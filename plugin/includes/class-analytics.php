<?php
/**
 * WebMaven Analytics
 * Adds the lightweight tracker to the site's pages, once the owner turned
 * visitor statistics on (WebMaven_Choices). The tracker ships in the plugin
 * (assets/tracker.js) and only sends its counts to the API: WordPress is not
 * in the data path, and no code is loaded from WPMaven's servers.
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/class-webmaven-choices.php';

class WebMaven_Analytics {

    private $plugin;

    public function __construct($plugin) {
        $this->plugin = $plugin;
    }

    /**
     * Initialize analytics tracking.
     * Only hooks on frontend pages (not admin, not AJAX, not REST).
     */
    public function init() {
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }

        add_action('wp_enqueue_scripts', [$this, 'inject_tracker']);
        add_action('woocommerce_thankyou', [$this, 'print_order_context'], 10, 1);
    }

    /**
     * Inject the tracker script on frontend pages.
     */
    public function inject_tracker() {
        $tracking_id = get_option('webmaven_wp_tracking_id', '');
        if (!$tracking_id) return;

        if (!WebMaven_Choices::on('analytics_enabled')) return;

        $settings = get_option('webmaven_wp_settings', []);
        $api_url = $settings['browser_api_base_url'] ?? WEBMAVEN_WP_BROWSER_API_BASE_URL;

        wp_enqueue_script('webmaven-tracker', WEBMAVEN_WP_URL . 'assets/tracker.js', [], WEBMAVEN_WP_VERSION, ['in_footer' => true, 'strategy' => 'defer']);
        wp_add_inline_script('webmaven-tracker', 'window.wpmavenTracker = ' . wp_json_encode([
            'id' => (string) $tracking_id,
            'collect' => rtrim((string) $api_url, '/') . '/analytics/collect',
        ]) . ';', 'before');
    }

    /**
     * Print the real order context on the WooCommerce thank-you page so the
     * tracker can send an 'order' event with the exact total (numbers, not
     * formatted strings). Only fires on woocommerce_thankyou, only when the
     * order exists, and only when the tracker itself would be injected.
     */
    public function print_order_context($order_id) {
        if (!class_exists('WooCommerce') || !function_exists('wc_get_order')) return;
        if (!$order_id) return;

        // Same gates as inject_tracker: no tracker means no consumer for this.
        $tracking_id = get_option('webmaven_wp_tracking_id', '');
        if (!$tracking_id) return;

        if (!WebMaven_Choices::on('analytics_enabled')) return;

        $order = wc_get_order($order_id);
        if (!$order) return;

        $context = [
            'id'       => $order->get_id(),
            'total'    => (float) $order->get_total(),
            'currency' => $order->get_currency(),
        ];

        echo '<script>window.__wpmavenOrder = ' . wp_json_encode($context) . ';</script>' . "\n";
    }
}
