<?php
/**
 * AI discoverability: a dynamic, cached /llms.txt plus an enhanced robots.txt,
 * so the sites we generate are easy for AI agents to read (the "robots.txt for
 * LLMs"). The file is built from LIVE content on each cache miss, so it stays
 * current as the owner edits — we manage these sites long-term. No new LLM call:
 * the brand summary is seeded into the `webmaven_llms_summary` option at
 * generation time, and per-link blurbs reuse each page's existing meta
 * description (the same key create_page writes).
 *
 * Serving uses template_redirect + exit (mirrors the editor's preview pattern),
 * so there is no rewrite rule to flush and our handler naturally takes
 * precedence over any other plugin that also serves /llms.txt.
 */

defined('ABSPATH') || exit;

require_once __DIR__ . '/class-webmaven-log.php';

class WebMaven_AI_Discovery {

    const CACHE_KEY = 'webmaven_llms_txt';

    /** Legal/utility slugs: surfaced under "Optional" or skipped, never "Main". */
    private $optional_slugs = [
        'privacy-policy', 'privacy', 'terms', 'terms-conditions', 'terms-and-conditions',
        'refund_returns', 'refund-policy', 'cookie-policy', 'disclaimer',
    ];

    /** WooCommerce functional pages: never listed (not content). */
    private $functional_slugs = ['cart', 'checkout', 'my-account'];

    public function __construct() {
        add_action('template_redirect', [$this, 'maybe_serve_llms_txt']);
        add_filter('robots_txt', [$this, 'filter_robots_txt'], 20, 1);

        // Bust the cached /llms.txt when content, menus, or identity change.
        $bust = [$this, 'flush_cache'];
        add_action('save_post', $bust);
        add_action('deleted_post', $bust);
        add_action('wp_update_nav_menu', $bust);
        add_action('switch_theme', $bust);
        // update_option() on an option the site never stored adds it instead,
        // which fires add_option_{name} and not update_option_{name}: the
        // summary's first write (Manage my site, on a site WPMaven did not
        // build) has to clear the file too.
        foreach (['blogname', 'blogdescription', 'webmaven_llms_summary'] as $option) {
            add_action('update_option_' . $option, $bust);
            add_action('add_option_' . $option, $bust);
            add_action('delete_option_' . $option, $bust);
        }
    }

    public function flush_cache() {
        delete_transient(self::CACHE_KEY);
    }

    /** Serve GET /llms.txt as text/plain, exiting before the theme renders. */
    public function maybe_serve_llms_txt() {
        $path = wp_parse_url(sanitize_text_field(wp_unslash((string) ($_SERVER['REQUEST_URI'] ?? ''))), PHP_URL_PATH);
        if (untrailingslashit((string) $path) !== '/llms.txt') {
            return;
        }
        $body = get_transient(self::CACHE_KEY);
        if ($body === false) {
            $body = $this->build();
            set_transient(self::CACHE_KEY, $body, DAY_IN_SECONDS);
        }
        if (!headers_sent()) {
            status_header(200);
            header('Content-Type: text/plain; charset=utf-8');
            header('X-Robots-Tag: noindex');
        }
        // A text/plain document (llms.txt), never read as HTML.
        echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
        exit;
    }

