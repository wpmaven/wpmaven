<?php
/**
 * Plugins that keep a currency of their own follow the store currency
 * (1.2.15, 2026-09-30).
 *
 * A booking calendar, a room booking plugin, an online ordering plugin, a
 * donation plugin, a course shop and an event calendar each keep a currency
 * of their own, US dollars out of the box, and their prices as plain
 * numbers. So a business that sells in euros got a booking page, a menu or a
 * donation form in dollars. Every plugin a WPMaven build puts on a site that
 * sells or prices through its own settings follows the business's currency
 * (PLUGINS): the catalog's plugin for bookings (LatePoint), stays (WP Hotel
 * Booking), restaurants (RestroPress), nonprofits (GiveWP), courses (Tutor
 * LMS) and events (The Events Calendar), and the calendar the design engine
 * installs for a booking area (Amelia). Two more keep a currency of their
 * own for listings they show, not sell: they are named to the owner and
 * never written (NAMED_ONLY). Adding a plugin here is the only change a new
 * one needs; the API sends the business's currency with every install.
 *
 * The business's currency: the store's (WooCommerce) while the store holds
 * prices; else the one WPMaven named last (the build's install config
 * plugin_currency, every store_currency_set that went through, the owner's
 * own change in WooCommerce's settings), remembered in BUSINESS_OPTION. So a
 * plugin installed later, by any path, takes it too. An empty store's
 * currency alone is not the business's (it may be WooCommerce's shipped
 * dollars), so a site where nothing named one leaves its plugins as they are.
 *
 * When a plugin follows:
 *  - installed: activated (activated_plugin) or turned on by install_plugin
 *    (its first-run config), and checked again 5 minutes later in case its
 *    own installer writes its defaults after the activation;
 *  - every store_currency_set that went through (initial, keep, convert, a
 *    convert finished late), right after the store's currency is written;
 *  - a change of the store's currency or price format made elsewhere
 *    (WooCommerce's own settings, store_update_settings), at the end of that
 *    request;
 *  - once after the plugin updates (a scheduled catch-up), for the plugins
 *    installed before.
 *
 * What never follows (the answer says why, and the API tells the owner):
 *  - a plugin that holds prices, unless the owner saw them and chose to keep
 *    the numbers (store_currency_set keep with plugin_currency: 'follow'):
 *    a new currency relabels every price it holds. Convert never relabels
 *    them: their prices cannot be converted here, so the plugin keeps
 *    selling in its own currency (reason convert). Prices that cannot be
 *    read count as held (reason has_prices);
 *  - a plugin in which customers still owe money on a booking, an order or
 *    an invoice: those amounts carry no currency, so a new one would change
 *    what a customer agreed to pay (reason owed);
 *  - a plugin with a payment method turned on that cannot take the currency,
 *    or one this does not know: its page would show one currency while the
 *    charge is taken in another (reason payments, the methods named);
 *  - a setting that did not stick: everything written is put back (reason
 *    not_saved).
 * A plugin that already sells in the currency takes the store's price format
 * (symbol, where it goes, separators) whatever it holds: nothing is
 * relabeled.
 *
 * Every write goes through the plugin's own settings (LatePoint's settings
 * helper, WP Hotel Booking's settings object, the settings options
 * RestroPress, GiveWP, Tutor LMS and The Events Calendar keep, Amelia's
 * settings option) and is read back. Reads of prices and balances are
 * read-only queries on the plugins' own tables. Nothing here throws.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-webmaven-log.php';

if (function_exists('add_action')) {
    add_action('activated_plugin', ['WebMaven_Plugin_Currency', 'on_activated'], 20, 1);
    add_action('webmaven_plugin_currency_catch_up', ['WebMaven_Plugin_Currency', 'catch_up']);
    add_action('init', ['WebMaven_Plugin_Currency', 'maybe_catch_up_after_update'], 30);
    foreach (['woocommerce_currency', 'woocommerce_currency_pos', 'woocommerce_price_thousand_sep', 'woocommerce_price_decimal_sep'] as $webmaven_store_option) {
        add_action('update_option_' . $webmaven_store_option, ['WebMaven_Plugin_Currency', 'on_store_format_change'], 10, 0);
    }
    unset($webmaven_store_option);
}

final class WebMaven_Plugin_Currency {

    /**
     * The plugins this follows: slug => [the name the owner sees in
     * WordPress, what it is to the owner].
     */
    const PLUGINS = [
        'latepoint' => ['LatePoint', 'booking calendar'],
        'ameliabooking' => ['Amelia', 'booking calendar'],
        'wp-hotel-booking' => ['WP Hotel Booking', 'room booking'],
        'restropress' => ['RestroPress', 'online ordering'],
        'give' => ['GiveWP', 'donation forms'],
        'tutor' => ['Tutor LMS', 'course sales'],
        'the-events-calendar' => ['The Events Calendar', 'event calendar'],
    ];

    /** Plugins with a currency of their own for the listings they show: named to the owner, never written. */
    const NAMED_ONLY = [
        'estatik' => ['Estatik', 'property listings'],
        'directorist' => ['Directorist', 'directory listings'],
    ];

    // Why a plugin did not follow.
    const HAS_PRICES = 'has_prices';
    const CONVERT = 'convert';
    const OWED = 'owed';
    const PAYMENTS = 'payments';
    const NOT_SAVED = 'not_saved';
    const NOT_SET_HERE = 'not_set_here';

    /**
     * Why it follows: initial (the build's first set), keep and convert (a
     * Store currency change), install, outside (the store changed elsewhere),
     * catch_up. Only keep takes the owner's consent to relabel prices.
     */
    const MODES = ['initial', 'keep', 'convert', 'install', 'outside', 'catch_up'];

    /** The business's currency as WPMaven named it last. */
    const BUSINESS_OPTION = 'webmaven_business_currency';

    /** The check that follows plugins installed before 1.2.15, or whose installer wrote its defaults late. */
    const CATCH_UP_HOOK = 'webmaven_plugin_currency_catch_up';

    /** Set once the catch-up after the plugin update is scheduled. */
    const CAUGHT_UP_OPTION = 'webmaven_plugin_currency_caught_up';

    /**
     * WooCommerce's own symbols for the currencies a WPMaven store sells in
     * (and the lev a store may still hold), for a plugin on a site without
     * WooCommerce: it then shows prices the way a new store in that currency
     * would. The symbols are written as escapes, so no editor can mangle them.
     */
    const SYMBOLS = [
        'USD' => '$',
        'EUR' => "\u{20AC}",
        'GBP' => "\u{00A3}",
        'CAD' => '$',
        'AUD' => '$',
        'NZD' => '$',
        'JPY' => "\u{00A5}",
        'CHF' => 'CHF',
        'SEK' => 'kr',
        'NOK' => 'kr',
        'DKK' => 'kr.',
        'PLN' => "z\u{0142}",
        'CZK' => "K\u{010D}",
        'HUF' => 'Ft',
        'RON' => 'lei',
        'BRL' => 'R$',
        'MXN' => '$',
        'INR' => "\u{20B9}",
        'ZAR' => 'R',
        'SGD' => '$',
        'HKD' => '$',
        'KRW' => "\u{20A9}",
        'ARS' => '$',
        'CLP' => '$',
        'AED' => "\u{062F}.\u{0625}",
        'PHP' => "\u{20B1}",
        'ILS' => "\u{20AA}",
        'BGN' => "\u{043B}\u{0432}.",
    ];

    /** Currencies whose prices have no decimals, and those with three (ISO 4217, as card payments size them). */
    const NO_DECIMALS = ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];
    const THREE_DECIMALS = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];

    /** Where the symbol goes, as WooCommerce names it. */
    const POSITIONS = ['left', 'right', 'left_space', 'right_space'];

    /** The separators a plugin can show. */
    const THOUSANDS = [',', '.', ' ', ''];
    const DECIMALS = ['.', ','];

    /**
     * The currencies a WPMaven store sells in (the API's list, with the UAE
     * dirham and the Philippine peso since 1.9.1, and the Israeli new shekel
     * since 1.9.2), and the lev a store may
     * still hold.
     */
    const OFFERED = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BRL', 'MXN', 'INR', 'ZAR', 'SGD', 'HKD', 'KRW', 'ARS', 'CLP', 'AED', 'PHP', 'ILS', 'BGN'];

    /** The currencies card payments (Stripe) take: every one a WPMaven store sells in. */
    const CARD_TAKES = self::OFFERED;

    /** The currencies PayPal takes. */
    const PAYPAL_TAKES = ['AUD', 'BRL', 'CAD', 'CNY', 'CZK', 'DKK', 'EUR', 'HKD', 'HUF', 'ILS', 'JPY', 'MYR', 'MXN', 'TWD', 'NZD', 'NOK', 'PHP', 'PLN', 'GBP', 'SGD', 'SEK', 'CHF', 'THB', 'USD'];

    /**
     * LatePoint's payment processors this can set: code => [the setting
     * that holds the code payments are taken in, its helper class, the list
     * of codes it takes, the name the owner knows it by, 'lower' or 'upper'
     * case]. Any other processor turned on keeps the calendar where it is.
     */
    const LATEPOINT_PAYMENTS = [
        'stripe_connect' => ['stripe_connect_currency_iso_code', 'OsStripeConnectHelper', 'load_all_currencies_list', 'Stripe', 'lower'],
        'paypal_ppcp' => ['paypal_connect_currency_iso_code', 'OsPaypalConnectHelper', 'load_all_currencies_list', 'PayPal', 'lower'],
        'razorpay_connect' => ['razorpay_connect_currency_iso_code', 'OsRazorpayConnectHelper', 'load_currencies_list', 'Razorpay', 'upper'],
    ];

    /** LatePoint's tables with money, and their money columns (the free plugin's own). */
    const LATEPOINT_MONEY = [
        'latepoint_services' => ['charge_amount', 'deposit_amount', 'price_min', 'price_max'],
        'latepoint_bundles' => ['charge_amount', 'deposit_amount', 'price_min', 'price_max'],
        'latepoint_custom_prices' => ['charge_amount', 'deposit_amount', 'price_min', 'price_max'],
        'latepoint_events' => ['price'],
    ];

    /** Amelia's tables with money, and their money columns. */
    const AMELIA_MONEY = [
        'amelia_services' => ['price', 'deposit'],
        'amelia_packages' => ['price', 'deposit'],
        'amelia_events' => ['price', 'deposit'],
        'amelia_events_to_tickets' => ['price'],
        'amelia_extras' => ['price'],
        'amelia_providers_to_services' => ['price'],
        'amelia_coupons' => ['deduction'],
    ];

    /** Amelia's separators setting: 1 is 1,000.00, 2 is 1.000,00, 3 is 1 000.00, 4 is 1 000,00. */
    const AMELIA_SEPARATORS = [1 => [',', '.'], 2 => ['.', ','], 3 => [' ', '.'], 4 => [' ', ',']];

    /** Amelia's words for where the symbol goes. */
    const AMELIA_POSITIONS = ['left' => 'before', 'right' => 'after', 'left_space' => 'beforeWithSpace', 'right_space' => 'afterWithSpace'];

    /** Amelia's payment methods that take its currency: settings key => [the name the owner knows it by, the codes it takes]. */
    const AMELIA_PAYMENTS = [
        'stripe' => ['Stripe', self::CARD_TAKES],
        'payPal' => ['PayPal', self::PAYPAL_TAKES],
        'barion' => ['Barion', ['EUR', 'HUF', 'CZK', 'USD']],
        'mollie' => ['Mollie', null],
        'razorpay' => ['Razorpay', null],
    ];

    /** WP Hotel Booking's words for where the symbol goes. */
    const HOTEL_POSITIONS = ['left' => 'left', 'right' => 'right', 'left_space' => 'left_with_space', 'right_space' => 'right_with_space'];

    /** GiveWP's payment gateways: id => the codes it takes (null: whatever the store sells in is fine). */
    const GIVE_PAYMENTS = [
        'manual' => null,
        'offline' => null,
        'test-offsite-gateway' => null,
        'stripe' => self::CARD_TAKES,
        'stripe_checkout' => self::CARD_TAKES,
        'stripe_payment_element' => self::CARD_TAKES,
        'stripe_sepa' => ['EUR'],
        'stripe_becs' => ['AUD'],
        'paypal' => self::PAYPAL_TAKES,
        'paypal-commerce' => self::PAYPAL_TAKES,
    ];

    /** Set once this request followed the store (store_currency_set, recovery): the end-of-request follow is not needed. */
    private static $followed = false;

    /** The store's currency or format changed in this request. */
    private static $store_changed = false;

    // ── Which plugins ───────────────────────────────────────────────────────

    /** The plugins this follows that run on this site (slugs, in PLUGINS order). */
    public static function active_plugins() {
        $out = [];
        foreach (array_keys(self::PLUGINS) as $slug) {
            if (self::is_active($slug)) {
                $out[] = $slug;
            }
        }
        return $out;
    }

    /** The plugins named only that run on this site. */
    public static function named_only_active() {
        $out = [];
        foreach (array_keys(self::NAMED_ONLY) as $slug) {
            if (self::is_active($slug)) {
                $out[] = $slug;
            }
        }
        return $out;
    }

    private static function is_active($slug) {
        switch ($slug) {
            case 'latepoint':
                return defined('LATEPOINT_VERSION') && class_exists('OsSettingsHelper')
                    && method_exists('OsSettingsHelper', 'get_settings_value') && method_exists('OsSettingsHelper', 'save_setting_by_name');
            case 'ameliabooking':
                return defined('AMELIA_VERSION') && function_exists('get_option') && function_exists('update_option');
            case 'wp-hotel-booking':
                return defined('WPHB_VERSION') && function_exists('get_option');
            case 'restropress':
                return function_exists('rpress_get_option') && function_exists('get_option');
            case 'give':
                return defined('GIVE_VERSION') && function_exists('give_get_option');
            case 'tutor':
                return defined('TUTOR_VERSION') && function_exists('get_option');
            case 'the-events-calendar':
                return class_exists('Tribe__Events__Main') && function_exists('get_option');
            case 'estatik':
                return function_exists('ests');
            case 'directorist':
                return defined('ATBDP_VERSION') && function_exists('get_directorist_option');
        }
        return false;
    }

    /** {slug, name, what} of a plugin this knows. */
    private static function identity($slug) {
        $known = self::PLUGINS[$slug] ?? self::NAMED_ONLY[$slug] ?? [$slug, 'plugin'];
        return ['slug' => $slug, 'name' => $known[0], 'what' => $known[1]];
    }

    // ── The business's currency ─────────────────────────────────────────────

    /**
     * The currency the business sells in: a store's that holds prices (its
     * money is in it), else the one WPMaven named last (a build, a Store
     * currency change, the owner's own change in WooCommerce's settings).
     * '' when none is known: an empty store's currency may be the dollars
     * WooCommerce ships with, which nobody chose.
     */
    public static function business_currency() {
        $store = self::woocommerce_currency();
        if ($store !== '' && class_exists('WebMaven_Cap_Store_Currency') && method_exists('WebMaven_Cap_Store_Currency', 'store_holds_prices')) {
            try {
                if (WebMaven_Cap_Store_Currency::store_holds_prices()) {
                    return $store;
                }
            } catch (\Throwable $e) {
                return $store;
            }
        }
        return function_exists('get_option') ? self::code(get_option(self::BUSINESS_OPTION, '')) : '';
    }

    /** WPMaven named the business's currency (a build, a Store currency change): remembered for the plugins installed later. */
    public static function remember($code) {
        $code = self::code($code);
        if ($code === '' || !function_exists('update_option')) {
            return;
        }
        try {
            if (self::code(get_option(self::BUSINESS_OPTION, '')) !== $code) {
                update_option(self::BUSINESS_OPTION, $code, false);
            }
        } catch (\Throwable $e) {
            WebMaven_Log::write('[WebMaven Plugin currency] The business currency was not remembered: ' . $e->getMessage());
        }
    }

    /** Whether WPMaven named a business currency on this site yet. */
    public static function remembered() {
        return function_exists('get_option') ? self::code(get_option(self::BUSINESS_OPTION, '')) : '';
    }

    // ── What the plugins hold (store_currency_read) ─────────────────────────

    /**
     * The plain read (the business page's card, the setup wizard): each
     * running plugin with its currency and whether it holds prices (null:
     * could not be told). [] when none runs. Never throws.
     */
    public static function summary() {
        $out = [];
        foreach (self::active_plugins() as $slug) {
            try {
                $out[] = self::identity($slug) + [
                    'currency' => self::current_currency($slug),
                    'holds_prices' => self::holds_prices($slug),
                    'named_only' => false,
                ];
            } catch (\Throwable $e) {
                // Could not be read: its prices count as held.
                $out[] = self::identity($slug) + ['currency' => '', 'holds_prices' => null, 'named_only' => false];
                WebMaven_Log::write('[WebMaven Plugin currency] ' . self::identity($slug)['name'] . ' could not be read: ' . $e->getMessage());
            }
        }
        foreach (self::named_only_active() as $slug) {
            try {
                $out[] = self::identity($slug) + ['currency' => self::current_currency($slug), 'holds_prices' => null, 'named_only' => true];
            } catch (\Throwable $e) {
                WebMaven_Log::write('[WebMaven Plugin currency] ' . self::identity($slug)['name'] . ' could not be read: ' . $e->getMessage());
            }
        }
        return $out;
    }

    /**
     * The read with include_prices (the Store currency dialog): each running
     * plugin with its currency, whether it holds prices and up to $limit of
     * them as it shows them now, how many balances customers still owe in it
     * (null: could not be told), and its payment methods that are turned on
     * with the store currencies each takes (takes: the codes of OFFERED it
     * can charge in; [] for one this cannot tell), so the dialog says which
     * cannot take the currency the owner picks. Never throws.
     */
    public static function details($limit = 10) {
        $out = [];
        foreach (self::active_plugins() as $slug) {
            try {
                $holds = self::holds_prices($slug);
                $methods = [];
                foreach (self::payment_methods($slug) as $method) {
                    // The store's own checkout takes whatever the store will sell in.
                    $codes = !empty($method[2]) ? self::OFFERED : [];
                    foreach (empty($method[2]) ? self::OFFERED : [] as $code) {
                        if ($method[1]($code) === true) {
                            $codes[] = $code;
                        }
                    }
                    $methods[] = ['name' => $method[0], 'takes' => $codes];
                }
                $out[] = self::identity($slug) + [
                    'currency' => self::current_currency($slug),
                    'holds_prices' => $holds,
                    'prices' => $holds === false ? [] : self::priced_items($slug, $limit),
                    'owed' => self::owed($slug),
                    'payment_methods' => $methods,
                    'named_only' => false,
                ];
            } catch (\Throwable $e) {
                // Could not be read: its prices and balances count as held.
                $out[] = self::identity($slug) + ['currency' => '', 'holds_prices' => null, 'prices' => [], 'owed' => null, 'payment_methods' => [], 'named_only' => false];
                WebMaven_Log::write('[WebMaven Plugin currency] ' . self::identity($slug)['name'] . '\'s prices could not be read: ' . $e->getMessage());
            }
        }
        foreach (self::named_only_active() as $slug) {
            try {
                $out[] = self::identity($slug) + [
                    'currency' => self::current_currency($slug),
                    'holds_prices' => null,
                    'prices' => [],
                    'owed' => 0,
                    'payment_methods' => [],
                    'named_only' => true,
                ];
            } catch (\Throwable $e) {
                WebMaven_Log::write('[WebMaven Plugin currency] ' . self::identity($slug)['name'] . ' could not be read: ' . $e->getMessage());
            }
        }
        return $out;
    }

    // ── Following ───────────────────────────────────────────────────────────

    /**
     * Every running plugin follows the store currency $code (a store
     * currency set that went through, the store changed elsewhere, the
     * catch-up). $decimals are the currency's own (the API sends them); $mode
     * is one of MODES; $consent is the owner's choice to relabel the prices a
     * plugin holds (keep only). Null when no plugin runs here. Never throws.
     *
     * -> {currency, followed, plugins: [{slug, name, what, followed,
     *     currency, changed?, reason?, methods?, owed?}]}
     */
    public static function follow_store($code, $decimals = null, $mode = 'keep', $consent = false) {
        self::$followed = true;
        try {
            $code = self::code($code);
            if ($code === '') {
                return null;
            }
            $mode = in_array($mode, self::MODES, true) ? $mode : 'keep';
            $rows = [];
            foreach (self::active_plugins() as $slug) {
                $rows[] = self::follow_safely($slug, $code, $decimals, $mode, (bool) $consent);
            }
            foreach (self::named_only_active() as $slug) {
                $rows[] = self::named_only_row($slug, $code);
            }
            return $rows ? self::answer($code, $rows) : null;
        } catch (\Throwable $e) {
            WebMaven_Log::write('[WebMaven Plugin currency] Following the store currency failed: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * install_plugin's first-run config: the build names the business's
     * currency (config plugin_currency, with plugin_decimals), remembered for
     * every plugin installed later; and a plugin that keeps its own currency,
     * which this call turned on, takes the business's currency (a store's
     * that holds prices first). Null when it did not run (another plugin, one
     * that already ran, no currency known). Never throws.
     */
    public static function follow_on_install($slug, $config, $just_activated) {
        try {
            $config = is_array($config) ? $config : [];
            $named = isset($config['plugin_currency']) && is_scalar($config['plugin_currency']) ? self::code($config['plugin_currency']) : '';
            if ($named !== '') {
                self::remember($named);
            }
            if (!$just_activated || !isset(self::PLUGINS[$slug]) || !self::is_active($slug)) {
                return null;
            }
            $code = self::business_currency();
            if ($code === '') {
                return null;
            }
            $decimals = $code === $named && isset($config['plugin_decimals']) ? $config['plugin_decimals'] : null;
            $row = self::follow_safely($slug, $code, $decimals, 'install', false);
            self::schedule_catch_up(300);
            return self::answer($code, [$row]);
        } catch (\Throwable $e) {
            WebMaven_Log::write('[WebMaven Plugin currency] A new plugin did not take the business currency: ' . $e->getMessage());
            return null;
        }
    }

    /** activated_plugin: a plugin that keeps its own currency, turned on by any path, takes the business's currency. */
    public static function on_activated($plugin = '') {
        try {
            $slug = self::slug_of($plugin);
            if ($slug === '' || !isset(self::PLUGINS[$slug]) || !self::is_active($slug)) {
                return;
            }
            $code = self::business_currency();
            if ($code === '') {
                return;
            }
            self::follow_safely($slug, $code, null, 'install', false);
            self::schedule_catch_up(300);
        } catch (\Throwable $e) {
            WebMaven_Log::write('[WebMaven Plugin currency] A plugin turned on did not take the business currency: ' . $e->getMessage());
        }
    }

    /** The check: every running plugin that holds no price takes the business's currency. */
    public static function catch_up() {
        try {
            $code = self::business_currency();
            if ($code === '') {
                return null;
            }
            $rows = [];
            foreach (self::active_plugins() as $slug) {
                $rows[] = self::follow_safely($slug, $code, null, 'catch_up', false);
            }
            return $rows ? self::answer($code, $rows) : null;
        } catch (\Throwable $e) {
            WebMaven_Log::write('[WebMaven Plugin currency] The catch-up failed: ' . $e->getMessage());
            return null;
        }
    }

    /** Once after the plugin updates: the plugins installed before this release follow too. */
    public static function maybe_catch_up_after_update() {
        try {
            if (!function_exists('get_option') || get_option(self::CAUGHT_UP_OPTION, '') === '1') {
                return;
            }
            update_option(self::CAUGHT_UP_OPTION, '1');
            self::schedule_catch_up(60);
        } catch (\Throwable $e) {
            WebMaven_Log::write('[WebMaven Plugin currency] The catch-up was not scheduled: ' . $e->getMessage());
        }
    }

    /** The store's currency or price format changed: the plugins follow at the end of the request. */
    public static function on_store_format_change() {
        if (self::$store_changed) {
            return;
        }
        self::$store_changed = true;
        if (function_exists('add_action')) {
            add_action('shutdown', ['WebMaven_Plugin_Currency', 'after_store_change']);
        }
    }

    /**
     * The end of a request that changed the store's currency or format
     * elsewhere (WooCommerce's settings, store_update_settings): the store's
     * currency is the business's now, and every plugin follows it (never
     * relabeling prices nobody saw). Nothing when store_currency_set already
     * brought them along.
     */
    public static function after_store_change() {
        if (self::$followed || !self::$store_changed) {
            return null;
        }
        $code = self::woocommerce_currency();
        if ($code === '') {
            return null;
        }
        self::remember($code);
        return self::follow_store($code, null, 'outside', false);
    }

    /** Test seam: forget what this request did. */
    public static function reset_request() {
        self::$followed = false;
        self::$store_changed = false;
    }

    private static function schedule_catch_up($delay) {
        if (function_exists('wp_next_scheduled') && function_exists('wp_schedule_single_event') && !wp_next_scheduled(self::CATCH_UP_HOOK)) {
            wp_schedule_single_event(time() + (int) $delay, self::CATCH_UP_HOOK);
        }
    }

    /** "latepoint/latepoint.php" -> "latepoint". */
    private static function slug_of($plugin) {
        if (!is_string($plugin) || $plugin === '') {
            return '';
        }
        $plugin = str_replace('\\', '/', $plugin);
        $dir = dirname($plugin);
        if ($dir !== '.' && $dir !== '') {
            $parts = explode('/', $dir);
            return (string) end($parts);
        }
        return basename($plugin, '.php');
    }

    private static function answer($code, array $rows) {
        $all = true;
        foreach ($rows as $r) {
            $all = $all && !empty($r['followed']);
        }
        return ['currency' => $code, 'followed' => $all, 'plugins' => $rows];
    }

    private static function named_only_row($slug, $code) {
        $current = self::current_currency($slug);
        $row = self::identity($slug) + ['followed' => $current === $code, 'currency' => $current];
        if ($current !== $code) {
            $row['reason'] = self::NOT_SET_HERE;
        }
        return $row;
    }

    /**
     * One plugin follows, whatever its own code throws: an error in one plugin
     * never stops the others (it keeps its currency, and says so).
     */
    private static function follow_safely($slug, $code, $decimals, $mode, $consent) {
        try {
            return self::follow_one($slug, $code, $decimals, $mode, $consent);
        } catch (\Throwable $e) {
            WebMaven_Log::write('[WebMaven Plugin currency] ' . self::identity($slug)['name'] . ' could not follow the store currency: ' . $e->getMessage());
            $current = '';
            try {
                $current = self::current_currency($slug);
            } catch (\Throwable $ignored) {
                $current = '';
            }
            return self::identity($slug) + ['followed' => false, 'currency' => $current, 'reason' => self::NOT_SAVED];
        }
    }

    /**
     * One plugin follows $code: {slug, name, what, followed, currency (its
     * currency after this), changed?, reason?, methods?, owed?}.
     */
    private static function follow_one($slug, $code, $decimals, $mode, $consent) {
        $base = self::identity($slug);
        $current = self::current_currency($slug);
        $stay = function ($reason, array $more = []) use ($base, $current) {
            return $base + ['followed' => false, 'currency' => $current, 'reason' => $reason] + $more;
        };
        if ($current !== $code) {
            // A new currency relabels every price the plugin holds.
            $holds = self::holds_prices($slug);
            if ($holds !== false) {
                if ($mode === 'convert') {
                    return $stay(self::CONVERT);
                }
                if (!($mode === 'keep' && $consent)) {
                    return $stay(self::HAS_PRICES);
                }
            }
            // A customer's agreed amount never changes currency.
            $owed = self::owed($slug);
            if ($owed !== 0) {
                return $stay(self::OWED, ['owed' => $owed]);
            }
        }
        $blocking = self::payments_blocking($slug, $code);
        if ($blocking) {
            return $stay(self::PAYMENTS, ['methods' => $blocking]);
        }
        list($saved, $changed) = self::write_slots(self::slots($slug, self::format($code, $decimals)));
        if (!$saved) {
            WebMaven_Log::write('[WebMaven Plugin currency] ' . $base['name'] . ' did not keep its currency settings; they were put back.');
            return $base + ['followed' => false, 'currency' => self::current_currency($slug), 'reason' => self::NOT_SAVED];
        }
        return $base + ['followed' => true, 'currency' => $code, 'changed' => $changed];
    }

    // ── The store currency's format ─────────────────────────────────────────

    /**
     * How the store shows a price in $code: {code, symbol, position,
     * thousand, decimal, decimals}. A running WooCommerce that sells in $code
     * gives its own symbol, position and separators; otherwise WooCommerce's
     * defaults for a new store (symbol first, 1,000.00). The decimals are the
     * currency's own ($decimals when the API sent them).
     */
    public static function format($code, $decimals = null) {
        $code = self::code($code);
        $symbol = self::SYMBOLS[$code] ?? $code;
        $position = isset(self::SYMBOLS[$code]) ? 'left' : 'left_space';
        $thousand = ',';
        $decimal = '.';
        if ($code !== '' && self::woocommerce_currency() === $code) {
            if (function_exists('get_woocommerce_currency_symbol')) {
                $own = html_entity_decode((string) get_woocommerce_currency_symbol($code), ENT_QUOTES, 'UTF-8');
                if (trim($own) !== '') {
                    $symbol = $own;
                }
            }
            $position = (string) get_option('woocommerce_currency_pos', 'left');
            $thousand = (string) get_option('woocommerce_price_thousand_sep', ',');
            $decimal = (string) get_option('woocommerce_price_decimal_sep', '.');
        }
        if (!in_array($position, self::POSITIONS, true)) {
            $position = 'left';
        }
        $decimal = in_array($decimal, self::DECIMALS, true) ? $decimal : '.';
        if (!in_array($thousand, self::THOUSANDS, true)) {
            // A no-break or thin space shows as a space; anything else as none.
            $thousand = preg_match('/^(?:\s|\x{00A0}|\x{202F}|\x{2009}|&nbsp;)+$/u', $thousand) ? ' ' : '';
        }
        if ($thousand === $decimal) {
            $thousand = '';
        }
        return [
            'code' => $code,
            'symbol' => $symbol,
            'position' => $position,
            'thousand' => $thousand,
            'decimal' => $decimal,
            'decimals' => self::decimals_of($code, $decimals),
        ];
    }

    /** The currency's own decimals: the API's when they are a whole number from 0 to 4, else ISO 4217's. */
    public static function decimals_of($code, $given = null) {
        if (is_int($given) || (is_string($given) && ctype_digit($given))) {
            $n = (int) $given;
            if ($n >= 0 && $n <= 4) {
                return $n;
            }
        }
        $code = self::code($code);
        if (in_array($code, self::NO_DECIMALS, true)) {
            return 0;
        }
        return in_array($code, self::THREE_DECIMALS, true) ? 3 : 2;
    }

    /** A three-letter code in upper case, or ''. */
    private static function code($v) {
        $c = is_scalar($v) ? strtoupper(trim((string) $v)) : '';
        return preg_match('/^[A-Z]{3}$/', $c) ? $c : '';
    }

    /** WooCommerce's currency when WooCommerce runs here, else ''. */
    private static function woocommerce_currency() {
        if (!class_exists('WooCommerce') || !function_exists('get_option')) {
            return '';
        }
        return self::code(get_option('woocommerce_currency', ''));
    }

    // ── Each plugin's currency and settings ─────────────────────────────────

    /** The currency a plugin sells (or shows prices) in now; '' when it cannot be told. */
    private static function current_currency($slug) {
        switch ($slug) {
            case 'latepoint':
                $own = self::code(self::latepoint_get('currency'));
                if ($own !== '') {
                    return $own;
                }
                $stripe = self::code(self::latepoint_get('stripe_connect_currency_iso_code'));
                return $stripe !== '' ? $stripe : 'USD';
            case 'ameliabooking':
                $settings = self::amelia_settings();
                $own = self::code($settings['payments']['currency'] ?? '');
                return $own !== '' ? $own : ($settings === null ? '' : 'USD');
            case 'wp-hotel-booking':
                return self::code(get_option('tp_hotel_booking_currency', 'USD'));
            case 'restropress':
                return self::code(self::array_option('rpress_settings')['currency'] ?? 'USD');
            case 'give':
                return self::code(self::array_option('give_settings')['currency'] ?? 'USD');
            case 'tutor':
                return self::code(self::array_option('tutor_option')['currency_code'] ?? 'USD');
            case 'the-events-calendar':
                return self::code(self::array_option('tribe_events_calendar_options')['defaultCurrencyCode'] ?? 'USD');
            case 'estatik':
                return function_exists('ests') ? self::code(ests('currency')) : '';
            case 'directorist':
                return function_exists('get_directorist_option') ? self::code(get_directorist_option('g_currency', 'USD')) : '';
        }
        return '';
    }

    /**
     * The settings a plugin shows and takes prices by, for $format, as slots:
     * {store, option?, key, value}. store: lp (LatePoint's settings helper),
     * hotel (WP Hotel Booking's settings, one option each), arr (a key of the
     * array option a plugin keeps its settings in), json (a key of Amelia's
     * JSON settings option, under payments).
     */
    private static function slots($slug, array $f) {
        $before = in_array($f['position'], ['left', 'left_space'], true);
        $spaced = in_array($f['position'], ['left_space', 'right_space'], true);
        switch ($slug) {
            case 'latepoint':
                $nbsp = "\u{00A0}";
                $out = [
                    ['store' => 'lp', 'key' => 'currency_symbol_before', 'value' => $before ? $f['symbol'] . ($spaced ? $nbsp : '') : ''],
                    ['store' => 'lp', 'key' => 'currency_symbol_after', 'value' => $before ? '' : ($spaced ? $nbsp : '') . $f['symbol']],
                    ['store' => 'lp', 'key' => 'thousand_separator', 'value' => $f['thousand']],
                    ['store' => 'lp', 'key' => 'decimal_separator', 'value' => $f['decimal']],
                    ['store' => 'lp', 'key' => 'number_of_decimals', 'value' => (string) $f['decimals']],
                    // The code LatePoint's own abilities report revenue in.
                    ['store' => 'lp', 'key' => 'currency', 'value' => $f['code']],
                ];
                // The code each payment method that takes the currency charges in.
                foreach (self::LATEPOINT_PAYMENTS as list($setting, $class, $list, $name, $case)) {
                    $value = $case === 'lower' ? strtolower($f['code']) : $f['code'];
                    if (self::list_takes($class, $list, $value) === true) {
                        $out[] = ['store' => 'lp', 'key' => $setting, 'value' => $value];
                    }
                }
                return $out;
            case 'ameliabooking':
                // Amelia has four ways to write 1,000.00; a store's other way is
                // the one with the same decimal separator (and a space when it has one).
                $space = $f['thousand'] === ' ';
                $separator = $f['decimal'] === ',' ? ($space ? 4 : 2) : ($space ? 3 : 1);
                foreach (self::AMELIA_SEPARATORS as $n => list($thousand, $decimal)) {
                    if ($thousand === $f['thousand'] && $decimal === $f['decimal']) {
                        $separator = $n;
                    }
                }
                return [
                    ['store' => 'json', 'option' => 'amelia_settings', 'key' => 'currency', 'value' => $f['code']],
                    ['store' => 'json', 'option' => 'amelia_settings', 'key' => 'symbol', 'value' => $f['symbol']],
                    ['store' => 'json', 'option' => 'amelia_settings', 'key' => 'priceSymbolPosition', 'value' => self::AMELIA_POSITIONS[$f['position']]],
                    ['store' => 'json', 'option' => 'amelia_settings', 'key' => 'priceNumberOfDecimals', 'value' => (int) $f['decimals']],
                    ['store' => 'json', 'option' => 'amelia_settings', 'key' => 'priceSeparator', 'value' => $separator],
                ];
            case 'wp-hotel-booking':
                // It shows its own symbol for the code.
                return [
                    ['store' => 'hotel', 'key' => 'tp_hotel_booking_currency', 'value' => $f['code']],
                    ['store' => 'hotel', 'key' => 'tp_hotel_booking_price_currency_position', 'value' => self::HOTEL_POSITIONS[$f['position']]],
                    ['store' => 'hotel', 'key' => 'tp_hotel_booking_price_thousands_separator', 'value' => $f['thousand']],
                    ['store' => 'hotel', 'key' => 'tp_hotel_booking_price_decimals_separator', 'value' => $f['decimal']],
                    ['store' => 'hotel', 'key' => 'tp_hotel_booking_price_number_of_decimal', 'value' => (string) $f['decimals']],
                ];
            case 'restropress':
                // Its own symbol for the code, before or after (no space), and
                // the currency's decimals by its own rule.
                return [
                    ['store' => 'arr', 'option' => 'rpress_settings', 'key' => 'currency', 'value' => $f['code']],
                    ['store' => 'arr', 'option' => 'rpress_settings', 'key' => 'currency_position', 'value' => $before ? 'before' : 'after'],
                    ['store' => 'arr', 'option' => 'rpress_settings', 'key' => 'thousands_separator', 'value' => $f['thousand']],
                    ['store' => 'arr', 'option' => 'rpress_settings', 'key' => 'decimal_separator', 'value' => $f['decimal']],
                ];
            case 'give':
                return [
                    ['store' => 'arr', 'option' => 'give_settings', 'key' => 'currency', 'value' => $f['code']],
                    ['store' => 'arr', 'option' => 'give_settings', 'key' => 'currency_position', 'value' => $before ? 'before' : 'after'],
                    ['store' => 'arr', 'option' => 'give_settings', 'key' => 'thousands_separator', 'value' => $f['thousand']],
                    ['store' => 'arr', 'option' => 'give_settings', 'key' => 'decimal_separator', 'value' => $f['decimal']],
                    ['store' => 'arr', 'option' => 'give_settings', 'key' => 'number_decimals', 'value' => (string) $f['decimals']],
                ];
            case 'tutor':
                return [
                    ['store' => 'arr', 'option' => 'tutor_option', 'key' => 'currency_code', 'value' => $f['code']],
                    ['store' => 'arr', 'option' => 'tutor_option', 'key' => 'currency_position', 'value' => $before ? 'left' : 'right'],
                    ['store' => 'arr', 'option' => 'tutor_option', 'key' => 'thousand_separator', 'value' => $f['thousand']],
                    ['store' => 'arr', 'option' => 'tutor_option', 'key' => 'decimal_separator', 'value' => $f['decimal']],
                    ['store' => 'arr', 'option' => 'tutor_option', 'key' => 'number_of_decimals', 'value' => (string) $f['decimals']],
                ];
            case 'the-events-calendar':
                // Its default for events that name no currency of their own.
                return [
                    ['store' => 'arr', 'option' => 'tribe_events_calendar_options', 'key' => 'defaultCurrencyCode', 'value' => $f['code']],
                    ['store' => 'arr', 'option' => 'tribe_events_calendar_options', 'key' => 'defaultCurrencySymbol', 'value' => $f['symbol']],
                    ['store' => 'arr', 'option' => 'tribe_events_calendar_options', 'key' => 'reverseCurrencyPosition', 'value' => !$before],
                ];
        }
        return [];
    }

    // ── Writing slots ───────────────────────────────────────────────────────

    /**
     * Write the slots whose value differs, then read every one back. [saved,
     * changed]: a write that does not stick puts back what was written (a
     * setting that existed gets its value back, one that did not is removed,
     * an array or JSON option gets its whole value back).
     */
    private static function write_slots(array $slots) {
        $todo = [];
        foreach ($slots as $i => $s) {
            $before = self::slot_get($s);
            if (!self::same($before, $s['value'])) {
                $todo[$i] = $before;
            }
        }
        if (!$todo) {
            return [true, false];
        }
        $raw = [];
        foreach (array_keys($todo) as $i) {
            $s = $slots[$i];
            if (($s['store'] === 'arr' || $s['store'] === 'json') && !array_key_exists($s['option'], $raw)) {
                $raw[$s['option']] = get_option($s['option'], null);
            }
        }
        try {
            // Array and JSON options: one write each, every key at once.
            $grouped = [];
            foreach (array_keys($todo) as $i) {
                $s = $slots[$i];
                if ($s['store'] === 'arr' || $s['store'] === 'json') {
                    $grouped[$s['store'] . ':' . $s['option']][] = $s;
                    continue;
                }
                self::slot_set($s, $s['value']);
            }
            foreach ($grouped as $group) {
                $first = $group[0];
                if ($first['store'] === 'arr') {
                    $data = self::array_option($first['option']);
                    foreach ($group as $s) {
                        $data[$s['key']] = $s['value'];
                    }
                    update_option($first['option'], $data);
                } else {
                    $data = self::json_option($first['option']);
                    if ($data === null) {
                        throw new \RuntimeException('its settings could not be read');
                    }
                    $payments = isset($data['payments']) && is_array($data['payments']) ? $data['payments'] : [];
                    foreach ($group as $s) {
                        $payments[$s['key']] = $s['value'];
                    }
                    $data['payments'] = $payments;
                    update_option($first['option'], json_encode($data));
                }
            }
            $ok = true;
            foreach (array_keys($todo) as $i) {
                if (!self::same(self::slot_get($slots[$i]), $slots[$i]['value'])) {
                    $ok = false;
                    break;
                }
            }
        } catch (\Throwable $e) {
            WebMaven_Log::write('[WebMaven Plugin currency] A currency setting was not written: ' . $e->getMessage());
            $ok = false;
        }
        if ($ok) {
            return [true, true];
        }
        // Put back what was written: the plugin stays as it was.
        foreach (array_reverse(array_keys($todo), true) as $i) {
            $s = $slots[$i];
            if ($s['store'] === 'arr' || $s['store'] === 'json') {
                continue;
            }
            try {
                self::slot_restore($s, $todo[$i]);
            } catch (\Throwable $e) {
                WebMaven_Log::write('[WebMaven Plugin currency] ' . $s['key'] . ' could not be put back: ' . $e->getMessage());
            }
        }
        foreach ($raw as $option => $value) {
            try {
                if ($value === null) {
                    delete_option($option);
                } else {
                    update_option($option, $value);
                }
            } catch (\Throwable $e) {
                WebMaven_Log::write('[WebMaven Plugin currency] ' . $option . ' could not be put back: ' . $e->getMessage());
            }
        }
        return [false, false];
    }

    /** A slot's value as stored now; null when it was never saved. */
    private static function slot_get(array $s) {
        switch ($s['store']) {
            case 'lp':
                return self::latepoint_get($s['key']);
            case 'hotel':
                $v = get_option($s['key'], null);
                return is_scalar($v) ? $v : null;
            case 'arr':
                $data = get_option($s['option'], null);
                return is_array($data) && array_key_exists($s['key'], $data) ? $data[$s['key']] : null;
            case 'json':
                $data = self::json_option($s['option']);
                $payments = is_array($data['payments'] ?? null) ? $data['payments'] : [];
                return array_key_exists($s['key'], $payments) ? $payments[$s['key']] : null;
        }
        return null;
    }

    private static function slot_set(array $s, $value) {
        switch ($s['store']) {
            case 'lp':
                OsSettingsHelper::save_setting_by_name($s['key'], $value);
                return;
            case 'hotel':
                // WP Hotel Booking's own settings object writes its option.
                if (class_exists('WPHB_Settings') && method_exists('WPHB_Settings', 'instance')) {
                    WPHB_Settings::instance()->set($s['key'], $value);
                } else {
                    update_option($s['key'], $value);
                }
                return;
        }
    }

    private static function slot_restore(array $s, $before) {
        switch ($s['store']) {
            case 'lp':
                if ($before === null && method_exists('OsSettingsHelper', 'remove_setting_by_name')) {
                    OsSettingsHelper::remove_setting_by_name($s['key']);
                } else {
                    OsSettingsHelper::save_setting_by_name($s['key'], $before === null ? '' : (string) $before);
                }
                return;
            case 'hotel':
                if ($before === null) {
                    delete_option($s['key']);
                } else {
                    update_option($s['key'], $before);
                }
                return;
        }
    }

    /** Whether a stored value is the one wanted (text as text, a switch as a switch). */
    private static function same($stored, $want) {
        if (is_bool($want) || is_bool($stored)) {
            return $stored !== null && (bool) $stored === (bool) $want && (is_bool($stored) || in_array((string) $stored, ['', '0', '1'], true));
        }
        if ($stored === null) {
            return false;
        }
        if (is_scalar($stored) && is_scalar($want)) {
            return (string) $stored === (string) $want;
        }
        return $stored === $want;
    }

    /** An array option as an array ([] when absent or not an array). */
    private static function array_option($option) {
        $data = function_exists('get_option') ? get_option($option, []) : [];
        return is_array($data) ? $data : [];
    }

    /** A JSON settings option (Amelia's), or null when it cannot be read. */
    private static function json_option($option) {
        $raw = get_option($option, null);
        $data = is_string($raw) ? json_decode($raw, true) : (is_array($raw) ? $raw : null);
        return is_array($data) ? $data : null;
    }

    /** Amelia's settings, or null when they cannot be read. */
    private static function amelia_settings() {
        return self::json_option('amelia_settings');
    }

    // ── LatePoint's settings ────────────────────────────────────────────────

    /** A LatePoint setting as it is stored now (as text), or null when it was never saved. */
    private static function latepoint_get($name) {
        if (!class_exists('OsSettingsHelper')) {
            return null;
        }
        if (method_exists('OsSettingsHelper', 'reset_loaded_value')) {
            OsSettingsHelper::reset_loaded_value($name);
        }
        $v = OsSettingsHelper::get_settings_value($name, null);
        return $v === null ? null : (is_scalar($v) ? (string) $v : null);
    }

    private static function latepoint_on($name) {
        return method_exists('OsSettingsHelper', 'is_on') ? (bool) OsSettingsHelper::is_on($name) : false;
    }

    /** Whether a payment list (a plugin helper's static method) holds $value: null when the list cannot be read. */
    private static function list_takes($class, $method, $value) {
        if (!class_exists($class) || !method_exists($class, $method)) {
            return null;
        }
        $codes = call_user_func([$class, $method]);
        return is_array($codes) && array_key_exists($value, $codes);
    }

    // ── Payment methods ─────────────────────────────────────────────────────

    /** The names of a plugin's payment methods that are turned on and cannot take $code (one this cannot tell included). */
    private static function payments_blocking($slug, $code) {
        $out = [];
        foreach (self::payment_methods($slug) as $method) {
            if ($method[1]($code) !== true) {
                $out[] = $method[0];
            }
        }
        return array_values(array_unique(array_filter(array_map('strval', $out), 'strlen')));
    }

    /**
     * A plugin's payment methods that are turned on and take a payment in the
     * plugin's own currency: [the name the owner knows it by, fn(code) ->
     * true when it takes that code, false or null when it does not or this
     * cannot tell, and true for the store's own checkout, which takes what
     * the store sells in]. A method that takes whatever is shown (paying on
     * site, in cash, by bank transfer) is not one: the page and the charge
     * agree.
     */
    private static function payment_methods($slug) {
        $list = function (array $codes) {
            return function ($code) use ($codes) {
                return in_array($code, $codes, true);
            };
        };
        $unknown = function ($code) {
            return null;
        };
        $out = [];
        switch ($slug) {
            case 'latepoint':
                foreach (self::latepoint_enabled_processors() as $processor => $name) {
                    $known = self::LATEPOINT_PAYMENTS[$processor] ?? null;
                    $out[] = [$name, $known === null ? $unknown : function ($code) use ($known) {
                        return self::list_takes($known[1], $known[2], $known[4] === 'lower' ? strtolower($code) : $code);
                    }];
                }
                break;
            case 'ameliabooking':
                $p = self::amelia_settings()['payments'] ?? [];
                $p = is_array($p) ? $p : [];
                if (!empty($p['square']['enabled'])) {
                    // Square takes a payment in its own location's currency, whatever the calendar says.
                    $out[] = ['Square', $unknown];
                }
                if (!empty($p['wc']['enabled'])) {
                    // The store's checkout takes the store's currency: the calendar
                    // follows the store, so they agree once both have changed.
                    $out[] = ['WooCommerce checkout', function ($code) {
                        $store = self::woocommerce_currency();
                        return $store === '' ? null : $store === $code;
                    }, true];
                }
                foreach (self::AMELIA_PAYMENTS as $key => list($name, $takes)) {
                    if (!empty($p[$key]['enabled'])) {
                        $out[] = [$name, $takes === null ? $unknown : $list($takes)];
                    }
                }
                break;
            case 'wp-hotel-booking':
                if (function_exists('hb_get_payment_gateways')) {
                    foreach ((array) hb_get_payment_gateways(['enable' => true]) as $id => $gateway) {
                        if ($id === 'offline-payment') {
                            continue;
                        }
                        $out[] = [self::gateway_name($gateway, $id), $id === 'paypal' ? $list(self::PAYPAL_TAKES) : ($id === 'stripe' ? $list(self::CARD_TAKES) : $unknown)];
                    }
                }
                break;
            case 'restropress':
                if (function_exists('rpress_get_enabled_payment_gateways')) {
                    foreach ((array) rpress_get_enabled_payment_gateways() as $id => $gateway) {
                        if (in_array($id, ['cash_on_delivery', 'manual'], true)) {
                            continue;
                        }
                        $out[] = [self::gateway_name($gateway, $id), $id === 'paypal' ? $list(self::PAYPAL_TAKES) : $unknown];
                    }
                }
                break;
            case 'give':
                if (function_exists('give_get_enabled_payment_gateways')) {
                    foreach ((array) give_get_enabled_payment_gateways() as $id => $gateway) {
                        $known = array_key_exists($id, self::GIVE_PAYMENTS);
                        if ($known && self::GIVE_PAYMENTS[$id] === null) {
                            continue;
                        }
                        $out[] = [self::gateway_name($gateway, $id), $known ? $list(self::GIVE_PAYMENTS[$id]) : $unknown];
                    }
                }
                break;
            case 'tutor':
                if (self::tutor_sells_itself()) {
                    foreach (self::tutor_payment_methods() as $method) {
                        if (empty($method['is_active']) || !empty($method['is_manual'])) {
                            continue;
                        }
                        $id = (string) ($method['name'] ?? '');
                        $out[] = [self::gateway_name($method, $id), $id === 'paypal' ? $list(self::PAYPAL_TAKES) : ($id === 'stripe' ? $list(self::CARD_TAKES) : $unknown)];
                    }
                }
                break;
        }
        return $out;
    }

    /** LatePoint's payment processors that are turned on: code => the name the owner knows it by. */
    private static function latepoint_enabled_processors() {
        $out = [];
        if (class_exists('OsPaymentsHelper') && method_exists('OsPaymentsHelper', 'get_enabled_payment_processors')) {
            foreach ((array) OsPaymentsHelper::get_enabled_payment_processors() as $key => $p) {
                $code = is_array($p) && isset($p['code']) ? (string) $p['code'] : (string) $key;
                $name = is_array($p) ? (string) ($p['front_name'] ?? $p['name'] ?? $code) : $code;
                $out[$code] = isset(self::LATEPOINT_PAYMENTS[$code]) ? self::LATEPOINT_PAYMENTS[$code][3] : $name;
            }
        }
        // The known ones, also when LatePoint registers its processors later (on init).
        foreach (self::LATEPOINT_PAYMENTS as $code => $known) {
            if (!isset($out[$code]) && self::latepoint_on('enable_payment_processor_' . $code)) {
                $out[$code] = $known[3];
            }
        }
        return $out;
    }

    /** A payment gateway's name as its plugin labels it. */
    private static function gateway_name($gateway, $id) {
        if (is_object($gateway)) {
            foreach (['title', 'name', 'label'] as $p) {
                if (isset($gateway->$p) && is_string($gateway->$p) && trim($gateway->$p) !== '') {
                    return trim($gateway->$p);
                }
            }
        }
        if (is_array($gateway)) {
            foreach (['admin_label', 'checkout_label', 'label', 'title'] as $k) {
                if (isset($gateway[$k]) && is_string($gateway[$k]) && trim($gateway[$k]) !== '') {
                    return self::plain_label($gateway[$k]);
                }
            }
        }
        return ucwords(str_replace(['-', '_'], ' ', (string) $id));
    }

    /** A label without markup (a gateway's admin label can carry HTML). */
    private static function plain_label($text) {
        return trim(wp_strip_all_tags((string) $text));
    }

    /** Whether Tutor LMS sells courses itself (not through WooCommerce or another shop). */
    private static function tutor_sells_itself() {
        $by = self::array_option('tutor_option')['monetize_by'] ?? 'tutor';
        return $by === 'tutor';
    }

    /** Tutor LMS's payment methods (its payment settings, JSON). */
    private static function tutor_payment_methods() {
        $raw = self::array_option('tutor_option')['payment_settings'] ?? '';
        $data = is_string($raw) ? json_decode($raw, true) : (is_array($raw) ? $raw : null);
        $methods = is_array($data) && is_array($data['payment_methods'] ?? null) ? $data['payment_methods'] : [];
        return array_values(array_filter($methods, 'is_array'));
    }

    // ── Prices a plugin holds ───────────────────────────────────────────────

    /** Whether a plugin holds a price a new currency would relabel. Null when it could not be told. */
    public static function holds_prices($slug) {
        switch ($slug) {
            case 'latepoint':
                $any = self::any_positive(self::LATEPOINT_MONEY);
                return $any !== false ? $any : self::json_prices('latepoint_service_meta', 'meta_value', "meta_key = 'durations'", ['charge_amount', 'deposit_amount']);
            case 'ameliabooking':
                $any = self::any_positive(self::AMELIA_MONEY);
                if ($any !== false) {
                    return $any;
                }
                $taxes = self::count_where('amelia_taxes', "`type` = 'fixed' AND `amount` > 0");
                if ($taxes !== 0) {
                    return $taxes === null ? null : true;
                }
                $custom = self::json_prices('amelia_services', 'customPricing', "customPricing IS NOT NULL AND customPricing <> ''", ['price']);
                if ($custom !== false) {
                    return $custom;
                }
                return self::json_prices('amelia_providers_to_services', 'customPricing', "customPricing IS NOT NULL AND customPricing <> ''", ['price']);
            case 'wp-hotel-booking':
                $plans = self::count_where('hotel_booking_plans', "pricing IS NOT NULL AND pricing <> ''");
                if ($plans !== 0) {
                    return $plans === null ? null : true;
                }
                return self::posts_hold(['hb_extra_room'], ['tp_hb_extra_room_price'], ['hb_coupon']);
            case 'restropress':
                return self::posts_hold(['fooditem'], ['rpress_price'], ['rpress_discount'], ['rpress_variable_prices']);
            case 'give':
                return self::posts_hold([], [], ['give_forms']);
            case 'tutor':
                return self::posts_hold(['courses'], ['tutor_course_price'], []);
            case 'the-events-calendar':
                return self::events_hold();
        }
        return false;
    }

    /** Up to $limit of the prices a plugin holds: [{title, value}] (value as it shows it now, or '' when it is not one number). */
    private static function priced_items($slug, $limit) {
        $rows = [];
        switch ($slug) {
            case 'latepoint':
                $shown = self::latepoint_shown();
                foreach (['latepoint_services', 'latepoint_bundles'] as $table) {
                    foreach (self::positive_rows($table, 'charge_amount, deposit_amount, price_min, price_max', self::LATEPOINT_MONEY[$table], $limit - count($rows)) as $r) {
                        $amount = (float) ($r['charge_amount'] ?? 0) > 0 ? $r['charge_amount'] : ((float) ($r['price_min'] ?? 0) > 0 ? $r['price_min'] : null);
                        $rows[] = ['title' => (string) $r['name'], 'value' => $amount === null ? '' : self::latepoint_display($amount, $shown)];
                    }
                }
                foreach (self::positive_rows('latepoint_events', 'price', ['price'], $limit - count($rows)) as $r) {
                    $rows[] = ['title' => (string) $r['name'], 'value' => self::latepoint_display($r['price'], $shown)];
                }
                break;
            case 'ameliabooking':
                $payments = self::amelia_settings()['payments'] ?? [];
                $payments = is_array($payments) ? $payments : [];
                foreach (['amelia_services', 'amelia_packages', 'amelia_events'] as $table) {
                    foreach (self::positive_rows($table, 'price', ['price'], $limit - count($rows)) as $r) {
                        $rows[] = ['title' => (string) $r['name'], 'value' => self::amelia_display($r['price'], $payments)];
                    }
                }
                break;
            case 'wp-hotel-booking':
                $rows = self::post_titles(['hb_room'], [], $limit, 'hotel_booking_plans');
                $rows = array_merge($rows, self::post_titles(['hb_extra_room'], ['tp_hb_extra_room_price'], $limit - count($rows)));
                break;
            case 'restropress':
                $rows = self::post_titles(['fooditem'], ['rpress_price'], $limit);
                break;
            case 'give':
                $rows = self::post_titles(['give_forms'], [], $limit);
                break;
            case 'tutor':
                $rows = self::post_titles(['courses'], ['tutor_course_price'], $limit);
                break;
            case 'the-events-calendar':
                $rows = self::event_rows($limit);
                break;
        }
        return array_slice($rows, 0, max(0, (int) $limit));
    }

    // ── Money customers still owe ───────────────────────────────────────────

    /**
     * How many bookings, orders or invoices of a plugin customers still owe
     * money on, where the amount carries no currency of its own (a new one
     * would change what they agreed to pay). 0 for a plugin whose orders keep
     * their own currency; null when it could not be told.
     */
    private static function owed($slug) {
        switch ($slug) {
            case 'latepoint':
                $n = 0;
                foreach ([
                    // An open invoice (a deposit's balance, a pay link).
                    ['latepoint_order_invoices', 'SELECT COUNT(*) FROM `%1$s` WHERE `status` = \'open\' AND `charge_amount` > 0', []],
                    // An order not paid in full, for a booking still to come.
                    ['latepoint_orders', 'SELECT COUNT(DISTINCT o.id) FROM `%1$s` o INNER JOIN `%2$s` oi ON oi.order_id = o.id INNER JOIN `%3$s` b ON b.order_item_id = oi.id'
                        . ' WHERE o.status <> \'cancelled\' AND o.payment_status IN (\'not_paid\', \'partially_paid\', \'processing\') AND o.total > 0'
                        . ' AND b.status <> \'cancelled\' AND b.start_datetime_utc >= UTC_TIMESTAMP()', ['latepoint_order_items', 'latepoint_bookings']],
                    // An order not paid in full, for an event still to come.
                    ['latepoint_orders', 'SELECT COUNT(DISTINCT o.id) FROM `%1$s` o INNER JOIN `%2$s` r ON r.order_id = o.id INNER JOIN `%3$s` e ON e.id = r.event_id'
                        . ' WHERE o.status <> \'cancelled\' AND o.payment_status IN (\'not_paid\', \'partially_paid\', \'processing\') AND o.total > 0'
                        . ' AND e.start_datetime_utc >= UTC_TIMESTAMP()', ['latepoint_event_registrations', 'latepoint_events']],
                ] as list($main, $sql, $joined)) {
                    $c = self::count_sql($main, $sql, $joined);
                    if ($c === null) {
                        return null;
                    }
                    $n += $c;
                }
                return $n;
            case 'ameliabooking':
                $n = 0;
                foreach ([
                    // A booking still to come whose payment is not in.
                    ['amelia_customer_bookings', 'SELECT COUNT(DISTINCT cb.id) FROM `%1$s` cb INNER JOIN `%2$s` p ON p.customerBookingId = cb.id INNER JOIN `%3$s` a ON a.id = cb.appointmentId'
                        . ' WHERE p.status IN (\'pending\', \'partiallyPaid\') AND cb.price > 0 AND cb.status IN (\'approved\', \'pending\', \'waiting\')'
                        . ' AND a.bookingStart >= UTC_TIMESTAMP() - INTERVAL 1 DAY', ['amelia_payments', 'amelia_appointments']],
                    // An event booking still to come whose payment is not in.
                    ['amelia_customer_bookings', 'SELECT COUNT(DISTINCT cb.id) FROM `%1$s` cb INNER JOIN `%2$s` p ON p.customerBookingId = cb.id INNER JOIN `%3$s` cbe ON cbe.customerBookingId = cb.id'
                        . ' INNER JOIN `%4$s` ep ON ep.id = cbe.eventPeriodId WHERE p.status IN (\'pending\', \'partiallyPaid\') AND cb.price > 0'
                        . ' AND cb.status IN (\'approved\', \'pending\', \'waiting\') AND ep.periodStart >= UTC_TIMESTAMP() - INTERVAL 1 DAY',
                        ['amelia_payments', 'amelia_customer_bookings_to_events_periods', 'amelia_events_periods']],
                ] as list($main, $sql, $joined)) {
                    $c = self::count_sql($main, $sql, $joined);
                    if ($c === null) {
                        return null;
                    }
                    $n += $c;
                }
                return $n;
            case 'tutor':
                if (!self::tutor_sells_itself()) {
                    return 0;
                }
                return self::count_sql('tutor_orders', 'SELECT COUNT(*) FROM `%1$s` WHERE `payment_status` = \'unpaid\' AND `order_status` IN (\'incomplete\', \'pending\') AND `total_price` > 0', []);
        }
        // WP Hotel Booking, RestroPress and GiveWP keep each booking's, order's
        // and donation's own currency; The Events Calendar takes no payment.
        return 0;
    }

    // ── How LatePoint and Amelia show a price ───────────────────────────────

    /** How LatePoint shows prices now: its symbols, separators and decimals ("$" first when never saved, as LatePoint does). */
    private static function latepoint_shown() {
        $before = self::latepoint_get('currency_symbol_before');
        return [
            'before' => $before === null ? '$' : $before,
            'after' => self::latepoint_get('currency_symbol_after') ?? '',
            'thousand' => self::latepoint_get('thousand_separator') ?? ',',
            'decimal' => self::latepoint_get('decimal_separator') ?? '.',
            'decimals' => max(0, min(4, (int) (self::latepoint_get('number_of_decimals') ?? '2'))),
        ];
    }

    /** An amount as LatePoint shows it (a whole amount without decimals, as LatePoint does). */
    private static function latepoint_display($amount, array $shown) {
        $n = (float) $amount;
        $text = number_format($n, floor($n) == $n ? 0 : $shown['decimals'], $shown['decimal'], $shown['thousand']);
        return $shown['before'] . $text . $shown['after'];
    }

    /** An amount as Amelia shows it now ($payments: its payments settings). */
    private static function amelia_display($amount, array $payments) {
        $sep = self::AMELIA_SEPARATORS[(int) ($payments['priceSeparator'] ?? 1)] ?? self::AMELIA_SEPARATORS[1];
        $text = number_format((float) $amount, max(0, min(4, (int) ($payments['priceNumberOfDecimals'] ?? 2))), $sep[1], $sep[0]);
        $symbol = (string) ($payments['symbol'] ?? '$');
        switch ($payments['priceSymbolPosition'] ?? 'before') {
            case 'after':
                return $text . $symbol;
            case 'afterWithSpace':
                return $text . ' ' . $symbol;
            case 'beforeWithSpace':
                return $symbol . ' ' . $text;
            default:
                return $symbol . $text;
        }
    }

    // ── Read-only queries (table, column and key names are this class's constants) ──

    /** Whether any of these tables holds a positive amount in these columns; null when it could not be told. */
    private static function any_positive(array $tables) {
        foreach ($tables as $table => $columns) {
            $c = self::count_where($table, self::positive($columns));
            if ($c === null) {
                return null;
            }
            if ($c > 0) {
                return true;
            }
        }
        return false;
    }

    /** Rows of a table matching $where: 0 when the table does not exist, null when the database could not say. */
    private static function count_where($table, $where) {
        return self::count_sql($table, 'SELECT COUNT(*) FROM `%1$s` WHERE ' . $where, []);
    }

    /**
     * A COUNT query over a plugin's tables ($sql names them %1$s, %2$s...):
     * 0 when one does not exist (the plugin's version has no such thing),
     * null when the database could not say.
     */
    private static function count_sql($main, $sql, array $joined) {
        $names = [];
        foreach (array_merge([$main], $joined) as $table) {
            $name = self::table($table);
            $exists = self::table_exists($name);
            if ($exists === null) {
                return null;
            }
            if (!$exists) {
                return 0;
            }
            $names[] = $name;
        }
        list($ok, $n) = self::db_read('get_var', vsprintf($sql, $names));
        return $ok ? (int) $n : null;
    }

    /** Whether JSON in a column holds a positive amount under one of $keys (anywhere in it); null when it could not be told. */
    private static function json_prices($table, $column, $where, array $keys) {
        $name = self::table($table);
        $exists = self::table_exists($name);
        if ($exists !== true) {
            return $exists === null ? null : false;
        }
        list($ok, $values) = self::db_read('get_col', 'SELECT `' . $column . '` FROM `' . $name . '` WHERE ' . $where . ' LIMIT 5000');
        if (!$ok || !is_array($values)) {
            return null;
        }
        foreach ($values as $json) {
            $data = is_string($json) ? json_decode($json, true) : null;
            if (is_array($data) && self::has_positive($data, $keys)) {
                return true;
            }
        }
        return false;
    }

    private static function has_positive(array $data, array $keys) {
        foreach ($data as $k => $v) {
            if (is_array($v)) {
                if (self::has_positive($v, $keys)) {
                    return true;
                }
            } elseif (in_array((string) $k, $keys, true) && is_numeric($v) && (float) $v > 0) {
                return true;
            }
        }
        return false;
    }

    /** Rows of $table with a positive amount: id, name and $select. [] when there are none (or no table). */
    private static function positive_rows($table, $select, array $columns, $limit) {
        if ($limit <= 0) {
            return [];
        }
        $name = self::table($table);
        if (self::table_exists($name) !== true) {
            return [];
        }
        list($ok, $rows) = self::db_read('get_results', 'SELECT id, name, ' . $select . ' FROM `' . $name . '` WHERE ' . self::positive($columns)
            . ' ORDER BY id ASC LIMIT ' . (int) $limit, ARRAY_A);
        return $ok && is_array($rows) ? $rows : [];
    }

    /**
     * Whether posts of a plugin hold prices: $priced post types with a
     * positive amount in one of $keys, $any post types at all (a donation
     * form, a coupon), or $listed post types with a non-empty list meta
     * (variable prices). Trashed posts and auto-drafts do not count.
     */
    private static function posts_hold(array $priced, array $keys, array $any, array $listed = []) {
        global $wpdb;
        if (!is_object($wpdb) || !isset($wpdb->posts, $wpdb->postmeta)) {
            return null;
        }
        $live = "p.post_status NOT IN ('trash', 'auto-draft')";
        $checks = [];
        if ($priced && $keys) {
            $checks[] = 'SELECT COUNT(*) FROM `' . self::ident($wpdb->posts) . '` p INNER JOIN `' . self::ident($wpdb->postmeta) . '` m ON m.post_id = p.ID'
                . ' WHERE p.post_type IN (' . self::list_sql($priced) . ') AND ' . $live . ' AND m.meta_key IN (' . self::list_sql($keys) . ') AND (m.meta_value + 0) > 0';
        }
        if ($priced && $listed) {
            $checks[] = 'SELECT COUNT(*) FROM `' . self::ident($wpdb->posts) . '` p INNER JOIN `' . self::ident($wpdb->postmeta) . '` m ON m.post_id = p.ID'
                . ' WHERE p.post_type IN (' . self::list_sql($priced) . ') AND ' . $live . ' AND m.meta_key IN (' . self::list_sql($listed) . ")"
                . " AND m.meta_value NOT IN ('', 'a:0:{}')";
        }
        if ($any) {
            $checks[] = 'SELECT COUNT(*) FROM `' . self::ident($wpdb->posts) . '` p WHERE p.post_type IN (' . self::list_sql($any) . ') AND ' . $live;
        }
        foreach ($checks as $sql) {
            list($ok, $n) = self::db_read('get_var', $sql);
            if (!$ok) {
                return null;
            }
            if ((int) $n > 0) {
                return true;
            }
        }
        return false;
    }

    /** The Events Calendar's events with a cost that name no currency of their own (a new default relabels them). */
    private static function events_hold() {
        global $wpdb;
        if (!is_object($wpdb) || !isset($wpdb->posts, $wpdb->postmeta)) {
            return null;
        }
        list($ok, $n) = self::db_read('get_var', 'SELECT COUNT(DISTINCT p.ID) ' . self::events_from());
        return $ok ? (int) $n > 0 : null;
    }

    private static function events_from() {
        global $wpdb;
        return 'FROM `' . self::ident($wpdb->posts) . '` p INNER JOIN `' . self::ident($wpdb->postmeta) . "` c ON c.post_id = p.ID AND c.meta_key = '_EventCost' AND TRIM(c.meta_value) <> ''"
            . ' LEFT JOIN `' . self::ident($wpdb->postmeta) . "` s ON s.post_id = p.ID AND s.meta_key = '_EventCurrencySymbol' AND TRIM(s.meta_value) <> ''"
            . " WHERE p.post_type = 'tribe_events' AND p.post_status NOT IN ('trash', 'auto-draft') AND s.meta_id IS NULL";
    }

    private static function event_rows($limit) {
        if ($limit <= 0) {
            return [];
        }
        list($ok, $rows) = self::db_read('get_results', 'SELECT DISTINCT p.ID AS id, p.post_title AS name, c.meta_value AS cost ' . self::events_from()
            . ' ORDER BY p.ID ASC LIMIT ' . (int) $limit, ARRAY_A);
        if (!$ok || !is_array($rows)) {
            return [];
        }
        $options = self::array_option('tribe_events_calendar_options');
        $symbol = isset($options['defaultCurrencySymbol']) && is_string($options['defaultCurrencySymbol']) ? $options['defaultCurrencySymbol'] : '$';
        $after = !empty($options['reverseCurrencyPosition']);
        $out = [];
        foreach ($rows as $r) {
            $cost = trim((string) ($r['cost'] ?? ''));
            $out[] = ['title' => (string) ($r['name'] ?? ''), 'value' => is_numeric($cost) ? ($after ? $cost . $symbol : $symbol . $cost) : $cost];
        }
        return $out;
    }

    /** Titles of posts that hold prices ($keys: a positive amount there; none: any post; $table: posts with rows in it by room_id). */
    private static function post_titles(array $types, array $keys, $limit, $table = null) {
        global $wpdb;
        if ($limit <= 0 || !is_object($wpdb) || !isset($wpdb->posts, $wpdb->postmeta)) {
            return [];
        }
        $sql = 'SELECT DISTINCT p.ID AS id, p.post_title AS name FROM `' . self::ident($wpdb->posts) . '` p';
        if ($keys) {
            $sql .= ' INNER JOIN `' . self::ident($wpdb->postmeta) . '` m ON m.post_id = p.ID AND m.meta_key IN (' . self::list_sql($keys) . ') AND (m.meta_value + 0) > 0';
        }
        if ($table !== null) {
            $name = self::table($table);
            if (self::table_exists($name) !== true) {
                return [];
            }
            $sql .= ' INNER JOIN `' . $name . '` t ON t.room_id = p.ID';
        }
        $sql .= ' WHERE p.post_type IN (' . self::list_sql($types) . ") AND p.post_status NOT IN ('trash', 'auto-draft') ORDER BY p.ID ASC LIMIT " . (int) $limit;
        list($ok, $rows) = self::db_read('get_results', $sql, ARRAY_A);
        if (!$ok || !is_array($rows)) {
            return [];
        }
        return array_map(function ($r) {
            return ['title' => (string) ($r['name'] ?? ''), 'value' => ''];
        }, $rows);
    }

    private static function positive(array $columns) {
        return '(' . implode(' OR ', array_map(function ($c) {
            return '`' . preg_replace('/[^A-Za-z_]/', '', $c) . '` > 0';
        }, $columns)) . ')';
    }

    /** A list of this class's own names as SQL strings. */
    private static function list_sql(array $values) {
        return implode(', ', array_map(function ($v) {
            return "'" . preg_replace('/[^A-Za-z0-9_\-]/', '', (string) $v) . "'";
        }, $values));
    }

    private static function ident($name) {
        return preg_replace('/[^A-Za-z0-9_]/', '', (string) $name);
    }

    private static function table($table) {
        global $wpdb;
        $prefix = is_object($wpdb) && isset($wpdb->prefix) ? (string) $wpdb->prefix : 'wp_';
        return self::ident($prefix . $table);
    }

    /** Whether a table exists; null when the database could not say. */
    private static function table_exists($name) {
        global $wpdb;
        if (!is_object($wpdb) || !method_exists($wpdb, 'prepare') || !method_exists($wpdb, 'esc_like')) {
            return null;
        }
        list($ok, $found) = self::db_read('get_var', $wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($name)));
        if (!$ok) {
            return null;
        }
        return $found !== null && strcasecmp((string) $found, $name) === 0;
    }

    /** A read with its errors kept quiet: [true, its result], or [false, null] when the database failed. */
    private static function db_read($method, $sql, $output = null) {
        global $wpdb;
        if (!is_object($wpdb) || !method_exists($wpdb, $method)) {
            return [false, null];
        }
        $prev = method_exists($wpdb, 'suppress_errors') ? $wpdb->suppress_errors(true) : null;
        if (property_exists($wpdb, 'last_error')) {
            $wpdb->last_error = '';
        }
        try {
            $result = $output === null ? $wpdb->$method($sql) : $wpdb->$method($sql, $output);
            $error = property_exists($wpdb, 'last_error') ? (string) $wpdb->last_error : '';
        } catch (\Throwable $e) {
            $result = null;
            $error = $e->getMessage() !== '' ? $e->getMessage() : 'failed';
        }
        if ($prev !== null) {
            $wpdb->suppress_errors($prev);
        }
        return $error === '' ? [true, $result] : [false, null];
    }
}
