<?php
/**
 * WordPress's own sample content, recognised in the site's language.
 *
 * A fresh WordPress ships three things nobody wrote: the "Hello world!" post,
 * the "Sample Page" and a draft "Privacy Policy" page (wp_install_defaults in
 * wp-admin/includes/upgrade.php, which also points wp_page_for_privacy_policy
 * at that draft). They are created with the install's language, so a French
 * site has "Bonjour tout le monde !" at bonjour-tout-le-monde.
 *
 * Untouched, they are not the owner's content: a build replaces them, never
 * parks its own page beside them, and the cleanup after a build removes them
 * (to the trash on a site the owner already runs, for good on a fresh hosted
 * site). Touched (edited since they were created, or the Hello world post
 * with comments of its own), they are the owner's like anything else.
 *
 * Pure apart from WordPress's own lookups, so a test runs it against
 * stand-ins.
 */

if (!defined('ABSPATH')) {
    exit;
}

class WebMaven_Default_Content {

    const HELLO_WORLD = 'hello_world';
    const SAMPLE_PAGE = 'sample_page';
    const PRIVACY_DRAFT = 'privacy_draft';

    /**
     * The kind of WordPress default this post still is, untouched since the
     * install, or null. The privacy draft is the page wp_page_for_privacy_policy
     * names, or one at the default privacy address, still a draft.
     */
    public static function untouched_kind($post) {
        $kind = self::default_kind($post);
        if ($kind === null || !self::never_modified($post)) {
            return null;
        }
        // Hello world arrives with one comment (WordPress's sample commenter).
        if ($kind === self::HELLO_WORLD && (int) ($post->comment_count ?? 0) > 1) {
            return null;
        }
        return $kind;
    }

    /**
     * The kind of WordPress default this post is by its address and title,
     * whatever happened to it since, or null. A post WPMaven made is never one.
     */
    public static function default_kind($post) {
        if (!is_object($post) || empty($post->ID)) {
            return null;
        }
        if (class_exists('WebMaven_AI_Marking') && WebMaven_AI_Marking::is_ai_generated((int) $post->ID)) {
            return null;
        }
        $type = (string) ($post->post_type ?? '');
        $status = (string) ($post->post_status ?? '');
        if ($status === 'trash' || $status === 'auto-draft') {
            return null;
        }
        $title = (string) ($post->post_title ?? '');
        $slug = (string) ($post->post_name ?? '');
        $s = self::strings();
        if ($type === 'post' && self::slug_in($slug, $s['hello_slug']) && self::title_in($title, $s['hello_title'])) {
            return self::HELLO_WORLD;
        }
        if ($type !== 'page') {
            return null;
        }
        if ($status === 'draft' && self::title_in($title, $s['privacy_title'])) {
            $privacy_id = function_exists('get_option') ? (int) get_option('wp_page_for_privacy_policy', 0) : 0;
            if ((int) $post->ID === $privacy_id || self::slug_in($slug, $s['privacy_slug'])) {
                return self::PRIVACY_DRAFT;
            }
        }
        if (self::slug_in($slug, $s['sample_slug']) && self::title_in($title, $s['sample_title'])) {
            return self::SAMPLE_PAGE;
        }
        return null;
    }

    /**
     * The kind of WordPress default a post is by its address alone (a fresh
     * hosted site, where nothing is the owner's yet): any post at the Hello
     * world or Sample Page address, and the privacy draft. Never a post
     * WPMaven made.
     */
    public static function kind_by_address($post) {
        if (!is_object($post) || empty($post->ID)) {
            return null;
        }
        $kind = self::default_kind($post);
        if ($kind !== null) {
            return $kind;
        }
        if (class_exists('WebMaven_AI_Marking') && WebMaven_AI_Marking::is_ai_generated((int) $post->ID)) {
            return null;
        }
        if ((string) ($post->post_status ?? '') === 'trash') {
            return null;
        }
        $s = self::strings();
        $type = (string) ($post->post_type ?? '');
        $slug = (string) ($post->post_name ?? '');
        if ($type === 'post' && self::slug_in($slug, $s['hello_slug'])) {
            return self::HELLO_WORLD;
        }
        if ($type === 'page' && self::slug_in($slug, $s['sample_slug'])) {
            return self::SAMPLE_PAGE;
        }
        return null;
    }

    /**
     * Every untouched default on the site, as [{ kind, post }], found where
     * WordPress puts them: the default addresses in English and in the
     * site's language, and the page wp_page_for_privacy_policy names.
     */
    public static function untouched_defaults() {
        $out = [];
        foreach (self::default_posts() as $post) {
            $kind = self::untouched_kind($post);
            if ($kind !== null) {
                $out[] = ['kind' => $kind, 'post' => $post];
            }
        }
        return $out;
    }

