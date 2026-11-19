<?php
/**
 * Owner-approved maintenance (1.2.6). The API sends this only after the site
 * owner said yes to it.
 *
 *   database_cleanup   deletes old revisions (keeping the newest few per
 *                      post), week-old auto-drafts, trashed posts (never
 *                      WooCommerce orders), spam and trashed comments, and
 *                      expired transients, through WordPress's own delete
 *                      functions, and returns the counts.
 *
 * This edition updates nothing and changes no security setting:
 * apply_updates and hardening_apply answer REQUIRES_AGENT.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['database_cleanup'] = ['WebMaven_Cap_Maintenance', 'database_cleanup'];
    return $handlers;
});

class WebMaven_Cap_Maintenance {

    const CLEANUP_ITEMS = ['revisions', 'auto_drafts', 'trashed_posts', 'spam_comments', 'trashed_comments', 'expired_transients'];

    /** Auto-drafts younger than this may be an editor still open (WordPress core uses the same week). */
    const AUTO_DRAFT_MIN_AGE_DAYS = 7;

    /** Seconds one cleanup call works before it stops and reports what is left. */
    const CLEANUP_TIME_BUDGET = 20;

    // ── database_cleanup ────────────────────────────────────────────────

    public static function database_cleanup($params = [], $step_id = null) {
        global $wpdb;

        $items = self::CLEANUP_ITEMS;
        if (isset($params['items']) && is_array($params['items']) && $params['items']) {
            $asked = array_map('sanitize_key', $params['items']);
            $unknown = array_values(array_diff($asked, self::CLEANUP_ITEMS));
            if ($unknown) {
                return ['success' => false, 'error' => 'Unknown cleanup item(s): ' . implode(', ', $unknown) . '. Allowed: ' . implode(', ', self::CLEANUP_ITEMS)];
            }
            $items = array_values(array_intersect(self::CLEANUP_ITEMS, $asked));
        }
        $keep = isset($params['keep_revisions']) ? (int) $params['keep_revisions'] : 3;
        $keep = max(0, min(50, $keep));
        $limit = isset($params['limit']) ? (int) $params['limit'] : 1000;
        $limit = max(1, min(5000, $limit));

        // A dropped connection must not stop a delete halfway; the work
        // stops itself at CLEANUP_TIME_BUDGET, within PHP's default limit.
        @ignore_user_abort(true);
        $deadline = microtime(true) + self::CLEANUP_TIME_BUDGET;
        $out_of_time = function () use ($deadline) {
            return microtime(true) > $deadline;
        };

        $deleted = array_fill_keys($items, 0);
        $failed = 0;
        $skipped = [];
        $stopped = false;
        $order_types = WebMaven_Cap_Diagnostics::ORDER_POST_TYPES;

        foreach ($items as $item) {
            if ($out_of_time()) {
                $stopped = true;
                break;
            }
            switch ($item) {
                case 'revisions':
                    // Newest first per post, so the first $keep of each are kept.
                    $rows = (array) $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- lists what the clean-up the owner asked for removes, which no WordPress function lists; each item is then deleted through WordPress (wp_delete_post, wp_delete_comment); read as the site is now, so nothing is cached
                        "SELECT ID, post_parent FROM {$wpdb->posts} WHERE post_type = 'revision' ORDER BY post_parent ASC, post_date DESC, ID DESC",
                        ARRAY_A
                    );
                    $seen = [];
                    $kept = 0;
                    foreach ($rows as $row) {
                        $parent = (int) $row['post_parent'];
                        $seen[$parent] = ($seen[$parent] ?? 0) + 1;
                        if ($seen[$parent] <= $keep) {
                            $kept++;
                            continue;
                        }
                        if ($deleted['revisions'] >= $limit || $out_of_time()) {
                            $stopped = true;
                            break;
                        }
                        $res = wp_delete_post_revision((int) $row['ID']);
                        if ($res && !is_wp_error($res)) {
                            $deleted['revisions']++;
                        } else {
                            $failed++;
                        }
                    }
                    $skipped['kept_revisions'] = $kept;
                    break;

                case 'auto_drafts':
                    $ids = (array) $wpdb->get_col($wpdb->prepare( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- lists what the clean-up the owner asked for removes, which no WordPress function lists; each item is then deleted through WordPress (wp_delete_post, wp_delete_comment); read as the site is now, so nothing is cached
                        "SELECT ID FROM {$wpdb->posts} WHERE post_status = 'auto-draft' AND DATE_SUB(NOW(), INTERVAL %d DAY) > post_date LIMIT %d",
                        self::AUTO_DRAFT_MIN_AGE_DAYS,
                        $limit
                    ));
                    $all = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_status = 'auto-draft'"); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- lists what the clean-up the owner asked for removes, which no WordPress function lists; each item is then deleted through WordPress (wp_delete_post, wp_delete_comment); read as the site is now, so nothing is cached
                    $skipped['recent_auto_drafts'] = max(0, $all - count($ids));
                    self::delete_each($ids, function ($id) {
                        return wp_delete_post($id, true);
                    }, $deleted['auto_drafts'], $failed, $stopped, $out_of_time);
                    break;

                case 'trashed_posts':
                    $ids = (array) $wpdb->get_col($wpdb->prepare( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- lists what the clean-up the owner asked for removes, which no WordPress function lists; each item is then deleted through WordPress (wp_delete_post, wp_delete_comment); read as the site is now, so nothing is cached
                        // One %s per order post type.
                        "SELECT ID FROM %i WHERE post_status = 'trash' AND post_type NOT IN (" . implode(', ', array_fill(0, count($order_types), '%s')) . ') LIMIT %d',
                        array_merge([$wpdb->posts], $order_types, [$limit])
                    ));
                    $skipped['trashed_orders'] = (int) $wpdb->get_var($wpdb->prepare( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- lists what the clean-up the owner asked for removes, which no WordPress function lists; each item is then deleted through WordPress (wp_delete_post, wp_delete_comment); read as the site is now, so nothing is cached
                        "SELECT COUNT(*) FROM %i WHERE post_status = 'trash' AND post_type IN (" . implode(', ', array_fill(0, count($order_types), '%s')) . ')',
                        array_merge([$wpdb->posts], $order_types)
                    ));
                    self::delete_each($ids, function ($id) {
                        return wp_delete_post($id, true);
                    }, $deleted['trashed_posts'], $failed, $stopped, $out_of_time);
                    break;

                case 'spam_comments':
                case 'trashed_comments':
                    $status = $item === 'spam_comments' ? 'spam' : 'trash';
                    $ids = (array) $wpdb->get_col($wpdb->prepare( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- lists what the clean-up the owner asked for removes, which no WordPress function lists; each item is then deleted through WordPress (wp_delete_post, wp_delete_comment); read as the site is now, so nothing is cached
                        "SELECT comment_ID FROM {$wpdb->comments} WHERE comment_approved = %s LIMIT %d",
                        $status,
                        $limit
                    ));
                    self::delete_each($ids, function ($id) {
                        return wp_delete_comment($id, true);
                    }, $deleted[$item], $failed, $stopped, $out_of_time);
                    break;

                case 'expired_transients':
                    $before = WebMaven_Cap_Diagnostics::clutter_counts()['expired_transients'];
                    delete_expired_transients(true);
                    $after = WebMaven_Cap_Diagnostics::clutter_counts()['expired_transients'];
                    $deleted['expired_transients'] = max(0, $before - $after);
                    break;
            }
        }

        $remaining = array_intersect_key(WebMaven_Cap_Diagnostics::clutter_counts(), array_flip($items));
        return [
            'deleted' => $deleted,
            'deleted_total' => array_sum($deleted),
            'remaining' => $remaining,
            'skipped' => $skipped,
            'failed' => $failed,
            'keep_revisions' => $keep,
            'limit' => $limit,
            'stopped_early' => $stopped,
        ];
    }

    private static function delete_each(array $ids, callable $delete, &$count, &$failed, &$stopped, callable $out_of_time) {
        foreach ($ids as $id) {
            if ($out_of_time()) {
                $stopped = true;
                return;
            }
            $res = $delete((int) $id);
            if ($res && !is_wp_error($res)) {
                $count++;
            } else {
                $failed++;
            }
        }
    }
}
