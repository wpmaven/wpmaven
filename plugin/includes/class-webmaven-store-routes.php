<?php
/**
 * The plugin app's own routes for the Store, Blog and Media screens
 * (webmaven_wp/v1, 2026-10-05).
 *
 * The screens read WordPress's and WooCommerce's own REST with the signed-in
 * user's cookie (wc/v3/products, wc/v3/orders, wp/v2/posts, wp/v2/media,
 * enriched by WebMaven_Store_Rest_Filters). These routes do the rest:
 *
 *   GET    /store/context                 what the screens need (StoreAppContext)
 *   POST   /store/edits                   one edit operation, through the WPMaven account
 *   GET    /store/edits?ref=&limit=       the changes made to one product, post or file
 *   POST   /store/edits/:operationId/undo
 *   GET    /store/products/:id/pricing    a printed product's floors and earnings
 *   GET    /store/redesign/available
 *   POST   /store/products/:id/redesign   New design (uses AI time)
 *   GET    /store/redesign/:jobId
 *   GET    /store/payments/orders?ids=    WPMaven Payments ledger rows of these orders
 *   GET    /media/usage?ids=              where each file is used (WebMaven_Media_Usage)
 *   DELETE /media/:id                     a file nothing uses
 *   POST   /media/alt-text                descriptions written by AI from the pictures
 *   GET    /media/designed?missing=       the pictures of the site's design (1.5.0)
 *
 * Every route needs WordPress's cookie and wp_rest nonce (core treats a
 * request without the nonce as signed out) and its own capability, by the
 * role tiers (WebMaven_Store_Caps): the owner tier is manage_options, the
 * store tier manage_woocommerce, the content tier edit_others_posts; authors
 * and below reach no route that calls the WPMaven API. A route that spends
 * AI time needs current_user_can_spend(). An edit operation is forwarded
 * only when it is one of the Store's (products, posts, images), never a
 * design operation, and only for a user who holds the capability WordPress
 * asks for that object.
 *
 * Forwarding (WebMaven_Store_Forward): a fixed API path under the site's
 * instance, the site's token, and X-WPMaven-WP-User "<id>;<login>;<role>"
 * (recorded by the API, never trusted). The generic /proxy prefix list is not
 * widened: these routes are the allowlist for their paths.
 */

if (!defined('ABSPATH')) {
    exit;
}

/** What the signed-in WordPress user may do in the Store, Blog, Media and Messages screens. */
final class WebMaven_Store_Caps {

    /** StoreCaps for the signed-in user. */
    public static function for_current_user(): array {
        $signed_in = function_exists('is_user_logged_in') && is_user_logged_in();
        $can = function ($cap) use ($signed_in) {
            return $signed_in && current_user_can($cap);
        };
        $woo = self::woo_active();
        $store = self::store_tier();
        return [
            'products' => $woo && $store && $can('edit_products'),
            'orders' => $woo && $store && $can('read_private_shop_orders'),
            'orderChanges' => $woo && $store && $can('edit_shop_orders'),
            'refunds' => $woo && $can('manage_woocommerce'),
            'posts' => $can('edit_others_posts'),
            'media' => $can('upload_files') && $can('edit_others_posts'),
            'messages' => $can(self::messages_capability()),
            'messagesSettings' => $can('manage_options'),
            'spend' => self::can_spend(),
        ];
    }

    /** The owner tier: an administrator. */
    public static function owner_tier(): bool {
        return is_user_logged_in() && current_user_can('manage_options');
    }

    /** The store tier or above: a shop manager or an administrator. */
    public static function store_tier(): bool {
        return is_user_logged_in() && (current_user_can('manage_options') || current_user_can('manage_woocommerce'));
    }

    /** The content tier or above: an editor (or a shop manager) or an administrator. */
    public static function content_tier(): bool {
        return is_user_logged_in() && (current_user_can('manage_options') || current_user_can('edit_others_posts'));
    }

    /**
     * The plugin's current_user_can_spend() (webmaven-wordpress.php): an
     * administrator, narrowed by the webmaven_wp_spend_capability filter,
     * never widened.
     */
    public static function can_spend(): bool {
        $cap = apply_filters('webmaven_wp_spend_capability', 'manage_options');
        $cap = is_string($cap) && $cap !== '' ? $cap : 'manage_options';
        return is_user_logged_in() && current_user_can('manage_options') && current_user_can($cap);
    }

    /** The Messages capability: the leads class's own when it is loaded. */
    public static function messages_capability(): string {
        if (class_exists('WebMaven_Leads') && method_exists('WebMaven_Leads', 'capability')) {
            $cap = (string) WebMaven_Leads::capability();
            return $cap !== '' ? $cap : 'manage_options';
        }
        $cap = apply_filters('wpmaven_messages_capability', 'edit_others_posts');
        return is_string($cap) && $cap !== '' ? $cap : 'manage_options';
    }

