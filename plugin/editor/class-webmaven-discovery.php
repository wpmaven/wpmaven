<?php

defined( 'ABSPATH' ) || exit;

/**
 * PHP-side discovery: annotates rendered HTML with data-wme-* attributes
 * so the iframe-side JS can map visual elements back to their data sources.
 *
 * Uses a stack-based UID system that tracks block depth properly:
 * - render_block_data (priority 5): assigns hierarchical UID, pushes stack
 * - render_block (priority 20): annotates HTML, pops stack
 *
 * A block's UID is its path inside its OWNER, the content it is saved in
 * (2026-10-09): a post's content (core/post-content, or the_content on a
 * classic theme), a template part, a synced pattern, a block widget. Blocks
 * the template draws around them belong to "template". So a header widget
 * or a template's groups never shift a page block's path, and the path is
 * the one the change handlers walk in that owner's content. Each annotated
 * block also carries data-wme-owner ("post:12", "part:header",
 * "pattern:45", "widget:block-3", "template") and data-wme-block-sig, the
 * mark of its stored markup (WebMaven_Block_Tree::sig) a handler compares
 * before it writes. A block rendered without render_block_data (a
 * navigation's links, rendered by the navigation block itself) has no frame
 * and never pops one.
 */
class WebMaven_Discovery {

	/**
	 * DOMPurify version of editor/assets/vendor/purify.min.js.
	 */
	public const PURIFY_VERSION = '3.4.17';

	/**
	 * Stack frames for hierarchical UID generation. A block frame:
	 * ['kind' => 'block', 'uid', 'owner', 'counter', 'token']; an owner
	 * frame (its children's paths start again at 0): ['kind' => 'owner',
	 * 'owner', 'counter', 'token'].
	 */
	private static array $uid_stack = [];

	/** The template's own top-level blocks (no owner frame open). */
	private static int $child_counter = 0;

	/** Frames the_content and widget_block_content pushed (true) or found already open (false). */
	private static array $filter_frames = [];

	private static int $next_token = 0;

	/**
	 * Server-side rendered (dynamic) blocks whose output is generated at render
	 * time and cannot be meaningfully edited via innerHTML replacement.
	 */
	private const DYNAMIC_BLOCKS = [
		'core/latest-posts',
		'core/latest-comments',
		'core/archives',
		'core/categories',
		'core/tag-cloud',
		'core/calendar',
		'core/rss',
		'core/search',
		'core/loginout',
		'core/post-date',
		'core/post-author',
		'core/post-author-name',
		'core/post-terms',
		'core/post-time-to-read',
		'core/post-featured-image',
		'core/site-logo',
		'core/avatar',
		'core/comment-author-name',
		'core/comment-date',
		'core/comment-edit-link',
		'core/comment-reply-link',
		'core/query-title',
		'core/term-description',
		'core/comments-title',
		'core/post-navigation-link',
	];

	/**
	 * Pure structural wrappers — tracked for UID depth but NOT annotated.
	 * These have innerBlocks whose content is the real target.
	 *
	 * Note: core/buttons is a container (individual core/button IS annotated).
	 * core/query-pagination-* are kept here because their content is
	 * generated server-side and not meaningfully editable via innerHTML.
	 */
	private const SKIP_ANNOTATION = [
		'core/group',
		'core/column',
		'core/columns',
		'core/row',
		'core/stack',
		'core/post-content',
		'core/pattern',
		'core/post-template',
		'core/query',
		'core/query-pagination',
		'core/query-pagination-numbers',
		'core/query-no-results',
		'core/null',
		'core/buttons',
		'core/comments',
		'core/comments-pagination',
		'core/comments-pagination-numbers',
		'core/comment-template',
		// WordPress 6.6-7.0 containers.
		'core/accordion',
		'core/tabs',
		'core/grid',
	];

	public static function init(): void {
		// Only annotate when discovery mode is active.
		if ( empty( $_GET['webmaven_discover'] ) ) {
			return;
		}

		// Defer capability check to 'init' — current_user_can() is not
		// available during plugin load (wp_get_current_user not defined yet).
		add_action( 'init', [ __CLASS__, 'register_hooks' ] );
	}

	/**
	 * Register discovery hooks after WordPress has initialized the user session.
	 */
	public static function register_hooks(): void {
		// Require editor capability — prevents unauthenticated users from
		// activating discovery mode and seeing block structure metadata.
		if ( ! current_user_can( 'edit_posts' ) ) {
			return;
		}

		// Reset static state for safety (persistent process environments).
		self::$uid_stack     = [];
		self::$child_counter = 0;
		self::$filter_frames = [];

		add_filter( 'render_block_data', [ __CLASS__, 'track_block_index' ], 5, 1 );
		add_filter( 'render_block', [ __CLASS__, 'annotate_block' ], 20, 2 );
		// A classic theme's content and block widgets are owners of their own
		// (do_blocks runs on both at priority 9).
		add_filter( 'the_content', [ __CLASS__, 'open_content_owner' ], 8 );
		add_filter( 'the_content', [ __CLASS__, 'close_filter_owner' ], 99 );
		add_filter( 'widget_block_content', [ __CLASS__, 'open_widget_owner' ], 8, 3 );
		add_filter( 'widget_block_content', [ __CLASS__, 'close_filter_owner' ], 99 );
		add_action( 'wp_enqueue_scripts', [ __CLASS__, 'enqueue_discovery_script' ] );

		// Disable admin bar in discovery mode to avoid interference.
		add_filter( 'show_admin_bar', '__return_false' );
	}

