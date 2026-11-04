<?php
/**
 * publish_preflight: what a publish needs to know about this site before it
 * starts (read-only).
 *
 * The API asks before the finish build spends anything and before anything
 * is written, so a publish that cannot finish never starts: WordPress or PHP
 * too old for a plugin the business needs, plugin installs turned off, files
 * that cannot be written, a full disk, WordPress.org out of reach. It also
 * learns what the build will decide: whether the front page would be set
 * (WebMaven_Front_Page::verdict), which of WordPress's untouched sample pages
 * are there (WebMaven_Default_Content), the site's language and the store's
 * currency and country.
 *
 *   in:  { plugins: string[] (WordPress.org slugs the business needs),
 *          refresh?: bool (ask WordPress.org for core updates again) }
 *   out: { versions: { wordpress, php, plugin }, can_install_plugins,
 *          filesystem_direct, writable: { plugins, themes, uploads },
 *          disk_free_mb, hosted, core_update: null | { version },
 *          plugins: [{ slug, installed, active, version, latest, requires_wp,
 *                      requires_php, compatible, reason: null | 'wp_too_old'
 *                      | 'php_too_old' | 'not_found', source_reachable }],
 *          front: { show_on_front, page_on_front, page_on_front_title,
 *                   page_for_posts, owner_content: { posts, pages }, would_set },
 *          defaults: [{ kind, id }], locale,
 *          woocommerce: null | { currency, default_country } }
 *
 * An older plugin answers "Unknown command": the API reads that as "this
 * site needs the plugin update", never as a pass.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once dirname(__DIR__) . '/class-webmaven-log.php';

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['publish_preflight'] = ['WebMaven_Cap_Publish_Preflight', 'run'];
    return $handlers;
});

class WebMaven_Cap_Publish_Preflight {

    /** Plugins checked per call (a business needs two or three). */
    const MAX_PLUGINS = 10;

    public static function run($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        foreach (['plugin.php', 'file.php', 'misc.php', 'plugin-install.php', 'update.php'] as $inc) {
            if (file_exists(ABSPATH . 'wp-admin/includes/' . $inc)) {
                require_once ABSPATH . 'wp-admin/includes/' . $inc;
            }
        }
        $slugs = [];
        foreach ((array) ($params['plugins'] ?? []) as $slug) {
            $slug = strtolower(trim((string) $slug));
            if (preg_match('/^[a-z0-9][a-z0-9-]{0,99}$/', $slug) && !in_array($slug, $slugs, true)) {
                $slugs[] = $slug;
            }
            if (count($slugs) >= self::MAX_PLUGINS) {
                break;
            }
        }
        $refresh = !empty($params['refresh']);

        $plugins = [];
        foreach ($slugs as $slug) {
            $plugins[] = self::guard(function () use ($slug) {
                return self::plugin_report($slug);
            }, ['slug' => $slug, 'installed' => false, 'active' => false, 'version' => null, 'latest' => null,
                'requires_wp' => null, 'requires_php' => null, 'compatible' => false, 'reason' => null, 'source_reachable' => false]);
        }

        $front = self::guard(function () {
            $setting = WebMaven_Front_Page::setting();
            $verdict = WebMaven_Front_Page::verdict();
            return array_merge($setting, ['owner_content' => $verdict['owner_content'], 'would_set' => (bool) $verdict['would_set']]);
        }, null);

        $defaults = self::guard(function () {
            $out = [];
            if (class_exists('WebMaven_Default_Content')) {
                foreach (WebMaven_Default_Content::untouched_defaults() as $d) {
                    $out[] = ['kind' => $d['kind'], 'id' => (int) $d['post']->ID];
                }
            }
            return $out;
        }, []);

        return [
            'versions' => [
                'wordpress' => self::wp_version(),
                'php' => PHP_VERSION,
                'plugin' => defined('WEBMAVEN_WP_VERSION') ? (string) WEBMAVEN_WP_VERSION : null,
            ],
            'can_install_plugins' => self::can_install_plugins(),
            'filesystem_direct' => self::guard(function () {
                return function_exists('get_filesystem_method') && get_filesystem_method() === 'direct';
            }, false),
            'writable' => [
                'plugins' => self::writable(defined('WP_PLUGIN_DIR') ? WP_PLUGIN_DIR : null),
                'themes' => self::writable(function_exists('get_theme_root') ? get_theme_root() : null),
                'uploads' => self::writable(self::uploads_dir()),
            ],
            'disk_free_mb' => self::disk_free_mb(),
            'hosted' => class_exists('WebMaven_Cap_Diagnostics') && WebMaven_Cap_Diagnostics::is_hosted(),
            'core_update' => self::guard(function () use ($refresh) {
                return self::core_update($refresh);
            }, null),
            'plugins' => $plugins,
            'front' => $front,
            'defaults' => $defaults,
            'locale' => function_exists('get_locale') ? (string) get_locale() : null,
            'woocommerce' => self::woocommerce(),
        ];
    }

    /** One needed plugin: what is installed, what WordPress.org offers, and whether it can run here. */
    private static function plugin_report($slug) {
        $report = ['slug' => $slug, 'installed' => false, 'active' => false, 'version' => null, 'latest' => null,
            'requires_wp' => null, 'requires_php' => null, 'compatible' => false, 'reason' => null, 'source_reachable' => true];
        $file = null;
        $headers = [];
        foreach ((function_exists('get_plugins') ? (array) get_plugins() : []) as $plugin_file => $data) {
            if (strpos((string) $plugin_file, $slug . '/') === 0) {
                $file = (string) $plugin_file;
                $headers = is_array($data) ? $data : [];
                break;
            }
        }
        if ($file !== null) {
            // Installed: its own headers say what it needs.
            $report['installed'] = true;
            $report['active'] = function_exists('is_plugin_active') && is_plugin_active($file);
            $report['version'] = (string) ($headers['Version'] ?? '') ?: null;
            $report['requires_wp'] = trim((string) ($headers['RequiresWP'] ?? '')) ?: null;
            $report['requires_php'] = trim((string) ($headers['RequiresPHP'] ?? '')) ?: null;
            $updates = function_exists('get_site_transient') ? get_site_transient('update_plugins') : null;
            $offer = (is_object($updates) && isset($updates->response[$file])) ? $updates->response[$file] : null;
            $report['latest'] = $offer && !empty($offer->new_version) ? (string) $offer->new_version : $report['version'];
        } else {
            $api = function_exists('plugins_api') ? plugins_api('plugin_information', [
                'slug' => $slug,
                'fields' => [
                    'short_description' => false, 'sections' => false, 'requires' => true, 'requires_php' => true,
                    'rating' => false, 'ratings' => false, 'downloaded' => false, 'last_updated' => false, 'added' => false,
                    'tags' => false, 'compatibility' => false, 'homepage' => false, 'donate_link' => false, 'versions' => false,
                ],
            ]) : null;
            if (!is_object($api) || is_wp_error($api)) {
                // plugins_api_failed: the transport's message rides as the
                // error data when WordPress.org could not be reached; "Plugin
                // not found." comes from WordPress.org itself.
                $data = is_wp_error($api) ? $api->get_error_data() : null;
                $message = is_wp_error($api) ? (string) $api->get_error_message() : '';
                $not_found = is_wp_error($api) && !(is_string($data) && $data !== '') && preg_match('/not\s+found/i', $message);
                $report['source_reachable'] = (bool) $not_found;
                $report['reason'] = $not_found ? 'not_found' : null;
                return $report;
            }
            $report['latest'] = (string) ($api->version ?? '') ?: null;
            $report['requires_wp'] = trim((string) ($api->requires ?? '')) ?: null;
            $report['requires_php'] = trim((string) ($api->requires_php ?? '')) ?: null;
        }
        $wp_ok = $report['requires_wp'] === null || WebMaven_WordPress_Commands::wp_version_ok($report['requires_wp']);
        $php_ok = $report['requires_php'] === null || WebMaven_WordPress_Commands::php_version_ok($report['requires_php']);
        $report['compatible'] = $wp_ok && $php_ok;
        $report['reason'] = !$wp_ok ? 'wp_too_old' : (!$php_ok ? 'php_too_old' : null);
        return $report;
    }

    private static function wp_version() {
        global $wp_version;
        if (is_string($wp_version) && $wp_version !== '') {
            return $wp_version;
        }
        return function_exists('get_bloginfo') ? (string) get_bloginfo('version') : null;
    }

    /** WordPress may install plugins here: the acting administrator may, and file changes are not turned off. */
    private static function can_install_plugins() {
        if (defined('DISALLOW_FILE_MODS') && DISALLOW_FILE_MODS) {
            return false;
        }
        return function_exists('current_user_can') && current_user_can('install_plugins');
    }

    private static function writable($dir) {
        if (!is_string($dir) || $dir === '') {
            return false;
        }
        return (bool) wp_is_writable($dir);
    }

    private static function uploads_dir() {
        if (!function_exists('wp_upload_dir')) {
            return null;
        }
        $uploads = wp_upload_dir(null, false);
        return is_array($uploads) && !empty($uploads['basedir']) ? (string) $uploads['basedir'] : null;
    }

    private static function disk_free_mb() {
        if (!function_exists('disk_free_space') || !defined('WP_CONTENT_DIR')) {
            return null;
        }
        $bytes = @disk_free_space(WP_CONTENT_DIR);
        return is_numeric($bytes) ? (int) floor($bytes / 1048576) : null;
    }

    /** An upgrade WordPress offers for itself (its own update check), or null. */
    private static function core_update($refresh) {
        if ($refresh && function_exists('wp_version_check')) {
            wp_version_check([], true);
        }
        if (!function_exists('get_core_updates')) {
            return null;
        }
        foreach ((array) get_core_updates() as $offer) {
            if (is_object($offer) && ($offer->response ?? '') === 'upgrade') {
                $version = (string) ($offer->version ?? $offer->current ?? '');
                return $version !== '' ? ['version' => $version] : null;
            }
        }
        return null;
    }

    private static function woocommerce() {
        if (!class_exists('WooCommerce') && !function_exists('WC')) {
            return null;
        }
        return [
            'currency' => (string) get_option('woocommerce_currency', ''),
            'default_country' => (string) get_option('woocommerce_default_country', ''),
        ];
    }

    /** One check that fails never fails the preflight: its fallback answers instead. */
    private static function guard(callable $check, $fallback) {
        try {
            return $check();
        } catch (\Throwable $e) {
            if (function_exists('error_log')) {
                WebMaven_Log::write('WebMaven: publish_preflight check failed: ' . $e->getMessage());
            }
            return $fallback;
        }
    }
}
