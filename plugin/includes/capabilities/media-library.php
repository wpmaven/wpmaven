<?php
/**
 * The media library for the API (2026-10-05): the dashboard's Media page and
 * the edit engine's replace_image.
 *
 *   media_list          {page, per_page, search, type, no_alt, unused} -> ListPage<StoreMediaRow> (uses filled)
 *   media_usage         {ids}                     -> MediaUsageAnswer
 *   media_update        {media_id, alt, title, caption} -> {media: StoreMediaRow, before: {alt, title, caption}}
 *   media_delete        {media_id}                -> {deleted: true}
 *   media_alt_source    {ids}                     -> {images: [{mediaId, base64, mime, title, uses}]}
 *   media_replace_refs  {from_id, to_id}          -> {changed: [{kind, id, how}]}
 *   media_alt_set       {items: [{media_id, alt}], dry_run?}
 *                       -> {items: [{media_id, name, before, after}]}  (1.5.0)
 *
 * media_alt_set writes the descriptions of several pictures as one change
 * (the describe_images edit operation, with its undo): every item is checked
 * first, then written; with dry_run it only answers the descriptions now.
 * A description saved on a library file also reaches the copies of that
 * picture already placed in posts and pages without one, at render
 * (WebMaven_Placed_Image_Alt below): WordPress keeps the alt inside the
 * post's HTML and never copies a later library description into it.
 *
 * media_list reads wp/v2/media with rest_do_request, so it answers what the
 * plugin app reads (the where-used counts included). A file in use is never
 * deleted (a fresh where-used pass decides, never a cached one).
 * media_alt_source hands the API the picture itself (its medium size, read
 * from disk) with where it is used, so the alt text describes what is in it.
 * media_replace_refs points WordPress's own references at another file:
 * featured images, product galleries, variation images, the site icon, the
 * logo, the blog cards' images and the content of pages the design does not
 * own (the design's pages are the edit engine's); it answers what it changed,
 * and the same call with the two ids swapped undoes it.
 *
 * Failures THROW "CODE: sentence" (NOT_FOUND, VALIDATION, IN_USE,
 * WRITE_FAILED). Registered through the filter, so the execute_command
 * bridge (webhook_<name>) cannot reach these.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['media_list'] = ['WebMaven_Cap_Media_Library', 'media_list'];
    $handlers['media_usage'] = ['WebMaven_Cap_Media_Library', 'media_usage'];
    $handlers['media_update'] = ['WebMaven_Cap_Media_Library', 'media_update'];
    $handlers['media_delete'] = ['WebMaven_Cap_Media_Library', 'media_delete'];
    $handlers['media_alt_source'] = ['WebMaven_Cap_Media_Library', 'media_alt_source'];
    $handlers['media_replace_refs'] = ['WebMaven_Cap_Media_Library', 'media_replace_refs'];
    $handlers['media_alt_set'] = ['WebMaven_Cap_Media_Library', 'media_alt_set'];
    return $handlers;
});

/**
 * A picture placed in a post or page before its library file had a
 * description shows the library's description, at render only: the post's
 * content is never rewritten, so an undo of the description is exact. A tag
 * marked as decoration (role="presentation", aria-hidden="true") or carrying
 * its own description is left as it is.
 */
final class WebMaven_Placed_Image_Alt {
    public static function init() {
        add_filter('wp_content_img_tag', [__CLASS__, 'fill'], 10, 3);
    }

