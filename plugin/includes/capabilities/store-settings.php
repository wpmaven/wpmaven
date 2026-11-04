<?php
/**
 * WooCommerce store settings (2026-09-22): the plugin side of the API's
 * ecommerce_setup read and its three owner-approved writes
 * (store_update_settings, store_save_shipping_zone, store_delete_shipping_zone).
 *
 * The API used to send woo_get_settings, woo_get_shipping_zones and
 * woo_update_settings, which no plugin build ever handled. Contract, as the
 * API reads it (results arrive wrapped in response.data.data):
 *
 *   store_settings_read {}
 *     -> {woocommerce_active, general, tax, emails, shipping, orders, errors}
 *        (a section that could not be read is null, with its reason in errors)
 *   store_settings_change {changes: {setting: value, ..., emails: {id: bool}}}
 *     -> {changes: [{setting, label, before, after}], unchanged, failed, warnings}
 *   store_shipping_zone_save {zone_id?, name?, locations?, methods?, remove_method_ids?}
 *     -> {created, zone_id, before, after, done, failed, warnings}
 *   store_shipping_zone_delete {zone_id}
 *     -> {deleted, zone_id, before, after: null}
 *
 * These touch money settings on live stores, so:
 *  - only the settings in OPTIONS (plus store country/state and turning
 *    WooCommerce's own emails on or off) can be changed; any other key is
 *    refused;
 *  - the store currency is not one of them (2026-09-30): WooCommerce keeps
 *    prices as plain numbers, so a new currency relabels every price. A
 *    change naming it is refused whole, with nothing written, with
 *    WebMaven_Self_Protect::STORE_CURRENCY_REFUSAL (the Store currency
 *    setting changes it, capabilities/store-currency.php). The read still
 *    reports it;
 *  - every value is checked against what WooCommerce itself accepts (its
 *    countries and states, its emails) and the whole request is refused,
 *    with nothing written, if any one is wrong;
 *  - shipping methods are limited to flat rate and free shipping;
 *  - every write is read back, and each change is returned with its value
 *    before and after.
 *
 * A refusal RETURNS {success: false, error, code, problems?} (never cached,
 * read by the API's pluginFailure).
 */

if (!defined('ABSPATH')) {
    exit;
}

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['store_settings_read'] = ['WebMaven_Cap_Store_Settings', 'read'];
    $handlers['store_settings_change'] = ['WebMaven_Cap_Store_Settings', 'change'];
    $handlers['store_shipping_zone_save'] = ['WebMaven_Cap_Store_Settings', 'save_zone'];
    $handlers['store_shipping_zone_delete'] = ['WebMaven_Cap_Store_Settings', 'delete_zone'];
    return $handlers;
});

final class WebMaven_Cap_Store_Settings {

    /** Changeable setting => [WooCommerce option, label]. Nothing else is written. */
    const OPTIONS = [
        'currency_position' => ['woocommerce_currency_pos', 'Currency position'],
        'thousand_separator' => ['woocommerce_price_thousand_sep', 'Thousand separator'],
        'decimal_separator' => ['woocommerce_price_decimal_sep', 'Decimal separator'],
        'decimals' => ['woocommerce_price_num_decimals', 'Number of decimals'],
        'taxes_enabled' => ['woocommerce_calc_taxes', 'Taxes'],
        'prices_include_tax' => ['woocommerce_prices_include_tax', 'Prices entered with tax'],
        'tax_display_shop' => ['woocommerce_tax_display_shop', 'Prices shown in the shop'],
        'tax_display_cart' => ['woocommerce_tax_display_cart', 'Prices shown in the cart and checkout'],
        'price_display_suffix' => ['woocommerce_price_display_suffix', 'Price suffix'],
        'store_address' => ['woocommerce_store_address', 'Store address line 1'],
        'store_address_2' => ['woocommerce_store_address_2', 'Store address line 2'],
        'store_city' => ['woocommerce_store_city', 'Store city'],
        'store_postcode' => ['woocommerce_store_postcode', 'Store postcode'],
        'email_from_name' => ['woocommerce_email_from_name', 'Email sender name'],
        'email_from_address' => ['woocommerce_email_from_address', 'Email sender address'],
    ];

    /** Country and state share one WooCommerce option, "US:CA". */
    const COUNTRY_OPTION = 'woocommerce_default_country';

    const POSITIONS = ['left', 'right', 'left_space', 'right_space'];
    const DISPLAY = ['incl', 'excl'];
    const METHOD_TYPES = ['flat_rate', 'free_shipping'];
    const LOCATION_TYPES = ['country', 'state', 'continent', 'postcode'];
    const FREE_REQUIRES = ['', 'coupon', 'min_amount', 'either', 'both'];
    const METHOD_KEYS = ['instance_id', 'type', 'title', 'enabled', 'cost', 'tax_status', 'requires', 'min_amount'];
    const MAX_LOCATIONS = 300;
    const MAX_METHODS = 10;

