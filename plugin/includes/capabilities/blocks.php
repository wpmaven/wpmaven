<?php
/**
 * Block content on any site (2026-10-09): the edit engine reads and writes
 * the blocks of a post, a template part or a navigation post, the global
 * styles of the active theme, and the theme's design sources, on sites
 * WPMaven did not design.
 *
 *   wm_blocks_read   {post_id} | {part: slug, theme_file?: true} | {navigation_id}
 *                    -> {target, kind: post|part|navigation, markup, sha256, tree: [Node],
 *                        modified_gmt, post_type?, customized?, area?, title?, raw?}
 *                    (raw: what the site stores when markup resolved its pattern references;
 *                    theme_file: a part as the theme's file holds it, customized or not)
 *   wm_blocks_write  {<target>, expect_sha256, replace?: {index: markup},
 *                     insert?: [{after: index|-1, markup}], restore?: markup}
 *                    -> {target, sha256, modified_gmt, created}
 *   wm_part_reset    {part, expect_sha256, keep?} -> {reset: true, trashed?}
 *                    (keep: the copy goes to the trash, for "Back to your theme's version")
 *   wm_part_untrash  {part, post_id} -> {sha256, post_id}: that copy is the part again
 *   wm_styles_read   {} -> {theme, exists, post_id, user_data, sha256, font_choices}
 *                    (font_choices: the font families the theme ships in its style
 *                    variations, with their faces, that its active styles do not list)
 *   wm_styles_write  {user_data: {settings?, styles?}, expect_sha256} -> {sha256, created, post_id}
 *   wm_styles_reset  {expect_sha256} -> {reset: true}
 *   wm_navigation_claim  {part?: 'header', index?: 0} -> {navigation_id, inline, claimed, created_navigation,
 *                        navigation_before, part: {slug, sha256_before, sha256, created}}
 *                        (an inline navigation's links become a navigation post of their own)
 *   wm_navigation_delete {navigation_id, expect_sha256} -> {deleted: true}
 *   wm_navigation_read {part?: 'header', index?: 0} -> {navigation_id, claimed, inline, markup, sha256,
 *                        count, part: {slug, sha256, customized}}
 *                        Read only: the links the part's index-th navigation shows (its ref,
 *                        else WordPress's fallback), a page list given as the links a claim
 *                        would write; inline links are the navigation block's own. count:
 *                        how many navigation blocks the part holds.
 *                        {all: true} -> {navigations: [{slug, index, read}]}: every
 *                        navigation of the header (its first) and the footer (up to 3) in one
 *                        call, the site map's single read.
 *   wm_blocks_page_create {title, markup, slug?, status?: publish|draft, parent?} -> {post_id, slug, link, sha256}
 *                        A page of blocks (a site WPMaven did not design): its markup cleaned as
 *                        wm_blocks_write cleans new blocks, the theme's own page template.
 *   wm_blocks_page_delete {post_id, expect_sha256} -> {deleted: true}: the undo of that create,
 *                        refused with DRIFT when the page changed since.
 *   wm_link_targets    {links?: [MenuLink]} -> {shop: {page_id, link}|null, categories:
 *                        [{taxonomy, id, name, link}], resolved: [{url, label, type, id, kind}|null]}
 *                        What a menu link may go to besides pages and posts (the shop, blog
 *                        and product categories), and each given link's address as WordPress
 *                        gives it (null: not found, not published).
 *   wm_design_tokens_read {} -> {theme, settings, styles, builder, root_values,
 *                        custom_properties, shas}
 *   wm_blocks_outline {} -> {theme: {slug, name, kind, supports_global_styles}, front_page_id,
 *                        posts_page_id, pages: [Page], posts: [{id, title, link}], parts: [Part],
 *                        navigation: [{id, title, location?}], classic: {menus, widget_areas}|null,
 *                        identity: {name, tagline}, design_shas}
 *                        A part is {slug, area, title, customized, excerpt, sha256, blocks:
 *                        [Outline], shows: {site_title, tagline}}; design_shas are wm_design_tokens_read's shas, cheap to
 *                        compare, so the api knows when the site's tokens must be read again.
 *                        A Page is {id, title, slug, link, status, builder, classic, sha256,
 *                        blocks: [Outline]}; an Outline is a top-level block {index, name, sig,
 *                        locked, label, heading, excerpt, rich, images, form, product_grid}.
 *
 * A Node is {path, name, attrs, text, sig, locked, children: [Node]}; at the
 * top level it also carries {index, start, end}, the block's bytes in the
 * markup. A path is the block's place among the NAMED blocks at each level
 * ("0", "2.1.0"), counted from the target's own content, never from the
 * order a page renders in: a widget or a template around the content never
 * shifts it. sig is the first 16 hex characters of the sha1 of the block's
 * innerHTML, the same mark the editor's frame carries (data-wme-block-sig).
 *
 * Writes splice only the changed top-level blocks into the markup the site
 * holds, so every other byte stays as it was (WordPress's own formatting,
 * attribute order, the text between blocks); `restore` writes a whole markup
 * back (an undo). Every write is refused with DRIFT when the target is no
 * longer what was read (expect_sha256). A template part that lives only in
 * the theme's files gets the customized copy WordPress's site editor would
 * make (a wp_template_part post with the theme and area terms) on its first
 * write; wm_part_reset deletes that copy, so the theme's file shows again.
 * The global styles post is created the way WordPress creates it on the
 * first styles change; wm_styles_reset deletes it.
 *
 * Failures THROW "CODE: sentence" like the other edit commands.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['wm_blocks_read'] = ['WebMaven_Cap_Blocks', 'blocks_read'];
    $handlers['wm_blocks_write'] = ['WebMaven_Cap_Blocks', 'blocks_write'];
    $handlers['wm_part_reset'] = ['WebMaven_Cap_Blocks', 'part_reset'];
    $handlers['wm_part_untrash'] = ['WebMaven_Cap_Blocks', 'part_untrash'];
    $handlers['wm_styles_read'] = ['WebMaven_Cap_Blocks', 'styles_read'];
    $handlers['wm_styles_write'] = ['WebMaven_Cap_Blocks', 'styles_write'];
    $handlers['wm_styles_reset'] = ['WebMaven_Cap_Blocks', 'styles_reset'];
    $handlers['wm_navigation_claim'] = ['WebMaven_Cap_Blocks', 'navigation_claim'];
    $handlers['wm_navigation_delete'] = ['WebMaven_Cap_Blocks', 'navigation_delete'];
    $handlers['wm_navigation_read'] = ['WebMaven_Cap_Blocks', 'navigation_read'];
    $handlers['wm_link_targets'] = ['WebMaven_Cap_Blocks', 'link_targets'];
    $handlers['wm_blocks_page_create'] = ['WebMaven_Cap_Blocks', 'page_create'];
    $handlers['wm_blocks_page_delete'] = ['WebMaven_Cap_Blocks', 'page_delete'];
    $handlers['wm_design_tokens_read'] = ['WebMaven_Cap_Blocks', 'design_tokens_read'];
    $handlers['wm_blocks_outline'] = ['WebMaven_Cap_Blocks', 'blocks_outline'];
    return $handlers;
});

/**
 * Block markup without a full parse-and-serialize: the top-level blocks'
 * byte ranges, the tree with target-relative paths, and splices. Also used
 * by the older editor's handlers and by discovery (the block mark).
 */
final class WebMaven_Block_Tree {

    /** A block delimiter, as WordPress's own parser reads it (WP_Block_Parser::next_token). */
    const DELIMITER = '/<!--\s+(?P<closer>\/)?wp:(?P<namespace>[a-z][a-z0-9_-]*\/)?(?P<name>[a-z][a-z0-9_-]*)\s+(?P<attrs>{(?:(?:[^}]+|}+(?=})|(?!}\s+\/?-->).)*+)?}\s+)?(?P<void>\/)?-->/s';

    const TEXT_CHARS = 200;
    const MAX_DEPTH = 40;

    /** The mark of a block: what the frame carries and a handler compares before it writes. */
    public static function sig(array $block): string {
        return substr(sha1((string) ($block['innerHTML'] ?? '')), 0, 16);
    }

    /**
     * The top-level named blocks of a markup, in order, each
     * {name, start, end, attrs}: start and end are byte offsets (end
     * exclusive). Text between blocks is not listed. An opener never closed
     * runs to the end of the markup, as WordPress's parser reads it.
     */
    public static function spans(string $markup): array {
        $spans = [];
        if (!preg_match_all(self::DELIMITER, $markup, $m, PREG_SET_ORDER | PREG_OFFSET_CAPTURE)) {
            return $spans;
        }
        $depth = 0;
        $open = null;
        foreach ($m as $tok) {
            $at = $tok[0][1];
            $len = strlen($tok[0][0]);
            $is_closer = isset($tok['closer']) && $tok['closer'][0] === '/' && $tok['closer'][1] >= 0;
            $is_void = isset($tok['void']) && $tok['void'][0] === '/' && $tok['void'][1] >= 0;
            $ns = isset($tok['namespace']) && $tok['namespace'][1] >= 0 ? $tok['namespace'][0] : 'core/';
            $name = $ns . $tok['name'][0];
            if ($is_closer) {
                if ($depth === 0) {
                    continue; // a stray closer: WordPress ignores it
                }
                $depth--;
                if ($depth === 0 && $open !== null) {
                    $open['end'] = $at + $len;
                    $spans[] = $open;
                    $open = null;
                }
                continue;
            }
            $attrs_raw = isset($tok['attrs']) && $tok['attrs'][1] >= 0 ? $tok['attrs'][0] : '';
            if ($is_void) {
                if ($depth === 0) {
                    $spans[] = ['name' => $name, 'start' => $at, 'end' => $at + $len, 'attrs' => self::attrs_of($attrs_raw)];
                }
                continue;
            }
            if ($depth === 0) {
                $open = ['name' => $name, 'start' => $at, 'end' => strlen($markup), 'attrs' => self::attrs_of($attrs_raw)];
            }
            $depth++;
        }
        if ($open !== null) {
            $spans[] = $open; // never closed: to the end
        }
        return $spans;
    }

