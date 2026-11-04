<?php
/**
 * WebMaven Conversation Routes & Handlers
 *
 * 1.2.9: every route here that reaches the WPMaven API takes an administrator
 * (current_user_can_reach_api), and while WEBMAVEN_WP_SITE_TOKEN_CHAT is off
 * it answers the "run in your WPMaven dashboard" card without calling the
 * API. The API's own status is passed through (a refusal is never a 500).
 * Removed: /signup and /chat (their handlers called methods that do not
 * exist, a PHP fatal), and the anonymous /test-simple and /test-messages.
 */

if (!defined('ABSPATH')) exit;

class WebMaven_Conversation_Routes {

    private $plugin;

    public function __construct($plugin) {
        $this->plugin = $plugin;
    }

    public function register_routes() {
        register_rest_route('webmaven_wp/v1', '/messages', [
            'methods' => 'GET',
            'permission_callback' => function() { return $this->plugin->current_user_can_reach_api(); },
            'callback' => [$this, 'get_conversation_messages'],
            'args' => [
                'conversationId' => [
                    'required' => true,
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                ],
                'page' => [
                    'required' => false,
                    'type' => 'integer',
                    'default' => 1,
                    'sanitize_callback' => 'absint',
                ],
                'limit' => [
                    'required' => false,
                    'type' => 'integer',
                    'default' => 20,
                    'sanitize_callback' => 'absint',
                ],
            ],
        ]);
        
        // 1.2.9: /settings and /prefs are gone. Their callbacks named methods
        // this class does not have, so WordPress answered every call with
        // "The handler for the route is invalid" (500), and nothing in the
        // WP-admin app calls them.

        register_rest_route('webmaven_wp/v1', '/conversations', [
            [
                'methods' => 'GET',
                'permission_callback' => function() { return $this->plugin->current_user_can_reach_api(); },
                'callback' => [$this, 'list_conversations'],
                'args' => [
                    'page' => ['type' => 'integer', 'default' => 1],
                    'limit' => ['type' => 'integer', 'default' => 5],
                    'clientType' => ['type' => 'string', 'required' => false],
                    // The editor's chat of one editor (2026-10-18): post, product, or page (the default).
                    'editorKind' => ['type' => 'string', 'required' => false, 'enum' => ['page', 'post', 'product']],
                ],
            ],
            [
                'methods' => 'POST',
                'permission_callback' => function() { return $this->plugin->current_user_can_reach_api(); },
                'callback' => [$this, 'create_conversation'],
                'args' => [
                    'title' => ['type' => 'string', 'required' => false],
                    'clientType' => ['type' => 'string', 'required' => false],
                    // The editor's chat of one editor (2026-10-18): post, product, or page (the default).
                    'editorKind' => ['type' => 'string', 'required' => false, 'enum' => ['page', 'post', 'product']],
                ],
            ],
        ]);

        // Get latest conversation or create the first one
        register_rest_route('webmaven_wp/v1', '/conversations/latest', [
            'methods' => 'GET',
            'permission_callback' => function() { return $this->plugin->current_user_can_reach_api(); },
            'callback' => [$this, 'get_latest_or_create_conversation'],
            'args' => [
                'clientType' => ['type' => 'string', 'required' => false],
                'editorKind' => ['type' => 'string', 'required' => false, 'enum' => ['page', 'post', 'product']],
            ],
        ]);

        register_rest_route('webmaven_wp/v1', '/conversations/(?P<id>[\w-]+)', [
            [
                'methods' => 'GET',
                'permission_callback' => function() { return $this->plugin->current_user_can_reach_api(); },
                'callback' => [$this, 'get_conversation'],
            ],
            [
                'methods' => 'POST',
                'permission_callback' => function() { return $this->plugin->current_user_can_reach_api(); },
                'callback' => [$this, 'update_conversation'],
                'args' => [
                    'title' => ['type' => 'string', 'required' => true],
                ],
            ],
            [
                'methods' => 'DELETE',
                'permission_callback' => function() { return $this->plugin->current_user_can_reach_api(); },
                'callback' => [$this, 'delete_conversation'],
            ],
        ]);

    }

