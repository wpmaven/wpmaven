<?php
/**
 * The store's ways to get paid, read on the site (1.3.0), for the app's
 * Payments screen: WPMaven Payments and the other gateways WPMaven knows
 * (WooPayments, Stripe, PayPal Payments) with their state, straight from
 * WooCommerce. Nothing here reaches the WPMaven API.
 *
 * "Set up" opens WooCommerce's own screens: the gateway's settings when its
 * plugin runs, the plugin installer otherwise (administrators only; a Shop
 * manager is told an administrator can add it). Connecting a provider needs
 * its own pages and the owner's identity, so it never starts from here.
 *
 * The screen offers only the gateways that can pay a business in the store's
 * currency (1.9.1): storeCurrency says
 * which, from the API's table copied here (STORE_CURRENCY_PAYMENTS), in the
 * shape of the API's payment status. Every gateway is still listed with its
 * state, a connected one included.
 *
 *   GET webmaven_wp/v1/store/gateways   Shop managers and administrators
 *   -> {success, data: {woocommerce, wpmaven: {enabled}, gateways: [{id,
 *       title, connected, enabled, active, setupUrl}], printedProducts,
 *       manageUrl, storeCurrency: {code, services, wpmavenPayments, note}
 *       or null}}
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Store_Gateways {

    /** The gateways in the screen's order (WebMaven_Store_Payments::GATEWAYS). */
    const ALL_GATEWAYS = ['woocommerce_payments', 'stripe', 'ppcp'];

    /**
     * Which gateways can pay a business in each currency a WPMaven store
     * sells in: the API's table, code => [where its businesses are, its name in
     * a sentence, the gateways that pay a business there in it]. None pays a
     * business in five of them: they stay offered, and the owner reads why
     * (the note). A currency not here (a store in Thai baht, one still in
     * lev) keeps every gateway, as before. A test pins it to the API's.
     */
    const STORE_CURRENCY_PAYMENTS = [
        'USD' => ['the United States', 'US dollars', self::ALL_GATEWAYS],
        'EUR' => ['the euro area', 'euros', self::ALL_GATEWAYS],
        'GBP' => ['the United Kingdom', 'British pounds', self::ALL_GATEWAYS],
        'CAD' => ['Canada', 'Canadian dollars', self::ALL_GATEWAYS],
        'AUD' => ['Australia', 'Australian dollars', self::ALL_GATEWAYS],
        'NZD' => ['New Zealand', 'New Zealand dollars', self::ALL_GATEWAYS],
        'JPY' => ['Japan', 'Japanese yen', self::ALL_GATEWAYS],
        'CHF' => ['Switzerland', 'Swiss francs', self::ALL_GATEWAYS],
        'SEK' => ['Sweden', 'Swedish kronor', self::ALL_GATEWAYS],
        'NOK' => ['Norway', 'Norwegian kroner', self::ALL_GATEWAYS],
        'DKK' => ['Denmark', 'Danish kroner', self::ALL_GATEWAYS],
        'PLN' => ['Poland', 'Polish zlotys', self::ALL_GATEWAYS],
        'CZK' => ['the Czech Republic', 'Czech korunas', self::ALL_GATEWAYS],
        'HUF' => ['Hungary', 'Hungarian forints', self::ALL_GATEWAYS],
        // PayPal does not take Romanian lei.
        'RON' => ['Romania', 'Romanian lei', ['woocommerce_payments', 'stripe']],
        // WooPayments has no business accounts in Brazil or Mexico.
        'BRL' => ['Brazil', 'Brazilian reals', ['stripe', 'ppcp']],
        'MXN' => ['Mexico', 'Mexican pesos', ['stripe', 'ppcp']],
        // None of the three pays a business there in it.
        'INR' => ['India', 'Indian rupees', []],
        'ZAR' => ['South Africa', 'South African rand', []],
        'SGD' => ['Singapore', 'Singapore dollars', self::ALL_GATEWAYS],
        'HKD' => ['Hong Kong', 'Hong Kong dollars', self::ALL_GATEWAYS],
        'KRW' => ['South Korea', 'South Korean won', []],
        'ARS' => ['Argentina', 'Argentine pesos', []],
        'CLP' => ['Chile', 'Chilean pesos', []],
        // PayPal does not take UAE dirhams.
        'AED' => ['the United Arab Emirates', 'UAE dirhams', ['woocommerce_payments', 'stripe']],
        // Neither WooPayments nor Stripe has business accounts in the Philippines.
        'PHP' => ['the Philippines', 'Philippine pesos', ['ppcp']],
        // Nor in Israel; PayPal takes shekels.
        'ILS' => ['Israel', 'Israeli new shekels', ['ppcp']],
    ];

    public static function register_routes() {
        register_rest_route('webmaven_wp/v1', '/store/gateways', [
            'methods' => 'GET',
            'permission_callback' => [__CLASS__, 'can_read'],
            'callback' => [__CLASS__, 'handle'],
        ]);
    }

    /** Shop managers and administrators: WooCommerce's payment settings are theirs. */
    public static function can_read() {
        $tier = class_exists('WebMaven_Actor') ? WebMaven_Actor::current_tier() : null;
        return $tier === 'owner' || $tier === 'store';
    }

    public static function handle() {
        return new \WP_REST_Response(['success' => true, 'data' => self::read()]);
    }

    /** What the Payments screen lists, as the site holds it. */
    public static function read() {
        $woocommerce = class_exists('WooCommerce') && function_exists('WC');
        $can_install = function_exists('current_user_can') && current_user_can('install_plugins');
        $out = [
            'woocommerce' => $woocommerce,
            'wpmaven' => ['enabled' => class_exists('WebMaven_Payments') && WebMaven_Payments::enabled()],
            'gateways' => [],
            'printedProducts' => $woocommerce && self::sells_printed_products(),
            'manageUrl' => $woocommerce ? admin_url('admin.php?page=wc-settings&tab=checkout') : null,
            'storeCurrency' => $woocommerce ? self::store_currency_offer(get_option('woocommerce_currency', '')) : null,
        ];
        if (!$woocommerce || !class_exists('WebMaven_Store_Payments')) {
            return $out;
        }
        foreach (WebMaven_Store_Payments::GATEWAYS as $key => $def) {
            try {
                $status = WebMaven_Store_Payments::gateway_status(['gateway' => $key]);
            } catch (\Throwable $e) {
                $status = ['connected' => 'none', 'enabled' => false, 'plugin_active' => false];
            }
            $active = !empty($status['plugin_active']);
            $setup = $active
                ? admin_url('admin.php?page=wc-settings&tab=checkout&section=' . rawurlencode($def['wc_id']))
                : ($can_install ? admin_url('plugin-install.php?s=' . rawurlencode($def['slug']) . '&tab=search&type=term') : null);
            $out['gateways'][] = [
                'id' => $key,
                'title' => $def['title'],
                'connected' => in_array($status['connected'] ?? 'none', ['connected', 'pending', 'none'], true) ? $status['connected'] : 'none',
                'enabled' => !empty($status['enabled']),
                'active' => $active,
                'setupUrl' => $setup,
            ];
        }
        return $out;
    }

    /**
     * What the payment setup says about a store selling in $code, as the
     * API's payment status does (storeCurrency): the gateways that can pay a
     * business in it, whether WPMaven Payments can (it is processed by
     * Stripe), and for a currency none can, the owner's sentence, word for
     * word the API's ("WooPayments, Stripe and PayPal cannot pay a business
     * in India in Indian rupees (INR) yet."). Null when the table does not
     * cover it.
     */
    public static function store_currency_offer($code) {
        $code = is_scalar($code) ? strtoupper(trim((string) $code)) : '';
        if (!isset(self::STORE_CURRENCY_PAYMENTS[$code])) {
            return null;
        }
        list($place, $name, $services) = self::STORE_CURRENCY_PAYMENTS[$code];
        return [
            'code' => $code,
            'services' => $services,
            'wpmavenPayments' => in_array('stripe', $services, true),
            'note' => $services ? null : "WooPayments, Stripe and PayPal cannot pay a business in $place in $name ($code) yet.",
        ];
    }

    /** Whether the store sells a printed product (made to order, paid through WPMaven Payments only). */
    private static function sells_printed_products() {
        if (!function_exists('get_posts')) {
            return false;
        }
        $meta = class_exists('WebMaven_Payments') ? WebMaven_Payments::POD_PRODUCT_META : '_wm_pod_product';
        $ids = get_posts([
            'post_type' => 'product',
            'post_status' => ['publish', 'private', 'draft', 'pending', 'future'],
            'meta_key' => $meta,
            'posts_per_page' => 1,
            'fields' => 'ids',
            'no_found_rows' => true,
        ]);
        return !empty($ids);
    }
}

add_action('rest_api_init', ['WebMaven_Store_Gateways', 'register_routes']);
