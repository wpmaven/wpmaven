<?php
/**
 * Files WPMaven keeps under the site's uploads folder (backups, a restore's
 * staging), through WordPress's own filesystem class. The folders are the
 * site's own and written in the same request, so the direct method is the
 * one used, never FTP credentials.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Files {

    /** @var WP_Filesystem_Direct|null */
    private static $fs = null;

    /** WordPress's direct filesystem. */
    public static function fs() {
        if (self::$fs === null) {
            if (!class_exists('WP_Filesystem_Direct')) {
                require_once ABSPATH . 'wp-admin/includes/class-wp-filesystem-base.php';
                require_once ABSPATH . 'wp-admin/includes/class-wp-filesystem-direct.php';
            }
            self::$fs = new WP_Filesystem_Direct(null);
        }
        return self::$fs;
    }

    /** Removes an empty folder. */
    public static function rmdir(string $dir): bool {
        return (bool) self::fs()->rmdir($dir);
    }

    /** Renames a file, replacing what is at $to. */
    public static function move(string $from, string $to): bool {
        return (bool) self::fs()->move($from, $to, true);
    }
}