	/**
	 * Assign hierarchical UID and push stack (pre-render).
	 *
	 * For a page with:
	 *   Group (0) → Heading (0.0), Paragraph (0.1)
	 *   Paragraph (1)
	 *
	 * render_block_data fires: Group→Heading→Paragraph(inner)→Paragraph(root)
	 * UIDs assigned:           0     0.0     0.1              1
	 */
	public static function track_block_index( array $parsed_block ): array {
		// Skip freeform/null blocks — they don't participate in the UID tree.
		if ( empty( $parsed_block['blockName'] ) ) {
			return $parsed_block;
		}

		// A pattern reference renders its pattern's blocks in its own place:
		// they are numbered where it sits (as the markup holds them once the
		// reference is resolved, the way the site editor saves a part).
		if ( 'core/pattern' === $parsed_block['blockName'] ) {
			$token                     = 'b' . ( ++self::$next_token );
			$parsed_block['wme_token'] = $token;
			self::$uid_stack[]         = [ 'kind' => 'transparent', 'token' => $token ];
			return $parsed_block;
		}

		// Its path in the innermost open frame (a pattern's frame numbers in
		// the frame below it): from 0 under an owner frame, below the parent
		// block's path under a block frame.
		$top = self::$uid_stack ? count( self::$uid_stack ) - 1 : -1;
		while ( $top >= 0 && 'transparent' === self::$uid_stack[ $top ]['kind'] ) {
			$top--;
		}
		if ( $top >= 0 ) {
			$frame = &self::$uid_stack[ $top ];
			$uid   = 'owner' === $frame['kind'] ? (string) $frame['counter'] : $frame['uid'] . '.' . $frame['counter'];
			$owner = $frame['owner'];
			$frame['counter']++;
			unset( $frame );
		} else {
			$uid   = (string) self::$child_counter;
			$owner = 'template';
			self::$child_counter++;
		}

		$token = 'b' . ( ++self::$next_token );
		$parsed_block['wme_uid']   = $uid;
		$parsed_block['wme_owner'] = $owner;
		$parsed_block['wme_token'] = $token;

		self::$uid_stack[] = [ 'kind' => 'block', 'uid' => $uid, 'owner' => $owner, 'counter' => 0, 'token' => $token ];

		// The content these blocks hold is saved elsewhere: its blocks count from 0 in their owner.
		$inner_owner = self::owner_inside( $parsed_block );
		if ( $inner_owner !== '' ) {
			self::$uid_stack[] = [ 'kind' => 'owner', 'owner' => $inner_owner, 'counter' => 0, 'token' => $token ];
		}

		return $parsed_block;
	}

	/** The owner of the content a block renders from elsewhere ('' when its children are its own). */
	private static function owner_inside( array $block ): string {
		switch ( $block['blockName'] ) {
			case 'core/post-content':
				$id = (int) get_the_ID();
				return $id > 0 ? 'post:' . $id : '';
			case 'core/template-part':
				$slug = (string) ( $block['attrs']['slug'] ?? '' );
				return $slug !== '' ? 'part:' . $slug : '';
			case 'core/block':
				$ref = (int) ( $block['attrs']['ref'] ?? 0 );
				return $ref > 0 ? 'pattern:' . $ref : '';
		}
		return '';
	}

	/** the_content (priority 8): a classic theme's content is its post's, unless core/post-content opened it already. */
	public static function open_content_owner( $content ) {
		$id    = (int) get_the_ID();
		$owner = $id > 0 ? 'post:' . $id : '';
		$top   = self::$uid_stack ? self::$uid_stack[ count( self::$uid_stack ) - 1 ] : null;
		if ( $owner === '' || ( $top && 'owner' === $top['kind'] && $top['owner'] === $owner ) ) {
			self::$filter_frames[] = false;
			return $content;
		}
		self::$uid_stack[]     = [ 'kind' => 'owner', 'owner' => $owner, 'counter' => 0, 'token' => 'f' . ( ++self::$next_token ) ];
		self::$filter_frames[] = true;
		return $content;
	}

