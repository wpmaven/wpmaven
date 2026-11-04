<?php
/**
 * What search engines and link previews read from a page's head (1.3.0),
 * on a site without an SEO plugin: the description, "hide from search
 * engines", the Open Graph tags (title, description, image, address, type)
 * and the Twitter card, on singular pages and the front page, plus the
 * page's search title. Without it, a description saved in the dashboard
 * would be stored and never printed.
 *
 * Only the fields the owner saved (WebMaven_SEO_Fields) and the page's own
 * facts (its title, address, featured image): nothing is invented. The front
 * page falls back to the site's tagline for its description; no other page
 * gets a description it was not given. Every value is escaped.
 *
 * With an SEO plugin active (Yoast SEO, Rank Math, All in One SEO, SEOPress,
 * The SEO Framework) this prints nothing: the fields are written into that
 * plugin's own keys and it prints them. All in One SEO keeps no per-page
 * "hide from search engines" key WPMaven can write, so there the switch
 * reaches its robots tag and its sitemap through its own filters.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-webmaven-seo-fields.php';

final class WebMaven_SEO_Head {

    public static function init() {
        add_action('wp_head', [__CLASS__, 'print_tags'], 2);
        add_filter('pre_get_document_title', [__CLASS__, 'document_title'], 20);
        add_filter('wp_robots', [__CLASS__, 'robots']);
        add_filter('aioseo_robots_meta', [__CLASS__, 'aioseo_robots']);
        add_filter('aioseo_sitemap_exclude_posts', [__CLASS__, 'aioseo_sitemap_exclude'], 10, 2);
    }

    /** Whether this printer runs: no SEO plugin is active. */
    public static function active() {
        return WebMaven_SEO_Fields::active_plugin() === null;
    }

    /**
     * The page whose fields apply: the singular post or page, the static
     * front page, or 0 (the latest posts on the front page, anything else).
     */
    public static function current_post_id() {
        if (function_exists('is_front_page') && is_front_page()) {
            return get_option('show_on_front') === 'page' ? (int) get_option('page_on_front', 0) : 0;
        }
        if (function_exists('is_singular') && is_singular()) {
            return (int) get_queried_object_id();
        }
        return 0;
    }

    private static function is_front() {
        return function_exists('is_front_page') && is_front_page();
    }

    /** The search title a page was given, else WordPress's own ('' keeps it). */
    public static function document_title($title) {
        if (!self::active()) {
            return $title;
        }
        $post_id = self::current_post_id();
        if ($post_id <= 0) {
            return $title;
        }
        $fields = WebMaven_SEO_Fields::read($post_id);
        return $fields['title'] !== '' ? $fields['title'] : $title;
    }

    /** "Hide from search engines" (WordPress's own robots tag). */
    public static function robots($robots) {
        if (!self::active()) {
            return $robots;
        }
        $post_id = self::current_post_id();
        if ($post_id > 0 && WebMaven_SEO_Fields::read($post_id)['noindex']) {
            $robots = is_array($robots) ? $robots : [];
            unset($robots['index']);
            $robots['noindex'] = true;
        }
        return $robots;
    }

    /** All in One SEO's robots tag: noindex on a page WPMaven hides from search engines. */
    public static function aioseo_robots($attributes) {
        if (WebMaven_SEO_Fields::active_plugin() !== 'aioseo') {
            return $attributes;
        }
        $post_id = self::current_post_id();
        if ($post_id <= 0 || !WebMaven_SEO_Fields::read($post_id)['noindex']) {
            return $attributes;
        }
        $attributes = is_array($attributes) ? $attributes : [];
        unset($attributes['index']);
        $attributes['noindex'] = 'noindex';
        return $attributes;
    }

    /** All in One SEO's sitemap leaves out the pages WPMaven hides from search engines. */
    public static function aioseo_sitemap_exclude($ids, $type = '') {
        if (WebMaven_SEO_Fields::active_plugin() !== 'aioseo' || !function_exists('get_posts')) {
            return $ids;
        }
        $hidden = get_posts([
            'post_type' => 'any',
            'post_status' => 'publish',
            'meta_key' => WebMaven_SEO_Fields::OWN_KEYS['noindex'],
            'meta_value' => '1',
            'fields' => 'ids',
            'posts_per_page' => 1000,
            'no_found_rows' => true,
        ]);
        if (!$hidden) {
            return $ids;
        }
        $ids = is_array($ids) ? $ids : [];
        return array_values(array_unique(array_merge(array_map('intval', $ids), array_map('intval', (array) $hidden))));
    }

    /** The tags for the current page, as name => [attribute, value] lines; empty where none apply. */
    public static function tags() {
        if (!self::active()) {
            return [];
        }
        $front = self::is_front();
        $post_id = self::current_post_id();
        if (!$front && $post_id <= 0) {
            return [];
        }
        $fields = $post_id > 0 ? WebMaven_SEO_Fields::read($post_id) : null;
        $site_name = self::text(get_bloginfo('name'));
        $tagline = self::text(get_bloginfo('description'));

        $title = $fields && $fields['title'] !== '' ? $fields['title'] : ($post_id > 0 && !$front ? self::text(get_the_title($post_id)) : $site_name);
        $description = $fields ? $fields['description'] : '';
        if ($description === '' && $front) {
            $description = $tagline;
        }
        $og_title = $fields && $fields['ogTitle'] !== '' ? $fields['ogTitle'] : $title;
        $og_description = $fields && $fields['ogDescription'] !== '' ? $fields['ogDescription'] : $description;
        $image = $fields ? WebMaven_SEO_Fields::image_url($fields['ogImage']) : null;
        if ($image === null && $post_id > 0 && function_exists('get_the_post_thumbnail_url')) {
            $thumb = get_the_post_thumbnail_url($post_id, 'full');
            $image = is_string($thumb) && $thumb !== '' ? $thumb : null;
        }
        // Then the site's own sharing picture (the homepage that lists posts included).
        if ($image === null && class_exists('WebMaven_SEO_Site')) {
            $image = WebMaven_SEO_Site::share_image_url();
        }
        $url = $front ? home_url('/') : (string) get_permalink($post_id);
        $type = !$front && $post_id > 0 && get_post_type($post_id) === 'post' ? 'article' : 'website';

        $tags = [];
        if ($description !== '') {
            $tags[] = ['name', 'description', $description];
        }
        if ($og_title !== '') {
            $tags[] = ['property', 'og:title', $og_title];
        }
        if ($og_description !== '') {
            $tags[] = ['property', 'og:description', $og_description];
        }
        if ($image !== null) {
            $tags[] = ['property', 'og:image', $image];
        }
        if ($url !== '') {
            $tags[] = ['property', 'og:url', $url];
        }
        $tags[] = ['property', 'og:type', $type];
        if ($site_name !== '') {
            $tags[] = ['property', 'og:site_name', $site_name];
        }
        $tags[] = ['name', 'twitter:card', $image !== null ? 'summary_large_image' : 'summary'];
        if ($og_title !== '') {
            $tags[] = ['name', 'twitter:title', $og_title];
        }
        if ($og_description !== '') {
            $tags[] = ['name', 'twitter:description', $og_description];
        }
        if ($image !== null) {
            $tags[] = ['name', 'twitter:image', $image];
        }
        return $tags;
    }

    public static function print_tags() {
        foreach (self::tags() as [$attribute, $key, $value]) {
            $is_url = in_array($key, ['og:image', 'og:url', 'twitter:image'], true);
            // Text as text: a value written elsewhere (another plugin, an
            // import) never brings markup into the head.
            printf(
                "<meta %s=\"%s\" content=\"%s\" />\n",
                esc_attr($attribute),
                esc_attr($key),
                $is_url ? esc_url($value) : esc_attr(self::text($value))
            );
        }
    }

    private static function text($value) {
        $value = function_exists('wp_specialchars_decode') ? wp_specialchars_decode((string) $value, ENT_QUOTES) : (string) $value;
        return trim(wp_strip_all_tags($value));
    }
}
