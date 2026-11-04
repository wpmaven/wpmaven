<?php
/**
 * The plugin's bootstrap: constants, the classes, and the one object that
 * wires them. Loaded by the main file of the edition that ships it
 * (wpmaven.php for the WordPress.org edition, webmaven-wordpress.php for
 * the single plugin that also carries WPMaven Agent), which first defines
 * WEBMAVEN_WP_FILE: that file's header gives the version, and its folder
 * is where these files live.
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Per-user hourly rate limit for the editor's AI-spend endpoints: the editor's generate/ai-image/ai-prompt/ai-action
 * routes trigger LLM/image generation on the OWNER's WPMaven credits with no
 * cap, so one low-role or compromised account could run the owner into overage
 * in minutes. Editors keep access; each user is bounded to $max spend calls per
 * rolling hour. Returns true, or a WP_Error the REST layer surfaces (403/429).
 */
function webmaven_wp_spend_guard($cap = 'edit_posts', $max_per_hour = 60) {
    if (!is_user_logged_in() || !current_user_can($cap)) {
        return new WP_Error('rest_forbidden', 'You are not allowed to do this.', ['status' => 403]);
    }
    $max = (int) apply_filters('webmaven_wp_editor_spend_per_hour', $max_per_hour);
    if ($max <= 0) { return true; }
    $key = 'wm_spend_' . get_current_user_id() . '_' . floor(time() / HOUR_IN_SECONDS);
    $n = (int) get_transient($key);
    if ($n >= $max) {
        return new WP_Error('rest_too_many_requests', 'AI request limit reached for this hour. Please try again later.', ['status' => 429]);
    }
    set_transient($key, $n + 1, HOUR_IN_SECONDS);
    return true;
}

// Single source of truth: derive the runtime version from the plugin header
// above — the same string WordPress displays and the CI version-bump gate
// checks — so there is only ONE place to bump. Sentinel fallback (never a real
// number) so a failed read is obvious and can't silently re-introduce drift.
if (function_exists('get_file_data')) {
    $webmaven_wp_header = get_file_data(WEBMAVEN_WP_FILE, ['Version' => 'Version']);
    define('WEBMAVEN_WP_VERSION', $webmaven_wp_header['Version'] !== '' ? $webmaven_wp_header['Version'] : '0.0.0');
    unset($webmaven_wp_header);
} else {
    define('WEBMAVEN_WP_VERSION', '0.0.0');
}
define('WEBMAVEN_WP_DIR', plugin_dir_path(WEBMAVEN_WP_FILE));
define('WEBMAVEN_WP_URL', plugin_dir_url(WEBMAVEN_WP_FILE));

