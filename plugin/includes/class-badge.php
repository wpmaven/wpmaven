<?php
/**
 * Per-tier "Built with WPMaven" footer badge (pricing v3).
 *
 * The visible badge renders on wp_footer ONLY while the site's EFFECTIVE
 * plan is FREE or LAUNCH. The API is the single source of truth: it derives
 * `badge.showBadge` in GET /sites/me/plan (the site-token read; the old
 * GET /payments/subscription refused this token) from effectivePlan(), and
 * effectivePlan() already resolves the $1 bridge week (TRIALING on a
 * first-week plan) to OPERATOR, so the bridge runs badge-free with no
 * special casing here. Invisible AI-content marking is NOT gated by this
 * class, it always runs (see WebMaven_AI_Marking).
 *
 * Fail-safe by design: the config is cached in a transient, and on any
 * error, missing field, or unconfigured API connection the badge defaults
 * to OFF and nothing is printed. A badge must never break a customer site
 * and must never show up on a paid tier by accident.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-webmaven-choices.php';

class WebMaven_Badge {

    const CACHE_KEY = 'webmaven_badge_config';

    const BADGE_URL = 'https://wpmaven.ai/?utm_source=badge&utm_medium=site-footer&utm_campaign=powered-by';

    public function __construct() {
        // Frontend pages only (mirrors WebMaven_Analytics).
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }
        add_action('wp_footer', [$this, 'render'], 90);
    }

    /**
     * Print the badge when, and only when, the cached config says so.
     * Any failure renders nothing.
     */
    public function render() {
        // A link on the site's pages only when the owner turned it on (WebMaven_Choices).
        if (!WebMaven_Choices::on('badge_enabled')) {
            return;
        }
        try {
            $config = $this->get_config();
            if (empty($config['show_badge'])) {
                return;
            }
            // Never our badge on a site under an agency's or a partner's
            // brand (1.2.31), whatever the plan says: the API leaves it off
            // there, and this is the second lock on that door.
            if (class_exists('WebMaven_Brand') && !WebMaven_Brand::is_wpmaven()) {
                return;
            }
            // Small, neutral, in normal document flow (no fixed or sticky
            // positioning, never covers content), inherits the site's colors.
            echo '<div class="wpmaven-badge" style="margin:1em auto;padding:8px 12px;text-align:center;font-size:12px;line-height:1.4;opacity:.75;">'
                . '<a href="' . esc_url(self::BADGE_URL) . '" rel="nofollow noopener" style="color:inherit;text-decoration:underline;">'
                . esc_html__('Built with WPMaven', 'wpmaven')
                . '</a></div>' . "\n";
        } catch (\Throwable $e) {
            // Never break a customer site over a badge.
        }
    }

    /**
     * Badge config, cached in a transient. Success caches for an hour;
     * a failed or unusable API response caches the safe OFF default for
     * 15 minutes so a transient hiccup recovers without hammering the API
     * on every page view.
     *
     * Contract (GET /sites/me/plan, through get_subscription_info()):
     *   data.badge.showBadge  boolean, true only for FREE and LAUNCH
     *                         effective tiers
     *   data.badge.aiMarking  boolean, always true (informational; the
     *                         marking itself is unconditional plugin-side)
     *
     * @return array{show_badge: bool, ai_marking: bool}
     */
    private function get_config() {
        $cached = get_transient(self::CACHE_KEY);
        if (is_array($cached)) {
            return $cached;
        }

        // Safe default: badge OFF, marking on (marking is not gated anyway).
        $config = ['show_badge' => false, 'ai_marking' => true];
        $ttl = 15 * MINUTE_IN_SECONDS;

        if (class_exists('WebMaven_WP_API_Client')) {
            $api_client = new WebMaven_WP_API_Client();
            if (!$api_client->is_configured()) {
                // Not connected to the API: no plan to verify, badge stays
                // off. Steady state for a disconnected site, cache longer.
                $ttl = HOUR_IN_SECONDS;
            } else {
                $response = $api_client->get_subscription_info();
                if (!empty($response['success'])
                    && isset($response['data']['badge'])
                    && is_array($response['data']['badge'])
                ) {
                    $badge = $response['data']['badge'];
                    $config['show_badge'] = !empty($badge['showBadge']) || !empty($badge['show_badge']);
                    $config['ai_marking'] = !isset($badge['aiMarking']) || !empty($badge['aiMarking']);
                    $ttl = HOUR_IN_SECONDS;
                    // The same answer names the plan: the WP-admin sidebar
                    // shows it without the owner opening Settings first.
                    WebMaven_WP_API_Client::remember_plan_name($response['data']);
                }
                // Older API without the badge field, or an error response:
                // keep the OFF default and the short retry window.
            }
        }

        set_transient(self::CACHE_KEY, $config, $ttl);
        return $config;
    }
}
