<?php
/**
 * What sells and who buys, for the API (2026-10-08): the chat answers "what
 * are my best sellers" and "who are my customers" from the store's own
 * orders, read live, guests included (WooCommerce's customer list holds
 * registered accounts only).
 *
 *   store_top_products   {period | after/before, by: revenue|quantity, limit (1 to 20, default 10)}
 *                        -> {period, items: [{productId, name, quantity, revenue, orders}], currency, ordersRead, partial}
 *   store_customers_list {segment: all|new|returning|lapsed|top, search, sort: recent|spend|orders, page}
 *                        -> {items: [CustomerRow], total, totalPages, counts, ordersRead, partial}
 *   store_customer_read  {email} | {name}  -> {customer: CustomerDetail}
 *
 * A buyer is one billing email (lowercase) across the paid orders
 * (processing, completed) of the last 24 months, newest 5,000 orders at most
 * (partial past that). A list row carries no email, phone or street; one
 * customer read carries the email (the owner asked for that person), never
 * a phone or a street. Segments are computed on each read: new (first order
 * in the last 30 days), returning (2 orders or more), lapsed (ordered before,
 * nothing in the last 90 days), top (the tenth who spent the most, at least
 * one person). The buyers are kept 10 minutes and forgotten on a new order
 * or a status change.
 *
 * Failures THROW "CODE: sentence" (NO_STORE, NOT_FOUND, VALIDATION).
 * Registered through the filter, so the execute_command bridge cannot reach
 * these.
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
    $handlers['store_top_products'] = ['WebMaven_Cap_Store_Customers', 'top_products'];
    $handlers['store_customers_list'] = ['WebMaven_Cap_Store_Customers', 'customers_list'];
    $handlers['store_customer_read'] = ['WebMaven_Cap_Store_Customers', 'customer_read'];
    return $handlers;
});

if (function_exists('add_action')) {
    add_action('woocommerce_new_order', ['WebMaven_Cap_Store_Customers', 'forget']);
    add_action('woocommerce_order_status_changed', ['WebMaven_Cap_Store_Customers', 'forget']);
}

final class WebMaven_Cap_Store_Customers {

    const ORDERS_MAX = 5000;
    const PAID = ['processing', 'completed'];
    const MONTHS = 24;
    const CACHE = 'wm_store_buyers_v1';
    const CACHE_TTL = 600;
    const PER_PAGE = 25;
    const SEGMENTS = ['all', 'new', 'returning', 'lapsed', 'top'];
    const SORTS = ['recent', 'spend', 'orders'];
    const DAY = 86400;

    private static function error(string $code, string $message): Exception {
        return new Exception($code . ': ' . $message);
    }

    /** The buyers changed: the next read counts again. */
    public static function forget(): void {
        if (function_exists('delete_transient')) {
            delete_transient(self::CACHE);
        }
    }

    // ── store_top_products ─────────────────────────────────────────────────

    public static function top_products($params = [], $step_id = null) {
        self::require_store();
        $p = is_array($params) ? $params : [];
        $by = $p['by'] ?? 'revenue';
        if (!in_array($by, ['revenue', 'quantity'], true)) {
            throw self::error('VALIDATION', 'by is revenue or quantity.');
        }
        $limit = (int) ($p['limit'] ?? 10);
        $limit = $limit >= 1 ? min($limit, 20) : 10;
        $period = WebMaven_Store_Periods::resolve($p) ?? WebMaven_Store_Periods::resolve(['period' => 'last_30_days']);
        list($orders, $partial) = self::paid_orders($period['from'], $period['to']);
        $products = [];
        $currency = '';
        foreach ($orders as $order) {
            $currency = $currency !== '' ? $currency : (string) $order->get_currency();
            $seen = [];
            foreach ((array) $order->get_items('line_item') as $item_id => $item) {
                $product_id = (int) $item->get_product_id();
                if ($product_id <= 0) {
                    continue;
                }
                $quantity = (int) $item->get_quantity() - abs((int) $order->get_qty_refunded_for_item($item_id));
                $revenue = (float) $item->get_total() - (method_exists($order, 'get_total_refunded_for_item') ? (float) $order->get_total_refunded_for_item($item_id) : 0.0);
                if ($quantity <= 0 && $revenue <= 0) {
                    continue;
                }
                if (!isset($products[$product_id])) {
                    $product = wc_get_product($product_id);
                    $products[$product_id] = [
                        'productId' => $product_id,
                        'name' => WebMaven_Cap_Store_Catalog::text($product ? $product->get_name() : $item->get_name()),
                        'quantity' => 0,
                        'revenue' => 0.0,
                        'orders' => 0,
                    ];
                }
                $products[$product_id]['quantity'] += max(0, $quantity);
                $products[$product_id]['revenue'] += max(0.0, $revenue);
                if (!isset($seen[$product_id])) {
                    $products[$product_id]['orders']++;
                    $seen[$product_id] = true;
                }
            }
        }
        $items = array_values($products);
        usort($items, function ($a, $b) use ($by) {
            $first = $by === 'quantity' ? $b['quantity'] <=> $a['quantity'] : $b['revenue'] <=> $a['revenue'];
            return $first !== 0 ? $first : ($by === 'quantity' ? $b['revenue'] <=> $a['revenue'] : $b['quantity'] <=> $a['quantity']);
        });
        $items = array_map(function ($row) {
            $row['revenue'] = self::money($row['revenue']);
            return $row;
        }, array_slice($items, 0, $limit));
        return [
            'period' => WebMaven_Store_Periods::public_part($period),
            'by' => $by,
            'items' => $items,
            'currency' => $currency !== '' ? $currency : (function_exists('get_woocommerce_currency') ? (string) get_woocommerce_currency() : ''),
            'ordersRead' => count($orders),
            'partial' => $partial,
        ];
    }

    // ── store_customers_list ───────────────────────────────────────────────

    public static function customers_list($params = [], $step_id = null) {
        self::require_store();
        $p = is_array($params) ? $params : [];
        $segment = $p['segment'] ?? 'all';
        if (!in_array($segment, self::SEGMENTS, true)) {
            throw self::error('VALIDATION', 'segment is one of: ' . implode(', ', self::SEGMENTS) . '.');
        }
        $sort = $p['sort'] ?? 'recent';
        if (!in_array($sort, self::SORTS, true)) {
            throw self::error('VALIDATION', 'sort is one of: ' . implode(', ', self::SORTS) . '.');
        }
        $page = max(1, (int) ($p['page'] ?? 1));
        $all = self::buyers();
        $now = time();
        $counts = array_fill_keys(self::SEGMENTS, 0);
        $top = self::top_floor($all['buyers']);
        $rows = [];
        $search = is_string($p['search'] ?? null) ? strtolower(trim(sanitize_text_field($p['search']))) : '';
        foreach ($all['buyers'] as $email => $b) {
            $in = self::segments_of($b, $now, $top);
            foreach ($in as $name) {
                $counts[$name]++;
            }
            $counts['all']++;
            if ($segment !== 'all' && !in_array($segment, $in, true)) {
                continue;
            }
            if ($search !== '' && strpos(strtolower($b['name'] . ' ' . $email . ' ' . $b['city']), $search) === false) {
                continue;
            }
            $rows[] = self::row($b, $in);
        }
        usort($rows, function ($a, $b) use ($sort) {
            if ($sort === 'spend') {
                return (float) $b['spent'] <=> (float) $a['spent'];
            }
            if ($sort === 'orders') {
                return $b['orders'] <=> $a['orders'] ?: strcmp($b['lastOrderAt'], $a['lastOrderAt']);
            }
            return strcmp($b['lastOrderAt'], $a['lastOrderAt']);
        });
        $total = count($rows);
        return [
            'items' => array_slice($rows, ($page - 1) * self::PER_PAGE, self::PER_PAGE),
            'total' => $total,
            'totalPages' => $total > 0 ? (int) ceil($total / self::PER_PAGE) : 0,
            'counts' => $counts,
            'currency' => $all['currency'],
            'ordersRead' => $all['ordersRead'],
            'partial' => $all['partial'],
        ];
    }

    // ── store_customer_read ────────────────────────────────────────────────

    public static function customer_read($params = [], $step_id = null) {
        self::require_store();
        $p = is_array($params) ? $params : [];
        $email = is_string($p['email'] ?? null) ? strtolower(trim(sanitize_text_field($p['email']))) : '';
        $name = is_string($p['name'] ?? null) ? trim(sanitize_text_field($p['name'])) : '';
        if ($email === '' && $name === '') {
            throw self::error('VALIDATION', 'Give the customer\'s email or name.');
        }
        $all = self::buyers();
        $found = null;
        if ($email !== '') {
            $found = $all['buyers'][$email] ?? null;
            if ($found === null) {
                throw self::error('NOT_FOUND', 'No customer with this email bought from your store in the last two years.');
            }
        } else {
            $matches = array_values(array_filter($all['buyers'], function ($b) use ($name) {
                return strcasecmp($b['name'], $name) === 0;
            }));
            if (!$matches) {
                $matches = array_values(array_filter($all['buyers'], function ($b) use ($name) {
                    return stripos($b['name'], $name) !== false;
                }));
            }
            if (!$matches) {
                throw self::error('NOT_FOUND', 'No customer called ' . $name . ' bought from your store in the last two years.');
            }
            if (count($matches) > 1) {
                throw self::error('VALIDATION', count($matches) . ' customers match ' . $name . '. Give their email to choose one.');
            }
            $found = $matches[0];
        }
        $top = self::top_floor($all['buyers']);
        $detail = self::row($found, self::segments_of($found, time(), $top));
        $detail['email'] = $found['email'];
        $detail['recentOrders'] = self::recent_orders($found['orderIds']);
        $detail['messages'] = self::messages_from($found['email']);
        return ['customer' => $detail, 'currency' => $all['currency']];
    }

    // ── The buyers ─────────────────────────────────────────────────────────

    /** {buyers: email => buyer, currency, ordersRead, partial}, kept 10 minutes. */
    private static function buyers(): array {
        $cached = function_exists('get_transient') ? get_transient(self::CACHE) : false;
        if (is_array($cached) && isset($cached['buyers'])) {
            return $cached;
        }
        $now = time();
        list($orders, $partial) = self::paid_orders($now - self::MONTHS * 31 * self::DAY, $now + self::DAY);
        $buyers = [];
        $currency = '';
        foreach ($orders as $order) {
            $email = strtolower(trim((string) $order->get_billing_email()));
            if ($email === '' || !preg_match('/^[^@\s]+@[^@\s]+\.[^@\s]+$/', $email)) {
                continue;
            }
            $currency = $currency !== '' ? $currency : (string) $order->get_currency();
            $created = $order->get_date_created();
            $at = is_object($created) && method_exists($created, 'getTimestamp') ? (int) $created->getTimestamp() : 0;
            if (!isset($buyers[$email])) {
                $buyers[$email] = [
                    'email' => $email,
                    'name' => '',
                    'city' => '',
                    'country' => '',
                    'orders' => 0,
                    'spent' => 0.0,
                    'first' => $at,
                    'last' => $at,
                    'registered' => false,
                    'orderIds' => [],
                ];
            }
            $b = &$buyers[$email];
            $b['orders']++;
            $b['spent'] += (float) $order->get_total() - (float) $order->get_total_refunded();
            if ($at > 0 && ($b['first'] === 0 || $at < $b['first'])) {
                $b['first'] = $at;
            }
            if ($at >= $b['last']) {
                // The newest order names the person and where they live.
                $b['last'] = $at;
                $name = WebMaven_Cap_Store_Catalog::text(trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name()));
                $b['name'] = $name !== '' ? $name : ($b['name'] !== '' ? $b['name'] : WebMaven_Cap_Store_Catalog::text($order->get_billing_company()));
                $b['city'] = WebMaven_Cap_Store_Catalog::text($order->get_billing_city());
                $b['country'] = (string) $order->get_billing_country();
            }
            if ((int) $order->get_customer_id() > 0) {
                $b['registered'] = true;
            }
            if (count($b['orderIds']) < 10) {
                $b['orderIds'][] = (int) $order->get_id();
            }
            unset($b);
        }
        $answer = ['buyers' => $buyers, 'currency' => $currency, 'ordersRead' => count($orders), 'partial' => $partial];
        if (function_exists('set_transient')) {
            set_transient(self::CACHE, $answer, self::CACHE_TTL);
        }
        return $answer;
    }

    /** The paid orders created in [from, to), newest first: [orders, partial]. */
    private static function paid_orders(int $from, int $to): array {
        $orders = wc_get_orders([
            'type' => 'shop_order',
            'status' => array_map(function ($s) { return 'wc-' . $s; }, self::PAID),
            'date_created' => $from . '...' . ($to - 1),
            'limit' => self::ORDERS_MAX + 1,
            'orderby' => 'date',
            'order' => 'DESC',
        ]);
        $orders = array_values(array_filter(is_array($orders) ? $orders : [], function ($o) {
            return is_object($o) && (!method_exists($o, 'get_type') || $o->get_type() === 'shop_order');
        }));
        $partial = count($orders) > self::ORDERS_MAX;
        return [array_slice($orders, 0, self::ORDERS_MAX), $partial];
    }

    /** The least a buyer spent to be in the top tenth (at least one person). */
    private static function top_floor(array $buyers): float {
        if (!$buyers) {
            return INF;
        }
        $spent = array_map(function ($b) { return (float) $b['spent']; }, array_values($buyers));
        rsort($spent);
        $n = max(1, (int) floor(count($spent) / 10));
        return $spent[$n - 1];
    }

    private static function segments_of(array $b, int $now, float $top): array {
        $in = [];
        if ($b['first'] >= $now - 30 * self::DAY) {
            $in[] = 'new';
        }
        if ($b['orders'] >= 2) {
            $in[] = 'returning';
        }
        if ($b['last'] > 0 && $b['last'] < $now - 90 * self::DAY) {
            $in[] = 'lapsed';
        }
        if ($b['spent'] > 0 && $b['spent'] >= $top) {
            $in[] = 'top';
        }
        return $in;
    }

    /** A list row: never the email, a phone or a street. */
    private static function row(array $b, array $segments): array {
        return [
            'name' => $b['name'] !== '' ? $b['name'] : 'Guest',
            'city' => $b['city'],
            'country' => self::country_name($b['country']),
            'orders' => (int) $b['orders'],
            'spent' => self::money($b['spent']),
            'firstOrderAt' => $b['first'] > 0 ? gmdate('Y-m-d\TH:i:s', $b['first']) : '',
            'lastOrderAt' => $b['last'] > 0 ? gmdate('Y-m-d\TH:i:s', $b['last']) : '',
            'registered' => (bool) $b['registered'],
            'segments' => $segments,
        ];
    }

    /** The person's last orders, as short rows. */
    private static function recent_orders(array $ids): array {
        $out = [];
        foreach ($ids as $id) {
            $order = wc_get_order($id);
            if (!$order) {
                continue;
            }
            $created = $order->get_date_created();
            $out[] = [
                'id' => (int) $order->get_id(),
                'number' => (string) $order->get_order_number(),
                'status' => WebMaven_Pod_Guards::bare_status((string) $order->get_status()),
                'createdAt' => is_object($created) && method_exists($created, 'getTimestamp') ? gmdate('Y-m-d\TH:i:s', (int) $created->getTimestamp()) : '',
                'total' => self::money($order->get_total()),
                'currency' => (string) $order->get_currency(),
                'itemCount' => (int) $order->get_item_count(),
            ];
        }
        return $out;
    }

    /** How many form messages this email sent (the messages stay in Messages). */
    private static function messages_from(string $email): int {
        if (!class_exists('WebMaven_Leads') || !WebMaven_Leads::installed()) {
            return 0;
        }
        global $wpdb;
        return (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM %i WHERE LOWER(email) = %s AND status <> 'spam'", WebMaven_Leads::table(), $email));
    }

    private static function country_name(string $code): string {
        $countries = function_exists('WC') && is_object(WC()) && isset(WC()->countries) && is_object(WC()->countries) ? WC()->countries : null;
        if ($countries && isset($countries->countries[$code])) {
            return WebMaven_Cap_Store_Catalog::text($countries->countries[$code]);
        }
        return $code;
    }

    private static function require_store(): void {
        if (!function_exists('wc_get_orders') || !function_exists('wc_get_order')) {
            throw self::error('NO_STORE', 'Your site has no store yet, so it has no orders.');
        }
    }

    private static function money($value): string {
        return number_format((float) $value, WebMaven_Pod_Guards::decimals(), '.', '');
    }
}

