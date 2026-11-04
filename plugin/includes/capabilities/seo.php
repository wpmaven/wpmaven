<?php
/**
 * Search engine fields for the WPMaven API (1.3.0): the dashboard's Pages tab
 * reads them, and its saves are edit operations (update_post with an seo
 * group: a preview, history and undo) that write them through seo_update.
 * One service underneath, WebMaven_SEO_Fields.
 *
 *   seo_read    {type: page|post, page?, perPage?}
 *               -> {items: [{postId, type, title, url, status, modified,
 *                            seo: {title, description, noindex}}], total, seoPlugin}
 *               {postId}
 *               -> {postId, type, title, url, modified, fields: {title,
 *                   description, ogTitle, ogDescription, ogImage, ogImageUrl,
 *                   noindex}, seoPlugin}
 *   seo_update  {postId, fields}   only the given fields change
 *               -> {previous: {...the same keys}, fields: {...the same keys}}
 *   seo_site_read    {} -> {shareImage, shareImageUrl, hidden, tagline,
 *                           seoPlugin, canSetShareImage, frontPage}  (1.5.0)
 *   seo_site_update  {fields: {shareImage?, hidden?, tagline?}}
 *                    -> {previous: {...}, fields: {...}}             (1.5.0)
 *
 * seoPlugin is the active SEO plugin's name ("Yoast SEO") or null. Failures
 * THROW "CODE: sentence" (NOT_FOUND, VALIDATION), as the edit commands do.
 * Registered through the filter, so the execute_command bridge cannot reach
 * these.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once dirname(__DIR__) . '/class-webmaven-seo-fields.php';

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['seo_read'] = ['WebMaven_Cap_Seo', 'seo_read'];
    $handlers['seo_update'] = ['WebMaven_Cap_Seo', 'seo_update'];
    $handlers['seo_site_read'] = ['WebMaven_Cap_Seo', 'seo_site_read'];
    $handlers['seo_site_update'] = ['WebMaven_Cap_Seo', 'seo_site_update'];
    return $handlers;
});

final class WebMaven_Cap_Seo {

    const MAX_PER_PAGE = 100;

    public static function seo_read($parameters, $step_id = null) {
        $p = is_array($parameters) ? $parameters : [];
        if (isset($p['postId'])) {
            $post = WebMaven_SEO_Fields::post_or_fail($p['postId']);
            $fields = WebMaven_SEO_Fields::read($post->ID);
            $summary = WebMaven_SEO_Fields::summary($post);
            $fields['ogImageUrl'] = WebMaven_SEO_Fields::image_url($fields['ogImage']);
            return [
                'postId' => $summary['postId'],
                'type' => $summary['type'],
                'title' => $summary['title'],
                'url' => $summary['url'],
                'modified' => $summary['modified'],
                'fields' => $fields,
                'seoPlugin' => WebMaven_SEO_Fields::active_plugin_name(),
            ];
        }

        $type = $p['type'] ?? 'page';
        if ($type !== 'page' && $type !== 'post') {
            throw new Exception('VALIDATION: type must be page or post.');
        }
        $page = max(1, (int) ($p['page'] ?? 1));
        $per_page = min(self::MAX_PER_PAGE, max(1, (int) ($p['perPage'] ?? 50)));
        $query = new WP_Query([
            'post_type' => $type,
            'post_status' => WebMaven_SEO_Fields::LIST_STATUSES,
            'posts_per_page' => $per_page,
            'paged' => $page,
            'orderby' => $type === 'page' ? ['menu_order' => 'ASC', 'title' => 'ASC'] : ['date' => 'DESC'],
            'no_found_rows' => false,
            'ignore_sticky_posts' => true,
            // Other plugins' query filters (a language switcher, a membership
            // rule) never hide a page from the SEO list.
            'suppress_filters' => true, // phpcs:ignore WordPressVIPMinimum.Performance.WPQueryParams.SuppressFilters_suppress_filters
        ]);
        $items = [];
        foreach ((array) $query->posts as $post) {
            $items[] = WebMaven_SEO_Fields::summary($post);
        }
        return [
            'items' => $items,
            'total' => (int) $query->found_posts,
            'page' => $page,
            'perPage' => $per_page,
            'seoPlugin' => WebMaven_SEO_Fields::active_plugin_name(),
        ];
    }

    public static function seo_site_read($parameters = [], $step_id = null) {
        return WebMaven_SEO_Site::read();
    }

    public static function seo_site_update($parameters, $step_id = null) {
        $p = is_array($parameters) ? $parameters : [];
        $fields = $p['fields'] ?? null;
        if (!is_array($fields) || $fields === []) {
            throw new Exception('VALIDATION: fields must name at least one search setting.');
        }
        return WebMaven_SEO_Site::write($fields);
    }

    public static function seo_update($parameters, $step_id = null) {
        $p = is_array($parameters) ? $parameters : [];
        $post = WebMaven_SEO_Fields::post_or_fail($p['postId'] ?? 0);
        $fields = $p['fields'] ?? null;
        if (!is_array($fields) || $fields === []) {
            throw new Exception('VALIDATION: fields must name at least one search engine field.');
        }
        return WebMaven_SEO_Fields::write($post->ID, $fields);
    }
}
