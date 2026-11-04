<?php
/**
 * Form messages kept on the site (2026-10-05).
 *
 * Every message a visitor sends through a form (WPForms, Contact Form 7,
 * Gravity Forms) is kept in the site's own table {prefix}wpmaven_leads, with
 * its timeline (replies, status changes, notes, exports) in
 * {prefix}wpmaven_lead_events. The owner reads and answers them in the
 * plugin's Messages screen (WebMaven_Leads_Routes) and in the dashboard,
 * which reads them live through signed commands (capabilities/leads.php).
 * WPMaven keeps no copy of a message.
 *
 * - Capture: wpforms_process_complete (priority 20, after the consent
 *   capture), wpcf7_mail_sent and wpcf7_mail_failed (a message is kept even
 *   when the site cannot send mail) and gform_after_submission. The email,
 *   name and phone are found by field type, then by label; the longest text
 *   area is the message (at most 5,000 characters); every field is kept as
 *   label and value, tags stripped (at most 50). The consent box
 *   WebMaven_Marketing_Consent adds (or a signup on a newsletter form without
 *   one) sets consent. A capture failure never breaks a submission.
 * - Spam: the form plugin's own verdict, plus more than 20 messages an hour
 *   from one visitor address. The address is kept only as a salted hash for
 *   that count, and blanked after a day. Past 100 an hour from one address
 *   nothing more is kept (a flood).
 * - The owner is told: a new message that is not spam raises
 *   FORM_SUBMISSIONS through the site alert push (POST /alerts/report) at the
 *   end of the request, with a count only, never a name or a word of the
 *   message. It is reported resolved once no new message is left unread.
 * - Retention: a daily clean-up (webmaven_leads_purge) deletes messages
 *   older than webmaven_leads_retention_days (365 by default, 3, 6, 12 or 24
 *   months from the settings) and spam after 30 days, with their timeline.
 *   Deleting the plugin keeps them unless the owner chose to remove the
 *   plugin's data (webmaven_remove_data_on_uninstall, see uninstall.php).
 * - Replies: to the sender, Reply-To the business email, the text escaped
 *   into paragraphs. A hosted site sends it with wp_mail, which WPMaven's
 *   mail relay takes (WPMaven Agent's). A connected site without its own
 *   mail setup sends it through its account (POST /sites/leads/reply), and
 *   with its own mail once when the account cannot take it. A site with its
 *   own mail setup (an SMTP plugin, a mail plugin that replaced wp_mail) uses
 *   it. The relay's monthly cap answers in words. mail_mode() says which.
 *
 * The tables are created here (dbDelta behind webmaven_leads_db_version) on
 * admin_init and on first use, never by the plugin's create_tables().
 *
 * Failures of the inbox operations THROW an Exception "CODE: sentence"
 * (NOT_FOUND, VALIDATION, RATE_LIMITED, MAIL_FAILED, WRITE_FAILED): the
 * commands pass it to the API as is, the REST routes turn it into a WP_Error.
 * Visitor text is plain text everywhere it is returned, and never logged.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-webmaven-log.php';

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

require_once __DIR__ . '/class-webmaven-hosting.php';
require_once __DIR__ . '/class-webmaven-site-mail.php';

final class WebMaven_Leads {

    const DB_VERSION = '1';
    const DB_VERSION_OPTION = 'webmaven_leads_db_version';
    /** Days a message is kept (the settings write 90, 180, 365 or 730). */
    const RETENTION_OPTION = 'webmaven_leads_retention_days';
    /** The owner's "Remove WPMaven's data when the plugin is deleted" ('1' or '0'). */
    const REMOVE_DATA_OPTION = 'webmaven_remove_data_on_uninstall';
    const PURGE_HOOK = 'webmaven_leads_purge';

    /** Who reads and answers messages: editors and above, by default. */
    const CAPABILITY_FILTER = 'wpmaven_messages_capability';
    const DEFAULT_CAPABILITY = 'edit_others_posts';
    /** Who changes how long messages are kept and what deleting the plugin removes. */
    const SETTINGS_CAPABILITY = 'manage_options';

    const ALERT_TYPE = 'FORM_SUBMISSIONS';
    const ALERT_TITLE = 'New messages from your website';
    const ALERT_MESSAGE = "People wrote to you through your site's forms. Open Messages to read and answer them.";
    const ALERT_TIMEOUT = 5;

    /** The account's route that sends a connected site's reply (site token): {to, subject, html, replyTo, fromName} -> {sent}. */
    const REPLY_ROUTE = '/sites/leads/reply';
    const REPLY_TIMEOUT = 15;

    /** The class the consent box carries (WPForms css, Gravity Forms cssClass) and the Contact Form 7 field name. */
    const CONSENT_MARK = 'wm-marketing-consent';
    /** What a form WPMaven made is for (create_form writes wm_form_intent_<form id>). */
    const INTENT_OPTION = 'wm_form_intent_';

    const STATUSES = ['new', 'answered', 'archived', 'spam'];
    const SOURCES = ['wpforms', 'cf7', 'gravityforms'];
    const INTENTS = ['contact', 'quote', 'booking', 'feedback', 'newsletter', 'order'];
    /**
     * A message is a conversation (someone expects an answer) or a signup (a
     * newsletter or another list): the form's own purpose decides, else
     * whether the person wrote a message. Signups never raise the alert, and
     * the AI team never lists or quotes them one by one.
     */
    const KINDS = ['conversation', 'signup'];
    const SIGNUP_SQL = "(intent = 'newsletter' OR (intent = '' AND COALESCE(message, '') = ''))";
    const EVENT_KINDS = ['reply', 'status', 'note', 'export'];

    const RETENTION_DAYS = 365;
    /** Months the settings offer, and the days each one keeps. */
    const RETENTION_MONTHS = [3 => 90, 6 => 180, 12 => 365, 24 => 730];
    const RETENTION_DAYS_MIN = 30;
    const RETENTION_DAYS_MAX = 1100;
    const SPAM_KEEP_DAYS = 30;
    const IP_HASH_KEEP_SECONDS = 86400;
    const DAY = 86400;
    const HOUR = 3600;

    const MESSAGE_MAX = 5000;
    const FIELDS_MAX = 50;
    const FIELD_VALUE_MAX = 5000;
    /** All the fields of one message together, in bytes. */
    const FIELDS_BYTES_MAX = 100000;
    const LABEL_MAX = 200;
    const NAME_MAX = 200;
    const PHONE_MAX = 50;
    const EMAIL_MAX = 254;
    const PAGE_URL_MAX = 500;
    const FIRST_LINE_MAX = 140;

    const SPAM_PER_HOUR = 20;
    const FLOOD_PER_HOUR = 100;

    const REPLY_MAX = 10000;
    const SUBJECT_MAX = 200;
    const REPLIES_PER_HOUR = 30;
    const NOTE_MAX = 2000;
    const SEARCH_MAX = 100;
    const PER_PAGE = 25;
    const PER_PAGE_MAX = 50;
    const EXPORT_MAX = 10000;
    const EVENTS_SHOWN = 100;
    const PURGE_BATCH = 500;
    const PURGE_ROUNDS = 40;

    // ── Owner-facing copy ──────────────────────────────────────────────────

    const COPY_EMPTY = 'No messages yet. When someone fills in a form on your site, it shows up here.';
    const COPY_REPLY_SITE = "Your site sends this email. If replies do not arrive, check your site's email settings.";

    /** "Messages are kept for 12 months, then deleted." */
    public static function retention_sentence($months = null) {
        $months = $months === null ? self::retention_months() : (int) $months;
        return 'Messages are kept for ' . $months . ' months, then deleted.';
    }

    /** What deleting the plugin does to the messages, as the owner set it. */
    public static function uninstall_sentence($remove = null) {
        $remove = $remove === null ? self::remove_on_uninstall() : (bool) $remove;
        $data = self::brand_possessive() . ' data';
        return $remove
            ? 'Deleting the plugin deletes them too, because you chose to remove ' . $data . '.'
            : 'Deleting the plugin keeps them unless you chose to remove ' . $data . '.';
    }

    // ── Field recognition ──────────────────────────────────────────────────

    /** Labels (lowercase) that name the person as a whole. */
    const NAME_LABELS = [
        'name', 'your name', 'full name', 'fullname', 'nom', 'votre nom', 'nom complet', 'prénom et nom', 'nom et prénom',
        'nombre', 'tu nombre', 'nombre completo', 'nome', 'nome completo', 'naam', 'volledige naam', 'vor- und nachname',
        'vollständiger name', 'contact name',
    ];
    const FIRST_NAME_LABELS = ['first name', 'firstname', 'given name', 'your first name', 'prénom', 'prenom', 'vorname', 'voornaam', 'nombre de pila'];
    const LAST_NAME_LABELS = [
        'last name', 'lastname', 'surname', 'family name', 'your last name', 'nom', 'nom de famille', 'nachname', 'apellido',
        'apellidos', 'achternaam', 'cognome',
    ];
    const PHONE_LABELS = [
        'phone', 'phone number', 'your phone', 'your phone number', 'telephone', 'telephone number', 'tel', 'mobile',
        'mobile phone', 'mobile number', 'cell', 'cell phone', 'téléphone', 'telephone portable', 'portable', 'teléfono',
        'telefono', 'telefon', 'telefoon', 'telefonnummer',
    ];

    /** WPForms field types: what each one is, or skip (layout, protection, payment). */
    const WPFORMS_ROLES = ['email' => 'email', 'name' => 'name', 'phone' => 'phone', 'textarea' => 'textarea'];
    const WPFORMS_SKIP = [
        'html', 'divider', 'pagebreak', 'content', 'captcha', 'entry-preview', 'layout', 'repeater', 'password',
        'credit-card', 'stripe-credit-card', 'square', 'authorize_net', 'paypal-commerce', 'internal-information', 'submit',
    ];
    /** Contact Form 7 base types. */
    const CF7_ROLES = ['email' => 'email', 'tel' => 'phone', 'textarea' => 'textarea'];
    const CF7_SKIP = ['submit', 'acceptance', 'quiz', 'captchac', 'captchar', 'recaptcha', 'response', 'stripe'];
    /** Gravity Forms field types (the input type when it has one). */
    const GF_ROLES = ['email' => 'email', 'name' => 'name', 'phone' => 'phone', 'textarea' => 'textarea', 'post_content' => 'textarea'];
    const GF_SKIP = ['html', 'section', 'page', 'captcha', 'password', 'creditcard', 'consent', 'stripe_creditcard', 'square_creditcard', 'submit'];

    private static $initialized = false;
    private static $install_tried = false;
    /** The alert report this request sends at its end: 'raise', 'resolve' or null. */
    private static $alert = null;
    private static $alert_hooked = false;
    /** Display names already read in this request, by user id. */
    private static $names = [];

    /**
     * Hooks everything; the capability loader calls it once (a second call
     * does nothing).
     */
    public static function init() {
        if (self::$initialized) {
            return;
        }
        self::$initialized = true;
        add_action('admin_init', [__CLASS__, 'maybe_install']);
        // Capture. The consent class reads the same WPForms submission at 10.
        add_action('wpforms_process_complete', [__CLASS__, 'on_wpforms'], 20, 4);
        add_action('wpcf7_mail_sent', [__CLASS__, 'on_cf7'], 10, 1);
        add_action('wpcf7_mail_failed', [__CLASS__, 'on_cf7'], 10, 1);
        add_action('gform_after_submission', [__CLASS__, 'on_gravityforms'], 10, 2);
        // The daily clean-up, scheduled again if it ever goes missing.
        add_action(self::PURGE_HOOK, [__CLASS__, 'purge']);
        if (function_exists('wp_next_scheduled') && function_exists('wp_schedule_event') && !wp_next_scheduled(self::PURGE_HOOK)) {
            wp_schedule_event(time() + self::HOUR, 'daily', self::PURGE_HOOK);
        }
        if (defined('WEBMAVEN_WP_FILE') && function_exists('register_deactivation_hook')) {
            register_deactivation_hook(WEBMAVEN_WP_FILE, [__CLASS__, 'on_deactivate']);
        }
    }

    public static function on_deactivate() {
        if (function_exists('wp_clear_scheduled_hook')) {
            wp_clear_scheduled_hook(self::PURGE_HOOK);
        }
    }

    // ── Who, how ───────────────────────────────────────────────────────────

    /** The capability that reads and answers messages (the wpmaven_messages_capability filter). */
    public static function capability() {
        $cap = function_exists('apply_filters') ? apply_filters(self::CAPABILITY_FILTER, self::DEFAULT_CAPABILITY) : self::DEFAULT_CAPABILITY;
        return is_string($cap) && trim($cap) !== '' ? trim($cap) : self::DEFAULT_CAPABILITY;
    }

    /** Messages with status new; 0 when the table is missing. */
    public static function count_new() {
        if (!self::installed()) {
            return 0;
        }
        global $wpdb;
        return (int) $wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM %i WHERE status = %s', self::table(), 'new'));
    }

    /**
     * New conversation messages nobody has opened yet: the alert stays raised
     * while there is one (a signup never raises it).
     */
    public static function count_unseen() {
        if (!self::installed()) {
            return 0;
        }
        global $wpdb;
        // SIGNUP_SQL is this class's own fixed condition.
        return (int) $wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM %i WHERE status = %s AND seen_at IS NULL AND NOT ' . self::SIGNUP_SQL, self::table(), 'new')); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
    }

    /** 'signup' for a newsletter or list signup, else 'conversation'. */
    public static function kind_of($intent, $message) {
        $intent = (string) $intent;
        if ($intent === 'newsletter') {
            return 'signup';
        }
        return $intent === '' && trim((string) $message) === '' ? 'signup' : 'conversation';
    }

    /**
     * 'relay' when WPMaven sends this site's replies: a hosted site, whose
     * mail the relay takes (a hosted site without an SMTP plugin, or as the
     * webmaven_mail_relay_enabled filter says), or a connected site without
     * its own mail setup, through its account. Else 'site'.
     */
    public static function mail_mode() {
        return self::reply_way() === 'site' ? 'site' : 'relay';
    }

    /**
     * How a reply leaves: 'hosted' (wp_mail, which the relay takes),
     * 'account' (the account's reply route, REPLY_ROUTE) or 'site' (the
     * site's own mail).
     */
    private static function reply_way() {
        if (WebMaven_Hosting::has_mail_relay()) {
            $hosted = WebMaven_Hosting::is_hosted_site() && !WebMaven_Site_Mail::smtp_plugin_active();
            if (apply_filters('webmaven_mail_relay_enabled', $hosted, [])) {
                return 'hosted';
            }
            if ($hosted) {
                // A hosted site whose relay a filter turned off sends its own way.
                return 'site';
            }
        }
        return (self::linked() && !self::own_mail_setup()) ? 'account' : 'site';
    }

    /** The site is connected to its account: an instance id and a token. */
    private static function linked() {
        $instance = get_option('webmaven_wp_instance_id', '');
        $token = get_option('webmaven_wp_access_token', '');
        return is_scalar($instance) && (string) $instance !== '' && is_scalar($token) && (string) $token !== '';
    }

    /** The site sends mail its own way: an SMTP plugin the relay knows, or a mail plugin that replaced wp_mail(). */
    private static function own_mail_setup() {
        if (WebMaven_Site_Mail::smtp_plugin_active()) {
            return true;
        }
        return self::wp_mail_replaced();
    }

    /** wp_mail() is not WordPress's own: a mail plugin defined it first. */
    private static function wp_mail_replaced() {
        if (!defined('WPINC') || !function_exists('wp_mail')) {
            return false;
        }
        $core = realpath(ABSPATH . WPINC . '/pluggable.php');
        if ($core === false) {
            return false;
        }
        try {
            $file = (new ReflectionFunction('wp_mail'))->getFileName();
        } catch (\Throwable $e) {
            return false;
        }
        return is_string($file) && $file !== '' && realpath($file) !== $core;
    }

    public static function retention_days() {
        $days = (int) get_option(self::RETENTION_OPTION, self::RETENTION_DAYS);
        // A value no setting writes (0, 1, a typo) never empties the inbox.
        return ($days >= self::RETENTION_DAYS_MIN && $days <= self::RETENTION_DAYS_MAX) ? $days : self::RETENTION_DAYS;
    }

    /** The settings' months (3, 6, 12 or 24) closest to the days kept. */
    public static function retention_months() {
        $days = self::retention_days();
        $best = 12;
        $gap = PHP_INT_MAX;
        foreach (self::RETENTION_MONTHS as $months => $kept) {
            if (abs($kept - $days) < $gap) {
                $gap = abs($kept - $days);
                $best = $months;
            }
        }
        return $best;
    }

    public static function remove_on_uninstall() {
        return !empty(get_option(self::REMOVE_DATA_OPTION, ''));
    }

    /** GET /leads/settings: LeadsSettings, plus the sentences the screens show. */
    public static function settings() {
        $months = self::retention_months();
        $remove = self::remove_on_uninstall();
        $mail = self::mail_mode();
        return [
            'retentionMonths' => $months,
            'mail' => $mail,
            'removeOnUninstall' => $remove,
            'copy' => [
                'empty' => self::COPY_EMPTY,
                'replySite' => $mail === 'site' ? self::COPY_REPLY_SITE : null,
                'retention' => self::retention_sentence($months),
                'uninstall' => self::uninstall_sentence($remove),
            ],
        ];
    }

    /** POST /leads/settings {retentionMonths?, removeOnUninstall?}: the settings after the change. */
    public static function save_settings(array $in) {
        if (array_key_exists('retentionMonths', $in) && $in['retentionMonths'] !== null && $in['retentionMonths'] !== '') {
            $raw = $in['retentionMonths'];
            $months = is_numeric($raw) ? (int) $raw : 0;
            if (!isset(self::RETENTION_MONTHS[$months]) || (float) $raw !== (float) $months) {
                throw self::error('VALIDATION', 'Choose to keep messages for 3, 6, 12 or 24 months.');
            }
            update_option(self::RETENTION_OPTION, self::RETENTION_MONTHS[$months], false);
        }
        if (array_key_exists('removeOnUninstall', $in) && $in['removeOnUninstall'] !== null) {
            $on = is_bool($in['removeOnUninstall']) ? $in['removeOnUninstall'] : filter_var($in['removeOnUninstall'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($on === null) {
                throw self::error('VALIDATION', 'Choose whether deleting the plugin removes its data.');
            }
            update_option(self::REMOVE_DATA_OPTION, $on ? '1' : '0', false);
        }
        return self::settings();
    }

    // ── Tables ─────────────────────────────────────────────────────────────

    public static function table() {
        global $wpdb;
        return $wpdb->prefix . 'wpmaven_leads';
    }

    public static function events_table() {
        global $wpdb;
        return $wpdb->prefix . 'wpmaven_lead_events';
    }

    public static function installed() {
        return (string) get_option(self::DB_VERSION_OPTION, '') === self::DB_VERSION;
    }

    /** The tables exist (created now when needed, at most one try per request). */
    public static function maybe_install() {
        if (self::installed()) {
            return true;
        }
        if (self::$install_tried) {
            return false;
        }
        self::$install_tried = true;
        try {
            return self::install();
        } catch (\Throwable $e) {
            WebMaven_Log::write('WPMaven messages: the tables could not be created (' . get_class($e) . ').');
            return false;
        }
    }

    /** Creates or upgrades both tables (dbDelta), then records the version. */
    public static function install() {
        global $wpdb;
        if (!function_exists('dbDelta')) {
            require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        }
        $charset = method_exists($wpdb, 'get_charset_collate') ? $wpdb->get_charset_collate() : '';
        $leads = self::table();
        $events = self::events_table();
        dbDelta("CREATE TABLE {$leads} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  created_at datetime NOT NULL,
  source varchar(20) NOT NULL,
  form_id bigint(20) unsigned NOT NULL DEFAULT 0,
  form_title varchar(200) NOT NULL DEFAULT '',
  intent varchar(20) NOT NULL DEFAULT '',
  page_url varchar(500) NOT NULL DEFAULT '',
  name varchar(200) NOT NULL DEFAULT '',
  email varchar(254) NOT NULL DEFAULT '',
  phone varchar(50) NOT NULL DEFAULT '',
  message text NOT NULL,
  fields longtext NOT NULL,
  consent tinyint(1) NOT NULL DEFAULT 0,
  status varchar(12) NOT NULL DEFAULT 'new',
  seen_at datetime DEFAULT NULL,
  answered_at datetime DEFAULT NULL,
  note text NULL,
  ip_hash char(64) NOT NULL DEFAULT '',
  source_ref varchar(64) NOT NULL DEFAULT '',
  updated_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY created (created_at),
  KEY status_created (status,created_at),
  KEY form (source,form_id),
  KEY email (email(64))
) {$charset};");
        dbDelta("CREATE TABLE {$events} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  lead_id bigint(20) unsigned NOT NULL,
  at datetime NOT NULL,
  kind varchar(16) NOT NULL,
  actor_user_id bigint(20) unsigned NOT NULL DEFAULT 0,
  data longtext NOT NULL,
  PRIMARY KEY  (id),
  KEY lead_at (lead_id,at)
) {$charset};");
        if (!self::table_exists($leads) || !self::table_exists($events)) {
            return false;
        }
        update_option(self::DB_VERSION_OPTION, self::DB_VERSION, true);
        return true;
    }

    private static function table_exists($name) {
        global $wpdb;
        return $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($name))) === $name;
    }

    // ── Capture ────────────────────────────────────────────────────────────

    /** wpforms_process_complete ($fields, $entry, $form_data, $entry_id). */
    public static function on_wpforms($fields, $entry = [], $form_data = [], $entry_id = 0) {
        try {
            $form_data = is_array($form_data) ? $form_data : [];
            $settings = isset($form_data['settings']) && is_array($form_data['settings']) ? $form_data['settings'] : [];
            // The owner told WPForms not to keep this form's entries.
            if (!empty($settings['disable_entries'])) {
                return;
            }
            $defs = isset($form_data['fields']) && is_array($form_data['fields']) ? $form_data['fields'] : [];
            $items = [];
            $box = null;
            foreach ((array) $fields as $id => $field) {
                if (!is_array($field)) {
                    continue;
                }
                $def = isset($defs[$id]) && is_array($defs[$id]) ? $defs[$id] : [];
                if (strpos((string) ($def['css'] ?? ''), self::CONSENT_MARK) !== false) {
                    $box = self::text($field['value'] ?? '') !== '';
                    continue;
                }
                $type = (string) ($field['type'] ?? ($def['type'] ?? ''));
                $items[] = [
                    'role' => self::role($type, self::WPFORMS_ROLES, self::WPFORMS_SKIP),
                    'label' => $field['name'] ?? ($def['label'] ?? ''),
                    'value' => $field['value'] ?? '',
                ];
            }
            $meta = isset($form_data['entry_meta']) && is_array($form_data['entry_meta']) ? $form_data['entry_meta'] : [];
            $raw = isset($form_data['post_data_raw']) && is_array($form_data['post_data_raw']) ? $form_data['post_data_raw'] : [];
            self::capture([
                'source' => 'wpforms',
                'form_id' => (int) ($form_data['id'] ?? 0),
                'form_title' => $settings['form_title'] ?? '',
                'items' => $items,
                'consent_box' => $box,
                'page_url' => $meta['page_url'] ?? ($raw['page_url'] ?? self::referer()),
                'source_ref' => (int) $entry_id > 0 ? (string) (int) $entry_id : '',
                'spam' => self::wpforms_says_spam(),
            ]);
        } catch (\Throwable $e) {
            self::capture_failed('WPForms', $e);
        }
    }

    /** wpcf7_mail_sent and wpcf7_mail_failed ($contact_form). */
    public static function on_cf7($contact_form = null) {
        try {
            if (!class_exists('WPCF7_Submission')) {
                return;
            }
            $submission = WPCF7_Submission::get_instance();
            if (!$submission) {
                return;
            }
            // The owner told Contact Form 7 not to keep this form's submissions.
            if (method_exists($submission, 'get_meta') && $submission->get_meta('do_not_store')) {
                return;
            }
            if (!is_object($contact_form) && method_exists($submission, 'get_contact_form')) {
                $contact_form = $submission->get_contact_form();
            }
            $data = (array) $submission->get_posted_data();
            $tags = (is_object($contact_form) && method_exists($contact_form, 'scan_form_tags')) ? (array) $contact_form->scan_form_tags() : [];
            $labels = self::cf7_labels((is_object($contact_form) && method_exists($contact_form, 'prop')) ? $contact_form->prop('form') : '');
            $items = [];
            $box = null;
            $declared = [];
            foreach ($tags as $tag) {
                $name = (string) self::prop($tag, 'name');
                if ($name === '' || isset($declared[$name])) {
                    continue;
                }
                $declared[$name] = true;
                if ($name === self::CONSENT_MARK) {
                    $box = self::ticked($data[$name] ?? '');
                    continue;
                }
                if (!array_key_exists($name, $data)) {
                    continue;
                }
                $items[] = [
                    'role' => self::role((string) self::prop($tag, 'basetype'), self::CF7_ROLES, self::CF7_SKIP),
                    'label' => $labels[$name] ?? self::label_from_name($name),
                    'value' => $data[$name],
                ];
            }
            // Without the form's tags (an older Contact Form 7), the posted fields.
            if (!$tags) {
                foreach ($data as $name => $value) {
                    if (!is_string($name) || $name === '' || $name[0] === '_') {
                        continue;
                    }
                    if ($name === self::CONSENT_MARK) {
                        $box = self::ticked($value);
                        continue;
                    }
                    $items[] = ['role' => 'text', 'label' => self::label_from_name($name), 'value' => $value];
                }
            }
            $form_id = (is_object($contact_form) && method_exists($contact_form, 'id')) ? (int) $contact_form->id() : 0;
            $title = (is_object($contact_form) && method_exists($contact_form, 'title')) ? (string) $contact_form->title() : '';
            $status = method_exists($submission, 'get_status') ? (string) $submission->get_status() : '';
            self::capture([
                'source' => 'cf7',
                'form_id' => $form_id,
                'form_title' => $title,
                'items' => $items,
                'consent_box' => $box,
                'page_url' => method_exists($submission, 'get_meta') ? (string) $submission->get_meta('url') : self::referer(),
                'source_ref' => '',
                'spam' => $status === 'spam',
            ]);
        } catch (\Throwable $e) {
            self::capture_failed('Contact Form 7', $e);
        }
    }

    /** gform_after_submission ($entry, $form). */
    public static function on_gravityforms($entry, $form) {
        try {
            if (!is_array($entry) || !is_array($form)) {
                return;
            }
            $items = [];
            $box = null;
            foreach ((array) ($form['fields'] ?? []) as $field) {
                $type = (string) self::prop($field, 'type');
                $input_type = (string) self::prop($field, 'inputType');
                $value = self::gf_value($field, $entry);
                if (strpos((string) self::prop($field, 'cssClass'), self::CONSENT_MARK) !== false) {
                    $box = self::text($value) !== '';
                    continue;
                }
                $label = (string) self::prop($field, 'label');
                if (trim($label) === '') {
                    $label = (string) self::prop($field, 'adminLabel');
                }
                $items[] = [
                    'role' => self::role($input_type !== '' ? $input_type : $type, self::GF_ROLES, self::GF_SKIP),
                    'label' => $label,
                    'value' => $value,
                ];
            }
            self::capture([
                'source' => 'gravityforms',
                'form_id' => (int) ($form['id'] ?? ($entry['form_id'] ?? 0)),
                'form_title' => $form['title'] ?? '',
                'items' => $items,
                'consent_box' => $box,
                'page_url' => $entry['source_url'] ?? self::referer(),
                'source_ref' => isset($entry['id']) ? (string) (int) $entry['id'] : '',
                'spam' => (($entry['status'] ?? '') === 'spam'),
            ]);
        } catch (\Throwable $e) {
            self::capture_failed('Gravity Forms', $e);
        }
    }

    /**
     * Keeps one submission. $sub: source, form_id, form_title, items
     * [{role, label, value}] (role: email, name, phone, textarea, text or
     * skip), consent_box (true ticked, false not ticked, null no box),
     * page_url, source_ref, spam (the form plugin's verdict). Returns the new
     * message's id, or 0 when nothing was kept.
     */
    public static function capture(array $sub) {
        $source = (string) ($sub['source'] ?? '');
        if (!in_array($source, self::SOURCES, true) || !self::maybe_install()) {
            return 0;
        }
        $parsed = self::parse_items(isset($sub['items']) && is_array($sub['items']) ? $sub['items'] : []);
        if ($parsed['fields'] === [] && $parsed['message'] === '') {
            return 0;
        }

        $ip_hash = self::ip_hash(self::visitor_ip());
        $recent = $ip_hash !== '' ? self::count_from_address($ip_hash) : 0;
        if ($recent >= self::FLOOD_PER_HOUR) {
            return 0;
        }
        $spam = !empty($sub['spam']) || $recent >= self::SPAM_PER_HOUR;

        $form_id = max(0, (int) ($sub['form_id'] ?? 0));
        $intent = self::intent_of($source, $form_id);
        $box = array_key_exists('consent_box', $sub) ? $sub['consent_box'] : null;
        $consent = $box === true || ($box === null && $intent === 'newsletter');
        $fields = function_exists('wp_json_encode')
            ? wp_json_encode($parsed['fields'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            : json_encode($parsed['fields'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        global $wpdb;
        $now = self::now_sql();
        $ok = $wpdb->insert(self::table(), [
            'created_at' => $now,
            'source' => $source,
            'form_id' => $form_id,
            'form_title' => self::line($sub['form_title'] ?? '', self::LABEL_MAX),
            'intent' => $intent,
            'page_url' => self::page_url($sub['page_url'] ?? ''),
            'name' => $parsed['name'],
            'email' => $parsed['email'],
            'phone' => $parsed['phone'],
            'message' => $parsed['message'],
            'fields' => is_string($fields) ? $fields : '[]',
            'consent' => $consent ? 1 : 0,
            'status' => $spam ? 'spam' : 'new',
            'ip_hash' => $ip_hash,
            'source_ref' => self::cut(preg_replace('/[^A-Za-z0-9_.:\-]/', '', (string) ($sub['source_ref'] ?? '')), 64),
            'updated_at' => $now,
        ], ['%s', '%s', '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%s', '%s']);
        if (!$ok) {
            WebMaven_Log::write('WPMaven messages: a form message was not saved.');
            return 0;
        }
        if (!$spam && self::kind_of($intent, $parsed['message']) === 'conversation') {
            self::queue_alert('raise');
        }
        return (int) $wpdb->insert_id;
    }

    /** name, email, phone, message and the kept fields of a submission. */
    private static function parse_items(array $items) {
        $out = ['name' => '', 'email' => '', 'phone' => '', 'message' => '', 'fields' => []];
        $clean = [];
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }
            $role = (string) ($item['role'] ?? 'text');
            if ($role === 'skip') {
                continue;
            }
            $value = self::text($item['value'] ?? '', $role === 'textarea' ? self::MESSAGE_MAX : self::FIELD_VALUE_MAX);
            if ($value === '') {
                continue;
            }
            $label = self::line($item['label'] ?? '', self::LABEL_MAX);
            $clean[] = ['role' => $role, 'label' => $label, 'key' => self::label_key($label), 'value' => $value];
        }

        foreach ($clean as $c) {
            if ($c['role'] === 'email' && ($email = self::email($c['value'])) !== '') {
                $out['email'] = $email;
                break;
            }
        }
        if ($out['email'] === '') {
            foreach ($clean as $c) {
                if (($email = self::email($c['value'])) !== '') {
                    $out['email'] = $email;
                    break;
                }
            }
        }

        foreach ($clean as $c) {
            if ($c['role'] === 'name') {
                $out['name'] = self::line($c['value'], self::NAME_MAX);
                break;
            }
        }
        if ($out['name'] === '') {
            $first = self::value_for($clean, self::FIRST_NAME_LABELS);
            $last = self::value_for($clean, self::LAST_NAME_LABELS);
            $whole = self::value_for($clean, self::NAME_LABELS);
            if ($first !== '' && $last !== '') {
                $out['name'] = self::line($first . ' ' . $last, self::NAME_MAX);
            } elseif ($whole !== '') {
                $out['name'] = self::line($whole, self::NAME_MAX);
            } elseif ($first !== '') {
                $out['name'] = self::line($first, self::NAME_MAX);
            }
        }

        foreach ($clean as $c) {
            if ($c['role'] === 'phone') {
                $out['phone'] = self::line($c['value'], self::PHONE_MAX);
                break;
            }
        }
        if ($out['phone'] === '') {
            $out['phone'] = self::line(self::value_for($clean, self::PHONE_LABELS), self::PHONE_MAX);
        }

        // The message: the longest text area.
        foreach ($clean as $c) {
            if ($c['role'] === 'textarea' && self::length($c['value']) > self::length($out['message'])) {
                $out['message'] = $c['value'];
            }
        }

        $bytes = 0;
        foreach ($clean as $c) {
            if (count($out['fields']) >= self::FIELDS_MAX) {
                break;
            }
            $label = $c['label'] !== '' ? $c['label'] : 'Field';
            $size = strlen($label) + strlen($c['value']);
            if ($bytes + $size > self::FIELDS_BYTES_MAX) {
                break;
            }
            $bytes += $size;
            $out['fields'][] = ['label' => $label, 'value' => $c['value']];
        }
        return $out;
    }

    /** The first value whose label is one of $keys. */
    private static function value_for(array $clean, array $keys) {
        foreach ($clean as $c) {
            if ($c['key'] !== '' && in_array($c['key'], $keys, true)) {
                return $c['value'];
            }
        }
        return '';
    }

    private static function role($type, array $roles, array $skip) {
        $type = strtolower(trim((string) $type));
        if (in_array($type, $skip, true)) {
            return 'skip';
        }
        return $roles[$type] ?? 'text';
    }

    /** WPForms marked this submission as spam (its process object's reason). */
    private static function wpforms_says_spam() {
        if (!function_exists('wpforms')) {
            return false;
        }
        $wpforms = wpforms();
        $process = null;
        if (is_object($wpforms)) {
            if (method_exists($wpforms, 'obj')) {
                $process = $wpforms->obj('process');
            } elseif (method_exists($wpforms, 'get')) {
                $process = $wpforms->get('process');
            } elseif (isset($wpforms->process)) {
                $process = $wpforms->process;
            }
        }
        return is_object($process) && !empty($process->spam_reason);
    }

    /** Contact Form 7 labels: the text before each tag inside its <label>. */
    private static function cf7_labels($template) {
        $labels = [];
        if (!is_string($template) || $template === '') {
            return $labels;
        }
        if (preg_match_all('#<label\b[^>]*>(.*?)</label>#is', $template, $matches)) {
            foreach ($matches[1] as $inner) {
                if (preg_match('/\[\s*[a-z_]+\*?\s+([A-Za-z][\w:.\-]*)/i', $inner, $tag, PREG_OFFSET_CAPTURE)) {
                    $text = self::line(substr($inner, 0, $tag[0][1]), self::LABEL_MAX);
                    if ($text !== '' && !isset($labels[$tag[1][0]])) {
                        $labels[$tag[1][0]] = $text;
                    }
                }
            }
        }
        return $labels;
    }

    /** "your-name" -> "Your name". */
    private static function label_from_name($name) {
        $words = trim(preg_replace('/[\s_\-]+/', ' ', (string) $name));
        return $words === '' ? '' : ucfirst(strtolower($words));
    }

    /** A Gravity Forms field's value: its own export when it has one, else its inputs. */
    private static function gf_value($field, array $entry) {
        if (is_object($field) && method_exists($field, 'get_value_export')) {
            $value = $field->get_value_export($entry, '', true);
            return is_scalar($value) ? (string) $value : '';
        }
        $inputs = self::prop($field, 'inputs');
        if (is_array($inputs) && $inputs) {
            $parts = [];
            foreach ($inputs as $input) {
                $input_id = (string) self::prop($input, 'id');
                if ($input_id !== '' && isset($entry[$input_id]) && is_scalar($entry[$input_id]) && trim((string) $entry[$input_id]) !== '') {
                    $parts[] = trim((string) $entry[$input_id]);
                }
            }
            return implode(self::prop($field, 'type') === 'name' ? ' ' : ', ', $parts);
        }
        $id = (string) self::prop($field, 'id');
        return ($id !== '' && isset($entry[$id])) ? $entry[$id] : '';
    }

    /** A key of an array or a property of an object (Gravity Forms fields are both). */
    private static function prop($thing, $key) {
        if (is_array($thing)) {
            return $thing[$key] ?? null;
        }
        if (is_object($thing)) {
            return isset($thing->$key) ? $thing->$key : null;
        }
        return null;
    }

    private static function ticked($value) {
        if (is_array($value)) {
            return self::text($value) !== '';
        }
        return !empty($value) && (string) $value !== '0';
    }

    /** What the form WPMaven made is for (WPForms and Contact Form 7 forms are posts). */
    private static function intent_of($source, $form_id) {
        if ($form_id <= 0 || !in_array($source, ['wpforms', 'cf7'], true)) {
            return '';
        }
        $intent = get_option(self::INTENT_OPTION . $form_id, '');
        return is_string($intent) && in_array($intent, self::INTENTS, true) ? $intent : '';
    }

    private static function capture_failed($plugin, \Throwable $e) {
        // Never the visitor's text: the exception's class only.
        WebMaven_Log::write('WPMaven messages: a ' . $plugin . ' message was not kept (' . get_class($e) . ').');
    }

    private static function referer() {
        return isset($_SERVER['HTTP_REFERER']) && is_string($_SERVER['HTTP_REFERER']) ? esc_url_raw(wp_unslash($_SERVER['HTTP_REFERER'])) : '';
    }

    // ── The spam count ─────────────────────────────────────────────────────

    /**
     * The visitor's address: REMOTE_ADDR, or behind a proxy on the same
     * network (a private or reserved address connects) the first public
     * address it forwards. Only ever stored as a salted hash.
     */
    public static function visitor_ip() {
        $remote = isset($_SERVER['REMOTE_ADDR']) ? trim(sanitize_text_field(wp_unslash((string) $_SERVER['REMOTE_ADDR']))) : '';
        $ip = filter_var($remote, FILTER_VALIDATE_IP) ? $remote : '';
        $public = FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE;
        if ($ip === '' || !filter_var($ip, FILTER_VALIDATE_IP, $public)) {
            foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP'] as $header) {
                if (empty($_SERVER[$header]) || !is_string($_SERVER[$header])) {
                    continue;
                }
                foreach (explode(',', sanitize_text_field(wp_unslash((string) $_SERVER[$header]))) as $part) {
                    $part = trim($part);
                    if (filter_var($part, FILTER_VALIDATE_IP, $public)) {
                        $ip = $part;
                        break 2;
                    }
                }
            }
        }
        $ip = function_exists('apply_filters') ? apply_filters('wpmaven_leads_visitor_ip', $ip) : $ip;
        return is_string($ip) ? $ip : '';
    }

    public static function ip_hash($ip) {
        $ip = trim((string) $ip);
        if ($ip === '') {
            return '';
        }
        $key = (function_exists('wp_salt') ? wp_salt('nonce') : '') . '|wpmaven-leads';
        return hash_hmac('sha256', $ip, $key);
    }

    private static function count_from_address($ip_hash) {
        global $wpdb;
        return (int) $wpdb->get_var($wpdb->prepare(
            'SELECT COUNT(*) FROM %i WHERE ip_hash = %s AND created_at >= %s',
            self::table(),
            $ip_hash,
            gmdate('Y-m-d H:i:s', time() - self::HOUR)
        ));
    }

    // ── Plain text ─────────────────────────────────────────────────────────

    /**
     * Visitor input as plain text: entities decoded, tags (and script or
     * style blocks) removed, line breaks kept, control characters gone, at
     * most $max characters. A lone "<" ("I <3 it") stays.
     */
    public static function text($value, $max = self::FIELD_VALUE_MAX) {
        if (is_array($value)) {
            $parts = [];
            array_walk_recursive($value, function ($v) use (&$parts) {
                if (is_scalar($v) && trim((string) $v) !== '') {
                    $parts[] = trim((string) $v);
                }
            });
            $value = implode(', ', $parts);
        } elseif (is_bool($value)) {
            $value = $value ? 'Yes' : '';
        } elseif (!is_scalar($value)) {
            return '';
        }
        $s = self::utf8((string) $value);
        if ($s === '') {
            return '';
        }
        $s = html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $s = (string) preg_replace('#<(script|style)\b[^>]*>.*?</\1\s*>#is', '', $s);
        $s = (string) preg_replace('#<!--.*?-->#s', '', $s);
        $s = (string) preg_replace('#</?[a-zA-Z][^<>]*>#', '', $s);
        $s = str_replace(["\r\n", "\r"], "\n", $s);
        $s = (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $s);
        $s = (string) preg_replace("/[ \t]+\n/", "\n", $s);
        $s = (string) preg_replace("/\n{3,}/", "\n\n", $s);
        return self::cut(trim($s), (int) $max);
    }

    /** text() on one line. */
    public static function line($value, $max = self::LABEL_MAX) {
        $s = (string) preg_replace('/\s+/', ' ', self::text($value, (int) $max * 2));
        return self::cut(trim($s), (int) $max);
    }

    private static function utf8($s) {
        if ($s === '') {
            return '';
        }
        if (function_exists('mb_check_encoding')) {
            if (!mb_check_encoding($s, 'UTF-8')) {
                $s = function_exists('mb_convert_encoding') ? (string) mb_convert_encoding($s, 'UTF-8', 'UTF-8') : '';
            }
            return $s;
        }
        return preg_match('//u', $s) === 1 ? $s : (function_exists('iconv') ? (string) @iconv('UTF-8', 'UTF-8//IGNORE', $s) : '');
    }

    private static function cut($s, $max) {
        $s = (string) $s;
        if ($max <= 0) {
            return '';
        }
        return function_exists('mb_substr') ? mb_substr($s, 0, $max) : substr($s, 0, $max);
    }

    private static function length($s) {
        return function_exists('mb_strlen') ? mb_strlen((string) $s) : strlen((string) $s);
    }

    /** A label as the recognition lists hold it: lowercase, without "*" or ":". */
    private static function label_key($label) {
        $key = function_exists('mb_strtolower') ? mb_strtolower((string) $label) : strtolower((string) $label);
        $key = trim((string) preg_replace('/[\s_]+/', ' ', $key));
        return trim(rtrim($key, " *:.?\t"));
    }

    /** A valid address, lowercase, or ''. */
    public static function email($value) {
        $v = strtolower(trim((string) $value));
        if ($v === '' || strlen($v) > self::EMAIL_MAX) {
            return '';
        }
        if (function_exists('sanitize_email')) {
            $v = (string) sanitize_email($v);
        }
        $valid = function_exists('is_email') ? is_email($v) : filter_var($v, FILTER_VALIDATE_EMAIL);
        return $valid ? $v : '';
    }

    /**
     * The page the form was sent from: http(s) only, at most 500 characters.
     * A page on another host (the form plugins read it from the visitor's
     * browser) keeps its path only.
     */
    private static function page_url($raw) {
        $url = trim(self::text($raw, self::PAGE_URL_MAX * 2));
        if ($url === '') {
            return '';
        }
        if (function_exists('esc_url_raw')) {
            $url = (string) esc_url_raw($url, ['http', 'https']);
        }
        if ($url === '' || !preg_match('#^https?://#i', $url)) {
            return '';
        }
        $host = wp_parse_url($url, PHP_URL_HOST);
        if (!is_string($host) || !in_array(self::bare_host($host), self::own_hosts(), true)) {
            $path = wp_parse_url($url, PHP_URL_PATH);
            $query = wp_parse_url($url, PHP_URL_QUERY);
            $url = (is_string($path) && $path !== '' ? $path : '/') . (is_string($query) && $query !== '' ? '?' . $query : '');
        }
        return self::cut($url, self::PAGE_URL_MAX);
    }

    private static function own_hosts() {
        $hosts = [];
        foreach ([function_exists('home_url') ? home_url() : '', function_exists('site_url') ? site_url() : ''] as $address) {
            $host = wp_parse_url((string) $address, PHP_URL_HOST);
            if (is_string($host) && $host !== '') {
                $hosts[] = self::bare_host($host);
            }
        }
        // A custom domain the edge forwards for (WPMaven Agent's edge host).
        $primary = get_option('webmaven_primary_host', '');
        if (is_string($primary) && $primary !== '') {
            $hosts[] = self::bare_host($primary);
        }
        return array_values(array_unique($hosts));
    }

    private static function bare_host($host) {
        $host = rtrim(strtolower(trim((string) $host)), '.');
        return strpos($host, 'www.') === 0 ? substr($host, 4) : $host;
    }

    // ── The inbox ──────────────────────────────────────────────────────────

    /** LeadsPage: page, per_page (1 to 50, default 25), status, form ("<source>:<formId>"), search. */
    public static function list_page(array $q) {
        $per = (int) ($q['per_page'] ?? 0);
        $per = $per <= 0 ? self::PER_PAGE : min($per, self::PER_PAGE_MAX);
        $page = max(1, (int) ($q['page'] ?? 1));
        $counts = array_fill_keys(self::STATUSES, 0);
        if (!self::maybe_install()) {
            return ['items' => [], 'total' => 0, 'totalPages' => 0, 'counts' => $counts, 'forms' => []];
        }
        global $wpdb;
        $t = self::table();
        list($where, $args) = self::list_filters($q);

        $rows = $wpdb->get_results($wpdb->prepare("SELECT status, COUNT(*) AS n FROM %i WHERE {$where} GROUP BY status", array_merge([$t], $args)), ARRAY_A); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $where is built from fixed fragments with placeholders (list_filters).
        foreach ((array) $rows as $r) {
            if (isset($counts[$r['status']])) {
                $counts[$r['status']] = (int) $r['n'];
            }
        }

        // One status, or everything but spam.
        $status = (string) ($q['status'] ?? '');
        if (in_array($status, self::STATUSES, true)) {
            $where .= ' AND status = %s';
            $args[] = $status;
        } else {
            $where .= ' AND status <> %s';
            $args[] = 'spam';
        }
        $total = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM %i WHERE {$where}", array_merge([$t], $args))); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $where is built from fixed fragments with placeholders (list_filters).
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, created_at, source, form_title, intent, name, email, phone, SUBSTR(message, 1, 400) AS head, status, seen_at, consent
             FROM %i WHERE {$where} ORDER BY created_at DESC, id DESC LIMIT %d OFFSET %d", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $where is built from fixed fragments with placeholders (list_filters).
            array_merge([$t], $args, [$per, ($page - 1) * $per])
        ), ARRAY_A);
        $items = [];
        foreach ((array) $rows as $r) {
            $items[] = [
                'id' => (int) $r['id'],
                'createdAt' => self::iso($r['created_at']) ?? '',
                'source' => (string) $r['source'],
                'formTitle' => (string) $r['form_title'],
                'intent' => (string) $r['intent'],
                'kind' => self::kind_of($r['intent'], $r['head']),
                'name' => (string) $r['name'],
                'email' => (string) $r['email'],
                'phone' => (string) $r['phone'],
                'firstLine' => self::first_line($r['head']),
                'status' => self::status_of($r['status']),
                'seen' => !empty($r['seen_at']),
                'consent' => (int) $r['consent'] === 1,
            ];
        }
        return [
            'items' => $items,
            'total' => $total,
            'totalPages' => $total > 0 ? (int) ceil($total / $per) : 0,
            'counts' => $counts,
            'forms' => self::forms(),
        ];
    }

    /** The form and search filters: [where, args]. */
    private static function list_filters(array $q) {
        global $wpdb;
        $where = '1=1';
        $args = [];
        $form = trim((string) ($q['form'] ?? ''));
        if ($form !== '' && preg_match('/^(wpforms|cf7|gravityforms):(\d+)$/', $form, $m)) {
            $where .= ' AND source = %s AND form_id = %d';
            $args[] = $m[1];
            $args[] = (int) $m[2];
        }
        $kind = (string) ($q['kind'] ?? '');
        if ($kind === 'signup') {
            $where .= ' AND ' . self::SIGNUP_SQL;
        } elseif ($kind === 'conversation') {
            $where .= ' AND NOT ' . self::SIGNUP_SQL;
        }
        // Received at or after this moment (UTC, "Y-m-d H:i:s"), for a period.
        $since = (string) ($q['since'] ?? '');
        if ($since !== '' && preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $since)) {
            $where .= ' AND created_at >= %s';
            $args[] = $since;
        }
        $search = self::line($q['search'] ?? '', self::SEARCH_MAX);
        if ($search !== '') {
            $like = '%' . $wpdb->esc_like($search) . '%';
            $where .= ' AND (name LIKE %s OR email LIKE %s OR phone LIKE %s OR form_title LIKE %s OR message LIKE %s OR fields LIKE %s)';
            array_push($args, $like, $like, $like, $like, $like, $like);
        }
        return [$where, $args];
    }

    /** Every form that sent a message, with its latest title. */
    private static function forms() {
        global $wpdb;
        $t = self::table();
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT source, form_id, form_title FROM %i WHERE id IN (SELECT MAX(id) FROM %i GROUP BY source, form_id) ORDER BY form_title ASC, form_id ASC LIMIT 100',
            $t,
            $t
        ), ARRAY_A);
        $forms = [];
        foreach ((array) $rows as $r) {
            $forms[] = ['source' => (string) $r['source'], 'formId' => (int) $r['form_id'], 'title' => (string) $r['form_title']];
        }
        return $forms;
    }

    /**
     * LeadsStats for a period: numbers only, never a name or a word anyone
     * wrote. $from and $to are UTC "Y-m-d H:i:s" bounds (to excluded). Per
     * form: messages received (spam left out), answered, and for
     * conversations the hours to a first answer (median). Signups count as
     * new subscribers.
     */
    public static function stats($from, $to) {
        $empty = ['conversations' => 0, 'signups' => 0, 'answered' => 0, 'shareAnswered' => null, 'medianHoursToAnswer' => null, 'spam' => 0, 'forms' => []];
        if (!self::maybe_install()) {
            return $empty;
        }
        global $wpdb;
        $t = self::table();
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT source, form_id, form_title, intent, (COALESCE(message, '') = '') AS no_message, status, created_at, answered_at
             FROM %i WHERE created_at >= %s AND created_at < %s ORDER BY id ASC LIMIT 20000",
            $t,
            $from,
            $to
        ), ARRAY_A);
        $out = $empty;
        $forms = [];
        $hours = [];
        foreach ((array) $rows as $r) {
            if ((string) $r['status'] === 'spam') {
                $out['spam']++;
                continue;
            }
            $kind = self::kind_of($r['intent'], (int) $r['no_message'] === 1 ? '' : 'x');
            $key = $r['source'] . ':' . (int) $r['form_id'];
            if (!isset($forms[$key])) {
                $forms[$key] = ['form' => $key, 'title' => (string) $r['form_title'], 'kind' => $kind, 'received' => 0, 'answered' => 0];
            }
            $forms[$key]['title'] = (string) $r['form_title'];
            $forms[$key]['received']++;
            if ($kind === 'signup') {
                $out['signups']++;
                continue;
            }
            $out['conversations']++;
            if (!empty($r['answered_at'])) {
                $out['answered']++;
                $forms[$key]['answered']++;
                $start = strtotime($r['created_at'] . ' UTC');
                $end = strtotime($r['answered_at'] . ' UTC');
                if ($start !== false && $end !== false && $end >= $start) {
                    $hours[] = ($end - $start) / self::HOUR;
                }
            }
        }
        if ($out['conversations'] > 0) {
            $out['shareAnswered'] = round($out['answered'] / $out['conversations'], 2);
        }
        if ($hours) {
            sort($hours);
            $n = count($hours);
            $mid = intdiv($n, 2);
            $out['medianHoursToAnswer'] = round($n % 2 ? $hours[$mid] : ($hours[$mid - 1] + $hours[$mid]) / 2, 1);
        }
        $out['forms'] = array_values($forms);
        return $out;
    }

    /** {lead}: one message with its timeline, marked seen unless $mark_seen is false. */
    public static function read($id, $mark_seen = true, $actor = 0) {
        $row = self::find($id);
        if ($mark_seen && empty($row['seen_at'])) {
            global $wpdb;
            $was_unseen = $row['status'] === 'new';
            $now = self::now_sql();
            $wpdb->update(self::table(), ['seen_at' => $now], ['id' => (int) $row['id']], ['%s'], ['%d']);
            $row['seen_at'] = $now;
            self::resolve_if_cleared($was_unseen);
        }
        return self::lead_json($row);
    }

    /** {lead} after a status change and/or a note ($patch: status?, note?). */
    public static function update($id, array $patch, $actor = 0) {
        $row = self::find($id);
        $now = self::now_sql();
        $set = [];
        $events = [];
        $status = $patch['status'] ?? null;
        if ($status !== null && $status !== '') {
            $status = (string) $status;
            if (!in_array($status, self::STATUSES, true)) {
                throw self::error('VALIDATION', 'Choose new, answered, archived or spam.');
            }
            if ($status !== $row['status']) {
                $set['status'] = $status;
                if ($status === 'answered') {
                    $set['answered_at'] = $now;
                }
                // Handling a message is seeing it.
                if (empty($row['seen_at'])) {
                    $set['seen_at'] = $now;
                }
                $events[] = ['status', ['from' => self::status_of($row['status']), 'to' => $status]];
            }
        }
        if (array_key_exists('note', $patch)) {
            $note = $patch['note'] === null ? '' : self::text($patch['note'], self::NOTE_MAX);
            $before = (string) ($row['note'] ?? '');
            if ($note !== $before) {
                $set['note'] = $note === '' ? null : $note;
                $events[] = ['note', ['action' => $before === '' ? 'added' : ($note === '' ? 'removed' : 'changed')]];
            }
        }
        if (!$set) {
            return self::lead_json($row);
        }
        global $wpdb;
        $set['updated_at'] = $now;
        if ($wpdb->update(self::table(), $set, ['id' => (int) $row['id']], null, ['%d']) === false) {
            throw self::error('WRITE_FAILED', 'This change was not saved. Try again.');
        }
        foreach ($events as $event) {
            self::add_events([(int) $row['id']], $event[0], $actor, $event[1]);
        }
        self::resolve_if_cleared($row['status'] === 'new' && empty($row['seen_at']));
        return self::lead_json(self::find($row['id']));
    }

    /** {deleted: true}: the message and its timeline are gone. */
    public static function delete($id) {
        $row = self::find($id);
        self::delete_ids([(int) $row['id']]);
        self::resolve_if_cleared($row['status'] === 'new' && empty($row['seen_at']));
        return ['deleted' => true];
    }

    /** Deletes messages and their timelines; returns how many messages went. */
    public static function delete_ids(array $ids) {
        $ids = array_values(array_unique(array_filter(array_map('intval', $ids), function ($id) {
            return $id > 0;
        })));
        if (!$ids) {
            return 0;
        }
        global $wpdb;
        // One %d per id.
        $in = implode(', ', array_fill(0, count($ids), '%d'));
        $wpdb->query($wpdb->prepare("DELETE FROM %i WHERE lead_id IN ({$in})", array_merge([self::events_table()], $ids))); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $in is only %d placeholders.
        return (int) $wpdb->query($wpdb->prepare("DELETE FROM %i WHERE id IN ({$in})", array_merge([self::table()], $ids))); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $in is only %d placeholders.
    }

    /** The message's row, or NOT_FOUND. */
    private static function find($id) {
        $id = (int) $id;
        if ($id > 0 && self::maybe_install()) {
            global $wpdb;
            $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM %i WHERE id = %d', self::table(), $id), ARRAY_A);
            if (is_array($row)) {
                return $row;
            }
        }
        throw self::error('NOT_FOUND', 'This message is no longer on your site.');
    }

    /** Lead: one message as the inbox's detail shows it. */
    private static function lead_json(array $r) {
        $fields = [];
        $decoded = json_decode((string) ($r['fields'] ?? ''), true);
        foreach (is_array($decoded) ? $decoded : [] as $f) {
            if (is_array($f) && isset($f['label'], $f['value']) && is_scalar($f['label']) && is_scalar($f['value'])) {
                $fields[] = ['label' => (string) $f['label'], 'value' => (string) $f['value']];
            }
        }
        $note = isset($r['note']) ? (string) $r['note'] : '';
        return [
            'id' => (int) $r['id'],
            'createdAt' => self::iso($r['created_at']) ?? '',
            'source' => (string) $r['source'],
            'formTitle' => (string) $r['form_title'],
            'intent' => (string) $r['intent'],
            'kind' => self::kind_of($r['intent'], $r['message'] ?? ''),
            'pageUrl' => (string) $r['page_url'],
            'name' => (string) $r['name'],
            'email' => (string) $r['email'],
            'phone' => (string) $r['phone'],
            'message' => (string) $r['message'],
            'fields' => $fields,
            'consent' => (int) $r['consent'] === 1,
            'status' => self::status_of($r['status']),
            'seenAt' => self::iso($r['seen_at'] ?? null),
            'answeredAt' => self::iso($r['answered_at'] ?? null),
            'note' => $note === '' ? null : $note,
            'events' => self::events_json((int) $r['id']),
        ];
    }

    /** The message's timeline, oldest first (the last 100 events). */
    private static function events_json($lead_id) {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT id, at, kind, actor_user_id, data FROM %i WHERE lead_id = %d ORDER BY id DESC LIMIT %d',
            self::events_table(),
            $lead_id,
            self::EVENTS_SHOWN
        ), ARRAY_A);
        $out = [];
        foreach (array_reverse(is_array($rows) ? $rows : []) as $r) {
            $kind = (string) $r['kind'];
            if (!in_array($kind, self::EVENT_KINDS, true)) {
                continue;
            }
            $data = json_decode((string) $r['data'], true);
            $out[] = [
                'at' => self::iso($r['at']) ?? '',
                'kind' => $kind,
                'by' => self::actor_name((int) $r['actor_user_id']),
                'summary' => self::event_summary($kind, is_array($data) ? $data : []),
            ];
        }
        return $out;
    }

    private static function event_summary($kind, array $data) {
        switch ($kind) {
            case 'reply':
                $subject = isset($data['subject']) && is_string($data['subject']) ? $data['subject'] : '';
                return (!empty($data['sent']) ? 'Replied by email' : 'Reply not sent') . ($subject !== '' ? ': "' . $subject . '"' : '');
            case 'status':
                $labels = ['new' => 'Marked as new', 'answered' => 'Marked as answered', 'archived' => 'Archived', 'spam' => 'Marked as spam'];
                return $labels[$data['to'] ?? ''] ?? 'Status changed';
            case 'note':
                $labels = ['added' => 'Note added', 'changed' => 'Note changed', 'removed' => 'Note removed'];
                return $labels[$data['action'] ?? ''] ?? 'Note changed';
            case 'export':
                return 'Included in a CSV export';
        }
        return '';
    }

    /** Who did it: the WordPress user's name, or the dashboard's for actor 0. */
    private static function actor_name($user_id) {
        if ($user_id <= 0) {
            return class_exists('WebMaven_Brand') ? WebMaven_Brand::name_or('Your dashboard') : 'WPMaven';
        }
        if (!isset(self::$names[$user_id])) {
            $user = function_exists('get_userdata') ? get_userdata($user_id) : false;
            $name = is_object($user) && isset($user->display_name) ? trim((string) $user->display_name) : '';
            self::$names[$user_id] = $name !== '' ? $name : 'Someone';
        }
        return self::$names[$user_id];
    }

    /** Timeline events, one per message (an export adds one to each message it holds). */
    private static function add_events(array $lead_ids, $kind, $actor, array $data) {
        global $wpdb;
        $json = function_exists('wp_json_encode') ? wp_json_encode($data, JSON_UNESCAPED_UNICODE) : json_encode($data, JSON_UNESCAPED_UNICODE);
        $json = is_string($json) ? $json : '{}';
        $at = self::now_sql();
        foreach (array_chunk(array_values(array_unique(array_map('intval', $lead_ids))), 200) as $chunk) {
            $values = [];
            $args = [];
            foreach ($chunk as $lead_id) {
                $values[] = '(%d, %s, %s, %d, %s)';
                array_push($args, $lead_id, $at, (string) $kind, max(0, (int) $actor), $json);
            }
            // $values holds only fixed (%d, %s, %s, %d, %s) groups.
            $wpdb->query($wpdb->prepare(
                'INSERT INTO %i (lead_id, at, kind, actor_user_id, data) VALUES ' . implode(', ', $values), // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
                array_merge([self::events_table()], $args)
            ));
        }
    }

    // ── Reply by email ─────────────────────────────────────────────────────

    /**
     * {sent: true, via, lead}: the reply goes to the sender, Reply-To the
     * business email, the way this site sends replies (via says how it
     * actually left); the event is recorded either way and the message turns
     * answered. RATE_LIMITED past 30 replies an hour for the site,
     * MAIL_FAILED when the email did not leave (the monthly cap in words).
     */
    public static function reply($id, $subject, $body, $actor = 0) {
        $row = self::find($id);
        $to = self::email($row['email']);
        if ($to === '') {
            throw self::error('VALIDATION', 'This message has no email address to reply to.');
        }
        $subject = self::line(is_scalar($subject) ? $subject : '', self::SUBJECT_MAX);
        if ($subject === '') {
            throw self::error('VALIDATION', 'Write a subject for your reply.');
        }
        $text = self::reply_text($body);
        if ($text === '') {
            throw self::error('VALIDATION', 'Write your reply first.');
        }
        if (self::length($text) > self::REPLY_MAX) {
            throw self::error('VALIDATION', 'Your reply is too long. Keep it under 10,000 characters.');
        }
        if (self::replies_last_hour() >= self::REPLIES_PER_HOUR) {
            throw self::error('RATE_LIMITED', 'Your site sent 30 replies in the last hour. Try again a little later.');
        }

        $result = self::send_reply($to, $subject, $text);
        // The way it actually went: 'relay' or 'site', and whether the site's
        // own mail stood in for an account that could not take it.
        $event = ['subject' => $subject, 'sent' => $result['sent'], 'via' => $result['via']];
        if ($result['fallback']) {
            $event['fallback'] = true;
        }
        if (!$result['sent']) {
            $event['error'] = $result['error'];
        }
        self::add_events([(int) $row['id']], 'reply', $actor, $event);
        if (!$result['sent']) {
            throw self::error('MAIL_FAILED', $result['sentence']);
        }
        $via = $result['via'];

        global $wpdb;
        $now = self::now_sql();
        $set = ['status' => 'answered', 'answered_at' => $now, 'updated_at' => $now];
        if (empty($row['seen_at'])) {
            $set['seen_at'] = $now;
        }
        $wpdb->update(self::table(), $set, ['id' => (int) $row['id']], null, ['%d']);
        self::resolve_if_cleared($row['status'] === 'new' && empty($row['seen_at']));
        return ['sent' => true, 'via' => $via, 'lead' => self::lead_json(self::find($row['id']))];
    }

    /** The owner's text as written: line breaks kept, control characters gone. */
    private static function reply_text($body) {
        if (!is_scalar($body)) {
            return '';
        }
        $s = str_replace(["\r\n", "\r"], "\n", self::utf8((string) $body));
        $s = (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $s);
        return trim($s);
    }

    /** The email body: the text escaped, in paragraphs. */
    public static function reply_html($text) {
        $html = '';
        foreach (preg_split("/\n\s*\n/", (string) $text) as $paragraph) {
            $paragraph = trim($paragraph);
            if ($paragraph === '') {
                continue;
            }
            $html .= '<p>' . str_replace("\n", "<br>\n", esc_html($paragraph)) . "</p>\n";
        }
        return "<!DOCTYPE html>\n<html><body>\n" . $html . "</body></html>\n";
    }

    /**
     * Sends one reply the way this site sends them (reply_way). Answers
     * sent, via ('relay' or 'site', as it actually left), fallback (the
     * account could not take it and the site's own mail sent it instead),
     * error ('', 'monthly_cap' or 'not_sent') and the owner's sentence for a
     * failure.
     */
    private static function send_reply($to, $subject, $text) {
        $html = self::reply_html($text);
        $reply_to = self::business_email();
        $way = self::reply_way();
        $fallback = false;
        if ($way === 'account') {
            $account = self::send_through_account($to, $subject, $html, $reply_to);
            if ($account['sent']) {
                return ['sent' => true, 'via' => 'relay', 'fallback' => false, 'error' => '', 'sentence' => ''];
            }
            if ($account['cap'] !== null) {
                return ['sent' => false, 'via' => 'relay', 'fallback' => false, 'error' => 'monthly_cap', 'sentence' => $account['cap']];
            }
            // An older account without the route, a refusal or no connection:
            // the site's own mail sends it, once.
            $fallback = true;
        }
        $via = $way === 'hosted' ? 'relay' : 'site';
        if (self::send_with_wp_mail($to, $subject, $html, $reply_to)) {
            return ['sent' => true, 'via' => $via, 'fallback' => $fallback, 'error' => '', 'sentence' => ''];
        }
        if ($way === 'hosted') {
            $state = WebMaven_Site_Mail::cap_state();
            if ($state !== null) {
                return ['sent' => false, 'via' => $via, 'fallback' => false, 'error' => 'monthly_cap', 'sentence' => WebMaven_Site_Mail::cap_notice_text($state['resets_at'])];
            }
        }
        return [
            'sent' => false,
            'via' => $via,
            'fallback' => $fallback,
            'error' => 'not_sent',
            'sentence' => $via === 'relay'
                ? 'Your reply was not sent. Try again in a few minutes.'
                : "Your site could not send this email. Check your site's email settings, then try again.",
        ];
    }

    /**
     * POST REPLY_ROUTE with the site's token: {sent: true}, or the relay's
     * refusals. Answers sent, and cap: the monthly cap's sentence (the
     * relay's own words) or null.
     */
    private static function send_through_account($to, $subject, $html, $reply_to) {
        $out = ['sent' => false, 'cap' => null];
        if (!class_exists('WebMaven_WP_API_Client')) {
            return $out;
        }
        $body = ['to' => $to, 'subject' => $subject, 'html' => $html];
        if ($reply_to !== '') {
            $body['replyTo'] = $reply_to;
        }
        $name = self::site_name();
        if ($name !== '') {
            $body['fromName'] = $name;
        }
        try {
            $client = new WebMaven_WP_API_Client();
            if (!$client->is_configured()) {
                return $out;
            }
            // Last argument false: the reply never reaches the PHP log.
            $response = $client->make_request(self::REPLY_ROUTE, 'POST', $body, null, self::REPLY_TIMEOUT, 0, false);
        } catch (\Throwable $e) {
            return $out;
        }
        if (!is_array($response)) {
            return $out;
        }
        $data = isset($response['data']) && is_array($response['data']) ? $response['data'] : [];
        if (!empty($response['success']) && !empty($data['sent'])) {
            $out['sent'] = true;
            return $out;
        }
        if (WebMaven_Site_Mail::is_monthly_cap($response)) {
            $resets_at = WebMaven_Site_Mail::cap_resets_at($response);
            if ($resets_at <= time()) {
                $resets_at = time() + WebMaven_Site_Mail::CAP_FALLBACK_SECONDS;
            }
            $out['cap'] = WebMaven_Site_Mail::cap_notice_text($resets_at);
        }
        return $out;
    }

    /** wp_mail, from the business's name unless the site set one itself. */
    private static function send_with_wp_mail($to, $subject, $html, $reply_to) {
        $headers = ['Content-Type: text/html; charset=UTF-8'];
        if ($reply_to !== '') {
            $headers[] = 'Reply-To: ' . $reply_to;
        }
        $site = self::site_name();
        $from_name = function ($name) use ($site) {
            return ($site !== '' && (trim((string) $name) === '' || $name === 'WordPress')) ? $site : $name;
        };
        add_filter('wp_mail_from_name', $from_name, 99);
        try {
            $sent = (bool) wp_mail($to, $subject, $html, $headers);
        } catch (\Throwable $e) {
            $sent = false;
        }
        remove_filter('wp_mail_from_name', $from_name, 99);
        return $sent;
    }

    /**
     * Where the visitor's answer goes: the business email (wm_biz_email),
     * else the site's admin email; '' for a placeholder address (the relay
     * then sends replies to the owner).
     */
    public static function business_email() {
        foreach (['wm_biz_email', 'admin_email'] as $option) {
            $raw = get_option($option, '');
            if (!is_string($raw) || !preg_match('/[^\s<>,;:"]+@[^\s<>,;:"]+/', $raw, $m)) {
                continue;
            }
            $email = self::email($m[0]);
            if ($email !== '' && !self::placeholder_address($email)) {
                return $email;
            }
        }
        return '';
    }

    /** admin@example.com and the like: the relay drops them too (example.com, .org, .net). */
    private static function placeholder_address($email) {
        return (bool) preg_match('/@(?:[a-z0-9-]+\.)*example\.(?:com|org|net)$/i', (string) $email);
    }

    private static function site_name() {
        $name = function_exists('get_bloginfo') ? (string) get_bloginfo('name') : '';
        if (function_exists('wp_specialchars_decode')) {
            $name = wp_specialchars_decode($name, ENT_QUOTES);
        }
        return trim(str_replace(["\r", "\n"], ' ', $name));
    }

    private static function replies_last_hour() {
        global $wpdb;
        return (int) $wpdb->get_var($wpdb->prepare(
            'SELECT COUNT(*) FROM %i WHERE kind = %s AND at >= %s',
            self::events_table(),
            'reply',
            gmdate('Y-m-d H:i:s', time() - self::HOUR)
        ));
    }

    // ── Export ─────────────────────────────────────────────────────────────

    /**
     * {filename, csv, rows}: the messages of the range (from and to are days
     * in the site's time zone, both optional) and status (one status, or
     * everything but spam), oldest first, at most 10,000. UTF-8 with a BOM,
     * formula cells escaped. Each exported message gets an export event.
     */
    public static function export(array $q, $actor = 0) {
        $from = self::day_param($q['from'] ?? '');
        $to = self::day_param($q['to'] ?? '');
        if ($from !== '' && $to !== '' && $from > $to) {
            throw self::error('VALIDATION', 'The first day of the export is after its last day.');
        }
        $rows = [];
        if (self::maybe_install()) {
            global $wpdb;
            $where = 'created_at >= %s AND created_at <= %s';
            $args = [$from !== '' ? self::day_bound($from, false) : '1970-01-01 00:00:00', $to !== '' ? self::day_bound($to, true) : self::now_sql()];
            $status = (string) ($q['status'] ?? '');
            if (in_array($status, self::STATUSES, true)) {
                $where .= ' AND status = %s';
                $args[] = $status;
            } else {
                $where .= ' AND status <> %s';
                $args[] = 'spam';
            }
            $args[] = self::EXPORT_MAX;
            $rows = $wpdb->get_results($wpdb->prepare(
                "SELECT * FROM %i WHERE {$where} ORDER BY created_at ASC, id ASC LIMIT %d", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $where is built from fixed fragments with placeholders (list_filters).
                array_merge([self::table()], $args)
            ), ARRAY_A);
            $rows = is_array($rows) ? $rows : [];
        }
        if ($rows) {
            self::add_events(array_column($rows, 'id'), 'export', $actor, ['rows' => count($rows)]);
        }
        $day = function_exists('wp_date') ? (string) wp_date('Y-m-d') : gmdate('Y-m-d');
        return ['filename' => 'messages-' . $day . '.csv', 'csv' => self::csv($rows), 'rows' => count($rows)];
    }

    /** The CSV file: a BOM, a header row, one row per message, CRLF lines. */
    public static function csv(array $rows) {
        $lines = [self::csv_line(['Date', 'Status', 'Form', 'Name', 'Email', 'Phone', 'Message', 'Agreed to emails', 'Page', 'Note', 'All fields'])];
        foreach ($rows as $r) {
            $all = [];
            $decoded = json_decode((string) ($r['fields'] ?? ''), true);
            foreach (is_array($decoded) ? $decoded : [] as $f) {
                if (is_array($f) && isset($f['label'], $f['value'])) {
                    $all[] = $f['label'] . ': ' . $f['value'];
                }
            }
            $lines[] = self::csv_line([
                self::local_time($r['created_at']),
                self::status_label($r['status']),
                $r['form_title'],
                $r['name'],
                $r['email'],
                $r['phone'],
                $r['message'],
                (int) $r['consent'] === 1 ? 'Yes' : 'No',
                $r['page_url'],
                (string) ($r['note'] ?? ''),
                implode("\n", $all),
            ]);
        }
        return "\xEF\xBB\xBF" . implode("\r\n", $lines) . "\r\n";
    }

    public static function csv_line(array $cells) {
        return implode(',', array_map([__CLASS__, 'csv_cell'], $cells));
    }

    /**
     * One cell. A cell starting with =, +, -, @, a tab or a carriage return
     * gets a leading apostrophe, so a spreadsheet never runs it as a formula.
     */
    public static function csv_cell($value) {
        $s = (string) $value;
        if ($s !== '' && strpos("=+-@\t\r", $s[0]) !== false) {
            $s = "'" . $s;
        }
        if (preg_match('/[",\r\n]/', $s) || ($s !== '' && ($s[0] === ' ' || substr($s, -1) === ' '))) {
            $s = '"' . str_replace('"', '""', $s) . '"';
        }
        return $s;
    }

    private static function day_param($value) {
        $day = trim(is_scalar($value) ? (string) $value : '');
        if ($day === '') {
            return '';
        }
        if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $day, $m) || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            throw self::error('VALIDATION', 'Choose the days of the export again (year, month and day).');
        }
        return $day;
    }

    /** The first or last second of a day in the site's time zone, in UTC. */
    private static function day_bound($day, $end) {
        $zone = function_exists('wp_timezone') ? wp_timezone() : new DateTimeZone('UTC');
        $at = new DateTimeImmutable($day . ($end ? ' 23:59:59' : ' 00:00:00'), $zone);
        return $at->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }

    private static function local_time($utc) {
        $ts = strtotime((string) $utc . ' UTC');
        if ($ts === false) {
            return '';
        }
        return function_exists('wp_date') ? (string) wp_date('Y-m-d H:i', $ts) : gmdate('Y-m-d H:i', $ts);
    }

    private static function status_label($status) {
        $labels = ['new' => 'New', 'answered' => 'Answered', 'archived' => 'Archived', 'spam' => 'Spam'];
        return $labels[self::status_of($status)];
    }

    // ── The owner's alert ──────────────────────────────────────────────────

    /** Sends this request's alert report at its end ('raise' wins over 'resolve'). */
    public static function queue_alert($what) {
        if ($what !== 'raise' && $what !== 'resolve') {
            return;
        }
        if (self::$alert !== 'raise') {
            self::$alert = $what;
        }
        if (!self::$alert_hooked && function_exists('add_action')) {
            self::$alert_hooked = true;
            add_action('shutdown', [__CLASS__, 'flush_alert'], 1000);
        }
    }

    /** A message was read, handled or deleted: resolve once none is left unread. */
    private static function resolve_if_cleared($changed) {
        if ($changed && self::count_unseen() === 0) {
            self::queue_alert('resolve');
        }
    }

    /**
     * shutdown: POST /alerts/report, FORM_SUBMISSIONS raised with a count, or
     * resolved. The response has been sent by then (the visitor and the app
     * never wait for it); a failure is logged and dropped.
     */
    public static function flush_alert() {
        $what = self::$alert;
        self::$alert = null;
        if ($what === null) {
            return;
        }
        try {
            $unseen = self::count_unseen();
            if ($what === 'resolve' && $unseen > 0) {
                return;
            }
            $instance_id = class_exists('WebMaven_Alert_Detector')
                ? WebMaven_Alert_Detector::instance_id()
                : (string) get_option('webmaven_wp_instance_id', '');
            if ($instance_id === '' || !class_exists('WebMaven_WP_API_Client')) {
                return;
            }
            $client = new WebMaven_WP_API_Client();
            if (!$client->is_configured()) {
                return;
            }
            self::finish_response();
            $body = $what === 'raise'
                ? ['instanceId' => $instance_id, 'alerts' => [self::alert_payload($unseen)], 'resolvedTypes' => []]
                : ['instanceId' => $instance_id, 'alerts' => [], 'resolvedTypes' => [self::ALERT_TYPE]];
            $client->make_request('/alerts/report', 'POST', $body, null, self::ALERT_TIMEOUT);
        } catch (\Throwable $e) {
            WebMaven_Log::write('WPMaven messages: the new-message alert was not sent (' . get_class($e) . ').');
        }
    }

    /** The alert, in WPMaven's words, with a count only: never a name or the visitor's text. */
    public static function alert_payload($count) {
        return [
            'type' => self::ALERT_TYPE,
            'severity' => 'INFO',
            'title' => self::ALERT_TITLE,
            'message' => self::ALERT_MESSAGE,
            'data' => ['count' => max(1, (int) $count)],
        ];
    }

    /** The visitor or the app gets the answer now; the report goes after. */
    private static function finish_response() {
        if (function_exists('fastcgi_finish_request')) {
            @fastcgi_finish_request();
        } elseif (function_exists('litespeed_finish_request')) {
            @litespeed_finish_request();
        }
    }

    // ── Retention ──────────────────────────────────────────────────────────

    /**
     * The daily clean-up: messages older than the retention and spam older
     * than 30 days go with their timeline; the address hashes older than a
     * day are blanked (they only count the last hour).
     */
    public static function purge() {
        try {
            if (!self::installed()) {
                return;
            }
            global $wpdb;
            $unseen = self::count_unseen();
            self::delete_matching('created_at < %s', [gmdate('Y-m-d H:i:s', time() - self::retention_days() * self::DAY)]);
            self::delete_matching('status = %s AND created_at < %s', ['spam', gmdate('Y-m-d H:i:s', time() - self::SPAM_KEEP_DAYS * self::DAY)]);
            $wpdb->query($wpdb->prepare(
                'UPDATE %i SET ip_hash = %s WHERE ip_hash <> %s AND created_at < %s',
                self::table(),
                '',
                '',
                gmdate('Y-m-d H:i:s', time() - self::IP_HASH_KEEP_SECONDS)
            ));
            self::resolve_if_cleared($unseen > 0);
        } catch (\Throwable $e) {
            WebMaven_Log::write('WPMaven messages: the daily clean-up stopped (' . get_class($e) . ').');
        }
    }

    /** Deletes the matching messages in batches (at most 20,000 a run). */
    private static function delete_matching($condition, array $args) {
        global $wpdb;
        for ($round = 0; $round < self::PURGE_ROUNDS; $round++) {
            $ids = $wpdb->get_col($wpdb->prepare(
                "SELECT id FROM %i WHERE {$condition} ORDER BY id ASC LIMIT %d", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $condition is one of this class's fixed conditions with placeholders.
                array_merge([self::table()], $args, [self::PURGE_BATCH])
            ));
            if (!$ids) {
                return;
            }
            self::delete_ids($ids);
            if (count($ids) < self::PURGE_BATCH) {
                return;
            }
        }
    }

    // ── Small helpers ──────────────────────────────────────────────────────

    /** "CODE: sentence", the shape the API reads. */
    private static function error($code, $sentence) {
        return new Exception($code . ': ' . $sentence);
    }


    private static function now_sql() {
        return gmdate('Y-m-d H:i:s');
    }

    /** "2026-10-05T10:12:00Z", or null for an empty date. */
    private static function iso($datetime) {
        $s = trim((string) $datetime);
        if ($s === '' || strpos($s, '0000-00-00') === 0) {
            return null;
        }
        $ts = strtotime($s . ' UTC');
        return $ts === false ? null : gmdate('Y-m-d\TH:i:s\Z', $ts);
    }

    private static function status_of($status) {
        return in_array((string) $status, self::STATUSES, true) ? (string) $status : 'new';
    }

    private static function first_line($message) {
        foreach (explode("\n", (string) $message) as $line) {
            $line = trim($line);
            if ($line !== '') {
                return self::cut($line, self::FIRST_LINE_MAX);
            }
        }
        return '';
    }

    /** "WPMaven's", the brand's, or "the plugin's" (white label sites never read WPMaven). */
    private static function brand_possessive() {
        $name = class_exists('WebMaven_Brand') ? WebMaven_Brand::name_or('') : 'WPMaven';
        return $name !== '' ? $name . "'s" : "the plugin's";
    }
}