    // ── Read ────────────────────────────────────────────────────────────────

    /** store_settings_read: every section, each read on its own. */
    public static function read($params = [], $step_id = null) {
        if (!self::woocommerce_active()) {
            return ['woocommerce_active' => false];
        }
        $out = ['woocommerce_active' => true];
        $errors = [];
        foreach (['general', 'tax', 'emails', 'shipping', 'orders'] as $section) {
            try {
                $out[$section] = call_user_func([__CLASS__, 'read_' . $section]);
            } catch (\Throwable $e) {
                $out[$section] = null;
                $errors[$section] = $e->getMessage();
            }
        }
        $out['errors'] = $errors ? $errors : (object) [];
        return $out;
    }

    private static function read_general() {
        list($country, $state) = self::split_country((string) get_option(self::COUNTRY_OPTION, ''));
        return [
            'currency' => (string) get_option('woocommerce_currency', ''),
            'currency_symbol' => function_exists('get_woocommerce_currency_symbol') ? html_entity_decode((string) get_woocommerce_currency_symbol(), ENT_QUOTES, 'UTF-8') : null,
            'currency_position' => (string) get_option('woocommerce_currency_pos', 'left'),
            'thousand_separator' => (string) get_option('woocommerce_price_thousand_sep', ','),
            'decimal_separator' => (string) get_option('woocommerce_price_decimal_sep', '.'),
            'decimals' => (int) get_option('woocommerce_price_num_decimals', 2),
            'store_address' => [
                'address' => (string) get_option('woocommerce_store_address', ''),
                'address_2' => (string) get_option('woocommerce_store_address_2', ''),
                'city' => (string) get_option('woocommerce_store_city', ''),
                'postcode' => (string) get_option('woocommerce_store_postcode', ''),
                'country' => $country,
                'state' => $state,
            ],
            'coupons_enabled' => get_option('woocommerce_enable_coupons', 'yes') === 'yes',
            // '' ships to every country the store sells to; 'disabled' turns shipping off.
            'ship_to_countries' => (string) get_option('woocommerce_ship_to_countries', ''),
            'shipping_enabled' => function_exists('wc_shipping_enabled') ? (bool) wc_shipping_enabled() : get_option('woocommerce_ship_to_countries', '') !== 'disabled',
        ];
    }

    private static function read_tax() {
        global $wpdb;
        return [
            'enabled' => get_option('woocommerce_calc_taxes', 'no') === 'yes',
            'prices_include_tax' => get_option('woocommerce_prices_include_tax', 'no') === 'yes',
            'display_shop' => (string) get_option('woocommerce_tax_display_shop', 'excl'),
            'display_cart' => (string) get_option('woocommerce_tax_display_cart', 'excl'),
            'price_display_suffix' => (string) get_option('woocommerce_price_display_suffix', ''),
            'based_on' => (string) get_option('woocommerce_tax_based_on', 'shipping'),
            'rate_count' => self::tax_rate_count(),
        ];
    }

    private static function read_emails() {
        $emails = [];
        foreach (self::wc_emails() as $email) {
            $customer = method_exists($email, 'is_customer_email') ? (bool) $email->is_customer_email() : false;
            $emails[] = [
                'id' => (string) $email->id,
                'title' => wp_strip_all_tags((string) $email->get_title()),
                'enabled' => self::email_enabled($email),
                'to_customer' => $customer,
                'recipient' => $customer || !method_exists($email, 'get_recipient') ? null : (string) $email->get_recipient(),
            ];
        }
        return [
            'from_name' => (string) get_option('woocommerce_email_from_name', ''),
            'from_address' => (string) get_option('woocommerce_email_from_address', ''),
            'emails' => $emails,
        ];
    }

    private static function read_shipping() {
        $zones = [];
        foreach ((array) WC_Shipping_Zones::get_zones() as $z) {
            $id = is_array($z) ? (int) ($z['id'] ?? $z['zone_id'] ?? 0) : (int) $z->get_id();
            $zone = WC_Shipping_Zones::get_zone($id);
            if ($zone) {
                $zones[] = self::zone_out($zone);
            }
        }
        $rest = WC_Shipping_Zones::get_zone(0);
        return [
            'zones' => $zones,
            'rest_of_world' => $rest ? self::zone_out($rest) : null,
        ];
    }

    private static function read_orders() {
        $by_status = [];
        $total = 0;
        foreach ((array) wc_get_order_statuses() as $key => $label) {
            $n = (int) wc_orders_count($key);
            $total += $n;
            $by_status[] = ['status' => (string) preg_replace('/^wc-/', '', $key), 'label' => (string) $label, 'count' => $n];
        }
        return ['total' => $total, 'by_status' => $by_status];
    }

