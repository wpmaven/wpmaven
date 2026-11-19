<?php
/**
 * The site's administrators stay.
 *
 * While a call from WPMaven's service runs (activate(), after the webhook
 * handler's token check), two accounts and the administrator role are out of
 * its reach, whatever path the call takes:
 *
 *   - the site's LAST administrator: deleting or demoting it leaves nobody
 *     who can manage the site, and cuts WPMaven off;
 *   - the administrator WPMaven works through: the account the webhook
 *     handler runs as (the first administrator by login, the same query the
 *     handler uses, see webhook_admin()). Deleting or demoting it cuts
 *     WPMaven off from the site;
 *   - the administrator ROLE: it cannot be deleted, reset or lose a
 *     capability.
 *
 * WordPress's own hooks stop the change before it is written: delete_user and
 * remove_user_from_blog fire before a user is deleted,
 * update/delete_user_metadata before a role change reaches the database,
 * pre_update_option and delete_option before the role definitions change.
 * Whatever code path ends in wp_delete_user(), WP_User::set_role(),
 * remove_role(), remove_cap() or update_option(wp_user_roles) is stopped,
 * with the reason. The refusal is an Error, not an Exception, so a plugin's
 * catch (Exception $e) cannot swallow it and carry on as if it had worked.
 * (A call cannot manage users at all: the capability limit, WebMaven_Remote_Caps,
 * takes those capabilities away; this guard holds even so.)
 *
 * Nothing here refuses the owner's own work in wp-admin: the hooks only act
 * while a call runs.
 */

if (!defined('ABSPATH')) {
    exit;
}

/** Thrown to stop a change to a protected administrator or to the administrator role. */
class WebMaven_Admin_Guard_Refusal extends \Error {
}

class WebMaven_Admin_Guard {

    const ROLE = 'administrator';

    /** Capabilities whose explicit denial on a protected account is a demotion. */
    const KEY_CAPS = [
        'manage_options', 'install_plugins', 'activate_plugins', 'update_plugins', 'delete_plugins',
        'edit_users', 'list_users', 'create_users', 'delete_users', 'promote_users',
        'switch_themes', 'edit_theme_options', 'update_core',
    ];

    const REFUSAL_LAST = 'This is refused: %s is the only administrator of this site. Deleting or demoting it would leave nobody who can manage the site, and would cut WPMaven off from it. Add another administrator first.';

    const REFUSAL_WPMAVEN = 'This is refused: %s is the administrator account WPMaven works through on this site. Deleting or demoting it would cut WPMaven off from the site. Another administrator can be changed instead.';

    const REFUSAL_ROLE = 'This is refused: it would delete or weaken the administrator role, which the site\'s administrators and WPMaven need.';

    /** @var bool */
    private static $active = false;

    /** @var string */
    private static $context = '';

    /** @var int The account the webhook handler set as the current user. */
    private static $acting_admin = 0;

    // ── State ──────────────────────────────────────────────────────────────

    /** A call from WPMaven's service runs from here to the end of the request. */
    public static function activate($context, $acting_admin = 0) {
        self::$active = true;
        self::$context = (string) $context;
        self::$acting_admin = (int) $acting_admin;
    }

    /** For tests and for code that hands control back to the owner. */
    public static function deactivate() {
        self::$active = false;
        self::$context = '';
        self::$acting_admin = 0;
    }

    public static function is_active() {
        return self::$active;
    }

    public static function context() {
        return self::$context;
    }

    /** Hooks. They do nothing unless WPMaven is acting. */
    public static function register() {
        add_action('delete_user', [__CLASS__, 'on_delete_user'], 0, 1);
        add_action('wpmu_delete_user', [__CLASS__, 'on_delete_user'], 0, 1);
        add_action('remove_user_from_blog', [__CLASS__, 'on_delete_user'], 0, 1);
        add_filter('update_user_metadata', [__CLASS__, 'filter_update_user_meta'], 0, 5);
        add_filter('delete_user_metadata', [__CLASS__, 'filter_delete_user_meta'], 0, 5);
        add_filter('pre_update_option', [__CLASS__, 'filter_pre_update_option'], 0, 3);
        add_action('delete_option', [__CLASS__, 'on_delete_option'], 0, 1);
    }

