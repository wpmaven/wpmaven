<?php
/**
 * The editor's edit operations (2026-10-05): the plugin's door to the
 * WPMaven edit service, for the editor of a site WPMaven built. Every route
 * is proxied to the API with the site's own token (WebMaven_WP_API_Client):
 *
 *   POST webmaven/v1/edits                    preview or publish an operation
 *   GET  webmaven/v1/edits/site-map           what the editor can address
 *   GET  webmaven/v1/edits/history            the site's changes, newest first
 *   GET  webmaven/v1/edits/<id>               one change (long previews are polled)
 *   POST webmaven/v1/edits/<id>/publish       publish a preview by its id { force?, wait? } (one made elsewhere too)
 *   POST webmaven/v1/edits/<id>/discard       a preview the owner does not want
 *   POST webmaven/v1/edits/<id>/share         "Share preview": a 72-hour link
 *   POST webmaven/v1/edits/<id>/undo          { mode, previewId?, force?, wait? }
 *   GET  webmaven/v1/seo-check                the last check of how search engines see the site (1.5.0)
 *   POST webmaven/v1/seo-check                check it now (about a minute)
 *   POST webmaven/v1/seo-suggest/<postId>     a suggested search title and description (AI, nothing written);
 *                                             { image: true } (1.8.0): a picture for sharing too, for a page without one
 *   POST webmaven/v1/seo-share-image/<postId> a picture for sharing the page (AI, 1.8.0): into the media library only
 *   POST webmaven/v1/seo-share-image/site     a picture for sharing the whole site (AI, 1.9.0): into the media library only
 *   GET  webmaven/v1/seo-site                 the whole site's search settings, read here (no API call)
 *
 * Who: an administrator (manage_options) of a site connected to WPMaven,
 * where the account lets this site take edits (features.edits) and the
 * site's own switch (WEBMAVEN_WP_SITE_TOKEN_CHAT) is on. Anyone else gets
 * an answer and no API call is made. The API checks the operation itself.
 *
 * The answer is the API's own (an EditResult, the site map, the history),
 * with its status; a refusal without one is { error, code } in plain words.
 */

defined('ABSPATH') || exit;

final class WebMaven_Edits_REST {

    const NS = 'webmaven/v1';
    /** An operation id as the API writes them (a cuid). */
    const OP_ID = '[a-z0-9]{20,40}';
    const SOURCES = ['editor', 'store', 'chat'];
    const EDITS_OFF_CODE = 'wpmaven_edits_off';

    public static function register_routes(): void {
        register_rest_route(self::NS, '/edits', [
            'methods'             => 'POST',
            'callback'            => [__CLASS__, 'request_edit'],
            'permission_callback' => [__CLASS__, 'permission'],
        ]);
        register_rest_route(self::NS, '/edits/site-map', [
            'methods'             => 'GET',
            'callback'            => [__CLASS__, 'site_map'],
            'permission_callback' => [__CLASS__, 'permission'],
        ]);
        // Before the one-change route: "history" is a word, never an id.
        register_rest_route(self::NS, '/edits/history', [
            'methods'             => 'GET',
            'callback'            => [__CLASS__, 'history'],
            'permission_callback' => [__CLASS__, 'permission'],
        ]);
        register_rest_route(self::NS, '/edits/(?P<op>' . self::OP_ID . ')', [
            'methods'             => 'GET',
            'callback'            => [__CLASS__, 'get_edit'],
            'permission_callback' => [__CLASS__, 'permission'],
        ]);
        register_rest_route(self::NS, '/seo-check', [
            'methods'             => ['GET', 'POST'],
            'callback'            => [__CLASS__, 'seo_check'],
            'permission_callback' => [__CLASS__, 'permission'],
        ]);
        register_rest_route(self::NS, '/seo-site', [
            'methods'             => 'GET',
            'callback'            => [__CLASS__, 'seo_site'],
            'permission_callback' => [__CLASS__, 'permission'],
        ]);
        register_rest_route(self::NS, '/seo-suggest/(?P<post>\d{1,18})', [
            'methods'             => 'POST',
            'callback'            => [__CLASS__, 'seo_suggest'],
            'permission_callback' => [__CLASS__, 'permission'],
        ]);
        register_rest_route(self::NS, '/seo-share-image/(?P<post>\d{1,18})', [
            'methods'             => 'POST',
            'callback'            => [__CLASS__, 'seo_share_image'],
            'permission_callback' => [__CLASS__, 'permission'],
        ]);
        register_rest_route(self::NS, '/seo-share-image/site', [
            'methods'             => 'POST',
            'callback'            => [__CLASS__, 'seo_share_image_site'],
            'permission_callback' => [__CLASS__, 'permission'],
        ]);
        foreach (['publish', 'discard', 'share', 'undo'] as $action) {
            register_rest_route(self::NS, '/edits/(?P<op>' . self::OP_ID . ')/' . $action, [
                'methods'             => 'POST',
                'callback'            => [__CLASS__, $action . '_edit'],
                'permission_callback' => [__CLASS__, 'permission'],
            ]);
        }
    }