    // ── Settings change ─────────────────────────────────────────────────────

    /** store_settings_change: allowlisted settings only, all checked before any is written. */
    public static function change($params = [], $step_id = null) {
        if (!self::woocommerce_active()) {
            return self::fail('Nothing was changed: WooCommerce is not active on this site.', 'woocommerce_inactive');
        }
        $changes = isset($params['changes']) && is_array($params['changes']) ? $params['changes'] : null;
        if (!$changes) {
            return self::fail('Nothing was changed: no setting was given.', 'invalid_input');
        }
        // The store currency relabels every price: the Store currency setting
        // changes it, where the owner chooses to keep or convert the prices.
        if (array_key_exists('currency', $changes)) {
            return self::fail(WebMaven_Self_Protect::STORE_CURRENCY_REFUSAL, 'store_currency_setting', ['problems' => [WebMaven_Self_Protect::STORE_CURRENCY_REFUSAL]]);
        }
        list($ops, $problems) = self::plan_changes($changes);
        if ($problems) {
            return self::fail('Nothing was changed: ' . implode('; ', $problems) . '.', 'invalid_input', ['problems' => $problems]);
        }

        $applied = [];
        $unchanged = [];
        $failed = [];
        foreach ($ops as $op) {
            $before = self::op_value($op);
            if ($before === $op['value']) {
                $unchanged[] = ['setting' => $op['setting'], 'label' => $op['label'], 'value' => $before];
                continue;
            }
            try {
                if (isset($op['email'])) {
                    $op['email']->update_option('enabled', $op['value']);
                } else {
                    do_action('woocommerce_update_option', ['id' => $op['option']]);
                    update_option($op['option'], $op['value']);
                }
            } catch (\Throwable $e) {
                $failed[] = ['setting' => $op['setting'], 'label' => $op['label'], 'error' => $e->getMessage()];
                continue;
            }
            $after = self::op_value($op);
            if ($after !== $op['value']) {
                $failed[] = ['setting' => $op['setting'], 'label' => $op['label'], 'error' => 'WooCommerce did not save the new value'];
                continue;
            }
            $applied[] = ['setting' => $op['setting'], 'label' => $op['label'], 'before' => $before, 'after' => $after];
        }
        if ($applied) {
            do_action('woocommerce_update_options');
        }

        $out = [
            'changes' => $applied,
            'unchanged' => $unchanged,
            'failed' => $failed,
            'warnings' => self::warnings($applied),
        ];
        if (!$applied && $failed) {
            return self::fail(
                'Nothing was changed: ' . implode('; ', array_map(function ($f) { return $f['label'] . ': ' . $f['error']; }, $failed)) . '.',
                'not_saved',
                $out
            );
        }
        return $out;
    }

    /** [$ops, $problems]: each op names its option (or email) and the exact value to store. */
    private static function plan_changes(array $changes) {
        $ops = [];
        $problems = [];
        $allowed = array_merge(array_keys(self::OPTIONS), ['store_country', 'store_state', 'emails']);
        foreach ($changes as $key => $value) {
            if (!in_array($key, $allowed, true)) {
                $problems[] = '"' . $key . '" cannot be changed here';
                continue;
            }
            if ($key === 'store_country' || $key === 'store_state' || $key === 'emails') {
                continue;
            }
            $v = self::normalize($key, $value);
            if (is_array($v)) {
                $problems[] = $v['problem'];
                continue;
            }
            $ops[] = ['setting' => $key, 'label' => self::OPTIONS[$key][1], 'option' => self::OPTIONS[$key][0], 'value' => $v];
        }

        // Separators are checked together, on what the store will end up with.
        $values = array_column($ops, 'value', 'setting');
        $decimal = array_key_exists('decimal_separator', $values) ? $values['decimal_separator'] : (string) get_option('woocommerce_price_decimal_sep', '.');
        $thousand = array_key_exists('thousand_separator', $values) ? $values['thousand_separator'] : (string) get_option('woocommerce_price_thousand_sep', ',');
        if ((array_key_exists('decimal_separator', $values) || array_key_exists('thousand_separator', $values)) && $thousand !== '' && $decimal === $thousand) {
            $problems[] = 'the decimal and thousand separators cannot be the same';
        }

        if (array_key_exists('store_country', $changes) || array_key_exists('store_state', $changes)) {
            list($cur_country, $cur_state) = self::split_country((string) get_option(self::COUNTRY_OPTION, ''));
            $country = array_key_exists('store_country', $changes) ? strtoupper(trim((string) $changes['store_country'])) : $cur_country;
            // A new country drops the old state unless a state is given.
            $state = array_key_exists('store_state', $changes)
                ? strtoupper(trim((string) $changes['store_state']))
                : ($country === $cur_country ? $cur_state : '');
            $countries = (array) WC()->countries->get_countries();
            if (!isset($countries[$country])) {
                $problems[] = '"' . $country . '" is not a country WooCommerce knows';
            } else {
                $states = WC()->countries->get_states($country);
                if ($state !== '' && (!is_array($states) || !isset($states[$state]))) {
                    $problems[] = '"' . $state . '" is not a state or province of ' . $countries[$country];
                } else {
                    $ops[] = ['setting' => 'store_country', 'label' => 'Store country and state', 'option' => self::COUNTRY_OPTION, 'value' => $state !== '' ? $country . ':' . $state : $country];
                }
            }
        }

        if (array_key_exists('emails', $changes)) {
            if (!is_array($changes['emails']) || !$changes['emails']) {
                $problems[] = 'emails must name each email with true (on) or false (off)';
            } else {
                $known = [];
                foreach (self::wc_emails() as $email) {
                    $known[(string) $email->id] = $email;
                }
                foreach ($changes['emails'] as $id => $on) {
                    if (!isset($known[$id])) {
                        $problems[] = '"' . $id . '" is not one of the store\'s emails (' . implode(', ', array_keys($known)) . ')';
                        continue;
                    }
                    $flag = self::yes_no($on);
                    if ($flag === null) {
                        $problems[] = 'the email "' . $id . '" must be true (on) or false (off)';
                        continue;
                    }
                    $ops[] = ['setting' => 'emails.' . $id, 'label' => 'Email: ' . wp_strip_all_tags((string) $known[$id]->get_title()), 'email' => $known[$id], 'value' => $flag];
                }
            }
        }
        return [$ops, $problems];
    }