// Load environment variables from .env file
if (!function_exists('webmaven_wp_load_env')) {
    function webmaven_wp_load_env($key, $default = null) {
        // First, check if WordPress constant is defined (highest priority)
        $constant_name = 'WEBMAVEN_WP_' . strtoupper($key);
        if (defined($constant_name)) {
            return constant($constant_name);
        }
        
        // Check environment variable
        $env_value = getenv($constant_name);
        if ($env_value !== false) {
            return $env_value;
        }
        
        // Try to load from .env file
        // Look in plugin directory first, then try to find project root
        $env_files = [WEBMAVEN_WP_DIR . '.env'];
        
        // Try to find project root by looking for build.sh or package.json
        // Go up from plugin directory to find project root
        $current_dir = WEBMAVEN_WP_DIR;
        for ($i = 0; $i < 5; $i++) {
            $parent_dir = dirname($current_dir);
            if ($parent_dir === $current_dir) {
                break; // Reached filesystem root
            }
            // Check if this looks like project root (has build.sh or frontend/package.json)
            if (file_exists($parent_dir . '/build.sh') || file_exists($parent_dir . '/frontend/package.json')) {
                $env_files[] = $parent_dir . '/.env';
                break;
            }
            $current_dir = $parent_dir;
        }
        
        foreach ($env_files as $env_file) {
            if (file_exists($env_file) && is_readable($env_file)) {
                $lines = file($env_file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
                foreach ($lines as $line) {
                    // Skip comments
                    if (strpos(trim($line), '#') === 0) {
                        continue;
                    }
                    
                    // Parse KEY=VALUE format
                    if (strpos($line, '=') !== false) {
                        list($env_key, $env_value) = explode('=', $line, 2);
                        $env_key = trim($env_key);
                        $env_value = trim($env_value, " \t\n\r\0\x0B\"'");
                        
                        if ($env_key === $constant_name) {
                            return $env_value;
                        }
                    }
                }
            }
        }
        
        return $default;
    }
}

// Runtime endpoints. Defaults are PRODUCTION: this plugin ships to
// end-user WordPress sites where we control no environment, so the
// compiled-in default must point at the live service. Local dev
// overrides these via WEBMAVEN_WP_* container env vars (getenv path) —
// see webmaven_dev_env/docker-compose.yml. Precedence in
// webmaven_wp_load_env(): WP constant → getenv → .env file → default.

// Server-side PHP requests (oauth, REST calls from the plugin).
define('WEBMAVEN_WP_API_BASE_URL', webmaven_wp_load_env('API_BASE_URL', 'https://api.wpmaven.ai/api'));

// Browser-side requests (SSE, tracker.js, dashboard handoff).
define('WEBMAVEN_WP_BROWSER_API_BASE_URL', webmaven_wp_load_env('BROWSER_API_BASE_URL', 'https://api.wpmaven.ai/api'));

// WebSocket base URL for browser connections. Empty → derives from
// BROWSER_API_BASE_URL.
define('WEBMAVEN_WP_WEBSOCKET_BASE_URL', webmaven_wp_load_env('WEBSOCKET_BASE_URL', ''));

// Dashboard URL (login handoff, "open in dashboard" links).
define('WEBMAVEN_WP_DASHBOARD_URL', webmaven_wp_load_env('DASHBOARD_URL', 'https://dashboard.wpmaven.ai'));

// Include required files
// WP-admin access rules (1.2.9): the chat switch, the dashboard card answer,
// the "not connected" answer and the hosted-site onboarding flag.
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-wp-admin-access.php';
// Whose name the plugin shows (1.2.31): WPMaven, or the White label agency's
// or wholesale partner's brand that GET /sites/me/plan names.
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-brand.php';
// What this site's business is, as the account says (GET /sites/me): the
// setup card, the menu, the admin bar and the app's screens read it.
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-log.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-choices.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-hosting.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-site-mail.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-site-state.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-actor.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-api-client.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-conversation.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-error-handler.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-alert-detector.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-intrusion-detection.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-setup-password.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-contact-sync.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-marketing-consent.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-user-secrets.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-self-protect.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-admin-guard.php';
// What stays in the backups folder: the newest archives, no stale staging.
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-files.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-backup-retention.php';
// What a site without WPMaven Agent answers to Agent's abilities.
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-requires-agent.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-option-allowlist.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-edition.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webhook-actions.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-wordpress-commands.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-designed-blocks.php';
// WordPress's own sample content, recognised in the site's language.
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-default-content.php';
// The setup wizard's calls to WPMaven, and the site it builds onto.
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-wizard.php';
// What a site already holds, read here: the wizard's first step and the site check.
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-site-profile.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-plugin-currency.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-conversation-routes.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-realtime.php';
// Who may hand this site its credentials (1.2.14): before the two route
// classes that receive them.
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-link-guard.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-oauth.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webhook-handler.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-admin.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-proxy.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-core-routes.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-site-ping.php';
// The guided tours' progress, per WordPress user (1.7.0).
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-tours.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-metrics-routes.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-analytics.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-ai-discovery.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-ai-marking.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-structured-data.php';
// A page's search engine fields, and their tags where no SEO plugin prints them (1.3.0).
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-seo-fields.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-seo-head.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-ai-crawlers.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-store-payments.php';
// WPMaven Payments (1.2.33): the Card or wallet gateway, its pay page and
// the order commands' helpers. The gateway class loads once WooCommerce has.
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-payments.php';
// The store's ways to get paid, read on the site for the Payments screen (1.3.0).
require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-store-gateways.php';
require_once WEBMAVEN_WP_DIR . 'includes/class-badge.php';
// Capabilities: one file per ability, each registering its webhook actions
// through the webmaven_webhook_action_handlers filter (see
// WebMaven_Webhook_Handler::capability_handlers). Loaded in name order.
foreach ((array) glob(WEBMAVEN_WP_DIR . 'includes/capabilities/*.php') as $webmaven_capability_file) {
    require_once $webmaven_capability_file;
}
unset($webmaven_capability_file);

class WebMavenWordPress {
    /** @var WebMavenWordPress|null The one object, for WPMaven Agent (WebMavenWordPress::instance()). */
    private static $instance = null;

    /** The plugin's one object, or null before it is built. */
    public static function instance() {
        return self::$instance;
    }

    private $_extracted_scripts = [];
    public $webhook_actions;
    public $wp_commands;
    private $wizard;
    private $conversations;
    private $realtime;
    private $oauth;
    private $webhook_handler;
    private $admin;
    public $proxy;
    public $core_routes;
    public $metrics_routes;
    public $ai_discovery;

    public function __construct() {
        self::$instance = $this;
        // The proxy forwards the routes of the API's own route table, for the
        // user's tier (1.3.0, WebMaven_Site_Routes); the prefix list is gone.

        $this->wp_commands = new WebMaven_WordPress_Commands();
        $this->webhook_actions = new WebMaven_Webhook_Actions($this);
        // Bridge: lets execute_command delegate unknown commands to webhook_<name> actions
        $this->wp_commands->set_webhook_actions($this->webhook_actions);
        $this->wizard = new WebMaven_Wizard($this);
        $this->conversations = new WebMaven_Conversation_Routes($this);
        $this->realtime = new WebMaven_Realtime($this);
        $this->oauth = new WebMaven_OAuth($this);
        $this->webhook_handler = new WebMaven_Webhook_Handler($this);
        $this->admin = new WebMaven_Admin($this);
        $this->proxy = new WebMaven_Proxy($this);
        $this->core_routes = new WebMaven_Core_Routes($this);
        $this->metrics_routes = new WebMaven_Metrics_Routes($this);
        // AI discoverability: dynamic /llms.txt + enhanced robots.txt (registers
        // its own frontend hooks; no REST route).
        $this->ai_discovery = new WebMaven_AI_Discovery();

        // Invisible machine-readable AI-content marking (EU AI Act art. 50):
        // every tier, always on, decoupled from the badge. Registers its own
        // frontend hooks; no REST route.
        new WebMaven_AI_Marking();

        // schema.org JSON-LD structured data (Google rich results + LLM grounding):
        // emitted into <head> on every front-end page, deferring to any real SEO
        // plugin. Registers its own frontend hook; no REST route.
        new WebMaven_Structured_Data();
        // The description, Open Graph and Twitter tags saved for a page, printed
        // when no SEO plugin prints them (1.3.0).
        WebMaven_SEO_Head::init();
        // AI crawler visits + AI readiness (2026-09-16): counts ChatGPT, Claude,
        // Perplexity and other AI fetchers per day, answers the readiness
        // checklist; the API pulls both through webhook actions.
        new WebMaven_AI_Crawlers();

        // Visible "Built with WPMaven" footer badge: FREE and LAUNCH effective
        // tiers only, decided by the API via the subscription payload and
        // cached in a transient. Fail-safe default is OFF.
        new WebMaven_Badge();

        // Analytics tracker injection (frontend pages only)
        $analytics = new WebMaven_Analytics($this);
        $analytics->init();

        add_action('rest_api_init', [$this, 'register_rest_routes']);

        // The brand on WP-admin screens (1.2.31). See the class header.
        WebMaven_Brand::init();
        // The site state: forgotten with the instance id, read after an
        // administrator signs in, and the old local setup flag retired.
        WebMaven_Site_State::init();

        // AI Editor integration
        require_once WEBMAVEN_WP_DIR . 'editor/class-editor-bootstrap.php';
        // Discovery hooks (only when ?webmaven_discover=1 on frontend)
        if (!is_admin() && !empty($_GET['webmaven_discover'])) {
            WebMaven_Editor_Bootstrap::init_discovery();
        }
        // REST routes
        add_action('rest_api_init', function () {
            WebMaven_Editor_Bootstrap::register_rest();
        });
        // Admin bar button
        WebMaven_Editor_Bootstrap::init_admin_bar();
        // Live preview of an edit (2026-10-05): a front-end GET carrying a
        // valid wm_preview token shows a staged change over the live site.
        require_once WEBMAVEN_WP_DIR . 'editor/class-webmaven-edit-preview.php';
        WebMaven_Edit_Preview::init();

        // Webhook endpoint for AI backend (admin-ajax)
        add_action('wp_ajax_ai_assistant_webhook', [$this->webhook_handler, 'handle_webhook']);
        add_action('wp_ajax_nopriv_ai_assistant_webhook', [$this->webhook_handler, 'handle_webhook']);

        // Admin pages, script enqueuing, plugin action links
        add_action('admin_menu', [$this->admin, 'register_admin_pages']);
        add_action('admin_enqueue_scripts', [$this->admin, 'enqueue_dashboard_canvas_scripts']);
        add_filter('plugin_action_links_' . plugin_basename(WEBMAVEN_WP_FILE), [$this->admin, 'plugin_action_links']);
        // Until the site is connected: a notice with "Connect", never a redirect.
        add_action('admin_notices', [$this->admin, 'connect_notice']);
        add_action('admin_init', [$this->admin, 'maybe_dismiss_connect_notice']);
        // Once, after a site moved here from the single plugin.
        add_action('admin_notices', [$this->admin, 'moved_notice']);

        register_activation_hook(WEBMAVEN_WP_FILE, [$this, 'on_activate']);

        // Initialize alert detector (WP cron for heartbeat + local checks)
        WebMaven_Alert_Detector::init();

        // Signs of intrusion (core files, PHP in uploads, new administrators,
        // failed-login bursts), reported to WPMaven for its staff (1.2.23).
        WebMaven_Intrusion_Detection::init();

        // The connect wizard's "WPMaven Dashboard" application password is
        // deleted once it is an hour old (1.2.30): the API deletes
        // it after the connect, and this catches older connects and misses.
        WebMaven_Setup_Password::init();

        // Contact sync: WP cron reconcile + WooCommerce event pushes to the API
        WebMaven_Contact_Sync::init();

        // Email campaigns (1.2.28): the yes a campaign needs, asked at the
        // checkout and on WPMaven's forms, never ticked in advance.
        WebMaven_Marketing_Consent::init();

        // Once after the 1.2.6 update: the database copies the retired
        // backup_database left in wpai_backup_* options stop autoloading.
        add_action('init', ['WebMaven_WordPress_Commands', 'retire_legacy_backup_options']);

        // Once after the 1.2.22 update: the theme_mods_{stylesheet}_{key}
        // options the old update_theme_options wrote (nothing reads them) are
        // deleted.
        add_action('init', ['WebMaven_WordPress_Commands', 'delete_theme_mod_junk_options']);
    }

    public function on_activate() {
        $defaults = [
            'theme_color' => '#7c3aed',
            'accent_color' => '#22d3ee',
            'position' => 'bottom-right',
            'offset'    => 20,
            // Optional remote endpoints
            'oauth_authorize_url' => '',
            'dashboard_url' => WEBMAVEN_WP_DASHBOARD_URL,
            'api_base_url' => WEBMAVEN_WP_API_BASE_URL,
            'browser_api_base_url' => WEBMAVEN_WP_BROWSER_API_BASE_URL,
            'billing_portal_url'  => '',
        ];
        $existing = get_option('webmaven_wp_settings', []);
        // Heal stale dev endpoints saved by older builds whose compiled-in
        // defaults were localhost. Any previously-saved local address is
        // forced back to the current per-field constant — production in a
        // released build, or the dev override under docker (so these are
        // no-ops in dev). Fresh installs skip this entirely ($existing empty).
        $stale_api  = ['0.0.0.0:3000/api', 'http://localhost:3000/api', 'https://localhost:3000/api'];
        $stale_dash = ['http://localhost:3001', 'https://localhost:3001'];
        if (isset($existing['api_base_url']) && in_array($existing['api_base_url'], $stale_api, true)) {
            $existing['api_base_url'] = WEBMAVEN_WP_API_BASE_URL;
        }
        if (isset($existing['browser_api_base_url']) && in_array($existing['browser_api_base_url'], $stale_api, true)) {
            $existing['browser_api_base_url'] = WEBMAVEN_WP_BROWSER_API_BASE_URL;
        }
        if (!isset($existing['browser_api_base_url'])) {
            $existing['browser_api_base_url'] = WEBMAVEN_WP_BROWSER_API_BASE_URL;
        }
        if (isset($existing['dashboard_url']) && in_array($existing['dashboard_url'], $stale_dash, true)) {
            $existing['dashboard_url'] = WEBMAVEN_WP_DASHBOARD_URL;
        }
        // Set the webmaven_wp_api_url option for the API client
        // Always update to match the current constant to ensure consistency
        update_option('webmaven_wp_api_url', WEBMAVEN_WP_API_BASE_URL);
        update_option('webmaven_wp_settings', array_merge($defaults, (array) $existing));
        
        // Create database tables
        $this->create_tables();

        WebMaven_WP_Admin_Access::maybe_mark_hosted_onboarding_completed();

        // What WPMaven Agent does after an activation (its welcome redirect,
        // WP-CLI, a partner package's code), when Agent is here.
        do_action('webmaven_activated', $this);
    }

    /**
     * Make sure WPMaven's own table exists (dbDelta is idempotent). Called
     * after a backup restore, whose dump may have dropped it (2026-09-22).
     */
    public function ensure_tables() {
        $this->create_tables();
    }

    private function create_tables() {
        global $wpdb;

        $table_name = $wpdb->prefix . 'wpai_conversations';
        
        $charset_collate = $wpdb->get_charset_collate();
        
        $sql = "CREATE TABLE $table_name (
            id mediumint(9) NOT NULL AUTO_INCREMENT,
            conversation_id varchar(255) NOT NULL,
            title varchar(255) NOT NULL,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            updated_at datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY conversation_id (conversation_id)
        ) $charset_collate;";
        
        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
    }

    public function current_user_can_use() {
        return is_user_logged_in() && current_user_can('edit_posts');
    }

    /**
     * The administrator gate (1.2.9), deliberately not filterable: the chat,
     * the editor AI, /subscription, /logout and OAuth. Roles are enforced
     * here first, and since 1.3.0 by the API too, from the signed actor claim
     * every call carries (WebMaven_Actor): the business pages answer each
     * WordPress tier its own routes (current_user_api_tier, the proxy's route
     * table), and the API refuses a tier outside a route's.
     */
    public function current_user_can_reach_api() {
        return is_user_logged_in() && current_user_can('manage_options');
    }

    /**
     * The signed-in user's tier for the API (1.3.0): 'owner' (manage_options),
     * 'store' (manage_woocommerce), 'content' (edit_others_posts), or null
     * (Authors, Contributors, Subscribers: no API route). From capabilities,
     * not filterable.
     */
    public function current_user_api_tier() {
        return WebMaven_Actor::current_tier();
    }

    /**
     * Capability for actions that SPEND the owner's WPMaven credits: AI
     * generation, agent runs, approving pending spend/publish steps. Since 1.2.9 every one of those reaches the API,
     * so it is never wider than current_user_can_reach_api(): the filter can
     * only narrow it further (a stricter capability), never open it to
     * Editors or below.
     */
    public function current_user_can_spend() {
        $cap = apply_filters('webmaven_wp_spend_capability', 'manage_options');
        return $this->current_user_can_reach_api() && current_user_can($cap);
    }

    /** True or WP_Error: the request carries a valid API signature for this site. */
    public function verify_api_request(\WP_REST_Request $req) {
        return $this->webhook_handler->verify_api_request($req);
    }

    /**
     * Permission gate for the two routes the WPMaven API pushes credentials to
     * (/activate and /oauth/callback): neither saves credentials from a caller
     * it cannot trust.
     *   - An administrator session (cookie + REST nonce, or an application
     *     password) always passes.
     *   - A push carrying a link token this site gave one of its
     *     administrators (Sign In in WP-admin) passes.
     *   - A site that already holds credentials requires the API's signature
     *     made with them.
     *   - Anything else is refused (1.2.14), a site with no credentials
     *     included: otherwise any WPMaven account could link the site to
     *     itself. See WebMaven_Link_Guard.
     */
    public function authorize_link_push(\WP_REST_Request $req) {
        return WebMaven_Link_Guard::authorize($req, [$this, 'verify_api_request']);
    }


    public function register_rest_routes() {
        $this->wizard->register_routes();
        // "Continue in WordPress" (POST /setup/skip), recorded on the account.
        WebMaven_Site_State::register_routes([$this, 'current_user_can_reach_api']);
        $this->conversations->register_routes();
        $this->realtime->register_routes();
        $this->oauth->register_routes();
        $this->core_routes->register_routes();
        $this->metrics_routes->register_routes();
    }
}

new WebMavenWordPress();

// WPMaven Agent (or any add-on) adds its abilities from here.
do_action('webmaven_loaded', WebMavenWordPress::instance());