	/** widget_block_content (priority 8): a block widget's blocks are the widget's. */
	public static function open_widget_owner( $content, $instance = [], $widget = null ) {
		$id                    = is_object( $widget ) && ! empty( $widget->id ) ? (string) $widget->id : 'block';
		self::$uid_stack[]     = [ 'kind' => 'owner', 'owner' => 'widget:' . $id, 'counter' => 0, 'token' => 'f' . ( ++self::$next_token ) ];
		self::$filter_frames[] = true;
		return $content;
	}

	/** the_content / widget_block_content (priority 99): closes what priority 8 opened. */
	public static function close_filter_owner( $content ) {
		$pushed = array_pop( self::$filter_frames );
		if ( $pushed && self::$uid_stack ) {
			$top = self::$uid_stack[ count( self::$uid_stack ) - 1 ];
			if ( 'owner' === $top['kind'] && 'f' === $top['token'][0] ) {
				array_pop( self::$uid_stack );
			}
		}
		return $content;
	}

	/**
	 * Annotate rendered block HTML with data-wme-* attributes and pop the UID stack.
	 *
	 * Uses WP_HTML_Tag_Processor for safe attribute injection.
	 */
	public static function annotate_block( string $block_content, array $block ): string {
		$block_name = $block['blockName'] ?? '';

		// Pop this block's frames (and an owner frame it opened). A block
		// that never went through render_block_data has no frame to pop.
		$token = (string) ( $block['wme_token'] ?? '' );
		if ( $token !== '' ) {
			for ( $i = count( self::$uid_stack ) - 1; $i >= 0; $i-- ) {
				if ( self::$uid_stack[ $i ]['token'] === $token && 'owner' !== self::$uid_stack[ $i ]['kind'] ) {
					array_splice( self::$uid_stack, $i );
					break;
				}
			}
		}

		// Skip annotation for empty, unnamed, or pure-wrapper blocks.
		if ( empty( $block_content ) || empty( $block_name ) ) {
			return $block_content;
		}

		if ( in_array( $block_name, self::SKIP_ANNOTATION, true ) ) {
			return $block_content;
		}

		$block_uid = $block['wme_uid'] ?? '0';
		$owner     = (string) ( $block['wme_owner'] ?? 'template' );
		$category  = self::get_block_category( $block_name );
		// The post the block is saved in: its owner's (a page, a synced pattern), else the page's.
		$post_id = preg_match( '/^(?:post|pattern):(\d+)$/', $owner, $owned ) ? (int) $owned[1] : ( get_the_ID() ?: get_queried_object_id() );

		$processor = new WP_HTML_Tag_Processor( $block_content );

		if ( $processor->next_tag() ) {
			$processor->set_attribute( 'data-wme-source', 'block' );
			$processor->set_attribute( 'data-wme-block-name', $block_name );
			$processor->set_attribute( 'data-wme-block-uid', $block_uid );
			$processor->set_attribute( 'data-wme-owner', $owner );
			$processor->set_attribute( 'data-wme-block-sig', substr( sha1( (string) ( $block['innerHTML'] ?? '' ) ), 0, 16 ) );
			$processor->set_attribute( 'data-wme-category', $category );

			if ( $post_id ) {
				$processor->set_attribute( 'data-wme-post-id', (string) $post_id );
			}

			if ( self::is_editable_block( $block_name ) ) {
				$processor->set_attribute( 'data-wme-editable', 'true' );
			}

			// A section of a page WPMaven designed (a Custom HTML block bound to it), whatever its first element is.
			if ( 'core/html' === $block_name && false !== strpos( (string) ( $block['innerHTML'] ?? '' ), 'data-wm-page=' ) ) {
				$processor->set_attribute( 'data-wme-designed', 'true' );
			}

			// Task 4: Flag dynamic (server-side rendered) blocks.
			if ( in_array( $block_name, self::DYNAMIC_BLOCKS, true ) ) {
				$processor->set_attribute( 'data-wme-dynamic', 'true' );
			}

			// Task 5: Flag blocks with attribute bindings.
			$bindings = $block['attrs']['metadata']['bindings'] ?? [];
			if ( ! empty( $bindings ) ) {
				$processor->set_attribute( 'data-wme-bound', 'true' );

				// Extract binding source and meta key from the first binding.
				$first_binding = reset( $bindings );
				$source        = $first_binding['source'] ?? '';
				if ( $source ) {
					$processor->set_attribute( 'data-wme-binding-source', $source );
				}

				if ( $source === 'core/post-meta' ) {
					$meta_key = $first_binding['args']['key'] ?? '';
					if ( $meta_key ) {
						$processor->set_attribute( 'data-wme-binding-key', $meta_key );
					}
				}
			}

			// Site identity: map identity blocks (title/tagline/logo) to the
			// setting they render from, so an edit routes to the setting
			// (option / theme mod, via the "site-identity" handler) instead of
			// rewriting block HTML.
			$setting_source = self::get_setting_source( $block_name );
			if ( $setting_source ) {
				$processor->set_attribute( 'data-wme-setting-source', $setting_source );
				$processor->set_attribute( 'data-wme-setting-target', 'site-identity' );
			}

			// Template parts (header/footer/sidebar): tag the wrapper with its
			// slug. Content inside lives in wp_template_part, not the page, so
			// the editor walks up to this marker and routes edits to the
			// template-part handler (which resolves the part by slug).
			if ( $block_name === 'core/template-part' ) {
				$slug = $block['attrs']['slug'] ?? '';
				if ( $slug ) {
					$processor->set_attribute( 'data-wme-template-part', 'true' );
					$processor->set_attribute( 'data-wme-template-slug', $slug );
					$area = $block['attrs']['area'] ?? '';
					if ( $area ) {
						$processor->set_attribute( 'data-wme-template-area', $area );
					}
				}
			}
		}

		return $processor->get_updated_html();
	}

