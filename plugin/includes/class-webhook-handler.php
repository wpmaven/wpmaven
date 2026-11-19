<?php
/**
 * WebMaven Webhook Handler
 * The API's signed calls, on the REST route wpmaven/v1/webhook: JWT
 * validation in the route's permission callback, request parsing, the call's
 * capability limit and action dispatch.
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/class-webmaven-log.php';
require_once __DIR__ . '/class-webmaven-edition.php';
require_once __DIR__ . '/class-webmaven-remote-caps.php';

class WebMaven_Webhook_Handler {

    /** @var WebMavenWordPress Reference to main plugin instance */
    private $plugin;

    public function __construct($plugin) {
        $this->plugin = $plugin;
    }

    /** The REST route the API sends its signed calls to (every edition). */
    const REST_NAMESPACE = 'wpmaven/v1';
    const REST_ROUTE = '/webhook';

    /** Where the ids of the calls already answered are kept, and for how long. */
    const NONCES_TRANSIENT = 'webmaven_webhook_nonces';
    const REPLAY_WINDOW = 900;

    /** The actions dispatch() answers itself (capabilities add theirs by filter). */
    const ACTIONS = [
        'ping', 'get_post_full', 'get_content_summary', 'get_global_styles', 'execute_command',
        'update_theme_option', 'test_functionality',
        'create_menu', 'wp_create_menu', 'update_menu', 'wp_update_menu', 'delete_menu', 'wp_delete_menu', 'get_menus', 'wp_get_menus',
        'update_option', 'wp_update_option', 'set_option', 'batch_update_options', 'wp_batch_update_options',
        'create_page', 'wp_create_page', 'create_post', 'wp_create_post', 'update_post', 'wp_update_post', 'delete_post', 'wp_delete_post',
        'cleanup_default_content', 'create_category', 'create_tag', 'set_featured_image', 'upload_media', 'wp_upload_media',
        'set_site_identity', 'get_site_context', 'get_site_info', 'discover_plugin_details',
        'set_homepage', 'set_page_on_front', 'set_page_for_posts', 'get_post_revisions', 'backup_create', 'backup_list',
        'woocommerce_create_product', 'woocommerce_get_currency', 'woocommerce_is_active', 'woocommerce_list_products',
        'wc_list_payment_gateways', 'wc_gateway_status', 'wc_get_connect_url', 'wc_finalize_gateway',
        'gift_cards_status', 'gift_cards_create_product', 'create_form', 'wp_create_form', 'create_coupon',
        'get_ai_crawler_stats', 'get_ai_readiness', 'get_metrics_available', 'get_metrics',
    ];

    /** How long the plugin's own check of the route is kept (connection_check). */
    const CHECK_TRANSIENT = 'webmaven_connection_check';
    const CHECK_TTL = 600;

    /**
     * rest_api_init: POST wpmaven/v1/webhook, open only to a call the API
     * signed for this site; and GET webmaven_wp/v1/connection-check, for the
     * plugin's screen (administrators).
     */
    public function register_routes() {
        register_rest_route(self::REST_NAMESPACE, self::REST_ROUTE, [
            'methods' => 'POST',
            'callback' => [$this, 'handle_rest'],
            'permission_callback' => [$this, 'rest_permission'],
        ]);
        register_rest_route('webmaven_wp/v1', '/connection-check', [
            'methods' => 'GET',
            'callback' => [$this, 'connection_check'],
            'permission_callback' => function () {
                return is_user_logged_in() && current_user_can('manage_options');
            },
        ]);
    }

    /**
     * Whether the API's calls reach this site: a call to its own route, the
     * way the API makes it, with no token. Our own refusal
     * (webmaven_unauthorized) means the route answers: {rest: 'ok'}. Any
     * other answer means something in front of WordPress (a security
     * plugin, the REST API turned off) stops it: {rest: 'blocked', status,
     * code}. {rest: 'unknown'} when the site cannot call itself. Kept for
     * ten minutes; ?fresh=1 asks again.
     */
    public function connection_check($request = null) {
        $fresh = $request && is_object($request) && method_exists($request, 'get_param') && (string) $request->get_param('fresh') === '1';
        $kept = $fresh ? false : get_transient(self::CHECK_TRANSIENT);
        if (is_array($kept) && isset($kept['rest'])) {
            return new \WP_REST_Response($kept, 200);
        }
        $url = add_query_arg('rest_route', '/' . self::REST_NAMESPACE . self::REST_ROUTE, home_url('/'));
        $response = wp_remote_post($url, [
            'timeout' => 10,
            'redirection' => 0,
            'headers' => ['Content-Type' => 'application/json'],
            'body' => '{}',
            'sslverify' => apply_filters('https_local_ssl_verify', false), // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- WordPress's own filter for a request the site makes to itself
        ]);
        $answer = self::check_answer($response);
        set_transient(self::CHECK_TRANSIENT, $answer, self::CHECK_TTL);
        return new \WP_REST_Response($answer, 200);
    }

    /** What the loopback's answer says: ok, blocked (with the status and the code) or unknown. */
    public static function check_answer($response): array {
        if (is_wp_error($response)) {
            return ['rest' => 'unknown'];
        }
        $status = (int) wp_remote_retrieve_response_code($response);
        if ($status === 0) {
            return ['rest' => 'unknown'];
        }
        $json = json_decode((string) wp_remote_retrieve_body($response), true);
        $code = is_array($json) && isset($json['code']) && is_string($json['code']) ? sanitize_key($json['code']) : '';
        if ($code === 'webmaven_unauthorized') {
            return ['rest' => 'ok'];
        }
        return ['rest' => 'blocked', 'status' => $status, 'code' => $code];
    }

    /**
     * The REST route's permission_callback: nothing runs before the token
     * is checked. A Bearer token (Authorization, X-Authorization or
     * REDIRECT_HTTP_AUTHORIZATION), signed HS256 with this site's OAuth
     * client secret, that has not expired, names this site as its audience,
     * carries an id not seen in the last 15 minutes, and the SHA-256 of this
     * very body. True, or a WP_Error the REST API answers with.
     */
    public function rest_permission($request) {
        $token = self::bearer_token([
            $request->get_header('authorization'),
            $request->get_header('x_authorization'),
            isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION']) ? sanitize_text_field(wp_unslash((string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) : '',
        ]);
        if ($token === '') {
            return new \WP_Error('webmaven_unauthorized', 'Missing or invalid Authorization header', ['status' => 401]);
        }
        $result = $this->validate_jwt($token);
        if (empty($result['valid'])) {
            return new \WP_Error('webmaven_unauthorized', (string) ($result['error'] ?? 'Invalid or expired token'), ['status' => 401]);
        }
        $payload = $result['payload'];
        if (!isset($payload['exp']) || !is_numeric($payload['exp'])) {
            return new \WP_Error('webmaven_unauthorized', 'Token has no expiry', ['status' => 401]);
        }
        if (!self::audience_matches($payload['aud'] ?? null)) {
            return new \WP_Error('webmaven_unauthorized', 'Token is not for this site', ['status' => 401]);
        }
        $jti = $payload['jti'] ?? null;
        if (!is_string($jti) || $jti === '' || strlen($jti) > 128) {
            return new \WP_Error('webmaven_unauthorized', 'Token has no id', ['status' => 401]);
        }
        if (empty($payload['body_sha256']) || !is_string($payload['body_sha256'])) {
            return new \WP_Error('webmaven_bad_body', 'Token carries no body hash', ['status' => 400]);
        }
        $body_hash = base64_encode(hash('sha256', (string) $request->get_body(), true));
        if (!hash_equals($payload['body_sha256'], $body_hash)) {
            return new \WP_Error('webmaven_bad_body', 'Request body hash mismatch', ['status' => 400]);
        }
        if (!self::remember_jti($jti)) {
            return new \WP_Error('webmaven_replay', 'Request already processed (replay detected)', ['status' => 400]);
        }
        return true;
    }

    /** The REST route's callback: the call, after rest_permission let it through. */
    public function handle_rest($request) {
        // WordPress's admin functions, which the actions use (media, posts,
        // menus), load as they do on an admin page.
        if (defined('ABSPATH') && file_exists(ABSPATH . 'wp-admin/includes/admin.php')) {
            require_once ABSPATH . 'wp-admin/includes/admin.php';
        }
        list($status, $answer) = $this->process((string) $request->get_body());
        return new \WP_REST_Response($answer, $status);
    }

    /**
     * A signed call, once its token passed: as the administrator WPMaven
     * works through, within the call's capability limit, the action run and
     * answered as [HTTP status, {success, data}].
     */
    private function process(string $body): array {
        // WordPress's permission checks (editing a page, a product, the
        // menus) need a signed-in user. WebMaven_Admin_Guard::webhook_admin()
        // is the one definition of this account: the guard protects exactly
        // the account used here.
        $admin = WebMaven_Admin_Guard::webhook_admin();
        if (!$admin) {
            return self::error(500, 'No administrator user found', 'NO_ADMIN');
        }
        // The call's capability limit goes on before the account is set:
        // WordPress reads its capabilities as soon as it is (kses_init).
        WebMaven_Remote_Caps::activate();
        wp_set_current_user($admin->ID);
        // WPMaven is acting from here on: no call may delete or demote the
        // site's last administrator or this account, whatever path it takes.
        WebMaven_Admin_Guard::activate('webhook', (int) $admin->ID);

        $data = json_decode($body, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            return self::error(400, 'Invalid JSON in request body', 'INVALID_JSON');
        }

        // Validate required fields
        if (!is_array($data) || empty($data['action']) || !is_string($data['action'])) {
            return self::error(400, 'Missing required field: action', 'MISSING_ACTION');
        }

        $action = $data['action'];
        $parameters = $data['parameters'] ?? [];
        $step_id = isset($data['stepId']) && is_scalar($data['stepId']) ? sanitize_text_field((string) $data['stepId']) : null;
        // Extract trace ID for request correlation
        $trace_id = isset($_SERVER['HTTP_X_TRACE_ID']) ? sanitize_text_field(wp_unslash((string) $_SERVER['HTTP_X_TRACE_ID'])) : wp_generate_uuid4();

        // Only a name this site answers reaches dispatch: anything else ends
        // here, as an unknown command, before any handler runs.
        if (!$this->is_known_action($action)) {
            $shown = sanitize_text_field(substr($action, 0, 64));
            WebMaven_Log::write('WebMaven WordPress: Webhook request for an unknown action: ' . $shown . ', TraceId: ' . $trace_id);
            return self::error(500, 'Unknown command: ' . $shown, 'ACTION_FAILED', ['action' => $shown, 'stepId' => $step_id]);
        }

        // Idempotency check for create actions: a retry with the same input
        // within 15 minutes replays the first SUCCESSFUL result instead of
        // creating a second copy. woocommerce_create_product and create_form
        // also upsert by a stable key (product name or SKU, form name), so a
        // re-apply after the window updates instead of duplicating. Any other
        // action runs each time.
        $idempotent_actions = ['create_menu', 'create_page', 'create_post', 'upload_theme', 'create_product', 'install_theme_from_url', 'woocommerce_create_product', 'create_form'];
        if (in_array($action, $idempotent_actions, true)) {
            $idempotency_key = $this->plugin->wp_commands->generate_action_idempotency_key($action, $parameters);
            $cached_result = get_transient('webmaven_idem_' . $idempotency_key);
            // A cached failure (written before failures stopped being cached)
            // is dropped, so the retry runs the action again.
            if ($cached_result !== false && !self::is_cacheable_result($cached_result)) {
                delete_transient('webmaven_idem_' . $idempotency_key);
                $cached_result = false;
            }
            if ($cached_result !== false) {
                WebMaven_Log::write("WebMaven: Idempotent action '{$action}' already executed (key: {$idempotency_key})");
                return [200, ['success' => true, 'data' => array_merge($cached_result, ['idempotent' => true])]];
            }
        }

        // Log webhook request for audit
        WebMaven_Log::write(sprintf(
            'WebMaven WordPress: Webhook request - Action: %s, StepId: %s, TraceId: %s',
            sanitize_text_field($action),
            $step_id ?? 'none',
            $trace_id
        ));

        // Route to appropriate action handler
        try {
            $result = $this->dispatch($action, $parameters, $step_id);

            // Cache the result of an idempotent create action, but only a
            // success: handlers report failure by RETURNING { success: false },
            // and a cached failure would be replayed to every retry for 15
            // minutes.
            if (in_array($action, $idempotent_actions, true) && isset($idempotency_key) && self::is_cacheable_result($result)) {
                set_transient('webmaven_idem_' . $idempotency_key, $result, 15 * MINUTE_IN_SECONDS);
            }

            return [200, ['success' => true, 'data' => [
                'data' => $result,
                'message' => 'Action completed successfully'
            ]]];

        } catch (WebMaven_Requires_Agent $e) {
            // An ability of WPMaven Agent on a site without it: the API tells
            // the owner where to install it, never "the action failed".
            return self::error(501, $e->getMessage(), WebMaven_Requires_Agent::CODE, ['action' => $action, 'stepId' => $step_id]);
        } catch (\Throwable $e) {
            WebMaven_Log::write('WebMaven WordPress: Webhook action failed - ' . $e->getMessage());
            return self::error(500, $e->getMessage(), 'ACTION_FAILED', ['action' => $action, 'stepId' => $step_id]);
        }
    }

    /** [status, {success: false, data: {error, code, data?}}], as wp_send_json_error answers. */
    private static function error(int $status, string $message, string $code, ?array $data = null): array {
        $out = ['error' => $message, 'code' => $code];
        if ($data !== null) {
            $out['data'] = $data;
        }
        return [$status, ['success' => false, 'data' => $out]];
    }

    /**
     * Whether this site answers $action: one of dispatch()'s own, one a
     * capability registered, or one this edition answers REQUIRES_AGENT.
     * Another plugin that answers more names says so through
     * webmaven_action_known (false by default).
     */
    public function is_known_action($action): bool {
        if (!is_string($action) || !preg_match('/^[a-z][a-z0-9_]{1,63}$/', $action)) {
            return false;
        }
        if (in_array($action, self::ACTIONS, true) || isset(self::capability_handlers()[$action])) {
            return true;
        }
        if (in_array($action, WebMaven_Requires_Agent::NAMES, true) || preg_match(WebMaven_Requires_Agent::REST_VERBS, $action)) {
            return true;
        }
        return (bool) apply_filters('webmaven_action_known', false, $action);
    }

    /** The Bearer token among the given header values, or ''. */
    private static function bearer_token(array $values): string {
        foreach ($values as $value) {
            if (is_string($value) && $value !== '' && preg_match('/Bearer\s+(\S+)\s*$/i', $value, $m)) {
                return $m[1];
            }
        }
        return '';
    }

    /**
     * Whether a token's audience is this site: the scheme, host (with its
     * port) and path of home_url() or site_url(), a trailing slash aside.
     */
    public static function audience_matches($aud): bool {
        $want = self::url_parts($aud);
        if ($want === null) {
            return false;
        }
        $urls = [
            function_exists('home_url') ? home_url('/') : '',
            function_exists('site_url') ? site_url('/') : (function_exists('get_site_url') ? get_site_url() : ''),
        ];
        foreach ($urls as $url) {
            if (self::url_parts($url) === $want) {
                return true;
            }
        }
        return false;
    }

    private static function url_parts($url): ?array {
        if (!is_string($url) || trim($url) === '') {
            return null;
        }
        $p = wp_parse_url(trim($url));
        if (!is_array($p) || empty($p['scheme']) || empty($p['host'])) {
            return null;
        }
        return [
            strtolower((string) $p['scheme']),
            strtolower((string) $p['host']) . (isset($p['port']) ? ':' . (int) $p['port'] : ''),
            // The API sends the address lowercased, its path included.
            strtolower(rtrim((string) ($p['path'] ?? ''), '/')),
        ];
    }

    /** Records a call's id; false when it was already answered in the last 15 minutes. */
    private static function remember_jti(string $jti): bool {
        $used = get_transient(self::NONCES_TRANSIENT);
        $used = is_array($used) ? $used : [];
        $cutoff = time() - self::REPLAY_WINDOW;
        $used = array_filter($used, function ($ts) use ($cutoff) {
            return $ts > $cutoff;
        });
        if (isset($used[$jti])) {
            return false;
        }
        $used[$jti] = time();
        set_transient(self::NONCES_TRANSIENT, $used, self::REPLAY_WINDOW);
        return true;
    }

    /**
     * Whether an idempotent action's result may be stored for replay. Only an
     * array that does not report failure: handlers signal failure by
     * returning { success: false, error } (the API reads that flag the same
     * way), and the replay merges the result into an array, so a WP_Error,
     * null or scalar is never stored either.
     */
    public static function is_cacheable_result($result) {
        if (!is_array($result)) {
            return false;
        }
        if (array_key_exists('success', $result) && !$result['success']) {
            return false;
        }
        // A result that carries an error is not a success either (an
        // activation_error included): a replay of it would hide the error.
        if (!empty($result['error']) || !empty($result['activation_error'])) {
            return false;
        }
        return true;
    }

    /**
     * Dispatch webhook action to the appropriate handler
     */
    private function dispatch($action, $parameters, $step_id) {
        switch ($action) {
            case 'ping':
                return [
                    'pong' => true,
                    'timestamp' => time(),
                    'php_version' => PHP_VERSION,
                    'wp_version' => get_bloginfo('version'),
                    'plugin_version' => WEBMAVEN_WP_VERSION,
                    // Which edition runs here, and what needs WPMaven Agent.
                    'edition' => WebMaven_Edition::report(),
                    // This site answers on the REST route (wpmaven/v1/webhook).
                    'transport' => ['rest' => true],
                ];

            case 'get_post_full':
                return $this->plugin->webhook_actions->webhook_get_post_full($parameters);

            case 'get_content_summary':
                return $this->plugin->webhook_actions->webhook_get_content_summary($parameters);

            case 'get_global_styles':
                return $this->plugin->webhook_actions->webhook_get_global_styles();

            case 'execute_command':
                return $this->plugin->webhook_actions->webhook_execute_command($parameters);

            case 'update_theme_option':
                return $this->plugin->webhook_actions->webhook_update_theme_option($parameters);

            case 'test_functionality':
                return $this->plugin->webhook_actions->webhook_test_functionality($parameters);

            // Menu operations
            case 'create_menu':
            case 'wp_create_menu':
                return $this->plugin->wp_commands->create_menu($parameters);

            case 'update_menu':
            case 'wp_update_menu':
                return $this->plugin->wp_commands->update_menu($parameters);

            case 'delete_menu':
            case 'wp_delete_menu':
                return $this->plugin->wp_commands->delete_menu($parameters);

            case 'get_menus':
            case 'wp_get_menus':
                return $this->plugin->wp_commands->get_menus($parameters);

            // General option update (with protection)
            case 'update_option':
            case 'wp_update_option':
            case 'set_option':  // alias the agent tends to invent
                return $this->plugin->webhook_actions->webhook_update_option($parameters);

            // Several options at once, each checked as update_option checks it
            case 'batch_update_options':
            case 'wp_batch_update_options':
                return $this->plugin->wp_commands->batch_update_options($parameters);

            // Page creation (shortcut for create_post with post_type=page)
            case 'create_page':
            case 'wp_create_page':
                return $this->plugin->webhook_actions->webhook_create_page($parameters);

            // Post operations
            case 'create_post':
            case 'wp_create_post':
                return $this->plugin->wp_commands->create_post($parameters);
            case 'update_post':
            case 'wp_update_post':
                return $this->plugin->wp_commands->update_post($parameters);
            case 'delete_post':
            case 'wp_delete_post':
                return $this->plugin->wp_commands->delete_post($parameters);
            case 'cleanup_default_content':
                return $this->plugin->webhook_actions->webhook_cleanup_default_content($parameters);

            // Taxonomy operations
            case 'create_category':
                return $this->plugin->wp_commands->create_taxonomy_term($parameters, 'category');
            case 'create_tag':
                return $this->plugin->wp_commands->create_taxonomy_term($parameters, 'post_tag');
            case 'set_featured_image':
                return $this->plugin->wp_commands->set_featured_image_command($parameters);

            // Media upload
            case 'upload_media':
            case 'wp_upload_media':
                return $this->plugin->webhook_actions->webhook_upload_media($parameters);
            case 'set_site_identity':
                return $this->plugin->webhook_actions->webhook_set_site_identity($parameters);

            // Site context and plugin discovery
            case 'get_site_context':
            case 'get_site_info':  // alias used by the agent runtime
                return $this->plugin->core_routes->get_site_context(new \WP_REST_Request())->get_data()['data'];
            case 'discover_plugin_details':
                return $this->plugin->webhook_actions->webhook_discover_plugin_details($parameters);

            // Homepage / posts page setup — sugar over update_option
            case 'set_homepage':
            case 'set_page_on_front':
                return $this->plugin->webhook_actions->webhook_set_homepage($parameters);
            case 'set_page_for_posts':
                return $this->plugin->webhook_actions->webhook_set_page_for_posts($parameters);

            // Revision lookup
            case 'get_post_revisions':
                return $this->plugin->webhook_actions->webhook_get_post_revisions($parameters);

            // Backups: made and listed on the site (this edition restores none)
            case 'backup_create':
                return $this->plugin->webhook_actions->webhook_backup_create($parameters);
            case 'backup_list':
                return $this->plugin->webhook_actions->webhook_backup_list($parameters);

            // WooCommerce operations (generic, no separate credentials needed)
            case 'woocommerce_create_product':
                return $this->plugin->webhook_actions->webhook_woocommerce_create_product($parameters);

            case 'woocommerce_get_currency':
                return $this->plugin->webhook_actions->webhook_woocommerce_get_currency();

            case 'woocommerce_is_active':
                return $this->plugin->webhook_actions->webhook_woocommerce_is_active();

            case 'woocommerce_list_products':
                return $this->plugin->webhook_actions->webhook_woocommerce_list_products($parameters);

            // Store payment gateways: the API's "get paid" flow
            // (storePaymentService.ts). Failures throw, so the API sees a 500.
            // This edition sets up and switches no other plugin's gateway
            // (wc_enable_gateway, wc_configure_gateway and wc_disable_gateway
            // answer REQUIRES_AGENT); WPMaven Payments has its own commands.
            case 'wc_list_payment_gateways':
                return WebMaven_Store_Payments::list_gateways();
            case 'wc_gateway_status':
                return WebMaven_Store_Payments::gateway_status(is_array($parameters) ? $parameters : []);
            case 'wc_get_connect_url':
                return WebMaven_Store_Payments::get_connect_url(is_array($parameters) ? $parameters : []);
            case 'wc_finalize_gateway':
                return WebMaven_Store_Payments::finalize_gateway(is_array($parameters) ? $parameters : []);

            // Gift-card capability (PW WooCommerce Gift Cards; the API's
            // setup_gift_cards tool drives these plus install_plugin)
            case 'gift_cards_status':
                return $this->plugin->webhook_actions->webhook_gift_cards_status();

            case 'gift_cards_create_product':
                return $this->plugin->webhook_actions->webhook_gift_cards_create_product($parameters);

            // Form creation (WPForms or CF7)
            case 'create_form':
            case 'wp_create_form':
                return $this->plugin->webhook_actions->webhook_create_form($parameters);

            // Coupon creation (a showcased promo code becomes a REAL coupon)
            case 'create_coupon':
                return $this->plugin->webhook_actions->webhook_create_coupon($parameters);

            // AI crawler visits + AI readiness (2026-09-16), read by the
            // weekly report, the Home screen and the site card.
            case 'get_ai_crawler_stats':
                return WebMaven_AI_Crawlers::stats(is_array($parameters) ? $parameters : []);
            case 'get_ai_readiness':
                return WebMaven_AI_Crawlers::readiness();

            // Business metrics collection
            case 'get_metrics_available':
                return $this->plugin->metrics_routes->get_registry()->get_available_sources();
            case 'get_metrics':
                // A source is a key (woocommerce, forms, bookings) and a day is
                // YYYY-MM-DD, as the metrics REST route takes them; without a day, today.
                $source = isset($parameters['source']) && is_scalar($parameters['source']) ? sanitize_key((string) $parameters['source']) : '';
                $date = isset($parameters['date']) && is_scalar($parameters['date']) ? sanitize_text_field((string) $parameters['date']) : '';
                if ($date === '') {
                    $date = gmdate('Y-m-d');
                } elseif (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                    throw new \Exception("Metrics date '{$date}' is not a day (YYYY-MM-DD)"); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- the error text of a JSON answer to the API, never printed in a page
                }
                $registry = $this->plugin->metrics_routes->get_registry();
                if (!$registry->has_source($source)) {
                    throw new \Exception("Metrics source '{$source}' not available"); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- the error text of a JSON answer to the API, never printed in a page
                }
                return $registry->get_metrics($source, $date);

            default:
                // Capabilities (includes/capabilities/*.php) register their
                // own top-level actions here, one file each, so new abilities
                // never edit this switch. They are reached only after the
                // JWT check above and cannot replace a case of this switch.
                $handlers = self::capability_handlers();
                if (isset($handlers[$action])) {
                    return call_user_func($handlers[$action], is_array($parameters) ? $parameters : [], $step_id);
                }
                // An action no handler took: another plugin may answer it
                // (webmaven_command_fallback). Otherwise this edition does
                // not run it (REQUIRES_AGENT), or the name is unknown.
                $answer = apply_filters('webmaven_command_fallback', null, $action, $parameters);
                if ($answer !== null) {
                    return $answer;
                }
                WebMaven_Requires_Agent::check($action);
                throw new \Exception('Unknown command: ' . $action); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- the error text of a JSON answer to the API, never printed in a page
        }
    }

    /**
     * Top-level actions registered by capability files: action name =>
     * callable($parameters, $step_id). Names must be lowercase snake_case;
     * anything else, or a non-callable, is dropped.
     */
    public static function capability_handlers() {
        $raw = apply_filters('webmaven_webhook_action_handlers', []);
        $handlers = [];
        if (!is_array($raw)) {
            return $handlers;
        }
        foreach ($raw as $name => $callable) {
            if (is_string($name) && preg_match('/^[a-z][a-z0-9_]{2,63}$/', $name) && is_callable($callable)) {
                $handlers[$name] = $callable;
            }
        }
        return $handlers;
    }

    /**
     * Validate JWT token from webhook requests
     * The API sends JWTs signed with the OAuth client secret using HS256
     */
    public function validate_jwt($token) {
        // Get the stored client secret
        $encrypted_secret = get_option('webmaven_wp_client_secret');
        if (empty($encrypted_secret)) {
            return ['valid' => false, 'error' => 'OAuth client not configured'];
        }

        $client_secret = WebMaven_WP_Error_Handler::decrypt_data($encrypted_secret);
        if (empty($client_secret)) {
            return ['valid' => false, 'error' => 'Failed to decrypt client secret'];
        }

        // Parse JWT (header.payload.signature)
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return ['valid' => false, 'error' => 'Invalid JWT format'];
        }

        list($encoded_header, $encoded_payload, $signature) = $parts;

        // Verify signature using HMAC SHA256
        $data = $encoded_header . '.' . $encoded_payload;
        $expected_signature = $this->base64url_encode(
            hash_hmac('sha256', $data, $client_secret, true)
        );

        if (!hash_equals($expected_signature, $signature)) {
            return ['valid' => false, 'error' => 'Invalid JWT signature'];
        }

        // Decode payload
        $payload_json = $this->base64url_decode($encoded_payload);
        if ($payload_json === false) {
            return ['valid' => false, 'error' => 'Failed to decode JWT payload'];
        }

        $payload = json_decode($payload_json, true);
        if (json_last_error() !== JSON_ERROR_NONE || !is_array($payload)) {
            return ['valid' => false, 'error' => 'Invalid JWT payload'];
        }

        // A token with a purpose (a sign-in link the account signs with the
        // same secret) is never a webhook or API request.
        if (isset($payload['purpose'])) {
            return ['valid' => false, 'error' => 'Not a webhook token'];
        }

        // Validate expiration
        if (isset($payload['exp']) && $payload['exp'] < time()) {
            return ['valid' => false, 'error' => 'JWT token expired'];
        }

        return [
            'valid' => true,
            'payload' => $payload
        ];
    }

    /**
     * Verify that a REST request was signed by the API with THIS site's current
     * client secret (same HS256 JWT the webhook channel uses): an expiry not
     * passed, an id not seen in the last 15 minutes, and the hash of this very
     * body. Used as the permission gate of the routes the API calls
     * server-to-server (/oauth/callback, /activate on a connected site), so an
     * anonymous caller cannot overwrite the site's credentials and then forge
     * webhooks, and a recorded push cannot be sent again. Returns true or a
     * WP_Error(403).
     */
    public function verify_api_request(\WP_REST_Request $req) {
        $auth_header = $req->get_header('authorization');
        if (empty($auth_header)) {
            $auth_header = $req->get_header('x-authorization');
        }
        if (empty($auth_header) || !preg_match('/Bearer\s+(.*)$/i', $auth_header, $m)) {
            return new \WP_Error('unauthorized', 'This endpoint is only for signed requests from the WPMaven API. Reconnect the site from wp-admin.', ['status' => 403]);
        }
        $result = $this->validate_jwt($m[1]);
        if (empty($result['valid'])) {
            return new \WP_Error('unauthorized', 'Invalid request signature: ' . ($result['error'] ?? 'unknown'), ['status' => 403]);
        }
        $payload = $result['payload'];
        if (!isset($payload['exp']) || !is_numeric($payload['exp'])) {
            return new \WP_Error('unauthorized', 'Token has no expiry', ['status' => 403]);
        }
        $jti = $payload['jti'] ?? null;
        if (!is_string($jti) || $jti === '' || strlen($jti) > 128) {
            return new \WP_Error('unauthorized', 'Token has no id', ['status' => 403]);
        }
        if (empty($payload['body_sha256']) || !is_string($payload['body_sha256'])) {
            return new \WP_Error('unauthorized', 'Token carries no body hash', ['status' => 403]);
        }
        $body_hash = base64_encode(hash('sha256', (string) $req->get_body(), true));
        if (!hash_equals($payload['body_sha256'], $body_hash)) {
            return new \WP_Error('unauthorized', 'Request body hash mismatch', ['status' => 403]);
        }
        if (!self::remember_jti($jti)) {
            return new \WP_Error('unauthorized', 'Request already processed (replay detected)', ['status' => 403]);
        }
        return true;
    }

    /**
     * Base64 URL-safe encode
     */
    private function base64url_encode($data) {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    /**
     * Base64 URL-safe decode
     */
    private function base64url_decode($data) {
        // Calculate padding needed to reach next multiple of 4
        $remainder = strlen($data) % 4;
        if ($remainder > 0) {
            $data .= str_repeat('=', 4 - $remainder);
        }
        return base64_decode(strtr($data, '-_', '+/'));
    }
}