    /** The stored value for one setting, or ['problem' => ...]. */
    private static function normalize($key, $value) {
        $label = self::OPTIONS[$key][1];
        switch ($key) {
            case 'currency_position':
                return in_array($value, self::POSITIONS, true) ? $value : ['problem' => 'the currency position must be one of ' . implode(', ', self::POSITIONS)];
            case 'thousand_separator':
                return is_string($value) && self::mb_len($value) <= 2 && !preg_match('/[\p{L}\p{N}]/u', $value)
                    ? $value : ['problem' => 'the thousand separator must be empty or one or two symbols, like "," or "."'];
            case 'decimal_separator':
                return is_string($value) && self::mb_len($value) === 1 && !preg_match('/[\p{L}\p{N}]/u', $value)
                    ? $value : ['problem' => 'the decimal separator must be one symbol, like "." or ","'];
            case 'decimals':
                return (is_int($value) || (is_string($value) && ctype_digit($value))) && (int) $value >= 0 && (int) $value <= 4
                    ? (string) (int) $value : ['problem' => 'the number of decimals must be a whole number from 0 to 4'];
            case 'taxes_enabled':
            case 'prices_include_tax':
                $flag = self::yes_no($value);
                return $flag !== null ? $flag : ['problem' => strtolower($label) . ' must be true or false'];
            case 'tax_display_shop':
            case 'tax_display_cart':
                return in_array($value, self::DISPLAY, true) ? $value : ['problem' => strtolower($label) . ' must be "incl" or "excl"'];
            case 'email_from_address':
                $email = is_string($value) ? sanitize_email(trim($value)) : '';
                return $email !== '' && is_email($email) ? $email : ['problem' => 'the email sender address is not a valid email address'];
            case 'email_from_name':
                $name = is_string($value) ? trim(sanitize_text_field($value)) : '';
                return $name !== '' && self::mb_len($name) <= 100 ? $name : ['problem' => 'the email sender name must be 1 to 100 characters'];
            default:
                // Free text: price suffix and the store address lines.
                $max = $key === 'store_postcode' ? 20 : ($key === 'price_display_suffix' ? 100 : 200);
                if (!is_string($value) || self::mb_len($value) > $max) {
                    return ['problem' => strtolower($label) . " must be text of at most $max characters"];
                }
                return trim(sanitize_text_field($value));
        }
    }

    private static function op_value(array $op) {
        if (isset($op['email'])) {
            $stored = get_option($op['email']->get_option_key(), null);
            if (is_array($stored) && isset($stored['enabled'])) {
                return (string) $stored['enabled'];
            }
            return self::email_enabled($op['email']) ? 'yes' : 'no';
        }
        $v = get_option($op['option'], null);
        return $v === null || $v === false ? '' : (string) $v;
    }