	/**
	 * Determine if a block type is directly editable (content can be replaced).
	 * Container blocks with innerBlocks are NOT editable — replacing their
	 * innerHTML would destroy the inner block structure.
	 * Dynamic (server-side rendered) blocks are never editable.
	 */
	private static function is_editable_block( string $block_name ): bool {
		// Dynamic blocks are server-rendered — never editable via innerHTML.
		if ( in_array( $block_name, self::DYNAMIC_BLOCKS, true ) ) {
			return false;
		}

		$editable_blocks = [
			// Core text content.
			'core/heading',
			'core/paragraph',
			'core/button',
			'core/verse',
			'core/preformatted',
			'core/code',
			// Structured text.
			'core/list',
			'core/list-item',
			'core/quote',
			'core/pullquote',
			'core/table',
			// Media.
			'core/image',
			// Site identity.
			'core/site-title',
			'core/site-tagline',
			'core/post-title',
			'core/post-excerpt',
			// WordPress 6.2+ blocks.
			'core/details',
			'core/footnotes',
			// Pagination text.
			'core/query-pagination-next',
			'core/query-pagination-previous',
			// Comment text.
			'core/comment-content',
			'core/post-comments-form',
			// WooCommerce text blocks.
			'woocommerce/product-title',
			'woocommerce/product-summary',
			'woocommerce/product-price',
			// WordPress 7.0 editable blocks.
			'core/accordion-summary',
			'core/accordion-content',
			'core/tab-panel',
		];

		// Also editable: any third-party block we have a category for
		// that is clearly text/content (not layout).
		return in_array( $block_name, $editable_blocks, true );
	}

	/**
	 * Map a site-identity block to the setting it renders from. These
	 * elements look like editable text/media but are backed by an option or
	 * theme mod, so edits must target the setting (the "site-identity"
	 * change handler), not the block's inner HTML.
	 *
	 * @return string The setting key (e.g. "blogname"), or '' if not identity.
	 */
	private static function get_setting_source( string $block_name ): string {
		return match ( $block_name ) {
			'core/site-title'   => 'blogname',
			'core/site-tagline' => 'blogdescription',
			'core/site-logo'    => 'custom_logo',
			default             => '',
		};
	}

