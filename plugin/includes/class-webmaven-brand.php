<?php
/**
 * Whose name the plugin shows (White label, 1.2.31, 2026-10-04).
 *
 * An agency on the White label plan runs its clients' businesses under its
 * own brand, and a wholesale hosting partner sells WPMaven as its own
 * product. On those sites the plugin must not name WPMaven anywhere the
 * client or the site's visitors look: the WP-admin menu and page titles, the
 * WP-admin app and the notices. The plugin list, the update details, the
 * must-use hardening file and the mail WordPress sends the site's
 * administrators are WPMaven Agent's to brand.
 *
 * The API says whose brand a site carries in the same answer the footer
 * badge already reads, GET /sites/me/plan (with the site's own token):
 *
 *   data.brand  absent or null   the site is WPMaven's: the plugin says WPMaven
 *                                (always, while WL_BRANDING_ENABLED is off)
 *   data.brand  {name, logoUrl,  a White label account's own brand, or the
 *                color}          brand of the hosting partner that pays for
 *                                the plan
 *   data.brand  {name: null}     a White label account with no name saved yet:
 *                                neutral words, never WPMaven
 *
 * logoUrl (https, on a host that does not name us) and color (#rrggbb) may be
 * null. An optional dashboardUrl (the brand's own live dashboard address, an
 * https origin) is read when the API sends one; "open your dashboard" links
 * then go there.
 *
 * Kept in one autoloaded option, written only when the answer changes, and
 * re-read at most once an hour (every successful plan read refreshes it: the
 * footer badge's hourly read, the WP-admin connection check, the settings
 * screen, and the WP-admin menu itself when the hour is up). A failed read
 * never changes it.
 *
 * FAIL SAFE. A connected site whose brand was never read shows neutral words
 * ("Site assistant", "your dashboard"), not WPMaven, until the first read
 * answers: the next WP-admin page makes that read before it draws the menu.
 * An answer the plugin cannot read (brand is not an object) is neutral too.
 * A site that never connected shows WPMaven: connecting is a WPMaven sign-in.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Brand {

    /** The product's own name, shown only where the site is WPMaven's. */
    const PRODUCT = 'WPMaven';

    /** What the plugin calls itself while the brand is unknown or has no name. */
    const NEUTRAL_NAME = 'Site assistant';

    const MODE_WPMAVEN = 'wpmaven';
    const MODE_BRAND = 'brand';
    const MODE_NEUTRAL = 'neutral';

    /** The last answer (autoloaded: the menu reads it on every WP-admin page). */
    const OPTION = 'webmaven_wp_brand';

    /** Set while the stored answer is fresh; the menu reads again once it is gone. */
    const FRESH = 'webmaven_wp_brand_fresh';

    /** One read at a time for the whole site. */
    const LOCK = 'webmaven_wp_brand_lock';

    const FRESH_SECONDS = 3600;
    const RETRY_SECONDS = 900;

    /** Seconds the WP-admin read may take before the page goes on without it. */
    const READ_TIMEOUT = 5;

    const NAME_MAX = 60;

    /**
     * WPMaven's mark in one colour (webmaven-ui branding, wpmaven-mark-white.svg),
     * for WordPress's own bars, where it takes their icons' colours: the admin
     * menu repaints it, the toolbar draws it as a mask. Its box is cropped to
     * the drawing, which fills it as WordPress's own icons fill theirs. Shown
     * only where the site is WPMaven's.
     */
    const WHITE_MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="6.244 3.756 54 54" width="20" height="20" aria-hidden="true" focusable="false"><path d="M7.589 47.186L7.589 40.036A2.263 2.263 0 0 1 10.172 37.796A18.275 18.275 0 0 1 13.485 38.59A2.089 2.089 0 0 1 14.9 40.567L14.9 41.964A7.136 7.136 0 0 0 22.036 49.1L23.079 49.1A2.089 2.089 0 0 1 25.078 50.583A18.275 18.275 0 0 1 25.681 53.306A2.263 2.263 0 0 1 23.441 55.888L16.292 55.888A8.703 8.703 0 0 1 7.589 47.186Z" fill="#FFFFFF"/><path d="M18.555 41.964L18.555 29.593A2.263 2.263 0 0 1 21.137 27.353A18.275 18.275 0 0 1 24.45 28.147A2.089 2.089 0 0 1 25.865 30.124L25.865 32.352A6.306 6.306 0 0 0 32.17 38.657L34.044 38.657A2.089 2.089 0 0 1 36.043 40.14A18.275 18.275 0 0 1 36.647 42.863A2.263 2.263 0 0 1 34.407 45.445L22.036 45.445A3.481 3.481 0 0 1 18.555 41.964Z" fill="#FFFFFF"/><path d="M32.17 35.002L38.443 35.002A0.53 0.53 0 0 0 38.973 34.472L38.973 28.199A2.651 2.651 0 0 0 36.323 25.549L30.05 25.549A0.53 0.53 0 0 0 29.52 26.079L29.52 32.352A2.651 2.651 0 0 0 32.17 35.002Z" fill="#FFFFFF"/><path d="M33.784 21.949L33.784 7.875A2.263 2.263 0 0 1 36.269 5.624A25.237 25.237 0 0 1 58.899 28.253A2.263 2.263 0 0 1 56.647 30.738L42.574 30.738A0.522 0.522 0 0 1 42.051 30.216L42.051 25.082A2.611 2.611 0 0 0 39.441 22.471L34.306 22.471A0.522 0.522 0 0 1 33.784 21.949Z" fill="#FFFFFF"/></svg>';

    /** The resolved brand for this request (reset whenever the answer changes). */
    private static $memo = null;

    public static function init() {
        // Before the menu is drawn (admin_menu fires before admin_init).
        add_action('admin_menu', [__CLASS__, 'maybe_refresh'], 0);
    }

    // ── The answer, read ───────────────────────────────────────────────────

    /**
     * The brand record a /sites/me/plan `data` answer describes, or null when
     * it is not an answer at all (nothing is changed then).
     *
     * @param mixed $data
     * @return array|null
     */
    public static function from_plan($data) {
        if (!is_array($data)) {
            return null;
        }
        if (!array_key_exists('brand', $data) || $data['brand'] === null || $data['brand'] === false) {
            return self::record(self::MODE_WPMAVEN);
        }
        $brand = $data['brand'];
        if (!is_array($brand)) {
            // Something the plugin cannot read: never fall back to our name.
            return self::record(self::MODE_NEUTRAL);
        }
        $name = self::clean_name($brand['name'] ?? '');
        return self::record(
            $name !== '' ? self::MODE_BRAND : self::MODE_NEUTRAL,
            $name,
            self::clean_https_url($brand['logoUrl'] ?? ''),
            self::clean_color($brand['color'] ?? ''),
            self::clean_origin($brand['dashboardUrl'] ?? '')
        );
    }

    private static function record($mode, $name = '', $logo_url = '', $color = '', $dashboard_url = '') {
        return [
            'mode' => $mode,
            'name' => $mode === self::MODE_BRAND ? $name : '',
            'logo_url' => $mode === self::MODE_WPMAVEN ? '' : $logo_url,
            'color' => $mode === self::MODE_WPMAVEN ? '' : $color,
            'dashboard_url' => $mode === self::MODE_WPMAVEN ? '' : $dashboard_url,
        ];
    }

    /**
     * A name as plain text: no tags, no control characters, none of the
     * characters that could end an HTML attribute or a PHP comment, single
     * spaces, at most NAME_MAX characters.
     */
    public static function clean_name($raw) {
        if (!is_string($raw)) {
            return '';
        }
        // Line breaks and tabs read as spaces; any other control character goes.
        $name = preg_replace('/[\t\r\n]+/u', ' ', wp_strip_all_tags($raw));
        if (!is_string($name)) {
            return '';
        }
        $name = preg_replace('/[\x00-\x1F\x7F<>"\\\\`]/u', '', $name);
        if (!is_string($name)) {
            return '';
        }
        $name = str_replace(['*/', '/*', '<?', '?>'], '', $name);
        $name = trim(preg_replace('/\s+/u', ' ', $name));
        if (function_exists('mb_substr')) {
            $name = mb_substr($name, 0, self::NAME_MAX);
        } else {
            $name = substr($name, 0, self::NAME_MAX);
        }
        return trim($name);
    }

    /** An absolute https URL, or ''. */
    public static function clean_https_url($raw) {
        if (!is_string($raw)) {
            return '';
        }
        $url = trim($raw);
        if ($url === '' || strlen($url) > 2048 || !preg_match('#^https://[^\s"\'<>\\\\]+$#i', $url)) {
            return '';
        }
        return filter_var($url, FILTER_VALIDATE_URL) !== false ? $url : '';
    }

    /** An https origin (scheme and host, maybe a port), without a trailing slash, or ''. */
    public static function clean_origin($raw) {
        $url = self::clean_https_url($raw);
        if ($url === '') {
            return '';
        }
        $parts = wp_parse_url($url);
        if (!is_array($parts) || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
            return '';
        }
        $host = strtolower($parts['host']);
        if (!preg_match('/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/', $host)) {
            return '';
        }
        return 'https://' . $host . (isset($parts['port']) ? ':' . (int) $parts['port'] : '');
    }

    /** #rrggbb, lowercase, or ''. */
    public static function clean_color($raw) {
        return is_string($raw) && preg_match('/^#[0-9a-fA-F]{6}$/', trim($raw)) ? strtolower(trim($raw)) : '';
    }

    // ── What this request shows ────────────────────────────────────────────

    /** The stored answer, cleaned again, or null when there is none. */
    private static function stored() {
        $raw = get_option(self::OPTION, null);
        if (!is_array($raw) || !isset($raw['mode'])
            || !in_array($raw['mode'], [self::MODE_WPMAVEN, self::MODE_BRAND, self::MODE_NEUTRAL], true)) {
            return null;
        }
        $name = self::clean_name($raw['name'] ?? '');
        $mode = $raw['mode'] === self::MODE_BRAND && $name === '' ? self::MODE_NEUTRAL : $raw['mode'];
        return self::record(
            $mode,
            $name,
            self::clean_https_url($raw['logo_url'] ?? ''),
            self::clean_color($raw['color'] ?? ''),
            self::clean_origin($raw['dashboard_url'] ?? '')
        );
    }

    /** True when this site holds a link to the WPMaven API. */
    public static function is_connected() {
        return !empty(get_option('webmaven_wp_access_token', ''))
            && !empty(get_option('webmaven_wp_client_id', ''));
    }

    /**
     * The brand this request shows: mode (wpmaven, brand or neutral), name,
     * logo_url, color and dashboard_url.
     */
    public static function current() {
        if (self::$memo !== null) {
            return self::$memo;
        }
        $stored = self::stored();
        if ($stored !== null) {
            return self::$memo = $stored;
        }
        // Connected but never read: neutral until the first answer (fail safe).
        return self::$memo = self::record(self::is_connected() ? self::MODE_NEUTRAL : self::MODE_WPMAVEN);
    }

    public static function mode() {
        return self::current()['mode'];
    }

    /** True only where the site is WPMaven's own. */
    public static function is_wpmaven() {
        return self::mode() === self::MODE_WPMAVEN;
    }

    /** "WPMaven", the brand's name, or "Site assistant". */
    public static function name() {
        $brand = self::current();
        if ($brand['mode'] === self::MODE_WPMAVEN) {
            return self::PRODUCT;
        }
        return $brand['mode'] === self::MODE_BRAND ? $brand['name'] : self::NEUTRAL_NAME;
    }

    /** "WPMaven", the brand's name, or $neutral (a phrase that names nobody). */
    public static function name_or($neutral) {
        $brand = self::current();
        if ($brand['mode'] === self::MODE_WPMAVEN) {
            return self::PRODUCT;
        }
        return $brand['mode'] === self::MODE_BRAND ? $brand['name'] : (string) $neutral;
    }

    /**
     * The admin menu's icon: the white mark, which WordPress paints in the
     * admin colour scheme like its own icons (svg-painter), or a neutral
     * dashicon where the site carries another brand.
     */
    public static function menu_icon() {
        return self::is_wpmaven() ? self::mark_data_uri() : 'dashicons-layout';
    }

    /** The one-colour mark as a data: address (the admin menu's icon, the toolbar's mask). */
    public static function mark_data_uri() {
        return 'data:image/svg+xml;base64,' . base64_encode(self::WHITE_MARK);
    }

    /**
     * Where "open your dashboard" goes: the brand's own dashboard address
     * when the API sent one, else $default (the WPMaven dashboard).
     */
    public static function dashboard_url($default) {
        $brand = self::current();
        return $brand['mode'] !== self::MODE_WPMAVEN && $brand['dashboard_url'] !== '' ? $brand['dashboard_url'] : $default;
    }

    /** What the WP-admin app reads (WEBMAVEN_WP_DATA.brand). */
    public static function for_script($default_dashboard_url) {
        $brand = self::current();
        return [
            'mode' => $brand['mode'],
            'name' => self::name(),
            'logoUrl' => $brand['logo_url'],
            'color' => $brand['color'],
            'dashboardUrl' => self::dashboard_url($default_dashboard_url),
        ];
    }

    /** Forget what this request worked out (tests, and after a new answer). */
    public static function reset() {
        self::$memo = null;
    }

    // ── Reads ──────────────────────────────────────────────────────────────

    /**
     * Keep the brand from a successful /sites/me/plan answer. Called for
     * every successful plan read (WebMaven_WP_API_Client::remember_plan_name).
     * Writes the option only when the answer changed, and announces the
     * change (webmaven_brand_changed) so the must-use file can follow it.
     *
     * @param mixed $data The `data` of the answer.
     */
    public static function remember($data) {
        // Inside a call WPMaven guards with a before/after check, a write here
        // would read as a change; the next ordinary request keeps it instead.
        if (class_exists('WebMaven_Self_Protect') && WebMaven_Self_Protect::in_guarded_call()) {
            return;
        }
        $record = self::from_plan($data);
        if ($record === null) {
            return;
        }
        $previous = self::stored();
        if ($previous === null || $previous !== $record) {
            update_option(self::OPTION, $record, true);
            self::$memo = null;
            if (function_exists('do_action')) {
                do_action('webmaven_brand_changed', self::current(), $previous);
            }
        }
        set_transient(self::FRESH, 1, self::FRESH_SECONDS);
        self::$memo = null;
    }

    /**
     * admin_menu, first: read the brand when the hour is up, so the menu and
     * the app are drawn with the current answer. One read at a time, a short
     * timeout, and a failure waits RETRY_SECONDS before the next try.
     */
    public static function maybe_refresh() {
        if (!self::is_connected() || get_transient(self::FRESH)) {
            return;
        }
        if (!function_exists('current_user_can') || !current_user_can('edit_posts')) {
            return;
        }
        if (class_exists('WebMaven_Self_Protect') && WebMaven_Self_Protect::in_guarded_call()) {
            return;
        }
        if (get_transient(self::LOCK)) {
            return;
        }
        set_transient(self::LOCK, 1, 30);
        try {
            self::refresh();
        } finally {
            delete_transient(self::LOCK);
        }
    }

    /** One plan read: a read never rotates a token the API refuses, only an expired one. */
    public static function refresh() {
        if (!class_exists('WebMaven_WP_API_Client')) {
            return false;
        }
        $client = new WebMaven_WP_API_Client();
        if (!$client->is_configured()) {
            return false;
        }
        $response = $client->read_refreshing_expired('/sites/me/plan', self::READ_TIMEOUT);
        if (!empty($response['success']) && isset($response['data']) && is_array($response['data'])) {
            WebMaven_WP_API_Client::remember_plan_name($response['data']);
            return true;
        }
        set_transient(self::FRESH, 1, self::RETRY_SECONDS);
        return false;
    }

    // ── The plugin as WordPress lists it ───────────────────────────────────

}