    /** What the owner should know about a change that went through. */
    private static function warnings(array $applied) {
        $out = [];
        foreach ($applied as $c) {
            switch ($c['setting']) {
                case 'prices_include_tax':
                    $out[] = 'Product prices were not recalculated: the same numbers are now read as prices ' . ($c['after'] === 'yes' ? 'including' : 'excluding') . ' tax.';
                    break;
                case 'taxes_enabled':
                    if ($c['after'] === 'yes' && self::tax_rate_count() === 0) {
                        $out[] = 'Taxes are on, but the store has no tax rate yet, so no tax is charged. Add rates in WooCommerce > Settings > Tax.';
                    }
                    break;
                default:
                    if (strpos($c['setting'], 'emails.') === 0 && $c['after'] === 'no') {
                        $out[] = substr($c['label'], 7) . ' is no longer sent.';
                    }
            }
        }
        return $out;
    }

    // ── Shipping zones ──────────────────────────────────────────────────────

    /** store_shipping_zone_save: create a zone, or change one; flat rate and free shipping only. */
    public static function save_zone($params = [], $step_id = null) {
        if (!self::woocommerce_active()) {
            return self::fail('Nothing was changed: WooCommerce is not active on this site.', 'woocommerce_inactive');
        }
        $problems = [];
        $creating = !isset($params['zone_id']) || $params['zone_id'] === null || $params['zone_id'] === '';
        $zone = null;
        if (!$creating) {
            if (!is_numeric($params['zone_id']) || (int) $params['zone_id'] < 0) {
                return self::fail('Nothing was changed: the zone id is not valid.', 'invalid_input');
            }
            $zone = WC_Shipping_Zones::get_zone((int) $params['zone_id']);
            if (!$zone) {
                return self::fail('Nothing was changed: shipping zone ' . (int) $params['zone_id'] . ' does not exist.', 'unknown_zone');
            }
        }
        $zone_id = $zone ? (int) $zone->get_id() : null;
        $rest_of_world = $zone_id === 0;

        // Name.
        $name = null;
        if (array_key_exists('name', $params) && $params['name'] !== null) {
            $name = is_string($params['name']) ? trim(sanitize_text_field($params['name'])) : '';
            if ($name === '' || self::mb_len($name) > 200) {
                $problems[] = 'the zone name must be 1 to 200 characters';
            }
            if ($rest_of_world) {
                $problems[] = 'the zone for locations not covered by other zones cannot be renamed';
            }
        } elseif ($creating) {
            $problems[] = 'a new zone needs a name';
        }

        // Locations: the list given replaces the zone's list.
        $locations = null;
        if (array_key_exists('locations', $params) && $params['locations'] !== null) {
            if ($rest_of_world) {
                $problems[] = 'the zone for locations not covered by other zones has no locations of its own';
            } elseif (!is_array($params['locations']) || count($params['locations']) > self::MAX_LOCATIONS) {
                $problems[] = 'locations must be a list of at most ' . self::MAX_LOCATIONS;
            } else {
                $locations = [];
                foreach (array_values($params['locations']) as $loc) {
                    $checked = self::check_location($loc);
                    if (is_string($checked)) {
                        $problems[] = $checked;
                    } else {
                        $locations[] = $checked;
                    }
                }
            }
        }

        // Methods.
        $existing = [];
        if ($zone) {
            foreach ((array) $zone->get_shipping_methods(false) as $instance_id => $m) {
                $existing[(int) $m->instance_id] = $m;
            }
        }
        $remove = [];
        foreach ((array) ($params['remove_method_ids'] ?? []) as $rid) {
            $rid = is_numeric($rid) ? (int) $rid : 0;
            if (!isset($existing[$rid])) {
                $problems[] = "method $rid is not in this zone";
            } elseif (!in_array($existing[$rid]->id, self::METHOD_TYPES, true)) {
                $problems[] = "method $rid is " . $existing[$rid]->id . ', and only flat rate and free shipping methods can be removed here';
            } else {
                $remove[] = $rid;
            }
        }
        $methods = [];
        $given = isset($params['methods']) ? $params['methods'] : [];
        if (!is_array($given) || count($given) > self::MAX_METHODS) {
            $problems[] = 'methods must be a list of at most ' . self::MAX_METHODS;
            $given = [];
        }
        foreach (array_values($given) as $i => $m) {
            $checked = self::check_method($m, $i + 1, $existing, $remove);
            if (is_string($checked)) {
                $problems[] = $checked;
            } else {
                $methods[] = $checked;
            }
        }
        if (!$creating && $name === null && $locations === null && !$methods && !$remove) {
            $problems[] = 'nothing to change was given';
        }
        if ($problems) {
            return self::fail('Nothing was changed: ' . implode('; ', $problems) . '.', 'invalid_input', ['problems' => $problems]);
        }

        // Write.
        $before = $zone ? self::zone_out($zone) : null;
        $done = [];
        $failed = [];
        if ($creating) {
            $zone = new WC_Shipping_Zone();
        }
        if ($name !== null || $locations !== null || $creating) {
            if ($name !== null) {
                $zone->set_zone_name($name);
            }
            if ($locations !== null) {
                $zone->set_locations($locations);
            }
            $zone->save();
            $zone_id = (int) $zone->get_id();
            if ($creating && !$zone_id) {
                return self::fail('The shipping zone was not created: WooCommerce did not save it.', 'not_saved');
            }
            $done[] = $creating ? 'created the zone' : 'saved the zone name and locations';
        }
        if ($remove) {
            foreach ($remove as $rid) {
                $zone->delete_shipping_method($rid);
            }
            // Read back: WooCommerce answers true whether or not a row went.
            $left = [];
            $check = WC_Shipping_Zones::get_zone($zone_id);
            foreach ($check ? (array) $check->get_shipping_methods(false) : [] as $x) {
                $left[] = (int) $x->instance_id;
            }
            foreach ($remove as $rid) {
                if (in_array($rid, $left, true)) {
                    $failed[] = "method $rid was not removed";
                } else {
                    $done[] = "removed method $rid";
                }
            }
        }
        foreach ($methods as $m) {
            $instance_id = $m['instance_id'];
            if (!$instance_id) {
                $instance_id = (int) $zone->add_shipping_method($m['type']);
                if (!$instance_id) {
                    $failed[] = 'a ' . str_replace('_', ' ', $m['type']) . ' method was not added';
                    continue;
                }
                $done[] = 'added a ' . str_replace('_', ' ', $m['type']) . " method ($instance_id)";
            }
            $error = self::apply_method($zone, $instance_id, $m);
            if ($error !== null) {
                $failed[] = $error;
            } elseif ($m['instance_id']) {
                $done[] = "updated method $instance_id";
            }
        }
        if (class_exists('WC_Cache_Helper') && method_exists('WC_Cache_Helper', 'get_transient_version')) {
            WC_Cache_Helper::get_transient_version('shipping', true);
        }

        $fresh = WC_Shipping_Zones::get_zone($zone_id);
        $after = $fresh ? self::zone_out($fresh) : null;
        $warnings = [];
        if ($after && !$rest_of_world && !$after['locations']) {
            $warnings[] = 'This zone has no locations yet, so no customer is matched to it.';
        }
        if ($after && !array_filter($after['methods'], function ($m) { return $m['enabled']; })) {
            $warnings[] = 'This zone has no enabled shipping method, so customers in it cannot check out with shipping.';
        }
        $out = [
            'created' => $creating,
            'zone_id' => $zone_id,
            'before' => $before,
            'after' => $after,
            'done' => $done,
            'failed' => $failed,
            'warnings' => $warnings,
        ];
        if (!$done && $failed) {
            return self::fail('Nothing was changed: ' . implode('; ', $failed) . '.', 'not_saved', $out);
        }
        return $out;
    }

