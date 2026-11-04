<?php
/**
 * The store's coupons for the API (2026-10-08): the chat reads them, makes
 * one, changes one or stops one, through WooCommerce's own coupon objects
 * (WC_Coupon), never as post meta, so its checks and caches apply. A coupon
 * never takes a printed product under its floor (WebMaven_Pod_Guards caps
 * every coupon at checkout, whoever made it); the answers say whether the
 * store sells printed products, so the owner reads it before saying yes.
 *
 *   store_coupons_list  {status: active|expired|all, search, code} -> {items: [CouponRow], printedProducts}
 *   store_coupon_save   {mode: create|update, code, discount_type, amount, description, expires (YYYY-MM-DD),
 *                        usage_limit, usage_limit_per_user, minimum_amount, free_shipping, individual_use,
 *                        product_ids, excluded_product_ids, category_ids} -> {coupon: CouponRow, created}
 *   store_coupon_expire {code} -> {coupon: CouponRow}
 *
 * expires is the last day the coupon works, to its end in the site's time
 * zone. Expiring sets the end to now and keeps the coupon and its usage.
 * Failures THROW "CODE: sentence" (NO_STORE, NOT_FOUND, VALIDATION,
 * CODE_TAKEN, WRITE_FAILED). Registered through the filter, so the
 * execute_command bridge cannot reach these.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

if (!class_exists('WebMaven_Store_Periods')) {
    require_once dirname(__DIR__) . '/class-webmaven-store-periods.php';
}

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['store_coupons_list'] = ['WebMaven_Cap_Store_Coupons', 'coupons_list'];
    $handlers['store_coupon_save'] = ['WebMaven_Cap_Store_Coupons', 'coupon_save'];
    $handlers['store_coupon_expire'] = ['WebMaven_Cap_Store_Coupons', 'coupon_expire'];
    return $handlers;
});

final class WebMaven_Cap_Store_Coupons {

    const TYPES = ['percent', 'fixed_cart', 'fixed_product'];
    const LIST_MAX = 200;
    const CODE_MAX = 50;
    const DESCRIPTION_MAX = 500;
    const IDS_MAX = 100;
    const FIELDS = [
        'mode', 'code', 'discount_type', 'amount', 'description', 'expires', 'usage_limit', 'usage_limit_per_user',
        'minimum_amount', 'free_shipping', 'individual_use', 'product_ids', 'excluded_product_ids', 'category_ids',
    ];

    private static function error(string $code, string $message): Exception {
        return new Exception($code . ': ' . $message);
    }

    // ── store_coupons_list ─────────────────────────────────────────────────

    public static function coupons_list($params = [], $step_id = null) {
        self::require_store();
        $p = is_array($params) ? $params : [];
        $status = $p['status'] ?? 'all';
        if (!in_array($status, ['active', 'expired', 'all'], true)) {
            throw self::error('VALIDATION', 'status is active, expired or all.');
        }
        $printed = self::printed_products();
        if (is_string($p['code'] ?? null) && trim($p['code']) !== '') {
            return ['items' => [self::row(self::by_code($p['code']))], 'printedProducts' => $printed];
        }
        $search = is_string($p['search'] ?? null) ? trim(sanitize_text_field($p['search'])) : '';
        $ids = get_posts([
            'post_type' => 'shop_coupon',
            'post_status' => 'publish',
            'numberposts' => self::LIST_MAX,
            'orderby' => 'date',
            'order' => 'DESC',
            'fields' => 'ids',
            's' => $search,
        ]);
        $items = [];
        foreach ((array) $ids as $id) {
            $id = is_object($id) ? (int) $id->ID : (int) $id;
            $coupon = $id > 0 ? new WC_Coupon($id) : null;
            if (!$coupon || !$coupon->get_id()) {
                continue;
            }
            $row = self::row($coupon);
            if ($status === 'all' || $row['status'] === $status) {
                $items[] = $row;
            }
        }
        return ['items' => $items, 'printedProducts' => $printed];
    }

    // ── store_coupon_save ──────────────────────────────────────────────────

    public static function coupon_save($params = [], $step_id = null) {
        self::require_store();
        $p = is_array($params) ? $params : [];
        foreach (array_keys($p) as $key) {
            if (!in_array($key, self::FIELDS, true)) {
                throw self::error('VALIDATION', 'Unknown coupon field: ' . preg_replace('/[^A-Za-z0-9_]/', '', (string) $key) . '.');
            }
        }
        $mode = $p['mode'] ?? 'create';
        if (!in_array($mode, ['create', 'update'], true)) {
            throw self::error('VALIDATION', 'mode is create or update.');
        }
        $code = self::code($p['code'] ?? null);
        $existing = function_exists('wc_get_coupon_id_by_code') ? (int) wc_get_coupon_id_by_code($code) : 0;
        if ($mode === 'create') {
            if ($existing > 0) {
                throw self::error('CODE_TAKEN', 'The code "' . $code . '" is already used by another coupon in your store. Choose another code, or change that coupon.');
            }
            if (!array_key_exists('discount_type', $p) || !array_key_exists('amount', $p)) {
                throw self::error('VALIDATION', 'A new coupon needs its kind of discount and its amount.');
            }
            $coupon = new WC_Coupon();
            $coupon->set_code($code);
        } else {
            if ($existing <= 0) {
                throw self::error('NOT_FOUND', 'There is no coupon "' . $code . '" in your store.');
            }
            $coupon = new WC_Coupon($existing);
        }

        // Everything is checked before anything is set.
        $set = [];
        $type = array_key_exists('discount_type', $p) ? $p['discount_type'] : $coupon->get_discount_type();
        if (!in_array($type, self::TYPES, true)) {
            throw self::error('VALIDATION', 'The discount is a percentage (percent), an amount off the cart (fixed_cart) or an amount off each product (fixed_product).');
        }
        if (array_key_exists('discount_type', $p)) {
            $set['discount_type'] = $type;
        }
        if (array_key_exists('amount', $p) || array_key_exists('discount_type', $p)) {
            $amount = array_key_exists('amount', $p) ? $p['amount'] : $coupon->get_amount();
            if (!is_numeric($amount) || (float) $amount <= 0) {
                throw self::error('VALIDATION', 'The discount must be a number above zero.');
            }
            if ($type === 'percent' && (float) $amount > 100) {
                throw self::error('VALIDATION', 'A coupon can take at most 100% off.');
            }
            $set['amount'] = (string) (0 + $amount);
        }
        if (array_key_exists('description', $p)) {
            $description = is_string($p['description']) ? trim(sanitize_textarea_field($p['description'])) : '';
            if (strlen($description) > self::DESCRIPTION_MAX) {
                throw self::error('VALIDATION', 'The description has at most 500 characters.');
            }
            $set['description'] = $description;
        }
        if (array_key_exists('expires', $p)) {
            $set['date_expires'] = self::expiry($p['expires']);
        }
        foreach (['usage_limit', 'usage_limit_per_user'] as $key) {
            if (array_key_exists($key, $p)) {
                $set[$key] = self::count($p[$key], $key);
            }
        }
        if (array_key_exists('minimum_amount', $p)) {
            $minimum = $p['minimum_amount'];
            if ($minimum !== null && $minimum !== '' && (!is_numeric($minimum) || (float) $minimum < 0)) {
                throw self::error('VALIDATION', 'The minimum spend is an amount, or nothing.');
            }
            $set['minimum_amount'] = $minimum === null || $minimum === '' ? '' : (string) (0 + $minimum);
        }
        foreach (['free_shipping', 'individual_use'] as $key) {
            if (array_key_exists($key, $p)) {
                if (!is_bool($p[$key])) {
                    throw self::error('VALIDATION', $key . ' must be true or false.');
                }
                $set[$key] = $p[$key];
            }
        }
        foreach (['product_ids', 'excluded_product_ids'] as $key) {
            if (array_key_exists($key, $p)) {
                $set[$key] = self::product_ids($p[$key]);
            }
        }
        if (array_key_exists('category_ids', $p)) {
            $set['product_categories'] = self::category_ids($p['category_ids']);
        }
        if ($mode === 'update' && !$set) {
            throw self::error('VALIDATION', 'Say what changes on the coupon.');
        }

        foreach ($set as $key => $value) {
            $setter = 'set_' . $key;
            $coupon->$setter($value);
        }
        $id = (int) $coupon->save();
        if ($id <= 0) {
            throw self::error('WRITE_FAILED', 'The coupon was not saved. Try again.');
        }
        return ['coupon' => self::row(new WC_Coupon($id)), 'created' => $mode === 'create', 'printedProducts' => self::printed_products()];
    }

    // ── store_coupon_expire ────────────────────────────────────────────────

    public static function coupon_expire($params = [], $step_id = null) {
        self::require_store();
        $p = is_array($params) ? $params : [];
        $coupon = self::by_code($p['code'] ?? null);
        $coupon->set_date_expires(time());
        if ((int) $coupon->save() <= 0) {
            throw self::error('WRITE_FAILED', 'The coupon was not stopped. Try again.');
        }
        return ['coupon' => self::row(new WC_Coupon((int) $coupon->get_id()))];
    }

    // ── Values ─────────────────────────────────────────────────────────────

    /** CouponRow: what the chat and its cards read. */
    public static function row($coupon): array {
        $expires = $coupon->get_date_expires();
        $ts = is_object($expires) && method_exists($expires, 'getTimestamp') ? (int) $expires->getTimestamp() : 0;
        $limit = (int) $coupon->get_usage_limit();
        $per = (int) $coupon->get_usage_limit_per_user();
        $count = (int) $coupon->get_usage_count();
        $minimum = (string) $coupon->get_minimum_amount();
        $expired = $ts > 0 && $ts <= time();
        $used_up = $limit > 0 && $count >= $limit;
        return [
            'id' => (int) $coupon->get_id(),
            'code' => (string) $coupon->get_code(),
            'discount' => ['type' => (string) $coupon->get_discount_type(), 'amount' => (string) $coupon->get_amount()],
            'description' => WebMaven_Cap_Store_Catalog::text($coupon->get_description()),
            'usage' => ['count' => $count, 'limit' => $limit > 0 ? $limit : null, 'perCustomer' => $per > 0 ? $per : null],
            'minimum' => $minimum !== '' && (float) $minimum > 0 ? $minimum : null,
            'expires' => $ts > 0 ? (new DateTimeImmutable('@' . $ts))->setTimezone(WebMaven_Store_Periods::zone())->format('Y-m-d') : null,
            'freeShipping' => (bool) $coupon->get_free_shipping(),
            'individualUse' => (bool) $coupon->get_individual_use(),
            'productCount' => count((array) $coupon->get_product_ids()),
            'excludedCount' => count((array) $coupon->get_excluded_product_ids()),
            'categoryCount' => count((array) $coupon->get_product_categories()),
            'status' => $expired || $used_up ? 'expired' : 'active',
        ];
    }

    private static function by_code($raw) {
        $code = self::code($raw);
        $id = function_exists('wc_get_coupon_id_by_code') ? (int) wc_get_coupon_id_by_code($code) : 0;
        if ($id <= 0) {
            throw self::error('NOT_FOUND', 'There is no coupon "' . $code . '" in your store.');
        }
        return new WC_Coupon($id);
    }

    /** A coupon code as WooCommerce keeps it (lowercase, no spaces around). */
    private static function code($raw): string {
        $code = is_string($raw) ? trim(sanitize_text_field($raw)) : '';
        if ($code === '' || strlen($code) > self::CODE_MAX || !preg_match('/^[\p{L}\p{N}_\-]+$/u', $code)) {
            throw self::error('VALIDATION', 'A coupon code has letters, numbers, dashes or underscores, at most 50 of them.');
        }
        return function_exists('wc_format_coupon_code') ? (string) wc_format_coupon_code($code) : strtolower($code);
    }

    /** The end of that day in the site's time zone, or null for no end. */
    private static function expiry($raw): ?int {
        if ($raw === null || $raw === '') {
            return null;
        }
        if (!is_string($raw) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw)) {
            throw self::error('VALIDATION', 'The end date is a day like 2026-10-31.');
        }
        $day = DateTimeImmutable::createFromFormat('!Y-m-d', $raw, WebMaven_Store_Periods::zone());
        if (!$day || $day->format('Y-m-d') !== $raw) {
            throw self::error('VALIDATION', 'The end date is not a real day.');
        }
        $end = $day->setTime(23, 59, 59)->getTimestamp();
        if ($end <= time()) {
            throw self::error('VALIDATION', 'The end date has passed. Choose today or a later day.');
        }
        return $end;
    }

    private static function count($raw, string $what): int {
        if ($raw === null || $raw === '' || $raw === 0) {
            return 0;
        }
        if (!is_int($raw) && !(is_string($raw) && preg_match('/^\d{1,9}$/', $raw))) {
            throw self::error('VALIDATION', $what . ' is a whole number, or nothing for no limit.');
        }
        return max(0, (int) $raw);
    }

    private static function product_ids($raw): array {
        $ids = self::ids($raw, 'product_ids');
        foreach ($ids as $id) {
            $product = wc_get_product($id);
            if (!$product) {
                throw self::error('VALIDATION', 'Product ' . $id . ' is not in your store.');
            }
        }
        return $ids;
    }

    private static function category_ids($raw): array {
        $ids = self::ids($raw, 'category_ids');
        foreach ($ids as $id) {
            $term = get_term($id, 'product_cat');
            if (!$term || is_wp_error($term) || ($term->taxonomy ?? 'product_cat') !== 'product_cat') {
                throw self::error('VALIDATION', 'Category ' . $id . ' is not in your store.');
            }
        }
        return $ids;
    }

    private static function ids($raw, string $what): array {
        if ($raw === null || $raw === '') {
            return [];
        }
        if (!is_array($raw) || count($raw) > self::IDS_MAX) {
            throw self::error('VALIDATION', $what . ' is a list of at most 100 ids.');
        }
        $out = [];
        foreach ($raw as $id) {
            if (!(is_int($id) && $id > 0) && !(is_string($id) && preg_match('/^\d{1,18}$/', $id))) {
                throw self::error('VALIDATION', $what . ' holds whole numbers.');
            }
            $out[(int) $id] = (int) $id;
        }
        return array_values($out);
    }

    /** Does the store sell printed products (their floor holds under every coupon)? */
    public static function printed_products(): bool {
        if (!class_exists('WebMaven_Pod_Guards')) {
            return false;
        }
        $ids = get_posts([
            'post_type' => 'product',
            'post_status' => 'publish',
            'numberposts' => 1,
            'fields' => 'ids',
            'meta_key' => WebMaven_Pod_Guards::POD_PRODUCT_META,
        ]);
        return !empty($ids);
    }

    private static function require_store(): void {
        if (!class_exists('WC_Coupon') || !function_exists('wc_get_product')) {
            throw self::error('NO_STORE', 'Your site has no store yet, so it has no coupons.');
        }
    }
}
