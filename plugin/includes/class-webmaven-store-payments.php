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
 *   wc_install_gateway       {gateway}        -> REQUIRES_AGENT here
 *   wc_enable_gateway        {gateway}        -> REQUIRES_AGENT here
 *   wc_configure_gateway     {gateway, mode, credentials, country} -> REQUIRES_AGENT here
 *   wc_disable_gateway       {gateway}        -> REQUIRES_AGENT here
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
 * Local payment services (2026-11-16): beside the three, the services in
 * data/local-payment-services.json (Mollie, Razorpay, Mercado Pago, Payfast
 * and more), the copy of the API's registry. Each names its plugin's slug,
 * the WooCommerce gateways it registers, and, for a service the owner
 * connects with keys, the settings each key goes to. For a local service,
 * wc_gateway_status also reports its mode (live or test keys), the fields
 * still missing, and whether WooCommerce offers it at checkout; "connected"
 * means live keys, every field, on and offered.
 *
 * This edition reads the other plugins' gateways and installs, sets up or
 * switches on none: wc_install_gateway, wc_enable_gateway,
 * wc_configure_gateway (the owner's keys into a service's own settings) and
 * wc_disable_gateway answer REQUIRES_AGENT. WPMaven Agent runs them, and
 * turns Stripe's and WooPayments' local methods on once the status finds the
 * account connected (webmaven_gateway_methods_on_connect). WPMaven Payments,
 * the store's own gateway, has its own commands (payments.php).
 */