	/**
	 * Map block name to element category for AI action routing.
	 */
	private static function get_block_category( string $block_name ): string {
		$category_map = [
			// ── Text content ───────────────────────────────────
			'core/heading'          => 'text-heading',
			'core/paragraph'        => 'text-paragraph',
			'core/button'           => 'text-button',
			'core/verse'            => 'text-paragraph',
			'core/preformatted'     => 'text-paragraph',
			'core/code'             => 'text-code',
			'core/html'             => 'text-code',
			'core/shortcode'        => 'text-code',
			'core/freeform'         => 'text-paragraph',

			// ── Structured text ────────────────────────────────
			'core/list'             => 'text-list',
			'core/list-item'        => 'text-list',
			'core/quote'            => 'text-quote',
			'core/pullquote'        => 'text-quote',
			'core/table'            => 'text-table',

			// ── WordPress 6.2+ blocks ──────────────────────────
			'core/details'          => 'accordion',
			'core/footnotes'        => 'text-list',
			'core/table-of-contents' => 'navigation',

			// ── Media ──────────────────────────────────────────
			'core/image'            => 'image',
			'core/gallery'          => 'gallery',
			'core/video'            => 'video',
			'core/audio'            => 'audio',
			'core/file'             => 'media',
			'core/post-featured-image' => 'image',
			'core/site-logo'        => 'image',
			'core/media-text'       => 'layout-media',
			'core/cover'            => 'layout-cover',

			// ── Embeds ─────────────────────────────────────────
			'core/embed'            => 'embed',

			// ── Site identity ──────────────────────────────────
			'core/site-title'       => 'text-heading',
			'core/site-tagline'     => 'text-paragraph',
			'core/post-title'       => 'text-heading',
			'core/post-excerpt'     => 'text-paragraph',
			'core/post-date'        => 'text-meta',
			'core/post-author'      => 'text-meta',
			'core/post-author-name' => 'text-meta',
			'core/post-author-biography' => 'text-paragraph',
			'core/post-terms'       => 'text-meta',
			'core/post-time-to-read' => 'text-meta',

			// ── Navigation ─────────────────────────────────────
			'core/navigation'       => 'navigation',
			'core/navigation-link'  => 'navigation',
			'core/navigation-submenu' => 'navigation',
			'core/page-list'        => 'navigation',
			'core/page-list-item'   => 'navigation',
			'core/home-link'        => 'navigation',
			'core/loginout'         => 'navigation',

			// ── Interactive ────────────────────────────────────
			'core/search'           => 'interactive',
			'core/social-links'     => 'social',
			'core/social-link'      => 'social',

			// ── Pagination (now discoverable) ──────────────────
			'core/query-pagination-next'     => 'navigation',
			'core/query-pagination-previous' => 'navigation',

			// ── Archive/listing blocks ─────────────────────────
			'core/latest-posts'     => 'text-list',
			'core/latest-comments'  => 'text-list',
			'core/archives'         => 'text-list',
			'core/categories'       => 'text-list',
			'core/tag-cloud'        => 'text-list',
			'core/rss'              => 'text-list',
			'core/calendar'         => 'interactive',
			'core/query-title'      => 'text-heading',
			'core/term-description' => 'text-paragraph',
			'core/comments-title'   => 'text-heading',

			// ── Comment blocks ─────────────────────────────────
			'core/comment-author-name' => 'text-meta',
			'core/comment-date'     => 'text-meta',
			'core/comment-content'  => 'text-paragraph',
			'core/comment-edit-link' => 'navigation',
			'core/comment-reply-link' => 'navigation',
			'core/post-comments-form' => 'interactive',
			'core/avatar'           => 'image',

			// ── WordPress 6.6+ Grid layout ────────────────────
			'core/grid'                  => 'layout-section',

			// ── WordPress 7.0 new blocks ──────────────────────
			'core/icon'                  => 'image',
			'core/breadcrumbs'           => 'navigation',
			'core/accordion'             => 'accordion',
			'core/accordion-item'        => 'accordion',
			'core/accordion-content'     => 'accordion',
			'core/accordion-summary'     => 'accordion',
			'core/tabs'                  => 'accordion',
			'core/tab'                   => 'accordion',
			'core/tab-panel'             => 'accordion',
			'core/math'                  => 'text-code',
			'core/time-to-read'          => 'text-meta',
			'core/comments-link'         => 'navigation',
			'core/comments-count'        => 'text-meta',

			// ── Template parts & patterns ──────────────────────
			'core/template-part'    => 'layout-section',
			'core/pattern'          => 'layout-section',
			'core/spacer'           => 'layout-section',
			'core/separator'        => 'layout-section',

			// ── WooCommerce blocks ─────────────────────────────
			'woocommerce/product-image'           => 'image',
			'woocommerce/product-title'           => 'text-heading',
			'woocommerce/product-price'           => 'wc-price',
			'woocommerce/product-summary'         => 'wc-description',
			'woocommerce/product-rating'          => 'text-meta',
			'woocommerce/product-add-to-cart'     => 'text-button',
			'woocommerce/product-meta'            => 'text-meta',
			'woocommerce/product-sku'             => 'text-meta',
			'woocommerce/product-stock-indicator'  => 'text-meta',
			'woocommerce/product-collection'      => 'wc-product-card',
			'woocommerce/featured-product'        => 'layout-cover',
			'woocommerce/featured-category'       => 'layout-cover',
			'woocommerce/breadcrumbs'             => 'navigation',
			'woocommerce/store-notices'           => 'text-paragraph',
			'woocommerce/mini-cart'               => 'interactive',
			'woocommerce/customer-account'        => 'navigation',
			'woocommerce/product-search'          => 'interactive',
			'woocommerce/all-reviews'             => 'wc-review',
			'woocommerce/reviews-by-product'      => 'wc-review',
			'woocommerce/reviews-by-category'     => 'wc-review',
			// Additional WooCommerce blocks.
			'woocommerce/product-details'         => 'wc-description',
			'woocommerce/product-image-gallery'   => 'gallery',
			'woocommerce/cart'                    => 'interactive',
			'woocommerce/checkout'                => 'interactive',
			'woocommerce/order-confirmation'      => 'layout-section',
			'woocommerce/product-on-sale'         => 'wc-product-card',
			'woocommerce/product-new'             => 'wc-product-card',
			'woocommerce/product-best-sellers'    => 'wc-product-card',
			'woocommerce/product-top-rated'       => 'wc-product-card',
			'woocommerce/product-category'        => 'wc-product-card',
			'woocommerce/product-tag'             => 'wc-product-card',
			'woocommerce/product-attribute'        => 'wc-attribute',
			'woocommerce/handpicked-products'     => 'wc-product-card',
			'woocommerce/products-by-attribute'   => 'wc-product-card',
			'woocommerce/active-filters'          => 'interactive',
			'woocommerce/price-filter'            => 'interactive',
			'woocommerce/attribute-filter'         => 'interactive',
			'woocommerce/rating-filter'            => 'interactive',
			'woocommerce/stock-filter'             => 'interactive',

			// ── Third-party block ecosystems ───────────────────
			// Kadence Blocks.
			'kadence/advancedheading'    => 'text-heading',
			'kadence/advancedbtn'        => 'text-button',
			'kadence/iconlist'           => 'text-list',
			'kadence/testimonials'       => 'text-quote',
			'kadence/accordion'          => 'accordion',
			'kadence/tabs'              => 'accordion',
			'kadence/image'             => 'image',
			'kadence/advancedgallery'   => 'gallery',
			'kadence/form'              => 'interactive',
			'kadence/countdown'         => 'interactive',
			'kadence/info-box'          => 'text-paragraph',
			'kadence/spacer-divider'    => 'layout-section',

			// Spectra (UAG).
			'uagb/advanced-heading'     => 'text-heading',
			'uagb/buttons'              => 'text-button',
			'uagb/image'               => 'image',
			'uagb/image-gallery'       => 'gallery',
			'uagb/info-box'            => 'text-paragraph',
			'uagb/icon-list'           => 'text-list',
			'uagb/testimonial'         => 'text-quote',
			'uagb/call-to-action'      => 'text-button',
			'uagb/faq'                 => 'accordion',
			'uagb/table-of-contents'   => 'navigation',
			'uagb/tabs'               => 'accordion',
			'uagb/forms'              => 'interactive',
			'uagb/star-rating'        => 'text-meta',
			'uagb/countdown'          => 'text-meta',
			'uagb/video'              => 'video',
			'uagb/social-share'       => 'social',
			'uagb/how-to'             => 'text-list',
			'uagb/counter'            => 'text-meta',
			'uagb/post-grid'          => 'text-list',
			'uagb/post-carousel'      => 'text-list',
			'uagb/post-masonry'       => 'text-list',
			'uagb/price-list'         => 'text-list',
			'uagb/marketing-button'   => 'text-button',
			'uagb/timeline'           => 'text-list',
			'uagb/review'             => 'text-quote',
			'uagb/inline-notice'      => 'text-paragraph',
			'uagb/taxonomy-list'      => 'navigation',
			'uagb/blockquote'         => 'text-quote',
			'uagb/slider'             => 'gallery',
			'uagb/lottie'             => 'media',
			'uagb/modal'              => 'interactive',
			'uagb/container'          => 'layout-section',

			// GenerateBlocks.
			'generateblocks/headline'   => 'text-heading',
			'generateblocks/button'     => 'text-button',
			'generateblocks/image'      => 'image',
			'generateblocks/container'  => 'layout-section',
			'generateblocks/grid'       => 'layout-section',
			'generateblocks/query-loop' => 'text-list',

			// Kadence (extended).
			'kadence/video-popup'       => 'video',
			'kadence/lottie'           => 'media',
			'kadence/show-more'        => 'accordion',
			'kadence/posts'            => 'text-list',
			'kadence/row-layout'       => 'layout-section',
			'kadence/section'          => 'layout-section',
			'kadence/table-of-contents' => 'navigation',
			'kadence/count-up'         => 'text-meta',
			'kadence/progress-bar'     => 'text-meta',
			'kadence/modal'            => 'interactive',

			// Stackable.
			'stackable/heading'         => 'text-heading',
			'stackable/text'            => 'text-paragraph',
			'stackable/subtitle'        => 'text-paragraph',
			'stackable/button-group'    => 'text-button',
			'stackable/icon-button'     => 'text-button',
			'stackable/image'           => 'image',
			'stackable/image-box'       => 'image',
			'stackable/icon'            => 'image',
			'stackable/icon-list'       => 'text-list',
			'stackable/icon-box'        => 'text-paragraph',
			'stackable/testimonial'     => 'text-quote',
			'stackable/blockquote'      => 'text-quote',
			'stackable/accordion'       => 'accordion',
			'stackable/tabs'            => 'accordion',
			'stackable/tab-labels'      => 'accordion',
			'stackable/tab-content'     => 'accordion',
			'stackable/video-popup'     => 'video',
			'stackable/card'            => 'text-paragraph',
			'stackable/feature'         => 'text-paragraph',
			'stackable/feature-grid'    => 'text-list',
			'stackable/hero'            => 'layout-cover',
			'stackable/call-to-action'  => 'text-button',
			'stackable/pricing-box'     => 'text-list',
			'stackable/team-member'     => 'text-paragraph',
			'stackable/notification'    => 'text-paragraph',
			'stackable/number-box'      => 'text-meta',
			'stackable/count-up'        => 'text-meta',
			'stackable/countdown'       => 'text-meta',
			'stackable/progress-bar'    => 'text-meta',
			'stackable/progress-circle' => 'text-meta',
			'stackable/posts'           => 'text-list',
			'stackable/blog-posts'      => 'text-list',
			'stackable/carousel'        => 'gallery',
			'stackable/columns'         => 'layout-section',
			'stackable/column'          => 'layout-section',
			'stackable/container'       => 'layout-section',
			'stackable/separator'       => 'layout-section',
			'stackable/spacer'          => 'layout-section',
			'stackable/divider'         => 'layout-section',
			'stackable/map'             => 'embed',
			'stackable/table-of-contents' => 'navigation',

			// CoBlocks (GoDaddy).
			'coblocks/accordion'        => 'accordion',
			'coblocks/accordion-item'   => 'accordion',
			'coblocks/faq'              => 'accordion',
			'coblocks/alert'            => 'text-paragraph',
			'coblocks/author'           => 'text-paragraph',
			'coblocks/buttons'          => 'text-button',
			'coblocks/click-to-tweet'   => 'text-quote',
			'coblocks/counter'          => 'text-meta',
			'coblocks/events'           => 'text-list',
			'coblocks/event-item'       => 'text-list',
			'coblocks/features'         => 'text-list',
			'coblocks/food-and-drinks'  => 'text-list',
			'coblocks/food-item'        => 'text-list',
			'coblocks/form'             => 'interactive',
			'coblocks/gallery-carousel'  => 'gallery',
			'coblocks/gallery-collage'   => 'gallery',
			'coblocks/gallery-masonry'   => 'gallery',
			'coblocks/gallery-offset'    => 'gallery',
			'coblocks/gallery-stacked'   => 'gallery',
			'coblocks/gif'              => 'image',
			'coblocks/gist'             => 'text-code',
			'coblocks/hero'             => 'layout-cover',
			'coblocks/highlight'        => 'text-paragraph',
			'coblocks/icon'             => 'image',
			'coblocks/logos'            => 'gallery',
			'coblocks/map'              => 'embed',
			'coblocks/media-card'       => 'layout-media',
			'coblocks/opentable'        => 'embed',
			'coblocks/post-carousel'    => 'text-list',
			'coblocks/posts'            => 'text-list',
			'coblocks/pricing-table'     => 'text-list',
			'coblocks/pricing-table-item' => 'text-list',
			'coblocks/row'              => 'layout-section',
			'coblocks/column'           => 'layout-section',
			'coblocks/services'         => 'text-list',
			'coblocks/shape-divider'    => 'layout-section',
			'coblocks/social-profiles'  => 'social',
			'coblocks/social'           => 'social',
			'coblocks/testimonials'     => 'text-quote',
			'coblocks/dynamic-separator' => 'layout-section',

			// Essential Blocks.
			'essential-blocks/accordion'       => 'accordion',
			'essential-blocks/toggle-content'  => 'accordion',
			'essential-blocks/tab'             => 'accordion',
			'essential-blocks/button'          => 'text-button',
			'essential-blocks/dual-button'     => 'text-button',
			'essential-blocks/call-to-action'  => 'text-button',
			'essential-blocks/flipbox'         => 'text-paragraph',
			'essential-blocks/infobox'         => 'text-paragraph',
			'essential-blocks/notice'          => 'text-paragraph',
			'essential-blocks/typing-text'     => 'text-heading',
			'essential-blocks/testimonial'     => 'text-quote',
			'essential-blocks/team-member'     => 'text-paragraph',
			'essential-blocks/feature-list'    => 'text-list',
			'essential-blocks/pricing-table'   => 'text-list',
			'essential-blocks/number-counter'  => 'text-meta',
			'essential-blocks/countdown'       => 'text-meta',
			'essential-blocks/progress-bar'    => 'text-meta',
			'essential-blocks/image-gallery'   => 'gallery',
			'essential-blocks/image-comparison' => 'image',
			'essential-blocks/slider'          => 'gallery',
			'essential-blocks/parallax-slider' => 'gallery',
			'essential-blocks/post-grid'       => 'text-list',
			'essential-blocks/post-carousel'   => 'text-list',
			'essential-blocks/form'            => 'interactive',
			'essential-blocks/popup'           => 'interactive',
			'essential-blocks/social'          => 'social',
			'essential-blocks/social-share'    => 'social',
			'essential-blocks/google-map'      => 'embed',
			'essential-blocks/instagram-feed'  => 'embed',
			'essential-blocks/openverse'       => 'image',
			'essential-blocks/table-of-contents' => 'navigation',
			'essential-blocks/row'             => 'layout-section',
			'essential-blocks/wrapper'         => 'layout-section',
			'essential-blocks/interactive-promo' => 'layout-cover',

			// Otter Blocks (ThemeIsle).
			'themeisle-blocks/accordion'         => 'accordion',
			'themeisle-blocks/tabs'              => 'accordion',
			'themeisle-blocks/advanced-heading'  => 'text-heading',
			'themeisle-blocks/button-group'      => 'text-button',
			'themeisle-blocks/flip'              => 'text-paragraph',
			'themeisle-blocks/icon-list'         => 'text-list',
			'themeisle-blocks/pricing'           => 'text-list',
			'themeisle-blocks/testimonials'      => 'text-quote',
			'themeisle-blocks/review'            => 'text-quote',
			'themeisle-blocks/circle-counter'    => 'text-meta',
			'themeisle-blocks/countdown'         => 'text-meta',
			'themeisle-blocks/progress-bar'      => 'text-meta',
			'themeisle-blocks/posts-grid'        => 'text-list',
			'themeisle-blocks/content-timeline'  => 'text-list',
			'themeisle-blocks/slider'            => 'gallery',
			'themeisle-blocks/form'              => 'interactive',
			'themeisle-blocks/popup'             => 'interactive',
			'themeisle-blocks/stripe-checkout'   => 'interactive',
			'themeisle-blocks/google-maps'       => 'embed',
			'themeisle-blocks/lottie'            => 'media',
			'themeisle-blocks/sharing-icons'     => 'social',
			'themeisle-blocks/font-awesome-icons' => 'image',
		];

		return $category_map[ $block_name ] ?? 'unknown';
	}