    public static function woo_active(): bool {
        return class_exists('WooCommerce') || function_exists('WC');
    }
}

/** A Store route's call to the WPMaven API (see the file header). */
final class WebMaven_Store_Forward {

    const UNREACHABLE = 'Changes to products and posts go through your WPMaven account, which this site cannot reach right now. You can still read everything here.';
    const FAILED = 'WPMaven could not do this right now. Try again in a moment.';

    /** Tests replace the API client (a callable returning an object with make_request). */
    public static $client_factory = null;

    /**
     * UNREACHABLE as a person in WP-admin reads it on a site under an
     * agency's or a partner's brand (WebMaven_Brand): "your Acme Studio
     * account", and "your account" while the brand has no name. Unchanged on
     * a WPMaven site.
     */
    public static function unreachable_text(): string {
        if (!class_exists('WebMaven_Brand') || WebMaven_Brand::is_wpmaven()) {
            return self::UNREACHABLE;
        }
        $account = WebMaven_Brand::mode() === WebMaven_Brand::MODE_BRAND ? 'your ' . WebMaven_Brand::name() . ' account' : 'your account';
        return 'Changes to products and posts go through ' . $account . ', which this site cannot reach right now. You can still read everything here.';
    }

    /** FAILED in the brand's words, or naming nobody while the brand has no name. */
    public static function failed_text(): string {
        if (!class_exists('WebMaven_Brand') || WebMaven_Brand::is_wpmaven()) {
            return self::FAILED;
        }
        return WebMaven_Brand::mode() === WebMaven_Brand::MODE_BRAND
            ? sprintf('%s could not do this right now. Try again in a moment.', WebMaven_Brand::name())
            : 'This could not be done right now. Try again in a moment.';
    }

    /**
     * Calls a fixed API path under this site's instance ($path starts with
     * "/", e.g. "/edits"). Answers a WP_REST_Response with the API's status
     * and body (its data on success), or 503 wpmaven_unreachable when the
     * site is not linked, the API refuses the site or does not answer.
     *
     * @return WP_REST_Response|WP_Error
     */
    public static function to_api(string $method, string $path, ?array $body = null, ?array $query = null, int $timeout = 30) {
        $instance = self::instance_id();
        $client = self::client();
        if ($instance === '' || !is_object($client) || (method_exists($client, 'is_configured') && !$client->is_configured())) {
            return self::unreachable();
        }
        // The WordPress user this call comes from (recorded by the API, never
        // trusted): on this call's own client, so no other request carries it.
        if (method_exists($client, 'with_header')) {
            $client->with_header('X-WPMaven-WP-User', self::wp_user_header());
        }
        $result = $client->make_request(
            '/instances/' . rawurlencode($instance) . $path,
            strtoupper($method),
            $body,
            $query ? $query : null,
            $timeout,
            0,
            false
        );
        return self::answer($result);
    }

    /** make_request's result as this site's REST answer. */
    public static function answer($result) {
        if (!is_array($result)) {
            return self::unreachable();
        }
        $status = (int) ($result['status_code'] ?? 0);
        $code = is_string($result['code'] ?? null) ? $result['code'] : '';
        if ($status === 0 || $status === 401 || ($status === 403 && strpos($code, 'SITE_') === 0)
            || (in_array($status, [502, 503, 504], true) && $code === '')) {
            return self::unreachable();
        }
        $data = $result['data'] ?? null;
        if ($status >= 200 && $status < 300) {
            return new WP_REST_Response($data, $status);
        }
        $failure = is_array($data) && is_array($data['failures'][0] ?? null) ? $data['failures'][0] : [];
        $message = is_string($result['error'] ?? null) ? trim($result['error']) : '';
        if ($message === '' && is_string($failure['message'] ?? null)) {
            $message = trim($failure['message']);
        }
        if ($code === '' && is_string($failure['code'] ?? null)) {
            $code = $failure['code'];
        }
        $out = is_array($data) ? $data : [];
        $out['code'] = $code !== '' ? $code : 'wpmaven_api_error';
        $out['message'] = $message !== '' ? $message : self::failed_text();
        $out['data'] = ['status' => $status];
        return new WP_REST_Response($out, $status);
    }

    public static function unreachable(): WP_Error {
        return new WP_Error('wpmaven_unreachable', self::unreachable_text(), ['status' => 503]);
    }

    /** "<id>;<login>;<role>": the signed-in WordPress user (login without ";", the first role). */
    public static function wp_user_header(): string {
        $user = function_exists('wp_get_current_user') ? wp_get_current_user() : null;
        $id = is_object($user) ? (int) ($user->ID ?? 0) : 0;
        $login = is_object($user) ? str_replace(';', '', (string) ($user->user_login ?? '')) : '';
        $roles = is_object($user) ? array_values((array) ($user->roles ?? [])) : [];
        $role = $roles ? (string) $roles[0] : '';
        return (string) preg_replace('/[\x00-\x1F\x7F]/', '', $id . ';' . $login . ';' . $role);
    }

