<?php
/**
 * A page's search engine fields, one service for every door (1.3.0): the
 * editor's SEO panel (webmaven/v1/seo/{id}), the API's signed commands
 * (seo_read, seo_update: the dashboard's Pages tab and its saves, which run
 * as edit operations with history and undo) and the head printer
 * (WebMaven_SEO_Head, when no SEO plugin is active).
 *
 * Fields, as the API names them:
 *   title, description, ogTitle, ogDescription   text
 *   ogImage                                       a media library id or an https address, or null
 *   noindex                                       hidden from search engines
 *
 * Reads take the active SEO plugin's keys first, then WPMaven's own
 * (_wme_*). Writes go to the active plugin's keys plus WPMaven's own, so the
 * value survives switching the plugin off. Known SEO plugins: Yoast SEO,
 * Rank Math, All in One SEO, SEOPress, The SEO Framework. All in One SEO
 * keeps no per-page "hide from search engines" key WPMaven can write: there
 * the switch is kept in WPMaven's own field only.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

final class WebMaven_SEO_Fields {

    const FIELDS = ['title', 'description', 'ogTitle', 'ogDescription', 'ogImage', 'noindex'];
    const TEXT_FIELDS = ['title', 'description', 'ogTitle', 'ogDescription'];

    /** WPMaven's own keys: read last, always written. */
    const OWN_KEYS = [
        'title' => '_wme_meta_title',
        'description' => '_wme_meta_description',
        'ogTitle' => '_wme_og_title',
        'ogDescription' => '_wme_og_description',
        'ogImage' => '_wme_og_image',
        'noindex' => '_wme_noindex',
    ];

    /** Longest value kept per text field (search engines show far less; the dashboard counts 60 and 155). */
    const MAX_LENGTH = ['title' => 300, 'description' => 1000, 'ogTitle' => 300, 'ogDescription' => 1000];

    /** The SEO plugins WPMaven reads and writes, in detection order, with their per-post keys. */
    public static function plugins() {
        return [
            'yoast' => ['name' => 'Yoast SEO', 'constant' => 'WPSEO_VERSION', 'keys' => [
                'title' => '_yoast_wpseo_title', 'description' => '_yoast_wpseo_metadesc',
                'ogTitle' => '_yoast_wpseo_opengraph-title', 'ogDescription' => '_yoast_wpseo_opengraph-description',
                'ogImage' => '_yoast_wpseo_opengraph-image', 'ogImageId' => '_yoast_wpseo_opengraph-image-id',
                'noindex' => '_yoast_wpseo_meta-robots-noindex',
            ]],
            'rankmath' => ['name' => 'Rank Math', 'constant' => 'RANK_MATH_VERSION', 'keys' => [
                'title' => 'rank_math_title', 'description' => 'rank_math_description',
                'ogTitle' => 'rank_math_facebook_title', 'ogDescription' => 'rank_math_facebook_description',
                'ogImage' => 'rank_math_facebook_image', 'ogImageId' => 'rank_math_facebook_image_id',
                'noindex' => 'rank_math_robots',
            ]],
            'aioseo' => ['name' => 'All in One SEO', 'constant' => 'AIOSEO_VERSION', 'keys' => [
                'title' => '_aioseo_title', 'description' => '_aioseo_description',
                'ogTitle' => '_aioseo_og_title', 'ogDescription' => '_aioseo_og_description',
                'ogImage' => '_aioseo_og_image_url',
            ]],
            'seopress' => ['name' => 'SEOPress', 'constant' => 'SEOPRESS_VERSION', 'keys' => [
                'title' => '_seopress_titles_title', 'description' => '_seopress_titles_desc',
                'ogTitle' => '_seopress_social_fb_title', 'ogDescription' => '_seopress_social_fb_desc',
                'ogImage' => '_seopress_social_fb_img',
                'noindex' => '_seopress_robots_index',
            ]],
            'tsf' => ['name' => 'The SEO Framework', 'constant' => 'THE_SEO_FRAMEWORK_VERSION', 'keys' => [
                'title' => '_genesis_title', 'description' => '_genesis_description',
                'ogTitle' => '_open_graph_title', 'ogDescription' => '_open_graph_description',
                'ogImage' => '_social_image_url', 'ogImageId' => '_social_image_id',
                'noindex' => '_genesis_noindex',
            ]],
        ];
    }

    /** The active SEO plugin's id ('yoast', 'rankmath'...), or null. */
    public static function active_plugin() {
        foreach (self::plugins() as $id => $plugin) {
            if (defined($plugin['constant'])) {
                return $id;
            }
        }
        return null;
    }

    /** The active SEO plugin's name ("Yoast SEO"), or null. */
    public static function active_plugin_name() {
        $id = self::active_plugin();
        return $id === null ? null : self::plugins()[$id]['name'];
    }

    private static function plugin_keys() {
        $id = self::active_plugin();
        return $id === null ? [] : self::plugins()[$id]['keys'];
    }

    // ── Reading ──────────────────────────────────────────────────────────

    /** Every field of one post, as stored: text '' when unset, ogImage null, noindex false. */
    public static function read($post_id) {
        $post_id = (int) $post_id;
        $plugin = self::plugin_keys();
        $out = [];
        foreach (self::TEXT_FIELDS as $field) {
            $value = '';
            if (isset($plugin[$field])) {
                $value = self::meta_text($post_id, $plugin[$field]);
            }
            if ($value === '') {
                $value = self::meta_text($post_id, self::OWN_KEYS[$field]);
            }
            $out[$field] = $value;
        }
        $out['ogImage'] = self::read_image($post_id, $plugin);
        $out['noindex'] = self::read_noindex($post_id, $plugin);
        return $out;
    }

    private static function meta_text($post_id, $key) {
        $value = get_post_meta($post_id, $key, true);
        return is_scalar($value) ? trim((string) $value) : '';
    }

    private static function read_image($post_id, array $plugin) {
        if (isset($plugin['ogImageId'])) {
            $id = (int) get_post_meta($post_id, $plugin['ogImageId'], true);
            if ($id > 0) {
                return $id;
            }
        }
        $own = self::meta_text($post_id, self::OWN_KEYS['ogImage']);
        $own = $own === '' ? null : (ctype_digit($own) ? (int) $own : $own);
        if (isset($plugin['ogImage'])) {
            $url = self::meta_text($post_id, $plugin['ogImage']);
            if ($url !== '') {
                // A plugin that keeps only the address: the media id WPMaven
                // wrote for that same address stays an id.
                return is_int($own) && self::image_url($own) === $url ? $own : $url;
            }
        }
        return $own;
    }

    private static function read_noindex($post_id, array $plugin) {
        if (isset($plugin['noindex'])) {
            $value = get_post_meta($post_id, $plugin['noindex'], true);
            switch (self::active_plugin()) {
                case 'yoast':
                case 'tsf':
                    if ((string) $value === '1') {
                        return true;
                    }
                    break;
                case 'rankmath':
                    if (is_array($value) && in_array('noindex', $value, true)) {
                        return true;
                    }
                    break;
                case 'seopress':
                    if ((string) $value === 'yes') {
                        return true;
                    }
                    break;
            }
        }
        return (string) get_post_meta($post_id, self::OWN_KEYS['noindex'], true) === '1';
    }

    /** The address of an ogImage value (a media id or a URL), or null. */
    public static function image_url($image) {
        if (is_int($image) && $image > 0) {
            $url = function_exists('wp_get_attachment_image_url') ? wp_get_attachment_image_url($image, 'full') : '';
            if (!$url && function_exists('wp_get_attachment_url')) {
                $url = wp_get_attachment_url($image);
            }
            return is_string($url) && $url !== '' ? $url : null;
        }
        return is_string($image) && $image !== '' ? $image : null;
    }

    // ── Writing ──────────────────────────────────────────────────────────

    /**
     * Check and clean the fields a caller wants to change. Unknown keys and
     * values of the wrong kind throw "VALIDATION: ...".
     */
    public static function clean(array $fields) {
        $out = [];
        foreach ($fields as $field => $value) {
            if (!in_array($field, self::FIELDS, true)) {
                throw new Exception('VALIDATION: ' . self::plain($field) . ' is not a search engine field.');
            }
            if (in_array($field, self::TEXT_FIELDS, true)) {
                if ($value === null) {
                    $value = '';
                }
                if (!is_string($value)) {
                    throw new Exception('VALIDATION: ' . $field . ' must be text.');
                }
                $value = sanitize_text_field($value);
                if (function_exists('mb_strlen') ? mb_strlen($value) > self::MAX_LENGTH[$field] : strlen($value) > self::MAX_LENGTH[$field]) {
                    throw new Exception('VALIDATION: ' . $field . ' is longer than ' . self::MAX_LENGTH[$field] . ' characters.');
                }
                $out[$field] = $value;
            } elseif ($field === 'noindex') {
                if (!is_bool($value) && $value !== 0 && $value !== 1) {
                    throw new Exception('VALIDATION: noindex must be true or false.');
                }
                $out[$field] = (bool) $value;
            } else { // ogImage
                if ($value === null || $value === '') {
                    $out[$field] = null;
                } elseif (is_int($value) || (is_string($value) && ctype_digit($value))) {
                    $id = (int) $value;
                    $mime = $id > 0 && function_exists('get_post_mime_type') ? (string) get_post_mime_type($id) : '';
                    if ($id <= 0 || strpos($mime, 'image/') !== 0) {
                        throw new Exception('NOT_FOUND: The image ' . $id . ' is not in the media library.');
                    }
                    $out[$field] = $id;
                } elseif (is_string($value) && preg_match('#^https://[^\s"\'<>]+$#i', $value)) {
                    $out[$field] = esc_url_raw($value, ['https']);
                } else {
                    throw new Exception('VALIDATION: ogImage must be a media library image or an https address.');
                }
            }
        }
        return $out;
    }

    /**
     * Write some fields of one post (only those given), after clean(). Writes
     * the active SEO plugin's keys and WPMaven's own. Answers the values
     * before and after, for the given keys only.
     */
    public static function write($post_id, array $fields) {
        $post_id = (int) $post_id;
        $clean = self::clean($fields);
        $before = self::read($post_id);
        $plugin = self::plugin_keys();
        foreach ($clean as $field => $value) {
            if (in_array($field, self::TEXT_FIELDS, true)) {
                if (isset($plugin[$field])) {
                    self::put($post_id, $plugin[$field], $value);
                }
                self::put($post_id, self::OWN_KEYS[$field], $value);
            } elseif ($field === 'ogImage') {
                self::write_image($post_id, $plugin, $value);
            } else {
                self::write_noindex($post_id, $plugin, $value);
            }
        }
        $after = self::read($post_id);
        $keys = array_keys($clean);
        return [
            'previous' => array_intersect_key($before, array_flip($keys)),
            'fields' => array_intersect_key($after, array_flip($keys)),
        ];
    }

    /** A text value, or no value at all for ''. */
    private static function put($post_id, $key, $value) {
        if ($value === '' || $value === null) {
            delete_post_meta($post_id, $key);
        } else {
            update_post_meta($post_id, $key, $value);
        }
    }

    private static function write_image($post_id, array $plugin, $image) {
        $url = self::image_url($image);
        if (isset($plugin['ogImage'])) {
            self::put($post_id, $plugin['ogImage'], $url ?? '');
        }
        if (isset($plugin['ogImageId'])) {
            self::put($post_id, $plugin['ogImageId'], is_int($image) ? (string) $image : '');
        }
        self::put($post_id, self::OWN_KEYS['ogImage'], $image === null ? '' : (string) $image);
    }

    private static function write_noindex($post_id, array $plugin, $hidden) {
        if (isset($plugin['noindex'])) {
            $key = $plugin['noindex'];
            switch (self::active_plugin()) {
                case 'yoast':
                case 'tsf':
                    self::put($post_id, $key, $hidden ? '1' : '');
                    break;
                case 'seopress':
                    self::put($post_id, $key, $hidden ? 'yes' : '');
                    break;
                case 'rankmath':
                    $robots = get_post_meta($post_id, $key, true);
                    $robots = is_array($robots) ? array_values(array_diff($robots, ['noindex', 'index'])) : [];
                    if ($hidden) {
                        $robots[] = 'noindex';
                    }
                    if ($robots === []) {
                        delete_post_meta($post_id, $key);
                    } else {
                        update_post_meta($post_id, $key, $robots);
                    }
                    break;
            }
        }
        self::put($post_id, self::OWN_KEYS['noindex'], $hidden ? '1' : '');
    }

    // ── Pages ────────────────────────────────────────────────────────────

    /** The statuses a page list shows (never the trash or an auto-draft). */
    const LIST_STATUSES = ['publish', 'future', 'draft', 'pending', 'private'];

    /** One post or page as the API's lists show it. */
    public static function summary($post) {
        $fields = self::read($post->ID);
        return [
            'postId' => (int) $post->ID,
            'type' => (string) $post->post_type,
            'title' => self::decoded(get_the_title($post)),
            'url' => (string) get_permalink($post),
            'status' => (string) $post->post_status,
            'modified' => self::iso($post->post_modified_gmt ?? ''),
            'seo' => ['title' => $fields['title'], 'description' => $fields['description'], 'noindex' => $fields['noindex']],
        ];
    }

    /** A post the fields may be read or written on: a page, a post or another public type. */
    public static function post_or_fail($post_id) {
        $post_id = (int) $post_id;
        $post = $post_id > 0 ? get_post($post_id) : null;
        if (!$post || in_array($post->post_status, ['trash', 'auto-draft', 'inherit'], true)) {
            throw new Exception('NOT_FOUND: The page ' . $post_id . ' was not found.');
        }
        $type = function_exists('get_post_type_object') ? get_post_type_object($post->post_type) : null;
        if (!in_array($post->post_type, ['page', 'post'], true) && !($type && !empty($type->public))) {
            throw new Exception('NOT_FOUND: The page ' . $post_id . ' was not found.');
        }
        return $post;
    }

    private static function decoded($text) {
        return function_exists('wp_specialchars_decode') ? wp_specialchars_decode((string) $text, ENT_QUOTES) : (string) $text;
    }

    private static function iso($gmt) {
        $gmt = (string) $gmt;
        if ($gmt === '' || strpos($gmt, '0000-00-00') === 0) {
            return null;
        }
        $time = strtotime($gmt . ' UTC');
        return $time ? gmdate('Y-m-d\TH:i:s\Z', $time) : null;
    }

    private static function plain($text) {
        return preg_replace('/[^A-Za-z0-9_ -]/', '', substr((string) $text, 0, 40));
    }
}

