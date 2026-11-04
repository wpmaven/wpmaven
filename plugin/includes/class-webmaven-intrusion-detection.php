<?php
/**
 * Signs of intrusion on this site, reported to WPMaven, so what the security
 * page promises is true. The API
 * turns each report into a staff alert.
 *
 * What is looked for (event types):
 *   - core_file_modified / core_file_missing: every WordPress core file
 *     against the official checksums for the installed version and package
 *     locale (api.wordpress.org/core/checksums/1.0/, the check `wp core
 *     verify-checksums` makes). wp-content and wp-config.php are skipped, and
 *     a removed readme.html, license.txt or wp-config-sample.php is hardening,
 *     not a sign (BENIGN_MISSING). A pass the time budget cuts short goes on
 *     from where it stopped.
 *   - unexpected_php_in_uploads: files under the uploads folder named like
 *     PHP (PHP_NAME: .php, .php3 to .php8, .phtml, .phar, .pht, and x.php.jpg),
 *     within a time and an entry budget, symlinked folders not followed. An
 *     index.php holding only `<?php` and comments (the "silence is golden"
 *     file plugins drop) runs nothing and is not one.
 *   - admin_user_created: a user created as or promoted to administrator, or
 *     granted network super admin. Seen as it happens (decided at the end of
 *     the request, once whoever made the account has marked it) and by a
 *     daily compare with the administrators known before, which also sees a
 *     change written straight to the database. The accounts WPMaven's
 *     one-click sign-in makes (the owner's and the staff's, marked with
 *     WebMaven_Actor::MARKER_META) are never reported; one made by
 *     a WPMaven command is, with via "wpmaven".
 *   - login_failure_burst: LOGIN_THRESHOLD failed logins within LOGIN_WINDOW.
 *
 * What is sent (POST /plugin/security-report with the site token, like the
 * plugin's other reports, and the instance id): paths, hashes, sizes, counts,
 * ids and times. Never a file's contents, a password, a user name or e-mail,
 * or a visitor's IP (sources are counted through a keyed hash that never
 * leaves the site). Each finding at most once per REPORT_EVERY (by its key);
 * the events wait in a bounded queue until the API takes them.
 *
 *   core_file_modified        { version, locale, count, files: [{ path, md5, expectedMd5 }], truncated, partial }
 *   core_file_missing         { version, locale, count, files: [{ path }], truncated, partial }
 *   unexpected_php_in_uploads { count, files: [{ path, size, sha256, modifiedAt }], truncated, scanned, complete }
 *   admin_user_created        { userId, change, via, detectedBy, loginHash, registeredAt, actorUserId }
 *   login_failure_burst       { count, windowMinutes, sources, usernames }
 *
 * When: daily (its own WP-Cron event on WordPress's daily schedule), once a
 * minute after every plugin update or first install, and a flush shortly
 * after a finding seen live; the 15-minute alert check retries whatever is
 * still queued. Never on a page load: the hooks only note, the work runs in
 * WP-Cron within a time budget, and every entry point swallows its own
 * errors, so a failed check never breaks a request or a cron run.
 *
 * Every option and transient here is WPMaven's own bookkeeping, written while
 * commands may be running: WebMaven_Self_Protect::VOLATILE_OPTIONS leaves
 * them out of its before/after check, which would otherwise put a write back
 * and fail the command.
 */

if (!defined('ABSPATH')) {
    exit;
}

class WebMaven_Intrusion_Detection {

    const SCAN_HOOK = 'webmaven_security_scan';
    const FLUSH_HOOK = 'webmaven_security_report_flush';
    const ENDPOINT = '/plugin/security-report';

