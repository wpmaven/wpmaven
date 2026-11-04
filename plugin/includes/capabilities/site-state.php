<?php
/**
 * The site_state push (2026-10-05): the account changed (a publish, a hosted
 * deploy or replay, a plan or payments change, an undo, a business details
 * save, a WhatsApp link, a brand address), so the site reads its state now
 * instead of at its next 5-minute read. Contract, as the API sends it:
 *
 *   site_state {stateVersion: int, reason: string}
 *     -> {received: true, version: int, read: bool}
 *
 * The push carries only the version. The site reads the state itself, with
 * its own token (WebMaven_Site_State::on_push), and ignores a version it
 * already holds, so a push that arrives twice or late costs one read at most.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['site_state'] = ['WebMaven_Site_State', 'on_push'];
    return $handlers;
});