    /** store_shipping_zone_delete: the zone, its locations and its methods. */
    public static function delete_zone($params = [], $step_id = null) {
        if (!self::woocommerce_active()) {
            return self::fail('Nothing was changed: WooCommerce is not active on this site.', 'woocommerce_inactive');
        }
        $id = isset($params['zone_id']) && is_numeric($params['zone_id']) ? (int) $params['zone_id'] : -1;
        if ($id === 0) {
            return self::fail('Nothing was changed: the zone for locations not covered by other zones cannot be deleted.', 'invalid_input');
        }
        $zone = $id > 0 ? WC_Shipping_Zones::get_zone($id) : false;
        if (!$zone) {
            return self::fail('Nothing was changed: shipping zone ' . max($id, 0) . ' does not exist.', 'unknown_zone');
        }
        $before = self::zone_out($zone);
        $zone->delete(true);
        if (WC_Shipping_Zones::get_zone($id)) {
            return self::fail("The shipping zone was not deleted: WooCommerce still lists zone $id.", 'not_saved', ['before' => $before]);
        }
        if (class_exists('WC_Cache_Helper') && method_exists('WC_Cache_Helper', 'get_transient_version')) {
            WC_Cache_Helper::get_transient_version('shipping', true);
        }
        return ['deleted' => true, 'zone_id' => $id, 'before' => $before, 'after' => null];
    }

