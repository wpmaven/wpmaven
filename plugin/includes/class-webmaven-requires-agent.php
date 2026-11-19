<?php
/**
 * What this edition answers to an action it does not run.
 *
 * WPMaven (the WordPress.org edition) never writes or runs code on the site,
 * never installs, updates or switches plugins, themes or WordPress, never
 * changes security settings, the site's addresses or search visibility,
 * never restores a backup, never runs raw SQL writes, and never calls other
 * plugins as an administrator. The signed webhook and execute_command answer
 * these names with REQUIRES_AGENT, which the API turns into a sentence for
 * the owner instead of a failure.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Requires_Agent extends Exception {

    const CODE = 'REQUIRES_AGENT';

    /** WPMaven Agent's actions and commands, by name. */
    const NAMES = [
        // Files, WP-CLI, MCP abilities.
        'write_file', 'read_file', 'grep_files', 'list_files', 'wp_cli', 'cli',
        'mcp_discover_abilities', 'mcp_get_ability_info', 'mcp_execute_ability',
        // Plugins, themes, users, code-shaped content.
        'install_plugin', 'activate_plugin', 'deactivate_plugin', 'uninstall_plugin',
        'install_theme', 'wp_install_theme', 'install_theme_from_url', 'activate_theme', 'wp_activate_theme',
        'deactivate_theme', 'wp_deactivate_theme', 'create_user', 'update_user',
        'create_widget', 'update_widget', 'create_taxonomy', 'create_post_type', 'wc_install_gateway',
        // Hosting, design switch, theme archives, the database, other plugins, sign-in.
        'set_edge_config', 'wm_theme_patch', 'wm_design_switch', 'wm_design_restore', 'wm_design_status', 'wm_site_brief_read',
        'wm_product_design_keys', 'theme_archive_export', 'theme_archive_restore', 'site_database_read',
        'site_database_write', 'discover_plugin_api', 'plugin_rest_call', 'plugin_ajax_call',
        // A site in several languages, and the live booking calendar.
        'wm_languages_set', 'wm_languages_get', 'wm_language_import', 'wm_languages_check', 'wm_languages_set_main',
        'live_slots_setup',
        // Updates, security settings and restores: administration of the site.
        'apply_updates', 'hardening_apply', 'backup_restore',
        // Language packs, raw database maintenance, the site's addresses.
        'multilingual_add_languages', 'optimize_database',
        'set_permalink_structure', 'set_permalinks', 'finalize_site',
        // Payment gateways of other plugins (WPMaven Payments stays): switched
        // on, given the owner's keys (a local payment service), switched off.
        'wc_enable_gateway', 'wc_configure_gateway', 'wc_disable_gateway',
        // The check before a publish, which installs plugins and writes a theme.
        'publish_preflight',
    ];

    /** Names shaped like WordPress's REST API's (get_, create_, update_...), which this edition answers REQUIRES_AGENT. */
    const REST_VERBS = '/^(get|list|create|add|update|edit|delete|remove)_[a-z0-9_]+$/';

    /** Throws when $name is WPMaven Agent's and Agent is not here. */
    public static function check($name) {
        $name = is_string($name) ? strtolower($name) : '';
        if (in_array($name, self::NAMES, true) || preg_match(self::REST_VERBS, $name)) {
            throw new self(
                $name . ' needs WPMaven Agent: WPMaven from WordPress.org does not change the site\'s code, its plugins or its themes, and does not update, secure or restore the site. The owner can install WPMaven Agent from their WPMaven dashboard.' // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- the error text of a JSON answer to the API, never printed in a page
            );
        }
    }
}