    /** Build the llms.txt markdown from live content. Never throws. */
    private function build() {
        try {
            $lines = [];
            $name = get_option('blogname') ?: get_bloginfo('name');
            $lines[] = '# ' . ($this->oneline($name) ?: 'Website');

            $summary = get_option('webmaven_llms_summary');
            if (!$summary) {
                $summary = get_option('blogdescription');
            }
            $summary = $this->oneline($summary);
            if ($summary) {
                $lines[] = '';
                $lines[] = '> ' . $summary;
            }

            // WooCommerce shop/cart/checkout/account pages are excluded from the
            // page lists (the shop is represented by the Products section; the
            // rest are functional). Resolved by ID so it is robust to slug drift.
            $wc_excluded = [];
            if (function_exists('wc_get_page_id')) {
                foreach (['shop', 'cart', 'checkout', 'myaccount'] as $k) {
                    $pid = (int) wc_get_page_id($k);
                    if ($pid > 0) $wc_excluded[$pid] = true;
                }
            }

            // Main pages — prefer the primary menu order, else published pages.
            $main = $this->primary_menu_pages($wc_excluded);
            if (empty($main)) {
                $main = $this->fallback_pages($wc_excluded);
            }
            if (!empty($main)) {
                $lines[] = '';
                $lines[] = '## Main pages';
                foreach ($main as $item) {
                    $lines[] = $this->link_line($item['title'], $item['url'], $item['blurb']);
                }
            }

            // Products (WooCommerce only) — shop link + a few products, never all.
            if (function_exists('wc_get_products') && function_exists('wc_get_page_id')) {
                $products = $this->products_section();
                if (!empty($products)) {
                    $lines[] = '';
                    $lines[] = '## Products';
                    foreach ($products as $l) { $lines[] = $l; }
                }
            }

            // Latest posts.
            $posts = get_posts([
                'post_type' => 'post', 'post_status' => 'publish',
                'numberposts' => 10, 'orderby' => 'date', 'order' => 'DESC',
            ]);
            $post_lines = [];
            foreach ($posts as $p) {
                if ($p->post_name === 'hello-world') continue; // default sample post (also removed at gen time)
                $post_lines[] = $this->link_line(get_the_title($p), get_permalink($p), $this->blurb($p));
            }
            if (!empty($post_lines)) {
                $lines[] = '';
                $lines[] = '## Latest posts';
                foreach ($post_lines as $l) { $lines[] = $l; }
            }

            // Optional — legal pages (privacy/terms/etc.), deduped.
            $opt = [];
            foreach ($this->optional_slugs as $slug) {
                $page = get_page_by_path($slug, OBJECT, 'page');
                if ($page && $page->post_status === 'publish' && empty($opt[$page->ID])) {
                    $opt[$page->ID] = $this->link_line(get_the_title($page), get_permalink($page), '');
                }
            }
            if (!empty($opt)) {
                $lines[] = '';
                $lines[] = '## Optional';
                foreach ($opt as $l) { $lines[] = $l; }
            }

            return implode("\n", $lines) . "\n";
        } catch (\Throwable $e) {
            WebMaven_Log::write('WebMaven: llms.txt build failed: ' . $e->getMessage());
            // Minimal but valid fallback.
            return '# ' . ($this->oneline(get_option('blogname')) ?: 'Website') . "\n";
        }
    }

    /** Top-level page items from the assigned primary menu, in order. */
    private function primary_menu_pages($excluded_ids = []) {
        $locations = get_nav_menu_locations();
        $menu_id = isset($locations['primary']) ? (int) $locations['primary'] : 0;
        if (!$menu_id) return [];
        $items = wp_get_nav_menu_items($menu_id);
        if (empty($items)) return [];
        $out = [];
        foreach ($items as $item) {
            if (!empty($item->menu_item_parent) && (int) $item->menu_item_parent !== 0) continue; // top level only
            $blurb = '';
            if ($item->type === 'post_type' && !empty($item->object_id)) {
                if (!empty($excluded_ids[(int) $item->object_id])) continue;                 // WC shop/cart/checkout/account
                $post = get_post($item->object_id);
                if ($post) {
                    if (in_array($post->post_name, $this->optional_slugs, true)) continue;   // → Optional
                    if (in_array($post->post_name, $this->functional_slugs, true)) continue;  // cart/checkout/account
                    $blurb = $this->blurb($post);
                }
            }
            $out[] = ['title' => $item->title, 'url' => $item->url, 'blurb' => $blurb];
        }
        return $out;
    }