    public static function fill($filtered_image, $context = '', $attachment_id = 0) {
        $attachment_id = (int) $attachment_id;
        if (!is_string($filtered_image) || $attachment_id <= 0) {
            return $filtered_image;
        }
        if (preg_match('/\s(role\s*=\s*["\']?(presentation|none)|aria-hidden\s*=\s*["\']?true)/i', $filtered_image)) {
            return $filtered_image;
        }
        if (preg_match('/\salt\s*=\s*("([^"]*)"|\'([^\']*)\')/i', $filtered_image, $m)) {
            $current = isset($m[3]) && $m[3] !== '' ? $m[3] : ($m[2] ?? '');
            if (trim($current) !== '') {
                return $filtered_image;
            }
        }
        $alt = trim((string) get_post_meta($attachment_id, WebMaven_Cap_Media_Library::ALT_META, true));
        if ($alt === '') {
            return $filtered_image;
        }
        $attr = 'alt="' . esc_attr($alt) . '"';
        if (preg_match('/\salt\s*=\s*("[^"]*"|\'[^\']*\')/i', $filtered_image)) {
            return preg_replace('/\salt\s*=\s*("[^"]*"|\'[^\']*\')/i', ' ' . $attr, $filtered_image, 1);
        }
        return preg_replace('/^<img\b/i', '<img ' . $attr, $filtered_image, 1);
    }
}
WebMaven_Placed_Image_Alt::init();

final class WebMaven_Cap_Media_Library {

    const TYPES = ['image' => 'image', 'video' => 'video', 'document' => 'application'];
    const MAX_USAGE_IDS = 100;
    const MAX_ALT_SOURCE = 10;

    const ALT_META = '_wp_attachment_image_alt';

    /** Where references to a file can be, for media_replace_refs. */
    const REF_POST_TYPES = ['page', 'post', 'product', 'product_variation'];
    const REF_STATUSES = ['publish', 'draft', 'pending', 'private', 'future'];

    private static function error(string $code, string $message): Exception {
        return new Exception($code . ': ' . $message);
    }

    const MAX_ALT_SET = 40;
    const ALT_MAX_LENGTH = 250;

    // ── media_alt_set ──────────────────────────────────────────────────────

    public static function media_alt_set($params = [], $step_id = null) {
        $p = is_array($params) ? $params : [];
        $raw = $p['items'] ?? null;
        if (!is_array($raw) || $raw === [] || count($raw) > self::MAX_ALT_SET) {
            throw self::error('VALIDATION', 'items must list 1 to ' . self::MAX_ALT_SET . ' pictures.');
        }
        $dry = self::flag($p['dry_run'] ?? false);
        $items = [];
        foreach ($raw as $i => $item) {
            $id = self::attachment(is_array($item) ? ($item['media_id'] ?? 0) : 0);
            $alt = is_array($item) && isset($item['alt']) && is_string($item['alt']) ? $item['alt'] : '';
            $alt = trim(preg_replace('/\s+/', ' ', wp_strip_all_tags($alt)));
            if (strlen($alt) > self::ALT_MAX_LENGTH) {
                throw self::error('VALIDATION', 'A description can have at most ' . self::ALT_MAX_LENGTH . ' characters.');
            }
            $items[$id] = $alt;
        }
        $out = [];
        foreach ($items as $id => $alt) {
            $before = (string) get_post_meta($id, self::ALT_META, true);
            if (!$dry && $before !== $alt) {
                if ($alt === '') {
                    delete_post_meta($id, self::ALT_META);
                } else {
                    update_post_meta($id, self::ALT_META, $alt);
                }
            }
            $title = get_the_title($id);
            $file = basename((string) get_attached_file($id));
            $out[] = [
                'media_id' => $id,
                'name' => $title !== '' ? html_entity_decode($title, ENT_QUOTES, 'UTF-8') : ($file !== '' ? $file : 'picture ' . $id),
                'before' => $before,
                'after' => $dry ? $before : (string) get_post_meta($id, self::ALT_META, true),
            ];
        }
        return ['items' => $out];
    }

    // ── media_list ─────────────────────────────────────────────────────────

