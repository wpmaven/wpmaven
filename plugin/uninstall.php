<?php
// If uninstall not called from WordPress, exit
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

delete_option('webmaven_wp_settings');
delete_option('webmaven_wp_account');
// Link tokens given out for a sign-in (1.2.14).
delete_option('webmaven_wp_link_tokens');
// The brand the WP-admin screens showed, and its read's bookkeeping (1.2.31).
// The hosting partner's code (webmaven_partner_code, webmaven_partner_ref)
// stays: the hosting company put it there, and a reinstall keeps counting
// for it.
delete_option('webmaven_wp_brand');
delete_transient('webmaven_wp_brand_fresh');
delete_transient('webmaven_wp_brand_lock');
// The site state read from the account (2026-10-05), its bookkeeping, and
// the old local setup flag it replaced. The connection credentials and the
// instance id stay: a reinstall reconnects to the same business, and the
// account rebuilds the state on the first read.
delete_option('webmaven_wp_site_state');
delete_transient('webmaven_wp_site_state_fresh');
delete_transient('webmaven_wp_site_state_lock');
delete_transient('webmaven_wp_site_state_refresh');
delete_transient('webmaven_wp_agent_activated');
delete_transient('webmaven_wp_agent_status_slot');
delete_option('webmaven_wp_onboarding_completed');
// The store currency the owner picked in the old setup wizard (1.2.15), and its report to WPMaven.
delete_option('webmaven_store_currency_choice');
// The old setup wizard's copy of the setup state (the account keeps it now).
delete_option('webmaven_wp_options');
delete_option('webmaven_wp_onboarding');
wp_clear_scheduled_hook('webmaven_store_currency_report');
// Intrusion detection (1.2.23): its bookkeeping, its cache and its two events.
foreach (['webmaven_sec_scanned_version', 'webmaven_sec_report_queue', 'webmaven_sec_reported',
    'webmaven_sec_known_admins', 'webmaven_sec_core_state', 'webmaven_sec_uploads_state'] as $webmaven_sec_option) {
    delete_option($webmaven_sec_option);
}
delete_transient('webmaven_sec_core_checksums');
delete_transient('webmaven_sec_login_failures');
wp_clear_scheduled_hook('webmaven_security_scan');
wp_clear_scheduled_hook('webmaven_security_report_flush');
// Edit previews (2026-10-05): the staged changes and the hourly clean-up.
// The previews' theme copies are WPMaven Agent's (its uninstall.php).
$webmaven_previews = get_option('wpmaven_preview_index', []);
foreach (is_array($webmaven_previews) ? array_keys($webmaven_previews) : [] as $webmaven_preview_id) {
    delete_option('wpmaven_preview_' . $webmaven_preview_id);
}
delete_option('wpmaven_preview_index');
wp_clear_scheduled_hook('webmaven_preview_cleanup');
// Form messages (WebMaven_Leads): the daily clean-up goes with the plugin.
// The messages stay unless the owner chose to remove the plugin's data when
// it is deleted (Messages settings); then both tables and their settings go.
wp_clear_scheduled_hook('webmaven_leads_purge');
if (get_option('webmaven_remove_data_on_uninstall')) {
    global $wpdb;
    $wpdb->query('DROP TABLE IF EXISTS ' . $wpdb->prefix . 'wpmaven_lead_events');
    $wpdb->query('DROP TABLE IF EXISTS ' . $wpdb->prefix . 'wpmaven_leads');
    delete_option('webmaven_leads_db_version');
    delete_option('webmaven_leads_retention_days');
    delete_option('webmaven_remove_data_on_uninstall');
}