    private static function instance_id(): string {
        $id = get_option('webmaven_wp_instance_id', '');
        $id = is_scalar($id) ? trim((string) $id) : '';
        return preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id) ? $id : '';
    }

    private static function client() {
        if (is_callable(self::$client_factory)) {
            return call_user_func(self::$client_factory);
        }
        return class_exists('WebMaven_WP_API_Client') ? new WebMaven_WP_API_Client() : null;
    }
}

final class WebMaven_Store_Routes {

    const NAMESPACE = 'webmaven_wp/v1';

    /** The operations the Store forwards. */
    const PRODUCT_OPS = ['update_product', 'add_product', 'remove_product'];
    const POST_OPS = ['update_post', 'add_post', 'remove_post'];

    const MAX_ALT_TEXT = 10;
    const MAX_USAGE_IDS = 100;
    const MAX_ORDER_IDS = 50;
    const EDIT_TIMEOUT = 150;

    const FORBIDDEN = 'Your WordPress role does not allow this.';
    const REFUSED_OPERATION = 'This change is made in the WPMaven editor, not here.';

    private static $started = false;

    /**
     * REFUSED_OPERATION in the site's brand (WebMaven_Brand): "the Acme
     * Studio editor", and "the editor" while the brand has no name.
     * Unchanged on a WPMaven site.
     */
    public static function refused_operation_text(): string {
        if (!class_exists('WebMaven_Brand') || WebMaven_Brand::is_wpmaven()) {
            return self::REFUSED_OPERATION;
        }
        return WebMaven_Brand::mode() === WebMaven_Brand::MODE_BRAND
            ? sprintf('This change is made in the %s editor, not here.', WebMaven_Brand::name())
            : 'This change is made in the editor, not here.';
    }

    /** "WPMaven", the brand's name, or '' while the brand has no name: the sentence then names nobody. */
    private static function brand_name(): string {
        return class_exists('WebMaven_Brand') ? WebMaven_Brand::name_or('') : 'WPMaven';
    }

    public static function init(): void {
        if (self::$started) {
            return;
        }
        self::$started = true;
        add_action('rest_api_init', [__CLASS__, 'register']);
        // The script data (the WP-admin app reads it synchronously): after the
        // app's own enqueue.
        add_action('admin_enqueue_scripts', [__CLASS__, 'script_data'], 20);
    }

    public static function register(): void {
        $id = '(?P<id>\d+)';
        $routes = [
            ['/store/context', 'GET', 'context', 'can_read_context'],
            ['/store/edits', 'POST', 'edit', 'can_edit'],
            ['/store/edits', 'GET', 'history', 'can_read_history'],
            ['/store/edits/(?P<operation>[A-Za-z0-9_-]{1,64})/undo', 'POST', 'undo', 'can_undo'],
            ['/store/products/' . $id . '/pricing', 'GET', 'pricing', 'can_products'],
            ['/store/redesign/available', 'GET', 'redesign_available', 'can_products'],
            ['/store/products/' . $id . '/redesign', 'POST', 'redesign', 'can_spend'],
            ['/store/redesign/(?P<job>[A-Za-z0-9_-]{1,64})', 'GET', 'redesign_job', 'can_products'],
            ['/store/payments/orders', 'GET', 'payments_orders', 'can_orders'],
            ['/store/orders/' . $id . '/shipment', 'POST', 'shipment', 'can_change_orders'],
            ['/media/usage', 'GET', 'media_usage', 'can_media'],
            ['/media/' . $id, 'DELETE', 'media_delete', 'can_delete_media'],
            ['/media/alt-text', 'POST', 'alt_text', 'can_spend'],
            ['/media/designed', 'GET', 'media_designed', 'can_media'],
        ];
        foreach ($routes as $route) {
            list($path, $method, $callback, $permission) = $route;
            register_rest_route(self::NAMESPACE, $path, [
                'methods' => $method,
                'callback' => [__CLASS__, $callback],
                'permission_callback' => [__CLASS__, $permission],
            ]);
        }
    }

    // ── Permissions ────────────────────────────────────────────────────────

    private static function forbidden(): WP_Error {
        return new WP_Error('rest_forbidden', self::FORBIDDEN, ['status' => is_user_logged_in() ? 403 : 401]);
    }

    private static function allow(bool $ok) {
        return $ok ? true : self::forbidden();
    }

    public static function can_read_context($request = null) {
        return self::allow(is_user_logged_in() && current_user_can('edit_posts'));
    }

    public static function can_products($request = null) {
        return self::allow(WebMaven_Store_Caps::for_current_user()['products']);
    }