    /** ['type' => ..., 'code' => ...] or the problem. */
    private static function check_location($loc) {
        if (!is_array($loc) || !isset($loc['type'], $loc['code']) || !is_string($loc['type']) || !is_string($loc['code'])) {
            return 'each location needs a type and a code';
        }
        $type = $loc['type'];
        $code = trim($loc['code']);
        switch ($type) {
            case 'country':
                $code = strtoupper($code);
                $countries = (array) WC()->countries->get_countries();
                return isset($countries[$code]) ? ['type' => 'country', 'code' => $code] : '"' . $code . '" is not a country WooCommerce knows';
            case 'state':
                $code = strtoupper($code);
                $parts = explode(':', $code);
                $states = count($parts) === 2 ? WC()->countries->get_states($parts[0]) : null;
                return is_array($states) && isset($states[$parts[1]]) ? ['type' => 'state', 'code' => $code] : '"' . $code . '" is not a state WooCommerce knows (use COUNTRY:STATE, like US:CA)';
            case 'continent':
                $code = strtoupper($code);
                $continents = (array) WC()->countries->get_continents();
                return isset($continents[$code]) ? ['type' => 'continent', 'code' => $code] : '"' . $code . '" is not a continent code WooCommerce knows';
            case 'postcode':
                return preg_match('/^[A-Za-z0-9 \-\*\.]{1,32}$/', $code) ? ['type' => 'postcode', 'code' => strtoupper($code)] : '"' . $code . '" is not a postcode pattern';
        }
        return 'a location type must be one of ' . implode(', ', self::LOCATION_TYPES);
    }

    /** The checked method, or the problem. */
    private static function check_method($m, $n, array $existing, array $remove) {
        if (!is_array($m)) {
            return "method $n is not an object";
        }
        foreach (array_keys($m) as $k) {
            if (!in_array($k, self::METHOD_KEYS, true)) {
                return "method $n: \"$k\" cannot be set here";
            }
        }
        $instance_id = isset($m['instance_id']) && $m['instance_id'] !== null ? (is_numeric($m['instance_id']) ? (int) $m['instance_id'] : -1) : 0;
        if ($instance_id) {
            if (!isset($existing[$instance_id])) {
                return "method $instance_id is not in this zone";
            }
            if (in_array($instance_id, $remove, true)) {
                return "method $instance_id cannot be both changed and removed";
            }
            $type = $existing[$instance_id]->id;
            if (!in_array($type, self::METHOD_TYPES, true)) {
                return "method $instance_id is $type, and only flat rate and free shipping methods can be changed here";
            }
            if (isset($m['type']) && $m['type'] !== $type) {
                return "method $instance_id is $type, so its type cannot be changed to " . (is_string($m['type']) ? $m['type'] : '?');
            }
        } else {
            $type = isset($m['type']) && is_string($m['type']) ? $m['type'] : '';
            if (!in_array($type, self::METHOD_TYPES, true)) {
                return "method $n: the type must be flat_rate or free_shipping";
            }
        }
        $out = ['instance_id' => $instance_id, 'type' => $type, 'settings' => [], 'enabled' => null];
        if (array_key_exists('title', $m)) {
            $title = is_string($m['title']) ? trim(sanitize_text_field($m['title'])) : '';
            if ($title === '' || self::mb_len($title) > 100) {
                return "method $n: the title must be 1 to 100 characters";
            }
            $out['settings']['title'] = $title;
        }
        if (array_key_exists('enabled', $m)) {
            if (!is_bool($m['enabled'])) {
                return "method $n: enabled must be true or false";
            }
            $out['enabled'] = $m['enabled'];
        }
        if ($type === 'flat_rate') {
            foreach (['requires', 'min_amount'] as $k) {
                if (array_key_exists($k, $m)) {
                    return "method $n: $k belongs to free shipping, not flat rate";
                }
            }
            if (array_key_exists('cost', $m)) {
                $cost = self::amount($m['cost']);
                if ($cost === null) {
                    return "method $n: the cost must be a plain amount from 0 to 1000000, like 4.95";
                }
                $out['settings']['cost'] = $cost;
            } elseif (!$instance_id) {
                return "method $n: a flat rate needs a cost";
            }
            if (array_key_exists('tax_status', $m)) {
                if (!in_array($m['tax_status'], ['taxable', 'none'], true)) {
                    return "method $n: tax_status must be taxable or none";
                }
                $out['settings']['tax_status'] = $m['tax_status'];
            }
        } else {
            foreach (['cost', 'tax_status'] as $k) {
                if (array_key_exists($k, $m)) {
                    return "method $n: $k belongs to flat rate, not free shipping";
                }
            }
            if (array_key_exists('requires', $m)) {
                if (!in_array($m['requires'], self::FREE_REQUIRES, true)) {
                    return "method $n: requires must be one of \"\", coupon, min_amount, either, both";
                }
                $out['settings']['requires'] = $m['requires'];
            }
            if (array_key_exists('min_amount', $m)) {
                $min = self::amount($m['min_amount']);
                if ($min === null) {
                    return "method $n: the minimum order amount must be a plain amount from 0 to 1000000";
                }
                $out['settings']['min_amount'] = $min;
            }
        }
        return $out;
    }

