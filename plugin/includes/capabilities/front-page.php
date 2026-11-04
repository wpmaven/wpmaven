<?php
/**
 * Which page a site opens on, and when WPMaven may change it (front page
 * rules, and the restore_front webhook action).
 *
 * A fresh WordPress shows the latest posts on its front page. After a build,
 * that front page should be the designed homepage: on a hosted site always,
 * on a site the owner already runs only when its front page is still
 * WordPress's default and nothing on the site is the owner's (a blog the
 * owner writes is their choice of front page). Otherwise the switch is
 * offered to the owner, one click away, and can be put back.
 *
 * One rule for every door: finalize_site (the build), publish_preflight (the
 * check before a publish), set_homepage and restore_front (the owner's
 * switch and its undo).
 */

if (!defined('ABSPATH')) {
    exit;
}

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['restore_front'] = ['WebMaven_Front_Page', 'restore'];
    return $handlers;
});

class WebMaven_Front_Page {

    /** Posts and pages read when looking for the owner's content (oldest first). */
    const OWNER_SCAN_CAP = 500;

    /** The front page setting as it is now. */
    public static function setting() {
        $front = (int) get_option('page_on_front', 0);
        $title = null;
        if ($front > 0 && function_exists('get_post')) {
            $page = get_post($front);
            if ($page) {
                $title = (string) ($page->post_title ?? '');
            }
        }
        return [
            'show_on_front' => get_option('show_on_front', 'posts') === 'page' ? 'page' : 'posts',
            'page_on_front' => $front,
            'page_on_front_title' => $title,
            'page_for_posts' => (int) get_option('page_for_posts', 0),
        ];
    }

    /** A page WPMaven made: the AI marker, or the planned page it is (_wm_page). */
    public static function is_wpmaven_page($post_id) {
        $post_id = (int) $post_id;
        if ($post_id <= 0) {
            return false;
        }
        if (class_exists('WebMaven_AI_Marking') && WebMaven_AI_Marking::is_ai_generated($post_id)) {
            return true;
        }
        return function_exists('get_post_meta') && (string) get_post_meta($post_id, '_wm_page', true) !== '';
    }

    /** WooCommerce's own pages (cart, checkout, my account, shop, terms). */
    public static function woocommerce_page_ids() {
        $ids = [];
        foreach (['cart', 'checkout', 'myaccount', 'shop', 'terms'] as $page) {
            $id = function_exists('wc_get_page_id') ? (int) wc_get_page_id($page) : (int) get_option('woocommerce_' . $page . '_page_id', 0);
            if ($id > 0) {
                $ids[] = $id;
            }
        }
        return array_values(array_unique($ids));
    }

    /**
     * The owner's published, scheduled or private posts and pages: not made
     * by WPMaven, not WordPress's untouched sample content, not one of
     * WooCommerce's pages. Counted up to OWNER_SCAN_CAP of each.
     *
     * @return array{posts: int, pages: int}
     */
    public static function owner_content() {
        $counts = ['posts' => 0, 'pages' => 0];
        if (!function_exists('get_posts')) {
            return $counts;
        }
        $woo = self::woocommerce_page_ids();
        foreach (['post' => 'posts', 'page' => 'pages'] as $type => $key) {
            $found = get_posts([
                'post_type' => $type,
                'post_status' => ['publish', 'future', 'private'],
                'numberposts' => self::OWNER_SCAN_CAP,
                'orderby' => 'ID',
                'order' => 'ASC',
            ]);
            foreach ((array) $found as $post) {
                $post = is_object($post) ? $post : (function_exists('get_post') ? get_post((int) $post) : null);
                if (!$post || empty($post->ID)) {
                    continue;
                }
                $id = (int) $post->ID;
                if (in_array($id, $woo, true) || self::is_wpmaven_page($id)) {
                    continue;
                }
                if (class_exists('WebMaven_Default_Content') && WebMaven_Default_Content::untouched_kind($post) !== null) {
                    continue;
                }
                $counts[$key]++;
            }
        }
        return $counts;
    }

    /**
     * Whether a build may set the front page of a site the owner already
     * runs, and why not. Set only when the front shows WordPress's default
     * (the latest posts, no static front page) and nothing on the site is the
     * owner's; a front page WPMaven set before stays WPMaven's to update.
     *
     * @return array{would_set: bool, reason: string, owner_content: array{posts: int, pages: int}}
     */
    public static function verdict() {
        $show = get_option('show_on_front', 'posts') === 'page' ? 'page' : 'posts';
        $front_id = (int) get_option('page_on_front', 0);
        $front = ($front_id > 0 && function_exists('get_post')) ? get_post($front_id) : null;
        $front_live = $front && (string) ($front->post_status ?? '') !== 'trash';
        $owner = self::owner_content();
        if ($front_live && self::is_wpmaven_page($front_id)) {
            return ['would_set' => true, 'reason' => 'wordpress_default', 'owner_content' => $owner];
        }
        if ($front_live) {
            return ['would_set' => false, 'reason' => 'owner_static_front', 'owner_content' => $owner];
        }
        if ($owner['posts'] + $owner['pages'] > 0) {
            return ['would_set' => false, 'reason' => 'owner_content', 'owner_content' => $owner];
        }
        return ['would_set' => true, 'reason' => 'wordpress_default', 'owner_content' => $owner];
    }

    /** Open the site on this page; a posts page that was this page is cleared. */
    public static function use_page($page_id) {
        $page_id = (int) $page_id;
        update_option('show_on_front', 'page');
        update_option('page_on_front', $page_id);
        if ((int) get_option('page_for_posts', 0) === $page_id) {
            update_option('page_for_posts', 0);
        }
    }

    /** A page id that exists and is not in the trash, else 0. */
    public static function live_page_id($id) {
        $id = (int) $id;
        if ($id <= 0 || !function_exists('get_post')) {
            return 0;
        }
        $page = get_post($id);
        if (!$page || (string) ($page->post_type ?? '') !== 'page' || (string) ($page->post_status ?? '') === 'trash') {
            return 0;
        }
        return $id;
    }

    /**
     * restore_front: put a previous front page setting back (the undo of a
     * switch), using only pages that still exist outside the trash. A front
     * page that is gone falls back to the latest posts.
     *
     * Params: { show_on_front: 'posts'|'page', page_on_front, page_for_posts }
     */
    public static function restore($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        $show = (string) ($params['show_on_front'] ?? '') === 'page' ? 'page' : 'posts';
        $front = self::live_page_id($params['page_on_front'] ?? 0);
        $posts = self::live_page_id($params['page_for_posts'] ?? 0);
        if ($show === 'page' && $front === 0) {
            $show = 'posts';
        }
        if ($posts > 0 && $posts === $front) {
            $posts = 0;
        }
        update_option('show_on_front', $show);
        update_option('page_on_front', $front);
        update_option('page_for_posts', $posts);
        $now = self::setting();
        return array_merge(['success' => true], $now);
    }
}
