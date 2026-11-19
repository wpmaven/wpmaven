<?php
/**
 * WPMaven's lines in the PHP error log: written with WP_DEBUG on, or when
 * another plugin asks for them (webmaven_log_errors). Otherwise the log
 * stays quiet.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Log {

    public static function enabled(): bool {
        if (defined('WP_DEBUG') && WP_DEBUG) {
            return true;
        }
        return function_exists('apply_filters') && (bool) apply_filters('webmaven_log_errors', false);
    }

    public static function write($message): void {
        if (self::enabled()) {
            error_log((string) $message); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- written only with WP_DEBUG on, or when a filter turns WPMaven's log on (webmaven_log_errors)
        }
    }
}