	/**
	 * DOMPurify for the iframe-side script: webmaven-discover.js runs every
	 * live preview through it before drawing it on the page. A vendored copy of
	 * the version frontend/package-lock.json locks (tests/html-sanitize-static
	 * keeps the two equal). Returns the handle to list as a dependency.
	 */
	public static function register_purify(): string {
		wp_register_script(
			'webmaven-dompurify',
			WEBMAVEN_WP_URL . 'editor/assets/vendor/purify.min.js',
			[],
			self::PURIFY_VERSION,
			true
		);
		return 'webmaven-dompurify';
	}

	/**
	 * Enqueue the iframe-side discovery script.
	 */
	public static function enqueue_discovery_script(): void {
		wp_enqueue_script(
			'webmaven-discover',
			WEBMAVEN_WP_URL . 'editor/assets/webmaven-discover.js',
			[ self::register_purify() ],
			self::discover_version(),
			true
		);
		$extras = self::own_extras();
		if ( $extras ) {
			wp_add_inline_script( 'webmaven-discover', 'window.wmeOwn = ' . wp_json_encode( $extras ) . ';', 'before' );
		}
	}

	/**
	 * What the frame shows of a post or a product in the editor only
	 * (2026-10-19): a post's summary (its excerpt as written, never one
	 * WordPress makes up), its categories and tags; whether a product has a
	 * description and a short description, so an empty one is offered where
	 * it would show. Discovery mode runs for a signed-in editor only, so
	 * visitors never get it.
	 */
	private static function own_extras(): array {
		$id = (int) get_queried_object_id();
		if ( $id <= 0 || ! current_user_can( 'edit_post', $id ) ) {
			return [];
		}
		if ( is_singular( 'post' ) ) {
			$post  = get_post( $id );
			$terms = function ( $list ) {
				$out = [];
				foreach ( (array) $list as $term ) {
					if ( $term instanceof WP_Term ) {
						$out[] = [ 'id' => (int) $term->term_id, 'name' => (string) $term->name ];
					}
				}
				return $out;
			};
			// The default category (Uncategorized) is no category to show.
			$default    = (int) get_option( 'default_category', 0 );
			$categories = array_values( array_filter( (array) get_the_category( $id ), function ( $term ) use ( $default ) {
				return (int) $term->term_id !== $default;
			} ) );
			return [ 'post' => [
				'id'         => $id,
				'summary'    => $post ? (string) $post->post_excerpt : '',
				'categories' => $terms( $categories ),
				'tags'       => $terms( get_the_tags( $id ) ?: [] ),
			] ];
		}
		if ( is_singular( 'product' ) && function_exists( 'wc_get_product' ) ) {
			$product = wc_get_product( $id );
			if ( ! $product ) {
				return [];
			}
			return [ 'product' => [
				'id'               => $id,
				'description'      => trim( wp_strip_all_tags( (string) $product->get_description() ) ) !== '',
				'shortDescription' => trim( wp_strip_all_tags( (string) $product->get_short_description() ) ) !== '',
			] ];
		}
		return [];
	}

	/**
	 * The discovery script's version: the plugin's and the file's time, so a
	 * new build of the same release is never served from the browser's cache.
	 */
	public static function discover_version(): string {
		$path = WEBMAVEN_WP_DIR . 'editor/assets/webmaven-discover.js';
		return WEBMAVEN_WP_VERSION . ( file_exists( $path ) ? '.' . filemtime( $path ) : '' );
	}
}
