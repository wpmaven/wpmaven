<?php
/**
 * WPMaven Payments commands (2026-10-01): the API's side of the store's
 * payments (its payment account service and the site payment routes).
 * Amounts are WooCommerce decimal strings in the order's currency. Results
 * arrive at the API wrapped in response.data.data.
 *
 *   payments_configure  {enabled, publishable_key, account_id}
 *     -> {configured: true, enabled}
 *   store_order_read    {order_id}
 *     -> {id, number, order_key, status, currency, total, subtotal,
 *         shipping_total, tax_total, discount_total, payment_method,
 *         customer_email, store_name, shipping: {name, company, address_1,
 *         address_2, city, state, postcode, country, phone, email},
 *         items: [{item_id, product_id, variation_id, name, quantity, total,
 *         tax, variant_key, pod, printful_product_id}]}
 *   order_mark_paid     {order_id, transaction_id}  -> {status}
 *   order_mark_failed   {order_id, reason}          -> {status, changed}
 *   order_shipped       {order_id, carrier, tracking_number, tracking_url} -> {status}
 *   order_record_refund {order_id, amount, reason, refund_id} -> {recorded}
 *
 * order_mark_paid is the only place an order of this gateway is marked paid
 * (payment_complete). Every command is idempotent: Stripe and the other
 * services redeliver events, and the API re-sends a command it got no answer to.
 *
 * Failures THROW (the webhook handler answers HTTP 500 with the message, which
 * the API reads as a failure), like class-webmaven-store-payments.php.
 * Registered through the filter, so the execute_command bridge
 * (webhook_<name>) cannot reach these.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['payments_configure'] = ['WebMaven_Cap_Payments', 'configure'];
    $handlers['store_order_read'] = ['WebMaven_Cap_Payments', 'order_read'];
    $handlers['order_mark_paid'] = ['WebMaven_Cap_Payments', 'mark_paid'];
    $handlers['order_mark_failed'] = ['WebMaven_Cap_Payments', 'mark_failed'];
    $handlers['order_shipped'] = ['WebMaven_Cap_Payments', 'shipped'];
    $handlers['order_record_refund'] = ['WebMaven_Cap_Payments', 'record_refund'];
    return $handlers;
});

final class WebMaven_Cap_Payments {

    /** Order meta: every shipment the API reported ([{carrier, tracking_number, tracking_url}]). */
    const TRACKING_META = '_wm_tracking';

    const ACCOUNT_PATTERN = '/^acct_[A-Za-z0-9]{6,}$/';

    // ── payments_configure ──────────────────────────────────────────────────

    public static function configure($params = [], $step_id = null) {
        if (!array_key_exists('enabled', $params) || !is_bool($params['enabled'])) {
            throw new Exception('payments_configure needs enabled (true or false).');
        }
        $key = trim((string) ($params['publishable_key'] ?? ''));
        $account = trim((string) ($params['account_id'] ?? ''));
        // A secret or restricted key never reaches a site, whatever the caller sends.
        if (preg_match('/^(?:sk|rk)_/', $key)) {
            throw new Exception('Only a publishable key is stored on the site.');
        }
        if ($key !== '' && !preg_match(WebMaven_Payments::PUBLISHABLE_KEY_PATTERN, $key)) {
            throw new Exception('The publishable key is not valid.');
        }
        if ($account !== '' && !preg_match(self::ACCOUNT_PATTERN, $account)) {
            throw new Exception('The account id is not valid.');
        }
        if ($params['enabled'] && ($key === '' || $account === '')) {
            throw new Exception('Turning payments on needs the publishable key and the account id.');
        }
        update_option(WebMaven_Payments::OPTION_PUBLISHABLE_KEY, $key);
        update_option(WebMaven_Payments::OPTION_ACCOUNT_ID, $account);
        update_option(WebMaven_Payments::OPTION_ENABLED, $params['enabled'] ? 'yes' : 'no');
        return ['configured' => true, 'enabled' => WebMaven_Payments::enabled()];
    }

    // ── Orders ──────────────────────────────────────────────────────────────

    /** The order the command names; throws when there is none. */
    private static function order($params) {
        if (!function_exists('wc_get_order')) {
            throw new Exception('WooCommerce is not active.');
        }
        $id = is_numeric($params['order_id'] ?? null) ? (int) $params['order_id'] : 0;
        $order = $id > 0 ? wc_get_order($id) : null;
        if (!$order) {
            throw new Exception('Order ' . $id . ' not found.');
        }
        return $order;
    }

    /** Orders of another gateway are never touched by these commands. */
    private static function ours($order) {
        if ($order->get_payment_method() !== WebMaven_Payments::GATEWAY_ID) {
            throw new Exception('Order ' . (int) $order->get_id() . ' was not paid with WPMaven Payments.');
        }
    }

    private static function decode_json($raw) {
        if (!is_string($raw) || $raw === '') {
            return null;
        }
        $value = json_decode($raw, true);
        return is_array($value) ? $value : null;
    }

    public static function order_read($params = [], $step_id = null) {
        $order = self::order($params);
        $items = [];
        foreach ($order->get_items('line_item') as $item_id => $item) {
            $product_id = (int) $item->get_product_id();
            $variation_id = (int) $item->get_variation_id();
            $pod_product = self::decode_json(get_post_meta($product_id, WebMaven_Payments::POD_PRODUCT_META, true));
            $items[] = [
                'item_id' => (int) $item_id,
                'product_id' => $product_id,
                'variation_id' => $variation_id,
                'name' => (string) $item->get_name(),
                'quantity' => (int) $item->get_quantity(),
                'total' => WebMaven_Payments::money($item->get_total()),
                'tax' => WebMaven_Payments::money($item->get_total_tax()),
                'variant_key' => $variation_id > 0 ? (string) get_post_meta($variation_id, '_wm_variant_key', true) : '',
                'pod' => self::decode_json(get_post_meta($variation_id > 0 ? $variation_id : $product_id, '_wm_pod', true)),
                'printful_product_id' => isset($pod_product['printful_product_id']) ? (int) $pod_product['printful_product_id'] : null,
            ];
        }
        return [
            'id' => (int) $order->get_id(),
            'number' => (string) $order->get_order_number(),
            'order_key' => (string) $order->get_order_key(),
            'status' => (string) $order->get_status(),
            'currency' => (string) $order->get_currency(),
            'total' => WebMaven_Payments::money($order->get_total()),
            'subtotal' => WebMaven_Payments::money($order->get_subtotal()),
            'shipping_total' => WebMaven_Payments::money($order->get_shipping_total()),
            'tax_total' => WebMaven_Payments::money($order->get_total_tax()),
            'discount_total' => WebMaven_Payments::money($order->get_discount_total()),
            'payment_method' => (string) $order->get_payment_method(),
            'customer_email' => (string) $order->get_billing_email(),
            'store_name' => wp_strip_all_tags((string) get_bloginfo('name')),
            'shipping' => self::ship_to($order),
            'items' => $items,
        ];
    }

    /** The shipping address, or the billing address when the order has none. */
    private static function ship_to($order): array {
        $side = trim((string) $order->get_shipping_address_1()) !== '' ? 'shipping' : 'billing';
        $get = function ($field) use ($order, $side) {
            $method = 'get_' . $side . '_' . $field;
            return is_callable([$order, $method]) ? trim((string) $order->$method()) : '';
        };
        $phone = $get('phone');
        if ($phone === '') {
            $phone = trim((string) $order->get_billing_phone());
        }
        return [
            'name' => trim($get('first_name') . ' ' . $get('last_name')),
            'company' => $get('company'),
            'address_1' => $get('address_1'),
            'address_2' => $get('address_2'),
            'city' => $get('city'),
            'state' => $get('state'),
            'postcode' => $get('postcode'),
            'country' => $get('country'),
            'phone' => $phone,
            'email' => trim((string) $order->get_billing_email()),
        ];
    }

    // ── order_mark_paid / order_mark_failed ─────────────────────────────────

    public static function mark_paid($params = [], $step_id = null) {
        $order = self::order($params);
        self::ours($order);
        $transaction = sanitize_text_field((string) ($params['transaction_id'] ?? ''));
        if ($transaction === '') {
            throw new Exception('order_mark_paid needs the transaction id.');
        }
        if ($order->is_paid()) {
            return ['status' => (string) $order->get_status()];
        }
        if (!$order->payment_complete($transaction)) {
            throw new Exception('Order ' . (int) $order->get_id() . ' could not be marked paid from status ' . $order->get_status() . '.');
        }
        $order->add_order_note('Payment confirmed by Stripe (' . $transaction . ').');
        return ['status' => (string) $order->get_status()];
    }

    public static function mark_failed($params = [], $step_id = null) {
        $order = self::order($params);
        self::ours($order);
        if ($order->get_status() !== 'pending') {
            return ['status' => (string) $order->get_status(), 'changed' => false];
        }
        $reason = sanitize_text_field((string) ($params['reason'] ?? ''));
        $order->update_status('failed', $reason !== '' ? 'Payment failed: ' . $reason : 'Payment failed.');
        return ['status' => (string) $order->get_status(), 'changed' => true];
    }

    // ── order_shipped ───────────────────────────────────────────────────────

    public static function shipped($params = [], $step_id = null) {
        $order = self::order($params);
        self::ours($order);
        $number = sanitize_text_field((string) ($params['tracking_number'] ?? ''));
        $carrier = sanitize_text_field((string) ($params['carrier'] ?? ''));
        $url = trim((string) ($params['tracking_url'] ?? ''));
        $url = preg_match('#^https?://#i', $url) ? esc_url_raw($url) : '';
        // Some parcels come with a tracking link only.
        if ($number === '' && $url === '') {
            throw new Exception('order_shipped needs a tracking number or a tracking link.');
        }
        $shipments = $order->get_meta(self::TRACKING_META, true);
        $shipments = is_array($shipments) ? $shipments : [];
        foreach ($shipments as $shipment) {
            if (!is_array($shipment)) {
                continue;
            }
            $same = $number !== ''
                ? ($shipment['tracking_number'] ?? '') === $number
                : ($shipment['tracking_number'] ?? '') === '' && ($shipment['tracking_url'] ?? '') === $url;
            if ($same) {
                return ['status' => (string) $order->get_status()];
            }
        }
        $shipment = ['carrier' => $carrier, 'tracking_number' => $number, 'tracking_url' => $url];
        $shipments[] = $shipment;
        $order->update_meta_data(self::TRACKING_META, $shipments);
        $order->save();
        $note = WebMaven_Payments::tracking_line($shipment) . ($url !== '' ? ' Track it here: ' . $url : '');
        // The first parcel completes the order: WooCommerce's "order complete"
        // email carries the tracking (WebMaven_Payments::email_tracking), so
        // the note stays private. A later parcel, or a store whose "order
        // complete" email is off, tells the buyer with a customer note.
        $completing = $order->get_status() !== 'completed';
        $order->add_order_note($note, !($completing && self::completed_email_on()));
        if ($completing) {
            $order->update_status('completed');
        }
        return ['status' => (string) $order->get_status()];
    }

    /** Whether WooCommerce sends the buyer its "order complete" email. */
    private static function completed_email_on(): bool {
        if (!function_exists('WC')) {
            return false;
        }
        $wc = WC();
        if (!is_object($wc) || !method_exists($wc, 'mailer')) {
            return false;
        }
        $mailer = $wc->mailer();
        $emails = is_object($mailer) && method_exists($mailer, 'get_emails') ? (array) $mailer->get_emails() : [];
        $email = $emails['WC_Email_Customer_Completed_Order'] ?? null;
        return is_object($email) && method_exists($email, 'is_enabled') && $email->is_enabled();
    }

    // ── order_record_refund ─────────────────────────────────────────────────

    public static function record_refund($params = [], $step_id = null) {
        $order = self::order($params);
        self::ours($order);
        $refund_id = (string) ($params['refund_id'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_]{3,255}$/', $refund_id)) {
            throw new Exception('order_record_refund needs the refund id.');
        }
        if (!is_numeric($params['amount'] ?? null) || (float) $params['amount'] <= 0) {
            throw new Exception('order_record_refund needs a positive amount.');
        }
        $amount = WebMaven_Payments::money($params['amount']);
        if (in_array($refund_id, WebMaven_Payments::refund_ids($order), true)) {
            return ['recorded' => false];
        }
        // A WP-admin refund still waiting for the API's answer: WooCommerce is
        // recording that one itself; only its id is kept.
        $pending = $order->get_meta(WebMaven_Payments::REFUND_PENDING_META, true);
        if (is_array($pending) && ($pending['amount'] ?? null) === $amount
            && time() - (int) ($pending['at'] ?? 0) <= WebMaven_Payments::REFUND_PENDING_TTL) {
            WebMaven_Payments::remember_refund_id($order, $refund_id);
            $order->delete_meta_data(WebMaven_Payments::REFUND_PENDING_META);
            $order->save();
            return ['recorded' => false];
        }
        if ((float) $amount > (float) $order->get_remaining_refund_amount() + 0.00001) {
            throw new Exception('Order ' . (int) $order->get_id() . ' has only ' . WebMaven_Payments::money($order->get_remaining_refund_amount()) . ' left to refund.');
        }
        $reason = sanitize_text_field((string) ($params['reason'] ?? ''));
        $refund = wc_create_refund([
            'order_id' => (int) $order->get_id(),
            'amount' => $amount,
            'reason' => $reason !== '' ? $reason : 'Refunded through WPMaven Payments.',
            'refund_payment' => false,
            'restock_items' => false,
        ]);
        if (is_wp_error($refund)) {
            throw new Exception('The refund could not be recorded: ' . $refund->get_error_message());
        }
        // The refund may have moved the order to refunded through its own copy.
        $order = wc_get_order((int) $order->get_id()) ?: $order;
        WebMaven_Payments::remember_refund_id($order, $refund_id);
        $order->save();
        return ['recorded' => true];
    }
}
