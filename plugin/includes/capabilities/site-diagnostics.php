<?php
/**
 * Site diagnostics (1.2.6): read-only checks the API's operators use for
 * health, security and performance reports.
 *
 *   site_health_flags   wp-config switches (WP_DEBUG, WP_DEBUG_LOG,
 *                       WP_DEBUG_DISPLAY, DISALLOW_FILE_EDIT,
 *                       DISALLOW_FILE_MODS), whether debug output reaches
 *                       visitors, multisite, SSL and the home/siteurl scheme,
 *                       environment type, persistent object cache.
 *   page_timing         a loopback fetch of one page of this site: total time,
 *                       time to first byte, size, status, compression.
 *   large_images        image attachments above a size threshold, largest first.
 *   database_stats      revisions, auto-drafts, trash, spam, expired transients,
 *                       autoloaded options, table sizes.
 *   updates_available   pending plugin, theme and core updates from
 *                       WordPress's own update checks.
 *   site_profile        what the site already holds and what the site check
 *                       reads that nothing else answers (WebMaven_Site_Profile):
 *                       counts, theme, builder, logins named admin, comments
 *                       waiting, legal pages, the homepage's viewport tag,
 *                       payment methods in test mode. Never a customer's details.
 *
 * Nothing here writes to the site. The API reads an "Unknown command" answer
 * from an older plugin as "this site needs the plugin update", never as a pass.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once dirname(__DIR__) . '/class-webmaven-hosting.php';

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['site_health_flags'] = ['WebMaven_Cap_Diagnostics', 'site_health_flags'];
    $handlers['page_timing'] = ['WebMaven_Cap_Diagnostics', 'page_timing'];
    $handlers['large_images'] = ['WebMaven_Cap_Diagnostics', 'large_images'];
    $handlers['database_stats'] = ['WebMaven_Cap_Diagnostics', 'database_stats'];
    $handlers['updates_available'] = ['WebMaven_Cap_Diagnostics', 'updates_available'];
    $handlers['site_profile'] = ['WebMaven_Site_Profile', 'site_profile'];
    return $handlers;
});

class WebMaven_Cap_Diagnostics {

    /** WooCommerce order types stored as posts: never counted as clutter, never cleaned. */
    const ORDER_POST_TYPES = ['shop_order', 'shop_order_refund', 'shop_subscription', 'shop_order_placehold'];

    /** Attachments read by one large_images call (newest first). */
    const IMAGE_SCAN_CAP = 5000;

    /** A WPMaven-hosted site (the fleet image), per the mail relay's detection. */
    public static function is_hosted() {
        return WebMaven_Hosting::is_hosted_site();
    }

    /** The WPMaven plugin's own basename, which no maintenance action touches. */
    public static function own_plugin_file() {
        return defined('WEBMAVEN_WP_FILE') && function_exists('plugin_basename')
            ? plugin_basename(WEBMAVEN_WP_FILE)
            : 'wpmaven-wordpress/webmaven-wordpress.php';
    }

    /** True for the WPMaven plugin, by basename or by folder name. */
    public static function is_own_plugin($file) {
        $file = (string) $file;
        if ($file === self::own_plugin_file()) {
            return true;
        }
        $folder = strtolower(strtok($file, '/'));
        return in_array($folder, ['wpmaven-wordpress', 'webmaven-wordpress', 'webmaven_wordpress'], true);
    }

    private static function constant_value($name) {
        return defined($name) ? constant($name) : null;
    }

    /** An ini flag as PHP spells it ("1", "On", "stderr", ...) read as "shown on the page". */
    private static function ini_shows_output($value) {
        $v = strtolower(trim((string) $value));
        return in_array($v, ['1', 'on', 'true', 'yes', 'stdout'], true);
    }

    /**
     * Whether a visitor's page shows PHP errors, by WordPress's own rule for a
     * page (wp_debug_mode): with WP_DEBUG, WP_DEBUG_DISPLAY decides (WordPress
     * defines it true when wp-config does not). This request's display_errors
     * is not what a visitor gets: WordPress keeps every JSON request quiet, the
     * webhook included. Without WP_DEBUG, what the server shows: this request's
     * value, or the server's own when this request was made quiet.
     */
    private static function visitor_sees_errors($wp_debug, $debug_display, $display_now) {
        if ($wp_debug) {
            return $debug_display === null ? true : (bool) $debug_display;
        }
        $quiet = defined('REST_REQUEST') || (function_exists('wp_is_json_request') && wp_is_json_request())
            || (function_exists('wp_doing_ajax') && wp_doing_ajax());
        if (!$quiet) {
            return self::ini_shows_output($display_now);
        }
        $server = function_exists('get_cfg_var') ? get_cfg_var('display_errors') : false;
        return self::ini_shows_output($server === false ? '' : $server);
    }

    // ── site_health_flags ───────────────────────────────────────────────

    public static function site_health_flags($params = [], $step_id = null) {
        $wp_debug = (bool) self::constant_value('WP_DEBUG');
        $debug_log_raw = self::constant_value('WP_DEBUG_LOG');
        $debug_display_raw = self::constant_value('WP_DEBUG_DISPLAY');

        // Where WordPress writes the log (wp_debug_mode): true or "1" means
        // wp-content/debug.log, another string is a path, false is no log.
        $log_path = null;
        if ($wp_debug && $debug_log_raw !== null && $debug_log_raw !== false) {
            $as_text = strtolower((string) (is_bool($debug_log_raw) ? ($debug_log_raw ? 'true' : 'false') : $debug_log_raw));
            if (in_array($as_text, ['true', '1'], true)) {
                $log_path = WP_CONTENT_DIR . '/debug.log';
            } elseif (is_string($debug_log_raw) && $debug_log_raw !== '' && $as_text !== 'false' && $as_text !== '0') {
                $log_path = $debug_log_raw;
            }
        }
        $web_root = realpath(ABSPATH);
        $log_dir = $log_path !== null ? realpath(dirname($log_path)) : false;
        $log_in_web_root = $log_path !== null && $web_root !== false && $log_dir !== false
            && strpos($log_dir . DIRECTORY_SEPARATOR, rtrim($web_root, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR) === 0;
        $log_exists = $log_path !== null && @file_exists($log_path);

        $home = (string) get_option('home');
        $siteurl = (string) get_option('siteurl');
        $scheme = function ($url) {
            $s = wp_parse_url($url, PHP_URL_SCHEME);
            return is_string($s) ? strtolower($s) : '';
        };

        $display_errors = (string) ini_get('display_errors');
        $disallow_edit = (bool) self::constant_value('DISALLOW_FILE_EDIT');
        $disallow_mods = (bool) self::constant_value('DISALLOW_FILE_MODS');

        return [
            'constants' => [
                'WP_DEBUG' => $wp_debug,
                'WP_DEBUG_LOG' => is_bool($debug_log_raw) || $debug_log_raw === null ? (bool) $debug_log_raw : (string) $debug_log_raw,
                // WordPress defines WP_DEBUG_DISPLAY as true when wp-config does not.
                'WP_DEBUG_DISPLAY' => $debug_display_raw === null ? null : (bool) $debug_display_raw,
                'DISALLOW_FILE_EDIT' => $disallow_edit,
                'DISALLOW_FILE_MODS' => $disallow_mods,
                'FORCE_SSL_ADMIN' => (bool) self::constant_value('FORCE_SSL_ADMIN'),
            ],
            'debug' => [
                'enabled' => $wp_debug,
                // What PHP does with an error right now, after wp-config,
                // WordPress and any must-use plugin had their say.
                'display_errors' => $display_errors,
                'output_visible' => self::visitor_sees_errors($wp_debug, $debug_display_raw, $display_errors),
                'log' => [
                    'enabled' => $log_path !== null,
                    'in_web_root' => $log_in_web_root,
                    'exists' => $log_exists,
                    'size_bytes' => $log_exists ? (int) @filesize($log_path) : null,
                ],
            ],
            // DISALLOW_FILE_MODS turns the editor off too.
            'file_editor_disabled' => $disallow_edit || $disallow_mods,
            'file_mods_disabled' => $disallow_mods,
            'multisite' => function_exists('is_multisite') ? (bool) is_multisite() : false,
            'ssl' => [
                'home' => $home,
                'siteurl' => $siteurl,
                'home_https' => $scheme($home) === 'https',
                'siteurl_https' => $scheme($siteurl) === 'https',
                'request_https' => function_exists('is_ssl') ? (bool) is_ssl() : null,
                'force_ssl_admin' => function_exists('force_ssl_admin') ? (bool) force_ssl_admin() : (bool) self::constant_value('FORCE_SSL_ADMIN'),
            ],
            'environment_type' => function_exists('wp_get_environment_type') ? (string) wp_get_environment_type() : 'production',
            'object_cache' => [
                'persistent' => function_exists('wp_using_ext_object_cache') ? (bool) wp_using_ext_object_cache() : false,
                'dropin' => @file_exists(WP_CONTENT_DIR . '/object-cache.php'),
            ],
            'page_cache_dropin' => (bool) self::constant_value('WP_CACHE') && @file_exists(WP_CONTENT_DIR . '/advanced-cache.php'),
            'hardening' => class_exists('WebMaven_Cap_Maintenance') ? WebMaven_Cap_Maintenance::hardening_state() : null,
            'hosted' => self::is_hosted(),
            'plugin_version' => defined('WEBMAVEN_WP_VERSION') ? WEBMAVEN_WP_VERSION : null,
        ];
    }

    // ── page_timing ─────────────────────────────────────────────────────

    /**
     * Fetch one page of this site from the server itself, as an anonymous
     * visitor. Only a path is accepted: the host is always the site's own
     * home, so this cannot be pointed at anything else. Redirects are followed
     * only while they stay on that host.
     */
    public static function page_timing($params = [], $step_id = null) {
        $path = isset($params['path']) ? (string) $params['path'] : '/';
        if ($path === '') {
            $path = '/';
        }
        if ($path[0] !== '/' || strpos($path, '//') === 0 || strlen($path) > 512 || preg_match('/[\s\x00-\x1f\x7f\\\\]/', $path)) {
            return ['success' => false, 'error' => 'path must be a path on this site, such as / or /shop/'];
        }
        $samples = isset($params['samples']) ? (int) $params['samples'] : 1;
        $samples = max(1, min(3, $samples));

        $home = (string) home_url('/');
        $home_host = strtolower((string) wp_parse_url($home, PHP_URL_HOST));
        $url = untrailingslashit($home) . $path;
        if ($home_host === '' || strtolower((string) wp_parse_url($url, PHP_URL_HOST)) !== $home_host) {
            return ['success' => false, 'error' => 'Could not build a URL on this site for that path'];
        }

        $runs = [];
        for ($i = 0; $i < $samples; $i++) {
            $runs[] = self::fetch_following($url, $home_host);
        }
        $ok = array_values(array_filter($runs, function ($r) {
            return empty($r['error']);
        }));
        if (!$ok) {
            return [
                'success' => false,
                'error' => 'The site could not fetch its own page: ' . $runs[0]['error'],
                'url' => $url,
            ];
        }

        $median = function (array $values) {
            $values = array_values(array_filter($values, function ($v) {
                return $v !== null;
            }));
            if (!$values) {
                return null;
            }
            sort($values);
            $n = count($values);
            return $n % 2 ? $values[intdiv($n, 2)] : (int) round(($values[$n / 2 - 1] + $values[$n / 2]) / 2);
        };
        $last = $ok[count($ok) - 1];

        return [
            'url' => $url,
            'final_url' => $last['final_url'],
            'status' => $last['status'],
            'redirects' => $last['redirects'],
            'total_ms' => $median(array_column($ok, 'total_ms')),
            'ttfb_ms' => $median(array_column($ok, 'ttfb_ms')),
            'bytes_transferred' => $last['bytes_transferred'],
            'html_bytes' => $last['html_bytes'],
            'content_encoding' => $last['content_encoding'],
            'content_type' => $last['content_type'],
            'cache_status' => $last['cache_status'],
            'assets' => $last['assets'],
            'samples' => array_map(function ($r) {
                return ['total_ms' => $r['total_ms'] ?? null, 'ttfb_ms' => $r['ttfb_ms'] ?? null, 'error' => $r['error'] ?? null];
            }, $runs),
            'method' => $last['method'],
            'measured_from' => 'server',
        ];
    }

    /** One timed fetch, following up to three same-host redirects. */
    private static function fetch_following($url, $home_host) {
        $total_ms = 0;
        $redirects = 0;
        $current = $url;
        for ($hop = 0; $hop < 4; $hop++) {
            $r = self::fetch_once($current);
            if (!empty($r['error'])) {
                return $r;
            }
            $total_ms += $r['total_ms'];
            $location = $r['location'];
            if ($r['status'] >= 300 && $r['status'] < 400 && $location !== '' && $hop < 3) {
                $next = self::resolve_location($current, $location);
                if ($next !== null && strtolower((string) wp_parse_url($next, PHP_URL_HOST)) === $home_host) {
                    $redirects++;
                    $current = $next;
                    continue;
                }
            }
            $r['total_ms'] = $total_ms;
            $r['redirects'] = $redirects;
            $r['final_url'] = $current;
            return $r;
        }
        return ['error' => 'Too many redirects'];
    }

    private static function resolve_location($base, $location) {
        if (preg_match('#^https?://#i', $location)) {
            return $location;
        }
        if (strpos($location, '//') === 0) {
            return null;
        }
        $scheme = wp_parse_url($base, PHP_URL_SCHEME);
        $host = wp_parse_url($base, PHP_URL_HOST);
        $port = wp_parse_url($base, PHP_URL_PORT);
        $origin = $scheme . '://' . $host . ($port ? ':' . $port : '');
        return $location !== '' && $location[0] === '/' ? $origin . $location : null;
    }

    /**
     * A single request through the WordPress HTTP API. When WordPress sends
     * it with cURL, cURL's own timings come back through the
     * requests-curl.after_request action: the time to first byte and the
     * bytes transferred. Otherwise only the total time is known.
     */
    private static function fetch_once($url) {
        $info = null;
        $capture = function ($headers, $curl_info = null) use (&$info) {
            if (is_array($curl_info)) {
                $info = $curl_info;
            }
        };
        add_action('requests-curl.after_request', $capture, 10, 2);
        $t0 = microtime(true);
        $response = wp_remote_get($url, [
            'timeout' => 20,
            'redirection' => 0,
            'user-agent' => 'WPMaven page timing (+https://wpmaven.ai)',
            'headers' => ['Accept-Encoding' => 'gzip, deflate'],
        ]);
        $ms = (int) round((microtime(true) - $t0) * 1000);
        remove_action('requests-curl.after_request', $capture, 10);
        if (is_wp_error($response)) {
            return ['error' => $response->get_error_message()];
        }
        $headers = [];
        foreach ((array) wp_remote_retrieve_headers($response) as $k => $v) {
            $headers[strtolower((string) $k)] = is_array($v) ? implode(', ', $v) : (string) $v;
        }
        $body = (string) wp_remote_retrieve_body($response);
        $status = (int) wp_remote_retrieve_response_code($response);
        if ($info !== null) {
            return self::describe_response(
                $status,
                isset($info['total_time']) ? (int) round(((float) $info['total_time']) * 1000) : $ms,
                isset($info['starttransfer_time']) ? (int) round(((float) $info['starttransfer_time']) * 1000) : null,
                isset($info['size_download']) ? (int) $info['size_download'] : null,
                $body,
                $headers,
                'curl'
            );
        }
        return self::describe_response($status, $ms, null, null, $body, $headers, 'wp_http');
    }

    private static function describe_response($status, $total_ms, $ttfb_ms, $transferred, $body, array $headers, $method) {
        $cache = '';
        foreach (['cf-cache-status', 'x-cache', 'x-litespeed-cache', 'x-proxy-cache', 'x-cache-status'] as $h) {
            if (!empty($headers[$h])) {
                $cache = $h . ': ' . $headers[$h];
                break;
            }
        }
        return [
            'status' => $status,
            'total_ms' => $total_ms,
            'ttfb_ms' => $ttfb_ms,
            'bytes_transferred' => $transferred,
            'html_bytes' => strlen($body),
            'content_encoding' => $headers['content-encoding'] ?? '',
            'content_type' => $headers['content-type'] ?? '',
            'cache_status' => $cache,
            'location' => $headers['location'] ?? '',
            'assets' => [
                // References in the HTML, not network requests: a browser also
                // loads what these reference, which this fetch does not.
                'images' => preg_match_all('/<img\b/i', $body),
                'scripts' => preg_match_all('/<script\b[^>]*\bsrc\s*=/i', $body),
                'stylesheets' => preg_match_all('/<link\b[^>]*\brel\s*=\s*["\']?stylesheet/i', $body),
            ],
            'method' => $method,
        ];
    }

    // ── large_images ────────────────────────────────────────────────────

    public static function large_images($params = [], $step_id = null) {
        global $wpdb;
        $min_kb = isset($params['min_kb']) ? (int) $params['min_kb'] : 300;
        $min_kb = max(50, min(20480, $min_kb));
        $threshold = $min_kb * 1024;
        $limit = isset($params['limit']) ? (int) $params['limit'] : 20;
        $limit = max(1, min(100, $limit));

        $total = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM %i WHERE post_type = 'attachment' AND post_mime_type LIKE %s",
            $wpdb->posts,
            'image/%'
        ));
        $ids = array_map('intval', (array) $wpdb->get_col($wpdb->prepare(
            "SELECT ID FROM %i WHERE post_type = 'attachment' AND post_mime_type LIKE %s ORDER BY ID DESC LIMIT %d",
            $wpdb->posts,
            'image/%',
            self::IMAGE_SCAN_CAP
        )));
        foreach (array_chunk($ids, 500) as $chunk) {
            update_meta_cache('post', $chunk);
        }

        $over = [];
        $over_bytes = 0;
        $unknown = 0;
        foreach ($ids as $id) {
            $meta = wp_get_attachment_metadata($id);
            $file = get_attached_file($id);
            $bytes = null;
            if (is_array($meta) && isset($meta['filesize']) && (int) $meta['filesize'] > 0) {
                $bytes = (int) $meta['filesize'];
            } elseif (is_string($file) && $file !== '' && @file_exists($file)) {
                $bytes = (int) @filesize($file);
            }
            if ($bytes === null) {
                $unknown++;
                continue;
            }
            if ($bytes < $threshold) {
                continue;
            }
            $over_bytes += $bytes;
            $over[] = [
                'id' => $id,
                'title' => get_the_title($id),
                'url' => (string) wp_get_attachment_url($id),
                'file' => is_array($meta) && isset($meta['file']) ? (string) $meta['file'] : basename((string) $file),
                'bytes' => $bytes,
                'width' => is_array($meta) && isset($meta['width']) ? (int) $meta['width'] : null,
                'height' => is_array($meta) && isset($meta['height']) ? (int) $meta['height'] : null,
                'mime' => (string) get_post_mime_type($id),
                'attached_to' => (int) wp_get_post_parent_id($id),
            ];
        }
        usort($over, function ($a, $b) {
            return $b['bytes'] <=> $a['bytes'];
        });

        return [
            'threshold_bytes' => $threshold,
            'total_images' => $total,
            'scanned' => count($ids),
            'truncated' => count($ids) < $total,
            'size_unknown' => $unknown,
            'over_threshold' => count($over),
            'over_threshold_bytes' => $over_bytes,
            'images' => array_slice($over, 0, $limit),
        ];
    }

    // ── database_stats ──────────────────────────────────────────────────

    /** The counts database_cleanup acts on, shared so the two always agree. */
    public static function clutter_counts() {
        global $wpdb;
        // One %s per order post type.
        $orders = implode(', ', array_fill(0, count(self::ORDER_POST_TYPES), '%s'));
        $now = time();
        $expired = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$wpdb->options} WHERE (option_name LIKE %s OR option_name LIKE %s) AND CAST(option_value AS UNSIGNED) < %d",
            $wpdb->esc_like('_transient_timeout_') . '%',
            $wpdb->esc_like('_site_transient_timeout_') . '%',
            $now
        ));
        return [
            'revisions' => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'revision'"),
            'auto_drafts' => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_status = 'auto-draft'"),
            'trashed_posts' => (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM %i WHERE post_status = 'trash' AND post_type NOT IN ($orders)", array_merge([$wpdb->posts], self::ORDER_POST_TYPES))), // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
            'trashed_orders' => (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM %i WHERE post_status = 'trash' AND post_type IN ($orders)", array_merge([$wpdb->posts], self::ORDER_POST_TYPES))), // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
            'spam_comments' => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->comments} WHERE comment_approved = 'spam'"),
            'trashed_comments' => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->comments} WHERE comment_approved = 'trash'"),
            'expired_transients' => $expired,
        ];
    }

    public static function database_stats($params = [], $step_id = null) {
        global $wpdb;
        $counts = self::clutter_counts();

        $autoload_values = function_exists('wp_autoload_values_to_autoload') ? wp_autoload_values_to_autoload() : ['yes'];
        $placeholders = implode(',', array_fill(0, count($autoload_values), '%s'));
        // $placeholders is only %s placeholders, one per value.
        $autoload = $wpdb->get_row($wpdb->prepare(
            "SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(option_value)), 0) AS bytes FROM %i WHERE autoload IN ($placeholders)", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
            array_merge([$wpdb->options], $autoload_values)
        ), ARRAY_A);
        $largest = (array) $wpdb->get_results($wpdb->prepare(
            "SELECT option_name AS name, LENGTH(option_value) AS bytes FROM %i WHERE autoload IN ($placeholders) ORDER BY LENGTH(option_value) DESC LIMIT 10", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
            array_merge([$wpdb->options], $autoload_values)
        ), ARRAY_A);

        $tables = $wpdb->get_results($wpdb->prepare(
            'SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_ROWS AS row_estimate, DATA_LENGTH AS data_bytes, INDEX_LENGTH AS index_bytes, DATA_FREE AS free_bytes'
            . ' FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_NAME LIKE %s ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC',
            DB_NAME,
            $wpdb->esc_like($wpdb->prefix) . '%'
        ), ARRAY_A);
        $table_rows = [];
        $total = 0;
        foreach ((array) $tables as $t) {
            $size = (int) $t['data_bytes'] + (int) $t['index_bytes'];
            $total += $size;
            $table_rows[] = [
                'name' => (string) $t['name'],
                'engine' => (string) $t['engine'],
                'row_estimate' => (int) $t['row_estimate'],
                'bytes' => $size,
                'free_bytes' => (int) $t['free_bytes'],
            ];
        }

        return [
            'counts' => $counts,
            'autoload' => [
                'count' => (int) ($autoload['n'] ?? 0),
                'bytes' => (int) ($autoload['bytes'] ?? 0),
                'largest' => array_map(function ($row) {
                    return ['name' => (string) $row['name'], 'bytes' => (int) $row['bytes']];
                }, $largest),
            ],
            'tables' => $tables === null ? null : [
                'count' => count($table_rows),
                'total_bytes' => $total,
                'largest' => array_slice($table_rows, 0, 15),
            ],
            'tables_error' => $tables === null ? (string) $wpdb->last_error : null,
        ];
    }

    // ── updates_available ───────────────────────────────────────────────

    private static function to_array($value) {
        return is_object($value) ? get_object_vars($value) : (is_array($value) ? $value : []);
    }

    /** Versions required by an update, as WordPress.org reports them; true when this site meets them. */
    private static function meets($requires_wp, $requires_php) {
        $wp = (string) get_bloginfo('version');
        $wp_ok = $requires_wp === '' || $requires_wp === false || version_compare($wp, (string) $requires_wp, '>=');
        $php_ok = $requires_php === '' || $requires_php === false || version_compare(PHP_VERSION, (string) $requires_php, '>=');
        return $wp_ok && $php_ok;
    }

    public static function updates_available($params = [], $step_id = null) {
        if (!function_exists('get_plugins')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        $installed = get_plugins();
        $auto = (array) get_site_option('auto_update_plugins', []);
        $plugins_t = get_site_transient('update_plugins');
        $themes_t = get_site_transient('update_themes');
        $core_t = get_site_transient('update_core');

        $plugins = [];
        foreach (self::to_array(is_object($plugins_t) ? ($plugins_t->response ?? []) : []) as $file => $update) {
            $u = self::to_array($update);
            $requires = (string) ($u['requires'] ?? '');
            $requires_php = (string) ($u['requires_php'] ?? '');
            $plugins[] = [
                'file' => (string) $file,
                'slug' => (string) ($u['slug'] ?? strtok((string) $file, '/')),
                'name' => (string) ($installed[$file]['Name'] ?? ($u['slug'] ?? $file)),
                'installed_version' => (string) ($installed[$file]['Version'] ?? ''),
                'new_version' => (string) ($u['new_version'] ?? ''),
                'requires_wp' => $requires,
                'requires_php' => $requires_php,
                'compatible' => self::meets($requires, $requires_php),
                'has_package' => !empty($u['package']),
                'active' => function_exists('is_plugin_active') ? (bool) is_plugin_active($file) : null,
                'auto_update' => in_array($file, $auto, true),
                // The WPMaven plugin updates itself; maintenance never touches it.
                'managed_by_wpmaven' => self::is_own_plugin($file),
            ];
        }

        $themes = [];
        foreach (self::to_array(is_object($themes_t) ? ($themes_t->response ?? []) : []) as $stylesheet => $update) {
            $u = self::to_array($update);
            $theme = wp_get_theme($stylesheet);
            $requires = (string) ($u['requires'] ?? '');
            $requires_php = (string) ($u['requires_php'] ?? '');
            $themes[] = [
                'stylesheet' => (string) $stylesheet,
                'name' => $theme->exists() ? (string) $theme->get('Name') : (string) $stylesheet,
                'installed_version' => $theme->exists() ? (string) $theme->get('Version') : '',
                'new_version' => (string) ($u['new_version'] ?? ''),
                'requires_wp' => $requires,
                'requires_php' => $requires_php,
                'compatible' => self::meets($requires, $requires_php),
                'has_package' => !empty($u['package']),
                'active' => (string) $stylesheet === (string) get_stylesheet() || (string) $stylesheet === (string) get_template(),
            ];
        }

        $offers = [];
        foreach ((is_object($core_t) && is_array($core_t->updates ?? null) ? $core_t->updates : []) as $offer) {
            $o = self::to_array($offer);
            $offers[] = [
                'response' => (string) ($o['response'] ?? ''),
                'version' => (string) ($o['version'] ?? ($o['current'] ?? '')),
                'locale' => (string) ($o['locale'] ?? ''),
                'php_version' => (string) ($o['php_version'] ?? ''),
            ];
        }
        $upgrade = null;
        foreach ($offers as $o) {
            if ($o['response'] === 'upgrade' && $o['version'] !== '') {
                $upgrade = $o['version'];
                break;
            }
        }

        $checked = function ($t) {
            return is_object($t) && isset($t->last_checked) ? (int) $t->last_checked : null;
        };
        $hosted = self::is_hosted();

        return [
            'plugins' => [
                'last_checked' => $checked($plugins_t),
                'checked' => is_object($plugins_t) && isset($plugins_t->checked) ? count((array) $plugins_t->checked) : 0,
                'updates' => $plugins,
            ],
            'themes' => [
                'last_checked' => $checked($themes_t),
                'checked' => is_object($themes_t) && isset($themes_t->checked) ? count((array) $themes_t->checked) : 0,
                'updates' => $themes,
            ],
            'core' => [
                'last_checked' => $checked($core_t),
                'current' => (string) get_bloginfo('version'),
                'version_checked' => is_object($core_t) && isset($core_t->version_checked) ? (string) $core_t->version_checked : null,
                'upgrade_to' => $upgrade,
                'offers' => $offers,
                // On a hosted site WordPress itself comes with the hosting
                // image, so it is updated by the platform, not on the site.
                'managed_by_platform' => $hosted,
            ],
            'hosted' => $hosted,
        ];
    }
}