    public static function can_orders($request = null) {
        return self::allow(WebMaven_Store_Caps::for_current_user()['orders']);
    }

    public static function can_change_orders($request = null) {
        return self::allow(WebMaven_Store_Caps::for_current_user()['orderChanges']);
    }

    public static function can_media($request = null) {
        return self::allow(WebMaven_Store_Caps::for_current_user()['media']);
    }

    public static function can_spend($request = null) {
        return self::allow(WebMaven_Store_Caps::can_spend());
    }

    public static function can_delete_media($request) {
        $id = (int) $request->get_param('id');
        return self::allow(WebMaven_Store_Caps::for_current_user()['media'] && $id > 0 && current_user_can('delete_post', $id));
    }

    public static function can_edit($request) {
        $operation = $request->get_param('operation');
        $refusal = self::operation_refusal(is_array($operation) ? $operation : null);
        return $refusal === null ? true : $refusal;
    }

    public static function can_read_history($request) {
        $refusal = self::ref_refusal((string) $request->get_param('ref'));
        return $refusal === null ? true : $refusal;
    }

    /** The undo route reads the operation first: here, only a user who could edit something. */
    public static function can_undo($request) {
        return self::allow(WebMaven_Store_Caps::store_tier() || WebMaven_Store_Caps::content_tier());
    }

    /**
     * Why the signed-in user may not send this operation (a WP_Error), or
     * null when they may: the tier, then the capability WordPress asks for
     * the object.
     */
    public static function operation_refusal(?array $operation): ?WP_Error {
        if ($operation === null) {
            return new WP_Error('wpmaven_invalid_operation', 'Send one change: an operation with its op.', ['status' => 400]);
        }
        $op = is_string($operation['op'] ?? null) ? $operation['op'] : '';
        $fields = is_array($operation['fields'] ?? null) ? $operation['fields'] : [];
        $publishing = ($fields['status'] ?? null) === 'publish';
        if (in_array($op, self::PRODUCT_OPS, true)) {
            if (!WebMaven_Store_Caps::store_tier() || !WebMaven_Store_Caps::woo_active()) {
                return self::forbidden();
            }
            if ($op === 'add_product') {
                return current_user_can('edit_products') && (!$publishing || current_user_can('publish_products')) ? null : self::forbidden();
            }
            $id = self::positive_int($operation['productId'] ?? null);
            $cap = $op === 'remove_product' ? 'delete_product' : 'edit_product';
            $ok = $id > 0 && current_user_can($cap, $id) && ($op !== 'update_product' || !$publishing || current_user_can('publish_products'));
            return $ok ? null : self::forbidden();
        }
        if (in_array($op, self::POST_OPS, true)) {
            if (!WebMaven_Store_Caps::content_tier()) {
                return self::forbidden();
            }
            if ($op === 'add_post') {
                return current_user_can('edit_posts') && (!$publishing || current_user_can('publish_posts')) ? null : self::forbidden();
            }
            $id = self::positive_int($operation['postId'] ?? null);
            if ($id <= 0) {
                return self::forbidden();
            }
            if ($op === 'remove_post') {
                return current_user_can('delete_post', $id) ? null : self::forbidden();
            }
            return current_user_can('edit_post', $id) && (!$publishing || current_user_can(self::publish_cap($id))) ? null : self::forbidden();
        }
        if ($op === 'replace_image') {
            return self::replace_image_refusal($operation);
        }
        if ($op === 'describe_images') {
            return self::describe_images_refusal($operation);
        }
        return new WP_Error('wpmaven_operation_refused', self::refused_operation_text(), ['status' => 403]);
    }

    /**
     * Descriptions of pictures (1.5.0): someone who may upload and edit the
     * files; WPMaven writing them (write) spends AI time. A picture of the
     * site's design (file) is described on the pages WPMaven designed: someone
     * who may edit other people's pages too.
     */
    private static function describe_images_refusal(array $operation): ?WP_Error {
        if (!WebMaven_Store_Caps::content_tier() || !current_user_can('upload_files')) {
            return self::forbidden();
        }
        if (isset($operation['write'])) {
            return WebMaven_Store_Caps::can_spend() ? null : self::forbidden();
        }
        $items = is_array($operation['items'] ?? null) ? $operation['items'] : [];
        if (!$items) {
            return new WP_Error('wpmaven_invalid_operation', 'Say which pictures to describe.', ['status' => 400]);
        }
        foreach ($items as $item) {
            $item = is_array($item) ? $item : [];
            $has_id = array_key_exists('mediaId', $item) && $item['mediaId'] !== null;
            $file = is_string($item['file'] ?? null) ? $item['file'] : null;
            if (!$has_id && $file === null) {
                return self::forbidden();
            }
            if ($has_id) {
                $id = self::positive_int($item['mediaId']);
                if ($id <= 0 || !current_user_can('edit_post', $id)) {
                    return self::forbidden();
                }
            }
            if ($file !== null && (!preg_match(self::DESIGN_FILE, $file) || !current_user_can('edit_others_pages'))) {
                return self::forbidden();
            }
        }
        return null;
    }