    /** Settings and on/off for one method, read back. Null when it all went through. */
    private static function apply_method($zone, $instance_id, array $m) {
        $method = WC_Shipping_Zones::get_shipping_method($instance_id);
        if (!$method) {
            return "method $instance_id could not be loaded";
        }
        if ($m['settings']) {
            $method->init_instance_settings();
            $settings = is_array($method->instance_settings) ? $method->instance_settings : [];
            foreach ($m['settings'] as $k => $v) {
                $settings[$k] = $v;
            }
            $key = $method->get_instance_option_key();
            update_option($key, apply_filters('woocommerce_shipping_' . $method->id . '_instance_settings_values', $settings, $method), 'yes');
            $stored = get_option($key, []);
            foreach ($m['settings'] as $k => $v) {
                if (!is_array($stored) || !isset($stored[$k]) || (string) $stored[$k] !== (string) $v) {
                    return "method $instance_id: WooCommerce did not save $k";
                }
            }
        }
        if ($m['enabled'] !== null) {
            global $wpdb;
            $wpdb->update(
                $wpdb->prefix . 'woocommerce_shipping_zone_methods',
                ['is_enabled' => $m['enabled'] ? 1 : 0],
                ['instance_id' => absint($instance_id)]
            );
            do_action('woocommerce_shipping_zone_method_status_toggled', $instance_id, $method->id, $zone->get_id(), $m['enabled']);
            $check = WC_Shipping_Zones::get_zone((int) $zone->get_id());
            $now = null;
            foreach ($check ? (array) $check->get_shipping_methods(false) : [] as $x) {
                if ((int) $x->instance_id === (int) $instance_id) {
                    $now = $x->is_enabled();
                }
            }
            if ($now !== $m['enabled']) {
                return "method $instance_id was not turned " . ($m['enabled'] ? 'on' : 'off');
            }
        }
        return null;
    }

    public static function zone_out($zone) {
        $locations = [];
        foreach ((array) $zone->get_zone_locations() as $l) {
            $locations[] = ['type' => (string) $l->type, 'code' => (string) $l->code];
        }
        $methods = [];
        foreach ((array) $zone->get_shipping_methods(false) as $m) {
            $row = [
                'instance_id' => (int) $m->instance_id,
                'type' => (string) $m->id,
                'title' => (string) $m->get_title(),
                'enabled' => (bool) $m->is_enabled(),
            ];
            if ($m->id === 'flat_rate') {
                $row['cost'] = (string) $m->get_option('cost');
                $row['tax_status'] = (string) $m->get_option('tax_status');
            } elseif ($m->id === 'free_shipping') {
                $row['requires'] = (string) $m->get_option('requires');
                $row['min_amount'] = (string) $m->get_option('min_amount');
            }
            $methods[] = $row;
        }
        return [
            'id' => (int) $zone->get_id(),
            'name' => (string) $zone->get_zone_name(),
            'order' => (int) $zone->get_zone_order(),
            'locations' => $locations,
            'methods' => $methods,
        ];
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private static function woocommerce_active() {
        return class_exists('WooCommerce') && function_exists('WC');
    }

    /** Every email WooCommerce sends, by its object. */
    private static function wc_emails() {
        $mailer = WC()->mailer();
        return $mailer ? array_values((array) $mailer->get_emails()) : [];
    }

    private static function email_enabled($email) {
        return method_exists($email, 'is_enabled') ? (bool) $email->is_enabled() : ($email->enabled ?? 'no') === 'yes';
    }

    private static function tax_rate_count() {
        global $wpdb;
        return (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->prefix}woocommerce_tax_rates");
    }

    private static function split_country($value) {
        $parts = explode(':', $value, 2);
        return [(string) $parts[0], isset($parts[1]) ? (string) $parts[1] : ''];
    }

    private static function yes_no($value) {
        if ($value === true || $value === 'yes') {
            return 'yes';
        }
        if ($value === false || $value === 'no') {
            return 'no';
        }
        return null;
    }

    /** A plain non-negative amount as WooCommerce stores it ("4.95"), or null. */
    private static function amount($value) {
        if (is_int($value) || is_float($value)) {
            $value = (string) $value;
        }
        if (!is_string($value) || !preg_match('/^\d{1,7}(\.\d{1,4})?$/', trim($value))) {
            return null;
        }
        $n = (float) $value;
        return $n <= 1000000 ? trim($value) : null;
    }

    private static function mb_len($s) {
        return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : strlen($s);
    }

    private static function fail($error, $code, array $extra = []) {
        return array_merge($extra, ['success' => false, 'error' => $error, 'code' => $code]);
    }
}
