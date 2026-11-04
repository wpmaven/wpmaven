<?php
/**
 * Live preview of an edit (2026-10-05): the site as it will look once a
 * change the edit engine prepared is published, without publishing it.
 *
 * The API stages the change (wm_preview_stage, capabilities/edit-operations.php)
 * and links to the site with ?wm_preview=<token>. A GET carrying a valid
 * token shows the staged pages, theme files, menus, facts, product names,
 * prices and descriptions, and post titles and excerpts over the live site,
 * for that request only: nothing live is written, and the real theme option
 * is never touched.
 *
 * Token: <preview_id>.<exp>.<kind>.<sig>
 *   kind p  private: the visitor must be signed in and able to edit pages
 *   kind s  shared: anyone with the link, until exp
 *   sig     base64url, no padding, of HMAC-SHA256(key, "<preview_id>.<exp>.<kind>")
 *           where key is the raw HMAC-SHA256(client secret, "wpmaven-preview-v1")
 *
 * Staged pages are cleaned exactly as a publish cleans them (the same kses
 * allowlist, inline scripts through the same filter), so a preview never
 * runs what the published page would not. A page with a post_id swaps its
 * content and title; a page without one (a page being added) is served as a
 * page of its own at /<slug>/ or at ?wm_preview_page=<slug>. Changed theme
 * files go into a preview copy of the theme, wp-content/themes/<slug>-wmpv-<id>/,
 * selected for the request through pre_option_stylesheet: a full copy (not a
 * child theme), so a changed functions.php replaces the live one instead of
 * loading beside it, and every asset the templates reference still resolves.
 * WPMaven Agent writes and removes those copies
 * (capabilities/theme-files.php); without it a change to theme files
 * answers REQUIRES_AGENT.
 *
 * Every request carrying a token is sent with X-Robots-Tag: noindex, nofollow
 * and Cache-Control: no-store, is never page cached or canonically
 * redirected, and shows a small banner unless wm_preview_bare=1 (the editor's
 * frame). Never active on POST, wp-admin, REST, AJAX, cron or WP-CLI. A
 * designed form on a preview never sends: its submit would reach the live
 * form (AJAX is never a preview). The page carries <meta name="wpmaven-preview">,
 * which the designed forms' runtime reads, and a guard for a theme compiled
 * before the runtime knew it.
 * Expired stagings and their theme copies are removed on each new staging
 * and hourly (WP-Cron).
 *
 * Block content (2026-10-09, sites WPMaven did not design): `blocks` stages
 * posts, template parts and navigation posts exactly as wm_blocks_write
 * would write them (capabilities/blocks.php), and `styles` the global
 * styles' user layer. For the token's request only: a post's content
 * through the_posts; a customized part through the_posts on the part's own
 * query (the template part block runs one); a part that lives in the
 * theme's files through get_block_file_template; the global styles through
 * wp_theme_json_data_user; a navigation block through render_block_data,
 * its links put in place of its ref (a draft navigation post would render
 * nothing). The same signed key opens the block toolkit page
 * (?wm_toolkit=<exp>.<sig>): the site's own block scripts, for the edit
 * engine to parse, validate and serialize block markup in the site's exact
 * WordPress version.
 */

defined('ABSPATH') || exit;

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

final class WebMaven_Edit_Preview {

    const OPTION_PREFIX = 'wpmaven_preview_';
    const INDEX_OPTION = 'wpmaven_preview_index';
    const CRON_HOOK = 'webmaven_preview_cleanup';
    const THEME_MARK = '-wmpv-';
    const KEY_CONTEXT = 'wpmaven-preview-v1';
    const ID_PATTERN = '/^[a-z0-9]{8,40}$/';

    /** Longest a staging lives. */
    const MAX_TTL = 2592000; // 30 days

    /** What a staging may hold. */
    const MAX_PAGES = 50;
    const MAX_PAYLOAD_BYTES = 3145728; // 3 MB: under MySQL's smallest default packet

    /** Post ids of pages being added (no post yet). */
    const VIRTUAL_ID_BASE = 2000000000;

    /** description (2026-10-19): a product's long text rewritten (rewrite_product_text) shows in the frame too. */
    const PRODUCT_PREVIEW_FIELDS = ['name', 'regularPrice', 'salePrice', 'shortDescription', 'description'];
    const POST_PREVIEW_FIELDS = ['title', 'excerpt', 'content'];

    const BANNERS = [
        'active' => 'Preview of a change. Not live yet.',
        'expired' => 'This preview has expired. You are seeing the live site.',
        'login' => 'Sign in to WordPress to see this preview. You are seeing the live site.',
        'invalid' => 'This preview link is not valid. You are seeing the live site.',
        'unknown' => 'This preview is no longer available. You are seeing the live site.',
    ];

    /** The staging shown on this request, when the token is good. */
    private static $active = null;

    /** active, expired, login, invalid or unknown on a request carrying a token; null otherwise. */
    private static $state = null;

    private static $token = '';

    public static function init() {
        add_action(self::CRON_HOOK, [__CLASS__, 'cleanup']);
        add_action('init', [__CLASS__, 'schedule_cleanup']);
        if (self::candidate_request()) {
            // After WP_Roles and the signed-in user are known, before the
            // theme loads (wp_templating_constants runs right after).
            add_action('setup_theme', [__CLASS__, 'boot'], 0);
        }
        if (self::toolkit_request()) {
            add_action('template_redirect', [__CLASS__, 'toolkit_page'], 0);
        }
    }