    private static function replace_image_refusal(array $operation): ?WP_Error {
        $target = is_array($operation['target'] ?? null) ? $operation['target'] : [];
        $kind = is_string($target['kind'] ?? null) ? $target['kind'] : '';
        if ($kind === 'section' || !in_array($kind, ['media', 'product', 'variation', 'post', 'site'], true)) {
            return new WP_Error('wpmaven_operation_refused', self::refused_operation_text(), ['status' => 403]);
        }
        $instruction = is_string($operation['instruction'] ?? null) && trim($operation['instruction']) !== '';
        $media = array_key_exists('mediaId', $operation) && $operation['mediaId'] !== null;
        if ($instruction === $media) {
            return new WP_Error('wpmaven_invalid_operation', 'Replace an image with a file from the library or with AI, one of the two.', ['status' => 400]);
        }
        if ($instruction) {
            return WebMaven_Store_Caps::can_spend() ? null : self::forbidden();
        }
        if (!WebMaven_Store_Caps::content_tier() || !current_user_can('upload_files') || self::positive_int($operation['mediaId']) <= 0) {
            return self::forbidden();
        }
        switch ($kind) {
            case 'media':
                $ok = current_user_can('edit_post', self::positive_int($target['mediaId'] ?? null));
                break;
            case 'product':
            case 'variation':
                $ok = WebMaven_Store_Caps::woo_active() && current_user_can('edit_product', self::positive_int($target['productId'] ?? null));
                break;
            case 'post':
                $ok = current_user_can('edit_post', self::positive_int($target['postId'] ?? null));
                break;
            default:
                $ok = current_user_can('manage_options');
        }
        return $ok ? null : self::forbidden();
    }

    /**
     * Why the signed-in user may not read or undo the changes of the object a
     * ref names ("product:31", "variation:45", "post:12", "media:73"), or null.
     * A design ref (a page, a section, the header...) is the owner's.
     */
    public static function ref_refusal(string $ref): ?WP_Error {
        if (!preg_match('/^([a-z_]+)(?::(.{1,200}))?$/', $ref, $m)) {
            return new WP_Error('wpmaven_invalid_ref', 'Name the product, post or file: product:31, post:12 or media:73.', ['status' => 400]);
        }
        $id = isset($m[2]) && ctype_digit($m[2]) ? (int) $m[2] : 0;
        switch ($m[1]) {
            case 'product':
                return WebMaven_Store_Caps::store_tier() && $id > 0 && current_user_can('edit_product', $id) ? null : self::forbidden();
            case 'variation':
                $parent = $id > 0 ? (int) wp_get_post_parent_id($id) : 0;
                return WebMaven_Store_Caps::store_tier() && $parent > 0 && current_user_can('edit_product', $parent) ? null : self::forbidden();
            case 'post':
                return WebMaven_Store_Caps::content_tier() && $id > 0 && current_user_can('edit_post', $id) ? null : self::forbidden();
            case 'media':
                return WebMaven_Store_Caps::content_tier() && $id > 0 && current_user_can('edit_post', $id) ? null : self::forbidden();
        }
        // page:, section:, chrome:, tokens, menu:, facts:, front_page: the design is the owner's.
        return WebMaven_Store_Caps::owner_tier() ? null : self::forbidden();
    }

    private static function publish_cap(int $post_id): string {
        $post = get_post($post_id);
        $type = $post && function_exists('get_post_type_object') ? get_post_type_object($post->post_type) : null;
        return $type && isset($type->cap->publish_posts) ? (string) $type->cap->publish_posts : 'publish_posts';
    }

    // ── Context ────────────────────────────────────────────────────────────

    public static function context($request) {
        // The store's own figures (products, orders to ship, new messages)
        // are for the WordPress users who have a section here: an
        // administrator, a shop manager, an editor (WebMaven_Store_Caps, from
        // capabilities). An Author or a Contributor has none, so reads what
        // they may do (nothing) and none of the figures (1.4.0).
        $caps = WebMaven_Store_Caps::for_current_user();
        $has_section = count(array_filter($caps)) > 0;
        $context = ($has_section && class_exists('WebMaven_Cap_Store_Catalog')) ? WebMaven_Cap_Store_Catalog::context() : [];
        $instance = get_option('webmaven_wp_instance_id', '');
        $instance = is_scalar($instance) && trim((string) $instance) !== '' ? trim((string) $instance) : null;
        return new WP_REST_Response($context + [
            'caps' => $caps,
            'writes' => self::writes($instance),
            'instanceId' => $instance,
            'adminUrl' => admin_url(),
        ], 200);
    }

