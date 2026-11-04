<?php
/**
 * WebMaven Realtime
 * Routes and handlers for SSE/Realtime connections (SSE config, tickets, agent execution).
 *
 * 1.2.9: /websocket/config is gone (it handed the raw access token to the
 * browser). The ticket, execute and approval routes reach the API, so they
 * take an administrator, and while WEBMAVEN_WP_SITE_TOKEN_CHAT is off they
 * answer the dashboard card without calling the API.
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/class-webmaven-log.php';

class WebMaven_Realtime {

    private $plugin;

    public function __construct($plugin) {
        $this->plugin = $plugin;
    }

    public function register_routes() {
        // SSE configuration
        register_rest_route('webmaven_wp/v1', '/sse/config', [
            'methods' => 'GET',
            'permission_callback' => function() { return $this->plugin->current_user_can_use(); },
            'callback' => [$this, 'get_sse_config'],
        ]);

        // SECURITY: SSE ticket endpoint - gets a short-lived ticket for SSE connection
        // This keeps the JWT server-side, only exposes a 30-second single-use ticket
        // Note: args validation removed because parameters come from JSON body, not query/URL
        // The callback handles parameter validation
        register_rest_route('webmaven_wp/v1', '/sse/ticket', [
            'methods' => 'POST',
            'permission_callback' => function() { return $this->plugin->current_user_can_reach_api(); },
            'callback' => [$this, 'get_sse_ticket'],
        ]);

        // SSE agent execution endpoint
        // Note: args are not used here because parameters come from JSON body, not query/URL
        register_rest_route('webmaven_wp/v1', '/backend/agent/sse/execute', [
            'methods' => 'POST',
            // An agent run spends the owner's metered actions.
            'permission_callback' => function() { return $this->plugin->current_user_can_reach_api(); },
            'callback' => [$this, 'execute_agent_sse'],
        ]);

        // SSE approval endpoint
        // Note: stepId is in URL path, other args come from JSON body (not query/URL)
        register_rest_route('webmaven_wp/v1', '/backend/agent/sse/approval/(?P<stepId>[a-zA-Z0-9_-]+)', [
            'methods' => 'POST',
            // Approving a pending step lets it publish or spend: owner only.
            'permission_callback' => function() { return $this->plugin->current_user_can_reach_api(); },
            'callback' => [$this, 'send_approval_sse'],
            'args' => [
                'stepId' => [
                    'type' => 'string',
                    'required' => true,
                    'validate_callback' => function($param) {
                        return !empty($param) && preg_match('/^[a-zA-Z0-9_-]+$/', $param);
                    }
                ],
            ],
        ]);
    }

    // ---------- SSE Handler ----------

    /**
     * Get SSE configuration (base URL only, no token).
     * SECURITY: Token is no longer included. Use get_sse_ticket() to get a short-lived ticket.
     */
    public function get_sse_config() {
        $api_client = new WebMaven_WP_API_Client();

        // Get browser API base URL (for browser-side requests like SSE)
        $settings = get_option('webmaven_wp_settings', []);
        $browser_api_base_url = $settings['browser_api_base_url'] ?? WEBMAVEN_WP_BROWSER_API_BASE_URL;

        if (!$browser_api_base_url) {
            return new \WP_Error('not_configured', 'Backend not configured', ['status' => 400]);
        }

        // Construct SSE URL (without token - use ticket instead)
        $sse_url = rtrim($browser_api_base_url, '/');

        // Handle different protocol cases. No socket is opened here: a ws or
        // wss address in the setting is read as the http or https one for SSE.
        if (strpos($sse_url, 'wss://') === 0 || strpos($sse_url, 'ws://') === 0) { // nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket
            $sse_url = str_replace(['wss://', 'ws://'], ['https://', 'http://'], $sse_url); // nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket
        } elseif (strpos($sse_url, 'https://') !== 0 && strpos($sse_url, 'http://') !== 0) {
            $sse_url = 'https://' . ltrim($sse_url, '/');
        }

        // Remove trailing /api if present
        if (substr($sse_url, -4) === '/api') {
            $sse_url = substr($sse_url, 0, -4);
        }

        // Store base URL before adding endpoint path (for onboarding and other SSE connections)
        $base_url = $sse_url . '/api';

        // Add SSE endpoint path (no token - ticket will be added by frontend)
        $sse_url .= '/api/agent/sse';

        $config = array(
            'url' => $sse_url,
            'max_reconnect_attempts' => 10,
            'reconnect_interval' => 5000,
            'useTicket' => true  // Signal to frontend to use ticket-based auth
        );

        return new \WP_REST_Response(array(
            'success' => true,
            'data' => array(
                'baseUrl' => $base_url  // Base API URL for building custom SSE endpoints
            ),
            'config' => $config,
            'available' => $api_client->is_configured()
        ));
    }

    /**
     * SECURITY: Get a short-lived SSE ticket.
     * This keeps the JWT server-side - only a 30-second single-use ticket is exposed to frontend.
     */
    public function get_sse_ticket(\WP_REST_Request $req) {
        WebMaven_Log::write('WebMaven WordPress: get_sse_ticket called');

        if (!webmaven_wp_site_chat_enabled()) {
            return webmaven_wp_chat_in_dashboard_response();
        }

        $api_client = new WebMaven_WP_API_Client();

        if (!$api_client->is_configured()) {
            WebMaven_Log::write('WebMaven WordPress: get_sse_ticket - API client not configured');
            return webmaven_wp_not_connected_response();
        }

        // Get parameters from JSON body (POST request)
        $json_params = $req->get_json_params();
        $params = $req->get_params();

        // The parameters' names only: their values are the owner's words.
        WebMaven_Log::write('WebMaven WordPress: get_sse_ticket - params: ' . implode(', ', array_keys(array_merge((array) $json_params, (array) $params))));

        // Try JSON params first, then fall back to regular params. The id goes
        // into the API request: plain id characters only (1.2.9).
        $conversation_id = WebMaven_WP_API_Client::path_id($json_params['conversationId'] ?? $params['conversationId'] ?? '');
        $instance_id = isset($json_params['instanceId']) ? sanitize_text_field($json_params['instanceId']) :
                      (isset($params['instanceId']) ? sanitize_text_field($params['instanceId']) : null);

        WebMaven_Log::write('WebMaven WordPress: get_sse_ticket - conversationId: ' . $conversation_id);

        if (empty($conversation_id)) {
            WebMaven_Log::write('WebMaven WordPress: get_sse_ticket - conversationId is missing');
            return new \WP_Error('missing_conversation_id', 'conversationId is required', ['status' => 400]);
        }

        // Get ticket from API (server-to-server, using stored JWT)
        $result = $api_client->get_sse_ticket($conversation_id, $instance_id);

        if (!$result['success']) {
            WebMaven_WP_Error_Handler::log_security_event('sse_ticket_failed', array(
                'error' => $result['error'] ?? 'Unknown error',
                'conversation_id' => $conversation_id
            ));
            return new \WP_Error('ticket_failed', $result['error'] ?? 'Failed to get SSE ticket', ['status' => $result['status_code'] ?? 500]);
        }

        return new \WP_REST_Response(array(
            'success' => true,
            'ticket' => $result['ticket'],
            'expiresIn' => $result['expiresIn']
        ));
    }

    public function execute_agent_sse($request) {
        if (!webmaven_wp_site_chat_enabled()) {
            return webmaven_wp_chat_in_dashboard_response();
        }

        $api_client = new WebMaven_WP_API_Client();

        if (!$api_client->is_configured()) {
            return webmaven_wp_not_connected_response();
        }

        $body = $request->get_json_params();

        // Validate required parameters
        if (empty($body['prompt'])) {
            return new \WP_Error('missing_prompt', 'prompt is required', ['status' => 400]);
        }

        if (empty($body['conversationId'])) {
            return new \WP_Error('missing_conversation_id', 'conversationId is required', ['status' => 400]);
        }

        // The site's own time zone and language, set here so they win over
        // anything the browser sent: the chat says today's date in the site's
        // zone, its tasks run at the site's hours, and text it writes for the
        // site follows the site's language. The actor claim signs the body as sent.
        if (function_exists('wp_timezone_string')) {
            $body['timeZone'] = wp_timezone_string();
        }
        if (function_exists('get_locale')) {
            $body['siteLocale'] = get_locale();
        }

        // Proxy request to backend API
        // Note: base URL already includes /api, so endpoint should not start with /api
        $endpoint = '/agent/sse/execute';
        $response = $api_client->make_request($endpoint, 'POST', $body);

        if (!$response['success']) {
            return new \WP_Error('backend_error', $response['error'] ?? 'Failed to execute agent', ['status' => $response['status_code'] ?? 500]);
        }

        return new \WP_REST_Response($response);
    }

    public function send_approval_sse($request) {
        if (!webmaven_wp_site_chat_enabled()) {
            return webmaven_wp_chat_in_dashboard_response();
        }

        $api_client = new WebMaven_WP_API_Client();

        if (!$api_client->is_configured()) {
            return webmaven_wp_not_connected_response();
        }

        $step_id = $request->get_param('stepId');
        $body = $request->get_json_params();

        // Validate required parameters
        if (empty($body['conversationId'])) {
            return new \WP_Error('missing_conversation_id', 'conversationId is required', ['status' => 400]);
        }

        if (!isset($body['approved'])) {
            return new \WP_Error('missing_approved', 'approved is required', ['status' => 400]);
        }

        // Proxy request to backend API
        // Note: base URL already includes /api, so endpoint should not start with /api
        $endpoint = '/agent/sse/approval/' . urlencode($step_id);
        $response = $api_client->make_request($endpoint, 'POST', $body);

        if (!$response['success']) {
            // The API's status, not a blanket 500 (1.2.9).
            return new \WP_Error('backend_error', $response['error'] ?? 'Failed to send approval', ['status' => $response['status_code'] ?? 502]);
        }

        return new \WP_REST_Response($response);
    }
}