    const VERSION_OPTION = 'webmaven_sec_scanned_version';
    const QUEUE_OPTION = 'webmaven_sec_report_queue';
    const REPORTED_OPTION = 'webmaven_sec_reported';
    const ADMINS_OPTION = 'webmaven_sec_known_admins';
    const CORE_STATE_OPTION = 'webmaven_sec_core_state';
    const UPLOADS_STATE_OPTION = 'webmaven_sec_uploads_state';
    const CHECKSUMS_TRANSIENT = 'webmaven_sec_core_checksums';
    const LOGIN_TRANSIENT = 'webmaven_sec_login_failures';

    /** A finding is reported at most once in this many seconds. */
    const REPORT_EVERY = 86400;

    const LOGIN_THRESHOLD = 20;
    const LOGIN_WINDOW = 600;

    /** Seconds for a whole scan, and the part of it the uploads walk may take. */
    const SCAN_BUDGET = 20.0;
    const UPLOADS_BUDGET = 8.0;
    /** Files (symlinked folders included, never followed) the uploads walk reads at most. */
    const UPLOADS_MAX_ENTRIES = 200000;
    /** A complete uploads walk is not repeated within this many seconds. */
    const UPLOADS_EVERY = 72000;

    const FILES_PER_EVENT = 50;
    const QUEUE_MAX = 100;
    const SEND_BATCH = 50;
    const REPORTED_MAX = 5000;
    const HASH_MAX_BYTES = 10485760;
    const STUB_MAX_BYTES = 512;

    /** Core files whose removal is hardening, not a sign of intrusion. */
    const BENIGN_MISSING = ['readme.html', 'license.txt', 'wp-config-sample.php'];

    /** A file name a web server may run as PHP. */
    const PHP_NAME = '/\.(?:php[0-9]?|pht|phtml?|phar)(?:\.[a-z0-9]{1,8})?$/i';

    /** Administrators noted in this request: user id => created | promoted | super_admin. */
    private static $admin_candidates = [];
    private static $shutdown_hooked = false;

    public static function init() {
        add_action('init', [__CLASS__, 'schedule']);
        add_action(self::SCAN_HOOK, [__CLASS__, 'run_scan']);
        add_action(self::FLUSH_HOOK, [__CLASS__, 'flush']);
        // The alert check runs every 15 minutes: it retries what is still queued.
        add_action('webmaven_alert_check', [__CLASS__, 'flush']);

        add_action('set_user_role', [__CLASS__, 'on_set_user_role'], 10, 3);
        add_action('add_user_role', [__CLASS__, 'on_add_user_role'], 10, 2);
        add_action('user_register', [__CLASS__, 'on_user_register'], 10, 1);
        add_action('granted_super_admin', [__CLASS__, 'on_granted_super_admin'], 10, 1);
        add_action('wp_login_failed', [__CLASS__, 'on_login_failed'], 10, 1);

        register_deactivation_hook(WEBMAVEN_WP_FILE, [__CLASS__, 'on_deactivate']);
    }

    /**
     * On init: the daily scan is scheduled, and once after every plugin update
     * (and the first install) a scan is queued a minute out. A page load reads
     * one autoloaded option and the cron array.
     */
    public static function schedule() {
        try {
            if (!wp_next_scheduled(self::SCAN_HOOK)) {
                wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', self::SCAN_HOOK);
            }
            if (get_option(self::VERSION_OPTION) !== WEBMAVEN_WP_VERSION) {
                update_option(self::VERSION_OPTION, WEBMAVEN_WP_VERSION, true);
                wp_schedule_single_event(time() + 60, self::SCAN_HOOK);
            }
        } catch (\Throwable $e) {
            // The next page load tries again.
        }
    }

    public static function on_deactivate() {
        wp_clear_scheduled_hook(self::SCAN_HOOK);
        wp_clear_scheduled_hook(self::FLUSH_HOOK);
    }

    // ── The scan (WP-Cron) ─────────────────────────────────────────────────