    /** Whether edits run from this site's WP-admin: the account's features.edits and the site's own switch. */
    public static function edits_enabled(): bool {
        return (defined('WEBMAVEN_WP_SITE_TOKEN_CHAT') ? (bool) WEBMAVEN_WP_SITE_TOKEN_CHAT : true)
            && class_exists('WebMaven_Site_State')
            && WebMaven_Site_State::feature('edits');
    }

    /** An administrator only; the switches are answered by the routes themselves (a reason the editor can show). */
    public static function permission() {
        if (!is_user_logged_in() || !current_user_can('manage_options')) {
            return new WP_Error('rest_forbidden', 'Only a site administrator can change the site from the editor.', ['status' => 403]);
        }
        return true;
    }

    // ── routes ───────────────────────────────────────────────────────────────

    public static function request_edit($request) {
        $params = self::json_params($request);
        $operation = $params['operation'] ?? null;
        $mode = ($params['mode'] ?? '') === 'publish' ? 'publish' : 'preview';
        // Another version asked from a chat card by the earlier preview's id
        // alone (1.5.0): the API takes that preview's operation.
        $version_only = $operation === null && $mode === 'preview'
            && is_string($params['variantOf'] ?? null) && preg_match('/^[a-z0-9]{1,64}$/', $params['variantOf']);
        if (!$version_only && (!is_array($operation) || !isset($operation['op']) || !is_string($operation['op']))) {
            return self::refusal(400, 'VALIDATION', 'Say what to change.');
        }
        $body = is_array($operation) ? ['operation' => $operation] : [];
        $body['mode'] = $mode;
        $body['source'] = in_array($params['source'] ?? '', self::SOURCES, true) ? $params['source'] : 'editor';
        // variantOf: another version of an earlier preview (its preview id);
        // revisionOf: a bulk change's values edited in its review, in place of that preview.
        foreach (['previewId', 'basePreviewId', 'variantOf', 'revisionOf'] as $key) {
            if (isset($params[$key]) && is_string($params[$key]) && preg_match('/^[a-z0-9]{1,64}$/', $params[$key])) {
                $body[$key] = $params[$key];
            }
        }
        if (isset($params['idempotencyKey']) && is_string($params['idempotencyKey']) && preg_match('/^[A-Za-z0-9_.:-]{1,120}$/', $params['idempotencyKey'])) {
            $body['idempotencyKey'] = $params['idempotencyKey'];
        }
        if (($params['force'] ?? false) === true) {
            $body['force'] = true;
        }
        if (($params['wait'] ?? false) === true) {
            $body['wait'] = true;
        }
        return self::forward('POST', '', $body, null, 90);
    }

    public static function seo_check($request) {
        $post = method_exists($request, 'get_method') && $request->get_method() === 'POST';
        return self::forward_to($post ? 'POST' : 'GET', '/seo/check', $post ? [] : null, null, $post ? 120 : 30);
    }

    public static function seo_site($request) {
        return new WP_REST_Response(class_exists('WebMaven_SEO_Site') ? WebMaven_SEO_Site::read() : [], 200);
    }

