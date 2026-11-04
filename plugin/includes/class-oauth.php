<?php
/**
 * WebMaven OAuth
 * Routes and handlers for OAuth authentication flow and logout.
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/class-webmaven-log.php';

// Link tokens (1.2.14): /oauth/callback is gated by them, and a link or a
// sign-out drops them.
require_once __DIR__ . '/class-webmaven-link-guard.php';

class WebMaven_OAuth {

    private $plugin;

    public function __construct($plugin) {
        $this->plugin = $plugin;
    }

    public function register_routes() {
        // The API calls this server-to-server to relink a site (rotating its
        // credentials). Whoever sets a site's client secret can sign its
        // webhooks, so the route is gated:
        // WebMavenWordPress::authorize_link_push(), which since 1.2.14 also
        // refuses a site with no credentials unless the push carries a link
        // token its administrator asked for (WebMaven_Link_Guard).
        register_rest_route('webmaven_wp/v1', '/oauth/callback', [
            'methods' => 'POST',
            'permission_callback' => [$this, 'check_link_push'],
            'callback' => [$this, 'handle_oauth_callback'],
        ]);

        // SECURITY: Generate OAuth state and return auth URL
        register_rest_route('webmaven_wp/v1', '/oauth/initiate', [
            'methods' => 'POST',
            'permission_callback' => function() { return $this->plugin->current_user_can_use(); },
            'callback' => [$this, 'initiate_oauth'],
        ]);

        // Reaches the API (POST /oauth/token): administrators only (1.2.9).
        register_rest_route('webmaven_wp/v1', '/oauth/exchange', [
            'methods' => 'POST',
            'permission_callback' => function() { return $this->plugin->current_user_can_reach_api(); },
            'callback' => [$this, 'handle_oauth_exchange'],
            'args' => [
                'code' => ['type' => 'string', 'required' => true],
                'state' => ['type' => 'string', 'required' => true],
            ],
        ]);

        // Logout - Clear tokens from WordPress options
        register_rest_route('webmaven_wp/v1', '/logout', [
            'methods' => 'POST',
            // handle_logout deletes SITE-WIDE
            // connection options, so require an admin, not edit_posts.
            'permission_callback' => function() { return current_user_can('manage_options'); },
            'callback' => [$this, 'handle_logout'],
        ]);
    }

    public function check_link_push(\WP_REST_Request $req) {
        return $this->plugin->authorize_link_push($req);
    }

    public function handle_oauth_callback(\WP_REST_Request $req) {
        // Called server-to-server by the API to relink an existing instance.
        // The relink flow sends fresh credentials (rotated by the API) so a
        // plugin that lost them recovers automatically; older API versions send
        // only the authorization code and rely on the stored credentials. Both
        // `clientId`/`clientSecret` shapes (flat or nested under oauthClient)
        // are accepted. Never log the payload: it carries the client secret.
        $data = $req->get_json_params();
        if (!is_array($data) || empty($data['authorizationCode'])) {
            return new \WP_REST_Response(array(
                'success' => false,
                'error' => 'Missing authorization code'
            ), 400);
        }

        $client_id     = $data['oauthClient']['clientId']     ?? $data['clientId']     ?? '';
        $client_secret = $data['oauthClient']['clientSecret'] ?? $data['clientSecret'] ?? '';
        $rotating      = !empty($client_id) && !empty($client_secret);

        $api_client = new WebMaven_WP_API_Client();
        if ($rotating) {
            // Prove rotated credentials against the API
            // before saving them, never the other way around.
            $api_client->use_credentials(sanitize_text_field($client_id), sanitize_text_field($client_secret));
        }
        $token_response = $api_client->exchange_authorization_code($data['authorizationCode']);

        if (empty($token_response['success'])) {
            WebMaven_WP_Error_Handler::log_security_event('oauth_callback_failed', array(
                'error' => $token_response['error'] ?? 'Unknown error'
            ));
            return new \WP_REST_Response(array(
                'success' => false,
                'error' => 'Failed to exchange authorization code'
            ), 400);
        }

        if ($rotating) {
            $encrypted_client_id     = WebMaven_WP_Error_Handler::encrypt_data(sanitize_text_field($client_id));
            $encrypted_client_secret = WebMaven_WP_Error_Handler::encrypt_data(sanitize_text_field($client_secret));
            if (!$encrypted_client_id || !$encrypted_client_secret) {
                WebMaven_WP_Error_Handler::log_security_event('oauth_credentials_encryption_failed', array(
                    'instance_id' => $data['instanceId'] ?? 'unknown',
                ));
                return new \WP_REST_Response(array(
                    'success' => false,
                    'error' => 'Failed to encrypt rotated credentials'
                ), 500);
            }
            update_option('webmaven_wp_client_id',     $encrypted_client_id);
            update_option('webmaven_wp_client_secret', $encrypted_client_secret);
            WebMaven_WP_Error_Handler::log_security_event('oauth_credentials_rotated', array(
                'instance_id' => $data['instanceId'] ?? 'unknown',
            ));
        }

        update_option('webmaven_wp_authorization_code', sanitize_text_field($data['authorizationCode']));
        if (!empty($data['instanceId'])) {
            update_option('webmaven_wp_instance_id', sanitize_text_field($data['instanceId']));
        }
        // Linked: no token given out for this sign-in may link it again.
        WebMaven_Link_Guard::forget_all();

        WebMaven_WP_Error_Handler::log_security_event('oauth_callback_successful', array(
            'instance_id' => $data['instanceId'] ?? 'unknown'
        ));
        return new \WP_REST_Response(array(
            'success' => true,
            'message' => 'OAuth callback processed successfully'
        ), 200);
    }

    /**
     * SECURITY: Generate OAuth state and return authorization URL.
     * This prevents CSRF attacks on the OAuth callback.
     */
    public function initiate_oauth(\WP_REST_Request $req) {
        $user_id = get_current_user_id();

        // Generate cryptographically secure state parameter
        $state = wp_generate_password(32, false);

        // Store state with 10-minute expiration (one-time use)
        set_transient('webmaven_oauth_state_' . $user_id, $state, 600);

        // Get OAuth configuration
        $settings = get_option('webmaven_wp_settings', array());
        $client_id = WebMaven_WP_Error_Handler::decrypt_data(get_option('webmaven_wp_client_id'));

        if (!$client_id) {
            return new \WP_REST_Response(array(
                'success' => false,
                'error' => 'OAuth credentials not configured. Please complete backend activation first.'
            ), 400);
        }

        // Build OAuth authorization URL
        $oauth_authorize_url = $settings['oauth_authorize_url'] ?? WEBMAVEN_WP_DASHBOARD_URL . '/oauth/authorize';
        $redirect_uri = rest_url('webmaven_wp/v1/oauth/exchange');

        $auth_url = add_query_arg(array(
            'client_id' => $client_id,
            'redirect_uri' => urlencode($redirect_uri),
            'response_type' => 'code',
            'state' => $state,
            'scope' => 'read write conversations files'
        ), $oauth_authorize_url);

        WebMaven_WP_Error_Handler::log_security_event('oauth_initiated', array(
            'user_id' => $user_id
        ));

        return new \WP_REST_Response(array(
            'success' => true,
            'data' => array(
                'authUrl' => $auth_url,
                'state' => $state
            )
        ), 200);
    }

    public function handle_oauth_exchange(\WP_REST_Request $req) {
        // This endpoint is called by the frontend to exchange authorization code for token
        $params = $req->get_params();

        // Validate required fields
        if (empty($params['code']) || empty($params['state'])) {
            return new \WP_REST_Response(array(
                'success' => false,
                'error' => 'Missing authorization code or state'
            ), 400);
        }

        // SECURITY: Validate OAuth state parameter to prevent CSRF
        $user_id = get_current_user_id();
        $stored_state = get_transient('webmaven_oauth_state_' . $user_id);
        delete_transient('webmaven_oauth_state_' . $user_id); // One-time use

        if (!$stored_state || !hash_equals($stored_state, $params['state'])) {
            WebMaven_WP_Error_Handler::log_security_event('oauth_state_mismatch', array(
                'user_id' => $user_id,
                'expected_state' => $stored_state ? 'present' : 'missing',
                'received_state' => $params['state'] ? 'present' : 'missing'
            ));
            return new \WP_REST_Response(array(
                'success' => false,
                'error' => 'Invalid state parameter - possible CSRF attack'
            ), 403);
        }

        // Get stored OAuth credentials
        $client_id = WebMaven_WP_Error_Handler::decrypt_data(get_option('webmaven_wp_client_id'));
        $client_secret = WebMaven_WP_Error_Handler::decrypt_data(get_option('webmaven_wp_client_secret'));

        if (!$client_id || !$client_secret) {
            return new \WP_REST_Response(array(
                'success' => false,
                'error' => 'OAuth credentials not found. Please complete the backend activation first.'
            ), 400);
        }

        // Exchange code for token using the API client
        $api_client = new WebMaven_WP_API_Client();
        $token_response = $api_client->exchange_authorization_code($params['code']);

        if ($token_response['success']) {
            // The site's tokens are stored (encrypted) by the exchange itself.
            // Never hand a raw token to the browser, and never keep a copy in
            // user meta (1.2.9): both used to happen here.
            WebMaven_WP_Error_Handler::log_security_event('oauth_exchange_successful', array(
                'user_id' => get_current_user_id()
            ));

            return new \WP_REST_Response(array(
                'success' => true,
                'message' => 'Authorization code exchanged successfully'
            ), 200);
        }

        WebMaven_WP_Error_Handler::log_security_event('oauth_exchange_failed', array(
            'error' => $token_response['error'] ?? 'Unknown error',
            'user_id' => get_current_user_id()
        ));

        return new \WP_REST_Response(array(
            'success' => false,
            'error' => 'Failed to exchange authorization code'
        ), 400);
    }

    // Logout handler - Clear tokens from WordPress options
    public function handle_logout(\WP_REST_Request $req) {
        WebMaven_Log::write('WebMaven WordPress: Logout requested');

        try {
            // Clear all authentication-related options
            delete_option('webmaven_wp_access_token');
            delete_option('webmaven_wp_refresh_token');
            delete_option('webmaven_wp_token_expires_at');
            delete_option('webmaven_wp_client_id');
            delete_option('webmaven_wp_client_secret');
            delete_option('webmaven_wp_authorization_code');
            delete_option('webmaven_wp_instance_id');
            delete_option('webmaven_wp_scopes');
            delete_option('webmaven_wp_redirect_uri');
            delete_option('webmaven_wp_metadata');
            // A sign-in started before this sign-out cannot link the site.
            WebMaven_Link_Guard::forget_all();

            WebMaven_Log::write('WebMaven WordPress: All authentication tokens and data cleared successfully');

            return new \WP_REST_Response([
                'success' => true,
                'message' => 'Logout successful'
            ]);
        } catch (Exception $e) {
            WebMaven_Log::write('WebMaven WordPress: Logout error: ' . $e->getMessage());
            return new \WP_Error('logout_error', 'Failed to logout', ['status' => 500]);
        }
    }
}