/**
 * The whole site's search settings (1.5.0), the Whole site tab of the
 * editor's Search panel and the dashboard's Pages tab, written as the
 * update_site_search edit operation (seo_site_read, seo_site_update):
 *
 *   shareImage  the picture a shared page without its own shows (a media id
 *               or an https address, null for none): WPMaven's own option,
 *               printed by WebMaven_SEO_Head while no SEO plugin prints the
 *               head (with one, its own setting decides: canSetShareImage
 *               false, and WPMaven never writes another plugin's options)
 *   hidden      WordPress's own "discourage search engines" (blog_public 0),
 *               which every SEO plugin honours
 *   tagline     WordPress's own tagline (blogdescription)
 */
final class WebMaven_SEO_Site {

    const SHARE_IMAGE_OPTION = 'wme_default_og_image';
    const TAGLINE_MAX = 200;

    public static function share_image() {
        $raw = get_option(self::SHARE_IMAGE_OPTION, '');
        if (is_numeric($raw) && (int) $raw > 0) {
            return (int) $raw;
        }
        return is_string($raw) && preg_match('#^https://[^\s"\'<>]+$#i', $raw) ? $raw : null;
    }

    /** The site's sharing picture's address, or null. */
    public static function share_image_url() {
        return WebMaven_SEO_Fields::image_url(self::share_image());
    }

