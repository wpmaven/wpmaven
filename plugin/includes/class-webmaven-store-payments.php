<?php
/**
 * Store payment gateways (2026-09-22): the plugin side of the API's "get
 * paid" flow.
 *
 * The API sent these six commands to every site, but no plugin build had
 * them, so "Connect WooPayments" failed with "Unknown command:
 * wc_install_gateway". Contract, as the API reads it (results arrive wrapped
 * in response.data.data):
 *
 *   wc_list_payment_gateways {}               -> {gateways: [{id, title, enabled}]}
 *   wc_gateway_status        {gateway}        -> {connected: 'connected'|'pending'|'none', enabled}
 *   wc_install_gateway       {gateway}        -> the gateway's plugin installed AND active
 *   wc_enable_gateway        {gateway}        -> the WooCommerce gateway's 'enabled' setting is 'yes'
 *   wc_get_connect_url       {gateway, returnUrl} -> {connectUrl: string|null}
 *   wc_finalize_gateway      {gateway, payload}   -> {ok: bool}
 *
 * `gateway` is the API's own key (StoreGateway in storePayments.types.ts):
 * woocommerce_payments, stripe or ppcp. Each maps to the WordPress.org plugin
 * slug the API names (GATEWAY_PLUGIN_SLUGS) and to the id the gateway
 * registers with WooCommerce. PayPal Payments registers 'ppcp-gateway', not
 * 'ppcp', so the key is mapped (and 'ppcp-gateway' is accepted too). The three
 * WooCommerce ids are the ones WooCommerce core itself maps to these
 * providers (PaymentsProviders::$payment_gateways_providers_class_map,
 * WooCommerce 11.1).
 *
 * Failures THROW. The webhook handler turns an exception into HTTP 500 with
 * {error}, which the API's mutate() treats as a failure. Returning
 * ['success' => false] would arrive as a success and the API would carry on
 * with a half-connected gateway.
 *
 * "connected" is deliberately conservative: it means the gateway can take
 * real money right now (account connected, onboarding done, live mode). It is
 * only reported on a positive signal read through the same calls WooCommerce
 * core makes into each gateway plugin (see live_ready()). Anything that cannot
 * be verified is 'pending', never 'connected'.
 *
 * On its own class, like the edge host, so the execute_command bridge
 * (webhook_<name>) cannot reach it.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

final class WebMaven_Store_Payments {

    /** API gateway key => WordPress.org plugin slug, WooCommerce gateway id, display name. */
    const GATEWAYS = [
        'woocommerce_payments' => ['slug' => 'woocommerce-payments', 'wc_id' => 'woocommerce_payments', 'title' => 'WooPayments'],
        'stripe' => ['slug' => 'woocommerce-gateway-stripe', 'wc_id' => 'stripe', 'title' => 'Stripe'],
        'ppcp' => ['slug' => 'woocommerce-paypal-payments', 'wc_id' => 'ppcp-gateway', 'title' => 'PayPal Payments'],
    ];

    /** Other names a caller may use for the same gateway. */
    const ALIASES = ['ppcp-gateway' => 'ppcp'];

    // ── Commands ────────────────────────────────────────────────────────────

    /** wc_list_payment_gateways: every gateway WooCommerce has registered. */
    public static function list_gateways() {
        if (!self::woocommerce_active()) {
            return ['woocommerce_active' => false, 'gateways' => []];
        }
        $gateways = [];
        foreach (self::registered_gateways() as $id => $gateway) {
            if (!is_object($gateway)) {
                continue;
            }
            $gateways[] = [
                'id' => (string) (isset($gateway->id) ? $gateway->id : $id),
                'title' => self::gateway_title($gateway),
                'enabled' => self::gateway_enabled($gateway),
            ];
        }
        return ['woocommerce_active' => true, 'gateways' => $gateways];
    }

    /** wc_gateway_status: connection state of one managed gateway. */
    public static function gateway_status($params) {
        return self::status_for(self::resolve($params));
    }

    /**
     * wc_enable_gateway: switch the gateway on in WooCommerce, the same writes
     * WooCommerce's own gateway toggle makes (WC_AJAX::toggle_gateway_enabled).
     *
     * Unlike that toggle it does not refuse a gateway that still needs setup:
     * the API enables BEFORE the owner connects the account, and refusing
     * would stop every first connection here. needs_setup is reported instead.
     */
    public static function enable_gateway($params) {
        $def = self::resolve($params);
        if (!self::woocommerce_active()) {
            throw new Exception("WooCommerce is not active on this site, so {$def['title']} cannot be enabled.");
        }
        $gateway = self::wc_gateway($def['wc_id']);
        if (!$gateway) {
            throw new Exception("{$def['title']} is not registered with WooCommerce (gateway id {$def['wc_id']}). Install and activate {$def['slug']} first.");
        }
        if (!is_callable([$gateway, 'update_option']) || !is_callable([$gateway, 'get_option_key'])) {
            throw new Exception("{$def['title']} does not expose WooCommerce gateway settings, so it cannot be enabled here.");
        }

        // Decided and verified on the STORED settings: the in-memory object
        // can carry a form default that was never saved.
        $option_key = (string) $gateway->get_option_key();
        $already = self::stored_enabled($option_key);
        if (!$already) {
            do_action('woocommerce_update_option', ['id' => $option_key]);
            $gateway->update_option('enabled', 'yes');
            do_action('woocommerce_update_options');
            if (!self::stored_enabled($option_key)) {
                throw new Exception("{$def['title']} could not be enabled: WooCommerce did not save the setting.");
            }
        }
        if (property_exists($gateway, 'enabled')) {
            $gateway->enabled = 'yes';
        }

        $needs_setup = null;
        if (is_callable([$gateway, 'needs_setup'])) {
            try {
                $needs_setup = (bool) $gateway->needs_setup();
            } catch (\Throwable $e) {
                $needs_setup = null;
            }
        }

        return [
            'gateway' => $def['key'],
            'wc_gateway_id' => $def['wc_id'],
            'enabled' => true,
            'already_enabled' => $already,
            'needs_setup' => $needs_setup,
        ];
    }

    /**
     * wc_get_connect_url: where the owner finishes connecting the account.
     *
     * The gateway's own settings screen in wp-admin, the URL WooCommerce core
     * falls back to for any gateway (Utils::wc_payments_settings_url with
     * section = gateway id). Each gateway plugin runs its own onboarding from
     * there, so returnUrl is not used. null when the gateway is already
     * connected or its plugin is not active.
     *
     * Hosted owners have no WordPress password, so the dashboard does not open
     * this URL directly: it opens a one-click sign-in link to the gateway's
     * onboarding screen (capabilities/owner-admin-login.php, targets
     * woopayments_onboarding, stripe_settings and paypal_onboarding), which signs the owner in as
     * their own administrator first. requiresWpAdminLogin says so. Minting a
     * gateway-hosted onboarding link server-side would need each gateway's
     * private onboarding API, which this plugin does not call.
     */
    public static function get_connect_url($params) {
        $def = self::resolve($params);
        $status = self::status_for($def);
        if ($status['connected'] === 'none') {
            return ['gateway' => $def['key'], 'connectUrl' => null, 'reason' => 'plugin_not_active'];
        }
        if ($status['connected'] === 'connected') {
            return ['gateway' => $def['key'], 'connectUrl' => null, 'reason' => 'already_connected'];
        }
        return [
            'gateway' => $def['key'],
            'connectUrl' => admin_url('admin.php?page=wc-settings&tab=checkout&section=' . rawurlencode($def['wc_id'])),
            'requiresWpAdminLogin' => true,
        ];
    }

    /**
     * wc_finalize_gateway: re-read the gateway's live state and report it.
     * No onboarding exchange happens here: each gateway plugin completes its
     * own onboarding in wp-admin, and the payload is not interpreted.
     */
    public static function finalize_gateway($params) {
        $def = self::resolve($params);
        $status = self::status_for($def);
        return [
            'ok' => $status['connected'] === 'connected',
            'gateway' => $def['key'],
            'connected' => $status['connected'],
            'enabled' => $status['enabled'],
        ];
    }

    // ── Status ──────────────────────────────────────────────────────────────

    /**
     * 'none'      WooCommerce or the gateway's plugin is not active.
     * 'pending'   active, but not verifiably able to take live payments.
     * 'connected' a positive signal from the gateway plugin (live_ready()).
     */
    private static function status_for($def) {
        $base = ['gateway' => $def['key'], 'wc_gateway_id' => $def['wc_id']];
        if (!self::woocommerce_active() || !self::plugin_active($def['slug'])) {
            return $base + ['connected' => 'none', 'enabled' => false, 'plugin_active' => false];
        }
        $gateway = self::wc_gateway($def['wc_id']);
        if (!$gateway) {
            return $base + ['connected' => 'pending', 'enabled' => false, 'plugin_active' => true];
        }
        $live = false;
        try {
            $live = self::live_ready($def['key'], $gateway) === true;
        } catch (\Throwable $e) {
            $live = false;
        }
        return $base + [
            'connected' => $live ? 'connected' : 'pending',
            'enabled' => self::gateway_enabled($gateway),
            'plugin_active' => true,
        ];
    }

    /**
     * True only when the gateway plugin positively says the account is
     * connected, onboarded and live. Every call below is one WooCommerce core
     * 11.1 itself makes into the gateway plugin (src/Internal/Admin/Settings/
     * PaymentsProviders/{WooPayments,Stripe,PayPal}.php and
     * WooPayments/WooPaymentsService.php). They were verified against that
     * WooCommerce source, NOT against the gateway plugins' own source, and
     * none of them is a stable public API: every step is guarded, and a
     * missing method or class means 'pending', never 'connected'. No option
     * names of the gateway plugins are read directly.
     */
    private static function live_ready($key, $gateway) {
        switch ($key) {
            case 'woocommerce_payments':
                return self::woopayments_live_ready($gateway);
            case 'stripe':
                return self::stripe_live_ready();
            case 'ppcp':
                return self::paypal_live_ready();
        }
        return false;
    }

    /**
     * WooPayments: an account is connected (the gateway's is_account_connected()
     * or is_connected(), what WooCommerce's base provider asks), the account is
     * valid (WC_Payments::get_account_service()->is_stripe_account_valid()),
     * payments are enabled, it is a live account and not a test-drive one
     * (get_account_status_data() paymentsEnabled / isLive / testDrive), and
     * WooPayments is not in test mode (WC_Payments::mode()->is_test()).
     */
    private static function woopayments_live_ready($gateway) {
        if (self::call_bool($gateway, ['is_account_connected', 'is_connected']) !== true) {
            return false;
        }
        // A negative signal when the gateway offers it (WooCommerce core notes
        // this is what WooPayments provides): details not submitted yet.
        if (is_callable([$gateway, 'is_account_partially_onboarded']) && $gateway->is_account_partially_onboarded()) {
            return false;
        }
        if (!class_exists('WC_Payments') || !is_callable(['WC_Payments', 'get_account_service'])) {
            return false;
        }
        $account = call_user_func(['WC_Payments', 'get_account_service']);
        if (!is_object($account)
            || !is_callable([$account, 'is_stripe_account_valid'])
            || !is_callable([$account, 'get_account_status_data'])) {
            return false;
        }
        if (!self::truthy($account->is_stripe_account_valid())) {
            return false;
        }
        $data = $account->get_account_status_data();
        if (!is_array($data) || empty($data['paymentsEnabled']) || empty($data['isLive']) || !empty($data['testDrive'])) {
            return false;
        }
        if (!is_callable(['WC_Payments', 'mode'])) {
            return false;
        }
        $mode = call_user_func(['WC_Payments', 'mode']);
        if (!is_object($mode) || !is_callable([$mode, 'is_test'])) {
            return false;
        }
        return $mode->is_test() === false;
    }

    /**
     * Stripe: an account is connected (WC_Stripe::get_instance()->account->
     * get_account_status() is not WC_Stripe_Account::STATUS_NO_ACCOUNT, the
     * check WooCommerce core uses), it is connected in live mode
     * (->connect->is_connected('live')), and the plugin is not in test mode
     * (WC_Stripe_Mode::is_test()). Other account statuses (restricted and so
     * on) are not distinguished: their constant names were not verified.
     */
    private static function stripe_live_ready() {
        if (!class_exists('WC_Stripe') || !is_callable(['WC_Stripe', 'get_instance'])) {
            return false;
        }
        $stripe = call_user_func(['WC_Stripe', 'get_instance']);
        if (!is_object($stripe)
            || !isset($stripe->account)
            || !class_exists('WC_Stripe_Account')
            || !defined('WC_Stripe_Account::STATUS_NO_ACCOUNT')
            || !($stripe->account instanceof WC_Stripe_Account)
            || !is_callable([$stripe->account, 'get_account_status'])) {
            return false;
        }
        if ($stripe->account->get_account_status() === constant('WC_Stripe_Account::STATUS_NO_ACCOUNT')) {
            return false;
        }
        if (!isset($stripe->connect)
            || !class_exists('WC_Stripe_Connect')
            || !($stripe->connect instanceof WC_Stripe_Connect)
            || !is_callable([$stripe->connect, 'is_connected'])) {
            return false;
        }
        if (!self::truthy($stripe->connect->is_connected('live'))) {
            return false;
        }
        if (!class_exists('WC_Stripe_Mode') || !is_callable(['WC_Stripe_Mode', 'is_test'])) {
            return false;
        }
        return call_user_func(['WC_Stripe_Mode', 'is_test']) === false;
    }

    /**
     * PayPal Payments: the plugin's container service settings.connection-state
     * says connected and not sandbox (3.0.0+), or, before 3.0.0, the
     * onboarding.state is at least State::STATE_ONBOARDED and the
     * onboarding.environment is not Environment::SANDBOX. Same services
     * WooCommerce core reads.
     */
    private static function paypal_live_ready() {
        $ppcp = 'WooCommerce\\PayPalCommerce\\PPCP';
        if (!class_exists($ppcp) || !is_callable([$ppcp, 'container'])) {
            return false;
        }
        $container = call_user_func([$ppcp, 'container']);
        if (!is_object($container) || !is_callable([$container, 'has']) || !is_callable([$container, 'get'])) {
            return false;
        }
        if ($container->has('settings.connection-state')) {
            $state = $container->get('settings.connection-state');
            if (!is_object($state) || !is_callable([$state, 'is_connected']) || !is_callable([$state, 'is_sandbox'])) {
                return false;
            }
            return self::truthy($state->is_connected()) && $state->is_sandbox() === false;
        }
        $state_const = 'WooCommerce\\PayPalCommerce\\Onboarding\\State::STATE_ONBOARDED';
        $sandbox_const = 'WooCommerce\\PayPalCommerce\\Onboarding\\Environment::SANDBOX';
        if ($container->has('onboarding.state') && $container->has('onboarding.environment')
            && defined($state_const) && defined($sandbox_const)) {
            $state = $container->get('onboarding.state');
            $environment = $container->get('onboarding.environment');
            if (!is_object($state) || !is_callable([$state, 'current_state'])
                || !is_object($environment) || !is_callable([$environment, 'current_environment'])) {
                return false;
            }
            return $state->current_state() >= constant($state_const)
                && $environment->current_environment() !== constant($sandbox_const);
        }
        return false;
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /** The managed gateway named by params['gateway'], or an exception. */
    public static function resolve($params) {
        $raw = (is_array($params) && isset($params['gateway']) && is_string($params['gateway'])) ? $params['gateway'] : '';
        $key = preg_replace('/[^a-z0-9_\-]/', '', strtolower(trim($raw)));
        if (isset(self::ALIASES[$key])) {
            $key = self::ALIASES[$key];
        }
        if ($key === '' || !isset(self::GATEWAYS[$key])) {
            $named = $key !== '' ? " '{$key}'" : '';
            throw new Exception("Unknown payment gateway{$named}. Supported: " . implode(', ', array_keys(self::GATEWAYS)) . '.');
        }
        return ['key' => $key] + self::GATEWAYS[$key];
    }

    public static function woocommerce_active() {
        return class_exists('WooCommerce') && function_exists('WC');
    }

    /** WooCommerce's registered gateways keyed by id, or []. */
    private static function registered_gateways() {
        if (!self::woocommerce_active()) {
            return [];
        }
        $registry = WC()->payment_gateways();
        if (!is_object($registry) || !is_callable([$registry, 'payment_gateways'])) {
            return [];
        }
        $all = $registry->payment_gateways();
        return is_array($all) ? $all : [];
    }

    private static function wc_gateway($wc_id) {
        $all = self::registered_gateways();
        return (isset($all[$wc_id]) && is_object($all[$wc_id])) ? $all[$wc_id] : null;
    }

    /** The plugin whose folder is $slug is installed and active. */
    public static function plugin_active($slug) {
        if (!function_exists('get_plugins') || !function_exists('is_plugin_active')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        foreach (array_keys((array) get_plugins()) as $file) {
            if (strpos($file, $slug . '/') === 0 && is_plugin_active($file)) {
                return true;
            }
        }
        return false;
    }

    /** Admin name first (what WooCommerce's payments screen shows), then the checkout title. */
    private static function gateway_title($gateway) {
        $title = is_callable([$gateway, 'get_method_title']) ? $gateway->get_method_title() : '';
        if (!is_string($title) || $title === '') {
            $title = is_callable([$gateway, 'get_title']) ? $gateway->get_title() : '';
        }
        if (!is_string($title) || $title === '') {
            return isset($gateway->id) ? (string) $gateway->id : '';
        }
        return trim(wp_strip_all_tags(html_entity_decode($title, ENT_QUOTES | ENT_SUBSTITUTE), true));
    }

    private static function gateway_enabled($gateway) {
        if (isset($gateway->enabled)) {
            return self::truthy($gateway->enabled);
        }
        return is_callable([$gateway, 'get_option']) ? self::truthy($gateway->get_option('enabled', 'no')) : false;
    }

    /** The gateway's saved settings say enabled. */
    private static function stored_enabled($option_key) {
        $stored = get_option($option_key);
        return is_array($stored) && isset($stored['enabled']) && self::truthy($stored['enabled']);
    }

    /** WooCommerce's wc_string_to_bool(): 'yes', 'true', '1', 1 or true. */
    private static function truthy($value) {
        if (is_bool($value)) {
            return $value;
        }
        if ($value === 1) {
            return true;
        }
        $value = strtolower((string) $value);
        return $value === 'yes' || $value === 'true' || $value === '1';
    }

    /** The first callable method's answer as a strict bool, or null when none exists. */
    private static function call_bool($object, $methods) {
        foreach ($methods as $method) {
            if (is_callable([$object, $method])) {
                return self::truthy($object->$method());
            }
        }
        return null;
    }
}
