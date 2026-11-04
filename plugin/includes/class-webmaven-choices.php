<?php
/**
 * What the owner chose to turn on: visitor statistics (the tracker on the
 * site's pages), the copy of the store's customers for email campaigns, and
 * the "Built with WPMaven" link in the footer. Each is off until an
 * administrator turns it on: the app asks once, before its other screens,
 * for a yes or a no to each (ChoicesQuestion), and Settings, What your site
 * shares, changes them any time.
 *
 * A site from before these choices existed never made one: WPMaven Agent
 * keeps what such a site always did (webmaven_choice_default).
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Choices {

    const KEYS = ['analytics_enabled', 'contact_sync_enabled', 'badge_enabled'];

    /** The owner's choice, or the default when they never made one. */
    public static function on(string $key): bool {
        $settings = function_exists('get_option') ? get_option('webmaven_wp_settings', []) : [];
        if (is_array($settings) && array_key_exists($key, $settings)) {
            return (bool) $settings[$key];
        }
        return function_exists('apply_filters') && (bool) apply_filters('webmaven_choice_default', false, $key);
    }

    /** Every choice, as the app shows it. */
    public static function all(): array {
        $out = [];
        foreach (self::KEYS as $key) {
            $out[$key] = self::on($key);
        }
        return $out;
    }

    /** The choices the owner answered, yes or no: the app asks for the others. */
    public static function answered(): array {
        $settings = function_exists('get_option') ? get_option('webmaven_wp_settings', []) : [];
        return is_array($settings) ? array_values(array_intersect(self::KEYS, array_keys($settings))) : [];
    }

    /** What GET and POST /choices answer: every choice, and which ones the owner answered. */
    public static function report(): array {
        return self::all() + ['answered' => self::answered()];
    }

    /** The choices $params names, saved into $settings (the caller writes the option). */
    public static function apply(array $params, array $settings): array {
        foreach (self::KEYS as $key) {
            if (array_key_exists($key, $params)) {
                $settings[$key] = function_exists('rest_sanitize_boolean') ? rest_sanitize_boolean($params[$key]) : (bool) $params[$key];
            }
        }
        return $settings;
    }
}
