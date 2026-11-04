<?php
/**
 * What a site already holds, read here (2026-10-10): the setup wizard in
 * WordPress opens on it before the idea flow when the site is not empty.
 *
 *   WebMaven_Site_Profile::profile()      the wizard's view (GET /wizard/site),
 *                                         read here and sent nowhere
 *   WebMaven_Site_Profile::check_facts()  the profile plus what the site check
 *                                         reads that no other reader answers
 *                                         (site action site_profile, registered
 *                                         with the diagnostics in
 *                                         capabilities/site-diagnostics.php)
 *   WebMaven_Site_Profile::kind_of($p)    empty, site or store, from a profile
 *
 * Counts only: never a customer's name, email, address or order contents.
 * WordPress's untouched sample content and the five widgets every new
 * WordPress gets do not make a site "existing".
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Site_Profile {

    /** A store whose last order is older than this is a site that sells nothing now. */
    const ORDER_WINDOW_DAYS = 90;

    /** Page builders by active plugin folder. */
    const BUILDER_PLUGINS = [
        'elementor' => 'elementor',
        'divi-builder' => 'divi',
        'bb-plugin' => 'beaver',
        'beaver-builder-lite-version' => 'beaver',
        'js_composer' => 'wpbakery',
        'oxygen' => 'oxygen',
    ];
    /** Page builders that are themes. */
    const BUILDER_THEMES = ['divi' => 'divi', 'extra' => 'divi', 'bricks' => 'bricks'];

    /** Plugins the check names, by folder: [folder => shown name]. */
    const SEO_PLUGINS = ['wordpress-seo' => 'Yoast SEO', 'wordpress-seo-premium' => 'Yoast SEO', 'seo-by-rank-math' => 'Rank Math', 'all-in-one-seo-pack' => 'All in One SEO', 'autodescription' => 'The SEO Framework', 'wp-seopress' => 'SEOPress'];
    const FORM_PLUGINS = ['contact-form-7' => 'Contact Form 7', 'wpforms-lite' => 'WPForms', 'wpforms' => 'WPForms', 'gravityforms' => 'Gravity Forms', 'ninja-forms' => 'Ninja Forms', 'formidable' => 'Formidable Forms', 'fluentform' => 'Fluent Forms'];
    const CACHE_PLUGINS = ['wp-rocket' => 'WP Rocket', 'w3-total-cache' => 'W3 Total Cache', 'wp-super-cache' => 'WP Super Cache', 'litespeed-cache' => 'LiteSpeed Cache', 'wp-fastest-cache' => 'WP Fastest Cache', 'autoptimize' => 'Autoptimize', 'wp-optimize' => 'WP-Optimize'];
    const BACKUP_PLUGINS = ['updraftplus' => 'UpdraftPlus', 'backwpup' => 'BackWPup', 'duplicator' => 'Duplicator', 'all-in-one-wp-migration' => 'All-in-One WP Migration', 'blogvault-real-time-backup' => 'BlogVault', 'jetpack-backup' => 'Jetpack VaultPress Backup'];
    const SMTP_PLUGINS = ['wp-mail-smtp' => 'WP Mail SMTP', 'post-smtp' => 'Post SMTP', 'fluent-smtp' => 'FluentSMTP', 'easy-wp-smtp' => 'Easy WP SMTP'];
    const ANALYTICS_PLUGINS = ['google-site-kit' => 'Site Kit by Google', 'google-analytics-for-wordpress' => 'MonsterInsights', 'koko-analytics' => 'Koko Analytics', 'independent-analytics' => 'Independent Analytics', 'wp-statistics' => 'WP Statistics', 'burst-statistics' => 'Burst Statistics', 'matomo' => 'Matomo', 'ga-google-analytics' => 'GA Google Analytics'];

    // ── The profile ────────────────────────────────────────────────────────

    /**
     * {kind, theme, builder, content, store, identity, plugins}. The counts
     * leave WordPress's untouched sample post and page out (the wizard's
     * existing_content), and menus count classic menus and the block
     * theme's saved navigations.
     */
    public static function profile(): array {
        $folders = self::active_plugin_folders();
        $theme = self::theme();
        $existing = class_exists('WebMaven_Wizard') ? WebMaven_Wizard::existing_content() : ['pages' => 0, 'posts' => 0, 'products' => 0];
        $p = [
            'theme' => $theme,
            'builder' => self::builder($folders, $theme),
            'content' => [
                'pages' => (int) $existing['pages'],
                'posts' => (int) $existing['posts'],
                'products' => (int) $existing['products'],
                'menus' => self::menus(),
                'widgets' => self::owner_widgets(),
            ],
            'store' => self::store(),
            'identity' => self::identity(),
            'plugins' => [
                'seo' => self::first_named($folders, self::SEO_PLUGINS),
                'forms' => self::all_named($folders, self::FORM_PLUGINS),
                'cache' => self::first_named($folders, self::CACHE_PLUGINS),
                'backup' => self::first_named($folders, self::BACKUP_PLUGINS),
                'smtp' => self::first_named($folders, self::SMTP_PLUGINS),
                'analytics' => self::first_named($folders, self::ANALYTICS_PLUGINS),
            ],
        ];
        return ['kind' => self::kind_of($p)] + $p;
    }

    /**
     * empty, site or store (pure). A store has an order in the last 90 days
     * or customers; a site has anything of the owner's own: content, a theme
     * that is neither WordPress's nor WPMaven's, a page builder, products,
     * a logo, menus or widgets.
     */
    public static function kind_of(array $p): string {
        $store = $p['store'] ?? null;
        if (is_array($store) && ((int) ($store['orders90'] ?? 0) > 0 || (int) ($store['customers'] ?? 0) > 0)) {
            return 'store';
        }
        $content = (array) ($p['content'] ?? []);
        $theme = (array) ($p['theme'] ?? []);
        $identity = (array) ($p['identity'] ?? []);
        $own = (int) ($content['pages'] ?? 0) > 0
            || (int) ($content['posts'] ?? 0) > 0
            || (int) ($content['products'] ?? 0) > 0
            || (int) ($content['menus'] ?? 0) > 0
            || (int) ($content['widgets'] ?? 0) > 0
            || (!empty($theme) && empty($theme['isDefault']) && empty($theme['isWpmaven']))
            || !empty($p['builder'])
            || !empty($identity['hasLogo']);
        return $own ? 'site' : 'empty';
    }

    // ── The site check's facts (site action site_profile) ──────────────────

    /** The site action: the profile plus the check's own facts, bare as the other diagnostics answer (the dispatcher wraps them). */
    public static function site_profile($params = []) {
        return self::check_facts();
    }

    /**
     * The profile plus: logins named admin, the administrators, comments
     * waiting, the legal and contact pages, the homepage's viewport tag, the
     * payment methods in test mode (names only), the PHP and WordPress
     * versions, the plugins installed but switched off, WordPress's sample
     * post, and the store's setup (counts and switches only).
     */
    public static function check_facts(): array {
        $facts = self::profile();
        $facts['users'] = [
            'adminLogin' => function_exists('username_exists') && username_exists('admin') ? true : false,
            'administrators' => self::administrators(),
        ];
        $facts['commentsWaiting'] = self::comments_waiting();
        $facts['pages'] = self::legal_pages();
        $facts['viewport'] = self::homepage_viewport();
        $facts['testModePayments'] = self::test_mode_gateways();
        $facts['php'] = PHP_VERSION;
        $facts['wordpress'] = function_exists('get_bloginfo') ? (string) get_bloginfo('version') : '';
        $facts['pluginsInactive'] = self::inactive_plugins();
        $facts['samplePost'] = self::sample_post();
        $facts['storeSetup'] = self::store_setup();
        return $facts;
    }

    /** Plugins installed but switched off (network-wide ones count as on). */
    private static function inactive_plugins(): int {
        if (!function_exists('get_plugins') && defined('ABSPATH') && file_exists(ABSPATH . 'wp-admin/includes/plugin.php')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        if (!function_exists('get_plugins')) {
            return 0;
        }
        $active = array_map('strtolower', (array) get_option('active_plugins', []));
        if (function_exists('is_multisite') && is_multisite() && function_exists('get_site_option')) {
            $active = array_merge($active, array_map('strtolower', array_keys((array) get_site_option('active_sitewide_plugins', []))));
        }
        $off = 0;
        foreach (array_keys((array) get_plugins()) as $file) {
            if (!in_array(strtolower((string) $file), $active, true)) {
                $off++;
            }
        }
        return $off;
    }

    /** WordPress's sample post ("Hello world!") still published. */
    private static function sample_post(): bool {
        $post = function_exists('get_page_by_path') ? get_page_by_path('hello-world', OBJECT, 'post') : null;
        return $post && (string) $post->post_status === 'publish';
    }

    /**
     * The store's setup, null without WooCommerce: switched-on payment
     * methods, shipping zones with a switched-on method, products that need
     * shipping, taxes and their rates, products without a photo, products
     * out of stock that the shop still shows, coming soon mode. Counts only.
     */
    private static function store_setup(): ?array {
        if (!class_exists('WooCommerce') || !function_exists('WC')) {
            return null;
        }
        global $wpdb;
        // The counts below name WordPress's and WooCommerce's tables and fixed
        // meta keys and values only; nothing comes from a request.
        $count = function (string $sql) use ($wpdb) {
            return isset($wpdb) && is_object($wpdb) && method_exists($wpdb, 'get_var') ? (int) $wpdb->get_var($sql) : 0; // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        };
        $gateways = 0;
        try {
            foreach ((array) WC()->payment_gateways()->payment_gateways() as $gateway) {
                if (is_object($gateway) && ($gateway->enabled ?? 'no') === 'yes') {
                    $gateways++;
                }
            }
        } catch (\Throwable $e) {
            $gateways = 0;
        }
        $zones = 0;
        try {
            if (class_exists('WC_Shipping_Zones')) {
                $all = (array) WC_Shipping_Zones::get_zones();
                foreach ($all as $zone) {
                    foreach ((array) ($zone['shipping_methods'] ?? []) as $method) {
                        if (is_object($method) && method_exists($method, 'is_enabled') && $method->is_enabled()) {
                            $zones++;
                            break;
                        }
                    }
                }
                if (class_exists('WC_Shipping_Zone')) {
                    $rest = new WC_Shipping_Zone(0);
                    if (count((array) $rest->get_shipping_methods(true)) > 0) {
                        $zones++;
                    }
                }
            }
        } catch (\Throwable $e) {
            $zones = 0;
        }
        $p = isset($wpdb) && is_object($wpdb) ? $wpdb->prefix : 'wp_';
        $published = "FROM {$p}posts p WHERE p.post_type = 'product' AND p.post_status = 'publish'";
        $meta = function (string $key, string $value) use ($p) {
            return "EXISTS (SELECT 1 FROM {$p}postmeta m WHERE m.post_id = p.ID AND m.meta_key = '{$key}' AND m.meta_value = '{$value}')";
        };
        $physical = $count("SELECT COUNT(*) {$published} AND NOT " . $meta('_virtual', 'yes'));
        $no_photo = $count("SELECT COUNT(*) {$published} AND NOT EXISTS (SELECT 1 FROM {$p}postmeta m WHERE m.post_id = p.ID AND m.meta_key = '_thumbnail_id' AND m.meta_value NOT IN ('', '0'))");
        $out_shown = get_option('woocommerce_hide_out_of_stock_items', 'no') === 'yes'
            ? 0
            : $count("SELECT COUNT(*) {$published} AND " . $meta('_stock_status', 'outofstock'));
        $taxes_on = function_exists('wc_tax_enabled') ? (bool) wc_tax_enabled() : get_option('woocommerce_calc_taxes', 'no') === 'yes';
        return [
            'gatewaysOn' => $gateways,
            'shippingZonesWithMethods' => $zones,
            'shippingDisabled' => get_option('woocommerce_ship_to_countries', '') === 'disabled',
            'physicalProducts' => $physical,
            'taxesOn' => $taxes_on,
            'taxRates' => $taxes_on ? $count("SELECT COUNT(*) FROM {$p}woocommerce_tax_rates") : 0,
            'productsNoPhoto' => $no_photo,
            'outOfStockShown' => $out_shown,
            'comingSoon' => get_option('woocommerce_coming_soon', 'no') === 'yes',
        ];
    }

    // ── Readers ─────────────────────────────────────────────────────────────

    /** Active plugins' folders (network-wide ones too). */
    private static function active_plugin_folders(): array {
        $files = (array) get_option('active_plugins', []);
        if (function_exists('is_multisite') && is_multisite() && function_exists('get_site_option')) {
            $files = array_merge($files, array_keys((array) get_site_option('active_sitewide_plugins', [])));
        }
        $folders = [];
        foreach ($files as $file) {
            $folder = strtok((string) $file, '/');
            if ($folder !== false && $folder !== '') {
                $folders[strtolower($folder)] = true;
            }
        }
        return array_keys($folders);
    }

    private static function theme(): array {
        $t = function_exists('wp_get_theme') ? wp_get_theme() : null;
        if (!$t) {
            return [];
        }
        $stylesheet = (string) $t->get_stylesheet();
        $template = (string) $t->get_template();
        return [
            'name' => wp_specialchars_decode((string) $t->get('Name'), ENT_QUOTES),
            'stylesheet' => $stylesheet,
            'isDefault' => strpos($template, 'twenty') === 0,
            'isBlockTheme' => function_exists('wp_is_block_theme') ? (bool) wp_is_block_theme() : false,
            'isWpmaven' => self::is_wpmaven_theme($t),
        ];
    }

    /** A theme WPMaven designed: its author or address says so (the theme or its parent). */
    private static function is_wpmaven_theme($t): bool {
        foreach ([$t, method_exists($t, 'parent') ? $t->parent() : null] as $theme) {
            if (!$theme) {
                continue;
            }
            $marks = strtolower((string) $theme->get('Author') . ' ' . (string) $theme->get('ThemeURI'));
            if (strpos($marks, 'webmaven') !== false || strpos($marks, 'wpmaven') !== false) {
                return true;
            }
        }
        return false;
    }

    private static function builder(array $folders, array $theme): ?string {
        foreach (self::BUILDER_PLUGINS as $folder => $builder) {
            if (in_array($folder, $folders, true)) {
                return $builder;
            }
        }
        $stylesheet = strtolower((string) ($theme['stylesheet'] ?? ''));
        foreach (self::BUILDER_THEMES as $slug => $builder) {
            if ($stylesheet === $slug || strpos($stylesheet, $slug . '-') === 0) {
                return $builder;
            }
        }
        return null;
    }

    /**
     * Classic menus and the block theme's saved navigations, leaving out the
     * page list a block theme saves as the navigation on the site's first
     * front-end view (WordPress's fallback, not the owner's menu).
     */
    private static function menus(): int {
        $n = function_exists('wp_get_nav_menus') ? count((array) wp_get_nav_menus()) : 0;
        if (function_exists('post_type_exists') && post_type_exists('wp_navigation') && function_exists('get_posts')) {
            foreach ((array) get_posts(['post_type' => 'wp_navigation', 'post_status' => 'publish', 'numberposts' => 20]) as $nav) {
                if (!self::is_fallback_navigation((string) ($nav->post_content ?? ''))) {
                    $n++;
                }
            }
        }
        return $n;
    }

    /** The navigation WordPress saves by itself: one page list, nothing else. */
    public static function is_fallback_navigation(string $content): bool {
        return (bool) preg_match('#^\s*<!--\s+wp:page-list\s*(\{[^}]*\}\s*)?/-->\s*$#', $content);
    }

    /**
     * Widgets in the theme's own widget areas, leaving out the block widgets
     * every new WordPress gets (search, latest posts and comments, archives,
     * categories) while they still hold their install content.
     */
    private static function owner_widgets(): int {
        $areas = (array) get_option('sidebars_widgets', []);
        $registered = isset($GLOBALS['wp_registered_sidebars']) && is_array($GLOBALS['wp_registered_sidebars']) ? array_keys($GLOBALS['wp_registered_sidebars']) : null;
        $blocks = (array) get_option('widget_block', []);
        $n = 0;
        foreach ($areas as $area => $ids) {
            if ($area === 'wp_inactive_widgets' || $area === 'array_version' || !is_array($ids)) {
                continue;
            }
            if ($registered !== null && !in_array($area, $registered, true)) {
                continue;
            }
            foreach ($ids as $id) {
                if (preg_match('/^block-(\d+)$/', (string) $id, $m)) {
                    $content = (string) ($blocks[(int) $m[1]]['content'] ?? '');
                    if (self::is_install_widget($content)) {
                        continue;
                    }
                }
                $n++;
            }
        }
        return $n;
    }

    /** One of the block widgets wp_install_defaults() writes, as it wrote it. */
    public static function is_install_widget(string $content): bool {
        $blocks = [];
        if (!preg_match_all('/<!--\s+wp:([a-z0-9\/-]+)/', $content, $m)) {
            return false;
        }
        foreach ($m[1] as $name) {
            $blocks[$name] = true;
        }
        unset($blocks['group'], $blocks['heading']);
        $kinds = array_keys($blocks);
        if (count($kinds) !== 1 || !in_array($kinds[0], ['search', 'latest-posts', 'latest-comments', 'archives', 'categories'], true)) {
            return false;
        }
        $text = trim(preg_replace('/\s+/', ' ', wp_strip_all_tags($content)));
        // WordPress's own widget headings, in the site's language.
        $headings = function_exists('translate') ? [translate('Recent Posts', 'default'), translate('Recent Comments', 'default'), translate('Archives', 'default'), translate('Categories', 'default')] : ['Recent Posts', 'Recent Comments', 'Archives', 'Categories'];
        return $text === '' || in_array($text, $headings, true) || in_array($text, ['Recent Posts', 'Recent Comments', 'Archives', 'Categories'], true);
    }

    /** {orders90, customers, lastOrderAt, currency}, or null without WooCommerce. Counts only. */
    private static function store(): ?array {
        if (!class_exists('WooCommerce') || !function_exists('wc_get_orders')) {
            return null;
        }
        $since = time() - self::ORDER_WINDOW_DAYS * DAY_IN_SECONDS;
        $orders90 = 0;
        $last = null;
        try {
            $page = wc_get_orders(['limit' => 1, 'paginate' => true, 'return' => 'ids', 'type' => 'shop_order', 'date_created' => '>' . $since]);
            $orders90 = is_object($page) && isset($page->total) ? (int) $page->total : 0;
            $latest = wc_get_orders(['limit' => 1, 'orderby' => 'date', 'order' => 'DESC', 'type' => 'shop_order']);
            if (!empty($latest) && is_object($latest[0]) && method_exists($latest[0], 'get_date_created') && $latest[0]->get_date_created()) {
                $last = $latest[0]->get_date_created()->date('c');
            }
        } catch (\Throwable $e) {
            $orders90 = 0;
        }
        return [
            'orders90' => $orders90,
            'customers' => self::customers(),
            'lastOrderAt' => $last,
            'currency' => function_exists('get_woocommerce_currency') ? (string) get_woocommerce_currency() : (string) get_option('woocommerce_currency', ''),
        ];
    }

    /** WooCommerce's customer count (its lookup table holds guests too), else the customer role. */
    private static function customers(): int {
        global $wpdb;
        if (isset($wpdb) && is_object($wpdb) && method_exists($wpdb, 'get_var')) {
            $table = $wpdb->prefix . 'wc_customer_lookup';
            $exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table));
            if ($exists === $table) {
                return (int) $wpdb->get_var("SELECT COUNT(*) FROM {$table}");
            }
        }
        if (function_exists('count_users')) {
            $users = count_users();
            return (int) ($users['avail_roles']['customer'] ?? 0);
        }
        return 0;
    }

    private static function identity(): array {
        $logo = (int) get_theme_mod('custom_logo', 0) > 0 || (int) get_option('site_logo', 0) > 0;
        return [
            'hasLogo' => $logo,
            'hasIcon' => (int) get_option('site_icon', 0) > 0,
            'tagline' => wp_specialchars_decode((string) get_option('blogdescription', ''), ENT_QUOTES),
        ];
    }

    private static function administrators(): int {
        if (!function_exists('count_users')) {
            return 0;
        }
        $users = count_users();
        return (int) ($users['avail_roles']['administrator'] ?? 0);
    }

    private static function comments_waiting(): int {
        if (!function_exists('wp_count_comments')) {
            return 0;
        }
        $c = wp_count_comments();
        return is_object($c) ? (int) ($c->moderated ?? 0) : 0;
    }

    /** The privacy, terms, contact and legal notice pages that are published. */
    private static function legal_pages(): array {
        $privacy = (int) get_option('wp_page_for_privacy_policy', 0);
        $terms = (int) get_option('woocommerce_terms_page_id', 0);
        $published = function ($id) {
            $post = $id > 0 && function_exists('get_post') ? get_post($id) : null;
            return $post && (string) $post->post_status === 'publish';
        };
        $by_slug = function (array $slugs) {
            foreach ($slugs as $slug) {
                $page = function_exists('get_page_by_path') ? get_page_by_path($slug, OBJECT, 'page') : null;
                if ($page && (string) $page->post_status === 'publish') {
                    return true;
                }
            }
            return false;
        };
        return [
            'privacy' => $published($privacy) || $by_slug(['privacy-policy', 'privacy', 'datenschutz', 'politique-de-confidentialite', 'confidentialite']),
            'terms' => $published($terms) || $by_slug(['terms', 'terms-and-conditions', 'terms-of-service', 'agb', 'cgv', 'conditions-generales-de-vente']),
            'contact' => $by_slug(['contact', 'contact-us', 'kontakt', 'contactez-nous']),
            'legal' => $by_slug(['legal-notice', 'legal', 'impressum', 'mentions-legales']),
        ];
    }

    /** Whether the homepage carries a viewport tag; null when it could not be read. */
    private static function homepage_viewport(): ?bool {
        if (!function_exists('wp_remote_get') || !function_exists('home_url')) {
            return null;
        }
        $r = wp_remote_get(home_url('/'), ['timeout' => 10, 'redirection' => 3, 'limit_response_size' => 262144]);
        if (is_wp_error($r) || (int) wp_remote_retrieve_response_code($r) >= 400) {
            return null;
        }
        return (bool) preg_match('/<meta[^>]+name=["\']viewport["\']/i', (string) wp_remote_retrieve_body($r));
    }

    /** Switched-on payment methods whose settings say test mode or sandbox: their names. */
    private static function test_mode_gateways(): array {
        if (!function_exists('WC') || !class_exists('WooCommerce')) {
            return [];
        }
        $names = [];
        try {
            foreach ((array) WC()->payment_gateways()->payment_gateways() as $gateway) {
                if (!is_object($gateway) || ($gateway->enabled ?? 'no') !== 'yes') {
                    continue;
                }
                $settings = is_array($gateway->settings ?? null) ? $gateway->settings : [];
                $test = ($settings['testmode'] ?? '') === 'yes' || ($settings['sandbox'] ?? '') === 'yes' || ($settings['test_mode'] ?? '') === 'yes';
                if ($test) {
                    $names[] = wp_strip_all_tags((string) ($gateway->get_title() ?: $gateway->id));
                }
            }
        } catch (\Throwable $e) {
            return [];
        }
        return $names;
    }

    private static function first_named(array $folders, array $map): ?string {
        foreach ($map as $folder => $name) {
            if (in_array($folder, $folders, true)) {
                return $name;
            }
        }
        return null;
    }

    private static function all_named(array $folders, array $map): array {
        $out = [];
        foreach ($map as $folder => $name) {
            if (in_array($folder, $folders, true) && !in_array($name, $out, true)) {
                $out[] = $name;
            }
        }
        return $out;
    }
}
