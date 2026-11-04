<?php
/**
 * Images WPMaven hosts for its drafts (2026-10-05). The page editor's AI
 * makes its images as drafts on WPMaven's media host, so an edit the owner
 * discards leaves no file in the media library. When a page or a post is
 * saved with such an image, the image is copied into the media library and
 * the content points at the copy: the site then serves its own file.
 *
 * Only WPMaven's own hosts and its own file names are read (a 32-hex name
 * under /api/public/images/ on the API host, under /images/ on the media
 * host), through WordPress's safe download, a few per save. An image already
 * copied once is reused. One that cannot be copied keeps its hosted address,
 * which keeps working.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once dirname(__DIR__) . '/class-webmaven-log.php';

add_filter('wp_insert_post_data', ['WebMaven_Cap_Hosted_Images', 'on_save'], 20, 2);

final class WebMaven_Cap_Hosted_Images {

    /** WPMaven's public media host (the API's PUBLIC_MEDIA_BASE_URL). */
    const MEDIA_HOST = 'media.wpmaven.site';

    /** Images copied in one save, and how long one download may take. */
    const MAX_PER_SAVE = 6;
    const TIMEOUT = 15;

    /** The hosted file name an attachment was copied from (reused by the next save). */
    const SOURCE_META = '_wm_hosted_source';

    /** Saves that are never pages or posts of the owner. */
    const SKIPPED_TYPES = ['revision', 'attachment', 'nav_menu_item', 'customize_changeset', 'oembed_cache', 'user_request', 'wp_global_styles', 'wp_navigation'];

    /** A hosted image address: scheme, host (and port), path, then the 32-hex file. */
    const URL_PATTERN = '#https?://[a-z0-9.-]+(?::\d{1,5})?(?:/[a-z0-9._~%-]+)*?/([a-f0-9]{32}\.(?:jpg|png|webp))(?![\w.%-])#i';

    /**
     * wp_insert_post_data: the content's hosted images, copied into the media
     * library, the content pointing at the copies. Never stops a save.
     */
    public static function on_save($data, $postarr = []) {
        try {
            if (!is_array($data) || !isset($data['post_content']) || !is_string($data['post_content'])) {
                return $data;
            }
            if (in_array((string) ($data['post_type'] ?? ''), self::SKIPPED_TYPES, true)
                || (string) ($data['post_status'] ?? '') === 'auto-draft'
                || (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE)) {
                return $data;
            }
            // The content arrives slashed; an image address carries no
            // character slashing changes, so it is found and replaced as is.
            $urls = self::hosted_urls($data['post_content']);
            if (!$urls) {
                return $data;
            }
            $post_id = is_array($postarr) ? (int) ($postarr['ID'] ?? 0) : 0;
            $content = $data['post_content'];
            foreach (array_slice($urls, 0, self::MAX_PER_SAVE, true) as $url => $file) {
                $local = self::library_url($url, $file, $post_id);
                if ($local !== null) {
                    $content = str_replace($url, $local, $content);
                }
            }
            $data['post_content'] = $content;
        } catch (\Throwable $e) {
            WebMaven_Log::write('WPMaven: hosted images were not copied on save: ' . $e->getMessage());
        }
        return $data;
    }

    /** The WPMaven-hosted image addresses in a text: url => file name. */
    public static function hosted_urls(string $text): array {
        if (strpos($text, '://') === false || !preg_match_all(self::URL_PATTERN, $text, $m, PREG_SET_ORDER)) {
            return [];
        }
        $out = [];
        foreach ($m as $hit) {
            $url = $hit[0];
            if (!isset($out[$url]) && self::is_hosted($url, $hit[1])) {
                $out[$url] = strtolower($hit[1]);
            }
        }
        return $out;
    }

    /** True for an address on one of WPMaven's hosts, at the path that host serves its images from. */
    public static function is_hosted(string $url, string $file): bool {
        $host = strtolower((string) wp_parse_url($url, PHP_URL_HOST));
        $port = wp_parse_url($url, PHP_URL_PORT);
        $path = (string) wp_parse_url($url, PHP_URL_PATH);
        if ($host === '' || wp_parse_url($url, PHP_URL_USER) !== null || wp_parse_url($url, PHP_URL_QUERY) !== null) {
            return false;
        }
        $have = $port === null || $port === false ? null : (int) $port;
        foreach (self::hosts() as $allowed) {
            $want = $allowed['port'] === null || $allowed['port'] === false ? null : (int) $allowed['port'];
            if ($allowed['host'] !== $host || $want !== $have) {
                continue;
            }
            if ($path === $allowed['path'] . '/' . $file) {
                return true;
            }
        }
        return false;
    }

    /** WPMaven's hosts and the path each serves hosted images under. */
    private static function hosts(): array {
        $hosts = [['host' => self::MEDIA_HOST, 'port' => null, 'path' => '/images']];
        $api = defined('WEBMAVEN_WP_API_BASE_URL') ? (string) WEBMAVEN_WP_API_BASE_URL : '';
        $api_host = strtolower((string) wp_parse_url($api, PHP_URL_HOST));
        if ($api_host !== '') {
            $hosts[] = ['host' => $api_host, 'port' => wp_parse_url($api, PHP_URL_PORT), 'path' => '/api/public/images'];
        }
        $extra = apply_filters('webmaven_hosted_image_hosts', []);
        foreach (is_array($extra) ? $extra : [] as $h) {
            if (is_array($h) && !empty($h['host']) && isset($h['path'])) {
                $hosts[] = ['host' => strtolower((string) $h['host']), 'port' => $h['port'] ?? null, 'path' => rtrim((string) $h['path'], '/')];
            }
        }
        return $hosts;
    }

    /** The library copy of a hosted image (made now, or the one made before), or null. */
    private static function library_url(string $url, string $file, int $post_id) {
        $copied = get_posts([
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'meta_key' => self::SOURCE_META,
            'meta_value' => $file,
            'numberposts' => 1,
            'fields' => 'ids',
        ]);
        if ($copied) {
            $id = is_object($copied[0]) ? (int) $copied[0]->ID : (int) $copied[0];
            $existing = $id > 0 ? wp_get_attachment_url($id) : false;
            if ($existing) {
                return (string) $existing;
            }
        }
        if (!function_exists('download_url')) {
            require_once ABSPATH . 'wp-admin/includes/file.php';
        }
        if (!function_exists('media_handle_sideload')) {
            require_once ABSPATH . 'wp-admin/includes/media.php';
            require_once ABSPATH . 'wp-admin/includes/image.php';
        }
        $tmp = download_url($url, self::TIMEOUT);
        if (is_wp_error($tmp)) {
            return null;
        }
        $id = media_handle_sideload(['name' => $file, 'tmp_name' => $tmp], $post_id);
        if (is_wp_error($id) || (int) $id <= 0) {
            wp_delete_file($tmp);
            return null;
        }
        update_post_meta((int) $id, self::SOURCE_META, $file);
        $local = wp_get_attachment_url((int) $id);
        return $local ? (string) $local : null;
    }
}
