<?php
/**
 * Store currency (2026-09-30): the plugin side of the business's Store
 * currency setting in the WPMaven dashboard, and of the first build's
 * currency.
 *
 * A store sells in its owner's currency, and the owner can change it. WooCommerce has ONE currency per store and keeps every
 * price as a plain number, so changing the currency relabels every price in
 * the store. The currency therefore changes here only, and only the way the
 * owner chose. Contract, as the API reads it (results arrive wrapped in
 * response.data.data):
 *
 *   store_currency_read {include_prices?: bool}
 *     -> {woocommerce_active: false}
 *     -> {woocommerce_active: true, currency, symbol, decimals,
 *         counts: {products, prices, fixed_coupons, shipping_costs},
 *         other_product_types, truncated,
 *         prices, coupons, shipping}            (the lists with include_prices)
 *   store_currency_set {to, from?, mode, decimals, from_decimals?, rows?,
 *                       plugin_currency?}
 *     mode initial  the build's first set: only on a store without products
 *     mode keep     the currency changes and every number stays (no rows;
 *                   rows that name no value are read as none)
 *     mode convert  the numbers the API converted (rows), then the currency
 *                   (a row whose value is empty and stays empty is left out)
 *     -> {changed, mode, currency_before, currency_after, decimals_before,
 *         decimals_after, converted: {prices, coupons, shipping},
 *         plugin_currency?}
 *
 * Plugins with a currency of their own (1.2.15, class-webmaven-plugin-
 * currency.php): a booking calendar, a room booking, an online ordering, a
 * donation, a course or an event plugin keeps its own currency and its
 * prices as plain numbers. After every set that went through, each one
 * running on the site follows the store currency, and the answer says how
 * (plugin_currency, only when one runs here, so every other answer keeps its
 * shape). The reads say what they hold (plugins, only when one runs here):
 * the plain read each one's currency and whether it holds prices; the read
 * with include_prices also up to 10 of its prices, how many balances
 * customers still owe in it, and its payment methods that are on with the
 * store currencies each takes. A plugin that holds prices
 * follows only with Keep and plugin_currency: 'follow' (the owner saw them
 * in the dialog); with Convert it keeps its currency, since its prices
 * cannot be converted here. A refusal writes nothing, plugins included.
 *
 * The money values of a store: the regular and sale prices of simple and
 * external products and of the variations of variable products (any status
 * but trash and auto-draft); the amount of fixed-amount coupons and the
 * minimum and maximum spend of every coupon (a percent coupon's 15% stays
 * 15%, its "over $50" is money); the cost, class costs and no-class cost of
 * flat rate shipping, the cost of local pickup and the minimum order amount
 * of free shipping. A shipping cost that is a formula ("10 + [qty]") is
 * listed, never converted, and so is a cost of any other shipping method
 * (its settings are that method's own): not_convertible names them, so the
 * owner is told they keep their numbers either way.
 *
 * One change at a time (1.2.15). Keep and Convert hold the store's change
 * lock for their whole run (a MySQL named lock, released by the database
 * when the process ends, however it ends; an option with a heartbeat where
 * the database has none), and a second one is refused with
 * change_in_progress. A Convert writes its journal (every value before and
 * after) before its first write and deletes it after its last. A Convert
 * whose process was killed (a host's time limit, memory) leaves the journal
 * behind with no lock held: the next read or set, or the scheduled check,
 * puts back every value that still holds its converted number before
 * anything else runs, so a retry never converts a price twice. While a
 * Convert is being written (or waits to be put back), checkout waits, so no
 * shopper pays a converted number under the old currency. The read says
 * whether a change is running (change) and how the last one ended (last).
 *
 * A refusal RETURNS {success: false, error, code, ...} and writes nothing.
 * Every other way to write woocommerce_currency (the option tools, WP-CLI,
 * store_settings_change, the plugin bridge, a product's price string) is
 * refused with WebMaven_Self_Protect::STORE_CURRENCY_REFUSAL.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once dirname(__DIR__) . '/class-webmaven-log.php';

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['store_currency_read'] = ['WebMaven_Cap_Store_Currency', 'read'];
    $handlers['store_currency_set'] = ['WebMaven_Cap_Store_Currency', 'set'];
    return $handlers;
});

// Shoppers never pay a converted number under the old currency: checkout
// waits while a Convert is being written (classic checkout and the block
// checkout's Store API), and a Convert that died partway is put back by the
// scheduled check when nobody opens the dashboard.
if (function_exists('add_action')) {
    add_action('woocommerce_after_checkout_validation', ['WebMaven_Cap_Store_Currency', 'hold_classic_checkout'], 10, 2);
    add_action('woocommerce_store_api_checkout_update_order_from_request', ['WebMaven_Cap_Store_Currency', 'hold_store_api_checkout'], 10, 2);
    add_action('webmaven_store_currency_recover', ['WebMaven_Cap_Store_Currency', 'recover_scheduled']);
}

final class WebMaven_Cap_Store_Currency {

    /** Most money values one conversion covers (and a read lists). */
    const MAX_VALUES = 2000;

    /**
     * Most rows a conversion may send, empty ones included: every field of
     * every row a read lists (a coupon has three) is at most 3 x MAX_VALUES.
     * Past it the rows are not read at all.
     */
    const MAX_ROWS_SENT = 6000;

    const MODES = ['initial', 'keep', 'convert'];

    /** WooCommerce's own product types. Any other type (a subscription, a bundle) blocks Convert. */
    const KNOWN_TYPES = ['simple', 'variable', 'variation', 'grouped', 'external'];

    /** Product types whose own post carries the price (a variable product's variations carry theirs). */
    const PRICED_TYPES = ['simple', 'external'];

    const FIXED_COUPON_TYPES = ['fixed_cart', 'fixed_product'];

    /** Price field => the product meta WooCommerce stores it in. */
    const PRICE_META = ['regular' => '_regular_price', 'sale' => '_sale_price'];

    /** Coupon field => the coupon meta WooCommerce stores it in. */
    const COUPON_META = ['amount' => 'coupon_amount', 'minimum_amount' => 'minimum_amount', 'maximum_amount' => 'maximum_amount'];

    /** Shipping methods whose money settings are converted (flat_rate: cost and class costs; free_shipping: minimum; local_pickup: cost). */
    const SHIPPING_METHODS = ['flat_rate', 'free_shipping', 'local_pickup'];

    /** A setting of another shipping method that looks like money: listed as not convertible, never written. */
    const OTHER_MONEY_SETTING = '/(?:^|_)(?:cost|costs|fee|fees|price|amount|min_amount|max_amount)(?:_|$)/';

    const SKIPPED_STATUSES = ['trash', 'auto-draft'];

    /** Every value a running Convert writes, before and after (autoload no). */
    const JOURNAL_OPTION = 'webmaven_store_currency_journal';

    /** The change that holds the lock: token, to, from, mode, started, heartbeat. */
    const LOCK_OPTION = 'webmaven_store_currency_lock';

    /** How the last Keep or Convert ended, for the API to read after it stopped waiting. */
    const LAST_OPTION = 'webmaven_store_currency_last';

    /** Without named locks, a lock whose heartbeat is older than this belongs to a process that died. */
    const LOCK_STALE_SECONDS = 120;

    /** The scheduled check that puts back a Convert that died partway. */
    const RECOVER_HOOK = 'webmaven_store_currency_recover';

    /** What a shopper reads at checkout while a Convert is being written. */
    const CHECKOUT_HOLD = 'This store is updating its prices right now. Please try again in a minute.';

    /** Held by this request: 'db' (a named lock), 'option' (the heartbeat option), or null. */
    private static $lock_held = null;

    /** The lock record this request wrote (LOCK_OPTION). */
    private static $lock_record = null;

    /** A converted value as WooCommerce stores it: "24.99", "4290". */
    const AMOUNT = '/^\d{1,9}(\.\d{1,4})?$/';

    /** A shipping cost that is a plain number, not a formula. */
    const PLAIN_NUMBER = '/^\d+(\.\d+)?$/';

    /** Post ids per meta query. */
    const CHUNK = 500;

    // ── Read ────────────────────────────────────────────────────────────────

    /**
     * store_currency_read: the store's currency, its decimals and its money
     * values. Without include_prices the counts come from COUNT queries (no
     * product row is loaded); with it every value is listed, up to 2,000. A
     * Convert that died partway is put back first (recovered says so).
     */
    public static function read($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        if (!self::woocommerce_active()) {
            return ['woocommerce_active' => false];
        }
        $recovered = self::recover_dead_run();
        $with_values = !empty($params['include_prices']);
        $inv = $with_values ? self::inventory(self::MAX_VALUES) : self::quick_counts();
        $currency = self::stored_currency();
        $out = [
            'woocommerce_active' => true,
            'currency' => $currency,
            'symbol' => self::symbol($currency),
            'decimals' => self::stored_decimals(),
            'counts' => [
                'products' => $inv['products'],
                'prices' => $inv['price_values'],
                'fixed_coupons' => $inv['fixed_coupons'],
                'shipping_costs' => $inv['shipping_values'],
                'coupons' => $inv['coupons_with_values'],
                'coupon_values' => $inv['coupon_values'],
                'other_values' => $inv['other_values'],
            ],
            'other_product_types' => $inv['other_types'],
            'truncated' => $inv['total'] > self::MAX_VALUES,
            'not_convertible' => array_slice($inv['not_convertible'], 0, 50),
            'change' => self::running_change(),
            'last' => self::last_change(),
        ];
        if ($recovered !== null) {
            $out['recovered'] = $recovered;
        }
        // The plugins with a currency of their own, only when one runs here.
        if (class_exists('WebMaven_Plugin_Currency')) {
            $plugins = $with_values ? WebMaven_Plugin_Currency::details() : WebMaven_Plugin_Currency::summary();
            if ($plugins) {
                $out['plugins'] = $plugins;
            }
        }
        if ($with_values) {
            $out['prices'] = $inv['prices'];
            $out['coupons'] = $inv['coupons'];
            $out['shipping'] = $inv['shipping'];
        }
        return $out;
    }

    // ── Set ─────────────────────────────────────────────────────────────────

    /** store_currency_set: everything is checked before anything is written. */
    public static function set($params = [], $step_id = null) {
        if (!self::woocommerce_active()) {
            return self::fail('Nothing was changed: WooCommerce is not active on this site.', 'woocommerce_inactive');
        }
        $params = is_array($params) ? $params : [];
        $mode = isset($params['mode']) && is_string($params['mode']) ? $params['mode'] : '';
        if (!in_array($mode, self::MODES, true)) {
            return self::fail('Nothing was changed: the mode must be initial, keep or convert.', 'invalid_input');
        }
        $to = isset($params['to']) && is_string($params['to']) ? strtoupper(trim($params['to'])) : '';
        $known = function_exists('get_woocommerce_currencies') ? (array) get_woocommerce_currencies() : [];
        if ($to === '' || !isset($known[$to])) {
            $named = isset($params['to']) && is_scalar($params['to']) ? (string) $params['to'] : '';
            return self::fail('Nothing was changed: "' . $named . '" is not a currency WooCommerce knows.', 'unknown_currency');
        }
        $decimals = self::whole_decimals($params['decimals'] ?? null);
        if ($decimals === null) {
            return self::fail('Nothing was changed: the number of decimals must be a whole number from 0 to 4.', 'invalid_input');
        }

        // One change at a time, and never on top of a Convert that died
        // partway: that one is put back first, so its converted numbers are
        // never read as the store's own and converted again.
        $running = self::running_change();
        if ($running !== null) {
            return self::fail('Nothing was changed: a currency change for this store is already running.', 'change_in_progress', ['change' => $running]);
        }
        self::recover_dead_run();

        $current = self::stored_currency();
        $decimals_before = self::stored_decimals();
        if ($mode === 'initial') {
            return self::set_initial($to, $decimals, $current, $decimals_before);
        }
        // A plugin with a currency of its own that holds prices follows a Keep
        // only when the owner saw those prices (the API's dialog lists them).
        $plugin_consent = isset($params['plugin_currency']) && $params['plugin_currency'] === 'follow';

        // Keep and Convert start from the currency the owner saw.
        if (!isset($params['from']) || !is_string($params['from'])) {
            return self::fail('Nothing was changed: the currency the store sells in now (from) is required.', 'invalid_input');
        }
        $from_decimals = self::whole_decimals($params['from_decimals'] ?? null);
        if ($from_decimals === null) {
            return self::fail('Nothing was changed: the decimals of the currency the store sells in now (from_decimals) must be a whole number from 0 to 4.', 'invalid_input');
        }
        $from = strtoupper(trim($params['from']));
        if ($from !== $current) {
            return self::fail(
                'Nothing was changed: the store sells in ' . ($current !== '' ? $current : 'no currency') . ' now, not ' . ($from !== '' ? $from : 'no currency') . '.',
                'currency_changed',
                ['current' => $current]
            );
        }
        $rows = array_key_exists('rows', $params) ? $params['rows'] : null;
        // Keep writes no number, so it takes no rows. Rows that name no value
        // at all (an empty list, or lists that are all empty) are read as none.
        if ($mode === 'keep' && !self::rows_are_empty($rows)) {
            return self::fail('Nothing was changed: prices are sent only to convert them, and keep leaves every number as it is.', 'invalid_input');
        }
        if ($to === $current) {
            // Nothing to change, so nothing is written (rows included).
            return self::result(false, $mode, $current, $current, $decimals_before, $decimals_before, self::none_converted());
        }
        $change = [
            'token' => self::token_param($params['token'] ?? null),
            'to' => $to,
            'from' => $current,
            'mode' => $mode,
            'rate' => isset($params['rate']) && is_numeric($params['rate']) && (float) $params['rate'] > 0 ? (float) $params['rate'] : null,
            'rate_date' => isset($params['rate_date']) && is_string($params['rate_date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $params['rate_date']) ? $params['rate_date'] : null,
        ];
        if (!self::lock_acquire($change)) {
            return self::fail('Nothing was changed: a currency change for this store is already running.', 'change_in_progress', ['change' => self::running_change()]);
        }
        try {
            if ($mode === 'keep') {
                return self::set_keep($to, $decimals, $from_decimals, $current, $decimals_before, $change, $plugin_consent);
            }
            return self::set_convert($rows, $to, $decimals, $from_decimals, $current, $decimals_before, $change);
        } finally {
            self::lock_release();
        }
    }

    /**
     * The build's first set. A store that already holds prices keeps its
     * currency (the build then prices its products in that currency): its
     * products, and also its coupons' amounts and spend limits and its
     * shipping costs, which the currency would otherwise relabel with nobody
     * asked. On an empty store the currency and its decimals are set; when
     * the currency is already the right one (WooCommerce was installed with
     * it), its decimals still follow, so a yen store does not show ¥4,290.00.
     */
    private static function set_initial($to, $decimals, $current, $decimals_before) {
        $held = self::money_held();
        if ($to === $current) {
            if ($decimals === $decimals_before || $held['any']) {
                return self::with_plugins(self::result(false, 'initial', $current, $current, $decimals_before, $decimals_before, self::none_converted()), $current, $decimals, 'initial', false);
            }
            self::write_decimals($decimals);
            self::clear_caches([], false);
            return self::with_plugins(self::result(true, 'initial', $current, $current, $decimals_before, self::stored_decimals(), self::none_converted()), $current, $decimals, 'initial', false);
        }
        if ($held['any']) {
            $parts = [];
            foreach ([['products', 'product'], ['coupons', 'coupon'], ['shipping_costs', 'shipping cost']] as list($key, $word)) {
                if ($held[$key] > 0) {
                    $parts[] = $held[$key] . ' ' . $word . ($held[$key] === 1 ? '' : 's');
                }
            }
            return self::fail(
                'Nothing was changed: the store already holds prices in ' . ($current !== '' ? $current : 'its currency')
                    . ($parts ? ' (' . implode(', ', $parts) . ')' : '') . ', so its currency is kept.',
                'store_has_products',
                ['current' => $current, 'products' => $held['products'], 'coupons' => $held['coupons'], 'shipping_costs' => $held['shipping_costs']]
            );
        }
        if (!self::write_currency($to)) {
            return self::fail('Nothing was changed: the site did not save the store currency.', 'not_saved', [
                'failed' => [['kind' => 'currency', 'field' => 'currency', 'label' => 'Store currency', 'error' => 'WooCommerce did not save ' . $to]],
                'restored' => true,
                'not_restored' => [],
            ]);
        }
        if ($decimals !== $decimals_before) {
            self::write_decimals($decimals);
        }
        self::clear_caches([], false);
        return self::with_plugins(self::result(true, 'initial', $current, $to, $decimals_before, self::stored_decimals(), self::none_converted()), $to, $decimals, 'initial', false);
    }

    /** Keep: the currency changes, every number stays (a plugin's prices too, when the owner saw them: $plugin_consent). */
    private static function set_keep($to, $decimals, $from_decimals, $current, $decimals_before, array $change, $plugin_consent = false) {
        if (!self::write_currency($to)) {
            self::record_last($change + ['outcome' => 'rolled_back', 'restored' => true, 'not_restored' => []]);
            return self::fail('Nothing was changed: the site did not save the store currency.', 'not_saved', [
                'failed' => [['kind' => 'currency', 'field' => 'currency', 'label' => 'Store currency', 'error' => 'WooCommerce did not save ' . $to]],
                'restored' => true,
                'not_restored' => [],
            ]);
        }
        self::follow_decimals($decimals, $from_decimals, $decimals_before);
        self::clear_caches([], false);
        self::record_last($change + ['outcome' => 'done', 'converted' => self::none_converted()]);
        return self::with_plugins(
            self::result(true, 'keep', $current, $to, $decimals_before, self::stored_decimals(), self::none_converted()),
            $to,
            $decimals,
            'keep',
            (bool) $plugin_consent
        );
    }

    /**
     * Convert: the rows must name exactly the store's money values as they
     * are now, each with its converted value. Prices, coupons and shipping
     * costs are written and read back first; the currency is written last. A
     * write that fails puts every value written back as it was, and leaves
     * the currency as it was.
     */
    private static function set_convert($rows, $to, $decimals, $from_decimals, $current, $decimals_before, array $change) {
        if (!is_array($rows)) {
            return self::fail('Nothing was changed: convert needs the converted prices (rows).', 'invalid_input');
        }
        $given = 0;
        foreach ($rows as $list) {
            $given += is_array($list) ? count($list) : 0;
        }
        if ($given > self::MAX_ROWS_SENT) {
            return self::fail('Nothing was changed: the store has more than ' . number_format(self::MAX_VALUES) . ' prices, too many to convert at once.', 'too_many_prices');
        }
        list($plan, $problems) = self::parse_rows($rows);
        // Only rows that carry a value count (parse_rows leaves out a value
        // that is empty and stays empty).
        if (count($plan) > self::MAX_VALUES) {
            return self::fail('Nothing was changed: the store has more than ' . number_format(self::MAX_VALUES) . ' prices, too many to convert at once.', 'too_many_prices');
        }
        if ($problems) {
            return self::fail('Nothing was changed: ' . self::join_problems($problems) . '.', 'invalid_input', ['problems' => self::cap_problems($problems)]);
        }

        $inv = self::inventory(self::MAX_VALUES);
        if ($inv['total'] > self::MAX_VALUES) {
            return self::fail('Nothing was changed: the store has more than ' . number_format(self::MAX_VALUES) . ' prices, too many to convert at once.', 'too_many_prices');
        }
        if ($inv['other_types']) {
            return self::fail(
                'Nothing was changed: the store has products of a kind whose prices cannot be converted here (' . implode(', ', $inv['other_types']) . ').',
                'unsupported_products',
                ['types' => $inv['other_types']]
            );
        }
        $problems = self::compare_rows($plan, $inv['values']);
        if ($problems) {
            return self::fail('Nothing was changed: the store\'s prices changed since they were read (' . self::join_problems($problems) . ').', 'store_changed', ['problems' => self::cap_problems($problems)]);
        }
        $problems = self::check_sales($plan, $inv['values']);
        if ($problems) {
            return self::fail('Nothing was changed: ' . self::join_problems($problems) . '.', 'invalid_input', ['problems' => self::cap_problems($problems)]);
        }

        // Write: one save per product, per coupon and per shipping method.
        // Many products take a while, so the PHP time limit is lifted and a
        // caller that stops waiting does not stop the change halfway. The
        // journal (every value before and after) is saved before the first
        // write: if the process is killed (a host's time limit, memory), the
        // next read or set, or the scheduled check, puts back what it wrote.
        // A fatal error inside this process puts it back on the way out.
        $groups = self::group_plan($plan, $inv['values']);
        $journal = $change + [
            'decimals' => $decimals,
            'from_decimals' => $from_decimals,
            'decimals_before' => $decimals_before,
            'started' => time(),
            'groups' => $groups,
        ];
        if (!self::write_journal($journal)) {
            self::record_last($change + ['outcome' => 'rolled_back', 'restored' => true, 'not_restored' => []]);
            return self::fail('Nothing was changed: the site could not save the list of values to convert, so nothing was written.', 'not_saved', [
                'failed' => [['kind' => 'journal', 'field' => 'journal', 'label' => 'Store currency', 'error' => 'the journal was not saved']],
                'restored' => true,
                'not_restored' => [],
            ]);
        }
        self::schedule_recovery();
        $done = [];
        $finished = false;
        self::keep_running();
        register_shutdown_function(function () use (&$finished, &$done, $to, $change, $decimals) {
            if ($finished) {
                return;
            }
            if (self::stored_currency() === $to) {
                // The currency, the last write, went through: the change is
                // done, and the plugins with a currency of their own follow it.
                self::record_last($change + ['outcome' => 'done', 'converted' => self::none_converted()]);
                self::delete_journal();
                self::with_plugins([], $to, $decimals, 'convert', false);
                self::lock_release();
                return;
            }
            $left = $done ? self::rollback($done) : [];
            self::record_last($change + ['outcome' => 'rolled_back', 'restored' => !$left, 'not_restored' => $left]);
            self::delete_journal();
            self::lock_release();
            WebMaven_Log::write('[WebMaven Store currency] A change to ' . $to . ' stopped partway; the values written were put back'
                . ($left ? ', except ' . json_encode($left) : '') . '.');
        });
        $failed = null;
        $touched = [];
        $parents = [];
        $shipping = false;
        foreach ($groups as $group) {
            $done[] = $group;
            if ($group['kind'] === 'price') {
                $touched[$group['id']] = true;
                if ($group['parent_id']) {
                    $parents[$group['parent_id']] = true;
                }
            } elseif ($group['kind'] === 'shipping') {
                $shipping = true;
            }
            $error = self::write_group($group, 'after');
            if ($error !== null) {
                $failed = self::failure_of($group, $error);
                break;
            }
            self::heartbeat();
        }
        self::sync_parents(array_keys($parents));
        if ($failed === null && !self::write_currency($to)) {
            $failed = ['kind' => 'currency', 'field' => 'currency', 'label' => 'Store currency', 'error' => 'WooCommerce did not save ' . $to];
        }
        if ($failed !== null) {
            $not_restored = self::rollback($done);
            $finished = true;
            self::sync_parents(array_keys($parents));
            self::clear_caches(array_merge(array_keys($touched), array_keys($parents)), $shipping);
            self::record_last($change + ['outcome' => 'rolled_back', 'restored' => !$not_restored, 'not_restored' => $not_restored]);
            self::delete_journal();
            return self::fail(
                $not_restored
                    ? 'The currency did not change, and ' . count($not_restored) . ' ' . (count($not_restored) === 1 ? 'value' : 'values') . ' could not be put back as they were.'
                    : 'Nothing was changed: the site did not save a converted value, so every value written was put back.',
                'not_saved',
                ['failed' => [$failed], 'restored' => !$not_restored, 'not_restored' => $not_restored]
            );
        }

        $finished = true;
        self::follow_decimals($decimals, $from_decimals, $decimals_before);
        self::clear_caches(array_merge(array_keys($touched), array_keys($parents)), $shipping);
        $converted = self::converted_counts($plan);
        self::record_last($change + ['outcome' => 'done', 'converted' => $converted]);
        self::delete_journal();
        return self::with_plugins(
            self::result(true, 'convert', $current, $to, $decimals_before, self::stored_decimals(), $converted),
            $to,
            $decimals,
            'convert',
            false
        );
    }

    /** Values per kind a plan (or a journal's groups) converts. */
    private static function converted_counts(array $rows) {
        $converted = self::none_converted();
        foreach ($rows as $row) {
            $n = isset($row['fields']) && is_array($row['fields']) ? count($row['fields']) : 1;
            $converted[$row['kind'] === 'price' ? 'prices' : ($row['kind'] === 'coupon' ? 'coupons' : 'shipping')] += $n;
        }
        return $converted;
    }

    // ── Rows ────────────────────────────────────────────────────────────────

    /**
     * [$plan, $problems]: key "kind:id:field" => ['kind', 'id', 'field',
     * 'before', 'after']. A row whose value is empty and stays empty (before
     * and after both '', such as the sale price of a product that has none)
     * names no value and is left out, so it neither counts nor needs a
     * match; a value the store holds still needs its own row with a number.
     */
    private static function parse_rows(array $rows) {
        $kinds = [
            'prices' => ['price', 'id', array_keys(self::PRICE_META)],
            'coupons' => ['coupon', 'id', array_keys(self::COUPON_META)],
            'shipping' => ['shipping', 'instance_id', null],
        ];
        $plan = [];
        $problems = [];
        foreach ($rows as $name => $list) {
            if (!isset($kinds[$name])) {
                $problems[] = '"' . $name . '" is not a kind of value (prices, coupons or shipping)';
                continue;
            }
            if (!is_array($list)) {
                $problems[] = $name . ' must be a list';
                continue;
            }
            list($kind, $id_key, $fields) = $kinds[$name];
            foreach (array_values($list) as $i => $row) {
                $n = $name . ' ' . ($i + 1);
                if (!is_array($row)) {
                    $problems[] = "$n is not an object";
                    continue;
                }
                $id = $row[$id_key] ?? null;
                $id = is_int($id) || (is_string($id) && ctype_digit($id)) ? (int) $id : 0;
                if ($id <= 0) {
                    $problems[] = "$n: $id_key must be a positive whole number";
                    continue;
                }
                $field = isset($row['field']) && is_string($row['field']) ? $row['field'] : '';
                $field_ok = $fields !== null ? in_array($field, $fields, true) : self::is_shipping_field($field);
                if (!$field_ok) {
                    $problems[] = "$n: \"$field\" is not a field that holds money";
                    continue;
                }
                $before = self::text($row['before'] ?? null);
                $after = self::text($row['after'] ?? null);
                if ($before === null) {
                    $problems[] = "$n: before must be the value as it is stored now";
                    continue;
                }
                if ($before === '' && $after === '') {
                    continue;
                }
                $empty_ok = $kind === 'price' && $field === 'sale';
                if ($after === null || !($after === '' ? $empty_ok : preg_match(self::AMOUNT, $after))) {
                    $problems[] = "$n: after must be a plain amount like 24.99 or 4290" . ($empty_ok ? ' (or empty to remove the sale price)' : '');
                    continue;
                }
                $key = $kind . ':' . $id . ':' . $field;
                if (isset($plan[$key])) {
                    $problems[] = "$n: $kind $id $field is listed twice";
                    continue;
                }
                $plan[$key] = ['kind' => $kind, 'id' => $id, 'field' => $field, 'before' => $before, 'after' => $after];
            }
        }
        return [$plan, $problems];
    }

    /** The rows name exactly the store's money values, each with its value as it is now. */
    private static function compare_rows(array $plan, array $values) {
        $problems = [];
        foreach ($values as $key => $v) {
            if (!isset($plan[$key])) {
                $problems[] = self::describe($v) . ' (' . $v['value'] . ') has no converted value';
            } elseif ($plan[$key]['before'] !== $v['value']) {
                $problems[] = self::describe($v) . ' is ' . $v['value'] . ' now, not ' . $plan[$key]['before'];
            }
        }
        foreach ($plan as $key => $row) {
            if (!isset($values[$key])) {
                $problems[] = $row['kind'] . ' ' . $row['id'] . ' has no ' . $row['field'] . ' value to convert';
            }
        }
        return $problems;
    }

    /** A converted sale price stays below the product's converted regular price. */
    private static function check_sales(array $plan, array $values) {
        $problems = [];
        foreach ($plan as $row) {
            if ($row['kind'] !== 'price' || $row['field'] !== 'sale' || $row['after'] === '') {
                continue;
            }
            $regular_key = 'price:' . $row['id'] . ':regular';
            $regular = isset($plan[$regular_key]) ? $plan[$regular_key]['after'] : '';
            if ($regular !== '' && (float) $row['after'] >= (float) $regular) {
                $label = isset($values['price:' . $row['id'] . ':sale']) ? self::label($values['price:' . $row['id'] . ':sale']) : 'product ' . $row['id'];
                $problems[] = 'the sale price of ' . $label . ' (' . $row['after'] . ') must stay below its regular price (' . $regular . ')';
            }
        }
        return $problems;
    }

    /**
     * The plan as write groups, in a fixed order: prices by product, then
     * coupons, then shipping methods. Each group carries every field with its
     * value before and after.
     */
    private static function group_plan(array $plan, array $values) {
        $groups = [];
        foreach ($plan as $key => $row) {
            $gkey = $row['kind'] . ':' . $row['id'];
            if (!isset($groups[$gkey])) {
                $v = $values[$key];
                $groups[$gkey] = [
                    'kind' => $row['kind'],
                    'id' => $row['id'],
                    'parent_id' => (int) ($v['parent_id'] ?? 0),
                    'label' => self::label($v),
                    'fields' => [],
                ];
            }
            $groups[$gkey]['fields'][$row['field']] = ['before' => $row['before'], 'after' => $row['after']];
        }
        $order = ['price' => 0, 'coupon' => 1, 'shipping' => 2];
        uasort($groups, function ($a, $b) use ($order) {
            return [$order[$a['kind']], $a['id']] <=> [$order[$b['kind']], $b['id']];
        });
        return array_values($groups);
    }

    // ── Writes ──────────────────────────────────────────────────────────────

    /**
     * Write one group's fields to their 'after' (or 'before') values and read
     * them back. Null when every field now holds its value, else the reason.
     * A group whose fields already hold those values is not written.
     */
    private static function write_group(array $group, $which) {
        $want = [];
        foreach ($group['fields'] as $field => $pair) {
            $want[$field] = $pair[$which];
        }
        try {
            if (self::stored_fields($group) === $want) {
                return null;
            }
            switch ($group['kind']) {
                case 'price':
                    $product = function_exists('wc_get_product') ? wc_get_product($group['id']) : null;
                    if (!$product) {
                        return 'the product could not be loaded';
                    }
                    foreach ($want as $field => $value) {
                        if ($field === 'regular') {
                            $product->set_regular_price($value);
                        } else {
                            $product->set_sale_price($value);
                        }
                    }
                    $product->save();
                    break;
                case 'coupon':
                    $coupon = new \WC_Coupon($group['id']);
                    if ((int) $coupon->get_id() !== (int) $group['id']) {
                        return 'the coupon could not be loaded';
                    }
                    foreach ($want as $field => $value) {
                        call_user_func([$coupon, 'set_' . $field], $value);
                    }
                    $coupon->save();
                    break;
                case 'shipping':
                    $method = WC_Shipping_Zones::get_shipping_method($group['id']);
                    if (!$method) {
                        return 'the shipping method could not be loaded';
                    }
                    $key = $method->get_instance_option_key();
                    $settings = get_option($key, []);
                    $settings = is_array($settings) ? $settings : [];
                    foreach ($want as $field => $value) {
                        $settings[$field] = $value;
                    }
                    update_option($key, apply_filters('woocommerce_shipping_' . $method->id . '_instance_settings_values', $settings, $method), 'yes');
                    break;
            }
        } catch (\Throwable $e) {
            return $e->getMessage() !== '' ? $e->getMessage() : get_class($e);
        }
        $stored = self::stored_fields($group);
        foreach ($want as $field => $value) {
            if (($stored[$field] ?? null) !== $value) {
                return 'the ' . self::field_name($group['kind'], $field) . ' reads "' . ($stored[$field] ?? '') . '" after saving, not "' . $value . '"';
            }
        }
        return null;
    }

    /** Put every group written back to its values before, newest first. The values that stay wrong. */
    private static function rollback(array $done) {
        $not_restored = [];
        foreach (array_reverse($done) as $group) {
            $error = self::write_group($group, 'before');
            if ($error === null) {
                continue;
            }
            $stored = [];
            try {
                $stored = self::stored_fields($group);
            } catch (\Throwable $e) {
                $stored = [];
            }
            foreach ($group['fields'] as $field => $pair) {
                $now = $stored[$field] ?? null;
                if ($now === $pair['before']) {
                    continue;
                }
                $not_restored[] = [
                    'kind' => $group['kind'],
                    'id' => $group['id'],
                    'field' => $field,
                    'label' => $group['label'],
                    'before' => $pair['before'],
                    'value' => $now,
                    'error' => $error,
                ];
            }
        }
        return $not_restored;
    }

    /** The group's fields as they are stored now (a missing value reads ''). */
    private static function stored_fields(array $group) {
        $out = [];
        switch ($group['kind']) {
            case 'price':
                $meta = self::meta([$group['id']], array_values(self::PRICE_META));
                foreach (array_keys($group['fields']) as $field) {
                    $out[$field] = $meta[$group['id']][self::PRICE_META[$field]] ?? '';
                }
                break;
            case 'coupon':
                $meta = self::meta([$group['id']], array_values(self::COUPON_META));
                foreach (array_keys($group['fields']) as $field) {
                    $out[$field] = $meta[$group['id']][self::COUPON_META[$field]] ?? '';
                }
                break;
            case 'shipping':
                $method = WC_Shipping_Zones::get_shipping_method($group['id']);
                $settings = $method ? get_option($method->get_instance_option_key(), []) : [];
                foreach (array_keys($group['fields']) as $field) {
                    $v = is_array($settings) ? ($settings[$field] ?? '') : '';
                    $out[$field] = is_scalar($v) ? (string) $v : '';
                }
                break;
        }
        return $out;
    }

    /** Written and read back: whether the store now sells in $to. */
    private static function write_currency($to) {
        try {
            update_option('woocommerce_currency', $to);
        } catch (\Throwable $e) {
            return false;
        }
        return self::stored_currency() === $to;
    }

    private static function write_decimals($decimals) {
        try {
            update_option('woocommerce_price_num_decimals', (string) $decimals);
        } catch (\Throwable $e) {
            return false;
        }
        return self::stored_decimals() === $decimals;
    }

    /**
     * Keep and Convert: the decimals follow the new currency only when the
     * owner never changed them (they still match the old currency's).
     */
    private static function follow_decimals($decimals, $from_decimals, $decimals_before) {
        if ($decimals_before === $from_decimals && $decimals !== $decimals_before) {
            self::write_decimals($decimals);
        }
    }

    /** No time limit, and no stop when the caller hangs up (as WooCommerce's own importers run). */
    private static function keep_running() {
        if (function_exists('ignore_user_abort')) {
            @ignore_user_abort(true);
        }
        if (function_exists('wc_set_time_limit')) {
            wc_set_time_limit(0);
        }
    }

    /** A variable product's price range follows its variations. */
    private static function sync_parents(array $parent_ids) {
        if (!$parent_ids || !class_exists('WC_Product_Variable') || !method_exists('WC_Product_Variable', 'sync')) {
            return;
        }
        foreach ($parent_ids as $id) {
            try {
                WC_Product_Variable::sync($id);
            } catch (\Throwable $e) {
                WebMaven_Log::write('[WebMaven Store currency] Could not sync the prices of product ' . (int) $id . ': ' . $e->getMessage());
            }
        }
    }

    /** No shopper sees a price the store no longer holds. */
    private static function clear_caches(array $product_ids, $shipping) {
        if (function_exists('wc_delete_product_transients')) {
            foreach (array_unique(array_map('intval', $product_ids)) as $id) {
                wc_delete_product_transients($id);
            }
        }
        if (class_exists('WC_Cache_Helper') && method_exists('WC_Cache_Helper', 'get_transient_version')) {
            WC_Cache_Helper::get_transient_version('product', true);
            if ($shipping) {
                WC_Cache_Helper::get_transient_version('shipping', true);
            }
        }
        if (function_exists('wp_cache_flush')) {
            wp_cache_flush();
        }
    }

    // ── Inventory ───────────────────────────────────────────────────────────

    /**
     * Every money value of the store, counted; with $limit > 0 also listed
     * (prices, then coupons, then shipping) until $limit values, and keyed in
     * 'values' ("kind:id:field" => the value and what it belongs to). A
     * formula shipping cost is listed but never counted or keyed.
     */
    private static function inventory($limit) {
        $inv = [
            'products' => 0,
            'other_types' => [],
            'price_values' => 0,
            'fixed_coupons' => 0,
            'coupon_values' => 0,
            'shipping_values' => 0,
            'coupons_with_values' => 0,
            'other_values' => 0,
            'total' => 0,
            'prices' => [],
            'coupons' => [],
            'shipping' => [],
            'values' => [],
            'not_convertible' => [],
        ];
        $listed = 0;
        $full = $limit <= 0;
        $take = function ($n) use (&$listed, &$full, $limit) {
            if ($full) {
                return false;
            }
            if ($listed + $n > $limit) {
                $full = true;
                return false;
            }
            $listed += $n;
            return true;
        };

        // Products and the variations of variable products.
        $posts = self::posts(['product', 'product_variation']);
        $types = self::product_types();
        $products = [];
        foreach ($posts as $p) {
            if ($p['post_type'] === 'product') {
                $products[(int) $p['ID']] = true;
            }
        }
        $inv['products'] = count($products);
        $priced = [];
        $other = [];
        foreach ($posts as $p) {
            $id = (int) $p['ID'];
            if ($p['post_type'] === 'product') {
                $type = $types[$id] ?? 'simple';
                if (in_array($type, self::PRICED_TYPES, true)) {
                    $priced[$id] = ['id' => $id, 'parent_id' => 0, 'type' => $type];
                } elseif (!in_array($type, self::KNOWN_TYPES, true)) {
                    $other[$type] = true;
                }
            } else {
                $parent = (int) $p['post_parent'];
                if (isset($products[$parent]) && ($types[$parent] ?? 'simple') === 'variable') {
                    $priced[$id] = ['id' => $id, 'parent_id' => $parent, 'type' => 'variation'];
                }
            }
            if (isset($priced[$id])) {
                $priced[$id]['name'] = (string) $p['post_title'];
                $priced[$id]['status'] = (string) $p['post_status'];
            }
        }
        ksort($other);
        $inv['other_types'] = array_map('strval', array_keys($other));

        $meta = self::meta(array_keys($priced), array_values(self::PRICE_META));
        foreach ($priced as $id => $row) {
            $row['regular'] = $meta[$id][self::PRICE_META['regular']] ?? '';
            $row['sale'] = $meta[$id][self::PRICE_META['sale']] ?? '';
            $fields = array_filter(['regular' => $row['regular'], 'sale' => $row['sale']], [__CLASS__, 'present']);
            if (!$fields) {
                continue;
            }
            $inv['price_values'] += count($fields);
            if ($take(count($fields))) {
                $inv['prices'][] = $row;
                foreach ($fields as $field => $value) {
                    $inv['values']['price:' . $id . ':' . $field] = ['kind' => 'price', 'id' => $id, 'parent_id' => $row['parent_id'], 'field' => $field, 'value' => $value, 'label' => $row['name']];
                }
            }
        }

        // Coupons: the amount of a fixed-amount coupon, and the minimum and
        // maximum spend of any coupon (a percent coupon's "over $50" is money;
        // its 15% is not). A coupon without a type is fixed_cart, as
        // WooCommerce reads it.
        $coupons = self::posts(['shop_coupon']);
        $coupon_meta = self::meta(array_map(function ($c) { return (int) $c['ID']; }, $coupons), array_merge(['discount_type'], array_values(self::COUPON_META)));
        foreach ($coupons as $c) {
            $id = (int) $c['ID'];
            $type = (string) ($coupon_meta[$id]['discount_type'] ?? '');
            $type = $type === '' ? 'fixed_cart' : $type;
            $fixed = in_array($type, self::FIXED_COUPON_TYPES, true);
            if ($fixed) {
                $inv['fixed_coupons']++;
            }
            $row = ['id' => $id, 'code' => (string) $c['post_title'], 'type' => $type];
            foreach (self::COUPON_META as $field => $key) {
                $row[$field] = $coupon_meta[$id][$key] ?? '';
            }
            $money = $fixed ? $row : array_diff_key($row, ['amount' => true]);
            $fields = array_filter(array_intersect_key($money, self::COUPON_META), [__CLASS__, 'present']);
            if (!$fields) {
                continue;
            }
            $inv['coupons_with_values']++;
            $inv['coupon_values'] += count($fields);
            if ($take(count($fields))) {
                $inv['coupons'][] = $row;
                foreach ($fields as $field => $value) {
                    $inv['values']['coupon:' . $id . ':' . $field] = ['kind' => 'coupon', 'id' => $id, 'field' => $field, 'value' => $value, 'label' => $row['code']];
                }
            }
        }

        // Shipping, in every zone: flat rate, free shipping and local pickup
        // are converted; any other method's money settings are listed as not
        // convertible (they keep their numbers either way).
        $shipping = self::shipping_inventory();
        foreach ($shipping['rows'] as $row) {
            if ($row['formula']) {
                if ($limit > 0) {
                    $inv['shipping'][] = $row;
                }
                continue;
            }
            $inv['shipping_values']++;
            if ($take(1)) {
                $inv['shipping'][] = $row;
                $inv['values']['shipping:' . $row['instance_id'] . ':' . $row['field']] = ['kind' => 'shipping', 'id' => $row['instance_id'], 'field' => $row['field'], 'value' => $row['value'], 'label' => $row['title'] . ' (' . $row['zone_name'] . ')'];
            }
        }
        $inv['not_convertible'] = $shipping['not_convertible'];
        $inv['other_values'] = $shipping['formulas'] + count($shipping['not_convertible']);

        $inv['total'] = $inv['price_values'] + $inv['coupon_values'] + $inv['shipping_values'];
        return $inv;
    }

    /** Flat rate: its cost, each shipping class cost, the no-class cost. Free shipping: its minimum. Local pickup: its cost. */
    private static function shipping_fields($type, array $settings) {
        if ($type === 'free_shipping') {
            return ['min_amount'];
        }
        if ($type === 'local_pickup') {
            return ['cost'];
        }
        $classes = [];
        foreach (array_keys($settings) as $key) {
            if (is_string($key) && preg_match('/^class_cost_\d+$/', $key)) {
                $classes[] = $key;
            }
        }
        natsort($classes);
        return array_merge(['cost'], array_values($classes), ['no_class_cost']);
    }

    private static function is_shipping_field($field) {
        return is_string($field) && (bool) preg_match('/^(?:cost|no_class_cost|class_cost_\d+|min_amount)$/', $field);
    }

    private static function shipping_zones() {
        if (!class_exists('WC_Shipping_Zones')) {
            return [];
        }
        $zones = [];
        foreach ((array) WC_Shipping_Zones::get_zones() as $z) {
            $id = is_array($z) ? (int) ($z['id'] ?? $z['zone_id'] ?? 0) : (int) $z->get_id();
            $zone = WC_Shipping_Zones::get_zone($id);
            if ($zone) {
                $zones[] = $zone;
            }
        }
        $rest = WC_Shipping_Zones::get_zone(0);
        if ($rest) {
            $zones[] = $rest;
        }
        return $zones;
    }

    /**
     * The shipping money of every zone: the rows of the methods this converts
     * (formula costs flagged), how many are formulas, and every other
     * method's money settings (never converted; the owner is told).
     */
    private static function shipping_inventory() {
        $out = ['rows' => [], 'formulas' => 0, 'not_convertible' => []];
        foreach (self::shipping_zones() as $zone) {
            foreach ((array) $zone->get_shipping_methods(false) as $method) {
                $type = (string) $method->id;
                $instance_id = (int) $method->instance_id;
                $settings = get_option($method->get_instance_option_key(), []);
                $settings = is_array($settings) ? $settings : [];
                if (!in_array($type, self::SHIPPING_METHODS, true)) {
                    foreach ($settings as $field => $value) {
                        if (!is_string($field) || !preg_match(self::OTHER_MONEY_SETTING, strtolower($field)) || !is_scalar($value) || !self::present((string) $value)) {
                            continue;
                        }
                        $out['not_convertible'][] = [
                            'kind' => 'shipping',
                            'zone_name' => (string) $zone->get_zone_name(),
                            'instance_id' => $instance_id,
                            'method' => $type,
                            'title' => (string) $method->get_title(),
                            'field' => $field,
                            'value' => (string) $value,
                        ];
                    }
                    continue;
                }
                foreach (self::shipping_fields($type, $settings) as $field) {
                    $value = isset($settings[$field]) && is_scalar($settings[$field]) ? (string) $settings[$field] : '';
                    if (!self::present($value)) {
                        continue;
                    }
                    $formula = !preg_match(self::PLAIN_NUMBER, $value);
                    if ($formula) {
                        $out['formulas']++;
                    }
                    $out['rows'][] = [
                        'zone_id' => (int) $zone->get_id(),
                        'zone_name' => (string) $zone->get_zone_name(),
                        'instance_id' => $instance_id,
                        'method' => $type,
                        'title' => (string) $method->get_title(),
                        'field' => $field,
                        'value' => $value,
                        'formula' => $formula,
                    ];
                }
            }
        }
        // The block checkout's local pickup keeps one cost for every location.
        $pickup = get_option('woocommerce_pickup_location_settings', []);
        if (is_array($pickup) && isset($pickup['cost']) && is_scalar($pickup['cost']) && self::present((string) $pickup['cost'])
            && (!isset($pickup['enabled']) || $pickup['enabled'] === 'yes')) {
            $out['not_convertible'][] = [
                'kind' => 'shipping',
                'zone_name' => '',
                'instance_id' => 0,
                'method' => 'pickup_location',
                'title' => isset($pickup['title']) && is_string($pickup['title']) && trim($pickup['title']) !== '' ? trim($pickup['title']) : 'Pickup',
                'field' => 'cost',
                'value' => (string) $pickup['cost'],
            ];
        }
        return $out;
    }

    /**
     * The read's counts without listing anything: COUNT queries over the
     * products, variations and coupons (no row is loaded), and the shipping
     * zones (a handful of options). The same numbers the full inventory
     * counts.
     */
    private static function quick_counts() {
        global $wpdb;
        // These reads name only WordPress's tables ($wpdb's own properties)
        // and this class's fixed word lists, each cleaned to letters, digits,
        // _ and - (sql_list); ids are integers. Nothing in them comes from a
        // request.
        // phpcs:disable WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, PluginCheck.Security.DirectDB.UnescapedDBParameter
        $skip = self::sql_list(self::SKIPPED_STATUSES);
        $price_keys = self::sql_list(array_values(self::PRICE_META));
        $type_of = "SELECT 1 FROM {$wpdb->term_relationships} tr"
            . " INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id"
            . " INNER JOIN {$wpdb->terms} t ON t.term_id = tt.term_id"
            . " WHERE tr.object_id = p.ID AND tt.taxonomy = 'product_type'";
        $products = self::count_products();
        $own_prices = (int) $wpdb->get_var(
            "SELECT COUNT(*) FROM {$wpdb->postmeta} pm INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id"
            . " WHERE p.post_type = 'product' AND p.post_status NOT IN ($skip)"
            . " AND pm.meta_key IN ($price_keys) AND TRIM(pm.meta_value) <> ''"
            . " AND NOT EXISTS ($type_of AND t.slug NOT IN (" . self::sql_list(self::PRICED_TYPES) . '))'
        );
        $variation_prices = (int) $wpdb->get_var(
            "SELECT COUNT(*) FROM {$wpdb->postmeta} pm INNER JOIN {$wpdb->posts} v ON v.ID = pm.post_id"
            . " INNER JOIN {$wpdb->posts} p ON p.ID = v.post_parent"
            . " WHERE v.post_type = 'product_variation' AND v.post_status NOT IN ($skip)"
            . " AND p.post_type = 'product' AND p.post_status NOT IN ($skip)"
            . " AND pm.meta_key IN ($price_keys) AND TRIM(pm.meta_value) <> ''"
            . " AND EXISTS ($type_of AND t.slug = 'variable')"
        );
        $other = (array) $wpdb->get_col(
            "SELECT DISTINCT t.slug FROM {$wpdb->term_relationships} tr"
            . " INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id"
            . " INNER JOIN {$wpdb->terms} t ON t.term_id = tt.term_id"
            . " INNER JOIN {$wpdb->posts} p ON p.ID = tr.object_id"
            . " WHERE tt.taxonomy = 'product_type' AND p.post_type = 'product' AND p.post_status NOT IN ($skip)"
            . ' AND t.slug NOT IN (' . self::sql_list(self::KNOWN_TYPES) . ')'
            . ' ORDER BY t.slug ASC'
        );
        $fixed = "(dt.meta_value IS NULL OR dt.meta_value IN ('', " . self::sql_list(self::FIXED_COUPON_TYPES) . '))';
        $coupon_join = "FROM {$wpdb->posts} c LEFT JOIN {$wpdb->postmeta} dt ON dt.post_id = c.ID AND dt.meta_key = 'discount_type'";
        $coupon_where = "c.post_type = 'shop_coupon' AND c.post_status NOT IN ($skip)";
        $money_meta = "((pm.meta_key IN ('minimum_amount', 'maximum_amount')) OR (pm.meta_key = 'coupon_amount' AND $fixed)) AND TRIM(pm.meta_value) <> ''";
        $fixed_coupons = (int) $wpdb->get_var("SELECT COUNT(*) $coupon_join WHERE $coupon_where AND $fixed");
        $coupon_values = (int) $wpdb->get_var(
            "SELECT COUNT(*) $coupon_join INNER JOIN {$wpdb->postmeta} pm ON pm.post_id = c.ID WHERE $coupon_where AND $money_meta"
        );
        $coupons_with_values = (int) $wpdb->get_var(
            "SELECT COUNT(DISTINCT c.ID) $coupon_join INNER JOIN {$wpdb->postmeta} pm ON pm.post_id = c.ID WHERE $coupon_where AND $money_meta"
        );
        // phpcs:enable WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, PluginCheck.Security.DirectDB.UnescapedDBParameter
        $shipping = self::shipping_inventory();
        $shipping_values = count($shipping['rows']) - $shipping['formulas'];
        $other_types = array_values(array_unique(array_map(function ($t) { return strtolower((string) $t); }, $other)));
        return [
            'products' => $products,
            'other_types' => $other_types,
            'price_values' => $own_prices + $variation_prices,
            'fixed_coupons' => $fixed_coupons,
            'coupon_values' => $coupon_values,
            'coupons_with_values' => $coupons_with_values,
            'shipping_values' => $shipping_values,
            'other_values' => $shipping['formulas'] + count($shipping['not_convertible']),
            'not_convertible' => $shipping['not_convertible'],
            'total' => $own_prices + $variation_prices + $coupon_values + $shipping_values,
        ];
    }

    /** Whether the store holds any price (install_plugin's first-run config asks before it sets a currency). */
    public static function store_holds_prices() {
        return self::money_held()['any'];
    }

    /** Whether the store holds any price: products, coupon amounts and spend limits, shipping costs of any kind. */
    private static function money_held() {
        $c = self::quick_counts();
        $shipping = $c['shipping_values'] + $c['other_values'];
        return [
            'products' => $c['products'],
            'coupons' => $c['coupons_with_values'],
            'shipping_costs' => $shipping,
            'any' => $c['products'] > 0 || $c['coupons_with_values'] > 0 || $shipping > 0,
        ];
    }

    // ── One change at a time ────────────────────────────────────────────────

    /** The named lock of this site's store (unique per database and table prefix). */
    private static function lock_name() {
        global $wpdb;
        $db = defined('DB_NAME') ? (string) DB_NAME : '';
        $prefix = is_object($wpdb) && isset($wpdb->prefix) ? (string) $wpdb->prefix : '';
        return 'wpm_store_currency_' . substr(md5($db . '|' . $prefix), 0, 20);
    }

    /**
     * The named lock as another request sees it: 'held', 'free', or
     * 'unsupported' when the database has no named locks.
     */
    private static function named_lock_state() {
        global $wpdb;
        if (!is_object($wpdb) || !method_exists($wpdb, 'get_var')) {
            return 'unsupported';
        }
        $prev = method_exists($wpdb, 'suppress_errors') ? $wpdb->suppress_errors(true) : null;
        $holder = $wpdb->get_var($wpdb->prepare('SELECT IS_USED_LOCK(%s)', self::lock_name()));
        $error = property_exists($wpdb, 'last_error') ? (string) $wpdb->last_error : '';
        if ($prev !== null) {
            $wpdb->suppress_errors($prev);
        }
        if ($error !== '') {
            return 'unsupported';
        }
        return $holder === null || $holder === '' || $holder === false ? 'free' : 'held';
    }

    /**
     * The change that runs now (another request holds the lock), or null:
     * {running, token, to, from, mode, started, heartbeat}.
     */
    private static function running_change() {
        if (self::$lock_held !== null) {
            return null;
        }
        $record = get_option(self::LOCK_OPTION, null);
        $record = is_array($record) ? $record : null;
        $state = self::named_lock_state();
        if ($state === 'free') {
            return null;
        }
        if ($state === 'unsupported') {
            if ($record === null || time() - (int) ($record['heartbeat'] ?? 0) > self::LOCK_STALE_SECONDS) {
                return null;
            }
        }
        $r = $record ?? [];
        return [
            'running' => true,
            'token' => (string) ($r['token'] ?? ''),
            'to' => (string) ($r['to'] ?? ''),
            'from' => (string) ($r['from'] ?? ''),
            'mode' => (string) ($r['mode'] ?? ''),
            'started' => self::iso((int) ($r['started'] ?? 0)),
            'heartbeat' => self::iso((int) ($r['heartbeat'] ?? 0)),
        ];
    }

    /** Take the store's change lock for this request; false when another change holds it. */
    private static function lock_acquire(array $change) {
        global $wpdb;
        $got = null;
        if (is_object($wpdb) && method_exists($wpdb, 'get_var')) {
            $prev = method_exists($wpdb, 'suppress_errors') ? $wpdb->suppress_errors(true) : null;
            $got = $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 0)', self::lock_name()));
            $error = property_exists($wpdb, 'last_error') ? (string) $wpdb->last_error : '';
            if ($prev !== null) {
                $wpdb->suppress_errors($prev);
            }
            if ($error !== '') {
                $got = null;
            }
        }
        $now = time();
        $record = [
            'token' => (string) ($change['token'] ?? ''),
            'to' => (string) ($change['to'] ?? ''),
            'from' => (string) ($change['from'] ?? ''),
            'mode' => (string) ($change['mode'] ?? ''),
            'started' => $now,
            'heartbeat' => $now,
        ];
        if ((string) $got === '1') {
            self::$lock_held = 'db';
        } elseif ((string) $got === '0') {
            return false;
        } else {
            // No named locks here: the option is the lock, taken over only
            // once its heartbeat has stopped.
            $held = get_option(self::LOCK_OPTION, null);
            if (is_array($held) && $now - (int) ($held['heartbeat'] ?? 0) <= self::LOCK_STALE_SECONDS) {
                return false;
            }
            self::$lock_held = 'option';
        }
        self::$lock_record = $record;
        update_option(self::LOCK_OPTION, $record, false);
        return true;
    }

    /** Still writing: the lock's heartbeat moves (at most once every 5 seconds). */
    private static function heartbeat() {
        if (self::$lock_held === null || !is_array(self::$lock_record)) {
            return;
        }
        $now = time();
        if ($now - (int) self::$lock_record['heartbeat'] < 5) {
            return;
        }
        self::$lock_record['heartbeat'] = $now;
        update_option(self::LOCK_OPTION, self::$lock_record, false);
    }

    /** Release the lock this request holds (and its record). */
    private static function lock_release() {
        global $wpdb;
        if (self::$lock_held === null) {
            return;
        }
        $held = get_option(self::LOCK_OPTION, null);
        if (is_array($held) && is_array(self::$lock_record) && ($held['started'] ?? null) === self::$lock_record['started'] && ($held['token'] ?? null) === self::$lock_record['token']) {
            delete_option(self::LOCK_OPTION);
        }
        if (self::$lock_held === 'db' && is_object($wpdb) && method_exists($wpdb, 'get_var')) {
            $prev = method_exists($wpdb, 'suppress_errors') ? $wpdb->suppress_errors(true) : null;
            $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', self::lock_name()));
            if ($prev !== null) {
                $wpdb->suppress_errors($prev);
            }
        }
        self::$lock_held = null;
        self::$lock_record = null;
    }

    // ── The journal, and a Convert that died partway ────────────────────────

    private static function write_journal(array $journal) {
        try {
            update_option(self::JOURNAL_OPTION, $journal, false);
        } catch (\Throwable $e) {
            return false;
        }
        $saved = get_option(self::JOURNAL_OPTION, null);
        return is_array($saved) && ($saved['started'] ?? null) === $journal['started'] && count($saved['groups'] ?? []) === count($journal['groups']);
    }

    private static function delete_journal() {
        delete_option(self::JOURNAL_OPTION);
        if (function_exists('wp_clear_scheduled_hook')) {
            wp_clear_scheduled_hook(self::RECOVER_HOOK);
        }
    }

    /** The scheduled check, in case the process dies and nobody opens the dashboard. */
    private static function schedule_recovery() {
        if (function_exists('wp_next_scheduled') && function_exists('wp_schedule_single_event') && !wp_next_scheduled(self::RECOVER_HOOK)) {
            wp_schedule_single_event(time() + 180, self::RECOVER_HOOK);
        }
    }

    /** WP-cron: put back a Convert that died partway; check again later while one still runs. */
    public static function recover_scheduled() {
        if (!self::woocommerce_active()) {
            return;
        }
        if (self::running_change() !== null) {
            if (function_exists('wp_schedule_single_event')) {
                wp_schedule_single_event(time() + 180, self::RECOVER_HOOK);
            }
            return;
        }
        self::recover_dead_run();
    }

    /**
     * A Convert whose process died partway leaves its journal and holds no
     * lock. Every value that still holds its converted number is put back
     * (a value changed since is the owner's and stays), and the currency was
     * never written, so the store is as it was. When the currency was written
     * (the last step), the change went through and only its tidying is
     * finished. Returns what happened (and records it as the last change), or
     * null when there was nothing to recover or a change still runs.
     */
    public static function recover_dead_run() {
        $journal = get_option(self::JOURNAL_OPTION, null);
        if ($journal === null || $journal === false) {
            return null;
        }
        if (self::running_change() !== null) {
            return null;
        }
        $change = is_array($journal) ? [
            'token' => (string) ($journal['token'] ?? ''),
            'to' => (string) ($journal['to'] ?? ''),
            'from' => (string) ($journal['from'] ?? ''),
            'mode' => 'convert',
            'rate' => $journal['rate'] ?? null,
            'rate_date' => $journal['rate_date'] ?? null,
        ] : null;
        if (!$change || !isset($journal['groups']) || !is_array($journal['groups'])) {
            delete_option(self::JOURNAL_OPTION);
            return null;
        }
        if (!self::lock_acquire(array_merge($change, ['mode' => 'recover']))) {
            return null;
        }
        try {
            $groups = $journal['groups'];
            $touched = [];
            $parents = [];
            $shipping = false;
            foreach ($groups as $group) {
                if (($group['kind'] ?? '') === 'price') {
                    $touched[(int) $group['id']] = true;
                    if (!empty($group['parent_id'])) {
                        $parents[(int) $group['parent_id']] = true;
                    }
                } elseif (($group['kind'] ?? '') === 'shipping') {
                    $shipping = true;
                }
            }
            if ($change['to'] !== '' && self::stored_currency() === $change['to']) {
                self::follow_decimals((int) ($journal['decimals'] ?? 2), (int) ($journal['from_decimals'] ?? 2), (int) ($journal['decimals_before'] ?? 2));
                self::with_plugins([], $change['to'], (int) ($journal['decimals'] ?? 2), 'convert', false);
                $outcome = ['outcome' => 'done', 'converted' => self::converted_counts($groups), 'late' => true];
            } else {
                $not_restored = [];
                foreach (array_reverse($groups) as $group) {
                    $stored = [];
                    try {
                        $stored = self::stored_fields($group);
                    } catch (\Throwable $e) {
                        $stored = [];
                    }
                    $back = [];
                    foreach ((array) ($group['fields'] ?? []) as $field => $pair) {
                        if (($stored[$field] ?? null) === $pair['after'] && $pair['after'] !== $pair['before']) {
                            $back[$field] = $pair;
                        }
                    }
                    if (!$back) {
                        continue;
                    }
                    $write = $group;
                    $write['fields'] = $back;
                    $error = self::write_group($write, 'before');
                    if ($error === null) {
                        continue;
                    }
                    $now = [];
                    try {
                        $now = self::stored_fields($write);
                    } catch (\Throwable $e) {
                        $now = [];
                    }
                    foreach ($back as $field => $pair) {
                        if (($now[$field] ?? null) === $pair['before']) {
                            continue;
                        }
                        $not_restored[] = [
                            'kind' => $group['kind'],
                            'id' => $group['id'],
                            'field' => $field,
                            'label' => $group['label'] ?? '',
                            'before' => $pair['before'],
                            'value' => $now[$field] ?? null,
                            'error' => $error,
                        ];
                    }
                }
                self::sync_parents(array_keys($parents));
                $outcome = ['outcome' => 'recovered', 'restored' => !$not_restored, 'not_restored' => $not_restored];
                WebMaven_Log::write('[WebMaven Store currency] A change to ' . $change['to'] . ' died partway; the values it wrote were put back'
                    . ($not_restored ? ', except ' . json_encode($not_restored) : '') . '.');
            }
            self::clear_caches(array_merge(array_keys($touched), array_keys($parents)), $shipping);
            self::record_last($change + $outcome);
            self::delete_journal();
            return self::last_change();
        } finally {
            self::lock_release();
        }
    }

    /** How the last Keep or Convert ended (the API reads it when it stopped waiting). */
    private static function record_last(array $last) {
        $last['at'] = self::iso(time());
        if (isset($last['not_restored']) && is_array($last['not_restored'])) {
            $last['not_restored'] = array_slice(array_values($last['not_restored']), 0, 50);
        }
        update_option(self::LAST_OPTION, $last, false);
    }

    /** The last Keep or Convert: {token, to, from, mode, rate, rate_date, outcome, converted?, restored?, not_restored?, at}, or null. */
    private static function last_change() {
        $last = get_option(self::LAST_OPTION, null);
        return is_array($last) ? $last : null;
    }

    /** The API's token for a change (letters, digits, dashes; at most 64), or ''. */
    private static function token_param($v) {
        return is_string($v) && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $v) ? $v : '';
    }

    // ── Checkout waits while a Convert is written ───────────────────────────

    /** Whether a Convert is being written or waits to be put back. */
    public static function holding() {
        $journal = get_option(self::JOURNAL_OPTION, null);
        return $journal !== null && $journal !== false;
    }

    /** Classic checkout: the order is refused with a notice while prices change. */
    public static function hold_classic_checkout($data = null, $errors = null) {
        if (!self::holding()) {
            return;
        }
        if (is_object($errors) && method_exists($errors, 'add')) {
            $errors->add('webmaven_store_currency', self::CHECKOUT_HOLD);
        } elseif (function_exists('wc_add_notice')) {
            wc_add_notice(self::CHECKOUT_HOLD, 'error');
        }
    }

    /** Block checkout (Store API): the order is refused while prices change. */
    public static function hold_store_api_checkout($order = null, $request = null) {
        if (!self::holding()) {
            return;
        }
        $route_exception = '\Automattic\WooCommerce\StoreApi\Exceptions\RouteException';
        if (class_exists($route_exception)) {
            throw new $route_exception('webmaven_store_currency', self::CHECKOUT_HOLD, 409);
        }
        throw new \Exception(self::CHECKOUT_HOLD);
    }

    /** An ISO 8601 time in UTC, or '' for none. */
    private static function iso($t) {
        return $t > 0 ? gmdate('Y-m-d\TH:i:s\Z', $t) : '';
    }

    // ── Database reads (read-only; every write goes through WooCommerce) ────
    //
    // These reads name only WordPress's tables ($wpdb's own properties) and
    // this class's fixed word lists, each cleaned to letters, digits, _ and -
    // (sql_list); ids are integers. Nothing in them comes from a request.
    // phpcs:disable WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, PluginCheck.Security.DirectDB.UnescapedDBParameter

    /** Posts of these types, any status but trash and auto-draft, by id. */
    private static function posts(array $types) {
        global $wpdb;
        return (array) $wpdb->get_results(
            "SELECT ID, post_parent, post_type, post_status, post_title FROM {$wpdb->posts}"
            . ' WHERE post_type IN (' . self::sql_list($types) . ') AND post_status NOT IN (' . self::sql_list(self::SKIPPED_STATUSES) . ')'
            . ' ORDER BY ID ASC',
            ARRAY_A
        );
    }

    /** Products, any status but trash and auto-draft. */
    private static function count_products() {
        global $wpdb;
        return (int) $wpdb->get_var(
            "SELECT COUNT(*) FROM {$wpdb->posts}"
            . " WHERE post_type IN ('product') AND post_status NOT IN (" . self::sql_list(self::SKIPPED_STATUSES) . ')'
        );
    }

    /** Product id => its product_type slug. A product without one is simple, as WooCommerce reads it. */
    private static function product_types() {
        global $wpdb;
        $rows = (array) $wpdb->get_results(
            "SELECT tr.object_id, t.slug FROM {$wpdb->term_relationships} tr"
            . " INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id"
            . " INNER JOIN {$wpdb->terms} t ON t.term_id = tt.term_id"
            . " WHERE tt.taxonomy = 'product_type'"
            . ' ORDER BY tr.object_id ASC, t.name ASC',
            ARRAY_A
        );
        $out = [];
        foreach ($rows as $r) {
            $id = (int) $r['object_id'];
            if (!isset($out[$id])) {
                $out[$id] = strtolower((string) $r['slug']);
            }
        }
        return $out;
    }

    /** Post id => [meta key => its first value], as get_post_meta($id, $key, true) reads it. */
    private static function meta(array $ids, array $keys) {
        global $wpdb;
        $out = [];
        $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
        foreach (array_chunk($ids, self::CHUNK) as $chunk) {
            $rows = (array) $wpdb->get_results(
                "SELECT post_id, meta_key, meta_value FROM {$wpdb->postmeta}"
                . ' WHERE post_id IN (' . implode(',', $chunk) . ') AND meta_key IN (' . self::sql_list($keys) . ')'
                . ' ORDER BY meta_id ASC',
                ARRAY_A
            );
            foreach ($rows as $r) {
                $id = (int) $r['post_id'];
                $key = (string) $r['meta_key'];
                if (!isset($out[$id][$key])) {
                    $out[$id][$key] = (string) $r['meta_value'];
                }
            }
        }
        return $out;
    }

    /** A quoted list of this class's own constant names (never input). */
    private static function sql_list(array $words) {
        return implode(', ', array_map(function ($w) {
            return "'" . preg_replace('/[^a-z0-9_\-]/i', '', (string) $w) . "'";
        }, $words));
    }

    // phpcs:enable WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, PluginCheck.Security.DirectDB.UnescapedDBParameter

    // ── Helpers ─────────────────────────────────────────────────────────────

    private static function woocommerce_active() {
        return class_exists('WooCommerce') && function_exists('get_woocommerce_currencies');
    }

    private static function stored_currency() {
        $v = get_option('woocommerce_currency', '');
        return is_scalar($v) ? strtoupper(trim((string) $v)) : '';
    }

    /** As WooCommerce reads it (absint of the option, 2 when it was never saved). */
    private static function stored_decimals() {
        $v = get_option('woocommerce_price_num_decimals', 2);
        return is_scalar($v) ? abs((int) $v) : 2;
    }

    private static function symbol($currency) {
        if ($currency === '' || !function_exists('get_woocommerce_currency_symbol')) {
            return '';
        }
        return html_entity_decode((string) get_woocommerce_currency_symbol($currency), ENT_QUOTES, 'UTF-8');
    }

    /** 0 to 4, from a whole number or its digits; else null. */
    private static function whole_decimals($v) {
        if (is_int($v) || (is_string($v) && ctype_digit($v))) {
            $n = (int) $v;
            return $n >= 0 && $n <= 4 ? $n : null;
        }
        return null;
    }

    /** A value as text: a string as it is, a whole number as its digits; else null. */
    private static function text($v) {
        if (is_string($v)) {
            return $v;
        }
        if (is_int($v)) {
            return (string) $v;
        }
        return null;
    }

    public static function present($value) {
        return is_string($value) && trim($value) !== '';
    }

    /** Whether rows name no value at all: absent, an empty list, or lists that are all empty. */
    private static function rows_are_empty($rows) {
        if ($rows === null) {
            return true;
        }
        if (!is_array($rows)) {
            return false;
        }
        foreach ($rows as $list) {
            if (!is_array($list) || $list) {
                return false;
            }
        }
        return true;
    }

    private static function field_name($kind, $field) {
        $names = [
            'regular' => 'regular price',
            'sale' => 'sale price',
            'amount' => 'amount',
            'minimum_amount' => 'minimum spend',
            'maximum_amount' => 'maximum spend',
            'cost' => 'cost',
            'no_class_cost' => 'cost for products without a shipping class',
            'min_amount' => 'minimum order amount',
        ];
        if (isset($names[$field])) {
            return $names[$field];
        }
        return strpos($field, 'class_cost_') === 0 ? 'shipping class cost' : $field;
    }

    private static function label(array $v) {
        $label = trim((string) ($v['label'] ?? ''));
        if ($label !== '') {
            return $label;
        }
        return $v['kind'] . ' ' . $v['id'];
    }

    private static function describe(array $v) {
        $what = ['price' => 'product', 'coupon' => 'coupon', 'shipping' => 'shipping method'][$v['kind']] ?? $v['kind'];
        return 'the ' . self::field_name($v['kind'], $v['field']) . ' of ' . $what . ' "' . self::label($v) . '"';
    }

    private static function failure_of(array $group, $error) {
        return [
            'kind' => $group['kind'],
            'id' => $group['id'],
            'fields' => array_keys($group['fields']),
            'label' => $group['label'],
            'error' => (string) $error,
        ];
    }

    private static function none_converted() {
        return ['prices' => 0, 'coupons' => 0, 'shipping' => 0];
    }

    /**
     * The answer of a set that went through, with how the plugins with a
     * currency of their own followed the store currency (plugin_currency:
     * only when one runs on the site, so every other answer keeps its
     * shape). The store's currency is the business's now: remembered for the
     * plugins installed later. $mode: initial, keep or convert; $consent: the
     * owner saw the prices a plugin holds and chose Keep.
     */
    private static function with_plugins(array $result, $currency, $decimals, $mode, $consent) {
        if (class_exists('WebMaven_Plugin_Currency')) {
            WebMaven_Plugin_Currency::remember($currency);
            $plugins = WebMaven_Plugin_Currency::follow_store($currency, $decimals, $mode, $consent);
            if ($plugins !== null) {
                $result['plugin_currency'] = $plugins;
            }
        }
        return $result;
    }

    private static function result($changed, $mode, $currency_before, $currency_after, $decimals_before, $decimals_after, array $converted) {
        return [
            'changed' => (bool) $changed,
            'mode' => $mode,
            'currency_before' => $currency_before,
            'currency_after' => $currency_after,
            'decimals_before' => $decimals_before,
            'decimals_after' => $decimals_after,
            'converted' => $converted,
        ];
    }

    /** At most 20 problems travel back; the rest are counted. */
    private static function cap_problems(array $problems) {
        if (count($problems) <= 20) {
            return array_values($problems);
        }
        $out = array_slice(array_values($problems), 0, 20);
        $out[] = 'and ' . (count($problems) - 20) . ' more';
        return $out;
    }

    private static function join_problems(array $problems) {
        return implode('; ', self::cap_problems($problems));
    }

    private static function fail($error, $code, array $extra = []) {
        return array_merge($extra, ['success' => false, 'error' => $error, 'code' => $code]);
    }
}
