<?php
/**
 * The setup wizard in WordPress: its calls to WPMaven and the site it builds
 * onto (2026-10-05).
 *
 * The WP-admin app runs the same setup wizard as the WPMaven dashboard. Its
 * calls reach WPMaven through this plugin, as the site: the browser asks
 * WordPress (cookie and REST nonce), and the plugin forwards the call with
 * the site's own token, which never reaches the browser.
 *
 *   GET, POST, PUT webmaven_wp/v1/wizard/<path>
 *       Only the calls in ROUTES (method and anchored path), the same list
 *       as the API's site rules for the setup; nothing else leaves the
 *       site. The query keeps only the keys that call reads. The API's HTTP
 *       status and JSON body come back as they are. 409
 *       wpmaven_site_not_connected when this site holds no link to WPMaven.
 *   GET webmaven_wp/v1/wizard/site
 *       The site the wizard builds onto, read here and sent nowhere:
 *       {name, url, adminUrl, locale, existing: {pages, posts, products},
 *       profile}, WordPress's own untouched sample content left out of the
 *       counts. The profile (WebMaven_Site_Profile) says whether the site
 *       already holds something of the owner's: empty, site or store.
 *
 * Administrators only (manage_options), like every route that reaches
 * WPMaven: the API sees one principal, the site, and cannot tell WordPress
 * users apart.
 *
 * The plugin's old wizard kept a second copy of the setup state in two
 * options nothing reads: they are deleted once.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Wizard {

    const REST_NAMESPACE = 'webmaven_wp/v1';

    /**
     * Every WPMaven call the wizard makes from WordPress: [method, path
     * pattern, query keys it reads]. The API's site rules for the setup hold
     * the same list; a call joins both with one line each. A session id is
     * [A-Za-z0-9_-]{1,64}, and the `instance` group must be this site's own
     * instance id. The last call, the list of currencies a store can sell
     * in, is public on the API, so it needs no site rule there.
     */
    const ROUTES = [
        ['GET', '#^onboarding/operators$#'],
        ['GET', '#^onboarding/inspirations$#'],
        ['GET', '#^onboarding/site-session$#'],
        ['POST', '#^onboarding/start$#'],
        ['POST', '#^onboarding/analyze$#'],
        ['POST', '#^onboarding/design-concepts$#'],
        ['POST', '#^onboarding/roadmap-interest$#'],
        ['PUT', '#^onboarding/confirm/[A-Za-z0-9_-]{1,64}$#'],
        ['PUT', '#^onboarding/store-currency/[A-Za-z0-9_-]{1,64}$#'],
        ['POST', '#^onboarding/business-plan/[A-Za-z0-9_-]{1,64}$#'],
        ['PUT', '#^onboarding/business-plan/[A-Za-z0-9_-]{1,64}$#'],
        ['POST', '#^onboarding/store-catalog/[A-Za-z0-9_-]{1,64}$#'],
        ['PUT', '#^onboarding/style/[A-Za-z0-9_-]{1,64}$#'],
        ['POST', '#^onboarding/whatsapp-intent/[A-Za-z0-9_-]{1,64}$#'],
        ['POST', '#^onboarding/operate-preview/[A-Za-z0-9_-]{1,64}$#'],
        ['POST', '#^onboarding/site-build/[A-Za-z0-9_-]{1,64}$#'],
        ['POST', '#^onboarding/ticket/[A-Za-z0-9_-]{1,64}$#'],
        ['POST', '#^onboarding/publish/[A-Za-z0-9_-]{1,64}$#'],
        ['POST', '#^onboarding/publish/[A-Za-z0-9_-]{1,64}/keep-as-is$#'],
        ['POST', '#^onboarding/site-check/[A-Za-z0-9_-]{1,64}$#'],
        ['GET', '#^onboarding/site-check/[A-Za-z0-9_-]{1,64}$#'],
        ['POST', '#^onboarding/keep-site/[A-Za-z0-9_-]{1,64}$#'],
        ['GET', '#^onboarding/site-fixes/[A-Za-z0-9_-]{1,64}$#'],
        ['POST', '#^onboarding/site-description/[A-Za-z0-9_-]{1,64}$#'],
        ['GET', '#^onboarding/manage-fixes/[A-Za-z0-9_-]{1,64}$#'],
        ['POST', '#^onboarding/manage-fixes/[A-Za-z0-9_-]{1,64}$#'],
        ['POST', '#^onboarding/site-brief/[A-Za-z0-9_-]{1,64}$#'],
        ['POST', '#^onboarding/design-restore/[A-Za-z0-9_-]{1,64}$#'],
        ['GET', '#^instances/(?<instance>[A-Za-z0-9_-]{1,64})/store-currency$#'],
        ['PUT', '#^instances/(?<instance>[A-Za-z0-9_-]{1,64})/store-currency$#'],
        ['GET', '#^instances/(?<instance>[A-Za-z0-9_-]{1,64})/store-currency/quote$#', ['to']],
        ['GET', '#^store-currencies$#'],
    ];

    /** Seconds one call may take (every JSON step of the wizard answers well within it). */
    const TIMEOUT = 120;
    /** PHP's time limit for one call, where the host lets the plugin change it. */
    const TIME_LIMIT = 150;
    /** The longest query value passed on. */
    const QUERY_VALUE_MAX = 64;

    /** The old wizard's copy of the setup state; nothing reads them. */
    const LEGACY_OPTIONS = ['webmaven_wp_options', 'webmaven_wp_onboarding'];

    const NOT_ALLOWED_CODE = 'wpmaven_wizard_not_allowed';
    const NOT_ALLOWED_TEXT = 'The setup does not make this call from WordPress.';
    const OTHER_SITE_CODE = 'wpmaven_wizard_other_site';
    const OTHER_SITE_TEXT = 'This call is about another site, so it was not sent.';
    const BAD_BODY_CODE = 'wpmaven_wizard_bad_body';
    const BAD_BODY_TEXT = 'The setup sent something WordPress could not read. Try again.';
    const UNREACHABLE_CODE = 'wpmaven_api_unreachable';
    const UNREADABLE_CODE = 'wpmaven_api_unreadable';

    /** @var object The plugin (its current_user_can_reach_api gate). */
    private $plugin;

    public function __construct($plugin) {
        $this->plugin = $plugin;
        // Updates run no activation hook: the old options go on the next admin view.
        add_action('admin_init', [__CLASS__, 'retire_legacy_options']);
    }

    public function register_routes() {
        $admin = [$this->plugin, 'current_user_can_reach_api'];
        // Registered first: WordPress takes the first route that matches, so
        // the local facts are never forwarded (a POST to it falls through to
        // the proxy, which refuses it).
        register_rest_route(self::REST_NAMESPACE, '/wizard/site', [
            'methods' => 'GET',
            'permission_callback' => $admin,
            'callback' => [$this, 'site'],
        ]);
        // Manage my site's "Site title": WordPress's own title, set here.
        register_rest_route(self::REST_NAMESPACE, '/wizard/site-title', [
            'methods' => 'POST',
            'permission_callback' => $admin,
            'callback' => [$this, 'site_title'],
        ]);
        register_rest_route(self::REST_NAMESPACE, '/wizard/(?P<path>.+)', [
            'methods' => ['GET', 'POST', 'PUT'],
            'permission_callback' => $admin,
            'callback' => [$this, 'proxy'],
        ]);
    }

    // ── The proxy ──────────────────────────────────────────────────────────

    /** One wizard call, forwarded as the site when ROUTES lists it. */
    public function proxy(\WP_REST_Request $request) {
        $method = strtoupper((string) $request->get_method());
        // The address's own segment: get_param('path') would read a "path"
        // key of the JSON body first.
        $url_params = (array) $request->get_url_params();
        $path = isset($url_params['path']) && is_string($url_params['path']) ? $url_params['path'] : '';

        $route = self::match($method, $path);
        if ($route === null) {
            return self::refuse(403, self::NOT_ALLOWED_CODE, self::NOT_ALLOWED_TEXT);
        }

        $client = new WebMaven_WP_API_Client();
        if (!$client->is_configured()) {
            return webmaven_wp_not_connected_response();
        }
        if ($route['instance'] !== null && !self::is_this_instance($route['instance'])) {
            return self::refuse(403, self::OTHER_SITE_CODE, self::OTHER_SITE_TEXT);
        }

        // The body as the browser sent it: objects stay objects (an empty
        // one too), so the API reads what the wizard wrote.
        $body = null;
        if ($method !== 'GET') {
            $raw = trim((string) $request->get_body());
            if ($raw !== '') {
                $body = json_decode($raw);
                if (json_last_error() !== JSON_ERROR_NONE) {
                    return self::refuse(400, self::BAD_BODY_CODE, self::BAD_BODY_TEXT);
                }
            }
        }
        $query = self::query((array) $request->get_query_params(), $route['query']);

        self::extend_time_limit();
        // No payload logging: the bodies carry the owner's business.
        $response = $client->make_request('/' . $path, $method, $body, $query ?: null, self::TIMEOUT, 0, false);
        return self::pass_through($response, $client);
    }

    /**
     * The call ROUTES allows for this method and path, as [query, instance]
     * (the query keys it reads, the instance id its path names or null), or
     * null for any other call.
     */
    public static function match($method, $path) {
        if (!is_string($method) || !is_string($path) || strlen($path) > 256
            || !preg_match('#^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*\z#', $path)) {
            return null;
        }
        foreach (self::ROUTES as $route) {
            if ($route[0] === $method && preg_match($route[1], $path, $m)) {
                return [
                    'query' => $route[2] ?? [],
                    'instance' => isset($m['instance']) ? (string) $m['instance'] : null,
                ];
            }
        }
        return null;
    }

    /** The query keys this call reads, plain text only; nothing else leaves the site. */
    private static function query(array $params, array $keys) {
        $out = [];
        foreach ($keys as $key) {
            $value = $params[$key] ?? null;
            if (is_string($value) && $value !== '' && strlen($value) <= self::QUERY_VALUE_MAX) {
                $out[$key] = $value;
            }
        }
        return $out;
    }

    private static function is_this_instance($id) {
        $own = get_option('webmaven_wp_instance_id', '');
        return is_string($own) && $own !== '' && hash_equals($own, (string) $id);
    }

    /** Room for a slow call where the host allows it (an unlimited script keeps its limit). */
    private static function extend_time_limit() {
        if ((int) ini_get('max_execution_time') === 0 || !function_exists('set_time_limit')) {
            return;
        }
        @set_time_limit(self::TIME_LIMIT);
    }

    /** The API's status and JSON body, as they came. */
    private static function pass_through(array $response, $client) {
        $status = (int) ($response['status_code'] ?? 0);
        if ($status <= 0) {
            return self::refuse(502, self::UNREACHABLE_CODE, self::unreachable_text());
        }
        $raw = trim((string) $client->get_last_response_body());
        $decoded = $raw === '' ? null : json_decode($raw);
        if ($raw === '' || json_last_error() !== JSON_ERROR_NONE) {
            // Not JSON (a gateway's error page, an empty answer): the error
            // status with a sentence, never the page itself.
            return self::refuse($status >= 400 && $status <= 599 ? $status : 502, self::UNREADABLE_CODE, self::unreachable_text());
        }
        return new \WP_REST_Response(self::response_data($decoded), $status >= 200 && $status <= 599 ? $status : 502);
    }

    /**
     * The decoded body for WP_REST_Response. Objects stay objects at every
     * level (an empty one stays {}); a top-level object becomes an array so
     * WordPress's own response filters (_fields, _embed) can read it.
     */
    private static function response_data($decoded) {
        if ($decoded instanceof \stdClass) {
            $vars = get_object_vars($decoded);
            if ($vars !== [] && array_keys($vars) !== range(0, count($vars) - 1)) {
                return $vars;
            }
        }
        return $decoded;
    }

    private static function refuse($status, $code, $message) {
        return new \WP_REST_Response(['success' => false, 'code' => $code, 'error' => $message], $status);
    }

    /** "WPMaven did not answer.", in the brand's words. */
    private static function unreachable_text() {
        $name = class_exists('WebMaven_Brand') ? WebMaven_Brand::name_or('The dashboard') : 'WPMaven';
        return sprintf('%s did not answer. Try again in a moment.', $name);
    }

    // ── The site the wizard builds onto ────────────────────────────────────

    public function site(\WP_REST_Request $request) {
        return new \WP_REST_Response(self::site_facts(), 200);
    }

    /** The longest title Manage my site sets. */
    const TITLE_MAX = 120;

    /**
     * POST wizard/site-title {title}: Manage my site's "Site title" is the
     * site's own (Settings > General), set here and nowhere else. A blank or
     * missing title changes nothing.
     */
    public function site_title(\WP_REST_Request $request) {
        $title = $request->get_param('title');
        $title = is_string($title) ? trim(sanitize_text_field($title)) : '';
        if ($title === '') {
            return new \WP_REST_Response(['success' => false, 'code' => 'title_missing', 'error' => 'Write a title for your site.'], 400);
        }
        if (function_exists('mb_substr')) {
            $title = mb_substr($title, 0, self::TITLE_MAX);
        } else {
            $title = substr($title, 0, self::TITLE_MAX);
        }
        update_option('blogname', $title);
        return new \WP_REST_Response(['success' => true, 'name' => wp_specialchars_decode((string) get_bloginfo('name'), ENT_QUOTES)], 200);
    }

    /** {name, url, adminUrl, locale, timeZone, existing, profile}: read here, never sent to WPMaven by this route. */
    public static function site_facts() {
        return [
            // WordPress stores the title escaped ("Bean &amp; Batch"); the app prints text.
            'name' => wp_specialchars_decode((string) get_bloginfo('name'), ENT_QUOTES),
            'url' => (string) home_url(),
            'adminUrl' => (string) admin_url(),
            // The language of the administrator who runs the wizard.
            'locale' => (string) (function_exists('get_user_locale') ? get_user_locale() : get_locale()),
            // The site's clock ("Europe/Paris" or "+02:00"): when the next site check opens is said in it.
            'timeZone' => function_exists('wp_timezone_string') ? (string) wp_timezone_string() : '',
            'existing' => self::existing_content(),
            'profile' => class_exists('WebMaven_Site_Profile') ? WebMaven_Site_Profile::profile() : null,
        ];
    }

    /**
     * The published pages, posts and products the owner already has.
     * WordPress's own sample post and page count only once someone changed
     * them (WebMaven_Default_Content); products are 0 without WooCommerce.
     */
    public static function existing_content() {
        $counts = ['pages' => self::published('page'), 'posts' => self::published('post'), 'products' => 0];
        if (class_exists('WebMaven_Default_Content')) {
            $keys = ['page' => 'pages', 'post' => 'posts'];
            foreach (WebMaven_Default_Content::untouched_defaults() as $default) {
                $post = $default['post'] ?? null;
                $key = is_object($post) ? ($keys[(string) ($post->post_type ?? '')] ?? null) : null;
                if ($key !== null && (string) ($post->post_status ?? '') === 'publish' && $counts[$key] > 0) {
                    $counts[$key]--;
                }
            }
        }
        if (class_exists('WooCommerce') && post_type_exists('product')) {
            $counts['products'] = self::published('product');
        }
        return $counts;
    }

    private static function published($type) {
        $counts = wp_count_posts($type);
        return is_object($counts) && isset($counts->publish) ? max(0, (int) $counts->publish) : 0;
    }

    // ── The old wizard's options ───────────────────────────────────────────

    /**
     * Delete the old wizard's copy of the setup state when it is still
     * there. Never inside a call WPMaven guards with a before/after check
     * (the next admin view does it). Answers how many went.
     */
    public static function retire_legacy_options() {
        if (class_exists('WebMaven_Self_Protect') && WebMaven_Self_Protect::in_guarded_call()) {
            return 0;
        }
        if (function_exists('wp_prime_option_caches')) {
            // One read for both on every admin view.
            wp_prime_option_caches(self::LEGACY_OPTIONS);
        }
        $deleted = 0;
        foreach (self::LEGACY_OPTIONS as $name) {
            if (get_option($name, null) !== null && delete_option($name)) {
                $deleted++;
            }
        }
        return $deleted;
    }
}
