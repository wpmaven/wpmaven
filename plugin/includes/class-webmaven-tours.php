<?php
/**
 * The guided tours' progress, per WordPress user (1.7.0).
 *
 * The app has three tours: the full one (everything but the editor), the
 * WordPress one (only what is the plugin's own, for someone who came from
 * the dashboard) and the editor's. How far each person got is kept in their
 * own user meta, one record per tour: {v, status, step, at}. Not in the
 * account (the API's /users/me/tour): this site acts as the owner there, so
 * every WordPress user of the site would share the owner's record.
 *
 *   GET /webmaven_wp/v1/tour   the signed-in user's records, by tour
 *   PUT /webmaven_wp/v1/tour   one record: {tour, v, status, step}; `at` is
 *                              this server's time
 *
 * Only the signed-in user's own meta is read or written: the route takes no
 * user id. The tour ids are an allowlist, so the route writes no other meta
 * key, and every field is checked before it is stored.
 *
 * Came from the dashboard: the dashboard's sign-in links
 * (capabilities/owner-admin-login.php) stamp ARRIVED_META on the user they
 * sign in. for_script() hands it to the app (WEBMAVEN_WP_DATA.tours), which
 * then opens the WordPress tour instead of the full one. A sign-in with
 * WordPress's own form leaves no stamp.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Tours {

    const ROUTE_NAMESPACE = 'webmaven_wp/v1';
    const ROUTE = '/tour';

    /** The app's tours: the only records, and the only meta keys, this route writes. */
    const TOURS = ['full', 'wordpress', 'editor'];
    /** One meta key per tour: _webmaven_tour_full, _webmaven_tour_wordpress, _webmaven_tour_editor. */
    const META_PREFIX = '_webmaven_tour_';
    const STATUSES = ['in_progress', 'skipped', 'done'];
    /** A step id as the app writes them ("edit-site", "chat"). */
    const STEP_PATTERN = '/^[a-z0-9][a-z0-9_-]{0,39}$/';
    const MAX_VERSION = 1000;

    /**
     * Unix time of this user's last sign-in through a dashboard link. The
     * same key WPMaven Agent's owner sign-in writes.
     */
    const ARRIVED_META = '_webmaven_arrived_from_dashboard';

    /**
     * @param callable $permission Who may read and write their own records:
     *                             the app's users (core routes pass
     *                             current_user_can_use).
     */
    public static function register_route($permission) {
        register_rest_route(self::ROUTE_NAMESPACE, self::ROUTE, [
            [
                'methods' => 'GET',
                'permission_callback' => $permission,
                'callback' => [__CLASS__, 'handle_get'],
            ],
            [
                'methods' => 'PUT',
                'permission_callback' => $permission,
                'callback' => [__CLASS__, 'handle_put'],
            ],
        ]);
    }

    /**
     * @param mixed $request Unused: the route reads the signed-in user only.
     * @return WP_REST_Response|WP_Error
     */
    public static function handle_get($request = null) {
        $user_id = (int) get_current_user_id();
        if ($user_id <= 0) {
            return self::signed_out();
        }
        return self::respond(['tours' => (object) self::records($user_id)]);
    }

    /**
     * @param WP_REST_Request $request JSON body {tour, v, status, step}.
     * @return WP_REST_Response|WP_Error
     */
    public static function handle_put($request) {
        $user_id = (int) get_current_user_id();
        if ($user_id <= 0) {
            return self::signed_out();
        }
        $params = is_object($request) && method_exists($request, 'get_json_params') ? $request->get_json_params() : null;
        $clean = self::clean(is_array($params) ? $params : []);
        if (is_wp_error($clean)) {
            return $clean;
        }
        update_user_meta($user_id, self::META_PREFIX . $clean['tour'], $clean['record']);
        return self::respond($clean['record']);
    }

    /**
     * A record from the app, checked: ['tour' => id, 'record' => {v, status,
     * step, at}], or a WP_Error (400) naming the field that is wrong.
     *
     * @param array    $params
     * @param int|null $now    Unix time (tests pass their own).
     * @return array|WP_Error
     */
    public static function clean($params, $now = null) {
        $tour = isset($params['tour']) && is_string($params['tour']) ? $params['tour'] : '';
        if (!in_array($tour, self::TOURS, true)) {
            return self::invalid('tour');
        }
        $version = $params['v'] ?? null;
        if (!is_int($version) || $version < 1 || $version > self::MAX_VERSION) {
            return self::invalid('v');
        }
        $status = $params['status'] ?? null;
        if (!is_string($status) || !in_array($status, self::STATUSES, true)) {
            return self::invalid('status');
        }
        $step = $params['step'] ?? null;
        if (!is_string($step) || !preg_match(self::STEP_PATTERN, $step)) {
            return self::invalid('step');
        }
        $now = $now === null ? time() : (int) $now;
        return [
            'tour' => $tour,
            'record' => [
                'v' => $version,
                'status' => $status,
                'step' => $step,
                'at' => gmdate('Y-m-d\TH:i:s\Z', $now),
            ],
        ];
    }

    /**
     * The user's records by tour. A tour never started, or whose stored
     * value is not a record, is left out.
     *
     * @return array<string, array>
     */
    public static function records($user_id) {
        $out = [];
        foreach (self::TOURS as $tour) {
            $record = self::stored(get_user_meta((int) $user_id, self::META_PREFIX . $tour, true));
            if ($record !== null) {
                $out[$tour] = $record;
            }
        }
        return $out;
    }

    /** A stored value that is a well-formed record, or null. */
    private static function stored($value) {
        if (!is_array($value)) {
            return null;
        }
        $version = $value['v'] ?? null;
        $status = $value['status'] ?? null;
        $step = $value['step'] ?? null;
        $at = $value['at'] ?? null;
        if (!is_int($version) || $version < 1 || $version > self::MAX_VERSION) {
            return null;
        }
        if (!is_string($status) || !in_array($status, self::STATUSES, true)) {
            return null;
        }
        if (!is_string($step) || !preg_match(self::STEP_PATTERN, $step)) {
            return null;
        }
        if (!is_string($at) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $at)) {
            return null;
        }
        return ['v' => $version, 'status' => $status, 'step' => $step, 'at' => $at];
    }

    /**
     * What the app needs at load (WEBMAVEN_WP_DATA.tours): when this user
     * last arrived through a dashboard link, as a Unix time, or null.
     */
    public static function for_script($user_id) {
        $arrived = (int) get_user_meta((int) $user_id, self::ARRIVED_META, true);
        return [
            'arrivedFromDashboard' => $arrived > 0 ? $arrived : null,
        ];
    }

    private static function respond($data) {
        $response = new WP_REST_Response(['success' => true, 'data' => $data], 200);
        $response->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        return $response;
    }

    private static function invalid($field) {
        return new WP_Error('webmaven_tour_invalid', 'This tour progress is not one the app writes (' . $field . ').', ['status' => 400]);
    }

    private static function signed_out() {
        return new WP_Error('rest_forbidden', 'Sign in again to save your progress.', ['status' => 401]);
    }
}
