<?php
/**
 * WPMaven self-protection.
 *
 * Operators may manage the whole site, but nothing they run may disconnect or
 * edit WPMaven itself: its plugin (deactivate, uninstall, delete, overwrite),
 * its connection options, or the plugin-state options that keep it active.
 * This is the one list every command path asks:
 *
 *  - update_option, delete_option, batch_update_options
 *    (WebMaven_WordPress_Commands);
 *  - a before/after check around a backup restore and the commands below:
 *    if WPMaven's options or its place in active_plugins changed anyway,
 *    they are put back and the call fails;
 *  - in WPMaven Agent (its guards): plugin deactivate and
 *    uninstall, the WP-CLI validator, which checks the command AFTER shell
 *    unquoting, so quotes and backslashes cannot hide a name, and the REST
 *    fallback of execute_command, which refuses a route or a body that names
 *    WPMaven before it dispatches and runs every non-GET between the same
 *    before/after check, with the plugin lifecycle guards hooked for the
 *    length of the call.
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
     * Options that decide which plugins run or uninstall. WPMaven Agent adds
     * the ones that decide updates (webmaven_plugin_state_options).
     */
    const PLUGIN_STATE_OPTIONS = [
        'active_plugins',
        'active_sitewide_plugins',
        'uninstall_plugins',
        'recently_activated',
    ];

    /** The plugin-state set: PLUGIN_STATE_OPTIONS and what WPMaven Agent adds. */
    public static function plugin_state_options(): array {
        $names = function_exists('apply_filters') ? apply_filters('webmaven_plugin_state_options', self::PLUGIN_STATE_OPTIONS) : self::PLUGIN_STATE_OPTIONS;
        return is_array($names) ? array_values(array_filter($names, 'is_string')) : self::PLUGIN_STATE_OPTIONS;
    }

    /**
     * WPMaven's option namespace: its connection, settings, state and queues
     * (webmaven_*, _webmaven_*, wpmaven_*, wm_*, wme_*), and the rows
     * WordPress stores its transients in (_transient_webmaven_*,
     * _transient_timeout_webmaven_*, and the _site_transient_ forms on a
     * network): the updater's cached release manifest and the webhook replay
     * nonces live there, and until 2026-09-22 an approved write could replace
     * the manifest with one that installs an older signed release. The same
     * pattern the plugin API bridge refuses (WPMAVEN_OPTION_PATTERN in
     * capabilities/plugin-api-bridge.php), so the two doors agree. Before
     * 2026-09-22 this fence knew three prefixes, and an approved write could
     * reset webmaven_known_admin_ids, which silenced the new-administrator
     * alert (WebMaven_Alert_Detector). The API guard mirrors it (wpCliGuard.ts).
     */
    const OPTION_NAMESPACE = '/^(?:_(?:site_)?transient_(?:timeout_)?)?_?(?:webmaven|wpmaven)|^(?:_(?:site_)?transient_(?:timeout_)?)?wme?_/i';

    /** LIKE prefixes that cover the bare names of OPTION_NAMESPACE. */
    const OPTION_LIKE_PREFIXES = ['webmaven', '_webmaven', 'wpmaven', '_wpmaven', 'wm_', 'wme_'];

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
        $out = self::OPTION_LIKE_PREFIXES;
        foreach (self::TRANSIENT_PREFIXES as $transient) {
            foreach (self::OPTION_LIKE_PREFIXES as $prefix) {
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
    const CONTENT_OPTION_PATTERN = '/^(?:webmaven_llms_summary|webmaven_structured_data|wm_(?:var|biz)_[a-z0-9_-]+|wm_posts_tpl|wm_posts_imgs|wm_booking_shortcode)$/i';

    const REFUSAL = 'This is refused: it would disconnect or change the WPMaven plugin or its connection.';

    /**
     * The store currency. WooCommerce keeps
     * every price as a plain number, so writing this option relabels every
     * price in the store. Only the Store currency setting changes it
     * (capabilities/store-currency.php, where the owner chooses to keep the
     * numbers or convert the prices) and the first build on a store without
     * products; every other door refuses it with STORE_CURRENCY_REFUSAL: the
     * option tools (update_option, delete_option, batch_update_options,
     * update_theme_option), store_settings_change, WP-CLI and the plugin
     * bridge. Reading it stays free.
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
        // WPMaven Agent just activated, and its notice's read slot
        // (2026-10-25): Agent's activation and the notice write them.
        '_transient_webmaven_wp_agent_activated', '_transient_timeout_webmaven_wp_agent_activated',
        '_transient_webmaven_wp_agent_status_slot', '_transient_timeout_webmaven_wp_agent_status_slot',
        // The form messages' table version (WebMaven_Leads): a visitor's
        // first message or an owner's page view creates the tables and
        // writes it while a command may run.
        'webmaven_leads_db_version',
    ];

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

    /**
     * What a command is told when it would change a core option (1.2.24): the
     * WP-CLI door refuses them by name, and puts SITE_IDENTITY_OPTIONS back
     * after a command that changed them some other way.
     */
    const CORE_OPTION_REFUSAL = 'This is refused: it would change one of WordPress\'s core settings (the site address, the admin e-mail, sign-up and roles, the keys and salts, scheduled tasks or the media folder), which WPMaven does not change.';

    /**
     * The site's identity among the core options: its address, admin e-mail,
     * sign-up rule, default role and media folder. A WP-CLI command no word
     * check catches (`wp search-replace` over wp_options) still cannot change
     * them: site_identity_restore puts them back and the call fails. The rest
     * of CORE_PROTECTED_OPTIONS is left to the word checks, because ordinary
     * commands write it: cron (any scheduling), db_version (core update-db),
     * the roles option (a plugin adding its roles), the salts (wp_salt fills
     * in a missing one).
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
     * Whether an option name belongs to WPMaven (its namespace, minus the
     * site's own content in it) or to the plugin-state set.
     */
    public static function is_protected_option($name): bool {
        if (!is_scalar($name)) return false;
        $n = strtolower(trim((string) $name));
        if ($n === '') return false;
        if (preg_match(self::OPTION_NAMESPACE, $n) && !self::is_content_option($n)) return true;
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
            if (preg_match(self::OPTION_NAMESPACE, $word) && !self::is_content_option($word)) return true;
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
     * WPMaven's own tables, with the live prefix: the conversation stores,
     * and the form messages visitors sent and their timeline (WebMaven_Leads).
     */
    public static function own_tables(): array {
        global $wpdb;
        $prefix = (is_object($wpdb) && isset($wpdb->prefix) && is_string($wpdb->prefix) && $wpdb->prefix !== '') ? $wpdb->prefix : 'wp_';
        return [
            $prefix . 'wpai_conversations', $prefix . 'webmaven_wp_conversations',
            $prefix . 'wpmaven_leads', $prefix . 'wpmaven_lead_events',
        ];
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
     * Whether WPMaven is inside a call it guards with a before/after check
     * (WPMaven Agent's REST fallback, or the WP-CLI child it marked: it
     * answers through the webmaven_in_guarded_call filter). WPMaven's own
     * bookkeeping asks this before it writes a row the check would otherwise
     * read as a change (the updater's manifest cache).
     */
    public static function in_guarded_call(): bool {
        return function_exists('apply_filters') && (bool) apply_filters('webmaven_in_guarded_call', false);
    }

    // ── Before/after check ─────────────────────────────────────────────────

    /** Raw rows of WPMaven's options, whether it is active, and the network half. */
    public static function snapshot(): ?array {
        global $wpdb;
        if (!is_object($wpdb) || !method_exists($wpdb, 'get_results')) return null;
        $where = [];
        foreach (self::option_like_prefixes() as $prefix) {
            $where[] = $wpdb->prepare('option_name LIKE %s', $wpdb->esc_like($prefix) . '%');
        }
        // Each LIKE above is prepared; joined with OR.
        $rows = $wpdb->get_results(
            "SELECT option_name, option_value, autoload FROM {$wpdb->options} WHERE " . implode(' OR ', $where), // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
            ARRAY_A
        );
        $options = [];
        foreach ((array) $rows as $r) {
            // The site's own content in the namespace is the owner's to
            // change; only the protected set is put back.
            if (!self::is_protected_option($r['option_name'])) continue;
            if (in_array(strtolower((string) $r['option_name']), self::VOLATILE_OPTIONS, true)) continue;
            $options[$r['option_name']] = ['value' => $r['option_value'], 'autoload' => $r['autoload']];
        }
        $active_raw = $wpdb->get_var($wpdb->prepare(
            "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s",
            'active_plugins'
        ));
        // The rows read here and below are lists of plugin files. They are
        // read right after a command that may have rewritten them, so no class
        // is ever built from their text (allowed_classes false).
        $active = @unserialize((string) $active_raw, ['allowed_classes' => false]); // nosemgrep: php.lang.security.unserialize-use.unserialize-use (a list of plugin files: no class is ever built from the row)
        return [
            'options' => $options,
            'active' => is_array($active) && in_array(self::basename(), $active, true),
            'network' => self::network_snapshot(),
        ];
    }

    /**
     * The network half, on multisite: WPMaven's rows in wp_sitemeta. Its
     * activation lives there (active_sitewide_plugins) and so do its network
     * options, so an ability calling deactivate_plugins($file, true) or a
     * `network meta update` could disconnect WPMaven entirely behind a
     * snapshot that only read {$wpdb->options}. null on a single-site install
     * (no sitemeta table) or when the table cannot be read.
     */
    private static function network_snapshot(): ?array {
        global $wpdb;
        if (!is_object($wpdb) || empty($wpdb->sitemeta) || !method_exists($wpdb, 'get_results')) return null;
        $prev = method_exists($wpdb, 'suppress_errors') ? $wpdb->suppress_errors(true) : null;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT meta_key, meta_value FROM {$wpdb->sitemeta} WHERE meta_key = %s OR meta_key LIKE %s",
            'active_sitewide_plugins',
            $wpdb->esc_like('webmaven_') . '%'
        ), ARRAY_A);
        $error = property_exists($wpdb, 'last_error') ? (string) $wpdb->last_error : '';
        if ($prev !== null) $wpdb->suppress_errors($prev);
        if ($error !== '' || !is_array($rows)) return null;
        $meta = [];
        foreach ($rows as $r) {
            $meta[(string) $r['meta_key']] = (string) $r['meta_value'];
        }
        $sitewide = @unserialize($meta['active_sitewide_plugins'] ?? 'N;', ['allowed_classes' => false]); // nosemgrep: php.lang.security.unserialize-use.unserialize-use (a list of plugin files: no class is ever built from the row)
        return [
            'meta' => $meta,
            'network_active' => is_array($sitewide) && array_key_exists(self::basename(), $sitewide),
        ];
    }

    /** The site id wp_sitemeta rows belong to. */
    private static function network_id(): int {
        global $wpdb;
        $id = (int) (is_object($wpdb) && property_exists($wpdb, 'siteid') ? $wpdb->siteid : 1);
        return $id > 0 ? $id : 1;
    }

    /** Write one wp_sitemeta row, replacing whatever is there. */
    private static function write_site_meta(string $key, string $value): void {
        global $wpdb;
        $site_id = self::network_id();
        $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->sitemeta} WHERE site_id = %d AND meta_key = %s", $site_id, $key));
        $wpdb->query($wpdb->prepare(
            "INSERT INTO {$wpdb->sitemeta} (site_id, meta_key, meta_value) VALUES (%d, %s, %s)",
            $site_id, $key, $value
        ));
        self::forget_site_meta($key);
    }

    /** Remove one wp_sitemeta row. */
    private static function delete_site_meta(string $key): void {
        global $wpdb;
        $wpdb->query($wpdb->prepare(
            "DELETE FROM {$wpdb->sitemeta} WHERE site_id = %d AND meta_key = %s",
            self::network_id(), $key
        ));
        self::forget_site_meta($key);
    }

    /** Drop the network-option cache entries WordPress would otherwise serve. */
    private static function forget_site_meta(string $key): void {
        if (!function_exists('wp_cache_delete')) return;
        $site_id = self::network_id();
        wp_cache_delete("{$site_id}:{$key}", 'site-options');
        wp_cache_delete("{$site_id}:notoptions", 'site-options');
    }

    /**
     * Put back WPMaven's wp_sitemeta rows, the way the options half does:
     * our own keys are restored or removed outright, and the network
     * activation is repaired ENTRY by entry, so a command that network-
     * activated another plugin in the same breath keeps that change.
     *
     * @return string[]
     */
    private static function restore_network(?array $before): array {
        if ($before === null) return [];
        $after = self::network_snapshot();
        if ($after === null) return [];
        $restored = [];
        foreach ($before['meta'] as $key => $value) {
            if ($key === 'active_sitewide_plugins') continue;
            if (isset($after['meta'][$key]) && $after['meta'][$key] === $value) continue;
            self::write_site_meta((string) $key, (string) $value);
            $restored[] = (string) $key;
        }
        foreach ($after['meta'] as $key => $value) {
            if ($key === 'active_sitewide_plugins') continue;
            if (!array_key_exists($key, $before['meta'])) {
                self::delete_site_meta((string) $key);
                $restored[] = (string) $key;
            }
        }
        if (!empty($before['network_active']) && empty($after['network_active'])) {
            $list = @unserialize($after['meta']['active_sitewide_plugins'] ?? 'N;', ['allowed_classes' => false]); // nosemgrep: php.lang.security.unserialize-use.unserialize-use (a list of plugin files: no class is ever built from the row)
            $list = is_array($list) ? $list : [];
            $list[self::basename()] = time();
            self::write_site_meta('active_sitewide_plugins', serialize($list));
            $restored[] = 'active_sitewide_plugins';
        }
        return $restored;
    }

    /**
     * Compare with a snapshot taken before a command ran. Puts back anything
     * of WPMaven's that changed and returns what was restored (empty when
     * nothing changed).
     *
     * @return string[]
     */
    public static function restore_if_changed(?array $before): array {
        if ($before === null) return [];
        $after = self::snapshot();
        if ($after === null) return [];
        global $wpdb;
        $restored = [];

        foreach ($before['options'] as $name => $row) {
            $now = $after['options'][$name] ?? null;
            if ($now !== null && $now['value'] === $row['value']) continue;
            // A transient that had already expired before the call is dropped
            // by WordPress on its next read (get_transient deletes the row and
            // its timeout). Gone after the call, it is not a change: nothing
            // relied on it, and putting it back would fail the call for a
            // `wp plugin list` that merely read it.
            if ($now === null && self::expired_transient_row($name, $before['options'])) continue;
            $wpdb->query($wpdb->prepare(
                "INSERT INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, %s)
                 ON DUPLICATE KEY UPDATE option_value = VALUES(option_value), autoload = VALUES(autoload)",
                $name, $row['value'], $row['autoload']
            ));
            $restored[] = $name;
        }
        foreach ($after['options'] as $name => $row) {
            if (!array_key_exists($name, $before['options'])) {
                $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name = %s", $name));
                $restored[] = $name;
            }
        }
        if (!empty($before['active']) && empty($after['active'])) {
            $raw = $wpdb->get_var($wpdb->prepare(
                "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", 'active_plugins'
            ));
            $list = @unserialize((string) $raw, ['allowed_classes' => false]); // nosemgrep: php.lang.security.unserialize-use.unserialize-use (a list of plugin files: no class is ever built from the row)
            $list = is_array($list) ? array_values($list) : [];
            $list[] = self::basename();
            sort($list);
            $wpdb->query($wpdb->prepare(
                "INSERT INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'yes')
                 ON DUPLICATE KEY UPDATE option_value = VALUES(option_value)",
                'active_plugins', serialize($list)
            ));
            $restored[] = 'active_plugins';
        }
        if ($restored && function_exists('wp_cache_delete')) {
            wp_cache_delete('alloptions', 'options');
            wp_cache_delete('notoptions', 'options');
            foreach ($restored as $name) wp_cache_delete($name, 'options');
        }
        return array_merge($restored, self::restore_network($before['network'] ?? null));
    }

    /**
     * The site's keys and salts kept as options, used by WordPress when
     * wp-config does not define them: secret_key derives the key WPMaven
     * encrypts its connection with (wp_salt('AUTH_KEY')), the others the
     * site's cookies and nonces. A backup restore keeps them as they were
     * (1.6.0): a dump that changed one left WPMaven unable to read its own
     * connection (the site was cut off) and signed everyone out.
     */
    const SITE_KEY_OPTIONS = [
        'secret_key', 'secret', 'auth_key', 'auth_salt', 'secure_auth_key', 'secure_auth_salt',
        'logged_in_key', 'logged_in_salt', 'nonce_key', 'nonce_salt',
    ];

    /**
     * The raw rows of SITE_KEY_OPTIONS, in wp_options and, on multisite, in
     * wp_sitemeta (where get_site_option reads secret_key). null when the
     * tables cannot be read.
     */
    public static function site_keys_snapshot(): ?array {
        global $wpdb;
        if (!is_object($wpdb) || !method_exists($wpdb, 'get_results') || !method_exists($wpdb, 'prepare')) return null;
        $in = implode(', ', array_fill(0, count(self::SITE_KEY_OPTIONS), '%s'));
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT option_name, option_value, autoload FROM {$wpdb->options} WHERE option_name IN ($in)",
            ...self::SITE_KEY_OPTIONS
        ), ARRAY_A);
        if (!is_array($rows)) return null;
        $options = [];
        foreach ($rows as $r) {
            $options[(string) $r['option_name']] = ['value' => (string) $r['option_value'], 'autoload' => (string) $r['autoload']];
        }
        $meta = null;
        if (!empty($wpdb->sitemeta)) {
            $meta_rows = $wpdb->get_results($wpdb->prepare(
                "SELECT meta_key, meta_value FROM {$wpdb->sitemeta} WHERE site_id = %d AND meta_key IN ($in)",
                self::network_id(), ...self::SITE_KEY_OPTIONS
            ), ARRAY_A);
            if (is_array($meta_rows)) {
                $meta = [];
                foreach ($meta_rows as $r) $meta[(string) $r['meta_key']] = (string) $r['meta_value'];
            }
        }
        return ['options' => $options, 'meta' => $meta];
    }

    /**
     * Put SITE_KEY_OPTIONS back as site_keys_snapshot read them: a changed
     * row gets its value back, a new one goes, a removed one returns.
     * Returns the names put back (empty when the restore changed none).
     *
     * @return string[]
     */
    public static function site_keys_restore(?array $before): array {
        if ($before === null) return [];
        $after = self::site_keys_snapshot();
        if ($after === null) return [];
        global $wpdb;
        $restored = [];
        foreach (self::SITE_KEY_OPTIONS as $name) {
            $was = $before['options'][$name] ?? null;
            $now = $after['options'][$name] ?? null;
            if ($was === null && $now === null) continue;
            if ($was !== null && $now !== null && $was['value'] === $now['value']) continue;
            if ($was === null) {
                $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name = %s", $name));
            } else {
                $wpdb->query($wpdb->prepare(
                    "INSERT INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, %s)
                     ON DUPLICATE KEY UPDATE option_value = VALUES(option_value), autoload = VALUES(autoload)",
                    $name, $was['value'], $was['autoload']
                ));
            }
            $restored[] = $name;
        }
        if (is_array($before['meta'] ?? null) && is_array($after['meta'] ?? null)) {
            foreach (self::SITE_KEY_OPTIONS as $name) {
                $was = $before['meta'][$name] ?? null;
                $now = $after['meta'][$name] ?? null;
                if ($was === $now) continue;
                if ($was === null) self::delete_site_meta($name);
                else self::write_site_meta($name, $was);
                if (!in_array($name, $restored, true)) $restored[] = $name;
            }
        }
        if ($restored && function_exists('wp_cache_delete')) {
            wp_cache_delete('alloptions', 'options');
            wp_cache_delete('notoptions', 'options');
            foreach ($restored as $name) wp_cache_delete($name, 'options');
        }
        return $restored;
    }

    /**
     * The store currency as the database holds it, read before a command
     * that could write any option (WP-CLI, an ability, a SQL write, a REST
     * route): the raw rows of woocommerce_currency and its decimals. A
     * command no word check catches (`wp search-replace USD EUR wp_options`)
     * still cannot change it: store_currency_restore puts it back and the
     * call fails with STORE_CURRENCY_REFUSAL. null when it cannot be read.
     */
    public static function store_currency_snapshot(): ?array {
        global $wpdb;
        if (!is_object($wpdb) || !method_exists($wpdb, 'get_results') || !method_exists($wpdb, 'prepare')) return null;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT option_name, option_value, autoload FROM {$wpdb->options} WHERE option_name IN (%s, %s)",
            self::STORE_CURRENCY_OPTION,
            self::STORE_DECIMALS_OPTION
        ), ARRAY_A);
        if (!is_array($rows)) return null;
        $out = [self::STORE_CURRENCY_OPTION => null, self::STORE_DECIMALS_OPTION => null];
        foreach ($rows as $r) {
            $name = strtolower((string) $r['option_name']);
            if (array_key_exists($name, $out)) {
                $out[$name] = ['value' => (string) $r['option_value'], 'autoload' => (string) $r['autoload']];
            }
        }
        return $out;
    }

    /**
     * Put the store currency back when the command changed it (its decimals
     * with it). True when it had changed: the caller fails the call with
     * STORE_CURRENCY_REFUSAL. The decimals alone are the owner's display
     * setting and stay as the command left them.
     */
    public static function store_currency_restore(?array $before): bool {
        if ($before === null) return false;
        $after = self::store_currency_snapshot();
        if ($after === null) return false;
        $was = $before[self::STORE_CURRENCY_OPTION];
        $now = $after[self::STORE_CURRENCY_OPTION];
        if (($was['value'] ?? null) === ($now['value'] ?? null)) return false;
        global $wpdb;
        foreach ([self::STORE_CURRENCY_OPTION, self::STORE_DECIMALS_OPTION] as $name) {
            $row = $before[$name];
            if ($row === null) {
                $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name = %s", $name));
            } elseif (($after[$name]['value'] ?? null) !== $row['value']) {
                $wpdb->query($wpdb->prepare(
                    "INSERT INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, %s)
                     ON DUPLICATE KEY UPDATE option_value = VALUES(option_value), autoload = VALUES(autoload)",
                    $name, $row['value'], $row['autoload']
                ));
            }
            if (function_exists('wp_cache_delete')) wp_cache_delete($name, 'options');
        }
        if (function_exists('wp_cache_delete')) {
            wp_cache_delete('alloptions', 'options');
            wp_cache_delete('notoptions', 'options');
        }
        return true;
    }

    /**
     * SITE_IDENTITY_OPTIONS as the database holds them (raw rows, not the
     * object cache a WP-CLI child never touched), read before a command runs.
     * null when they cannot be read.
     */
    public static function site_identity_snapshot(): ?array {
        global $wpdb;
        if (!is_object($wpdb) || !method_exists($wpdb, 'get_results') || !method_exists($wpdb, 'prepare')) return null;
        $names = self::SITE_IDENTITY_OPTIONS;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT option_name, option_value, autoload FROM {$wpdb->options} WHERE option_name IN (" . implode(', ', array_fill(0, count($names), '%s')) . ')',
            ...$names
        ), ARRAY_A);
        if (!is_array($rows)) return null;
        $out = array_fill_keys($names, null);
        foreach ($rows as $r) {
            $name = strtolower((string) $r['option_name']);
            if (array_key_exists($name, $out)) {
                $out[$name] = ['value' => (string) $r['option_value'], 'autoload' => (string) $r['autoload']];
            }
        }
        return $out;
    }

    /**
     * Puts back every SITE_IDENTITY_OPTIONS row the command changed, added or
     * removed. Returns their names: the caller fails the call with
     * CORE_OPTION_REFUSAL. [] when nothing changed or they cannot be read.
     */
    public static function site_identity_restore(?array $before): array {
        if ($before === null) return [];
        $after = self::site_identity_snapshot();
        if ($after === null) return [];
        global $wpdb;
        $changed = [];
        foreach (self::SITE_IDENTITY_OPTIONS as $name) {
            $was = $before[$name] ?? null;
            $now = $after[$name] ?? null;
            if (($was === null) === ($now === null) && ($was['value'] ?? null) === ($now['value'] ?? null)) continue;
            if ($was === null) {
                $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name = %s", $name));
            } else {
                $wpdb->query($wpdb->prepare(
                    "INSERT INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, %s)
                     ON DUPLICATE KEY UPDATE option_value = VALUES(option_value), autoload = VALUES(autoload)",
                    $name, $was['value'], $was['autoload']
                ));
            }
            if (function_exists('wp_cache_delete')) wp_cache_delete($name, 'options');
            $changed[] = $name;
        }
        if ($changed && function_exists('wp_cache_delete')) {
            wp_cache_delete('alloptions', 'options');
            wp_cache_delete('notoptions', 'options');
        }
        return $changed;
    }

    /**
     * Whether an option row is a transient (or a transient's timeout row)
     * whose timeout, as carried in the same snapshot, had already passed.
     */
    private static function expired_transient_row(string $name, array $rows): bool {
        if (!preg_match('/^(_(?:site_)?transient_)(?:timeout_)?(.+)$/', $name, $m)) return false;
        $timeout_row = $rows[$m[1] . 'timeout_' . $m[2]] ?? null;
        if ($timeout_row === null) return false;
        $timeout = (int) $timeout_row['value'];
        return $timeout > 0 && $timeout < time();
    }
}
