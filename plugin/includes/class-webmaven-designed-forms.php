<?php
/**
 * Designed forms (2026-10-08): the WPForms definition behind a form WPMaven
 * designed follows the page.
 *
 * The page ships the designed markup; WPForms only processes. The compile
 * pins each field of a form to an id (the markup posts wpforms[fields][id])
 * and sends the fields with their ids. The definition keeps exactly one
 * field per id, so an edit that rewords, reorders or reshapes a form never
 * sends a visitor's answer into another field.
 *
 * What a design write owns, and nothing else: the design fields (by id) and
 * the button's words and classes. It keeps fields the owner added in WPForms'
 * builder, the marketing consent box, and every setting (notifications,
 * anti-spam, confirmations) except the thank-you line while that line is
 * still the one WPMaven wrote. A field the owner added whose id a design
 * field now takes moves to a free id. Every form records which ids are
 * design fields (option wm_form_design_<id>) and what WPMaven last wrote
 * (wm_form_written_<id>).
 *
 * The design hash (design fields and button) is what the edit engine's
 * drift guard compares: a label changed in the builder since the last
 * publish shows as a change made in WordPress.
 */

if (!defined('ABSPATH')) exit;

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

final class WebMaven_Designed_Forms {

    /** Design field types to WPForms field types. */
    const TYPE_MAP = [
        'text' => 'text',
        'email' => 'email',
        'tel' => 'phone',
        'textarea' => 'textarea',
        'date' => 'date-time',
        'number' => 'number',
        'select' => 'select',
        'checkbox' => 'checkbox',
        'radio' => 'radio',
        'url' => 'url',
    ];

    /** Thank-you lines WPMaven wrote before it recorded what it wrote. */
    const LEGACY_CONFIRMATIONS = ['<p>Thank you for your submission!</p>'];

    const CONSENT_CSS = 'wm-marketing-consent';
    const DESIGN_OPTION = 'wm_form_design_';
    const WRITTEN_OPTION = 'wm_form_written_';

    /** A form holds at most this many fields from the design. */
    const MAX_FIELDS = 60;

    /** One WPForms field from a design field ({label, type, required, placeholder, options|choices, css}). */
    public static function wpforms_field(array $field, int $id, bool $labels_hidden): array {
        $type = self::TYPE_MAP[$field['type'] ?? 'text'] ?? 'text';
        $out = [
            'id' => (string) $id,
            'type' => $type,
            'label' => (string) ($field['label'] ?? ''),
            'required' => !empty($field['required']) ? '1' : '0',
            'size' => 'medium',
        ];
        if (!empty($field['placeholder'])) {
            $out['placeholder'] = sanitize_text_field($field['placeholder']);
        }
        if ($labels_hidden) {
            $out['label_hide'] = '1';
        }
        if (!empty($field['css'])) {
            $out['css'] = sanitize_text_field($field['css']);
        }
        // A line under the field (the booking request's "we will confirm").
        if (!empty($field['description'])) {
            $out['description'] = sanitize_text_field($field['description']);
        }
        // Choices: `options` is the reference shape (labels), the legacy
        // `choices` key keeps working. 1-based, an empty value submits the label.
        if (in_array($type, ['select', 'checkbox', 'radio'], true)) {
            $labels = !empty($field['options']) ? (array) $field['options'] : (array) ($field['choices'] ?? []);
            $choices = [];
            $i = 1;
            foreach ($labels as $label) {
                $choices[$i++] = ['label' => sanitize_text_field($label), 'value' => ''];
            }
            $out['choices'] = $choices ?: [1 => ['label' => 'Option 1', 'value' => '']];
        }
        // A date-only picker: without this WPForms defaults to date and time.
        if ($type === 'date-time') {
            $out['format'] = 'date';
            $out['date_format'] = 'm/d/Y';
            $out['date_type'] = 'datepicker';
        }
        return $out;
    }