    public static function media_list($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        $page = self::positive_int($params['page'] ?? null);
        $per_page = self::positive_int($params['per_page'] ?? null);
        $query = [
            'context' => 'edit',
            'page' => $page > 0 ? min($page, 100000) : 1,
            'per_page' => $per_page > 0 ? min($per_page, 60) : 40,
            'wpmaven_uses' => true,
        ];
        $search = is_string($params['search'] ?? null) ? trim(sanitize_text_field($params['search'])) : '';
        if ($search !== '') {
            $query['search'] = function_exists('mb_substr') ? mb_substr($search, 0, 100) : substr($search, 0, 100);
        }
        if (isset($params['type']) && $params['type'] !== '') {
            if (!is_string($params['type']) || !isset(self::TYPES[$params['type']])) {
                throw self::error('VALIDATION', 'type must be one of: image, video, document.');
            }
            $query['media_type'] = self::TYPES[$params['type']];
        }
        if (self::flag($params['no_alt'] ?? false)) {
            $query['wpmaven_no_alt'] = true;
        }
        if (self::flag($params['unused'] ?? false)) {
            $query['wpmaven_unused'] = true;
        }
        list($items, $total, $pages) = WebMaven_Cap_Store_Catalog::rest_list('/wp/v2/media', $query);
        return ['items' => array_map([__CLASS__, 'row'], $items), 'total' => $total, 'totalPages' => $pages];
    }

    /** StoreMediaRow from a wp/v2 media answer (edit context). */
    public static function row(array $item): array {
        $details = is_array($item['media_details'] ?? null) ? $item['media_details'] : [];
        $sizes = is_array($details['sizes'] ?? null) ? $details['sizes'] : [];
        $mime = (string) ($item['mime_type'] ?? '');
        $url = (string) ($item['source_url'] ?? '');
        $thumb = $sizes['medium']['source_url'] ?? ($sizes['thumbnail']['source_url'] ?? null);
        $file = (string) ($details['file'] ?? '');
        $raw = function ($field) use ($item) {
            $value = $item[$field] ?? '';
            return is_array($value) ? (string) ($value['raw'] ?? ($value['rendered'] ?? '')) : (string) $value;
        };
        $uses = is_array($item['wpmaven'] ?? null) && isset($item['wpmaven']['uses']) ? (int) $item['wpmaven']['uses'] : null;
        return [
            'id' => (int) ($item['id'] ?? 0),
            'title' => WebMaven_Cap_Store_Catalog::text($raw('title')),
            'filename' => basename($file !== '' ? $file : (string) wp_parse_url($url, PHP_URL_PATH)),
            'url' => $url,
            'thumbUrl' => is_string($thumb) && $thumb !== '' ? $thumb : null,
            'mime' => $mime,
            'kind' => self::kind_of($mime),
            'width' => isset($details['width']) && is_numeric($details['width']) ? (int) $details['width'] : null,
            'height' => isset($details['height']) && is_numeric($details['height']) ? (int) $details['height'] : null,
            'bytes' => isset($details['filesize']) && is_numeric($details['filesize']) ? (int) $details['filesize'] : null,
            'alt' => (string) ($item['alt_text'] ?? ''),
            'caption' => WebMaven_Cap_Store_Catalog::text($raw('caption')),
            'date' => (string) ($item['date_gmt'] ?? ''),
            'uses' => $uses,
        ];
    }

    private static function kind_of(string $mime): string {
        foreach (['image', 'video', 'audio'] as $kind) {
            if (strpos($mime, $kind . '/') === 0) {
                return $kind;
            }
        }
        return strpos($mime, 'application/') === 0 || strpos($mime, 'text/') === 0 ? 'document' : 'other';
    }

    /** One file as media_list answers it. */
    private static function read_row(int $id): array {
        list($items) = self::rest_one('/wp/v2/media/' . $id, ['context' => 'edit', 'wpmaven_uses' => true]);
        return self::row($items);
    }

