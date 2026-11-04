<?php
/**
 * An ability of WPMaven Agent, asked of a site that runs WPMaven without it.
 *
 * WPMaven (the WordPress.org edition) never writes or runs code on the site,
 * never installs or switches plugins and themes, never runs WP-CLI or raw
 * SQL writes, and never calls other plugins as an administrator. WPMaven
 * Agent, installed by the owner from wpmaven.ai, adds those abilities
 * through webmaven_webhook_action_handlers, webmaven_command_handlers and
 * webmaven_command_fallback. Without Agent, the signed webhook and
 * execute_command answer these names with REQUIRES_AGENT, which the API
 * turns into "install WPMaven Agent from your dashboard" instead of a
 * failure.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

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
    ];

    /** Names WordPress's REST API would take, which only WPMaven Agent's fallback maps. */
    const REST_VERBS = '/^(get|list|create|add|update|edit|delete|remove)_[a-z0-9_]+$/';

    /** Throws when $name is WPMaven Agent's and Agent is not here. */
    public static function check($name) {
        $name = is_string($name) ? strtolower($name) : '';
        if (in_array($name, self::NAMES, true) || preg_match(self::REST_VERBS, $name)) {
            throw new self(
                $name . ' needs WPMaven Agent: WPMaven from WordPress.org does not change the site\'s code, its plugins or its themes. The owner can install WPMaven Agent from their WPMaven dashboard.'
            );
        }
    }
}
