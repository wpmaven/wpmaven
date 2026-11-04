<?php
/**
 * WebMaven Marketing Consent (email campaigns, 2026-10-03)
 *
 * WPMaven sends a business's email campaigns only to people who said yes.
 * This class collects that yes where it happens, and never assumes it:
 *
 *  - WooCommerce checkout: an UNCHECKED box, "Email me news and offers from
 *    <site>. Unsubscribe anytime.", on the classic checkout and on the block
 *    checkout. A ticked box is stored on the order (_wm_marketing_optin = yes,
 *    _wm_marketing_optin_at) and pushed to WPMaven by the contact sync.
 *  - Forms WPMaven creates (WPForms or Contact Form 7): a newsletter form
 *    carries a required consent box, every other form an optional one, never
 *    ticked in advance. A submission with the box ticked (or a signup on a
 *    newsletter form made before the box existed, whose only purpose is the
 *    newsletter) is queued to WPMaven with the form and the page as evidence.
 *
 * Off with the option webmaven_marketing_optin = 'off' or the filter
 * webmaven_marketing_optin_enabled. Nothing here may break a checkout or a
 * form: every handler bails quietly.
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/class-webmaven-log.php';

class WebMaven_Marketing_Consent {

    const META_OPTIN = '_wm_marketing_optin';
    const META_OPTIN_AT = '_wm_marketing_optin_at';
    const BLOCK_FIELD = 'wpmaven/marketing-optin';
    const CLASSIC_FIELD = 'wm_marketing_optin';
    const FORM_FIELD_CSS = 'wm-marketing-consent';
    const CF7_FIELD = 'wm-marketing-consent';
    const FORM_INTENT_OPTION = 'wm_form_intent_';
    const EVIDENCE_MAX = 300;

    public static function init() {
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

    public static function enabled() {
        $on = get_option('webmaven_marketing_optin', 'on') !== 'off';
        return (bool) apply_filters('webmaven_marketing_optin_enabled', $on);
    }

    /** The box's words, naming the business. */
    public static function label($also = false) {
        $name = trim(wp_strip_all_tags((string) get_bloginfo('name')));
        if ($name === '') $name = 'us';
        return $also
            ? sprintf('Also email me news and offers from %s. Unsubscribe anytime.', $name)
            : sprintf('Email me news and offers from %s. Unsubscribe anytime.', $name);
    }

    /** The consent field create_form adds: required on a newsletter form, optional elsewhere. */
    public static function form_field($intent) {
        $newsletter = ($intent === 'newsletter');
        return [
            'label' => self::label(!$newsletter),
            'type' => 'consent',
            'required' => $newsletter,
        ];
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
            // phpcs:ignore WordPress.Security.NonceVerification.Missing
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
