<?php
/**
 * What stays in the site's backups folder ({uploads}/webmaven-backups).
 *
 * backup_create (WebMaven_Webhook_Actions) writes a full database dump and a
 * zip of every upload there, on the owner's own hosting: left alone, a
 * connected site's disk would fill, one backup at a time. This class is the three rules that keep the
 * folder bounded:
 *
 *  - the newest KEEP archives stay, older ones go, once a new archive was
 *    written (prune);
 *  - a staging folder a backup left behind when it never finished goes after
 *    a day: it holds a whole database dump (sweep_stale_stages);
 *  - when the disk clearly has no room for an archive the size of the last
 *    one, the oldest archive goes first, as long as two stay to fall back on
 *    while the new one is written; still no room, and the backup is refused
 *    in plain words (make_room, room_problem).
 *
 * Only what backup_create itself names is ever removed: an archive is
 * backup-<Ymd>-<His>.zip (before 2026-09-22) or
 * backup-<Ymd>-<His>-<24 letters or digits>.zip, a staging folder is
 * .stage-<the same stamp>. Every entry is read from the folder's own listing,
 * must be a real file (or a real folder) and not a link, and must resolve to
 * a path directly inside the folder: a link is never followed out of it, and
 * any other file there (the .htaccess, an index.php, something a person put
 * there) is not touched.
 *
 * No WordPress function is called here, so a test runs these rules on a
 * real folder with the plain PHP CLI.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-webmaven-log.php';

require_once __DIR__ . '/class-webmaven-files.php';

if (!class_exists('WebMaven_Backup_Retention')) {

class WebMaven_Backup_Retention {

    /** How many archives stay: the newest ones. */
    const KEEP = 3;

    /** A staging folder older than this (seconds) was left by a backup that never finished. */
    const STAGE_MAX_AGE = 86400;

    /** An archive backup_create wrote. Group 1: its UTC stamp, Ymd-His. */
    const ARCHIVE_RE = '/^backup-(\d{8}-\d{6})(?:-[A-Za-z0-9]{24})?\.zip$/';

    /** A staging folder backup_create made. Group 1: its UTC stamp, Ymd-His. */
    const STAGE_RE = '/^\.stage-(\d{8}-\d{6})(?:-[A-Za-z0-9]{24})?$/';

    /** Room asked for a new archive: the last one's size and one part in this many more, for the dump staged beside it. */
    const ROOM_MARGIN_PART = 10;

    /** Archives that always stay while a new one is written: making room never goes below this. */
    const KEEP_WHILE_WRITING = 2;

    /**
     * Tests stand in for the disk here: a callable given the folder, answering
     * its free bytes (or false for a server that does not tell). Null: the
     * server's own disk_free_space.
     */
    public static $free_space_probe = null;

    /** The folder's free bytes, or false when the server does not tell. */
    private static function free_space($root) {
        if (is_callable(self::$free_space_probe)) {
            return call_user_func(self::$free_space_probe, $root);
        }
        return function_exists('disk_free_space') ? @disk_free_space($root) : false;
    }

    /**
     * The folder as the file system knows it, or null when it is not a
     * readable folder.
     */
    private static function real_root($root) {
        if (!is_string($root) || $root === '' || !is_dir($root)) {
            return null;
        }
        $real = realpath($root);
        return ($real === false || !is_dir($real)) ? null : rtrim($real, '/\\');
    }

    /**
     * The folder's own entries whose name matches $pattern, each one a real
     * file ($want_dir false) or a real folder ($want_dir true), not a link,
     * that resolves to a path directly inside the folder.
     *
     * @return array<int, array{name: string, path: string, stamp: string, mtime: int}>
     */
    private static function own_entries($real_root, $pattern, $want_dir) {
        $found = [];
        $names = @scandir($real_root);
        if (!is_array($names)) {
            return $found;
        }
        foreach ($names as $name) {
            if (!is_string($name) || !preg_match($pattern, $name, $m)) {
                continue;
            }
            $path = $real_root . DIRECTORY_SEPARATOR . $name;
            if (is_link($path)) {
                continue;
            }
            if ($want_dir ? !is_dir($path) : !is_file($path)) {
                continue;
            }
            // Read from the folder's listing, so this holds unless a parent is
            // a link swapped in meanwhile: checked all the same.
            if (realpath($path) !== $path) {
                continue;
            }
            $found[] = ['name' => $name, 'path' => $path, 'stamp' => $m[1], 'mtime' => (int) @filemtime($path)];
        }
        return $found;
    }

    /**
     * The archives backup_create wrote in $root, newest first: by the stamp
     * in the name, then by the file's time, then by name.
     *
     * @return array<int, array{name: string, path: string, stamp: string, mtime: int}>
     */
    public static function archives($root) {
        $real = self::real_root($root);
        if ($real === null) {
            return [];
        }
        $archives = self::own_entries($real, self::ARCHIVE_RE, false);
        usort($archives, function ($a, $b) {
            return strcmp($b['stamp'], $a['stamp']) ?: ($b['mtime'] <=> $a['mtime']) ?: strcmp($b['name'], $a['name']);
        });
        return $archives;
    }

    /** True for a name backup_create gives an archive. */
    public static function is_archive_name($name) {
        return is_string($name) && preg_match(self::ARCHIVE_RE, $name) === 1;
    }

    /**
     * Keep the newest $keep archives of $root and remove the older ones.
     * $just_written (an archive's file name) always stays, whatever the
     * clock said. An archive that cannot be removed is logged and listed
     * under 'failed': the caller's backup is made all the same.
     *
     * @return array{kept: string[], removed: string[], failed: string[]}
     */
    public static function prune($root, $just_written = null, $keep = self::KEEP) {
        $keep = max(1, (int) $keep);
        $out = ['kept' => [], 'removed' => [], 'failed' => []];
        $archives = self::archives($root);
        if (is_string($just_written) && $just_written !== '') {
            // The archive of this call first, the rest newest first.
            foreach ($archives as $i => $archive) {
                if ($archive['name'] === $just_written) {
                    unset($archives[$i]);
                    array_unshift($archives, $archive);
                    break;
                }
            }
            $archives = array_values($archives);
        }
        foreach ($archives as $i => $archive) {
            if ($i < $keep) {
                $out['kept'][] = $archive['name'];
                continue;
            }
            // The path is own_entries': an entry of the folder's own listing,
            // named as backup_create names an archive, a real file directly
            // inside the folder.
            if (self::delete_file($archive['path'])) {
                $out['removed'][] = $archive['name'];
            } else {
                $out['failed'][] = $archive['name'];
                WebMaven_Log::write('WebMaven: the old backup archive ' . $archive['name'] . ' could not be removed');
            }
        }
        return $out;
    }

    /**
     * Remove the staging folders of backups that never finished: named as
     * backup_create names them, and both their stamp and their own time older
     * than $max_age seconds. A folder a backup is filling now is younger and
     * stays.
     *
     * @return array{removed: string[], failed: string[]}
     */
    public static function sweep_stale_stages($root, $max_age = self::STAGE_MAX_AGE, $now = null) {
        $out = ['removed' => [], 'failed' => []];
        $real = self::real_root($root);
        if ($real === null) {
            return $out;
        }
        $now = $now === null ? time() : (int) $now;
        $limit = $now - max(0, (int) $max_age);
        foreach (self::own_entries($real, self::STAGE_RE, true) as $stage) {
            $named = self::stamp_time($stage['stamp']);
            if ($named === null || $named >= $limit || $stage['mtime'] >= $limit) {
                continue;
            }
            self::remove_tree($stage['path']);
            clearstatcache(true, $stage['path']);
            if (file_exists($stage['path'])) {
                $out['failed'][] = $stage['name'];
                WebMaven_Log::write('WebMaven: the leftover backup staging folder ' . $stage['name'] . ' could not be removed');
            } else {
                $out['removed'][] = $stage['name'];
            }
        }
        return $out;
    }

    /**
     * A plain sentence when the disk clearly has no room for an archive the
     * size of the last one, or null: room enough, no earlier archive to
     * measure by, or a server that does not tell its free space.
     * $free_bytes: the free space when the caller knows it (tests).
     */
    public static function room_problem($root, $free_bytes = null) {
        $archives = self::archives($root);
        if (!$archives) {
            return null;
        }
        $last = (int) @filesize($archives[0]['path']);
        if ($last <= 0) {
            return null;
        }
        if ($free_bytes === null) {
            $free_bytes = self::free_space($root);
        }
        if ($free_bytes === false || $free_bytes === null || !is_numeric($free_bytes)) {
            return null;
        }
        $needed = $last + (int) ceil($last / self::ROOM_MARGIN_PART);
        if ((float) $free_bytes >= $needed) {
            return null;
        }
        return sprintf(
            'There is not enough free disk space for a new backup: about %s is free and the last backup took %s. Free some space on the site\'s hosting, then try again.',
            self::megabytes((float) $free_bytes),
            self::megabytes((float) $last)
        );
    }

    /**
     * Room for a new archive on a tight disk, before anything is written.
     * While there is no room for an archive the size of the last one and
     * more than KEEP_WHILE_WRITING archives exist, the OLDEST one goes and
     * the room is read again: with three kept, two good archives stay to fall
     * back on while the new one is written. The newest is never removed and
     * the folder never goes below two archives here. A site that kept every
     * archive (nothing removed one before 1.4.0) loses its oldest one at a
     * time, only until there is room.
     *
     * 'problem': null when there is room now (or the server does not tell
     * its free space), else the sentence of room_problem. 'removed': the
     * archives that went, by file name.
     *
     * @return array{problem: ?string, removed: string[]}
     */
    public static function make_room($root) {
        $removed = [];
        $problem = self::room_problem($root);
        while ($problem !== null) {
            $archives = self::archives($root);
            if (count($archives) <= self::KEEP_WHILE_WRITING) {
                break;
            }
            $oldest = $archives[count($archives) - 1];
            // The path is own_entries': an archive of the folder's own
            // listing, a real file directly inside the folder; the oldest of
            // at least three, so never the newest.
            if (!self::delete_file($oldest['path'])) {
                WebMaven_Log::write('WebMaven: the old backup archive ' . $oldest['name'] . ' could not be removed to make room');
                break;
            }
            clearstatcache(true, $oldest['path']);
            $removed[] = $oldest['name'];
            $problem = self::room_problem($root);
        }
        return ['problem' => $problem, 'removed' => $removed];
    }

    /** "Ymd-His" (UTC) as a Unix time, or null when it is not a date. */
    private static function stamp_time($stamp) {
        $date = \DateTime::createFromFormat('Ymd-His', (string) $stamp, new \DateTimeZone('UTC'));
        $errors = \DateTime::getLastErrors();
        if ($date === false || (is_array($errors) && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))) {
            return null;
        }
        return $date->getTimestamp();
    }

    private static function megabytes($bytes) {
        $mb = $bytes / 1048576;
        return ($mb >= 10 ? (string) round($mb) : (string) round($mb, 1)) . ' MB';
    }

    /** Removes a file; true when it is gone (wp_delete_file answers only since WordPress 6.7). */
    private static function delete_file($path) {
        wp_delete_file($path);
        clearstatcache(true, $path);
        return !file_exists($path) && !is_link($path);
    }

    /** A staging folder and what is in it. A link is removed as a link, never followed. */
    private static function remove_tree($path) {
        if (is_link($path) || is_file($path)) {
            wp_delete_file($path);
            return;
        }
        if (!is_dir($path)) {
            return;
        }
        foreach ((array) @scandir($path) as $entry) {
            if ($entry === '.' || $entry === '..' || $entry === '' || !is_string($entry)) {
                continue;
            }
            self::remove_tree($path . DIRECTORY_SEPARATOR . $entry);
        }
        WebMaven_Files::rmdir($path);
    }
}

}
