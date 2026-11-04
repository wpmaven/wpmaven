<?php
/**
 * WPMaven Payments (2026-10-01): the store side of the business's Stripe
 * account, which the WPMaven API runs (its payment account service and the
 * site payment routes).
 *
 * The site never holds a Stripe secret and never decides that an order is
 * paid. The flow:
 *
 *  1. The buyer places the order with the "Card or wallet" gateway
 *     (WebMaven_Payments_Gateway, also offered in the block checkout). The
 *     order stays pending and the buyer lands on the order's pay page.
 *  2. The pay page asks the API for a payment (POST /sites/payments/intents
 *     with the order id and key). The API reads the order back from this site
 *     (store_order_read), checks it, and answers the client secret and the
 *     platform's publishable key. Stripe's Payment Element confirms the
 *     payment in the buyer's browser (3D Secure included).
 *  3. Stripe tells the API, and the API sends order_mark_paid
 *     (capabilities/payments.php), the only place an order is marked paid.
 *     Meanwhile the order-received page says "Confirming your payment" and
 *     polls this plugin's order-status route.
 *
 * Refunds made in WP admin go to the API (process_refund), and so do orders
 * the owner cancels. Settings live in webmaven_payments_* options, written
 * only by the payments_configure command; the self-protection already
 * refuses generic writes to them (OPTION_NAMESPACE covers webmaven_*).
 *
 * Print-on-demand products (meta _wm_pod_product, written by
 * woocommerce_create_product) can only be paid this way: they are not
 * purchasable while payments are off, and a checkout holding one offers
 * this gateway only.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-webmaven-log.php';

final class WebMaven_Payments {

    const GATEWAY_ID = 'webmaven_payments';

    const OPTION_ENABLED = 'webmaven_payments_enabled';
    const OPTION_PUBLISHABLE_KEY = 'webmaven_payments_publishable_key';
    const OPTION_ACCOUNT_ID = 'webmaven_payments_account_id';

    /** Same meta as WebMaven_Webhook_Actions::POD_PRODUCT_META. */
    const POD_PRODUCT_META = '_wm_pod_product';

    /** Order meta: every Stripe refund id already recorded on the order. */
    const REFUND_IDS_META = '_wm_refund_ids';

    /** Order meta: a WP-admin refund on its way to the API ({amount, at}). */
    const REFUND_PENDING_META = '_wm_refund_pending';

    /** How long a WP-admin refund waits for its id before the marker is stale. */
    const REFUND_PENDING_TTL = 600;

    const ROUTE_NAMESPACE = 'webmaven_wp/v1';
    const STATUS_ROUTE = '/payments/order-status';

    /** Stripe.js is always loaded from Stripe, never self-hosted (PCI). */
    const STRIPE_JS = 'https://js.stripe.com/v3/';

    const PUBLISHABLE_KEY_PATTERN = '/^pk_(?:test|live)_[A-Za-z0-9]{10,}$/';
    const CLIENT_SECRET_PATTERN = '/^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/';
    const ACCOUNT_PATTERN = '/^acct_[A-Za-z0-9]{6,}$/';

    /** Buyer copy (checkout and pay page). */
    const TITLE = 'Card or wallet';
    const DESCRIPTION = 'Pay securely by card, Apple Pay or Google Pay. Payments are processed by Stripe.';
    const START_FAILED = 'We could not start the payment. Please try again in a moment.';

    /** Tests replace the API client (a callable returning an object with make_request). */
    public static $api_factory = null;

    public static function init(): void {
        add_action('plugins_loaded', [__CLASS__, 'load_gateway'], 11);
        add_filter('woocommerce_payment_gateways', [__CLASS__, 'register_gateway']);
        add_action('woocommerce_blocks_payment_method_type_registration', [__CLASS__, 'register_blocks']);
        add_filter('woocommerce_is_purchasable', [__CLASS__, 'filter_purchasable'], 20, 2);
        add_filter('woocommerce_variation_is_purchasable', [__CLASS__, 'filter_purchasable'], 20, 2);
        add_filter('woocommerce_available_payment_gateways', [__CLASS__, 'filter_gateways'], 100);
        add_action('woocommerce_order_status_cancelled', [__CLASS__, 'on_cancelled'], 10, 2);
        add_action('rest_api_init', [__CLASS__, 'register_routes']);
        add_action('woocommerce_email_before_order_table', [__CLASS__, 'email_tracking'], 10, 4);
    }

    // ── Settings ────────────────────────────────────────────────────────────

    /** The platform's publishable key, or '' when none (or not a publishable key) is stored. */
    public static function publishable_key(): string {
        $key = trim((string) get_option(self::OPTION_PUBLISHABLE_KEY, ''));
        return preg_match(self::PUBLISHABLE_KEY_PATTERN, $key) ? $key : '';
    }

    /** On, with a key to load Stripe with. */
    public static function enabled(): bool {
        return get_option(self::OPTION_ENABLED, 'no') === 'yes' && self::publishable_key() !== '';
    }

    // ── Gateway registration ────────────────────────────────────────────────

    public static function load_gateway(): void {
        if (class_exists('WC_Payment_Gateway') && !class_exists('WebMaven_Payments_Gateway')) {
            require_once __DIR__ . '/class-webmaven-payments-gateway.php';
        }
    }

    public static function register_gateway($methods) {
        self::load_gateway();
        if (class_exists('WebMaven_Payments_Gateway')) {
            $methods[] = 'WebMaven_Payments_Gateway';
        }
        return $methods;
    }

    public static function register_blocks($registry): void {
        if (!class_exists('Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType')) {
            return;
        }
        require_once __DIR__ . '/class-webmaven-payments-blocks.php';
        $registry->register(new WebMaven_Payments_Blocks());
    }

    // ── Print-on-demand products ────────────────────────────────────────────

    /** True for a print-on-demand product, or a variation of one. */
    public static function is_pod_product($product): bool {
        if (!is_object($product) || !method_exists($product, 'get_id')) {
            return false;
        }
        $parent = method_exists($product, 'get_parent_id') ? (int) $product->get_parent_id() : 0;
        $id = $parent > 0 ? $parent : (int) $product->get_id();
        return $id > 0 && (string) get_post_meta($id, self::POD_PRODUCT_META, true) !== '';
    }

    /** A print-on-demand product can only be bought once payments are on. */
    public static function filter_purchasable($purchasable, $product) {
        if ($purchasable && !self::enabled() && self::is_pod_product($product)) {
            return false;
        }
        return $purchasable;
    }

    /** True when the cart, or the order being paid, holds a print-on-demand product. */
    public static function pod_in_checkout(): bool {
        if (function_exists('WC')) {
            $wc = WC();
            if (is_object($wc) && isset($wc->cart) && is_object($wc->cart)) {
                foreach ((array) $wc->cart->get_cart() as $line) {
                    if (self::is_pod_product($line['data'] ?? null)) {
                        return true;
                    }
                }
            }
        }
        $pay = isset($GLOBALS['wp']) && is_object($GLOBALS['wp']) ? ($GLOBALS['wp']->query_vars['order-pay'] ?? null) : null;
        if ($pay && function_exists('wc_get_order')) {
            $order = wc_get_order(absint($pay));
            if ($order) {
                foreach ($order->get_items('line_item') as $item) {
                    if (self::is_pod_product($item->get_product())) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * A checkout holding a print-on-demand product offers WPMaven Payments
     * only: the order must be paid where the API can check it and print it.
     */
    public static function filter_gateways($gateways) {
        if (!is_array($gateways) || (is_admin() && !wp_doing_ajax())) {
            return $gateways;
        }
        if (!self::pod_in_checkout()) {
            return $gateways;
        }
        return isset($gateways[self::GATEWAY_ID]) ? [self::GATEWAY_ID => $gateways[self::GATEWAY_ID]] : [];
    }

    // ── The API ─────────────────────────────────────────────────────────────

    private static function api() {
        if (is_callable(self::$api_factory)) {
            return call_user_func(self::$api_factory);
        }
        return new WebMaven_WP_API_Client();
    }

    /** The API's sentence when it gave one, else $fallback. */
    private static function api_error($response, string $fallback): string {
        $error = is_array($response) ? ($response['error'] ?? '') : '';
        return is_string($error) && trim($error) !== '' ? trim($error) : $fallback;
    }

    /** An amount as WooCommerce writes it ("29.00"). */
    public static function money($amount): string {
        return (string) wc_format_decimal($amount, wc_get_price_decimals());
    }

    // ── The pay page ────────────────────────────────────────────────────────

    /**
     * Ask the API for the order's payment. Never logged: the answer carries
     * the client secret, so the request goes with $log_payload = false.
     *
     * stripe_account is set when the payment lives on the business's own
     * Stripe account (a direct charge, for a business that linked the Stripe
     * account it already had): Stripe.js must then confirm it there.
     *
     * @return array{ok: bool, error?: string, client_secret?: string, publishable_key?: string, stripe_account?: string}
     */
    public static function start_payment($order): array {
        $response = self::api()->make_request('/sites/payments/intents', 'POST', [
            'orderId' => (int) $order->get_id(),
            'orderKey' => (string) $order->get_order_key(),
        ], null, 30, 0, false);
        if (!is_array($response) || empty($response['success'])) {
            return ['ok' => false, 'error' => self::api_error($response, self::START_FAILED)];
        }
        $data = is_array($response['data'] ?? null) ? $response['data'] : [];
        $secret = (string) ($data['clientSecret'] ?? '');
        $key = (string) ($data['publishableKey'] ?? '');
        $account = $data['stripeAccount'] ?? null;
        $account = is_string($account) ? trim($account) : '';
        if (!preg_match(self::CLIENT_SECRET_PATTERN, $secret) || !preg_match(self::PUBLISHABLE_KEY_PATTERN, $key)
            || ($account !== '' && !preg_match(self::ACCOUNT_PATTERN, $account))) {
            return ['ok' => false, 'error' => self::START_FAILED];
        }
        return ['ok' => true, 'client_secret' => $secret, 'publishable_key' => $key, 'stripe_account' => $account];
    }

    private static function enqueue_checkout_script(): void {
        wp_enqueue_script('webmaven-stripe-js', self::STRIPE_JS, [], null, true);
        wp_enqueue_script(
            'webmaven-payments-checkout',
            WEBMAVEN_WP_URL . 'includes/webmaven-payments-checkout.js',
            ['webmaven-stripe-js'],
            WEBMAVEN_WP_VERSION,
            true
        );
    }

    /** The pay page: Stripe's Payment Element for this order, or the reason it cannot open. */
    public static function receipt_html($order): string {
        if (!$order || $order->get_payment_method() !== self::GATEWAY_ID) {
            return '';
        }
        if ($order->is_paid()) {
            return '<p class="wm-pay__done">' . esc_html('This order is already paid. Thank you!') . '</p>';
        }
        $start = self::start_payment($order);
        if (!$start['ok']) {
            return '<div class="wm-pay"><p class="wm-pay__error" role="alert">' . esc_html($start['error']) . '</p></div>';
        }
        self::enqueue_checkout_script();
        return '<div class="wm-pay" data-wm-pay'
            . ' data-publishable-key="' . esc_attr($start['publishable_key']) . '"'
            . ' data-client-secret="' . esc_attr($start['client_secret']) . '"'
            . ($start['stripe_account'] !== '' ? ' data-stripe-account="' . esc_attr($start['stripe_account']) . '"' : '')
            . ' data-return-url="' . esc_attr($order->get_checkout_order_received_url()) . '">'
            . '<div class="wm-pay__element"></div>'
            . '<p class="wm-pay__error" role="alert" hidden></p>'
            . '<button type="button" class="button alt wm-pay__submit" disabled>' . esc_html('Pay now') . '</button>'
            . '<p class="wm-pay__note">' . esc_html('Payments are processed by Stripe.') . '</p>'
            . '</div>';
    }

    /** The order-received page while the payment is being confirmed. */
    public static function thankyou_html($order, array $query = []): string {
        if (!$order || $order->get_payment_method() !== self::GATEWAY_ID || $order->is_paid()) {
            return '';
        }
        if (($query['redirect_status'] ?? '') === 'failed' || $order->get_status() === 'failed') {
            return '<div class="wm-pay-confirming wm-pay-confirming--failed" role="status"><p>'
                . esc_html('Your payment did not go through. No money was taken.')
                . ' <a href="' . esc_url($order->get_checkout_payment_url(true)) . '">' . esc_html('Try again') . '</a></p></div>';
        }
        if (!in_array($order->get_status(), ['pending', 'on-hold'], true)) {
            return '';
        }
        self::enqueue_checkout_script();
        $url = add_query_arg(
            ['order_id' => (int) $order->get_id(), 'key' => (string) $order->get_order_key()],
            rest_url(self::ROUTE_NAMESPACE . self::STATUS_ROUTE)
        );
        return '<div class="wm-pay-confirming" role="status" data-wm-pay-status="' . esc_attr($url) . '"'
            . ' data-retry-url="' . esc_attr($order->get_checkout_payment_url(true)) . '">'
            . '<p><strong>' . esc_html('Confirming your payment') . '</strong></p>'
            . '<p class="wm-pay-confirming__detail">' . esc_html('This usually takes a few seconds. You can keep this page open.') . '</p>'
            . '</div>';
    }

    // ── Tracking in the "order complete" email ──────────────────────────────

    /**
     * The first parcel completes the order, and WooCommerce's "order complete"
     * email carries its tracking (order_shipped then keeps its own note
     * private, so the buyer gets one email, not two).
     */
    public static function email_tracking($order, $sent_to_admin = false, $plain_text = false, $email = null): void {
        if ($sent_to_admin || !is_object($email) || ($email->id ?? '') !== 'customer_completed_order'
            || !is_object($order) || $order->get_payment_method() !== self::GATEWAY_ID) {
            return;
        }
        $shipments = $order->get_meta('_wm_tracking', true);
        if (!is_array($shipments) || !$shipments) {
            return;
        }
        foreach ($shipments as $shipment) {
            if (!is_array($shipment)) {
                continue;
            }
            $line = self::tracking_line($shipment);
            $url = (string) ($shipment['tracking_url'] ?? '');
            if ($plain_text) {
                echo $line . ($url !== '' ? ' ' . esc_url_raw($url) : '') . "\n\n"; // phpcs:ignore WordPress.Security.EscapeOutput -- plain text email
            } else {
                echo '<p>' . esc_html($line) . ($url !== '' ? ' <a href="' . esc_url($url) . '">' . esc_html('Track your parcel') . '</a>' : '') . '</p>';
            }
        }
    }

    /** "Your order is on its way with DHL. Tracking number: JD0001." */
    public static function tracking_line(array $shipment): string {
        $carrier = trim((string) ($shipment['carrier'] ?? ''));
        $number = trim((string) ($shipment['tracking_number'] ?? ''));
        return 'Your order is on its way' . ($carrier !== '' ? ' with ' . $carrier : '') . '.'
            . ($number !== '' ? ' Tracking number: ' . $number . '.' : '');
    }

    // ── Order status for the order-received page ────────────────────────────

    public static function register_routes(): void {
        register_rest_route(self::ROUTE_NAMESPACE, self::STATUS_ROUTE, [
            'methods' => 'GET',
            'permission_callback' => '__return_true',
            'callback' => [__CLASS__, 'order_status'],
        ]);
    }

    /**
     * {status, paid, failed} for an order paid with this gateway, when the
     * caller holds its order key (the buyer's order-received link has it).
     */
    public static function order_status($request) {
        $order_id = absint($request->get_param('order_id'));
        $key = (string) $request->get_param('key');
        $order = $order_id ? wc_get_order($order_id) : null;
        if (!$order || $key === '' || !hash_equals((string) $order->get_order_key(), $key)
            || $order->get_payment_method() !== self::GATEWAY_ID) {
            return new WP_REST_Response(['error' => 'Order not found.'], 404);
        }
        $status = (string) $order->get_status();
        return new WP_REST_Response([
            'status' => $status,
            'paid' => (bool) $order->is_paid(),
            'failed' => $status === 'failed',
        ], 200);
    }

    // ── Refunds and cancellations (WP admin -> API) ─────────────────────────

    /** @return array Stripe refund ids already on the order. */
    public static function refund_ids($order): array {
        $ids = $order->get_meta(self::REFUND_IDS_META, true);
        return is_array($ids) ? array_values(array_filter($ids, 'is_string')) : [];
    }

    public static function remember_refund_id($order, string $refund_id): void {
        $ids = self::refund_ids($order);
        if (!in_array($refund_id, $ids, true)) {
            $ids[] = $refund_id;
            $order->update_meta_data(self::REFUND_IDS_META, $ids);
        }
    }

    /**
     * WP admin's refund: the API refunds through Stripe (and cancels the print
     * order when it can); WooCommerce records the refund itself. The id the
     * API answers is kept, so the API's own record of it is not added twice.
     *
     * @return true|WP_Error
     */
    public static function refund($order, $amount, string $reason = '') {
        if ($amount === null || (float) $amount <= 0) {
            return new WP_Error('webmaven_payments_refund', 'Enter an amount to refund.');
        }
        $value = self::money($amount);
        $order->update_meta_data(self::REFUND_PENDING_META, ['amount' => $value, 'at' => time()]);
        $order->save();
        $response = self::api()->make_request('/sites/payments/refunds', 'POST', [
            'orderId' => (int) $order->get_id(),
            'amount' => $value,
            'reason' => sanitize_text_field($reason),
        ], null, 30, 0, false);
        $order->delete_meta_data(self::REFUND_PENDING_META);
        if (!is_array($response) || empty($response['success'])) {
            $order->save();
            return new WP_Error('webmaven_payments_refund', self::api_error($response, 'The refund did not go through. Please try again.'));
        }
        $data = is_array($response['data'] ?? null) ? $response['data'] : [];
        $refund_id = sanitize_text_field((string) ($data['refundId'] ?? ''));
        if ($refund_id !== '') {
            self::remember_refund_id($order, $refund_id);
        }
        // The API says what Stripe keeps of its card fee (a decimal in the order currency, or null).
        $fee = $data['stripeFeeKept'] ?? null;
        $fee_note = '';
        if ((is_string($fee) || is_int($fee) || is_float($fee)) && is_numeric($fee) && (float) $fee > 0) {
            $fee_note = sprintf(' Stripe keeps its card fee of %s %s.', self::money($fee), (string) $order->get_currency());
        }
        $order->add_order_note(sprintf('Refund of %s sent to Stripe%s.', $value, $refund_id !== '' ? ' (' . $refund_id . ')' : '') . $fee_note);
        $order->save();
        return true;
    }

    /** The owner cancelled an order paid this way in WP admin: the API cancels the print order and refunds. */
    public static function on_cancelled($order_id, $order = null): void {
        try {
            $order = is_object($order) ? $order : wc_get_order($order_id);
            if (!$order || $order->get_payment_method() !== self::GATEWAY_ID) {
                return;
            }
            $response = self::api()->make_request('/sites/orders/cancelled', 'POST', ['orderId' => (int) $order->get_id()], null, 30, 0, false);
            if (!is_array($response) || empty($response['success'])) {
                WebMaven_Log::write('WebMaven Payments: the API did not take the cancellation of order ' . (int) $order->get_id() . ': ' . self::api_error($response, 'no answer'));
            }
        } catch (\Throwable $e) {
            WebMaven_Log::write('WebMaven Payments: cancellation notice failed: ' . $e->getMessage());
        }
    }
}

WebMaven_Payments::init();
