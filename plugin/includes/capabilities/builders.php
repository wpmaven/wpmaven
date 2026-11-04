<?php
/**
 * Pages built with a page builder (2026-10-09): the edit engine reads and
 * changes an Elementor page's words and pictures in Elementor's own data
 * (class-webmaven-builder-content.php); its layout stays Elementor's.
 *
 *   wm_builder_read  {post_id} -> {post_id, builder, sha256, raw, title, link, post_type, sections}
 *                    (builder: 'elementor' | 'divi' | null; sections and raw for Elementor only)
 *   wm_builder_write {post_id, expect_sha256, texts?: [{path, text}], link?: {path, url},
 *                     image?: {slot, id?, url?, alt?}} | {post_id, expect_sha256, restore: raw}
 *                    -> {post_id, sha256}
 *
 * A write over a page changed since (another sha) answers DRIFT. After each
 * write Elementor's caches of the page go (its element cache and its CSS
 * file), so the next visit renders the page from the new data.
 *
 * Failures THROW "CODE: sentence" like the other edit commands.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-builder-content.php';

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['wm_builder_read'] = ['WebMaven_Cap_Builders', 'builder_read'];
    $handlers['wm_builder_write'] = ['WebMaven_Cap_Builders', 'builder_write'];
    return $handlers;
});

final class WebMaven_Cap_Builders {

    const META = '_elementor_data';

    /** The post's builder ('elementor' | 'divi' | null). */
    public static function builder($post_id): ?string {
        $id = (int) $post_id;
        return WebMaven_Builder_Content::builder_of([
            '_elementor_edit_mode' => (string) get_post_meta($id, '_elementor_edit_mode', true),
            '_et_pb_use_builder' => (string) get_post_meta($id, '_et_pb_use_builder', true),
        ]);
    }

    /** What Elementor stores for the page, as stored. */
    public static function raw($post_id): string {
        $raw = get_post_meta((int) $post_id, self::META, true);
        return is_string($raw) ? $raw : WebMaven_Builder_Content::encode(is_array($raw) ? $raw : []);
    }

    public static function sha(string $raw): string {
        return hash('sha256', $raw);
    }

    /** An Elementor page's sections for the outline (empty for anything else). */
    public static function outline_sections($post_id): array {
        if (self::builder($post_id) !== 'elementor') {
            return [];
        }
        try {
            return WebMaven_Builder_Content::sections(WebMaven_Builder_Content::elementor_tree(self::raw($post_id)));
        } catch (Exception $e) {
            return [];
        }
    }

    private static function post(array $params): WP_Post {
        $id = (int) ($params['post_id'] ?? 0);
        $post = $id > 0 ? get_post($id) : null;
        if (!$post || !in_array($post->post_type, ['page', 'post'], true) || $post->post_status === 'trash') {
            throw new Exception('NOT_FOUND: This page is not on the site.');
        }
        return $post;
    }

    public static function builder_read(array $params): array {
        $post = self::post($params);
        $builder = self::builder($post->ID);
        $out = [
            'post_id' => (int) $post->ID,
            'builder' => $builder,
            'title' => wp_strip_all_tags((string) $post->post_title),
            'link' => (string) get_permalink($post),
            'post_type' => (string) $post->post_type,
        ];
        if ($builder === 'elementor') {
            $raw = self::raw($post->ID);
            $out['raw'] = $raw;
            $out['sha256'] = self::sha($raw);
            $out['sections'] = WebMaven_Builder_Content::sections(WebMaven_Builder_Content::elementor_tree($raw));
        }
        return $out;
    }

    /** The page's Elementor data after a change, checked against the sha it was computed on. */
    public static function changed_raw(array $params): string {
        $post = self::post($params);
        if (self::builder($post->ID) !== 'elementor') {
            throw new Exception('VALIDATION: WPMaven changes the words and pictures of Elementor pages only.');
        }
        $raw = self::raw($post->ID);
        $expect = is_string($params['expect_sha256'] ?? null) ? $params['expect_sha256'] : '';
        if ($expect === '' || !hash_equals(self::sha($raw), $expect)) {
            throw new Exception('DRIFT: This page changed in WordPress since WPMaven read it.');
        }
        if (array_key_exists('restore', $params)) {
            if (!is_string($params['restore'])) {
                throw new Exception('VALIDATION: restore is what the page held.');
            }
            WebMaven_Builder_Content::elementor_tree($params['restore']);
            return $params['restore'];
        }
        $tree = WebMaven_Builder_Content::apply(WebMaven_Builder_Content::elementor_tree($raw), [
            'texts' => $params['texts'] ?? [],
            'link' => $params['link'] ?? null,
            'image' => $params['image'] ?? null,
        ]);
        return WebMaven_Builder_Content::encode($tree);
    }

    public static function builder_write(array $params): array {
        $next = self::changed_raw($params);
        $id = (int) $params['post_id'];
        update_post_meta($id, self::META, wp_slash($next));
        self::clear_caches($id);
        return ['post_id' => $id, 'sha256' => self::sha(self::raw($id))];
    }

    /**
     * wm_preview_stage's `builder`: [{post_id, expect_sha256, texts?, link?, image?}]
     * -> {post_id: data as the write would leave it}.
     */
    public static function staged($raw): array {
        if (!is_array($raw) || count($raw) > 10) {
            throw new Exception('VALIDATION: builder must be a list of at most 10 pages.');
        }
        $out = [];
        foreach ($raw as $entry) {
            if (!is_array($entry) || array_key_exists('restore', $entry)) {
                throw new Exception('VALIDATION: Each staged builder page is a change.');
            }
            $out[(string) (int) ($entry['post_id'] ?? 0)] = self::changed_raw($entry);
        }
        return $out;
    }

    /** Elementor renders the page again from its data: its element cache and CSS file go. */
    private static function clear_caches(int $id): void {
        delete_post_meta($id, '_elementor_element_cache');
        if (class_exists('\Elementor\Core\Files\CSS\Post')) {
            $css = \Elementor\Core\Files\CSS\Post::create($id);
            if (method_exists($css, 'delete')) {
                $css->delete();
            }
        }
        clean_post_cache($id);
    }
}