    /**
     * The daily scan: administrators, core files, uploads, then the queue goes
     * out. A core pass the budget cut short continues five minutes later.
     */
    public static function run_scan() {
        try {
            if (!self::connected()) return;
            $now = time();
            $deadline = self::deadline(self::SCAN_BUDGET);
            self::check_admins($now);
            $more = self::check_core_files(min($deadline, microtime(true) + self::SCAN_BUDGET - self::UPLOADS_BUDGET), $now);
            self::check_uploads($deadline, $now);
            if ($more) {
                wp_schedule_single_event(time() + 300, self::SCAN_HOOK);
            }
            self::flush();
        } catch (\Throwable $e) {
            // Never a broken cron run: the next scan tries again.
        }
    }

    /**
     * When the work must stop (microtime): $budget seconds from now, inside
     * what PHP still allows this request, with five seconds to spare.
     */
    private static function deadline($budget) {
        $now = microtime(true);
        $end = $now + $budget;
        $max = (int) ini_get('max_execution_time');
        if ($max > 0) {
            $start = isset($_SERVER['REQUEST_TIME_FLOAT']) ? (float) $_SERVER['REQUEST_TIME_FLOAT'] : $now;
            $end = min($end, $start + $max - 5);
        }
        return $end;
    }

    /** Whether this site is connected to WPMaven (an instance to report for). */
    private static function connected() {
        return class_exists('WebMaven_Alert_Detector') && WebMaven_Alert_Detector::instance_id() !== '';
    }

    // ── Core files ─────────────────────────────────────────────────────────

    /**
     * Core files against the official checksums, from where the last pass
     * stopped. Returns true when files are left for a next run (the deadline
     * came first), false when the pass is complete or cannot run.
     */
    public static function check_core_files($deadline, $now = null) {
        $now = $now === null ? time() : (int) $now;
        global $wp_local_package;
        $version = function_exists('get_bloginfo') ? (string) get_bloginfo('version') : '';
        $locale = (isset($wp_local_package) && is_string($wp_local_package) && $wp_local_package !== '') ? $wp_local_package : 'en_US';
        if ($version === '') return false;
        $checksums = self::core_checksums($version, $locale);
        if (!$checksums) return false;

        $files = array_keys($checksums);
        sort($files, SORT_STRING);
        $count = count($files);
        $state = get_option(self::CORE_STATE_OPTION, []);
        $offset = (is_array($state) && ($state['version'] ?? '') === $version && ($state['locale'] ?? '') === $locale)
            ? min(max(0, (int) ($state['offset'] ?? 0)), $count) : 0;
        $partial = $offset > 0;

        $modified = [];
        $missing = [];
        for ($i = $offset; $i < $count; $i++) {
            if (microtime(true) >= $deadline) break;
            $file = (string) $files[$i];
            if (self::skip_core_file($file)) continue;
            $path = ABSPATH . $file;
            if (!file_exists($path)) {
                if (!in_array($file, self::BENIGN_MISSING, true)) $missing[] = ['path' => $file];
                continue;
            }
            $md5 = @md5_file($path);
            if (!is_string($md5)) continue;
            $expected = $checksums[$file];
            $expected = is_array($expected) ? array_map('strtolower', array_map('strval', $expected)) : [strtolower((string) $expected)];
            if (!in_array($md5, $expected, true)) {
                $modified[] = ['path' => $file, 'md5' => $md5, 'expectedMd5' => $expected[0]];
            }
        }
        $done = $i >= $count;
        update_option(self::CORE_STATE_OPTION, ['version' => $version, 'locale' => $locale, 'offset' => $done ? 0 : $i, 'at' => $now], false);

        $extra = ['version' => $version, 'locale' => $locale, 'partial' => $partial || !$done];
        self::queue(array_merge(
            self::file_event('core_file_modified', $modified, $extra, $now),
            self::file_event('core_file_missing', $missing, $extra, $now)
        ));
        return !$done;
    }

    /** wp-content holds the site's own files, and wp-config.php is the site's own. */
    private static function skip_core_file($file) {
        return $file === '' || strpos($file, 'wp-content/') === 0 || $file === 'wp-config.php'
            || strpos($file, '..') !== false || $file[0] === '/' || $file[0] === '\\';
    }

