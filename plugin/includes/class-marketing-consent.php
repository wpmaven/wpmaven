<?php
/**
 * WebMaven Marketing Consent (email campaigns, 2026-10-03)
 *
 * WPMaven sends a business's email campaigns only to people who said yes.
 * This class collects that yes where it happens, and never assumes it:
 *
 *  - WooCommerce checkout: an UNCHECKED box, "Email me news and offers from
 *    <site>. Unsubscribe anytime.", on the classic checkout and on the block
 *    checkout. A ticked box is stored on the order (_webmaven_marketing_optin = yes,
 *    _webmaven_marketing_optin_at) and pushed to WPMaven by the contact sync.
 *  - Forms WPMaven creates (WPForms or Contact Form 7): a newsletter form
 *    carries a required consent box, every other form an optional one, never
 *    ticked in advance. A submission with the box ticked (or a signup on a
 *    newsletter form made before the box existed, whose only purpose is the
 *    newsletter) is queued to WPMaven with the form and the page as evidence.
 *
 * The boxes show only once the owner chose to copy the store's customers for
 * email campaigns (WebMaven_Choices, contact_sync_enabled), unless the
 * option webmaven_marketing_optin says 'on' or 'off', and the filter
 * webmaven_marketing_optin_enabled has the last word. Nothing is queued or
 * sent without that choice (WebMaven_Contact_Sync). Nothing here may break
 * a checkout or a form: every handler bails quietly.
 *
 * The box reads the site's language (WebMaven_Visitor_Words):
 * a form stores the words of the language it was made in, and prints them in
 * the page's language, the business's name kept; words an owner changed
 * stay theirs.
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/class-webmaven-log.php';
require_once __DIR__ . '/class-webmaven-visitor-words.php';
require_once __DIR__ . '/class-webmaven-choices.php';

class WebMaven_Marketing_Consent {

    const META_OPTIN = '_webmaven_marketing_optin';
    const META_OPTIN_AT = '_webmaven_marketing_optin_at';
    const BLOCK_FIELD = 'wpmaven/marketing-optin';
    const CLASSIC_FIELD = 'webmaven_marketing_optin';
    const FORM_FIELD_CSS = 'wm-marketing-consent';
    const CF7_FIELD = 'wm-marketing-consent';
    const FORM_INTENT_OPTION = 'webmaven_form_intent_';
    const EVIDENCE_MAX = 300;

    public static function init() {
        // A box already in a form reads the page's language, on or off.
        add_filter('wpforms_frontend_form_data', [__CLASS__, 'wpforms_words'], 20);
        add_filter('wpcf7_form_elements', [__CLASS__, 'cf7_words'], 20);
        if (!self::enabled()) return;
        // WooCommerce checkout (the handlers bail without WooCommerce).
        add_action('woocommerce_review_order_before_submit', [__CLASS__, 'render_classic_checkbox']);
        add_action('woocommerce_checkout_create_order', [__CLASS__, 'save_classic'], 10, 2);
        add_action('woocommerce_init', [__CLASS__, 'register_block_field']);
        add_action('woocommerce_set_additional_field_value', [__CLASS__, 'save_block'], 10, 4);
        // Site forms.
        add_action('wpforms_process_complete', [__CLASS__, 'on_wpforms_submit'], 10, 4);
        add_action('wpcf7_mail_sent', [__CLASS__, 'on_cf7_submit'], 10, 1);
    }

    /**
     * Whether the boxes show: the owner's own setting when they made one
     * ('on' or 'off'), otherwise their contact sync choice, so a site whose
     * owner never chose shows no box.
     */
    public static function enabled() {
        $set = get_option('webmaven_marketing_optin', '');
        if ($set === 'on' || $set === 'off') {
            $on = $set === 'on';
        } else {
            $on = class_exists('WebMaven_Choices') && WebMaven_Choices::on('contact_sync_enabled');
        }
        return (bool) apply_filters('webmaven_marketing_optin_enabled', $on);
    }

    /** The box's words, naming the business, in the site's language or the one given. */
    public static function label($also = false, $language = '') {
        $name = trim(wp_strip_all_tags((string) get_bloginfo('name')));
        if ($name === '') {
            return WebMaven_Visitor_Words::get($also ? 'consent_also_us' : 'consent_us', (string) $language);
        }
        return WebMaven_Visitor_Words::with($also ? 'consent_also' : 'consent', $name, (string) $language);
    }

    /** The consent field create_form adds: required on a newsletter form, optional elsewhere; its words in the form's language. */
    public static function form_field($intent, $language = '') {
        $newsletter = ($intent === 'newsletter');
        return [
            'label' => self::label(!$newsletter, $language),
            'type' => 'consent',
            'required' => $newsletter,
        ];
    }

    /**
     * Our words as a form stored them, in any language: [key, name] (name ''
     * for the words without one), or null for words an owner wrote.
     */
    public static function stored_words($text) {
        $text = trim((string) $text);
        if ($text === '') return null;
        foreach (['consent_us', 'consent_also_us'] as $key) {
            if (in_array($text, WebMaven_Visitor_Words::all($key), true)) return [$key, ''];
        }
        foreach (['consent', 'consent_also'] as $key) {
            foreach (WebMaven_Visitor_Words::all($key) as $words) {
                $parts = explode('%s', $words, 2);
                if (count($parts) === 2 && preg_match('/^' . preg_quote($parts[0], '/') . '(.+)' . preg_quote($parts[1], '/') . '$/su', $text, $m)) {
                    return [$key, $m[1]];
                }
            }
        }
        return null;
    }

    /** Stored words of ours in the page's language ('' when they are not ours or already read so). */
    public static function words_now($text) {
        $found = self::stored_words($text);
        if ($found === null) return '';
        [$key, $name] = $found;
        $now = $name === '' ? WebMaven_Visitor_Words::get($key) : WebMaven_Visitor_Words::with($key, $name);
        return $now !== trim((string) $text) ? $now : '';
    }

    /**
     * wpforms_frontend_form_data: the consent box of a form (its sentence and
     * its hidden label) in the page's language. The visitor still sends the
     * sentence the form stores, which WPForms checks against the stored form.
     */
    public static function wpforms_words($form_data) {
        try {
            if (!is_array($form_data) || !isset($form_data['fields']) || !is_array($form_data['fields'])) return $form_data;
            foreach ($form_data['fields'] as $fid => $field) {
                if (!is_array($field) || strpos((string) ($field['css'] ?? ''), self::FORM_FIELD_CSS) === false) continue;
                $label = (string) ($field['label'] ?? '');
                if ($label !== '' && in_array($label, WebMaven_Visitor_Words::all('consent_box'), true)) {
                    $form_data['fields'][$fid]['label'] = WebMaven_Visitor_Words::get('consent_box');
                }
                if (!isset($field['choices']) || !is_array($field['choices'])) continue;
                foreach ($field['choices'] as $cid => $choice) {
                    if (!is_array($choice)) continue;
                    $now = self::words_now($choice['label'] ?? '');
                    if ($now === '') continue;
                    if (empty($field['show_values'])) {
                        $form_data['fields'][$fid]['choices'][$cid]['value'] = (string) $choice['label'];
                        $form_data['fields'][$fid]['show_values'] = '1';
                    }
                    $form_data['fields'][$fid]['choices'][$cid]['label'] = $now;
                }
            }
        } catch (\Throwable $e) {
            // Never break a form.
        }
        return $form_data;
    }

    /** wpcf7_form_elements: the consent box of a Contact Form 7 form in the page's language. */
    public static function cf7_words($html) {
        try {
            if (!is_string($html) || strpos($html, self::CF7_FIELD) === false) return $html;
            return preg_replace_callback('/(<span class="wpcf7-list-item-label">)([^<]*)(<\/span>)/u', function ($m) {
                $text = html_entity_decode($m[2], ENT_QUOTES, 'UTF-8');
                $now = self::words_now($text);
                return $now === '' ? $m[0] : $m[1] . esc_html($now) . $m[3];
            }, $html);
        } catch (\Throwable $e) {
            return $html;
        }
    }

    /** Whether a field list already carries the consent box. */
    public static function fields_have_consent($fields) {
        foreach ((array) $fields as $f) {
            if (is_array($f) && (($f['type'] ?? '') === 'consent')) return true;
        }
        return false;
    }

    // ── WooCommerce checkout ───────────────────────────

    public static function render_classic_checkbox() {
        try {
            echo '<p class="form-row wm-marketing-optin">'
                . '<label class="woocommerce-form__label woocommerce-form__label-for-checkbox checkbox">'
                . '<input type="checkbox" class="woocommerce-form__input woocommerce-form__input-checkbox input-checkbox" name="'
                . esc_attr(self::CLASSIC_FIELD) . '" value="1" /> '
                . '<span>' . esc_html(self::label()) . '</span></label></p>';
        } catch (\Throwable $e) {
            // Never break the checkout.
        }
    }

    public static function save_classic($order, $data = null) {
        try {
            // WooCommerce verified the checkout nonce before this hook runs.
            // phpcs:ignore WordPress.Security.NonceVerification.Missing -- WooCommerce verified the checkout nonce before this hook runs
            $raw = isset($_POST[self::CLASSIC_FIELD]) ? sanitize_text_field(wp_unslash((string) $_POST[self::CLASSIC_FIELD])) : '';
            if ($raw === '1') self::mark_order($order);
        } catch (\Throwable $e) {
            WebMaven_Log::write('WebMaven Marketing Consent: classic checkout save failed: ' . $e->getMessage());
        }
    }

    public static function register_block_field() {
        try {
            if (!function_exists('woocommerce_register_additional_checkout_field')) return;
            woocommerce_register_additional_checkout_field([
                'id' => self::BLOCK_FIELD,
                'label' => self::label(),
                'location' => 'order',
                'type' => 'checkbox',
                'required' => false,
            ]);
        } catch (\Throwable $e) {
            WebMaven_Log::write('WebMaven Marketing Consent: block field not registered: ' . $e->getMessage());
        }
    }

    public static function save_block($key, $value, $group = null, $wc_object = null) {
        try {
            if ($key !== self::BLOCK_FIELD || empty($value)) return;
            if (is_object($wc_object) && is_a($wc_object, 'WC_Order')) self::mark_order($wc_object);
        } catch (\Throwable $e) {
            WebMaven_Log::write('WebMaven Marketing Consent: block checkout save failed: ' . $e->getMessage());
        }
    }

    private static function mark_order($order) {
        if (!is_object($order) || !method_exists($order, 'update_meta_data')) return;
        $order->update_meta_data(self::META_OPTIN, 'yes');
        $order->update_meta_data(self::META_OPTIN_AT, gmdate('Y-m-d\TH:i:s\Z'));
        // An order already in the database keeps it now; a new one is saved
        // by WooCommerce right after this hook.
        if (method_exists($order, 'get_id') && $order->get_id() && method_exists($order, 'save_meta_data')) {
            $order->save_meta_data();
        }
    }

    /** The consent an order carries, for the contact sync: [consentAt, evidence] or null. */
    public static function order_optin($order) {
        if (!is_object($order) || !method_exists($order, 'get_meta')) return null;
        if ($order->get_meta(self::META_OPTIN) !== 'yes') return null;
        $at = (string) $order->get_meta(self::META_OPTIN_AT);
        $number = method_exists($order, 'get_order_number') ? $order->get_order_number() : '';
        return [
            'consentAt' => $at !== '' ? $at : gmdate('Y-m-d\TH:i:s\Z'),
            'consentEvidence' => 'Checkout opt-in' . ($number !== '' ? ', order #' . $number : ''),
        ];
    }

    // ── Site forms ─────────────────────────────────────

    private static function intent_of($form_id) {
        return $form_id ? (string) get_option(self::FORM_INTENT_OPTION . (int) $form_id, '') : '';
    }

    public static function on_wpforms_submit($fields, $entry = null, $form_data = [], $entry_id = 0) {
        try {
            $form_data = is_array($form_data) ? $form_data : [];
            $defs = isset($form_data['fields']) && is_array($form_data['fields']) ? $form_data['fields'] : [];
            $has_box = false;
            $ticked = false;
            $email = '';
            $name = '';
            foreach ((array) $fields as $id => $f) {
                if (!is_array($f)) continue;
                $def = isset($defs[$id]) && is_array($defs[$id]) ? $defs[$id] : [];
                $css = (string) ($def['css'] ?? '');
                if (strpos($css, self::FORM_FIELD_CSS) !== false) {
                    $has_box = true;
                    $ticked = trim((string) ($f['value'] ?? '')) !== '';
                    continue;
                }
                $type = (string) ($f['type'] ?? ($def['type'] ?? ''));
                if ($type === 'email' && $email === '') $email = (string) ($f['value'] ?? '');
                $label = strtolower(trim((string) ($def['label'] ?? ($f['name'] ?? ''))));
                if ($name === '' && ($type === 'name' || ($type === 'text' && $label === 'name'))) $name = (string) ($f['value'] ?? '');
            }
            $form_id = (int) ($form_data['id'] ?? 0);
            $consent = $ticked || (!$has_box && self::intent_of($form_id) === 'newsletter');
            if (!$consent) return;
            $title = (string) ($form_data['settings']['form_title'] ?? ('form ' . $form_id));
            self::queue_form_contact($email, $name, 'Form "' . $title . '"', '');
        } catch (\Throwable $e) {
            WebMaven_Log::write('WebMaven Marketing Consent: WPForms capture failed: ' . $e->getMessage());
        }
    }

    public static function on_cf7_submit($contact_form) {
        try {
            if (!class_exists('WPCF7_Submission')) return;
            $submission = WPCF7_Submission::get_instance();
            if (!$submission) return;
            $data = (array) $submission->get_posted_data();
            $has_box = array_key_exists(self::CF7_FIELD, $data);
            $value = $has_box ? $data[self::CF7_FIELD] : '';
            $ticked = $has_box && !empty($value) && $value !== '0';
            $form_id = (is_object($contact_form) && method_exists($contact_form, 'id')) ? (int) $contact_form->id() : 0;
            $consent = $ticked || (!$has_box && self::intent_of($form_id) === 'newsletter');
            if (!$consent) return;
            $email = '';
            foreach ($data as $v) {
                if (is_string($v) && is_email($v)) { $email = $v; break; }
            }
            $name = (isset($data['name']) && is_string($data['name'])) ? $data['name'] : '';
            $title = (is_object($contact_form) && method_exists($contact_form, 'title')) ? (string) $contact_form->title() : ('form ' . $form_id);
            $page = method_exists($submission, 'get_meta') ? (string) $submission->get_meta('url') : '';
            self::queue_form_contact($email, $name, 'Form "' . $title . '"', $page);
        } catch (\Throwable $e) {
            WebMaven_Log::write('WebMaven Marketing Consent: Contact Form 7 capture failed: ' . $e->getMessage());
        }
    }

    private static function queue_form_contact($email, $name, $what, $page) {
        $email = strtolower(sanitize_email((string) $email));
        if (!$email || !is_email($email)) return;
        if ($page === '' && isset($_SERVER['HTTP_REFERER'])) {
            $page = esc_url_raw(wp_unslash((string) $_SERVER['HTTP_REFERER']));
        }
        $evidence = $what . ($page !== '' ? ' on ' . $page : '');
        if (function_exists('mb_substr')) {
            $evidence = mb_substr($evidence, 0, self::EVIDENCE_MAX);
        } else {
            $evidence = substr($evidence, 0, self::EVIDENCE_MAX);
        }
        $now = gmdate('Y-m-d\TH:i:s\Z');
        $entry = [
            'email' => $email,
            'status' => 'subscribed',
            'source' => 'form',
            'subscribedAt' => $now,
            'consent' => true,
            'consentAt' => $now,
            'consentSource' => 'form',
            'consentEvidence' => $evidence,
        ];
        $name = trim(sanitize_text_field((string) $name));
        if ($name !== '') $entry['name'] = $name;
        WebMaven_Contact_Sync::queue_consented($entry);
    }
}
