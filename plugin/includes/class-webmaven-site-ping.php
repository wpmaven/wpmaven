<?php
/**
 * A check that the site loads (1.2.12).
 *
 * GET /wp-json/webmaven_wp/v1/ping, also reachable as
 * /?rest_route=/webmaven_wp/v1/ping.
 *
 * - The route is anonymous on purpose: the caller is a server with no login,
 *   and the answer says nothing about the site.
 * - It proves PHP and the database answer: one read of a single post ID.
 *   200 {"ok":true} when the read works, 503 {"ok":false} when it errors.
 * - WPMaven's servers read it every minute on hosted sites, to tell a site
 *   that is down from one that is quiet (the heartbeat only runs when
 *   WordPress's scheduler does, so a quiet site used to look down).
 * - It returns JSON, so it is never a page view: the traffic allowances do not
 *   count it.
 *
 * The body is exactly {ok}. No plugin, PHP or WordPress version, no time, no
 * site data, and nothing is written.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Site_Ping {

    const ROUTE_NAMESPACE = 'webmaven_wp/v1';
    const ROUTE = '/ping';

    public static function register_route() {
        register_rest_route(self::ROUTE_NAMESPACE, self::ROUTE, [
            'methods' => 'GET',
            'permission_callback' => '__return_true',
            'callback' => [__CLASS__, 'handle'],
        ]);
    }

    /**
     * @param mixed $request Unused: the route takes no arguments.
     * @return WP_REST_Response
     */
    public static function handle($request = null) {
        global $wpdb;

        $ok = false;
        if (is_object($wpdb)) {
            $previous = $wpdb->suppress_errors(true);
            $wpdb->get_var("SELECT ID FROM {$wpdb->posts} LIMIT 1");
            $ok = ($wpdb->last_error === '');
            $wpdb->suppress_errors($previous);
        }

        $response = new WP_REST_Response(['ok' => $ok], $ok ? 200 : 503);
        $response->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        $response->header('X-Robots-Tag', 'noindex');
        return $response;
    }
}