if (!defined('ABSPATH')) {
    exit;
}

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
        return [
            'woocommerce_active' => true,
            'gateways' => $gateways,
            // The store's country (WooCommerce's base country), for the
            // local services that serve it (2026-11-16).
            'storeCountry' => self::store_country(),
            'capabilities' => ['local_services' => count(self::local_services())],
        ];
    }

    /** wc_gateway_status: connection state of one managed gateway. */
    public static function gateway_status($params) {
        return self::status_for(self::resolve($params));
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
     * A local service's own screen instead, when the data file names one
     * (setupPath).
     *
     * The owner opens it signed in to WordPress (requiresWpAdminLogin says so).
     * Minting a gateway-hosted onboarding link server-side would need each
     * gateway's private onboarding API, which this plugin does not call.
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
        $path = !empty($def['local']['setupPath']) && is_string($def['local']['setupPath'])
            ? $def['local']['setupPath']
            : 'admin.php?page=wc-settings&tab=checkout&section=' . rawurlencode($def['wc_id']);
        return [
            'gateway' => $def['key'],
            'connectUrl' => admin_url($path),
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
        if (!empty($def['local'])) {
            return $base + self::local_status($def);
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
        // Stripe's and WooPayments' local methods waiting for this moment are
        // WPMaven Agent's to turn on (they change the gateway plugin's
        // settings); this edition only reads.
        $methods = $live ? apply_filters('webmaven_gateway_methods_on_connect', null, $def['key']) : null;
        return $base + [
            'connected' => $live ? 'connected' : 'pending',
            'enabled' => self::gateway_enabled($gateway),
            'plugin_active' => true,
        ] + ($methods ? ['methods_enabled' => $methods] : []);
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

    // ── Local payment services (2026-11-16) ─────────────────────────────────

    /** The local services this plugin may set up, by id (data/local-payment-services.json). */
    public static function local_services() {
        static $services = null;
        if ($services !== null) {
            return $services;
        }
        $services = [];
        $file = __DIR__ . '/data/local-payment-services.json';
        $data = is_readable($file) ? json_decode((string) file_get_contents($file), true) : null;
        if (!is_array($data) || !isset($data['services']) || !is_array($data['services'])) {
            return $services;
        }
        foreach ($data['services'] as $service) {
            if (is_array($service) && isset($service['id'], $service['slug'], $service['name'], $service['gateways'])
                && is_string($service['id']) && preg_match('/^[a-z0-9_]+$/', $service['id'])
                && is_string($service['slug']) && preg_match('/^[a-z0-9-]+$/', $service['slug'])
                && is_array($service['gateways']) && $service['gateways']) {
                $services[$service['id']] = $service;
            }
        }
        return $services;
    }

    /** The local services that pay a business selling in $code (and, when given, based in $country). */
    public static function local_services_for($code, $country = null) {
        $code = is_scalar($code) ? strtoupper(trim((string) $code)) : '';
        $country = is_scalar($country) ? strtoupper(trim((string) $country)) : '';
        $out = [];
        foreach (self::local_services() as $id => $service) {
            $currencies = isset($service['currencies']) && is_array($service['currencies']) ? $service['currencies'] : [];
            $countries = isset($service['countries']) && is_array($service['countries']) ? $service['countries'] : [];
            if (in_array($code, $currencies, true) && ($country === '' || !preg_match('/^[A-Z]{2}$/', $country) || in_array($country, $countries, true))) {
                $out[$id] = $service;
            }
        }
        return $out;
    }

    /** The store's country (WooCommerce's base country), or null. */
    public static function store_country() {
        if (!self::woocommerce_active()) {
            return null;
        }
        $wc = WC();
        $country = '';
        if (is_object($wc) && isset($wc->countries) && is_object($wc->countries) && is_callable([$wc->countries, 'get_base_country'])) {
            $country = (string) $wc->countries->get_base_country();
        } else {
            $raw = (string) get_option('woocommerce_default_country', '');
            $country = explode(':', $raw)[0];
        }
        $country = strtoupper(trim($country));
        return preg_match('/^[A-Z]{2}$/', $country) ? $country : null;
    }

    /** A service's main gateway id: its first exact id, else its first prefix. */
    public static function main_gateway_id($service) {
        foreach ($service['gateways'] as $id) {
            if (is_string($id) && substr($id, -1) !== '*') {
                return $id;
            }
        }
        return rtrim((string) $service['gateways'][0], '*');
    }

    /** The WooCommerce gateways of a local service that are registered now (an id ending in "*" is a prefix). */
    public static function local_gateways($service) {
        $out = [];
        $registered = self::registered_gateways();
        foreach ($service['gateways'] as $id) {
            if (!is_string($id) || $id === '') {
                continue;
            }
            if (substr($id, -1) === '*') {
                $prefix = substr($id, 0, -1);
                foreach ($registered as $gid => $gateway) {
                    if (is_object($gateway) && strpos((string) $gid, $prefix) === 0) {
                        $out[(string) $gid] = $gateway;
                    }
                }
            } elseif (isset($registered[$id]) && is_object($registered[$id])) {
                $out[$id] = $registered[$id];
            }
        }
        return $out;
    }

    /** The fields a mode needs: both modes' shared ones and that mode's own. */
    public static function local_fields($service, $mode) {
        $out = [];
        foreach (isset($service['fields']) && is_array($service['fields']) ? $service['fields'] : [] as $field) {
            if (is_array($field) && isset($field['id'], $field['store']) && (empty($field['mode']) || $field['mode'] === $mode)) {
                $out[] = $field;
            }
        }
        return $out;
    }

    /** Where a 'gateway' service keeps its settings: its main gateway's WooCommerce option. */
    public static function local_option_key($service) {
        $main = self::wc_gateway(self::main_gateway_id($service));
        if ($main && is_callable([$main, 'get_option_key'])) {
            return (string) $main->get_option_key();
        }
        return 'woocommerce_' . self::main_gateway_id($service) . '_settings';
    }

    /** One stored setting of a local service, as a string ('' when not set). */
    public static function local_read($service, $store) {
        $type = isset($service['storage']['type']) ? $service['storage']['type'] : 'gateway';
        if ($type === 'options') {
            $value = get_option($store, '');
        } else {
            $option = $type === 'option_array' ? (string) $service['storage']['option'] : self::local_option_key($service);
            $all = get_option($option, []);
            $value = is_array($all) && isset($all[$store]) ? $all[$store] : '';
        }
        return is_scalar($value) ? trim((string) $value) : '';
    }


    /** 'live' or 'test' keys, from the plugin's switch or the shape of a key; null when not set yet. */
    private static function local_mode($service) {
        if (!empty($service['modeSetting']) && is_array($service['modeSetting'])) {
            $stored = self::local_read($service, (string) $service['modeSetting']['store']);
            if ($stored === (string) $service['modeSetting']['test']) {
                return 'test';
            }
            return $stored === (string) $service['modeSetting']['live'] ? 'live' : null;
        }
        if (!empty($service['testWhen']) && is_array($service['testWhen'])) {
            $value = self::local_read($service, (string) $service['testWhen']['field']);
            if ($value === '') {
                return null;
            }
            return @preg_match('/' . str_replace('/', '\/', (string) $service['testWhen']['pattern']) . '/', $value) ? 'test' : 'live';
        }
        return 'live';
    }

    /** The field ids a mode still lacks on this site. */
    private static function local_missing($service, $mode) {
        $missing = [];
        foreach (self::local_fields($service, $mode) as $field) {
            if (empty($field['optional']) && self::local_read($service, (string) $field['store']) === '') {
                $missing[] = (string) $field['id'];
            }
        }
        return $missing;
    }

    /**
     * A local service's state: 'connected' only with live keys (every field
     * there, for a service connected with keys), on, and offered at checkout
     * by WooCommerce (is_available, and needs_setup not true). Anything less
     * is 'pending', with the mode and the fields still missing.
     */
    private static function local_status($def) {
        $service = $def['local'];
        $gateways = self::local_gateways($service);
        $keys = ($service['connect'] ?? '') === 'keys';
        $mode = $keys ? self::local_mode($service) : null;
        $missing = $keys ? self::local_missing($service, $mode ?: 'live') : [];
        $enabled = false;
        foreach ($gateways as $gateway) {
            $enabled = $enabled || self::gateway_enabled($gateway);
        }
        $main = self::wc_gateway($def['wc_id']);
        if (!$main && $gateways) {
            $main = reset($gateways);
        }
        $available = null;
        $needs_setup = null;
        if ($main) {
            try {
                $available = is_callable([$main, 'is_available']) ? (bool) $main->is_available() : null;
            } catch (\Throwable $e) {
                $available = null;
            }
            try {
                $needs_setup = is_callable([$main, 'needs_setup']) ? (bool) $main->needs_setup() : null;
            } catch (\Throwable $e) {
                $needs_setup = null;
            }
        }
        $ready = $enabled && $available === true && $needs_setup !== true;
        // A service whose plugin connects the account: only with the sign
        // that it has (its token or secret set), since some call themselves
        // available before any account is connected (PortOne, Xendit).
        $connected = $keys ? ($ready && !$missing && $mode === 'live') : ($ready && self::local_connected_sign($service));
        return [
            'connected' => $connected ? 'connected' : 'pending',
            'enabled' => $enabled,
            'plugin_active' => true,
            'available' => $available,
            'mode' => $mode,
            'missing' => $missing,
            'gateways' => array_keys($gateways),
        ];
    }

    /** Whether a service whose plugin connects the account shows the setting that is set once it has (connectedWhen). */
    public static function local_connected_sign($service) {
        $signs = isset($service['connectedWhen']) && is_array($service['connectedWhen']) ? $service['connectedWhen'] : [];
        foreach ($signs as $sign) {
            if (!is_array($sign) || empty($sign['option']) || !is_string($sign['option'])) {
                continue;
            }
            $value = get_option($sign['option'], '');
            if (!empty($sign['key']) && is_string($sign['key'])) {
                $value = is_array($value) && isset($value[$sign['key']]) ? $value[$sign['key']] : '';
            }
            if ((is_string($value) && trim($value) !== '') || (is_array($value) && $value)) {
                return true;
            }
        }
        return false;
    }




    // ── Helpers ─────────────────────────────────────────────────────────────

    /** The managed gateway named by params['gateway'], or an exception. */
    public static function resolve($params) {
        $raw = (is_array($params) && isset($params['gateway']) && is_string($params['gateway'])) ? $params['gateway'] : '';
        $key = sanitize_key($raw);
        if (isset(self::ALIASES[$key])) {
            $key = self::ALIASES[$key];
        }
        if ($key !== '' && isset(self::GATEWAYS[$key])) {
            return ['key' => $key, 'local' => null] + self::GATEWAYS[$key];
        }
        $local = self::local_services();
        if ($key !== '' && isset($local[$key])) {
            $service = $local[$key];
            return [
                'key' => $key,
                'slug' => (string) $service['slug'],
                'wc_id' => self::main_gateway_id($service),
                'title' => (string) $service['name'],
                'local' => $service,
            ];
        }
        $named = $key !== '' ? " '{$key}'" : '';
        throw new Exception("Unknown payment gateway{$named}. Supported: " . implode(', ', array_merge(array_keys(self::GATEWAYS), array_keys($local))) . '.'); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- the error text of a JSON answer to the API, never printed in a page
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

    /** The gateway WooCommerce registered under $wc_id, or null. */
    public static function wc_gateway($wc_id) {
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
    public static function stored_enabled($option_key) {
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