    /** Whether changes can reach the account: linked, and allowed by the account's site state. */
    private static function writes(?string $instance): array {
        $linked = $instance !== null && (string) get_option('webmaven_wp_access_token', '') !== '';
        if (!$linked) {
            return ['available' => false, 'reason' => 'not_connected'];
        }
        $record = class_exists('WebMaven_Site_State') ? WebMaven_Site_State::current() : null;
        if ($record !== null && empty($record['state']['features']['store'])) {
            return ['available' => false, 'reason' => 'not_allowed'];
        }
        return ['available' => true, 'reason' => null];
    }

    // ── Edits ──────────────────────────────────────────────────────────────

    public static function edit($request) {
        $mode = $request->get_param('mode');
        $mode = $mode === null ? 'publish' : $mode;
        if (!in_array($mode, ['preview', 'publish'], true)) {
            return new WP_Error('wpmaven_invalid_operation', 'mode is preview or publish.', ['status' => 400]);
        }
        $body = [
            'operation' => $request->get_param('operation'),
            'mode' => $mode,
            'source' => 'store',
            'wait' => true,
        ];
        $preview = $request->get_param('previewId');
        if (is_string($preview) && preg_match('/^[A-Za-z0-9_-]{1,120}$/', $preview)) {
            $body['previewId'] = $preview;
        }
        if ($request->get_param('force') === true) {
            $body['force'] = true;
        }
        $key = $request->get_param('idempotencyKey');
        if (is_string($key) && $key !== '' && strlen($key) <= 120) {
            $body['idempotencyKey'] = $key;
        }
        return WebMaven_Store_Forward::to_api('POST', '/edits', $body, null, self::EDIT_TIMEOUT);
    }

    public static function history($request) {
        $limit = (int) $request->get_param('limit');
        $limit = $limit > 0 ? min($limit, 50) : 20;
        return WebMaven_Store_Forward::to_api('GET', '/edits', null, ['ref' => (string) $request->get_param('ref'), 'limit' => $limit]);
    }

    public static function undo($request) {
        $operation = (string) $request->get_param('operation');
        $read = WebMaven_Store_Forward::to_api('GET', '/edits/' . rawurlencode($operation));
        if (is_wp_error($read) || $read->get_status() >= 300) {
            return $read;
        }
        $refusal = self::undo_refusal((array) $read->get_data());
        if ($refusal !== null) {
            return $refusal;
        }
        $mode = $request->get_param('mode');
        $body = ['mode' => $mode === 'preview' ? 'preview' : 'publish', 'wait' => true];
        $preview = $request->get_param('previewId');
        if (is_string($preview) && preg_match('/^[A-Za-z0-9_-]{1,120}$/', $preview)) {
            $body['previewId'] = $preview;
        }
        if ($request->get_param('force') === true) {
            $body['force'] = true;
        }
        return WebMaven_Store_Forward::to_api('POST', '/edits/' . rawurlencode($operation) . '/undo', $body, null, self::EDIT_TIMEOUT);
    }

    /** The operation is one of the Store's, and the user may change every object it changed. */
    private static function undo_refusal(array $result): ?WP_Error {
        $kind = is_string($result['kind'] ?? null) ? $result['kind'] : '';
        if (!in_array($kind, array_merge(self::PRODUCT_OPS, self::POST_OPS, ['replace_image']), true)) {
            return new WP_Error('wpmaven_operation_refused', self::refused_operation_text(), ['status' => 403]);
        }
        $refs = [];
        foreach ((array) ($result['changed'] ?? []) as $change) {
            if (is_array($change) && is_string($change['ref'] ?? null)) {
                $refs[] = $change['ref'];
            }
        }
        if (!$refs) {
            if (in_array($kind, self::PRODUCT_OPS, true)) {
                return WebMaven_Store_Caps::store_tier() && current_user_can('edit_products') ? null : self::forbidden();
            }
            if (in_array($kind, self::POST_OPS, true)) {
                return WebMaven_Store_Caps::content_tier() && current_user_can('edit_posts') ? null : self::forbidden();
            }
            return WebMaven_Store_Caps::content_tier() && current_user_can('upload_files') ? null : self::forbidden();
        }
        foreach ($refs as $ref) {
            $refusal = self::ref_refusal($ref);
            if ($refusal !== null) {
                return $refusal;
            }
        }
        return null;
    }

    // ── Printed products ───────────────────────────────────────────────────

    public static function pricing($request) {
        return WebMaven_Store_Forward::to_api('GET', '/store/products/' . (int) $request->get_param('id') . '/pricing');
    }

    public static function redesign_available($request) {
        return WebMaven_Store_Forward::to_api('GET', '/products/redesign-available');
    }