    /** One REST item (not a list). */
    private static function rest_one(string $route, array $query): array {
        $request = new WP_REST_Request('GET', $route);
        $request->set_query_params($query);
        $response = rest_do_request($request);
        if (!is_object($response) || (method_exists($response, 'is_error') && $response->is_error())) {
            throw self::error('NOT_FOUND', 'This file is not in the media library.');
        }
        $data = $response->get_data();
        return [is_array($data) ? $data : []];
    }

    // ── media_usage ────────────────────────────────────────────────────────

    public static function media_usage($params = [], $step_id = null) {
        $ids = self::ids($params['ids'] ?? null);
        if (!$ids || count($ids) > self::MAX_USAGE_IDS) {
            throw self::error('VALIDATION', 'ids is a list of 1 to 100 media ids.');
        }
        $answer = WebMaven_Media_Usage::uses($ids);
        $answer['uses'] = (object) $answer['uses'];
        return $answer;
    }

    // ── media_update ───────────────────────────────────────────────────────

    public static function media_update($params = [], $step_id = null) {
        $id = self::attachment($params['media_id'] ?? null);
        $post = get_post($id);
        $changes = [];
        $alt = null;
        if (array_key_exists('alt', $params)) {
            $alt = self::text_value($params['alt'], 'The description', 0, 500);
        }
        if (array_key_exists('title', $params)) {
            $changes['post_title'] = self::text_value($params['title'], 'The title', 1, 200);
        }
        if (array_key_exists('caption', $params)) {
            if (!is_string($params['caption'])) {
                throw self::error('VALIDATION', 'The caption must be text.');
            }
            $caption = trim(sanitize_textarea_field($params['caption']));
            if ((function_exists('mb_strlen') ? mb_strlen($caption, 'UTF-8') : strlen($caption)) > 2000) {
                throw self::error('VALIDATION', 'The caption has at most 2,000 characters.');
            }
            $changes['post_excerpt'] = $caption;
        }
        if ($alt === null && !$changes) {
            throw self::error('VALIDATION', 'Say what changes: alt, title or caption.');
        }
        $before = [
            'alt' => (string) get_post_meta($id, self::ALT_META, true),
            'title' => (string) $post->post_title,
            'caption' => (string) $post->post_excerpt,
        ];
        if ($changes) {
            $result = wp_update_post(wp_slash(['ID' => $id] + $changes), true);
            if (is_wp_error($result) || !$result) {
                throw self::error('WRITE_FAILED', 'WordPress could not save this file\'s details.');
            }
        }
        if ($alt !== null) {
            update_post_meta($id, self::ALT_META, $alt);
        }
        return ['media' => self::read_row($id), 'before' => $before];
    }

    // ── media_delete ───────────────────────────────────────────────────────

    public static function media_delete($params = [], $step_id = null) {
        $id = self::attachment($params['media_id'] ?? null);
        $uses = WebMaven_Media_Usage::fresh_uses([$id])['uses'][$id] ?? [];
        if ($uses) {
            throw self::error('IN_USE', WebMaven_Media_Usage::in_use_sentence($id, count($uses)));
        }
        if (!wp_delete_attachment($id, true)) {
            throw self::error('WRITE_FAILED', 'WordPress could not delete this file.');
        }
        return ['deleted' => true];
    }

    // ── media_alt_source ───────────────────────────────────────────────────

    public static function media_alt_source($params = [], $step_id = null) {
        $ids = self::ids($params['ids'] ?? null);
        if (!$ids || count($ids) > self::MAX_ALT_SOURCE) {
            throw self::error('VALIDATION', 'ids is a list of 1 to 10 image ids.');
        }
        $usage = WebMaven_Media_Usage::uses($ids)['uses'];
        $images = [];
        foreach ($ids as $id) {
            $post = get_post($id);
            if (!$post || $post->post_type !== 'attachment') {
                throw self::error('NOT_FOUND', 'Image ' . $id . ' was not found in the media library.');
            }
            $file = WebMaven_Media_Usage::readable_file($id);
            $bytes = $file ? @file_get_contents($file['path']) : false;
            if ($bytes === false || $bytes === '') {
                throw self::error('VALIDATION', 'Image ' . $id . ' cannot be read: WPMaven reads JPEG, PNG, GIF and WebP pictures.');
            }
            $images[] = [
                'mediaId' => $id,
                'base64' => base64_encode($bytes),
                'mime' => $file['mime'],
                'title' => WebMaven_Cap_Store_Catalog::text($post->post_title),
                'uses' => array_values(array_unique(array_map(['WebMaven_Media_Usage', 'label'], $usage[$id] ?? []))),
            ];
        }
        return ['images' => $images];
    }

