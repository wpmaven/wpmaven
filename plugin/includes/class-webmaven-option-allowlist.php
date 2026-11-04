<?php
/**
 * The options WPMaven from WordPress.org may change: WordPress's own
 * settings (General, Reading, Discussion, Media and Permalinks), the active
 * theme's Customizer settings, the store's WooCommerce settings, and
 * WPMaven's own content options (the business
 * details, the structured data). Another plugin's options can hold code, so
 * changing them is WPMaven Agent's (webmaven_option_allowed); without Agent
 * the option commands answer REQUIRES_AGENT. The protected options
 * (WebMaven_Self_Protect) stay refused either way.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-webmaven-requires-agent.php';

// The refusal ends as the "error" of a JSON answer (the option commands),
// never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

final class WebMaven_Option_Allowlist {

    /** WordPress's own settings screens. */
    const CORE = [
        // General
        'blogname', 'blogdescription', 'site_icon', 'timezone_string', 'gmt_offset',
        'date_format', 'time_format', 'start_of_week', 'wplang',
        // Reading
        'show_on_front', 'page_on_front', 'page_for_posts', 'posts_per_page',
        'posts_per_rss', 'rss_use_excerpt', 'blog_public',
        // Writing
        'default_category', 'default_post_format',
        // Discussion
        'default_comment_status', 'default_ping_status', 'default_pingback_flag',
        'require_name_email', 'comment_registration', 'close_comments_for_old_posts',
        'close_comments_days_old', 'thread_comments', 'thread_comments_depth',
        'page_comments', 'comments_per_page', 'default_comments_page', 'comment_order',
        'comments_notify', 'moderation_notify', 'comment_moderation',
        'comment_previously_approved', 'show_avatars', 'avatar_rating', 'avatar_default',
        // Media
        'thumbnail_size_w', 'thumbnail_size_h', 'thumbnail_crop', 'medium_size_w',
        'medium_size_h', 'large_size_w', 'large_size_h', 'uploads_use_yearmonth_folders',
        // Permalinks (rewrite_rules: emptied so WordPress rebuilds them)
        'permalink_structure', 'category_base', 'tag_base', 'rewrite_rules',
    ];

    /** A theme's Customizer settings, and the store's settings. */
    const PREFIXES = ['theme_mods_', 'woocommerce_'];

    public static function allows($name): bool {
        if (!is_scalar($name)) {
            return false;
        }
        $n = strtolower(trim((string) $name));
        if ($n === '') {
            return false;
        }
        if (in_array($n, self::CORE, true)) {
            return true;
        }
        foreach (self::PREFIXES as $prefix) {
            if (strpos($n, $prefix) === 0) {
                return true;
            }
        }
        if (class_exists('WebMaven_Self_Protect') && WebMaven_Self_Protect::is_content_option($n)) {
            return true;
        }
        return function_exists('apply_filters') && (bool) apply_filters('webmaven_option_allowed', false, $n);
    }

    /** The sentence an option outside the list answers with. */
    public static function refusal($name): string {
        return 'Changing the setting "' . (is_scalar($name) ? (string) $name : '') . '" needs WPMaven Agent: WPMaven from WordPress.org changes WordPress\'s own settings, the store\'s and the business details only, since another plugin\'s settings can hold code. The owner can install WPMaven Agent from their WPMaven dashboard.';
    }

    /** Throws REQUIRES_AGENT for an option outside the list. */
    public static function check($name): void {
        if (!self::allows($name)) {
            throw new WebMaven_Requires_Agent(self::refusal($name));
        }
    }
}
