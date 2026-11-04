<?php
/**
 * WebMaven Alert Detector
 * Runs local checks inside WordPress and reports findings to the API.
 * Scheduled via WP cron every 15 minutes.
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/class-webmaven-log.php';

class WebMaven_Alert_Detector {

    private $api_client;

    public function __construct() {
        $this->api_client = new WebMaven_WP_API_Client();
    }

    /**
     * Register WP cron schedules and hooks.
     */
    public static function init() {
        // Custom 5-minute interval for heartbeat
        add_filter('cron_schedules', function($schedules) {
            $schedules['webmaven_5min'] = ['interval' => 300, 'display' => 'Every 5 minutes'];
            $schedules['webmaven_15min'] = ['interval' => 900, 'display' => 'Every 15 minutes'];
            $schedules['webmaven_daily'] = ['interval' => DAY_IN_SECONDS, 'display' => 'Once daily'];
            return $schedules;
        });

        // Schedule heartbeat
        if (!wp_next_scheduled('webmaven_heartbeat')) {
            wp_schedule_event(time(), 'webmaven_5min', 'webmaven_heartbeat');
        }
        add_action('webmaven_heartbeat', [__CLASS__, 'send_heartbeat']);

        // Schedule alert checks
        if (!wp_next_scheduled('webmaven_alert_check')) {
            wp_schedule_event(time(), 'webmaven_15min', 'webmaven_alert_check');
        }
        add_action('webmaven_alert_check', [__CLASS__, 'run_checks']);

        // Schedule hourly metrics push (one row per day, updated each hour)
        if (!wp_next_scheduled('webmaven_metrics_push')) {
            wp_schedule_event(time(), 'hourly', 'webmaven_metrics_push');
        }
        add_action('webmaven_metrics_push', [__CLASS__, 'push_metrics']);
    }

    /**
     * Collect business metrics from all detected adapters and push to the API.
     */
    public static function push_metrics() {
        $instance_id = get_option('webmaven_wp_instance_id', '');
        if (!$instance_id) return;

        $api_client = new WebMaven_WP_API_Client();
        if (!$api_client->is_configured()) return;

        // Load the metrics registry
        if (!class_exists('WebMaven_Metrics_Registry')) {
            require_once WEBMAVEN_WP_DIR . 'includes/metrics-adapters/class-metrics-registry.php';
        }

        $registry = new WebMaven_Metrics_Registry();
        $sources = $registry->get_available_sources();

        if (empty($sources)) return;

        $date = gmdate('Y-m-d');
        $hour = (int) gmdate('G'); // 0-23 UTC
        $metrics = [];

        foreach ($sources as $source_info) {
            $key = $source_info['key'];
            try {
                $data = $registry->get_metrics($key, $date);
                if ($data) {
                    $metrics[] = [
                        'source' => $key,
                        'date' => $date,
                        'hour' => $hour,
                        'data' => $data,
                    ];
                }
            } catch (\Exception $e) {
                WebMaven_Log::write("WebMaven Metrics: Failed to collect {$key} — " . $e->getMessage());
            }
        }

        if (empty($metrics)) return;

        $api_client->make_request('/metrics/report', 'POST', [
            'instanceId' => $instance_id,
            'metrics' => $metrics,
        ]);
    }

    /**
     * This site's WPMaven instance id, or '' when the site is not registered.
     * An id that could not be a path segment is treated as missing: the
     * heartbeat puts it in the API path.
     */
    public static function instance_id() {
        $instance_id = get_option('webmaven_wp_instance_id', '');
        if (!is_scalar($instance_id)) {
            return '';
        }
        $instance_id = (string) $instance_id;
        return preg_match('/^[A-Za-z0-9_-]{1,128}$/', $instance_id) ? $instance_id : '';
    }

    /**
     * Send heartbeat to the API.
     */
    public static function send_heartbeat() {
        // The instance id lives in webmaven_wp_instance_id (written by
        // activation, the OAuth callback and provisioning). This read
        // webmaven_wp_settings['instance_id'], which nothing writes, so no
        // heartbeat was ever sent (1.2.9; metrics was fixed the same way).
        $instance_id = self::instance_id();
        if (!$instance_id) return;

        $api_client = new WebMaven_WP_API_Client();
        if (!$api_client->is_configured()) return;

        // The site's title: a business still named after its address (the
        // ones called "localhost") takes it; a name the owner chose stays.
        $site_name = function_exists('wp_specialchars_decode') && function_exists('get_bloginfo')
            ? trim(wp_specialchars_decode((string) get_bloginfo('name'), ENT_QUOTES))
            : '';
        $body = $site_name !== '' ? ['siteName' => $site_name] : [];
        // What the site runs (1.3.0), for its Health tab.
        $body['versions'] = self::versions();
        $api_client->make_request("/instances/{$instance_id}/heartbeat", 'POST', $body);
    }

    /** WordPress, PHP and plugin versions, as plain version strings (null when unknown). */
    public static function versions() {
        $clean = function ($v) {
            $v = is_string($v) ? trim($v) : '';
            return preg_match('/^\d+(\.\d+){0,3}$/', $v) && strlen($v) <= 20 ? $v : null;
        };
        return [
            'wordpress' => $clean(function_exists('get_bloginfo') ? get_bloginfo('version') : ''),
            'php' => $clean(preg_replace('/[^0-9.].*$/', '', PHP_VERSION)),
            'plugin' => $clean(defined('WEBMAVEN_WP_VERSION') ? WEBMAVEN_WP_VERSION : ''),
        ];
    }

    /**
     * Run all local alert checks and report to API.
     */
    public static function run_checks() {
        // Same fix as send_heartbeat(): no alert report was ever sent (1.2.9).
        $instance_id = self::instance_id();
        if (!$instance_id) return;

        $api_client = new WebMaven_WP_API_Client();
        if (!$api_client->is_configured()) return;

        $detector = new self();
        $alerts = [];
        $resolved = [];

        // Run each detector (every 15 min)
        $checks = [
            'check_plugin_updates',
            'check_ssl_expiry',
            'check_content_stale',
            'check_site_slow',
            'check_wp_core_update',
            'check_theme_update',
            'check_debug_mode',
            'check_comments_pending',
            'check_new_admin_user',
            'check_theme_changed',
            'check_unknown_plugin',
        ];

        // Daily checks (run once per day)
        $last_daily = get_option('webmaven_last_daily_check', '');
        if ($last_daily !== gmdate('Y-m-d')) {
            $checks = array_merge($checks, [
                'check_php_version',
                'check_inactive_plugins',
                'check_disk_space',
            ]);
            update_option('webmaven_last_daily_check', gmdate('Y-m-d'));
        }

        foreach ($checks as $check) {
            try {
                $result = $detector->$check();
                if ($result) {
                    $alerts[] = $result;
                } else {
                    // No issue found — report the type as resolved
                    $resolved[] = $detector->get_resolved_type($check);
                }
            } catch (\Exception $e) {
                WebMaven_Log::write("WebMaven Alert Detector: {$check} failed: " . $e->getMessage());
            }
        }

        $resolved = array_filter($resolved);

        if (empty($alerts) && empty($resolved)) return;

        // Report to API
        $api_client->make_request('/alerts/report', 'POST', [
            'instanceId' => $instance_id,
            'alerts' => $alerts,
            'resolvedTypes' => array_values($resolved),
        ]);
    }

    /**
     * Map check method to AlertType for resolution reporting.
     */
    private function get_resolved_type($check) {
        $map = [
            'check_plugin_updates' => 'PLUGIN_UPDATE',
            'check_ssl_expiry' => 'SSL_EXPIRING',
            'check_content_stale' => 'CONTENT_STALE',
            'check_site_slow' => 'SITE_SLOW',
            'check_wp_core_update' => 'WP_CORE_UPDATE',
            'check_theme_update' => 'THEME_UPDATE',
            'check_debug_mode' => 'DEBUG_MODE_ON',
            'check_comments_pending' => 'COMMENTS_PENDING',
            'check_php_version' => 'PHP_DEPRECATED',
            'check_inactive_plugins' => 'INACTIVE_PLUGINS',
            'check_disk_space' => 'DISK_SPACE_LOW',
        ];
        return $map[$check] ?? null;
    }

    // ── Detectors ─────────────────────────────────────

    /**
     * Check for plugin updates.
     */
    private function check_plugin_updates() {
        if (!function_exists('get_plugin_updates')) {
            require_once ABSPATH . 'wp-admin/includes/update.php';
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }

        wp_update_plugins();
        $updates = get_plugin_updates();

        if (empty($updates)) return null;

        $count = count($updates);
        $names = array_map(function($plugin) {
            return $plugin->Name ?? $plugin->slug ?? 'Unknown';
        }, $updates);

        // Check for security updates (heuristic: version bump description mentions "security")
        $security_count = 0;
        foreach ($updates as $plugin) {
            if (isset($plugin->update->upgrade_notice) &&
                stripos($plugin->update->upgrade_notice, 'security') !== false) {
                $security_count++;
            }
        }

        if ($security_count > 0) {
            return [
                'type' => 'SECURITY_UPDATE',
                'severity' => 'WARNING',
                'title' => "{$security_count} security update" . ($security_count > 1 ? 's' : '') . " available",
                'message' => "There " . ($security_count === 1 ? "is a security update" : "are {$security_count} security updates") . " available for your plugins. We recommend updating them to keep your site safe.",
                'data' => ['count' => $security_count, 'plugins' => array_slice($names, 0, 5)],
            ];
        }

        if ($count >= 3) {
            return [
                'type' => 'PLUGIN_UPDATE',
                'severity' => 'INFO',
                'title' => "{$count} plugin updates available",
                'message' => "You have {$count} plugins that can be updated. Keeping them up to date helps with security and performance.",
                'data' => ['count' => $count, 'plugins' => array_slice($names, 0, 5)],
            ];
        }

        return null;
    }

    /**
     * Check SSL certificate expiry.
     */
    private function check_ssl_expiry() {
        $site_url = get_site_url();
        if (strpos($site_url, 'https://') !== 0) return null;

        $hostname = wp_parse_url($site_url, PHP_URL_HOST);
        $context = stream_context_create(['ssl' => ['capture_peer_cert' => true]]);

        $stream = @stream_socket_client(
            "ssl://{$hostname}:443",
            $errno, $errstr, 5,
            STREAM_CLIENT_CONNECT, $context
        );

        if (!$stream) return null;

        $params = stream_context_get_params($stream);
        // A TLS socket opened only to read the certificate, not a file.
        fclose($stream); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose

        $cert = $params['options']['ssl']['peer_certificate'] ?? null;
        if (!$cert) return null;

        $cert_info = openssl_x509_parse($cert);
        if (!$cert_info || !isset($cert_info['validTo_time_t'])) return null;

        $days_until = floor(($cert_info['validTo_time_t'] - time()) / 86400);

        if ($days_until <= 3) {
            return [
                'type' => 'SSL_EXPIRING',
                'severity' => 'CRITICAL',
                'title' => 'Your SSL certificate expires very soon',
                'message' => "Your SSL certificate expires in {$days_until} day" . ($days_until !== 1 ? 's' : '') . ". Without it, browsers will show a security warning to your visitors.",
                'data' => ['daysUntilExpiry' => $days_until],
            ];
        }

        if ($days_until <= 14) {
            return [
                'type' => 'SSL_EXPIRING',
                'severity' => 'WARNING',
                'title' => 'Your SSL certificate is expiring soon',
                'message' => "Your SSL certificate expires in {$days_until} days. Most hosting providers renew it automatically, but it's good to check.",
                'data' => ['daysUntilExpiry' => $days_until],
            ];
        }

        return null;
    }

    /**
     * Check for stale content.
     */
    private function check_content_stale() {
        $latest = get_posts([
            'numberposts' => 1,
            'post_status' => 'publish',
            'orderby' => 'date',
            'order' => 'DESC',
        ]);

        if (empty($latest)) return null;

        $days_since = floor((time() - strtotime($latest[0]->post_date)) / 86400);

        if ($days_since >= 30) {
            return [
                'type' => 'CONTENT_STALE',
                'severity' => 'WARNING',
                'title' => "You haven't published in a while",
                'message' => "Your last post was {$days_since} days ago. Regular content helps with search engine rankings and keeps visitors coming back.",
                'data' => ['daysSinceLastPost' => $days_since, 'lastPostTitle' => $latest[0]->post_title],
            ];
        }

        if ($days_since >= 14) {
            return [
                'type' => 'CONTENT_STALE',
                'severity' => 'INFO',
                'title' => 'Time for a new post?',
                'message' => "It's been {$days_since} days since your last post. Publishing regularly helps keep your audience engaged.",
                'data' => ['daysSinceLastPost' => $days_since, 'lastPostTitle' => $latest[0]->post_title],
            ];
        }

        return null;
    }

    /**
     * Check site response time.
     */
    private function check_site_slow() {
        $start = microtime(true);
        $response = wp_remote_get(get_site_url(), ['timeout' => 10, 'sslverify' => false]);
        $load_time = (microtime(true) - $start) * 1000; // ms

        if (is_wp_error($response)) return null;

        if ($load_time > 5000) {
            return [
                'type' => 'SITE_SLOW',
                'severity' => 'WARNING',
                'title' => 'Your site is loading slowly',
                'message' => "Your site took " . round($load_time / 1000, 1) . " seconds to respond. Visitors may leave if it takes too long.",
                'data' => ['loadTimeMs' => round($load_time)],
            ];
        }

        if ($load_time > 3000) {
            return [
                'type' => 'SITE_SLOW',
                'severity' => 'INFO',
                'title' => 'Your site is a bit slow',
                'message' => "Your site took " . round($load_time / 1000, 1) . " seconds to respond. It's not critical, but faster is always better.",
                'data' => ['loadTimeMs' => round($load_time)],
            ];
        }

        return null;
    }

    // ── New detectors ─────────────────────────────────

    private function check_wp_core_update() {
        if (!function_exists('get_core_updates')) {
            require_once ABSPATH . 'wp-admin/includes/update.php';
        }
        wp_version_check();
        $updates = get_core_updates();
        if (empty($updates) || !is_array($updates)) return null;

        foreach ($updates as $update) {
            if (isset($update->response) && $update->response === 'upgrade') {
                return [
                    'type' => 'WP_CORE_UPDATE',
                    'severity' => 'WARNING',
                    'title' => "WordPress {$update->version} is available",
                    'message' => "Your site is running WordPress " . get_bloginfo('version') . ". Version {$update->version} is available with improvements and security fixes.",
                    'data' => ['current' => get_bloginfo('version'), 'available' => $update->version],
                ];
            }
        }
        return null;
    }

    private function check_theme_update() {
        if (!function_exists('get_theme_updates')) {
            require_once ABSPATH . 'wp-admin/includes/update.php';
            require_once ABSPATH . 'wp-admin/includes/theme.php';
        }
        $updates = get_theme_updates();
        if (empty($updates)) return null;

        $active = get_stylesheet();
        if (isset($updates[$active])) {
            $theme = $updates[$active];
            return [
                'type' => 'THEME_UPDATE',
                'severity' => 'INFO',
                'title' => "Theme update available: {$theme->get('Name')}",
                'message' => "Your active theme has an update available. Updating keeps your site compatible and secure.",
                'data' => ['theme' => $theme->get('Name'), 'current' => $theme->get('Version')],
            ];
        }
        return null;
    }

    private function check_debug_mode() {
        if (defined('WP_DEBUG') && WP_DEBUG && defined('WP_DEBUG_DISPLAY') && WP_DEBUG_DISPLAY) {
            return [
                'type' => 'DEBUG_MODE_ON',
                'severity' => 'WARNING',
                'title' => 'Debug mode is enabled on your live site',
                'message' => 'WP_DEBUG and WP_DEBUG_DISPLAY are both enabled. PHP errors and warnings are visible to your visitors. Disable this in wp-config.php.',
                'data' => [],
            ];
        }
        return null;
    }

    private function check_comments_pending() {
        $counts = wp_count_comments();
        $pending = (int) ($counts->moderated ?? 0);
        if ($pending > 10) {
            return [
                'type' => 'COMMENTS_PENDING',
                'severity' => 'INFO',
                'title' => "{$pending} comments awaiting moderation",
                'message' => "You have {$pending} pending comments. Responding to comments boosts engagement and SEO.",
                'data' => ['pending' => $pending],
            ];
        }
        return null;
    }

    private function check_new_admin_user() {
        $admins = get_users(['role' => 'administrator', 'fields' => 'ID']);
        $admin_ids = array_map('intval', $admins);
        sort($admin_ids);

        $known = get_option('webmaven_known_admin_ids', null);
        if ($known === null) {
            // First run — store baseline, don't alert
            update_option('webmaven_known_admin_ids', $admin_ids);
            return null;
        }

        $new_admins = array_diff($admin_ids, $known);
        update_option('webmaven_known_admin_ids', $admin_ids);

        // An account WPMaven's own one-click sign-in created (the owner's, or
        // a staff member's under the owner's grant) is not an intruder. It
        // carries the sign-in's marker. This check never ran before 1.2.9
        // (the alert push read an instance id nothing wrote), so without this
        // every one-click sign-in would page the owner with a CRITICAL alert.
        $marker = class_exists('WebMaven_Actor') ? WebMaven_Actor::MARKER_META : '_webmaven_admin_login_created';
        $new_admins = array_filter($new_admins, function ($uid) use ($marker) {
            return !get_user_meta($uid, $marker, true);
        });

        if (!empty($new_admins)) {
            $names = [];
            foreach ($new_admins as $uid) {
                $u = get_userdata($uid);
                if ($u) $names[] = $u->user_login;
            }
            return [
                'type' => 'NEW_ADMIN_USER',
                'severity' => 'CRITICAL',
                'title' => 'New administrator account detected',
                'message' => 'A new administrator account was created: ' . implode(', ', $names) . '. If you did not create this, your site may be compromised.',
                'data' => ['newAdmins' => $names],
            ];
        }
        return null;
    }

    private function check_theme_changed() {
        $current = get_stylesheet();
        $stored = get_option('webmaven_known_theme', null);

        if ($stored === null) {
            update_option('webmaven_known_theme', $current);
            return null;
        }

        if ($current !== $stored) {
            update_option('webmaven_known_theme', $current);
            return [
                'type' => 'THEME_CHANGED',
                'severity' => 'WARNING',
                'title' => "Theme changed to \"{$current}\"",
                'message' => "Your active theme was changed from \"{$stored}\" to \"{$current}\". If this wasn't intentional, investigate immediately.",
                'data' => ['previous' => $stored, 'current' => $current],
            ];
        }
        return null;
    }

    private function check_unknown_plugin() {
        $active = get_option('active_plugins', []);
        $slugs = array_map(function($p) { return dirname($p); }, $active);
        sort($slugs);

        $known = get_option('webmaven_known_plugins', null);
        if ($known === null) {
            update_option('webmaven_known_plugins', $slugs);
            return null;
        }

        $new_plugins = array_diff($slugs, $known);
        update_option('webmaven_known_plugins', $slugs);

        if (!empty($new_plugins)) {
            return [
                'type' => 'UNKNOWN_PLUGIN',
                'severity' => 'WARNING',
                'title' => 'New plugin activated: ' . implode(', ', $new_plugins),
                'message' => 'A new plugin was activated on your site: ' . implode(', ', $new_plugins) . '. Verify this was intentional.',
                'data' => ['newPlugins' => array_values($new_plugins)],
            ];
        }
        return null;
    }

    private function check_php_version() {
        $version = phpversion();
        $major_minor = implode('.', array_slice(explode('.', $version), 0, 2));

        // PHP EOL dates (approximate)
        $eol_dates = [
            '7.4' => '2022-11-28',
            '8.0' => '2023-11-26',
            '8.1' => '2025-12-31',
            '8.2' => '2026-12-31',
            '8.3' => '2027-12-31',
        ];

        $eol = $eol_dates[$major_minor] ?? null;
        if (!$eol) return null;

        $eol_ts = strtotime($eol);
        $months_until = (int) (($eol_ts - time()) / (30 * 86400));

        if ($months_until < 0) {
            return [
                'type' => 'PHP_DEPRECATED',
                'severity' => 'CRITICAL',
                'title' => "PHP {$major_minor} has reached end of life",
                'message' => "Your server runs PHP {$version}, which no longer receives security updates. Upgrade to PHP 8.2+ for security and performance.",
                'data' => ['version' => $version, 'eol' => $eol],
            ];
        }

        if ($months_until < 12) {
            return [
                'type' => 'PHP_DEPRECATED',
                'severity' => 'WARNING',
                'title' => "PHP {$major_minor} reaches end of life in {$months_until} months",
                'message' => "Your PHP version ({$version}) will stop receiving security updates on {$eol}. Plan an upgrade to avoid vulnerabilities.",
                'data' => ['version' => $version, 'eol' => $eol, 'monthsUntil' => $months_until],
            ];
        }

        return null;
    }

    private function check_inactive_plugins() {
        if (!function_exists('get_plugins')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        $all = get_plugins();
        $active = get_option('active_plugins', []);
        $inactive = array_diff(array_keys($all), $active);

        if (count($inactive) > 3) {
            $names = array_map(function($f) use ($all) { return $all[$f]['Name'] ?? $f; }, array_slice($inactive, 0, 5));
            return [
                'type' => 'INACTIVE_PLUGINS',
                'severity' => 'INFO',
                'title' => count($inactive) . ' inactive plugins installed',
                'message' => 'Inactive plugins can be a security risk and slow down your site. Consider deleting ones you don\'t need: ' . implode(', ', $names) . '.',
                'data' => ['count' => count($inactive), 'plugins' => $names],
            ];
        }
        return null;
    }

    private function check_disk_space() {
        $free = @disk_free_space(ABSPATH);
        if ($free === false) return null;

        $free_mb = round($free / 1048576);

        if ($free_mb < 100) {
            return [
                'type' => 'DISK_SPACE_LOW',
                'severity' => 'CRITICAL',
                'title' => "Disk space critically low: {$free_mb}MB remaining",
                'message' => "Your server has only {$free_mb}MB of free disk space. This can cause uploads to fail and your site to crash. Free up space or upgrade your hosting.",
                'data' => ['freeMb' => $free_mb],
            ];
        }

        if ($free_mb < 500) {
            return [
                'type' => 'DISK_SPACE_LOW',
                'severity' => 'WARNING',
                'title' => "Disk space running low: {$free_mb}MB remaining",
                'message' => "Your server has {$free_mb}MB of free disk space. Consider cleaning up old media files or upgrading your hosting plan.",
                'data' => ['freeMb' => $free_mb],
            ];
        }

        return null;
    }
}
