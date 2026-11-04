<?php

defined( 'ABSPATH' ) || exit;

/**
 * The editor's own routes under webmaven/v1 besides the edit engine's
 * (class-webmaven-edits-rest.php): the sidebar's lists of pages, posts and
 * products and its search in them (2026-10-17: ?search=words&type=post
 * answers WordPress's own search on that post type, up to 30, older items
 * included), and a page's search details as the SEO panel reads them. The older visual editor's routes (apply-change,
 * publish-changeset, ai-prompt, checkpoints, discover, pages, templates and
 * the SEO save and generate) retired with it on 2026-10-09: every site opens
 * the section editor, whose changes go through the edit engine.
 */
class WebMaven_REST_API {

	public static function register_routes(): void {
		// The editor sidebar's lists: pages, posts and products, live or drafts; with search and type, the matches.
		register_rest_route( 'webmaven/v1', '/pages', [
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => [ __CLASS__, 'list_pages' ],
			'permission_callback' => [ __CLASS__, 'check_permissions' ],
			'args'                => [
				'search' => [ 'type' => 'string', 'required' => false ],
				'type'   => [ 'type' => 'string', 'required' => false, 'enum' => [ 'page', 'post', 'product' ] ],
				'id'     => [ 'type' => 'integer', 'required' => false, 'minimum' => 1 ],
				// The template page's chooser: what visitors see only (with type, and search or not).
				'status' => [ 'type' => 'string', 'required' => false, 'enum' => [ 'publish' ] ],
			],
		] );
		register_rest_route( 'webmaven/v1', '/seo/(?P<post_id>\d+)', [
			[
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => [ __CLASS__, 'get_seo' ],
				'permission_callback' => [ __CLASS__, 'check_permissions' ],
			],
		] );
	}

	public static function check_permissions(): bool {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * Verify the current user can edit the specific post.
	 */
	private static function check_post_permission( int $post_id ): ?WP_REST_Response {
		if ( ! $post_id ) {
			return new WP_REST_Response( [ 'error' => 'post_id is required.' ], 400 );
		}

		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return new WP_REST_Response(
				[ 'error' => 'You do not have permission to edit this post.' ],
				403
			);
		}

		return null;
	}

	// ── SEO Metadata ──────────────────────────────────────────────────

	/**
	 * The editor's field names and the shared service's (WebMaven_SEO_Fields,
	 * the same fields the dashboard's Pages tab and the head printer use).
	 */
	const SEO_EDITOR_FIELDS = [
		'meta_title'       => 'title',
		'meta_description' => 'description',
		'og_title'         => 'ogTitle',
		'og_description'   => 'ogDescription',
		'og_image'         => 'ogImage',
	];

	/**
	 * GET /seo/{post_id}: read SEO metadata, for a user who may edit that post.
	 */
	public static function get_seo( WP_REST_Request $request ): WP_REST_Response {
		$post_id = (int) $request['post_id'];
		$post    = get_post( $post_id );
		if ( ! $post ) {
			return new WP_REST_Response( [ 'error' => 'Post not found.' ], 404 );
		}
		$auth_error = self::check_post_permission( $post_id );
		if ( $auth_error ) {
			return $auth_error;
		}

		$fields = WebMaven_SEO_Fields::read( $post_id );
		$result = [];
		foreach ( self::SEO_EDITOR_FIELDS as $editor_field => $field ) {
			$result[ $editor_field ] = $field === 'ogImage'
				? (string) ( WebMaven_SEO_Fields::image_url( $fields['ogImage'] ) ?? '' )
				: $fields[ $field ];
		}
		$result['noindex'] = $fields['noindex'];

		// Fallback: meta_title defaults to post title.
		if ( ! $result['meta_title'] ) {
			$result['meta_title'] = get_the_title( $post_id );
		}

		$content               = apply_filters( 'the_content', $post->post_content );
		$result['post_title']  = get_the_title( $post_id );
		$result['post_excerpt'] = $post->post_excerpt;
		$result['word_count']  = str_word_count( wp_strip_all_tags( $content ) );
		$result['seo_plugin']  = WebMaven_SEO_Fields::active_plugin_name();

		return new WP_REST_Response( $result );
	}

	/** The most items one search answers. */
	const SEARCH_MAX = 30;

	/** What the sidebar lists: what is live, and the drafts (a page or post just added waits as one). */
	const LISTED_STATUSES = [ 'publish', 'draft' ];

