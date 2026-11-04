<?php
/**
 * The connect wizard's setup password.
 *
 * The WPMaven dashboard connects a self-hosted site through WordPress's
 * "authorize application" screen, which makes an application password named
 * "WPMaven Dashboard" (app_id APP_ID) with the approving administrator's
 * rights. The WPMaven API uses it once, to check the site and switch this
 * plugin on, and deletes it when the connect is done (since 2026-10-04).
 *
 * Connects before that never deleted it, and its value came back to the
 * dashboard in an address its servers logged. A connect that could not reach
 * the site, or one whose delete failed, leaves it too. So this plugin deletes
 * every password with that app_id once it is an hour old, from WP-Cron every
 * hour: a connect in progress takes minutes and is never touched, and
 * nothing else ever uses that app_id (the plugin talks to WPMaven with its own
 * keys). Other application passwords are never read beyond their app_id and
 * age, and never changed.
 */

if (!defined('ABSPATH')) exit;

class WebMaven_Setup_Password {

    /** The app_id the dashboard's connect wizard gives WordPress (ConnectSiteWizard). */
    const APP_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

    /** A setup password younger than this may belong to a connect in progress. */
    const GRACE_SECONDS = 3600;

    /** The hourly WP-Cron event. */
    const SWEEP_HOOK = 'webmaven_wp_setup_password_sweep';

    public static function init() {
        add_action('init', [__CLASS__, 'schedule']);
        add_action(self::SWEEP_HOOK, [__CLASS__, 'sweep']);
    }

    public static function schedule() {
        if (!wp_next_scheduled(self::SWEEP_HOOK)) {
            wp_schedule_event(time() + 300, 'hourly', self::SWEEP_HOOK);
        }
    }

    /**
     * Delete every setup password older than GRACE_SECONDS, for every user
     * who has application passwords. Returns how many were deleted.
     */
    public static function sweep($now = null) {
        if (!class_exists('WP_Application_Passwords') || !function_exists('get_users')) {
            return 0;
        }
        $now = $now === null ? time() : (int) $now;
        $user_ids = get_users([
            'meta_key' => '_application_passwords',
            'fields'   => 'ID',
            'number'   => 500,
        ]);
        $deleted = 0;
        foreach ((array) $user_ids as $user_id) {
            $user_id = (int) $user_id;
            if ($user_id <= 0) continue;
            $passwords = WP_Application_Passwords::get_user_application_passwords($user_id);
            if (!is_array($passwords)) continue;
            foreach ($passwords as $item) {
                if (!is_array($item) || ($item['app_id'] ?? '') !== self::APP_ID) continue;
                $created = (int) ($item['created'] ?? 0);
                if ($created <= 0 || $now - $created < self::GRACE_SECONDS) continue;
                $uuid = (string) ($item['uuid'] ?? '');
                if ($uuid === '') continue;
                $result = WP_Application_Passwords::delete_application_password($user_id, $uuid);
                if ($result === true) $deleted++;
            }
        }
        return $deleted;
    }
}