    /**
     * While WEBMAVEN_WP_SITE_TOKEN_CHAT is off: the dashboard card response,
     * and no API call. Null when chat runs in WP-admin.
     */
    private function chat_off() {
        return webmaven_wp_site_chat_enabled() ? null : webmaven_wp_chat_in_dashboard_response();
    }

    /**
     * A failed API call as the browser should see it (1.2.9): the API's own
     * status and message, and its refusal code when it sends one. 502 when
     * the API did not answer at all. Never "Unexpected API response" 500.
     */
    private function api_failure($response, $fallback) {
        $status = is_array($response) ? (int) ($response['status_code'] ?? 0) : 0;
        if ($status < 400 || $status > 599) {
            $status = 502;
        }
        $body = [
            'success' => false,
            'error' => (is_array($response) && !empty($response['error']) && is_string($response['error'])) ? $response['error'] : $fallback,
        ];
        if (is_array($response) && !empty($response['code']) && is_string($response['code'])) {
            $body['code'] = $response['code'];
        }
        return new \WP_REST_Response($body, $status);
    }

    /**
     * The editor's chat of one editor (2026-10-18): the post editor's (the
     * Content Writer's), the product editor's (the E-commerce Manager's), or
     * null for the page editor's (the Web Designer's). Passed on to the API,
     * which keeps one thread per editor.
     */
    private function editor_kind($value) {
        return ($value === 'post' || $value === 'product') ? $value : null;
    }

    public function list_conversations(\WP_REST_Request $request) {
        if ($off = $this->chat_off()) {
            return $off;
        }
        $api_client = new WebMaven_WP_API_Client();

        $page = max(1, (int) ($request->get_param('page') ?: 1));
        $limit = max(1, min(50, (int) ($request->get_param('limit') ?: 5)));
        $client_type = $request->get_param('clientType');
        $client_type = $client_type ? sanitize_text_field($client_type) : null;

        $response = $api_client->list_conversations($page, $limit, $client_type, $this->editor_kind($request->get_param('editorKind')));
        if (!empty($response['success'])) {
            return new \WP_REST_Response([
                'success' => true,
                'conversations' => $response['data'] ?? [],
            ]);
        }
        return $this->api_failure($response, 'Failed to fetch conversations');
    }

    public function create_conversation(\WP_REST_Request $req) {
        if ($off = $this->chat_off()) {
            return $off;
        }
        // Title and channel from the JSON body first, then from the params.
        $json_params = $req->get_json_params();
        $title = isset($json_params['title']) ? $json_params['title'] : $req->get_param('title');
        $title = is_string($title) ? sanitize_text_field($title) : '';
        $client_type = isset($json_params['clientType']) ? $json_params['clientType'] : $req->get_param('clientType');
        $client_type = is_string($client_type) && $client_type !== '' ? sanitize_text_field($client_type) : null;
        $editor_kind = $this->editor_kind(isset($json_params['editorKind']) ? $json_params['editorKind'] : $req->get_param('editorKind'));
        if ($title === '') {
            $title = 'New chat';
        }

        $api_client = new WebMaven_WP_API_Client();
        $response = $api_client->create_conversation($title, null, $client_type, $editor_kind);
        if (!empty($response['success'])) {
            return new \WP_REST_Response([
                'success' => true,
                'data' => [
                    'conversation' => $response['data'] ?? null,
                ],
            ]);
        }
        return $this->api_failure($response, 'Failed to create conversation');
    }

    public function get_conversation(\WP_REST_Request $req) {
        if ($off = $this->chat_off()) {
            return $off;
        }
        $id = WebMaven_WP_API_Client::path_id($req['id']);
        if ($id === '') {
            return new \WP_REST_Response(['success' => false, 'error' => 'Invalid conversation id'], 400);
        }
        $api_client = new WebMaven_WP_API_Client();
        $response = $api_client->get_conversation($id);
        if (!empty($response['success'])) {
            return new \WP_REST_Response([
                'success' => true,
                'conversation' => $response['data'],
            ]);
        }
        return $this->api_failure($response, 'Conversation not found');
    }

