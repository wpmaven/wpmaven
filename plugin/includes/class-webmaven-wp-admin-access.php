<?php
/**
 * WP-admin access rules (1.2.9, 2026-09-27).
 *
 * The WPMaven API refuses the site's OAuth token on its chat, agent,
 * editor-AI and account routes. The WP-admin
 * app used to treat each refusal as a sign-out, so the owner landed on
 * "Welcome to WPMaven / Sign In" in a loop while the site was connected.
 * The rules that fix it live here:
 *
 * - Chat and AI editing inside WP-admin follow the account (2026-10-05):
 *   the API says per site whether each is on (GET /sites/me,
 *   features.chat and features.editorAI, kept by WebMaven_Site_State), from
 *   its own switch, so they reach every site when the API turns them on,
 *   with no plugin release. WEBMAVEN_WP_SITE_TOKEN_CHAT stays as this
 *   site's own off switch (define it false in wp-config.php). While one is
 *   off, WP-admin shows "Chat runs in your WPMaven dashboard. AI editing is
 *   not on for this site yet." with a button to the dashboard, and no chat,
 *   conversation, agent or editor-AI call leaves the site. Before the
 *   account's first answer both read off.
 * - The two answers the WP-admin app understands: "chat runs in the
 *   dashboard" (403) and "this site is not connected" (409). An API 401 is
 *   never either of them: it is not a sign-out.
 * - A WPMaven-hosted site never needs setup (WebMaven_Site_State).
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-webmaven-hosting.php';

if (!defined('WEBMAVEN_WP_SITE_TOKEN_CHAT')) {
    define('WEBMAVEN_WP_SITE_TOKEN_CHAT', true);
}

class WebMaven_WP_Admin_Access {

    const CHAT_IN_DASHBOARD_CODE = 'wpmaven_chat_in_dashboard';
    const CHAT_IN_DASHBOARD_TEXT = 'Chat runs in your WPMaven dashboard. AI editing is not on for this site yet.';
    const NOT_CONNECTED_CODE = 'wpmaven_site_not_connected';
    const DEFAULT_DASHBOARD_URL = 'https://dashboard.wpmaven.ai';

    /** True when the chat runs inside WP-admin: the account turned it on for this site, and wp-config.php did not turn it off. */
    public static function site_chat_enabled() {
        return (bool) WEBMAVEN_WP_SITE_TOKEN_CHAT && class_exists('WebMaven_Site_State') && WebMaven_Site_State::feature('chat');
    }

    /** True when the page editor's AI runs inside WP-admin (features.editorAI, the same off switch). */
    public static function ai_editing_enabled() {
        return (bool) WEBMAVEN_WP_SITE_TOKEN_CHAT && class_exists('WebMaven_Site_State') && WebMaven_Site_State::feature('editorAI');
    }

    /**
     * The dashboard the card opens: the brand's own dashboard address on a
     * site under an agency's or a partner's brand that has one (1.2.31),
     * else the WPMaven dashboard.
     */
    public static function dashboard_url() {
        $default = defined('WEBMAVEN_WP_DASHBOARD_URL') && WEBMAVEN_WP_DASHBOARD_URL
            ? WEBMAVEN_WP_DASHBOARD_URL
            : self::DEFAULT_DASHBOARD_URL;
        return class_exists('WebMaven_Brand') ? WebMaven_Brand::dashboard_url($default) : $default;
    }

    /** "Chat runs in your WPMaven dashboard. AI editing is not on for this site yet.", in the brand's words (1.2.31). */
    public static function chat_in_dashboard_text() {
        if (!class_exists('WebMaven_Brand') || WebMaven_Brand::is_wpmaven()) {
            return self::CHAT_IN_DASHBOARD_TEXT;
        }
        return WebMaven_Brand::mode() === WebMaven_Brand::MODE_BRAND
            ? sprintf('Chat runs in your %s dashboard. AI editing is not on for this site yet.', WebMaven_Brand::name())
            : 'Chat runs in your dashboard. AI editing is not on for this site yet.';
    }

    /** "This site is not connected to WPMaven.", in the brand's words (1.2.31). */
    public static function not_connected_text() {
        if (!class_exists('WebMaven_Brand') || WebMaven_Brand::is_wpmaven()) {
            return 'This site is not connected to WPMaven.';
        }
        return WebMaven_Brand::mode() === WebMaven_Brand::MODE_BRAND
            ? sprintf('This site is not connected to %s.', WebMaven_Brand::name())
            : 'This site is not connected to its dashboard.';
    }

    /**
     * What a chat, conversation, agent or editor-AI route answers while the
     * switch is off: a 403 the WP-admin app shows as the dashboard card. No
     * API call is made.
     */
    public static function chat_in_dashboard_response() {
        return new WP_REST_Response([
            'success' => false,
            'code' => self::CHAT_IN_DASHBOARD_CODE,
            'error' => self::chat_in_dashboard_text(),
            'dashboardUrl' => self::dashboard_url(),
        ], 403);
    }

    /**
     * What a route that needs the WPMaven API answers when this site holds no
     * link to WPMaven (no credentials or no tokens stored). The WP-admin app
     * re-reads /status on this code, and only /status decides to show Sign In.
     */
    public static function not_connected_response() {
        return new WP_REST_Response([
            'success' => false,
            'code' => self::NOT_CONNECTED_CODE,
            'error' => self::not_connected_text(),
        ], 409);
    }

    /**
     * Whether this is a WPMaven-hosted site, whose business comes from its own
     * deploy, so it never needs setup. Called on activation. It used to write
     * webmaven_wp_onboarding_completed; the account now says whether a site
     * has a business (WebMaven_Site_State, which answers 'completed' on a
     * hosted site with or without a state), so it writes nothing. "Hosted" is
     * the mail relay's fleet check: registered with WPMaven and recognized as
     * a fleet site (provision token, WPMAVEN_HOSTED, a *.wpmaven.site home,
     * or the remembered site-bound marker).
     */
    public static function maybe_mark_hosted_onboarding_completed() {
        return WebMaven_Hosting::is_hosted_site();
    }
}

/** True when the chat runs inside WP-admin (the account's features.chat; see WEBMAVEN_WP_SITE_TOKEN_CHAT). */
function webmaven_wp_site_chat_enabled() {
    return WebMaven_WP_Admin_Access::site_chat_enabled();
}

/** The dashboard card answer (403); see WebMaven_WP_Admin_Access. */
function webmaven_wp_chat_in_dashboard_response() {
    return WebMaven_WP_Admin_Access::chat_in_dashboard_response();
}

/** The "this site is not connected" answer (409); see WebMaven_WP_Admin_Access. */
function webmaven_wp_not_connected_response() {
    return WebMaven_WP_Admin_Access::not_connected_response();
}
