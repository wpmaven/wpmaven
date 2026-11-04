<?php
/**
 * Designed forms (2026-10-08): the edit engine keeps a designed form's
 * WPForms definition in step with its page.
 *
 *   wm_form_sync {name, intent?, spec: {fields: [{id, type, label, placeholder,
 *                 required, options, css}], submit_text?, submit_class?,
 *                 form_class?, labels_hidden?}, confirmation?}
 *                -> {id, sha256, field_id, created, shortcode}
 *   wm_form_read {names} -> {forms: {name: {id, fields (origin design, consent
 *                 or wpforms), submit_text, confirmation, recipients,
 *                 notifications_on, admin_email, messages, sha256, field_id} | null}}
 *   wm_form_settings {name, confirmation?, recipients?, remove_fields?,
 *                 restore_fields?} -> {before, after, sha256}
 *
 * The rules live in WebMaven_Designed_Forms (includes/class-webmaven-designed-forms.php):
 * the design fields (by id) and the button follow the page, everything the
 * owner set in WPForms stays. Failures THROW "CODE: sentence" like the edit
 * commands (capabilities/edit-operations.php), which also answer each
 * form's design hash (wm_fingerprints form_names) for the drift guard.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/../class-webmaven-designed-forms.php';

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['wm_form_sync'] = ['WebMaven_Designed_Forms', 'sync'];
    $handlers['wm_form_read'] = ['WebMaven_Designed_Forms', 'read'];
    $handlers['wm_form_settings'] = ['WebMaven_Designed_Forms', 'settings'];
    return $handlers;
});

// The theme a site ran before it asked for each form's own anti-spam token.
add_filter('wpforms_process_antispam', ['WebMaven_Designed_Forms', 'accept_site_token'], 10, 4);
