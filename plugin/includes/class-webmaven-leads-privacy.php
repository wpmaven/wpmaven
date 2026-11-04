<?php
/**
 * Form messages and WordPress's privacy tools (2026-10-05).
 *
 * - Tools, Export Personal Data: the messages sent with that email address
 *   (wp_privacy_personal_data_exporters), the visitor's text escaped.
 * - Tools, Erase Personal Data: those messages and their timeline are deleted
 *   (wp_privacy_personal_data_erasers).
 * - Settings, Privacy: a suggested paragraph for the privacy policy
 *   (wp_add_privacy_policy_content): messages stay on the site, how long
 *   they are kept, and that WPMaven reads them to show them and, when asked, to let the AI assistant summarize them or draft answers.
 *
 * A message belongs to the address in its email column (the form's email
 * field), the one the erasure request names.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!class_exists('WebMaven_Leads')) {
    require_once __DIR__ . '/class-webmaven-leads.php';
}

final class WebMaven_Leads_Privacy {

    const GROUP_ID = 'wpmaven-form-messages';
    const GROUP_LABEL = 'Form messages';
    const PAGE_SIZE = 50;

    private static $initialized = false;

    public static function init() {
        if (self::$initialized) {
            return;
        }
        self::$initialized = true;
        add_filter('wp_privacy_personal_data_exporters', [__CLASS__, 'register_exporter']);
        add_filter('wp_privacy_personal_data_erasers', [__CLASS__, 'register_eraser']);
        add_action('admin_init', [__CLASS__, 'add_policy_text']);
    }

    public static function register_exporter($exporters) {
        $exporters = is_array($exporters) ? $exporters : [];
        $exporters[self::GROUP_ID] = [
            'exporter_friendly_name' => self::GROUP_LABEL,
            'callback' => [__CLASS__, 'export_personal_data'],
        ];
        return $exporters;
    }

    public static function register_eraser($erasers) {
        $erasers = is_array($erasers) ? $erasers : [];
        $erasers[self::GROUP_ID] = [
            'eraser_friendly_name' => self::GROUP_LABEL,
            'callback' => [__CLASS__, 'erase_personal_data'],
        ];
        return $erasers;
    }

    /**
     * One page of the messages sent with $email. WordPress renders values as
     * HTML (through wp_kses), so the visitor's text is escaped here; the page
     * address is left as is so WordPress makes it a link.
     */
    public static function export_personal_data($email, $page = 1) {
        $email = WebMaven_Leads::email($email);
        $page = max(1, (int) $page);
        if ($email === '' || !WebMaven_Leads::installed()) {
            return ['data' => [], 'done' => true];
        }
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT * FROM %i WHERE email = %s ORDER BY id ASC LIMIT %d OFFSET %d',
            WebMaven_Leads::table(),
            $email,
            self::PAGE_SIZE,
            ($page - 1) * self::PAGE_SIZE
        ), ARRAY_A);
        $rows = is_array($rows) ? $rows : [];
        $items = [];
        foreach ($rows as $r) {
            $data = [
                ['name' => 'Sent', 'value' => self::esc(self::local_time($r['created_at']))],
                ['name' => 'Form', 'value' => self::esc($r['form_title'])],
            ];
            if ((string) $r['page_url'] !== '') {
                $data[] = ['name' => 'Page', 'value' => (string) $r['page_url']];
            }
            foreach (['Name' => 'name', 'Email' => 'email', 'Phone' => 'phone', 'Message' => 'message'] as $label => $column) {
                if ((string) $r[$column] !== '') {
                    $data[] = ['name' => $label, 'value' => self::esc($r[$column])];
                }
            }
            $data[] = ['name' => 'Agreed to get emails', 'value' => (int) $r['consent'] === 1 ? 'Yes' : 'No'];
            $fields = json_decode((string) $r['fields'], true);
            foreach (is_array($fields) ? $fields : [] as $f) {
                if (is_array($f) && isset($f['label'], $f['value']) && is_scalar($f['label']) && is_scalar($f['value'])) {
                    $data[] = ['name' => (string) $f['label'], 'value' => self::esc($f['value'])];
                }
            }
            if (isset($r['note']) && (string) $r['note'] !== '') {
                $data[] = ['name' => 'Note', 'value' => self::esc($r['note'])];
            }
            $items[] = [
                'group_id' => self::GROUP_ID,
                'group_label' => self::GROUP_LABEL,
                'group_description' => 'Messages sent through the forms on this site.',
                'item_id' => 'wpmaven-form-message-' . (int) $r['id'],
                'data' => $data,
            ];
        }
        return ['data' => $items, 'done' => count($rows) < self::PAGE_SIZE];
    }

    /** Deletes the messages sent with $email, a batch per call, until none is left. */
    public static function erase_personal_data($email, $page = 1) {
        $email = WebMaven_Leads::email($email);
        if ($email === '' || !WebMaven_Leads::installed()) {
            return ['items_removed' => false, 'items_retained' => false, 'messages' => [], 'done' => true];
        }
        global $wpdb;
        $unseen = WebMaven_Leads::count_unseen();
        $ids = $wpdb->get_col($wpdb->prepare(
            'SELECT id FROM %i WHERE email = %s ORDER BY id ASC LIMIT %d',
            WebMaven_Leads::table(),
            $email,
            self::PAGE_SIZE
        ));
        $ids = is_array($ids) ? $ids : [];
        $removed = $ids ? WebMaven_Leads::delete_ids($ids) : 0;
        if ($unseen > 0 && WebMaven_Leads::count_unseen() === 0) {
            WebMaven_Leads::queue_alert('resolve');
        }
        return [
            'items_removed' => $removed > 0,
            'items_retained' => false,
            'messages' => [],
            'done' => count($ids) < self::PAGE_SIZE,
        ];
    }

    public static function add_policy_text() {
        if (function_exists('wp_add_privacy_policy_content')) {
            wp_add_privacy_policy_content(self::policy_title(), self::policy_text());
        }
    }

    private static function policy_title() {
        $brand = class_exists('WebMaven_Brand') ? WebMaven_Brand::name_or('') : 'WPMaven';
        return $brand !== '' ? $brand . ': form messages' : 'Form messages';
    }

    /** The suggested text: what is kept, where, for how long, and who reads it. */
    public static function policy_text() {
        // On a White label site the service is named by its brand, never WPMaven.
        $brand = class_exists('WebMaven_Brand') ? WebMaven_Brand::name_or('') : 'WPMaven';
        $paragraphs = [
            'When you send us a message through a form on this website, we keep what you wrote and the details you entered (such as your name, email address and phone number) on this website, so we can read and answer it.',
            WebMaven_Leads::retention_sentence() . ' You can ask us for a copy of your messages, or ask us to delete them.',
            $brand !== ''
                ? $brand . ' runs this website for us. It reads your messages to show them to us, and to let our AI assistant summarize them or draft our answers when we ask. It does not keep a copy of them.'
                : 'The service that runs this website for us reads your messages to show them to us, and to let our AI assistant summarize them or draft our answers when we ask. It does not keep a copy of them.',
            'To keep spam out, we also keep a code made from your internet address, which cannot be turned back into the address. It is deleted after a day.',
        ];
        if (WebMaven_Leads::mail_mode() === 'relay') {
            $paragraphs[] = 'When we answer by email, ' . ($brand !== '' ? $brand : 'the service that runs this website') . ' sends our reply for us.';
        }
        $html = '<p class="privacy-policy-tutorial">' . esc_html('Suggested text for the messages visitors send through the forms on this website. Change it to match how you use them.') . '</p>';
        $html .= '<p><strong class="privacy-policy-tutorial">' . esc_html('Suggested text:') . ' </strong>' . esc_html(array_shift($paragraphs)) . '</p>';
        foreach ($paragraphs as $paragraph) {
            $html .= '<p>' . esc_html($paragraph) . '</p>';
        }
        return $html;
    }

    private static function esc($value) {
        return esc_html((string) $value);
    }

    private static function local_time($utc) {
        $ts = strtotime((string) $utc . ' UTC');
        if ($ts === false) {
            return '';
        }
        return function_exists('wp_date') ? (string) wp_date('Y-m-d H:i', $ts) : gmdate('Y-m-d H:i', $ts);
    }
}
