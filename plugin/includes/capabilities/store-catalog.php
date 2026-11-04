<?php
/**
 * Store reads for the API (2026-10-05): the catalog and the blog as the
 * dashboard's Store, Blog and Media pages and the edit engine read them.
 *
 *   store_context          {}                                  -> StoreContext
 *   store_products_list    {page, per_page, search, status, category, stock, kind, no_photo}
 *                                                              -> ListPage<StoreProductRow>
 *   store_categories_list  {}                                  -> {items: StoreCategory[]}
 *   store_floor_sync       {product_id, floors: [{variation_id, minor, currency}]} -> {written}
 *   store_product_find     {slug | key}                        -> {product_id}
 *   content_posts_list     {page, per_page, status, search}    -> ListPage<StorePostRow>
 *
 * Lists run an internal rest_do_request to WooCommerce's and WordPress's own
 * routes with whitelisted parameters, so they answer what the plugin app
 * reads, the REST enrichment included (WebMaven_Store_Rest_Filters). They run
 * as the webhook's administrator. Counts use the same filters.
 *
 * store_product_find finds a product by its design key (_wm_product_slug)
 * first, then by the name key woocommerce_create_product keeps
 * (_webmaven_product_key); a product found by its name key gets the design
 * key, so the next lookup finds it whatever its name becomes.
 *
 * Failures THROW "CODE: sentence" (NOT_FOUND, NO_STORE, VALIDATION). Never in
 * an answer: the _wm_ and _webmaven_ meta. Registered through the filter, so
 * the execute_command bridge (webhook_<name>) cannot reach these.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

require_once dirname(__DIR__) . '/class-webmaven-hosting.php';
require_once dirname(__DIR__) . '/class-webmaven-site-mail.php';

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['store_context'] = ['WebMaven_Cap_Store_Catalog', 'store_context'];
    $handlers['store_products_list'] = ['WebMaven_Cap_Store_Catalog', 'products_list'];
    $handlers['store_categories_list'] = ['WebMaven_Cap_Store_Catalog', 'categories_list'];
    $handlers['store_floor_sync'] = ['WebMaven_Cap_Store_Catalog', 'floor_sync'];
    $handlers['store_product_find'] = ['WebMaven_Cap_Store_Catalog', 'product_find'];
    $handlers['content_posts_list'] = ['WebMaven_Cap_Store_Catalog', 'posts_list'];
    return $handlers;
});

final class WebMaven_Cap_Store_Catalog {

    const PRODUCT_STATUSES = ['any', 'publish', 'draft', 'pending', 'private'];
    const STOCK_STATUSES = ['instock', 'outofstock', 'onbackorder'];
    const KINDS = ['own', 'sample', 'printed'];
    const POST_STATUSES = ['publish', 'draft', 'pending', 'private', 'future'];
    /** The product statuses REST's "any" covers (not trash, not auto-draft). */
    const LIVE_PRODUCT_STATUSES = ['publish', 'draft', 'pending', 'private', 'future'];

    const PRODUCT_FIELDS = 'id,name,type,status,price,regular_price,sale_price,stock_status,stock_quantity,manage_stock,categories,permalink,variations,date_modified_gmt,wpmaven';

    const DESIGN_KEY_META = '_wm_product_slug';
    const NAME_KEY_META = '_webmaven_product_key';

    private static function error(string $code, string $message): Exception {
        return new Exception($code . ': ' . $message);
    }

    // ── store_context ──────────────────────────────────────────────────────

    public static function store_context($params = [], $step_id = null) {
        return self::context();
    }

    /** StoreContext: the store's format, the counts the screens show, the upload limit, how replies leave. */
    public static function context(): array {
        $woo = self::woo_active();
        return [
            'woocommerce' => ['active' => $woo, 'version' => $woo && defined('WC_VERSION') ? (string) WC_VERSION : null],
            'money' => $woo ? self::money_format() : null,
            'units' => $woo ? self::units() : null,
            'paymentsWpmaven' => class_exists('WebMaven_Payments') && WebMaven_Payments::enabled(),
            'counts' => self::counts($woo),
            'uploads' => ['maxBytes' => function_exists('wp_max_upload_size') ? (int) wp_max_upload_size() : 0],
            'mail' => self::mail_mode(),
        ];
    }

    /** StoreMoneyFormat: WooCommerce's currency settings, the symbol decoded. */
    public static function money_format(): array {
        $position = (string) get_option('woocommerce_currency_pos', 'left');
        return [
            'code' => strtoupper(function_exists('get_woocommerce_currency') ? (string) get_woocommerce_currency() : (string) get_option('woocommerce_currency', '')),
            'symbol' => function_exists('get_woocommerce_currency_symbol') ? html_entity_decode((string) get_woocommerce_currency_symbol(), ENT_QUOTES, 'UTF-8') : '',
            'position' => in_array($position, ['left', 'right', 'left_space', 'right_space'], true) ? $position : 'left',
            'decimals' => function_exists('wc_get_price_decimals') ? (int) wc_get_price_decimals() : 2,
            'thousandSep' => function_exists('wc_get_price_thousand_separator') ? (string) wc_get_price_thousand_separator() : ',',
            'decimalSep' => function_exists('wc_get_price_decimal_separator') ? (string) wc_get_price_decimal_separator() : '.',
        ];
    }

    /** WooCommerce's weight and size units. */
    public static function units(): array {
        return [
            'weight' => (string) get_option('woocommerce_weight_unit', 'kg'),
            'dimension' => (string) get_option('woocommerce_dimension_unit', 'cm'),
        ];
    }

    /** 'relay' when WPMaven's mail relay sends this site's mail, else 'site'. */
    public static function mail_mode(): string {
        if (class_exists('WebMaven_Leads') && method_exists('WebMaven_Leads', 'mail_mode')) {
            return WebMaven_Leads::mail_mode() === 'relay' ? 'relay' : 'site';
        }
        if (WebMaven_Hosting::is_hosted_site() && !WebMaven_Site_Mail::smtp_plugin_active()) {
            return 'relay';
        }
        return 'site';
    }

    private static function woo_active(): bool {
        return function_exists('wc_get_product') && class_exists('WC_Product');
    }

    private static function counts(bool $woo): array {
        $counts = [
            'products' => 0, 'printed' => 0, 'samples' => 0, 'withoutPhoto' => 0,
            'ordersToShip' => 0, 'newMessages' => 0, 'imagesWithoutAlt' => 0, 'posts' => 0,
        ];
        if ($woo) {
            $counts['products'] = self::count_products([]);
            $counts['printed'] = self::count_products(['wpmaven_kind' => 'printed']);
            $counts['samples'] = self::count_products(['wpmaven_kind' => 'sample']);
            $counts['withoutPhoto'] = self::count_products(['wpmaven_no_photo' => true]);
            if (function_exists('wc_orders_count')) {
                $counts['ordersToShip'] = (int) wc_orders_count('processing') + (int) wc_orders_count('on-hold');
            }
        }
        if (class_exists('WebMaven_Leads') && method_exists('WebMaven_Leads', 'count_new')) {
            $counts['newMessages'] = (int) WebMaven_Leads::count_new();
        }
        $counts['imagesWithoutAlt'] = self::count_query(WebMaven_Store_Rest_Filters::media_query(
            ['post_type' => 'attachment', 'post_status' => 'inherit', 'post_mime_type' => 'image'],
            ['wpmaven_no_alt' => true]
        ));
        $posts = function_exists('wp_count_posts') ? wp_count_posts('post') : null;
        foreach (self::POST_STATUSES as $status) {
            $counts['posts'] += is_object($posts) ? (int) ($posts->$status ?? 0) : 0;
        }
        return $counts;
    }

    /** Products a filter of the products collection selects (the REST filters' own query). */
    private static function count_products(array $filters): int {
        $args = WebMaven_Store_Rest_Filters::product_query(['post_type' => 'product', 'post_status' => self::LIVE_PRODUCT_STATUSES], $filters);
        return self::count_query($args);
    }

    private static function count_query(array $args): int {
        $query = new WP_Query($args + [
            'posts_per_page' => 1,
            'fields' => 'ids',
            'no_found_rows' => false,
            'ignore_sticky_posts' => true,
            'update_post_meta_cache' => false,
            'update_post_term_cache' => false,
        ]);
        return (int) $query->found_posts;
    }

    // ── store_products_list ────────────────────────────────────────────────

    public static function products_list($params = [], $step_id = null) {
        self::require_store();
        $params = is_array($params) ? $params : [];
        $query = [
            'page' => self::page($params['page'] ?? null),
            'per_page' => self::per_page($params['per_page'] ?? null, 24, 50),
            'status' => self::one_of($params['status'] ?? 'any', self::PRODUCT_STATUSES, 'status'),
            '_fields' => self::PRODUCT_FIELDS,
        ];
        $search = self::search($params['search'] ?? '');
        if ($search !== '') {
            $query['search'] = $search;
        }
        if (isset($params['category']) && $params['category'] !== '') {
            $category = self::positive_int($params['category']);
            if ($category <= 0) {
                throw self::error('VALIDATION', 'category is a product category id.');
            }
            $query['category'] = (string) $category;
        }
        if (isset($params['stock']) && $params['stock'] !== '') {
            $query['stock_status'] = self::one_of($params['stock'], self::STOCK_STATUSES, 'stock');
        }
        if (isset($params['kind']) && $params['kind'] !== '') {
            $query['wpmaven_kind'] = self::one_of($params['kind'], self::KINDS, 'kind');
        }
        if (self::flag($params['no_photo'] ?? false)) {
            $query['wpmaven_no_photo'] = true;
        }
        list($items, $total, $pages) = self::rest_list('/wc/v3/products', $query);
        return ['items' => array_map([__CLASS__, 'product_row'], $items), 'total' => $total, 'totalPages' => $pages];
    }

    /** StoreProductRow from a wc/v3 product answer (with its wpmaven field). */
    public static function product_row(array $item): array {
        $id = (int) ($item['id'] ?? 0);
        $info = self::info_of($item);
        $type = (string) ($item['type'] ?? 'simple');
        $variable = $type === 'variable';
        $quantity = $item['stock_quantity'] ?? null;
        return [
            'id' => $id,
            'name' => self::text($item['name'] ?? ''),
            'type' => in_array($type, ['simple', 'variable', 'external', 'grouped'], true) ? $type : 'simple',
            'status' => (string) ($item['status'] ?? ''),
            'price' => WebMaven_Store_Rest_Filters::decimal($item['price'] ?? null),
            'regularPrice' => $variable ? null : WebMaven_Store_Rest_Filters::decimal($item['regular_price'] ?? null),
            'salePrice' => $variable ? null : WebMaven_Store_Rest_Filters::decimal($item['sale_price'] ?? null),
            'priceRange' => $info['priceRange'] ?? null,
            'stockStatus' => (string) ($item['stock_status'] ?? ''),
            'stockQuantity' => is_numeric($quantity) ? (int) $quantity : null,
            'manageStock' => ($item['manage_stock'] ?? false) === true,
            'imageUrl' => $info['imageUrl'] ?? null,
            'categories' => self::named_list($item['categories'] ?? []),
            'permalink' => (string) ($item['permalink'] ?? ''),
            'variations' => count((array) ($item['variations'] ?? [])),
            'modified' => (string) ($item['date_modified_gmt'] ?? ''),
            'wpmaven' => $info,
        ];
    }

    /** The answer's wpmaven field, or the same worked out from the product. */
    private static function info_of(array $item): array {
        if (is_array($item['wpmaven'] ?? null)) {
            return $item['wpmaven'];
        }
        $product = function_exists('wc_get_product') ? wc_get_product((int) ($item['id'] ?? 0)) : null;
        return $product ? WebMaven_Store_Rest_Filters::product_info($product) : [
            'kind' => 'own', 'designKey' => null, 'hasPhoto' => false, 'floor' => null,
            'cardSlots' => (object) [], 'priceRange' => null, 'imageUrl' => null,
        ];
    }

    // ── store_categories_list ──────────────────────────────────────────────

    public static function categories_list($params = [], $step_id = null) {
        self::require_store();
        $items = [];
        for ($page = 1; $page <= 10; $page++) {
            list($batch, , $pages) = self::rest_list('/wc/v3/products/categories', ['page' => $page, 'per_page' => 100, 'hide_empty' => false]);
            foreach ($batch as $category) {
                $items[] = [
                    'id' => (int) ($category['id'] ?? 0),
                    'name' => self::text($category['name'] ?? ''),
                    'parent' => (int) ($category['parent'] ?? 0),
                    'count' => (int) ($category['count'] ?? 0),
                ];
            }
            if ($page >= $pages || count($batch) < 100) {
                break;
            }
        }
        return ['items' => $items];
    }

    // ── store_floor_sync ───────────────────────────────────────────────────

    public static function floor_sync($params = [], $step_id = null) {
        self::require_store();
        $id = self::positive_int($params['product_id'] ?? null);
        $product = $id > 0 ? wc_get_product($id) : null;
        if (!$product || $product->is_type('variation')) {
            throw self::error('NOT_FOUND', 'Product ' . $id . ' was not found.');
        }
        if (!WebMaven_Pod_Guards::is_printed($id)) {
            throw self::error('VALIDATION', 'Only a printed product has a lowest price.');
        }
        $floors = $params['floors'] ?? null;
        if (!is_array($floors) || !$floors || count($floors) > 500) {
            throw self::error('VALIDATION', 'floors is a list of {variation_id, minor, currency}.');
        }
        $children = $product->is_type('variable') ? array_map('intval', (array) $product->get_children()) : [];
        $plan = [];
        foreach ($floors as $floor) {
            if (!is_array($floor) || !is_int($floor['minor'] ?? null) || $floor['minor'] < 0
                || !is_string($floor['currency'] ?? null) || !preg_match('/^[A-Za-z]{3}$/', $floor['currency'])) {
                throw self::error('VALIDATION', 'Each floor has a variation_id (or null), minor units and a currency.');
            }
            $variation = $floor['variation_id'] ?? null;
            if ($variation === null) {
                $target = $id;
            } else {
                $target = self::positive_int($variation);
                if (!in_array($target, $children, true)) {
                    throw self::error('NOT_FOUND', 'Option ' . $target . ' is not an option of this product.');
                }
            }
            $plan[] = [$target, $floor['minor'], $floor['currency']];
        }
        $written = 0;
        foreach ($plan as $entry) {
            if (WebMaven_Pod_Guards::write_floor($entry[0], $entry[1], $entry[2])) {
                $written++;
            }
        }
        return ['written' => $written];
    }

    // ── store_product_find ─────────────────────────────────────────────────

    public static function product_find($params = [], $step_id = null) {
        self::require_store();
        // The design key as woocommerce_create_product keeps it (a slug).
        $slug = is_string($params['slug'] ?? null) ? sanitize_title($params['slug']) : '';
        $key = is_string($params['key'] ?? null) ? trim($params['key']) : '';
        if (strlen($slug) > 200 || strlen($key) > 400) {
            throw self::error('VALIDATION', 'The design key or the name is too long.');
        }
        if ($slug === '' && $key === '') {
            throw self::error('VALIDATION', 'Name the product by its design key (slug) or its name key (key).');
        }
        if ($slug !== '') {
            $found = self::product_with_meta(self::DESIGN_KEY_META, $slug);
            if ($found > 0) {
                return ['product_id' => $found];
            }
        }
        if ($key !== '') {
            $name_key = class_exists('WebMaven_Webhook_Actions')
                ? (string) WebMaven_Webhook_Actions::product_upsert_key($key)
                : (function_exists('mb_strtolower') ? mb_strtolower(preg_replace('/\s+/u', ' ', $key), 'UTF-8') : strtolower($key));
            $found = $name_key !== '' ? self::product_with_meta(self::NAME_KEY_META, $name_key) : 0;
            if ($found > 0) {
                $design = (string) get_post_meta($found, self::DESIGN_KEY_META, true);
                if ($slug !== '' && $design !== '' && $design !== $slug) {
                    // Another product of the design: not the one asked for.
                    return ['product_id' => null];
                }
                if ($slug !== '' && $design === '') {
                    update_post_meta($found, self::DESIGN_KEY_META, $slug);
                }
                return ['product_id' => $found];
            }
        }
        return ['product_id' => null];
    }

    /** The oldest product (not trashed) with this meta value, or 0. */
    private static function product_with_meta(string $key, string $value): int {
        $ids = get_posts([
            'post_type' => 'product',
            'post_status' => 'any',
            'numberposts' => 1,
            'fields' => 'ids',
            'orderby' => 'ID',
            'order' => 'ASC',
            'meta_key' => $key,
            'meta_value' => $value,
        ]);
        return $ids ? (int) $ids[0] : 0;
    }

    // ── content_posts_list ─────────────────────────────────────────────────

    public static function posts_list($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        $query = [
            'context' => 'edit',
            'page' => self::page($params['page'] ?? null),
            'per_page' => self::per_page($params['per_page'] ?? null, 20, 50),
            'status' => self::statuses($params['status'] ?? null, self::POST_STATUSES),
            // What a row shows, never the post's content or WordPress's excerpt, which render it.
            '_fields' => WebMaven_Store_Rest_Filters::LIST_POST_FIELDS,
        ];
        $search = self::search($params['search'] ?? '');
        if ($search !== '') {
            $query['search'] = $search;
        }
        list($items, $total, $pages) = self::rest_list('/wp/v2/posts', $query);
        return ['items' => array_map([__CLASS__, 'post_row'], $items), 'total' => $total, 'totalPages' => $pages];
    }

    /** StorePostRow from a wp/v2 post answer (edit context). */
    public static function post_row(array $item): array {
        $id = (int) ($item['id'] ?? 0);
        $featured = (int) ($item['featured_media'] ?? 0);
        $raw = function ($field) use ($item) {
            $value = $item[$field] ?? '';
            return is_array($value) ? (string) ($value['raw'] ?? ($value['rendered'] ?? '')) : (string) $value;
        };
        $categories = [];
        foreach ((array) ($item['categories'] ?? []) as $term_id) {
            $term = get_term((int) $term_id, 'category');
            if ($term && !is_wp_error($term)) {
                $categories[] = ['id' => (int) $term->term_id, 'name' => self::text($term->name)];
            }
        }
        $tags = [];
        foreach ((array) ($item['tags'] ?? []) as $term_id) {
            $term = get_term((int) $term_id, 'post_tag');
            if ($term && !is_wp_error($term)) {
                $tags[] = self::text($term->name);
            }
        }
        $modified = (string) ($item['modified_gmt'] ?? '');
        return [
            'id' => $id,
            'title' => self::text($raw('title')),
            // The excerpt as written, from the wpmaven field (a list never asks WordPress for its excerpt).
            'excerpt' => self::text(wp_strip_all_tags(is_array($item['wpmaven'] ?? null) && isset($item['wpmaven']['excerpt'])
                ? (string) $item['wpmaven']['excerpt']
                : $raw('excerpt'))),
            'status' => (string) ($item['status'] ?? ''),
            'date' => (string) ($item['date'] ?? ''),
            'modifiedGmt' => $modified !== '' ? $modified : null,
            'slug' => (string) ($item['slug'] ?? ''),
            'link' => (string) ($item['link'] ?? ''),
            'featuredMediaId' => $featured > 0 ? $featured : null,
            'imageUrl' => $featured > 0 ? WebMaven_Store_Rest_Filters::image_url($featured) : null,
            'categories' => $categories,
            'tags' => $tags,
            'designOwned' => is_array($item['wpmaven'] ?? null)
                ? (bool) ($item['wpmaven']['designOwned'] ?? false)
                : (bool) get_post_meta($id, WebMaven_Store_Rest_Filters::FULLHTML_META, true),
        ];
    }

    // ── Internal REST ──────────────────────────────────────────────────────

    /**
     * One read of a REST collection, as the site's own REST answers it:
     * [items, total, totalPages].
     */
    public static function rest_list(string $route, array $query): array {
        $request = new WP_REST_Request('GET', $route);
        $request->set_query_params($query);
        $response = rest_do_request($request);
        if (!is_object($response) || !method_exists($response, 'get_data')) {
            throw self::error('VALIDATION', 'The site could not read ' . $route . '.');
        }
        if (method_exists($response, 'is_error') && $response->is_error()) {
            $error = $response->as_error();
            $status = (int) $response->get_status();
            if ($error->get_error_code() === 'rest_no_route') {
                throw self::error('NO_STORE', 'This site cannot read ' . $route . ': the plugin that answers it is not active.');
            }
            throw self::error($status === 404 ? 'NOT_FOUND' : 'VALIDATION', self::plain(wp_strip_all_tags((string) $error->get_error_message())));
        }
        $data = $response->get_data();
        $items = [];
        foreach (is_array($data) ? $data : [] as $item) {
            if (is_array($item)) {
                $items[] = $item;
            }
        }
        $headers = method_exists($response, 'get_headers') ? (array) $response->get_headers() : [];
        $total = isset($headers['X-WP-Total']) ? (int) $headers['X-WP-Total'] : count($items);
        $pages = isset($headers['X-WP-TotalPages']) ? (int) $headers['X-WP-TotalPages'] : ($items ? 1 : 0);
        return [$items, $total, $pages];
    }

    // ── Values ─────────────────────────────────────────────────────────────

    private static function require_store(): void {
        if (!self::woo_active()) {
            throw self::error('NO_STORE', 'WooCommerce is not active on this site, so it has no products.');
        }
    }

    private static function page($value): int {
        $page = self::positive_int($value);
        return $page > 0 ? min($page, 100000) : 1;
    }

    private static function per_page($value, int $default, int $max): int {
        $n = self::positive_int($value);
        return $n > 0 ? min($n, $max) : $default;
    }

    /** A status list ("publish,draft" or an array) from the allowed ones; all of them when none is named. */
    public static function statuses($value, array $allowed): array {
        if ($value === null || $value === '' || $value === []) {
            return $allowed;
        }
        $parts = is_array($value) ? $value : explode(',', (string) $value);
        $out = [];
        foreach ($parts as $part) {
            $status = is_string($part) ? trim($part) : '';
            if (!in_array($status, $allowed, true)) {
                throw self::error('VALIDATION', 'status must be one or more of: ' . implode(', ', $allowed) . '.');
            }
            $out[$status] = $status;
        }
        return array_values($out);
    }

    private static function search($value): string {
        if (!is_string($value)) {
            return '';
        }
        $search = trim(sanitize_text_field($value));
        return function_exists('mb_substr') ? mb_substr($search, 0, 100) : substr($search, 0, 100);
    }

    private static function one_of($value, array $allowed, string $what) {
        if (!in_array($value, $allowed, true)) {
            throw self::error('VALIDATION', $what . ' must be one of: ' . implode(', ', $allowed) . '.');
        }
        return $value;
    }

    private static function flag($value): bool {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value)) {
            return $value === 1;
        }
        return is_string($value) && in_array(strtolower(trim($value)), ['1', 'true', 'yes'], true);
    }

    /** [{id, name}] from a REST list of terms. */
    private static function named_list($list): array {
        $out = [];
        foreach ((array) $list as $entry) {
            if (is_array($entry)) {
                $out[] = ['id' => (int) ($entry['id'] ?? 0), 'name' => self::text($entry['name'] ?? '')];
            }
        }
        return $out;
    }

    /** Plain text as people read it: no markup, entities decoded. */
    public static function text($value): string {
        return trim(html_entity_decode(wp_strip_all_tags((string) $value), ENT_QUOTES, 'UTF-8'));
    }

    private static function positive_int($value): int {
        if (is_int($value)) {
            return $value > 0 ? $value : 0;
        }
        if (is_string($value) && preg_match('/^\d{1,18}$/', $value)) {
            return (int) $value;
        }
        return 0;
    }

    private static function plain(string $value): string {
        $value = preg_replace('/[\x00-\x1F\x7F]/', '', $value);
        return strlen($value) > 160 ? substr($value, 0, 157) . '...' : $value;
    }
}