    public static function redesign($request) {
        $id = (int) $request->get_param('id');
        $key = class_exists('WebMaven_Store_Rest_Filters') ? WebMaven_Store_Rest_Filters::design_key($id) : null;
        if ($key === null || get_post_type($id) !== 'product') {
            $brand = self::brand_name();
            return new WP_Error('wpmaven_no_design', $brand !== ''
                ? $brand . ' did not design this product, so it has no design to redo.'
                : 'This product has no design to redo.', ['status' => 409]);
        }
        return WebMaven_Store_Forward::to_api('POST', '/products/' . rawurlencode($key) . '/redesign', []);
    }

    public static function redesign_job($request) {
        return WebMaven_Store_Forward::to_api('GET', '/products/redesign/' . rawurlencode((string) $request->get_param('job')));
    }

    /**
     * Marks an order shipped with the parcel the owner sent (carrier,
     * tracking number, link): Completed when the order may be, and the
     * tracking emailed to the customer as a note unless notify is false
     * (which also holds back WooCommerce's completed email). An order whose
     * printed products are not shipped yet keeps its status and gets the
     * note only.
     */
    public static function shipment($request) {
        if (!class_exists('WebMaven_Cap_Store_Orders')) {
            return new WP_Error('wm_store_unavailable', WebMaven_Store_Forward::failed_text(), ['status' => 409]);
        }
        $id = (int) $request->get_param('id');
        $order = function_exists('wc_get_order') ? wc_get_order($id) : null;
        if (!$order) {
            return new WP_Error('wm_not_found', 'This order is no longer in your store.', ['status' => 404]);
        }
        $body = (array) $request->get_json_params();
        $params = [
            'order_id' => $id,
            'shipment' => [
                'carrier' => is_string($body['carrier'] ?? null) ? $body['carrier'] : '',
                'number' => is_string($body['number'] ?? null) ? $body['number'] : '',
                'url' => is_string($body['url'] ?? null) ? $body['url'] : '',
            ],
            'notify' => !array_key_exists('notify', $body) || $body['notify'] !== false,
        ];
        if (in_array('completed', WebMaven_Pod_Guards::allowed_statuses($order), true)) {
            $params['status'] = 'completed';
        }
        try {
            return new WP_REST_Response(WebMaven_Cap_Store_Orders::order_update($params), 200);
        } catch (Exception $e) {
            $parsed = preg_match('/^([A-Z_]+):\s*(.*)$/s', $e->getMessage(), $m) ? [$m[1], $m[2]] : ['WRITE_FAILED', WebMaven_Store_Forward::failed_text()];
            return new WP_Error('wm_' . strtolower($parsed[0]), $parsed[1], ['status' => $parsed[0] === 'VALIDATION' ? 400 : 409]);
        }
    }

    public static function payments_orders($request) {
        $ids = self::ids($request->get_param('ids'), self::MAX_ORDER_IDS);
        if (!$ids) {
            return new WP_REST_Response(['orders' => []], 200);
        }
        return WebMaven_Store_Forward::to_api('GET', '/payments/wpmaven/orders', null, ['orderIds' => implode(',', $ids)]);
    }

    // ── Media ──────────────────────────────────────────────────────────────

    public static function media_usage($request) {
        $ids = self::ids($request->get_param('ids'), self::MAX_USAGE_IDS);
        $answer = WebMaven_Media_Usage::uses($ids);
        $answer['uses'] = (object) $answer['uses'];
        return new WP_REST_Response($answer, 200);
    }

    public static function media_delete($request) {
        $id = (int) $request->get_param('id');
        $post = get_post($id);
        if (!$post || $post->post_type !== 'attachment') {
            return new WP_Error('rest_not_found', 'This file is not in the media library.', ['status' => 404]);
        }
        $uses = WebMaven_Media_Usage::fresh_uses([$id])['uses'][$id] ?? [];
        if ($uses) {
            return new WP_Error('in_use', WebMaven_Media_Usage::in_use_sentence($id, count($uses)), ['status' => 409, 'uses' => $uses]);
        }
        if (!wp_delete_attachment($id, true)) {
            return new WP_Error('wpmaven_delete_failed', 'WordPress could not delete this file. Try again.', ['status' => 500]);
        }
        return new WP_REST_Response(['deleted' => true], 200);
    }

    /**
     * The pictures of the site's design WPMaven built (its pages' sections, its
     * header and footer), with where the site shows them: the API reads them
     * from the design.
     */
    public static function media_designed($request) {
        $missing = self::flag_param($request->get_param('missing'));
        return WebMaven_Store_Forward::to_api('GET', '/media/designed', null, $missing ? ['missing' => 'true'] : null);
    }

