<?php
/**
 * The plugin's own words a visitor reads: the marketing consent box, the
 * checkout's hold while a store's prices change, WPMaven Payments (its
 * checkout, pay page and order-received page) and the tracking line of the
 * "order complete" email and of the buyer's order note.
 *
 * The language is the one a caller names, else the site's: get_locale().
 * The table here is English, the words these screens always printed; an
 * add-on may add rows for other languages (webmaven_visitor_words_table) and
 * a way to pick a close language for one the table lacks
 * (webmaven_language_fallback_key). Without one, every visitor reads English.
 *
 * Keys as the booking request form's words: zh-TW for Chinese in traditional
 * characters, nb for Norwegian.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Visitor_Words {

    /** The rows a native speaker has checked; every other row an add-on adds is a machine translation for native review. */
    const REVIEWED = ['en'];

    const WORDS = [
        'en' => ['consent' => 'Email me news and offers from %s. Unsubscribe anytime.', 'consent_also' => 'Also email me news and offers from %s. Unsubscribe anytime.', 'consent_us' => 'Email me news and offers from us. Unsubscribe anytime.', 'consent_also_us' => 'Also email me news and offers from us. Unsubscribe anytime.', 'consent_box' => 'Email updates', 'checkout_hold' => 'This store is updating its prices right now. Please try again in a minute.', 'pay_title' => 'Card or wallet', 'pay_description' => 'Pay securely by card, Apple Pay or Google Pay. Payments are processed by Stripe.', 'pay_start_failed' => 'We could not start the payment. Please try again in a moment.', 'pay_order_missing' => 'We could not find your order. Please try again.', 'pay_not_payable' => 'This order cannot be paid online. Please check your order or contact us.', 'pay_unavailable' => 'Online payment is not available right now. Please contact us.', 'pay_item_unavailable' => 'An item in your order cannot be ordered right now. Please remove it from your cart or contact us.', 'pay_paid' => 'This order is already paid. Thank you!', 'pay_now' => 'Pay now', 'pay_note' => 'Payments are processed by Stripe.', 'pay_failed' => 'Your payment did not go through. No money was taken.', 'pay_retry' => 'Try again', 'pay_confirming' => 'Confirming your payment', 'pay_confirming_detail' => 'This usually takes a few seconds. You can keep this page open.', 'pay_js_failed' => 'Your payment did not go through. Please try again.', 'pay_js_load_failed' => 'The payment form could not load. Please refresh the page.', 'pay_js_slow' => 'This is taking longer than usual. We will email you as soon as your payment is confirmed.', 'track_on_way' => 'Your order is on its way.', 'track_on_way_with' => 'Your order is on its way with %s.', 'track_number' => ' Tracking number: %s.', 'track_link' => 'Track your parcel', 'track_here' => ' Track it here: %s'],
    ];

    /** The table: English, and the rows an add-on adds (English stays the table's own). */
    public static function table(): array {
        $table = function_exists('apply_filters') ? apply_filters('webmaven_visitor_words_table', self::WORDS) : self::WORDS;
        return is_array($table) && isset($table['en']) && is_array($table['en']) ? $table : self::WORDS;
    }

    /**
     * The WORDS key of a language code or a WordPress locale (es, pt-BR,
     * zh-Hant, zh_TW, nb_NO, no). A language the table lacks reads the first
     * of its fallback chain the table has (an add-on's: the national language
     * of the business's country, the main one, a close one), else English.
     */
    public static function language(string $code): string {
        $own = self::row($code);
        if ($own !== '') {
            return $own;
        }
        $key = function_exists('apply_filters') ? (string) apply_filters('webmaven_language_fallback_key', '', $code, [__CLASS__, 'row']) : '';
        return $key !== '' ? $key : 'en';
    }

    /** The table's own row of a code ('' when it has none). */
    public static function row(string $code): string {
        $parts = preg_split('/[_\-]/', strtolower(trim($code)));
        $base = $parts[0] ?? '';
        $table = self::table();
        if ($base === 'zh') {
            $key = array_intersect(array_slice($parts, 1), ['tw', 'hk', 'mo', 'hant']) ? 'zh-TW' : 'zh';
            return isset($table[$key]) ? $key : '';
        }
        if ($base === 'no') {
            return isset($table['nb']) ? 'nb' : '';
        }
        return isset($table[$base]) ? $base : '';
    }

    /** The language a visitor reads: the one given, else the site's (the request's, the order's in its email). */
    public static function current(string $language = ''): string {
        $code = trim($language) !== '' ? $language : (function_exists('get_locale') ? (string) get_locale() : '');
        return self::language($code);
    }

    /** A visitor word in a language (see current()). */
    public static function get(string $key, string $language = ''): string {
        $table = self::table();
        $words = $table[self::current($language)];
        return (string) ($words[$key] ?? $table['en'][$key] ?? '');
    }

    /** A visitor word with its one value in place of %s (a name, a carrier, a number, an address). */
    public static function with(string $key, string $value, string $language = ''): string {
        return str_replace('%s', $value, self::get($key, $language));
    }

    /** A key's words in every language, English first (to recognise words stored in a form). */
    public static function all(string $key): array {
        $out = [];
        foreach (self::table() as $lang => $words) {
            if (isset($words[$key])) {
                $out[$lang] = $words[$key];
            }
        }
        return $out;
    }
}
