<?php
/**
 * What the plugin knows about the site's hosting, through filters another
 * plugin may answer (a WPMaven-hosted site, a hosting partner's code, a
 * custom domain, a mail relay). This edition answers none of them: not
 * hosted, no partner, no edge, no relay.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Hosting {

    /** The edge's options: a secret key and the primary host, never read through the generic option tools. */
    const EDGE_OPTIONS = ['webmaven_edge_key', 'webmaven_primary_host'];

    /** A mail relay is here (webmaven_has_mail_relay): wp_mail() may go out through it. */
    public static function has_mail_relay(): bool {
        return function_exists('apply_filters') && (bool) apply_filters('webmaven_has_mail_relay', false);
    }

    /** A WPMaven-hosted site (webmaven_is_hosted_site). */
    public static function is_hosted_site(): bool {
        return function_exists('apply_filters') && (bool) apply_filters('webmaven_is_hosted_site', false);
    }

    /** The hosting partner's code for the connect links, or null (webmaven_partner_for_script). */
    public static function partner_for_script() {
        $partner = function_exists('apply_filters') ? apply_filters('webmaven_partner_for_script', null) : null;
        return is_array($partner) ? $partner : null;
    }

    /** One of the edge's options. */
    public static function is_edge_option($name): bool {
        return is_scalar($name) && in_array(strtolower(trim((string) $name)), self::EDGE_OPTIONS, true);
    }
}
