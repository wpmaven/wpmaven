<?php
/**
 * Printed products and order statuses (2026-10-05).
 *
 * WPMaven prints a printed product (meta _wm_pod_product) when someone buys
 * it, so three rules hold whatever door a change comes through:
 *
 *  - The price floor. The API works out the lowest price of each option
 *    (printing, shipping and the payment fee) and keeps it in
 *    _wm_price_floor ({minor, currency, at}) on the variation, or on the
 *    product (a simple product, or every option without its own). A floor in
 *    another currency than the store's is left out until the API writes a
 *    new one. A regular or sale price that changes to under the floor is put
 *    back to the stored price on every WooCommerce save
 *    (woocommerce_before_product_object_save: the product screen, quick
 *    edit, bulk edit, imports, other plugins), and the next WP-admin screen
 *    says why. The product screen shows the error in place, and WooCommerce
 *    REST answers 400 price_below_floor (WebMaven_Store_Rest_Filters).
 *  - The options lock. The colors and sizes are the ones WPMaven prints: no
 *    attribute change and no new or deleted variation on a printed product
 *    (hiding one stays possible).
 *  - The order status guard. A WPMaven Payments order turns paid only through
 *    the API's order_mark_paid, and an order with printed lines is completed
 *    by its shipping. allowed_statuses() is what the Store offers for any
 *    order. A WooCommerce REST write (an outside tool) is refused the rest
 *    only on an order of ours, is_ours(): on any other order it sets what
 *    WooCommerce itself accepts, "refunded" and another plugin's statuses
 *    included.
 *  - The coupon cap. A coupon never takes a printed line of a cart under its
 *    floor (floor x quantity), whoever made the coupon and whatever its kind:
 *    WooCommerce sends each line's share of a percentage, per product or cart
 *    amount coupon through woocommerce_coupon_get_discount_amount, and the
 *    line keeps what earlier coupons left. The order says which code took
 *    less, and the coupon screen says why.
 *
 * WPMaven's own catalog writer (woocommerce_create_product: a build and a new
 * design) runs inside trusted(): it writes the print data and the options
 * these guards keep.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Pod_Guards {

    const POD_PRODUCT_META = '_wm_pod_product';
    const SAMPLE_META = '_wm_sample_product';
    const FLOOR_META = '_wm_price_floor';
    /** Order meta: every shipment the API reported (capabilities/payments.php). */
    const TRACKING_META = '_wm_tracking';
    /** WebMaven_Payments::GATEWAY_ID, kept here so the guards stand alone. */
    const GATEWAY_ID = 'webmaven_payments';

    /** The statuses the Store offers: never refunded, checkout-draft or trash. */
    const STATUSES = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'failed'];

    /** User meta: what a put-back save tells the next WP-admin screen. */
    const NOTICES_META = 'wpmaven_store_notices';
    const NOTICES_MAX = 5;

    const PRICE_KEYS = ['regular_price', 'sale_price'];

    const OPTIONS_LOCKED = 'The colors and sizes of a printed product are the ones WPMaven prints. You can hide one, but not add, change or delete one.';
    const NOT_PAID = 'This order is not paid yet. It moves to Processing by itself once the payment is confirmed.';
    const PRINTING_NOT_SHIPPED = 'WPMaven prints part of this order. It turns Completed by itself when the printed items ship.';

    /** How many trusted() calls are running. */
    private static $trusted = 0;
    private static $started = false;

    /**
     * OPTIONS_LOCKED, PRINTING_NOT_SHIPPED and the notice after a put-back
     * save, as a person reads them on a site under an agency's or a partner's
     * brand (WebMaven_Brand): its name does the printing, and while the brand
     * has no name the sentence names nobody. Unchanged on a WPMaven site.
     */
    public static function options_locked_text(): string {
        if (!class_exists('WebMaven_Brand') || WebMaven_Brand::is_wpmaven()) {
            return self::OPTIONS_LOCKED;
        }
        return 'The colors and sizes of a printed product are ' . self::the_ones_printed() . ' You can hide one, but not add, change or delete one.';
    }

    public static function printing_not_shipped_text(): string {
        if (!class_exists('WebMaven_Brand') || WebMaven_Brand::is_wpmaven()) {
            return self::PRINTING_NOT_SHIPPED;
        }
        return (WebMaven_Brand::mode() === WebMaven_Brand::MODE_BRAND
            ? WebMaven_Brand::name() . ' prints part of this order.'
            : 'Part of this order is made to order.') . ' It turns Completed by itself when the printed items ship.';
    }

    /** '"Ceramic Mug" keeps its colors and sizes: they are the ones WPMaven prints.' */
    public static function options_kept_text(string $name): string {
        return '"' . $name . '" keeps its colors and sizes: they are ' . self::the_ones_printed();
    }

    /** "the ones WPMaven prints.", "the ones Acme Studio prints.", or "the ones that can be printed." */
    private static function the_ones_printed(): string {
        $brand = class_exists('WebMaven_Brand') ? WebMaven_Brand::name_or('') : 'WPMaven';
        return $brand !== '' ? 'the ones ' . $brand . ' prints.' : 'the ones that can be printed.';
    }

    public static function init(): void {
        if (self::$started) {
            return;
        }
        self::$started = true;
        // Late, so the values every other plugin set are the ones checked.
        add_action('woocommerce_before_product_object_save', [__CLASS__, 'before_save'], 1000, 1);
        add_action('woocommerce_before_product_variation_object_save', [__CLASS__, 'before_save'], 1000, 1);
        add_action('woocommerce_admin_process_product_object', [__CLASS__, 'admin_process'], 1000, 1);
        add_action('woocommerce_admin_process_variation_object', [__CLASS__, 'admin_process'], 1000, 1);
        foreach (['add_variation', 'link_all_variations', 'remove_variations'] as $ajax) {
            add_action('wp_ajax_woocommerce_' . $ajax, [__CLASS__, 'ajax_options_lock'], 1);
        }
        add_action('admin_notices', [__CLASS__, 'admin_notices']);
        add_filter('woocommerce_coupon_get_items_to_apply', [__CLASS__, 'coupon_items'], 1000, 3);
        add_filter('woocommerce_coupon_get_discount_amount', [__CLASS__, 'coupon_discount'], 1000, 5);
        add_action('woocommerce_after_calculate_totals', [__CLASS__, 'coupon_totals_done'], 1, 0);
        add_action('woocommerce_checkout_order_processed', [__CLASS__, 'coupon_order_note'], 10, 1);
        add_action('woocommerce_store_api_checkout_order_processed', [__CLASS__, 'coupon_order_note'], 10, 1);
        add_action('admin_notices', [__CLASS__, 'coupon_screen_notice']);
    }

    /** Runs $fn with the guards standing aside: WPMaven's own catalog writer. */
    public static function trusted(callable $fn) {
        self::$trusted++;
        try {
            return $fn();
        } finally {
            self::$trusted--;
        }
    }

    public static function is_trusted(): bool {
        return self::$trusted > 0;
    }

    // ── What a product is ──────────────────────────────────────────────────

    public static function is_printed(int $product_id): bool {
        return $product_id > 0 && (string) get_post_meta($product_id, self::POD_PRODUCT_META, true) !== '';
    }

    /** A product or a variation object whose product is printed. */
    public static function is_printed_object($product): bool {
        if (!is_object($product) || !method_exists($product, 'get_id')) {
            return false;
        }
        $parent = method_exists($product, 'get_parent_id') ? (int) $product->get_parent_id() : 0;
        return self::is_printed($parent > 0 ? $parent : (int) $product->get_id());
    }

    /** printed, else sample (a sample listing of an own product), else own. */
    public static function kind(int $product_id): string {
        if (self::is_printed($product_id)) {
            return 'printed';
        }
        return $product_id > 0 && !empty(get_post_meta($product_id, self::SAMPLE_META, true)) ? 'sample' : 'own';
    }

    // ── Money ──────────────────────────────────────────────────────────────

    public static function store_currency(): string {
        return strtoupper(function_exists('get_woocommerce_currency') ? (string) get_woocommerce_currency() : (string) get_option('woocommerce_currency', ''));
    }

    public static function decimals(): int {
        return function_exists('wc_get_price_decimals') ? max(0, (int) wc_get_price_decimals()) : 2;
    }

    public static function to_minor($price): int {
        return (int) round(((float) $price) * (10 ** self::decimals()));
    }

    /** Minor units as a WooCommerce decimal string with the store's decimals ("18.00"). */
    public static function decimal_of(int $minor): string {
        $decimals = self::decimals();
        return number_format($minor / (10 ** $decimals), $decimals, '.', '');
    }

    /** Minor units as the store writes prices ("$18.00", "18,00 €"), in plain text. */
    public static function money_text(int $minor): string {
        $decimals = self::decimals();
        $decimal_sep = function_exists('wc_get_price_decimal_separator') ? (string) wc_get_price_decimal_separator() : '.';
        $thousand_sep = function_exists('wc_get_price_thousand_separator') ? (string) wc_get_price_thousand_separator() : ',';
        $amount = number_format($minor / (10 ** $decimals), $decimals, $decimal_sep, $thousand_sep);
        $symbol = function_exists('get_woocommerce_currency_symbol')
            ? html_entity_decode((string) get_woocommerce_currency_symbol(), ENT_QUOTES, 'UTF-8')
            : self::store_currency();
        switch ((string) get_option('woocommerce_currency_pos', 'left')) {
            case 'right':
                return $amount . $symbol;
            case 'left_space':
                return $symbol . ' ' . $amount;
            case 'right_space':
                return $amount . ' ' . $symbol;
            default:
                return $symbol . $amount;
        }
    }

    // ── Floors ─────────────────────────────────────────────────────────────

    /** The stored floor of a product or a variation in minor units of the store currency, or null. */
    public static function floor_minor(int $id): ?int {
        if ($id <= 0) {
            return null;
        }
        $raw = get_post_meta($id, self::FLOOR_META, true);
        if (is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);
            $raw = is_array($decoded) ? $decoded : null;
        }
        if (!is_array($raw) || !isset($raw['minor']) || !is_numeric($raw['minor']) || (int) $raw['minor'] < 0) {
            return null;
        }
        $currency = strtoupper(trim((string) ($raw['currency'] ?? '')));
        return $currency !== '' && $currency === self::store_currency() ? (int) $raw['minor'] : null;
    }

    /** The floor a product or a variation object sells above: its own, else its product's. Printed products only. */
    public static function applicable_floor($product): ?int {
        if (!self::is_printed_object($product)) {
            return null;
        }
        $own = self::floor_minor((int) $product->get_id());
        if ($own !== null) {
            return $own;
        }
        $parent = method_exists($product, 'get_parent_id') ? (int) $product->get_parent_id() : 0;
        return $parent > 0 ? self::floor_minor($parent) : null;
    }

    /** A product's floor as the Store shows it: the lowest floor of its options on sale, or its own. */
    public static function product_floor($product): ?int {
        if (!self::is_printed_object($product)) {
            return null;
        }
        $own = self::floor_minor((int) $product->get_id());
        if (!$product->is_type('variable')) {
            return $own;
        }
        $lowest = null;
        foreach ((array) $product->get_children() as $vid) {
            if (get_post_status((int) $vid) !== 'publish') {
                continue;
            }
            $floor = self::floor_minor((int) $vid);
            if ($floor === null) {
                $floor = $own;
            }
            if ($floor !== null && ($lowest === null || $floor < $lowest)) {
                $lowest = $floor;
            }
        }
        return $lowest !== null ? $lowest : $own;
    }

    /** The stored floors of a printed product by variation id (0: the product itself). */
    public static function stored_floors($product): array {
        if (!self::is_printed_object($product)) {
            return [];
        }
        $out = [];
        $own = self::floor_minor((int) $product->get_id());
        if ($own !== null) {
            $out[0] = $own;
        }
        if ($product->is_type('variable')) {
            foreach ((array) $product->get_children() as $vid) {
                $floor = self::floor_minor((int) $vid);
                if ($floor !== null) {
                    $out[(int) $vid] = $floor;
                }
            }
        }
        return $out;
    }

    /** Keeps a floor the API worked out. Answers whether the stored floor changed. */
    public static function write_floor(int $id, int $minor, string $currency): bool {
        $currency = strtoupper(trim($currency));
        $current = get_post_meta($id, self::FLOOR_META, true);
        if (is_array($current) && isset($current['minor']) && (int) $current['minor'] === $minor
            && strtoupper((string) ($current['currency'] ?? '')) === $currency) {
            return false;
        }
        update_post_meta($id, self::FLOOR_META, ['minor' => $minor, 'currency' => $currency, 'at' => gmdate('Y-m-d\TH:i:s\Z')]);
        return true;
    }

    /** "Ceramic Mug - Black": at least $17.00 so printing, shipping and fees are covered. */
    public static function floor_sentence($product, int $floor): string {
        return '"' . self::name_of($product) . '": at least ' . self::money_text($floor) . ' so printing, shipping and fees are covered.';
    }

    /** The sentence refusing a price an object is about to save under its floor, or null. */
    public static function floor_problem($product): ?string {
        if (!self::prices_under_floor($product)) {
            return null;
        }
        return self::floor_sentence($product, (int) self::applicable_floor($product));
    }

    /**
     * The price keys of an object's pending changes that go under its floor.
     * Only a price that changes is read: a price stored before the floor
     * rose stays until someone changes it.
     */
    private static function prices_under_floor($product): array {
        if (self::is_trusted() || !is_object($product) || !method_exists($product, 'get_changes')) {
            return [];
        }
        $floor = self::applicable_floor($product);
        if ($floor === null) {
            return [];
        }
        $changes = (array) $product->get_changes();
        $stored = method_exists($product, 'get_data') ? (array) $product->get_data() : [];
        $out = [];
        foreach (self::PRICE_KEYS as $key) {
            if (!array_key_exists($key, $changes)) {
                continue;
            }
            $new = trim((string) $changes[$key]);
            if ($new === '' || !is_numeric($new)) {
                continue;
            }
            $old = trim((string) ($stored[$key] ?? ''));
            if ($old !== '' && is_numeric($old) && self::to_minor($old) === self::to_minor($new)) {
                continue;
            }
            if (self::to_minor($new) < $floor) {
                $out[] = $key;
            }
        }
        return $out;
    }

    // ── The options lock ───────────────────────────────────────────────────

    /** The sentence refusing a change to a printed product's options, or null. */
    public static function options_problem($product, bool $creating = false): ?string {
        if (self::is_trusted() || !is_object($product) || !self::is_printed_object($product)) {
            return null;
        }
        if ($product->is_type('variation') && ($creating || (int) $product->get_id() <= 0)) {
            return self::options_locked_text();
        }
        return self::options_changed($product) ? self::options_locked_text() : null;
    }

    /** True when a save would change the colors or sizes of a printed product, or of one of its options. */
    public static function options_changed($product): bool {
        if (self::is_trusted() || !self::is_printed_object($product) || !method_exists($product, 'get_changes')) {
            return false;
        }
        $changes = (array) $product->get_changes();
        if (!array_key_exists('attributes', $changes)) {
            return false;
        }
        $stored = method_exists($product, 'get_data') ? (array) $product->get_data() : [];
        return self::attributes_key($stored['attributes'] ?? []) !== self::attributes_key($changes['attributes']);
    }

    /** Attributes reduced to what the lock compares: names, values and whether variations use them. */
    private static function attributes_key($attributes): string {
        $out = [];
        foreach ((array) $attributes as $key => $attribute) {
            if (is_object($attribute) && method_exists($attribute, 'get_options')) {
                $options = array_map('strval', (array) $attribute->get_options());
                sort($options);
                $variation = method_exists($attribute, 'get_variation') ? (bool) $attribute->get_variation() : false;
                $out[sanitize_title((string) $attribute->get_name())] = [$options, $variation];
            } else {
                // A variation's own attributes: attribute => value.
                $out[sanitize_title(preg_replace('/^attribute_/', '', (string) $key))] = sanitize_title((string) $attribute);
            }
        }
        ksort($out);
        return (string) wp_json_encode($out);
    }

    // ── The WooCommerce doors ──────────────────────────────────────────────

    /**
     * Every WooCommerce save: a price under the floor and a change to a
     * printed product's options are put back to the stored values, and the
     * next WP-admin screen says why.
     */
    public static function before_save($product): void {
        if (self::is_trusted() || !is_object($product) || !method_exists($product, 'get_changes')) {
            return;
        }
        $prices = self::prices_under_floor($product);
        if ($prices) {
            $floor = (int) self::applicable_floor($product);
            $stored = (array) $product->get_data();
            foreach ($prices as $key) {
                $product->{'set_' . $key}((string) ($stored[$key] ?? ''));
            }
            self::notice('"' . self::name_of($product) . '" keeps its price: at least ' . self::money_text($floor) . ' so printing, shipping and fees are covered.');
        }
        // A new object has no stored options to put back (a new option is refused at the REST and WP-admin doors).
        if ((int) $product->get_id() > 0 && self::options_changed($product)) {
            $stored = (array) $product->get_data();
            $product->set_attributes($stored['attributes'] ?? []);
            self::notice(self::options_kept_text(self::name_of($product)));
        }
    }

    /** The product screen (and its variations): the error shows in place, and the stored values stay. */
    public static function admin_process($product): void {
        if (self::is_trusted() || !is_object($product) || !method_exists($product, 'get_changes')) {
            return;
        }
        $prices = self::prices_under_floor($product);
        if ($prices) {
            $sentence = self::floor_sentence($product, (int) self::applicable_floor($product));
            $stored = (array) $product->get_data();
            foreach ($prices as $key) {
                $product->{'set_' . $key}((string) ($stored[$key] ?? ''));
            }
            self::screen_error($sentence);
        }
        if (self::options_changed($product)) {
            $stored = (array) $product->get_data();
            $product->set_attributes($stored['attributes'] ?? []);
            self::screen_error(self::options_locked_text());
        }
    }

    /** WooCommerce's "Add variation", "Generate variations" and "Remove" buttons on a printed product. */
    public static function ajax_options_lock(): void {
        if (self::is_trusted()) {
            return;
        }
        $ids = [];
        // phpcs:disable WordPress.Security.NonceVerification -- read only to refuse; WooCommerce checks its own nonce after.
        if (isset($_POST['post_id'])) {
            $ids[] = absint(wp_unslash($_POST['post_id']));
        }
        if (isset($_POST['variation_ids']) && is_array($_POST['variation_ids'])) {
            foreach (array_map('absint', (array) wp_unslash($_POST['variation_ids'])) as $variation_id) {
                $ids[] = (int) wp_get_post_parent_id(absint($variation_id));
            }
        }
        // phpcs:enable
        foreach (array_unique(array_filter($ids)) as $id) {
            if (self::is_printed((int) $id)) {
                wp_die(esc_html(self::options_locked_text()), '', ['response' => 403]);
            }
        }
    }

    private static function screen_error(string $text): void {
        if (class_exists('WC_Admin_Meta_Boxes') && method_exists('WC_Admin_Meta_Boxes', 'add_error')) {
            WC_Admin_Meta_Boxes::add_error($text);
            return;
        }
        self::notice($text);
    }

    /** Keeps a sentence for the signed-in user's next WP-admin screen (never outside WP admin). */
    public static function notice(string $text): void {
        $user = function_exists('get_current_user_id') ? (int) get_current_user_id() : 0;
        if ($user <= 0 || !function_exists('is_admin') || !is_admin()) {
            return;
        }
        $list = get_user_meta($user, self::NOTICES_META, true);
        $list = is_array($list) ? $list : [];
        if (!in_array($text, $list, true)) {
            $list[] = $text;
        }
        update_user_meta($user, self::NOTICES_META, array_slice($list, -self::NOTICES_MAX));
    }

    public static function admin_notices(): void {
        $user = (int) get_current_user_id();
        if ($user <= 0) {
            return;
        }
        $list = get_user_meta($user, self::NOTICES_META, true);
        if (!is_array($list) || !$list) {
            return;
        }
        delete_user_meta($user, self::NOTICES_META);
        foreach ($list as $text) {
            echo '<div class="notice notice-warning is-dismissible"><p>' . esc_html((string) $text) . '</p></div>';
        }
    }

    // ── Coupons ────────────────────────────────────────────────────────────

    const COUPON_SCREEN_NOTE = 'On printed products a coupon takes off less when it would go under the price that covers printing, shipping and fees.';

    /** WooCommerce's discounts of the cart being worked out, while its coupons apply. */
    private static $cart_discounts = null;
    /** Coupon code => names of the printed products it took less off, this request. */
    private static $capped = [];

    /**
     * woocommerce_coupon_get_items_to_apply: keeps the cart's discounts
     * object, so coupon_discount() knows what each line already got.
     */
    public static function coupon_items($items, $coupon = null, $discounts = null) {
        if (is_object($discounts) && method_exists($discounts, 'get_object') && class_exists('WC_Cart')
            && $discounts->get_object() instanceof WC_Cart) {
            self::$cart_discounts = $discounts;
        }
        return $items;
    }

    /** The cart's totals are done: the discounts object is not read again. */
    public static function coupon_totals_done(): void {
        self::$cart_discounts = null;
    }

    /**
     * woocommerce_coupon_get_discount_amount: what a coupon takes off one cart
     * line ($single: off one unit of it, for coupon kinds other plugins add),
     * capped so a printed line keeps at least its floor x quantity.
     */
    public static function coupon_discount($discount, $discounting_amount = 0, $cart_item = null, $single = false, $coupon = null) {
        if (!is_array($cart_item) || !isset($cart_item['data']) || !is_object($cart_item['data'])
            || !is_numeric($discount) || (float) $discount <= 0) {
            return $discount;
        }
        $product = $cart_item['data'];
        $floor = self::applicable_floor($product);
        if ($floor === null) {
            return $discount;
        }
        $quantity = max(1, (int) ceil((float) ($cart_item['quantity'] ?? 1)));
        $room = self::coupon_room($cart_item, $floor * $quantity, $quantity);
        $cap = $single ? intdiv($room, $quantity) : $room;
        if (self::to_minor($discount) <= $cap) {
            return $discount;
        }
        if (is_object($coupon) && method_exists($coupon, 'get_code')) {
            self::$capped[(string) $coupon->get_code()][self::name_of($product)] = true;
        }
        return (float) self::decimal_of($cap);
    }

    /**
     * Minor units a coupon may still take off a printed line: the line's
     * price, less floor x quantity, less what the coupons before it took
     * (WooCommerce's own running total when it is known).
     */
    private static function coupon_room(array $cart_item, int $floor_total, int $quantity): int {
        $key = (string) ($cart_item['key'] ?? '');
        $discounts = self::$cart_discounts;
        if ($discounts !== null && $key !== '' && method_exists($discounts, 'get_items') && method_exists($discounts, 'get_discount')) {
            $items = (array) $discounts->get_items();
            if (isset($items[$key]) && is_object($items[$key]) && isset($items[$key]->price)) {
                $price = (int) round((float) $items[$key]->price);
                $taken = (int) round((float) $discounts->get_discount($key, true));
                return max(0, $price - $floor_total - $taken);
            }
        }
        $product = $cart_item['data'];
        $unit = is_callable([$product, 'get_price']) ? self::to_minor($product->get_price()) : 0;
        return max(0, $unit * $quantity - $floor_total);
    }

    /** The order says which code took less off which printed products (classic and block checkout). */
    public static function coupon_order_note($order): void {
        if (!self::$capped) {
            return;
        }
        if (!is_object($order) && function_exists('wc_get_order')) {
            $order = wc_get_order((int) $order);
        }
        if (!is_object($order) || !method_exists($order, 'add_order_note')) {
            return;
        }
        foreach (self::$capped as $code => $names) {
            $order->add_order_note(self::coupon_capped_text((string) $code, array_keys($names)));
        }
        self::$capped = [];
    }

    /** 'The code WELCOME10 took less off "Ceramic Mug" so its price still covers printing, shipping and fees.' */
    public static function coupon_capped_text(string $code, array $names): string {
        $quoted = array_map(function ($name) {
            return '"' . $name . '"';
        }, array_values(array_filter(array_map('strval', $names), 'strlen')));
        if (count($quoted) > 1) {
            $last = array_pop($quoted);
            return 'The code ' . $code . ' took less off ' . implode(', ', $quoted) . ' and ' . $last
                . ' so their prices still cover printing, shipping and fees.';
        }
        return 'The code ' . $code . ' took less off ' . ($quoted[0] ?? 'a printed product')
            . ' so its price still covers printing, shipping and fees.';
    }

    /** The coupon screens of a store that sells printed products say what the cap does. */
    public static function coupon_screen_notice(): void {
        if (!function_exists('get_current_screen')) {
            return;
        }
        $screen = get_current_screen();
        if (!is_object($screen) || (string) ($screen->post_type ?? '') !== 'shop_coupon' || !self::store_has_printed_products()) {
            return;
        }
        echo '<div class="notice notice-info"><p>' . esc_html(self::COUPON_SCREEN_NOTE) . '</p></div>';
    }

    private static function store_has_printed_products(): bool {
        if (!function_exists('get_posts')) {
            return false;
        }
        return (bool) get_posts([
            'post_type' => 'product',
            'post_status' => ['publish', 'private', 'draft'],
            'meta_key' => self::POD_PRODUCT_META,
            'posts_per_page' => 1,
            'fields' => 'ids',
            'no_found_rows' => true,
        ]);
    }

    private static function name_of($product): string {
        $name = method_exists($product, 'get_name') ? (string) $product->get_name('edit') : '';
        $name = preg_replace('/[\x00-\x1F\x7F]/', '', html_entity_decode(wp_strip_all_tags($name), ENT_QUOTES, 'UTF-8'));
        return strlen($name) > 120 ? substr($name, 0, 117) . '...' : $name;
    }

    // ── Order statuses ─────────────────────────────────────────────────────

    /** "wc-processing" or "processing": "processing". */
    public static function bare_status(string $status): string {
        return strpos($status, 'wc-') === 0 ? substr($status, 3) : $status;
    }

    public static function is_wpmaven_payments($order): bool {
        $gateway = class_exists('WebMaven_Payments') ? WebMaven_Payments::GATEWAY_ID : self::GATEWAY_ID;
        return is_object($order) && (string) $order->get_payment_method() === $gateway;
    }

    /** At least one line of the order is a printed product. */
    public static function has_printed_lines($order): bool {
        if (!is_object($order) || !method_exists($order, 'get_items')) {
            return false;
        }
        foreach ((array) $order->get_items('line_item') as $item) {
            if (is_object($item) && method_exists($item, 'get_product_id') && self::is_printed((int) $item->get_product_id())) {
                return true;
            }
        }
        return false;
    }

    /**
     * An order of ours: paid with WPMaven Payments, or holding at least one
     * printed line. Its money and its printing follow their own events, so an
     * outside write keeps to the statuses the Store offers. Any other order
     * is the owner's and their tools' (WebMaven_Store_Rest_Filters).
     */
    public static function is_ours($order): bool {
        return self::is_wpmaven_payments($order) || self::has_printed_lines($order);
    }

    /** The printed part of the order shipped (the API reported a parcel). */
    public static function printing_shipped($order): bool {
        $shipments = $order->get_meta(self::TRACKING_META, true);
        return is_array($shipments) && $shipments !== [];
    }

    /** Why an order may not move to a status (an owner sentence), or null when it may. */
    public static function status_refusal($order, string $to): ?string {
        $to = self::bare_status(trim($to));
        if (!in_array($to, self::STATUSES, true)) {
            return 'An order cannot be set to "' . self::status_label($to) . '" here.';
        }
        if ($to === self::bare_status((string) $order->get_status())) {
            return 'This order is already "' . self::status_label($to) . '".';
        }
        if (in_array($to, ['processing', 'completed'], true) && self::is_wpmaven_payments($order) && !$order->is_paid()) {
            return self::NOT_PAID;
        }
        if ($to === 'completed' && self::has_printed_lines($order) && !self::printing_shipped($order)) {
            return self::printing_not_shipped_text();
        }
        return null;
    }

    public static function order_status_allowed($order, string $to): bool {
        return self::status_refusal($order, $to) === null;
    }

    /** The statuses the Store offers for an order, in WooCommerce's names without "wc-". */
    public static function allowed_statuses($order): array {
        $out = [];
        foreach (self::STATUSES as $to) {
            if (self::order_status_allowed($order, $to)) {
                $out[] = $to;
            }
        }
        return $out;
    }

    private static function status_label(string $status): string {
        $label = function_exists('wc_get_order_status_name') ? (string) wc_get_order_status_name($status) : '';
        $label = trim(wp_strip_all_tags($label !== '' ? $label : ucfirst(str_replace('-', ' ', $status))));
        return substr(preg_replace('/[\x00-\x1F\x7F"]/', '', $label), 0, 40);
    }
}