    /** A front-end GET carrying a token: the only requests a preview may touch. */
    public static function candidate_request(): bool {
        if (!isset($_GET['wm_preview']) || !is_string($_GET['wm_preview']) || $_GET['wm_preview'] === '') {
            return false;
        }
        if (strtoupper(sanitize_text_field(wp_unslash((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')))) !== 'GET') {
            return false;
        }
        if (is_admin() || wp_doing_ajax() || (function_exists('wp_doing_cron') && wp_doing_cron())) {
            return false;
        }
        if (defined('REST_REQUEST') || defined('XMLRPC_REQUEST') || (defined('WP_CLI') && WP_CLI)) {
            return false;
        }
        if (isset($_GET['rest_route'])) {
            return false;
        }
        $path = (string) wp_parse_url(sanitize_text_field(wp_unslash((string) ($_SERVER['REQUEST_URI'] ?? '/'))), PHP_URL_PATH);
        $prefix = function_exists('rest_get_url_prefix') ? trim((string) rest_get_url_prefix(), '/') : 'wp-json';
        if ($prefix !== '' && strpos($path . '/', '/' . $prefix . '/') !== false) {
            return false;
        }
        return true;
    }

    /** setup_theme: reads the token and, when it is good, turns the overlay on. */
    public static function boot() {
        // The signed preview token is what authorizes this request (check_token), not a nonce.
        $check = self::check_token(sanitize_text_field(wp_unslash((string) $_GET['wm_preview']))); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
        self::$state = $check['state'];

        // Every request carrying a token, good or not: never indexed, never
        // cached, never redirected (a redirect would drop the token).
        add_filter('wp_headers', [__CLASS__, 'headers']);
        add_filter('redirect_canonical', '__return_false');
        if (function_exists('wp_robots_no_robots')) {
            add_filter('wp_robots', 'wp_robots_no_robots');
        }
        if (!defined('DONOTCACHEPAGE')) {
            define('DONOTCACHEPAGE', true);
        }
        add_action('wp_footer', [__CLASS__, 'footer'], 1000);
        add_action('wp_head', [__CLASS__, 'head_marker'], 1);

        if ($check['state'] === 'active') {
            self::$token = $check['token'];
            self::activate($check['payload']);
        }
    }

    // ── Tokens ──────────────────────────────────────────────────────────────

    /**
     * {state: active|expired|login|invalid|unknown, payload?, token?}. The
     * signature is checked first, so a forged token never says "expired".
     */
    public static function check_token(string $token, $now = null): array {
        $now = $now === null ? time() : (int) $now;
        if (!preg_match('/^([a-z0-9]{8,40})\.(\d{1,12})\.([ps])\.([A-Za-z0-9_-]{43})$/', $token, $m)) {
            return ['state' => 'invalid'];
        }
        list(, $id, $exp, $kind, $sig) = $m;
        $key = self::key();
        if ($key === '' || !hash_equals(self::sign($key, $id . '.' . $exp . '.' . $kind), $sig)) {
            return ['state' => 'invalid'];
        }
        if ((int) $exp <= $now) {
            return ['state' => 'expired'];
        }
        $payload = self::payload($id);
        if ($payload === null) {
            return ['state' => 'unknown'];
        }
        if ((int) ($payload['expires_at'] ?? 0) <= $now) {
            return ['state' => 'expired'];
        }
        if ($kind === 'p' && !(is_user_logged_in() && current_user_can('edit_pages'))) {
            return ['state' => 'login'];
        }
        return ['state' => 'active', 'payload' => $payload, 'token' => $token, 'kind' => $kind];
    }

    /** The token for a staging: what the API makes (the site makes one only for its tests). */
    public static function token_for(string $id, int $exp, string $kind): string {
        $key = self::key();
        return $key === '' ? '' : $id . '.' . $exp . '.' . $kind . '.' . self::sign($key, $id . '.' . $exp . '.' . $kind);
    }

    /** The preview key: the raw HMAC-SHA256 of the context with the client secret. */
    private static function key(): string {
        $encrypted = get_option('webmaven_wp_client_secret');
        if (empty($encrypted) || !class_exists('WebMaven_WP_Error_Handler')) {
            return '';
        }
        $secret = WebMaven_WP_Error_Handler::decrypt_data($encrypted);
        if (!is_string($secret) || $secret === '') {
            return '';
        }
        return hash_hmac('sha256', self::KEY_CONTEXT, $secret, true);
    }

    private static function sign(string $key, string $data): string {
        return rtrim(strtr(base64_encode(hash_hmac('sha256', $data, $key, true)), '+/', '-_'), '=');
    }

    // ── Staging (wm_preview_stage, wm_preview_discard) ──────────────────────

    /** "CODE: sentence", the shape the API parses. */
    private static function error(string $code, string $message): Exception {
        return new Exception($code . ': ' . $message);
    }

    /**
     * wm_preview_stage: checks the whole change, writes the preview copy of
     * the theme when files changed, stores the rest (a non-autoloaded
     * option). Staging the same preview_id again replaces it.
     */
    public static function stage(array $params): array {
        $id = is_string($params['preview_id'] ?? null) ? $params['preview_id'] : '';
        if (!preg_match(self::ID_PATTERN, $id)) {
            throw self::error('VALIDATION', 'preview_id must be 8 to 40 lowercase letters and digits.');
        }
        $now = time();
        $expires = $params['expires_at'] ?? null;
        if (!is_int($expires) || $expires <= $now || $expires > $now + self::MAX_TTL) {
            throw self::error('VALIDATION', 'expires_at must be a time in the next 30 days.');
        }
        $slug = is_string($params['theme_slug'] ?? null) ? $params['theme_slug'] : '';
        $live_stylesheet = (string) get_stylesheet();
        if ($slug === '' || $slug !== $live_stylesheet) {
            throw self::error('THEME_NOT_ACTIVE', 'The theme "' . self::plain($slug) . '" is not the active theme of this site.');
        }

        $root = realpath((string) get_theme_root($slug));
        if ($root === false) {
            throw self::error('NOT_FOUND', 'The theme ' . $slug . ' is not installed on this site.');
        }
        $root = rtrim(str_replace('\\', '/', $root), '/');
        $payload = [
            'preview_id' => $id,
            'expires_at' => $expires,
            'theme_slug' => $slug,
            'theme_root' => $root,
            'staging' => bin2hex(random_bytes(8)),
            'preview_theme' => null,
            'preview_template' => null,
            'pages' => self::staged_pages($params['pages'] ?? []),
            'options' => self::staged_options($params['options'] ?? []),
            'menus' => self::staged_menus($params['menus'] ?? []),
            'products' => self::staged_products($params['products'] ?? []),
            'posts' => self::staged_posts($params['posts'] ?? []),
            'blocks' => self::staged_blocks($params['blocks'] ?? []),
            'styles' => class_exists('WebMaven_Cap_Blocks') ? WebMaven_Cap_Blocks::staged_styles($params['styles'] ?? null) : null,
            'builder' => self::staged_builder($params['builder'] ?? []),
            'removed_theme_files' => [],
            'staged_at' => $now,
        ];
        $theme_change = self::theme_change($params);
        $payload['removed_theme_files'] = $theme_change ? $theme_change['removed'] : [];
        if (strlen((string) wp_json_encode($payload)) > self::MAX_PAYLOAD_BYTES) {
            throw self::error('VALIDATION', 'The change is too large to preview.');
        }

        self::cleanup($now);

        $preview_theme = $theme_change ? $slug . self::THEME_MARK . $id : null;
        // In the index before its copy exists, so a clean-up running
        // meanwhile never takes the copy being built for an orphan.
        $index = self::index();
        $index[$id] = ['expires_at' => $expires, 'theme' => $preview_theme, 'root' => $root];
        update_option(self::INDEX_OPTION, $index, false);

        if ($preview_theme !== null) {
            do_action('webmaven_preview_build_theme', $slug, $preview_theme, $theme_change['files'], $theme_change['removed'], $root);
            $payload['preview_theme'] = $preview_theme;
            // A standalone theme's copy is its own template; a child theme's
            // copy keeps the live parent.
            $live_template = (string) get_template();
            $payload['preview_template'] = $live_template === $slug ? $preview_theme : $live_template;
        } else {
            do_action('webmaven_preview_remove_theme', $slug . self::THEME_MARK . $id, $root);
        }

        update_option(self::OPTION_PREFIX . $id, $payload, false);
        // Read back: a change the database could not take is never answered as staged.
        $stored = self::payload($id);
        if ($stored === null || ($stored['staging'] ?? '') !== $payload['staging']) {
            self::remove($id);
            throw self::error('WRITE_FAILED', 'The change could not be stored for its preview. It may be too large: try a smaller change.');
        }
        self::schedule_cleanup();

        return ['staged' => true, 'preview_id' => $id];
    }

    /**
     * The change's theme files, [files: [path => bytes], removed: [path]], or
     * null when it has none. WPMaven Agent checks them
     * (webmaven_preview_theme_change) and writes the copy; without it a
     * change to theme files needs Agent.
     */
    private static function theme_change(array $params) {
        $files = $params['theme_files'] ?? [];
        $removed = $params['removed_theme_files'] ?? null;
        if ($files === [] && ($removed === null || $removed === [])) {
            return null;
        }
        $change = apply_filters('webmaven_preview_theme_change', null, $files, $removed);
        if (!is_array($change) || !isset($change['files'], $change['removed'])) {
            throw new WebMaven_Requires_Agent('Previewing a change to theme files needs WPMaven Agent: WPMaven from WordPress.org does not change the site\'s code, its plugins or its themes. The owner can install WPMaven Agent from their WPMaven dashboard.');
        }
        return ($change['files'] || $change['removed']) ? $change : null;
    }

    /** wm_preview_discard: the staging and its theme copy go (also when already gone). */
    public static function discard(array $params): array {
        $id = is_string($params['preview_id'] ?? null) ? $params['preview_id'] : '';
        if (!preg_match(self::ID_PATTERN, $id)) {
            throw self::error('VALIDATION', 'preview_id must be 8 to 40 lowercase letters and digits.');
        }
        self::remove($id);
        return ['discarded' => true];
    }

    private static function staged_pages($raw): array {
        if (!is_array($raw) || count($raw) > self::MAX_PAGES) {
            throw self::error('VALIDATION', 'pages must be a list of at most ' . self::MAX_PAGES . ' pages.');
        }
        $commands = new WebMaven_WordPress_Commands();
        $pages = [];
        $seen = [];
        foreach ($raw as $page) {
            if (!is_array($page) || !is_string($page['slug'] ?? null) || !is_string($page['title'] ?? null) || !is_string($page['content'] ?? null)) {
                throw self::error('VALIDATION', 'Each staged page has a slug, a title and its content.');
            }
            $slug = sanitize_title($page['slug']);
            if ($slug === '') {
                throw self::error('VALIDATION', 'A staged page needs a slug.');
            }
            $post_id = null;
            if (isset($page['post_id']) && $page['post_id'] !== null) {
                $post_id = is_int($page['post_id']) ? $page['post_id'] : (is_string($page['post_id']) && ctype_digit($page['post_id']) ? (int) $page['post_id'] : 0);
                $post = $post_id > 0 ? get_post($post_id) : null;
                if (!$post || $post->post_type !== 'page' || $post->post_status === 'trash') {
                    throw self::error('NOT_FOUND', 'Page ' . $post_id . ' was not found.');
                }
            }
            $key = $post_id !== null ? 'id:' . $post_id : 'slug:' . $slug;
            if (isset($seen[$key])) {
                throw self::error('VALIDATION', 'A page is staged twice.');
            }
            $seen[$key] = true;
            if ($post_id === null && ($page['blocks'] ?? false) === true && class_exists('WebMaven_Cap_Blocks')) {
                // A block page being added (a site WPMaven did not design): cleaned as wm_blocks_page_create
                // cleans it, rendered in the theme's own page template.
                $pages[] = ['post_id' => null, 'slug' => $slug, 'title' => trim(wp_strip_all_tags($page['title'])), 'content' => WebMaven_Cap_Blocks::clean($page['content']), 'blocks' => true];
                continue;
            }
            // Cleaned as a publish cleans it: the same allowlist, and the
            // inline scripts through the same filter, run once the page is
            // loaded (a publish moves them to the page's script file).
            list($clean, $scripts) = $commands->sanitize_page_content($page['content']);
            if ($post_id !== null && class_exists('WebMaven_Designed_Blocks')) {
                // The owner's blocks between designed sections show in the preview where a publish keeps them.
                $memory = class_exists('WebMaven_Cap_Edit_Operations') ? WebMaven_Cap_Edit_Operations::owner_anchors($post_id) : [];
                $clean = WebMaven_Designed_Blocks::merge($clean, (string) get_post($post_id)->post_content, $memory);
            }
            // The page's script, as WPMaven Agent would write it; none without Agent.
            $script = $scripts ? (string) apply_filters('webmaven_preview_page_script', '', $post_id !== null ? $post_id : 0, $scripts) : '';
            $pages[] = [
                'post_id' => $post_id,
                'slug' => $slug,
                'title' => trim(wp_strip_all_tags($page['title'])),
                'content' => $clean . ($script !== '' ? "\n<script>\n" . $script . "</script>\n" : ''),
            ];
        }
        return $pages;
    }

    /**
     * Block targets as wm_blocks_write would leave them: {posts: {id: markup},
     * parts: {slug: markup}, navigation: {id: markup}}.
     */
    private static function staged_blocks($raw): array {
        $out = ['posts' => [], 'parts' => [], 'navigation' => []];
        if (!is_array($raw) || count($raw) > self::MAX_PAGES) {
            throw self::error('VALIDATION', 'blocks must be a list of at most ' . self::MAX_PAGES . ' targets.');
        }
        if ($raw && !class_exists('WebMaven_Cap_Blocks')) {
            throw self::error('VALIDATION', 'This plugin cannot preview block content.');
        }
        foreach ($raw as $entry) {
            if (!is_array($entry)) {
                throw self::error('VALIDATION', 'Each staged block target is an object.');
            }
            $t = WebMaven_Cap_Blocks::staged_target($entry);
            if ($t['kind'] === 'part') {
                $out['parts'][$t['slug']] = $t['markup'];
            } elseif ($t['kind'] === 'navigation') {
                $out['navigation'][(string) $t['navigation_id']] = $t['markup'];
            } else {
                $out['posts'][(string) $t['post_id']] = $t['markup'];
            }
        }
        return $out;
    }

    /** Builder pages (Elementor) as wm_builder_write would leave them: {post_id: data}. */
    private static function staged_builder($raw): array {
        if ($raw === [] || $raw === null) {
            return [];
        }
        if (!class_exists('WebMaven_Cap_Builders')) {
            throw self::error('VALIDATION', 'This plugin cannot preview page builder content.');
        }
        return WebMaven_Cap_Builders::staged($raw);
    }

    private static function staged_options($raw): array {
        if (!is_array($raw)) {
            throw self::error('VALIDATION', 'options must map names to values.');
        }
        $out = [];
        foreach ($raw as $name => $value) {
            // The site's name and tagline too: a block theme's header shows them (its site title block).
            if (!is_string($name) || (!preg_match('/^wm_(var|biz)_[a-z0-9_]{1,100}$/', $name) && !in_array($name, ['blogname', 'blogdescription'], true))) {
                throw self::error('VALIDATION', 'Only wm_var_ and wm_biz_ settings, the site\'s name and its tagline can be previewed, not ' . self::plain((string) $name) . '.');
            }
            if (!is_string($value) && !is_int($value) && !is_float($value)) {
                throw self::error('VALIDATION', 'The setting ' . $name . ' takes text.');
            }
            $out[$name] = (string) $value;
        }
        return $out;
    }

    private static function staged_menus($raw): array {
        if (!is_array($raw)) {
            throw self::error('VALIDATION', 'menus must map theme locations to their items.');
        }
        $registered = function_exists('get_registered_nav_menus') ? (array) get_registered_nav_menus() : [];
        $out = [];
        foreach ($raw as $location => $items) {
            if (!is_string($location) || !isset($registered[$location])) {
                throw self::error('NOT_FOUND', 'This theme has no menu location named ' . self::plain((string) $location) . '.');
            }
            if (!is_array($items) || count($items) > WebMaven_Cap_Edit_Operations::MAX_MENU_ITEMS) {
                throw self::error('TOO_MANY_ITEMS', 'A menu holds at most ' . WebMaven_Cap_Edit_Operations::MAX_MENU_ITEMS . ' items.');
            }
            $list = [];
            foreach ($items as $item) {
                if (!is_array($item) || !is_int($item['id'] ?? null) || !is_string($item['label'] ?? null) || !is_array($item['link'] ?? null)) {
                    throw self::error('VALIDATION', 'Each staged menu item has an id, a label and a link.');
                }
                $link = $item['link'];
                $kind = $link['kind'] ?? null;
                if (!in_array($kind, WebMaven_Cap_Edit_Operations::MENU_LINK_KINDS, true)) {
                    throw self::error('BAD_LINK', 'A menu item links to a page, a post, a product, a category, the shop or a web address.');
                }
                if ($kind === 'url') {
                    $link = ['kind' => 'url', 'url' => WebMaven_Cap_Edit_Operations::safe_menu_url($link['url'] ?? null)];
                } elseif ($kind === 'term') {
                    $link = ['kind' => 'term', 'taxonomy' => in_array($link['taxonomy'] ?? '', ['category', 'product_cat'], true) ? $link['taxonomy'] : 'category', 'termId' => (int) ($link['termId'] ?? 0)];
                } elseif ($kind !== 'shop') {
                    $key = $kind . 'Id';
                    $link = ['kind' => $kind, $key => (int) ($link[$key] ?? 0)];
                } else {
                    $link = ['kind' => 'shop'];
                }
                $list[] = [
                    'id' => (int) $item['id'],
                    'label' => trim(wp_strip_all_tags($item['label'])),
                    'link' => $link,
                    'newTab' => !empty($item['newTab']),
                    'classes' => is_string($item['classes'] ?? null) ? $item['classes'] : '',
                    'parent' => (int) ($item['parent'] ?? 0),
                    'order' => (int) ($item['order'] ?? 0),
                ];
            }
            $out[$location] = $list;
        }
        return $out;
    }

    private static function staged_products($raw): array {
        if (!is_array($raw)) {
            throw self::error('VALIDATION', 'products must be a list.');
        }
        $out = [];
        foreach ($raw as $entry) {
            $id = is_array($entry) && is_int($entry['product_id'] ?? null) ? $entry['product_id'] : 0;
            $fields = is_array($entry) ? ($entry['fields'] ?? null) : null;
            if ($id <= 0 || !is_array($fields)) {
                throw self::error('VALIDATION', 'Each staged product has a product_id and fields.');
            }
            $post = get_post($id);
            if (!$post || $post->post_type !== 'product') {
                throw self::error('NOT_FOUND', 'Product ' . $id . ' was not found.');
            }
            $staged = [];
            foreach ($fields as $key => $value) {
                if (!in_array($key, self::PRODUCT_PREVIEW_FIELDS, true)) {
                    throw self::error('VALIDATION', 'A product preview shows the name, the prices and the descriptions, not ' . self::plain((string) $key) . '.');
                }
                if ($value !== null && !is_string($value)) {
                    throw self::error('VALIDATION', 'The product ' . $key . ' takes text.');
                }
                if (in_array($key, ['regularPrice', 'salePrice'], true) && $value !== null && !preg_match('/^\d{1,12}(\.\d{1,4})?$/', $value)) {
                    throw self::error('VALIDATION', 'A price is a number like 14.50.');
                }
                if ($value === null && $key !== 'salePrice') {
                    throw self::error('VALIDATION', 'Only the sale price can be removed.');
                }
                if ($key === 'name') {
                    $value = trim(wp_strip_all_tags($value));
                } elseif ($key === 'shortDescription' || $key === 'description') {
                    $value = wp_kses_post($value); // as store_product_update writes them
                }
                $staged[$key] = $value;
            }
            $out[$id] = $staged;
        }
        return $out;
    }

    private static function staged_posts($raw): array {
        if (!is_array($raw)) {
            throw self::error('VALIDATION', 'posts must be a list.');
        }
        $out = [];
        foreach ($raw as $entry) {
            $id = is_array($entry) && is_int($entry['post_id'] ?? null) ? $entry['post_id'] : 0;
            $fields = is_array($entry) ? ($entry['fields'] ?? null) : null;
            if ($id <= 0 || !is_array($fields) || !get_post($id)) {
                throw self::error('NOT_FOUND', 'Post ' . $id . ' was not found.');
            }
            $staged = [];
            foreach ($fields as $key => $value) {
                if (!in_array($key, self::POST_PREVIEW_FIELDS, true) || !is_string($value)) {
                    throw self::error('VALIDATION', 'A post preview shows the title, the excerpt and the text.');
                }
                // The text keeps what a post may hold (the same filter a published post goes through).
                $staged[$key] = $key === 'content' ? wp_kses_post($value) : trim(wp_strip_all_tags($value));
            }
            $out[$id] = $staged;
        }
        return $out;
    }

    // ── Clean up ────────────────────────────────────────────────────────────

    public static function schedule_cleanup() {
        if (function_exists('wp_next_scheduled') && !wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time() + 3600, 'hourly', self::CRON_HOOK);
        }
    }

    /** Expired stagings, their theme copies and any copy no staging owns. Answers the ids removed. */
    public static function cleanup($now = null): array {
        $now = $now === null ? time() : (int) $now;
        $index = self::index();
        $removed = [];
        foreach ($index as $id => $entry) {
            if ((int) ($entry['expires_at'] ?? 0) <= $now) {
                self::remove((string) $id);
                $removed[] = (string) $id;
            }
        }
        // Theme copies no staging owns (WPMaven Agent's).
        do_action('webmaven_preview_sweep_themes', $now);
        return $removed;
    }

    private static function remove(string $id) {
        $payload = self::payload($id);
        if ($payload && !empty($payload['preview_theme'])) {
            do_action('webmaven_preview_remove_theme', (string) $payload['preview_theme'], (string) ($payload['theme_root'] ?? ''));
            // Settings a theme saved on its copy during a preview, if any.
            delete_option('theme_mods_' . $payload['preview_theme']);
        }
        delete_option(self::OPTION_PREFIX . $id);
        $index = self::index();
        if (isset($index[$id])) {
            if (!empty($index[$id]['theme'])) {
                do_action('webmaven_preview_remove_theme', (string) $index[$id]['theme'], (string) ($index[$id]['root'] ?? ''));
            }
            unset($index[$id]);
            update_option(self::INDEX_OPTION, $index, false);
        }
    }

    public static function index(): array {
        $index = get_option(self::INDEX_OPTION, []);
        return is_array($index) ? $index : [];
    }

    public static function payload(string $id) {
        $payload = get_option(self::OPTION_PREFIX . $id, null);
        return is_array($payload) ? $payload : null;
    }

    // ── The overlay ─────────────────────────────────────────────────────────

    public static function active(): bool {
        return self::$active !== null;
    }

    public static function state() {
        return self::$state;
    }

    /** Turns the overlay on for this request. Public for the tests. */
    public static function activate(array $payload) {
        self::$active = $payload;

        add_filter('the_posts', [__CLASS__, 'swap_posts'], 10, 2);
        add_filter('get_post_metadata', [__CLASS__, 'virtual_meta'], 10, 4);

        $theme = (string) ($payload['preview_theme'] ?? '');
        $root = (string) ($payload['theme_root'] ?? get_theme_root());
        if ($theme !== '' && is_dir(rtrim($root, '/') . '/' . $theme)) {
            $template = (string) ($payload['preview_template'] ?? $theme);
            $live = (string) $payload['theme_slug'];
            add_filter('pre_option_stylesheet', function () use ($theme) { return $theme; });
            add_filter('pre_option_template', function () use ($template) { return $template; });
            // The live theme's settings (menu locations, logo, Customizer) on its copy.
            add_filter('pre_option_theme_mods_' . $theme, function () use ($live) {
                $mods = get_option('theme_mods_' . $live);
                return is_array($mods) ? $mods : [];
            });
        }

        if (!empty($payload['menus'])) {
            add_filter('wp_nav_menu_objects', [__CLASS__, 'menu_objects'], 10, 2);
            add_filter('theme_mod_nav_menu_locations', [__CLASS__, 'menu_locations']);
        }

        foreach ((array) ($payload['options'] ?? []) as $name => $value) {
            add_filter('pre_option_' . $name, function () use ($value) { return $value; });
        }

        if (!empty($payload['products'])) {
            foreach (['name', 'regular_price', 'sale_price', 'price', 'short_description', 'description'] as $field) {
                add_filter('woocommerce_product_get_' . $field, [__CLASS__, 'product_' . $field], 10, 2);
            }
        }

        $blocks = (array) ($payload['blocks'] ?? []);
        if (!empty($blocks['parts'])) {
            add_filter('get_block_file_template', [__CLASS__, 'part_file'], 10, 3);
        }
        if (!empty($blocks['navigation'])) {
            add_filter('render_block_data', [__CLASS__, 'navigation_data'], 1);
        }
        if (!empty($payload['styles'])) {
            add_filter('wp_theme_json_data_user', [__CLASS__, 'user_styles'], 1000);
        }
        if (!empty($payload['builder'])) {
            add_filter('get_post_metadata', [__CLASS__, 'builder_meta'], 5, 4);
        }

        // Titles and excerpts: posts, and products (WooCommerce's templates
        // print the product's post title and excerpt, not its getters).
        if (!empty($payload['posts']) || !empty($payload['products'])) {
            add_filter('the_title', [__CLASS__, 'post_title'], 10, 2);
            add_filter('get_the_excerpt', [__CLASS__, 'post_excerpt'], 10, 2);
        }
    }

    /** Turns it off again (tests, and code that must see the live site). */
    public static function deactivate() {
        self::$active = null;
        self::$state = null;
        self::$token = '';
    }

    /**
     * the_posts: staged pages swap their content and title; a page being
     * added replaces the main query when it is the one asked for.
     */
    public static function swap_posts($posts, $query = null) {
        if (self::$active === null || !is_array($posts)) {
            return $posts;
        }
        $by_id = [];
        $added = [];
        foreach ((array) self::$active['pages'] as $i => $page) {
            if (!empty($page['post_id'])) {
                $by_id[(int) $page['post_id']] = $page;
            } else {
                $added[$page['slug']] = $page + ['index' => $i];
            }
        }

        if ($added && is_object($query) && method_exists($query, 'is_main_query') && $query->is_main_query()) {
            $wanted = self::requested_added_page($query, $posts);
            if ($wanted !== null && isset($added[$wanted])) {
                $post = self::added_page_post($added[$wanted]);
                // get_post() of its id finds it (wp_head's shortlink, the template's blocks read the queried post).
                if (function_exists('wp_cache_set')) {
                    wp_cache_set($post->ID, $post, 'posts');
                }
                self::as_page_query($query, $post);
                return [$post];
            }
        }

        $products = (array) (self::$active['products'] ?? []);
        $staged_posts = (array) (self::$active['posts'] ?? []);
        $block_posts = (array) (self::$active['blocks']['posts'] ?? []);
        $parts = (array) (self::$active['blocks']['parts'] ?? []);
        foreach ($posts as $i => $post) {
            if (!is_object($post) || !isset($post->ID)) {
                continue;
            }
            $id = (int) $post->ID;
            if ($parts && ($post->post_type ?? '') === 'wp_template_part' && isset($parts[(string) $post->post_name])) {
                // A customized part, read by the template part block's own query.
                $copy = clone $post;
                $copy->post_content = $parts[(string) $post->post_name];
                $posts[$i] = $copy;
                continue;
            }
            if (isset($block_posts[(string) $id])) {
                $copy = clone $post;
                $copy->post_content = $block_posts[(string) $id];
                $posts[$i] = $copy;
                continue;
            }
            if (isset($by_id[$id])) {
                $copy = clone $post;
                $copy->post_content = $by_id[$id]['content'];
                $copy->post_title = $by_id[$id]['title'];
                $posts[$i] = $copy;
            } elseif (isset($products[$id]) && (isset($products[$id]['name']) || isset($products[$id]['shortDescription']) || isset($products[$id]['description']))) {
                // WooCommerce's templates print these from the post itself (its description tab through the_content).
                $copy = clone $post;
                if (isset($products[$id]['name'])) {
                    $copy->post_title = $products[$id]['name'];
                }
                if (isset($products[$id]['shortDescription'])) {
                    $copy->post_excerpt = $products[$id]['shortDescription'];
                }
                if (isset($products[$id]['description'])) {
                    $copy->post_content = $products[$id]['description'];
                }
                $posts[$i] = $copy;
            } elseif (isset($staged_posts[$id])) {
                $copy = clone $post;
                if (isset($staged_posts[$id]['title'])) {
                    $copy->post_title = $staged_posts[$id]['title'];
                }
                if (isset($staged_posts[$id]['excerpt'])) {
                    $copy->post_excerpt = $staged_posts[$id]['excerpt'];
                }
                if (isset($staged_posts[$id]['content'])) {
                    $copy->post_content = $staged_posts[$id]['content'];
                }
                $posts[$i] = $copy;
            }
        }
        return $posts;
    }

    /** The slug of the page being added this request asks for: ?wm_preview_page=, else the path of a request that found nothing. */
    private static function requested_added_page($query, array $posts) {
        if (isset($_GET['wm_preview_page']) && is_string($_GET['wm_preview_page'])) {
            $slug = sanitize_title(wp_unslash($_GET['wm_preview_page']));
            return $slug !== '' ? $slug : null;
        }
        if ($posts) {
            return null;
        }
        $asked = (string) ($query->get('pagename') ?: $query->get('name'));
        if ($asked === '') {
            return null;
        }
        $parts = explode('/', trim($asked, '/'));
        $slug = sanitize_title((string) end($parts));
        return $slug !== '' ? $slug : null;
    }

    /** A page being added, as a post WordPress can render (the editor's mock post pattern). */
    public static function added_page_post(array $page): WP_Post {
        $now = function_exists('current_time') ? current_time('mysql') : gmdate('Y-m-d H:i:s');
        $now_gmt = function_exists('current_time') ? current_time('mysql', 1) : gmdate('Y-m-d H:i:s');
        return new WP_Post((object) [
            'ID' => self::VIRTUAL_ID_BASE + (int) ($page['index'] ?? 0),
            'post_author' => 1,
            'post_date' => $now,
            'post_date_gmt' => $now_gmt,
            'post_title' => (string) $page['title'],
            'post_content' => (string) $page['content'],
            'post_excerpt' => '',
            'post_status' => 'publish',
            'comment_status' => 'closed',
            'ping_status' => 'closed',
            'post_password' => '',
            'post_name' => (string) $page['slug'],
            'to_ping' => '',
            'pinged' => '',
            'post_modified' => $now,
            'post_modified_gmt' => $now_gmt,
            'post_content_filtered' => '',
            'post_parent' => 0,
            'guid' => '',
            'menu_order' => 0,
            'post_type' => 'page',
            'post_mime_type' => '',
            'comment_count' => 0,
            'filter' => 'raw',
        ]);
    }

    /** The main query, made a single page query for a page being added. */
    private static function as_page_query($query, $post) {
        foreach (['is_single', 'is_home', 'is_archive', 'is_404', 'is_search', 'is_posts_page', 'is_category', 'is_tag', 'is_tax', 'is_author', 'is_date', 'is_post_type_archive', 'is_attachment', 'is_paged'] as $flag) {
            $query->$flag = false;
        }
        $query->is_page = true;
        $query->is_singular = true;
        $query->post = $post;
        $query->posts = [$post];
        $query->post_count = 1;
        $query->found_posts = 1;
        $query->max_num_pages = 1;
        $query->queried_object = $post;
        $query->queried_object_id = $post->ID;
    }

    /** get_block_file_template: a staged part that lives in the theme's files. */
    public static function part_file($template, $id = '', $type = '') {
        $parts = (array) (self::$active['blocks']['parts'] ?? []);
        if (self::$active === null || $type !== 'wp_template_part' || !is_object($template) || !$parts) {
            return $template;
        }
        $prefix = get_stylesheet() . '//';
        if (strpos((string) $id, $prefix) === 0) {
            $slug = substr((string) $id, strlen($prefix));
            if (isset($parts[$slug])) {
                $copy = clone $template;
                $copy->content = $parts[$slug];
                return $copy;
            }
        }
        return $template;
    }

    /**
     * render_block_data: a navigation block whose posts are staged shows the
     * staged links (its own ref, or WordPress's fallback for a block without
     * one).
     */
    public static function navigation_data($block) {
        $staged = (array) (self::$active['blocks']['navigation'] ?? []);
        if (self::$active === null || !$staged || ($block['blockName'] ?? '') !== 'core/navigation') {
            return $block;
        }
        $ref = (int) ($block['attrs']['ref'] ?? 0);
        if ($ref <= 0) {
            if (!empty($block['innerBlocks'])) {
                return $block; // its links live in the part around it
            }
            static $fallback = null;
            if ($fallback === null) {
                $fallback = class_exists('WebMaven_Cap_Blocks') ? WebMaven_Cap_Blocks::fallback_navigation_id() : 0;
            }
            $ref = $fallback;
        }
        if ($ref <= 0 || !isset($staged[(string) $ref])) {
            return $block;
        }
        $inner = array_values(array_filter(parse_blocks($staged[(string) $ref]), function ($b) {
            return !empty($b['blockName']);
        }));
        unset($block['attrs']['ref']);
        $block['innerBlocks'] = $inner;
        $block['innerContent'] = array_fill(0, count($inner), null);
        $block['innerHTML'] = '';
        return $block;
    }

    /** wp_theme_json_data_user: the staged user layer in place of the saved one. */
    public static function user_styles($data) {
        $styles = self::$active['styles'] ?? null;
        if (self::$active === null || !is_array($styles) || !class_exists('WP_Theme_JSON_Data')) {
            return $data;
        }
        $json = ['version' => class_exists('WP_Theme_JSON') ? WP_Theme_JSON::LATEST_SCHEMA : 3, 'isGlobalStylesUserThemeJSON' => true];
        if (!empty($styles['settings'])) {
            $json['settings'] = $styles['settings'];
        }
        if (!empty($styles['styles'])) {
            $json['styles'] = $styles['styles'];
        }
        return new WP_Theme_JSON_Data($json, 'custom');
    }

    // ── The block toolkit page ──────────────────────────────────────────────

    /** A front-end GET carrying a toolkit token. */
    public static function toolkit_request(): bool {
        if (!isset($_GET['wm_toolkit']) || !is_string($_GET['wm_toolkit']) || isset($_GET['wm_preview'])) {
            return false;
        }
        if (strtoupper(sanitize_text_field(wp_unslash((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')))) !== 'GET') {
            return false;
        }
        if (is_admin() || wp_doing_ajax() || defined('REST_REQUEST') || (defined('WP_CLI') && WP_CLI)) {
            return false;
        }
        return true;
    }

    /** <exp>.<sig>: sig over "toolkit.<exp>" with the preview key; good for a day at most. */
    public static function check_toolkit_token(string $token, $now = null): bool {
        $now = $now === null ? time() : (int) $now;
        if (!preg_match('/^(\d{1,12})\.([A-Za-z0-9_-]{43})$/', $token, $m)) {
            return false;
        }
        $exp = (int) $m[1];
        if ($exp <= $now || $exp > $now + 86400) {
            return false;
        }
        $key = self::key();
        return $key !== '' && hash_equals(self::sign($key, 'toolkit.' . $m[1]), $m[2]);
    }

    /** The token the API makes (the site makes one only for its tests). */
    public static function toolkit_token_for(int $exp): string {
        $key = self::key();
        return $key === '' ? '' : $exp . '.' . self::sign($key, 'toolkit.' . $exp);
    }

    /**
     * template_redirect: a bare page with the site's own block scripts and
     * window.wmToolkit (validate, serialize, types), or a 403.
     */
    public static function toolkit_page() {
        // The signed toolkit token authorizes this request, not a nonce.
        if (!self::check_toolkit_token(sanitize_text_field(wp_unslash((string) $_GET['wm_toolkit'])))) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
            status_header(403);
            nocache_headers();
            header('Content-Type: text/plain; charset=utf-8');
            echo 'This toolkit link is not valid.';
            exit;
        }
        if (!defined('DONOTCACHEPAGE')) {
            define('DONOTCACHEPAGE', true);
        }
        nocache_headers();
        header('X-Robots-Tag: noindex, nofollow');
        header('Content-Type: text/html; charset=utf-8');
        echo "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex\"><title>WPMaven block toolkit</title>";
        wp_print_scripts(['wp-blocks', 'wp-block-library', 'wp-block-editor', 'wp-format-library']);
        // toolkit_script is this class's own fixed script, the version a JSON string in it.
        echo '<script>' . self::toolkit_script((string) get_bloginfo('version')) . '</script>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
        echo '</head><body></body></html>';
        exit;
    }

    /**
     * window.wmToolkit. Paths count named blocks as the site's commands do:
     * classic HTML between blocks (core/freeform here) is not addressed.
     */
    public static function toolkit_script(string $version): string {
        return 'window.wmToolkit=(function(){var done=false;'
            . 'function reg(){if(!done){wp.blockLibrary.registerCoreBlocks();done=true;}}'
            . 'function issues(b){return(b.validationIssues||[]).slice(0,5).map(function(x){try{return String(x&&x.args?x.args.slice(0,3).join(" "):x).slice(0,300);}catch(e){return "invalid";}});}'
            . 'function walk(list,path,out,count){var n=0;list.forEach(function(b){if(b.name==="core/freeform"){return;}var p=path===""?String(n):path+"."+n;n++;count.n++;'
            . 'if(b.isValid===false){out.push({path:p,name:b.name,issues:issues(b)});}walk(b.innerBlocks||[],p,out,count);});}'
            . 'return{version:' . wp_json_encode($version) . ','
            . 'types:function(){reg();return wp.blocks.getBlockTypes().map(function(t){return t.name;});},'
            . 'validate:function(m){reg();var bl=wp.blocks.parse(m),out=[],c={n:0};walk(bl,"",out,c);return{blocks:c.n,invalid:out};},'
            . 'serialize:function(m){reg();return wp.blocks.serialize(wp.blocks.parse(m));}};})();';
    }

    /** A page being added is a full-HTML page, like every page the engine writes. */
    /**
     * get_post_metadata: a staged builder page shows its staged data, never
     * Elementor's cache of the live widgets.
     */
    public static function builder_meta($value, $object_id, $meta_key, $single) {
        $staged = self::$active['builder'] ?? [];
        $key = (string) (int) $object_id;
        if (!isset($staged[$key])) {
            return $value;
        }
        if ($meta_key === '_elementor_data') {
            return [$staged[$key]];
        }
        if ($meta_key === '_elementor_element_cache') {
            return [''];
        }
        return $value;
    }

    public static function virtual_meta($value, $object_id, $meta_key, $single) {
        if (self::$active !== null && (int) $object_id >= self::VIRTUAL_ID_BASE && $meta_key === '_webmaven_fullhtml') {
            // A block page being added renders in the theme's own template, never as a designed page.
            $page = ((array) self::$active['pages'])[(int) $object_id - self::VIRTUAL_ID_BASE] ?? null;
            return is_array($page) && !empty($page['blocks']) ? $value : ['1'];
        }
        return $value;
    }

    // ── Menus ───────────────────────────────────────────────────────────────

    /** wp_nav_menu_objects: a staged location shows its staged items. */
    public static function menu_objects($items, $args) {
        $location = is_object($args) && isset($args->theme_location) ? (string) $args->theme_location : '';
        if (self::$active === null || $location === '' || !isset(self::$active['menus'][$location])) {
            return $items;
        }
        $built = self::menu_item_objects(self::$active['menus'][$location]);
        if (function_exists('_wp_menu_item_classes_by_context')) {
            _wp_menu_item_classes_by_context($built);
        }
        $out = [];
        foreach ($built as $item) {
            $out[(int) $item->menu_order] = $item;
        }
        ksort($out);
        return $out;
    }

    /** Staged Items as the menu item objects the walkers print. */
    public static function menu_item_objects(array $items): array {
        // Items not saved yet carry ids of their own (0 or less): each gets one that cannot be a post's.
        $ids = [];
        foreach ($items as $n => $item) {
            $ids[(string) $item['id']] = $item['id'] > 0 ? (int) $item['id'] : self::VIRTUAL_ID_BASE + 1000 + $n;
        }
        $parents = [];
        foreach ($items as $item) {
            if (!empty($item['parent'])) {
                $parents[(string) $item['parent']] = true;
            }
        }
        $out = [];
        foreach ($items as $n => $item) {
            $db = $ids[(string) $item['id']];
            $parent = !empty($item['parent']) && isset($ids[(string) $item['parent']]) ? $ids[(string) $item['parent']] : 0;
            list($type, $object, $object_id, $url) = self::menu_target($item['link']);
            $classes = array_values(array_filter(preg_split('/\s+/', (string) $item['classes'])));
            if (isset($parents[(string) $item['id']])) {
                $classes[] = 'menu-item-has-children';
            }
            $out[] = new WP_Post((object) [
                'ID' => $db,
                'db_id' => $db,
                'post_type' => 'nav_menu_item',
                'post_status' => 'publish',
                'post_title' => (string) $item['label'],
                'title' => esc_html((string) $item['label']),
                'menu_item_parent' => (string) $parent,
                'object_id' => (string) $object_id,
                'object' => $object,
                'type' => $type,
                'type_label' => '',
                'url' => $url,
                'target' => !empty($item['newTab']) ? '_blank' : '',
                'attr_title' => '',
                'description' => '',
                'classes' => $classes,
                'xfn' => '',
                'menu_order' => !empty($item['order']) ? (int) $item['order'] : $n + 1,
                'current' => false,
                'current_item_ancestor' => false,
                'current_item_parent' => false,
                'filter' => 'raw',
            ]);
        }
        return $out;
    }

    /** [type, object, object_id, url] of a staged link. */
    private static function menu_target(array $link): array {
        switch ($link['kind'] ?? '') {
            case 'page':
            case 'post':
            case 'product':
                $id = (int) ($link[$link['kind'] . 'Id'] ?? 0);
                return ['post_type', $link['kind'], $id, (string) get_permalink($id)];
            case 'term':
                $url = get_term_link((int) $link['termId'], (string) $link['taxonomy']);
                return ['taxonomy', (string) $link['taxonomy'], (int) $link['termId'], is_string($url) ? $url : '#'];
            case 'shop':
                $shop = function_exists('wc_get_page_id') ? (int) wc_get_page_id('shop') : 0;
                return ['post_type', 'page', $shop, $shop > 0 ? (string) get_permalink($shop) : home_url('/shop/')];
            default:
                return ['custom', 'custom', 0, (string) ($link['url'] ?? '')];
        }
    }

    /** A staged location with no menu yet borrows one, so the theme draws it (with the staged items). */
    public static function menu_locations($locations) {
        if (self::$active === null) {
            return $locations;
        }
        $locations = is_array($locations) ? $locations : [];
        $stand_in = null;
        foreach (array_keys((array) self::$active['menus']) as $location) {
            if (!empty($locations[$location])) {
                continue;
            }
            if ($stand_in === null) {
                $menus = function_exists('wp_get_nav_menus') ? (array) wp_get_nav_menus() : [];
                $stand_in = $menus ? (int) $menus[0]->term_id : 0;
            }
            if ($stand_in > 0) {
                $locations[$location] = $stand_in;
            }
        }
        return $locations;
    }

    // ── Products and posts ──────────────────────────────────────────────────

    private static function staged_product_fields($product) {
        if (self::$active === null || !is_object($product) || !method_exists($product, 'get_id')) {
            return null;
        }
        return self::$active['products'][(int) $product->get_id()] ?? null;
    }

    public static function product_name($value, $product) {
        $fields = self::staged_product_fields($product);
        return isset($fields['name']) ? $fields['name'] : $value;
    }

    public static function product_short_description($value, $product) {
        $fields = self::staged_product_fields($product);
        return isset($fields['shortDescription']) ? $fields['shortDescription'] : $value;
    }

    /** The long description, for a template that prints get_description() (a designed product page does). */
    public static function product_description($value, $product) {
        $fields = self::staged_product_fields($product);
        return isset($fields['description']) ? $fields['description'] : $value;
    }

    public static function product_regular_price($value, $product) {
        $fields = self::staged_product_fields($product);
        return isset($fields['regularPrice']) ? $fields['regularPrice'] : $value;
    }

    public static function product_sale_price($value, $product) {
        $fields = self::staged_product_fields($product);
        if ($fields === null || !array_key_exists('salePrice', $fields)) {
            return $value;
        }
        return $fields['salePrice'] === null ? '' : $fields['salePrice'];
    }

    /** The price a shopper pays: the staged sale price when it is below the regular one. */
    public static function product_price($value, $product) {
        $fields = self::staged_product_fields($product);
        if ($fields === null || (!isset($fields['regularPrice']) && !array_key_exists('salePrice', $fields))) {
            return $value;
        }
        $regular = isset($fields['regularPrice']) ? $fields['regularPrice'] : (string) $product->get_regular_price('edit');
        $sale = array_key_exists('salePrice', $fields) ? (string) $fields['salePrice'] : (string) $product->get_sale_price('edit');
        return ($sale !== '' && $regular !== '' && (float) $sale < (float) $regular) ? $sale : $regular;
    }

    public static function post_title($title, $id = 0) {
        if (self::$active === null) {
            return $title;
        }
        $fields = self::$active['posts'][(int) $id] ?? null;
        if (isset($fields['title'])) {
            return esc_html($fields['title']);
        }
        $product = self::$active['products'][(int) $id] ?? null;
        return isset($product['name']) ? esc_html($product['name']) : $title;
    }

    public static function post_excerpt($excerpt, $post = null) {
        if (self::$active === null) {
            return $excerpt;
        }
        $id = is_object($post) ? (int) $post->ID : (int) $post;
        $fields = self::$active['posts'][$id] ?? null;
        return isset($fields['excerpt']) ? esc_html($fields['excerpt']) : $excerpt;
    }

    // ── Headers, banner, links ──────────────────────────────────────────────

    /** wp_headers: a preview is never indexed and never stored by a cache. */
    public static function headers($headers) {
        $headers = is_array($headers) ? $headers : [];
        $headers['X-Robots-Tag'] = 'noindex, nofollow';
        $headers['Cache-Control'] = 'no-store';
        unset($headers['Last-Modified'], $headers['ETag']);
        return $headers;
    }

    /** wp_footer: the banner (not in the editor's frame) and the script that keeps the token on internal links. */
    /** A page of an active preview says so: the designed forms' runtime then never sends. */
    public static function head_marker() {
        if (self::$state === 'active') {
            echo '<meta name="wpmaven-preview" content="1">' . "\n";
        }
    }

    /** Pressing a designed form's button on a preview: one sentence, nothing sent. */
    const FORM_PREVIEW_SENTENCE = 'This is a preview. The form sends once the change is published.';

    public static function footer() {
        if (self::$state === null) {
            return;
        }
        $bare = isset($_GET['wm_preview_bare']) && (string) $_GET['wm_preview_bare'] === '1';
        if (!$bare) {
            $text = self::BANNERS[self::$state] ?? self::BANNERS['invalid'];
            echo '<div id="wm-preview-banner" role="status" style="position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;max-width:calc(100% - 32px);box-sizing:border-box;background:#111827;color:#fff;font:600 13px/1.4 system-ui,-apple-system,\'Segoe UI\',Roboto,sans-serif;padding:8px 16px;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.25);pointer-events:none;text-align:center">'
                . esc_html($text) . '</div>' . "\n";
        }
        if (self::$state === 'active' && self::$token !== '') {
            echo '<script>(function(){var t=' . wp_json_encode(self::$token) . ',b=' . ($bare ? 'true' : 'false') . ';'
                . 'function k(a){try{var u=new URL(a.getAttribute("href"),location.href);if(u.origin!==location.origin||!/^https?:$/.test(u.protocol)||u.searchParams.has("wm_preview"))return;'
                . 'u.searchParams.set("wm_preview",t);if(b)u.searchParams.set("wm_preview_bare","1");a.setAttribute("href",u.toString());}catch(e){}}'
                . 'function all(){var l=document.querySelectorAll("a[href]");for(var i=0;i<l.length;i++)k(l[i]);}'
                . 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",all);else all();'
                . 'document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(a)k(a);},true);})();</script>' . "\n";
            // Before any theme script (window capture runs first): a designed
            // form never submits from a preview, whatever runtime the theme has.
            echo '<script>(function(){var m=' . wp_json_encode(self::FORM_PREVIEW_SENTENCE) . ';'
                . 'function stop(e){var t=e.target,f=t&&t.closest?t.closest("[data-wm-form]"):null;if(!f)return;'
                . 'if(e.type==="click"&&!t.closest("button[type=submit],input[type=submit],button:not([type])"))return;'
                . 'e.preventDefault();e.stopImmediatePropagation();'
                . 'var d=f.querySelector(".wpforms-error-container")||f.insertBefore(document.createElement("div"),f.firstChild);'
                . 'd.className="wpforms-error-container";d.setAttribute("role","status");d.textContent=m;}'
                . 'window.addEventListener("submit",stop,true);window.addEventListener("click",stop,true);})();</script>' . "\n";
        }
    }

    /** A value shown inside a sentence: no markup, no control characters, not too long. */
    private static function plain(string $value): string {
        $value = preg_replace('/[\x00-\x1F\x7F]/', '', wp_strip_all_tags($value));
        return strlen($value) > 120 ? substr($value, 0, 117) . '...' : $value;
    }
}