    /**
     * Descriptions written by AI: library files (ids) are read here and sent,
     * pictures of the site's design (files) are read by the API from the
     * design. At most 10 pictures at a time.
     */
    public static function alt_text($request) {
        $ids = self::ids($request->get_param('ids'), PHP_INT_MAX);
        $files = self::design_files($request->get_param('files'));
        if ($files === null) {
            return new WP_Error('wpmaven_invalid_files', 'A picture of the design is named by its file, like hero-photo.png.', ['status' => 400]);
        }
        $count = count($ids) + count($files);
        if ($count === 0 || $count > self::MAX_ALT_TEXT) {
            return new WP_Error('wpmaven_invalid_ids', 'Send 1 to ' . self::MAX_ALT_TEXT . ' images at a time.', ['status' => 400]);
        }
        $images = [];
        foreach ($ids as $id) {
            $file = WebMaven_Media_Usage::readable_file($id);
            $bytes = $file ? @file_get_contents($file['path']) : false;
            if ($bytes === false || $bytes === '') {
                $brand = self::brand_name();
                return new WP_Error('wpmaven_unreadable_image', ($brand !== ''
                    ? $brand . ' reads JPEG, PNG, GIF and WebP pictures from the media library.'
                    : 'Only JPEG, PNG, GIF and WebP pictures from the media library can be read.') . ' File ' . $id . ' is not one of them.', ['status' => 400]);
            }
            $images[] = ['mediaId' => $id, 'base64' => base64_encode($bytes), 'mime' => $file['mime']];
        }
        foreach ($files as $design_file) {
            $images[] = ['file' => $design_file];
        }
        return WebMaven_Store_Forward::to_api('POST', '/media/alt-text', ['images' => $images], null, 120);
    }

    /** A picture file of the design, as the API names it. */
    const DESIGN_FILE = '/^[a-z0-9][a-z0-9-]*\.(png|jpe?g|webp|svg)$/i';

    /** The design's picture files of a request (none when absent), or null when one is not a file name. */
    private static function design_files($raw): ?array {
        if ($raw === null || $raw === '' || $raw === []) {
            return [];
        }
        $list = is_array($raw) ? $raw : explode(',', (string) $raw);
        $out = [];
        foreach ($list as $f) {
            $f = is_string($f) ? trim($f) : '';
            if ($f === '' || strlen($f) > 120 || !preg_match(self::DESIGN_FILE, $f)) {
                return null;
            }
            $out[$f] = true;
        }
        return array_keys($out);
    }

    private static function flag_param($raw): bool {
        return $raw === true || $raw === 1 || $raw === '1' || $raw === 'true';
    }

    // ── The app's script data ──────────────────────────────────────────────

    /** WEBMAVEN_WP_DATA.storeApp, before the app's script (no edit to the admin class). */
    public static function script_data(): void {
        if (!function_exists('wp_script_is') || !wp_script_is('webmaven-dashboard', 'enqueued')) {
            return;
        }
        wp_add_inline_script(
            'webmaven-dashboard',
            'window.WEBMAVEN_WP_DATA=window.WEBMAVEN_WP_DATA||{};window.WEBMAVEN_WP_DATA.storeApp=' . wp_json_encode(self::app_data()) . ';',
            'before'
        );
    }

    /** StoreAppData. */
    public static function app_data(): array {
        $woo = WebMaven_Store_Caps::woo_active();
        $catalog = class_exists('WebMaven_Cap_Store_Catalog');
        return [
            'caps' => WebMaven_Store_Caps::for_current_user(),
            'wooActive' => $woo,
            'money' => $woo && $catalog ? WebMaven_Cap_Store_Catalog::money_format() : null,
            'paymentsWpmaven' => class_exists('WebMaven_Payments') && WebMaven_Payments::enabled(),
            'wpRestRoot' => esc_url_raw(rest_url()),
            'uploads' => ['maxBytes' => (int) wp_max_upload_size()],
            'units' => $woo && $catalog ? WebMaven_Cap_Store_Catalog::units() : null,
            'mail' => $catalog ? WebMaven_Cap_Store_Catalog::mail_mode() : 'site',
        ];
    }

    // ── Values ─────────────────────────────────────────────────────────────

    /** "1,2,3" or [1, 2, 3] as positive ids, at most $max, in order, without repeats. */
    private static function ids($raw, int $max): array {
        $parts = is_array($raw) ? $raw : explode(',', (string) $raw);
        $out = [];
        foreach ($parts as $part) {
            $id = self::positive_int(is_string($part) ? trim($part) : $part);
            if ($id > 0) {
                $out[$id] = $id;
            }
            if (count($out) >= $max) {
                break;
            }
        }
        return array_values($out);
    }

    private static function positive_int($value): int {
        if (is_int($value)) {
            return $value > 0 ? $value : 0;
        }
        if (is_string($value) && preg_match('/^\d{1,18}$/', $value)) {
            return (int) $value;
        }
        return 0;
    }
}