	/**
	 * The sidebar's lists, for the posts the current user can edit: the
	 * homepage (the front page itself, listed once, or a Homepage line when
	 * the site opens on its latest posts), then the latest 50 pages (not
	 * the store's cart, checkout and account pages), 30 posts and 30
	 * products, live or
	 * drafts (2026-10-17: a draft says so, and its address is its preview).
	 * With search (and type: page, post or product) it answers that type's
	 * matches instead, WordPress's own search (s), up to 30, as { items }.
	 * With id (2026-10-19) it answers that one page, post or product as
	 * { item } (null when it is none of them or cannot be edited): the
	 * editor's address names what it shows (#/editor/product/27), and a
	 * reload opens it again.
	 * With status=publish and type post or product (2026-10-19) it answers
	 * that type's published items only, as { items }: the newest 50, or the
	 * matches of search. The product page and the post page show one of
	 * them, and their chooser lists them.
	 *
	 * A page says what the sidebar's trash needs (2026-10-17): wm_page, the
	 * plan slug of a page WPMaven designed (the edit engine removes those),
	 * and locked for the pages that stay (the front page and the designed
	 * homepage, the blog's posts page, the store's shop, cart, checkout and
	 * account pages). store says
	 * whether WooCommerce is active, so Products shows with no product yet.
	 */
	public static function list_pages( WP_REST_Request $request ): WP_REST_Response {
		$id = (int) $request->get_param( 'id' );
		if ( $id > 0 ) {
			$p  = get_post( $id );
			$ok = $p
				&& in_array( $p->post_type, [ 'page', 'post', 'product' ], true )
				&& ( $p->post_type !== 'product' || class_exists( 'WooCommerce' ) )
				&& in_array( $p->post_status, self::LISTED_STATUSES, true )
				&& current_user_can( 'edit_post', $p->ID );
			return new WP_REST_Response( [ 'item' => $ok ? self::item( $p, self::locked_pages() ) : null ] );
		}
		$search    = trim( sanitize_text_field( (string) $request->get_param( 'search' ) ) );
		$published = $request->get_param( 'status' ) === 'publish';
		if ( $search !== '' || $published ) {
			$type = (string) $request->get_param( 'type' );
			if ( ! in_array( $type, [ 'page', 'post', 'product' ], true ) || ( $type === 'product' && ! class_exists( 'WooCommerce' ) ) ) {
				return new WP_REST_Response( [ 'items' => [] ] );
			}
			$query = [
				'post_type'      => $type,
				'post_status'    => $published ? 'publish' : self::LISTED_STATUSES,
				'posts_per_page' => $search !== '' ? self::SEARCH_MAX : 50,
				'orderby'        => $search !== '' ? 'relevance' : 'date',
				'order'          => 'DESC',
			];
			if ( $search !== '' ) {
				$query['s'] = function_exists( 'mb_substr' ) ? mb_substr( $search, 0, 100 ) : substr( $search, 0, 100 );
			}
			$found = get_posts( $query );
			$locked = self::locked_pages();
			$steps  = self::store_steps();
			$items  = [];
			foreach ( $found as $p ) {
				if ( in_array( (int) $p->ID, $steps, true ) ) continue;
				if ( ! current_user_can( 'edit_post', $p->ID ) ) continue;
				$items[] = self::item( $p, $locked );
			}
			return new WP_REST_Response( [ 'items' => $items ] );
		}

		$locked = self::locked_pages();
		$steps  = self::store_steps();
		$pages  = [];
		$posts  = [];

		// The homepage first: the page visitors land on when the site shows
		// one (once, under its own name), else a line of its own for the
		// latest posts.
		$front = get_option( 'show_on_front' ) === 'page' ? get_post( (int) get_option( 'page_on_front', 0 ) ) : null;
		if ( $front && $front->post_type === 'page' && in_array( $front->post_status, self::LISTED_STATUSES, true ) && current_user_can( 'edit_post', $front->ID ) ) {
			$pages[] = self::item( $front, $locked );
		} else {
			$front   = null;
			$pages[] = [
				'id'    => 0,
				'title' => 'Homepage',
				'type'  => 'home',
				'url'   => home_url( '/' ),
			];
		}

		// Pages, live or drafts
		$wp_pages = get_posts( [
			'post_type'      => 'page',
			'post_status'    => self::LISTED_STATUSES,
			'posts_per_page' => 50,
			'orderby'        => 'menu_order',
			'order'          => 'ASC',
		] );
		foreach ( $wp_pages as $p ) {
			if ( $front && $p->ID === $front->ID ) continue;
			if ( in_array( (int) $p->ID, $steps, true ) ) continue;
			if ( ! current_user_can( 'edit_post', $p->ID ) ) continue;
			$pages[] = self::item( $p, $locked );
		}

		// Posts, live or drafts
		$wp_posts = get_posts( [
			'post_type'      => 'post',
			'post_status'    => self::LISTED_STATUSES,
			'posts_per_page' => 30,
			'orderby'        => 'date',
			'order'          => 'DESC',
		] );
		foreach ( $wp_posts as $p ) {
			if ( ! current_user_can( 'edit_post', $p->ID ) ) continue;
			$posts[] = self::item( $p, $locked );
		}

		// WooCommerce products (only if WooCommerce is active)
		$products = [];
		if ( class_exists( 'WooCommerce' ) ) {
			$wp_products = get_posts( [
				'post_type'      => 'product',
				'post_status'    => self::LISTED_STATUSES,
				'posts_per_page' => 30,
				'orderby'        => 'date',
				'order'          => 'DESC',
			] );
			foreach ( $wp_products as $p ) {
				if ( ! current_user_can( 'edit_post', $p->ID ) ) continue;
				$products[] = self::item( $p, $locked );
			}
		}

		return new WP_REST_Response( [
			'pages'    => $pages,
			'posts'    => $posts,
			'products' => $products,
			'store'    => class_exists( 'WooCommerce' ),
		] );
	}