    /** Fallback: published pages by menu_order (minus legal/utility/WC pages). */
    private function fallback_pages($excluded_ids = []) {
        $pages = get_posts([
            'post_type' => 'page', 'post_status' => 'publish',
            'numberposts' => 12, 'orderby' => 'menu_order', 'order' => 'ASC',
        ]);
        $skip = array_merge($this->optional_slugs, $this->functional_slugs, ['sample-page']);
        $out = [];
        foreach ($pages as $p) {
            if (!empty($excluded_ids[(int) $p->ID])) continue;
            if (in_array($p->post_name, $skip, true)) continue;
            $out[] = ['title' => get_the_title($p), 'url' => get_permalink($p), 'blurb' => $this->blurb($p)];
        }
        return $out;
    }

    /** Shop link + up to 8 recent products (never the full catalog). */
    private function products_section() {
        $out = [];
        $shop_id = wc_get_page_id('shop');
        if ($shop_id && $shop_id > 0) {
            $out[] = $this->link_line('Shop', get_permalink($shop_id), 'Browse the full product catalog.');
        }
        $products = wc_get_products([
            'status' => 'publish', 'limit' => 8, 'orderby' => 'date', 'order' => 'DESC',
        ]);
        foreach ($products as $product) {
            $out[] = $this->link_line($product->get_name(), $product->get_permalink(), '');
        }
        return $out;
    }

    /**
     * Per-link blurb: any active SEO plugin's meta description → the keys
     * create_page writes → excerpt → trimmed content. Self-contained so it works
     * on a plain frontend request regardless of which classes are loaded.
     */
    private function blurb($post) {
        $id = is_object($post) ? (int) $post->ID : (int) $post;
        if (!$id) return '';
        $keys = [
            '_yoast_wpseo_metadesc', 'rank_math_description', '_seopress_titles_desc',
            '_aioseo_description', '_webmaven_meta_description', '_meta_description', '_wme_meta_description',
        ];
        foreach ($keys as $k) {
            $v = get_post_meta($id, $k, true);
            if ($v) return $this->oneline($v);
        }
        if (has_excerpt($id)) {
            $ex = $this->oneline(get_the_excerpt($id));
            if ($ex) return $ex;
        }
        $p = get_post($id);
        if ($p && $p->post_content) {
            return $this->oneline(wp_trim_words(wp_strip_all_tags($p->post_content), 25, '…'));
        }
        return '';
    }

    private function link_line($title, $url, $blurb) {
        $title = $this->oneline($title);
        if ($title === '') $title = 'Untitled';
        $line = '- [' . $title . '](' . esc_url_raw($url) . ')';
        if ($blurb !== '') $line .= ': ' . $blurb;
        return $line;
    }

    /** Collapse a string to a single trimmed, entity-decoded line (this is a
     *  plain-text file, so `&#038;` etc. must become real characters). */
    private function oneline($s) {
        $s = wp_strip_all_tags((string) $s);
        $s = html_entity_decode($s, ENT_QUOTES, 'UTF-8');
        $s = preg_replace('/\s+/', ' ', $s);
        return trim((string) $s);
    }

    /**
     * Enhance WordPress's virtual robots.txt: ensure a real Sitemap line exists
     * and advertise /llms.txt. AI crawlers stay allowed (WP's default). Only
     * applies to the virtual robots.txt (no physical file).
     */
    public function filter_robots_txt($output) {
        $extra = '';

        // Ensure a Sitemap line — but only the REAL core sitemap URL, and only
        // if nothing already added one (WP core + Yoast both add their own).
        if (stripos((string) $output, 'sitemap:') === false && function_exists('wp_sitemaps_get_server')) {
            try {
                $server = wp_sitemaps_get_server();
                if ($server && isset($server->index) && method_exists($server->index, 'get_index_url')) {
                    $url = $server->index->get_index_url();
                    if ($url) {
                        $extra .= "\nSitemap: " . $url;
                    }
                }
            } catch (\Throwable $e) {
                // No sitemap line rather than a guessed (possibly 404) URL.
            }
        }

        // Advertise the llms.txt for AI agents (no standard directive exists yet).
        if (stripos((string) $output, 'llms.txt') === false) {
            $extra .= "\n# AI agents: an llms.txt overview is available at " . untrailingslashit(home_url()) . '/llms.txt';
        }

        return rtrim((string) $output) . $extra . "\n";
    }
}
