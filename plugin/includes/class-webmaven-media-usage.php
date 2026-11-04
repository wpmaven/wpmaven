<?php
/**
 * Where each media file is used (2026-10-05): one answer for the Media
 * screen, the delete guard, the dashboard and the edit engine's
 * replace_image.
 *
 * A file is used when something on the site points at it:
 *  - the content (and a product's short description) of pages, posts and
 *    products that are published, drafts, pending, private or scheduled,
 *    by URL or root-relative path of any of its files (every size in its
 *    metadata, the original of a scaled image, and a size the metadata no
 *    longer lists), by a wp-image-<id> class, or by a [gallery ids=...];
 *  - the featured image (_thumbnail_id) of pages, posts, products and
 *    product variations, and a product's gallery (_product_image_gallery);
 *  - the site icon, the theme's logo (custom_logo), WooCommerce's
 *    placeholder image, the blog cards' images (wm_posts_imgs) and the
 *    site details (wm_var_* values).
 *
 * One pass reads at most POST_LIMIT pages, posts and products (oldest
 * first); past that the answer says partial (the counts are "at least").
 * The index is kept in the transient webmaven_media_usage_v1 for TTL
 * seconds and dropped on every change that can move a use (save_post,
 * edit_attachment, delete_attachment, WooCommerce's product saves, the
 * thumbnail and gallery meta, and the options above). Inside a call WPMaven
 * guards with a before and after check (WebMaven_Self_Protect), the
 * transient is not written, and dropping it waits for the end of the
 * request, so the check never reads this cache as a change.
 *
 * `designed` is true for a page the design owns (_webmaven_fullhtml, or
 * WPMaven's AI marking): it changes through the editor or replace_image,
 * never by rewriting its content here.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Media_Usage {

    const TRANSIENT = 'webmaven_media_usage_v1';
    const TTL = 900;
    const POST_LIMIT = 2000;
    const CHUNK = 100;
    const VERSION = 1;

    const POST_TYPES = ['page', 'post', 'product'];
    const STATUSES = ['publish', 'draft', 'pending', 'private', 'future'];

    /** Options whose change can move a use (theme_mods_* and wm_var_* by prefix). */
    const OPTIONS = ['site_icon', 'woocommerce_placeholder_image', 'wm_posts_imgs', 'wm_var_registry'];
    const META_KEYS = ['_thumbnail_id', '_product_image_gallery', '_wp_attached_file', '_wp_attachment_metadata', '_webmaven_fullhtml'];

    const FULLHTML_META = '_webmaven_fullhtml';
    const IDENTITY_PATH = 'customize.php?autofocus%5Bsection%5D=title_tagline';
    const PLACEHOLDER_PATH = 'admin.php?page=wc-settings&tab=products';

    /** What the picture readers take (media_alt_source, the alt text routes). */
    const READABLE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const READABLE_MAX_BYTES = 2097152;

    /** The index for this request. */
    private static $memo = null;
    private static $late = false;
    private static $started = false;

    public static function init(): void {
        if (self::$started) {
            return;
        }
        self::$started = true;
        foreach (['save_post', 'deleted_post', 'add_attachment', 'edit_attachment', 'delete_attachment',
            'woocommerce_new_product', 'woocommerce_update_product',
            'woocommerce_new_product_variation', 'woocommerce_update_product_variation'] as $hook) {
            add_action($hook, [__CLASS__, 'invalidate'], 10, 0);
        }
        foreach (['added_post_meta', 'updated_post_meta', 'deleted_post_meta'] as $hook) {
            add_action($hook, [__CLASS__, 'on_meta'], 10, 3);
        }
        foreach (['added_option', 'updated_option', 'deleted_option'] as $hook) {
            add_action($hook, [__CLASS__, 'on_option'], 10, 1);
        }
    }

    // ── Answers ────────────────────────────────────────────────────────────

    /**
     * MediaUsageAnswer for these attachment ids: {uses: {id: MediaUse[]},
     * partial}. Every id asked for has an entry, empty when unused.
     */
    public static function uses(array $ids): array {
        $index = self::index();
        $out = [];
        foreach ($ids as $id) {
            $id = (int) $id;
            if ($id > 0) {
                $out[$id] = array_values($index['uses'][$id] ?? []);
            }
        }
        return ['uses' => $out, 'partial' => (bool) $index['partial']];
    }

    /** The same answer from a fresh pass: the delete guard never trusts a cached "unused". */
    public static function fresh_uses(array $ids): array {
        self::$memo = self::build();
        self::store(self::$memo);
        return self::uses($ids);
    }

    /** How many places use a file. */
    public static function count_for(int $id): int {
        $index = self::index();
        return count($index['uses'][$id] ?? []);
    }

    /** Every attachment id used somewhere. */
    public static function used_ids(): array {
        $index = self::index();
        $out = [];
        foreach ($index['uses'] as $id => $list) {
            if ($list) {
                $out[] = (int) $id;
            }
        }
        sort($out);
        return $out;
    }

    /** "Product: Ceramic Mug", "Page: About", "Blog cards": a use in a few words. */
    public static function label(array $use): string {
        $title = (string) ($use['title'] ?? '');
        switch ($use['kind'] ?? '') {
            case 'page':
                return 'Page: ' . $title;
            case 'post':
                return 'Post: ' . $title;
            case 'product':
                return 'Product: ' . $title;
            case 'variation':
                return 'Product option: ' . $title;
            case 'blog-cards':
                return 'Blog cards';
            case 'logo':
                return 'Site logo';
            case 'icon':
                return 'Site icon';
            case 'placeholder':
                return 'Store placeholder image';
            case 'fact':
                return 'Site detail: ' . $title;
        }
        return $title;
    }

    /** "This image is used in 2 places. Replace it there first, or replace it everywhere at once." */
    public static function in_use_sentence(int $id, int $count): string {
        $what = function_exists('wp_attachment_is_image') && wp_attachment_is_image($id) ? 'image' : 'file';
        return 'This ' . $what . ' is used in ' . $count . ($count === 1 ? ' place' : ' places') . '. Replace it there first, or replace it everywhere at once.';
    }

    // ── The cache ──────────────────────────────────────────────────────────

    private static function index(): array {
        if (self::$memo !== null) {
            return self::$memo;
        }
        $cached = get_transient(self::TRANSIENT);
        if (is_array($cached) && ($cached['v'] ?? null) === self::VERSION && is_array($cached['uses'] ?? null)) {
            self::$memo = $cached;
            return self::$memo;
        }
        self::$memo = self::build();
        self::store(self::$memo);
        return self::$memo;
    }

    private static function store(array $index): void {
        if (self::guarded()) {
            return;
        }
        set_transient(self::TRANSIENT, $index, self::TTL);
    }

    private static function guarded(): bool {
        return class_exists('WebMaven_Self_Protect') && WebMaven_Self_Protect::in_guarded_call();
    }

    /** A use may have moved: the index is read again next time. */
    public static function invalidate(): void {
        self::$memo = null;
        if (self::guarded()) {
            if (!self::$late) {
                self::$late = true;
                add_action('shutdown', [__CLASS__, 'invalidate_late'], 1, 0);
            }
            return;
        }
        delete_transient(self::TRANSIENT);
    }

    /** The end of a request that changed a use inside a guarded call. */
    public static function invalidate_late(): void {
        self::$late = false;
        if (!self::guarded()) {
            delete_transient(self::TRANSIENT);
        }
    }

    public static function on_meta($meta_id, $object_id, $meta_key): void {
        if (in_array((string) $meta_key, self::META_KEYS, true)) {
            self::invalidate();
        }
    }

    public static function on_option($name): void {
        $name = (string) $name;
        if (in_array($name, self::OPTIONS, true) || strpos($name, 'theme_mods_') === 0 || strpos($name, 'wm_var_') === 0) {
            self::invalidate();
        }
    }

    // ── One pass ───────────────────────────────────────────────────────────

    private static function build(): array {
        $files = self::file_map();
        $uses = [];
        $add = function ($attachment_id, array $use) use (&$uses) {
            $attachment_id = (int) $attachment_id;
            if ($attachment_id > 0) {
                $uses[$attachment_id][$use['kind'] . '|' . $use['id'] . '|' . $use['how']] = $use;
            }
        };

        // Pages, posts and products: content, featured image, gallery.
        $ids = array_map('intval', (array) get_posts([
            'post_type' => self::POST_TYPES,
            'post_status' => self::STATUSES,
            'numberposts' => self::POST_LIMIT + 1,
            'fields' => 'ids',
            'orderby' => 'ID',
            'order' => 'ASC',
            'no_found_rows' => true,
        ]));
        $partial = count($ids) > self::POST_LIMIT;
        $ids = array_slice($ids, 0, self::POST_LIMIT);
        foreach (array_chunk($ids, self::CHUNK) as $chunk) {
            if (function_exists('update_meta_cache')) {
                update_meta_cache('post', $chunk);
            }
            foreach ($chunk as $id) {
                $post = get_post($id);
                if (!$post) {
                    continue;
                }
                $base = self::base_of($post);
                foreach (self::referenced_ids((string) $post->post_content . "\n" . (string) $post->post_excerpt, $files) as $attachment_id) {
                    $add($attachment_id, self::make_use($base, 'content'));
                }
                $thumbnail = (int) get_post_meta($id, '_thumbnail_id', true);
                if ($thumbnail > 0) {
                    $add($thumbnail, self::make_use($base, 'featured'));
                }
                if ($post->post_type === 'product') {
                    foreach (self::id_list(get_post_meta($id, '_product_image_gallery', true)) as $attachment_id) {
                        $add($attachment_id, self::make_use($base, 'gallery'));
                    }
                }
            }
        }

        // Product variations: their image.
        $variations = (array) get_posts([
            'post_type' => 'product_variation',
            'post_status' => ['publish', 'private'],
            'numberposts' => -1,
            'fields' => 'id=>parent',
            'no_found_rows' => true,
        ]);
        foreach (array_chunk(array_keys($variations), 200) as $chunk) {
            if (function_exists('update_meta_cache')) {
                update_meta_cache('post', array_map('intval', $chunk));
            }
            foreach ($chunk as $variation_id) {
                $thumbnail = (int) get_post_meta((int) $variation_id, '_thumbnail_id', true);
                if ($thumbnail <= 0) {
                    continue;
                }
                $variation = get_post((int) $variation_id);
                $parent = (int) $variations[$variation_id];
                $add($thumbnail, self::make_use([
                    'kind' => 'variation',
                    'id' => (int) $variation_id,
                    'title' => self::title($variation ? (string) $variation->post_title : ''),
                    'designed' => false,
                    'editPath' => $parent > 0 ? 'post.php?post=' . $parent . '&action=edit' : null,
                ], 'featured'));
            }
        }

        // Settings.
        $icon = (int) get_option('site_icon', 0);
        if ($icon > 0) {
            $add($icon, self::setting('icon', 'Site icon', self::IDENTITY_PATH));
        }
        $logo = function_exists('get_theme_mod') ? (int) get_theme_mod('custom_logo', 0) : 0;
        if ($logo > 0) {
            $add($logo, self::setting('logo', 'Site logo', self::IDENTITY_PATH));
        }
        $placeholder = (int) get_option('woocommerce_placeholder_image', 0);
        if ($placeholder > 0) {
            $add($placeholder, self::setting('placeholder', 'Store placeholder image', self::PLACEHOLDER_PATH));
        }
        foreach (self::blog_card_urls() as $url) {
            foreach (self::referenced_ids($url, $files) as $attachment_id) {
                $add($attachment_id, self::setting('blog-cards', 'Blog cards', null));
            }
        }
        foreach (self::fact_values() as $fact) {
            foreach (self::referenced_ids($fact['value'], $files) as $attachment_id) {
                $add($attachment_id, self::setting('fact', $fact['label'], null));
            }
        }

        // Only files of the library.
        $out = [];
        foreach ($uses as $attachment_id => $list) {
            if (isset($files['ids'][$attachment_id])) {
                $out[$attachment_id] = array_values($list);
            }
        }
        return ['v' => self::VERSION, 'uses' => $out, 'partial' => $partial, 'built' => time()];
    }

    /** kind, id, title, designed and editPath of a page, post or product. */
    private static function base_of($post): array {
        $kind = $post->post_type === 'page' ? 'page' : ($post->post_type === 'product' ? 'product' : 'post');
        $id = (int) $post->ID;
        $designed = $kind === 'page' && self::designed($id);
        return [
            'kind' => $kind,
            'id' => $id,
            'title' => self::title((string) $post->post_title),
            'designed' => $designed,
            'editPath' => $designed ? null : 'post.php?post=' . $id . '&action=edit',
        ];
    }

    /** A MediaUse in its documented key order. */
    private static function make_use(array $base, string $how): array {
        return [
            'kind' => $base['kind'],
            'id' => $base['id'],
            'title' => $base['title'],
            'how' => $how,
            'designed' => (bool) $base['designed'],
            'editPath' => $base['editPath'],
        ];
    }

    private static function setting(string $kind, string $title, ?string $edit_path): array {
        return self::make_use(['kind' => $kind, 'id' => null, 'title' => $title, 'designed' => false, 'editPath' => $edit_path], 'setting');
    }

    /** A page the design owns. */
    public static function designed(int $id): bool {
        if ($id <= 0) {
            return false;
        }
        if (get_post_meta($id, self::FULLHTML_META, true)) {
            return true;
        }
        return class_exists('WebMaven_AI_Marking') && WebMaven_AI_Marking::is_ai_generated($id);
    }

    private static function title(string $title): string {
        $title = trim(html_entity_decode(wp_strip_all_tags($title), ENT_QUOTES, 'UTF-8'));
        return $title !== '' ? $title : 'Untitled';
    }

    /** "1,2, 3" or [1, 2] as positive ids. */
    private static function id_list($raw): array {
        $parts = is_array($raw) ? $raw : explode(',', (string) $raw);
        $out = [];
        foreach ($parts as $part) {
            $id = (int) trim((string) $part);
            if ($id > 0) {
                $out[$id] = $id;
            }
        }
        return array_values($out);
    }

    /** The blog cards' image URLs (wm_posts_imgs: a JSON list, as the theme reads it). */
    private static function blog_card_urls(): array {
        $raw = get_option('wm_posts_imgs', '');
        $list = is_array($raw) ? $raw : json_decode((string) $raw, true);
        $out = [];
        foreach (is_array($list) ? $list : [] as $url) {
            if (is_string($url) && $url !== '') {
                $out[] = $url;
            }
        }
        return $out;
    }

    /** The site details (wm_var_<key>) that hold text: [{label, value}]. */
    private static function fact_values(): array {
        global $wpdb;
        if (!isset($wpdb) || !is_object($wpdb) || !method_exists($wpdb, 'get_results') || !method_exists($wpdb, 'prepare')) {
            return [];
        }
        $like = (method_exists($wpdb, 'esc_like') ? $wpdb->esc_like('wm_var_') : 'wm\\_var\\_') . '%';
        $rows = (array) $wpdb->get_results($wpdb->prepare(
            "SELECT option_name, option_value FROM {$wpdb->options} WHERE option_name LIKE %s LIMIT 500",
            $like
        ), defined('ARRAY_A') ? ARRAY_A : 'ARRAY_A');
        $labels = [];
        $registry = json_decode((string) get_option('wm_var_registry', ''), true);
        foreach (is_array($registry) ? $registry : [] as $entry) {
            if (is_array($entry) && is_string($entry['key'] ?? null) && is_string($entry['label'] ?? null)) {
                $labels[$entry['key']] = $entry['label'];
            }
        }
        $out = [];
        foreach ($rows as $row) {
            $row = (array) $row;
            $name = (string) ($row['option_name'] ?? '');
            if ($name === 'wm_var_registry' || strpos($name, 'wm_var_') !== 0) {
                continue;
            }
            $value = function_exists('maybe_unserialize') ? maybe_unserialize((string) ($row['option_value'] ?? '')) : (string) ($row['option_value'] ?? '');
            if (!is_string($value) || $value === '') {
                continue;
            }
            $key = substr($name, strlen('wm_var_'));
            $label = $labels[$key] ?? ucfirst(trim(str_replace(['_', '-'], ' ', $key)));
            $out[] = ['label' => self::title($label), 'value' => $value];
        }
        return $out;
    }

    // ── Files ──────────────────────────────────────────────────────────────

    /** Every file of the library: exact path, lowercase path, and the ids. */
    private static function file_map(): array {
        $map = ['exact' => [], 'lower' => [], 'ids' => []];
        $ids = array_map('intval', (array) get_posts([
            'post_type' => 'attachment',
            'post_status' => 'any',
            'numberposts' => -1,
            'fields' => 'ids',
            'no_found_rows' => true,
        ]));
        foreach (array_chunk($ids, 200) as $chunk) {
            if (function_exists('update_meta_cache')) {
                update_meta_cache('post', $chunk);
            }
            foreach ($chunk as $id) {
                $map['ids'][$id] = true;
                foreach (self::files_of($id) as $path => $size) {
                    $map['exact'][$path] = $id;
                    $map['lower'][strtolower($path)] = $id;
                }
            }
        }
        return $map;
    }

    /**
     * Every file of an attachment, relative to the uploads folder, with its
     * size name: 'full' (the attached file), 'original' (before scaling),
     * then each size of its metadata.
     */
    public static function files_of(int $id): array {
        $out = [];
        $main = ltrim(str_replace('\\', '/', (string) get_post_meta($id, '_wp_attached_file', true)), '/');
        if ($main === '') {
            return $out;
        }
        $out[$main] = 'full';
        $dir = dirname($main);
        $dir = ($dir === '.' || $dir === '') ? '' : $dir . '/';
        $meta = get_post_meta($id, '_wp_attachment_metadata', true);
        if (!is_array($meta)) {
            return $out;
        }
        if (!empty($meta['original_image']) && is_string($meta['original_image'])) {
            $out += [$dir . basename($meta['original_image']) => 'original'];
        }
        foreach ((array) ($meta['sizes'] ?? []) as $size => $info) {
            if (!is_array($info)) {
                continue;
            }
            if (!empty($info['file']) && is_string($info['file'])) {
                $out += [$dir . basename($info['file']) => (string) $size];
            }
            // The same size in other formats (WordPress 6.1 sources).
            foreach ((array) ($info['sources'] ?? []) as $source) {
                if (is_array($source) && !empty($source['file']) && is_string($source['file'])) {
                    $out += [$dir . basename($source['file']) => (string) $size];
                }
            }
        }
        return $out;
    }

    /** The attachments a text points at: upload URLs and paths, wp-image-<id>, [gallery ids]. */
    private static function referenced_ids(string $text, array $files): array {
        if ($text === '') {
            return [];
        }
        $text = str_replace('\\/', '/', $text);
        $found = [];
        foreach (self::upload_paths($text) as $path) {
            $id = self::resolve($path, $files);
            if ($id > 0) {
                $found[$id] = true;
            }
        }
        if (preg_match_all('/\bwp-image-(\d+)\b/', $text, $m)) {
            foreach ($m[1] as $raw) {
                if (isset($files['ids'][(int) $raw])) {
                    $found[(int) $raw] = true;
                }
            }
        }
        if (preg_match_all('/\[gallery\b[^\]]*\bids=["\']?([\d,\s]+)/i', $text, $m)) {
            foreach ($m[1] as $list) {
                foreach (self::id_list($list) as $id) {
                    if (isset($files['ids'][$id])) {
                        $found[$id] = true;
                    }
                }
            }
        }
        return array_keys($found);
    }

    /** The paths under the uploads folder a text names, decoded, relative to that folder. */
    public static function upload_paths(string $text): array {
        $out = [];
        foreach (self::upload_bases() as $base) {
            if (stripos($text, $base . '/') === false) {
                continue;
            }
            if (!preg_match_all('~' . preg_quote($base, '~') . '/([^\s"\'<>()\\\\?#,;&]+)~i', $text, $m)) {
                continue;
            }
            foreach ($m[1] as $raw) {
                $path = rtrim(rawurldecode($raw), '.');
                if (preg_match('/\.[a-z0-9]{2,5}$/i', $path) && strpos($path, '..') === false) {
                    $out[$path] = true;
                }
            }
        }
        return array_keys($out);
    }

    /** The uploads folder's URL path ("/wp-content/uploads"), and the default one when it differs. */
    private static function upload_bases(): array {
        $out = [];
        $uploads = function_exists('wp_upload_dir') ? wp_upload_dir(null, false) : [];
        $path = is_array($uploads) && !empty($uploads['baseurl']) ? (string) wp_parse_url((string) $uploads['baseurl'], PHP_URL_PATH) : '';
        $path = rtrim($path, '/');
        if ($path !== '') {
            $out[] = $path;
        }
        if (!in_array('/wp-content/uploads', $out, true)) {
            $out[] = '/wp-content/uploads';
        }
        return $out;
    }

    /** The attachment a relative path is a file of, or 0: exact, any case, then without a size or scaled suffix. */
    private static function resolve(string $path, array $files): int {
        if (isset($files['exact'][$path])) {
            return (int) $files['exact'][$path];
        }
        $lower = strtolower($path);
        if (isset($files['lower'][$lower])) {
            return (int) $files['lower'][$lower];
        }
        $stem = preg_replace('/-(?:\d+x\d+|scaled|rotated)(?=\.[a-z0-9]+$)/i', '', $lower);
        if ($stem !== $lower && isset($files['lower'][$stem])) {
            return (int) $files['lower'][$stem];
        }
        $scaled = preg_replace('/(\.[a-z0-9]+)$/i', '-scaled$1', $stem);
        return isset($files['lower'][$scaled]) ? (int) $files['lower'][$scaled] : 0;
    }

    /**
     * A text with every reference to file $from pointing at file $to: each
     * URL or path of $from becomes $to's file of the same size (its main
     * file when it has no such size), and wp-image-<id>, [gallery ids] and
     * the media blocks' "id" follow.
     */
    public static function replace_in_text(string $text, int $from, int $to): string {
        $from_files = [];
        foreach (self::files_of($from) as $path => $size) {
            $from_files[strtolower($path)] = $size;
        }
        $to_by_size = [];
        foreach (self::files_of($to) as $path => $size) {
            if (!isset($to_by_size[$size])) {
                $to_by_size[$size] = $path;
            }
        }
        if (!$from_files || !isset($to_by_size['full'])) {
            return $text;
        }
        foreach (self::upload_bases() as $base) {
            foreach ([$base . '/', str_replace('/', '\\/', $base) . '\\/'] as $prefix) {
                $slash = substr($prefix, -2) === '\\/' ? '\\/' : '/';
                $text = preg_replace_callback(
                    '~(' . preg_quote($prefix, '~') . ')((?:[^\s"\'<>()\\\\?#,;&]|\\\\/)+)~i',
                    function ($m) use ($from_files, $to_by_size, $slash) {
                        $raw = $m[2];
                        $trail = '';
                        while ($raw !== '' && substr($raw, -1) === '.') {
                            $trail .= '.';
                            $raw = substr($raw, 0, -1);
                        }
                        $path = rawurldecode(str_replace('\\/', '/', $raw));
                        $size = $from_files[strtolower($path)] ?? null;
                        if ($size === null) {
                            return $m[0];
                        }
                        $target = $to_by_size[$size] ?? $to_by_size['full'];
                        return $m[1] . str_replace('/', $slash, $target) . $trail;
                    },
                    $text
                );
            }
        }
        $text = preg_replace('/\bwp-image-' . $from . '\b/', 'wp-image-' . $to, $text);
        $text = preg_replace_callback('/(\[gallery\b[^\]]*\bids=["\']?)([\d,\s]+)/i', function ($m) use ($from, $to) {
            return $m[1] . preg_replace('/(?<!\d)' . $from . '(?!\d)/', (string) $to, $m[2]);
        }, $text);
        return preg_replace_callback('/(<!--\s+wp:(?:image|cover|video|audio|file|media-text)\s+)(\{.*?\})(\s+\/?-->)/s', function ($m) use ($from, $to) {
            return $m[1] . preg_replace('/("(?:id|mediaId)"\s*:\s*)' . $from . '(?!\d)/', '${1}' . $to, $m[2]) . $m[3];
        }, $text);
    }

    // ── Reading a picture ──────────────────────────────────────────────────

    /**
     * The picture a model reads for an image: its medium size on disk, else
     * its own file, when it is a JPEG, PNG, GIF or WebP of at most
     * READABLE_MAX_BYTES. {path, mime}, or null.
     */
    public static function readable_file(int $id): ?array {
        if ($id <= 0 || !wp_attachment_is_image($id)) {
            return null;
        }
        $uploads = wp_upload_dir(null, false);
        $basedir = rtrim(str_replace('\\', '/', (string) ($uploads['basedir'] ?? '')), '/');
        $main = ltrim(str_replace('\\', '/', (string) get_post_meta($id, '_wp_attached_file', true)), '/');
        if ($basedir === '' || $main === '') {
            return null;
        }
        $dir = dirname($main);
        $dir = ($dir === '.' || $dir === '') ? '' : $dir . '/';
        $candidates = [];
        $meta = get_post_meta($id, '_wp_attachment_metadata', true);
        if (is_array($meta) && is_array($meta['sizes']['medium'] ?? null) && !empty($meta['sizes']['medium']['file'])) {
            $candidates[] = [$dir . basename((string) $meta['sizes']['medium']['file']), (string) ($meta['sizes']['medium']['mime-type'] ?? '')];
        }
        $candidates[] = [$main, function_exists('get_post_mime_type') ? (string) get_post_mime_type($id) : ''];
        foreach ($candidates as $candidate) {
            list($relative, $mime) = $candidate;
            if (strpos($relative, '..') !== false) {
                continue;
            }
            $path = $basedir . '/' . $relative;
            if (!is_file($path) || !is_readable($path)) {
                continue;
            }
            $bytes = filesize($path);
            if ($bytes === false || $bytes <= 0 || $bytes > self::READABLE_MAX_BYTES) {
                continue;
            }
            if ($mime === '' && function_exists('wp_check_filetype')) {
                $mime = (string) (wp_check_filetype($path)['type'] ?? '');
            }
            if (in_array($mime, self::READABLE_MIMES, true)) {
                return ['path' => $path, 'mime' => $mime];
            }
        }
        return null;
    }

    /** The attachment behind an upload URL (any size of it), or 0. */
    public static function attachment_id_for_url(string $url): int {
        $url = trim($url);
        if ($url === '') {
            return 0;
        }
        if (function_exists('attachment_url_to_postid')) {
            $id = (int) attachment_url_to_postid($url);
            if ($id > 0) {
                return $id;
            }
            $stem = preg_replace('/-(?:\d+x\d+|scaled|rotated)(?=\.[a-z0-9]+(?:[?#].*)?$)/i', '', $url);
            if ($stem !== $url) {
                $id = (int) attachment_url_to_postid($stem);
                if ($id > 0) {
                    return $id;
                }
            }
        }
        $paths = self::upload_paths($url);
        if (!$paths) {
            return 0;
        }
        return self::resolve($paths[0], self::file_map());
    }
}
