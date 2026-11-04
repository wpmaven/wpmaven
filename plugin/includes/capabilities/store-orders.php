<?php
/**
 * The store's orders for the API (2026-10-05): the dashboard's Store reads
 * every WooCommerce order, changes its status, adds a note and refunds an
 * order of another gateway than WPMaven Payments.
 *
 *   store_orders_list   {page, per_page, status, search, period | after/before} -> ListPage<StoreOrderRow>
 *                       (+ period and sum {count, totals per currency, partial} when a period is named)
 *   store_order_detail  {order_id | number}                -> {order: StoreOrderDetail}
 *   store_order_update  {order_id, status, note: {text, customer}, shipment: {carrier, number, url}, notify}
 *                       -> {status, noteId, customerEmailed: completed_email|note|none, shipment}
 *   store_order_refund  {order_id, amount, reason, restock, api_refund} -> {refundId, amount}
 *
 * Orders are read and written through WooCommerce (its REST for the list,
 * wc_get_order and its CRUD otherwise), never as post meta: the store may
 * keep its orders in its own tables (HPOS). A status change follows the
 * Store's rules (WebMaven_Pod_Guards::order_status_allowed): a WPMaven
 * Payments order turns paid only through its payment, an order with printed
 * lines is completed by its shipping. A WPMaven Payments order is refunded
 * through its own route (the one refund engine), never here. Money is in the
 * order's own currency.
 *
 * Failures THROW "CODE: sentence" (NOT_FOUND, NO_STORE, VALIDATION,
 * STATUS_NOT_ALLOWED, REFUND_NOT_ALLOWED, REFUND_TOO_HIGH, WRITE_FAILED).
 * Registered through the filter, so the execute_command bridge
 * (webhook_<name>) cannot reach these.
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
    $handlers['store_orders_list'] = ['WebMaven_Cap_Store_Orders', 'orders_list'];
    $handlers['store_order_detail'] = ['WebMaven_Cap_Store_Orders', 'order_detail'];
    $handlers['store_order_update'] = ['WebMaven_Cap_Store_Orders', 'order_update'];
    $handlers['store_order_refund'] = ['WebMaven_Cap_Store_Orders', 'order_refund'];
    return $handlers;
});

final class WebMaven_Cap_Store_Orders {

    /** The statuses a list can ask for. */
    const LIST_STATUSES = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed', 'checkout-draft'];
    const LIST_FIELDS = 'id,number,status,date_created_gmt,currency,currency_symbol,total,billing,payment_method_title,wpmaven';
    const NOTE_MAX = 2000;
    const REASON_MAX = 500;
    /** Parcels the owner sent themselves (the printed parcels keep _wm_tracking, written by their fulfilment). */
    const SHIPMENT_META = '_wm_shipment';
    const SHIPMENTS_KEPT = 10;
    const CARRIER_MAX = 60;
    const TRACKING_MAX = 80;
    /** A period's sum reads at most this many orders, newest first, and says when it stopped. */
    const SUM_MAX = 2000;
    /** The statuses a period's sum counts when the list names none: orders someone placed and did not lose. */
    const SUM_STATUSES = ['pending', 'processing', 'on-hold', 'completed'];

    const REFUND_HERE_REFUSED = 'An order paid with WPMaven Payments is refunded through WPMaven Payments, which also stops its printing when it can.';

    private static function error(string $code, string $message): Exception {
        return new Exception($code . ': ' . $message);
    }

    // ── store_orders_list ──────────────────────────────────────────────────

    public static function orders_list($params = [], $step_id = null) {
        self::require_store();
        $params = is_array($params) ? $params : [];
        $page = self::positive_int($params['page'] ?? null);
        $per_page = self::positive_int($params['per_page'] ?? null);
        $query = [
            'page' => $page > 0 ? min($page, 100000) : 1,
            'per_page' => $per_page > 0 ? min($per_page, 50) : 20,
            'status' => WebMaven_Cap_Store_Catalog::statuses($params['status'] ?? null, self::LIST_STATUSES),
            '_fields' => self::LIST_FIELDS,
        ];
        $search = is_string($params['search'] ?? null) ? trim(sanitize_text_field($params['search'])) : '';
        if ($search !== '') {
            $query['search'] = function_exists('mb_substr') ? mb_substr($search, 0, 100) : substr($search, 0, 100);
        }
        $period = WebMaven_Store_Periods::resolve($params);
        if ($period) {
            $query['after'] = WebMaven_Store_Periods::utc_iso($period['from']);
            $query['before'] = WebMaven_Store_Periods::utc_iso($period['to']);
            $query['dates_are_gmt'] = true;
        }
        list($items, $total, $pages) = WebMaven_Cap_Store_Catalog::rest_list('/wc/v3/orders', $query);
        $answer = ['items' => array_map([__CLASS__, 'order_row'], $items), 'total' => $total, 'totalPages' => $pages];
        if ($period) {
            $answer['period'] = WebMaven_Store_Periods::public_part($period);
            $asked = $params['status'] ?? null;
            $answer['sum'] = self::sum($period, ($asked === null || $asked === '' || $asked === []) ? self::SUM_STATUSES : $query['status']);
        }
        return $answer;
    }

    /** How many orders the period holds and their totals per currency (refunds taken off). */
    private static function sum(array $period, array $statuses): array {
        $orders = function_exists('wc_get_orders') ? wc_get_orders([
            'type' => 'shop_order',
            'status' => array_map(function ($s) { return 'wc-' . $s; }, $statuses),
            'date_created' => $period['from'] . '...' . ($period['to'] - 1),
            'limit' => self::SUM_MAX + 1,
            'orderby' => 'date',
            'order' => 'DESC',
        ]) : [];
        $orders = is_array($orders) ? $orders : [];
        $partial = count($orders) > self::SUM_MAX;
        $totals = [];
        $count = 0;
        foreach (array_slice($orders, 0, self::SUM_MAX) as $order) {
            if (!is_object($order) || (method_exists($order, 'get_type') && $order->get_type() !== 'shop_order')) {
                continue;
            }
            $count++;
            $currency = (string) $order->get_currency();
            $net = (float) $order->get_total() - (float) $order->get_total_refunded();
            $totals[$currency] = ($totals[$currency] ?? 0.0) + $net;
        }
        $out = [];
        foreach ($totals as $currency => $amount) {
            $out[] = ['currency' => $currency, 'amount' => self::money($amount)];
        }
        return ['count' => $count, 'totals' => $out, 'partial' => $partial];
    }

    /** StoreOrderRow from a wc/v3 order answer (with its wpmaven field). */
    public static function order_row(array $item): array {
        $id = (int) ($item['id'] ?? 0);
        $order = $id > 0 ? wc_get_order($id) : null;
        $billing = is_array($item['billing'] ?? null) ? $item['billing'] : [];
        return [
            'id' => $id,
            'number' => (string) ($item['number'] ?? $id),
            'status' => WebMaven_Pod_Guards::bare_status((string) ($item['status'] ?? '')),
            'createdAt' => (string) ($item['date_created_gmt'] ?? ''),
            'currency' => (string) ($item['currency'] ?? ''),
            'currencySymbol' => html_entity_decode((string) ($item['currency_symbol'] ?? ''), ENT_QUOTES, 'UTF-8'),
            'total' => self::money($item['total'] ?? '0'),
            'itemCount' => $order ? (int) $order->get_item_count() : 0,
            'customerName' => self::customer_name(
                (string) ($billing['first_name'] ?? ''),
                (string) ($billing['last_name'] ?? ''),
                (string) ($billing['company'] ?? '')
            ),
            'paymentMethodTitle' => WebMaven_Cap_Store_Catalog::text($item['payment_method_title'] ?? ''),
            'wpmaven' => is_array($item['wpmaven'] ?? null) ? $item['wpmaven'] : ($order ? WebMaven_Store_Rest_Filters::order_info($order) : null),
        ];
    }

    // ── store_order_detail ─────────────────────────────────────────────────

    public static function order_detail($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        if (($params['order_id'] ?? null) === null && ($params['number'] ?? null) !== null) {
            return ['order' => self::detail(self::by_number($params['number']))];
        }
        return ['order' => self::detail(self::order($params['order_id'] ?? null))];
    }

    /**
     * The order whose number customers see: an id whose number is that one,
     * else the number a sequential-numbers plugin keeps (_order_number).
     */
    private static function by_number($raw) {
        self::require_store();
        $number = is_scalar($raw) ? trim(ltrim((string) $raw, '#')) : '';
        if ($number === '' || strlen($number) > 40 || !preg_match('/^[A-Za-z0-9_\-\/]+$/', $number)) {
            throw self::error('VALIDATION', 'An order number is like 1042.');
        }
        $id = self::positive_int($number);
        $order = $id > 0 ? wc_get_order($id) : null;
        if ($order && (!method_exists($order, 'get_type') || $order->get_type() === 'shop_order') && (string) $order->get_order_number() === $number) {
            return $order;
        }
        if (function_exists('wc_get_orders')) {
            $found = wc_get_orders(['type' => 'shop_order', 'limit' => 1, 'meta_query' => [['key' => '_order_number', 'value' => $number]]]);
            if (is_array($found) && isset($found[0]) && is_object($found[0])) {
                return $found[0];
            }
        }
        throw self::error('NOT_FOUND', 'There is no order ' . $number . ' in your store.');
    }

    /** StoreOrderDetail of an order object. */
    public static function detail($order): array {
        $id = (int) $order->get_id();
        $currency = (string) $order->get_currency();
        $name = trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name());
        $symbol = function_exists('get_woocommerce_currency_symbol') ? (string) get_woocommerce_currency_symbol($currency) : $currency;
        return [
            'id' => $id,
            'number' => (string) $order->get_order_number(),
            'status' => WebMaven_Pod_Guards::bare_status((string) $order->get_status()),
            'createdAt' => self::gmt($order->get_date_created()),
            'currency' => $currency,
            'currencySymbol' => html_entity_decode($symbol, ENT_QUOTES, 'UTF-8'),
            'total' => self::money($order->get_total()),
            'itemCount' => (int) $order->get_item_count(),
            'customerName' => self::customer_name((string) $order->get_billing_first_name(), (string) $order->get_billing_last_name(), (string) $order->get_billing_company()),
            'paymentMethodTitle' => WebMaven_Cap_Store_Catalog::text($order->get_payment_method_title()),
            'wpmaven' => WebMaven_Store_Rest_Filters::order_info($order),
            'paymentMethod' => (string) $order->get_payment_method(),
            'customer' => [
                'name' => $name,
                'email' => (string) $order->get_billing_email(),
                'phone' => (string) $order->get_billing_phone(),
                'billing' => self::address($order, 'billing'),
                'shipping' => self::address($order, 'shipping'),
                'note' => WebMaven_Cap_Store_Catalog::text($order->get_customer_note()),
            ],
            'items' => self::items($order),
            'totals' => [
                'subtotal' => self::money($order->get_subtotal()),
                'shipping' => self::money($order->get_shipping_total()),
                'tax' => self::money($order->get_total_tax()),
                'discount' => self::money($order->get_total_discount()),
                'refunded' => self::money($order->get_total_refunded()),
                'total' => self::money($order->get_total()),
            ],
            'notes' => self::notes($id),
            'refunds' => self::refunds($order),
            'refundable' => self::money($order->get_remaining_refund_amount()),
            'gatewayRefunds' => self::gateway_refunds($order),
            'paid' => method_exists($order, 'is_paid') ? (bool) $order->is_paid() : false,
            'shipments' => self::shipments($order),
            'emails' => ['completed' => self::completed_email_on()],
            'editUrl' => is_callable([$order, 'get_edit_order_url']) ? (string) $order->get_edit_order_url() : (string) admin_url('post.php?post=' . $id . '&action=edit'),
        ];
    }

    private static function items($order): array {
        $out = [];
        foreach ((array) $order->get_items('line_item') as $item_id => $item) {
            $product_id = (int) $item->get_product_id();
            $variation_id = (int) $item->get_variation_id();
            $product = $item->get_product();
            $printed = WebMaven_Pod_Guards::is_printed($product_id);
            $photo = is_object($product) ? WebMaven_Store_Rest_Filters::photo($product) : null;
            if ($photo === null && $variation_id > 0 && $product_id > 0) {
                $parent = wc_get_product($product_id);
                $photo = $parent ? WebMaven_Store_Rest_Filters::photo($parent) : null;
            }
            $options = [];
            foreach ((array) $item->get_formatted_meta_data() as $meta) {
                $key = is_object($meta) ? (string) ($meta->key ?? '') : '';
                if (WebMaven_Store_Rest_Filters::is_internal_key($key)) {
                    continue;
                }
                $options[] = [
                    'label' => WebMaven_Cap_Store_Catalog::text(is_object($meta) ? ($meta->display_key ?? $key) : ''),
                    'value' => WebMaven_Cap_Store_Catalog::text(is_object($meta) ? ($meta->display_value ?? '') : ''),
                ];
            }
            $out[] = [
                'id' => (int) $item_id,
                'productId' => $product_id,
                'variationId' => $variation_id > 0 ? $variation_id : null,
                'name' => WebMaven_Cap_Store_Catalog::text($item->get_name()),
                'quantity' => (int) $item->get_quantity(),
                'total' => self::money($item->get_total()),
                'options' => $options,
                'imageUrl' => $photo['url'] ?? null,
                'printed' => $printed,
                'restockable' => !$printed && is_object($product) && method_exists($product, 'managing_stock') && $product->managing_stock(),
            ];
        }
        return $out;
    }

    /** StoreAddress of one side of the order, or null when it has none. */
    private static function address($order, string $side): ?array {
        $fields = ['first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country'];
        $raw = [];
        foreach ($fields as $field) {
            $method = 'get_' . $side . '_' . $field;
            $raw[$field] = is_callable([$order, $method]) ? trim((string) $order->$method()) : '';
        }
        if ($raw['address_1'] === '' && $raw['city'] === '' && $raw['postcode'] === '' && $raw['country'] === '') {
            return null;
        }
        $countries = function_exists('WC') && is_object(WC()) && isset(WC()->countries) && is_object(WC()->countries) ? WC()->countries : null;
        $country = $raw['country'];
        if ($countries && isset($countries->countries[$country])) {
            $country = WebMaven_Cap_Store_Catalog::text($countries->countries[$country]);
        }
        $lines = [];
        if ($countries && method_exists($countries, 'get_formatted_address')) {
            $formatted = (string) $countries->get_formatted_address(array_merge($raw, ['first_name' => '', 'last_name' => '', 'company' => '']), "\n");
            foreach (explode("\n", $formatted) as $line) {
                $line = WebMaven_Cap_Store_Catalog::text($line);
                if ($line !== '' && $line !== $country) {
                    $lines[] = $line;
                }
            }
        } else {
            foreach ([$raw['address_1'], $raw['address_2'], trim($raw['postcode'] . ' ' . $raw['city']), $raw['state']] as $line) {
                if (trim($line) !== '') {
                    $lines[] = WebMaven_Cap_Store_Catalog::text($line);
                }
            }
        }
        return [
            'name' => trim($raw['first_name'] . ' ' . $raw['last_name']),
            'company' => $raw['company'],
            'lines' => $lines,
            'country' => $country,
        ];
    }

    private static function notes(int $order_id): array {
        if (!function_exists('wc_get_order_notes')) {
            return [];
        }
        $out = [];
        foreach ((array) wc_get_order_notes(['order_id' => $order_id, 'order_by' => 'date_created', 'order' => 'DESC']) as $note) {
            if (!is_object($note)) {
                continue;
            }
            $by = (string) ($note->added_by ?? '');
            $out[] = [
                'id' => (int) ($note->id ?? 0),
                'at' => self::gmt($note->date_created ?? null),
                'text' => WebMaven_Cap_Store_Catalog::text($note->content ?? ''),
                'customer' => !empty($note->customer_note),
                'author' => $by === '' || $by === 'system' ? 'WooCommerce' : WebMaven_Cap_Store_Catalog::text($by),
            ];
        }
        return $out;
    }

    private static function refunds($order): array {
        $out = [];
        foreach ((array) $order->get_refunds() as $refund) {
            $out[] = [
                'id' => (int) $refund->get_id(),
                'at' => self::gmt($refund->get_date_created()),
                'amount' => self::money($refund->get_amount()),
                'reason' => WebMaven_Cap_Store_Catalog::text($refund->get_reason()),
            ];
        }
        return $out;
    }

    /** The order's gateway refunds through its own plugin. */
    private static function gateway_refunds($order): bool {
        $gateway = function_exists('wc_get_payment_gateway_by_order') ? wc_get_payment_gateway_by_order($order) : null;
        return is_object($gateway) && method_exists($gateway, 'supports') && (bool) $gateway->supports('refunds');
    }

    // ── store_order_update ─────────────────────────────────────────────────

    public static function order_update($params = [], $step_id = null) {
        $order = self::order($params['order_id'] ?? null);
        $status = $params['status'] ?? null;
        $note = $params['note'] ?? null;
        $shipment = self::shipment_param($params['shipment'] ?? null);
        $notify = array_key_exists('notify', $params) ? self::boolean($params['notify'], 'notify') : true;
        if (($status === null || $status === '') && $note === null && $shipment === null) {
            throw self::error('VALIDATION', 'Say what changes: the status, a note, the parcel, or more than one.');
        }
        // Everything is checked before anything is written.
        $to = null;
        if ($status !== null && $status !== '') {
            if (!is_string($status)) {
                throw self::error('VALIDATION', 'status is one of: ' . implode(', ', WebMaven_Pod_Guards::STATUSES) . '.');
            }
            $to = WebMaven_Pod_Guards::bare_status(trim($status));
            if ($to === WebMaven_Pod_Guards::bare_status((string) $order->get_status())) {
                $to = null; // already there: nothing to change
            } else {
                $refusal = WebMaven_Pod_Guards::status_refusal($order, $to);
                if ($refusal !== null) {
                    throw self::error('STATUS_NOT_ALLOWED', $refusal);
                }
            }
        }
        $text = null;
        $customer = false;
        if ($note !== null) {
            if (!is_array($note)) {
                throw self::error('VALIDATION', 'note holds its text and whether the customer gets it.');
            }
            foreach (array_keys($note) as $key) {
                if (!in_array($key, ['text', 'customer'], true)) {
                    throw self::error('VALIDATION', 'Unknown note field: ' . preg_replace('/[^A-Za-z0-9_]/', '', (string) $key) . '.');
                }
            }
            $text = is_string($note['text'] ?? null) ? trim(sanitize_textarea_field($note['text'])) : '';
            $length = function_exists('mb_strlen') ? mb_strlen($text, 'UTF-8') : strlen($text);
            if ($length < 1 || $length > self::NOTE_MAX) {
                throw self::error('VALIDATION', 'A note has 1 to 2,000 characters.');
            }
            if (array_key_exists('customer', $note)) {
                if (!is_bool($note['customer'])) {
                    throw self::error('VALIDATION', 'note.customer must be true or false.');
                }
                $customer = $note['customer'];
            }
        }
        $emailed = 'none';
        if ($to !== null) {
            $hold = !$notify && $to === 'completed';
            if ($hold) {
                // This change only: WooCommerce's "Completed order" email stays unsent.
                add_filter('woocommerce_email_enabled_customer_completed_order', '__return_false', 99);
            }
            try {
                $order->update_status($to, '', true);
            } finally {
                if ($hold) {
                    remove_filter('woocommerce_email_enabled_customer_completed_order', '__return_false', 99);
                }
            }
            if ($to === 'completed' && $notify && self::completed_email_on()) {
                $emailed = 'completed_email';
            }
        }
        $kept = null;
        if ($shipment !== null) {
            $kept = $shipment + ['at' => gmdate('Y-m-d\TH:i:s')];
            $list = self::shipments($order);
            $list[] = $kept;
            $order->update_meta_data(self::SHIPMENT_META, array_slice($list, -self::SHIPMENTS_KEPT));
            $order->save();
            if ($notify) {
                // The customer gets the tracking as a note (WooCommerce emails customer notes).
                if ((int) $order->add_order_note(self::shipment_sentence($shipment), 1, true) > 0) {
                    $emailed = $emailed === 'none' ? 'note' : $emailed;
                }
            }
        }
        $note_id = null;
        if ($text !== null) {
            $note_id = (int) $order->add_order_note($text, $customer ? 1 : 0, true);
            if ($note_id <= 0) {
                throw self::error('WRITE_FAILED', 'The note could not be added to the order.');
            }
            if ($customer && $emailed === 'none') {
                $emailed = 'note';
            }
        }
        $fresh = wc_get_order((int) $order->get_id());
        return [
            'status' => WebMaven_Pod_Guards::bare_status((string) ($fresh ? $fresh : $order)->get_status()),
            'noteId' => $note_id,
            'customerEmailed' => $emailed,
            'shipment' => $kept,
        ];
    }

    /** {carrier, number, url} from the parameter, or null when none is given. */
    private static function shipment_param($raw): ?array {
        if ($raw === null) {
            return null;
        }
        if (!is_array($raw)) {
            throw self::error('VALIDATION', 'shipment holds the carrier, the tracking number and its link.');
        }
        foreach (array_keys($raw) as $key) {
            if (!in_array($key, ['carrier', 'number', 'url'], true)) {
                throw self::error('VALIDATION', 'Unknown shipment field: ' . preg_replace('/[^A-Za-z0-9_]/', '', (string) $key) . '.');
            }
        }
        $carrier = is_string($raw['carrier'] ?? null) ? trim(sanitize_text_field($raw['carrier'])) : '';
        $number = is_string($raw['number'] ?? null) ? trim(sanitize_text_field($raw['number'])) : '';
        $url = is_string($raw['url'] ?? null) ? trim($raw['url']) : '';
        if ($number === '' && $carrier === '' && $url === '') {
            throw self::error('VALIDATION', 'Give the tracking number, the carrier or the tracking link.');
        }
        if (strlen($carrier) > self::CARRIER_MAX || strlen($number) > self::TRACKING_MAX) {
            throw self::error('VALIDATION', 'The carrier has at most 60 characters and the tracking number at most 80.');
        }
        if ($url !== '') {
            $clean = esc_url_raw($url);
            if ($clean === '' || !preg_match('#^https?://[^\s]+$#i', $clean) || strlen($clean) > 500) {
                throw self::error('VALIDATION', 'The tracking link must be a web address starting with https://.');
            }
            $url = $clean;
        }
        return ['carrier' => $carrier, 'number' => $number, 'url' => $url];
    }

    /** "Your order is on its way with UPS. Tracking number: 1Z999. Track it here: https://..." */
    private static function shipment_sentence(array $shipment): string {
        $parts = [$shipment['carrier'] !== '' ? 'Your order is on its way with ' . $shipment['carrier'] . '.' : 'Your order is on its way.'];
        if ($shipment['number'] !== '') {
            $parts[] = 'Tracking number: ' . $shipment['number'] . '.';
        }
        if ($shipment['url'] !== '') {
            $parts[] = 'Track it here: ' . $shipment['url'];
        }
        return implode(' ', $parts);
    }

    /** The parcels the owner sent themselves, oldest first. */
    private static function shipments($order): array {
        $raw = method_exists($order, 'get_meta') ? $order->get_meta(self::SHIPMENT_META, true) : [];
        $out = [];
        foreach (is_array($raw) ? $raw : [] as $s) {
            if (is_array($s)) {
                $out[] = [
                    'carrier' => (string) ($s['carrier'] ?? ''),
                    'number' => (string) ($s['number'] ?? ''),
                    'url' => (string) ($s['url'] ?? ''),
                    'at' => (string) ($s['at'] ?? ''),
                ];
            }
        }
        return $out;
    }

    /** Does the store email customers when an order is completed (WooCommerce's setting, on by default)? */
    public static function completed_email_on(): bool {
        $settings = get_option('woocommerce_customer_completed_order_settings', []);
        return !is_array($settings) || ($settings['enabled'] ?? 'yes') !== 'no';
    }

    // ── store_order_refund ─────────────────────────────────────────────────

    public static function order_refund($params = [], $step_id = null) {
        $order = self::order($params['order_id'] ?? null);
        if (WebMaven_Pod_Guards::is_wpmaven_payments($order)) {
            throw self::error('REFUND_NOT_ALLOWED', self::REFUND_HERE_REFUSED);
        }
        $decimals = WebMaven_Pod_Guards::decimals();
        $raw = $params['amount'] ?? null;
        $pattern = $decimals > 0 ? '/^\d{1,12}(\.\d{1,' . $decimals . '})?$/' : '/^\d{1,12}$/';
        if (!is_string($raw) || !preg_match($pattern, $raw) || (float) $raw <= 0) {
            throw self::error('VALIDATION', 'The amount must be a number above zero, like ' . ($decimals > 0 ? '12.' . str_repeat('5', $decimals) : '12') . '.');
        }
        $amount = number_format((float) $raw, $decimals, '.', '');
        $left = (float) $order->get_remaining_refund_amount();
        if (WebMaven_Pod_Guards::to_minor($amount) > WebMaven_Pod_Guards::to_minor($left)) {
            throw self::error('REFUND_TOO_HIGH', 'This order has ' . self::money($left) . ' ' . (string) $order->get_currency() . ' left to refund.');
        }
        $reason = is_string($params['reason'] ?? null) ? trim(sanitize_text_field($params['reason'])) : '';
        if (strlen($reason) > self::REASON_MAX) {
            throw self::error('VALIDATION', 'The reason has at most 500 characters.');
        }
        $restock = self::boolean($params['restock'] ?? false, 'restock');
        $api_refund = self::boolean($params['api_refund'] ?? false, 'api_refund');
        if ($api_refund && !self::gateway_refunds($order)) {
            throw self::error('REFUND_NOT_ALLOWED', 'This payment method cannot send the money back by itself. Record the refund, then send the money back yourself.');
        }
        $line_items = [];
        if ($restock) {
            if (WebMaven_Pod_Guards::to_minor($amount) !== WebMaven_Pod_Guards::to_minor($left)) {
                throw self::error('VALIDATION', 'Putting items back in stock works when the whole amount left is refunded.');
            }
            foreach ((array) $order->get_items('line_item') as $item_id => $item) {
                $product = $item->get_product();
                if (WebMaven_Pod_Guards::is_printed((int) $item->get_product_id()) || !is_object($product)
                    || !method_exists($product, 'managing_stock') || !$product->managing_stock()) {
                    continue;
                }
                $quantity = (int) $item->get_quantity() - abs((int) $order->get_qty_refunded_for_item($item_id));
                if ($quantity > 0) {
                    $line_items[(int) $item_id] = ['qty' => $quantity, 'refund_total' => 0, 'refund_tax' => []];
                }
            }
        }
        $refund = wc_create_refund([
            'order_id' => (int) $order->get_id(),
            'amount' => $amount,
            'reason' => $reason,
            'refund_payment' => $api_refund,
            'restock_items' => (bool) $line_items,
            'line_items' => $line_items,
        ]);
        if (is_wp_error($refund)) {
            throw self::error('WRITE_FAILED', 'The refund did not go through: ' . self::plain(wp_strip_all_tags($refund->get_error_message())));
        }
        return ['refundId' => (int) $refund->get_id(), 'amount' => $amount];
    }

    // ── Values ─────────────────────────────────────────────────────────────

    private static function require_store(): void {
        if (!function_exists('wc_get_order')) {
            throw self::error('NO_STORE', 'WooCommerce is not active on this site, so it has no orders.');
        }
    }

    private static function order($raw) {
        self::require_store();
        $id = self::positive_int($raw);
        $order = $id > 0 ? wc_get_order($id) : null;
        // A refund is an order object too: only real orders here.
        if (!$order || (method_exists($order, 'get_type') && $order->get_type() !== 'shop_order')) {
            throw self::error('NOT_FOUND', 'Order ' . $id . ' was not found.');
        }
        return $order;
    }

    /** An amount as WooCommerce writes it, with the store's decimals ("41.90"). */
    private static function money($value): string {
        return number_format((float) $value, WebMaven_Pod_Guards::decimals(), '.', '');
    }

    /** The billing name, else the company, else "Guest". */
    private static function customer_name(string $first, string $last, string $company): string {
        $name = WebMaven_Cap_Store_Catalog::text(trim($first . ' ' . $last));
        if ($name !== '') {
            return $name;
        }
        $company = WebMaven_Cap_Store_Catalog::text($company);
        return $company !== '' ? $company : 'Guest';
    }

    /** A WooCommerce date as ISO 8601 UTC ("2026-10-05T10:42:00"), '' when none. */
    private static function gmt($date): string {
        if (is_object($date) && method_exists($date, 'getTimestamp')) {
            return gmdate('Y-m-d\TH:i:s', (int) $date->getTimestamp());
        }
        return '';
    }

    private static function boolean($value, string $what): bool {
        if (!is_bool($value)) {
            throw self::error('VALIDATION', $what . ' must be true or false.');
        }
        return $value;
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
