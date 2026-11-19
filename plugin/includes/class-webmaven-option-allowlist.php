<?php
/**
 * The options WPMaven from WordPress.org may change: WordPress's own content
 * settings (the site's title, tagline, icon, language, time and date, the
 * homepage and posts page, the feeds, the comment settings and the image
 * sizes), the store's named settings, and WPMaven's own content options (the
 * business details, the structured data). Every option command asks this one
 * list: update_option, delete_option and batch_update_options alike.
 *
 * Left out on purpose, so they answer REQUIRES_AGENT: search engine
 * visibility (blog_public), the addresses (permalink_structure, category_base,
 * tag_base, rewrite_rules), any other WooCommerce option (a payment gateway's
 * settings, the store's coming soon mode), a theme's whole Customizer array
 * (theme_mods_*, which some themes use to hold scripts) and another plugin's
 * options, which can hold code. The list is filterable
 * (webmaven_option_allowed); the protected options (WebMaven_Self_Protect)
 * stay refused either way.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-webmaven-requires-agent.php';

final class WebMaven_Option_Allowlist {

    /** WordPress's own settings that only change how content shows. */
    const CORE = [
        // General
        'blogname', 'blogdescription', 'site_icon', 'timezone_string', 'gmt_offset',
        'date_format', 'time_format', 'start_of_week', 'wplang',
        // Reading (never search engine visibility)
        'show_on_front', 'page_on_front', 'page_for_posts', 'posts_per_page',
        'posts_per_rss', 'rss_use_excerpt',
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
    ];

    /**
     * The store's named settings: the ones its Store settings screen changes
     * (WebMaven_Cap_Store_Settings), and the two privacy texts the site's
     * language follows. The store currency is never one of them: only the
     * Store currency setting changes it.
     */
    const STORE = [
        'woocommerce_currency_pos', 'woocommerce_price_thousand_sep', 'woocommerce_price_decimal_sep',
        'woocommerce_price_num_decimals', 'woocommerce_calc_taxes', 'woocommerce_prices_include_tax',
        'woocommerce_tax_display_shop', 'woocommerce_tax_display_cart', 'woocommerce_price_display_suffix',
        'woocommerce_store_address', 'woocommerce_store_address_2', 'woocommerce_store_city',
        'woocommerce_store_postcode', 'woocommerce_default_country',
        'woocommerce_email_from_name', 'woocommerce_email_from_address',
        'woocommerce_checkout_privacy_policy_text', 'woocommerce_registration_privacy_policy_text',
    ];

    /**
     * The theme settings update_theme_options may change, each with how its
     * value is cleaned: the logo, the menus' places and the header and
     * background colours and pictures. One key at a time, never a theme's
     * whole Customizer array.
     */
    const THEME_MODS = [
        'custom_logo' => 'id',
        'nav_menu_locations' => 'menu_locations',
        'header_textcolor' => 'color',
        'background_color' => 'color',
        'header_image' => 'url',
        'background_image' => 'url',
    ];

    public static function allows($name): bool {
        if (!is_scalar($name)) {
            return false;
        }
        $n = strtolower(trim((string) $name));
        if ($n === '') {
            return false;
        }
        if (in_array($n, self::CORE, true) || in_array($n, self::STORE, true)) {
            return true;
        }
        if (class_exists('WebMaven_Self_Protect') && WebMaven_Self_Protect::is_content_option($n)) {
            return true;
        }
        return function_exists('apply_filters') && (bool) apply_filters('webmaven_option_allowed', false, $n);
    }

    /** The sentence an option outside the list answers with. */
    public static function refusal($name): string {
        return 'Changing the setting "' . (is_scalar($name) ? (string) $name : '') . '" needs WPMaven Agent: WPMaven from WordPress.org changes how the site\'s content shows, the store\'s named settings and the business details only, never search engine visibility, the site\'s addresses or another plugin\'s settings. The owner can install WPMaven Agent from their WPMaven dashboard.';
    }

    /**
     * A theme setting update_theme_options may write, cleaned, or null when
     * the key is not on the list (a key the filter adds is written as given).
     * $ok says whether it may be written.
     */
    public static function theme_mod_value($key, $value, &$ok) {
        $key = is_scalar($key) ? (string) $key : '';
        if (!isset(self::THEME_MODS[$key])) {
            $ok = function_exists('apply_filters') && (bool) apply_filters('webmaven_option_allowed', false, 'theme_mods_' . $key);
            return $value;
        }
        $ok = true;
        switch (self::THEME_MODS[$key]) {
            case 'id':
                return is_numeric($value) ? max(0, (int) $value) : 0;
            case 'menu_locations':
                $out = [];
                foreach (is_array($value) ? $value : [] as $location => $menu) {
                    $location = sanitize_key((string) $location);
                    if ($location !== '' && is_numeric($menu)) {
                        $out[$location] = max(0, (int) $menu);
                    }
                }
                return $out;
            case 'color':
                $hex = ltrim(is_string($value) ? trim($value) : '', '#');
                return preg_match('/^(?:[0-9a-fA-F]{3}){1,2}$/', $hex) ? $hex : ($hex === 'blank' ? 'blank' : '');
            case 'url':
                return is_string($value) && $value !== '' ? esc_url_raw($value) : '';
        }
        $ok = false;
        return null;
    }

    /** Throws REQUIRES_AGENT for an option outside the list. */
    public static function check($name): void {
        if (!self::allows($name)) {
            throw new WebMaven_Requires_Agent(self::refusal($name)); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- the error text of a JSON answer to the API, never printed in a page
        }
    }
}