    /** The marketing consent box: one checkbox whose choice is the sentence. */
    public static function consent_field(array $field, int $id): array {
        return [
            'id' => (string) $id,
            'type' => 'checkbox',
            'label' => 'Email updates',
            'label_hide' => '1',
            'required' => !empty($field['required']) ? '1' : '0',
            'size' => 'medium',
            'css' => self::CONSENT_CSS,
            'choices' => [1 => ['label' => sanitize_text_field($field['label'] ?? ''), 'value' => '']],
        ];
    }

    public static function is_consent($field): bool {
        return is_array($field) && strpos((string) ($field['css'] ?? ''), self::CONSENT_CSS) !== false;
    }

    /**
     * The design fields of a field list, keyed by id in the list's order: an
     * id the design pinned is kept, the others are numbered around them. The
     * consent box (type consent) is returned apart.
     * @return array{0: array<int, array>, 1: ?array}
     */
    public static function design_fields(array $fields, bool $labels_hidden): array {
        $pinned = [];
        foreach ($fields as $f) {
            if (is_array($f) && ($f['type'] ?? '') !== 'consent' && self::id_of($f) !== null) {
                $pinned[self::id_of($f)] = true;
            }
        }
        $design = [];
        $consent = null;
        $auto = 0;
        foreach ($fields as $f) {
            if (!is_array($f)) {
                continue;
            }
            if (($f['type'] ?? '') === 'consent') {
                $consent = $f;
                continue;
            }
            $id = self::id_of($f);
            if ($id === null || isset($design[$id])) {
                while (isset($pinned[$auto]) || isset($design[$auto])) {
                    $auto++;
                }
                $id = $auto++;
            }
            $design[$id] = self::wpforms_field($f, $id, $labels_hidden);
        }
        return [$design, $consent];
    }

    private static function id_of(array $field) {
        $raw = $field['id'] ?? null;
        if (is_int($raw) || (is_string($raw) && preg_match('/^\d{1,4}$/', $raw))) {
            return (int) $raw;
        }
        return null;
    }

    /** The ids of a stored form that are design fields (all but the consent box for a form made before they were recorded). */
    public static function design_ids(int $form_id, array $data): array {
        $saved = $form_id > 0 ? get_option(self::DESIGN_OPTION . $form_id, null) : null;
        if (is_array($saved)) {
            return array_map('intval', $saved);
        }
        $ids = [];
        foreach ((array) ($data['fields'] ?? []) as $key => $f) {
            if (is_array($f) && !self::is_consent($f)) {
                $ids[] = (int) ($f['id'] ?? $key);
            }
        }
        return $ids;
    }

    /**
     * The definition's fields after a design write: the design fields (spec
     * order), the fields the owner added in WPForms, then the consent box
     * (the stored one, else $consent_new when given). A kept field whose id
     * a design field takes moves to a free id.
     * @return array{0: array<int, array>, 1: int} the fields by id, the next free id
     */
    public static function merge_fields(array $design, array $existing, array $previous_design_ids, $consent_new, int $counter): array {
        $out = $design;
        $all_ids = array_keys($design);
        $builder = [];
        $consent = null;
        foreach ($existing as $key => $f) {
            if (!is_array($f)) {
                continue;
            }
            $id = (int) ($f['id'] ?? $key);
            $all_ids[] = $id;
            if (self::is_consent($f)) {
                $consent = [$id, $f];
                continue;
            }
            if (in_array($id, $previous_design_ids, true)) {
                continue;
            }
            $builder[] = [$id, $f];
        }
        $next = max($counter, $all_ids ? max($all_ids) + 1 : 0);
        foreach ($builder as [$id, $f]) {
            if (isset($out[$id])) {
                $id = $next++;
                $f['id'] = (string) $id;
            }
            $out[$id] = $f;
        }
        if ($consent) {
            [$id, $f] = $consent;
            if (isset($out[$id])) {
                $id = $next++;
                $f['id'] = (string) $id;
            }
            $out[$id] = $f;
        } elseif (is_array($consent_new)) {
            $id = $next++;
            $out[$id] = self::consent_field($consent_new, $id);
        }
        $next = max($next, $out ? max(array_keys($out)) + 1 : 0);
        return [$out, $next];
    }

    /** The thank-you line as WPForms stores it. */
    public static function confirmation_html(string $text): string {
        return '<p>' . esc_html($text) . '</p>';
    }

