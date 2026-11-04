<?php
/**
 * Invisible machine-readable AI-content marking (EU AI Act, Article 50).
 *
 * Every post or page the WPMaven agents create is stamped with the
 * `_wme_ai_generated` post meta, the same key the editor already writes on
 * AI-generated images. On singular frontend views of marked content this
 * class emits three machine-readable markers, none of them visible text:
 *
 *   1. <meta name="ai-generated" content="true"> in the document head
 *   2. an invisible <!--wpmaven:ai-generated--> HTML comment after the content
 *   3. a data-ai-generated="true" attribute on the core/post-content wrapper
 *      when a block theme renders the page (skipped silently elsewhere)
 *
 * The marking ships at EVERY tier and is deliberately decoupled from the
 * visible footer badge (see WebMaven_Badge): the badge is a monetization
 * surface, the marking is a compliance duty. Content created before this
 * class existed is covered too, via the legacy `_webmaven_fullhtml` flag
 * that create_post has always written on agent-created content.
 *
 * C2PA / IPTC metadata embedding in generated images is intentionally NOT
 * attempted here: it needs signing infrastructure and is tracked separately.
 */

if (!defined('ABSPATH')) {
    exit;
}

class WebMaven_AI_Marking {

    /** Canonical AI-generated marker, shared with the editor's AI images. */
    const META_KEY = '_wme_ai_generated';

    /** Legacy flag create_post has always set on agent-created content. */
    const LEGACY_META_KEY = '_webmaven_fullhtml';

    /** Invisible machine-readable marker appended after the content. */
    const CONTENT_MARKER = '<!--wpmaven:ai-generated-->';

    /**
     * The same marker on a site under an agency's or a partner's brand
     * (1.2.31): a visitor who opens the page source finds no name of ours.
     */
    const NEUTRAL_CONTENT_MARKER = '<!--ai-generated-->';

    /** The marker this site uses. */
    public static function content_marker() {
        return class_exists('WebMaven_Brand') && !WebMaven_Brand::is_wpmaven()
            ? self::NEUTRAL_CONTENT_MARKER
            : self::CONTENT_MARKER;
    }

    public function __construct() {
        // Frontend pages only (mirrors WebMaven_Analytics).
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }
        add_action('wp_head', [$this, 'print_meta_tag']);
        add_filter('the_content', [$this, 'append_content_marker'], 999);
        add_filter('render_block', [$this, 'add_wrapper_attribute'], 10, 2);
    }

    /**
     * Stamp a post as AI-generated. Called from every plugin-side path where
     * agent-created content lands: create_post / update_post in
     * WebMaven_WordPress_Commands (the webhook and MCP publish path) and the
     * editor's page generator.
     */
    public static function mark_post($post_id) {
        $post_id = (int) $post_id;
        if ($post_id > 0) {
            update_post_meta($post_id, self::META_KEY, 1);
        }
    }

    /** True when the post carries the AI marker (or the legacy flag). */
    public static function is_ai_generated($post_id) {
        $post_id = (int) $post_id;
        if ($post_id <= 0) {
            return false;
        }
        return (bool) get_post_meta($post_id, self::META_KEY, true)
            || (bool) get_post_meta($post_id, self::LEGACY_META_KEY, true);
    }

    /** True when the current request is a singular view of marked content. */
    private function is_marked_singular() {
        if (!is_singular()) {
            return false;
        }
        $post_id = get_queried_object_id();
        return $post_id && self::is_ai_generated($post_id);
    }

    /** (1) Machine-readable head tag on singular AI-generated content. */
    public function print_meta_tag() {
        if ($this->is_marked_singular()) {
            echo '<meta name="ai-generated" content="true" />' . "\n";
        }
    }

    /**
     * (2) Invisible HTML comment after the main content. Restricted to the
     * main query loop so excerpts of other posts rendered on the same page
     * never pick up the marker, and guarded against double-appending when
     * the_content runs more than once.
     */
    public function append_content_marker($content) {
        if (!is_string($content) || $content === '') {
            return $content;
        }
        if (!$this->is_marked_singular() || !in_the_loop() || !is_main_query()) {
            return $content;
        }
        if (get_the_ID() !== get_queried_object_id()) {
            return $content;
        }
        if (strpos($content, self::CONTENT_MARKER) !== false || strpos($content, self::NEUTRAL_CONTENT_MARKER) !== false) {
            return $content;
        }
        return $content . "\n" . self::content_marker();
    }

    /**
     * (3) data-ai-generated="true" on the post-content wrapper when a block
     * theme renders it and the tag processor exists (WP 6.2+). Cheap: the
     * strict block-name check runs first, everything else only on a match.
     */
    public function add_wrapper_attribute($block_content, $block) {
        if (!isset($block['blockName']) || $block['blockName'] !== 'core/post-content') {
            return $block_content;
        }
        if (!class_exists('WP_HTML_Tag_Processor') || !is_string($block_content) || $block_content === '') {
            return $block_content;
        }
        if (!$this->is_marked_singular()) {
            return $block_content;
        }
        $processor = new WP_HTML_Tag_Processor($block_content);
        if ($processor->next_tag()) {
            $processor->set_attribute('data-ai-generated', 'true');
            return $processor->get_updated_html();
        }
        return $block_content;
    }
}
