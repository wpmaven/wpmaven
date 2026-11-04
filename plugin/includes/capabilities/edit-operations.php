<?php
/**
 * The edit engine's site commands (2026-10-05). The API's edit service
 * changes a genstudio site through these, page by page, theme file by theme
 * file and menu by menu, and reads back what the site holds, so a publish
 * never overwrites a change made elsewhere. Theme files (wm_theme_patch)
 * are WPMaven Agent's (capabilities/theme-files.php there); these read them.
 *
 *   wm_page_update   {post_id, content, title?, expect_sha256?}
 *                    -> {post_id, sha256, modified_gmt}
 *   wm_page_create   {slug, title, content, status: draft|publish, wm_page, meta_description?, parent?}
 *                    -> {post_id, post_slug, status, permalink, sha256, modified_gmt, existed}
 *   wm_media_get     {media_id, max_bytes?}
 *                    -> {id, url, mime, filename, width, height, alt, bytes, base64}
 *   wm_site_identity {custom_logo?, site_icon?}   (no params: read only)
 *                    -> {before: {custom_logo, site_icon}, after: {custom_logo, site_icon},
 *                        custom_logo_url, site_icon_url}
 *   wm_fingerprints  {post_ids, theme_slug?, theme_files?, form_names?}
 *                    -> {pages: {id: {sha256, modified_gmt, status, slug}|null},
 *                        theme_files: {path: sha256|null}, theme_version, active_theme,
 *                        forms: {name: design sha256|null} (when form_names is sent)}
 *   wm_menu_get      {location?}
 *                    -> {locations: [{location, label, menu_id, menu_name, items}]}
 *   wm_menu_set      {location, items: [MenuItemInput]}
 *                    -> {menu_id, location, before: [Item], after: [Item]}
 *   wm_ledger_probe  {pages, products, forms, assets, theme_slug?}
 *                    -> {pages, products, forms, media, theme_files, theme_version, active_theme}
 *   wm_preview_stage {preview_id, expires_at, theme_slug, pages, theme_files, ...}
 *                    -> {staged: true, preview_id}
 *   wm_preview_discard {preview_id} -> {discarded: true}
 *
 * A menu Item is {id, label, link, newTab, classes, parent, order}; a link is
 * {kind: page, pageId} | {kind: post, postId} | {kind: product, productId} |
 * {kind: term, taxonomy: category|product_cat, termId} | {kind: shop} |
 * {kind: url, url}. A MenuItemInput is {id?, label, link, newTab?, classes?,
 * children?}.
 *
 * Hashes are the sha256 (hex) of what the site holds AFTER its own write
 * (WordPress may rewrite content on save). A designed page whose sections
 * are blocks hashes its designed blocks alone: the blocks the owner added
 * between them are no change, and every page write puts them back after
 * the section they followed (class-webmaven-designed-blocks.php). Dates are WordPress's own GMT
 * values ('Y-m-d H:i:s'). Failures THROW an Exception whose message is
 * "CODE: sentence": the API reads ^([A-Z_]+):\s*(.*)$ and may show the
 * sentence to the owner. Registered through the filter, so the
 * execute_command bridge (webhook_<name>) cannot reach these.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

require_once dirname(__DIR__) . '/class-webmaven-designed-blocks.php';

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['wm_page_update'] = ['WebMaven_Cap_Edit_Operations', 'page_update'];
    $handlers['wm_page_create'] = ['WebMaven_Cap_Edit_Operations', 'page_create'];
    $handlers['wm_media_get'] = ['WebMaven_Cap_Edit_Operations', 'media_get'];
    $handlers['wm_site_identity'] = ['WebMaven_Cap_Edit_Operations', 'site_identity'];
    $handlers['wm_fingerprints'] = ['WebMaven_Cap_Edit_Operations', 'fingerprints'];
    $handlers['wm_menu_get'] = ['WebMaven_Cap_Edit_Operations', 'menu_get'];
    $handlers['wm_menu_set'] = ['WebMaven_Cap_Edit_Operations', 'menu_set'];
    $handlers['wm_ledger_probe'] = ['WebMaven_Cap_Edit_Operations', 'ledger_probe'];
    $handlers['wm_preview_stage'] = ['WebMaven_Cap_Edit_Operations', 'preview_stage'];
    $handlers['wm_preview_discard'] = ['WebMaven_Cap_Edit_Operations', 'preview_discard'];
    return $handlers;
});

final class WebMaven_Cap_Edit_Operations {

    /** The file kinds a theme patch may write or remove. */
    const THEME_EXTENSIONS = ['php', 'css', 'js', 'json', 'md', 'txt', 'svg', 'png', 'jpg', 'jpeg', 'webp'];

    /** Theme files listed when the caller names none. */
    const MAX_LISTED_FILES = 500;

    /** Folders that are never part of a theme listing. */
    const SKIPPED_DIRS = ['.git', '.svn', '.hg', 'node_modules'];

    const MAX_MENU_ITEMS = 30;
    const MAX_LABEL_CHARS = 60;
    const MENU_LINK_KINDS = ['page', 'post', 'product', 'term', 'shop', 'url'];
    const MENU_ITEM_KEYS = ['id', 'label', 'link', 'newTab', 'classes', 'children'];

    /** Post statuses the ledger probe matches (never trash or auto-draft). */
    const LIVE_STATUSES = ['publish', 'draft', 'private', 'pending', 'future'];

    /** A page the edit engine adds starts as a draft (a connected site: the owner publishes it) or published (a hosted site). */
    const NEW_PAGE_STATUSES = ['draft', 'publish'];

    /** Marks a page wm_page_create made: a retried create updates it instead of adding a second page. */
    const EDIT_PAGE_META = '_wm_edit_page';

    /** Largest page content one create takes (the preview staging's own cap). */
    const MAX_PAGE_BYTES = 3145728; // 3 MB

    /** The library images wm_media_get hands to the edit engine, and how large. */
    const MEDIA_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const MEDIA_DEFAULT_BYTES = 8388608; // 8 MB
    const MEDIA_MAX_BYTES = 12582912; // 12 MB

    /** "CODE: sentence", the shape the API parses. */
    private static function error(string $code, string $message): Exception {
        return new Exception($code . ': ' . $message);
    }

    // ── wm_page_update ──────────────────────────────────────────────────────

    public static function page_update($params = [], $step_id = null) {
        $post_id = self::positive_int($params['post_id'] ?? null);
        $post = $post_id > 0 ? get_post($post_id) : null;
        if (!$post || $post->post_type !== 'page' || $post->post_status === 'trash') {
            throw self::error('NOT_FOUND', 'Page ' . $post_id . ' was not found.');
        }
        $content = $params['content'] ?? null;
        if (!is_string($content) || trim($content) === '') {
            throw self::error('VALIDATION', 'The new content of the page is missing.');
        }
        $title = null;
        if (array_key_exists('title', $params) && $params['title'] !== null) {
            $title = trim(wp_strip_all_tags((string) $params['title']));
            if ($title === '') {
                throw self::error('VALIDATION', 'The page title cannot be empty.');
            }
        }
        $expect = $params['expect_sha256'] ?? null;
        if ($expect !== null && $expect !== '') {
            if (!is_string($expect) || !preg_match('/^[a-f0-9]{64}$/i', $expect)) {
                throw self::error('VALIDATION', 'expect_sha256 must be a sha256 in hex.');
            }
            if (!hash_equals(strtolower($expect), self::page_sha((string) $post->post_content))) {
                throw self::error('DRIFT', 'The page "' . self::title_of($post) . '" was changed on the site after this change was prepared.');
            }
        }

        $current = (string) $post->post_content;
        $anchors = null;
        $saved = self::commands()->rewrite_fullhtml_page($post_id, $content, $title, self::keeper($current, $post_id, $anchors));
        if (is_wp_error($saved)) {
            throw self::error('WRITE_FAILED', 'The page "' . self::title_of($post) . '" could not be saved: ' . wp_strip_all_tags($saved->get_error_message()));
        }
        self::remember_anchors($post_id, $anchors);
        self::purge_post_caches($post_id);

        // What the site holds now, read back.
        clean_post_cache($post_id);
        $fresh = get_post($post_id);
        if (!$fresh) {
            throw self::error('WRITE_FAILED', 'The page could not be read back after the save.');
        }
        return [
            'post_id' => $post_id,
            'sha256' => self::page_sha((string) $fresh->post_content),
            'modified_gmt' => (string) $fresh->post_modified_gmt,
        ];
    }

    /** The hash the edit engine compares for a page (its designed blocks alone when it has any). */
    public static function page_sha(string $content): string {
        return WebMaven_Designed_Blocks::designed_sha($content);
    }

    /** Where the owner's blocks of a page were before a write moved them (WebMaven_Designed_Blocks::merge). */
    const OWNER_ANCHORS_META = '_wm_owner_anchors';

    /** The owner's blocks' sections a page remembers. */
    public static function owner_anchors(int $post_id): array {
        $m = get_post_meta($post_id, self::OWNER_ANCHORS_META, true);
        return is_array($m) ? $m : [];
    }

    /** What a page write keeps of the page as it is: the owner's blocks between designed sections. */
    private static function keeper(string $current, int $post_id, &$anchors) {
        $memory = self::owner_anchors($post_id);
        return function ($clean) use ($current, $memory, &$anchors) {
            return WebMaven_Designed_Blocks::merge((string) $clean, $current, $memory, $anchors);
        };
    }

    private static function remember_anchors(int $post_id, $anchors) {
        if (!is_array($anchors)) {
            return;
        }
        if ($anchors) {
            update_post_meta($post_id, self::OWNER_ANCHORS_META, $anchors);
        } else {
            delete_post_meta($post_id, self::OWNER_ANCHORS_META);
        }
    }

    /** The plugin's commands (the same write path as create_page). */
    private static function commands() {
        return new WebMaven_WordPress_Commands();
    }

    // ── wm_page_create ──────────────────────────────────────────────────────

    /**
     * A page the edit engine adds (add_page). The content is cleaned exactly
     * as wm_page_update and create_page clean it (sanitize_page_content: the
     * same kses allowlist, inline scripts moved to the page's script file),
     * and the page is a designed page of its planned slug (_wm_page,
     * _webmaven_fullhtml, the AI marker). It starts as a draft (a connected
     * site, where the owner publishes it) or published (a hosted site). A
     * slug already taken gets WordPress's next free one: the answer's
     * post_slug says which. Idempotent: a retried create finds the page it
     * made for that planned slug (not in the trash) and updates it. parent
     * (1.8.0): the page it goes under, when that is a page of the site and
     * not in the trash; anything else leaves it at the top level.
     */
    public static function page_create($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        $wm_page = $params['wm_page'] ?? null;
        if (!is_string($wm_page) || !preg_match('/^[a-z0-9][a-z0-9_-]{0,80}$/', $wm_page)) {
            throw self::error('VALIDATION', 'wm_page must be the slug of the page in the site plan.');
        }
        $title = trim(wp_strip_all_tags((string) ($params['title'] ?? '')));
        if ($title === '' || strlen($title) > 200) {
            throw self::error('VALIDATION', 'The new page needs a title of at most 200 characters.');
        }
        $content = $params['content'] ?? null;
        if (!is_string($content) || trim($content) === '') {
            throw self::error('VALIDATION', 'The content of the new page is missing.');
        }
        if (strlen($content) > self::MAX_PAGE_BYTES) {
            throw self::error('VALIDATION', 'The content of the new page is larger than 3 MB.');
        }
        $status = $params['status'] ?? 'draft';
        if (!is_string($status) || !in_array($status, self::NEW_PAGE_STATUSES, true)) {
            throw self::error('VALIDATION', 'status must be draft or publish.');
        }
        $slug = sanitize_title(is_string($params['slug'] ?? null) && trim($params['slug']) !== '' ? $params['slug'] : $wm_page);
        if ($slug === '') {
            throw self::error('VALIDATION', 'The address of the new page must hold letters or numbers.');
        }
        $meta_description = is_string($params['meta_description'] ?? null) ? sanitize_text_field($params['meta_description']) : '';
        $parent = self::parent_page($params['parent'] ?? null);

        $commands = self::commands();
        $existing = self::edit_page_for($wm_page);
        if ($existing) {
            $post_id = (int) $existing->ID;
            $anchors = null;
            $saved = $commands->rewrite_fullhtml_page($post_id, $content, $title, self::keeper((string) $existing->post_content, $post_id, $anchors));
            if (is_wp_error($saved)) {
                throw self::error('WRITE_FAILED', 'The page "' . self::plain($title) . '" could not be saved: ' . wp_strip_all_tags($saved->get_error_message()));
            }
            self::remember_anchors($post_id, $anchors);
            $move = [];
            if ((string) $existing->post_status !== $status) {
                $move['post_status'] = $status;
            }
            if ($parent !== null && (int) $existing->post_parent !== $parent) {
                $move['post_parent'] = $parent;
            }
            if ($move) {
                $moved = wp_update_post(wp_slash(['ID' => $post_id] + $move), true);
                if (is_wp_error($moved) || !$moved) {
                    throw self::error('WRITE_FAILED', 'The page "' . self::plain($title) . '" was saved but its status or the page it goes under could not be set.');
                }
            }
        } else {
            list($clean, $scripts) = $commands->sanitize_page_content($content);
            $created = wp_insert_post(wp_slash([
                'post_type' => 'page',
                'post_status' => $status,
                'post_title' => $title,
                'post_name' => $slug,
                'post_content' => $clean,
                'post_parent' => $parent ?? 0,
            ]), true);
            if (is_wp_error($created) || (int) $created <= 0) {
                throw self::error('WRITE_FAILED', 'The page "' . self::plain($title) . '" could not be created: '
                    . (is_wp_error($created) ? wp_strip_all_tags($created->get_error_message()) : 'WordPress gave no page id') . '.');
            }
            $post_id = (int) $created;
            update_post_meta($post_id, '_webmaven_fullhtml', 1);
            WebMaven_AI_Marking::mark_post($post_id);
            update_post_meta($post_id, self::EDIT_PAGE_META, 1);
            if (!empty($scripts)) {
                // The page's script file is WPMaven Agent's (capabilities/page-scripts.php).
                do_action('webmaven_page_scripts', $post_id, $scripts);
            }
        }
        // The planned page this is, so the theme finds its styles (as create_page writes it).
        update_post_meta($post_id, '_wm_page', $wm_page);
        if ($meta_description !== '') {
            update_post_meta($post_id, '_yoast_wpseo_metadesc', $meta_description);
            update_post_meta($post_id, '_webmaven_meta_description', $meta_description);
        }
        self::purge_post_caches($post_id);

        // What the site holds now, read back.
        clean_post_cache($post_id);
        $fresh = get_post($post_id);
        if (!$fresh) {
            throw self::error('WRITE_FAILED', 'The new page could not be read back after the save.');
        }
        return [
            'post_id' => $post_id,
            'post_slug' => (string) $fresh->post_name,
            'status' => (string) $fresh->post_status,
            'permalink' => (string) get_permalink($post_id),
            'sha256' => self::page_sha((string) $fresh->post_content),
            'modified_gmt' => (string) $fresh->post_modified_gmt,
            'existed' => $existing !== null,
        ];
    }

    /** The page a new page goes under: a page of the site not in the trash, else null (the top level). */
    private static function parent_page($value): ?int {
        $id = is_numeric($value) ? (int) $value : 0;
        if ($id <= 0) {
            return null;
        }
        $parent = get_post($id);
        return $parent && $parent->post_type === 'page' && in_array((string) $parent->post_status, self::LIVE_STATUSES, true) ? $id : null;
    }

    /** The page wm_page_create made for this planned slug, when it is still on the site (never one in the trash). */
    private static function edit_page_for(string $wm_page) {
        $found = get_posts([
            'post_type' => 'page',
            'post_status' => self::LIVE_STATUSES,
            'meta_query' => [
                ['key' => '_wm_page', 'value' => $wm_page],
                ['key' => self::EDIT_PAGE_META, 'value' => '1'],
            ],
            'numberposts' => 1,
            'orderby' => 'ID',
            'order' => 'ASC',
        ]);
        return $found ? $found[0] : null;
    }

    // ── wm_media_get ────────────────────────────────────────────────────────

    /**
     * One image of the media library for the edit engine (replace_image with
     * a library file): its address, size and alt text, and its bytes in
     * base64, so the engine places it in the design wherever the site is.
     */
    public static function media_get($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        $id = self::positive_int($params['media_id'] ?? null);
        $post = $id > 0 ? get_post($id) : null;
        if (!$post || $post->post_type !== 'attachment') {
            throw self::error('NOT_FOUND', 'Image ' . $id . ' was not found in the media library.');
        }
        $max = self::MEDIA_DEFAULT_BYTES;
        if (array_key_exists('max_bytes', $params) && $params['max_bytes'] !== null) {
            $max = self::positive_int($params['max_bytes']);
            if ($max <= 0) {
                throw self::error('VALIDATION', 'max_bytes must be a number of bytes.');
            }
            $max = min($max, self::MEDIA_MAX_BYTES);
        }
        $mime = strtolower((string) get_post_mime_type($id));
        if (!in_array($mime, self::MEDIA_MIMES, true)) {
            throw self::error('VALIDATION', '"' . self::title_of($post) . '" is not a JPEG, PNG, WebP or GIF image.');
        }
        $file = get_attached_file($id);
        if (!is_string($file) || $file === '' || !is_file($file) || !is_readable($file)) {
            throw self::error('NOT_FOUND', 'The file of image ' . $id . ' is missing on the site.');
        }
        $size = (int) filesize($file);
        if ($size > $max) {
            throw self::error('TOO_LARGE', 'This image is too large to use here. Choose one under ' . max(1, (int) floor($max / 1048576)) . ' MB.');
        }
        $data = file_get_contents($file);
        if ($data === false) {
            throw self::error('NOT_FOUND', 'The file of image ' . $id . ' could not be read.');
        }
        $meta = wp_get_attachment_metadata($id);
        return [
            'id' => $id,
            'url' => (string) wp_get_attachment_url($id),
            'mime' => $mime,
            'filename' => basename($file),
            'width' => is_array($meta) ? (int) ($meta['width'] ?? 0) : 0,
            'height' => is_array($meta) ? (int) ($meta['height'] ?? 0) : 0,
            'alt' => self::plain_text((string) get_post_meta($id, '_wp_attachment_image_alt', true), 300),
            'bytes' => strlen($data),
            'base64' => base64_encode($data),
        ];
    }

    // ── wm_site_identity ────────────────────────────────────────────────────

    /**
     * The site's logo (the custom_logo mod of the active theme) and icon (the
     * site_icon option): read when called without parameters, else set to
     * library images, 0 removing one. Every id is checked before anything is
     * written, and the answer holds the values before and after, so the edit
     * engine undoes a change exactly.
     */
    public static function site_identity($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        $set = [];
        foreach (['custom_logo', 'site_icon'] as $key) {
            if (!array_key_exists($key, $params) || $params[$key] === null) {
                continue;
            }
            $raw = $params[$key];
            $remove = $raw === 0 || $raw === '0';
            $id = $remove ? 0 : self::positive_int($raw);
            if (!$remove && $id <= 0) {
                throw self::error('VALIDATION', $key . ' must be the id of an image, or 0 to remove it.');
            }
            if ($id > 0 && !self::is_library_image($id)) {
                throw self::error('NOT_FOUND', 'Image ' . $id . ' was not found in the media library.');
            }
            $set[$key] = $id;
        }
        $before = self::identity_now();
        if (array_key_exists('custom_logo', $set)) {
            if ($set['custom_logo'] > 0) {
                set_theme_mod('custom_logo', $set['custom_logo']);
            } else {
                remove_theme_mod('custom_logo');
            }
        }
        if (array_key_exists('site_icon', $set)) {
            if ($set['site_icon'] > 0) {
                update_option('site_icon', $set['site_icon']);
            } else {
                delete_option('site_icon');
            }
        }
        $after = self::identity_now();
        if ($set) {
            // The logo and the icon show on every page.
            self::purge_all_caches();
        }
        return [
            'before' => $before,
            'after' => $after,
            'custom_logo_url' => $after['custom_logo'] > 0 ? ((string) wp_get_attachment_url($after['custom_logo']) ?: null) : null,
            'site_icon_url' => $after['site_icon'] > 0 ? ((string) wp_get_attachment_url($after['site_icon']) ?: null) : null,
        ];
    }

    private static function identity_now(): array {
        return [
            'custom_logo' => (int) get_theme_mod('custom_logo', 0),
            'site_icon' => (int) get_option('site_icon', 0),
        ];
    }

    private static function is_library_image(int $id): bool {
        $post = get_post($id);
        return $post && $post->post_type === 'attachment' && wp_attachment_is_image($id);
    }

    // ── Theme paths (wm_theme_patch is WPMaven Agent's: capabilities/theme-files.php) ──

    /**
     * A theme-relative path: no absolute path, no "..", no null byte, no
     * backslash, no hidden file, one of the allowed extensions. Throws BAD_PATH.
     */
    public static function theme_path($path): string {
        if (!is_string($path) || $path === '' || strlen($path) > 255) {
            throw self::error('BAD_PATH', 'A theme file path is missing or too long.');
        }
        $shown = self::plain($path);
        if (strpos($path, "\0") !== false || strpos($path, '\\') !== false || strpos($path, '..') !== false
            || strpos($path, ':') !== false || $path[0] === '/' || preg_match('/[\x00-\x1F\x7F]/', $path)) {
            throw self::error('BAD_PATH', 'The path ' . $shown . ' is not a file inside the theme.');
        }
        foreach (explode('/', $path) as $segment) {
            if ($segment === '' || $segment === '.' || $segment[0] === '.') {
                throw self::error('BAD_PATH', 'The path ' . $shown . ' is not a file inside the theme.');
            }
        }
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        if (!in_array($ext, self::THEME_EXTENSIONS, true)) {
            throw self::error('BAD_PATH', 'The theme cannot hold ' . $shown . ': only ' . implode(', ', self::THEME_EXTENSIONS) . ' files are written.');
        }
        return $path;
    }

    /**
     * BAD_PATH unless the file's folder, followed through any link, is inside
     * the theme: a linked folder never leads a write or a removal elsewhere.
     * Checked before any folder is created.
     */
    public static function inside_theme(string $dir, string $rel) {
        $folder = WebMaven_Self_Protect::resolve_real_path(dirname($dir . '/' . $rel));
        $folder = rtrim(str_replace('\\', '/', $folder), '/');
        if ($folder === '' || ($folder !== $dir && strpos($folder, $dir . '/') !== 0)) {
            throw self::error('BAD_PATH', 'The path ' . self::plain($rel) . ' leads outside the theme.');
        }
    }

    // ── wm_fingerprints ─────────────────────────────────────────────────────

    public static function fingerprints($params = [], $step_id = null) {
        $ids = $params['post_ids'] ?? [];
        if (!is_array($ids) || count($ids) > 500) {
            throw self::error('VALIDATION', 'post_ids must be a list of at most 500 ids.');
        }
        $pages = [];
        foreach ($ids as $raw) {
            $id = self::positive_int($raw);
            if ($id <= 0) {
                throw self::error('VALIDATION', 'post_ids must hold positive ids.');
            }
            $post = get_post($id);
            $pages[(string) $id] = ($post && $post->post_type !== 'revision') ? [
                'sha256' => self::page_sha((string) $post->post_content),
                'modified_gmt' => (string) $post->post_modified_gmt,
                'status' => (string) $post->post_status,
                'slug' => (string) $post->post_name,
            ] : null;
        }

        $active = (string) get_stylesheet();
        $slug = isset($params['theme_slug']) && $params['theme_slug'] !== '' ? (string) $params['theme_slug'] : $active;
        $dir = self::theme_dir($slug);
        $theme_files = [];
        if (isset($params['theme_files']) && $params['theme_files'] !== null) {
            if (!is_array($params['theme_files'])) {
                throw self::error('VALIDATION', 'theme_files must be a list of paths.');
            }
            foreach ($params['theme_files'] as $path) {
                $rel = self::theme_path($path);
                self::inside_theme($dir, $rel);
                $theme_files[$rel] = self::file_sha($dir . '/' . $rel);
            }
        } else {
            $theme_files = self::theme_listing($dir);
        }

        $out = [
            'pages' => (object) $pages,
            'theme_files' => (object) $theme_files,
            'theme_version' => self::theme_version($dir),
            'active_theme' => $active,
        ];
        // Designed forms: the hash of their design fields and button
        // (WebMaven_Designed_Forms), so a form changed in WPForms since the
        // last publish shows as a change made in WordPress.
        if (isset($params['form_names'])) {
            if (!is_array($params['form_names']) || count($params['form_names']) > 100) {
                throw self::error('VALIDATION', 'form_names must be a list of at most 100 names.');
            }
            $forms = [];
            foreach ($params['form_names'] as $name) {
                $key = sanitize_key((string) $name);
                if ($key === '') {
                    continue;
                }
                $forms[$key] = class_exists('WebMaven_Designed_Forms') ? WebMaven_Designed_Forms::sha_by_name($key) : null;
            }
            $out['forms'] = (object) $forms;
        }
        return $out;
    }

    // ── Theme helpers ───────────────────────────────────────────────────────

    /** The real folder of an installed theme; NOT_FOUND when there is none. */
    public static function theme_dir(string $slug): string {
        if (!preg_match('/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/', $slug) || strpos($slug, '..') !== false) {
            throw self::error('VALIDATION', 'The theme name ' . self::plain($slug) . ' is not valid.');
        }
        $theme = wp_get_theme($slug);
        $dir = ($theme && $theme->exists()) ? realpath((string) $theme->get_stylesheet_directory()) : false;
        if ($dir === false || !is_dir($dir)) {
            throw self::error('NOT_FOUND', 'The theme ' . $slug . ' is not installed on this site.');
        }
        return rtrim(str_replace('\\', '/', $dir), '/');
    }

    public static function file_sha(string $file) {
        if (!is_file($file)) {
            return null;
        }
        $sha = hash_file('sha256', $file);
        return $sha === false ? null : $sha;
    }

    /** The Version header of the theme's style.css, or null. */
    public static function theme_version(string $dir) {
        $file = $dir . '/style.css';
        if (!is_file($file)) {
            return null;
        }
        $data = get_file_data($file, ['Version' => 'Version']);
        $version = trim((string) ($data['Version'] ?? ''));
        return $version === '' ? null : $version;
    }

    /** Every patchable file of the theme (sorted, at most MAX_LISTED_FILES) with its sha256. */
    private static function theme_listing(string $dir): array {
        $paths = [];
        self::walk($dir, '', $paths);
        sort($paths, SORT_STRING);
        $out = [];
        foreach (array_slice($paths, 0, self::MAX_LISTED_FILES) as $rel) {
            $sha = self::file_sha($dir . '/' . $rel);
            if ($sha !== null) {
                $out[$rel] = $sha;
            }
        }
        return $out;
    }

    private static function walk(string $dir, string $prefix, array &$paths) {
        $entries = @scandir($dir);
        if ($entries === false) {
            return;
        }
        foreach ($entries as $name) {
            if ($name === '.' || $name === '..' || $name[0] === '.' || in_array($name, self::SKIPPED_DIRS, true)) {
                continue;
            }
            $full = $dir . '/' . $name;
            $rel = $prefix === '' ? $name : $prefix . '/' . $name;
            if (is_link($full)) {
                continue;
            }
            if (is_dir($full)) {
                if (count($paths) < self::MAX_LISTED_FILES * 4) {
                    self::walk($full, $rel, $paths);
                }
                continue;
            }
            if (in_array(strtolower(pathinfo($name, PATHINFO_EXTENSION)), self::THEME_EXTENSIONS, true)) {
                $paths[] = $rel;
            }
        }
    }

    // ── wm_menu_get ─────────────────────────────────────────────────────────

    public static function menu_get($params = [], $step_id = null) {
        $only = isset($params['location']) && $params['location'] !== '' ? (string) $params['location'] : null;
        $registered = (array) get_registered_nav_menus();
        if ($only !== null && !isset($registered[$only])) {
            throw self::error('NOT_FOUND', 'This theme has no menu location named ' . self::plain($only) . '.');
        }
        $assigned = (array) get_nav_menu_locations();
        $locations = [];
        foreach ($registered as $location => $label) {
            if ($only !== null && $location !== $only) {
                continue;
            }
            $menu = self::menu_at($assigned, (string) $location);
            $locations[] = [
                'location' => (string) $location,
                'label' => (string) $label,
                'menu_id' => $menu ? (int) $menu->term_id : null,
                'menu_name' => $menu ? (string) $menu->name : null,
                'items' => $menu ? self::menu_items((int) $menu->term_id) : [],
            ];
        }
        return ['locations' => $locations];
    }

    /** The menu assigned to a location, or null. */
    private static function menu_at(array $assigned, string $location) {
        $menu_id = (int) ($assigned[$location] ?? 0);
        if ($menu_id <= 0) {
            return null;
        }
        $menu = wp_get_nav_menu_object($menu_id);
        return $menu ? $menu : null;
    }

    /** A menu's items in order, as flat Items. */
    public static function menu_items(int $menu_id): array {
        $items = wp_get_nav_menu_items($menu_id, ['update_post_term_cache' => false]);
        $out = [];
        foreach ((array) $items as $item) {
            if (!is_object($item)) {
                continue;
            }
            $out[] = [
                'id' => (int) $item->ID,
                'label' => (string) $item->title,
                'link' => self::link_of($item),
                'newTab' => ((string) ($item->target ?? '')) === '_blank',
                'classes' => implode(' ', array_values(array_filter(array_map('strval', (array) ($item->classes ?? []))))),
                'parent' => (int) ($item->menu_item_parent ?? 0),
                'order' => (int) ($item->menu_order ?? 0),
            ];
        }
        usort($out, function ($a, $b) {
            return $a['order'] <=> $b['order'];
        });
        return $out;
    }

    /** What a menu item points at, as a link. */
    private static function link_of($item): array {
        $type = (string) ($item->type ?? '');
        $object = (string) ($item->object ?? '');
        $object_id = (int) ($item->object_id ?? 0);
        $shop = self::shop_page_id();
        if ($type === 'post_type') {
            if ($object === 'page' && $shop > 0 && $object_id === $shop) {
                return ['kind' => 'shop'];
            }
            if ($object === 'page') {
                return ['kind' => 'page', 'pageId' => $object_id];
            }
            if ($object === 'post') {
                return ['kind' => 'post', 'postId' => $object_id];
            }
            if ($object === 'product') {
                return ['kind' => 'product', 'productId' => $object_id];
            }
        }
        if ($type === 'post_type_archive' && $object === 'product') {
            return ['kind' => 'shop'];
        }
        if ($type === 'taxonomy' && in_array($object, ['category', 'product_cat'], true)) {
            return ['kind' => 'term', 'taxonomy' => $object, 'termId' => $object_id];
        }
        return ['kind' => 'url', 'url' => (string) ($item->url ?? '')];
    }

    private static function shop_page_id(): int {
        return function_exists('wc_get_page_id') ? max(0, (int) wc_get_page_id('shop')) : 0;
    }

    // ── wm_menu_set ─────────────────────────────────────────────────────────

    public static function menu_set($params = [], $step_id = null) {
        $location = is_string($params['location'] ?? null) ? $params['location'] : '';
        $registered = (array) get_registered_nav_menus();
        if ($location === '' || !isset($registered[$location])) {
            throw self::error('NOT_FOUND', 'This theme has no menu location named ' . self::plain($location) . '.');
        }
        $input = $params['items'] ?? null;
        if (!is_array($input) || ($input && array_keys($input) !== range(0, count($input) - 1))) {
            throw self::error('VALIDATION', 'items must be a list of menu items.');
        }

        // The whole tree is checked before anything is written.
        $count = 0;
        $seen_ids = [];
        $tree = [];
        foreach ($input as $entry) {
            $node = self::menu_item_input($entry, 0, $count, $seen_ids);
            $node['children'] = [];
            foreach ((array) ($entry['children'] ?? []) as $child) {
                $node['children'][] = self::menu_item_input($child, 1, $count, $seen_ids);
            }
            $tree[] = $node;
        }

        $assigned = (array) get_nav_menu_locations();
        $menu = self::menu_at($assigned, $location);
        $menu_id = $menu ? (int) $menu->term_id : self::create_menu_for($location, (string) $registered[$location]);

        $before = self::menu_items($menu_id);
        $existing = [];
        foreach ((array) wp_get_nav_menu_items($menu_id, ['update_post_term_cache' => false]) as $item) {
            if (is_object($item)) {
                $existing[(int) $item->ID] = $item;
            }
        }

        $kept = [];
        $position = 0;
        foreach ($tree as $node) {
            $parent_id = self::save_menu_item($menu_id, $node, 0, ++$position, $existing);
            $kept[$parent_id] = true;
            foreach ($node['children'] as $child) {
                $kept[self::save_menu_item($menu_id, $child, $parent_id, ++$position, $existing)] = true;
            }
        }
        foreach (array_keys($existing) as $id) {
            if (!isset($kept[$id])) {
                wp_delete_post($id, true);
            }
        }
        self::purge_all_caches();

        return [
            'menu_id' => $menu_id,
            'location' => $location,
            'before' => $before,
            'after' => self::menu_items($menu_id),
        ];
    }

    /**
     * One MenuItemInput, checked: known keys, a label of 1 to 60 characters,
     * a link to something that exists, one level of children at most, 30
     * items in all. Returns {id, label, link: menu item fields, newTab, classes}.
     */
    private static function menu_item_input($entry, int $depth, int &$count, array &$seen_ids): array {
        if (!is_array($entry)) {
            throw self::error('VALIDATION', 'Each menu item needs a label and a link.');
        }
        foreach (array_keys($entry) as $key) {
            if (!in_array($key, self::MENU_ITEM_KEYS, true)) {
                throw self::error('VALIDATION', 'Unknown menu item field: ' . self::plain((string) $key) . '.');
            }
        }
        if (++$count > self::MAX_MENU_ITEMS) {
            throw self::error('TOO_MANY_ITEMS', 'A menu holds at most ' . self::MAX_MENU_ITEMS . ' items.');
        }
        if ($depth > 0 && !empty($entry['children'])) {
            throw self::error('DEPTH', 'Menu items go one level deep: an item under another cannot have its own items.');
        }
        if (isset($entry['children']) && !is_array($entry['children'])) {
            throw self::error('VALIDATION', 'children must be a list of menu items.');
        }
        $label = is_string($entry['label'] ?? null) ? trim(wp_strip_all_tags($entry['label'])) : '';
        $length = function_exists('mb_strlen') ? mb_strlen($label, 'UTF-8') : strlen($label);
        if ($length < 1 || $length > self::MAX_LABEL_CHARS) {
            throw self::error('VALIDATION', 'A menu label has 1 to ' . self::MAX_LABEL_CHARS . ' characters.');
        }
        $id = null;
        if (isset($entry['id']) && $entry['id'] !== null) {
            $id = self::positive_int($entry['id']);
            if ($id <= 0) {
                throw self::error('VALIDATION', 'A menu item id must be a positive number.');
            }
            if (isset($seen_ids[$id])) {
                throw self::error('VALIDATION', 'The menu item ' . $id . ' is listed twice.');
            }
            $seen_ids[$id] = true;
        }
        if (isset($entry['newTab']) && !is_bool($entry['newTab'])) {
            throw self::error('VALIDATION', 'newTab must be true or false.');
        }
        $classes = null;
        if (isset($entry['classes'])) {
            if (!is_string($entry['classes'])) {
                throw self::error('VALIDATION', 'classes must be a string of CSS class names.');
            }
            $classes = self::css_classes($entry['classes']);
        }
        return [
            'id' => $id,
            'label' => $label,
            'link' => self::menu_link($entry['link'] ?? null),
            'newTab' => isset($entry['newTab']) ? $entry['newTab'] : null,
            'classes' => $classes,
        ];
    }

    /** A link as the menu item fields WordPress stores; NOT_FOUND or BAD_LINK when it cannot be. */
    private static function menu_link($link): array {
        if (!is_array($link) || !in_array($link['kind'] ?? null, self::MENU_LINK_KINDS, true)) {
            throw self::error('BAD_LINK', 'A menu item links to a page, a post, a product, a category, the shop or a web address.');
        }
        switch ($link['kind']) {
            case 'page':
            case 'post':
            case 'product':
                $key = $link['kind'] . 'Id';
                $id = self::positive_int($link[$key] ?? null);
                $post = $id > 0 ? get_post($id) : null;
                if (!$post || $post->post_type !== $link['kind'] || in_array($post->post_status, ['trash', 'auto-draft'], true)) {
                    throw self::error('NOT_FOUND', ucfirst($link['kind']) . ' ' . $id . ' was not found.');
                }
                return ['menu-item-type' => 'post_type', 'menu-item-object' => $link['kind'], 'menu-item-object-id' => $id, 'menu-item-url' => ''];
            case 'term':
                $taxonomy = $link['taxonomy'] ?? '';
                if (!in_array($taxonomy, ['category', 'product_cat'], true)) {
                    throw self::error('BAD_LINK', 'A category link is to a blog category or a product category.');
                }
                $term_id = self::positive_int($link['termId'] ?? null);
                $term = $term_id > 0 ? get_term($term_id, $taxonomy) : null;
                if (!$term || is_wp_error($term)) {
                    throw self::error('NOT_FOUND', 'Category ' . $term_id . ' was not found.');
                }
                return ['menu-item-type' => 'taxonomy', 'menu-item-object' => $taxonomy, 'menu-item-object-id' => $term_id, 'menu-item-url' => ''];
            case 'shop':
                $shop = self::shop_page_id();
                $page = $shop > 0 ? get_post($shop) : null;
                if (!$page || $page->post_status === 'trash') {
                    throw self::error('NOT_FOUND', 'This site has no shop page.');
                }
                return ['menu-item-type' => 'post_type', 'menu-item-object' => 'page', 'menu-item-object-id' => $shop, 'menu-item-url' => ''];
            default:
                $url = self::safe_menu_url($link['url'] ?? null);
                return ['menu-item-type' => 'custom', 'menu-item-object' => 'custom', 'menu-item-object-id' => 0, 'menu-item-url' => $url];
        }
    }

    /**
     * A web address a menu may link to: http, https, mailto or tel, or a
     * path or anchor on this site ("/contact/", "#booking"). Throws BAD_LINK.
     */
    public static function safe_menu_url($url): string {
        $url = is_string($url) ? trim($url) : '';
        $ok = false;
        if ($url !== '' && strlen($url) <= 2000 && !preg_match('/[\x00-\x20\x7F]/', $url)) {
            if (preg_match('~^https?://[^/\s?#]+~i', $url) || preg_match('/^(mailto|tel):[^\s]+$/i', $url)) {
                $ok = true;
            } elseif (($url[0] === '/' && substr($url, 0, 2) !== '//') || $url[0] === '#') {
                $ok = true;
            }
        }
        if (!$ok) {
            throw self::error('BAD_LINK', 'A menu link must be a web address (http or https), an email (mailto), a phone number (tel), or a page of this site.');
        }
        $clean = esc_url_raw($url, ['http', 'https', 'mailto', 'tel']);
        if ($clean === '' && $url[0] !== '#' && $url[0] !== '/') {
            throw self::error('BAD_LINK', 'The menu link ' . self::plain($url) . ' is not a valid address.');
        }
        return $clean !== '' ? $clean : $url;
    }

    private static function css_classes(string $raw): string {
        $out = [];
        foreach (preg_split('/\s+/', trim($raw)) as $class) {
            $class = sanitize_html_class($class);
            if ($class !== '' && !in_array($class, $out, true)) {
                $out[] = $class;
            }
            if (count($out) >= 10) {
                break;
            }
        }
        return implode(' ', $out);
    }

    /** A new menu for a location that has none, named after the location, and assigned to it. */
    private static function create_menu_for(string $location, string $label): int {
        $base = trim($label) !== '' ? trim($label) : $location;
        $name = $base;
        for ($n = 2; wp_get_nav_menu_object($name) && $n < 50; $n++) {
            $name = $base . ' ' . $n;
        }
        $menu_id = wp_create_nav_menu($name);
        if (is_wp_error($menu_id) || (int) $menu_id <= 0) {
            throw self::error('WRITE_FAILED', 'A menu for ' . self::plain($base) . ' could not be created.');
        }
        $locations = get_theme_mod('nav_menu_locations', []);
        $locations = is_array($locations) ? $locations : [];
        $locations[$location] = (int) $menu_id;
        set_theme_mod('nav_menu_locations', $locations);
        return (int) $menu_id;
    }

    /**
     * Creates or updates one item. An item that already belongs to the menu
     * keeps what the input does not name: its CSS classes (a designed accent
     * on the call to action) and its new-tab setting. Returns its id.
     */
    private static function save_menu_item(int $menu_id, array $node, int $parent_id, int $position, array $existing): int {
        $current = ($node['id'] !== null && isset($existing[$node['id']])) ? $existing[$node['id']] : null;
        $classes = $node['classes'];
        if ($classes === null) {
            $classes = $current ? implode(' ', array_filter(array_map('strval', (array) ($current->classes ?? [])))) : '';
        }
        $target = $node['newTab'] === null
            ? ($current ? (string) ($current->target ?? '') : '')
            : ($node['newTab'] ? '_blank' : '');
        $args = $node['link'] + [
            'menu-item-title' => $node['label'],
            'menu-item-parent-id' => $parent_id,
            'menu-item-position' => $position,
            'menu-item-classes' => $classes,
            'menu-item-target' => $target,
            'menu-item-attr-title' => $current ? (string) ($current->attr_title ?? '') : '',
            'menu-item-description' => $current ? (string) ($current->description ?? '') : '',
            'menu-item-xfn' => $current ? (string) ($current->xfn ?? '') : '',
            'menu-item-status' => 'publish',
        ];
        $id = wp_update_nav_menu_item($menu_id, $current ? (int) $current->ID : 0, wp_slash($args));
        if (is_wp_error($id) || (int) $id <= 0) {
            throw self::error('WRITE_FAILED', 'The menu item "' . self::plain($node['label']) . '" could not be saved.');
        }
        if (!$current && class_exists('WebMaven_AI_Marking')) {
            // Ours: a later build on a connected site tells our items from the owner's.
            WebMaven_AI_Marking::mark_post((int) $id);
        }
        return (int) $id;
    }

    // ── wm_ledger_probe ─────────────────────────────────────────────────────

    public static function ledger_probe($params = [], $step_id = null) {
        $lists = [];
        foreach (['pages', 'products', 'forms', 'assets'] as $key) {
            $value = $params[$key] ?? [];
            if (!is_array($value) || count($value) > 500) {
                throw self::error('VALIDATION', $key . ' must be a list of at most 500 names.');
            }
            foreach ($value as $name) {
                if (!is_string($name) || $name === '' || strlen($name) > 200) {
                    throw self::error('VALIDATION', $key . ' must hold names.');
                }
            }
            $lists[$key] = array_values(array_unique($value));
        }

        $pages = [];
        foreach ($lists['pages'] as $slug) {
            $post = self::probe_page($slug);
            $pages[$slug] = $post ? [
                'post_id' => (int) $post->ID,
                'wp_slug' => (string) $post->post_name,
                'sha256' => self::page_sha((string) $post->post_content),
                'status' => (string) $post->post_status,
                'fullhtml' => (bool) get_post_meta($post->ID, '_webmaven_fullhtml', true),
            ] : null;
        }

        $products = [];
        foreach ($lists['products'] as $slug) {
            $products[$slug] = self::probe_product($slug);
        }

        $forms = [];
        foreach ($lists['forms'] as $name) {
            $forms[$name] = self::probe_form($name);
        }

        $media = [];
        foreach ($lists['assets'] as $file) {
            $id = self::probe_media($file);
            $media[$file] = $id > 0 ? ['id' => $id, 'url' => (string) wp_get_attachment_url($id)] : null;
        }

        $active = (string) get_stylesheet();
        $slug = isset($params['theme_slug']) && $params['theme_slug'] !== '' ? (string) $params['theme_slug'] : $active;
        $dir = self::theme_dir($slug);

        return [
            'pages' => (object) $pages,
            'products' => (object) $products,
            'forms' => (object) $forms,
            'media' => (object) $media,
            'theme_files' => (object) self::theme_listing($dir),
            'theme_version' => self::theme_version($dir),
            'active_theme' => $active,
        ];
    }

    /**
     * The page a plan slug became: the one marked with it (_wm_page), else
     * (for the homepage, 'index') the front page when it is a full-HTML page,
     * else by name: the slug or "<slug>-wpmaven" (the draft a connected site
     * gets beside the owner's page), "<slug>-new" on a branded site. A page
     * WPMaven made wins over the owner's page of the same name.
     */
    private static function probe_page(string $slug) {
        $marked = get_posts([
            'post_type' => 'page',
            'post_status' => self::LIVE_STATUSES,
            'meta_key' => '_wm_page',
            'meta_value' => $slug,
            'numberposts' => 1,
            'orderby' => 'ID',
            'order' => 'ASC',
        ]);
        if (!empty($marked)) {
            return $marked[0];
        }
        if ($slug === 'index') {
            $front = (int) get_option('page_on_front', 0);
            $page = $front > 0 ? get_post($front) : null;
            if ($page && $page->post_type === 'page' && in_array($page->post_status, self::LIVE_STATUSES, true)
                && get_post_meta($front, '_webmaven_fullhtml', true)) {
                return $page;
            }
        }
        $wp_slug = sanitize_title($slug);
        $fallback = null;
        foreach ([$wp_slug, $wp_slug . '-wpmaven', $wp_slug . '-new'] as $i => $name) {
            $found = get_posts([
                'post_type' => 'page',
                'post_status' => self::LIVE_STATUSES,
                'name' => $name,
                'numberposts' => 5,
                'orderby' => 'ID',
                'order' => 'ASC',
            ]);
            foreach ((array) $found as $page) {
                if (WebMaven_AI_Marking::is_ai_generated($page->ID)) {
                    return $page;
                }
                if ($fallback === null && $i < 2) {
                    $fallback = $page;
                }
            }
        }
        return $fallback;
    }

    /** {id, permalink, add_to_cart_url} of the product a plan slug became, or null. */
    private static function probe_product(string $slug) {
        $query = [
            'post_type' => 'product',
            'post_status' => self::LIVE_STATUSES,
            'numberposts' => 1,
            'orderby' => 'ID',
            'order' => 'ASC',
        ];
        $found = get_posts($query + ['meta_key' => '_wm_product_slug', 'meta_value' => $slug]);
        if (empty($found)) {
            $found = get_posts($query + ['name' => sanitize_title($slug)]);
        }
        if (empty($found)) {
            return null;
        }
        $id = (int) $found[0]->ID;
        $permalink = (string) get_permalink($id);
        $product = function_exists('wc_get_product') ? wc_get_product($id) : null;
        $variable = $product && method_exists($product, 'is_type') && $product->is_type('variable');
        return [
            'id' => $id,
            'permalink' => $permalink,
            'add_to_cart_url' => esc_url_raw($variable ? $permalink : add_query_arg('add-to-cart', $id, $permalink)),
        ];
    }

    /** {id, shortcode} of the form create_form registered under this name (wm_form_<name>), or null. */
    private static function probe_form(string $name) {
        $key = sanitize_key($name);
        $id = $key !== '' ? (int) get_option('wm_form_' . $key, 0) : 0;
        $post = $id > 0 ? get_post($id) : null;
        if (!$post || $post->post_status === 'trash') {
            return null;
        }
        if ($post->post_type === 'wpforms') {
            return ['id' => $id, 'shortcode' => '[wpforms id="' . $id . '"]'];
        }
        if ($post->post_type === 'wpcf7_contact_form') {
            return ['id' => $id, 'shortcode' => '[contact-form-7 id="' . $id . '" title="' . esc_attr((string) $post->post_title) . '"]'];
        }
        return null;
    }

    /**
     * The library file an asset became: the one upload_media marked with its
     * name (_wm_asset_name), else the newest file with the same stem
     * ("story-farm.png" finds story-farm.jpg, "kit/logo.png" finds logo.webp).
     */
    private static function probe_media(string $file): int {
        $marked = get_posts([
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'meta_key' => '_wm_asset_name',
            'meta_value' => $file,
            'numberposts' => 1,
            'orderby' => 'ID',
            'order' => 'DESC',
        ]);
        if (!empty($marked)) {
            return (int) $marked[0]->ID;
        }
        $stem = self::file_stem($file);
        if ($stem === '') {
            return 0;
        }
        $candidates = get_posts([
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'numberposts' => 50,
            'orderby' => 'ID',
            'order' => 'DESC',
            'meta_query' => [['key' => '_wp_attached_file', 'value' => $stem, 'compare' => 'LIKE']],
        ]);
        foreach ((array) $candidates as $attachment) {
            $attached = (string) get_post_meta($attachment->ID, '_wp_attached_file', true);
            $own = preg_replace('/-scaled$/', '', self::file_stem($attached));
            if ($own === $stem) {
                return (int) $attachment->ID;
            }
        }
        return 0;
    }

    /** A file's name without folder or extension, lowercased: "kit/Logo.png" -> "logo". */
    public static function file_stem(string $file): string {
        $base = basename(str_replace('\\', '/', $file));
        $dot = strrpos($base, '.');
        return strtolower($dot === false || $dot === 0 ? $base : substr($base, 0, $dot));
    }

    // ── wm_preview_stage / wm_preview_discard ───────────────────────────────

    public static function preview_stage($params = [], $step_id = null) {
        return WebMaven_Edit_Preview::stage(is_array($params) ? $params : []);
    }

    public static function preview_discard($params = [], $step_id = null) {
        return WebMaven_Edit_Preview::discard(is_array($params) ? $params : []);
    }

    // ── Caches ──────────────────────────────────────────────────────────────

    /** No visitor sees the old page from a page cache. */
    private static function purge_post_caches(int $post_id) {
        clean_post_cache($post_id);
        if (function_exists('wp_cache_post_change')) {
            wp_cache_post_change($post_id); // WP Super Cache
        }
        if (function_exists('w3tc_flush_post')) {
            w3tc_flush_post($post_id);
        }
        if (function_exists('rocket_clean_post')) {
            rocket_clean_post($post_id);
        }
        if (function_exists('wpfc_clear_post_cache_by_id')) {
            wpfc_clear_post_cache_by_id($post_id);
        }
        do_action('litespeed_purge_post', $post_id);
    }

    /** A theme file or a menu shows on every page: every page cache goes. */
    public static function purge_all_caches() {
        if (function_exists('wp_cache_clear_cache')) {
            wp_cache_clear_cache();
        }
        if (function_exists('w3tc_flush_all')) {
            w3tc_flush_all();
        }
        if (function_exists('rocket_clean_domain')) {
            rocket_clean_domain();
        }
        if (function_exists('wpfc_clear_all_cache')) {
            wpfc_clear_all_cache();
        }
        do_action('litespeed_purge_all');
        // Never wp_cache_flush(): with a persistent object cache it would drop
        // every transient (the webhook's replay protection among them) and,
        // on a shared cache, other sites' entries. WordPress clears what a
        // menu or theme change touches itself.
    }

    // ── Small helpers ───────────────────────────────────────────────────────

    private static function positive_int($value): int {
        if (is_int($value)) {
            return $value > 0 ? $value : 0;
        }
        if (is_string($value) && preg_match('/^\d{1,18}$/', $value)) {
            return (int) $value;
        }
        if (is_float($value) && floor($value) === $value && $value > 0) {
            return (int) $value;
        }
        return 0;
    }

    private static function title_of($post): string {
        $title = trim(wp_strip_all_tags((string) ($post->post_title ?? '')));
        return $title !== '' ? $title : ('#' . (int) ($post->ID ?? 0));
    }

    /** A value shown inside a sentence: no markup, no control characters, not too long. */
    public static function plain(string $value): string {
        $value = preg_replace('/[\x00-\x1F\x7F]/', '', wp_strip_all_tags($value));
        return strlen($value) > 120 ? substr($value, 0, 117) . '...' : $value;
    }

    /** Plain text kept whole up to $max characters (an alt text): no markup, no control characters. */
    private static function plain_text(string $value, int $max): string {
        $value = trim(preg_replace('/[\x00-\x1F\x7F]/', ' ', wp_strip_all_tags($value)));
        if (function_exists('mb_substr')) {
            return mb_strlen($value) > $max ? rtrim(mb_substr($value, 0, $max)) : $value;
        }
        return strlen($value) > $max ? rtrim(substr($value, 0, $max)) : $value;
    }
}