    // ── media_replace_refs ─────────────────────────────────────────────────

    public static function media_replace_refs($params = [], $step_id = null) {
        $from = self::attachment($params['from_id'] ?? null);
        $to = self::attachment($params['to_id'] ?? null);
        if ($from === $to) {
            throw self::error('VALIDATION', 'from_id and to_id are two different files.');
        }
        if (wp_attachment_is_image($from) && !wp_attachment_is_image($to)) {
            throw self::error('VALIDATION', 'An image is replaced with another image.');
        }
        $changed = [];
        $note = function ($kind, $id, $how) use (&$changed) {
            $changed[] = ['kind' => $kind, 'id' => $id === null ? null : (int) $id, 'how' => $how];
        };

        // Featured images, of pages, posts, products and variations.
        foreach (self::posts_with_meta('_thumbnail_id', (string) $from) as $id) {
            $type = get_post_type($id);
            if (in_array($type, ['product', 'product_variation'], true) && function_exists('wc_get_product')) {
                $product = wc_get_product($id);
                if (!$product) {
                    continue;
                }
                $product->set_image_id($to);
                $product->save();
            } else {
                set_post_thumbnail($id, $to);
            }
            $note($type === 'product_variation' ? 'variation' : self::kind_of_post($type), $id, 'featured');
        }

        // Product galleries.
        foreach (self::posts_with_meta('_product_image_gallery', (string) $from, 'LIKE') as $id) {
            $product = function_exists('wc_get_product') ? wc_get_product($id) : null;
            if (!$product) {
                continue;
            }
            $gallery = array_map('intval', (array) $product->get_gallery_image_ids('edit'));
            if (!in_array($from, $gallery, true)) {
                continue;
            }
            $product->set_gallery_image_ids(array_values(array_unique(array_map(function ($g) use ($from, $to) {
                return $g === $from ? $to : $g;
            }, $gallery))));
            $product->save();
            $note('product', $id, 'gallery');
        }

        // The site icon, the logo.
        if ((int) get_option('site_icon', 0) === $from) {
            update_option('site_icon', $to);
            $note('icon', null, 'setting');
        }
        if (function_exists('get_theme_mod') && (int) get_theme_mod('custom_logo', 0) === $from) {
            set_theme_mod('custom_logo', $to);
            $note('logo', null, 'setting');
        }

        // The blog cards' images (a JSON list of URLs, as the theme reads it).
        $raw = get_option('wm_posts_imgs', '');
        $urls = is_array($raw) ? $raw : json_decode((string) $raw, true);
        if (is_array($urls) && $urls) {
            $next = [];
            foreach ($urls as $url) {
                $next[] = is_string($url) ? WebMaven_Media_Usage::replace_in_text($url, $from, $to) : $url;
            }
            if ($next !== $urls) {
                update_option('wm_posts_imgs', wp_json_encode(array_map('esc_url_raw', array_map('strval', $next))));
                $note('blog-cards', null, 'setting');
            }
        }

        // Content of the pages, posts and products the design does not own.
        $uses = WebMaven_Media_Usage::fresh_uses([$from])['uses'][$from] ?? [];
        foreach ($uses as $use) {
            if (($use['how'] ?? '') !== 'content' || !empty($use['designed']) || !is_int($use['id'] ?? null)) {
                continue;
            }
            if (self::replace_in_content((int) $use['id'], $from, $to)) {
                $note($use['kind'], $use['id'], 'content');
            }
        }
        return ['changed' => $changed];
    }