    /** WPForms' own thank-you line, in the site's language. */
    public static function default_confirmation_html(): string {
        // WPForms' words, as WPForms wrote them in the site's language.
        $text = 'Thanks for contacting us! We will be in touch with you shortly.';
        if (function_exists('get_translations_for_domain')) {
            $text = (string) get_translations_for_domain('wpforms-lite')->translate($text);
        }
        return '<p>' . esc_html($text) . '</p>';
    }

    /**
     * The designed thank-you line ($text, plain), unless the owner set their
     * own: a line other than the one WPMaven wrote, or a redirect or a page
     * instead of a message, stays.
     */
    public static function apply_confirmation(array &$settings, int $form_id, string $text): void {
        $text = trim($text);
        if ($text === '') {
            return;
        }
        $current = $settings['confirmations'][1] ?? null;
        if (is_array($current)) {
            if (($current['type'] ?? 'message') !== 'message') {
                return;
            }
            $message = trim((string) ($current['message'] ?? ''));
            $written = $form_id > 0 ? get_option(self::WRITTEN_OPTION . $form_id, []) : [];
            $ours = is_array($written) && isset($written['confirmation']) && trim((string) $written['confirmation']) === $message;
            if ($message !== '' && !$ours && !in_array($message, self::LEGACY_CONFIRMATIONS, true) && $message !== self::default_confirmation_html()) {
                return;
            }
        }
        $settings['confirmations'] = is_array($settings['confirmations'] ?? null) ? $settings['confirmations'] : [];
        $settings['confirmations'][1] = array_merge(is_array($current) ? $current : [], [
            'type' => 'message',
            'message' => self::confirmation_html($text),
        ]);
    }

    /** Answering the notification email answers the visitor: Reply-To is the form's email field, unless set. */
    public static function apply_reply_to(array &$settings, array $fields): void {
        if (!isset($settings['notifications'][1]) || !is_array($settings['notifications'][1])) {
            return;
        }
        if (trim((string) ($settings['notifications'][1]['replyto'] ?? '')) !== '') {
            return;
        }
        foreach ($fields as $id => $f) {
            if (is_array($f) && ($f['type'] ?? '') === 'email') {
                $settings['notifications'][1]['replyto'] = '{field_id="' . (int) ($f['id'] ?? $id) . '"}';
                return;
            }
        }
    }

    /** What WPMaven wrote: the design ids and the thank-you line. */
    public static function record(int $form_id, array $design_ids, array $settings): void {
        if ($form_id <= 0) {
            return;
        }
        update_option(self::DESIGN_OPTION . $form_id, array_values(array_map('intval', $design_ids)), false);
        $message = $settings['confirmations'][1]['message'] ?? null;
        update_option(self::WRITTEN_OPTION . $form_id, ['confirmation' => is_string($message) ? $message : null], false);
    }

    /** The design hash of a stored definition: its design fields and its button. */
    public static function design_sha(int $form_id, array $data): string {
        $ids = self::design_ids($form_id, $data);
        $fields = [];
        foreach ((array) ($data['fields'] ?? []) as $key => $f) {
            if (!is_array($f)) {
                continue;
            }
            $id = (int) ($f['id'] ?? $key);
            if (!in_array($id, $ids, true)) {
                continue;
            }
            $choices = [];
            foreach ((array) ($f['choices'] ?? []) as $c) {
                if (is_array($c)) {
                    $choices[] = (string) ($c['label'] ?? '');
                }
            }
            $fields[$id] = [(string) ($f['type'] ?? ''), (string) ($f['label'] ?? ''), (string) ($f['required'] ?? '0'), (string) ($f['placeholder'] ?? ''), $choices];
        }
        ksort($fields);
        return hash('sha256', (string) json_encode([$fields, (string) ($data['settings']['submit_text'] ?? '')]));
    }

    /** The design hash of the form registered under a name, or null when the site has no such form. */
    public static function sha_by_name(string $name) {
        $post = self::form_post((int) get_option('wm_form_' . sanitize_key($name), 0));
        $data = $post ? json_decode((string) $post->post_content, true) : null;
        return is_array($data) ? self::design_sha((int) $post->ID, $data) : null;
    }