	/** One line of the sidebar: a page, a post or a product, with what its row needs. */
	private static function item( $p, array $locked ): array {
		$draft = $p->post_status === 'draft';
		$item  = [
			'id'    => (int) $p->ID,
			'title' => $p->post_title ?: '(Untitled)',
			'type'  => (string) $p->post_type,
			// A draft opens as its preview, which only someone who may edit it sees.
			'url'   => $draft ? ( get_preview_post_link( $p ) ?: get_permalink( $p->ID ) ) : get_permalink( $p->ID ),
		];
		if ( $draft ) {
			$item['status'] = 'draft';
		}
		if ( $p->post_type === 'page' ) {
			$wm_page = (string) get_post_meta( $p->ID, '_wm_page', true );
			if ( $wm_page !== '' ) {
				$item['wm_page'] = $wm_page;
			}
			// The designed homepage stays too, even while visitors land on another one.
			if ( in_array( (int) $p->ID, $locked, true ) || $wm_page === 'index' ) {
				$item['locked'] = true;
			}
		} elseif ( $p->post_type === 'product' ) {
			$price = get_post_meta( $p->ID, '_regular_price', true );
			$item['price'] = $price ?: '';
			// The price as the store shows it: its currency and format,
			// a range for a variable product (print-on-demand stores).
			$item['price_text'] = self::price_text( $p->ID );
		}
		return $item;
	}

	/**
	 * The store's own steps: the cart, the checkout and the account pages.
	 * WooCommerce draws them for each shopper and they hold nothing of their
	 * own to edit, so the sidebar leaves them out (2026-10-18).
	 */
	private static function store_steps(): array {
		if ( ! class_exists( 'WooCommerce' ) ) return [];
		$ids = [];
		foreach ( [ 'cart', 'checkout', 'myaccount' ] as $page ) {
			$ids[] = function_exists( 'wc_get_page_id' ) ? (int) wc_get_page_id( $page ) : (int) get_option( 'woocommerce_' . $page . '_page_id', 0 );
		}
		return array_values( array_filter( $ids, function ( $id ) { return $id > 0; } ) );
	}

	/** The pages that stay whatever the owner removes: the front page, the blog's posts page and the store's own pages. */
	private static function locked_pages(): array {
		$ids = get_option( 'show_on_front' ) === 'page' ? [ (int) get_option( 'page_on_front', 0 ), (int) get_option( 'page_for_posts', 0 ) ] : [];
		foreach ( [ 'shop', 'cart', 'checkout', 'myaccount' ] as $page ) {
			$ids[] = function_exists( 'wc_get_page_id' ) ? (int) wc_get_page_id( $page ) : (int) get_option( 'woocommerce_' . $page . '_page_id', 0 );
		}
		return array_values( array_filter( $ids, function ( $id ) { return $id > 0; } ) );
	}

	/**
	 * A product's price as the store shows it, as plain text: WooCommerce's
	 * own price HTML without its tags, in the store's currency and format, a
	 * range for a variable product. '' when there is none.
	 */
	public static function price_text( $product_id ) {
		if ( ! function_exists( 'wc_get_product' ) ) {
			return '';
		}
		$product = wc_get_product( $product_id );
		if ( ! $product || ! method_exists( $product, 'get_price_html' ) ) {
			return '';
		}
		$text = html_entity_decode( wp_strip_all_tags( (string) $product->get_price_html() ), ENT_QUOTES, 'UTF-8' );
		return trim( preg_replace( '/\s+/u', ' ', $text ) );
	}
}