    public static function seo_suggest($request) {
        $post_id = (int) $request['post'];
        if ($post_id <= 0) {
            return self::refusal(400, 'VALIDATION', 'Say which page.');
        }
        // A picture for sharing with the words (1.8.0, 2026-10-17): making it takes longer.
        $image = (self::json_params($request)['image'] ?? false) === true;
        return $image
            ? self::forward_to('POST', '/pages/' . $post_id . '/seo/suggest', ['image' => true], null, 150)
            : self::forward_to('POST', '/pages/' . $post_id . '/seo/suggest', [], null, 60);
    }

    /**
     * "Generate a picture" in the Search panel (1.8.0, 2026-10-17): one
     * picture for sharing this page, made by the API in the site's look and
     * put in the media library. The form's title and description, when sent,
     * say what the page is about. Nothing is saved to the page here.
     */
    public static function seo_share_image($request) {
        $post_id = (int) $request['post'];
        if ($post_id <= 0) {
            return self::refusal(400, 'VALIDATION', 'Say which page.');
        }
        return self::forward_to('POST', '/pages/' . $post_id . '/seo/share-image', self::share_image_words($request), null, 150);
    }

    /**
     * "Make a picture" in the Search panel's Whole site tab (1.9.0,
     * 2026-10-19), for a site whose homepage lists the latest posts: one
     * picture for sharing the whole site, made by the API from the header
     * and the homepage's design, with the site's name and tagline as its
     * words. Into the media library only: the tab's Save makes it the site's.
     */
    public static function seo_share_image_site($request) {
        return self::forward_to('POST', '/site/seo/share-image', self::share_image_words($request), null, 150);
    }

    /** The words a share picture is made from, as the form sent them: plain, bounded, left out when empty. */
    private static function share_image_words($request) {
        $params = self::json_params($request);
        $body = new stdClass();
        foreach (['title' => 300, 'description' => 1000] as $key => $max) {
            if (isset($params[$key]) && is_string($params[$key])) {
                $text = trim(wp_strip_all_tags($params[$key]));
                if ($text !== '') {
                    $body->$key = function_exists('mb_substr') ? mb_substr($text, 0, $max) : substr($text, 0, $max);
                }
            }
        }
        return $body;
    }

    public static function site_map($request) {
        return self::forward('GET', '/site-map', null, null, 90);
    }

    public static function history($request) {
        $query = [];
        $limit = (int) $request->get_param('limit');
        if ($limit > 0) {
            $query['limit'] = min(100, $limit);
        }
        $cursor = $request->get_param('cursor');
        if (is_string($cursor) && preg_match('/^' . self::OP_ID . '$/', $cursor)) {
            $query['cursor'] = $cursor;
        }
        foreach (['status', 'kind'] as $key) {
            $value = $request->get_param($key);
            if (is_string($value) && preg_match('/^[a-z_,]{1,200}$/', $value)) {
                $query[$key] = $value;
            }
        }
        return self::forward('GET', '', null, $query ?: null, 30);
    }

    public static function get_edit($request) {
        return self::forward('GET', '/' . $request['op'], null, null, 30);
    }

    /** A preview published by its id: History publishes what another screen, a chat or another session previewed. */
    public static function publish_edit($request) {
        $params = self::json_params($request);
        $body = ['wait' => ($params['wait'] ?? false) === true];
        if (($params['force'] ?? false) === true) {
            $body['force'] = true;
        }
        return self::forward('POST', '/' . $request['op'] . '/publish', $body, null, 90);
    }

    public static function discard_edit($request) {
        return self::forward('POST', '/' . $request['op'] . '/discard', new stdClass(), null, 30);
    }

    public static function share_edit($request) {
        return self::forward('POST', '/' . $request['op'] . '/share', new stdClass(), null, 30);
    }

    public static function undo_edit($request) {
        $params = self::json_params($request);
        $body = [
            'mode' => ($params['mode'] ?? '') === 'publish' ? 'publish' : 'preview',
            // The editor polls a long undo; the API waits only when asked.
            'wait' => ($params['wait'] ?? false) === true,
        ];
        if (isset($params['previewId']) && is_string($params['previewId']) && preg_match('/^[a-z0-9]{1,64}$/', $params['previewId'])) {
            $body['previewId'] = $params['previewId'];
        }
        if (($params['force'] ?? false) === true) {
            $body['force'] = true;
        }
        return self::forward('POST', '/' . $request['op'] . '/undo', $body, null, 90);
    }

