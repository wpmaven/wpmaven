<?php
/**
 * WPMaven Payments in the block checkout (2026-10-01). Generated stores use
 * the block checkout, so the gateway must be registered here too. No fields:
 * placing the order sends the buyer to the pay page (see
 * WebMaven_Payments_Gateway::process_payment), as in the classic checkout.
 */

if (!defined('ABSPATH')) {
    exit;
}

use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

final class WebMaven_Payments_Blocks extends AbstractPaymentMethodType {

    protected $name = 'webmaven_payments';

    public function initialize() {
        $this->settings = [];
    }

    public function is_active() {
        return WebMaven_Payments::enabled();
    }

    public function get_payment_method_script_handles() {
        wp_register_script(
            'webmaven-payments-blocks',
            WEBMAVEN_WP_URL . 'includes/webmaven-payments-blocks.js',
            ['wc-blocks-registry', 'wc-settings', 'wp-element', 'wp-html-entities'],
            WEBMAVEN_WP_VERSION,
            true
        );
        return ['webmaven-payments-blocks'];
    }

    public function get_payment_method_data() {
        return [
            'title' => WebMaven_Payments::TITLE,
            'description' => WebMaven_Payments::DESCRIPTION,
            'supports' => ['products'],
        ];
    }
}
