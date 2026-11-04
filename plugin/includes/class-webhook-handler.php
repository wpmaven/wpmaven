<?php
/**
 * WebMaven Webhook Handler
 * Handles incoming webhook requests: JWT validation, request parsing, and action dispatch.
 * Extracted from the main plugin file (handle_webhook, handle_webhook_action, validate_webhook_jwt).
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/class-webmaven-log.php';
require_once __DIR__ . '/class-webmaven-edition.php';

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

class WebMaven_Webhook_Handler {

    /** @var WebMavenWordPress Reference to main plugin instance */
    private $plugin;

    public function __construct($plugin) {
        $this->plugin = $plugin;
    }

    /**
     * Main webhook entry point
     */
    public function handle_webhook() {
        // Set JSON response header
        header('Content-Type: application/json');

        // Only allow POST requests
        if (!isset($_SERVER['REQUEST_METHOD']) || sanitize_text_field(wp_unslash((string) $_SERVER['REQUEST_METHOD'])) !== 'POST') {
            wp_send_json_error([
                'error' => 'Only POST requests are allowed',
                'code' => 'METHOD_NOT_ALLOWED'
            ], 405);
            return;
        }

        // Get and validate JWT token
        // Check multiple sources as some servers don't pass Authorization header to PHP
        $auth_header = '';

        // First, try the standard Authorization header
        if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
            $auth_header = sanitize_text_field(wp_unslash((string) $_SERVER['HTTP_AUTHORIZATION']));
        } elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            // Apache with mod_rewrite
            $auth_header = sanitize_text_field(wp_unslash((string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION']));
        } elseif (isset($_SERVER['HTTP_X_AUTHORIZATION'])) {
            // X-Authorization fallback header (not stripped by most servers)
            $auth_header = sanitize_text_field(wp_unslash((string) $_SERVER['HTTP_X_AUTHORIZATION']));
        } elseif (function_exists('apache_request_headers')) {
            // Try Apache's request headers function
            $headers = apache_request_headers();
            if (isset($headers['Authorization'])) {
                $auth_header = $headers['Authorization'];
            } elseif (isset($headers['authorization'])) {
                $auth_header = $headers['authorization'];
            } elseif (isset($headers['X-Authorization'])) {
                $auth_header = $headers['X-Authorization'];
            }
        } elseif (function_exists('getallheaders')) {
            // PHP 7.3+ fallback
            $headers = getallheaders();
            if (isset($headers['Authorization'])) {
                $auth_header = $headers['Authorization'];
            } elseif (isset($headers['authorization'])) {
                $auth_header = $headers['authorization'];
            } elseif (isset($headers['X-Authorization'])) {
                $auth_header = $headers['X-Authorization'];
            }
        }

        // Debug: log what we found and from which source
        $auth_source = 'NOT FOUND';
        if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
            $auth_source = 'HTTP_AUTHORIZATION';
        } elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            $auth_source = 'REDIRECT_HTTP_AUTHORIZATION';
        } elseif (isset($_SERVER['HTTP_X_AUTHORIZATION'])) {
            $auth_source = 'HTTP_X_AUTHORIZATION';
        } elseif ($auth_header) {
            $auth_source = 'apache_request_headers/getallheaders';
        }
        WebMaven_Log::write('WebMaven WordPress Webhook: Auth header source: ' . $auth_source);

        if (empty($auth_header) || !preg_match('/Bearer\s+(.*)$/i', $auth_header, $matches)) {
            // The headers' names only: their values can carry cookies and tokens.
            $http_headers = [];
            foreach (array_keys($_SERVER) as $key) {
                if (strpos((string) $key, 'HTTP_') === 0) {
                    $http_headers[] = (string) $key;
                }
            }
            WebMaven_Log::write('WebMaven WordPress: Authorization header not found. HTTP headers: ' . implode(', ', $http_headers));
            wp_send_json_error([
                'error' => 'Missing or invalid Authorization header',
                'code' => 'UNAUTHORIZED'
            ], 401);
            return;
        }

        $token = $matches[1];

        // Validate JWT token from webhook
        // The API sends JWTs signed with the OAuth client secret
        $validation_result = $this->validate_jwt($token);
        if (!$validation_result['valid']) {
            wp_send_json_error([
                'error' => $validation_result['error'] ?? 'Invalid or expired token',
                'code' => 'UNAUTHORIZED'
            ], 401);
            return;
        }

        // Set admin user context for permission checks
        // WordPress permission checks like current_user_can('install_plugins') require a logged-in user.
        // WebMaven_Admin_Guard::webhook_admin() is the one definition of this
        // account: the guard protects exactly the account used here.
        $admin = WebMaven_Admin_Guard::webhook_admin();
        if ($admin) {
            wp_set_current_user($admin->ID);
            // WPMaven is acting from here on: no call may delete or demote the
            // site's last administrator or this account, whatever path it
            // takes.
            WebMaven_Admin_Guard::activate('webhook', (int) $admin->ID);
        } else {
            wp_send_json_error([
                'error' => 'No administrator user found',
                'code' => 'NO_ADMIN'
            ], 500);
            return;
        }

        // Get request body (read once for body hash validation)
        $body = file_get_contents('php://input');

        // Security: the API always signs the body hash into the JWT (webhookService
        // createWebhookJWT). A token without it is not one of ours: a signature
        // over an empty claim set could be replayed with any body.
        if (empty($validation_result['payload']['body_sha256'])) {
            wp_send_json_error([
                'error' => 'Token carries no body hash',
                'code' => 'INVALID_BODY'
            ], 400);
            return;
        }
        $body_hash = base64_encode(hash('sha256', $body, true));
        if (!hash_equals($validation_result['payload']['body_sha256'], $body_hash)) {
            wp_send_json_error([
                'error' => 'Request body hash mismatch',
                'code' => 'INVALID_BODY'
            ], 400);
            return;
        }

        // Security: Replay protection - track used JTIs
        $jti = $validation_result['payload']['jti'] ?? null;
        if ($jti) {
            $used_nonces_key = 'webmaven_webhook_nonces';
            $used_nonces = get_transient($used_nonces_key) ?: [];

            // Clean expired nonces (older than 15 min)
            $cutoff = time() - 900;
            $used_nonces = array_filter($used_nonces, function($ts) use ($cutoff) {
                return $ts > $cutoff;
            });

            // Check for replay
            if (isset($used_nonces[$jti])) {
                wp_send_json_error([
                    'error' => 'Request already processed (replay detected)',
                    'code' => 'REPLAY_DETECTED'
                ], 400);
                return;
            }

            // Record this nonce
            $used_nonces[$jti] = time();
            set_transient($used_nonces_key, $used_nonces, 900);
        }
        $data = json_decode($body, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            wp_send_json_error([
                'error' => 'Invalid JSON in request body',
                'code' => 'INVALID_JSON'
            ], 400);
            return;
        }

        // Validate required fields
        if (empty($data['action'])) {
            wp_send_json_error([
                'error' => 'Missing required field: action',
                'code' => 'MISSING_ACTION'
            ], 400);
            return;
        }

        $action = $data['action'];
        $parameters = $data['parameters'] ?? [];
        $step_id = $data['stepId'] ?? null;
        $nonce = $data['nonce'] ?? null;

        // Idempotency check for create actions: a retry with the same input
        // within 15 minutes replays the first SUCCESSFUL result instead of
        // creating a second copy. woocommerce_create_product and create_form
        // also upsert by a stable key (product name or SKU, form name), so a
        // re-apply after the window updates instead of duplicating.
        // install_plugin is not replayed: it is idempotent by itself (a
        // plugin already there takes the already_installed path), and a
        // replay would answer with the site as it was, not as it is.
        $idempotent_actions = ['create_menu', 'create_page', 'create_post', 'upload_theme', 'create_product', 'install_theme_from_url', 'woocommerce_create_product', 'create_form'];
        if (in_array($action, $idempotent_actions, true)) {
            $idempotency_key = $this->plugin->wp_commands->generate_action_idempotency_key($action, $parameters);
            $cached_result = get_transient('wm_idem_' . $idempotency_key);
            // A cached failure (written before failures stopped being cached)
            // is dropped, so the retry runs the action again.
            if ($cached_result !== false && !self::is_cacheable_result($cached_result)) {
                delete_transient('wm_idem_' . $idempotency_key);
                $cached_result = false;
            }
            if ($cached_result !== false) {
                WebMaven_Log::write("WebMaven: Idempotent action '{$action}' already executed (key: {$idempotency_key})");
                wp_send_json_success(array_merge($cached_result, ['idempotent' => true]));
                return;
            }
        }

        // Validate nonce if provided (optional for webhooks using JWT auth)
        // Nonce is validated but not required since JWT provides authentication
        if ($nonce && !wp_verify_nonce($nonce, 'ai_assistant_webhook')) {
            // Only log in debug mode to avoid noisy logs
            if (defined('WP_DEBUG') && WP_DEBUG && defined('WEBMAVEN_DEBUG') && WEBMAVEN_DEBUG) {
                WebMaven_Log::write('WebMaven WordPress: Nonce validation skipped (JWT auth used)');
            }
        }

        // Extract trace ID for request correlation
        $trace_id = isset($_SERVER['HTTP_X_TRACE_ID']) ? sanitize_text_field(wp_unslash((string) $_SERVER['HTTP_X_TRACE_ID'])) : wp_generate_uuid4();

        // Log webhook request for audit
        WebMaven_Log::write(sprintf(
            'WebMaven WordPress: Webhook request - Action: %s, StepId: %s, TraceId: %s',
            $action,
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
                set_transient('wm_idem_' . $idempotency_key, $result, 15 * MINUTE_IN_SECONDS);
            }

            wp_send_json_success([
                'data' => $result,
                'message' => 'Action completed successfully'
            ]);

        } catch (WebMaven_Requires_Agent $e) {
            // An ability of WPMaven Agent on a site without it: the API tells
            // the owner where to install it, never "the action failed".
            wp_send_json_error([
                'error' => $e->getMessage(),
                'code' => WebMaven_Requires_Agent::CODE,
                'data' => [
                    'action' => $action,
                    'stepId' => $step_id
                ]
            ], 501);
        } catch (\Throwable $e) {
            WebMaven_Log::write('WebMaven WordPress: Webhook action failed - ' . $e->getMessage());

            wp_send_json_error([
                'error' => $e->getMessage(),
                'code' => 'ACTION_FAILED',
                'data' => [
                    'action' => $action,
                    'stepId' => $step_id
                ]
            ], 500);
        }
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
        // A result that carries an error is not a success either: an older
        // install answered installed: true with an activation_error, and a
        // replay of it hid that the plugin never ran.
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

            // Batch option update (for plugin post-install configuration)
            case 'batch_update_options':
            case 'wp_batch_update_options':
                return $this->plugin->wp_commands->batch_update_options($parameters);

            // Permalink structure (sets permalink_structure + flushes rewrite
            // rules — the `rewrite_rules` option is blocked from update_option,
            // so a pretty-permalink switch needs this dedicated handler).
            case 'set_permalink_structure':
            case 'set_permalinks':
                return $this->plugin->webhook_actions->webhook_set_permalink_structure($parameters);

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

            // Atomic site finalization: front page + posts page + shop slug +
            // permalinks in one action (genstudio driver parity)
            case 'finalize_site':
                return $this->plugin->webhook_actions->webhook_finalize_site($parameters);

            // Revision lookup
            case 'get_post_revisions':
                return $this->plugin->webhook_actions->webhook_get_post_revisions($parameters);

            // Backup / restore
            case 'backup_create':
                return $this->plugin->webhook_actions->webhook_backup_create($parameters);
            case 'backup_restore':
                return $this->plugin->webhook_actions->webhook_backup_restore($parameters);
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
            // On their own class, so the execute_command bridge
            // (webhook_<name>) cannot reach them.
            case 'wc_list_payment_gateways':
                return WebMaven_Store_Payments::list_gateways();
            case 'wc_gateway_status':
                return WebMaven_Store_Payments::gateway_status(is_array($parameters) ? $parameters : []);
            case 'wc_enable_gateway':
                return WebMaven_Store_Payments::enable_gateway(is_array($parameters) ? $parameters : []);
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
                $source = $parameters['source'] ?? '';
                $date = $parameters['date'] ?? gmdate('Y-m-d');
                $registry = $this->plugin->metrics_routes->get_registry();
                if (!$registry->has_source($source)) {
                    throw new \Exception("Metrics source '{$source}' not available");
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
                // WPMaven Agent maps any other action to the site's REST API.
                $answer = apply_filters('webmaven_command_fallback', null, $action, $parameters);
                if ($answer !== null) {
                    return $answer;
                }
                WebMaven_Requires_Agent::check($action);
                throw new \Exception('Unknown command: ' . $action);
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

        // A one-click sign-in token (capabilities/owner-admin-login.php) is
        // signed with the same secret but is never a webhook or API request.
        if (isset($payload['purpose'])) {
            return ['valid' => false, 'error' => 'Not a webhook token'];
        }

        // Validate expiration
        if (isset($payload['exp']) && $payload['exp'] < time()) {
            return ['valid' => false, 'error' => 'JWT token expired'];
        }

        // Validate audience (should be our site URL)
        $site_url = get_site_url();
        if (isset($payload['aud']) && $payload['aud'] !== $site_url) {
            // Allow without trailing slash mismatch
            $normalized_aud = rtrim($payload['aud'], '/');
            $normalized_site = rtrim($site_url, '/');
            if ($normalized_aud !== $normalized_site) {
                WebMaven_Log::write("JWT audience mismatch: expected {$site_url}, got {$payload['aud']}");
                // Don't fail on audience mismatch for now, just log
            }
        }

        return [
            'valid' => true,
            'payload' => $payload
        ];
    }

    /**
     * Verify that a REST request was signed by the API with THIS site's current
     * client secret (same HS256 JWT the webhook channel uses, body hash
     * mandatory). Used as the permission gate of the routes the API calls
     * server-to-server (/oauth/callback, /activate on a connected site), so an
     * anonymous caller cannot overwrite the site's credentials and then forge
     * webhooks. Returns true or a WP_Error(403).
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
        if (empty($result['payload']['body_sha256'])) {
            return new \WP_Error('unauthorized', 'Token carries no body hash', ['status' => 403]);
        }
        $body_hash = base64_encode(hash('sha256', (string) $req->get_body(), true));
        if (!hash_equals($result['payload']['body_sha256'], $body_hash)) {
            return new \WP_Error('unauthorized', 'Request body hash mismatch', ['status' => 403]);
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
