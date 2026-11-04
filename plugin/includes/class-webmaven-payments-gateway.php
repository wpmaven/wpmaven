<?php
/**
 * The "Card or wallet" gateway of WPMaven Payments (2026-10-01). Thin: the
 * logic lives in WebMaven_Payments (class-webmaven-payments.php).
 *
 * Loaded once WooCommerce is (WebMaven_Payments::load_gateway). No settings
 * screen: the payments_configure command turns it on and off. Placing the
 * order never confirms anything; it sends the buyer to the order's pay page,
 * where Stripe's Payment Element confirms the payment. Only the API's
 * order_mark_paid command marks the order paid.
 */

if (!defined('ABSPATH')) {
    exit;
}

class WebMaven_Payments_Gateway extends WC_Payment_Gateway {

    public function __construct() {
        $this->id = WebMaven_Payments::GATEWAY_ID;
        $this->method_title = 'WPMaven Payments';
        $this->method_description = 'Card and wallet payments processed by Stripe, paid out to the business. ' . self::turned_on_text();
        $this->title = WebMaven_Payments::TITLE;
        $this->description = WebMaven_Payments::DESCRIPTION;
        $this->has_fields = false;
        $this->supports = ['products', 'refunds'];
        $this->enabled = WebMaven_Payments::enabled() ? 'yes' : 'no';
        $this->form_fields = [];

        add_action('woocommerce_receipt_' . $this->id, [$this, 'receipt_page']);
        add_action('woocommerce_thankyou_' . $this->id, [$this, 'thankyou_page']);
    }

    /**
     * Where the gateway is turned on, as WooCommerce's payment settings say
     * it: the brand's dashboard on a site under an agency's or a partner's
     * brand (WebMaven_Brand), "your dashboard" while that brand has no name.
     * Unchanged on a WPMaven site.
     */
    public static function turned_on_text() {
        if (!class_exists('WebMaven_Brand') || WebMaven_Brand::is_wpmaven()) {
            return 'Turned on from the WPMaven dashboard.';
        }
        return WebMaven_Brand::mode() === WebMaven_Brand::MODE_BRAND
            ? sprintf('Turned on from the %s dashboard.', WebMaven_Brand::name())
            : 'Turned on from your dashboard.';
    }

    /** Settings come from the payments_configure command, never from this screen. */
    public function process_admin_options() {
        return false;
    }

    public function is_available() {
        return WebMaven_Payments::enabled();
    }

    public function process_payment($order_id) {
        $order = wc_get_order($order_id);
        if (!$order) {
            wc_add_notice('We could not find your order. Please try again.', 'error');
            return ['result' => 'failure'];
        }
        return [
            'result' => 'success',
            'redirect' => $order->get_checkout_payment_url(true),
        ];
    }

    public function process_refund($order_id, $amount = null, $reason = '') {
        $order = wc_get_order($order_id);
        if (!$order) {
            return new WP_Error('webmaven_payments_refund', 'Order not found.');
        }
        return WebMaven_Payments::refund($order, $amount, (string) $reason);
    }

    public function receipt_page($order_id) {
        echo WebMaven_Payments::receipt_html(wc_get_order($order_id)); // phpcs:ignore WordPress.Security.EscapeOutput -- escaped inside
    }

    public function thankyou_page($order_id) {
        $query = [];
        if (isset($_GET['redirect_status'])) { // phpcs:ignore WordPress.Security.NonceVerification -- Stripe's return parameter, read only
            $query['redirect_status'] = sanitize_key(wp_unslash($_GET['redirect_status']));
        }
        // nosemgrep: php.lang.security.injection.echoed-request.echoed-request -- the only request value is sanitize_key()'d, and the html is escaped inside
        echo WebMaven_Payments::thankyou_html(wc_get_order($order_id), $query); // phpcs:ignore WordPress.Security.EscapeOutput -- escaped inside
    }
}
