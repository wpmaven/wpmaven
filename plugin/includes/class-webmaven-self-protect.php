<?php
/**
 * WPMaven self-protection.
 *
 * Nothing a call from WPMaven's service runs may disconnect or edit WPMaven
 * itself: its plugin (deactivate, delete, overwrite), its connection
 * options, or the plugin-state options that keep it active. This is the one
 * list every command path asks: update_option, delete_option and
 * batch_update_options (WebMaven_WordPress_Commands), and the webhook's
 * option actions.
 *
 * The same doors refuse the store currency (woocommerce_currency, 2026-09-30)
 * with STORE_CURRENCY_REFUSAL: only the Store currency setting changes it.
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/class-webmaven-hosting.php';

class WebMaven_Self_Protect {

    /** WPMaven's plugin folder and main file (as WordPress names them). */
    const DEFAULT_BASENAME = 'webmaven-wordpress/webmaven-wordpress.php';

    /**
     * Options that decide which plugins run or uninstall. Another plugin may
     * add to the set (webmaven_plugin_state_options).
     */
    const PLUGIN_STATE_OPTIONS = [
        'active_plugins',
        'active_sitewide_plugins',
        'uninstall_plugins',
        'recently_activated',
    ];

    /** The plugin-state set: PLUGIN_STATE_OPTIONS and what another plugin adds. */
    public static function plugin_state_options(): array {
        $names = function_exists('apply_filters') ? apply_filters('webmaven_plugin_state_options', self::PLUGIN_STATE_OPTIONS) : self::PLUGIN_STATE_OPTIONS;
        return is_array($names) ? array_values(array_filter($names, 'is_string')) : self::PLUGIN_STATE_OPTIONS;
    }

    /**
     * WPMaven's option namespace: its connection, settings, state and queues
     * (webmaven_*, _webmaven_*, wpmaven_*, _wpmaven_*), and the rows
     * WordPress stores its transients in (_transient_webmaven_*,
     * _transient_timeout_webmaven_*, and the _site_transient_ forms on a
     * network): the webhook replay nonces live there. Before 2026-09-22 this
     * fence knew three prefixes, and an approved write could reset
     * webmaven_known_admin_ids, which silenced the new-administrator alert
     * (WebMaven_Alert_Detector). The API guard mirrors it (wpCliGuard.ts).
     * Another plugin may fence more names (webmaven_protected_option_patterns),
     * never fewer.
     */
    const OPTION_NAMESPACE = '/^(?:_(?:site_)?transient_(?:timeout_)?)?_?(?:webmaven|wpmaven)/i';

    /** LIKE prefixes that cover the bare names of OPTION_NAMESPACE. */
    const OPTION_LIKE_PREFIXES = ['webmaven', '_webmaven', 'wpmaven', '_wpmaven'];

    /** How WordPress prefixes a transient's row and its timeout row (site and network). */
    const TRANSIENT_PREFIXES = ['_transient_', '_transient_timeout_', '_site_transient_', '_site_transient_timeout_'];

    /**
     * Every LIKE prefix the snapshot query reads: the bare names and each
     * of them under each transient prefix, so the stored transient rows are
     * carried and put back like the rest.
     *
     * @return string[]
     */
    public static function option_like_prefixes(): array {
        $bare = self::OPTION_LIKE_PREFIXES;
        $more = function_exists('apply_filters') ? apply_filters('webmaven_protected_option_like_prefixes', []) : [];
        foreach ((array) $more as $prefix) {
            if (is_string($prefix) && $prefix !== '' && !in_array($prefix, $bare, true)) $bare[] = $prefix;
        }
        $out = $bare;
        foreach (self::TRANSIENT_PREFIXES as $transient) {
            foreach ($bare as $prefix) {
                $out[] = $transient . $prefix;
            }
        }
        return $out;
    }

    /**
     * The site's own content inside the namespace: options the product
     * writes FOR the owner and an approved change may write again. The AI
     * summary and the schema config the SEO tools maintain, and the generated
     * theme's variables, business facts, post template, post images and
     * booking shortcode. None is plugin state or a credential. Everything
     * else in the namespace is protected. A variable key may carry a hyphen
     * (the engine writes `var:promo-code`); the API's guard has the same set.
     */
    const CONTENT_OPTION_PATTERN = '/^(?:webmaven_llms_summary|webmaven_structured_data|webmaven_(?:var|biz)_[a-z0-9_-]+|webmaven_posts_tpl|webmaven_posts_imgs|webmaven_booking_shortcode)$/i';

    const REFUSAL = 'This is refused: it would disconnect or change the WPMaven plugin or its connection.';

    /**
     * The store currency. WooCommerce keeps
     * every price as a plain number, so writing this option relabels every
     * price in the store. Only the Store currency setting changes it
     * (capabilities/store-currency.php, where the owner chooses to keep the
     * numbers or convert the prices) and the first build on a store without
     * products; every other door refuses it with STORE_CURRENCY_REFUSAL: the
     * option tools (update_option, delete_option, batch_update_options,
     * update_theme_option) and store_settings_change. Reading it stays free.
     */
    const STORE_CURRENCY_OPTION = 'woocommerce_currency';

    const STORE_CURRENCY_REFUSAL = 'The store currency is changed only with Store currency on the business page in the WPMaven dashboard (Your website, then Manage), where the owner chooses to keep the numbers or convert the prices.';

    /** The price decimals, which follow the currency (store currency 1.2.15). */
    const STORE_DECIMALS_OPTION = 'woocommerce_price_num_decimals';

    /**
     * WPMaven's own store currency state (1.2.15: the running change's lock,
     * a Convert's journal, how the last change ended). Protected like the
     * rest of the namespace (no command writes them), but another request
     * writes them while a command runs, so the before/after check leaves
     * them out: putting back an older copy would undo a live change's lock
     * or journal.
     */
    const VOLATILE_OPTIONS = [
        'webmaven_store_currency_lock', 'webmaven_store_currency_journal', 'webmaven_store_currency_last',
        // The intrusion detection's bookkeeping (1.2.23, WebMaven_Intrusion_Detection):
        // its WP-Cron scan, a failed login or the end of a request writes these
        // while a command may run, and putting an older copy back would fail
        // the command and lose a finding.
        'webmaven_sec_scanned_version', 'webmaven_sec_report_queue', 'webmaven_sec_reported',
        'webmaven_sec_known_admins', 'webmaven_sec_core_state', 'webmaven_sec_uploads_state',
        '_transient_webmaven_sec_core_checksums', '_transient_timeout_webmaven_sec_core_checksums',
        '_transient_webmaven_sec_login_failures', '_transient_timeout_webmaven_sec_login_failures',
        // The plan read's caches (1.2.31): the brand the WP-admin screens show,
        // when it was last read, and the read's lock, plus the footer badge's
        // decision and the sidebar's plan name. A page view or a WP-admin
        // screen refreshes them while a command may run, and putting back an
        // older copy would fail the command for a cache.
        'webmaven_wp_brand', '_transient_webmaven_wp_brand_fresh', '_transient_timeout_webmaven_wp_brand_fresh',
        '_transient_webmaven_wp_brand_lock', '_transient_timeout_webmaven_wp_brand_lock',
        '_transient_webmaven_badge_config', '_transient_timeout_webmaven_badge_config',
        '_transient_webmaven_user_plan', '_transient_timeout_webmaven_user_plan',
        // The site state (2026-10-05, WebMaven_Site_State): the account's
        // answer, its freshness, the push's and the refresh's locks, and the
        // old setup flag deleted once on init. The connection check, a push
        // or a sign-in writes them while a command may run.
        'webmaven_wp_site_state', 'webmaven_wp_onboarding_completed',
        '_transient_webmaven_wp_site_state_fresh', '_transient_timeout_webmaven_wp_site_state_fresh',
        '_transient_webmaven_wp_site_state_lock', '_transient_timeout_webmaven_wp_site_state_lock',
        '_transient_webmaven_wp_site_state_refresh', '_transient_timeout_webmaven_wp_site_state_refresh',
        // The notice after WPMaven Agent's activation and its read slot
        // (2026-10-25, WebMaven_Site_State): an activation or a page view
        // writes them while a command may run.
        '_transient_webmaven_wp_agent_activated', '_transient_timeout_webmaven_wp_agent_activated',
        '_transient_webmaven_wp_agent_status_slot', '_transient_timeout_webmaven_wp_agent_status_slot',
        // The form messages' table version (WebMaven_Leads): a visitor's
        // first message or an owner's page view creates the tables and
        // writes it while a command may run.
        'webmaven_leads_db_version',
        // When the last guarded call started (GUARDED_CALL_OPTION): every
        // guarded call writes it before its own check reads.
        'webmaven_guarded_call_at',
    ];

    /**
     * The row a guarded call writes as it starts (snapshot()): the time, so
     * WPMaven's own bookkeeping in another request (the alert detector's
     * WP-Cron run, which the hosting's scheduler or a page view starts at any
     * moment) waits instead of writing a row the call's before/after check
     * would read as the call's change (Nov 6, 2026: the category names step
     * after a publish failed with "the command changed the WPMaven plugin or
     * its connection (webmaven_known_theme, webmaven_known_plugins, ...)").
     */
    const GUARDED_CALL_OPTION = 'webmaven_guarded_call_at';

    /** How long after a guarded call starts the bookkeeping waits: the WP-CLI door stops a command at 30 seconds, a request ends well before this. */
    const GUARDED_CALL_WINDOW = 300;

    /**
     * Core options no option command writes or deletes: the site and admin addresses, registration and the default
     * role, db_version, the keys and salts, cron, the media path and URL, the
     * hack_file marker, and the roles option under this site's own table
     * prefix (roles_option()). update_option, batch_update_options,
     * delete_option and the webhook update path all ask
     * is_core_protected_option(), so their lists cannot drift apart again
     * (delete_option had none of them). rewrite_rules is not here: onboarding
     * writes it in a batch and deleting it only makes WordPress build it
     * again; the webhook's single-option update still refuses it.
     */
    const CORE_PROTECTED_OPTIONS = [
        'siteurl', 'home', 'admin_email', 'users_can_register',
        'default_role', 'db_version', 'secret', 'secret_key', 'auth_key',
        'secure_auth_key', 'logged_in_key', 'nonce_key',
        'auth_salt', 'secure_auth_salt', 'logged_in_salt', 'nonce_salt',
        'cron', 'hack_file', 'upload_path', 'upload_url_path',
    ];

    /** What a command is told when it would change a core option (1.2.24). */
    const CORE_OPTION_REFUSAL = 'This is refused: it would change one of WordPress\'s core settings (the site address, the admin e-mail, sign-up and roles, the keys and salts, scheduled tasks or the media folder), which WPMaven does not change.';

    /**
     * The site's identity among the core options: its address, admin e-mail,
     * sign-up rule, default role and media folder. A before/after check of a
     * call that changes options outside the option commands puts these back,
     * and the call fails. The rest of CORE_PROTECTED_OPTIONS changes in
     * ordinary use: cron (any scheduling), db_version (a core update), the
     * roles option (a plugin adding its roles), the salts (wp_salt fills in a
     * missing one).
     */
    const SITE_IDENTITY_OPTIONS = ['siteurl', 'home', 'admin_email', 'users_can_register', 'default_role', 'upload_path', 'upload_url_path'];

    public static function basename(): string {
        if (defined('WEBMAVEN_WP_FILE') && function_exists('plugin_basename')) {
            $b = plugin_basename(WEBMAVEN_WP_FILE);
            if (is_string($b) && $b !== '') return $b;
        }
        return self::DEFAULT_BASENAME;
    }

    public static function folder(): string {
        $b = self::basename();
        $slash = strpos($b, '/');
        return $slash === false ? preg_replace('/\.php$/i', '', $b) : substr($b, 0, $slash);
    }

    /**
     * Whether a name is in WPMaven's option namespace: OPTION_NAMESPACE, or a
     * pattern another plugin adds (webmaven_protected_option_patterns). An
     * added pattern can only fence more names, never fewer.
     */
    public static function in_namespace(string $name): bool {
        if (preg_match(self::OPTION_NAMESPACE, $name)) return true;
        $more = function_exists('apply_filters') ? apply_filters('webmaven_protected_option_patterns', []) : [];
        foreach ((array) $more as $pattern) {
            if (is_string($pattern) && $pattern !== '' && preg_match($pattern, $name) === 1) return true;
        }
        return false;
    }

    /**
     * Whether an option name belongs to WPMaven (its namespace, minus the
     * site's own content in it) or to the plugin-state set.
     */
    public static function is_protected_option($name): bool {
        if (!is_scalar($name)) return false;
        $n = strtolower(trim((string) $name));
        if ($n === '') return false;
        if (self::in_namespace($n) && !self::is_content_option($n)) return true;
        if (in_array($n, self::plugin_state_options(), true)) return true;
        if (class_exists('WebMaven_Hosting') && WebMaven_Hosting::is_edge_option($name)) return true;
        return false;
    }

    /**
     * The option WordPress keeps the role definitions in: the table prefix
     * plus user_roles, the blog's own prefix on multisite (WP_Roles' role_key).
     * It is wp_user_roles only on the default prefix.
     */
    public static function roles_option(): string {
        global $wpdb;
        $prefix = (isset($wpdb) && is_object($wpdb) && method_exists($wpdb, 'get_blog_prefix'))
            ? (string) $wpdb->get_blog_prefix()
            : 'wp_';
        return strtolower($prefix . 'user_roles');
    }

    /**
     * Whether an option is a core option no command writes or deletes
     * (CORE_PROTECTED_OPTIONS or the roles option). Matched the way MySQL and
     * update_option() match option names: case-insensitive, trimmed.
     */
    public static function is_core_protected_option($name): bool {
        if (!is_scalar($name)) return false;
        $n = strtolower(trim((string) $name));
        if ($n === '') return false;
        return in_array($n, self::CORE_PROTECTED_OPTIONS, true) || $n === self::roles_option();
    }

    /** A core option (is_core_protected_option) or site_admins, the network's super admins. */
    public static function is_core_network_option($name): bool {
        return self::is_core_protected_option($name) || (is_scalar($name) && strtolower(trim((string) $name)) === 'site_admins');
    }

    /**
     * Whether an option name is the store currency. Option names are matched
     * the way MySQL and update_option() match them: case-insensitive, trimmed.
     */
    public static function is_store_currency_option($name): bool {
        return is_scalar($name) && strtolower(trim((string) $name)) === self::STORE_CURRENCY_OPTION;
    }

    /** An option in WPMaven's namespace that is the site's own content (CONTENT_OPTION_PATTERN). */
    public static function is_content_option($name): bool {
        return is_scalar($name) && preg_match(self::CONTENT_OPTION_PATTERN, trim((string) $name)) === 1;
    }

    /**
     * Whether a command word carries a protected WPMaven option name: every
     * underscored word of the text is read against the namespace, so a name
     * hidden in a value, a flag or a concatenated argument is still seen.
     * A bare "webmaven" (the plugin folder webmaven-wordpress) is a plugin
     * reference, which the plugin verbs handle; the site's own content runs.
     */
    public static function names_protected_option(string $text): bool {
        if (!preg_match_all('/_?[A-Za-z][A-Za-z0-9_]*/', $text, $m)) return false;
        foreach ($m[0] as $word) {
            if (strpos($word, '_') === false) continue;
            if (self::in_namespace($word) && !self::is_content_option($word)) return true;
        }
        return false;
    }

    /** Whether a plugin reference (file, folder, slug, or a list) names WPMaven. */
    public static function is_self_plugin($plugin): bool {
        if (is_array($plugin)) {
            foreach ($plugin as $p) {
                if (self::is_self_plugin($p)) return true;
            }
            return false;
        }
        if (!is_scalar($plugin)) return false;
        $p = strtolower(trim(str_replace('\\', '/', (string) $plugin)));
        $p = trim(preg_replace('#/+#', '/', $p), '/');
        $p = preg_replace('#^(\./)+#', '', $p);
        if ($p === '') return false;
        foreach (self::own_basenames() as $base) {
            $base = strtolower($base);
            $slash = strpos($base, '/');
            $folder = $slash === false ? preg_replace('/\.php$/i', '', $base) : substr($base, 0, $slash);
            if ($p === $base || $p === $folder) return true;
            $first = explode('/', $p)[0];
            if ($first === $folder) return true;
            // A path INTO the folder (wp-content/plugins/webmaven-wordpress/
            // languages, the --dir of a scaffold): the folder as any segment.
            // Before 2026-09-22 only the first segment and the leaf were read.
            if (strpos('/' . $p . '/', '/' . $folder . '/') !== false) return true;
            // A zip or URL named after the folder, and the main file on its own.
            $leaf = basename($p);
            if ($leaf === basename($base) || preg_replace('/(\.\d+)*\.zip$/', '', $leaf) === $folder) return true;
        }
        return false;
    }

    /**
     * WPMaven's plugin files as WordPress names them: this plugin's, and
     * WPMaven Agent's when it is a plugin of its own (webmaven_own_plugin_files).
     */
    public static function own_basenames(): array {
        $files = [self::basename()];
        $more = function_exists('apply_filters') ? apply_filters('webmaven_own_plugin_files', []) : [];
        foreach ((array) $more as $file) {
            if (is_string($file) && $file !== '' && !in_array($file, $files, true)) {
                $files[] = $file;
            }
        }
        return $files;
    }

    /**
     * WPMaven's own tables, with the live prefix: the form messages visitors
     * sent and their timeline (WebMaven_Leads).
     */
    public static function own_tables(): array {
        global $wpdb;
        $prefix = (is_object($wpdb) && isset($wpdb->prefix) && is_string($wpdb->prefix) && $wpdb->prefix !== '') ? $wpdb->prefix : 'wp_';
        return [$prefix . 'wpmaven_leads', $prefix . 'wpmaven_lead_events'];
    }

    // ── File paths ──────────────────────────────────────────────────────────

    /**
     * Resolve a filesystem path to a real, absolute path even when the file
     * does not exist yet: the deepest existing ancestor is resolved with
     * realpath (following symlinks and collapsing ..), and the remaining tail
     * is appended. Empty string when it cannot be resolved.
     */
    public static function resolve_real_path(string $path): string {
        if ($path === '') return '';
        $real = realpath($path);
        if ($real !== false) return $real;
        $parent = $path;
        $tail = [];
        // Walk up to the first ancestor that exists on disk.
        for ($guard = 0; $guard < 64; $guard++) {
            $dir = dirname($parent);
            if ($dir === $parent) break;
            $tail[] = basename($parent);
            $real = realpath($dir);
            if ($real !== false) {
                return $real . '/' . implode('/', array_reverse($tail));
            }
            $parent = $dir;
        }
        return '';
    }

    /**
     * Whether a call guarded by a before/after check is running (another
     * plugin answers webmaven_in_guarded_call). WPMaven's own bookkeeping asks
     * this before it writes a row the check would otherwise read as a change.
     */
    public static function in_guarded_call(): bool {
        return function_exists('apply_filters') && (bool) apply_filters('webmaven_in_guarded_call', false);
    }

    /**
     * Whether a guarded call started in the last GUARDED_CALL_WINDOW seconds,
     * in this request or another (read from the table, never a cache).
     * WPMaven's own bookkeeping asks this before it writes a protected row.
     */
    public static function guarded_call_running(): bool {
        if (self::in_guarded_call()) return true;
        global $wpdb;
        if (!is_object($wpdb) || !method_exists($wpdb, 'get_var') || !method_exists($wpdb, 'prepare')) return false;
        try {
            $at = $wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", self::GUARDED_CALL_OPTION)); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- another request writes this row while this one runs: get_option's cache would hide it
        } catch (\Throwable $e) {
            return false;
        }
        return is_numeric($at) && abs(time() - (int) $at) < self::GUARDED_CALL_WINDOW;
    }
}