    /** The live WPForms post of an id, or null. */
    private static function form_post(int $id) {
        $post = $id > 0 ? get_post($id) : null;
        return ($post && $post->post_type === 'wpforms' && $post->post_status !== 'trash') ? $post : null;
    }

    private static function error(string $code, string $message): Exception {
        return new Exception($code . ': ' . $message);
    }

    /**
     * wm_form_sync {name, intent?, spec: {fields, submit_text?, submit_class?,
     * form_class?, labels_hidden?}, confirmation?}
     *   -> {id, sha256, field_id, created, shortcode}
     * A form the site lost is created again (create_form).
     */
    public static function sync($params = [], $step_id = null): array {
        $params = is_array($params) ? $params : [];
        $name = sanitize_key((string) ($params['name'] ?? ''));
        if ($name === '') {
            throw self::error('VALIDATION', 'Name the form to update.');
        }
        $spec = $params['spec'] ?? null;
        if (!is_array($spec) || !isset($spec['fields']) || !is_array($spec['fields'])) {
            throw self::error('VALIDATION', 'The form has no fields to write.');
        }
        if (count($spec['fields']) > self::MAX_FIELDS) {
            throw self::error('VALIDATION', 'A form holds at most ' . self::MAX_FIELDS . ' fields.');
        }
        if (!function_exists('wpforms')) {
            throw self::error('NOT_SUPPORTED', 'WPForms is not active on this site, so its forms cannot change. Turn WPForms on, then publish again.');
        }
        $intent = sanitize_key((string) ($params['intent'] ?? '')) ?: 'contact';
        $confirmation = sanitize_text_field((string) ($params['confirmation'] ?? ''));

        $id = (int) get_option('wm_form_' . $name, 0);
        $post = self::form_post($id);
        if (!$post) {
            $made = (new WebMaven_Webhook_Actions())->webhook_create_form([
                'intent' => $intent,
                'title' => $name,
                'name' => $name,
                'spec' => $spec,
                'confirmation' => $confirmation,
            ]);
            if (empty($made['success']) || empty($made['id'])) {
                throw self::error('WRITE_FAILED', 'The form could not be added to the site again.');
            }
            return [
                'id' => (int) $made['id'],
                'sha256' => (string) ($made['sha256'] ?? ''),
                'field_id' => (int) ($made['field_id'] ?? 0),
                'created' => true,
                'shortcode' => (string) ($made['shortcode'] ?? ''),
            ];
        }

        $data = json_decode((string) $post->post_content, true);
        if (!is_array($data)) {
            throw self::error('WRITE_FAILED', 'This form\'s settings in WordPress cannot be read, so it was left as it is.');
        }
        [$design] = self::design_fields($spec['fields'], !empty($spec['labels_hidden']));
        $consent_new = null;
        if (class_exists('WebMaven_Marketing_Consent') && WebMaven_Marketing_Consent::enabled()) {
            $consent_new = WebMaven_Marketing_Consent::form_field($intent);
        }
        [$fields, $field_id] = self::merge_fields($design, (array) ($data['fields'] ?? []), self::design_ids($id, $data), $consent_new, (int) ($data['field_id'] ?? 0));

        $settings = is_array($data['settings'] ?? null) ? $data['settings'] : [];
        if (!empty($spec['submit_text'])) {
            $settings['submit_text'] = sanitize_text_field($spec['submit_text']);
        }
        if (!empty($spec['submit_class'])) {
            $settings['submit_class'] = sanitize_text_field($spec['submit_class']);
        }
        if (!empty($spec['form_class'])) {
            $settings['form_class'] = sanitize_text_field($spec['form_class']);
        }
        self::apply_confirmation($settings, $id, $confirmation);
        self::apply_reply_to($settings, $fields);

        $data['id'] = (string) $id;
        $data['fields'] = $fields;
        $data['field_id'] = $field_id;
        $data['settings'] = $settings;
        // Slashed, as WPForms saves it (wp_update_post unslashes its input).
        $saved = wp_update_post(['ID' => $id, 'post_content' => wp_slash(wp_json_encode($data))], true);
        if (is_wp_error($saved) || !$saved) {
            throw self::error('WRITE_FAILED', 'The form could not be saved in WordPress.');
        }
        self::record($id, array_keys($design), $settings);
        return [
            'id' => $id,
            'sha256' => self::design_sha($id, $data),
            'field_id' => $field_id,
            'created' => false,
            'shortcode' => '[wpforms id="' . $id . '"]',
        ];
    }

