<?php
/**
 * WordPress's and WooCommerce's own REST answers, as the Store reads them
 * (2026-10-05).
 *
 * The plugin app reads wc/v3/products, wc/v3/orders, wp/v2/posts and
 * wp/v2/media directly with the signed-in user's cookie, and the store
 * commands read the same routes with rest_do_request, so one enrichment
 * serves both:
 *
 *  - Products, variations and orders: every meta_data entry whose key starts
 *    with _wm_ or _webmaven_ is dropped (the print data and its mapping never
 *    leave the site), and a `wpmaven` field says what the Store needs:
 *    WpmavenProductInfo, WpmavenVariationInfo (plus `enabled`) and
 *    WpmavenOrderInfo.
 *  - The products collection takes wpmaven_kind (own, sample, printed; own
 *    means "not printed", samples included) and wpmaven_no_photo.
 *  - The media collection takes wpmaven_no_alt and wpmaven_unused (the
 *    where-used index), and wpmaven_uses=1 adds `wpmaven: {uses}` to each
 *    file (one where-used pass for the page).
 *  - Posts and pages answer `wpmaven: {designOwned, excerpt, summary, sitePage}` in
 *    the edit context, to users who can edit them. A list asks for these
 *    with LIST_POST_FIELDS and never for WordPress's own content or excerpt:
 *    both run the post through its blocks and content filters (an empty
 *    excerpt is made from the rendered post), and one post whose blocks do
 *    not close ran PHP out of memory there, which took the whole list down.
 *    The summary is read from the stored text, bounded, and never rendered.
 *  - Writes: a product or variation write naming an internal meta key is
 *    refused (400 rest_forbidden_meta), then a price under the floor (400
 *    price_below_floor) and a change to a printed product's options (400
 *    pod_options_locked); an order write keeps the Store's rules for the six
 *    statuses, and on an order of ours (paid with WPMaven Payments, or with
 *    a printed line) is refused any other status (400 status_not_allowed),
 *    see WebMaven_Pod_Guards. On any other order an outside tool sets what
 *    WooCommerce itself accepts.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Store_Rest_Filters {

    /** Meta keys that never leave the site through REST. */
    const INTERNAL_META = '/^_(?:wm_|webmaven_)/';
    const DESIGN_KEY_META = '_wm_product_slug';
    const CARD_SLOT_PREFIX = '_wm_card_slot_';
    const FULLHTML_META = '_webmaven_fullhtml';
    const KINDS = ['own', 'sample', 'printed'];

    const FORBIDDEN_META = 'WPMaven keeps this information itself, so it cannot be changed here.';
    const PAID_BY_PAYMENT = 'An order paid with WPMaven Payments is marked paid by the payment itself, never by hand.';

    /**
     * The wp/v2 fields a list of posts reads (`_fields`): what a row shows,
     * never `content` or `excerpt`, which WordPress renders (see above).
     */
    const LIST_POST_FIELDS = 'id,date,date_gmt,modified_gmt,slug,status,link,title,featured_media,categories,tags,wpmaven';

    /** The most of a post's stored text a summary reads, in bytes: a list never reads a whole post. */
    const SUMMARY_SOURCE_BYTES = 16384;

    /** The longest summary, in characters. */
    const SUMMARY_CHARS = 200;

    /** The WooCommerce REST route of one variation, or of the variations batch. */
    const VARIATION_ROUTE = '#^/wc/v[23]/products/(?P<product>\d+)/variations/(?P<target>\d+|batch)/?$#';

    private static $started = false;

    /**
     * FORBIDDEN_META in the site's brand (WebMaven_Brand): its name, and "The
     * plugin" while the brand has no name. Unchanged on a WPMaven site.
     */
    public static function forbidden_meta_text(): string {
        if (!class_exists('WebMaven_Brand') || WebMaven_Brand::is_wpmaven()) {
            return self::FORBIDDEN_META;
        }
        return WebMaven_Brand::name_or('The plugin') . ' keeps this information itself, so it cannot be changed here.';
    }

    public static function init(): void {
        if (self::$started) {
            return;
        }
        self::$started = true;
        add_filter('woocommerce_rest_prepare_product_object', [__CLASS__, 'prepare_product'], 20, 3);
        add_filter('woocommerce_rest_prepare_product_variation_object', [__CLASS__, 'prepare_variation'], 20, 3);
        add_filter('woocommerce_rest_prepare_shop_order_object', [__CLASS__, 'prepare_order'], 20, 3);
        add_filter('rest_product_collection_params', [__CLASS__, 'product_params'], 10, 1);
        add_filter('woocommerce_rest_product_object_query', [__CLASS__, 'product_query'], 10, 2);
        add_filter('rest_attachment_collection_params', [__CLASS__, 'media_params'], 10, 1);
        add_filter('rest_attachment_query', [__CLASS__, 'media_query'], 10, 2);
        add_filter('rest_prepare_attachment', [__CLASS__, 'prepare_attachment'], 20, 3);
        add_action('rest_api_init', [__CLASS__, 'register_fields']);
        add_filter('woocommerce_rest_pre_insert_product_object', [__CLASS__, 'pre_insert_product'], 20, 3);
        add_filter('woocommerce_rest_pre_insert_product_variation_object', [__CLASS__, 'pre_insert_product'], 20, 3);
        add_filter('woocommerce_rest_pre_insert_shop_order_object', [__CLASS__, 'pre_insert_order'], 20, 3);
        add_filter('rest_request_before_callbacks', [__CLASS__, 'before_variation_delete'], 20, 3);
    }

    // ── What the Store reads about a product, a variation, an order ───────

    /** WpmavenProductInfo of a product object. */
    public static function product_info($product): array {
        $id = (int) $product->get_id();
        $photo = self::photo($product);
        $floor = WebMaven_Pod_Guards::product_floor($product);
        return [
            'kind' => WebMaven_Pod_Guards::kind($id),
            'designKey' => self::design_key($id),
            'hasPhoto' => $photo !== null,
            'floor' => $floor === null ? null : WebMaven_Pod_Guards::decimal_of($floor),
            'cardSlots' => (object) self::card_slots($id),
            'priceRange' => self::price_range($product),
            'imageUrl' => $photo['url'] ?? null,
        ];
    }

    /** WpmavenVariationInfo of a variation object, with `enabled`. */
    public static function variation_info($variation): array {
        $photo = self::photo($variation);
        $floor = WebMaven_Pod_Guards::applicable_floor($variation);
        return [
            'kind' => WebMaven_Pod_Guards::kind((int) $variation->get_parent_id()),
            'floor' => $floor === null ? null : WebMaven_Pod_Guards::decimal_of($floor),
            'hasPhoto' => $photo !== null,
            'imageUrl' => $photo['url'] ?? null,
            'enabled' => (string) $variation->get_status('edit') === 'publish',
        ];
    }

    /** WpmavenOrderInfo of an order object. */
    public static function order_info($order): array {
        $info = [
            'paymentsWpmaven' => WebMaven_Pod_Guards::is_wpmaven_payments($order),
            'printed' => WebMaven_Pod_Guards::has_printed_lines($order),
            'tracking' => self::tracking($order),
            'allowedStatuses' => WebMaven_Pod_Guards::allowed_statuses($order),
            'needsAction' => in_array(WebMaven_Pod_Guards::bare_status((string) $order->get_status()), ['processing', 'on-hold'], true),
        ];
        // The parcels the owner sent themselves, when there are any (1.4.0).
        $own = self::own_shipments($order);
        if ($own) {
            $info['shipments'] = $own;
        }
        return $info;
    }

    /** The parcels the owner sent themselves ({carrier, number, url, at}), oldest first; never the printed parcels. */
    public static function own_shipments($order): array {
        $raw = method_exists($order, 'get_meta') ? $order->get_meta('_wm_shipment', true) : [];
        $out = [];
        foreach (is_array($raw) ? $raw : [] as $s) {
            if (!is_array($s)) {
                continue;
            }
            $url = trim((string) ($s['url'] ?? ''));
            $out[] = [
                'carrier' => trim((string) ($s['carrier'] ?? '')),
                'number' => trim((string) ($s['number'] ?? '')),
                'url' => preg_match('#^https?://#i', $url) ? $url : '',
                'at' => (string) ($s['at'] ?? ''),
            ];
        }
        return $out;
    }

    /**
     * The product's photo {id, url}, or null: no image, an attachment that is
     * gone, or WooCommerce's placeholder image.
     */
    public static function photo($product): ?array {
        $id = (int) $product->get_image_id('edit');
        if ($id <= 0 || $id === (int) get_option('woocommerce_placeholder_image', 0)) {
            return null;
        }
        $post = get_post($id);
        if (!$post || $post->post_type !== 'attachment') {
            return null;
        }
        $url = self::image_url($id);
        return $url === null ? null : ['id' => $id, 'url' => $url];
    }

    /** An attachment's URL in a size (medium by default), else its full URL, or null. */
    public static function image_url(int $id, string $size = 'medium'): ?string {
        $url = function_exists('wp_get_attachment_image_url') ? wp_get_attachment_image_url($id, $size) : false;
        if (!$url) {
            $url = wp_get_attachment_url($id);
        }
        return $url ? (string) $url : null;
    }

    /** The design key (_wm_product_slug), or null for a product WPMaven did not design. */
    public static function design_key(int $id): ?string {
        $key = $id > 0 ? trim((string) get_post_meta($id, self::DESIGN_KEY_META, true)) : '';
        return $key !== '' ? $key : null;
    }

    /** The designed card's text: {key: text} from _wm_card_slot_<key>. */
    public static function card_slots(int $id): array {
        $out = [];
        if ($id <= 0) {
            return $out;
        }
        foreach ((array) get_post_meta($id) as $key => $values) {
            if (is_string($key) && strpos($key, self::CARD_SLOT_PREFIX) === 0 && strlen($key) > strlen(self::CARD_SLOT_PREFIX)) {
                $out[substr($key, strlen(self::CARD_SLOT_PREFIX))] = (string) (is_array($values) ? reset($values) : $values);
            }
        }
        ksort($out);
        return $out;
    }

    /** A variable product's lowest and highest option price, or null. */
    public static function price_range($product): ?array {
        if (!$product->is_type('variable') || !method_exists($product, 'get_variation_prices')) {
            return null;
        }
        $prices = (array) (($product->get_variation_prices(true))['price'] ?? []);
        $values = [];
        foreach ($prices as $price) {
            if (is_numeric($price)) {
                $values[] = (float) $price;
            }
        }
        if (!$values) {
            return null;
        }
        return ['min' => self::decimal(min($values)), 'max' => self::decimal(max($values))];
    }

    /** A stored price as a Decimal with the store's decimals ("18" -> "18.00"); '' -> null. */
    public static function decimal($value): ?string {
        if ($value === null || $value === '' || !is_numeric($value)) {
            return null;
        }
        $decimals = WebMaven_Pod_Guards::decimals();
        return number_format((float) $value, $decimals, '.', '');
    }

    /** The last parcel of an order's printed part, or null. */
    public static function tracking($order): ?array {
        $shipments = $order->get_meta(WebMaven_Pod_Guards::TRACKING_META, true);
        if (!is_array($shipments) || !$shipments) {
            return null;
        }
        $last = end($shipments);
        if (!is_array($last)) {
            return null;
        }
        $text = function ($value) {
            $value = trim((string) $value);
            return $value === '' ? null : $value;
        };
        return [
            'url' => $text($last['tracking_url'] ?? ''),
            'number' => $text($last['tracking_number'] ?? ''),
            'carrier' => $text($last['carrier'] ?? ''),
        ];
    }

    // ── Answers ────────────────────────────────────────────────────────────

    public static function prepare_product($response, $product, $request) {
        return self::enrich($response, $request, function () use ($product) {
            return self::product_info($product);
        });
    }

    public static function prepare_variation($response, $variation, $request) {
        return self::enrich($response, $request, function () use ($variation) {
            return self::variation_info($variation);
        });
    }

    public static function prepare_order($response, $order, $request) {
        return self::enrich($response, $request, function () use ($order) {
            return self::order_info($order);
        });
    }

    private static function enrich($response, $request, callable $info) {
        if (!is_object($response) || !method_exists($response, 'get_data')) {
            return $response;
        }
        $data = $response->get_data();
        if (!is_array($data)) {
            return $response;
        }
        $data = self::strip_meta($data);
        if (self::wants($request, 'wpmaven')) {
            $data['wpmaven'] = $info();
        }
        $response->set_data($data);
        return $response;
    }

    /** An answer without internal meta: its own meta_data and every line's (orders). */
    public static function strip_meta(array $data): array {
        if (isset($data['meta_data']) && is_array($data['meta_data'])) {
            $data['meta_data'] = self::without_internal($data['meta_data']);
        }
        foreach (['line_items', 'shipping_lines', 'fee_lines', 'tax_lines', 'coupon_lines'] as $lines) {
            if (!isset($data[$lines]) || !is_array($data[$lines])) {
                continue;
            }
            foreach ($data[$lines] as $i => $line) {
                if (is_array($line) && isset($line['meta_data']) && is_array($line['meta_data'])) {
                    $data[$lines][$i]['meta_data'] = self::without_internal($line['meta_data']);
                }
            }
        }
        return $data;
    }

    public static function is_internal_key($key): bool {
        return is_string($key) && preg_match(self::INTERNAL_META, $key) === 1;
    }

    private static function without_internal(array $list): array {
        $out = [];
        foreach ($list as $meta) {
            if (!self::is_internal_key(self::meta_key($meta))) {
                $out[] = $meta;
            }
        }
        return $out;
    }

    /** The key of a meta_data entry: a WC_Meta_Data object or an array. */
    private static function meta_key($meta): string {
        if (is_object($meta)) {
            if (method_exists($meta, 'get_data')) {
                $data = (array) $meta->get_data();
                return (string) ($data['key'] ?? '');
            }
            return (string) ($meta->key ?? '');
        }
        return is_array($meta) ? (string) ($meta['key'] ?? '') : '';
    }

    /** Whether a request's _fields (when it has any) asks for this field. */
    private static function wants($request, string $field): bool {
        $fields = self::param($request, '_fields');
        if ($fields === null || $fields === '' || $fields === []) {
            return true;
        }
        $list = is_array($fields) ? $fields : explode(',', (string) $fields);
        foreach ($list as $name) {
            $name = trim((string) $name);
            if ($name === $field || strpos($name, $field . '.') === 0) {
                return true;
            }
        }
        return false;
    }

    // ── Collections ────────────────────────────────────────────────────────

    public static function product_params($params) {
        if (!is_array($params)) {
            return $params;
        }
        $params['wpmaven_kind'] = [
            'description' => 'Printed products, sample listings, or your own products (own includes samples).',
            'type' => 'string',
            'enum' => self::KINDS,
        ];
        $params['wpmaven_no_photo'] = [
            'description' => 'Only products without a photo of their own.',
            'type' => 'boolean',
        ];
        return $params;
    }

    public static function product_query($args, $request) {
        if (!is_array($args)) {
            return $args;
        }
        $kind = self::param($request, 'wpmaven_kind');
        $not_printed = [
            'relation' => 'OR',
            ['key' => WebMaven_Pod_Guards::POD_PRODUCT_META, 'compare' => 'NOT EXISTS'],
            ['key' => WebMaven_Pod_Guards::POD_PRODUCT_META, 'value' => '', 'compare' => '='],
        ];
        if ($kind === 'printed') {
            $args['meta_query'] = self::with_clause($args['meta_query'] ?? [], ['key' => WebMaven_Pod_Guards::POD_PRODUCT_META, 'value' => '', 'compare' => '!=']);
        } elseif ($kind === 'sample') {
            $args['meta_query'] = self::with_clause($args['meta_query'] ?? [], [
                'relation' => 'AND',
                ['key' => WebMaven_Pod_Guards::SAMPLE_META, 'value' => ['', '0'], 'compare' => 'NOT IN'],
                $not_printed,
            ]);
        } elseif ($kind === 'own') {
            $args['meta_query'] = self::with_clause($args['meta_query'] ?? [], $not_printed);
        }
        if (self::flag(self::param($request, 'wpmaven_no_photo'))) {
            $placeholder = (int) get_option('woocommerce_placeholder_image', 0);
            $empty = ['', '0'];
            if ($placeholder > 0) {
                $empty[] = (string) $placeholder;
            }
            $args['meta_query'] = self::with_clause($args['meta_query'] ?? [], [
                'relation' => 'OR',
                ['key' => '_thumbnail_id', 'compare' => 'NOT EXISTS'],
                ['key' => '_thumbnail_id', 'value' => $empty, 'compare' => 'IN'],
            ]);
        }
        return $args;
    }

    public static function media_params($params) {
        if (!is_array($params)) {
            return $params;
        }
        $params['wpmaven_no_alt'] = [
            'description' => 'Only images without a description for people who cannot see them.',
            'type' => 'boolean',
        ];
        $params['wpmaven_unused'] = [
            'description' => 'Only files the site does not use anywhere.',
            'type' => 'boolean',
        ];
        $params['wpmaven_uses'] = [
            'description' => 'Add how many places use each file.',
            'type' => 'boolean',
        ];
        return $params;
    }

    public static function media_query($args, $request) {
        if (!is_array($args)) {
            return $args;
        }
        if (self::flag(self::param($request, 'wpmaven_no_alt'))) {
            $args['meta_query'] = self::with_clause($args['meta_query'] ?? [], [
                'relation' => 'OR',
                ['key' => '_wp_attachment_image_alt', 'compare' => 'NOT EXISTS'],
                ['key' => '_wp_attachment_image_alt', 'value' => '', 'compare' => '='],
            ]);
            if (empty($args['post_mime_type'])) {
                $args['post_mime_type'] = 'image';
            }
        }
        if (self::flag(self::param($request, 'wpmaven_unused')) && class_exists('WebMaven_Media_Usage')) {
            $used = WebMaven_Media_Usage::used_ids();
            if ($used) {
                $not_in = array_map('intval', (array) ($args['post__not_in'] ?? []));
                $args['post__not_in'] = array_values(array_unique(array_merge($not_in, $used)));
            }
        }
        return $args;
    }

    public static function prepare_attachment($response, $post, $request) {
        if (!self::flag(self::param($request, 'wpmaven_uses')) || !class_exists('WebMaven_Media_Usage')
            || !is_object($response) || !method_exists($response, 'get_data')) {
            return $response;
        }
        $data = $response->get_data();
        if (!is_array($data)) {
            return $response;
        }
        $id = (int) (is_object($post) ? ($post->ID ?? 0) : ($data['id'] ?? 0));
        $data['wpmaven'] = ['uses' => WebMaven_Media_Usage::count_for($id)];
        $response->set_data($data);
        return $response;
    }

    /** One more clause, ANDed with what the query already holds. */
    private static function with_clause($meta_query, array $clause): array {
        $meta_query = is_array($meta_query) ? $meta_query : [];
        if (!$meta_query) {
            return [$clause];
        }
        return ['relation' => 'AND', $meta_query, $clause];
    }

    // ── Posts and pages ────────────────────────────────────────────────────

    public static function register_fields(): void {
        if (!function_exists('register_rest_field')) {
            return;
        }
        register_rest_field(['post', 'page'], 'wpmaven', [
            'get_callback' => [__CLASS__, 'post_field'],
            'schema' => [
                'description' => 'What WPMaven knows about this post.',
                'type' => 'object',
                'context' => ['edit'],
                'readonly' => true,
                'properties' => [
                    'designOwned' => ['type' => 'boolean', 'context' => ['edit'], 'readonly' => true],
                    'excerpt' => ['type' => 'string', 'context' => ['edit'], 'readonly' => true, 'description' => 'The excerpt as written, empty when there is none.'],
                    'summary' => ['type' => 'string', 'context' => ['edit'], 'readonly' => true, 'description' => 'The line under the title in a list: the excerpt, else the start of the text, plain and short.'],
                    'sitePage' => ['type' => 'string', 'context' => ['edit'], 'readonly' => true, 'description' => 'What the page is to the site ("the homepage", "the shop page"), which keeps it published; empty for any other.'],
                ],
            ],
        ]);
    }

    /** {designOwned, excerpt, summary, sitePage} for a user who can edit the post; null for anyone else. */
    public static function post_field($object) {
        $id = (int) (is_array($object) ? ($object['id'] ?? 0) : (is_object($object) ? ($object->ID ?? 0) : 0));
        if ($id <= 0 || !current_user_can('edit_post', $id)) {
            return null;
        }
        $post = get_post($id);
        // A page the site needs stays published (2026-10-19): the editor's page card says so before the owner tries.
        $site_page = $post && $post->post_type === 'page' && method_exists('WebMaven_Cap_Store', 'site_page')
            ? WebMaven_Cap_Store::site_page($id)
            : '';
        return [
            'designOwned' => (bool) get_post_meta($id, self::FULLHTML_META, true),
            'excerpt' => $post ? (string) $post->post_excerpt : '',
            'summary' => $post ? self::summary_of($post) : '',
            'sitePage' => $site_page,
        ];
    }

    /**
     * The line a list shows under a post's title, as plain text: its own
     * excerpt, else the start of its text, at most SUMMARY_CHARS characters.
     * It reads at most SUMMARY_SOURCE_BYTES of what WordPress stores and
     * never renders it: no block is parsed and no content filter runs, so a
     * post whose blocks do not close reads like any other.
     */
    public static function summary_of($post): string {
        $text = trim((string) $post->post_excerpt);
        if ($text === '') {
            $text = (string) $post->post_content;
        }
        $text = function_exists('mb_strcut')
            ? mb_strcut($text, 0, self::SUMMARY_SOURCE_BYTES, 'UTF-8')
            : substr($text, 0, self::SUMMARY_SOURCE_BYTES);
        // Block comments and what a reader never sees; one cut short at the end goes too.
        $text = (string) preg_replace('/<!--.*?(?:-->|$)/s', ' ', $text);
        $text = (string) preg_replace('#<(script|style|template|svg|noscript)\b.*?(?:</\1\s*>|$)#is', ' ', $text);
        if (function_exists('strip_shortcodes')) {
            $text = strip_shortcodes($text);
        }
        // Tags become spaces, so two paragraphs never run into one word.
        $text = (string) preg_replace('/<[^>]*(?:>|$)/', ' ', $text);
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $collapsed = preg_replace('/\s+/u', ' ', $text);
        $text = trim($collapsed === null ? (string) preg_replace('/\s+/', ' ', $text) : $collapsed);
        if (self::length($text) <= self::SUMMARY_CHARS) {
            return $text;
        }
        $cut = self::slice($text, self::SUMMARY_CHARS);
        $space = strrpos($cut, ' ');
        // At the last whole word, unless that loses too much.
        if ($space !== false && self::length(substr($cut, 0, $space)) > self::SUMMARY_CHARS * 0.6) {
            $cut = substr($cut, 0, $space);
        }
        return rtrim($cut, " ,;:.!?") . '…';
    }

    private static function length(string $text): int {
        return function_exists('mb_strlen') ? mb_strlen($text, 'UTF-8') : strlen($text);
    }

    private static function slice(string $text, int $chars): string {
        return function_exists('mb_substr') ? mb_substr($text, 0, $chars, 'UTF-8') : substr($text, 0, $chars);
    }

    // ── Writes ─────────────────────────────────────────────────────────────

    /** Products and variations: internal meta, then the floor, then the options lock. */
    public static function pre_insert_product($product, $request, $creating = false) {
        if (is_wp_error($product) || !is_object($product)) {
            return $product;
        }
        if (self::writes_internal_meta($product, $request)) {
            return new WP_Error('rest_forbidden_meta', self::forbidden_meta_text(), ['status' => 400]);
        }
        $floor = WebMaven_Pod_Guards::floor_problem($product);
        if ($floor !== null) {
            return new WP_Error('price_below_floor', $floor, ['status' => 400]);
        }
        $lock = WebMaven_Pod_Guards::options_problem($product, (bool) $creating);
        if ($lock !== null) {
            return new WP_Error('pod_options_locked', $lock, ['status' => 400]);
        }
        return $product;
    }

    /**
     * Orders: internal meta, marking a WPMaven Payments order paid by hand,
     * the Store's own rules for the six statuses, and on an order of ours a
     * status the Store would not offer.
     */
    public static function pre_insert_order($order, $request, $creating = false) {
        if (is_wp_error($order) || !is_object($order)) {
            return $order;
        }
        if (self::writes_internal_meta($order, $request)) {
            return new WP_Error('rest_forbidden_meta', self::forbidden_meta_text(), ['status' => 400]);
        }
        if ($creating) {
            return $order;
        }
        if (self::flag(self::param($request, 'set_paid')) && WebMaven_Pod_Guards::is_wpmaven_payments($order) && !$order->is_paid()) {
            return new WP_Error('status_not_allowed', self::PAID_BY_PAYMENT, ['status' => 400]);
        }
        $to = self::param($request, 'status');
        if (!is_string($to) || trim($to) === '') {
            return $order;
        }
        $to = WebMaven_Pod_Guards::bare_status(trim($to));
        if ($to === WebMaven_Pod_Guards::bare_status((string) $order->get_status())) {
            return $order;
        }
        // A status the Store does not offer ("refunded", one another plugin
        // added) is refused only on an order of ours: paid with WPMaven
        // Payments, or holding a printed line. Any other order is the owner's
        // and their tools': an outside client sets what WooCommerce itself
        // accepts, as before this plugin. The
        // Store's own screens and commands still offer the six for every
        // order (WebMaven_Pod_Guards::allowed_statuses).
        if (!in_array($to, WebMaven_Pod_Guards::STATUSES, true) && !self::order_is_ours($order)) {
            return $order;
        }
        $refusal = WebMaven_Pod_Guards::status_refusal($order, $to);
        return $refusal === null ? $order : new WP_Error('status_not_allowed', $refusal, ['status' => 400]);
    }

    /**
     * The order is ours as this write would leave it, or as the site holds
     * it now: a write that also names another payment method, or drops the
     * printed line, does not make it someone else's in the same breath.
     */
    private static function order_is_ours($order): bool {
        if (WebMaven_Pod_Guards::is_ours($order)) {
            return true;
        }
        $id = method_exists($order, 'get_id') ? (int) $order->get_id() : 0;
        $stored = $id > 0 && function_exists('wc_get_order') ? wc_get_order($id) : null;
        return is_object($stored) && $stored !== $order && WebMaven_Pod_Guards::is_ours($stored);
    }

    /** Deleting a printed product's variation through REST (one, or in a batch) is the options lock too. */
    public static function before_variation_delete($response, $handler, $request) {
        // Something earlier already answered (an error or a response): it stands.
        if ($response !== null || !is_object($request) || !method_exists($request, 'get_route') || WebMaven_Pod_Guards::is_trusted()) {
            return $response;
        }
        if (!preg_match(self::VARIATION_ROUTE, (string) $request->get_route(), $m)) {
            return $response;
        }
        $method = strtoupper((string) $request->get_method());
        $deletes = $m['target'] === 'batch' ? (array) self::param($request, 'delete') : ($method === 'DELETE' ? [(int) $m['target']] : []);
        if ($deletes && WebMaven_Pod_Guards::is_printed((int) $m['product'])) {
            return new WP_Error('pod_options_locked', WebMaven_Pod_Guards::options_locked_text(), ['status' => 400]);
        }
        return $response;
    }

    /** A write that names an internal meta key, by key or by the id of an internal meta row. */
    private static function writes_internal_meta($object, $request): bool {
        $entries = self::param($request, 'meta_data');
        if (!is_array($entries)) {
            return false;
        }
        foreach ($entries as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            if (self::is_internal_key($entry['key'] ?? null)) {
                return true;
            }
            $id = isset($entry['id']) && is_numeric($entry['id']) ? (int) $entry['id'] : 0;
            if ($id > 0 && method_exists($object, 'get_meta_data')) {
                foreach ((array) $object->get_meta_data() as $meta) {
                    $data = is_object($meta) && method_exists($meta, 'get_data') ? (array) $meta->get_data() : (array) $meta;
                    if ((int) ($data['id'] ?? 0) === $id && self::is_internal_key($data['key'] ?? null)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // ── Values ─────────────────────────────────────────────────────────────

    private static function param($request, string $key) {
        if (is_object($request) && method_exists($request, 'get_param')) {
            return $request->get_param($key);
        }
        if (is_array($request) || $request instanceof ArrayAccess) {
            return $request[$key] ?? null;
        }
        return null;
    }

    private static function flag($value): bool {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value)) {
            return $value === 1;
        }
        return is_string($value) && in_array(strtolower(trim($value)), ['1', 'true', 'yes', 'on'], true);
    }
}
