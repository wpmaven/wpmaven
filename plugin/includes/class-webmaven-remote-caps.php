<?php
/**
 * What a call from WPMaven's service may do on the site: a capability limit
 * for the length of the call.
 *
 * The signed webhook runs as one of the site's administrators, so that
 * WordPress's own checks (editing a page, a product, the menus) pass. While
 * it runs, the administrator's account cannot install, activate, update,
 * delete or edit plugins and themes, update WordPress or its translations,
 * edit files, manage users, upload files of any type, import or export, or
 * manage a network: WordPress refuses each of those whatever the code path
 * (map_meta_cap answers do_not_allow, which also holds for a network's super
 * administrators, and user_has_cap drops the primitive capabilities). The
 * limit goes on before the account is set (wp_set_current_user), since
 * WordPress reads the account's capabilities as soon as it is set, and it
 * holds for every action and command of the call, to the end of the request.
 *
 * Kept: unfiltered_html (designed pages keep the <style> blocks our own
 * cleaning lets through), manage_options (the settings WPMaven's option list
 * allows), edit_theme_options (menus, template parts, global styles),
 * upload_files, and the post, page, product, comment and store capabilities.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Remote_Caps {

    /** Capabilities a call never has, primitive and meta. */
    const DROP = [
        // Plugins and themes: install, activate, update, delete, edit.
        'install_plugins', 'activate_plugins', 'deactivate_plugins', 'update_plugins', 'delete_plugins', 'edit_plugins',
        'resume_plugins', 'activate_plugin', 'deactivate_plugin', 'resume_plugin',
        'install_themes', 'switch_themes', 'update_themes', 'delete_themes', 'edit_themes', 'resume_themes', 'resume_theme',
        // WordPress itself, its translations and its files.
        'update_core', 'update_languages', 'install_languages', 'update_php', 'update_https', 'edit_files',
        // Every user capability.
        'list_users', 'create_users', 'add_users', 'edit_users', 'delete_users', 'promote_users', 'remove_users',
        'edit_user', 'delete_user', 'promote_user', 'remove_user',
        // Files of any type, the site's data in and out.
        'unfiltered_upload', 'import', 'export', 'export_others_personal_data', 'erase_others_personal_data',
        // A network of sites.
        'create_sites', 'delete_sites', 'delete_site', 'upgrade_network', 'setup_network',
    ];

    /** Families of capabilities a call never has. */
    const DROP_PREFIXES = ['install_', 'update_', 'manage_network'];

    /** The two filters the limit adds: hook => this class's callback. */
    const FILTERS = [
        'map_meta_cap' => 'filter_map_meta_cap',
        'user_has_cap' => 'filter_user_has_cap',
    ];

    /** Their priority (last, after every other plugin's) and their number of arguments. */
    const PRIORITY = PHP_INT_MAX;
    const ACCEPTED_ARGS = 4;

    /** @var bool */
    private static $active = false;

    /** Whether WordPress refuses $cap during a call. */
    public static function is_dropped($cap): bool {
        if (!is_string($cap) || $cap === '') {
            return false;
        }
        if (in_array($cap, self::DROP, true)) {
            return true;
        }
        foreach (self::DROP_PREFIXES as $prefix) {
            if (strpos($cap, $prefix) === 0) {
                return true;
            }
        }
        return false;
    }

    /** The limit holds from here to the end of the request. Call it before wp_set_current_user. */
    public static function activate(): void {
        if (self::$active) {
            return;
        }
        self::$active = true;
        if (function_exists('add_filter')) {
            foreach (self::FILTERS as $hook => $method) {
                add_filter($hook, [__CLASS__, $method], self::PRIORITY, self::ACCEPTED_ARGS);
            }
        }
    }

    /** For tests. */
    public static function deactivate(): void {
        self::$active = false;
        if (function_exists('remove_filter')) {
            foreach (self::FILTERS as $hook => $method) {
                remove_filter($hook, [__CLASS__, $method], self::PRIORITY);
            }
        }
    }

    public static function is_active(): bool {
        return self::$active;
    }

    /** map_meta_cap: a dropped capability, asked or needed, is do_not_allow. */
    public static function filter_map_meta_cap($caps, $cap = '', $user_id = 0, $args = []) {
        if (!self::$active) {
            return $caps;
        }
        if (self::is_dropped($cap)) {
            return ['do_not_allow'];
        }
        foreach ((array) $caps as $needed) {
            if (self::is_dropped($needed)) {
                return ['do_not_allow'];
            }
        }
        return $caps;
    }

    /** user_has_cap: the account holds none of the dropped capabilities. */
    public static function filter_user_has_cap($allcaps, $caps = [], $args = [], $user = null) {
        if (!self::$active || !is_array($allcaps)) {
            return $allcaps;
        }
        foreach (array_keys($allcaps) as $name) {
            if (self::is_dropped($name)) {
                $allcaps[$name] = false;
            }
        }
        foreach ((array) $caps as $name) {
            if (self::is_dropped($name)) {
                $allcaps[$name] = false;
            }
        }
        return $allcaps;
    }
}
