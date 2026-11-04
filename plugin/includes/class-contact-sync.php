<?php
/**
 * WebMaven Contact Sync
 * Mirrors the site's marketing audience to the API's SubscribedContact
 * table (POST /contacts/sync), which drives the contact-cap engine.
 *
 * Contacts are WooCommerce customers and guest-order billing emails only.
 * WordPress users are not automatically contacts, so site staff never
 * count against the owner's plan. Without WooCommerce nothing is synced.
 *
 * Full reconcile twice daily via WP cron (mode 'full': current site truth,
 * including consent-revoked contacts reported as unsubscribed), plus
 * lightweight incremental pushes queued on order/customer events and
 * flushed on shutdown (mode 'incremental'). Failed batches stay queued and
 * retry on the next flush or cron run; nothing here may break the site.
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/class-webmaven-log.php';
require_once __DIR__ . '/class-webmaven-choices.php';

class WebMaven_Contact_Sync {

    const CRON_HOOK = 'webmaven_contact_sync';
    const QUEUE_OPTION = 'webmaven_contact_sync_queue';
    const OPTOUT_OPTION = 'webmaven_contact_sync_optouts';
    const BATCH_SIZE = 500;

    private static $flush_registered = false;

    /**
     * Register WP cron schedule and event hooks.
     */
    public static function init() {
        // Only once the owner chose to copy the store's customers for email
        // campaigns (WebMaven_Choices); until then nothing is scheduled or sent.
        if (!WebMaven_Choices::on('contact_sync_enabled')) {
            if (function_exists('wp_next_scheduled') && wp_next_scheduled(self::CRON_HOOK)) {
                wp_clear_scheduled_hook(self::CRON_HOOK);
            }
            return;
        }
        // Self-healing schedule, same idiom as the alert detector.
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time(), 'twicedaily', self::CRON_HOOK);
        }
        add_action(self::CRON_HOOK, [__CLASS__, 'run_full_sync']);

        // Incremental signals. The handlers only queue locally and bail
        // without WooCommerce, so registering them unconditionally is safe.
        add_action('woocommerce_new_order', [__CLASS__, 'on_new_order'], 10, 1);
        // Email campaigns (1.2.28): the checkout opt-in is written while the
        // order is processed, after woocommerce_new_order on the block
        // checkout, so a processed order is pushed again with its yes.
        add_action('woocommerce_checkout_order_processed', [__CLASS__, 'on_order_processed'], 10, 1);
        add_action('woocommerce_store_api_checkout_order_processed', [__CLASS__, 'on_order_processed'], 10, 1);
        add_action('woocommerce_created_customer', [__CLASS__, 'on_customer_registered'], 10, 1);
        add_action('delete_user', [__CLASS__, 'on_user_deleted'], 10, 1);

        register_deactivation_hook(WEBMAVEN_WP_FILE, [__CLASS__, 'on_deactivate']);
    }

    /**
     * Clear the cron event on deactivation. The queue option is kept so
     * pending unsubscribes survive a deactivate/reactivate cycle.
     */
    public static function on_deactivate() {
        wp_clear_scheduled_hook(self::CRON_HOOK);
    }

    // ── Incremental event handlers ─────────────────────

    public static function on_new_order($order_id) {
        try {
            if (!class_exists('WooCommerce')) return;
            $order = wc_get_order($order_id);
            if (!$order || !is_a($order, 'WC_Order')) return;

            $email = strtolower(sanitize_email($order->get_billing_email()));
            if (!$email || !is_email($email)) return;

            $signal = self::order_consent_status($order);
            $status = $signal !== null ? $signal : 'subscribed';

            // A fresh consenting order is a current signal from this person;
            // it clears any stored local opt-out (e.g. from an earlier
            // account deletion). An order-level opt-out needs no list entry:
            // its meta persists and the reconcile keeps reading it.
            if ($status === 'subscribed') {
                self::remove_optout($email);
            }

            $created = $order->get_date_created();
            $entry = [
                'email' => $email,
                'status' => $status,
                'source' => 'woocommerce',
                'subscribedAt' => $created
                    ? gmdate('Y-m-d\TH:i:s\Z', $created->getTimestamp())
                    : gmdate('Y-m-d\TH:i:s\Z'),
            ];
            self::queue_contact(self::with_order_consent($entry, $order, $signal));
        } catch (\Throwable $e) {
            WebMaven_Log::write('WebMaven Contact Sync: on_new_order failed: ' . $e->getMessage());
        }
    }

    public static function on_customer_registered($customer_id) {
        try {
            if (!class_exists('WooCommerce')) return;
            $user = get_userdata($customer_id);
            if (!$user || !$user->user_email) return;

            $email = strtolower(sanitize_email($user->user_email));
            if (!$email || !is_email($email)) return;

            self::remove_optout($email);
            $entry = [
                'email' => $email,
                'status' => 'subscribed',
                'source' => 'woocommerce',
            ];
            $registered = strtotime($user->user_registered . ' UTC');
            if ($registered) {
                $entry['subscribedAt'] = gmdate('Y-m-d\TH:i:s\Z', $registered);
            }
            self::queue_contact($entry);
        } catch (\Throwable $e) {
            WebMaven_Log::write('WebMaven Contact Sync: on_customer_registered failed: ' . $e->getMessage());
        }
    }

    /**
     * delete_user fires before the row is removed, so the email is still
     * readable here. Deletion is an opt-out signal; it also goes on the
     * local opt-out list because the person's guest orders survive the
     * deletion and would otherwise re-subscribe them at the next reconcile.
     */
    public static function on_user_deleted($user_id) {
        try {
            $user = get_userdata($user_id);
            if (!$user || !$user->user_email) return;

            $email = strtolower(sanitize_email($user->user_email));
            if (!$email || !is_email($email)) return;

            if (!self::is_marketing_contact($user, $email)) return;

            self::add_optout($email);
            self::queue_contact([
                'email' => $email,
                'status' => 'unsubscribed',
                'source' => 'woocommerce',
                'unsubscribedAt' => gmdate('Y-m-d\TH:i:s\Z'),
            ]);
        } catch (\Throwable $e) {
            WebMaven_Log::write('WebMaven Contact Sync: on_user_deleted failed: ' . $e->getMessage());
        }
    }

    /**
     * Only WooCommerce customers (by role or by having placed an order) are
     * synced contacts; deleting an admin or editor is not an unsubscribe.
     */
    private static function is_marketing_contact($user, $email) {
        if (in_array('customer', (array) $user->roles, true)) {
            return true;
        }
        if (!class_exists('WooCommerce')) {
            return false;
        }
        $orders = wc_get_orders([
            'customer' => $email,
            'limit' => 1,
            'return' => 'ids',
        ]);
        return !empty($orders);
    }

    /**
     * A processed order (the checkout is done, the opt-in written): pushed
     * again when it carries a yes, so it does not wait for the next reconcile.
     */
    public static function on_order_processed($order_or_id) {
        try {
            if (!class_exists('WooCommerce')) return;
            $order = is_object($order_or_id) ? $order_or_id : wc_get_order($order_or_id);
            if (!$order || !is_a($order, 'WC_Order')) return;
            if (!class_exists('WebMaven_Marketing_Consent') || WebMaven_Marketing_Consent::order_optin($order) === null) return;
            self::on_new_order($order->get_id());
        } catch (\Throwable $e) {
            WebMaven_Log::write('WebMaven Contact Sync: on_order_processed failed: ' . $e->getMessage());
        }
    }

    /**
     * Email campaigns (1.2.28): the yes an order carries, added to a sync
     * entry. The checkout opt-in comes first; a newsletter plugin's own
     * opt-in signal (the consent meta keys) counts as the site's signal. A
     * customer with neither is synced without a yes: buying is not consent.
     * An entry that is unsubscribed never carries one.
     */
    private static function with_order_consent(array $entry, $order, $signal = null) {
        if (($entry['status'] ?? '') !== 'subscribed') return $entry;
        $optin = class_exists('WebMaven_Marketing_Consent') ? WebMaven_Marketing_Consent::order_optin($order) : null;
        if ($optin !== null) {
            if (empty($entry['consentAt']) || strcmp($optin['consentAt'], (string) $entry['consentAt']) > 0) {
                $entry['consent'] = true;
                $entry['consentAt'] = $optin['consentAt'];
                $entry['consentSource'] = 'checkout';
                $entry['consentEvidence'] = $optin['consentEvidence'];
            }
        } elseif ($signal === 'subscribed' && empty($entry['consent'])) {
            $entry['consent'] = true;
            $entry['consentSource'] = 'site_signal';
            $entry['consentEvidence'] = 'Opt-in recorded by the site';
        }
        if (empty($entry['name']) && method_exists($order, 'get_billing_first_name')) {
            $name = trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name());
            if ($name !== '') $entry['name'] = $name;
        }
        return $entry;
    }

    /**
     * A person who said yes on a site form (WebMaven_Marketing_Consent). A
     * fresh yes is current: it clears a stored local opt-out, like a
     * consenting order does.
     */
    public static function queue_consented(array $entry) {
        try {
            if (empty($entry['email'])) return;
            self::remove_optout($entry['email']);
            self::queue_contact($entry);
        } catch (\Throwable $e) {
            WebMaven_Log::write('WebMaven Contact Sync: queue_consented failed: ' . $e->getMessage());
        }
    }

    // ── Queue ──────────────────────────────────────────

    private static function queue_contact(array $entry) {
        $queue = get_option(self::QUEUE_OPTION, []);
        if (!is_array($queue)) $queue = [];
        $queue[] = $entry;
        // Cap so a long API outage cannot grow the option unbounded; the
        // twice-daily full reconcile restores anything dropped here.
        if (count($queue) > 2000) {
            $queue = array_slice($queue, -2000);
        }
        update_option(self::QUEUE_OPTION, $queue, false);

        if (!self::$flush_registered) {
            self::$flush_registered = true;
            add_action('shutdown', [__CLASS__, 'flush_queue']);
        }
    }

    /**
     * Push queued incremental entries in batches. Failures keep the queue
     * intact for the next flush or cron run.
     */
    public static function flush_queue() {
        try {
            $queue = get_option(self::QUEUE_OPTION, []);
            if (empty($queue) || !is_array($queue)) return;

            $instance_id = get_option('webmaven_wp_instance_id', '');
            if (!$instance_id) return;

            $api_client = new WebMaven_WP_API_Client();
            if (!$api_client->is_configured()) return;

            while (!empty($queue)) {
                $batch = array_slice($queue, 0, self::BATCH_SIZE);
                $response = $api_client->make_request('/contacts/sync', 'POST', [
                    'instanceId' => $instance_id,
                    'mode' => 'incremental',
                    'contacts' => array_values($batch),
                ], null, 15);

                if (empty($response['success'])) {
                    WebMaven_Log::write('WebMaven Contact Sync: incremental flush failed, keeping '
                        . count($queue) . ' entries queued: ' . ($response['error'] ?? 'unknown error'));
                    break;
                }

                $queue = array_slice($queue, count($batch));
                update_option(self::QUEUE_OPTION, $queue, false);
            }
        } catch (\Throwable $e) {
            WebMaven_Log::write('WebMaven Contact Sync: queue flush failed: ' . $e->getMessage());
        }
    }

    // ── Full reconcile (WP cron, twice daily) ──────────

    public static function run_full_sync() {
        try {
            if (!class_exists('WooCommerce')) return;

            $instance_id = get_option('webmaven_wp_instance_id', '');
            if (!$instance_id) return;

            $api_client = new WebMaven_WP_API_Client();
            if (!$api_client->is_configured()) return;

            // Ship anything the event queue is still holding first, so the
            // snapshot below is the newest state the API sees.
            self::flush_queue();

            $contacts = self::collect_contacts();
            if (empty($contacts)) return;

            foreach (array_chunk($contacts, self::BATCH_SIZE) as $batch) {
                $response = $api_client->make_request('/contacts/sync', 'POST', [
                    'instanceId' => $instance_id,
                    'mode' => 'full',
                    'contacts' => $batch,
                ]);

                if (empty($response['success'])) {
                    WebMaven_Log::write('WebMaven Contact Sync: full sync batch failed: '
                        . ($response['error'] ?? 'unknown error'));
                    // Stop rather than hammer a failing API; the next cron
                    // run recomputes and retries the whole snapshot.
                    return;
                }
            }

            update_option('webmaven_contact_sync_last_full', gmdate('c'), false);
        } catch (\Throwable $e) {
            WebMaven_Log::write('WebMaven Contact Sync: full sync failed: ' . $e->getMessage());
        }
    }

    /**
     * Collect the current marketing audience: registered WooCommerce
     * customers plus guest-order billing emails, with consent signals and
     * the local opt-out list applied.
     */
    private static function collect_contacts() {
        $contacts = [];
        $user_ids = [];

        // Registered customers (the customer role only; staff are skipped).
        $customers = get_users([
            'role' => 'customer',
            'fields' => ['ID', 'user_email', 'user_registered'],
        ]);
        foreach ($customers as $customer) {
            $email = strtolower(sanitize_email($customer->user_email));
            if (!$email || !is_email($email)) continue;
            $contacts[$email] = [
                'email' => $email,
                'status' => 'subscribed',
                'source' => 'woocommerce',
            ];
            $registered = strtotime($customer->user_registered . ' UTC');
            if ($registered) {
                $contacts[$email]['subscribedAt'] = gmdate('Y-m-d\TH:i:s\Z', $registered);
            }
            $user_ids[$email] = (int) $customer->ID;
        }

        // Order billing emails (guests and customers alike). Oldest first so
        // the first order seen sets subscribedAt and later consent signals
        // override earlier ones. Capped at 20,000 orders per run.
        //
        // Real orders only (type shop_order). WooCommerce keeps a refund as
        // an order of its own kind with the status completed, and hands it
        // back unless the type is named: a refund has no billing email, so
        // one refund in the store ended the whole sync, twice a day, since
        // this loop was written. Anything that is still not an order (a
        // listing another plugin filters) is skipped, never asked.
        $offset = 0;
        do {
            $orders = wc_get_orders([
                'type' => 'shop_order',
                'limit' => 100,
                'offset' => $offset,
                'status' => ['completed', 'processing', 'on-hold'],
                'orderby' => 'date',
                'order' => 'ASC',
                'return' => 'objects',
            ]);

            foreach ($orders as $order) {
                if (!is_a($order, 'WC_Order')) continue;
                $email = strtolower(sanitize_email($order->get_billing_email()));
                if (!$email || !is_email($email)) continue;

                if (!isset($contacts[$email])) {
                    $created = $order->get_date_created();
                    $contacts[$email] = [
                        'email' => $email,
                        'status' => 'subscribed',
                        'source' => 'woocommerce',
                    ];
                    if ($created) {
                        $contacts[$email]['subscribedAt'] = gmdate('Y-m-d\TH:i:s\Z', $created->getTimestamp());
                    }
                }

                $signal = self::order_consent_status($order);
                if ($signal !== null) {
                    $contacts[$email]['status'] = $signal;
                }
                // Email campaigns: the newest yes on any of their orders.
                $contacts[$email] = self::with_order_consent($contacts[$email], $order, $signal);
            }

            $offset += 100;
        } while (count($orders) === 100 && $offset < 20000);

        // Profile-level consent for registered customers, then the local
        // opt-out list (deleted accounts) as the strongest signal.
        $optouts = self::get_optouts();
        foreach ($contacts as $email => $entry) {
            if (isset($user_ids[$email])) {
                $signal = self::user_consent_status($user_ids[$email]);
                if ($signal !== null) {
                    $contacts[$email]['status'] = $signal;
                }
            }
            if (isset($optouts[$email])) {
                $contacts[$email]['status'] = 'unsubscribed';
            }
        }

        return array_values($contacts);
    }

    // ── Marketing consent ──────────────────────────────

    /**
     * Meta keys that carry a marketing-consent signal. WooCommerce core
     * stores none; these are written by common newsletter integrations.
     * Filterable so a site using another consent plugin can add its key.
     */
    private static function consent_meta_keys() {
        return apply_filters('webmaven_contact_sync_consent_meta_keys', [
            'marketing_consent',
            '_marketing_consent',
            'marketing_opt_in',
            'mailchimp_woocommerce_is_subscribed',
        ]);
    }

    /**
     * Map a stored consent value to a status. Returns null when the value
     * is absent or empty, i.e. no signal either way.
     */
    private static function consent_signal($value) {
        if ($value === null || $value === '' || $value === []) return null;
        if (is_bool($value)) return $value ? 'subscribed' : 'unsubscribed';
        if (!is_scalar($value)) return null;
        $value = strtolower(trim((string) $value));
        if ($value === '') return null;
        return in_array($value, ['no', '0', 'false', 'unsubscribed'], true)
            ? 'unsubscribed'
            : 'subscribed';
    }

    private static function order_consent_status($order) {
        foreach (self::consent_meta_keys() as $key) {
            $signal = self::consent_signal($order->get_meta($key));
            if ($signal !== null) return $signal;
        }
        return null;
    }

    private static function user_consent_status($user_id) {
        foreach (self::consent_meta_keys() as $key) {
            $signal = self::consent_signal(get_user_meta($user_id, $key, true));
            if ($signal !== null) return $signal;
        }
        return null;
    }

    // ── Local opt-out list ─────────────────────────────
    //
    // Emails whose opt-out no longer has a site-side record (a deleted
    // account whose guest orders remain). Without this list the reconcile
    // would re-subscribe them from those orders.

    private static function get_optouts() {
        $optouts = get_option(self::OPTOUT_OPTION, []);
        return is_array($optouts) ? $optouts : [];
    }

    private static function add_optout($email) {
        $optouts = self::get_optouts();
        $optouts[$email] = time();
        update_option(self::OPTOUT_OPTION, $optouts, false);
    }

    private static function remove_optout($email) {
        $optouts = self::get_optouts();
        if (isset($optouts[$email])) {
            unset($optouts[$email]);
            update_option(self::OPTOUT_OPTION, $optouts, false);
        }
    }
}