    // ── Who is protected ───────────────────────────────────────────────────

    /**
     * The administrator the webhook handler runs as. The ONE definition: the
     * handler and the REST fallback call this, so the account protected here
     * is always the account WPMaven actually uses.
     */
    public static function webhook_admin() {
        $admins = get_users(['role' => self::ROLE, 'number' => 1]);
        return !empty($admins) ? $admins[0] : null;
    }

    /** @return int[] Every administrator of this site. */
    public static function admin_ids() {
        $ids = get_users(['role' => self::ROLE, 'fields' => 'ID']);
        return array_values(array_unique(array_map('intval', (array) $ids)));
    }

    public static function is_admin_user($user_id) {
        $user = get_userdata((int) $user_id);
        return $user && in_array(self::ROLE, (array) $user->roles, true);
    }

    /** True when this user is the site's only administrator. */
    public static function is_last_admin($user_id) {
        $user_id = (int) $user_id;
        if ($user_id <= 0 || !self::is_admin_user($user_id)) {
            return false;
        }
        return count(array_diff(self::admin_ids(), [$user_id])) === 0;
    }

    /** @return int[] The accounts WPMaven works through right now. */
    public static function acting_ids() {
        $ids = [];
        if (self::$acting_admin > 0) {
            $ids[] = self::$acting_admin;
        }
        if (self::$active && function_exists('get_current_user_id') && get_current_user_id() > 0) {
            $ids[] = (int) get_current_user_id();
        }
        $first = self::webhook_admin();
        if ($first) {
            $ids[] = (int) $first->ID;
        }
        return array_values(array_unique($ids));
    }

    /**
     * Why this user may not be deleted or demoted, or null. Only an
     * administrator can be protected: demoting anyone else changes nothing
     * for the site's management.
     */
    public static function protection_reason($user_id) {
        $user_id = (int) $user_id;
        if ($user_id <= 0 || !self::is_admin_user($user_id)) {
            return null;
        }
        if (self::is_last_admin($user_id)) {
            return self::branded(sprintf(self::REFUSAL_LAST, self::label($user_id)));
        }
        if (in_array($user_id, self::acting_ids(), true)) {
            return self::branded(sprintf(self::REFUSAL_WPMAVEN, self::label($user_id)));
        }
        return null;
    }

    private static function label($user_id) {
        $user = get_userdata((int) $user_id);
        $login = $user && isset($user->user_login) ? (string) $user->user_login : '';
        return $login !== '' ? sprintf('the account "%s" (user %d)', $login, (int) $user_id) : sprintf('user %d', (int) $user_id);
    }

    private static function refuse($message) {
        throw new WebMaven_Admin_Guard_Refusal(self::branded($message)); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- the error text of a JSON answer to the API, never printed in a page
    }

    /**
     * A refusal as a person in WP-admin reads it: on a site under an agency's
     * or a partner's brand it names the brand, and "your site team" while
     * that brand is unknown, never WPMaven (1.2.31).
     */
    public static function branded($message) {
        if (!class_exists('WebMaven_Brand') || WebMaven_Brand::is_wpmaven()) {
            return $message;
        }
        return str_replace('WPMaven', WebMaven_Brand::name_or('your site team'), (string) $message);
    }

    // ── Hooks ──────────────────────────────────────────────────────────────

    /** delete_user / wpmu_delete_user / remove_user_from_blog: before anything is removed. */
    public static function on_delete_user($user_id) {
        if (!self::$active) {
            return;
        }
        $reason = self::protection_reason($user_id);
        if ($reason !== null) {
            self::refuse($reason);
        }
    }