    public static function read() {
        $front = get_option('show_on_front') === 'page' ? (int) get_option('page_on_front') : 0;
        $image = self::share_image();
        return [
            'shareImage' => $image,
            'shareImageUrl' => WebMaven_SEO_Fields::image_url($image) ?? '',
            'hidden' => (string) get_option('blog_public', '1') === '0',
            'tagline' => html_entity_decode((string) get_option('blogdescription', ''), ENT_QUOTES, 'UTF-8'),
            'seoPlugin' => WebMaven_SEO_Fields::active_plugin_name(),
            'canSetShareImage' => WebMaven_SEO_Fields::active_plugin() === null,
            'frontPage' => $front > 0 ? $front : 'posts',
        ];
    }

    /** Only the given fields change; answers the values before and after. Throws "VALIDATION: ...". */
    public static function write(array $fields) {
        $known = ['shareImage', 'hidden', 'tagline'];
        foreach (array_keys($fields) as $key) {
            if (!in_array($key, $known, true)) {
                throw new Exception('VALIDATION: ' . $key . ' is not a search setting of the site.');
            }
        }
        $previous = self::read();
        if (array_key_exists('shareImage', $fields)) {
            $image = $fields['shareImage'];
            if ($image === null || $image === '' || $image === 0) {
                delete_option(self::SHARE_IMAGE_OPTION);
            } elseif (is_numeric($image) && (int) $image > 0) {
                $post = get_post((int) $image);
                if (!$post || $post->post_type !== 'attachment') {
                    throw new Exception('NOT_FOUND: This picture is not in the media library.');
                }
                update_option(self::SHARE_IMAGE_OPTION, (int) $image, false);
            } elseif (is_string($image) && preg_match('#^https://[^\s"\'<>]+$#i', $image)) {
                update_option(self::SHARE_IMAGE_OPTION, esc_url_raw($image), false);
            } else {
                throw new Exception('VALIDATION: shareImage must be a media id, an https address or null.');
            }
        }
        if (array_key_exists('hidden', $fields)) {
            update_option('blog_public', $fields['hidden'] ? '0' : '1');
        }
        if (array_key_exists('tagline', $fields)) {
            $tagline = trim(preg_replace('/\s+/', ' ', wp_strip_all_tags((string) $fields['tagline'])));
            if (strlen($tagline) > self::TAGLINE_MAX * 4 || (function_exists('mb_strlen') ? mb_strlen($tagline, 'UTF-8') : strlen($tagline)) > self::TAGLINE_MAX) {
                throw new Exception('VALIDATION: The tagline can have at most ' . self::TAGLINE_MAX . ' characters.');
            }
            update_option('blogdescription', $tagline);
        }
        return ['previous' => $previous, 'fields' => self::read()];
    }
}