    /** WPForms field types back to the design's words. */
    const DESIGN_TYPE = [
        'text' => 'text', 'email' => 'email', 'phone' => 'tel', 'textarea' => 'textarea',
        'date-time' => 'date', 'number' => 'number', 'number-slider' => 'number', 'select' => 'select',
        'checkbox' => 'checkbox', 'radio' => 'radio', 'url' => 'url', 'name' => 'text',
    ];

    /** A form holds at most this many recipients for each message. */
    const MAX_RECIPIENTS = 5;
    const MAX_CONFIRMATION = 240;

    /** The plain words of a stored thank-you message. */
    private static function plain($html): string {
        $text = wp_strip_all_tags((string) $html);
        return trim(preg_replace('/\s+/u', ' ', html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8')));
    }

    /** The recipients of a form's first notification, as written ({admin_email} stays a token). */
    private static function recipients_of(array $settings): array {
        $raw = (string) ($settings['notifications'][1]['email'] ?? '');
        $out = [];
        foreach (preg_split('/[,;\s]+/', $raw) as $one) {
            $one = trim($one);
            if ($one !== '' && !in_array($one, $out, true)) {
                $out[] = $one;
            }
        }
        return $out;
    }

    /** What the owner reads about a form's settings. */
    private static function settings_view(array $settings): array {
        $c = $settings['confirmations'][1] ?? [];
        $type = is_array($c) ? (string) ($c['type'] ?? 'message') : 'message';
        return [
            'confirmation' => $type === 'message' && is_array($c) ? self::plain($c['message'] ?? '') : '',
            'confirmation_type' => $type,
            'recipients' => self::recipients_of($settings),
            'notifications_on' => (string) ($settings['notification_enable'] ?? '1') !== '0',
        ];
    }

    /** How many messages came through a WPForms form (the leads table), or null. */
    private static function messages_for(int $form_id) {
        global $wpdb;
        if (!class_exists('WebMaven_Leads') || !method_exists('WebMaven_Leads', 'installed') || !WebMaven_Leads::installed() || !isset($wpdb)) {
            return null;
        }
        $table = WebMaven_Leads::table();
        $n = $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$table} WHERE source = %s AND form_id = %d", 'wpforms', $form_id)); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- the plugin's own table name
        return $n === null ? null : (int) $n;
    }

    /** One stored form, as wm_form_read answers it. */
    private static function read_one(string $name) {
        $id = (int) get_option('wm_form_' . $name, 0);
        $post = self::form_post($id);
        if (!$post) {
            return null;
        }
        $data = json_decode((string) $post->post_content, true);
        if (!is_array($data)) {
            return null;
        }
        $design = self::design_ids($id, $data);
        $fields = [];
        foreach ((array) ($data['fields'] ?? []) as $key => $f) {
            if (!is_array($f)) {
                continue;
            }
            $fid = (int) ($f['id'] ?? $key);
            $choices = [];
            foreach ((array) ($f['choices'] ?? []) as $c) {
                if (is_array($c)) {
                    $choices[] = (string) ($c['label'] ?? '');
                }
            }
            $fields[] = [
                'id' => $fid,
                'type' => self::DESIGN_TYPE[(string) ($f['type'] ?? '')] ?? (string) ($f['type'] ?? 'text'),
                'label' => (string) ($f['label'] ?? ''),
                'required' => (string) ($f['required'] ?? '0') === '1',
                'placeholder' => (string) ($f['placeholder'] ?? ''),
                'choices' => $choices,
                'origin' => self::is_consent($f) ? 'consent' : (in_array($fid, $design, true) ? 'design' : 'wpforms'),
            ];
        }
        $settings = is_array($data['settings'] ?? null) ? $data['settings'] : [];
        return array_merge([
            'id' => $id,
            'provider' => 'wpforms',
            'title' => (string) ($settings['form_title'] ?? $post->post_title),
            'intent' => (string) get_option('wm_form_intent_' . $id, ''),
            'field_id' => (int) ($data['field_id'] ?? 0),
            'sha256' => self::design_sha($id, $data),
            'fields' => $fields,
            'submit_text' => (string) ($settings['submit_text'] ?? ''),
            'admin_email' => (string) get_option('admin_email', ''),
            'messages' => self::messages_for($id),
        ], self::settings_view($settings));
    }

    /**
     * wm_form_read {names: [string]} -> {forms: {name: {...} | null}, provider}
     * Each designed form with its fields (origin: design, consent, or wpforms
     * for one added in WPForms' builder), its thank-you message, who gets an
     * email, and how many messages it received.
     */
    public static function read($params = [], $step_id = null): array {
        $params = is_array($params) ? $params : [];
        $names = array_slice(array_values(array_filter(array_map(function ($n) {
            return sanitize_key((string) $n);
        }, (array) ($params['names'] ?? [])))), 0, 50);
        $active = function_exists('wpforms');
        $forms = [];
        foreach ($names as $name) {
            $forms[$name] = $active ? self::read_one($name) : null;
        }
        return ['forms' => $forms, 'provider' => $active ? 'wpforms' : 'none'];
    }

    /**
     * wm_form_settings {name, confirmation?, recipients?, remove_fields?, restore_fields?}
     *   -> {before, after, sha256}
     * The thank-you message (plain text), who gets an email for each message
     * (one to five addresses, {admin_email} for the owner; none turns the
     * email off) and fields added in WPForms' builder taken out (or put back
     * by an undo). Design fields and the consent box never change here.
     */
    public static function settings($params = [], $step_id = null): array {
        $params = is_array($params) ? $params : [];
        $name = sanitize_key((string) ($params['name'] ?? ''));
        if ($name === '') {
            throw self::error('VALIDATION', 'Name the form to change.');
        }
        if (!function_exists('wpforms')) {
            throw self::error('NOT_SUPPORTED', 'WPForms is not active on this site, so its forms cannot change. Turn WPForms on, then try again.');
        }
        $id = (int) get_option('wm_form_' . $name, 0);
        $post = self::form_post($id);
        if (!$post) {
            throw self::error('TARGET_NOT_FOUND', 'This form is not on your site any more.');
        }
        $data = json_decode((string) $post->post_content, true);
        if (!is_array($data)) {
            throw self::error('WRITE_FAILED', 'This form\'s settings in WordPress cannot be read, so it was left as it is.');
        }
        $settings = is_array($data['settings'] ?? null) ? $data['settings'] : [];
        $fields = (array) ($data['fields'] ?? []);
        $before = self::settings_view($settings);
        $before_fields = [];

        if (array_key_exists('confirmation', $params)) {
            $text = trim(preg_replace('/\s+/u', ' ', (string) $params['confirmation']));
            if ($text === '') {
                throw self::error('VALIDATION', 'Write the message shown after sending.');
            }
            if (function_exists('mb_strlen') ? mb_strlen($text) > self::MAX_CONFIRMATION : strlen($text) > self::MAX_CONFIRMATION) {
                throw self::error('VALIDATION', 'The thank-you message has at most ' . self::MAX_CONFIRMATION . ' characters.');
            }
            $current = is_array($settings['confirmations'][1] ?? null) ? $settings['confirmations'][1] : [];
            $settings['confirmations'] = is_array($settings['confirmations'] ?? null) ? $settings['confirmations'] : [];
            $settings['confirmations'][1] = array_merge($current, ['type' => 'message', 'message' => self::confirmation_html($text)]);
        }

        if (array_key_exists('recipients', $params)) {
            $list = [];
            foreach ((array) $params['recipients'] as $r) {
                $r = trim((string) $r);
                if ($r === '{admin_email}') {
                    $list[] = $r;
                    continue;
                }
                $r = strtolower($r);
                if (!is_email($r)) {
                    throw self::error('VALIDATION', $r . ' is not an email address.');
                }
                $list[] = $r;
            }
            $list = array_values(array_unique($list));
            if (count($list) > self::MAX_RECIPIENTS) {
                throw self::error('VALIDATION', 'Choose one to five addresses.');
            }
            if (!$list) {
                $settings['notification_enable'] = '0';
            } else {
                $settings['notification_enable'] = '1';
                $settings['notifications'] = is_array($settings['notifications'] ?? null) ? $settings['notifications'] : [];
                $first = is_array($settings['notifications'][1] ?? null) ? $settings['notifications'][1] : [
                    'subject' => 'New ' . (string) ($settings['form_title'] ?? $post->post_title) . ' submission',
                    'sender_name' => get_bloginfo('name'),
                    'sender_address' => '{admin_email}',
                    'message' => '{all_fields}',
                ];
                $first['email'] = implode(', ', $list);
                $settings['notifications'][1] = $first;
                self::apply_reply_to($settings, $fields);
            }
        }

        $design = self::design_ids($id, $data);
        foreach ((array) ($params['remove_fields'] ?? []) as $rid) {
            $rid = (int) $rid;
            foreach ($fields as $key => $f) {
                if (!is_array($f) || (int) ($f['id'] ?? $key) !== $rid) {
                    continue;
                }
                if (self::is_consent($f)) {
                    throw self::error('VALIDATION', 'The box asking to receive emails stays on every form: it is how people agree to your newsletters.');
                }
                if (in_array($rid, $design, true)) {
                    throw self::error('VALIDATION', 'This field is part of the form\'s design: remove it from the form itself.');
                }
                $before_fields[] = $f;
                unset($fields[$key]);
            }
        }
        foreach ((array) ($params['restore_fields'] ?? []) as $f) {
            if (!is_array($f) || !isset($f['id']) || !preg_match('/^\d{1,4}$/', (string) $f['id'])) {
                continue;
            }
            $rid = (int) $f['id'];
            $taken = false;
            foreach ($fields as $key => $g) {
                if (is_array($g) && (int) ($g['id'] ?? $key) === $rid) {
                    $taken = true;
                }
            }
            if (!$taken) {
                $fields[$rid] = map_deep($f, 'sanitize_text_field');
            }
        }

        $data['fields'] = $fields;
        $data['settings'] = $settings;
        $saved = wp_update_post(['ID' => $id, 'post_content' => wp_slash(wp_json_encode($data))], true);
        if (is_wp_error($saved) || !$saved) {
            throw self::error('WRITE_FAILED', 'The form could not be saved in WordPress.');
        }
        return [
            'before' => array_merge($before, ['fields' => $before_fields]),
            'after' => self::settings_view($settings),
            'sha256' => self::design_sha($id, $data),
            'admin_email' => (string) get_option('admin_email', ''),
        ];
    }

    /**
     * WPForms' anti-spam check for WPMaven's forms: a theme compiled before
     * the theme asked for the form's own token hands out the site-wide one;
     * it is accepted too, on these forms only.
     */
    public static function accept_site_token($valid, $fields = [], $entry = [], $form_data = []) {
        if ($valid) {
            return $valid;
        }
        try {
            $id = (int) ($form_data['id'] ?? 0);
            $token = is_array($entry) && isset($entry['token']) ? (string) $entry['token'] : '';
            if ($id <= 0 || $token === '' || !get_option('wm_form_intent_' . $id) || !function_exists('wpforms')) {
                return $valid;
            }
            $wpforms = wpforms();
            $obj = method_exists($wpforms, 'obj') ? $wpforms->obj('token') : (method_exists($wpforms, 'get') ? $wpforms->get('token') : null);
            if ($obj && method_exists($obj, 'get_valid_tokens') && in_array($token, (array) $obj->get_valid_tokens([]), true)) {
                return true;
            }
        } catch (\Throwable $e) {
            // Never break a submission here.
        }
        return $valid;
    }
}