    /**
     * The official checksums for a version and package locale (file => md5),
     * kept a week, or null when they cannot be read.
     */
    private static function core_checksums($version, $locale) {
        $cached = get_transient(self::CHECKSUMS_TRANSIENT);
        if (is_array($cached) && ($cached['version'] ?? null) === $version && ($cached['locale'] ?? null) === $locale
            && !empty($cached['checksums']) && is_array($cached['checksums'])) {
            return $cached['checksums'];
        }
        $url = 'https://api.wordpress.org/core/checksums/1.0/?' . http_build_query(['version' => $version, 'locale' => $locale], '', '&');
        $response = wp_remote_get($url, ['timeout' => 10]);
        if (is_wp_error($response) || (int) wp_remote_retrieve_response_code($response) !== 200) return null;
        $body = json_decode((string) wp_remote_retrieve_body($response), true);
        $checksums = is_array($body) ? ($body['checksums'] ?? null) : null;
        if (!is_array($checksums) || !$checksums) return null;
        set_transient(self::CHECKSUMS_TRANSIENT, ['version' => $version, 'locale' => $locale, 'checksums' => $checksums], WEEK_IN_SECONDS);
        return $checksums;
    }

    // ── Uploads ────────────────────────────────────────────────────────────

    /**
     * Files named like PHP under the uploads folder, until the deadline or
     * UPLOADS_MAX_ENTRIES. A complete walk is not repeated within UPLOADS_EVERY.
     */
    public static function check_uploads($deadline, $now = null) {
        $now = $now === null ? time() : (int) $now;
        $state = get_option(self::UPLOADS_STATE_OPTION, []);
        $last_complete = is_array($state) ? (int) ($state['completeAt'] ?? 0) : 0;
        if ($last_complete > 0 && $now - $last_complete < self::UPLOADS_EVERY) return;
        $dirs = wp_upload_dir(null, false);
        $base = is_array($dirs) && !empty($dirs['basedir']) ? rtrim((string) $dirs['basedir'], '/\\') : '';
        if ($base === '' || !is_dir($base)) return;

        $found = [];
        $entries = 0;
        $complete = true;
        try {
            $walk = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($base, \FilesystemIterator::SKIP_DOTS),
                \RecursiveIteratorIterator::LEAVES_ONLY,
                \RecursiveIteratorIterator::CATCH_GET_CHILD
            );
            foreach ($walk as $info) {
                if (++$entries > self::UPLOADS_MAX_ENTRIES || microtime(true) >= $deadline) {
                    $complete = false;
                    break;
                }
                $name = $info->getFilename();
                if (!preg_match(self::PHP_NAME, $name)) continue;
                $abs = $info->getPathname();
                $link = $info->isLink();
                $size = $link ? 0 : (int) @filesize($abs);
                if (!$link && $size <= self::STUB_MAX_BYTES && self::is_inert_stub($abs)) continue;
                $hash = (!$link && $size <= self::HASH_MAX_BYTES) ? @hash_file('sha256', $abs) : false;
                $mtime = $link ? 0 : (int) @filemtime($abs);
                $found[] = [
                    'path' => str_replace('\\', '/', ltrim(substr($abs, strlen($base)), '/\\')),
                    'size' => $size,
                    'sha256' => is_string($hash) ? $hash : null,
                    'modifiedAt' => $mtime > 0 ? gmdate('Y-m-d\TH:i:s\Z', $mtime) : null,
                ];
                if (count($found) >= 1000) break;
            }
        } catch (\Throwable $e) {
            $complete = false;
        }
        update_option(self::UPLOADS_STATE_OPTION, [
            'completeAt' => $complete ? $now : $last_complete,
            'scannedAt' => $now,
            'entries' => $entries,
        ], false);
        self::queue(self::file_event('unexpected_php_in_uploads', $found, ['scanned' => $entries, 'complete' => $complete], $now));
    }

    /**
     * An index.php holding only `<?php` and comments: nothing in it runs. A
     * line comment ends at `?>` in PHP and `#[` opens an attribute, so neither
     * counts as a comment here; anything this does not recognize is reported.
     */
    private static function is_inert_stub($path) {
        $code = @file_get_contents($path, false, null, 0, self::STUB_MAX_BYTES + 1);
        if (!is_string($code) || strlen($code) > self::STUB_MAX_BYTES) return false;
        return preg_match('~\A\s*<\?php(?:\s+|//(?:(?!\?>)[^\r\n])*|#(?!\[)(?:(?!\?>)[^\r\n])*|/\*.*?\*/)*(?:\?>\s*)?\z~s', $code) === 1;
    }

    // ── Administrators ─────────────────────────────────────────────────────

    public static function on_set_user_role($user_id, $role, $old_roles = []) {
        if ($role === 'administrator' && !in_array('administrator', (array) $old_roles, true)) {
            self::note_admin((int) $user_id, 'promoted');
        }
    }

    public static function on_add_user_role($user_id, $role) {
        if ($role === 'administrator') {
            self::note_admin((int) $user_id, 'promoted');
        }
    }

    /** wp_insert_user sets the role first, then fires user_register: a noted account is a new one. */
    public static function on_user_register($user_id) {
        $user_id = (int) $user_id;
        if (isset(self::$admin_candidates[$user_id]) && self::$admin_candidates[$user_id] === 'promoted') {
            self::$admin_candidates[$user_id] = 'created';
        }
    }

    public static function on_granted_super_admin($user_id) {
        self::note_admin((int) $user_id, 'super_admin');
    }

    /**
     * Notes an administrator for the end of the request: by then whoever made
     * the account has marked it (the one-click sign-in writes its marker right
     * after wp_insert_user), so WPMaven's own accounts are told apart.
     */
    private static function note_admin($user_id, $change) {
        try {
            if ($user_id <= 0) return;
            if (!isset(self::$admin_candidates[$user_id]) || $change === 'super_admin') {
                self::$admin_candidates[$user_id] = $change;
            }
            if (!self::$shutdown_hooked) {
                self::$shutdown_hooked = true;
                add_action('shutdown', [__CLASS__, 'report_noted_admins'], 0);
            }
        } catch (\Throwable $e) {
        }
    }

    /** shutdown: each noted account that is still an administrator and not WPMaven's own. */
    public static function report_noted_admins() {
        try {
            $candidates = self::$admin_candidates;
            self::$admin_candidates = [];
            if (!$candidates || !self::connected()) return;
            $now = time();
            $events = [];
            $seen = [];
            foreach ($candidates as $user_id => $change) {
                $user = get_userdata($user_id);
                if (!$user || !self::is_admin_now($user, $change)) continue;
                $seen[] = (int) $user_id;
                if (self::wpmaven_account($user_id)) continue;
                $key = 'admin_user_created:' . (int) $user_id;
                if (!self::unreported([$key], $now)) continue;
                self::mark_reported([$key], $now);
                $events[] = self::admin_event($user, $change, 'live', $now);
            }
            if ($seen) self::remember_admins($seen);
            if ($events && self::queue($events)) self::schedule_flush();
        } catch (\Throwable $e) {
        }
    }

    /**
     * Daily: administrators who were not there at the last compare (a change
     * written straight to the database fires no hook). The first compare only
     * records who is there.
     */
    public static function check_admins($now = null) {
        $now = $now === null ? time() : (int) $now;
        $current = self::current_admin_ids();
        $known = get_option(self::ADMINS_OPTION, null);
        update_option(self::ADMINS_OPTION, $current, false);
        if (!is_array($known)) return;
        $events = [];
        foreach (array_diff($current, array_map('intval', $known)) as $user_id) {
            if (self::wpmaven_account($user_id)) continue;
            $key = 'admin_user_created:' . (int) $user_id;
            if (!self::unreported([$key], $now)) continue;
            $user = get_userdata($user_id);
            if (!$user) continue;
            self::mark_reported([$key], $now);
            $events[] = self::admin_event($user, 'found', 'daily_scan', $now);
        }
        self::queue($events);
    }

    private static function is_admin_now($user, $change) {
        if (in_array('administrator', (array) $user->roles, true)) return true;
        return $change === 'super_admin' && function_exists('is_super_admin') && is_super_admin($user->ID);
    }

    /** An account WPMaven's one-click sign-in made (the owner's or a staff member's). */
    private static function wpmaven_account($user_id) {
        $marker = class_exists('WebMaven_Actor') ? WebMaven_Actor::MARKER_META : '_webmaven_admin_login_created';
        return (bool) get_user_meta((int) $user_id, $marker, true);
    }

    /** Administrators of this site, and the network's super admins on multisite. */
    private static function current_admin_ids() {
        $ids = array_map('intval', (array) get_users(['role' => 'administrator', 'fields' => 'ID', 'number' => 1000]));
        if (function_exists('is_multisite') && is_multisite() && function_exists('get_super_admins')) {
            foreach ((array) get_super_admins() as $login) {
                $user = get_user_by('login', $login);
                if ($user) $ids[] = (int) $user->ID;
            }
        }
        $ids = array_values(array_unique($ids));
        sort($ids);
        return $ids;
    }

    /** Adds administrators seen live to the daily compare's list, so it does not report them again. */
    private static function remember_admins(array $ids) {
        $known = get_option(self::ADMINS_OPTION, null);
        $known = is_array($known) ? array_map('intval', $known) : self::current_admin_ids();
        $known = array_values(array_unique(array_merge($known, array_map('intval', $ids))));
        sort($known);
        update_option(self::ADMINS_OPTION, $known, false);
    }

    private static function admin_event($user, $change, $detected_by, $now) {
        $registered = isset($user->user_registered) ? strtotime($user->user_registered . ' UTC') : false;
        $detail = [
            'userId' => (int) $user->ID,
            'change' => $change,
            'via' => $detected_by === 'live' ? self::via() : 'unknown',
            'detectedBy' => $detected_by,
            'loginHash' => self::sent_hash((string) $user->user_login),
            'registeredAt' => $registered ? gmdate('Y-m-d\TH:i:s\Z', $registered) : null,
        ];
        if ($detected_by === 'live' && function_exists('get_current_user_id') && get_current_user_id() > 0) {
            $detail['actorUserId'] = (int) get_current_user_id();
        }
        return self::event('admin_user_created', 'admin_user_created:' . (int) $user->ID, $detail, $now);
    }

    /** Where a live change came from: a WPMaven call, WP-CLI, REST, XML-RPC, WP-Cron, wp-admin or the site. */
    private static function via() {
        if ((class_exists('WebMaven_Admin_Guard') && WebMaven_Admin_Guard::is_active())
            || (class_exists('WebMaven_Self_Protect') && WebMaven_Self_Protect::in_guarded_call())) {
            return 'wpmaven';
        }
        if (defined('WP_CLI') && WP_CLI) return 'wp_cli';
        if (defined('REST_REQUEST') && REST_REQUEST) return 'rest';
        if (defined('XMLRPC_REQUEST') && XMLRPC_REQUEST) return 'xmlrpc';
        if (function_exists('wp_doing_cron') && wp_doing_cron()) return 'cron';
        if (function_exists('is_admin') && is_admin()) return 'wp_admin';
        return 'site';
    }

    // ── Failed logins ──────────────────────────────────────────────────────

    public static function on_login_failed($username) {
        try {
            self::count_login_failure($username, time());
        } catch (\Throwable $e) {
        }
    }

    /**
     * One failed login into the current LOGIN_WINDOW. The window's sources
     * and user names are kept as keyed hashes (never sent, only counted).
     * Reports the burst once when the count reaches LOGIN_THRESHOLD.
     */
    public static function count_login_failure($username, $now) {
        $now = (int) $now;
        $window = get_transient(self::LOGIN_TRANSIENT);
        if (!is_array($window) || $now - (int) ($window['start'] ?? 0) >= self::LOGIN_WINDOW) {
            $window = ['start' => $now, 'count' => 0, 'sources' => [], 'names' => [], 'reported' => false];
        }
        $window['sources'] = is_array($window['sources'] ?? null) ? $window['sources'] : [];
        $window['names'] = is_array($window['names'] ?? null) ? $window['names'] : [];
        $window['count'] = (int) ($window['count'] ?? 0) + 1;
        $source = self::local_hash(isset($_SERVER['REMOTE_ADDR']) ? sanitize_text_field(wp_unslash((string) $_SERVER['REMOTE_ADDR'])) : '');
        if (count($window['sources']) < 200) $window['sources'][$source] = 1;
        $name = self::local_hash(strtolower(trim((string) $username)));
        if (count($window['names']) < 200) $window['names'][$name] = 1;
        $burst = empty($window['reported']) && $window['count'] >= self::LOGIN_THRESHOLD;
        if ($burst) $window['reported'] = true;
        set_transient(self::LOGIN_TRANSIENT, $window, max(1, self::LOGIN_WINDOW - ($now - (int) $window['start'])));
        if (!$burst || !self::connected() || !self::unreported(['login_failure_burst'], $now)) return;
        self::mark_reported(['login_failure_burst'], $now);
        $queued = self::queue([self::event('login_failure_burst', 'login_failure_burst', [
            'count' => $window['count'],
            'windowMinutes' => (int) (self::LOGIN_WINDOW / 60),
            'sources' => count($window['sources']),
            'usernames' => count($window['names']),
        ], $now)]);
        if ($queued) self::schedule_flush();
    }

    // ── Findings, the queue and the report ─────────────────────────────────

    private static function event($type, $key, array $detail, $now) {
        return ['type' => $type, 'key' => $key, 'detail' => $detail, 'detectedAt' => gmdate('Y-m-d\TH:i:s\Z', (int) $now)];
    }

    /**
     * One event for a list of files: the ones not reported within
     * REPORT_EVERY, never-reported first, at most FILES_PER_EVENT of them;
     * count is every file found this run. [] when none is new.
     */
    private static function file_event($type, array $files, array $extra, $now) {
        if (!$files) return [];
        $by_key = [];
        foreach ($files as $file) {
            $by_key[$type . ':' . $file['path']] = $file;
        }
        $fresh = array_slice(self::unreported(array_keys($by_key), $now), 0, self::FILES_PER_EVENT);
        if (!$fresh) return [];
        self::mark_reported($fresh, $now);
        $listed = [];
        foreach ($fresh as $key) {
            $listed[] = $by_key[$key];
        }
        $detail = array_merge($extra, [
            'count' => count($files),
            'files' => $listed,
            'truncated' => count($listed) < count($files),
        ]);
        return [self::event($type, $type . ':' . (int) $now, $detail, $now)];
    }

    /** The keys among $keys not reported within REPORT_EVERY, never-reported first. */
    private static function unreported(array $keys, $now) {
        $reported = get_option(self::REPORTED_OPTION, []);
        $reported = is_array($reported) ? $reported : [];
        $out = [];
        foreach ($keys as $key) {
            $at = (int) ($reported[$key] ?? 0);
            if ($at > 0 && $now - $at < self::REPORT_EVERY) continue;
            $out[$key] = $at;
        }
        asort($out, SORT_NUMERIC);
        return array_map('strval', array_keys($out));
    }

    private static function mark_reported(array $keys, $now) {
        if (!$keys) return;
        $reported = get_option(self::REPORTED_OPTION, []);
        $reported = is_array($reported) ? $reported : [];
        foreach ($reported as $key => $at) {
            if ($now - (int) $at >= self::REPORT_EVERY) unset($reported[$key]);
        }
        foreach ($keys as $key) {
            $reported[$key] = (int) $now;
        }
        if (count($reported) > self::REPORTED_MAX) {
            arsort($reported, SORT_NUMERIC);
            $reported = array_slice($reported, 0, self::REPORTED_MAX, true);
        }
        update_option(self::REPORTED_OPTION, $reported, false);
    }

    /** Adds events to the queue (the oldest go past QUEUE_MAX). Returns how many. */
    public static function queue(array $events) {
        if (!$events) return 0;
        $queue = get_option(self::QUEUE_OPTION, []);
        $queue = is_array($queue) ? $queue : [];
        foreach ($events as $event) {
            $queue[] = $event;
        }
        if (count($queue) > self::QUEUE_MAX) {
            $queue = array_slice($queue, -self::QUEUE_MAX);
        }
        update_option(self::QUEUE_OPTION, array_values($queue), false);
        return count($events);
    }

    private static function schedule_flush() {
        if (!wp_next_scheduled(self::FLUSH_HOOK)) {
            wp_schedule_single_event(time() + 30, self::FLUSH_HOOK);
        }
    }

    /**
     * Sends up to SEND_BATCH queued events. Taken (2xx) or refused for good
     * (400, 403, 404, 410, 413, 422), they leave the queue; anything else
     * (no answer, 401, 429, 5xx) is tried again by the next flush.
     */
    public static function flush() {
        try {
            $queue = get_option(self::QUEUE_OPTION, []);
            if (!is_array($queue) || !$queue) return;
            $instance_id = class_exists('WebMaven_Alert_Detector') ? WebMaven_Alert_Detector::instance_id() : '';
            if ($instance_id === '') return;
            $client = new WebMaven_WP_API_Client();
            if (!$client->is_configured()) return;

            $batch = array_slice($queue, 0, self::SEND_BATCH);
            $events = [];
            $sent = [];
            foreach ($batch as $event) {
                if (!is_array($event) || empty($event['type'])) continue;
                $events[] = ['type' => $event['type'], 'detail' => $event['detail'] ?? new \stdClass(), 'detectedAt' => $event['detectedAt'] ?? null];
                $sent[(string) ($event['key'] ?? '')] = true;
            }
            $status = 0;
            if ($events) {
                $result = $client->make_request(self::ENDPOINT, 'POST', ['instanceId' => $instance_id, 'events' => $events], null, 15);
                $status = is_array($result) ? (int) ($result['status_code'] ?? 0) : 0;
            }
            $done = !$events || ($status >= 200 && $status < 300) || in_array($status, [400, 403, 404, 410, 413, 422], true);
            if (!$done) return;
            // New events may have come in meanwhile: only the batch leaves.
            $left = [];
            $skip = count($batch);
            foreach ((array) get_option(self::QUEUE_OPTION, []) as $event) {
                if ($skip > 0 && is_array($event) && isset($sent[(string) ($event['key'] ?? '')])) {
                    $skip--;
                    continue;
                }
                $left[] = $event;
            }
            update_option(self::QUEUE_OPTION, $left, false);
        } catch (\Throwable $e) {
        }
    }

    // ── Hashes ─────────────────────────────────────────────────────────────

    /** A hash that may be sent: SHA-256, first 16 hex digits. */
    private static function sent_hash($value) {
        return substr(hash('sha256', (string) $value), 0, 16);
    }

    /** A hash keyed with this site's salt, for counting only (never sent). */
    private static function local_hash($value) {
        if (function_exists('wp_hash')) {
            return substr(wp_hash((string) $value), 0, 16);
        }
        return substr(hash('sha256', 'webmaven-sec|' . (string) $value), 0, 16);
    }
}