    /**
     * Rename (1.2.9). It edited a local list through methods that do not
     * exist (a PHP fatal). The API has no rename route, so this says so,
     * clearly, and changes nothing.
     */
    public function update_conversation(\WP_REST_Request $req) {
        if ($off = $this->chat_off()) {
            return $off;
        }
        return new \WP_REST_Response([
            'success' => false,
            'code' => 'wpmaven_rename_unavailable',
            'error' => 'Renaming a conversation is not available yet.',
        ], 501);
    }

    /**
     * Delete (1.2.9): the API's DELETE /conversations/:id. It edited a local
     * list through methods that do not exist (a PHP fatal).
     */
    public function delete_conversation(\WP_REST_Request $req) {
        if ($off = $this->chat_off()) {
            return $off;
        }
        $id = WebMaven_WP_API_Client::path_id($req['id']);
        if ($id === '') {
            return new \WP_REST_Response(['success' => false, 'error' => 'Invalid conversation id'], 400);
        }
        $api_client = new WebMaven_WP_API_Client();
        $response = $api_client->make_request('/conversations/' . $id, 'DELETE');
        if (!empty($response['success'])) {
            return new \WP_REST_Response(['success' => true]);
        }
        return $this->api_failure($response, 'Failed to delete conversation');
    }

    /**
     * GET /conversations/latest: the channel's latest conversation, or a new
     * one when it has none (the API answers 404, or success with no data).
     * Any other answer goes to the browser with the API's own status (1.2.9):
     * a 401 or 403 used to fall through to a 500 "Unexpected API response".
     */
    public function get_latest_or_create_conversation(\WP_REST_Request $request = null) {
        if ($off = $this->chat_off()) {
            return $off;
        }
        $client_type = null;
        $editor_kind = null;
        if ($request) {
            $ct = $request->get_param('clientType');
            if (is_string($ct) && $ct !== '') {
                $client_type = sanitize_text_field($ct);
            }
            $editor_kind = $this->editor_kind($request->get_param('editorKind'));
        }

        $api_client = new WebMaven_WP_API_Client();
        $response = $api_client->get_latest_conversation($client_type, $editor_kind);

        // A conversation carries its id at data.id (or data.conversation.id).
        $data = $response['data'] ?? null;
        $found = !empty($response['success'])
            && is_array($data)
            && (!empty($data['id']) || !empty($data['conversation']['id']));
        if ($found) {
            return new \WP_REST_Response([
                'success' => true,
                'data' => $response['data'],
            ]);
        }

        $none = (!empty($response['success']) && !$found)
            || (int) ($response['status_code'] ?? 0) === 404;
        if (!$none) {
            return $this->api_failure($response, 'Failed to get the latest conversation');
        }

        $created = $api_client->create_conversation('New chat', null, $client_type, $editor_kind);
        if (!empty($created['success'])) {
            return new \WP_REST_Response([
                'success' => true,
                'data' => $created['data'] ?? null,
            ]);
        }
        return $this->api_failure($created, 'Failed to create conversation');
    }

    public function get_conversation_messages($request) {
        if ($off = $this->chat_off()) {
            return $off;
        }
        $conversation_id = WebMaven_WP_API_Client::path_id($request->get_param('conversationId'));
        if ($conversation_id === '') {
            return new \WP_REST_Response(['success' => false, 'error' => 'Conversation ID is required'], 400);
        }
        $page = max(1, (int) ($request->get_param('page') ?: 1));
        $limit = max(1, min(100, (int) ($request->get_param('limit') ?: 20)));

        $api_client = new WebMaven_WP_API_Client();
        $response = $api_client->make_request(
            '/conversations/' . $conversation_id . '/messages',
            'GET',
            null,
            ['page' => $page, 'limit' => $limit]
        );

        if (!empty($response['success'])) {
            // Extract the actual data from the nested response
            $actual_data = $response['data'];
            if (is_array($actual_data) && isset($actual_data['data'])) {
                $actual_data = $actual_data['data'];
            }
            return new \WP_REST_Response([
                'success' => true,
                'data' => $actual_data,
            ]);
        }
        return $this->api_failure($response, 'Failed to fetch messages');
    }
}
