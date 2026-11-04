<?php
/**
 * WebMaven Proxy
 * Handles API proxy requests and command execution with OAuth verification.
 */

if (!defined('ABSPATH')) exit;

// The API's route table the proxy forwards (1.3.0).
require_once __DIR__ . '/class-webmaven-site-routes.php';

class WebMaven_Proxy {

    private $plugin;

    public function __construct($plugin) {
        $this->plugin = $plugin;
    }

    /**
     * The app's calls to the WPMaven API (1.3.0): exactly the routes of the
     * API's route table (WebMaven_Site_Routes) that the generic proxy
     * forwards, for the tiers the table names, with this site's own business
     * in the path. Each refusal happens here, before any call, and the API
     * enforces the same rules again from the signed actor claim.
     */
    public function handle_api_proxy($request) {
        // The path from the route's own URL only: a ?path= query or a JSON
        // body field "path" never overrides it (WordPress ranks both higher).
        $url_params = method_exists($request, 'get_url_params') ? (array) $request->get_url_params() : [];
        $path = isset($url_params['path']) && is_string($url_params['path']) ? $url_params['path'] : '';

        // A path that could climb out of its route ("reports/../payments",
        // an encoded dot or slash, a doubled slash) is refused before the
        // table: an edge in front of the API may normalize it into a route
        // the table never allowed.
        if (!self::is_plain_path($path)) {
            return self::refusal(403, 'wpmaven_not_allowed');
        }

        $method = strtoupper((string) $request->get_method());
        $instance_id = (string) get_option('webmaven_wp_instance_id', '');
        $rule = WebMaven_Site_Routes::match($method, $path, $instance_id);
        if ($rule === null || !$rule['proxy']) {
            return self::refusal(403, 'wpmaven_not_allowed');
        }
        $tier = method_exists($this->plugin, 'current_user_api_tier') ? $this->plugin->current_user_api_tier() : null;
        if (!WebMaven_Site_Routes::tier_allowed($rule, $tier)) {
            return self::refusal(403, 'wpmaven_role');
        }

        $query = (array) $request->get_query_params();
        unset($query['rest_route'], $query['path'], $query['_locale']); // WordPress's own
        $body = $request->get_json_params();
        // Only this business, in the query or the body.
        foreach ([$query, is_array($body) ? $body : []] as $bag) {
            if (array_key_exists('instanceId', $bag) && $bag['instanceId'] !== $instance_id) {
                return self::refusal(403, 'wpmaven_business');
            }
        }

        // Work that spends the owner's AI time: the editor's hourly guard too.
        if ($rule['spendsAi'] && function_exists('webmaven_wp_spend_guard')) {
            $guard = webmaven_wp_spend_guard('manage_options');
            if ($guard !== true) {
                $data = is_wp_error($guard) ? $guard->get_error_data() : [];
                $status = (int) (is_array($data) ? ($data['status'] ?? 429) : 429);
                return self::refusal($status, $status === 429 ? 'wpmaven_spend_limit' : 'wpmaven_role');
            }
        }

        $api_client = new WebMaven_WP_API_Client();
        if (!$api_client->is_configured()) {
            return webmaven_wp_not_connected_response();
        }

        $response = $api_client->make_request(
            '/' . $path,
            $method,
            !empty($body) ? $body : null,
            !empty($query) ? $query : null,
            // Work that spends AI (a report, a chart) can take a minute or two.
            $rule['spendsAi'] ? 150 : null
        );

        $status_code = $response['status_code'] ?? (!empty($response['success']) ? 200 : 500);
        $out = ['success' => $response['success'] ?? false, 'data' => $response['data'] ?? null, 'error' => $response['error'] ?? null];
        // The API's own refusal code (SITE_ROLE, SITE_NOT_ENABLED...), for the app's words.
        if (!empty($response['code']) && is_string($response['code'])) {
            $out['code'] = $response['code'];
        }
        return new \WP_REST_Response($out, $status_code ?: 502);
    }

    /** The proxy's own refusals, in the words the app shows. */
    const REFUSALS = [
        'wpmaven_not_allowed' => 'This is not available from WordPress.',
        'wpmaven_role' => 'Your WordPress role can\'t use this. An administrator of this site can.',
        'wpmaven_business' => 'A WordPress site can only work on its own business.',
        'wpmaven_spend_limit' => 'AI request limit reached for this hour. Please try again later.',
    ];

    private static function refusal($status, $code) {
        return new \WP_REST_Response(['success' => false, 'code' => $code, 'error' => self::REFUSALS[$code] ?? self::REFUSALS['wpmaven_not_allowed']], $status);
    }

    /**
     * A proxy path made of plain segments only (1.2.9): letters, digits, dash,
     * underscore and dot inside segments, single slashes between them, no
     * "." or ".." segment, no percent sign and no backslash.
     */
    public static function is_plain_path($path) {
        if (!is_string($path) || $path === '' || strlen($path) > 512) {
            return false;
        }
        if (!preg_match('#^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$#', $path)) {
            return false;
        }
        foreach (explode('/', $path) as $segment) {
            if ($segment === '.' || $segment === '..') {
                return false;
            }
        }
        return true;
    }

}
