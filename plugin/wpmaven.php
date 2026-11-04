<?php
/**
 * Plugin Name:       WPMaven
 * Plugin URI:        https://wpmaven.ai
 * Description:       An AI team for your WordPress site: your store, content, search visibility and messages in one place, and a new site built for you if you want one.
 * Version:           1.10.1
 * Requires at least: 6.5
 * Requires PHP:      8.0
 * Author:            WPMaven
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       wpmaven
 */

if (!defined('ABSPATH')) {
    exit;
}

// The single plugin (WPMaven WordPress) holds this plugin's code: while it
// runs, this plugin waits, and says so to administrators.
if (defined('WEBMAVEN_WP_FILE')) {
    add_action('admin_notices', static function () {
        if (!current_user_can('activate_plugins')) {
            return;
        }
        echo '<div class="notice notice-info"><p>'
            . esc_html__('WPMaven is installed and waits for WPMaven WordPress, the plugin it replaces: deactivate WPMaven WordPress to finish the switch. Your connection and settings stay.', 'wpmaven')
            . '</p></div>';
    });
    return;
}
define('WEBMAVEN_WP_FILE', __FILE__);

require_once __DIR__ . '/includes/bootstrap.php';