    private static function attrs_of(string $raw): array {
        if (trim($raw) === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * The tree of a markup: named blocks only, paths from its own root. The
     * top-level nodes carry their byte range. Throws UNREADABLE when
     * WordPress's parser and the delimiter scan disagree on the top level.
     */
    public static function tree(string $markup): array {
        $parsed = array_values(array_filter(parse_blocks($markup), function ($b) {
            return !empty($b['blockName']);
        }));
        $spans = self::spans($markup);
        if (count($parsed) !== count($spans)) {
            throw new Exception('UNREADABLE: The blocks of this content could not be read reliably.');
        }
        $nodes = [];
        foreach ($parsed as $i => $block) {
            $node = self::node($block, (string) $i, null, 0);
            $node['index'] = $i;
            $node['start'] = $spans[$i]['start'];
            $node['end'] = $spans[$i]['end'];
            $nodes[] = $node;
        }
        return $nodes;
    }

    private static function node(array $block, string $path, $parent, int $depth): array {
        $children = [];
        if ($depth < self::MAX_DEPTH) {
            $n = 0;
            foreach ((array) ($block['innerBlocks'] ?? []) as $inner) {
                if (empty($inner['blockName'])) {
                    continue;
                }
                $children[] = self::node($inner, $path . '.' . $n, $block, $depth + 1);
                $n++;
            }
        }
        $attrs = is_array($block['attrs'] ?? null) ? $block['attrs'] : [];
        return [
            'path' => $path,
            'name' => (string) $block['blockName'],
            'attrs' => (object) $attrs,
            'text' => self::text_of((string) ($block['innerHTML'] ?? '')),
            'sig' => self::sig($block),
            'locked' => self::locked($block, $parent),
            'children' => $children,
        ];
    }

    private static function text_of(string $html): string {
        $text = trim(preg_replace('/\s+/u', ' ', html_entity_decode(wp_strip_all_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8')));
        return function_exists('mb_substr') ? mb_substr($text, 0, self::TEXT_CHARS) : substr($text, 0, self::TEXT_CHARS);
    }

    /** Locked against content changes: its own lock beyond remove and move, or a parent's templateLock all or contentOnly. */
    public static function locked(array $block, $parent): bool {
        if (is_array($parent)) {
            $tl = $parent['attrs']['templateLock'] ?? null;
            if ($tl === 'all' || $tl === 'contentOnly') {
                return true;
            }
        }
        $lock = $block['attrs']['lock'] ?? [];
        if (is_array($lock) && $lock) {
            return (bool) array_diff(array_keys(array_filter($lock)), ['remove', 'move']);
        }
        return false;
    }

    /**
     * A new markup from an old one: top-level block `index` replaced by its
     * new markup (an empty markup removes it), new markup inserted after a
     * top-level block (-1: at the start). Indices are the old markup's. Every
     * byte outside the changed blocks is kept.
     */
    public static function splice(string $markup, array $replace, array $insert): string {
        $spans = self::spans($markup);
        $count = count($spans);
        $edits = []; // [start, end, text]
        foreach ($replace as $index => $new) {
            $i = self::index_of($index, $count, false);
            if (!is_string($new)) {
                throw new Exception('VALIDATION: A block replacement is markup.');
            }
            $edits[] = [$spans[$i]['start'], $spans[$i]['end'], $new, 1];
        }
        foreach ($insert as $ins) {
            if (!is_array($ins) || !array_key_exists('after', $ins) || !is_string($ins['markup'] ?? null)) {
                throw new Exception('VALIDATION: An insertion is {after, markup}.');
            }
            $i = self::index_of($ins['after'], $count, true);
            $at = $i < 0 ? ($count ? $spans[0]['start'] : strlen($markup)) : $spans[$i]['end'];
            $text = $i < 0 ? $ins['markup'] . "\n\n" : "\n\n" . $ins['markup'];
            $edits[] = [$at, $at, $text, 0];
        }
        // From the end, so earlier offsets stay true; at one offset an insertion goes after a replacement's end.
        usort($edits, function ($a, $b) {
            return $b[0] <=> $a[0] ?: $a[3] <=> $b[3];
        });
        $starts = [];
        foreach ($edits as $e) {
            if ($e[3] === 1) {
                if (isset($starts[$e[0]])) {
                    throw new Exception('VALIDATION: A block is replaced twice.');
                }
                $starts[$e[0]] = true;
            }
        }
        foreach ($edits as $e) {
            $markup = substr($markup, 0, $e[0]) . $e[2] . substr($markup, $e[1]);
        }
        return $markup;
    }

    private static function index_of($index, int $count, bool $allow_start): int {
        if (is_string($index) && preg_match('/^-?\d+$/', $index)) {
            $index = (int) $index;
        }
        if (!is_int($index) || $index >= $count || $index < ($allow_start ? -1 : 0)) {
            throw new Exception('NOT_FOUND: Block ' . (is_scalar($index) ? $index : '?') . ' is not on this content.');
        }
        return $index;
    }

    /**
     * The block at a path of a parsed list (named blocks only), with its
     * parent, or null.
     */
    public static function at_path(array $blocks, string $path) {
        $parent = null;
        $list = $blocks;
        $found = null;
        foreach (explode('.', $path) as $step) {
            if (!ctype_digit($step)) {
                return null;
            }
            $want = (int) $step;
            $n = 0;
            $found = null;
            foreach ($list as $b) {
                if (empty($b['blockName'])) {
                    continue;
                }
                if ($n === $want) {
                    $found = $b;
                    break;
                }
                $n++;
            }
            if ($found === null) {
                return null;
            }
            $last_parent = $parent;
            $parent = $found;
            $list = (array) ($found['innerBlocks'] ?? []);
        }
        return $found === null ? null : ['block' => $found, 'parent' => $last_parent ?? null];
    }
}

final class WebMaven_Cap_Blocks {

    const PART_SLUG = '/^[a-z0-9][a-z0-9_-]{0,80}$/';
    const POST_TYPES = ['page', 'post', 'wp_block'];
    const MAX_MARKUP_BYTES = 3145728; // 3 MB, the page commands' cap
    const MAX_PROPERTIES = 300;

    private static function error(string $code, string $message): Exception {
        return new Exception($code . ': ' . $message);
    }

    // ── Targets ─────────────────────────────────────────────────────────────

    /**
     * What a request names: {kind, key, markup, post?, ...}. A part that
     * lives only in the theme's files has no post.
     */
    private static function target(array $params): array {
        $has = array_values(array_filter(['post_id', 'part', 'navigation_id'], function ($k) use ($params) {
            return isset($params[$k]) && $params[$k] !== '' && $params[$k] !== null;
        }));
        if (count($has) !== 1) {
            throw self::error('VALIDATION', 'Name one target: post_id, part or navigation_id.');
        }
        if ($has[0] === 'part') {
            return self::part_target((string) $params['part'], !empty($params['theme_file']));
        }
        $id = self::positive_int($params[$has[0]]);
        $post = $id > 0 ? get_post($id) : null;
        if ($has[0] === 'navigation_id') {
            if (!$post || $post->post_type !== 'wp_navigation' || $post->post_status === 'trash') {
                throw self::error('NOT_FOUND', 'Navigation ' . $id . ' was not found.');
            }
            return ['kind' => 'navigation', 'key' => ['navigation_id' => $id], 'post' => $post, 'raw' => (string) $post->post_content, 'markup' => (string) $post->post_content];
        }
        if (!$post || !in_array($post->post_type, self::POST_TYPES, true) || in_array($post->post_status, ['trash', 'auto-draft'], true)) {
            throw self::error('NOT_FOUND', 'Post ' . $id . ' was not found.');
        }
        return ['kind' => 'post', 'key' => ['post_id' => $id], 'post' => $post, 'post_type' => $post->post_type,
            'raw' => (string) $post->post_content, 'markup' => self::resolve_patterns((string) $post->post_content)];
    }

    /** A template part of the active block theme: its customized copy, else (or when asked) the theme's file. */
    public static function part_target(string $slug, bool $theme_file = false): array {
        if (!preg_match(self::PART_SLUG, $slug)) {
            throw self::error('VALIDATION', 'part must be a template part slug.');
        }
        if (!function_exists('wp_is_block_theme') || !wp_is_block_theme()) {
            throw self::error('NOT_BLOCK_THEME', 'This theme draws its header and footer itself.');
        }
        $post = $theme_file ? null : self::customized_part($slug);
        if ($post) {
            return ['kind' => 'part', 'key' => ['part' => $slug], 'slug' => $slug, 'post' => $post, 'customized' => true,
                'area' => self::part_area($post), 'title' => (string) $post->post_title,
                'raw' => (string) $post->post_content, 'markup' => self::resolve_patterns((string) $post->post_content)];
        }
        $file = function_exists('get_block_file_template') ? get_block_file_template(get_stylesheet() . '//' . $slug, 'wp_template_part') : null;
        if (!$file) {
            throw self::error('NOT_FOUND', 'This theme has no template part named ' . $slug . '.');
        }
        return ['kind' => 'part', 'key' => ['part' => $slug], 'slug' => $slug, 'post' => null,
            'customized' => $theme_file ? self::customized_part($slug) !== null : false,
            'area' => (string) ($file->area ?? 'uncategorized'), 'title' => (string) ($file->title ?: ucfirst($slug)),
            'raw' => (string) $file->content, 'markup' => self::resolve_patterns((string) $file->content)];
    }

    /** The customized copy of a part for the active theme (published), or null. */
    public static function customized_part(string $slug) {
        $posts = get_posts([
            'post_type' => 'wp_template_part',
            'post_status' => ['publish'],
            'name' => $slug,
            'posts_per_page' => 1,
            'no_found_rows' => true,
            'tax_query' => [[
                'taxonomy' => 'wp_theme',
                'field' => 'name',
                'terms' => get_stylesheet(),
            ]],
        ]);
        return $posts ? $posts[0] : null;
    }

    /**
     * A markup with its pattern references (<!-- wp:pattern {"slug":...} /-->,
     * how the default theme's header holds its blocks) replaced by the
     * patterns' blocks, as WordPress renders them and as its site editor saves
     * a part: the blocks the owner sees are then the blocks the markup holds.
     * Everything else is kept byte for byte.
     */
    public static function resolve_patterns(string $markup, int $depth = 0): string {
        if ($depth > 4 || strpos($markup, 'wp:pattern') === false || !class_exists('WP_Block_Patterns_Registry')) {
            return $markup;
        }
        return preg_replace_callback('/<!--\s+wp:pattern\s+(\{.*?\})\s+\/-->/s', function ($m) use ($depth) {
            $attrs = json_decode($m[1], true);
            $slug = is_array($attrs) ? (string) ($attrs['slug'] ?? '') : '';
            $pattern = $slug !== '' ? WP_Block_Patterns_Registry::get_instance()->get_registered($slug) : null;
            if (!is_array($pattern) || !isset($pattern['content'])) {
                return $m[0];
            }
            return self::resolve_patterns((string) $pattern['content'], $depth + 1);
        }, $markup);
    }

    private static function part_area($post): string {
        $terms = get_the_terms($post, 'wp_template_part_area');
        return (is_array($terms) && $terms) ? (string) $terms[0]->name : 'uncategorized';
    }

    private static function positive_int($v): int {
        if (is_int($v)) {
            return $v > 0 ? $v : 0;
        }
        return (is_string($v) && ctype_digit($v)) ? (int) $v : 0;
    }

    private static function sha(string $markup): string {
        return hash('sha256', $markup);
    }

    private static function check_sha(array $params, string $current, string $what) {
        $expect = $params['expect_sha256'] ?? null;
        if (!is_string($expect) || !preg_match('/^[a-f0-9]{64}$/i', $expect)) {
            throw self::error('VALIDATION', 'expect_sha256 must be the sha256 (hex) of what was read.');
        }
        if (!hash_equals(strtolower($expect), self::sha($current))) {
            throw self::error('DRIFT', $what . ' was changed on the site after this change was prepared.');
        }
    }

    private static function describe(array $t): string {
        if ($t['kind'] === 'part') {
            return 'The ' . $t['slug'] . ' part';
        }
        if ($t['kind'] === 'navigation') {
            return 'The navigation';
        }
        $title = trim(wp_strip_all_tags((string) $t['post']->post_title));
        return $title !== '' ? '"' . $title . '"' : 'This content';
    }

    // ── wm_blocks_read ──────────────────────────────────────────────────────

    public static function blocks_read($params = [], $step_id = null) {
        $t = self::target(is_array($params) ? $params : []);
        $out = [
            'target' => $t['key'],
            'kind' => $t['kind'],
            'markup' => $t['markup'],
            'sha256' => self::sha($t['raw']),
            'resolved' => $t['markup'] !== $t['raw'],
            'tree' => WebMaven_Block_Tree::tree($t['markup']),
            'modified_gmt' => $t['post'] ? (string) $t['post']->post_modified_gmt : null,
        ];
        if ($t['kind'] === 'post') {
            $out['post_type'] = $t['post_type'];
            // The site's language: AI-written words follow it, never a guess from where the business is.
            $out['locale'] = (string) get_locale();
            $out['title'] = wp_strip_all_tags((string) $t['post']->post_title);
        }
        if ($t['markup'] !== $t['raw']) {
            // What the site stores, pattern references kept: an undo writes it back as it was.
            $out['raw'] = $t['raw'];
        }
        if ($t['kind'] === 'part') {
            $out['customized'] = $t['customized'];
            $out['area'] = $t['area'];
            $out['title'] = $t['title'];
        }
        return $out;
    }

    // ── wm_blocks_outline ───────────────────────────────────────────────────

    const OUTLINE_PAGES = 100;
    const OUTLINE_POSTS = 30;
    const OUTLINE_RICH = 40;
    const OUTLINE_EXCERPT = 160;
    /** Blocks whose own HTML holds the words the owner reads (a section's text fields). */
    const RICH_BLOCKS = ['core/heading', 'core/paragraph', 'core/button', 'core/list-item', 'core/quote', 'core/pullquote',
        'core/verse', 'core/preformatted', 'core/details', 'core/image', 'core/site-title', 'core/site-tagline'];
    const IMAGE_BLOCKS = ['core/image', 'core/cover', 'core/media-text'];
    const FORM_BLOCKS = ['wpforms/form-selector', 'contact-form-7/contact-form-selector', 'jetpack/contact-form', 'core/search'];

    /**
     * What the edit engine lists on a site it did not design: the theme, the
     * published pages with their top-level blocks summarized (the sections),
     * the latest posts, the template parts, the navigation posts and, on a
     * classic theme, its menus and widget areas. Nothing is written.
     */
    public static function blocks_outline($params = [], $step_id = null) {
        $theme = wp_get_theme();
        $block_theme = function_exists('wp_is_block_theme') && wp_is_block_theme();
        $pages = [];
        foreach ((array) get_posts([
            'post_type' => 'page', 'post_status' => ['publish'], 'numberposts' => self::OUTLINE_PAGES, 'posts_per_page' => self::OUTLINE_PAGES,
            'orderby' => 'menu_order title', 'order' => 'ASC', 'no_found_rows' => true,
        ]) as $post) {
            $pages[] = self::outline_page($post);
        }
        $posts = [];
        foreach ((array) get_posts([
            'post_type' => 'post', 'post_status' => ['publish'], 'numberposts' => self::OUTLINE_POSTS, 'posts_per_page' => self::OUTLINE_POSTS,
            'orderby' => 'date', 'order' => 'DESC', 'no_found_rows' => true,
        ]) as $post) {
            $posts[] = ['id' => (int) $post->ID, 'title' => wp_strip_all_tags((string) $post->post_title), 'link' => (string) get_permalink($post)];
        }
        $parts = [];
        $navigation = [];
        if ($block_theme) {
            foreach (['header', 'footer'] as $slug) {
                try {
                    $t = self::part_target($slug);
                } catch (Exception $e) {
                    continue;
                }
                $part_blocks = [];
                foreach (array_values(array_filter(parse_blocks($t['markup']), function ($b) {
                    return !empty($b['blockName']);
                })) as $i => $block) {
                    $part_blocks[] = self::outline_block($block, $i);
                }
                $parts[] = ['slug' => $slug, 'area' => $t['area'], 'title' => $t['title'], 'customized' => $t['customized'],
                    'excerpt' => self::excerpt_of_markup($t['markup']), 'sha256' => self::sha($t['raw']), 'blocks' => $part_blocks,
                    'shows' => ['site_title' => strpos($t['markup'], 'wp:site-title') !== false, 'tagline' => strpos($t['markup'], 'wp:site-tagline') !== false]];
                foreach (self::navigations($t['markup']) as $nav) {
                    if (!empty($nav['attrs']['ref']) && !isset($navigation[(int) $nav['attrs']['ref']])) {
                        $navigation[(int) $nav['attrs']['ref']] = ['id' => (int) $nav['attrs']['ref'], 'location' => $slug];
                    }
                }
            }
            foreach ((array) get_posts([
                'post_type' => 'wp_navigation', 'post_status' => ['publish'], 'numberposts' => 20, 'posts_per_page' => 20,
                'orderby' => 'date', 'order' => 'DESC', 'no_found_rows' => true,
            ]) as $nav) {
                $id = (int) $nav->ID;
                $navigation[$id] = ['id' => $id, 'title' => wp_strip_all_tags((string) $nav->post_title)] + ($navigation[$id] ?? []);
            }
        }
        $classic = null;
        if (!$block_theme) {
            $areas = [];
            foreach ((array) ($GLOBALS['wp_registered_sidebars'] ?? []) as $id => $area) {
                $areas[] = ['id' => (string) $id, 'name' => (string) ($area['name'] ?? $id)];
            }
            $menus = [];
            foreach ((array) (function_exists('get_registered_nav_menus') ? get_registered_nav_menus() : []) as $loc => $label) {
                $menus[] = ['location' => (string) $loc, 'label' => (string) $label];
            }
            $classic = ['menus' => $menus, 'widget_areas' => $areas];
        }
        return [
            'theme' => ['slug' => get_stylesheet(), 'name' => (string) $theme->get('Name'), 'kind' => $block_theme ? 'block' : 'classic',
                'supports_global_styles' => function_exists('wp_theme_has_theme_json') ? (bool) wp_theme_has_theme_json() : $block_theme],
            'front_page_id' => get_option('show_on_front') === 'page' ? (int) get_option('page_on_front') : 0,
            'posts_page_id' => (int) get_option('page_for_posts'),
            'pages' => $pages,
            'posts' => $posts,
            'parts' => $parts,
            'navigation' => array_values($navigation),
            'classic' => $classic,
            'identity' => ['name' => (string) get_option('blogname'), 'tagline' => (string) get_option('blogdescription')],
            'design_shas' => self::design_shas(),
        ];
    }

    /** One page with its top-level blocks summarized; a builder's page or classic content lists none. */
    private static function outline_page($post): array {
        $id = (int) $post->ID;
        $raw = (string) $post->post_content;
        $builder = null;
        if (get_post_meta($id, '_elementor_edit_mode', true) === 'builder') {
            $builder = 'elementor';
        } elseif (get_post_meta($id, '_et_pb_use_builder', true) === 'on') {
            $builder = 'divi';
        }
        $markup = self::resolve_patterns($raw);
        $blocks = [];
        $classic = trim($markup) !== '' && strpos($markup, '<!-- wp:') === false;
        if ($builder === null && !$classic) {
            $parsed = array_values(array_filter(parse_blocks($markup), function ($b) {
                return !empty($b['blockName']);
            }));
            foreach ($parsed as $i => $block) {
                $blocks[] = self::outline_block($block, $i);
            }
        }
        return [
            'id' => $id,
            'title' => wp_strip_all_tags((string) $post->post_title),
            'slug' => (string) $post->post_name,
            'link' => (string) get_permalink($post),
            'status' => (string) $post->post_status,
            'builder' => $builder,
            'classic' => $classic,
            'sha256' => self::sha($raw),
            'blocks' => $blocks,
            // An Elementor page: its sections with the words and pictures WPMaven changes in Elementor's data.
            'builder_sections' => $builder === 'elementor' && class_exists('WebMaven_Cap_Builders') ? WebMaven_Cap_Builders::outline_sections($id) : [],
        ];
    }

    /** A top-level block as the section list reads it. */
    private static function outline_block(array $block, int $index): array {
        $out = [
            'index' => $index,
            'name' => (string) $block['blockName'],
            'sig' => WebMaven_Block_Tree::sig($block),
            'locked' => WebMaven_Block_Tree::locked($block, null),
            'label' => '',
            'heading' => null,
            'excerpt' => '',
            'rich' => [],
            'images' => [],
            'form' => false,
            'product_grid' => false,
        ];
        $meta = $block['attrs']['metadata']['name'] ?? '';
        if (is_string($meta)) {
            $out['label'] = wp_strip_all_tags($meta);
        }
        // A section of a page WPMaven designed (a Custom HTML block bound to it): the owner's blocks sit between these.
        $inner = (string) ($block['innerHTML'] ?? '');
        if ($out['name'] === 'core/html' && strpos($inner, 'data-wm-page=') !== false) {
            $out['designed'] = true;
            $out['section'] = preg_match('/\sdata-wm-section="([^"]*)"/', $inner, $s) ? html_entity_decode($s[1], ENT_QUOTES) : null;
            return $out;
        }
        $texts = [];
        self::outline_walk($block, (string) $index, $out, $texts, 0);
        $excerpt = trim(preg_replace('/\s+/u', ' ', implode(' ', $texts)));
        $out['excerpt'] = function_exists('mb_substr') ? mb_substr($excerpt, 0, self::OUTLINE_EXCERPT) : substr($excerpt, 0, self::OUTLINE_EXCERPT);
        return $out;
    }

    private static function outline_walk(array $block, string $path, array &$out, array &$texts, int $depth) {
        $name = (string) $block['blockName'];
        $html = (string) ($block['innerHTML'] ?? '');
        $attrs = is_array($block['attrs'] ?? null) ? $block['attrs'] : [];
        $text = trim(preg_replace('/\s+/u', ' ', html_entity_decode(wp_strip_all_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8')));
        if ($text !== '' && count($texts) < 12) {
            $texts[] = $text;
        }
        if ($name === 'core/heading' && $out['heading'] === null && $text !== '') {
            $out['heading'] = ['text' => function_exists('mb_substr') ? mb_substr($text, 0, 120) : substr($text, 0, 120), 'level' => (int) ($attrs['level'] ?? 2), 'path' => $path];
        }
        if (in_array($name, self::RICH_BLOCKS, true) && $text !== '' && count($out['rich']) < self::OUTLINE_RICH) {
            $rich = ['path' => $path, 'name' => $name, 'text' => function_exists('mb_substr') ? mb_substr($text, 0, 300) : substr($text, 0, 300)];
            if (preg_match('/<a\s[^>]*href="([^"]*)"/i', $html, $m)) {
                $rich['url'] = html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
            }
            if ($name === 'core/heading') {
                $rich['level'] = (int) ($attrs['level'] ?? 2);
            }
            $out['rich'][] = $rich;
        }
        if (in_array($name, self::IMAGE_BLOCKS, true)) {
            $img = ['path' => $path, 'name' => $name, 'id' => 0, 'url' => '', 'alt' => ''];
            if (preg_match('/<img\s[^>]*>/i', $html, $tag)) {
                if (preg_match('/\ssrc="([^"]*)"/i', $tag[0], $m)) {
                    $img['url'] = html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
                }
                if (preg_match('/\salt="([^"]*)"/i', $tag[0], $m)) {
                    $img['alt'] = html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
                }
                if (preg_match('/\bwp-image-(\d+)\b/', $tag[0], $m)) {
                    $img['id'] = (int) $m[1];
                }
            }
            foreach (['id', 'mediaId'] as $k) {
                if (!empty($attrs[$k]) && is_numeric($attrs[$k])) {
                    $img['id'] = (int) $attrs[$k];
                }
            }
            foreach (['url', 'mediaUrl'] as $k) {
                if ($img['url'] === '' && !empty($attrs[$k]) && is_string($attrs[$k])) {
                    $img['url'] = $attrs[$k];
                }
            }
            if ($img['url'] !== '' || $img['id'] > 0) {
                $out['images'][] = $img;
            }
        }
        if (in_array($name, self::FORM_BLOCKS, true)
            || ($name === 'core/shortcode' && preg_match('/\[(wpforms|contact-form-7)\b/', $html))) {
            $out['form'] = true;
        }
        if (strpos($name, 'woocommerce/') === 0
            || ($name === 'core/query' && (($attrs['query']['postType'] ?? '') === 'product'))
            || ($name === 'core/shortcode' && preg_match('/\[(products|product_category|recent_products|featured_products|sale_products)\b/', $html))) {
            $out['product_grid'] = true;
        }
        if ($depth >= WebMaven_Block_Tree::MAX_DEPTH) {
            return;
        }
        $n = 0;
        foreach ((array) ($block['innerBlocks'] ?? []) as $inner) {
            if (empty($inner['blockName'])) {
                continue;
            }
            self::outline_walk($inner, $path . '.' . $n, $out, $texts, $depth + 1);
            $n++;
        }
    }

    /** The words of a markup, short (a part's excerpt). */
    private static function excerpt_of_markup(string $markup): string {
        $text = trim(preg_replace('/\s+/u', ' ', html_entity_decode(wp_strip_all_tags(preg_replace('/<!--.*?-->/s', ' ', $markup)), ENT_QUOTES | ENT_HTML5, 'UTF-8')));
        return function_exists('mb_substr') ? mb_substr($text, 0, self::OUTLINE_EXCERPT) : substr($text, 0, self::OUTLINE_EXCERPT);
    }

    // ── wm_blocks_write ─────────────────────────────────────────────────────

    public static function blocks_write($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        if (!empty($params['theme_file'])) {
            throw self::error('VALIDATION', 'A part is written as the site holds it, not as the theme\'s file.');
        }
        $t = self::target($params);
        $new = self::new_markup($params, $t);

        $created = false;
        if ($t['kind'] === 'part' && !$t['customized']) {
            $post_id = self::create_part_copy($t, $new);
            $created = true;
        } else {
            $post_id = (int) $t['post']->ID;
            $saved = wp_update_post(wp_slash(['ID' => $post_id, 'post_content' => $new]), true);
            if (is_wp_error($saved) || !$saved) {
                throw self::error('WRITE_FAILED', self::describe($t) . ' could not be saved' . (is_wp_error($saved) ? ': ' . wp_strip_all_tags($saved->get_error_message()) : '.'));
            }
        }
        clean_post_cache($post_id);
        $fresh = get_post($post_id);
        if (!$fresh) {
            throw self::error('WRITE_FAILED', 'The content could not be read back after the save.');
        }
        return [
            'target' => $t['key'],
            'sha256' => self::sha((string) $fresh->post_content),
            'modified_gmt' => (string) $fresh->post_modified_gmt,
            'created' => $created,
        ];
    }

    /** A part's new markup saved: its customized copy updated, or made on its first change. Answers the post id. */
    public static function save_part(array $t, string $markup): int {
        if ($t['customized']) {
            $id = (int) $t['post']->ID;
            $saved = wp_update_post(wp_slash(['ID' => $id, 'post_content' => $markup]), true);
            if (is_wp_error($saved) || !$saved) {
                throw self::error('WRITE_FAILED', 'The ' . $t['slug'] . ' part could not be saved.');
            }
            clean_post_cache($id);
            return $id;
        }
        return self::create_part_copy($t, $markup);
    }

    /**
     * The customized copy WordPress's site editor makes on a part's first
     * save: a published wp_template_part of the active theme, in its area.
     */
    private static function create_part_copy(array $t, string $markup): int {
        $id = wp_insert_post(wp_slash([
            'post_type' => 'wp_template_part',
            'post_status' => 'publish',
            'post_name' => $t['slug'],
            'post_title' => $t['title'],
            'post_content' => $markup,
        ]), true);
        if (is_wp_error($id) || (int) $id <= 0) {
            throw self::error('WRITE_FAILED', 'The ' . $t['slug'] . ' part could not be saved' . (is_wp_error($id) ? ': ' . wp_strip_all_tags($id->get_error_message()) : '.'));
        }
        // Terms set directly: tax_input is skipped for a user who cannot assign terms.
        wp_set_object_terms((int) $id, get_stylesheet(), 'wp_theme');
        wp_set_object_terms((int) $id, $t['area'] !== '' ? $t['area'] : 'uncategorized', 'wp_template_part_area');
        return (int) $id;
    }

    /**
     * The new blocks' markup, cleaned like a designed page: the same
     * allowlist (block attributes through WordPress's block-aware kses when
     * it has it), styles kept apart and put back, no script.
     */
    public static function clean(string $markup): string {
        $styles = [];
        $markup = preg_replace_callback('/<style([^>]*)>(.*?)<\/style>/si', function ($m) use (&$styles) {
            $css = preg_replace(['/<\/style/i', '/<script/i', '/expression\s*\(/i', '/url\s*\(\s*["\']?\s*javascript:/i'], ['', '', '', 'url('], $m[2]);
            $key = '<!--WM_STYLE_' . count($styles) . '-->';
            $styles[$key] = '<style' . $m[1] . '>' . $css . '</style>';
            return $key;
        }, $markup);
        $markup = preg_replace('/<script\b[^>]*>.*?<\/script>/si', '', $markup);
        $allowed = (new WebMaven_WordPress_Commands())->designed_allowed_html();
        $markup = function_exists('filter_block_content') ? filter_block_content($markup, $allowed) : wp_kses($markup, $allowed);
        return strtr($markup, $styles);
    }

    /**
     * The markup a write would leave (checked against what was read,
     * spliced, cleaned): what wm_blocks_write saves and what a preview
     * stages, so a preview shows exactly what the publish writes.
     */
    private static function new_markup(array $params, array $t): string {
        self::check_sha($params, $t['raw'], self::describe($t));
        // A page a page builder renders shows its builder's data, never these blocks.
        if ($t['kind'] === 'post' && !array_key_exists('restore', $params) && class_exists('WebMaven_Cap_Builders')) {
            $builder = WebMaven_Cap_Builders::builder($t['post']->ID);
            if ($builder !== null) {
                throw self::error('VALIDATION', 'This page is built with ' . ($builder === 'elementor' ? 'Elementor' : 'Divi') . ': WPMaven changes its words and pictures only, never its sections.');
            }
        }
        if (array_key_exists('restore', $params)) {
            // An undo: the markup the site held before, written back as it was.
            if (!is_string($params['restore'])) {
                throw self::error('VALIDATION', 'restore is the markup to write back.');
            }
            $new = $params['restore'];
        } else {
            $replace = $params['replace'] ?? [];
            $insert = $params['insert'] ?? [];
            if (!is_array($replace) || !is_array($insert) || (!$replace && !$insert)) {
                throw self::error('VALIDATION', 'A write replaces or inserts blocks.');
            }
            foreach ($replace as $i => $markup) {
                $replace[$i] = is_string($markup) ? self::clean($markup) : $markup;
            }
            foreach ($insert as $i => $ins) {
                if (is_array($ins) && is_string($ins['markup'] ?? null)) {
                    $insert[$i]['markup'] = self::clean($ins['markup']);
                }
            }
            $new = WebMaven_Block_Tree::splice($t['markup'], $replace, $insert);
        }
        if (strlen($new) > self::MAX_MARKUP_BYTES) {
            throw self::error('VALIDATION', 'The new content is larger than 3 MB.');
        }
        // The result must still read as blocks the way it was planned.
        WebMaven_Block_Tree::tree($new);
        return $new;
    }

    /**
     * A staged block target for a preview: {kind, post_id?, slug?, navigation_id?, markup}.
     * Nothing is written.
     */
    public static function staged_target(array $entry): array {
        $t = self::target($entry);
        $markup = self::new_markup($entry, $t);
        $out = ['kind' => $t['kind'], 'markup' => $markup];
        if ($t['kind'] === 'part') {
            $out['slug'] = $t['slug'];
        } elseif ($t['kind'] === 'navigation') {
            $out['navigation_id'] = (int) $t['post']->ID;
        } else {
            $out['post_id'] = (int) $t['post']->ID;
        }
        return $out;
    }

    /** What WordPress shows for a navigation block without ref: its id, or 0. */
    public static function fallback_navigation_id(): int {
        $post = self::fallback_navigation();
        return $post ? (int) $post->ID : 0;
    }

    /**
     * Staged global styles: {settings, styles} as the user layer would hold
     * them after the write.
     */
    public static function staged_styles($raw) {
        if ($raw === null) {
            return null;
        }
        $data = is_array($raw) ? ($raw['user_data'] ?? null) : null;
        if (!is_array($data) || array_diff(array_keys($data), ['settings', 'styles'])) {
            throw self::error('VALIDATION', 'styles.user_data holds settings and styles.');
        }
        return [
            'settings' => is_array($data['settings'] ?? null) ? $data['settings'] : [],
            'styles' => is_array($data['styles'] ?? null) ? $data['styles'] : [],
        ];
    }

    // ── wm_part_reset ───────────────────────────────────────────────────────

    /**
     * The theme's file shows again: the part's customized copy goes. The undo
     * of a part's first change deletes it; "Back to your theme's version"
     * (keep) puts it in the trash, so its own undo brings the same post back.
     */
    public static function part_reset($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        $t = self::part_target((string) ($params['part'] ?? ''));
        if (!$t['customized']) {
            return ['reset' => true];
        }
        self::check_sha($params, $t['raw'], self::describe($t));
        $id = (int) $t['post']->ID;
        if (!empty($params['keep'])) {
            if (!wp_trash_post($id)) {
                throw self::error('WRITE_FAILED', 'The ' . $t['slug'] . ' part could not go back to the theme\'s version.');
            }
            clean_post_cache($id);
            return ['reset' => true, 'trashed' => $id];
        }
        $deleted = wp_delete_post($id, true);
        if (!$deleted) {
            throw self::error('WRITE_FAILED', 'The ' . $t['slug'] . ' part could not go back to the theme\'s version.');
        }
        return ['reset' => true];
    }

    /** The undo of "Back to your theme's version": the copy put in the trash is the part again. */
    public static function part_untrash($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        $slug = (string) ($params['part'] ?? '');
        $t = self::part_target($slug);
        if ($t['customized']) {
            throw self::error('DRIFT', 'The ' . $slug . ' part was changed in WordPress since it went back to the theme\'s version.');
        }
        $id = self::positive_int($params['post_id'] ?? null);
        $post = $id > 0 ? get_post($id) : null;
        if (!$post || $post->post_type !== 'wp_template_part' || $post->post_status !== 'trash') {
            throw self::error('NOT_FOUND', 'The ' . $slug . ' part is no longer in the trash.');
        }
        $keep = function () { return 'publish'; };
        add_filter('wp_untrash_post_status', $keep);
        $back = wp_untrash_post($id);
        remove_filter('wp_untrash_post_status', $keep);
        if (!$back) {
            throw self::error('WRITE_FAILED', 'The ' . $slug . ' part could not be brought back.');
        }
        clean_post_cache($id);
        $fresh = get_post($id);
        // WordPress gives a trashed post a "__trashed" slug and puts its own back on the way out; a part is found by its slug.
        if ($fresh && ($fresh->post_name !== $slug || $fresh->post_status !== 'publish')) {
            wp_update_post(wp_slash(['ID' => $id, 'post_name' => $slug, 'post_status' => 'publish']));
            clean_post_cache($id);
            $fresh = get_post($id);
        }
        if (!$fresh || $fresh->post_status !== 'publish' || $fresh->post_name !== $slug) {
            throw self::error('WRITE_FAILED', 'The ' . $slug . ' part could not be brought back.');
        }
        return ['sha256' => self::sha((string) $fresh->post_content), 'post_id' => $id];
    }

    // ── Global styles ───────────────────────────────────────────────────────

    /** The active theme's user styles post as an array, or [] when it has none (never created by a read). */
    private static function styles_post(): array {
        if (!class_exists('WP_Theme_JSON_Resolver')) {
            throw self::error('NOT_BLOCK_THEME', 'This site has no global styles.');
        }
        $post = WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles(wp_get_theme(), false);
        return is_array($post) ? $post : [];
    }

    public static function styles_read($params = [], $step_id = null) {
        $post = self::styles_post();
        $content = (string) ($post['post_content'] ?? '');
        $decoded = $content !== '' ? json_decode($content, true) : [];
        return [
            'theme' => get_stylesheet(),
            'exists' => !empty($post['ID']),
            'post_id' => !empty($post['ID']) ? (int) $post['ID'] : null,
            'user_data' => [
                'settings' => (object) (is_array($decoded['settings'] ?? null) ? $decoded['settings'] : []),
                'styles' => (object) (is_array($decoded['styles'] ?? null) ? $decoded['styles'] : []),
            ],
            'sha256' => self::sha($content),
            'font_choices' => self::font_choices(),
        ];
    }

    /**
     * The font families the theme ships in its style variations (the site
     * editor's typography choices) that its active styles do not list, each
     * with its faces as the variation declares them (file:./ sources, which
     * WordPress resolves against the theme).
     */
    public static function font_choices(): array {
        if (!class_exists('WP_Theme_JSON_Resolver') || !method_exists('WP_Theme_JSON_Resolver', 'get_style_variations')) {
            return [];
        }
        $active = [];
        $settings = function_exists('wp_get_global_settings') ? (array) wp_get_global_settings() : [];
        foreach (['theme', 'custom', 'default'] as $origin) {
            foreach ((array) ($settings['typography']['fontFamilies'][$origin] ?? []) as $f) {
                if (is_array($f) && isset($f['slug'])) {
                    $active[(string) $f['slug']] = true;
                }
            }
        }
        $variations = [];
        try {
            $variations = (array) WP_Theme_JSON_Resolver::get_style_variations();
            $method = new ReflectionMethod('WP_Theme_JSON_Resolver', 'get_style_variations');
            if ($method->getNumberOfParameters() > 0) {
                $variations = array_merge($variations, (array) WP_Theme_JSON_Resolver::get_style_variations('typography'));
            }
        } catch (Throwable $e) {
            return [];
        }
        $out = [];
        foreach ($variations as $v) {
            foreach ((array) ($v['settings']['typography']['fontFamilies']['theme'] ?? []) as $f) {
                if (!is_array($f) || empty($f['slug']) || empty($f['fontFamily']) || isset($active[(string) $f['slug']]) || isset($out[(string) $f['slug']])) {
                    continue;
                }
                $out[(string) $f['slug']] = array_intersect_key($f, array_flip(['slug', 'name', 'fontFamily', 'fontFace']));
            }
        }
        return array_values($out);
    }

    public static function styles_write($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        $data = $params['user_data'] ?? null;
        if (!is_array($data) || array_diff(array_keys($data), ['settings', 'styles'])) {
            throw self::error('VALIDATION', 'user_data holds settings and styles.');
        }
        $post = self::styles_post();
        self::check_sha($params, (string) ($post['post_content'] ?? ''), 'The site\'s styles');
        $created = false;
        if (empty($post['ID'])) {
            // Made the way WordPress makes it on the first styles change (with the theme term).
            $post = WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles(wp_get_theme(), true);
            if (empty($post['ID'])) {
                throw self::error('WRITE_FAILED', 'The site\'s styles could not be created.');
            }
            $created = true;
        }
        $json = [
            'version' => class_exists('WP_Theme_JSON') ? WP_Theme_JSON::LATEST_SCHEMA : 3,
            'isGlobalStylesUserThemeJSON' => true,
        ];
        if (!empty($data['settings'])) {
            $json['settings'] = $data['settings'];
        }
        if (!empty($data['styles'])) {
            $json['styles'] = $data['styles'];
        }
        $saved = wp_update_post(wp_slash(['ID' => (int) $post['ID'], 'post_content' => wp_json_encode($json)]), true);
        if (is_wp_error($saved) || !$saved) {
            throw self::error('WRITE_FAILED', 'The site\'s styles could not be saved.');
        }
        self::clean_styles_cache((int) $post['ID']);
        $fresh = get_post((int) $post['ID']);
        return ['sha256' => self::sha((string) ($fresh ? $fresh->post_content : '')), 'created' => $created, 'post_id' => (int) $post['ID']];
    }

    /** The undo of the first styles change: the user styles post goes. */
    public static function styles_reset($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        $post = self::styles_post();
        if (empty($post['ID'])) {
            return ['reset' => true];
        }
        self::check_sha($params, (string) ($post['post_content'] ?? ''), 'The site\'s styles');
        if (!wp_delete_post((int) $post['ID'], true)) {
            throw self::error('WRITE_FAILED', 'The site\'s styles could not go back to the theme\'s.');
        }
        self::clean_styles_cache((int) $post['ID']);
        return ['reset' => true];
    }

    private static function clean_styles_cache(int $post_id) {
        clean_post_cache($post_id);
        if (class_exists('WP_Theme_JSON_Resolver')) {
            WP_Theme_JSON_Resolver::clean_cached_data();
        }
        if (function_exists('wp_clean_theme_json_cache')) {
            wp_clean_theme_json_cache();
        }
    }

    // ── Navigation ──────────────────────────────────────────────────────────

    /**
     * Before the first change to a block theme's header navigation: the
     * navigation block of the part gets a `ref` to the navigation post it
     * shows (WordPress's fallback, the most recently published one, or a new
     * one when there is none), and a page list in that post becomes links, so
     * a change is the owner's menu and never every visitor's fallback. A
     * navigation block that holds its own links is "inline": its links live
     * in the part.
     */
    public static function navigation_claim($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        $slug = is_string($params['part'] ?? null) && $params['part'] !== '' ? $params['part'] : 'header';
        $index = self::nav_index($params);
        $t = self::part_target($slug);
        $nav = self::nth_navigation($t['markup'], $index);
        if ($nav === null) {
            throw self::error('NOT_FOUND', 'The ' . $slug . ' part has no navigation.');
        }
        $part = ['slug' => $slug, 'sha256_before' => self::sha($t['raw']), 'sha256' => self::sha($t['raw']), 'created' => false];
        if (!empty($nav['attrs']['ref'])) {
            return ['navigation_id' => (int) $nav['attrs']['ref'], 'inline' => false, 'claimed' => false, 'created_navigation' => false, 'navigation_before' => null, 'part' => $part];
        }
        self::check_sha($params, $t['raw'], self::describe($t));

        $created_navigation = false;
        $inner_end = $nav['end'];
        if (!$nav['void']) {
            // Links written in the part (the default theme's footer): they become a navigation post of their own.
            $inner = self::inner_of_navigation($t['markup'], $nav);
            $inner_end = $nav['end'] + strlen($inner);
            if (!preg_match('/<!--\s+\/wp:navigation\s+-->/', $t['markup'], $close, PREG_OFFSET_CAPTURE, $inner_end) || $close[0][1] !== $inner_end) {
                throw self::error('WRITE_FAILED', 'The ' . $slug . ' menu could not be read.');
            }
            $inner_end += strlen($close[0][0]);
            $title = ucfirst($slug) . ' navigation' . ($index > 0 ? ' ' . ($index + 1) : '');
            $before = null;
            $nav_id = wp_insert_post(wp_slash([
                'post_type' => 'wp_navigation',
                'post_status' => 'publish',
                'post_title' => $title,
                'post_content' => trim($inner),
            ]), true);
            if (is_wp_error($nav_id) || (int) $nav_id <= 0) {
                throw self::error('WRITE_FAILED', 'The navigation could not be made.');
            }
            $nav_id = (int) $nav_id;
            $created_navigation = true;
        } elseif ($existing = self::fallback_navigation()) {
            $nav_id = (int) $existing->ID;
            $before = (string) $existing->post_content;
        } else {
            $before = null;
            $nav_id = wp_insert_post(wp_slash([
                'post_type' => 'wp_navigation',
                'post_status' => 'publish',
                'post_title' => 'Header navigation',
                'post_content' => '<!-- wp:page-list /-->',
            ]), true);
            if (is_wp_error($nav_id) || (int) $nav_id <= 0) {
                throw self::error('WRITE_FAILED', 'The navigation could not be made.');
            }
            $nav_id = (int) $nav_id;
            $created_navigation = true;
        }
        $content = (string) get_post($nav_id)->post_content;
        $links = self::expand_page_list($content);
        if ($links !== $content) {
            $saved = wp_update_post(wp_slash(['ID' => $nav_id, 'post_content' => $links]), true);
            if (is_wp_error($saved) || !$saved) {
                throw self::error('WRITE_FAILED', 'The navigation could not be saved.');
            }
        }

        $attrs = $nav['attrs'];
        $attrs['ref'] = $nav_id;
        $markup = substr($t['markup'], 0, $nav['start']) . '<!-- wp:navigation ' . serialize_block_attributes($attrs) . ' /-->' . substr($t['markup'], $inner_end);
        if ($t['customized']) {
            $saved = wp_update_post(wp_slash(['ID' => (int) $t['post']->ID, 'post_content' => $markup]), true);
            if (is_wp_error($saved) || !$saved) {
                throw self::error('WRITE_FAILED', 'The ' . $slug . ' part could not be saved.');
            }
            $part_id = (int) $t['post']->ID;
        } else {
            $part_id = self::create_part_copy($t, $markup);
            $part['created'] = true;
        }
        clean_post_cache($part_id);
        clean_post_cache($nav_id);
        $part['sha256'] = self::sha((string) get_post($part_id)->post_content);
        return [
            'navigation_id' => $nav_id,
            'inline' => false,
            'claimed' => true,
            'created_navigation' => $created_navigation,
            'navigation_before' => $before,
            'navigation_sha256' => self::sha((string) get_post($nav_id)->post_content),
            'part' => $part,
        ];
    }

    /** The undo of a claim that made a navigation post: it goes. */
    public static function navigation_delete($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        $t = self::target(['navigation_id' => $params['navigation_id'] ?? null]);
        self::check_sha($params, $t['raw'], 'The navigation');
        if (!wp_delete_post((int) $t['post']->ID, true)) {
            throw self::error('WRITE_FAILED', 'The navigation could not be removed.');
        }
        return ['deleted' => true];
    }

    /**
     * The links a part's navigation shows, read only: the navigation post of
     * its ref, else the one WordPress falls back to, a page list given as the
     * links wm_navigation_claim would write (the claim, made at publish, writes
     * exactly these); inline links are the navigation block's own, in the part.
     */
    public static function navigation_read($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        if (($params['all'] ?? false) === true) {
            return ['navigations' => self::all_navigations()];
        }
        $slug = is_string($params['part'] ?? null) && $params['part'] !== '' ? $params['part'] : 'header';
        $index = self::nav_index($params);
        $t = self::part_target($slug);
        $count = count(self::navigations($t['markup']));
        $nav = self::nth_navigation($t['markup'], $index);
        if ($nav === null) {
            throw self::error('NOT_FOUND', 'The ' . $slug . ' part has no navigation.');
        }
        $part = ['slug' => $slug, 'sha256' => self::sha($t['raw']), 'customized' => $t['customized']];
        if (!$nav['void'] && empty($nav['attrs']['ref'])) {
            $inner = self::inner_of_navigation($t['markup'], $nav);
            return ['navigation_id' => null, 'claimed' => false, 'inline' => true, 'markup' => $inner, 'sha256' => self::sha($t['raw']), 'count' => $count, 'part' => $part];
        }
        $post = null;
        $claimed = !empty($nav['attrs']['ref']);
        if ($claimed) {
            $post = get_post((int) $nav['attrs']['ref']);
            if (!$post || $post->post_type !== 'wp_navigation' || $post->post_status !== 'publish') {
                $post = null;
            }
        } else {
            $post = self::fallback_navigation();
        }
        $content = $post ? (string) $post->post_content : '<!-- wp:page-list /-->';
        return [
            'navigation_id' => $post ? (int) $post->ID : null,
            'claimed' => $claimed && $post !== null,
            'inline' => false,
            'markup' => self::expand_page_list($content),
            'sha256' => self::sha($post ? $content : ''),
            'count' => $count,
            'part' => $part,
        ];
    }

    /** Every navigation of the header (its first) and the footer (up to 3), as navigation_read answers each. */
    private static function all_navigations(): array {
        $out = [];
        foreach (['header' => 1, 'footer' => 3] as $slug => $max) {
            try {
                $t = self::part_target($slug);
            } catch (Exception $e) {
                continue;
            }
            $count = min($max, count(self::navigations($t['markup'])));
            for ($i = 0; $i < $count; $i++) {
                try {
                    $out[] = ['slug' => $slug, 'index' => $i, 'read' => self::navigation_read(['part' => $slug, 'index' => $i])];
                } catch (Exception $e) {
                    continue;
                }
            }
        }
        return $out;
    }

    /** What a navigation block that is not void holds between its opener and its closer. */
    private static function inner_of_navigation(string $markup, array $nav): string {
        $depth = 0;
        $from = $nav['end'];
        if (!preg_match_all(WebMaven_Block_Tree::DELIMITER, $markup, $m, PREG_SET_ORDER | PREG_OFFSET_CAPTURE, $from)) {
            return '';
        }
        foreach ($m as $tok) {
            $is_closer = isset($tok['closer']) && $tok['closer'][1] >= 0 && $tok['closer'][0] === '/';
            $is_void = isset($tok['void']) && $tok['void'][1] >= 0 && $tok['void'][0] === '/';
            $ns = isset($tok['namespace']) && $tok['namespace'][1] >= 0 ? $tok['namespace'][0] : 'core/';
            $name = $ns . $tok['name'][0];
            if ($is_closer) {
                if ($depth === 0 && $name === 'core/navigation') {
                    return substr($markup, $from, $tok[0][1] - $from);
                }
                $depth--;
            } elseif (!$is_void) {
                $depth++;
            }
        }
        return '';
    }

    /** The core/navigation blocks of a markup, in document order: [{start, end, attrs, void}] (end: the opener's end). */
    private static function navigations(string $markup): array {
        if (!preg_match_all(WebMaven_Block_Tree::DELIMITER, $markup, $m, PREG_SET_ORDER | PREG_OFFSET_CAPTURE)) {
            return [];
        }
        $out = [];
        foreach ($m as $tok) {
            $is_closer = isset($tok['closer']) && $tok['closer'][1] >= 0 && $tok['closer'][0] === '/';
            $ns = isset($tok['namespace']) && $tok['namespace'][1] >= 0 ? $tok['namespace'][0] : 'core/';
            if ($is_closer || $ns . $tok['name'][0] !== 'core/navigation') {
                continue;
            }
            $raw = isset($tok['attrs']) && $tok['attrs'][1] >= 0 ? $tok['attrs'][0] : '';
            $attrs = $raw !== '' ? json_decode($raw, true) : [];
            $void = isset($tok['void']) && $tok['void'][1] >= 0 && $tok['void'][0] === '/';
            $out[] = ['start' => $tok[0][1], 'end' => $tok[0][1] + strlen($tok[0][0]), 'attrs' => is_array($attrs) ? $attrs : [], 'void' => $void];
        }
        return $out;
    }

    /** The index-th core/navigation block of a markup (0: the first), or null. */
    private static function nth_navigation(string $markup, int $index) {
        $all = self::navigations($markup);
        return $all[$index] ?? null;
    }

    /** The params' navigation index: 0 to 9. */
    private static function nav_index(array $params): int {
        $i = $params['index'] ?? 0;
        if (!is_int($i) && !(is_string($i) && ctype_digit($i))) {
            throw self::error('VALIDATION', 'index is a number from 0.');
        }
        $i = (int) $i;
        if ($i < 0 || $i > 9) {
            throw self::error('VALIDATION', 'index is a number from 0 to 9.');
        }
        return $i;
    }

    // ── wm_blocks_page_create / wm_blocks_page_delete ───────────────────────

    /**
     * A page of blocks the edit engine adds on a site WPMaven did not design
     * (a landing page). parent (1.8.0): the page it goes under, when that is
     * a page of the site not in the trash; else the top level.
     */
    public static function page_create($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        $title = trim(wp_strip_all_tags((string) ($params['title'] ?? '')));
        if ($title === '' || strlen($title) > 200) {
            throw self::error('VALIDATION', 'The new page needs a title of at most 200 characters.');
        }
        $markup = $params['markup'] ?? null;
        if (!is_string($markup) || trim($markup) === '' || strlen($markup) > 1048576) {
            throw self::error('VALIDATION', 'The new page\'s blocks are missing or larger than 1 MB.');
        }
        $status = $params['status'] ?? 'publish';
        if (!in_array($status, ['publish', 'draft'], true)) {
            throw self::error('VALIDATION', 'status must be publish or draft.');
        }
        $slug = sanitize_title(is_string($params['slug'] ?? null) && trim($params['slug']) !== '' ? $params['slug'] : $title);
        $parent_id = is_numeric($params['parent'] ?? null) ? (int) $params['parent'] : 0;
        $parent = $parent_id > 0 ? get_post($parent_id) : null;
        $id = wp_insert_post(wp_slash([
            'post_type' => 'page',
            'post_status' => $status,
            'post_title' => $title,
            'post_name' => $slug,
            'post_content' => self::clean($markup),
            'post_parent' => $parent && $parent->post_type === 'page' && $parent->post_status !== 'trash' ? $parent_id : 0,
        ]), true);
        if (is_wp_error($id) || (int) $id <= 0) {
            throw self::error('WRITE_FAILED', 'The page "' . $title . '" could not be created.');
        }
        $id = (int) $id;
        update_post_meta($id, '_wm_block_page', 1);
        clean_post_cache($id);
        $post = get_post($id);
        return ['post_id' => $id, 'slug' => (string) $post->post_name, 'link' => (string) get_permalink($id), 'sha256' => self::sha((string) $post->post_content)];
    }

    /** The undo of wm_blocks_page_create: the page goes, unless it changed since. */
    public static function page_delete($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        $id = (int) ($params['post_id'] ?? 0);
        $post = $id > 0 ? get_post($id) : null;
        if (!$post || $post->post_type !== 'page') {
            return ['deleted' => true];
        }
        if ((int) get_post_meta($id, '_wm_block_page', true) !== 1) {
            throw self::error('VALIDATION', 'WPMaven did not add this page.');
        }
        self::check_sha($params, (string) $post->post_content, 'The page "' . wp_strip_all_tags((string) $post->post_title) . '"');
        if (!wp_delete_post($id, true)) {
            throw self::error('WRITE_FAILED', 'The page could not be removed.');
        }
        return ['deleted' => true];
    }

    // ── wm_link_targets ─────────────────────────────────────────────────────

    /**
     * What a menu link may go to besides pages and posts, and the address of
     * each given link (MenuLink: page, post, product, term, shop) as
     * WordPress gives it; null for one that is not found or not published.
     */
    public static function link_targets($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        $shop = null;
        if (function_exists('wc_get_page_id')) {
            $shop_id = (int) wc_get_page_id('shop');
            $page = $shop_id > 0 ? get_post($shop_id) : null;
            if ($page && $page->post_status === 'publish') {
                $shop = ['page_id' => $shop_id, 'link' => (string) get_permalink($page)];
            }
        }
        $categories = [];
        foreach (['category', 'product_cat'] as $taxonomy) {
            if (!taxonomy_exists($taxonomy)) {
                continue;
            }
            $terms = get_terms(['taxonomy' => $taxonomy, 'hide_empty' => true, 'number' => 100]);
            if (is_wp_error($terms)) {
                continue;
            }
            foreach ($terms as $term) {
                if ($term->slug === 'uncategorized') {
                    continue;
                }
                $link = get_term_link((int) $term->term_id, $taxonomy);
                $categories[] = ['taxonomy' => $taxonomy, 'id' => (int) $term->term_id, 'name' => html_entity_decode((string) $term->name, ENT_QUOTES), 'link' => is_wp_error($link) ? '' : (string) $link];
            }
        }
        $resolved = [];
        $links = is_array($params['links'] ?? null) ? array_slice($params['links'], 0, 60) : [];
        foreach ($links as $link) {
            $resolved[] = self::resolve_link(is_array($link) ? $link : [], $shop);
        }
        return ['shop' => $shop, 'categories' => $categories, 'resolved' => $resolved];
    }

    /** A menu link's address and name as a navigation link block stores them, or null. */
    private static function resolve_link(array $link, $shop) {
        $kind = $link['kind'] ?? '';
        if (in_array($kind, ['page', 'post', 'product'], true)) {
            $id = (int) ($link[$kind . 'Id'] ?? 0);
            $post = $id > 0 ? get_post($id) : null;
            if (!$post || $post->post_type !== $kind || $post->post_status !== 'publish') {
                return null;
            }
            return ['url' => (string) get_permalink($post), 'label' => wp_strip_all_tags((string) $post->post_title), 'type' => $kind, 'id' => $id, 'kind' => 'post-type'];
        }
        if ($kind === 'term') {
            $taxonomy = $link['taxonomy'] ?? '';
            $term_id = (int) ($link['termId'] ?? 0);
            if (!in_array($taxonomy, ['category', 'product_cat'], true) || $term_id <= 0) {
                return null;
            }
            $term = get_term($term_id, $taxonomy);
            if (!$term || is_wp_error($term)) {
                return null;
            }
            $url = get_term_link($term_id, $taxonomy);
            if (is_wp_error($url)) {
                return null;
            }
            return ['url' => (string) $url, 'label' => html_entity_decode((string) $term->name, ENT_QUOTES), 'type' => $taxonomy, 'id' => $term_id, 'kind' => 'taxonomy'];
        }
        if ($kind === 'shop') {
            if (!$shop) {
                return null;
            }
            return ['url' => $shop['link'], 'label' => wp_strip_all_tags((string) get_the_title($shop['page_id'])), 'type' => 'page', 'id' => $shop['page_id'], 'kind' => 'post-type'];
        }
        return null;
    }

    /**
     * What WordPress shows for a navigation block without ref: the most
     * recently published navigation (the query of
     * WP_Navigation_Fallback::get_most_recently_published_navigation, which
     * is private).
     */
    private static function fallback_navigation() {
        $posts = get_posts([
            'post_type' => 'wp_navigation',
            'post_status' => 'publish',
            'posts_per_page' => 1,
            'numberposts' => 1,
            'orderby' => 'date',
            'order' => 'DESC',
            'no_found_rows' => true,
            'update_post_meta_cache' => false,
            'update_post_term_cache' => false,
        ]);
        return $posts ? $posts[0] : null;
    }

    /** A page list replaced by links to the pages it shows (children as submenus); everything else kept. */
    public static function expand_page_list(string $markup): string {
        if (strpos($markup, 'wp:page-list') === false) {
            return $markup;
        }
        $pages = get_pages(['sort_column' => 'menu_order,post_title', 'post_status' => 'publish']);
        $by_parent = [];
        foreach ((array) $pages as $p) {
            $by_parent[(int) $p->post_parent][] = $p;
        }
        $render = function ($parent) use (&$render, $by_parent) {
            $out = '';
            foreach ($by_parent[$parent] ?? [] as $p) {
                $attrs = ['label' => wp_strip_all_tags((string) $p->post_title), 'type' => 'page', 'id' => (int) $p->ID, 'url' => (string) get_permalink($p), 'kind' => 'post-type'];
                if (!empty($by_parent[(int) $p->ID])) {
                    $out .= '<!-- wp:navigation-submenu ' . serialize_block_attributes($attrs) . ' -->' . $render((int) $p->ID) . '<!-- /wp:navigation-submenu -->';
                } else {
                    $out .= '<!-- wp:navigation-link ' . serialize_block_attributes($attrs) . ' /-->';
                }
            }
            return $out;
        };
        $links = $render(0);
        return preg_replace('/<!--\s+wp:page-list(?:\s+\{.*?\})?\s+\/-->|<!--\s+wp:page-list(?:\s+\{.*?\})?\s+-->.*?<!--\s+\/wp:page-list\s+-->/s', $links, $markup, 1);
    }

    // ── wm_design_tokens_read ───────────────────────────────────────────────

    /**
     * The theme's own design sources, as WordPress and the builders hold
     * them: the merged theme.json settings and styles (core, theme, child
     * theme, the owner's global styles, a classic theme's editor palette),
     * the builder's global settings (Elementor's active kit, Divi's
     * options), the :root values a theme prints from its Customizer, and the
     * names (never values) of the custom properties its stylesheet declares.
     * The api derives the site's tokens from these; measuring is the api's.
     */
    public static function design_tokens_read($params = [], $step_id = null) {
        $theme = wp_get_theme();
        $stylesheet_dir = get_stylesheet_directory();
        $style_css = is_readable($stylesheet_dir . '/style.css') ? (string) file_get_contents($stylesheet_dir . '/style.css') : '';
        $builder = self::builder_settings();
        return [
            'theme' => [
                'slug' => get_stylesheet(),
                'template' => get_template(),
                'name' => (string) $theme->get('Name'),
                'version' => (string) $theme->get('Version'),
                'block_theme' => function_exists('wp_is_block_theme') && wp_is_block_theme(),
                'has_theme_json' => function_exists('wp_theme_has_theme_json') && wp_theme_has_theme_json(),
            ],
            'settings' => self::token_settings(function_exists('wp_get_global_settings') ? (array) wp_get_global_settings() : []),
            'styles' => self::token_styles(function_exists('wp_get_global_styles') ? (array) wp_get_global_styles() : []),
            'builder' => $builder,
            // Whether the owner set colours in WordPress's own styles (a builder kit's accent gives way to them).
            'user_palette' => self::user_palette(),
            'root_values' => self::root_values(),
            'custom_properties' => self::custom_property_names($style_css),
            'shas' => self::design_shas(),
        ];
    }

    /**
     * The shas of what the site's tokens are derived from: the stylesheet,
     * theme.json (theme and parent), the owner's global styles, the
     * builder's kit and the theme's Customizer settings (the :root values a
     * classic theme prints). Cheap: files and options, no merging.
     */
    public static function design_shas(): array {
        $stylesheet_dir = get_stylesheet_directory();
        $template_dir = get_template_directory();
        $style_css = is_readable($stylesheet_dir . '/style.css') ? (string) file_get_contents($stylesheet_dir . '/style.css') : '';
        $theme_json = '';
        foreach (array_unique([$template_dir, $stylesheet_dir]) as $dir) {
            if (is_readable($dir . '/theme.json')) {
                $theme_json .= (string) file_get_contents($dir . '/theme.json');
            }
        }
        $styles_post = self::styles_post_or_empty();
        $mods = function_exists('get_theme_mods') ? get_theme_mods() : [];
        unset($mods['nav_menu_locations'], $mods['custom_css_post_id'], $mods['sidebars_widgets']);
        return [
            'stylesheet' => hash('sha256', get_stylesheet() . "\n" . $style_css),
            'theme_json' => hash('sha256', $theme_json),
            'global_styles' => hash('sha256', (string) ($styles_post['post_content'] ?? '')),
            'builder' => hash('sha256', (string) wp_json_encode(self::builder_settings())),
            'mods' => hash('sha256', (string) wp_json_encode(is_array($mods) ? $mods : [])),
        ];
    }

    /** The block styles the tokens read (buttons, navigation, a group's section styles, headings, text). */
    const TOKEN_BLOCKS = ['core/button', 'core/navigation', 'core/group', 'core/heading', 'core/paragraph', 'core/site-title'];

    /** The merged settings the tokens read: presets, the layout widths, shadows, borders. */
    private static function token_settings(array $s): array {
        $out = [];
        if (isset($s['color']['palette'])) {
            $out['color']['palette'] = $s['color']['palette'];
        }
        foreach (['fontFamilies', 'fontSizes'] as $k) {
            if (isset($s['typography'][$k])) {
                $out['typography'][$k] = $s['typography'][$k];
            }
        }
        if (isset($s['spacing']['spacingSizes'])) {
            $out['spacing']['spacingSizes'] = $s['spacing']['spacingSizes'];
        }
        if (isset($s['layout'])) {
            $out['layout'] = array_intersect_key((array) $s['layout'], array_flip(['contentSize', 'wideSize']));
        }
        if (isset($s['shadow']['presets'])) {
            $out['shadow']['presets'] = $s['shadow']['presets'];
        }
        return $out;
    }

    /** The merged styles the tokens read: the root, the elements and a few blocks. */
    private static function token_styles(array $s): array {
        $out = array_intersect_key($s, array_flip(['color', 'typography', 'spacing', 'border', 'shadow', 'elements']));
        foreach (self::TOKEN_BLOCKS as $name) {
            if (isset($s['blocks'][$name])) {
                $out['blocks'][$name] = $s['blocks'][$name];
            }
        }
        return $out;
    }

    private static function styles_post_or_empty(): array {
        try {
            return self::styles_post();
        } catch (Exception $e) {
            return [];
        }
    }

    /** Whether the owner's global styles hold a colour palette of their own. */
    private static function user_palette(): bool {
        if (!class_exists('WP_Theme_JSON_Resolver') || !(function_exists('wp_theme_has_theme_json') && wp_theme_has_theme_json())) {
            return false;
        }
        try {
            $raw = WP_Theme_JSON_Resolver::get_user_data()->get_raw_data();
        } catch (Throwable $e) {
            return false;
        }
        $palette = $raw['settings']['color']['palette'] ?? null;
        return is_array($palette) && $palette !== [];
    }

    /** Elementor's active kit and Divi's theme options, or null for each. */
    private static function builder_settings(): array {
        $out = ['elementor' => null, 'divi' => null];
        $kit_id = (int) get_option('elementor_active_kit');
        if ($kit_id > 0 && defined('ELEMENTOR_VERSION')) {
            $s = get_post_meta($kit_id, '_elementor_page_settings', true);
            $s = is_array($s) ? $s : [];
            $pick = function ($list, array $keys) {
                $rows = [];
                foreach ((array) $list as $row) {
                    if (!is_array($row) || !isset($row['_id'])) {
                        continue;
                    }
                    $rows[] = array_intersect_key($row, array_flip($keys));
                }
                return $rows;
            };
            $type_keys = ['_id', 'title', 'typography_font_family', 'typography_font_weight', 'typography_font_size'];
            $out['elementor'] = [
                'kit' => $kit_id,
                'version' => (string) ELEMENTOR_VERSION,
                'system_colors' => $pick($s['system_colors'] ?? [], ['_id', 'title', 'color']),
                'custom_colors' => $pick($s['custom_colors'] ?? [], ['_id', 'title', 'color']),
                'system_typography' => $pick($s['system_typography'] ?? [], $type_keys),
                'custom_typography' => $pick($s['custom_typography'] ?? [], $type_keys),
            ];
        }
        if (get_template() === 'Divi' || get_template() === 'divi') {
            $d = get_option('et_divi');
            $d = is_array($d) ? $d : [];
            $keys = ['accent_color', 'font_color', 'header_color', 'link_color', 'body_font', 'heading_font', 'buttons_font', 'primary_nav_bg', 'footer_bg'];
            $out['divi'] = array_intersect_key($d, array_flip($keys));
        }
        return $out;
    }

    /**
     * The custom properties a theme prints on :root from its settings (a
     * classic theme's Customizer colours, GeneratePress's --accent), read
     * from the inline styles its front end enqueues. [] when it prints none
     * or the front end's styles cannot be gathered here.
     */
    private static function root_values(): array {
        $values = [];
        try {
            if (!did_action('wp_enqueue_scripts')) {
                ob_start();
                do_action('wp_enqueue_scripts');
                ob_end_clean();
            }
            $styles = function_exists('wp_styles') ? wp_styles() : null;
            if (!$styles) {
                return [];
            }
            foreach ((array) $styles->registered as $handle => $dep) {
                // WordPress's own (global styles, block supports) repeat theme.json: the theme's only.
                if (preg_match('/^(global-styles|wp-|core-)/', (string) $handle)) {
                    continue;
                }
                $inline = $dep->extra['after'] ?? [];
                foreach ((array) $inline as $css) {
                    if (!is_string($css) || !preg_match_all('/:root\s*\{([^}]*)\}/', $css, $blocks)) {
                        continue;
                    }
                    foreach ($blocks[1] as $body) {
                        if (preg_match_all('/(--[A-Za-z0-9_-]{1,80})\s*:\s*([^;]{1,200})/', $body, $pairs, PREG_SET_ORDER)) {
                            foreach ($pairs as $p) {
                                if (strpos($p[1], '--wp-') === 0) {
                                    continue;
                                }
                                if (count($values) >= self::MAX_PROPERTIES) {
                                    break 4;
                                }
                                $values[$p[1]] = ['value' => trim($p[2]), 'handle' => (string) $handle];
                            }
                        }
                    }
                }
            }
        } catch (Throwable $e) {
            return [];
        }
        return $values;
    }

    /** The custom property names a stylesheet declares (names only: a value there is not trusted as the site's). */
    public static function custom_property_names(string $css): array {
        if (!preg_match_all('/(--[A-Za-z0-9_-]{1,80})\s*:/', $css, $m)) {
            return [];
        }
        return array_slice(array_values(array_unique($m[1])), 0, self::MAX_PROPERTIES);
    }
}
