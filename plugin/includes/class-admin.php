<?php
/**
 * WebMaven Admin
 * Admin page registration, script enqueueing, and UI rendering.
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/class-webmaven-hosting.php';

class WebMaven_Admin {

    private $plugin;

    public function __construct($plugin) {
        $this->plugin = $plugin;
    }

    // ── Admin Menu ──────────────────────────────────────────────

    /**
     * Register WP admin menu pages.
     */
    public function register_admin_pages() {
        // Main Dashboard page - appears at top of admin menu. Its name is the
        // brand's on a site under an agency's or a partner's brand, "Site
        // assistant" while that brand is unknown, WPMaven otherwise (1.2.31).
        $name = WebMaven_Brand::name();
        add_menu_page(
            $name,
            $name,
            'edit_posts',
            'webmaven-dashboard',
            [$this, 'render_dashboard_page'],
            WebMaven_Brand::menu_icon(),
            2  // Position near top
        );

        // Dashboard submenu (same as parent)
        add_submenu_page(
            'webmaven-dashboard',
            __('Dashboard', 'wpmaven'),
            __('Dashboard', 'wpmaven'),
            'edit_posts',
            'webmaven-dashboard',
            [$this, 'render_dashboard_page']
        );

        // "Set up your business": while the account says this site has no
        // business, also after "Continue in WordPress" (the entry opens the
        // setup wizard again), and never on a site an agency manages or a
        // hosted one (WebMaven_Site_State::setup_open).
        if (WebMaven_Site_State::setup_open()) {
            add_submenu_page(
                'webmaven-dashboard',
                __('Set up your business', 'wpmaven'),
                __('Set up your business', 'wpmaven'),
                'manage_options',
                'webmaven-onboarding',
                [$this, 'render_onboarding_page']
            );
        }
    }

    // ── The connect notice ──────────────────────────────────────

    /** Set on a user who dismissed the connect notice. */
    const CONNECT_NOTICE_DISMISSED = 'webmaven_connect_notice_dismissed';

    /**
     * Until the site is connected: a notice on WordPress's screens with
     * "Connect" (the plugin's own screen), never a redirect after
     * activation. For administrators, not on the plugin's screens, and gone
     * once dismissed (per user).
     */
    public function connect_notice() {
        if (WebMaven_Brand::is_connected() || !current_user_can('manage_options')) {
            return;
        }
        $screen = function_exists('get_current_screen') ? get_current_screen() : null;
        if ($screen && strpos((string) $screen->id, 'webmaven') !== false) {
            return;
        }
        if (get_user_meta(get_current_user_id(), self::CONNECT_NOTICE_DISMISSED, true)) {
            return;
        }
        $connect = admin_url('admin.php?page=webmaven-dashboard');
        $dismiss = wp_nonce_url(add_query_arg('webmaven_dismiss_connect', '1'), 'webmaven_dismiss_connect');
        echo '<div class="notice notice-info webmaven-notice" data-wpmaven-notice="connect"><p>'
            . esc_html__('WPMaven is ready. Connect your site to start with your AI team.', 'wpmaven')
            . ' <a class="button button-primary" href="' . esc_url($connect) . '">' . esc_html__('Connect', 'wpmaven') . '</a>'
            . ' <a href="' . esc_url($dismiss) . '">' . esc_html__('Dismiss', 'wpmaven') . '</a>'
            . '</p></div>';
    }

    /** admin_init: the notice's Dismiss link, checked with its nonce. */
    public function maybe_dismiss_connect_notice() {
        if (!isset($_GET['webmaven_dismiss_connect']) || !current_user_can('manage_options')) {
            return;
        }
        check_admin_referer('webmaven_dismiss_connect');
        update_user_meta(get_current_user_id(), self::CONNECT_NOTICE_DISMISSED, '1');
        wp_safe_redirect(remove_query_arg(['webmaven_dismiss_connect', '_wpnonce']));
        exit;
    }

    /**
     * Once, after the single plugin (WPMaven WordPress) moved the site to
     * this plugin and WPMaven Agent (its option webmaven_edition_move): what
     * changed, for the first administrator who opens wp-admin.
     */
    public function moved_notice() {
        if (!current_user_can('activate_plugins')) {
            return;
        }
        $move = get_option('webmaven_edition_move', []);
        if (!is_array($move) || ($move['status'] ?? '') !== 'done' || !empty($move['noticeShown'])) {
            return;
        }
        $move['noticeShown'] = true;
        update_option('webmaven_edition_move', $move, false);
        echo '<div class="notice notice-success is-dismissible" data-wpmaven-notice="moved"><p>'
            . esc_html__('WPMaven now comes as two plugins: WPMaven, from WordPress.org, and WPMaven Agent. They replace WPMaven WordPress. Your connection, settings and content did not change.', 'wpmaven')
            . '</p></div>';
    }

    // ── Script / Style Enqueueing ───────────────────────────────

    /**
     * Enqueue scripts for Dashboard pages.
     */
    public function enqueue_dashboard_canvas_scripts($hook) {
        // Check which page we're on
        $is_dashboard = ($hook === 'toplevel_page_webmaven-dashboard');
        // WordPress names a submenu page's hook after its parent menu's title:
        // "wpmaven_page_webmaven-onboarding" under the WPMaven menu,
        // "acme-studio_page_..." under a brand (1.2.31). The old check expected
        // "webmaven_page_...", so the Setup Wizard page never loaded the app and
        // a self-hosted site showed "Loading Setup Wizard..." forever.
        $is_onboarding = substr((string) $hook, -strlen('_page_webmaven-onboarding')) === '_page_webmaven-onboarding';

        if (!$is_dashboard && !$is_onboarding) {
            return;
        }

        if (!$this->plugin->current_user_can_use()) {
            return;
        }

        // WordPress's own React and ReactDOM, and the chat's markdown
        // renderer from the plugin itself.
        $this->register_vendor_scripts();

        // Determine which script to load
        $script_handle = 'webmaven-dashboard';
        $script_file = 'dashboard.js';
        $deps = ['react', 'react-dom', 'marked'];

        // Check if script file exists
        $script_path = WEBMAVEN_WP_DIR . 'assets/' . $script_file;
        if (!file_exists($script_path)) {
            // Fallback: show error message in console
            add_action('admin_notices', function() use ($script_file) {
                echo '<div class="notice notice-warning"><p>';
                echo esc_html(WebMaven_Brand::name()) . ': ' . sprintf(
                    /* translators: %s: the name of the app's script file */
                    esc_html__('The %s file is missing. Please run the build process.', 'wpmaven'),
                    '<code>' . esc_html($script_file) . '</code>'
                );
                echo '</p></div>';
            });
            return;
        }

        // Enqueue the script
        wp_enqueue_script(
            $script_handle,
            WEBMAVEN_WP_URL . 'assets/' . $script_file,
            $deps,
            WEBMAVEN_WP_VERSION . '.' . filemtime($script_path),
            true
        );

        // The app's fonts, from where the app gets them, in the head: the
        // first paint's line is in Inter too (see APP_FONTS_URL).
        $this->enqueue_app_fonts();

        // Enqueue CSS
        $css_file = str_replace('.js', '.css', $script_file);
        $css_path = WEBMAVEN_WP_DIR . 'assets/' . $css_file;
        if (file_exists($css_path)) {
            wp_enqueue_style(
                $script_handle,
                WEBMAVEN_WP_URL . 'assets/' . $css_file,
                [],
                WEBMAVEN_WP_VERSION . '.' . filemtime($css_path)
            );
        }

        // Localize script with data
        $settings = get_option('webmaven_wp_settings', []);
        $current_user = wp_get_current_user();

        // WPMaven ACCOUNT holder (a real name) — the onboarding greets with
        // this, never the WP username. Fallback: the legacy signup
        // option's free-text name, split in two.
        // 1.2.9: no API call on page load any more. It asked /auth/me, which
        // takes dashboard sign-ins only: it failed every time, and each
        // failure rotated the site's token on a plain WP-admin page view.
        $account_user = get_option('webmaven_wp_account_user', []);
        if (!is_array($account_user)) {
            $account_user = [];
        }
        if (empty($account_user['first_name'])) {
            $legacy = get_option('webmaven_wp_account', []);
            $legacy_name = trim($legacy['name'] ?? '');
            if ($legacy_name !== '') {
                $parts = preg_split('/\s+/', $legacy_name, 2);
                $account_user['first_name'] = $parts[0];
                $account_user['last_name']  = $parts[1] ?? '';
            }
            if (empty($account_user['email']) && !empty($legacy['email'])) {
                $account_user['email'] = $legacy['email'];
            }
        }

        $is_admin = current_user_can('manage_options');
        // Just updated or just connected: the account is read once now, so
        // the first page already shows the chat and the AI it turned on.
        if ($is_admin) {
            WebMaven_Site_State::ensure_current();
        }
        // The account holder's name, for an administrator only: the
        // account's (the site state), else what an older link stored. The
        // last name comes from the same place as the first, never mixed.
        $state = WebMaven_Site_State::for_script($is_admin);
        $account_first_name = $is_admin ? ($state['account']['firstName'] ?? null) : null;
        $account_last_name = $is_admin ? ($state['account']['lastName'] ?? null) : null;
        if ($is_admin && ($account_first_name === null || $account_first_name === '')) {
            $account_first_name = $account_user['first_name'] ?? '';
            $account_last_name = $account_user['last_name'] ?? '';
        }

        wp_localize_script($script_handle, 'WEBMAVEN_WP_DATA', [
            'restUrl' => esc_url_raw(get_rest_url(null, 'webmaven_wp/v1')),
            // WordPress's own REST base (plain permalinks use ?rest_route=).
            'wpRestUrl' => esc_url_raw(get_rest_url(null, 'wp/v2')),
            'nonce' => wp_create_nonce('wp_rest'),
            // What the theme lets the chat change (1.6.0): a classic theme
            // without theme.json keeps its colours in the Customizer, so the
            // chat's colour chips do not show there.
            'theme' => [
                'themeJson' => function_exists('wp_theme_has_theme_json') && wp_theme_has_theme_json(),
                'blockTheme' => function_exists('wp_is_block_theme') && wp_is_block_theme(),
            ],
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'adminUrl' => admin_url(),
            // Focus mode: this user's choice (POST /focus-mode).
            'focusMode' => self::focus_mode(),
            // The app's fonts: null when the plugin's own copy is on the page
            // already, else the stylesheet the kit imports (Google Fonts).
            'fontsHref' => self::local_fonts_url() === null ? self::APP_FONTS_URL : null,
            'settings' => [
                'theme_color' => $settings['theme_color'] ?? '#7c3aed',
                'accent_color' => $settings['accent_color'] ?? '#22d3ee',
            ],
            'remotes' => [
                'apiBaseUrl' => $settings['api_base_url'] ?? WEBMAVEN_WP_API_BASE_URL,
                'browserApiBaseUrl' => $settings['browser_api_base_url'] ?? WEBMAVEN_WP_BROWSER_API_BASE_URL,
                // The brand's own dashboard address when it has one (1.2.31).
                'dashboardUrl' => WebMaven_Brand::dashboard_url($settings['dashboard_url'] ?? WEBMAVEN_WP_DASHBOARD_URL),
            ],
            // Whose name and mark the app shows (1.2.31, WebMaven_Brand).
            'brand' => WebMaven_Brand::for_script($settings['dashboard_url'] ?? WEBMAVEN_WP_DASHBOARD_URL),
            // The hosting partner's code for the connect and setup links
            // (1.2.31, WPMaven Agent's partner kit). Not a secret.
            'partner' => WebMaven_Hosting::partner_for_script(),
            'user' => [
                'id' => $current_user->ID,
                'displayName' => $current_user->display_name,
                // The greeting's name: the WordPress user's own first name.
                'firstName' => (string) get_user_meta($current_user->ID, 'first_name', true),
                'email' => $current_user->user_email,
                'isAdmin' => $is_admin,
                // What this user may reach in the API (1.3.0, WebMaven_Actor):
                // 'owner', 'store', 'content' or null. The app shows only the
                // screens of this tier; the API enforces it from the claim.
                'tier' => WebMaven_Actor::current_tier(),
                // A login WPMaven made here: 'owner', 'staff' or null.
                'wpm' => WebMaven_Actor::wpm_marker($current_user->ID),
            ],
            // The guided tours (1.7.0): when this user last came in through a
            // dashboard sign-in link, so the app opens the WordPress tour
            // instead of the full one. Their progress comes from /tour.
            'tours' => class_exists('WebMaven_Tours')
                ? WebMaven_Tours::for_script($current_user->ID)
                : ['arrivedFromDashboard' => null],
            'account' => [
                'firstName' => (string) $account_first_name,
                'lastName'  => $is_admin ? (string) $account_last_name : '',
                // The owner's email is for administrators only (1.2.9).
                'email'     => $is_admin ? ($account_user['email'] ?? '') : '',
            ],
            // Chat and AI editing in WP-admin: on when the account turned them
            // on for this site (features.chat, features.editorAI) and
            // WEBMAVEN_WP_SITE_TOKEN_CHAT did not turn them off, and only
            // ever for an administrator. Otherwise the app shows the card.
            // `switchOn` lets the app follow a later read of the state.
            'siteChat' => [
                'enabled' => function_exists('webmaven_wp_site_chat_enabled') && webmaven_wp_site_chat_enabled() && $is_admin,
                'aiEditing' => WebMaven_WP_Admin_Access::ai_editing_enabled() && $is_admin,
                'switchOn' => (bool) WEBMAVEN_WP_SITE_TOKEN_CHAT && $is_admin,
                'dashboardUrl' => WebMaven_Brand::dashboard_url(WEBMAVEN_WP_DASHBOARD_URL),
            ],
            'site' => [
                // WordPress stores the title escaped ("Bean &amp; Batch"); the app prints text.
                'name' => wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES),
                'url' => get_site_url(),
                'adminUrl' => admin_url(),
                // The site's own icon (Settings > General > Site Icon) at 64px,
                // beside its name in the app; null when the owner set none.
                'iconUrl' => esc_url_raw(get_site_icon_url(64)) ?: null,
            ],
            // WP locale (e.g. "fr_FR"): drives the business plan's currency.
            'locale' => get_locale(),
            'instanceId' => get_option('webmaven_wp_instance_id', ''),
            'pluginUrl' => WEBMAVEN_WP_URL,
            'page' => $is_dashboard ? 'dashboard' : 'onboarding',
            // What the account says about this site's business (GET /sites/me):
            // the setup card, the next step, the links and one flag per screen.
            'siteState' => $state,
            'setupNeeded' => $is_admin && $state['setupNeeded'],
            // A business made in the dashboard waits for this site, and the
            // site already holds the owner's own content: the setup card also
            // offers to start from this site (read here, sent nowhere).
            'setupFromSite' => $is_admin && $state['setupNeeded'] && ($state['next'] ?? null) === 'publish'
                && WebMaven_Edition::has_agent()
                && WebMaven_Site_State::setup_open() && class_exists('WebMaven_Site_Profile')
                && WebMaven_Site_Profile::profile()['kind'] !== 'empty'
                ? admin_url('admin.php?page=webmaven-onboarding') : null,
            // WPMaven Agent is active on this site (or this is the single
            // plugin): without it, a waiting business goes on through the
            // dashboard's WPMaven Agent step (links.installAgent).
            'hasAgent' => WebMaven_Edition::has_agent(),
            // For older readers: true unless the account says setup is needed.
            'onboardingCompleted' => $state['onboarding'] !== 'needed',
            // WordPress's own screens, for this user's role ("Advanced").
            'wpAdminLinks' => self::wp_admin_links(),
            // The store's other payment methods, for Settings' Payments card.
            'store' => self::store_for_script($is_admin),
            // Where this site lives (its identity, and the edge's primary host
            // on a custom domain), so Settings can tell a copy of the site.
            'siteIdentity' => [
                'home' => WebMaven_Site_State::identity(),
                'primaryHost' => (string) get_option('webmaven_primary_host', ''),
            ],
            'auth' => [
                'isAuthenticated' => !empty(get_option('webmaven_wp_access_token', '')),
                'instanceId' => get_option('webmaven_wp_instance_id', ''),
            ],
            'editor' => [
                'restUrl' => esc_url_raw(get_rest_url(null, 'webmaven/v1')),
                'siteUrl' => home_url('/'),
                'siteOrigin' => home_url(),
                'pluginUrl' => WEBMAVEN_WP_URL,
                'apiConnected' => !empty(get_option('webmaven_wp_access_token', '')),
            ],
            'subscription' => [
                'plan' => get_transient('webmaven_user_plan') ?: null,
            ],
        ]);

        // Focus mode (the user's choice): the app over the whole window.
        // Otherwise WordPress's menu and admin bar stay around it.
        add_filter('admin_body_class', function($classes) use ($is_dashboard, $is_onboarding) {
            if (($is_dashboard || $is_onboarding) && self::focus_mode()) {
                $classes .= ' webmaven-fullscreen';
            }
            return $classes;
        });
    }

    /**
     * The fonts the app's kit loads when it starts (its GlobalStyles import
     * this very address: Gabarito, Instrument Serif, Inter and JetBrains
     * Mono, each file fetched only when text uses it). The first paint's
     * line is set in Inter like the app's, but it painted before the app had
     * asked for Inter, so it showed in the computer's fallback font and
     * changed font when the app took over. Loaded here in the head, the font
     * is on its way before the first paint, and the kit's own import finds
     * the same address already loaded. No address the app does not already
     * load: a test checks this one against the installed kit.
     */
    const APP_FONTS_URL = 'https://fonts.googleapis.com/css2?family=Gabarito:wght@400..900&family=Instrument+Serif:ital@0;1&family=Inter:opsz,wght@14..32,400..750&family=JetBrains+Mono:wght@450;600&display=swap';

    /** The plugin's own copy of the app's fonts (assets/fonts), when this edition ships it. */
    public static function local_fonts_url() {
        return file_exists(WEBMAVEN_WP_DIR . 'assets/fonts/fonts.css') ? WEBMAVEN_WP_URL . 'assets/fonts/fonts.css' : null;
    }

    /**
     * The app's fonts in the head of its pages: the plugin's own copy where
     * the edition ships it (WordPress.org: nothing leaves the site before
     * Connect), else APP_FONTS_URL with no version (a ?ver= would make it
     * another address than the kit's), after WordPress's own preconnect
     * hints to the two hosts it comes from.
     */
    private function enqueue_app_fonts() {
        $local = self::local_fonts_url();
        if ($local !== null) {
            wp_enqueue_style('webmaven-app-fonts', $local, [], WEBMAVEN_WP_VERSION);
            return;
        }
        wp_enqueue_style('webmaven-app-fonts', self::APP_FONTS_URL, [], null);
        add_filter('wp_resource_hints', function ($urls, $relation) {
            if ($relation === 'preconnect') {
                $urls[] = 'https://fonts.googleapis.com';
                $urls[] = ['href' => 'https://fonts.gstatic.com', 'crossorigin'];
            }
            return $urls;
        }, 10, 2);
    }

    /**
     * marked for the WP-admin app's chat, served by the plugin itself
     * (1.2.26): wp-admin loads no third-party script. React and ReactDOM are
     * WordPress's own ('react' and 'react-dom', React 18 since WordPress
     * 6.2). The file in assets/vendor/ is the npm release byte for byte
     * (marked 12.0.0, its tarball checked against the registry's integrity
     * when vendored), and a test pins its SHA-256.
     */
    private function register_vendor_scripts() {
        $vendor = WEBMAVEN_WP_URL . 'assets/vendor/';
        wp_register_script('marked', $vendor . 'marked.min.js', [], '12.0.0', true);
    }

    // ── Page Rendering ──────────────────────────────────────────

    /**
     * Render the Dashboard page.
     */
    public function render_dashboard_page() {
        if (!$this->plugin->current_user_can_use()) {
            wp_die(esc_html__('You do not have sufficient permissions to access this page.', 'wpmaven'));
        }

        $this->print_app_root('webmaven-dashboard-root');
    }

    /**
     * The line under the loader while the app loads, in the brand's words
     * (1.2.31). The app's loading screen says the same line by the same rule
     * (frontend/src/components/AppLoading.tsx, loadingText()), so the swap
     * from this first paint to the app cannot be read.
     */
    public static function loading_text() {
        if (WebMaven_Brand::is_wpmaven()) {
            return 'Loading WPMaven...';
        }
        return WebMaven_Brand::mode() === WebMaven_Brand::MODE_BRAND
            ? sprintf('Loading %s...', WebMaven_Brand::name())
            : 'Loading...';
    }

    /**
     * Render the Onboarding page.
     */
    public function render_onboarding_page() {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have sufficient permissions to access this page.', 'wpmaven'));
        }

        // The same app as the dashboard page (WEBMAVEN_WP_DATA.page is
        // 'onboarding': it opens the setup wizard), and the same first paint.
        $this->print_app_root('webmaven-onboarding-root');
    }

    /**
     * Our mark, as the kit's WMLogo draws it (its four paths, its fills
     * through --wm-mark-*), in the box the app's loading screen draws its
     * loader in: 80px, so the mark reads about 64px wide. The mark sits off
     * centre in its 64-unit box, 1.25 units right of the middle and 1.25
     * above it; the group moves it back by that much, as the kit's loaders
     * do, so the swap to the app does not move it.
     * A test checks the paths and the size.
     */
    const LOADING_MARK = '<svg class="webmaven-loading-mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="80" height="80" aria-hidden="true" focusable="false"><g transform="translate(-1.25 1.25)"><path d="M7.589 47.186L7.589 40.036A2.263 2.263 0 0 1 10.172 37.796A18.275 18.275 0 0 1 13.485 38.59A2.089 2.089 0 0 1 14.9 40.567L14.9 41.964A7.136 7.136 0 0 0 22.036 49.1L23.079 49.1A2.089 2.089 0 0 1 25.078 50.583A18.275 18.275 0 0 1 25.681 53.306A2.263 2.263 0 0 1 23.441 55.888L16.292 55.888A8.703 8.703 0 0 1 7.589 47.186Z" fill="var(--wm-mark-ink, #15121F)"/><path d="M18.555 41.964L18.555 29.593A2.263 2.263 0 0 1 21.137 27.353A18.275 18.275 0 0 1 24.45 28.147A2.089 2.089 0 0 1 25.865 30.124L25.865 32.352A6.306 6.306 0 0 0 32.17 38.657L34.044 38.657A2.089 2.089 0 0 1 36.043 40.14A18.275 18.275 0 0 1 36.647 42.863A2.263 2.263 0 0 1 34.407 45.445L22.036 45.445A3.481 3.481 0 0 1 18.555 41.964Z" fill="var(--wm-mark-ink, #15121F)"/><path d="M32.17 35.002L38.443 35.002A0.53 0.53 0 0 0 38.973 34.472L38.973 28.199A2.651 2.651 0 0 0 36.323 25.549L30.05 25.549A0.53 0.53 0 0 0 29.52 26.079L29.52 32.352A2.651 2.651 0 0 0 32.17 35.002Z" fill="var(--wm-mark-orange, #FF6A3D)"/><path d="M33.784 21.949L33.784 7.875A2.263 2.263 0 0 1 36.269 5.624A25.237 25.237 0 0 1 58.899 28.253A2.263 2.263 0 0 1 56.647 30.738L42.574 30.738A0.522 0.522 0 0 1 42.051 30.216L42.051 25.082A2.611 2.611 0 0 0 39.441 22.471L34.306 22.471A0.522 0.522 0 0 1 33.784 21.949Z" fill="var(--wm-mark-violet, #6A4BFF)"/></g></svg>';

    /**
     * The app's root with its first paint, before the app's script runs: one
     * loader from the first paint. It matches the app's loading screen
     * (AppLoading): the same place, the same 80px box, the same line, the
     * same font and the same ground, in the theme the owner chose.
     *
     * On a WPMaven site it draws our mark; under a brand, or while the brand
     * is unknown, a ring in the text colour, never our mark.
     */
    private function print_app_root($root_id) {
        // The styles and the theme come first, so the first paint has both.
        $this->output_fullscreen_styles();
        $this->output_theme_script();

        echo '<div id="' . esc_attr($root_id) . '" class="webmaven-app-container">';
        echo '<div class="webmaven-loading" role="status">';
        // LOADING_MARK is this class's own fixed SVG markup.
        $mark = WebMaven_Brand::is_wpmaven() ? self::LOADING_MARK : '<div class="webmaven-loading-ring" aria-hidden="true"></div>';
        echo $mark; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
        echo '<p>' . esc_html(self::loading_text()) . '</p>';
        echo '</div>';
        echo '</div>';
    }

    /**
     * The theme the owner chose in the app, on <html> before the first paint:
     * the app keeps it in this browser (contexts/ThemeContext.tsx), and the
     * splash otherwise follows the computer's setting until the app starts.
     * "System" leaves it to the computer.
     */
    private function output_theme_script() {
        echo "<script>(function(){try{var p=JSON.parse(localStorage.getItem('webmaven-theme-preferences')||'{}').mode;\n"
            . "var t=p?p:localStorage.getItem('webmaven-theme');\n"
            . "if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();</script>\n";
    }

    /** The user meta that keeps a user's Focus mode: '1' on, '0' off. */
    const FOCUS_MODE_META = 'webmaven_focus_mode';

    /**
     * Whether the app covers the whole window for this user: their own
     * choice, or the default when they never made one (off; WPMaven Agent
     * keeps the full screen its sites always had, webmaven_focus_mode_default).
     */
    public static function focus_mode(): bool {
        $saved = function_exists('get_user_meta') ? (string) get_user_meta(get_current_user_id(), self::FOCUS_MODE_META, true) : '';
        if ($saved === '1' || $saved === '0') {
            return $saved === '1';
        }
        return function_exists('apply_filters') && (bool) apply_filters('webmaven_focus_mode_default', false);
    }

    /**
     * Output CSS for full-screen mode and the first paint.
     */
    private function output_fullscreen_styles() {
        ?>
        <style>
            /* Hide WordPress admin UI for full-screen experience */
            .webmaven-fullscreen #wpcontent {
                margin-left: 0 !important;
                padding-left: 0 !important;
            }
            .webmaven-fullscreen #wpbody-content {
                padding-bottom: 0 !important;
            }
            .webmaven-fullscreen #adminmenumain,
            .webmaven-fullscreen #wpadminbar,
            .webmaven-fullscreen #wpfooter,
            .webmaven-fullscreen .update-nag,
            .webmaven-fullscreen .notice:not(.webmaven-notice) {
                display: none !important;
            }
            .webmaven-fullscreen #wpcontent,
            .webmaven-fullscreen #wpbody,
            .webmaven-fullscreen #wpbody-content {
                height: 100vh !important;
                overflow: hidden !important;
            }
            html:has(.webmaven-fullscreen) {
                padding-top: 0 !important;
                overflow: hidden !important;
                height: 100vh !important;
            }
            body.webmaven-fullscreen {
                overflow: hidden !important;
                height: 100vh !important;
            }

            /*
             * Without Focus mode, the app sits in WordPress's content area:
             * the admin bar above it, the menu to its left (folded, or gone
             * on a phone). --wm-app-height is the height the app's own
             * layouts take.
             */
            body:not(.webmaven-fullscreen) .webmaven-app-container {
                top: var(--wp-admin--admin-bar--height, 32px) !important;
                left: 160px !important;
                --wm-app-height: calc(100vh - var(--wp-admin--admin-bar--height, 32px));
            }
            body.folded:not(.webmaven-fullscreen) .webmaven-app-container {
                left: 36px !important;
            }
            @media screen and (max-width: 960px) {
                body.auto-fold:not(.webmaven-fullscreen) .webmaven-app-container {
                    left: 36px !important;
                }
            }
            @media screen and (max-width: 782px) {
                body:not(.webmaven-fullscreen) .webmaven-app-container {
                    left: 0 !important;
                }
            }

            /* App container: the kit's ground (--bg), light and dark. */
            .webmaven-app-container {
                position: fixed;
                --wm-app-height: 100vh;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: #F5F6F8;
                z-index: 99999;
            }

            /* The first paint, as the app's loading screen draws it (AppLoading):
               an 80px loader, 16px above the line, in the kit's colours. The
               mark's colours are the kit's --wm-mark-* for each theme, set here
               on the splash only: the app sets its own when it starts. */
            .webmaven-loading {
                --wm-mark-ink: #15121F;
                --wm-mark-violet: #6A4BFF;
                --wm-mark-orange: #FF6A3D;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100%;
                gap: 16px;
                color: #6E7382;
            }
            .webmaven-loading-mark {
                display: block;
                width: 80px;
                height: 80px;
                animation: webmaven-pulse 2.4s ease-in-out infinite;
            }
            /* Under a brand, or while it is unknown: a ring in the text colour,
               in the same 80px box. */
            .webmaven-loading-ring {
                box-sizing: border-box;
                width: 32px;
                height: 32px;
                margin: 24px;
                border: 3px solid rgba(110, 115, 130, 0.2);
                border-top-color: currentColor;
                border-radius: 50%;
                animation: webmaven-spin 0.8s linear infinite;
            }
            .webmaven-loading p {
                color: inherit;
                font-family: "Inter", sans-serif;
                font-size: 13px;
                line-height: 1.5;
                margin: 0;
            }
            @keyframes webmaven-spin {
                to { transform: rotate(360deg); }
            }
            @keyframes webmaven-pulse {
                50% { opacity: 0.6; }
            }
            @media (prefers-reduced-motion: reduce) {
                .webmaven-loading-mark,
                .webmaven-loading-ring {
                    animation: none;
                }
            }

            /* Dark: the data-theme attribute the theme script above (and then
               the app) sets on <html>; with none, the computer's setting. */
            html[data-theme="dark"] .webmaven-app-container {
                background: #0E0F13;
            }
            html[data-theme="dark"] .webmaven-loading {
                --wm-mark-ink: #F4F3F8;
                --wm-mark-violet: #8C74FF;
                --wm-mark-orange: #FF7A50;
                color: #9BA0AF;
            }
            html[data-theme="dark"] .webmaven-loading-ring {
                border-color: rgba(155, 160, 175, 0.2);
                border-top-color: currentColor;
            }

            @media (prefers-color-scheme: dark) {
                html:not([data-theme]) .webmaven-app-container,
                html[data-theme="system"] .webmaven-app-container {
                    background: #0E0F13;
                }
                html:not([data-theme]) .webmaven-loading,
                html[data-theme="system"] .webmaven-loading {
                    --wm-mark-ink: #F4F3F8;
                    --wm-mark-violet: #8C74FF;
                    --wm-mark-orange: #FF7A50;
                    color: #9BA0AF;
                }
                html:not([data-theme]) .webmaven-loading-ring,
                html[data-theme="system"] .webmaven-loading-ring {
                    border-color: rgba(155, 160, 175, 0.2);
                    border-top-color: currentColor;
                }
            }
        </style>
        <?php
    }

    // ── WordPress's own screens ("Advanced") ───────────────────

    /**
     * The WordPress screens the current user may open, in this order, each
     * only with its capability, with WordPress's own translated labels: the
     * full-screen app hides the admin menu, and these bring it back (the
     * brand's entry sits near the top of that menu to come back). Orders
     * follow WooCommerce's storage (HPOS or posts).
     *
     * @return array<int, array{key: string, label: string, url: string}>
     */
    public static function wp_admin_links() {
        $links = [];
        $add = function ($key, $label, $path) use (&$links) {
            $links[] = ['key' => $key, 'label' => (string) $label, 'url' => esc_url_raw(admin_url($path))];
        };
        $woo = class_exists('WooCommerce');
        if (current_user_can('read')) {
            $add('wp-admin', __('WordPress admin', 'wpmaven'), 'index.php');
        }
        if ($woo && current_user_can('edit_products')) {
            $add('products', __('Products', 'wpmaven'), 'edit.php?post_type=product');
        }
        if ($woo && current_user_can('edit_shop_orders')) {
            $hpos = class_exists('Automattic\\WooCommerce\\Utilities\\OrderUtil')
                && \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled();
            $add('orders', __('Orders', 'wpmaven'), $hpos ? 'admin.php?page=wc-orders' : 'edit.php?post_type=shop_order');
        }
        // WordPress's own words for its own screens, in the site's language.
        if (current_user_can('edit_posts')) {
            $add('posts', translate('Posts', 'default'), 'edit.php');
        }
        if (current_user_can('edit_pages')) {
            $add('pages', translate('Pages', 'default'), 'edit.php?post_type=page');
        }
        if (current_user_can('upload_files')) {
            $add('media', translate('Media', 'default'), 'upload.php');
        }
        if (current_user_can('switch_themes')) {
            $add('appearance', translate('Appearance', 'default'), 'themes.php');
        }
        if (current_user_can('activate_plugins')) {
            $add('plugins', translate('Plugins', 'default'), 'plugins.php');
        }
        if (current_user_can('manage_options')) {
            $add('settings', translate('Settings', 'default'), 'options-general.php');
        }
        return $links;
    }

    /**
     * The store's own payment methods for Settings (administrators only):
     * the titles of the WooCommerce gateways that are on, WPMaven Payments
     * left out (its card says where it stands), and where to manage them
     * for a user who may.
     *
     * @return array{active: bool, gateways: string[], manageUrl: string}
     */
    public static function store_for_script($is_admin) {
        $out = ['active' => class_exists('WooCommerce'), 'gateways' => [], 'manageUrl' => ''];
        if (!$is_admin || !$out['active'] || !function_exists('WC')) {
            return $out;
        }
        try {
            $registry = WC()->payment_gateways();
            $gateways = $registry ? $registry->payment_gateways() : [];
            foreach ((array) $gateways as $id => $gateway) {
                if (!is_object($gateway) || ($gateway->enabled ?? 'no') !== 'yes') {
                    continue;
                }
                if (class_exists('WebMaven_Payments') && $id === WebMaven_Payments::GATEWAY_ID) {
                    continue;
                }
                $title = trim(wp_strip_all_tags(html_entity_decode((string) $gateway->get_title(), ENT_QUOTES, 'UTF-8')));
                if ($title !== '' && count($out['gateways']) < 12) {
                    $out['gateways'][] = function_exists('mb_substr') ? mb_substr($title, 0, 60) : substr($title, 0, 60);
                }
            }
        } catch (\Throwable $e) {
            $out['gateways'] = [];
        }
        if (current_user_can('manage_woocommerce')) {
            $out['manageUrl'] = esc_url_raw(admin_url('admin.php?page=wc-settings&tab=checkout'));
        }
        return $out;
    }

    // ── Plugin Action Links ─────────────────────────────────────

    /**
     * Add "Dashboard" link to the Plugins list page.
     */
    public function plugin_action_links($links) {
        $url = admin_url('admin.php?page=webmaven-dashboard');
        $links[] = '<a href="' . esc_url($url) . '">' . esc_html__('Dashboard', 'wpmaven') . '</a>';
        return $links;
    }
}