    /** The capabilities meta key of this site (its table prefix). */
    public static function caps_key() {
        global $wpdb;
        $prefix = (isset($wpdb) && is_object($wpdb) && method_exists($wpdb, 'get_blog_prefix')) ? $wpdb->get_blog_prefix() : 'wp_';
        return $prefix . 'capabilities';
    }

    /** Would these stored capabilities still make the user an administrator? */
    public static function caps_keep_admin($caps) {
        if (is_string($caps)) {
            // Stored capabilities are names with true or false. This text can
            // be a value on its way in (update_user_metadata hands it to the
            // guard before WordPress stores it, and WordPress would store a
            // serialized text as text), so no class is ever built from it:
            // not maybe_unserialize, which allows every class. Like it, a text
            // that is not serialized is left alone (it is not capabilities).
            $text = trim($caps);
            if (!function_exists('is_serialized') || is_serialized($text)) {
                $caps = @unserialize($text, ['allowed_classes' => false]); // nosemgrep: php.lang.security.unserialize-use.unserialize-use (names and true or false: no class is ever built from the text)
            }
        }
        if (!is_array($caps) || empty($caps[self::ROLE])) {
            return false;
        }
        foreach (self::KEY_CAPS as $cap) {
            if (array_key_exists($cap, $caps) && !$caps[$cap]) {
                return false;
            }
        }
        return true;
    }

    /** update_user_metadata: a role change reaches here before the database. */
    public static function filter_update_user_meta($check, $user_id, $meta_key, $meta_value, $prev_value = '') {
        if (!self::$active || $meta_key !== self::caps_key()) {
            return $check;
        }
        if (!self::caps_keep_admin($meta_value)) {
            $reason = self::protection_reason($user_id);
            if ($reason !== null) {
                self::refuse($reason);
            }
        }
        return $check;
    }

    /** delete_user_metadata: removing every capability (remove_all_caps) is a demotion. */
    public static function filter_delete_user_meta($check, $user_id, $meta_key, $meta_value = '', $delete_all = false) {
        if (!self::$active || $meta_key !== self::caps_key()) {
            return $check;
        }
        if ($delete_all) {
            foreach (self::admin_ids() as $admin_id) {
                if (self::protection_reason($admin_id) !== null) {
                    self::refuse(self::protection_reason($admin_id));
                }
            }
            return $check;
        }
        $reason = self::protection_reason($user_id);
        if ($reason !== null) {
            self::refuse($reason);
        }
        return $check;
    }

    public static function is_roles_option($option) {
        return is_string($option) && preg_match('/user_roles$/', $option) === 1;
    }

    /** pre_update_option: the role definitions may gain, never lose, the administrator. */
    public static function filter_pre_update_option($value, $option, $old_value) {
        if (!self::$active || !self::is_roles_option($option)) {
            return $value;
        }
        $old_caps = (is_array($old_value) && isset($old_value[self::ROLE]['capabilities']) && is_array($old_value[self::ROLE]['capabilities']))
            ? $old_value[self::ROLE]['capabilities'] : [];
        if (!is_array($value) || !isset($value[self::ROLE])) {
            self::refuse(self::REFUSAL_ROLE);
        }
        $new_caps = (isset($value[self::ROLE]['capabilities']) && is_array($value[self::ROLE]['capabilities']))
            ? $value[self::ROLE]['capabilities'] : [];
        foreach ($old_caps as $cap => $granted) {
            if ($granted && empty($new_caps[$cap])) {
                self::refuse(self::REFUSAL_ROLE);
            }
        }
        return $value;
    }

    /** delete_option: fires before the role definitions are deleted. */
    public static function on_delete_option($option) {
        if (self::$active && self::is_roles_option($option)) {
            self::refuse(self::REFUSAL_ROLE);
        }
    }

}

if (function_exists('add_action')) {
    WebMaven_Admin_Guard::register();
}
