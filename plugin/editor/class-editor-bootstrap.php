<?php
/**
 * Editor Bootstrap — Conditionally loads the AI Editor components
 * within the main WebMaven WordPress plugin.
 */

defined('ABSPATH') || exit;

class WebMaven_Editor_Bootstrap {

    private static bool $discovery_loaded = false;
    private static bool $rest_loaded = false;

    /**
     * Initialize discovery hooks (only when ?webmaven_discover=1).
     * Called from main plugin bootstrap.
     */
    public static function init_discovery(): void {
        if (self::$discovery_loaded) return;
        self::$discovery_loaded = true;

        $editor_dir = WEBMAVEN_WP_DIR . 'editor/';

        require_once $editor_dir . 'class-webmaven-discovery.php';

        WebMaven_Discovery::init();

        // Enqueue discovery script on the frontend
        add_action('wp_enqueue_scripts', function () {
            if (empty($_GET['webmaven_discover'])) return;
            if (!current_user_can('edit_posts')) return;

            wp_enqueue_script(
                'webmaven-discover',
                WEBMAVEN_WP_URL . 'editor/assets/webmaven-discover.js',
                [WebMaven_Discovery::register_purify()],
                WebMaven_Discovery::discover_version(),
                true
            );
        });
    }

    /**
     * Register editor REST API routes.
     * Called from main plugin's rest_api_init action.
     */
    public static function register_rest(): void {
        if (self::$rest_loaded) return;
        self::$rest_loaded = true;

        $editor_dir = WEBMAVEN_WP_DIR . 'editor/';

        require_once $editor_dir . 'class-webmaven-rest-api.php';
        // Search engine fields: one service for the editor, the API's commands and the head.
        require_once WEBMAVEN_WP_DIR . 'includes/class-webmaven-seo-fields.php';

        WebMaven_REST_API::register_routes();
        // The edit operations of a site WPMaven built (the genstudio editor).
        require_once $editor_dir . 'class-webmaven-edits-rest.php';
        WebMaven_Edits_REST::register_routes();
    }

    /**
     * The admin bar's editor button, only where the account lets this site
     * edit (WebMaven_Site_State, features.edits) and only for an
     * administrator, the one role whose changes the edits route takes
     * (manage_options): "AI Edit Mode" when the editor's AI is on too, else
     * "Edit with <brand>". No button promises an AI that is off, or an
     * editor that would refuse every change.
     */
    public static function init_admin_bar(): void {
        add_action('admin_bar_init', [self::class, 'admin_bar_style']);
        add_action('admin_bar_menu', function ($wp_admin_bar) {
            $node = self::admin_bar_node();
            if ($node !== null) {
                $wp_admin_bar->add_node($node);
            }
        }, 100);
    }

    /**
     * The toolbar's mark in the toolbar icons' own colours: a mask filled with
     * the colour WordPress gives every .ab-icon:before (grey at rest, blue on
     * hover and focus, the admin colour scheme's where one is set), dropped
     * 2px like theirs so it sits centred on the label.
     */
    public static function admin_bar_style(): void {
        if (!class_exists('WebMaven_Brand') || !WebMaven_Brand::is_wpmaven()) {
            return;
        }
        $mask = 'url("' . WebMaven_Brand::mark_data_uri() . '") center/17px 17px no-repeat';
        wp_add_inline_style('admin-bar',
            '#wpadminbar #wp-admin-bar-webmaven-ai-edit .webmaven-ab-mark:before{content:"";display:block;width:20px;height:20px;top:2px;'
            . 'background-color:currentColor;-webkit-mask:' . $mask . ';mask:' . $mask . '}');
    }

    /** The admin bar node for this site, or null when the account does not let it edit or the user is not an administrator. */
    public static function admin_bar_node(): ?array {
        if (!current_user_can('manage_options')) {
            return null;
        }
        if (!class_exists('WebMaven_Site_State') || !WebMaven_Site_State::feature('edits')) {
            return null;
        }
        $title = WebMaven_Site_State::feature('editorAI')
            ? self::admin_bar_icon() . ' AI Edit Mode'
            : esc_html(sprintf('Edit with %s', class_exists('WebMaven_Brand') ? WebMaven_Brand::name() : 'WPMaven'));
        return [
            'id'    => 'webmaven-ai-edit',
            'title' => $title,
            'href'  => admin_url('admin.php?page=webmaven-dashboard#editor'),
            'meta'  => ['class' => 'webmaven-ai-edit-btn'],
        ];
    }

    /** "AI Edit Mode"'s icon: WPMaven's mark where the site is WPMaven's (admin_bar_style draws it), a sparkle under another brand. */
    private static function admin_bar_icon(): string {
        if (!class_exists('WebMaven_Brand') || !WebMaven_Brand::is_wpmaven()) {
            return '<span class="ab-icon" style="margin-right:4px">&#10024;</span>';
        }
        return '<span class="ab-icon webmaven-ab-mark" aria-hidden="true"></span>';
    }
}