    // ── the API call ─────────────────────────────────────────────────────────

    /**
     * One call to /instances/<this site>/edits<path>, as this administrator.
     * The answer keeps the API's status (202 for a change still being
     * prepared); a refusal the API wrote passes on as it is.
     */
    private static function forward(string $method, string $path, $body, $query, int $timeout) {
        return self::forward_to($method, '/edits' . $path, $body, $query, $timeout);
    }

    /** One call to /instances/<this site><path>, as this administrator. */
    private static function forward_to(string $method, string $path, $body, $query, int $timeout) {
        if (!self::edits_enabled()) {
            return self::refusal(403, self::EDITS_OFF_CODE, 'Changes from the editor are not on for this site yet.');
        }
        $instance_id = (string) get_option('webmaven_wp_instance_id', '');
        if ($instance_id === '' || !preg_match('/^[A-Za-z0-9_-]{1,64}$/', $instance_id)) {
            return class_exists('WebMaven_WP_Admin_Access')
                ? WebMaven_WP_Admin_Access::not_connected_response()
                : self::refusal(409, 'wpmaven_site_not_connected', 'This site is not connected to WPMaven.');
        }
        $client = new WebMaven_WP_API_Client();
        if (!$client->is_configured()) {
            return class_exists('WebMaven_WP_Admin_Access')
                ? WebMaven_WP_Admin_Access::not_connected_response()
                : self::refusal(409, 'wpmaven_site_not_connected', 'This site is not connected to WPMaven.');
        }
        $user = wp_get_current_user();
        if ($user && !empty($user->ID)) {
            $roles = is_array($user->roles ?? null) ? $user->roles : [];
            $client->with_header('X-WPMaven-WP-User', (int) $user->ID . ';' . sanitize_user((string) $user->user_login, true) . ';' . (string) ($roles[0] ?? ''));
        }
        $response = $client->make_request('/instances/' . rawurlencode($instance_id) . $path, $method, $body, $query, $timeout);
        return self::answer(is_array($response) ? $response : []);
    }

    /** The API's answer as the REST response the editor reads. */
    public static function answer(array $response) {
        $status = (int) ($response['status_code'] ?? 0);
        $data = $response['data'] ?? null;
        if ($status >= 200 && $status < 300 && is_array($data)) {
            return new WP_REST_Response($data, $status);
        }
        // A change that did not happen still answers its row (ok:false, failures).
        if (is_array($data) && (isset($data['operationId']) || isset($data['failures']))) {
            return new WP_REST_Response($data, $status >= 400 ? $status : 200);
        }
        if ($status === 0) {
            return self::refusal(502, 'SITE_UNREACHABLE', self::unreachable_text());
        }
        $code = isset($response['code']) && is_string($response['code']) ? $response['code'] : 'api_error';
        $message = isset($response['error']) && is_string($response['error']) && trim($response['error']) !== ''
            ? wp_strip_all_tags($response['error'])
            : self::failed_text();
        return self::refusal($status >= 400 ? $status : 502, $code, $message);
    }

    /** "WPMaven did not answer.", in the brand's words (as the setup wizard says it, WebMaven_Wizard). */
    private static function unreachable_text(): string {
        $name = class_exists('WebMaven_Brand') ? WebMaven_Brand::name_or('The dashboard') : 'WPMaven';
        return sprintf('%s did not answer. Try again in a moment.', $name);
    }

    /** "WPMaven could not do this right now.", in the brand's words, or naming nobody while the brand has no name. */
    private static function failed_text(): string {
        $name = class_exists('WebMaven_Brand') ? WebMaven_Brand::name_or('') : 'WPMaven';
        return $name !== ''
            ? $name . ' could not do this right now. Try again in a moment.'
            : 'This could not be done right now. Try again in a moment.';
    }

    private static function refusal(int $status, string $code, string $message) {
        return new WP_REST_Response(['error' => $message, 'code' => $code], $status);
    }

    private static function json_params($request): array {
        $params = method_exists($request, 'get_json_params') ? $request->get_json_params() : null;
        return is_array($params) ? $params : [];
    }
}