    /** One post's content (and a product's short description) pointing at $to instead of $from. */
    private static function replace_in_content(int $id, int $from, int $to): bool {
        $post = get_post($id);
        if (!$post) {
            return false;
        }
        $content = WebMaven_Media_Usage::replace_in_text((string) $post->post_content, $from, $to);
        $excerpt = WebMaven_Media_Usage::replace_in_text((string) $post->post_excerpt, $from, $to);
        if ($content === (string) $post->post_content && $excerpt === (string) $post->post_excerpt) {
            return false;
        }
        if ($post->post_type === 'product' && function_exists('wc_get_product')) {
            $product = wc_get_product($id);
            if (!$product) {
                return false;
            }
            $product->set_description($content);
            $product->set_short_description($excerpt);
            $product->save();
            return true;
        }
        $result = wp_update_post(wp_slash(['ID' => $id, 'post_content' => $content, 'post_excerpt' => $excerpt]), true);
        if (is_wp_error($result) || !$result) {
            throw self::error('WRITE_FAILED', 'WordPress could not save "' . WebMaven_Cap_Store_Catalog::text($post->post_title) . '".');
        }
        return true;
    }

    /** Ids of pages, posts, products and variations with this meta value (or holding it, for LIKE). */
    private static function posts_with_meta(string $key, string $value, string $compare = '='): array {
        $ids = get_posts([
            'post_type' => self::REF_POST_TYPES,
            'post_status' => self::REF_STATUSES,
            'numberposts' => -1,
            'fields' => 'ids',
            'orderby' => 'ID',
            'order' => 'ASC',
            'meta_query' => [['key' => $key, 'value' => $value, 'compare' => $compare]],
        ]);
        return array_map('intval', (array) $ids);
    }

    private static function kind_of_post($type): string {
        return $type === 'page' ? 'page' : ($type === 'product' ? 'product' : 'post');
    }

    // ── Values ─────────────────────────────────────────────────────────────

    /** An attachment id of the library; NOT_FOUND otherwise. */
    private static function attachment($raw): int {
        $id = self::positive_int($raw);
        $post = $id > 0 ? get_post($id) : null;
        if (!$post || $post->post_type !== 'attachment') {
            throw self::error('NOT_FOUND', 'File ' . $id . ' is not in the media library.');
        }
        return $id;
    }

    private static function ids($raw): array {
        $parts = is_array($raw) ? $raw : (is_string($raw) ? explode(',', $raw) : []);
        $out = [];
        foreach ($parts as $part) {
            $id = self::positive_int(is_string($part) ? trim($part) : $part);
            if ($id <= 0) {
                throw self::error('VALIDATION', 'ids holds media ids.');
            }
            $out[$id] = $id;
        }
        return array_values($out);
    }

    private static function text_value($value, string $what, int $min, int $max): string {
        if (!is_string($value)) {
            throw self::error('VALIDATION', $what . ' must be text.');
        }
        $text = trim(sanitize_text_field($value));
        $length = function_exists('mb_strlen') ? mb_strlen($text, 'UTF-8') : strlen($text);
        if ($length < $min || $length > $max) {
            throw self::error('VALIDATION', $what . ' has ' . ($min > 0 ? $min . ' to ' : 'at most ') . $max . ' characters.');
        }
        return $text;
    }

    private static function flag($value): bool {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value)) {
            return $value === 1;
        }
        return is_string($value) && in_array(strtolower(trim($value)), ['1', 'true', 'yes'], true);
    }

    private static function positive_int($value): int {
        if (is_int($value)) {
            return $value > 0 ? $value : 0;
        }
        if (is_string($value) && preg_match('/^\d{1,18}$/', $value)) {
            return (int) $value;
        }
        return 0;
    }
}
