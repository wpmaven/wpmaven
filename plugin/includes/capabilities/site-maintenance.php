<?php
/**
 * Owner-approved maintenance (1.2.6). Every action here changes the site, and
 * the API sends each one only after the site owner said yes to it.
 *
 *   database_cleanup   deletes old revisions (keeping the newest few per
 *                      post), week-old auto-drafts, trashed posts (never
 *                      WooCommerce orders), spam and trashed comments, and
 *                      expired transients, through WordPress's own delete
 *                      functions, and returns the counts.
 *   apply_updates      plugin, theme or core updates through WordPress's
 *                      upgraders. Never the WPMaven plugin (it updates itself),
 *                      and never WordPress core on a WPMaven-hosted site, where
 *                      core comes with the hosting image and an update made in
 *                      place would be undone when the site's container is
 *                      recreated.
 *   hardening_apply    turns the wp-admin file editor off and keeps debug
 *                      output off visitors' pages, as plugin rules WPMaven
 *                      applies on each request (an option, never
 *                      wp-config.php). WPMaven Agent also writes them as a
 *                      must-use file. Reversible: pass false to turn a
 *                      setting back off.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['database_cleanup'] = ['WebMaven_Cap_Maintenance', 'database_cleanup'];
    $handlers['apply_updates'] = ['WebMaven_Cap_Maintenance', 'apply_updates'];
    $handlers['hardening_apply'] = ['WebMaven_Cap_Maintenance', 'hardening_apply'];
    return $handlers;
});

class WebMaven_Cap_Maintenance {

    const CLEANUP_ITEMS = ['revisions', 'auto_drafts', 'trashed_posts', 'spam_comments', 'trashed_comments', 'expired_transients'];

    /** Auto-drafts younger than this may be an editor still open (WordPress core uses the same week). */
    const AUTO_DRAFT_MIN_AGE_DAYS = 7;

    /** Seconds one cleanup call works before it stops and reports what is left. */
    const CLEANUP_TIME_BUDGET = 20;

    /** Items one apply_updates call updates; the rest are reported as remaining. */
    const MAX_UPDATES_PER_CALL = 20;

    /**
     * Seconds after which apply_updates starts no new item. Hosted sites
     * answer through Cloudflare, which drops a request after 100 seconds; an
     * item already started always finishes (ignore_user_abort).
     */
    const UPDATE_TIME_BUDGET = 60;

    /** When this apply_updates call began (the time budget runs from here). */
    private static $started = 0.0;

    /** True once the budget is spent; the first item of a call always runs. */
    private static function over_budget($done) {
        $budget = function_exists('apply_filters') ? (int) apply_filters('webmaven_update_time_budget', self::UPDATE_TIME_BUDGET) : self::UPDATE_TIME_BUDGET;
        return $done > 0 && self::$started > 0 && microtime(true) - self::$started > $budget;
    }

    const HARDENING_SETTINGS = ['disable_file_editor', 'hide_debug_output'];

    private static function to_bool($value) {
        if (is_bool($value)) {
            return $value;
        }
        if (is_string($value)) {
            return in_array(strtolower(trim($value)), ['1', 'true', 'yes', 'on'], true);
        }
        return (bool) $value;
    }

    // ── database_cleanup ────────────────────────────────────────────────

    public static function database_cleanup($params = [], $step_id = null) {
        global $wpdb;

        $items = self::CLEANUP_ITEMS;
        if (isset($params['items']) && is_array($params['items']) && $params['items']) {
            $asked = array_map('strval', $params['items']);
            $unknown = array_values(array_diff($asked, self::CLEANUP_ITEMS));
            if ($unknown) {
                return ['success' => false, 'error' => 'Unknown cleanup item(s): ' . implode(', ', $unknown) . '. Allowed: ' . implode(', ', self::CLEANUP_ITEMS)];
            }
            $items = array_values(array_intersect(self::CLEANUP_ITEMS, $asked));
        }
        $keep = isset($params['keep_revisions']) ? (int) $params['keep_revisions'] : 3;
        $keep = max(0, min(50, $keep));
        $limit = isset($params['limit']) ? (int) $params['limit'] : 1000;
        $limit = max(1, min(5000, $limit));

        if (function_exists('set_time_limit')) {
            @set_time_limit(120);
        }
        // A dropped connection must not stop a delete halfway.
        @ignore_user_abort(true);
        $deadline = microtime(true) + self::CLEANUP_TIME_BUDGET;
        $out_of_time = function () use ($deadline) {
            return microtime(true) > $deadline;
        };

        $deleted = array_fill_keys($items, 0);
        $failed = 0;
        $skipped = [];
        $stopped = false;
        $order_types = WebMaven_Cap_Diagnostics::ORDER_POST_TYPES;
        // One %s per order post type.
        $orders = implode(', ', array_fill(0, count($order_types), '%s'));

        foreach ($items as $item) {
            if ($out_of_time()) {
                $stopped = true;
                break;
            }
            switch ($item) {
                case 'revisions':
                    // Newest first per post, so the first $keep of each are kept.
                    $rows = (array) $wpdb->get_results(
                        "SELECT ID, post_parent FROM {$wpdb->posts} WHERE post_type = 'revision' ORDER BY post_parent ASC, post_date DESC, ID DESC",
                        ARRAY_A
                    );
                    $seen = [];
                    $kept = 0;
                    foreach ($rows as $row) {
                        $parent = (int) $row['post_parent'];
                        $seen[$parent] = ($seen[$parent] ?? 0) + 1;
                        if ($seen[$parent] <= $keep) {
                            $kept++;
                            continue;
                        }
                        if ($deleted['revisions'] >= $limit || $out_of_time()) {
                            $stopped = true;
                            break;
                        }
                        $res = wp_delete_post_revision((int) $row['ID']);
                        if ($res && !is_wp_error($res)) {
                            $deleted['revisions']++;
                        } else {
                            $failed++;
                        }
                    }
                    $skipped['kept_revisions'] = $kept;
                    break;

                case 'auto_drafts':
                    $ids = (array) $wpdb->get_col($wpdb->prepare(
                        "SELECT ID FROM {$wpdb->posts} WHERE post_status = 'auto-draft' AND DATE_SUB(NOW(), INTERVAL %d DAY) > post_date LIMIT %d",
                        self::AUTO_DRAFT_MIN_AGE_DAYS,
                        $limit
                    ));
                    $all = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_status = 'auto-draft'");
                    $skipped['recent_auto_drafts'] = max(0, $all - count($ids));
                    self::delete_each($ids, function ($id) {
                        return wp_delete_post($id, true);
                    }, $deleted['auto_drafts'], $failed, $stopped, $out_of_time);
                    break;

                case 'trashed_posts':
                    $ids = (array) $wpdb->get_col($wpdb->prepare(
                        "SELECT ID FROM %i WHERE post_status = 'trash' AND post_type NOT IN ($orders) LIMIT %d", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
                        array_merge([$wpdb->posts], $order_types, [$limit])
                    ));
                    $skipped['trashed_orders'] = (int) $wpdb->get_var($wpdb->prepare(
                        "SELECT COUNT(*) FROM %i WHERE post_status = 'trash' AND post_type IN ($orders)", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
                        array_merge([$wpdb->posts], $order_types)
                    ));
                    self::delete_each($ids, function ($id) {
                        return wp_delete_post($id, true);
                    }, $deleted['trashed_posts'], $failed, $stopped, $out_of_time);
                    break;

                case 'spam_comments':
                case 'trashed_comments':
                    $status = $item === 'spam_comments' ? 'spam' : 'trash';
                    $ids = (array) $wpdb->get_col($wpdb->prepare(
                        "SELECT comment_ID FROM {$wpdb->comments} WHERE comment_approved = %s LIMIT %d",
                        $status,
                        $limit
                    ));
                    self::delete_each($ids, function ($id) {
                        return wp_delete_comment($id, true);
                    }, $deleted[$item], $failed, $stopped, $out_of_time);
                    break;

                case 'expired_transients':
                    $before = WebMaven_Cap_Diagnostics::clutter_counts()['expired_transients'];
                    delete_expired_transients(true);
                    $after = WebMaven_Cap_Diagnostics::clutter_counts()['expired_transients'];
                    $deleted['expired_transients'] = max(0, $before - $after);
                    break;
            }
        }

        $remaining = array_intersect_key(WebMaven_Cap_Diagnostics::clutter_counts(), array_flip($items));
        return [
            'deleted' => $deleted,
            'deleted_total' => array_sum($deleted),
            'remaining' => $remaining,
            'skipped' => $skipped,
            'failed' => $failed,
            'keep_revisions' => $keep,
            'limit' => $limit,
            'stopped_early' => $stopped,
        ];
    }

    private static function delete_each(array $ids, callable $delete, &$count, &$failed, &$stopped, callable $out_of_time) {
        foreach ($ids as $id) {
            if ($out_of_time()) {
                $stopped = true;
                return;
            }
            $res = $delete((int) $id);
            if ($res && !is_wp_error($res)) {
                $count++;
            } else {
                $failed++;
            }
        }
    }

    // ── apply_updates ───────────────────────────────────────────────────

    public static function apply_updates($params = [], $step_id = null) {
        $type = (string) ($params['type'] ?? '');
        if (!in_array($type, ['plugins', 'themes', 'core'], true)) {
            return ['success' => false, 'error' => 'type must be plugins, themes or core'];
        }
        if ($type === 'core' && WebMaven_Cap_Diagnostics::is_hosted()) {
            return [
                'success' => false,
                'code' => 'hosted_core',
                'error' => 'WordPress itself comes with the WPMaven hosting image on this site. An update made here would be undone '
                    . 'the next time the site\'s container is recreated, so nothing was changed. WPMaven updates WordPress on '
                    . 'hosted sites by rebuilding that image.',
            ];
        }

        foreach (['file.php', 'misc.php', 'plugin.php', 'theme.php', 'update.php', 'class-wp-upgrader.php'] as $inc) {
            require_once ABSPATH . 'wp-admin/includes/' . $inc;
        }
        $cap = ['plugins' => 'update_plugins', 'themes' => 'update_themes', 'core' => 'update_core'][$type];
        if (!current_user_can($cap)) {
            $why = defined('DISALLOW_FILE_MODS') && DISALLOW_FILE_MODS
                ? 'File changes are turned off on this site (DISALLOW_FILE_MODS in wp-config.php), so WordPress cannot install updates'
                : 'The administrator account WPMaven acts as is not allowed to run updates on this site';
            return ['success' => false, 'code' => 'not_allowed', 'error' => $why];
        }
        if (!WP_Filesystem()) {
            return [
                'success' => false,
                'code' => 'no_filesystem',
                'error' => 'WordPress cannot write its own files directly on this server (it would ask for FTP details), so updates cannot run from WPMaven',
            ];
        }
        if (function_exists('set_time_limit')) {
            @set_time_limit(600);
        }
        // A dropped connection must never leave a plugin half replaced.
        @ignore_user_abort(true);
        if (function_exists('wp_raise_memory_limit')) {
            wp_raise_memory_limit('admin');
        }
        self::$started = microtime(true);
        $refresh = !array_key_exists('refresh', $params) || self::to_bool($params['refresh']);
        $items = isset($params['items']) && is_array($params['items']) ? array_values(array_filter(array_map('strval', $params['items']))) : [];

        if ($type === 'plugins') {
            return self::update_plugins($items, $refresh);
        }
        if ($type === 'themes') {
            return self::update_themes($items, $refresh);
        }
        return self::update_core($refresh);
    }

    /** Make WordPress ask WordPress.org again instead of trusting a check up to 12 hours old. */
    private static function force_recheck($transient) {
        $current = get_site_transient($transient);
        if (is_object($current)) {
            $current->last_checked = 0;
            set_site_transient($transient, $current);
        }
    }

    /** The message a WP_Ajax_Upgrader_Skin collected, or the result's own error. */
    private static function upgrade_error($skin, $result, $key) {
        if (is_wp_error($skin->result)) {
            return $skin->result->get_error_message();
        }
        if ($skin->get_errors()->has_errors()) {
            return (string) $skin->get_error_messages();
        }
        if (is_wp_error($result)) {
            return $result->get_error_message();
        }
        if ($result === false) {
            return 'WordPress could not reach its files to update them';
        }
        if (is_array($result) && (!isset($result[$key]) || $result[$key] === false || $result[$key] === null)) {
            return 'WordPress reported that the update did not complete';
        }
        if (is_array($result) && is_wp_error($result[$key])) {
            return $result[$key]->get_error_message();
        }
        return null;
    }

    private static function update_plugins(array $items, $refresh) {
        if ($refresh) {
            self::force_recheck('update_plugins');
            wp_update_plugins();
        }
        $available = get_site_transient('update_plugins');
        $available = is_object($available) && !empty($available->response) ? (array) $available->response : [];
        $installed = get_plugins();

        $targets = [];
        $results = [];
        if ($items) {
            foreach ($items as $item) {
                $file = self::resolve_plugin($installed, $item);
                if ($file === null) {
                    $results[] = ['item' => $item, 'ok' => false, 'status' => 'not_installed', 'error' => 'No installed plugin matches this name'];
                    continue;
                }
                $targets[$file] = true;
            }
        } else {
            foreach (array_keys($available) as $file) {
                $targets[$file] = true;
            }
        }

        $remaining = [];
        $done = 0;
        foreach (array_keys($targets) as $file) {
            $name = (string) ($installed[$file]['Name'] ?? $file);
            if (WebMaven_Cap_Diagnostics::is_own_plugin($file)) {
                $results[] = ['item' => $file, 'name' => $name, 'ok' => false, 'status' => 'refused', 'error' => 'The WPMaven plugin updates itself; it is never updated from here'];
                continue;
            }
            if (!isset($available[$file])) {
                $results[] = ['item' => $file, 'name' => $name, 'ok' => true, 'status' => 'up_to_date', 'from' => (string) ($installed[$file]['Version'] ?? '')];
                continue;
            }
            $u = is_object($available[$file]) ? get_object_vars($available[$file]) : (array) $available[$file];
            $from = (string) ($installed[$file]['Version'] ?? '');
            $target = (string) ($u['new_version'] ?? '');
            $blocker = self::requirement_blocker((string) ($u['requires'] ?? ''), (string) ($u['requires_php'] ?? ''));
            if ($blocker !== null) {
                $results[] = ['item' => $file, 'name' => $name, 'ok' => false, 'status' => 'incompatible', 'from' => $from, 'target' => $target, 'error' => $blocker];
                continue;
            }
            if ($done >= self::MAX_UPDATES_PER_CALL || self::over_budget($done)) {
                $remaining[] = $file;
                continue;
            }
            $done++;
            $skin = new WP_Ajax_Upgrader_Skin();
            $upgrader = new Plugin_Upgrader($skin);
            // Keep WordPress's update list for the next item: the upgrader
            // looks each package up there, and drops the list when told to.
            $result = $upgrader->bulk_upgrade([$file], ['clear_update_cache' => false]);
            $error = self::upgrade_error($skin, $result, $file);
            wp_cache_delete('plugins', 'plugins');
            $now = get_plugins();
            $to = (string) ($now[$file]['Version'] ?? '');
            if ($error === null && $to !== '' && $from !== '' && version_compare($to, $from, '<=')) {
                $error = "The plugin still reports version {$to} after the update";
            }
            $results[] = $error === null
                ? ['item' => $file, 'name' => $name, 'ok' => true, 'status' => 'updated', 'from' => $from, 'to' => $to, 'target' => $target]
                : ['item' => $file, 'name' => $name, 'ok' => false, 'status' => 'failed', 'from' => $from, 'to' => $to, 'target' => $target, 'error' => $error];
        }

        // The list still names what was just updated: ask WordPress.org again
        // so the next read says what is really pending.
        if ($done > 0) {
            self::force_recheck('update_plugins');
            wp_update_plugins();
        }
        return self::summarize('plugins', $results, $remaining);
    }

    private static function resolve_plugin(array $installed, $item) {
        if (isset($installed[$item])) {
            return $item;
        }
        $needle = strtolower(preg_replace('/\.php$/i', '', $item));
        foreach (array_keys($installed) as $file) {
            $folder = strtolower(strtok($file, '/'));
            if ($folder === $needle || strtolower(preg_replace('/\.php$/i', '', $file)) === $needle) {
                return $file;
            }
        }
        foreach ($installed as $file => $data) {
            if (strtolower((string) ($data['Name'] ?? '')) === strtolower($item)) {
                return $file;
            }
        }
        return null;
    }

    private static function update_themes(array $items, $refresh) {
        if ($refresh) {
            self::force_recheck('update_themes');
            wp_update_themes();
        }
        $available = get_site_transient('update_themes');
        $available = is_object($available) && !empty($available->response) ? (array) $available->response : [];

        $targets = $items ?: array_keys($available);
        $results = [];
        $remaining = [];
        $done = 0;
        foreach ($targets as $stylesheet) {
            $stylesheet = (string) $stylesheet;
            $theme = wp_get_theme($stylesheet);
            if (!$theme->exists()) {
                $results[] = ['item' => $stylesheet, 'ok' => false, 'status' => 'not_installed', 'error' => 'No installed theme has this folder name'];
                continue;
            }
            $name = (string) $theme->get('Name');
            $from = (string) $theme->get('Version');
            if (!isset($available[$stylesheet])) {
                $results[] = ['item' => $stylesheet, 'name' => $name, 'ok' => true, 'status' => 'up_to_date', 'from' => $from];
                continue;
            }
            $u = (array) $available[$stylesheet];
            $target = (string) ($u['new_version'] ?? '');
            $blocker = self::requirement_blocker((string) ($u['requires'] ?? ''), (string) ($u['requires_php'] ?? ''));
            if ($blocker !== null) {
                $results[] = ['item' => $stylesheet, 'name' => $name, 'ok' => false, 'status' => 'incompatible', 'from' => $from, 'target' => $target, 'error' => $blocker];
                continue;
            }
            if ($done >= self::MAX_UPDATES_PER_CALL || self::over_budget($done)) {
                $remaining[] = $stylesheet;
                continue;
            }
            $done++;
            $skin = new WP_Ajax_Upgrader_Skin();
            $upgrader = new Theme_Upgrader($skin);
            $result = $upgrader->bulk_upgrade([$stylesheet], ['clear_update_cache' => false]);
            $error = self::upgrade_error($skin, $result, $stylesheet);
            if (function_exists('wp_clean_themes_cache')) {
                wp_clean_themes_cache(false);
            }
            $to = (string) wp_get_theme($stylesheet)->get('Version');
            if ($error === null && $to !== '' && $from !== '' && version_compare($to, $from, '<=')) {
                $error = "The theme still reports version {$to} after the update";
            }
            $results[] = $error === null
                ? ['item' => $stylesheet, 'name' => $name, 'ok' => true, 'status' => 'updated', 'from' => $from, 'to' => $to, 'target' => $target]
                : ['item' => $stylesheet, 'name' => $name, 'ok' => false, 'status' => 'failed', 'from' => $from, 'to' => $to, 'target' => $target, 'error' => $error];
        }
        if ($done > 0) {
            self::force_recheck('update_themes');
            wp_update_themes();
        }
        return self::summarize('themes', $results, $remaining);
    }

    private static function update_core($refresh) {
        if ($refresh) {
            wp_version_check([], true);
        }
        $from = (string) get_bloginfo('version');
        $offer = null;
        foreach ((array) get_core_updates() as $candidate) {
            if (is_object($candidate) && ($candidate->response ?? '') === 'upgrade') {
                $offer = $candidate;
                break;
            }
        }
        if ($offer === null) {
            return self::summarize('core', [['item' => 'wordpress', 'name' => 'WordPress', 'ok' => true, 'status' => 'up_to_date', 'from' => $from]], []);
        }
        $target = (string) ($offer->version ?? $offer->current ?? '');
        $blocker = self::requirement_blocker('', (string) ($offer->php_version ?? ''));
        if ($blocker !== null) {
            return self::summarize('core', [['item' => 'wordpress', 'name' => 'WordPress', 'ok' => false, 'status' => 'incompatible', 'from' => $from, 'target' => $target, 'error' => $blocker]], []);
        }
        $skin = new WP_Ajax_Upgrader_Skin();
        $upgrader = new Core_Upgrader($skin);
        $result = $upgrader->upgrade($offer);
        $error = null;
        if (is_wp_error($result)) {
            $error = $result->get_error_code() === 'up_to_date' ? null : $result->get_error_message();
        } elseif (!$result) {
            $error = self::upgrade_error($skin, null, 'wordpress') ?? 'WordPress reported that the update did not complete';
        }
        // The running request still has the old $wp_version in memory; the
        // file on disk says what is installed now.
        $to = $from;
        $version_file = @file_get_contents(ABSPATH . WPINC . '/version.php');
        if (is_string($version_file) && preg_match('/\$wp_version\s*=\s*[\'"]([^\'"]+)[\'"]/', $version_file, $m)) {
            $to = $m[1];
        }
        return self::summarize('core', [
            $error === null
                ? ['item' => 'wordpress', 'name' => 'WordPress', 'ok' => true, 'status' => 'updated', 'from' => $from, 'to' => $to, 'target' => $target]
                : ['item' => 'wordpress', 'name' => 'WordPress', 'ok' => false, 'status' => 'failed', 'from' => $from, 'to' => $to, 'target' => $target, 'error' => $error],
        ], []);
    }

    private static function requirement_blocker($requires_wp, $requires_php) {
        if ($requires_php !== '' && version_compare(PHP_VERSION, $requires_php, '<')) {
            return "Needs PHP {$requires_php}; this server runs PHP " . PHP_VERSION;
        }
        $wp = (string) get_bloginfo('version');
        if ($requires_wp !== '' && version_compare($wp, $requires_wp, '<')) {
            return "Needs WordPress {$requires_wp}; this site runs WordPress {$wp}";
        }
        return null;
    }

    private static function summarize($type, array $results, array $remaining) {
        $count = function ($status) use ($results) {
            return count(array_filter($results, function ($r) use ($status) {
                return $r['status'] === $status;
            }));
        };
        return [
            'type' => $type,
            'results' => $results,
            'updated' => $count('updated'),
            'failed' => count(array_filter($results, function ($r) {
                return !$r['ok'] && $r['status'] !== 'refused';
            })),
            'up_to_date' => $count('up_to_date'),
            'refused' => $count('refused'),
            'remaining' => $remaining,
        ];
    }

    // ── hardening_apply ─────────────────────────────────────────────────

    /** The settings the owner approved, applied on each request (apply_hardening_rules). */
    const HARDENING_OPTION = 'webmaven_hardening_rules';

    /** The two settings, on or off. */
    public static function hardening_rules() {
        $saved = function_exists('get_option') ? get_option(self::HARDENING_OPTION, []) : [];
        $settings = [];
        foreach (self::HARDENING_SETTINGS as $key) {
            $settings[$key] = is_array($saved) && !empty($saved[$key]);
        }
        return $settings;
    }

    /**
     * At load, for this request: the file editor off (a value wp-config.php
     * set wins), PHP errors off the page (they still reach the error log).
     */
    public static function apply_hardening_rules() {
        $settings = self::hardening_rules();
        if ($settings['disable_file_editor'] && !defined('DISALLOW_FILE_EDIT')) {
            define('DISALLOW_FILE_EDIT', true);
        }
        if ($settings['hide_debug_output']) {
            @ini_set('display_errors', '0');
        }
    }

    /** What is in effect (WPMaven Agent adds its must-use file through webmaven_hardening_state). */
    public static function hardening_state() {
        $settings = self::hardening_rules();
        $state = ['installed' => in_array(true, $settings, true), 'ours' => true, 'settings' => $settings, 'file' => null];
        return function_exists('apply_filters') ? apply_filters('webmaven_hardening_state', $state) : $state;
    }

    public static function hardening_apply($params = [], $step_id = null) {
        $wanted = [];
        foreach (self::HARDENING_SETTINGS as $key) {
            if (array_key_exists($key, $params) && $params[$key] !== null && $params[$key] !== '') {
                $wanted[$key] = self::to_bool($params[$key]);
            }
        }
        if (!$wanted) {
            return ['success' => false, 'error' => 'Say what to change: disable_file_editor and/or hide_debug_output (true turns a setting on, false turns it off)'];
        }
        $previous = self::hardening_rules();
        $settings = array_merge($previous, $wanted);
        if ($settings !== $previous) {
            update_option(self::HARDENING_OPTION, $settings, true);
        }

        // A value wp-config.php (or the hosting platform) already set wins
        // over these rules; say so rather than report a change that cannot happen.
        $notes = [];
        if (!empty($settings['disable_file_editor']) && defined('DISALLOW_FILE_EDIT') && !DISALLOW_FILE_EDIT) {
            $notes[] = 'wp-config.php sets DISALLOW_FILE_EDIT to false, and that wins: the file editor stays on until that line is removed.';
        }

        return [
            'settings' => $settings,
            'previous' => $previous,
            'file' => null,
            'written' => false,
            'removed' => false,
            // The rules apply when the plugin loads, at the start of each request.
            'takes_effect' => 'next_request',
            'notes' => $notes,
        ];
    }
}

// The owner's hardening settings, for this request.
if (function_exists('get_option')) {
    WebMaven_Cap_Maintenance::apply_hardening_rules();
}
