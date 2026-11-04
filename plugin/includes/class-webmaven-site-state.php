<?php
/**
 * What this site's business is, as the account says (2026-10-05).
 *
 * The plugin used to decide from a local option nothing wrote on a connected
 * site (webmaven_wp_onboarding_completed): it asked owners to set up a
 * business that existed, and the option survived a relink, a reinstall and a
 * database copy. The account answers instead: GET /sites/me (the site's own
 * token) is the site state, and this class keeps it.
 *
 *   onboardingCompleted  the site has a business (the API's one rule)
 *   onboardingSkipped    the owner chose "Continue in WordPress" (recorded
 *                        on the account by POST /sites/me/onboarding-skip)
 *   draft, lastPublish   the business that can still go live here, and the
 *                        last publish onto the site
 *   links, next          where the owner's next step is, on the brand's own
 *                        dashboard address under White label
 *   features             what the WP-admin app may show, per surface; a
 *                        surface whose flag is false makes no call at all
 *   stateVersion         bumped by the API each time the content changes
 *
 * The answer is a cache, bound to the instance id, the site's identity (the
 * WP_HOME constant when defined, else the home option: the edge host swaps
 * home per request on hosted custom domains) and the plugin version. Any
 * mismatch reads as "no state", and no state never blocks the owner: the app
 * opens and the next read decides. A WPMaven-hosted site has a business by
 * construction (its own deploy), so it never needs setup, state or not.
 *
 * Reads: the connection check (/status, at most every 5 minutes, 1 minute
 * after a failure), the site_state push (capabilities/site-state.php, when
 * the account changed), the first WP-admin view after an administrator signs
 * in, and /status?refresh=1 (at most every 30 seconds). Never a token
 * refresh: a read never rotates the site's token.
 *
 * Every value is copied through a whitelist: strings cleaned, booleans cast,
 * unknown keys dropped, the dashboard address accepted when https (or the
 * configured dashboard's own origin, for local development), and a link only
 * when it is on that address.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-webmaven-log.php';

require_once __DIR__ . '/class-webmaven-hosting.php';

final class WebMaven_Site_State {

    /** The stored answer (autoloaded: the admin menu and the admin bar read it). */
    const OPTION = 'webmaven_wp_site_state';
    /** Set while the stored answer is fresh. */
    const FRESH = 'webmaven_wp_site_state_fresh';
    /** One read at a time for the whole site (the push). */
    const LOCK = 'webmaven_wp_site_state_lock';
    /** /status?refresh=1 reads at most once in REFRESH_SECONDS. */
    const REFRESH_LOCK = 'webmaven_wp_site_state_refresh';
    /** The option this class replaces; deleted once, written by nothing. */
    const LEGACY_FLAG = 'webmaven_wp_onboarding_completed';

    const FRESH_SECONDS = 300;
    const RETRY_SECONDS = 60;
    const REFRESH_SECONDS = 30;
    const LOCK_SECONDS = 30;
    /** Seconds a read may take (the push answers within the API's 15). */
    const READ_TIMEOUT = 8;
    const VERSION_MAX = 2147483647;

    /** The surfaces the API flags. */
    const FEATURES = [
        'chat', 'editorAI', 'edits', 'store',
        'reports', 'notifications', 'tasks', 'analytics',
        'finance', 'payments', 'social', 'approvals',
        'parity', 'health', 'activity',
        // The screens shared with the dashboard (1.7.0): Waiting for you with
        // every kind of approval, the store changes the team prepared, the
        // alerts worth fixing, the customers to answer, and Your team with
        // the business's whole plan.
        'approvalsAll', 'storeApprovals', 'alerts', 'customerReplies', 'teamPlan',
        // Overview's side column, the dashboard Home's right column (1.7.0):
        // the site's screenshot, Turn on a way to get paid, Check what your
        // site says about you, the referral link a share carries, and Feature
        // on WPMaven.
        'sitePreview', 'getPaid', 'businessDetails', 'referrals', 'featureOnWpmaven',
        // The actions behind some of the chat's suggestions: a suggestion
        // shows only when its action works for this site.
        'campaigns', 'seoAudit', 'altText', 'pageRedesign',
        // The editor's chat led by the Web Designer, who asks the Co-CEO
        // when it needs to (1.8.0; off again with the server's switch).
        'editorDesigner',
        // The editor's Search panel makes a picture for sharing a page (1.8.0).
        'shareImage',
        // The editor's Add a page shows its More options: the page it goes
        // under, published or a draft, a page to look like, its search
        // details (1.8.0).
        'addPageOptions',
    ];

    const TEXT_MAX = 200;
    const PROBLEMS_MAX = 10;

    /** WPMaven Agent's main file, as WordPress names an active plugin. */
    const AGENT_PLUGIN = 'wpmaven-agent/wpmaven-agent.php';
    /** Set when WPMaven Agent was just activated: its notice follows the account closely for a while. */
    const AGENT_ACTIVATED = 'webmaven_wp_agent_activated';
    const AGENT_ACTIVATED_SECONDS = 900;
    /**
     * Set with Agent's activation (2026-10-26): the next admin page goes to
     * WPMaven's own screen once, where the business's progress shows. The
     * administrator who activated it, never on a bulk or network activation.
     */
    const AGENT_REDIRECT = 'webmaven_wp_agent_redirect';
    const AGENT_REDIRECT_SECONDS = 60;
    /** One fresh read of the account at most every few seconds for Agent's notice. */
    const AGENT_STATUS_SLOT = 'webmaven_wp_agent_status_slot';
    const AGENT_STATUS_SECONDS = 5;

    /** current() for this request: the record and the key it was worked out from. */
    private static $memo = null;
    private static $memo_key = null;

    public static function init() {
        // A new link, a relink to another business, a sign-out: nothing
        // stored about the previous business survives (activation, the OAuth
        // callback, the provisioner and the logout write this option).
        add_action('add_option_webmaven_wp_instance_id', [__CLASS__, 'forget'], 10, 0);
        add_action('update_option_webmaven_wp_instance_id', [__CLASS__, 'forget'], 10, 0);
        add_action('delete_option_webmaven_wp_instance_id', [__CLASS__, 'forget'], 10, 0);
        // An administrator who signs in reads the state on their first view.
        add_action('wp_login', [__CLASS__, 'on_login'], 10, 2);
        // The option the account replaces goes, once (updates run no activation hook).
        add_action('init', [__CLASS__, 'retire_legacy_flag'], 20);
        // WPMaven Agent activated: the account is told once WordPress saved
        // the active plugins (activated_plugin), so the site it asks back
        // already runs Agent.
        add_action('activated_plugin', [__CLASS__, 'on_plugin_activated'], 10, 1);
        add_action('admin_init', [__CLASS__, 'redirect_after_agent'], 1);
    }

    // ── WPMaven Agent ──────────────────────────────────────────────────────

    /**
     * WPMaven Agent was activated on this connected site: the account is told
     * (POST /sites/me/edition). It asks the site which edition runs, never
     * taking this call's word, and publishes the business the owner said to
     * publish here once Agent is active (their go-ahead, an hour).
     */
    public static function on_plugin_activated($plugin) {
        if ($plugin !== self::AGENT_PLUGIN || self::instance_id() === '') {
            return;
        }
        set_transient(self::AGENT_ACTIVATED, time(), self::AGENT_ACTIVATED_SECONDS);
        delete_transient(self::FRESH);
        // One plugin activated on its own (not "Activate" on several at once).
        // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read only, to leave a bulk activation alone
        $bulk = isset($_REQUEST['checked']) || isset($_GET['activate-multi']);
        if (!$bulk && !is_network_admin() && function_exists('get_current_user_id') && get_current_user_id() > 0) {
            set_transient(self::AGENT_REDIRECT, get_current_user_id(), self::AGENT_REDIRECT_SECONDS);
        }
        self::edition_changed();
    }

    /** Right after Agent's activation, the next admin page is WPMaven's screen, once. */
    public static function redirect_after_agent() {
        $user = (int) get_transient(self::AGENT_REDIRECT);
        if ($user <= 0) {
            return;
        }
        if (wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST) || is_network_admin()) {
            return;
        }
        if ($user !== get_current_user_id() || !current_user_can('activate_plugins')) {
            return;
        }
        delete_transient(self::AGENT_REDIRECT);
        // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read only
        if (isset($_GET['activate-multi'])) {
            return;
        }
        wp_safe_redirect(admin_url('admin.php?page=webmaven-dashboard&agent=activated'));
        exit;
    }

    /** POST /sites/me/edition. Answers make_request's result. */
    public static function edition_changed() {
        if (!class_exists('WebMaven_WP_API_Client')) {
            return ['success' => false, 'status_code' => 0, 'error' => 'No API client'];
        }
        $client = new WebMaven_WP_API_Client();
        if (!$client->is_configured()) {
            return ['success' => false, 'status_code' => 0, 'error' => 'Not connected'];
        }
        $response = $client->make_request('/sites/me/edition', 'POST', null, null, self::READ_TIMEOUT, 0);
        if (empty($response['success'])) {
            WebMaven_Log::write('WebMaven WordPress: WPMaven Agent\'s activation was not told to WPMaven (HTTP ' . (int) ($response['status_code'] ?? 0) . ')');
        }
        return $response;
    }

    /** POST /sites/me/publish-waiting: WPMaven Agent's "Put <business> on my site". Answers make_request's result. */
    public static function publish_waiting() {
        if (!class_exists('WebMaven_WP_API_Client')) {
            return ['success' => false, 'status_code' => 0, 'error' => 'No API client'];
        }
        $client = new WebMaven_WP_API_Client();
        // An owner's click may refresh an expired token (retry count 0).
        return $client->make_request('/sites/me/publish-waiting', 'POST', null, null, self::READ_TIMEOUT, 0);
    }

    /**
     * What WPMaven Agent's notice says, from the account's word (pure on the
     * stored state):
     *   checking    Agent was just activated and the account has not said yet
     *   publishing  the owner's business is going onto this site now
     *   live        it is live here
     *   waiting     a saved business can go on this site ("Put <name> on my site")
     *   stopped     the last publish onto this site stopped short
     *   active      nothing waits
     *
     * @param array|null $state a stored state (self::current()['state'])
     * @param bool $just_activated Agent was activated in the last minutes
     */
    public static function agent_notice_of($state, $just_activated = false) {
        $state = is_array($state) ? $state : null;
        $draft = $state['draft'] ?? null;
        $last = $state['lastPublish'] ?? null;
        $business = $state['business'] ?? null;
        $name = is_array($draft) ? (string) $draft['name'] : (is_array($business) ? (string) ($business['name'] ?? '') : '');
        $status = 'active';
        if (is_array($draft) && !empty($draft['publishingHere'])) {
            $status = 'publishing';
        } elseif (!empty($state['onboardingCompleted']) && is_array($last) && ($last['state'] ?? '') === 'complete') {
            $status = 'live';
        } elseif (is_array($draft)) {
            $status = is_array($last) && in_array($last['state'] ?? '', ['blocked', 'failed', 'partial'], true) && !$just_activated ? 'stopped' : 'waiting';
        } elseif ($just_activated && !$state) {
            $status = 'checking';
        }
        return [
            'status' => $status,
            'name' => $name !== '' ? $name : null,
            'dashboard' => is_array($state) ? ($state['links']['publish'] ?? $state['links']['business'] ?? null) : null,
        ];
    }

    /** The notice's state now, read fresh from the account at most every few seconds. */
    public static function agent_notice($fresh = false) {
        if ($fresh && !get_transient(self::AGENT_STATUS_SLOT)) {
            set_transient(self::AGENT_STATUS_SLOT, 1, self::AGENT_STATUS_SECONDS);
            self::refresh('agent', 6);
        }
        $record = self::current();
        $just = (bool) get_transient(self::AGENT_ACTIVATED);
        $notice = self::agent_notice_of($record['state'] ?? null, $just);
        // Just activated: the account may still be starting the publish.
        if ($just && $notice['status'] === 'waiting' && (time() - (int) get_transient(self::AGENT_ACTIVATED)) < 20) {
            $notice['status'] = 'checking';
        }
        return $notice;
    }

    /** GET webmaven_wp/v1/agent/status: what WPMaven Agent's notice says now. */
    public static function agent_status_route() {
        return new \WP_REST_Response(['success' => true, 'agent' => self::agent_notice(true)]);
    }

    /** POST webmaven_wp/v1/agent/publish: "Put <business> on my site". */
    public static function agent_publish_route() {
        $api_client = new WebMaven_WP_API_Client();
        if (!$api_client->is_configured()) {
            return webmaven_wp_not_connected_response();
        }
        $response = self::publish_waiting();
        if (empty($response['success'])) {
            $status = (int) ($response['status_code'] ?? 0);
            return new \WP_REST_Response([
                'success' => false,
                'code' => is_string($response['code'] ?? null) ? $response['code'] : 'wpmaven_publish_not_started',
                'error' => is_string($response['error'] ?? null) && $response['error'] !== ''
                    ? $response['error']
                    : 'WPMaven did not answer, so nothing started. Try again in a minute.',
            ], $status >= 400 && $status < 500 ? $status : 502);
        }
        delete_transient(self::AGENT_STATUS_SLOT);
        return new \WP_REST_Response(['success' => true, 'agent' => self::agent_notice(true)]);
    }

    // ── Binding ────────────────────────────────────────────────────────────

    /** The site's identity: WP_HOME when defined, else the home option; lowercase, no trailing slash. */
    public static function identity() {
        $home = defined('WP_HOME') && WP_HOME ? WP_HOME : get_option('home', '');
        return rtrim(strtolower(trim((string) $home)), '/');
    }

    private static function plugin_version() {
        return defined('WEBMAVEN_WP_VERSION') ? (string) WEBMAVEN_WP_VERSION : '';
    }

    private static function instance_id() {
        $id = get_option('webmaven_wp_instance_id', '');
        return is_scalar($id) ? (string) $id : '';
    }

    /**
     * The stored answer when it is bound to this site as it is now (instance
     * id, identity, plugin version), cleaned again, or null.
     *
     * @return array|null {instance_id, identity, plugin_version, read_at, version, state}
     */
    public static function current() {
        $raw = get_option(self::OPTION, null);
        if (!is_array($raw) || !isset($raw['state']) || !is_array($raw['state'])) {
            return null;
        }
        $key = md5(serialize([$raw, self::instance_id(), self::identity(), self::plugin_version()]));
        if (self::$memo_key === $key) {
            return self::$memo;
        }
        self::$memo_key = $key;
        self::$memo = self::bound($raw);
        return self::$memo;
    }

    /** The stored record when it is bound to this site, cleaned again, or null. */
    private static function bound(array $raw) {
        $instance_id = self::instance_id();
        if ($instance_id === '' || !is_string($raw['instance_id'] ?? null) || !hash_equals($instance_id, $raw['instance_id'])) {
            return null;
        }
        if (($raw['identity'] ?? null) !== self::identity() || ($raw['plugin_version'] ?? null) !== self::plugin_version()) {
            return null;
        }
        $state = self::clean_state($raw['state']);
        if ($state === null || $state['instance']['id'] !== $instance_id) {
            return null;
        }
        return [
            'instance_id' => $instance_id,
            'identity' => $raw['identity'],
            'plugin_version' => $raw['plugin_version'],
            'read_at' => (int) ($raw['read_at'] ?? 0),
            'version' => $state['stateVersion'],
            'state' => $state,
        ];
    }

    /** True while the stored answer is bound and was read recently. */
    public static function is_fresh() {
        return (bool) get_transient(self::FRESH) && self::current() !== null;
    }

    // ── Reads ──────────────────────────────────────────────────────────────

    /**
     * One read of GET /sites/me; a successful answer is stored. Answers
     * make_request's result (success, data, status_code, error), which the
     * connection check maps to its verdict.
     *
     * @param string $reason  'status', 'push', 'login' or 'refresh' (logs only)
     * @param int    $timeout seconds
     * @param WebMaven_WP_API_Client|null $client the caller's client (the connection check reuses its own)
     */
    public static function refresh($reason = 'status', $timeout = self::READ_TIMEOUT, $client = null) {
        if (!class_exists('WebMaven_WP_API_Client')) {
            return ['success' => false, 'status_code' => 0, 'error' => 'No API client'];
        }
        $client = $client ?: new WebMaven_WP_API_Client();
        $response = $client->check_site_connection((int) $timeout);
        if (!empty($response['success']) && isset($response['data']) && is_array($response['data']) && self::store($response['data'])) {
            return $response;
        }
        if (empty($response['success'])) {
            // Not again for a minute: the stored answer stands meanwhile.
            self::set_transient_unless_guarded(self::FRESH, 1, self::RETRY_SECONDS);
            WebMaven_Log::write('WebMaven WordPress: site state read failed (' . preg_replace('/[^a-z_]/', '', (string) $reason) . ', HTTP ' . (int) ($response['status_code'] ?? 0) . ')');
        }
        return $response;
    }

    /**
     * Keep an answer when it is a site state for this site. Never inside a
     * call WPMaven guards with a before/after check (the next ordinary
     * request reads again).
     */
    public static function store($data) {
        if (class_exists('WebMaven_Self_Protect') && WebMaven_Self_Protect::in_guarded_call()) {
            return false;
        }
        $state = self::clean_state($data);
        $instance_id = self::instance_id();
        if ($state === null || $instance_id === '' || $state['instance']['id'] !== $instance_id) {
            return false;
        }
        update_option(self::OPTION, [
            'instance_id' => $instance_id,
            'identity' => self::identity(),
            'plugin_version' => self::plugin_version(),
            'read_at' => time(),
            'version' => $state['stateVersion'],
            'state' => $state,
        ], true);
        set_transient(self::FRESH, 1, self::FRESH_SECONDS);
        return true;
    }

    /**
     * The site_state push (capabilities/site-state.php): the account changed.
     * A version at or below the one held is already known; a newer one is
     * read now, one read at a time. A failed read still answers received
     * (the next WP-admin view reads).
     */
    public static function on_push(array $params) {
        $raw = $params['stateVersion'] ?? null;
        if (!(is_int($raw) || (is_string($raw) && preg_match('/^\d{1,10}$/', $raw)))
            || (int) $raw < 0 || (int) $raw > self::VERSION_MAX) {
            return ['success' => false, 'error' => 'stateVersion must be a whole number from 0 to 2147483647.'];
        }
        $version = (int) $raw;
        $current = self::current();
        $held = $current ? (int) $current['version'] : -1;
        if ($current !== null && $version <= $held) {
            return ['received' => true, 'version' => $held, 'read' => false];
        }
        delete_transient(self::FRESH);
        if (get_transient(self::LOCK)) {
            return ['received' => true, 'version' => max($held, 0), 'read' => false];
        }
        set_transient(self::LOCK, 1, self::LOCK_SECONDS);
        try {
            $response = self::refresh('push', self::READ_TIMEOUT);
        } finally {
            delete_transient(self::LOCK);
        }
        $after = self::current();
        return [
            'received' => true,
            'version' => $after ? (int) $after['version'] : max($held, 0),
            'read' => !empty($response['success']) && $after !== null,
        ];
    }

    /**
     * "Continue in WordPress": recorded on the account (POST
     * /sites/me/onboarding-skip), which answers the fresh state. Answers
     * make_request's result.
     */
    public static function record_skip() {
        if (!class_exists('WebMaven_WP_API_Client')) {
            return ['success' => false, 'status_code' => 0, 'error' => 'No API client'];
        }
        $client = new WebMaven_WP_API_Client();
        // An owner's click may refresh an expired token (retry count 0).
        $response = $client->make_request('/sites/me/onboarding-skip', 'POST', null, null, self::READ_TIMEOUT, 0);
        if (!empty($response['success']) && isset($response['data']) && is_array($response['data'])) {
            self::store($response['data']);
        }
        return $response;
    }

    /**
     * POST webmaven_wp/v1/setup/skip, "Continue in WordPress" on the setup
     * card and in the setup wizard.
     *
     * @param callable $permission the plugin's administrator gate (current_user_can_reach_api)
     */
    public static function register_routes($permission) {
        register_rest_route('webmaven_wp/v1', '/setup/skip', [
            'methods' => 'POST',
            'permission_callback' => $permission,
            'callback' => [__CLASS__, 'skip_route'],
        ]);
        // WPMaven Agent's notice: what it says now, and "Put <business> on my site".
        register_rest_route('webmaven_wp/v1', '/agent/status', [
            'methods' => 'GET',
            'permission_callback' => $permission,
            'callback' => [__CLASS__, 'agent_status_route'],
        ]);
        register_rest_route('webmaven_wp/v1', '/agent/publish', [
            'methods' => 'POST',
            'permission_callback' => $permission,
            'callback' => [__CLASS__, 'agent_publish_route'],
        ]);
        // The owner's names for the required step (GET and PUT /sites/me/owner).
        register_rest_route('webmaven_wp/v1', '/owner', [
            [
                'methods' => 'GET',
                'permission_callback' => $permission,
                'callback' => [__CLASS__, 'owner_read_route'],
            ],
            [
                'methods' => 'PUT',
                'permission_callback' => $permission,
                'callback' => [__CLASS__, 'owner_save_route'],
            ],
        ]);
    }

    /**
     * GET webmaven_wp/v1/owner: the account holder's names and, when they are
     * not set, the checkout's name to suggest (never an email or an address).
     */
    public static function owner_read_route() {
        $api_client = new WebMaven_WP_API_Client();
        if (!$api_client->is_configured()) {
            return webmaven_wp_not_connected_response();
        }
        $response = $api_client->make_request('/sites/me/owner', 'GET', null, null, self::READ_TIMEOUT, 1);
        if (empty($response['success']) || !is_array($response['data'] ?? null)) {
            return new \WP_REST_Response(['success' => false, 'error' => 'WPMaven did not answer.'], 502);
        }
        return new \WP_REST_Response(['success' => true, 'data' => self::clean_owner($response['data'])]);
    }

    /** PUT webmaven_wp/v1/owner: the owner's first and last name, saved on the account. */
    public static function owner_save_route($request) {
        $api_client = new WebMaven_WP_API_Client();
        if (!$api_client->is_configured()) {
            return webmaven_wp_not_connected_response();
        }
        $body = [
            'firstName' => self::text(is_object($request) && method_exists($request, 'get_param') ? $request->get_param('firstName') : null, 60) ?? '',
            'lastName' => self::text(is_object($request) && method_exists($request, 'get_param') ? $request->get_param('lastName') : null, 60) ?? '',
        ];
        $response = $api_client->make_request('/sites/me/owner', 'PUT', $body, null, self::READ_TIMEOUT, 0);
        if (empty($response['success'])) {
            $status = (int) ($response['status_code'] ?? 0);
            return new \WP_REST_Response([
                'success' => false,
                'error' => is_string($response['error'] ?? null) && $response['error'] !== '' ? $response['error'] : 'Your name was not saved. Try again.',
            ], $status === 400 ? 400 : 502);
        }
        // The account's name is in the site state too (the account button).
        delete_transient(self::FRESH);
        return new \WP_REST_Response(['success' => true, 'data' => self::clean_owner($response['data'] ?? [])]);
    }

    /** The owner answer through the whitelist: names and the names to suggest, nothing else. */
    private static function clean_owner($raw) {
        $raw = is_array($raw) ? $raw : [];
        $suggested = is_array($raw['suggested'] ?? null) ? $raw['suggested'] : [];
        return [
            'firstName' => self::text($raw['firstName'] ?? null, 60),
            'lastName' => self::text($raw['lastName'] ?? null, 60),
            'named' => ($raw['named'] ?? false) === true,
            'suggested' => [
                'firstName' => self::text($suggested['firstName'] ?? null, 60),
                'lastName' => self::text($suggested['lastName'] ?? null, 60),
            ],
        ];
    }

    /**
     * "Continue in WordPress": recorded on the account (record_skip), never
     * on the site, so a relink, a reinstall or a copy of the site cannot
     * carry it. When WPMaven does not answer, nothing is recorded and the
     * screen says so (502).
     */
    public static function skip_route() {
        $api_client = new WebMaven_WP_API_Client();
        if (!$api_client->is_configured()) {
            return webmaven_wp_not_connected_response();
        }
        $response = self::record_skip();
        if (empty($response['success'])) {
            return new \WP_REST_Response([
                'success' => false,
                'code' => 'wpmaven_skip_not_saved',
                'error' => is_string($response['error'] ?? null) && $response['error'] !== ''
                    ? $response['error']
                    : 'WPMaven did not answer, so your choice was not saved.',
            ], 502);
        }
        return new \WP_REST_Response([
            'success' => true,
            'onboarding' => self::onboarding(),
            'setup_needed' => self::setup_needed(),
            'site_state' => self::for_script(true),
        ]);
    }

    /**
     * The state for an administrator's page: when none is bound to this site
     * and this plugin version (the plugin was just updated, or the site just
     * connected), read the account once, within a short budget, so the page
     * shows what the account turned on (the chat, AI editing) instead of the
     * dashboard card until the next load. One read at a time (the refresh
     * slot); a failed read leaves the page as it was.
     */
    public static function ensure_current($timeout = 4) {
        if (self::current() !== null || self::instance_id() === '' || !self::take_refresh_slot()) {
            return self::current();
        }
        self::refresh('page', $timeout);
        return self::current();
    }

    /** /status?refresh=1: true when this caller may read now (at most once in REFRESH_SECONDS). */
    public static function take_refresh_slot() {
        if (get_transient(self::REFRESH_LOCK)) {
            return false;
        }
        set_transient(self::REFRESH_LOCK, 1, self::REFRESH_SECONDS);
        return true;
    }

    /** wp_login: an administrator's first view after signing in reads the state. */
    public static function on_login($user_login = '', $user = null) {
        if (is_object($user) && method_exists($user, 'has_cap') && !$user->has_cap('manage_options')) {
            return;
        }
        self::delete_transient_unless_guarded(self::FRESH);
    }

    /** Forget everything stored about the business (another instance id, a sign-out, uninstall). */
    public static function forget() {
        self::$memo = null;
        self::$memo_key = null;
        delete_option(self::OPTION);
        delete_transient(self::FRESH);
        delete_transient(self::LOCK);
        delete_transient(self::REFRESH_LOCK);
        if (class_exists('WebMaven_WP_API_Client')) {
            delete_transient(WebMaven_WP_API_Client::CONNECTION_CACHE);
        }
    }

    /** The option the account replaces: deleted once; nothing writes it any more. */
    public static function retire_legacy_flag() {
        if (get_option(self::LEGACY_FLAG, null) === null) {
            return false;
        }
        if (class_exists('WebMaven_Self_Protect') && WebMaven_Self_Protect::in_guarded_call()) {
            return false;
        }
        delete_option(self::LEGACY_FLAG);
        return true;
    }

    private static function set_transient_unless_guarded($key, $value, $ttl) {
        if (class_exists('WebMaven_Self_Protect') && WebMaven_Self_Protect::in_guarded_call()) {
            return;
        }
        set_transient($key, $value, $ttl);
    }

    private static function delete_transient_unless_guarded($key) {
        if (class_exists('WebMaven_Self_Protect') && WebMaven_Self_Protect::in_guarded_call()) {
            return;
        }
        delete_transient($key);
    }

    // ── What the site shows ────────────────────────────────────────────────

    /** True on a site WPMaven hosts: its business comes from its own deploy. */
    private static function hosted() {
        return WebMaven_Hosting::is_hosted_site();
    }

    /** 'completed', 'skipped', 'needed' or 'unknown' (no bound answer). */
    public static function onboarding() {
        if (self::hosted()) {
            return 'completed';
        }
        $record = self::current();
        if ($record === null) {
            return 'unknown';
        }
        if ($record['state']['onboardingCompleted']) {
            return 'completed';
        }
        return $record['state']['onboardingSkipped'] ? 'skipped' : 'needed';
    }

    /** The setup card shows: no business, no skip, and a door to open (none on a branded or hosted site). */
    public static function setup_needed() {
        if (self::onboarding() !== 'needed') {
            return false;
        }
        $links = self::current()['state']['links'];
        return $links['create'] !== null || $links['publish'] !== null;
    }

    /**
     * The "Set up your business" menu entry shows: no business on this site
     * yet, also after "Continue in WordPress" (the entry is the way back to
     * the setup wizard), and a door to open (none on a site an agency
     * manages, or a hosted one).
     */
    public static function setup_open() {
        $onboarding = self::onboarding();
        if ($onboarding !== 'needed' && $onboarding !== 'skipped') {
            return false;
        }
        $links = self::current()['state']['links'];
        return $links['create'] !== null || $links['publish'] !== null;
    }

    /** Whether the account lets this site show a surface; false when unknown. */
    public static function feature($name) {
        if (!in_array($name, self::FEATURES, true)) {
            return false;
        }
        $record = self::current();
        return $record !== null && !empty($record['state']['features'][$name]);
    }

    /**
     * The WP-admin app's view (WEBMAVEN_WP_DATA.siteState and /status): the
     * state, or its empty shape when none is held. The account holder's
     * name (first and last, 2026-10-16) only for an administrator.
     */
    public static function for_script($is_admin) {
        $record = self::current();
        $state = $record !== null ? $record['state'] : self::empty_state();
        if (!$is_admin) {
            $state['account'] = ['firstName' => null, 'lastName' => null];
        }
        unset($state['stateVersion']);
        $state['known'] = $record !== null;
        $state['version'] = $record !== null ? (int) $record['version'] : 0;
        $state['onboarding'] = self::onboarding();
        $state['setupNeeded'] = self::setup_needed();
        return $state;
    }

    private static function empty_state() {
        return [
            'connected' => false,
            'instance' => null,
            'account' => ['firstName' => null, 'lastName' => null],
            'onboardingCompleted' => false,
            'onboardingSkipped' => false,
            'business' => null,
            'draft' => null,
            'lastPublish' => null,
            'plan' => null,
            'payments' => ['wpmaven' => 'none', 'needsAction' => false, 'available' => false],
            'whatsappLinked' => false,
            'dashboardUrl' => self::default_dashboard_origin(),
            'links' => ['business' => null, 'create' => null, 'publish' => null, 'installAgent' => null, 'getPaid' => null],
            'next' => null,
            'features' => array_fill_keys(self::FEATURES, false),
            'policyVersion' => 1,
            'stateVersion' => 0,
        ];
    }

    // ── The whitelist ──────────────────────────────────────────────────────

    /**
     * A site state copied through the whitelist, or null when it is not one.
     *
     * @param mixed $data
     */
    public static function clean_state($data) {
        if (!is_array($data) || ($data['connected'] ?? null) !== true || !is_array($data['instance'] ?? null)) {
            return null;
        }
        $instance_id = self::clean_id($data['instance']['id'] ?? null);
        if ($instance_id === null) {
            return null;
        }
        $version = $data['stateVersion'] ?? null;
        if (!is_int($version) || $version < 0 || $version > self::VERSION_MAX) {
            return null;
        }
        $dashboard = self::accepted_dashboard_origin($data['dashboardUrl'] ?? null);
        $links = is_array($data['links'] ?? null) ? $data['links'] : [];
        $features = [];
        foreach (self::FEATURES as $name) {
            $features[$name] = is_array($data['features'] ?? null) && ($data['features'][$name] ?? false) === true;
        }
        $policy = $data['policyVersion'] ?? 1;
        return [
            'connected' => true,
            'instance' => [
                'id' => $instance_id,
                'siteName' => self::text($data['instance']['siteName'] ?? '') ?? '',
                'siteUrl' => self::clean_site_url($data['instance']['siteUrl'] ?? ''),
                'status' => self::enum($data['instance']['status'] ?? '', ['PENDING_ACTIVATION', 'ACTIVE', 'INACTIVE', 'SUSPENDED'], 'ACTIVE'),
                'paused' => ($data['instance']['paused'] ?? false) === true,
                // The site's screenshot for Overview's preview (1.7.0): the
                // signed address the dashboard shows, https only.
                'thumbnailUrl' => self::clean_image_url($data['instance']['thumbnailUrl'] ?? null),
            ],
            // The account holder's name: the sidebar's account button and menu
            // show it to administrators (2026-10-16). Never an email.
            'account' => [
                'firstName' => self::text($data['account']['firstName'] ?? null, 60),
                'lastName' => self::text($data['account']['lastName'] ?? null, 60),
            ],
            'onboardingCompleted' => ($data['onboardingCompleted'] ?? false) === true,
            'onboardingSkipped' => ($data['onboardingSkipped'] ?? false) === true,
            'business' => self::clean_business($data['business'] ?? null),
            'draft' => self::clean_draft($data['draft'] ?? null),
            'lastPublish' => self::clean_last_publish($data['lastPublish'] ?? null),
            'plan' => self::clean_plan($data['plan'] ?? null),
            'payments' => [
                'wpmaven' => self::enum($data['payments']['wpmaven'] ?? '', ['none', 'pending', 'active'], 'none'),
                'needsAction' => ($data['payments']['needsAction'] ?? false) === true,
                'available' => ($data['payments']['available'] ?? false) === true,
            ],
            'whatsappLinked' => ($data['whatsappLinked'] ?? false) === true,
            'dashboardUrl' => $dashboard ?? self::default_dashboard_origin(),
            'links' => [
                'business' => self::clean_link($links['business'] ?? null, $dashboard),
                'create' => self::clean_link($links['create'] ?? null, $dashboard),
                'publish' => self::clean_link($links['publish'] ?? null, $dashboard),
                // The dashboard's WPMaven Agent step for this site (2026-10-25):
                // what a site running WPMaven from WordPress.org alone offers in
                // place of `publish`.
                'installAgent' => self::clean_link($links['installAgent'] ?? null, $dashboard),
                'getPaid' => self::clean_link($links['getPaid'] ?? null, $dashboard),
            ],
            'next' => in_array($data['next'] ?? null, ['publish', 'create', 'get_paid'], true) ? $data['next'] : null,
            'features' => $features,
            'policyVersion' => is_int($policy) && $policy >= 1 && $policy <= 1000000 ? $policy : 1,
            'stateVersion' => $version,
        ];
    }

    private static function clean_business($raw) {
        if (!is_array($raw)) {
            return null;
        }
        $name = self::text($raw['name'] ?? null, 120);
        if ($name === null) {
            return null;
        }
        return [
            'name' => $name,
            'sessionId' => self::clean_id($raw['sessionId'] ?? null),
            'builtByWpmaven' => ($raw['builtByWpmaven'] ?? false) === true,
            'engine' => in_array($raw['engine'] ?? null, ['genstudio', 'legacy'], true) ? $raw['engine'] : null,
            'store' => ($raw['store'] ?? false) === true,
            // kept: the owner's own site, kept as it was (no build behind it).
            'origin' => ($raw['origin'] ?? null) === 'kept' ? 'kept' : 'designed',
            // Kept by Fix and improve, its fixes not chosen yet: the setup wizard opens on them.
            'fixesToChoose' => ($raw['fixesToChoose'] ?? false) === true,
        ];
    }

    private static function clean_draft($raw) {
        if (!is_array($raw)) {
            return null;
        }
        $name = self::text($raw['name'] ?? null, 120);
        $session = self::clean_id($raw['sessionId'] ?? null);
        if ($name === null || $session === null) {
            return null;
        }
        return ['name' => $name, 'sessionId' => $session, 'publishingHere' => ($raw['publishingHere'] ?? false) === true];
    }

    private static function clean_last_publish($raw) {
        if (!is_array($raw)) {
            return null;
        }
        $state = self::enum($raw['state'] ?? '', ['complete', 'partial', 'blocked', 'failed'], '');
        $at = is_string($raw['at'] ?? null) && preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/', $raw['at']) ? $raw['at'] : null;
        if ($state === '' || $at === null) {
            return null;
        }
        $problems = [];
        foreach (is_array($raw['problems'] ?? null) ? $raw['problems'] : [] as $p) {
            if (count($problems) >= self::PROBLEMS_MAX) {
                break;
            }
            $code = is_array($p) && is_string($p['code'] ?? null) && preg_match('/^[a-z0-9_]{1,64}$/', $p['code']) ? $p['code'] : null;
            $message = is_array($p) ? self::text($p['message'] ?? null, 300) : null;
            if ($code !== null && $message !== null) {
                $problems[] = ['code' => $code, 'message' => $message];
            }
        }
        return ['state' => $state, 'at' => $at, 'problems' => $problems];
    }

    private static function clean_plan($raw) {
        if (!is_array($raw)) {
            return null;
        }
        $code = self::text($raw['code'] ?? null, 40);
        $name = self::text($raw['name'] ?? null, 60);
        if ($code === null || $name === null) {
            return null;
        }
        return ['code' => $code, 'name' => $name, 'status' => self::text($raw['status'] ?? null, 40) ?? ''];
    }

    /** A plain text value, or null. */
    private static function text($raw, $max = self::TEXT_MAX) {
        if (!is_string($raw)) {
            return null;
        }
        $text = sanitize_text_field($raw);
        $text = function_exists('mb_substr') ? mb_substr($text, 0, $max) : substr($text, 0, $max);
        $text = trim($text);
        return $text === '' ? null : $text;
    }

    private static function enum($raw, array $allowed, $default) {
        return is_string($raw) && in_array($raw, $allowed, true) ? $raw : $default;
    }

    /** An id as the API makes them (letters, digits, dash, underscore), or null. */
    private static function clean_id($raw) {
        return is_string($raw) && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $raw) ? $raw : null;
    }

    private static function clean_site_url($raw) {
        if (!is_string($raw) || !preg_match('#^https?://[^\s"\'<>\\\\]+$#i', $raw) || strlen($raw) > 2048) {
            return '';
        }
        return $raw;
    }

    /**
     * A picture's https address (a signed storage address is long and
     * carries a query), or null.
     */
    private static function clean_image_url($raw) {
        if (!is_string($raw) || strlen($raw) > 4096 || !preg_match('#^https://[^\s"\'<>\\\\`]+$#i', $raw)) {
            return null;
        }
        return $raw;
    }

    /** The configured dashboard's origin (scheme, host, port), lowercase, no trailing slash. */
    private static function default_dashboard_origin() {
        $url = defined('WEBMAVEN_WP_DASHBOARD_URL') && WEBMAVEN_WP_DASHBOARD_URL ? WEBMAVEN_WP_DASHBOARD_URL : 'https://dashboard.wpmaven.ai';
        $parts = wp_parse_url((string) $url);
        if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
            return 'https://dashboard.wpmaven.ai';
        }
        return strtolower($parts['scheme']) . '://' . strtolower($parts['host']) . (isset($parts['port']) ? ':' . (int) $parts['port'] : '');
    }

    /**
     * The dashboard address the API named: an https origin, or the configured
     * dashboard's own origin (local development runs it on http); else the
     * configured one, and every link is dropped with it.
     */
    private static function accepted_dashboard_origin($raw) {
        if (!is_string($raw)) {
            return null;
        }
        $raw = rtrim(trim($raw), '/');
        if (class_exists('WebMaven_Brand')) {
            $origin = WebMaven_Brand::clean_origin($raw);
            if ($origin !== '' && $origin === strtolower($raw)) {
                return $origin;
            }
        } elseif (preg_match('#^https://[a-z0-9.-]+(:\d{1,5})?$#i', $raw)) {
            return strtolower($raw);
        }
        return strtolower($raw) === self::default_dashboard_origin() ? self::default_dashboard_origin() : null;
    }

    /** A link on the accepted dashboard address, or null. */
    private static function clean_link($raw, $dashboard) {
        if ($dashboard === null || !is_string($raw) || strlen($raw) > 2048 || strpos($raw, $dashboard . '/') !== 0) {
            return null;
        }
        return preg_match('#^[^\s"\'<>\\\\`]+$#', $raw) ? $raw : null;
    }
}
