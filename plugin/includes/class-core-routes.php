<?php
/**
 * WebMaven Core Routes & Handlers
 *
 * Contains all route registrations that were previously inline in the main plugin class,
 * plus the handler methods for: signup, settings, user prefs, test, activation,
 * backend connection, config, plugin status, site context, themes and the owner's plan.
 *
 * 1.2.9: every route here that reaches the WPMaven API takes an administrator
 * (current_user_can_reach_api). The /ai/* routes (API /agent/process) and
 * /editor/index (API /conversations/:id/index) are gone: the API has neither.
 *
 * Note: handle_plugin_activation references $this->plugin->maybe_install_wp_cli()
 *       — the main class method maybe_install_wp_cli() must be made public.
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/class-webmaven-choices.php';
require_once __DIR__ . '/class-webmaven-edition.php';

// register_routes() registers /ping from this class;
// require it here too so the routes load wherever this file is loaded.
require_once __DIR__ . '/class-webmaven-site-ping.php';
// Link tokens (1.2.14): register_routes() registers /link/start from it, and
// /activate is gated by it.
require_once __DIR__ . '/class-webmaven-link-guard.php';
// The API's route table: the PDF route takes the tiers it names (1.3.0).
require_once __DIR__ . '/class-webmaven-site-routes.php';
// The guided tours' progress (1.7.0): register_routes() registers /tour from it.
require_once __DIR__ . '/class-webmaven-tours.php';

class WebMaven_Core_Routes {

    private $plugin;

    public function __construct($plugin) {
        $this->plugin = $plugin;
    }

    public function register_routes() {
        // Activation: called server to server by the WPMaven API, and gated by
        // WebMavenWordPress::authorize_link_push (WebMaven_Link_Guard).
        register_rest_route('webmaven_wp/v1', '/activate', [
            'methods' => 'POST',
            'permission_callback' => [$this, 'check_activation_permission'],
            'callback' => [$this, 'handle_plugin_activation'],
        ]);

        // A link token for an administrator's Sign In (1.2.14): the push that
        // links this site must carry it. Administrators only.
        WebMaven_Link_Guard::register_route();

        // Test: gated. It reports the WP version, site info and API config,
        // so it must not be anonymous.
        register_rest_route('webmaven_wp/v1', '/test', [
            'methods' => 'GET',
            'permission_callback' => function() { return $this->plugin->current_user_can_use(); },
            'callback' => [$this, 'test_plugin'],
        ]);

        // Backend connection test (reaches the API: administrators only, 1.2.9)
        register_rest_route('webmaven_wp/v1', '/backend/test', [
            'methods' => 'GET',
            'permission_callback' => function() { return $this->plugin->current_user_can_reach_api(); },
            'callback' => [$this, 'test_backend_connection'],
        ]);

        // Backend config
        register_rest_route('webmaven_wp/v1', '/backend/config', [
            'methods' => 'GET',
            'permission_callback' => function() { return $this->plugin->current_user_can_use(); },
            'callback' => [$this, 'get_backend_config'],
        ]);

        // Status & health. /status is gated. It
        // reports connection/auth state, so it must not be anonymous. The
        // wp-admin dashboard calls it as a logged-in user. Since 1.2.9 it never
        // clears tokens and never refreshes them, and only an administrator's
        // call can reach the API (see get_plugin_status).
        register_rest_route('webmaven_wp/v1', '/status', [
            'methods' => 'GET',
            'permission_callback' => function() { return $this->plugin->current_user_can_use(); },
            'callback' => [$this, 'get_plugin_status'],
        ]);

        register_rest_route('webmaven_wp/v1', '/heartbeat', [
            'methods' => 'GET',
            'permission_callback' => '__return_true',
            // Anonymous liveness ping. It never returns the PHP or WordPress
            // version: those would tell anyone which known flaws to try.
            'callback' => function() {
                return new \WP_REST_Response([
                    'ok' => true,
                    'version' => WEBMAVEN_WP_VERSION,
                    'timestamp' => gmdate('c'),
                ]);
            },
        ]);

        // Anonymous check that PHP and the database
        // answer (1.2.12). WPMaven's servers read it every minute on hosted
        // sites; /heartbeat above stays as it is.
        WebMaven_Site_Ping::register_route();

        // The guided tours' progress (1.7.0): the signed-in user's own, in
        // their user meta, for anyone who can open the app. Never the
        // account's: every WordPress user would share the owner's record.
        WebMaven_Tours::register_route(function() { return $this->plugin->current_user_can_use(); });

        // The owner's plan and usage (1.2.8): the site owner only
        // (manage_options), like every route that speaks for the account. It
        // used to take any user who can edit posts, which was harmless only
        // while the API refused the call. There is no usage-overview route:
        // nothing showed it, and the API's overview carries the account's AI
        // spend.
        register_rest_route('webmaven_wp/v1', '/subscription', [
            'methods' => 'GET',
            'permission_callback' => function() { return $this->plugin->current_user_can_reach_api(); },
            'callback' => [$this, 'get_subscription'],
        ]);

        // Site context & themes. The context lists every active plugin with
        // its version, the theme, the users per role and whether WP-CLI is
        // there: an administrator's to read (1.4.0, security review
        // 2026-10-08; it answered any user who can edit posts, so a
        // Contributor read the site's whole inventory). Nothing in the app
        // reads it for a lower role.
        register_rest_route('webmaven_wp/v1', '/site/context', [
            'methods' => 'GET',
            'permission_callback' => function() { return $this->plugin->current_user_can_reach_api(); },
            'callback' => [$this, 'get_site_context'],
        ]);

        // The owner's choices (WebMaven_Choices): visitor statistics, the
        // customers' copy for email campaigns, the footer link, and which of
        // them the owner answered. An administrator's to read and to change.
        register_rest_route('webmaven_wp/v1', '/choices', [
            [
                'methods' => 'GET',
                'permission_callback' => function () { return current_user_can('manage_options'); },
                'callback' => function () { return new \WP_REST_Response(WebMaven_Choices::report()); },
            ],
            [
                'methods' => 'POST',
                'permission_callback' => function () { return current_user_can('manage_options'); },
                'callback' => [$this, 'save_choices'],
            ],
        ]);

        // Focus mode: the app over the whole window, WordPress's menu and bar
        // hidden. Each user's own, off until they turn it on.
        register_rest_route('webmaven_wp/v1', '/focus-mode', [
            'methods' => 'POST',
            'permission_callback' => function () { return $this->plugin->current_user_can_use(); },
            'callback' => function (\WP_REST_Request $req) {
                $on = rest_sanitize_boolean($req->get_param('on'));
                update_user_meta(get_current_user_id(), WebMaven_Admin::FOCUS_MODE_META, $on ? '1' : '0');
                return new \WP_REST_Response(['focusMode' => $on]);
            },
        ]);

        register_rest_route('webmaven_wp/v1', '/themes/list', [
            'methods' => 'GET',
            'permission_callback' => function() { return $this->plugin->current_user_can_use(); },
            'callback' => [$this, 'list_themes_with_flag'],
        ]);

        // A report's PDF (a file, so not through the JSON proxy): the tiers
        // the API's route table gives GET /reports/:reportId/pdf (1.3.0).
        register_rest_route('webmaven_wp/v1', '/reports/(?P<reportId>[a-zA-Z0-9_-]+)/pdf', [
            'methods' => 'GET',
            'permission_callback' => function() {
                $rule = WebMaven_Site_Routes::rule('GET', '/reports/:reportId/pdf');
                return $rule !== null && WebMaven_Site_Routes::tier_allowed($rule, $this->plugin->current_user_api_tier());
            },
            'callback' => [$this, 'download_report_pdf'],
            'args' => [
                'reportId' => ['type' => 'string', 'required' => true],
            ],
        ]);

        // API Proxy (1.3.0): any user with an API tier (Administrator, Shop
        // manager, Editor); the API's route table decides each call, for the
        // user's tier (WebMaven_Proxy). Authors and below reach nothing.
        register_rest_route('webmaven_wp/v1', '/proxy/(?P<path>.+)', [
            'methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
            'permission_callback' => function() { return $this->plugin->current_user_api_tier() !== null; },
            'callback' => [$this->plugin->proxy, 'handle_api_proxy'],
        ]);
    }

    // ---------- REST handlers ----------

    public function handle_signup(\WP_REST_Request $req) {
        $params = $req->get_params();
        $email = sanitize_email($params['email'] ?? '');
        $name = sanitize_text_field($params['name'] ?? '');
        $company = sanitize_text_field($params['company'] ?? '');

        if (empty($email) || empty($name)) {
            return new \WP_Error('invalid', 'Name and email are required', ['status' => 400]);
        }

        $account = [
            'email' => $email,
            'name'  => $name,
            'company' => $company,
            'created_at' => current_time('mysql'),
            'token' => wp_generate_password(20, false, false),
        ];
        update_option('webmaven_wp_account', $account, false);

        return new \WP_REST_Response(['success' => true, 'account' => $account]);
    }

    public function get_settings() {
        $settings = get_option('webmaven_wp_settings', []);
        // The owner's choices as they are in effect, defaults included.
        return new \WP_REST_Response(array_merge(is_array($settings) ? $settings : [], WebMaven_Choices::all()));
    }

    /** POST /choices: the choices the body names, saved; answers every choice. */
    public function save_choices(\WP_REST_Request $req) {
        $settings = get_option('webmaven_wp_settings', []);
        $before = WebMaven_Choices::on('contact_sync_enabled');
        update_option('webmaven_wp_settings', WebMaven_Choices::apply((array) $req->get_json_params() + (array) $req->get_body_params(), is_array($settings) ? $settings : []));
        // The customers' copy starts with a full sync once it is turned on.
        if (!$before && WebMaven_Choices::on('contact_sync_enabled') && class_exists('WebMaven_Contact_Sync')) {
            WebMaven_Contact_Sync::init();
        }
        return new \WP_REST_Response(WebMaven_Choices::report());
    }

    public function save_settings(\WP_REST_Request $req) {
        $params = $req->get_params();
        $settings = get_option('webmaven_wp_settings', []);

        $settings['theme_color']  = isset($params['theme_color']) ? sanitize_hex_color($params['theme_color']) : ($settings['theme_color'] ?? '#7c3aed');
        $settings['accent_color'] = isset($params['accent_color']) ? sanitize_hex_color($params['accent_color']) : ($settings['accent_color'] ?? '#22d3ee');

        $position = sanitize_text_field($params['position'] ?? ($settings['position'] ?? 'bottom-right'));
        if (!in_array($position, ['bottom-right', 'bottom-left', 'top-right', 'top-left'], true)) {
            $position = 'bottom-right';
        }
        $settings['position'] = $position;

        $offset = isset($params['offset']) ? intval($params['offset']) : ($settings['offset'] ?? 20);
        $settings['offset'] = max(0, min(100, $offset));

        if (isset($params['oauth_authorize_url'])) {
            $settings['oauth_authorize_url'] = esc_url_raw($params['oauth_authorize_url']);
        }
        if (isset($params['dashboard_url'])) {
            $settings['dashboard_url'] = esc_url_raw($params['dashboard_url']);
        }
        if (isset($params['api_base_url'])) {
            $settings['api_base_url'] = esc_url_raw($params['api_base_url']);
            // Also update the webmaven_wp_api_url option for the API client
            update_option('webmaven_wp_api_url', esc_url_raw($params['api_base_url']));
        }
        if (isset($params['websocket_url'])) {
            $settings['websocket_url'] = esc_url_raw($params['websocket_url']);
            // Also store WebSocket URL separately for easy access
            if ($settings['websocket_url']) {
                update_option('webmaven_wp_websocket_url', esc_url_raw($params['websocket_url']));
            } else {
                delete_option('webmaven_wp_websocket_url');
            }
        }
        if (isset($params['billing_portal_url'])) {
            $settings['billing_portal_url'] = esc_url_raw($params['billing_portal_url']);
        }
        // The owner's choices: statistics, the customers' copy, the footer link.
        $settings = WebMaven_Choices::apply($params, $settings);

        update_option('webmaven_wp_settings', $settings);

        return new \WP_REST_Response(['success' => true, 'settings' => $settings]);
    }

    public function get_user_prefs() {
        $prefs = get_user_meta(get_current_user_id(), 'wpai_user_prefs', true);
        if (!is_array($prefs)) $prefs = null;
        return new \WP_REST_Response(['success' => true, 'prefs' => $prefs]);
    }

    public function save_user_prefs(\WP_REST_Request $req) {
        $params = $req->get_json_params();
        $clear = !empty($params['clear']);
        if ($clear) {
            delete_user_meta(get_current_user_id(), 'wpai_user_prefs');
            return new \WP_REST_Response(['success' => true, 'prefs' => null]);
        }

        $prefs = get_user_meta(get_current_user_id(), 'wpai_user_prefs', true);
        if (!is_array($prefs)) $prefs = [];

        // Allow explicitly clearing position override without affecting other prefs
        if (!empty($params['positionClear'])) {
            if (isset($prefs['position'])) unset($prefs['position']);
        }

        if (isset($params['position']) && is_array($params['position'])) {
            $prefs['position'] = [
                'top' => max(0, intval($params['position']['top'] ?? 0)),
                'left' => max(0, intval($params['position']['left'] ?? 0)),
            ];
        }
        if (isset($params['panelHeight'])) {
            $prefs['panelHeight'] = max(300, min(1000, intval($params['panelHeight'])));
        }
        if (isset($params['colors']) && is_array($params['colors'])) {
            $prefs['colors'] = [
                'theme' => sanitize_hex_color($params['colors']['theme'] ?? '#7c3aed'),
                'accent' => sanitize_hex_color($params['colors']['accent'] ?? '#22d3ee'),
            ];
        }

        update_user_meta(get_current_user_id(), 'wpai_user_prefs', $prefs);
        return new \WP_REST_Response(['success' => true, 'prefs' => $prefs]);
    }

    // ---------- Test and Debug Handlers ----------

    public function test_plugin(\WP_REST_Request $req) {
        $api_client = new WebMaven_WP_API_Client();
        return new \WP_REST_Response(array(
            'success' => true,
            'message' => 'WebMaven WordPress plugin is working!',
            'plugin_version' => defined('WEBMAVEN_WP_VERSION') ? WEBMAVEN_WP_VERSION : '0.0.0',
            'wordpress_version' => get_bloginfo('version'),
            'site_url' => get_site_url(),
            'site_name' => get_bloginfo('name'),
            'timestamp' => current_time('mysql'),
            'user_logged_in' => is_user_logged_in(),
            'current_user_id' => get_current_user_id(),
            'api_base_url' => get_option('webmaven_wp_api_url', 'NOT_SET'),
            'api_client_url' => $api_client->api_base_url ?? 'NOT_SET',
            'client_id_set' => !empty(get_option('webmaven_wp_client_id')),
            'client_secret_set' => !empty(get_option('webmaven_wp_client_secret'))
        ), 200);
    }

    // ---------- Backend API Integration Handlers ----------

    /** See WebMavenWordPress::authorize_link_push(). */
    public function check_activation_permission(\WP_REST_Request $req) {
        return $this->plugin->authorize_link_push($req);
    }

    public function handle_plugin_activation(\WP_REST_Request $req) {
        // Called server-to-server by the WPMaven API. Never log the payload: it
        // carries the client secret and the authorization code.
        $data = $req->get_json_params();
        if (!is_array($data)) {
            $data = array();
        }

        $client_id          = $data['oauthClient']['clientId'] ?? $data['clientId'] ?? '';
        $client_secret      = $data['oauthClient']['clientSecret'] ?? $data['clientSecret'] ?? '';
        $authorization_code = $data['authorizationCode'] ?? '';
        $instance_id        = $data['instanceId'] ?? '';

        if (empty($client_id) || empty($client_secret) || empty($authorization_code)) {
            return new \WP_REST_Response(array(
                'success' => false,
                'error' => 'Missing required OAuth credentials'
            ), 400);
        }

        $api_client = new WebMaven_WP_API_Client();
        $api_base_url = get_option('webmaven_wp_api_url', WEBMAVEN_WP_API_BASE_URL);
        if (empty($api_client->api_base_url) || $api_client->api_base_url === 'NOT_SET') {
            $api_client->api_base_url = $api_base_url;
        }

        // Prove the pushed credentials against the WPMaven API BEFORE saving
        // anything. The old handler saved them first, so a failed exchange
        // still left a caller-chosen secret in place, and that secret then
        // signed forged webhooks that run as an administrator.
        $api_client->use_credentials(sanitize_text_field($client_id), sanitize_text_field($client_secret));
        $token_response = $api_client->exchange_authorization_code($authorization_code);

        if (empty($token_response['success'])) {
            WebMaven_WP_Error_Handler::log_security_event('plugin_activation_failed', array(
                'error' => $token_response['error'] ?? 'Unknown error',
                'instance_id' => $instance_id
            ));
            return new \WP_REST_Response(array(
                'success' => false,
                'error' => 'Failed to exchange authorization code',
                'debug' => $token_response['error'] ?? 'Unknown error',
                'instanceId' => $instance_id
            ), 400);
        }

        $encrypted_client_id = WebMaven_WP_Error_Handler::encrypt_data(sanitize_text_field($client_id));
        $encrypted_client_secret = WebMaven_WP_Error_Handler::encrypt_data(sanitize_text_field($client_secret));
        if (!$encrypted_client_id || !$encrypted_client_secret) {
            WebMaven_WP_Error_Handler::log_security_event('oauth_credentials_encryption_failed', array(
                'instance_id' => $instance_id
            ));
            return new \WP_REST_Response(array(
                'success' => false,
                'error' => 'Failed to encrypt credentials'
            ), 500);
        }
        update_option('webmaven_wp_client_id', $encrypted_client_id);
        update_option('webmaven_wp_client_secret', $encrypted_client_secret);
        update_option('webmaven_wp_authorization_code', sanitize_text_field($authorization_code));
        // Linked: no token given out for this sign-in may link it again.
        WebMaven_Link_Guard::forget_all();

        if (!empty($instance_id)) {
            update_option('webmaven_wp_instance_id', sanitize_text_field($instance_id));
        }

        // The analytics tracking id: WebMaven_Analytics::inject_tracker() reads
        // this option and injects nothing without it. Activation is where the
        // site learns who it is, so it rides along with the instance id.
        if (!empty($data['trackingId'])) {
            update_option('webmaven_wp_tracking_id', sanitize_text_field($data['trackingId']));
        }
        if (!empty($data['scopes'])) {
            update_option('webmaven_wp_scopes', $data['scopes']);
        }
        if (!empty($data['redirectUri'])) {
            update_option('webmaven_wp_redirect_uri', sanitize_text_field($data['redirectUri']));
        }
        if (!empty($data['metadata'])) {
            update_option('webmaven_wp_metadata', $data['metadata']);
        }

        WebMaven_WP_Error_Handler::log_security_event('plugin_activated_successfully', array(
            'instance_id' => $instance_id
        ));

        // What WPMaven Agent does once the site is linked (WP-CLI), when
        // Agent is here.
        do_action('webmaven_connected', $instance_id);

        return new \WP_REST_Response(array(
            'success' => true,
            'message' => 'Plugin activated successfully',
            'instanceId' => $instance_id
        ), 200);
    }

    public function test_backend_connection() {
        $api_client = new WebMaven_WP_API_Client();
        $response = $api_client->test_connection();

        return new \WP_REST_Response(array(
            'success' => $response['success'],
            'message' => $response['success'] ? 'Backend connection successful' : 'Backend connection failed',
            'details' => $response
        ));
    }

    public function get_backend_config() {
        $api_client = new WebMaven_WP_API_Client();
        $config = $api_client->get_config_status();

        return new \WP_REST_Response(array(
            'success' => true,
            'config' => $config,
            'configured' => $api_client->is_configured()
        ));
    }

    /**
     * Connection checks the API refused in a row before WP-admin asks the
     * owner to sign in again (1.2.9). One refusal is never enough: a token
     * rotated by a parallel request, or a passing error, must not flip the
     * screen to Sign In.
     */
    const REJECTIONS_BEFORE_RECONNECT = 2;

    /**
     * GET /status (1.2.9). What the WP-admin app needs to pick its screen:
     *
     * - connection: 'connected' (the API accepts this site), 'unreachable'
     *   (linked, the API did not answer), 'reconnect' (linked, but the API
     *   refused the site's credentials on REJECTIONS_BEFORE_RECONNECT checks
     *   or token refreshes in a row) or 'not_connected' (no credentials or
     *   no tokens stored). Only the last two are "not connected":
     *   `authenticated` is false for them and the app shows Sign In.
     *
     * The check is GET /sites/me, the site state (2026-10-05; GET
     * /sites/me/plan before). It replaces GET /auth/me, which takes
     * dashboard sign-ins only: it failed on every site, the status then
     * refreshed the token (a rotation per call, while the app polled every 2
     * seconds), and one failed refresh deleted both tokens and disconnected
     * the site. Now:
     * - this route NEVER deletes a token and NEVER refreshes one;
     * - the result is cached site-wide (5 minutes, 1 minute after a failure),
     *   so polling does not reach the API each time;
     * - only an administrator's call reaches the API. Other WordPress users
     *   get the cached result or the local state.
     *
     * It also says whether the site needs setup, from the account
     * (WebMaven_Site_State): `onboarding` ('completed', 'skipped', 'needed'
     * or 'unknown'), `setup_needed`, and the app's view of the state
     * (`site_state`). `onboarding_completed` stays for older readers.
     */
    public function get_plugin_status($request = null) {
        $client_id = get_option('webmaven_wp_client_id');
        $client_secret = get_option('webmaven_wp_client_secret');
        $instance_id = get_option('webmaven_wp_instance_id');

        $is_configured = !empty($client_id) && !empty($client_secret);
        // The same test as WebMaven_WP_API_Client::is_configured(): every route
        // that needs the API answers "not connected" without an access token.
        $has_tokens = !empty(get_option('webmaven_wp_access_token'));

        // Stored but unreadable (the site's secret_key changed, a restore
        // of a broken dump before 1.6.0): no request could carry a token, so
        // the answer is a reconnect with its reason, without asking the API.
        $unreadable = $is_configured && $has_tokens && WebMaven_WP_API_Client::stored_connection_unreadable();

        if (!$is_configured || !$has_tokens) {
            $check = ['state' => 'not_connected', 'api_reachable' => false];
        } elseif ($unreadable) {
            $check = ['state' => 'reconnect', 'api_reachable' => true];
        } else {
            // ?refresh=1: an administrator asks again now (after "Check again",
            // or when the tab comes back), at most once every 30 seconds.
            $force = $request instanceof \WP_REST_Request
                && !empty($request->get_param('refresh'))
                && $this->plugin->current_user_can_reach_api()
                && WebMaven_Site_State::take_refresh_slot();
            $check = $this->connection_check($force);
        }

        $is_authenticated = in_array($check['state'], ['connected', 'unreachable'], true);

        // Whether this site has a business, as the account says (the site
        // state, GET /sites/me): 'completed', 'skipped', 'needed' or 'unknown'
        // (no answer yet: the app opens, the next read decides). A site that
        // is not connected never needs setup; a hosted one never does.
        $onboarding = WebMaven_Site_State::onboarding();
        $is_admin = current_user_can('manage_options');
        $setup_needed = $is_authenticated && WebMaven_Site_State::setup_needed();

        return new \WP_REST_Response([
            'success' => true,
            'status' => [
                'configured' => $is_configured,
                'authenticated' => $is_authenticated,
                'activated' => $is_configured && $is_authenticated,
                'api_reachable' => (bool) $check['api_reachable'],
                'connection' => $check['state'],
                // Why a reconnect is needed, when the site knows: 'unreadable'
                // (the stored connection no longer decrypts, after a restore).
                'connection_reason' => $unreadable ? 'unreadable' : null,
                'instance_id' => $instance_id ?: null,
                'onboarding' => $onboarding,
                'setup_needed' => $setup_needed,
                // For older readers: true unless the account says setup is needed.
                'onboarding_completed' => $onboarding !== 'needed',
                'chat_enabled' => function_exists('webmaven_wp_site_chat_enabled') ? webmaven_wp_site_chat_enabled() : false,
                'site_state' => WebMaven_Site_State::for_script($is_admin),
            ],
        ]);
    }

    /**
     * The linked site's connection state: ['state' => ..., 'api_reachable' => bool].
     * See get_plugin_status(). Refreshes only an expired token, and never deletes one.
     */
    private function connection_check($force = false) {
        $cached = get_transient(WebMaven_WP_API_Client::CONNECTION_CACHE);
        // An administrator's check also keeps the site state fresh: on a
        // connected site it reads again once the state is stale (5 minutes,
        // or 1 after a failed read) or gone (a sign-in, a push, a new
        // instance), even inside the verdict's own cache. A cached refusal
        // or outage is kept until it expires: reading again could not help.
        if (!$force && is_array($cached) && isset($cached['state'], $cached['api_reachable'])
            && (!$this->plugin->current_user_can_reach_api() || $cached['state'] !== 'connected' || WebMaven_Site_State::is_fresh())) {
            return $cached;
        }

        $refresh_rejected = (int) get_option(WebMaven_WP_API_Client::REFRESH_REJECTIONS, 0) >= self::REJECTIONS_BEFORE_RECONNECT;

        // A user who is not an administrator never reaches the API from here:
        // the last check's answer (above) or the local state.
        if (!$this->plugin->current_user_can_reach_api()) {
            $rejected = $refresh_rejected
                || (int) get_option(WebMaven_WP_API_Client::CONNECTION_REJECTIONS, 0) >= self::REJECTIONS_BEFORE_RECONNECT;
            return ['state' => $rejected ? 'reconnect' : 'connected', 'api_reachable' => !$rejected];
        }

        // GET /sites/me: the verdict, and the site state it answers (kept by
        // WebMaven_Site_State). A refresh only for a token that has expired.
        $api_client = new WebMaven_WP_API_Client();
        $response = WebMaven_Site_State::refresh('status', 15, $api_client);
        $code = (int) ($response['status_code'] ?? $api_client->get_last_response_code());

        // Another request rotated the token since this one read it: check
        // once more with the stored token. No refresh here.
        if ($code === 401 && !$api_client->access_token_expired() && $api_client->reload_tokens()) {
            $response = WebMaven_Site_State::refresh('status', 15, $api_client);
            $code = (int) ($response['status_code'] ?? $api_client->get_last_response_code());
        }

        if (!empty($response['success'])) {
            update_option(WebMaven_WP_API_Client::CONNECTION_REJECTIONS, 0, false);
            $result = ['state' => 'connected', 'api_reachable' => true];
            $ttl = 5 * MINUTE_IN_SECONDS;
        } elseif ($code === 401 && $api_client->access_token_expired()) {
            // Still expired after the read's own refresh (the network, or a
            // refresh running elsewhere): the next read tries again. Still
            // linked, unless the refreshes themselves keep being refused.
            $result = $refresh_rejected
                ? ['state' => 'reconnect', 'api_reachable' => true]
                : ['state' => 'connected', 'api_reachable' => true];
            $ttl = MINUTE_IN_SECONDS;
        } elseif ($code === 401) {
            // A valid-looking token the API refuses: revoked or rotated away.
            $rejections = (int) get_option(WebMaven_WP_API_Client::CONNECTION_REJECTIONS, 0) + 1;
            update_option(WebMaven_WP_API_Client::CONNECTION_REJECTIONS, $rejections, false);
            $result = ($rejections >= self::REJECTIONS_BEFORE_RECONNECT || $refresh_rejected)
                ? ['state' => 'reconnect', 'api_reachable' => true]
                : ['state' => 'connected', 'api_reachable' => true];
            $ttl = MINUTE_IN_SECONDS;
        } elseif ($code === 0 || $code === 429 || $code >= 500) {
            // Network error, rate limit or outage: the link is not in question.
            $result = ['state' => 'unreachable', 'api_reachable' => false];
            $ttl = MINUTE_IN_SECONDS;
        } else {
            // 403 (a scope), 404 (an API without the route): the API answered
            // and did not refuse the site itself.
            $result = ['state' => 'connected', 'api_reachable' => true];
            $ttl = 5 * MINUTE_IN_SECONDS;
        }

        set_transient(WebMaven_WP_API_Client::CONNECTION_CACHE, $result, $ttl);
        return $result;
    }

    /**
     * Comprehensive site context for AI — returns everything the LLM needs to understand the site.
     */
    public function get_site_context(\WP_REST_Request $request) {
        // Site info
        $site = [
            'name' => get_bloginfo('name'),
            'tagline' => get_bloginfo('description'),
            'url' => home_url(),
            'adminUrl' => admin_url(),
            'language' => get_locale(),
            'timezone' => get_option('timezone_string') ?: 'UTC' . get_option('gmt_offset'),
            'permalinkStructure' => get_option('permalink_structure') ?: 'plain',
        ];

        // Active theme
        $active_theme = wp_get_theme();
        $theme = [
            'name' => $active_theme->get('Name'),
            'slug' => $active_theme->get_stylesheet(),
            'version' => $active_theme->get('Version'),
            'supportsPostThumbnails' => current_theme_supports('post-thumbnails'),
            'supportsCustomLogo' => current_theme_supports('custom-logo'),
            'menuLocations' => array_keys(get_registered_nav_menus()),
        ];

        // Posts (recent 10)
        $recent_posts = get_posts(['post_type' => 'post', 'post_status' => 'any', 'numberposts' => 10, 'orderby' => 'date', 'order' => 'DESC']);
        $posts = [];
        foreach ($recent_posts as $p) {
            $posts[] = [
                'id' => $p->ID,
                'title' => $p->post_title,
                'status' => $p->post_status,
                'date' => $p->post_date,
                'slug' => $p->post_name,
                'commentCount' => (int) $p->comment_count,
                'hasFeaturedImage' => has_post_thumbnail($p->ID),
            ];
        }

        // Pages (all)
        $all_pages = get_posts(['post_type' => 'page', 'post_status' => 'any', 'numberposts' => 50, 'orderby' => 'menu_order', 'order' => 'ASC']);
        $pages = [];
        foreach ($all_pages as $p) {
            $pages[] = [
                'id' => $p->ID,
                'title' => $p->post_title,
                'status' => $p->post_status,
                'slug' => $p->post_name,
                'template' => get_page_template_slug($p->ID) ?: 'default',
            ];
        }

        // Categories
        $cats = get_terms(['taxonomy' => 'category', 'hide_empty' => false, 'number' => 50]);
        $categories = [];
        if (!is_wp_error($cats)) {
            foreach ($cats as $c) {
                $categories[] = ['id' => $c->term_id, 'name' => $c->name, 'slug' => $c->slug, 'count' => $c->count];
            }
        }

        // Tags
        $tag_terms = get_terms(['taxonomy' => 'post_tag', 'hide_empty' => false, 'number' => 50]);
        $tags = [];
        if (!is_wp_error($tag_terms)) {
            foreach ($tag_terms as $t) {
                $tags[] = ['id' => $t->term_id, 'name' => $t->name, 'slug' => $t->slug, 'count' => $t->count];
            }
        }

        // Menus
        $nav_menus = wp_get_nav_menus();
        $menus = [];
        $menu_locations = get_nav_menu_locations();
        foreach ($nav_menus as $menu) {
            $locations = [];
            foreach ($menu_locations as $loc => $menu_id) {
                if ($menu_id == $menu->term_id) $locations[] = $loc;
            }
            $items = wp_get_nav_menu_items($menu->term_id);
            $menus[] = [
                'id' => $menu->term_id,
                'name' => $menu->name,
                'locations' => $locations,
                'itemCount' => is_array($items) ? count($items) : 0,
            ];
        }

        // Active plugins
        if (!function_exists('get_plugins')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        $active_plugins = get_option('active_plugins', []);
        $all_plugins = get_plugins();
        $plugins = [];
        $plugin_flags = [
            'hasWooCommerce' => false,
            'hasYoast' => false,
            'hasWPForms' => false,
            'hasCF7' => false,
            'hasGravityForms' => false,
            'hasElementor' => false,
        ];
        foreach ($active_plugins as $plugin_file) {
            if (isset($all_plugins[$plugin_file])) {
                $slug = dirname($plugin_file);
                $plugins[] = [
                    'name' => $all_plugins[$plugin_file]['Name'],
                    'slug' => $slug,
                    'version' => $all_plugins[$plugin_file]['Version'],
                ];
                if (strpos($slug, 'woocommerce') !== false) $plugin_flags['hasWooCommerce'] = true;
                if (strpos($slug, 'wordpress-seo') !== false) $plugin_flags['hasYoast'] = true;
                if (strpos($slug, 'wpforms') !== false) $plugin_flags['hasWPForms'] = true;
                if (strpos($slug, 'contact-form-7') !== false) $plugin_flags['hasCF7'] = true;
                if (strpos($slug, 'gravityforms') !== false) $plugin_flags['hasGravityForms'] = true;
                if (strpos($slug, 'elementor') !== false) $plugin_flags['hasElementor'] = true;
            }
        }

        // Media count
        $attachments = wp_count_attachments();
        $media_count = (int) ($attachments->{'image/jpeg'} ?? 0) +
                       (int) ($attachments->{'image/png'} ?? 0) +
                       (int) ($attachments->{'image/gif'} ?? 0) +
                       (int) ($attachments->{'image/webp'} ?? 0);

        // Comments count
        $comment_counts = wp_count_comments();

        // Users
        $user_count = count_users();

        return new \WP_REST_Response([
            'success' => true,
            'data' => [
                'site' => $site,
                'theme' => $theme,
                'content' => [
                    'posts' => ['count' => wp_count_posts('post')->publish, 'recent' => $posts],
                    'pages' => ['count' => wp_count_posts('page')->publish, 'items' => $pages],
                    'media' => ['imageCount' => $media_count],
                    'comments' => ['total' => $comment_counts->total_comments, 'approved' => $comment_counts->approved, 'pending' => $comment_counts->moderated],
                ],
                'taxonomy' => [
                    'categories' => $categories,
                    'tags' => $tags,
                ],
                'navigation' => [
                    'menus' => $menus,
                    'registeredLocations' => array_keys(get_registered_nav_menus()),
                ],
                'plugins' => [
                    'active' => $plugins,
                    'flags' => $plugin_flags,
                ],
                'users' => [
                    'total' => $user_count['total_users'],
                    'roles' => $user_count['avail_roles'],
                ],
                // WP-CLI is WPMaven Agent's: it answers here when it is present.
                'cli' => apply_filters('webmaven_site_context_cli', [
                    'available' => false,
                    'status' => 'needs_agent',
                ]),
                // Which edition runs here, and what needs WPMaven Agent.
                'edition' => WebMaven_Edition::report(),
            ],
        ]);
    }

    /**
     * List all themes with WebMaven-generated flag
     */
    public function list_themes_with_flag(\WP_REST_Request $request) {
        $generated = get_option('webmaven_wp_generated_themes', []);
        if (!is_array($generated)) $generated = [];

        $themes = wp_get_themes();
        $active = get_stylesheet();
        $result = [];

        foreach ($themes as $stylesheet => $theme) {
            $result[] = [
                'stylesheet' => $stylesheet,
                'name' => $theme->get('Name'),
                'version' => $theme->get('Version'),
                'status' => ($stylesheet === $active) ? 'active' : 'inactive',
                'screenshot' => $theme->get_screenshot() ?: null,
                'description' => $theme->get('Description'),
                'author' => $theme->get('Author'),
                'webmavenGenerated' => in_array($stylesheet, $generated, true),
            ];
        }

        return new \WP_REST_Response([
            'success' => true,
            'data' => $result,
        ]);
    }

    /**
     * Get subscription information from backend API
     */
    public function get_subscription() {
        $api_client = new WebMaven_WP_API_Client();

        if (!$api_client->is_configured()) {
            return webmaven_wp_not_connected_response();
        }

        $response = $api_client->get_subscription_info();

        if ($response['success']) {
            // Cache the plan name for the sidebar (avoids an API call on page load).
            WebMaven_WP_API_Client::remember_plan_name($response['data'] ?? null);
            return new \WP_REST_Response([
                'success' => true,
                'data' => $response['data']
            ]);
        }

        return new \WP_REST_Response([
            'success' => false,
            'error' => $response['error'] ?? 'Failed to fetch subscription info'
        ], $response['status_code'] ?? 500);
    }

    /**
     * A report's PDF, streamed to the browser as the file it is (1.3.0): one
     * call through the API client, with the signed actor claim.
     */
    public function download_report_pdf(\WP_REST_Request $request) {
        $pdf = $this->report_pdf($request->get_param('reportId'));
        if ($pdf instanceof \WP_REST_Response) {
            return $pdf;
        }
        header('Content-Type: application/pdf');
        header('Content-Disposition: ' . ($pdf['disposition'] !== '' ? $pdf['disposition'] : 'attachment; filename="report.pdf"'));
        header('Content-Length: ' . strlen($pdf['body']));
        // The PDF's bytes (application/pdf), never read as HTML.
        echo $pdf['body']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
        exit;
    }

    /**
     * The PDF of a report: ['body' => bytes, 'disposition' => header], or the
     * refusal to answer (the API's status and code kept).
     */
    public function report_pdf($report_id) {
        $report_id = WebMaven_WP_API_Client::path_id($report_id);
        if ($report_id === '') {
            return new \WP_REST_Response(['success' => false, 'error' => 'This report could not be found.'], 400);
        }
        $api_client = new \WebMaven_WP_API_Client();
        if (!$api_client->is_configured()) {
            return webmaven_wp_not_connected_response();
        }
        $res = $api_client->fetch_binary('/reports/' . $report_id . '/pdf', 90);
        if (empty($res['success']) || strpos((string) ($res['content_type'] ?? ''), 'application/pdf') === false) {
            $out = ['success' => false, 'error' => 'The report could not be downloaded. Try again in a minute.'];
            if (!empty($res['code'])) {
                $out['code'] = $res['code'];
            }
            $status = (int) ($res['status_code'] ?? 0);
            return new \WP_REST_Response($out, $status >= 400 ? $status : 502);
        }
        // A header value must stay one line.
        $disposition = preg_replace('/[\r\n]+/', ' ', (string) ($res['disposition'] ?? ''));
        return ['body' => (string) $res['body'], 'disposition' => $disposition];
    }

}