    /**
     * The posts at WordPress's default addresses (and the privacy page the
     * option names), whatever their state, each once.
     */
    public static function default_posts() {
        if (!function_exists('get_page_by_path')) {
            return [];
        }
        $s = self::strings();
        $seen = [];
        $out = [];
        $add = function ($post) use (&$seen, &$out) {
            if (is_object($post) && !empty($post->ID) && !isset($seen[(int) $post->ID])) {
                $seen[(int) $post->ID] = true;
                $out[] = $post;
            }
        };
        foreach ($s['hello_slug'] as $slug) {
            $add(get_page_by_path($slug, OBJECT, 'post'));
        }
        foreach (array_merge($s['sample_slug'], $s['privacy_slug']) as $slug) {
            $add(get_page_by_path($slug, OBJECT, 'page'));
        }
        $privacy_id = function_exists('get_option') ? (int) get_option('wp_page_for_privacy_policy', 0) : 0;
        if ($privacy_id > 0 && function_exists('get_post')) {
            $add(get_post($privacy_id));
        }
        return $out;
    }

    /**
     * An untouched default of this post type titled exactly $title (as the
     * planned page or post would be), or null.
     */
    public static function untouched_titled($title, $type) {
        $title = trim((string) $title);
        if ($title === '') {
            return null;
        }
        // Only a title WordPress gives its sample content can match: no
        // lookup for any other page.
        $s = self::strings();
        if (!self::title_in($title, array_merge($s['hello_title'], $s['sample_title'], $s['privacy_title']))) {
            return null;
        }
        foreach (self::default_posts() as $post) {
            if ((string) ($post->post_type ?? '') !== (string) $type) {
                continue;
            }
            if (self::title_in((string) ($post->post_title ?? ''), [$title]) && self::untouched_kind($post) !== null) {
                return $post;
            }
        }
        return null;
    }

    /** Never edited since it was created: the modified time is the creation time. */
    public static function never_modified($post) {
        $created = (string) ($post->post_date_gmt ?? '');
        $modified = (string) ($post->post_modified_gmt ?? '');
        $zero = '0000-00-00 00:00:00';
        if ($created === '' || $created === $zero || $modified === '' || $modified === $zero) {
            // A draft saved through the editor has no GMT date yet: the local times then.
            $created = (string) ($post->post_date ?? '');
            $modified = (string) ($post->post_modified ?? '');
        }
        return $created !== '' && $created !== $zero && $created === $modified;
    }

    /**
     * WordPress's own titles and addresses for its defaults, in English and in
     * the languages this request has loaded (the site's, and the user's when
     * it differs), so a translated install is recognised.
     */
    public static function strings() {
        static $cache = [];
        $translated = function () {
            return [
                // WordPress's own words, as it wrote them in the site's language.
                'hello_title' => function_exists('translate') ? translate('Hello world!', 'default') : 'Hello world!',
                'hello_slug' => function_exists('translate_with_gettext_context') ? translate_with_gettext_context('hello-world', 'Default post slug', 'default') : 'hello-world',
                'sample_title' => function_exists('translate') ? translate('Sample Page', 'default') : 'Sample Page',
                'sample_slug' => function_exists('translate') ? translate('sample-page', 'default') : 'sample-page',
                'privacy_title' => function_exists('translate') ? translate('Privacy Policy', 'default') : 'Privacy Policy',
                'privacy_slug' => function_exists('translate') ? translate('privacy-policy', 'default') : 'privacy-policy',
            ];
        };
        $current = $translated();
        // Switching to the site's language loads its translations: once per
        // request and language.
        $cache_key = md5(serialize($current) . '|' . (function_exists('get_locale') ? (string) get_locale() : ''));
        if (isset($cache[$cache_key])) {
            return $cache[$cache_key];
        }
        $sets = [[
            'hello_title' => 'Hello world!',
            'hello_slug' => 'hello-world',
            'sample_title' => 'Sample Page',
            'sample_slug' => 'sample-page',
            'privacy_title' => 'Privacy Policy',
            'privacy_slug' => 'privacy-policy',
        ]];
        $sets[] = $current;
        // The install used the site's language; this request may run in the
        // acting user's. Read the strings in the site's language too.
        if (function_exists('switch_to_locale') && function_exists('restore_previous_locale') && function_exists('get_locale')) {
            $site_locale = (string) get_locale();
            if ($site_locale !== '' && switch_to_locale($site_locale)) {
                $sets[] = $translated();
                restore_previous_locale();
            }
        }
        $out = [];
        foreach ($sets as $set) {
            foreach ($set as $key => $value) {
                $value = (string) $value;
                if (substr($key, -5) === '_slug') {
                    $value = function_exists('sanitize_title') ? sanitize_title($value) : strtolower($value);
                }
                if ($value !== '' && !in_array($value, $out[$key] ?? [], true)) {
                    $out[$key][] = $value;
                }
            }
        }
        $cache[$cache_key] = $out;
        return $out;
    }

    private static function slug_in($slug, array $slugs) {
        $slug = (string) $slug;
        return $slug !== '' && in_array($slug, $slugs, true);
    }

    private static function title_in($title, array $titles) {
        $norm = function ($t) {
            $t = html_entity_decode((string) $t, ENT_QUOTES, 'UTF-8');
            // Translations put a no-break space before "!" ("Bonjour tout le monde !").
            $t = preg_replace('/[\s\x{00A0}\x{202F}]+/u', ' ', $t);
            $t = trim((string) $t);
            return function_exists('mb_strtolower') ? mb_strtolower($t, 'UTF-8') : strtolower($t);
        };
        $title = $norm($title);
        if ($title === '') {
            return false;
        }
        foreach ($titles as $candidate) {
            if ($norm($candidate) === $title) {
                return true;
            }
        }
        return false;
    }
}
