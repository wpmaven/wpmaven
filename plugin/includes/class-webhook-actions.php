<?php
/**
 * WebMaven Webhook Actions
 * All webhook action implementations extracted from the main plugin file.
 * Called by handle_webhook_action() in the main plugin class.
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/class-webmaven-log.php';
require_once __DIR__ . '/class-webmaven-option-allowlist.php';

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

require_once __DIR__ . '/class-webmaven-files.php';

// The WPForms definition behind a designed form follows the page (1.4.0).
require_once __DIR__ . '/class-webmaven-designed-forms.php';
require_once __DIR__ . '/class-webmaven-booking-request.php';

class WebMaven_Webhook_Actions {

    /** @var WebMavenWordPress Reference to main plugin for calling WP command methods */
    private $plugin;

    public function __construct($plugin = null) {
        $this->plugin = $plugin;
    }

    /**
     * Delegate calls to the main plugin class for methods not yet extracted.
     * (create_post, install_plugin, execute_command, etc.)
     */
    public function __call($name, $arguments) {
        // Try main plugin first
        if ($this->plugin && method_exists($this->plugin, $name)) {
            return call_user_func_array([$this->plugin, $name], $arguments);
        }
        // Try wp_commands
        if ($this->plugin && $this->plugin->wp_commands && method_exists($this->plugin->wp_commands, $name)) {
            return call_user_func_array([$this->plugin->wp_commands, $name], $arguments);
        }
        throw new \BadMethodCallException("Method {$name} not found");
    }

    
    
    // ===== WP-CLI =====

    // ===== FILE SEARCH & CONTENT RETRIEVAL =====

    /**
     * Get full post/page data with meta, taxonomy, and featured image: the
     * saved content (the editor keeps no working copy on the site).
     */
    public function webhook_get_post_full($params) {
        if (empty($params['post_id'])) {
            throw new \Exception('post_id is required');
        }

        $post_id = intval($params['post_id']);
        $post = get_post($post_id);

        if (!$post) {
            throw new \Exception('Post not found: ' . $post_id);
        }

        $content = $post->post_content;
        $content_source = 'saved';

        // Categories and tags
        $categories = wp_get_post_categories($post_id, ['fields' => 'names']);
        $tags = wp_get_post_tags($post_id, ['fields' => 'names']);

        // Featured image
        $featured = null;
        $thumb_id = get_post_thumbnail_id($post_id);
        if ($thumb_id) {
            $featured = [
                'id' => $thumb_id,
                'url' => wp_get_attachment_url($thumb_id),
                'alt' => get_post_meta($thumb_id, '_wp_attachment_image_alt', true),
            ];
        }

        // Post meta (selected useful fields)
        $meta = [];
        $yoast_title = get_post_meta($post_id, '_yoast_wpseo_title', true);
        $yoast_desc = get_post_meta($post_id, '_yoast_wpseo_metadesc', true);
        $yoast_focus = get_post_meta($post_id, '_yoast_wpseo_focuskw', true);
        if ($yoast_title) $meta['yoast_title'] = $yoast_title;
        if ($yoast_desc) $meta['yoast_description'] = $yoast_desc;
        if ($yoast_focus) $meta['yoast_focus_keyword'] = $yoast_focus;

        // Template
        $template = get_page_template_slug($post_id) ?: 'default';

        // Rendered content (the saved content)
        $rendered = apply_filters('the_content', $content);

        // Related posts (same category, exclude self)
        $related = [];
        if (!empty($categories) && !is_wp_error($categories)) {
            $cat_ids = wp_get_post_categories($post_id);
            if (!empty($cat_ids)) {
                $related_posts = get_posts([
                    'category__in' => $cat_ids,
                    'post__not_in' => [$post_id],
                    'numberposts' => 5,
                    'post_status' => 'publish',
                ]);
                foreach ($related_posts as $rp) {
                    $related[] = [
                        'id' => $rp->ID,
                        'title' => $rp->post_title,
                        'excerpt' => wp_trim_words($rp->post_content, 30, '...'),
                        'url' => get_permalink($rp->ID),
                    ];
                }
            }
        }

        return [
            'id' => $post_id,
            'title' => $post->post_title,
            'content' => $content,
            'content_source' => $content_source,
            'rendered' => $rendered,
            'excerpt' => $post->post_excerpt ?: wp_trim_words($content, 55, '...'),
            'status' => $post->post_status,
            'type' => $post->post_type,
            'slug' => $post->post_name,
            // Whether a password protects the post; the password itself is a
            // secret and never leaves the site (2026-09-22).
            'password_protected' => is_string($post->post_password) && $post->post_password !== '',
            'date' => $post->post_date,
            'modified' => $post->post_modified,
            'author' => get_the_author_meta('display_name', $post->post_author),
            'template' => $template,
            'categories' => is_wp_error($categories) ? [] : $categories,
            'tags' => is_wp_error($tags) ? [] : $tags,
            'featured_image' => $featured,
            'meta' => $meta,
            'related_posts' => $related,
            'word_count' => str_word_count(wp_strip_all_tags($content)),
        ];
    }

    /**
     * Get lightweight summary of all content for site-wide awareness.
     */
    public function webhook_get_content_summary($params) {
        $post_type = $params['post_type'] ?? 'any';
        $status = $params['status'] ?? 'any';
        $limit = min((int) ($params['limit'] ?? 100), 500);

        $query_args = [
            'numberposts' => $limit,
            'post_status' => $status,
            'orderby' => 'date',
            'order' => 'DESC',
        ];

        if ($post_type === 'any') {
            $query_args['post_type'] = ['post', 'page'];
        } else {
            $query_args['post_type'] = $post_type;
        }

        $posts = get_posts($query_args);
        $results = [];

        foreach ($posts as $p) {
            $content = wp_strip_all_tags($p->post_content);
            $has_images = preg_match('/<img\s/i', $p->post_content) === 1
                       || preg_match('/wp:image/i', $p->post_content) === 1;

            $cats = wp_get_post_categories($p->ID, ['fields' => 'names']);

            $results[] = [
                'id' => $p->ID,
                'title' => $p->post_title,
                'type' => $p->post_type,
                'status' => $p->post_status,
                'slug' => $p->post_name,
                'date' => $p->post_date,
                'word_count' => str_word_count($content),
                'has_images' => $has_images,
                'has_featured_image' => has_post_thumbnail($p->ID),
                'categories' => is_wp_error($cats) ? [] : $cats,
                'excerpt' => wp_trim_words($content, 20, '...'),
            ];
        }

        return [
            'items' => $results,
            'count' => count($results),
            'truncated' => count($results) >= $limit,
        ];
    }

    /**
     * Get global styles (user customizations layer), as saved.
     */
    public function webhook_get_global_styles() {
        if (!function_exists('wp_get_global_styles')) {
            return ['content' => null, 'source' => 'not_available'];
        }

        // Find the global styles post
        $query = new \WP_Query([
            'post_type'      => 'wp_global_styles',
            'posts_per_page' => 1,
            'post_status'    => ['publish', 'draft'],
            'tax_query'      => [[
                'taxonomy' => 'wp_theme',
                'field'    => 'name',
                'terms'    => get_stylesheet(),
            ]],
            'no_found_rows' => true,
        ]);

        if (empty($query->posts)) {
            return ['content' => null, 'post_id' => 0, 'source' => 'none'];
        }

        $post = $query->posts[0];
        $post_id = $post->ID;

        return [
            'content'        => $post->post_content,
            'content_source' => 'saved',
            'post_id'        => $post_id,
            'theme'          => get_stylesheet(),
        ];
    }

    /**
     * Execute command action (uses existing execute_command method)
     */
    public function webhook_execute_command($params) {
        // Handle multiple parameter formats:
        // 1. { command: "name", args: {...} } — standard format
        // 2. { command: { command: "name", args: {...} } } — nested from wp_command_generator
        // 3. Entire wp_command_generator result passed as params
        $command = $params['command'] ?? '';
        $args = $params['args'] ?? [];

        // If command is an object (wp_command_generator result passed directly)
        if (is_array($command)) {
            $args = $command['args'] ?? [];
            $command = $command['command'] ?? '';
        }

        // If command is still empty, check if this IS a wp_command_generator result
        if (empty($command) && !empty($params['type']) && $params['type'] === 'wp_command') {
            $command = $params['command'] ?? '';
            $args = $params['args'] ?? [];
        }

        if (empty($command)) {
            throw new Exception('command parameter is required');
        }

        return $this->execute_command($command, $args);
    }
    

    /**
     * Update theme option action
     */
    /**
     * Refuse the security-critical / plugin-internal options a site-hijack or
     * privilege-escalation targets, and the store currency. Shared by
     * update_option and update_theme_option.
     */
    private function assert_option_writable($option_name) {
        // The core options every option command refuses (one list, with the
        // roles option under this site's table prefix), and on this
        // single-option path rewrite_rules too.
        if (WebMaven_Self_Protect::is_core_protected_option($option_name)
            || (is_scalar($option_name) && strtolower(trim((string) $option_name)) === 'rewrite_rules')) {
            throw new Exception('Cannot modify protected option: ' . $option_name);
        }
        // WPMaven's own options and the whole plugin-state set (active_plugins,
        // active_sitewide_plugins, recently_activated, and with WPMaven Agent
        // the options that decide updates), plus the edge key and primary host. This is
        // the one list every command path asks; these two action handlers each
        // carried their own shorter copy of it before 2026-09-22, so writing
        // active_sitewide_plugins could network-deactivate WPMaven.
        if (WebMaven_Self_Protect::is_protected_option($option_name)) {
            throw new Exception('Cannot modify protected option: ' . $option_name);
        }
        // The store currency relabels every price in the store: only the
        // Store currency setting changes it (2026-09-30).
        if (WebMaven_Self_Protect::is_store_currency_option($option_name)) {
            throw new Exception(WebMaven_Self_Protect::STORE_CURRENCY_REFUSAL);
        }
        // Only the options on WPMaven's list; another plugin's are WPMaven Agent's.
        WebMaven_Option_Allowlist::check($option_name);
    }

    public function webhook_update_theme_option($params) {
        if (empty($params['option_name'])) {
            throw new Exception('option_name parameter is required');
        }
        if (!isset($params['option_value'])) {
            throw new Exception('option_value parameter is required');
        }

        $option_name = $params['option_name'];
        $option_value = $params['option_value'];

        // The same guard as update_option: siteurl, users_can_register,
        // default_role, active_plugins and the other options a site-hijack or
        // privilege-escalation targets are refused.
        $this->assert_option_writable($option_name);
        $result = update_option($option_name, $option_value);

        return [
            'option_name' => $option_name,
            'updated' => $result,
            'value' => $option_value
        ];
    }

    /**
     * Update option with security restrictions
     * Blocks sensitive WordPress options from being modified via webhook
     */
    public function webhook_update_option($params) {
        if (empty($params['option']) && empty($params['option_name'])) {
            throw new Exception('option parameter is required');
        }
        if (!isset($params['value']) && !isset($params['option_value'])) {
            throw new Exception('value parameter is required');
        }

        $option_name = $params['option'] ?? $params['option_name'];
        $option_value = $params['value'] ?? $params['option_value'];

        // Security: the security-critical options, WPMaven's own options and
        // the plugin-state set (see assert_option_writable — one guard, one
        // list, shared with update_theme_option).
        $this->assert_option_writable($option_name);

        // RAW keys (wm_posts_tpl / wm_posts_imgs) are stored without content
        // sanitization — see WebMaven_WordPress_Commands::RAW_OPTION_KEYS.
        if (in_array($option_name, WebMaven_WordPress_Commands::RAW_OPTION_KEYS, true)) {
            $option_value = WebMaven_WordPress_Commands::prepare_raw_option_value($option_name, $option_value);
        }

        $result = update_option($option_name, $option_value);

        return [
            'option' => $option_name,
            'updated' => $result,
            'value' => $option_value
        ];
    }

    /**
     * Test functionality action
     */
    public function webhook_test_functionality($params) {
        if (empty($params['test_type'])) {
            throw new Exception('test_type parameter is required');
        }
        
        $test_type = $params['test_type'];
        
        switch ($test_type) {
            case 'theme_loading':
                $active_theme = wp_get_theme();
                return [
                    'test_type' => $test_type,
                    'success' => true,
                    'active_theme' => $active_theme->get('Name'),
                    'theme_version' => $active_theme->get('Version')
                ];
                
            case 'plugin_functionality':
                $plugins = get_plugins();
                return [
                    'test_type' => $test_type,
                    'success' => true,
                    'plugins_count' => count($plugins),
                    'active_plugins' => get_option('active_plugins', [])
                ];
                
            case 'database_connection':
                global $wpdb;
                $result = $wpdb->get_var("SELECT 1");
                // The database name is half of a direct connection, and the
                // one value site_database_read redacts from every row; this
                // free read handed it back until 2026-09-22. The server
                // version is not a credential.
                $out = [
                    'test_type' => $test_type,
                    'success' => $result === '1',
                ];
                if (is_object($wpdb) && method_exists($wpdb, 'db_version')) {
                    $version = $wpdb->db_version();
                    if (is_string($version) && $version !== '') {
                        $out['server_version'] = $version;
                    }
                }
                return $out;
                
            default:
                throw new Exception("Unknown test type: {$test_type}");
        }
    }

    /**
     * Create a page via webhook
     * Wrapper around create_post with post_type=page
     */
    public function webhook_create_page($params) {
        // Map page parameters to post parameters
        $post_params = [
            'title' => $params['title'] ?? 'New Page',
            'content' => $params['content'] ?? '',
            'status' => $params['status'] ?? 'draft',
            'post_type' => 'page'
        ];

        // Optional parameters
        if (isset($params['slug'])) {
            $post_params['post_name'] = sanitize_title($params['slug']);

            // Remove default WordPress draft/auto-draft pages that would cause slug collision
            $requested_slug = sanitize_title($params['slug']);
            $existing_page = get_page_by_path($requested_slug);
            // Never delete one of WooCommerce's own pages, even as a draft, and
            // never delete anything on a site whose existing content is
            // protected (protect_existing: the owner's drafts stay).
            // WordPress's untouched privacy draft is replaced in place instead
            // (create_post), so the privacy page keeps its id.
            if (empty($params['protect_existing']) && empty($params['candidate']) && $existing_page && in_array($existing_page->post_status, ['draft', 'auto-draft'])
                && !(class_exists('WebMaven_Default_Content') && WebMaven_Default_Content::untouched_kind($existing_page) !== null)
                && !in_array((int) $existing_page->ID, $this->woocommerce_page_ids(), true)) {
                WebMaven_Log::write("[WebMaven Page] Removing default draft page '{$requested_slug}' (ID: {$existing_page->ID}) to claim slug");
                wp_delete_post($existing_page->ID, true);
            }
        }
        if (isset($params['excerpt'])) {
            $post_params['excerpt'] = $params['excerpt'];
        }
        if (isset($params['parent'])) {
            $post_params['post_parent'] = intval($params['parent']);
        }
        if (isset($params['template'])) {
            $post_params['page_template'] = $params['template'];
        }
        if (isset($params['menu_order'])) {
            $post_params['menu_order'] = intval($params['menu_order']);
        }
        // Opt-in upsert-by-slug: an existing published page with this slug is
        // updated in place instead of spawning a -2 sibling (see create_post).
        if (!empty($params['upsert'])) {
            $post_params['upsert'] = true;
        }
        // A connected site (the owner's existing WordPress): the first build
        // leaves the owner's pages alone and saves its version as a draft
        // (see create_post, 2026-09-22).
        if (!empty($params['protect_existing'])) {
            $post_params['protect_existing'] = true;
        }
        // A new design's page waits as a draft for the design switch (see create_post).
        if (!empty($params['candidate'])) {
            $post_params['candidate'] = true;
        }
        // The planned page this is, and when WPMaven last wrote it (a publish
        // run again parks a page edited since): see create_post.
        if (isset($params['wm_page']) && is_string($params['wm_page']) && $params['wm_page'] !== '') {
            $post_params['wm_page'] = $params['wm_page'];
        }
        if (isset($params['if_unmodified_since']) && is_string($params['if_unmodified_since'])) {
            $post_params['if_unmodified_since'] = $params['if_unmodified_since'];
        }
        // Optional fullhtml flag (default true, see create_post): explicit
        // false keeps wpautop formatting for regular prose pages.
        if (isset($params['fullhtml'])) {
            $post_params['fullhtml'] = (bool) $params['fullhtml'];
        }
        // The page's featured image (2026-09-24), which create_post sets: the
        // library id of the image the API copied with this change, or a web
        // address the site downloads. Anything else is ignored.
        if (!empty($params['featured_image_id']) && intval($params['featured_image_id']) > 0) {
            $post_params['featured_image_id'] = intval($params['featured_image_id']);
        } elseif (!empty($params['featured_image_url']) && is_string($params['featured_image_url'])
            && preg_match('#^https?://#i', $params['featured_image_url'])) {
            $post_params['featured_image_url'] = esc_url_raw($params['featured_image_url']);
        }

        // Create the page using the existing create_post method
        $requested_slug = $params['slug'] ?? null;
        WebMaven_Log::write("[WebMaven Page] Creating page: title='{$post_params['title']}', requested_slug='{$requested_slug}', content_length=" . strlen($post_params['content'] ?? ''));

        $result = $this->create_post($post_params);

        // Log the actual result
        $actual_slug = $result['post_slug'] ?? 'unknown';
        WebMaven_Log::write("[WebMaven Page] Page created: ID={$result['post_id']}, actual_slug='{$actual_slug}'");

        if ($requested_slug && $actual_slug !== $requested_slug && $actual_slug !== sanitize_title($requested_slug)) {
            WebMaven_Log::write("[WebMaven Page] WARNING: Slug mismatch! Requested: '{$requested_slug}', Got: '{$actual_slug}'");
        }

        // Log content preview for debugging
        $content_preview = substr($post_params['content'] ?? '', 0, 200);
        $has_html_sections = strpos($post_params['content'] ?? '', '<section') !== false;
        $has_container = strpos($post_params['content'] ?? '', 'class="container"') !== false;
        WebMaven_Log::write("[WebMaven Page] Content analysis: has_sections={$has_html_sections}, has_container={$has_container}, preview='{$content_preview}'");

        // Handle meta description if provided
        if (isset($params['meta_description']) && !empty($result['post_id'])) {
            update_post_meta($result['post_id'], '_yoast_wpseo_metadesc', $params['meta_description']);
            // Also set generic meta description for non-Yoast sites
            update_post_meta($result['post_id'], '_meta_description', $params['meta_description']);
        }

        return $result;
    }

    /**
     * Upload media file via webhook
     * Handles base64-encoded image data with metadata
     */
    public function webhook_upload_media($params) {
        if (empty($params['content']) && empty($params['file_content'])) {
            throw new Exception('Media content is required (content or file_content parameter)');
        }
        if (empty($params['filename'])) {
            throw new Exception('Filename is required');
        }

        if (!current_user_can('upload_files')) {
            throw new Exception('Insufficient permissions to upload files');
        }

        // Get base64 content (support both parameter names)
        $base64_content = $params['content'] ?? $params['file_content'];

        // Decode first, validate before writing to disk
        $decoded = base64_decode($base64_content);
        if ($decoded === false) {
            throw new Exception('Invalid base64 content');
        }

        // Check decoded size (10MB max)
        if (strlen($decoded) > 10 * 1024 * 1024) {
            throw new Exception('File exceeds 10MB size limit');
        }

        // Validate MIME type using finfo
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $detected_mime = $finfo->buffer($decoded);
        $allowed_mimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
        if (!in_array($detected_mime, $allowed_mimes, true)) {
            throw new Exception("File type not allowed: {$detected_mime}");
        }

        // An SVG is an XML document that can carry
        // <script>, event handlers, javascript: URLs, <foreignObject>/<iframe>
        // or an external entity, so a stored SVG is stored XSS when opened as a
        // top-level document. Keep static-logo SVGs working but reject any active
        // or external content (denylist; behind the signed webhook).
        if ($detected_mime === 'image/svg+xml') {
            $bad = preg_match('/<\s*(script|foreignObject|iframe|embed|object)\b/i', $decoded)
                || preg_match('/\son\w+\s*=/i', $decoded)
                || preg_match('/javascript\s*:/i', $decoded)
                || preg_match('/data\s*:\s*(text\/html|image\/svg)/i', $decoded)
                || preg_match('/<!\s*(ENTITY|DOCTYPE)/i', $decoded);
            if ($bad) {
                throw new Exception('SVG contains active or external content and was rejected');
            }
        }

        // Create temporary file AFTER validation
        $temp_file = wp_tempnam($params['filename']);
        file_put_contents($temp_file, $decoded);

        // Determine mime type from filename or parameters
        $mime_type = $params['mime_type'] ?? '';
        if (empty($mime_type)) {
            $extension = strtolower(pathinfo($params['filename'], PATHINFO_EXTENSION));
            $mime_types = [
                'jpg' => 'image/jpeg',
                'jpeg' => 'image/jpeg',
                'png' => 'image/png',
                'gif' => 'image/gif',
                'webp' => 'image/webp',
                'svg' => 'image/svg+xml'
            ];
            $mime_type = $mime_types[$extension] ?? 'application/octet-stream';
        }

        // Prepare file array for wp_handle_sideload
        $file_array = [
            'name' => $params['filename'],
            'tmp_name' => $temp_file,
            'type' => $mime_type,
            'error' => 0,
            'size' => filesize($temp_file)
        ];

        // Use wp_handle_sideload instead of wp_handle_upload for programmatic uploads
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';

        // WordPress rejects .svg uploads by default (get_allowed_mime_types()
        // excludes SVG), so wp_handle_sideload would refuse our sanitized brand
        // logo with "file type not permitted" — silently losing custom_logo.
        // Pass an explicit mimes allowlist for THIS sideload and, for SVG, force
        // the ext/type so wp_check_filetype_and_ext doesn't second-guess the
        // real-mime across libmagic versions. Filter is removed right after, so
        // we never globally enable SVG uploads in the media library.
        $sideload_mimes = [
            'jpg|jpeg|jpe' => 'image/jpeg',
            'png'          => 'image/png',
            'gif'          => 'image/gif',
            'webp'         => 'image/webp',
            'svg'          => 'image/svg+xml',
        ];
        $svg_filetype_fix = static function ($data, $file, $filename, $allowed_mimes) {
            if (preg_match('/\.svg$/i', (string) $filename)) {
                $data['ext']  = 'svg';
                $data['type'] = 'image/svg+xml';
                if (empty($data['proper_filename'])) {
                    $data['proper_filename'] = $filename;
                }
            }
            return $data;
        };
        add_filter('wp_check_filetype_and_ext', $svg_filetype_fix, 10, 4);
        $upload = wp_handle_sideload($file_array, ['test_form' => false, 'mimes' => $sideload_mimes]);
        remove_filter('wp_check_filetype_and_ext', $svg_filetype_fix, 10);

        if (isset($upload['error'])) {
            wp_delete_file($temp_file);
            throw new Exception('Upload failed: ' . $upload['error']);
        }

        // Create attachment
        $attachment = [
            'post_mime_type' => $upload['type'],
            'post_title' => $params['title'] ?? sanitize_file_name(pathinfo($params['filename'], PATHINFO_FILENAME)),
            'post_content' => $params['description'] ?? '',
            'post_excerpt' => $params['caption'] ?? '',
            'post_status' => 'inherit'
        ];

        $attachment_id = wp_insert_attachment($attachment, $upload['file']);

        if (is_wp_error($attachment_id)) {
            throw new Exception('Failed to create attachment: ' . $attachment_id->get_error_message());
        }

        // Generate attachment metadata (thumbnails, etc.)
        $attachment_data = wp_generate_attachment_metadata($attachment_id, $upload['file']);
        wp_update_attachment_metadata($attachment_id, $attachment_data);

        // Set alt text if provided
        if (!empty($params['alt'])) {
            update_post_meta($attachment_id, '_wp_attachment_image_alt', $params['alt']);
        }

        // The name the API uploaded the file under ("story-farm.png", a
        // genstudio asset), so wm_ledger_probe finds it again by that name
        // whatever WordPress renamed the file to.
        update_post_meta($attachment_id, '_wm_asset_name', sanitize_text_field((string) $params['filename']));

        // Get all image sizes
        $sizes = [];
        if (wp_attachment_is_image($attachment_id)) {
            $image_sizes = ['thumbnail', 'medium', 'medium_large', 'large', 'full'];
            foreach ($image_sizes as $size) {
                $image_src = wp_get_attachment_image_src($attachment_id, $size);
                if ($image_src) {
                    $sizes[$size] = [
                        'url' => $image_src[0],
                        'width' => $image_src[1],
                        'height' => $image_src[2]
                    ];
                }
            }
        }

        return [
            'success' => true,
            'id' => $attachment_id,
            'url' => $upload['url'],
            'file' => $upload['file'],
            'mime_type' => $upload['type'],
            'title' => get_the_title($attachment_id),
            'alt' => get_post_meta($attachment_id, '_wp_attachment_image_alt', true),
            'sizes' => $sizes
        ];
    }

    /**
     * Discover plugin details and capabilities
     * Returns information about installed plugins and their features
     */
    public function webhook_discover_plugin_details($params) {
        $plugin_slug = $params['plugin_slug'] ?? $params['slug'] ?? '';

        if (!function_exists('get_plugins')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }

        $all_plugins = get_plugins();
        $active_plugins = get_option('active_plugins', []);

        // If specific plugin requested
        if (!empty($plugin_slug)) {
            $plugin_details = null;
            $plugin_file = null;

            foreach ($all_plugins as $file => $data) {
                // Match by slug (folder name) or by plugin file
                $folder = dirname($file);
                if ($folder === '.' ) {
                    $folder = basename($file, '.php');
                }
                if ($folder === $plugin_slug || $file === $plugin_slug || strpos($file, $plugin_slug) !== false) {
                    $plugin_file = $file;
                    $plugin_details = $data;
                    break;
                }
            }

            if (!$plugin_details) {
                return [
                    'success' => false,
                    'error' => "Plugin not found: {$plugin_slug}",
                    'installed_plugins' => array_keys($all_plugins)
                ];
            }

            $is_active = in_array($plugin_file, $active_plugins);

            // Try to discover plugin-specific capabilities
            $capabilities = $this->discover_plugin_capabilities($plugin_slug, $plugin_file, $is_active);

            return [
                'success' => true,
                'plugin' => [
                    'name' => $plugin_details['Name'] ?? '',
                    'slug' => $plugin_slug,
                    'version' => $plugin_details['Version'] ?? '',
                    'description' => $plugin_details['Description'] ?? '',
                    'author' => $plugin_details['Author'] ?? '',
                    'plugin_file' => $plugin_file,
                    'is_active' => $is_active,
                    'capabilities' => $capabilities
                ]
            ];
        }

        // Return all installed plugins with rich capability data
        $plugins_list = [];
        foreach ($all_plugins as $file => $data) {
            $folder = dirname($file);
            if ($folder === '.') {
                $folder = basename($file, '.php');
            }
            $is_active = in_array($file, $active_plugins);
            $plugin_entry = [
                'name' => $data['Name'] ?? '',
                'slug' => $folder,
                'version' => $data['Version'] ?? '',
                'description' => wp_strip_all_tags($data['Description'] ?? ''),
                'is_active' => $is_active,
            ];
            if ($is_active) {
                $caps = $this->discover_plugin_capabilities($folder, $file, true);
                $plugin_entry['shortcodes'] = array_values(array_unique($caps['shortcodes'] ?? []));
                $plugin_entry['blocks'] = $caps['blocks'] ?? [];
                $plugin_entry['supports'] = $caps['supports'] ?? [];
            }
            $plugins_list[] = $plugin_entry;
        }

        // Scan all registered shortcodes (gives us tags even for plugins we don't hardcode)
        $all_shortcodes = $this->discover_all_shortcodes($all_plugins, $active_plugins);

        // Scan all registered blocks (non-core)
        $all_blocks = $this->discover_all_blocks();

        // List available resource creation actions
        $resource_actions = ['create_form'];
        if (class_exists('WC_Product')) {
            $resource_actions[] = 'woocommerce_create_product';
        }

        return [
            'success' => true,
            'plugins' => $plugins_list,
            'shortcodes' => $all_shortcodes,
            'blocks' => $all_blocks,
            'resource_actions' => $resource_actions,
            'count' => count($plugins_list)
        ];
    }

    /**
     * Discover capabilities for specific plugins
     */
    public function discover_plugin_capabilities($slug, $plugin_file, $is_active) {
        $capabilities = [
            'shortcodes' => [],
            'blocks' => [],
            'widgets' => [],
            'settings_page' => null,
            'supports' => []
        ];

        if (!$is_active) {
            return $capabilities;
        }

        // Common plugin capability mappings
        $plugin_capabilities = [
            'elementor' => [
                'supports' => ['page_builder', 'widgets', 'templates'],
                'settings_page' => 'elementor'
            ],
            'wpforms' => [
                'shortcodes' => ['wpforms'],
                'blocks' => ['wpforms/form-selector'],
                'supports' => ['forms', 'drag_drop_builder']
            ],
            'wpforms-lite' => [
                'shortcodes' => ['wpforms'],
                'blocks' => ['wpforms/form-selector'],
                'supports' => ['forms', 'drag_drop_builder']
            ],
            'contact-form-7' => [
                'shortcodes' => ['contact-form-7', 'contact-form'],
                'supports' => ['forms']
            ],
            'woocommerce' => [
                'shortcodes' => ['products', 'product', 'product_page', 'product_category', 'add_to_cart', 'cart', 'checkout'],
                'supports' => ['ecommerce', 'products', 'cart', 'checkout', 'payments']
            ],
            'yoast' => [
                'supports' => ['seo', 'meta_tags', 'sitemap', 'breadcrumbs']
            ],
            'wordpress-seo' => [
                'supports' => ['seo', 'meta_tags', 'sitemap', 'breadcrumbs']
            ],
            'wp-smushit' => [
                'supports' => ['image_optimization', 'lazy_loading', 'webp']
            ],
            'smush' => [
                'supports' => ['image_optimization', 'lazy_loading', 'webp']
            ]
        ];

        if (isset($plugin_capabilities[$slug])) {
            $capabilities = array_merge($capabilities, $plugin_capabilities[$slug]);
        }

        // Try to discover shortcodes registered by the plugin
        global $shortcode_tags;
        if (!empty($shortcode_tags)) {
            foreach ($shortcode_tags as $tag => $callback) {
                // Check if callback is related to this plugin
                if (is_array($callback) && is_object($callback[0])) {
                    $class_name = get_class($callback[0]);
                    if (stripos($class_name, str_replace('-', '', $slug)) !== false) {
                        $capabilities['shortcodes'][] = $tag;
                    }
                }
            }
        }

        return $capabilities;
    }

    /**
     * Scan all registered shortcodes and map them to their owning plugin.
     */
    public function discover_all_shortcodes($all_plugins, $active_plugins) {
        global $shortcode_tags;
        if (empty($shortcode_tags)) return [];

        // WordPress core shortcodes to skip
        $core_tags = ['gallery', 'caption', 'embed', 'wp_caption', 'audio', 'video', 'playlist'];

        // Build a map: class-file → plugin slug
        $plugin_dir = WP_PLUGIN_DIR . '/';
        $class_to_slug = [];

        $shortcodes = [];
        foreach ($shortcode_tags as $tag => $callback) {
            if (in_array($tag, $core_tags, true)) continue;

            $plugin_slug = null;

            // Resolve callback to a file path, then match to plugin directory
            try {
                if (is_array($callback) && is_object($callback[0])) {
                    $ref = new ReflectionClass($callback[0]);
                    $file = $ref->getFileName();
                } elseif (is_string($callback) && function_exists($callback)) {
                    $ref = new ReflectionFunction($callback);
                    $file = $ref->getFileName();
                } else {
                    $file = null;
                }

                if ($file && strpos($file, $plugin_dir) === 0) {
                    $relative = substr($file, strlen($plugin_dir));
                    $parts = explode('/', $relative);
                    $plugin_slug = $parts[0] ?? null;
                }
            } catch (Exception $e) {
                // Reflection failed — skip
            }

            $shortcodes[] = [
                'tag' => $tag,
                'plugin' => $plugin_slug,
            ];
        }

        return $shortcodes;
    }

    /**
     * Scan all registered Gutenberg blocks (non-core).
     */
    public function discover_all_blocks() {
        if (!class_exists('WP_Block_Type_Registry')) return [];

        $registry = WP_Block_Type_Registry::get_instance();
        $blocks = [];

        foreach ($registry->get_all_registered() as $name => $block) {
            // Skip core blocks
            if (strpos($name, 'core/') === 0) continue;

            $blocks[] = [
                'name' => $name,
                'title' => $block->title ?? $name,
                'description' => $block->description ?? '',
                'category' => $block->category ?? '',
                'plugin' => explode('/', $name)[0],
            ];
        }

        return $blocks;
    }

    /**
     * Check if WooCommerce is active
     */
    public function webhook_woocommerce_is_active() {
        $is_active = class_exists('WooCommerce') || in_array('woocommerce/woocommerce.php', apply_filters('active_plugins', get_option('active_plugins')));

        return [
            'success' => true,
            'active' => $is_active,
            'version' => $is_active && defined('WC_VERSION') ? WC_VERSION : null
        ];
    }

    /**
     * Get WooCommerce store currency
     */
    public function webhook_woocommerce_get_currency() {
        if (!function_exists('get_woocommerce_currency')) {
            return [
                'success' => false,
                'error' => 'WooCommerce is not active'
            ];
        }

        return [
            'success' => true,
            'currency' => get_woocommerce_currency(),
            'currency_symbol' => get_woocommerce_currency_symbol()
        ];
    }

    /**
     * Create a WooCommerce product
     *
     * Backward compatible: numeric `price` and the `categories` array keep
     * working exactly as before. Additive fields:
     * - price may be a display string ("$28", "€2,400", "28"): the amount is
     *   parsed out (see parse_display_price). The currency the string names
     *   is information only: this action never writes the store currency
     *   (2026-09-30; only the Store currency setting and the build's first
     *   set do, capabilities/store-currency.php). The result says which
     *   currency the store sells in (store_currency), which one the string
     *   named (price_currency), and currency_mismatch when they differ.
     * - category (singular): a name whose product_cat term is get-or-created
     *   by slug and assigned.
     * - category_description (2026-10-19): the words the design gives that
     *   category, written on its term only while it has no description of
     *   its own (the owner's words are never replaced); ignored when empty.
     * - options: declares a VARIABLE product — one attribute per option set,
     *   one variation per value combination, each variation priced base price
     *   plus the sum of its values' deltas.
     *   Shape: [{attribute: 'Size', values: ['S', {name: 'XL', delta: 4}]}]
     *
     * Upsert: re-applying a site must be idempotent, so a call whose product
     * already exists UPDATES it (same id, permalink and add-to-cart URL)
     * instead of creating a duplicate. The key is the SKU when one is sent,
     * otherwise the product name among the products this action created
     * (marked with _webmaven_product_key). A product without the marker
     * (made before the marker existed, or by hand) is adopted only when no
     * SKU is sent, no marked product matches, and it is the ONLY unmarked,
     * non-trashed product whose name is exactly the requested one (trimmed,
     * same case): it is marked and updated in place. Two or more such
     * products are ambiguous, so a new product is created, as before. A
     * variable product's variations follow the declared options: each one is
     * keyed by its attribute values (_wm_variant_key), a re-apply updates the
     * variations that still exist IN PLACE (same id, so anything mapped to a
     * variation keeps pointing at it), creates the new ones and deletes only
     * the ones no longer declared.
     * - menu_order: the catalog position (the designed card order).
     * - card_slots: {key: text} per-product card copy, stored as
     *   _wm_card_slot_<key> meta that the generated theme prints.
     * - pod: print-on-demand data, never shown on the site:
     *   {printful_product_id, technique, variants: [{options: {Color: 'Black',
     *   Size: 'M'}, printful_variant_id, files: [{placement, url, position}],
     *   artwork_hash}]}. Each variant lands as _wm_pod meta on the variation
     *   whose attribute values match its options (on the product itself for a
     *   simple product).
     * The result carries created: true|false, adopted: true|false and
     * variations: [{id, key, printful_variant_id}].
     * - slug: the product's design key (its slug in the site plan), kept as
     *   _wm_product_slug by every call that names it; a product is found by
     *   it after its SKU and before its name.
     * - media_only: true (a new design): see product_media_only().
     *
     * WPMaven's own catalog writer: it runs with the printed product guards
     * standing aside (WebMaven_Pod_Guards::trusted), since it writes the
     * print data and the options those guards keep.
     */
    public function webhook_woocommerce_create_product($params) {
        $params = is_array($params) ? $params : [];
        $run = function () use ($params) {
            return !empty($params['media_only']) ? $this->product_media_only($params) : $this->upsert_product($params);
        };
        return class_exists('WebMaven_Pod_Guards') ? WebMaven_Pod_Guards::trusted($run) : $run();
    }

    /**
     * A product category's description from the design (category_description),
     * set only while the term has none: a category page shows it under its
     * name. Limited HTML, at most 2,000 characters.
     */
    private function describe_product_category(int $term_id, $text): void {
        $text = is_string($text) ? trim($text) : '';
        if ($term_id <= 0 || $text === '') {
            return;
        }
        $term = get_term($term_id, 'product_cat');
        if (!$term || is_wp_error($term) || trim((string) $term->description) !== '') {
            return;
        }
        $text = function_exists('mb_substr') ? mb_substr($text, 0, 2000) : substr($text, 0, 2000);
        $text = trim(force_balance_tags(wp_kses_post($text)));
        if ($text !== '') {
            wp_update_term($term_id, 'product_cat', ['description' => $text]);
        }
    }

    /** woocommerce_create_product's upsert (see above). */
    private function upsert_product($params) {
        if (!function_exists('wc_get_product')) {
            return [
                'success' => false,
                'error' => 'WooCommerce is not active'
            ];
        }

        if (empty($params['name'])) {
            return [
                'success' => false,
                'error' => 'Product name is required'
            ];
        }

        try {
            $options = (!empty($params['options']) && is_array($params['options'])) ? $params['options'] : [];
            $is_variable = !empty($options) && class_exists('WC_Product_Variable');

            // Upsert: the product this call re-applies, if it exists; else,
            // without a SKU, the one unmarked product with exactly this name.
            $existing_id = $this->find_upsert_product_id($params);
            $adopted = false;
            // A connected site (the owner's existing WordPress, 2026-09-22):
            // with protect_existing the owner's own product with this name is
            // never adopted or rewritten. Ours is saved as a DRAFT beside it,
            // the answer names theirs (left_alone), and a build run again
            // updates that draft (found by its marker above).
            $protect = !empty($params['protect_existing']);
            $no_sku = trim((string) ($params['sku'] ?? '')) === '';
            $left_alone = null;
            if ($protect && $no_sku) {
                $theirs = $this->find_owner_product_id($params['name']);
                if ($theirs && $theirs !== $existing_id) {
                    $left_alone = [
                        'id' => $theirs,
                        'title' => trim((string) get_post_field('post_title', $theirs, 'raw')),
                        'status' => (string) get_post_status($theirs),
                    ];
                    if (!$existing_id) {
                        $params['status'] = 'draft';
                    }
                }
            } elseif (!$existing_id && $no_sku) {
                $existing_id = $this->find_adoptable_product_id($params['name']);
                $adopted = $existing_id > 0;
            }
            $previous = $existing_id ? wc_get_product($existing_id) : null;
            $was_variable = $previous && $previous->is_type('variable');
            $old_variation_ids = $was_variable ? array_map('intval', (array) $previous->get_children()) : [];

            // Price: numeric values keep the legacy path untouched; display
            // strings are parsed into amount + currency (the currency is
            // only reported back, never written).
            $base_price = null;
            $price_currency = null;
            if (isset($params['price'])) {
                if (is_numeric($params['price'])) {
                    $base_price = (float) $params['price'];
                } else {
                    $parsed = self::parse_display_price((string) $params['price']);
                    $base_price = $parsed['amount'];
                    $price_currency = $parsed['currency'];
                }
            }

            if ($existing_id) {
                // Loading the existing id into the class of the wanted type
                // converts it on save (WooCommerce rewrites product_type).
                $product = $is_variable ? new \WC_Product_Variable($existing_id) : new \WC_Product_Simple($existing_id);
                if ($was_variable && !$is_variable) {
                    // No longer variable: drop the option attributes.
                    $product->set_attributes([]);
                } elseif ($is_variable && !$was_variable) {
                    // Prices move onto the variations.
                    $product->set_regular_price('');
                    $product->set_sale_price('');
                }
            } else {
                $product = $is_variable ? new \WC_Product_Variable() : new \WC_Product_Simple();
            }

            $product->set_name($params['name']);
            // An update keeps the owner's status (a product they drafted stays
            // a draft) unless the call names one. A chat's product is sent as a
            // draft with keep_status_if_existing: the draft is for a new
            // product only, and a live product the call updates stays live.
            $keep_status = $existing_id && !empty($params['keep_status_if_existing']);
            if (!$keep_status && (!$existing_id || isset($params['status']))) {
                $product->set_status($params['status'] ?? 'publish');
            }

            // Virtual offerings (paid bookings sold as products): no shipping
            // fields at checkout. Mirrors the Playground mock driver.
            if (!empty($params['virtual'])) {
                $product->set_virtual(true);
            }

            // Prices live on the variations for variable products
            if (isset($params['regular_price']) && !$is_variable) {
                $product->set_regular_price($params['regular_price']);
            }
            if (isset($params['price']) && !$is_variable) {
                if (is_numeric($params['price'])) {
                    $product->set_regular_price($params['price']);
                } elseif ($base_price !== null) {
                    $product->set_regular_price((string) $base_price);
                }
            }
            if (isset($params['sale_price']) && !$is_variable) {
                $product->set_sale_price($params['sale_price']);
            }
            if (isset($params['description'])) {
                $product->set_description($params['description']);
            }
            if (isset($params['short_description'])) {
                $product->set_short_description($params['short_description']);
            }
            if (isset($params['sku'])) {
                $product->set_sku($params['sku']);
            }
            if (isset($params['stock_quantity'])) {
                $product->set_stock_quantity($params['stock_quantity']);
                $product->set_manage_stock(true);
            }

            // Handle categories
            $category_ids = [];
            if (!empty($params['categories'])) {
                foreach ((array) $params['categories'] as $cat_name) {
                    $term = get_term_by('name', $cat_name, 'product_cat');
                    if ($term) {
                        $category_ids[] = $term->term_id;
                    } else {
                        // Create the category
                        $new_term = wp_insert_term($cat_name, 'product_cat');
                        if (!is_wp_error($new_term)) {
                            $category_ids[] = $new_term['term_id'];
                        }
                    }
                }
            }
            // Singular category NAME (additive): get-or-create the product_cat
            // term by slug — the archive filter contract needs a real term.
            if (!empty($params['category'])) {
                $cat_slug = sanitize_title($params['category']);
                $term = term_exists($cat_slug, 'product_cat');
                if (!$term) {
                    $term = wp_insert_term(ucwords(str_replace('-', ' ', $cat_slug)), 'product_cat', ['slug' => $cat_slug]);
                }
                if (!is_wp_error($term)) {
                    $cat_id = (int) (is_array($term) ? $term['term_id'] : $term);
                    $category_ids[] = $cat_id;
                    $this->describe_product_category($cat_id, $params['category_description'] ?? '');
                }
            }
            if (!empty($category_ids)) {
                $product->set_category_ids(array_values(array_unique($category_ids)));
            }

            // Variable products: one attribute per declared option set
            if ($is_variable) {
                $attributes = [];
                foreach ($options as $option) {
                    $attribute = new \WC_Product_Attribute();
                    $attribute->set_name(sanitize_text_field($option['attribute'] ?? 'Option'));
                    $attribute->set_options(array_map(function ($value) {
                        return sanitize_text_field(is_array($value) ? ($value['name'] ?? '') : $value);
                    }, (array) ($option['values'] ?? [])));
                    $attribute->set_visible(true);
                    $attribute->set_variation(true);
                    $attributes[] = $attribute;
                }
                $product->set_attributes($attributes);
            }

            // Handle images. The product's photo comes by attachment id first
            // (image_id: the build uploaded it to this site's media library
            // already), so the site never downloads its own file again; the
            // URL in images[0] is the fallback for an older API. A product
            // keeps the photo it has unless the call names one. The answer
            // says whether the photo was set and, when not, why.
            $image_named = false;
            $image_set = false;
            $image_error = null;
            $named_id = isset($params['image_id']) && is_numeric($params['image_id']) ? (int) $params['image_id'] : 0;
            if ($named_id > 0) {
                $image_named = true;
                if (function_exists('wp_attachment_is_image') && wp_attachment_is_image($named_id)) {
                    $product->set_image_id($named_id);
                    $image_set = true;
                } else {
                    $image_error = "Attachment {$named_id} is not an image in this site's media library";
                }
            }
            if (!empty($params['images'])) {
                $image_ids = [];
                foreach ($params['images'] as $index => $image) {
                    $image_url = is_array($image) ? ($image['src'] ?? $image['url'] ?? '') : $image;
                    if ($index === 0 && $image_set) {
                        continue; // the photo is set by id already
                    }
                    if (!empty($image_url)) {
                        if ($index === 0) {
                            $image_named = true;
                        }
                        // Download and attach image (reusing the attachment
                        // an earlier apply made from the same URL)
                        $image_id = $this->product_image_id_from_url($image_url, $params['name']);
                        if ($image_id && !is_wp_error($image_id)) {
                            if ($index === 0) {
                                $product->set_image_id($image_id);
                                $image_set = true;
                                $image_error = null;
                            } else {
                                $image_ids[] = $image_id;
                            }
                        } else {
                            $error_msg = is_wp_error($image_id) ? $image_id->get_error_message() : 'null result';
                            WebMaven_Log::write("WebMaven: Failed to upload product image [{$index}] from URL '{$image_url}': {$error_msg}");
                            if ($index === 0) {
                                $image_error = $image_error !== null ? $image_error . '; ' . $error_msg : $error_msg;
                            }
                        }
                    }
                }
                if (!empty($image_ids)) {
                    $product->set_gallery_image_ids($image_ids);
                }
            }

            // The designed catalog position and card spec slots:
            // the theme's product card reads `_wm_card_slot_<key>` and Woo sorts
            // by menu_order; without these every product shows the same sample
            // card. The API forwards them (short_description already applied above).
            if (isset($params['menu_order']) && is_numeric($params['menu_order'])) {
                $product->set_menu_order((int) $params['menu_order']);
            }
            foreach ((array) ($params['card_slots'] ?? array()) as $wm_slot_key => $wm_slot_value) {
                $wm_slot_key = sanitize_key((string) $wm_slot_key);
                if ($wm_slot_key !== '') {
                    $product->update_meta_data('_wm_card_slot_' . $wm_slot_key, sanitize_text_field((string) $wm_slot_value));
                }
            }

            $product_id = $product->save();

            // Upsert marker: a later call for the same name finds this product.
            $upsert_key = self::product_upsert_key($params['name']);
            if ($upsert_key !== '') {
                update_post_meta($product_id, self::PRODUCT_KEY_META, $upsert_key);
            }
            // The design key: a new design finds the product by it, whatever its name becomes.
            $design_key = self::design_key_from_params($params);
            if ($design_key !== '') {
                update_post_meta($product_id, self::DESIGN_KEY_META, $design_key);
            }

            // An own product (the owner makes and ships it): its listing is a
            // sample until they make it real. The marker follows every call.
            if (!empty($params['sample'])) {
                update_post_meta($product_id, self::SAMPLE_META, '1');
            } else {
                delete_post_meta($product_id, self::SAMPLE_META);
            }

            // Print-on-demand data (product level).
            $pod = self::pod_from_params($params['pod'] ?? null);
            if ($pod !== null) {
                update_post_meta($product_id, self::POD_PRODUCT_META, wp_json_encode([
                    'printful_product_id' => $pod['printful_product_id'],
                    'technique' => $pod['technique'],
                ]));
                if (!$is_variable && isset($pod['variants'][''])) {
                    update_post_meta($product_id, self::POD_META, wp_json_encode($pod['variants']['']));
                }
            }

            // The variations already there, by key: the stored key, else the
            // key of their attributes (variations made before the key
            // existed). A product that is no longer variable, or a duplicate
            // key, loses them.
            $kept_variations = [];
            foreach ($old_variation_ids as $old_variation_id) {
                $old_variation = wc_get_product($old_variation_id);
                if (!$old_variation) {
                    continue;
                }
                $old_key = (string) get_post_meta($old_variation_id, self::VARIANT_KEY_META, true);
                if ($old_key === '') {
                    $old_key = self::variation_key((array) $old_variation->get_attributes());
                }
                if ($is_variable && !isset($kept_variations[$old_key])) {
                    $kept_variations[$old_key] = $old_variation;
                } else {
                    $old_variation->delete(true);
                }
            }

            // Variable products: one variation per value combination, priced
            // base + the sum of the combination's deltas. A variation that
            // already exists is updated in place (same id); the owner's
            // status for it is kept.
            $variations_out = [];
            // Images per option (usually per color): each entry resolved once.
            $variation_images = [];
            foreach (self::variation_images_from_params($params['variation_images'] ?? null) as $entry) {
                $image_id = $entry['image_id'];
                if ($image_id === null && $entry['image_url'] !== null) {
                    $image_id = $this->product_image_id_from_url($entry['image_url'], $params['name']);
                    if (!$image_id || is_wp_error($image_id)) {
                        WebMaven_Log::write("WebMaven: Failed to upload variation image from URL '{$entry['image_url']}'");
                        $image_id = null;
                    }
                }
                if ($image_id) {
                    $variation_images[] = ['options' => $entry['options'], 'image_id' => (int) $image_id];
                }
            }
            if ($is_variable) {
                $combos = $this->build_option_combinations($options);
                // A printed product sells only what the print partner makes:
                // not every color comes in every size, and checkout refuses a
                // combination it cannot print. Those are not offered (one an
                // earlier call made goes with the combinations no longer
                // declared). When no combination maps at all (names that do
                // not match), every one stays, as before.
                $printable = null;
                if ($pod !== null && !empty($pod['variants'])) {
                    foreach ($combos as $combo) {
                        $key = self::variation_key(array_column($combo, 'value', 'attr'));
                        if (isset($pod['variants'][$key])) {
                            $printable[$key] = true;
                        }
                    }
                }
                foreach ($combos as $combo) {
                    $attr_map = [];
                    $delta = 0.0;
                    foreach ($combo as $part) {
                        $attr_map[$part['attr']] = $part['value'];
                        $delta += $part['delta'];
                    }
                    $key = self::variation_key($attr_map);
                    if ($printable !== null && !isset($printable[$key])) {
                        continue;
                    }
                    $variation = $kept_variations[$key] ?? null;
                    unset($kept_variations[$key]);
                    $is_new_variation = $variation === null;
                    if ($is_new_variation) {
                        $variation = new \WC_Product_Variation();
                        $variation->set_parent_id($product_id);
                    }
                    $variation->set_attributes($attr_map);
                    if ($base_price !== null) {
                        $variation->set_regular_price((string) ($base_price + $delta));
                    }
                    if (!empty($params['virtual'])) {
                        $variation->set_virtual(true);
                    }
                    if ($is_new_variation) {
                        $variation->set_status('publish');
                    }
                    // The first given image whose options this variation has;
                    // an image already set stays when none is given for it.
                    $variation_image = self::variation_image_for($attr_map, $variation_images);
                    if ($variation_image !== null) {
                        $variation->set_image_id($variation_image);
                    }
                    $variation_id = $variation->save();
                    update_post_meta($variation_id, self::VARIANT_KEY_META, $key);
                    $variant_pod = $pod['variants'][$key] ?? null;
                    if ($variant_pod !== null) {
                        update_post_meta($variation_id, self::POD_META, wp_json_encode($variant_pod));
                    } elseif ($pod !== null || (string) get_post_meta($variation_id, self::POD_META, true) !== '') {
                        update_post_meta($variation_id, self::POD_META, '');
                    }
                    $variations_out[] = [
                        'id' => $variation_id,
                        'key' => $key,
                        'printful_variant_id' => $variant_pod['printful_variant_id'] ?? null,
                        'image_id' => method_exists($variation, 'get_image_id') ? ((int) $variation->get_image_id() ?: null) : null,
                    ];
                }
                // Combinations no longer declared.
                foreach ($kept_variations as $gone) {
                    $gone->delete(true);
                }
                if (method_exists('WC_Product_Variable', 'sync')) {
                    \WC_Product_Variable::sync($product_id);
                }
            }

            // WooCommerce has ONE currency for the whole store, and a price
            // string never changes it (2026-09-30). Before, the first product
            // of a store adopted the symbol it was written with, and "$"
            // turned a euro store into a dollar store (every "CA$" or "A$"
            // too). The store currency comes only from the business's Store
            // currency (capabilities/store-currency.php); a price naming
            // another currency is reported, and its number kept as sent.
            $store_currency = strtoupper(trim((string) get_option('woocommerce_currency', '')));
            $currency_mismatch = $price_currency !== null && $store_currency !== $price_currency;
            if ($currency_mismatch) {
                WebMaven_Log::write("[WebMaven Product] Price names {$price_currency} but the store sells in " . ($store_currency !== '' ? $store_currency : 'no currency') . '; store currency kept.');
            }

            // Re-read so slug/price reflect what was persisted (incl. variations)
            $product = wc_get_product($product_id) ?: $product;
            $add_to_cart_url = $product->is_type('variable')
                ? get_permalink($product_id)
                : add_query_arg('add-to-cart', $product_id, get_permalink($product_id));

            $out = [
                'success' => true,
                'id' => $product_id,
                'created' => !$existing_id,
                'adopted' => $adopted,
                'status' => $product->get_status(),
                'name' => $product->get_name(),
                'slug' => $product->get_slug(),
                'permalink' => get_permalink($product_id),
                'price' => $product->get_price(),
                'add_to_cart_url' => esc_url_raw($add_to_cart_url),
                'variable' => $product->is_type('variable'),
                'shortcode' => '[product id="' . $product_id . '"]',
                'store_currency' => $store_currency !== '' ? $store_currency : null,
                'price_currency' => $price_currency,
                'currency_mismatch' => $currency_mismatch,
                'variations' => $variations_out,
                // The photo: whether this call set it, the product's image
                // now, and why a photo the call named was not set.
                'image_set' => $image_set,
                'image_id' => ((int) $product->get_image_id()) ?: null,
                'image_error' => $image_named && !$image_set ? ($image_error ?? 'The image could not be set') : null,
            ];
            // Only in the connected-site mode, so the legacy shape stays.
            if ($protect) {
                $out['saved_as_draft'] = $left_alone !== null;
                if ($left_alone !== null) {
                    $out['left_alone'] = $left_alone;
                }
            }
            return $out;
        } catch (Exception $e) {
            return [
                'success' => false,
                'error' => 'Failed to create product: ' . $e->getMessage()
            ];
        }
    }

    /** Post meta that marks a product woocommerce_create_product created. */
    const PRODUCT_KEY_META = '_webmaven_product_key';

    /** Post meta on a sideloaded image: the URL it was downloaded from. */
    const SOURCE_URL_META = '_webmaven_source_url';

    /** Post meta on a variation: its stable key (attribute slug = value slug, sorted). */
    const VARIANT_KEY_META = '_wm_variant_key';

    /** Post meta: a variation's (or a simple product's) print-on-demand data, JSON. */
    const POD_META = '_wm_pod';

    /** Post meta on a product: its print-on-demand catalog product and technique, JSON. */
    const POD_PRODUCT_META = '_wm_pod_product';

    /** Post meta on a product: '1' while it is a sample listing of an own product. */
    const SAMPLE_META = '_wm_sample_product';

    /** Post meta on a product: its design key, the product's slug in the site plan. */
    const DESIGN_KEY_META = '_wm_product_slug';

    /**
     * A new design (media_only): the product's photo, its variations' photos
     * and its print data change, and nothing else. Its name, prices,
     * descriptions, status, categories, card text and menu order stay as the
     * owner keeps them, whatever the call carries. The product is the one
     * product_id names, else the one with the design key slug; a new design
     * never creates one. The photo comes as image_id (an attachment of this
     * site), else image_url or images[0]; variation_images and pod as for an
     * upsert. The answer has the upsert's shape, with media_only: true.
     */
    private function product_media_only($params) {
        if (!function_exists('wc_get_product')) {
            return ['success' => false, 'error' => 'WooCommerce is not active'];
        }
        $design_key = self::design_key_from_params($params);
        $id = isset($params['product_id']) && is_numeric($params['product_id']) ? (int) $params['product_id'] : 0;
        if ($id <= 0 && $design_key !== '') {
            $id = $this->product_id_by_design_key($design_key);
        }
        $product = $id > 0 ? wc_get_product($id) : null;
        if (!$product || $product->is_type('variation')) {
            return ['success' => false, 'error' => 'No product to give the new design to (product_id or slug)'];
        }
        try {
            // The photo.
            $image_named = false;
            $image_set = false;
            $image_error = null;
            $named_id = isset($params['image_id']) && is_numeric($params['image_id']) ? (int) $params['image_id'] : 0;
            if ($named_id > 0) {
                $image_named = true;
                if (function_exists('wp_attachment_is_image') && wp_attachment_is_image($named_id)) {
                    $product->set_image_id($named_id);
                    $image_set = true;
                } else {
                    $image_error = "Attachment {$named_id} is not an image in this site's media library";
                }
            }
            $first = $params['image_url'] ?? (is_array($params['images'] ?? null) ? reset($params['images']) : null);
            $url = is_array($first) ? (string) ($first['src'] ?? $first['url'] ?? '') : (string) $first;
            if (!$image_set && $url !== '') {
                $image_named = true;
                $image_id = $this->product_image_id_from_url($url, $product->get_name());
                if ($image_id && !is_wp_error($image_id)) {
                    $product->set_image_id($image_id);
                    $image_set = true;
                    $image_error = null;
                } else {
                    $image_error = is_wp_error($image_id) ? $image_id->get_error_message() : 'The image could not be downloaded';
                }
            }
            if ($image_set) {
                $product->save();
            }
            if ($design_key !== '') {
                update_post_meta($id, self::DESIGN_KEY_META, $design_key);
            }

            // The print data.
            $variable = $product->is_type('variable');
            $pod = self::pod_from_params($params['pod'] ?? null);
            if ($pod !== null) {
                update_post_meta($id, self::POD_PRODUCT_META, wp_json_encode([
                    'printful_product_id' => $pod['printful_product_id'],
                    'technique' => $pod['technique'],
                ]));
                if (!$variable && isset($pod['variants'][''])) {
                    update_post_meta($id, self::POD_META, wp_json_encode($pod['variants']['']));
                }
            }

            // Each variation: its photo, and its print data, matched by its key.
            $variation_images = [];
            foreach (self::variation_images_from_params($params['variation_images'] ?? null) as $entry) {
                $image_id = $entry['image_id'];
                if ($image_id === null && $entry['image_url'] !== null) {
                    $image_id = $this->product_image_id_from_url($entry['image_url'], $product->get_name());
                    $image_id = $image_id && !is_wp_error($image_id) ? (int) $image_id : null;
                }
                if ($image_id) {
                    $variation_images[] = ['options' => $entry['options'], 'image_id' => (int) $image_id];
                }
            }
            $variations_out = [];
            foreach ($variable ? (array) $product->get_children() : [] as $variation_id) {
                $variation = wc_get_product($variation_id);
                if (!$variation) {
                    continue;
                }
                $attributes = (array) $variation->get_attributes();
                $key = (string) get_post_meta($variation_id, self::VARIANT_KEY_META, true);
                if ($key === '') {
                    $key = self::variation_key($attributes);
                }
                $image = self::variation_image_for($attributes, $variation_images);
                if ($image !== null && (int) $variation->get_image_id() !== $image) {
                    $variation->set_image_id($image);
                    $variation->save();
                }
                $variant_pod = $pod['variants'][$key] ?? null;
                if ($variant_pod !== null) {
                    update_post_meta($variation_id, self::POD_META, wp_json_encode($variant_pod));
                }
                $variations_out[] = [
                    'id' => (int) $variation_id,
                    'key' => $key,
                    'printful_variant_id' => $variant_pod['printful_variant_id'] ?? null,
                    'image_id' => ((int) $variation->get_image_id()) ?: null,
                ];
            }
            if (function_exists('wc_delete_product_transients')) {
                wc_delete_product_transients($id);
            }
            $product = wc_get_product($id) ?: $product;
            return [
                'success' => true,
                'id' => $id,
                'created' => false,
                'adopted' => false,
                'media_only' => true,
                'name' => $product->get_name(),
                'slug' => $product->get_slug(),
                'permalink' => get_permalink($id),
                'price' => $product->get_price(),
                'variable' => $product->is_type('variable'),
                'variations' => $variations_out,
                'image_set' => $image_set,
                'image_id' => ((int) $product->get_image_id()) ?: null,
                'image_error' => $image_named && !$image_set ? ($image_error ?? 'The image could not be set') : null,
            ];
        } catch (Exception $e) {
            return ['success' => false, 'error' => 'Failed to apply the new design: ' . $e->getMessage()];
        }
    }

    /** The design key a call names (slug), as stored: a slug ("ceramic-mug"), or ''. */
    public static function design_key_from_params($params): string {
        $slug = is_array($params) && is_string($params['slug'] ?? null) ? sanitize_title($params['slug']) : '';
        return strlen($slug) <= 200 ? $slug : '';
    }

    /** The oldest product (not trashed) with this design key, or 0. */
    private function product_id_by_design_key(string $design_key) {
        $ids = get_posts([
            'post_type' => 'product',
            'post_status' => 'any',
            'numberposts' => 1,
            'fields' => 'ids',
            'orderby' => 'ID',
            'order' => 'ASC',
            'meta_key' => self::DESIGN_KEY_META,
            'meta_value' => $design_key,
        ]);
        return empty($ids) ? 0 : (int) $ids[0];
    }

    /**
     * Normalized `variation_images` params: [{options: {attribute slug: value
     * slug}, image_id: int|null, image_url: string|null}]. Entries without
     * options, or without a positive id or an http(s) url, are dropped.
     * Pure function, tested on its own.
     */
    public static function variation_images_from_params($images): array {
        $out = [];
        foreach ((array) $images as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $options = [];
            foreach ((array) ($entry['options'] ?? []) as $attribute => $value) {
                $attribute = sanitize_title(preg_replace('/^(attribute_)?(pa_)?/', '', (string) $attribute));
                $value = sanitize_title((string) $value);
                if ($attribute !== '' && $value !== '') {
                    $options[$attribute] = $value;
                }
            }
            $image_id = is_numeric($entry['image_id'] ?? null) && (int) $entry['image_id'] > 0 ? (int) $entry['image_id'] : null;
            $url = is_string($entry['image_url'] ?? null) ? trim($entry['image_url']) : '';
            $image_url = preg_match('#^https?://#i', $url) ? esc_url_raw($url) : null;
            if (empty($options) || ($image_id === null && !$image_url)) {
                continue;
            }
            $out[] = ['options' => $options, 'image_id' => $image_id, 'image_url' => $image_url ?: null];
        }
        return $out;
    }

    /**
     * The image of the first entry whose every option the variation has
     * (attribute and value compared as slugs, so "Color: Navy Blue" matches
     * pa_color = navy-blue), or null.
     * Pure function, tested on its own.
     */
    public static function variation_image_for(array $attributes, array $images): ?int {
        $have = [];
        foreach ($attributes as $attribute => $value) {
            $have[sanitize_title(preg_replace('/^(attribute_)?(pa_)?/', '', (string) $attribute))] = sanitize_title((string) $value);
        }
        foreach ($images as $entry) {
            $match = true;
            foreach ($entry['options'] as $attribute => $value) {
                if (($have[$attribute] ?? null) !== $value) {
                    $match = false;
                    break;
                }
            }
            if ($match && !empty($entry['image_id'])) {
                return (int) $entry['image_id'];
            }
        }
        return null;
    }

    /**
     * The stable key of a variation from its attributes ({slug|attribute_slug:
     * value}): "color=black|size=m", attribute and value slugs, sorted. The same
     * combination always has the same key, whatever the attribute order.
     * Pure function, tested on its own.
     */
    public static function variation_key(array $attributes): string {
        $parts = [];
        foreach ($attributes as $attribute => $value) {
            $attribute = sanitize_title(preg_replace('/^attribute_/', '', (string) $attribute));
            if ($attribute === '') {
                continue;
            }
            $parts[] = $attribute . '=' . sanitize_title((string) $value);
        }
        sort($parts);
        return implode('|', $parts);
    }

    /**
     * Normalized print-on-demand params, or null when absent or unusable:
     * {printful_product_id, technique, variants: {variation key: {
     * printful_variant_id, files, artwork_hash}}}. A variant without options
     * is keyed '' (a simple product). Every value is sanitized: ids must be
     * positive integers (a negative one is refused, never made positive), placements keys, urls http(s) only, positions numbers.
     * Pure function, tested on its own.
     */
    public static function pod_from_params($pod): ?array {
        if (!is_array($pod)) {
            return null;
        }
        $product_id = is_numeric($pod['printful_product_id'] ?? null) ? (int) $pod['printful_product_id'] : 0;
        if ($product_id <= 0) {
            return null;
        }
        $variants = [];
        foreach ((array) ($pod['variants'] ?? []) as $variant) {
            if (!is_array($variant)) {
                continue;
            }
            $variant_id = is_numeric($variant['printful_variant_id'] ?? null) ? (int) $variant['printful_variant_id'] : 0;
            if ($variant_id <= 0) {
                continue;
            }
            $files = [];
            foreach ((array) ($variant['files'] ?? []) as $file) {
                $url = is_array($file) ? trim((string) ($file['url'] ?? '')) : '';
                if (!preg_match('#^https?://#i', $url)) {
                    continue;
                }
                $position = [];
                foreach ((array) ($file['position'] ?? []) as $pk => $pv) {
                    if (is_numeric($pv)) {
                        $position[sanitize_key((string) $pk)] = $pv + 0;
                    }
                }
                $entry = [
                    'placement' => sanitize_key((string) ($file['placement'] ?? 'default')),
                    'url' => esc_url_raw($url),
                    'position' => $position,
                ];
                // The print partner's file library id: orders name the file by
                // it, since the hosted URL may expire. Positive integers only.
                $file_id = is_numeric($file['id'] ?? null) ? (int) $file['id'] : 0;
                if ($file_id > 0) {
                    $entry['id'] = $file_id;
                }
                $files[] = $entry;
            }
            $variants[self::variation_key((array) ($variant['options'] ?? []))] = [
                'printful_variant_id' => $variant_id,
                'files' => $files,
                'artwork_hash' => sanitize_text_field((string) ($variant['artwork_hash'] ?? '')),
            ];
        }
        return [
            'printful_product_id' => $product_id,
            'technique' => sanitize_key((string) ($pod['technique'] ?? '')),
            'variants' => $variants,
        ];
    }

    /**
     * The upsert key of a product name: trimmed, inner whitespace collapsed,
     * lowercased. '' when the name has nothing usable.
     * Pure function, tested on its own.
     */
    public static function product_upsert_key($name) {
        $name = preg_replace('/\s+/u', ' ', trim((string) $name));
        if (!is_string($name) || $name === '') {
            return '';
        }
        return function_exists('mb_strtolower') ? mb_strtolower($name, 'UTF-8') : strtolower($name);
    }

    /**
     * The product a woocommerce_create_product call should update instead of
     * creating one: the product with the given SKU, else the product this
     * action created earlier under the same name. 0 when there is none.
     */
    private function find_upsert_product_id($params) {
        $sku = isset($params['sku']) ? trim((string) $params['sku']) : '';
        if ($sku !== '') {
            $id = function_exists('wc_get_product_id_by_sku') ? (int) wc_get_product_id_by_sku($sku) : 0;
            // A variation can own the SKU too; only a product is upserted.
            return ($id && get_post_type($id) === 'product') ? $id : 0;
        }
        $design_key = self::design_key_from_params($params);
        if ($design_key !== '') {
            $id = $this->product_id_by_design_key($design_key);
            if ($id > 0) {
                return $id;
            }
        }
        $key = self::product_upsert_key($params['name'] ?? '');
        if ($key === '') {
            return 0;
        }
        $ids = get_posts([
            'post_type' => 'product',
            'post_status' => 'any', // not trashed
            'numberposts' => 1,
            'fields' => 'ids',
            'orderby' => 'ID',
            'order' => 'ASC',
            'meta_key' => self::PRODUCT_KEY_META,
            'meta_value' => $key,
        ]);
        return empty($ids) ? 0 : (int) $ids[0];
    }

    /**
     * An unmarked product this action may adopt: products made before the
     * _webmaven_product_key marker existed would otherwise be duplicated on
     * their first re-apply. The one non-trashed product WITHOUT the marker
     * whose name is exactly $name (both trimmed, case and accents included:
     * the database's title match ignores both, so it is re-checked here).
     * 0 when there is none, or more than one (ambiguous: never guessed).
     */
    private function find_adoptable_product_id($name) {
        $matches = $this->unmarked_products_named($name);
        return count($matches) === 1 ? $matches[0] : 0;
    }

    /**
     * The owner's product with this name: any unmarked, non-trashed product
     * titled exactly $name (the lowest id), or 0. Used by the connected-site
     * mode, which leaves it alone whether there is one or several.
     */
    private function find_owner_product_id($name) {
        $matches = $this->unmarked_products_named($name);
        return $matches[0] ?? 0;
    }

    /** The unmarked, non-trashed products titled exactly $name (trimmed, same case), lowest id first. */
    private function unmarked_products_named($name): array {
        $name = trim((string) $name);
        if ($name === '') {
            return [];
        }
        $ids = get_posts([
            'post_type' => 'product',
            'post_status' => 'any', // not trashed
            'title' => $name,
            'numberposts' => -1,
            'fields' => 'ids',
            'orderby' => 'ID',
            'order' => 'ASC',
        ]);
        $matches = [];
        foreach ((array) $ids as $id) {
            $id = (int) $id;
            if ((string) get_post_meta($id, self::PRODUCT_KEY_META, true) !== '') {
                continue; // made by this action for another name, not adoptable
            }
            if (trim((string) get_post_field('post_title', $id, 'raw')) === $name) {
                $matches[] = $id;
            }
        }
        return $matches;
    }

    /**
     * Attachment id for a product image URL: the attachment an earlier call
     * already sideloaded from the same URL, else a fresh sideload (marked with
     * its source URL). A retried or re-applied product must not pile up
     * copies of its image in the media library. Returns an id or a WP_Error.
     */
    private function product_image_id_from_url($image_url, $title) {
        $existing = get_posts([
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'numberposts' => 1,
            'fields' => 'ids',
            'meta_key' => self::SOURCE_URL_META,
            'meta_value' => $image_url,
        ]);
        if (!empty($existing)) {
            return (int) $existing[0];
        }
        $image_id = $this->upload_image_from_url($image_url, $title);
        if ($image_id && !is_wp_error($image_id)) {
            update_post_meta($image_id, self::SOURCE_URL_META, $image_url);
        }
        return $image_id;
    }

    /**
     * Parse a display-string price like "$28", "€2,400" or "2.400,50" into
     * ['amount' => float|null, 'currency' => 'USD'|'EUR'|'GBP'|null].
     *
     * - A range or a list ("$28–$40", "€45 - €60", "from $28/month") prices
     *   at its FIRST number. Every digit used to be glued together, so
     *   "$28–$40" became 2840.
     * - The decimal separator is decided per number, never assumed:
     *   both "." and "," present: the last one is the decimal separator
     *     ("1,234.56" and "1.234,56" are both 1234.56);
     *   one kind, more than once: thousands ("1.234.567");
     *   one kind, once, followed by exactly 3 digits: thousands
     *     ("€2.400" is 2400, "$1.200" is 1200, "€12.000" is 12000), unless
     *     the whole part is 0 ("0.500" is 0.5);
     *   otherwise decimal ("24.99", "€1,5" is 1.5).
     * - A space (also no-break or thin) before a group of exactly 3 digits
     *   groups thousands ("1 200 €" is 1200).
     * Pure function, tested without WordPress.
     */
    public static function parse_display_price($raw) {
        $raw = (string) $raw;
        $currency = null;
        if (strpos($raw, '€') !== false) {
            $currency = 'EUR';
        } elseif (strpos($raw, '£') !== false) {
            $currency = 'GBP';
        } elseif (strpos($raw, '$') !== false) {
            $currency = 'USD';
        }
        // No-break, narrow no-break and thin spaces group thousands too.
        $text = str_replace(["\xC2\xA0", "\xE2\x80\xAF", "\xE2\x80\x89"], ' ', $raw);
        // The first number only: digit groups joined by "." or "," (followed
        // by digits), or by a space before exactly 3 digits.
        if (!preg_match('/\d+(?:[.,]\d+| \d{3}(?!\d))*/', $text, $match)) {
            return ['amount' => null, 'currency' => $currency];
        }
        $num = str_replace(' ', '', $match[0]);

        $last_dot = strrpos($num, '.');
        $last_comma = strrpos($num, ',');
        $decimal = null;
        if ($last_dot !== false && $last_comma !== false) {
            $decimal = $last_dot > $last_comma ? '.' : ',';
        } elseif ($last_dot !== false || $last_comma !== false) {
            $separator = $last_dot !== false ? '.' : ',';
            $parts = explode($separator, $num);
            $is_thousands = count($parts) > 2
                || (strlen($parts[1]) === 3 && ltrim($parts[0], '0') !== '');
            $decimal = $is_thousands ? null : $separator;
        }

        if ($decimal === null) {
            $num = str_replace(['.', ','], '', $num);
        } else {
            $num = str_replace($decimal === '.' ? ',' : '.', '', $num);
            $num = str_replace($decimal, '.', $num);
        }
        return ['amount' => is_numeric($num) ? (float) $num : null, 'currency' => $currency];
    }

    /**
     * Cartesian product of the declared option sets. Each combination is a
     * list of ['attr' => slug, 'value' => name, 'delta' => float] parts.
     */
    private function build_option_combinations($options) {
        $combos = [[]];
        foreach ($options as $option) {
            $next = [];
            foreach ($combos as $combo) {
                foreach ((array) ($option['values'] ?? []) as $value) {
                    $with_value = $combo;
                    $with_value[] = [
                        'attr' => sanitize_title($option['attribute'] ?? 'option'),
                        'value' => sanitize_text_field(is_array($value) ? ($value['name'] ?? '') : $value),
                        'delta' => is_array($value) ? (float) ($value['delta'] ?? 0) : 0.0,
                    ];
                    $next[] = $with_value;
                }
            }
            $combos = $next;
        }
        return $combos;
    }

    /**
     * List WooCommerce products
     */
    /**
     * Create a form using WPForms or Contact Form 7 (whichever is active)
     * Returns the form ID and shortcode so content generation can embed it.
     *
     * @param array $params {
     *   type: 'contact'|'quote'|'booking'|'feedback'|'newsletter' (default: contact)
     *   title: string (optional, auto-generated from type if missing)
     *   fields: array of {label, type, required} (optional, defaults per type)
     * }
     */
    /**
     * Remove the sample content a fresh WordPress ships with, after a build:
     * the "Hello world!" post, the "Sample Page", and the draft "Privacy
     * Policy" once the build's own privacy page replaced it (WordPress's
     * privacy setting points elsewhere). Recognised in the site's language
     * (WebMaven_Default_Content), so a French site loses "Bonjour tout le
     * monde !" too. Idempotent and fault-tolerant: anything already gone is
     * skipped, per-item failures are logged, nothing is ever fatal.
     *
     * A connected site (protect_existing): only content never edited since
     * the install goes, and it goes to the trash, where the owner can bring
     * it back; a page or post the owner rewrote at the same address stays
     * and is named in left_alone. A fresh hosted site: the address rule,
     * deleted for good.
     *
     * Answer: { success, deleted: [slug], defaults: [{ kind, id, action:
     * 'trashed'|'deleted' }], left_alone (connected sites) }.
     */
    public function webhook_cleanup_default_content($params) {
        $deleted = array();
        $defaults = array();
        $left_alone = array();
        $protect = !empty($params['protect_existing']);
        if (!class_exists('WebMaven_Default_Content')) {
            return array('success' => true, 'deleted' => $deleted, 'defaults' => $defaults);
        }
        $privacy_id = (int) get_option('wp_page_for_privacy_policy', 0);
        foreach (WebMaven_Default_Content::default_posts() as $post) {
            try {
                $kind = $protect ? WebMaven_Default_Content::untouched_kind($post) : WebMaven_Default_Content::kind_by_address($post);
                if ($kind === null) {
                    // At a default address but the owner's now (edited since).
                    if ($protect && WebMaven_Default_Content::kind_by_address($post) !== null
                        && WebMaven_Default_Content::default_kind($post) !== WebMaven_Default_Content::PRIVACY_DRAFT) {
                        $left_alone[] = array('id' => (int) $post->ID, 'slug' => (string) ($post->post_name ?? ''), 'title' => (string) ($post->post_title ?? ''));
                    }
                    continue;
                }
                // Still the page WordPress's privacy setting names: it goes
                // only once the build's own privacy page replaced it.
                if ($kind === WebMaven_Default_Content::PRIVACY_DRAFT && (int) $post->ID === $privacy_id) {
                    continue;
                }
                $slug = (string) ($post->post_name ?? '');
                $done = $protect ? wp_trash_post((int) $post->ID) : wp_delete_post((int) $post->ID, true); // force = skip trash + drop its comments
                if ($done) {
                    $deleted[] = $slug;
                    $defaults[] = array('kind' => $kind, 'id' => (int) $post->ID, 'action' => $protect ? 'trashed' : 'deleted');
                }
            } catch (\Throwable $e) {
                WebMaven_Log::write('WebMaven: cleanup_default_content failed for #' . (int) ($post->ID ?? 0) . ': ' . $e->getMessage());
            }
        }
        $out = array('success' => true, 'deleted' => $deleted, 'defaults' => $defaults);
        if ($protect) {
            $out['left_alone'] = $left_alone;
        }
        return $out;
    }

    /**
     * Set the site branding from already-uploaded media: custom_logo
     * (a per-theme theme_mod — call AFTER the target theme is active) and/or
     * site_icon (theme-independent option, drives the favicon). Each param is an
     * attachment id; missing/invalid ones are skipped. Idempotent, never fatal.
     */
    public function webhook_set_site_identity($params) {
        $result = array('custom_logo_set' => false, 'site_icon_set' => false);

        $logo_id = isset($params['custom_logo']) ? intval($params['custom_logo']) : 0;
        if ($logo_id > 0 && get_post_type($logo_id) === 'attachment') {
            set_theme_mod('custom_logo', $logo_id);
            $result['custom_logo_set'] = true;
        }

        $icon_id = isset($params['site_icon']) ? intval($params['site_icon']) : 0;
        if ($icon_id > 0 && get_post_type($icon_id) === 'attachment') {
            update_option('site_icon', $icon_id);
            $result['site_icon_set'] = true;
        }

        return array_merge(array('success' => true), $result);
    }

    /**
     * Create/refresh the REAL WooCommerce coupon behind a showcased promo
     * code (upsert by code): percent or fixed_cart, one use per customer,
     * no expiry. The generated site renders the code through the wm_var
     * variables, so what visitors see is exactly what the cart accepts.
     *
     * The code is normalized by coupon_code_from() (hyphens and underscores
     * kept, so WELCOME-10 stays WELCOME-10) and the result's `code` is the
     * code that exists in WooCommerce, for the caller to display verbatim.
     *
     * @param array $params { code: string, kind: 'percent'|'fixed', amount: int }
     */
    public function webhook_create_coupon($params) {
        if (!class_exists('WooCommerce')) {
            return array('success' => false, 'error' => 'WooCommerce is not active');
        }
        $code = self::coupon_code_from($params['code'] ?? '');
        $amount = absint($params['amount'] ?? 0);
        if ('' === $code || !$amount) {
            return array('success' => false, 'error' => 'coupon needs a code and an amount');
        }
        $type = ($params['kind'] ?? 'percent') === 'fixed' ? 'fixed_cart' : 'percent';
        // post_exists() is admin-only (undefined outside wp-admin includes);
        // Woo's own code->id lookup is the context-safe upsert key.
        $existing = function_exists('wc_get_coupon_id_by_code') ? (int) wc_get_coupon_id_by_code($code) : 0;
        $coupon_id = $existing ? $existing : wp_insert_post(array(
            'post_title' => $code,
            'post_status' => 'publish',
            'post_type' => 'shop_coupon',
        ));
        if (is_wp_error($coupon_id) || !$coupon_id) {
            return array('success' => false, 'error' => 'coupon insert failed');
        }
        update_post_meta($coupon_id, 'discount_type', $type);
        update_post_meta($coupon_id, 'coupon_amount', (string) $amount);
        update_post_meta($coupon_id, 'usage_limit_per_user', '1');
        update_post_meta($coupon_id, 'individual_use', 'no');
        return array('success' => true, 'id' => $coupon_id, 'code' => $code, 'type' => $type, 'amount' => $amount);
    }

    /**
     * The coupon code create_coupon stores: text-field sanitized, uppercased,
     * then only letters, digits, hyphens and underscores kept. WooCommerce
     * accepts hyphens and underscores in a code; stripping them rewrote
     * WELCOME-10 as WELCOME10, so the code the site showed was rejected at
     * checkout. The cart compares codes case-insensitively, so the uppercase
     * form matches what visitors type. '' when no letter or digit is left.
     * Pure apart from sanitize_text_field (tests stub it).
     */
    public static function coupon_code_from($raw) {
        $raw = is_scalar($raw) ? (string) $raw : '';
        $code = (string) preg_replace('/[^A-Z0-9_-]/', '', strtoupper(sanitize_text_field($raw)));
        // Separators alone are not a code.
        return preg_match('/[A-Z0-9]/', $code) ? $code : '';
    }

    /**
     * Create a form using WPForms or Contact Form 7 (whichever is active).
     *
     * Field source, best first: explicit `fields` (legacy callers), the
     * designed form's harvested `spec` (the live form must match the markup
     * the design shipped), a booking form synthesized from the plan's
     * `services`, the intent preset.
     *
     * @param array $params {
     *   intent: contact|quote|booking|feedback|newsletter|order (default
     *           contact; legacy alias: type)
     *   title: string (optional, derived from intent when empty)
     *   fields: [{label, type, required, placeholder?, options?|choices?, css?}] (optional)
     *   spec: {fields: [{label?, placeholder?, type?, required?, options?, css?}],
     *          labels_hidden?, submit_text?, submit_class?, form_class?} (optional)
     *   services: [string|{name, duration}] for booking synthesis (optional)
     *   name: string (optional) — registers the form id under option wm_form_<name>
     *   confirmation: string (optional): the designed thank-you line, plain text
     *   language: string (optional): the site's language as the build names it
     *           (es, pt-BR, zh-TW); the booking request form's words follow it,
     *           else the site's locale
     * }
     *
     * Upsert by name: when wm_form_<name> already points at a live form of
     * the active form plugin, that form is rewritten in place (same id, same
     * shortcode) instead of a second one being created, so re-applying a
     * site is idempotent. Without a name every call creates a form, as
     * before. The result carries created: true|false. A spec field's `id`
     * is the id the designed markup posts it under: the WPForms field keeps
     * it. An upsert keeps what the owner set in WPForms (fields added in the
     * builder, the consent box, settings, their own thank-you line); see
     * WebMaven_Designed_Forms. WPForms answers the form's design hash
     * (sha256) for the edit engine's drift guard.
     */
    public function webhook_create_form($params) {
        // `intent` is the reference name; the legacy `type` alias keeps working
        $form_type = sanitize_key($params['intent'] ?? $params['type'] ?? 'contact');
        $title = !empty($params['title']) ? $params['title'] : ucfirst($form_type) . ' Form';
        $spec = (isset($params['spec']) && is_array($params['spec'])) ? $params['spec'] : null;
        $services = (isset($params['services']) && is_array($params['services'])) ? $params['services'] : [];
        $form_name = sanitize_key($params['name'] ?? '');

        // Default fields per form type
        $default_fields = [
            'contact' => [
                ['label' => 'Name', 'type' => 'text', 'required' => true],
                ['label' => 'Email', 'type' => 'email', 'required' => true],
                ['label' => 'Phone', 'type' => 'tel', 'required' => false],
                ['label' => 'Message', 'type' => 'textarea', 'required' => true],
            ],
            'quote' => [
                ['label' => 'Name', 'type' => 'text', 'required' => true],
                ['label' => 'Email', 'type' => 'email', 'required' => true],
                ['label' => 'Phone', 'type' => 'tel', 'required' => true],
                ['label' => 'Service Needed', 'type' => 'text', 'required' => true],
                ['label' => 'Budget Range', 'type' => 'text', 'required' => false],
                ['label' => 'Details', 'type' => 'textarea', 'required' => true],
            ],
            'feedback' => [
                ['label' => 'Name', 'type' => 'text', 'required' => false],
                ['label' => 'Email', 'type' => 'email', 'required' => false],
                ['label' => 'Rating', 'type' => 'text', 'required' => true],
                ['label' => 'Feedback', 'type' => 'textarea', 'required' => true],
            ],
            'newsletter' => [
                ['label' => 'Name', 'type' => 'text', 'required' => false],
                ['label' => 'Email', 'type' => 'email', 'required' => true],
            ],
            'order' => [
                ['label' => 'Name', 'type' => 'text', 'required' => true],
                ['label' => 'Email', 'type' => 'email', 'required' => true],
                ['label' => 'Phone', 'type' => 'tel', 'required' => true],
                ['label' => 'Your Order', 'type' => 'textarea', 'required' => true],
                ['label' => 'Pickup Date', 'type' => 'date', 'required' => false],
            ],
        ];

        $labels_hidden = false;
        if (!empty($params['fields']) && is_array($params['fields'])) {
            // Explicit fields from legacy callers always win
            $fields = $params['fields'];
        } elseif ($spec && !empty($spec['fields']) && is_array($spec['fields'])) {
            // The designed form's harvested spec: labels (falling back to the
            // placeholder text), placeholders, options and css classes carry
            // over so the live form renders like the designed one.
            $fields = [];
            foreach ($spec['fields'] as $f) {
                $fields[] = [
                    // The id the designed markup posts this field under.
                    'id' => (isset($f['id']) && (is_int($f['id']) || (is_string($f['id']) && preg_match('/^\d{1,4}$/', $f['id'])))) ? (int) $f['id'] : null,
                    'label' => !empty($f['label']) ? $f['label'] : (!empty($f['placeholder']) ? preg_replace('/\.\.\.$/', '', $f['placeholder']) : ucfirst($f['type'] ?? 'text')),
                    'type' => $f['type'] ?? 'text',
                    'required' => !empty($f['required']),
                    'placeholder' => $f['placeholder'] ?? '',
                    'options' => array_values(array_filter((array) ($f['options'] ?? []))),
                    'css' => $f['css'] ?? '',
                ];
            }
            $labels_hidden = !empty($spec['labels_hidden']);
        } elseif ($form_type === 'booking') {
            // The booking request form when the design brings none
            // (WebMaven_Booking_Request): the service, a preferred date and
            // time, the visitor's details, in the site's language; never time
            // slots the owner did not give (2026-11-03).
            $booking_request = WebMaven_Booking_Request::form($services, (string) ($params['language'] ?? ''));
            $fields = $booking_request['fields'];
        } else {
            $fields = $default_fields[$form_type] ?? $default_fields['contact'];
        }

        // Email campaigns (1.2.28): every form WPMaven makes asks for the yes
        // a campaign needs, never ticked in advance. Required on a newsletter
        // form (its whole purpose), optional on the others.
        if (class_exists('WebMaven_Marketing_Consent') && WebMaven_Marketing_Consent::enabled()
            && !WebMaven_Marketing_Consent::fields_have_consent($fields)) {
            $fields[] = WebMaven_Marketing_Consent::form_field($form_type);
        }

        // Designed-form settings the builder honors (labels, submit button)
        $builder_options = ['labels_hidden' => $labels_hidden];
        if ($spec && !empty($spec['submit_text'])) {
            $builder_options['submit_text'] = $spec['submit_text'];
        }
        if (isset($booking_request)) {
            $builder_options['submit_text'] = $booking_request['submit'];
        }
        if ($spec && !empty($spec['submit_class'])) {
            $builder_options['submit_class'] = $spec['submit_class'];
        }
        if ($spec && !empty($spec['form_class'])) {
            $builder_options['form_class'] = $spec['form_class'];
        }

        // Upsert: the form this name registered on an earlier apply.
        $existing_form_id = $form_name ? (int) get_option('wm_form_' . $form_name, 0) : 0;
        // A booking request says the business will confirm, whatever line the
        // design wrote for its own form (an owner's own line still stays).
        $builder_options['confirmation'] = isset($booking_request)
            ? $booking_request['confirmation']
            : sanitize_text_field((string) ($params['confirmation'] ?? ''));

        // Try WPForms first, then Contact Form 7
        if (function_exists('wpforms') && class_exists('WPForms_Form_Handler')) {
            $result = $this->create_wpforms_form($title, $fields, $builder_options, $existing_form_id);
        } elseif (defined('WPCF7_VERSION')) {
            $result = $this->create_cf7_form($title, $fields, $existing_form_id);
        } else {
            return [
                'success' => false,
                'error' => 'No supported form plugin is active. Install WPForms or Contact Form 7.',
                'provider' => 'none'
            ];
        }

        // Register the form id under wm_form_<name> so the generated theme's
        // shortcodes can resolve designed forms by name.
        if ($form_name && !empty($result['success']) && !empty($result['id'])) {
            update_option('wm_form_' . $form_name, (int) $result['id']);
        }
        // What the form is for, so a submission knows whether it is a
        // newsletter signup (WebMaven_Marketing_Consent).
        if (!empty($result['success']) && !empty($result['id'])) {
            update_option('wm_form_intent_' . (int) $result['id'], $form_type, false);
        }

        return $result;
    }

    /**
     * Create a WPForms form
     *
     * $builder_options (all optional): labels_hidden (hide every field label,
     * for placeholder-only designed forms), submit_text, submit_class,
     * form_class (carried from the designed form's spec), confirmation (the
     * designed thank-you line, plain text).
     *
     * $existing_id: a wpforms post to rewrite in place (create_form's upsert
     * by name, keeping what the owner set: WebMaven_Designed_Forms); ignored
     * when it is not a live WPForms form. A new form asks WPForms to check
     * its anti-spam token and honeypot.
     */
    public function create_wpforms_form($title, $fields, $builder_options = [], $existing_id = 0) {
        // Make WPForms defer visual styling to the generated theme. WPForms'
        // default "modern markup" colors each form via a per-form, ID-scoped
        // inline <style> (specificity 1,x,x) that beats the theme's class-based
        // plugin style baseline, so forms keep WPForms' stock colors instead of
        // the brand's. Classic markup styles via equal-specificity class
        // selectors the theme's stylesheet overrides, and "base styling only"
        // (disable-css = 2) keeps WPForms' layout while the theme owns colors,
        // borders and the submit button. Guarded so we never clobber a choice
        // the site owner made later in WPForms settings.
        $wpf_settings = get_option('wpforms_settings', []);
        if (!is_array($wpf_settings)) {
            $wpf_settings = [];
        }
        $wpf_changed = false;
        if (!array_key_exists('modern-markup', $wpf_settings)) {
            $wpf_settings['modern-markup'] = 0;
            $wpf_changed = true;
        }
        if (!array_key_exists('disable-css', $wpf_settings)) {
            $wpf_settings['disable-css'] = 2;
            $wpf_changed = true;
        }
        if ($wpf_changed) {
            update_option('wpforms_settings', $wpf_settings);
        }

        $labels_hidden = !empty($builder_options['labels_hidden']);
        // The design fields at their ids (a designed form's markup posts each
        // field under the id its spec carries), the consent box apart.
        [$design, $consent] = WebMaven_Designed_Forms::design_fields((array) $fields, $labels_hidden);

        $existing_id = (int) $existing_id;
        $existing = null;
        if ($existing_id > 0 && get_post_type($existing_id) === 'wpforms' && get_post_status($existing_id) !== 'trash') {
            $existing = json_decode((string) get_post_field('post_content', $existing_id, 'raw'), true);
            if (!is_array($existing)) {
                $existing = [];
            }
        }

        $submit_text = !empty($builder_options['submit_text']) ? sanitize_text_field($builder_options['submit_text']) : 'Submit';
        $confirmation = trim((string) ($builder_options['confirmation'] ?? ''));

        if ($existing !== null) {
            // Upsert: what the owner set in WPForms stays (fields added in the
            // builder, the consent box, notifications, anti-spam, their own
            // thank-you line); the design fields and the button follow the design.
            [$wpforms_fields, $field_id] = WebMaven_Designed_Forms::merge_fields(
                $design,
                (array) ($existing['fields'] ?? []),
                WebMaven_Designed_Forms::design_ids($existing_id, $existing),
                $consent,
                (int) ($existing['field_id'] ?? 0)
            );
            $settings = is_array($existing['settings'] ?? null) ? $existing['settings'] : [];
            $settings['form_title'] = $settings['form_title'] ?? $title;
            if (!empty($builder_options['submit_text']) || !isset($settings['submit_text'])) {
                $settings['submit_text'] = $submit_text;
            }
            if (!isset($settings['notification_enable'])) {
                $settings['notification_enable'] = '1';
            }
        } else {
            [$wpforms_fields, $field_id] = WebMaven_Designed_Forms::merge_fields($design, [], [], $consent, 0);
            $settings = [
                'form_title' => $title,
                'submit_text' => $submit_text,
                'notification_enable' => '1',
                'notifications' => [
                    1 => [
                        'email' => '{admin_email}',
                        'subject' => 'New ' . $title . ' submission',
                        'sender_name' => get_bloginfo('name'),
                        'sender_address' => '{admin_email}',
                        'message' => '{all_fields}',
                    ],
                ],
                // WPForms' own line, in the site's language, until the design
                // says one (apply_confirmation below).
                'confirmations' => [
                    1 => [
                        'type' => 'message',
                        'message' => WebMaven_Designed_Forms::default_confirmation_html(),
                    ],
                ],
                // WPForms checks its anti-spam token and honeypot only when
                // the form asks: the designed markup posts both.
                'antispam' => '1',
                'honeypot' => '1',
            ];
        }
        if (!empty($builder_options['submit_class'])) {
            $settings['submit_class'] = sanitize_text_field($builder_options['submit_class']);
        }
        if (!empty($builder_options['form_class'])) {
            $settings['form_class'] = sanitize_text_field($builder_options['form_class']);
        }
        WebMaven_Designed_Forms::apply_confirmation($settings, $existing !== null ? $existing_id : 0, $confirmation);
        WebMaven_Designed_Forms::apply_reply_to($settings, $wpforms_fields);

        $form_data = [
            'field_id' => $field_id,
            'fields' => $wpforms_fields,
            'settings' => $settings,
        ];

        if ($existing !== null) {
            // Upsert: same id, so every shortcode already on the site keeps
            // working. The id inside the config is written in one go (slashed,
            // see below).
            $form_data['id'] = (string) $existing_id;
            $updated = wp_update_post([
                'ID' => $existing_id,
                'post_title' => $title,
                'post_status' => 'publish',
                'post_content' => wp_slash(wp_json_encode($form_data)),
            ], true);
            if (is_wp_error($updated) || !$updated) {
                return [
                    'success' => false,
                    'error' => is_wp_error($updated) ? $updated->get_error_message() : 'Form update failed',
                    'provider' => 'wpforms'
                ];
            }
            WebMaven_Designed_Forms::record($existing_id, array_keys($design), $settings);
            return [
                'success' => true,
                'id' => $existing_id,
                'created' => false,
                'shortcode' => '[wpforms id="' . $existing_id . '"]',
                'provider' => 'wpforms',
                'field_id' => $field_id,
                'sha256' => WebMaven_Designed_Forms::design_sha($existing_id, $form_data),
            ];
        }

        // wp_insert_post()/wp_update_post() unslash their input, so the JSON
        // goes in slashed, exactly as WPForms saves it
        // (wp_slash(wp_json_encode(...))). Unslashed, the backslashes of the
        // \u escapes wp_json_encode() writes for non-ASCII text were stripped
        // ("Teléfono" came back as "Telu00e9fono") and an escaped quote in a
        // label broke the stored JSON, so the form would not load.
        $form_id = wp_insert_post([
            'post_title' => $title,
            'post_status' => 'publish',
            'post_type' => 'wpforms',
            'post_content' => wp_slash(wp_json_encode($form_data)),
        ]);

        if (is_wp_error($form_id)) {
            return [
                'success' => false,
                'error' => $form_id->get_error_message(),
                'provider' => 'wpforms'
            ];
        }

        // WPForms renders the hidden form id (and the container id) from the
        // id INSIDE the stored config; without this write-back every
        // submission posts wpforms[id]=0 and fails server-side lookup.
        $form_data['id'] = (string) $form_id;
        wp_update_post([
            'ID' => $form_id,
            'post_content' => wp_slash(wp_json_encode($form_data)),
        ]);
        WebMaven_Designed_Forms::record((int) $form_id, array_keys($design), $settings);

        return [
            'success' => true,
            'id' => $form_id,
            'created' => true,
            'shortcode' => '[wpforms id="' . $form_id . '"]',
            'provider' => 'wpforms',
            'field_id' => $field_id,
            'sha256' => WebMaven_Designed_Forms::design_sha((int) $form_id, $form_data),
        ];
    }

    /**
     * Create a Contact Form 7 form, or rewrite $existing_id in place when it
     * is a live Contact Form 7 form (create_form's upsert by name).
     */
    public function create_cf7_form($title, $fields, $existing_id = 0) {
        $form_parts = [];
        $mail_parts = [];

        foreach ($fields as $field) {
            $tag_name = sanitize_title($field['label'] ?? 'field');
            $required = !empty($field['required']) ? '*' : '';

            switch ($field['type'] ?? 'text') {
                case 'email':
                    $form_parts[] = '<label>' . esc_html($field['label']) . "\n    [email{$required} {$tag_name}]</label>";
                    break;
                case 'textarea':
                    $form_parts[] = '<label>' . esc_html($field['label']) . "\n    [textarea{$required} {$tag_name}]</label>";
                    break;
                case 'tel':
                    $form_parts[] = '<label>' . esc_html($field['label']) . "\n    [tel{$required} {$tag_name}]</label>";
                    break;
                case 'date':
                    $form_parts[] = '<label>' . esc_html($field['label']) . "\n    [date{$required} {$tag_name}]</label>";
                    break;
                case 'select':
                    // Options from the reference `options` shape (legacy alias:
                    // choices), quoted for the CF7 tag syntax.
                    $select_options = array_map(function ($opt) {
                        return '"' . str_replace('"', '', sanitize_text_field($opt)) . '"';
                    }, (array) ($field['options'] ?? $field['choices'] ?? []));
                    $options_part = $select_options ? ' ' . implode(' ', $select_options) : '';
                    $form_parts[] = '<label>' . esc_html($field['label']) . "\n    [select{$required} {$tag_name}{$options_part}]</label>";
                    break;
                case 'consent':
                    // The consent box: an acceptance tag (optional unless the
                    // form is a newsletter), never ticked in advance.
                    $optional = !empty($field['required']) ? '' : ' optional';
                    $form_parts[] = '[acceptance wm-marketing-consent' . $optional . '] ' . esc_html($field['label']) . ' [/acceptance]';
                    $mail_parts[] = 'Email updates: [wm-marketing-consent]';
                    continue 2;
                default:
                    $form_parts[] = '<label>' . esc_html($field['label']) . "\n    [text{$required} {$tag_name}]</label>";
                    break;
            }
            $mail_parts[] = $field['label'] . ': [' . $tag_name . ']';
        }

        $form_parts[] = '[submit "Submit"]';
        $form_content = implode("\n\n", $form_parts);
        $mail_body = implode("\n", $mail_parts);

        // Use WPCF7 API if available
        if (class_exists('WPCF7_ContactForm')) {
            $existing_id = (int) $existing_id;
            $cf7_form = null;
            if ($existing_id > 0 && get_post_type($existing_id) === 'wpcf7_contact_form' && get_post_status($existing_id) !== 'trash') {
                $cf7_form = WPCF7_ContactForm::get_instance($existing_id);
            }
            $created = !$cf7_form;
            if (!$cf7_form) {
                $cf7_form = WPCF7_ContactForm::get_template([
                    'title' => $title,
                ]);
            }
            $cf7_form->set_title($title);
            $cf7_form->set_properties([
                'form' => $form_content,
                'mail' => [
                    'active' => true,
                    'subject' => 'New ' . $title . ' submission',
                    'sender' => '[_site_title] <[_site_admin_email]>',
                    'recipient' => '[_site_admin_email]',
                    'body' => $mail_body,
                    'additional_headers' => 'Reply-To: [email]',
                    'attachments' => '',
                    'use_html' => false,
                ],
            ]);
            $cf7_form->save();

            $form_id = $cf7_form->id();
            return [
                'success' => true,
                'id' => $form_id,
                'created' => $created,
                'shortcode' => '[contact-form-7 id="' . $form_id . '" title="' . esc_attr($title) . '"]',
                'provider' => 'cf7'
            ];
        }

        return [
            'success' => false,
            'error' => 'Contact Form 7 is active but WPCF7_ContactForm class not found',
            'provider' => 'cf7'
        ];
    }

    public function webhook_woocommerce_list_products($params) {
        if (!function_exists('wc_get_products')) {
            return [
                'success' => false,
                'error' => 'WooCommerce is not active'
            ];
        }

        $args = [
            'limit' => $params['limit'] ?? 10,
            'page' => $params['page'] ?? 1,
            'status' => $params['status'] ?? 'publish',
            'orderby' => $params['orderby'] ?? 'date',
            'order' => $params['order'] ?? 'DESC'
        ];

        if (!empty($params['category'])) {
            $args['category'] = [$params['category']];
        }

        if (!empty($params['search'])) {
            $args['s'] = $params['search'];
        }

        $products = wc_get_products($args);
        $result = [];

        foreach ($products as $product) {
            // Expose the featured image so callers can render a compact product
            // THUMBNAIL (a plain <img> linked to the permalink) — WooCommerce has
            // no thumbnail-only shortcode, and [product]/[products] render the
            // full card (image+title+price+add-to-cart), which breaks when forced
            // into a small/decorative box.
            $image_id = $product->get_image_id();
            $image_url = $image_id ? wp_get_attachment_image_url($image_id, 'woocommerce_thumbnail') : null;
            $result[] = [
                'id' => $product->get_id(),
                'name' => $product->get_name(),
                'slug' => $product->get_slug(),
                'permalink' => $product->get_permalink(),
                'price' => $product->get_price(),
                'regular_price' => $product->get_regular_price(),
                'sale_price' => $product->get_sale_price(),
                'status' => $product->get_status(),
                'image_id' => $image_id ? (int) $image_id : null,
                'image' => $image_url ?: null,
                'shortcode' => '[products ids="' . $product->get_id() . '"]'
            ];
        }

        return [
            'success' => true,
            'products' => $result,
            'count' => count($result)
        ];
    }

    /**
     * Gift-card capability status (PW WooCommerce Gift Cards).
     * The read the API's setup_gift_cards tool verifies against: WooCommerce
     * state, backing-plugin state, and the live gift-card product if any.
     */
    public function webhook_gift_cards_status() {
        // find_plugin_file/is_plugin_active are wp-admin functions that are
        // not loaded in a plain webhook request.
        if (!function_exists('is_plugin_active')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        $plugin_file = $this->find_plugin_file('pw-woocommerce-gift-cards');
        $plugin_active = $plugin_file ? is_plugin_active($plugin_file) : false;

        // Type-taxonomy lookup, NOT wc_get_products: while the PW plugin is
        // inactive its product type is unregistered, so a WC product query
        // for it cannot be trusted; the term assignment still exists.
        $product_ids = get_posts([
            'post_type' => 'product',
            'post_status' => 'any',
            'numberposts' => 1,
            'fields' => 'ids',
            'tax_query' => [[
                'taxonomy' => 'product_type',
                'field' => 'slug',
                'terms' => 'pw-gift-card',
            ]],
        ]);
        $product_id = !empty($product_ids) ? (int) $product_ids[0] : null;

        return [
            'success' => true,
            'woocommerce_active' => class_exists('WooCommerce'),
            'plugin_installed' => $plugin_file !== null,
            'plugin_active' => $plugin_active,
            'product_id' => $product_id,
            'product_status' => $product_id ? get_post_status($product_id) : null,
            'product_url' => $product_id ? get_permalink($product_id) : null,
            'amounts' => ($product_id && $plugin_active) ? $this->gift_card_product_amounts($product_id) : [],
            'currency' => function_exists('get_woocommerce_currency') ? get_woocommerce_currency() : null,
        ];
    }

    /**
     * Create (or top up) the store's gift-card product with the given
     * denominations. Requires PW WooCommerce Gift Cards ACTIVE, and in a
     * request AFTER the one that activated it: the PW product class loads at
     * plugins_loaded, so it does not exist inside the activating request.
     * Idempotent: reuses the existing gift-card product, and PW's
     * add_amount() skips denominations that already exist.
     */
    public function webhook_gift_cards_create_product($params) {
        if (!function_exists('wc_get_product')) {
            return [
                'success' => false,
                'error' => 'WooCommerce is not active'
            ];
        }
        if (!class_exists('WC_Product_PW_Gift_Card') || !isset($GLOBALS['pw_gift_cards'])) {
            return [
                'success' => false,
                'error' => 'PW WooCommerce Gift Cards is not active. Install and activate pw-woocommerce-gift-cards first, then retry in a new request.'
            ];
        }

        $amounts = [];
        foreach ((array) ($params['amounts'] ?? [25, 50, 100]) as $amount) {
            if (is_numeric($amount) && (float) $amount > 0) {
                $amounts[] = (float) $amount;
            }
        }
        if (empty($amounts)) {
            return [
                'success' => false,
                'error' => 'amounts must contain at least one number greater than zero'
            ];
        }

        try {
            $existing = get_posts([
                'post_type' => 'product',
                'post_status' => 'any',
                'numberposts' => 1,
                'fields' => 'ids',
                'tax_query' => [[
                    'taxonomy' => 'product_type',
                    'field' => 'slug',
                    'terms' => 'pw-gift-card',
                ]],
            ]);

            if (!empty($existing)) {
                $product = new \WC_Product_PW_Gift_Card((int) $existing[0]);
                $created = false;
                if ($product->get_status() !== 'publish') {
                    $product->set_status('publish');
                    $product->save();
                }
            } else {
                $product = new \WC_Product_PW_Gift_Card();
                $product->set_name(!empty($params['name']) ? sanitize_text_field($params['name']) : 'Gift Card');
                if (!empty($params['description'])) {
                    $product->set_description(wp_kses_post($params['description']));
                }
                $product->set_status('publish');
                $product->save();
                $created = true;
            }

            // add_amount() returns the variation id on success, or a string
            // when it refuses (duplicate denomination, invalid amount).
            $added = [];
            foreach ($amounts as $amount) {
                if (is_numeric($product->add_amount($amount))) {
                    $added[] = $amount;
                }
            }

            return [
                'success' => true,
                'id' => $product->get_id(),
                'created' => $created,
                'name' => $product->get_name(),
                'status' => get_post_status($product->get_id()),
                'permalink' => get_permalink($product->get_id()),
                'amounts' => $this->gift_card_product_amounts($product->get_id()),
                'amounts_added' => $added,
                'currency' => function_exists('get_woocommerce_currency') ? get_woocommerce_currency() : null,
            ];
        } catch (Exception $e) {
            return [
                'success' => false,
                'error' => 'Failed to set up the gift card product: ' . $e->getMessage()
            ];
        }
    }

    /**
     * The denominations currently purchasable on a gift-card product: the
     * regular prices of its variations, in the store currency.
     */
    private function gift_card_product_amounts($product_id) {
        $product = wc_get_product($product_id);
        if (!$product) {
            return [];
        }
        $amounts = [];
        foreach ($product->get_children() as $child_id) {
            $variation = wc_get_product($child_id);
            if ($variation) {
                // 'edit' context so currency plugins cannot convert the stored price.
                $price = $variation->get_regular_price('edit');
                if ($price !== '' && $price !== null) {
                    $amounts[] = (float) $price;
                }
            }
        }
        sort($amounts);
        return $amounts;
    }

    /**
     * Upload image from URL (helper for WooCommerce product images)
     */
    /**
     * SSRF guard: true only when every A/AAAA record for
     * the URL host is a public address. Fails closed on unresolvable hosts.
     */
    public function wm_url_host_is_public(string $url): bool {
        $host = wp_parse_url($url, PHP_URL_HOST);
        if (!is_string($host) || $host === '') return false;
        $host = trim($host, '[]'); // IPv6 literal brackets
        $ips = [];
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            $ips[] = $host;
        } else {
            $v4 = @gethostbynamel($host);
            if (is_array($v4)) { $ips = array_merge($ips, $v4); }
            if (function_exists('dns_get_record')) {
                $aaaa = @dns_get_record($host, DNS_AAAA);
                if (is_array($aaaa)) {
                    foreach ($aaaa as $rec) { if (!empty($rec['ipv6'])) { $ips[] = $rec['ipv6']; } }
                }
            }
        }
        if (empty($ips)) return false; // unresolvable -> fail closed
        foreach ($ips as $ip) {
            // NO_PRIV_RANGE: 10/8, 172.16/12, 192.168/16, fc00::/7.
            // NO_RES_RANGE: 127/8, 169.254/16 (metadata), 0/8, ::1, fe80::/10, 240/4.
            if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
                return false;
            }
        }
        return true;
    }

    public function upload_image_from_url($url, $title = '') {
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';

        // Validate URL
        if (!filter_var($url, FILTER_VALIDATE_URL)) {
            WebMaven_Log::write("WebMaven: Invalid image URL: {$url}");
            return new \WP_Error('invalid_url', 'Invalid image URL');
        }

        // Protocol whitelist
        $scheme = wp_parse_url($url, PHP_URL_SCHEME);
        if (!in_array($scheme, ['http', 'https'], true)) {
            WebMaven_Log::write("WebMaven: Rejected non-HTTP image URL scheme: {$scheme}");
            return new \WP_Error('invalid_scheme', 'Only HTTP/HTTPS URLs are allowed');
        }

        // Block URLs resolving to private, loopback,
        // link-local or reserved addresses (incl. the cloud metadata IP), and make
        // redirects re-validate the same way (reject_unsafe_urls).
        if (!$this->wm_url_host_is_public($url)) {
            WebMaven_Log::write("WebMaven: Rejected SSRF-unsafe image URL: {$url}");
            return new \WP_Error('blocked_host', 'Image URL resolves to a private or reserved address');
        }
        $wm_safe_http = static function ($args) {
            $args['reject_unsafe_urls'] = true;
            if (!isset($args['redirection']) || $args['redirection'] > 3) { $args['redirection'] = 3; }
            return $args;
        };
        add_filter('http_request_args', $wm_safe_http);
        // Download file to temp location with 30s timeout
        $tmp = download_url($url, 30);
        remove_filter('http_request_args', $wm_safe_http);
        if (is_wp_error($tmp)) {
            return $tmp;
        }

        // Check filesize (10MB max)
        $filesize = filesize($tmp);
        if ($filesize > 10 * 1024 * 1024) {
            wp_delete_file($tmp);
            WebMaven_Log::write("WebMaven: Image too large ({$filesize} bytes): {$url}");
            return new \WP_Error('file_too_large', 'Image exceeds 10MB limit');
        }

        // Get file info
        $file_array = [
            'name' => basename(wp_parse_url($url, PHP_URL_PATH)) ?: 'product-image.jpg',
            'tmp_name' => $tmp
        ];

        // Upload to media library
        $attachment_id = media_handle_sideload($file_array, 0, $title);

        // Clean up temp file
        wp_delete_file($tmp);

        return $attachment_id;
    }

    // ── Homepage / posts page setup ─────────────────────────────────────

    /**
     * Set a static homepage. Accepts either { page_id } or { slug }.
     * Sugar over update_option('show_on_front','page') + update_option('page_on_front').
     */
    public function webhook_set_homepage($params) {
        $page_id = isset($params['page_id']) ? (int) $params['page_id'] : 0;
        $slug = isset($params['slug']) ? sanitize_title((string) $params['slug']) : '';
        $title = isset($params['title']) ? sanitize_text_field((string) $params['title']) : '';

        if (!$page_id && $slug) {
            $page = get_page_by_path($slug);
            if ($page) $page_id = (int) $page->ID;
        }
        if (!$page_id && $title) {
            // get_page_by_title() is deprecated in WP 6.2+; use a direct query.
            global $wpdb;
            $found = $wpdb->get_var($wpdb->prepare(
                "SELECT ID FROM {$wpdb->posts} WHERE post_title = %s AND post_type = 'page' AND post_status IN ('publish','draft','private') ORDER BY ID ASC LIMIT 1",
                $title,
            ));
            if ($found) $page_id = (int) $found;
        }
        if (!$page_id) {
            throw new \Exception('page_id, slug, or title required to set homepage');
        }
        if (!get_post($page_id)) {
            throw new \Exception("Page {$page_id} not found");
        }
        $this->refuse_owners_page_if_protected($params, $page_id, 'make the homepage of');
        // The setting before this call: the owner's one-click switch keeps
        // it, so the old front page can be put back (restore_front).
        $previous = class_exists('WebMaven_Front_Page') ? WebMaven_Front_Page::setting() : null;
        update_option('show_on_front', 'page');
        update_option('page_on_front', $page_id);
        // A posts page of WPMaven's keeps the latest posts reachable once
        // the front page is a page; any other id is ignored. The front page
        // and the posts page can never be the same page.
        $posts_page_id = isset($params['posts_page_id']) ? (int) $params['posts_page_id'] : 0;
        if ($posts_page_id > 0 && $posts_page_id !== $page_id && class_exists('WebMaven_Front_Page')
            && WebMaven_Front_Page::live_page_id($posts_page_id) === $posts_page_id && WebMaven_Front_Page::is_wpmaven_page($posts_page_id)) {
            update_option('page_for_posts', $posts_page_id);
        } elseif ((int) get_option('page_for_posts', 0) === $page_id) {
            update_option('page_for_posts', 0);
        }
        return [
            'show_on_front' => 'page',
            'page_on_front' => $page_id,
            'page_title' => get_the_title($page_id),
            'permalink' => get_permalink($page_id),
            'page_for_posts' => (int) get_option('page_for_posts', 0),
            'previous' => $previous,
        ];
    }

    /**
     * Set the blog posts page. Accepts { page_id } or { slug }.
     */
    public function webhook_set_page_for_posts($params) {
        $page_id = isset($params['page_id']) ? (int) $params['page_id'] : 0;
        $slug = isset($params['slug']) ? sanitize_title((string) $params['slug']) : '';
        if (!$page_id && $slug) {
            $page = get_page_by_path($slug);
            if ($page) $page_id = (int) $page->ID;
        }
        if (!$page_id) {
            throw new \Exception('page_id or slug required');
        }
        // Validate the target is a real page (parity with set_homepage) — a
        // wrong/hallucinated id would otherwise store a bogus page_for_posts and
        // produce a broken archive with no error surfaced.
        $target = get_post($page_id);
        if (!$target || $target->post_type !== 'page') {
            throw new \Exception('page_for_posts target must be an existing page');
        }
        // A connected site's first build never makes the OWNER's page the
        // posts index (its content would stop rendering): only a page
        // WPMaven made (the AI marker) may be wired while protect_existing
        // is on (2026-09-22; finalize_site applies the same rule).
        $this->refuse_owners_page_if_protected($params, $page_id, 'make the posts page of');
        // WordPress treats page_for_posts == page_on_front as invalid (the front
        // page wins, the archive is lost) — reject the collision.
        if ((int) get_option('page_on_front') === $page_id) {
            throw new \Exception('page_for_posts cannot be the same as the front page');
        }
        update_option('page_for_posts', $page_id);
        // Posts render on this page only when the front is a STATIC page. The
        // onboarding spine sets a static homepage first; flip show_on_front
        // defensively — but ONLY when a front page actually exists, since
        // show_on_front='page' with page_on_front=0 renders a BLANK homepage.
        if (get_option('show_on_front') !== 'page' && (int) get_option('page_on_front') > 0) {
            update_option('show_on_front', 'page');
        }
        return ['page_for_posts' => (int) $page_id, 'show_on_front' => get_option('show_on_front')];
    }

    /**
     * Set the site's permalink structure and flush rewrite rules.
     *
     * A pretty-permalink switch can't go through webhook_update_option — the
     * `rewrite_rules` option is on the blocked list, so updating only
     * `permalink_structure` would leave stale rules and the new slugs would
     * 404. This handler updates the structure AND flushes (hard flush, so
     * .htaccess is rewritten where applicable).
     *
     * Accepts { structure }. Only a small set of known-safe structures is
     * allowed; anything else falls back to '/%postname%/'.
     */
    public function webhook_set_permalink_structure($params) {
        $structure = isset($params['structure']) ? (string) $params['structure'] : '/%postname%/';

        $allowed = [
            '/%postname%/',
            '/%year%/%monthnum%/%postname%/',
            '/%year%/%monthnum%/%day%/%postname%/',
            '/%category%/%postname%/',
            '/archives/%post_id%',
        ];
        if (!in_array($structure, $allowed, true)) {
            $structure = '/%postname%/';
        }

        $this->switch_permalink_structure($structure);

        return [
            'permalink_structure' => get_option('permalink_structure'),
            'flushed' => true,
        ];
    }

    /**
     * Switch the permalink structure and hard flush in the same request.
     *
     * WP_Rewrite::set_permalink_structure() re-inits the rewrite object,
     * which empties the endpoints and rules plugins registered on init
     * (WooCommerce's order-received and My Account endpoints). A flush right
     * after would store rules without them: the order confirmation would
     * fall through to the front page and account pages would 404. They are
     * carried across the switch so the flush keeps them.
     */
    private function switch_permalink_structure(string $structure): void {
        global $wp_rewrite;
        if (!($wp_rewrite instanceof \WP_Rewrite)) {
            require_once ABSPATH . WPINC . '/class-wp-rewrite.php';
            $wp_rewrite = new \WP_Rewrite();
        }
        $kept = [];
        foreach (['endpoints', 'extra_rules', 'non_wp_rules'] as $prop) {
            if (isset($wp_rewrite->$prop)) {
                $kept[$prop] = $wp_rewrite->$prop;
            }
        }
        $wp_rewrite->set_permalink_structure($structure);
        foreach ($kept as $prop => $value) {
            $wp_rewrite->$prop = $value;
        }
        // Hard flush: regenerate rewrite rules and update server config files.
        require_once ABSPATH . 'wp-admin/includes/misc.php';
        $wp_rewrite->flush_rules(true);
    }

    /**
     * Atomically finalize a generated site (mirrors the genstudio driver's
     * finalize step): the front page, the posts page, WooCommerce's shop page
     * renamed to shop_slug so plan links resolve, WordPress's privacy page,
     * then the permalink structure and a rewrite flush, in one action.
     *
     * Params: { front_slug: string, front_page_id?: int,
     *           front?: 'set'|'if_default'|'keep' (default 'set'; the legacy
     *             keep_front: true reads as 'keep'), posts_slug?, shop_slug?,
     *           privacy_slug?, permalink?: string = '/%postname%/',
     *           keep_permalink?: bool }
     *
     * front: 'set' (a fresh hosted site) opens the site on the designed page;
     * 'if_default' (a site the owner already runs) does so only while the
     * front page is WordPress's default and nothing on the site is the
     * owner's (WebMaven_Front_Page::verdict), otherwise the switch is only
     * offered; 'keep' never touches it. The designed page is front_page_id
     * when it is WPMaven's, else the page at front_slug (on a site the owner
     * runs, only a published page WPMaven made is ever set).
     *
     * Answer adds front_decision ('set'|'offered'|'kept'), front_reason
     * ('asked_to_set'|'wordpress_default'|'owner_static_front'|'owner_content'
     * |'asked_to_keep'|'no_designed_page'), previous (the setting before this
     * call), front_page_id (the designed page, even when only offered) and
     * privacy_page_id.
     */
    public function webhook_finalize_site($params) {
        $mode = (string) ($params['front'] ?? '');
        if (!in_array($mode, ['set', 'if_default', 'keep'], true)) {
            $mode = !empty($params['keep_front']) ? 'keep' : 'set';
        }
        // A site the owner already runs: only pages WPMaven made are wired.
        $connected = $mode !== 'set' || !empty($params['protect_existing']);
        $previous = WebMaven_Front_Page::setting();

        $designed = $this->designed_front_page($params, $connected);
        $designed_live = $designed && (string) ($designed->post_status ?? '') === 'publish';
        $front_set = false;
        if ($mode === 'keep') {
            $decision = 'kept';
            $reason = 'asked_to_keep';
        } elseif ($mode === 'set') {
            $reason = $designed ? 'asked_to_set' : 'no_designed_page';
            $decision = $designed ? 'set' : 'kept';
            if ($designed) {
                WebMaven_Front_Page::use_page((int) $designed->ID);
                $front_set = true;
            }
        } else {
            $verdict = WebMaven_Front_Page::verdict();
            if (!$designed) {
                $decision = 'kept';
                $reason = 'no_designed_page';
            } elseif ($verdict['would_set'] && $designed_live) {
                WebMaven_Front_Page::use_page((int) $designed->ID);
                $front_set = true;
                $decision = 'set';
                $reason = 'wordpress_default';
            } else {
                $decision = 'offered';
                $reason = $verdict['reason'];
            }
        }

        // On a site the owner already runs, only a page WPMaven made becomes
        // the posts page: the planned posts page may have been parked as a
        // draft because the owner has a page at that address, and making
        // theirs the posts index would stop its content rendering
        // (2026-09-22). Nor does it replace the owner's own posts page while
        // their front page stays theirs.
        $posts_page_id = null;
        $posts_page_left_alone = null;
        if (!empty($params['posts_slug'])) {
            $posts = get_page_by_path(sanitize_title($params['posts_slug']), OBJECT, 'page');
            if ($posts && $connected && !$this->is_ours((int) $posts->ID)) {
                $posts_page_left_alone = ['id' => (int) $posts->ID, 'slug' => sanitize_title($params['posts_slug'])];
            } elseif ($posts && (int) $posts->ID !== (int) get_option('page_on_front', 0)) {
                $current_posts = WebMaven_Front_Page::live_page_id(get_option('page_for_posts', 0));
                if (!$connected || $front_set || $current_posts === 0 || $this->is_ours($current_posts)) {
                    update_option('page_for_posts', $posts->ID);
                    $posts_page_id = (int) $posts->ID;
                }
            }
        }

        // The Woo shop page joins the plan namespace: its slug must equal the
        // planned archive slug so shop-like links resolve. On a connected
        // site the owner's shop page keeps its address unless WPMaven made it.
        $shop_renamed = false;
        $shop_left_alone = null;
        if (!empty($params['shop_slug']) && function_exists('wc_get_page_id')) {
            $shop_slug = sanitize_title($params['shop_slug']);
            $shop_id = wc_get_page_id('shop');
            if ($shop_id > 0 && get_post_field('post_name', $shop_id) !== $shop_slug) {
                if ($connected && !$this->is_ours((int) $shop_id)) {
                    $shop_left_alone = ['id' => (int) $shop_id, 'slug' => (string) get_post_field('post_name', $shop_id)];
                } else {
                    wp_update_post(['ID' => $shop_id, 'post_name' => $shop_slug]);
                    $shop_renamed = true;
                }
            }
        }

        // WordPress's privacy page: the build's own, published privacy page
        // takes over when the setting names no page, a page that is gone, or
        // WordPress's untouched draft. A privacy page of the owner's stays.
        $privacy_page_id = null;
        if (!empty($params['privacy_slug'])) {
            $planned = get_page_by_path(sanitize_title($params['privacy_slug']), OBJECT, 'page');
            if ($planned && (string) ($planned->post_status ?? '') === 'publish' && $this->is_ours((int) $planned->ID)) {
                $current = (int) get_option('wp_page_for_privacy_policy', 0);
                $current_post = $current > 0 ? get_post($current) : null;
                $replaceable = $current <= 0 || !$current_post || (string) ($current_post->post_status ?? '') === 'trash'
                    || (class_exists('WebMaven_Default_Content') && WebMaven_Default_Content::untouched_kind($current_post) === WebMaven_Default_Content::PRIVACY_DRAFT);
                if ($replaceable && $current !== (int) $planned->ID) {
                    update_option('wp_page_for_privacy_policy', (int) $planned->ID);
                }
            }
            $privacy_page_id = (int) get_option('wp_page_for_privacy_policy', 0) ?: null;
        }

        // Permalinks last, so the freshly assigned front/posts/shop slugs are
        // all covered by the same flush (same whitelist + fallback as
        // webhook_set_permalink_structure). keep_permalink: a site the owner
        // runs keeps its structure; the rules are refreshed for the new
        // pages and plugins.
        $keep_permalink = !empty($params['keep_permalink']);
        if ($keep_permalink) {
            if (function_exists('flush_rewrite_rules')) {
                flush_rewrite_rules(false);
            } elseif (isset($GLOBALS['wp_rewrite']) && is_object($GLOBALS['wp_rewrite'])) {
                $GLOBALS['wp_rewrite']->flush_rules(false);
            }
        } else {
            $structure = isset($params['permalink']) ? (string) $params['permalink'] : '/%postname%/';
            $allowed = [
                '/%postname%/',
                '/%year%/%monthnum%/%postname%/',
                '/%year%/%monthnum%/%day%/%postname%/',
                '/%category%/%postname%/',
                '/archives/%post_id%',
            ];
            if (!in_array($structure, $allowed, true)) {
                $structure = '/%postname%/';
            }
            $this->switch_permalink_structure($structure);
        }

        $out = [
            'front_page_id' => $designed ? (int) $designed->ID : null,
            'posts_page_id' => $posts_page_id,
            'shop_renamed' => $shop_renamed,
            'permalink_structure' => get_option('permalink_structure'),
            'front_decision' => $decision,
            'front_reason' => $reason,
            'previous' => $previous,
            'privacy_page_id' => $privacy_page_id,
        ];
        if ($keep_permalink) {
            $out['permalink_left_alone'] = true;
        }
        if ($connected) {
            $out['posts_page_left_alone'] = $posts_page_left_alone;
            $out['shop_left_alone'] = $shop_left_alone;
        }
        return $out;
    }

    /**
     * The designed homepage of a build: front_page_id when that page is
     * WPMaven's, else the page at front_slug. On a site the owner runs only a
     * page WPMaven made counts (a parked draft is still reported, to be
     * offered); on a fresh hosted site the page at the address, as before.
     */
    private function designed_front_page($params, bool $connected) {
        $id = isset($params['front_page_id']) ? (int) $params['front_page_id'] : 0;
        if ($id > 0) {
            $page = get_post($id);
            if ($page && (string) ($page->post_type ?? '') === 'page' && (string) ($page->post_status ?? '') !== 'trash'
                && WebMaven_Front_Page::is_wpmaven_page($id)) {
                return $page;
            }
        }
        $page = get_page_by_path(sanitize_title($params['front_slug'] ?? 'index'), OBJECT, 'page');
        if (!$page) {
            return null;
        }
        if (!$connected) {
            return $page;
        }
        return WebMaven_Front_Page::is_wpmaven_page((int) $page->ID) ? $page : null;
    }

    /** Whether WPMaven made this post or page (the AI marker). */
    private function is_ours(int $post_id): bool {
        return $post_id > 0 && class_exists('WebMaven_AI_Marking') && WebMaven_AI_Marking::is_ai_generated($post_id);
    }

    /**
     * A connected site's first build (protect_existing, 2026-09-22): a page
     * without WPMaven's AI marker is the owner's and is never repurposed as
     * the homepage or the posts page by that build. Same rule and wording as
     * WebMaven_WordPress_Commands::refuse_owners_post_if_protected.
     */
    private function refuse_owners_page_if_protected($params, int $page_id, string $verb): void {
        if (empty($params['protect_existing']) || $this->is_ours($page_id)) {
            return;
        }
        throw new \Exception("This page or post (#{$page_id}) is the owner's, not one WPMaven made: the first build leaves it alone and does not {$verb} it. Ask for the change after the build, so the owner can approve it.");
    }

    // ── Post revisions ──────────────────────────────────────────────────

    /**
     * List recent revisions for a post/page. Lets the agent answer "what
     * did the homepage look like 2 hours ago?" without manual exploration.
     *
     * Params: { post_id: number, limit?: number = 10 }
     */
    public function webhook_get_post_revisions($params) {
        $post_id = isset($params['post_id']) ? (int) $params['post_id'] : 0;
        if (!$post_id) {
            throw new \Exception('post_id is required');
        }
        $limit = isset($params['limit']) ? max(1, min((int) $params['limit'], 50)) : 10;

        $revisions = wp_get_post_revisions($post_id, [
            'numberposts' => $limit,
            'orderby' => 'date',
            'order' => 'DESC',
        ]);

        $out = [];
        foreach ($revisions as $rev) {
            $out[] = [
                'id' => $rev->ID,
                'parent' => $rev->post_parent,
                'date' => $rev->post_date_gmt,
                'author' => get_the_author_meta('display_name', $rev->post_author),
                'title' => $rev->post_title,
                'excerpt' => mb_substr(wp_strip_all_tags($rev->post_content), 0, 200),
            ];
        }
        return ['post_id' => $post_id, 'revisions' => $out];
    }

    // ── Backups ─────────────────────────────────────────────────────────

    /**
     * Create a backup: dump the DB via wp-cli (or wpdb fallback) + zip
     * the uploads dir, store under wp-content/uploads/webmaven-backups/
     * for the dev environment. Production should swap the storage path
     * for GCS streaming.
     *
     * Returns the shape backupService expects:
     *   { success: true, data: { gcsPath, sizeBytes, ... } }
     * In dev, gcsPath is a `file://` URI to the local archive.
     */
    /**
     * Keep a directory under uploads private: an index.php so a listing shows
     * nothing, and a .htaccess that denies every request on Apache (the
     * uploads tree is served as static files, and a database dump holds every
     * option value, token and password hash). Written each time, so a
     * directory created before 2026-09-22 is covered too. nginx does not read
     * .htaccess; the archive's random name is the second line there.
     */
    private function protect_private_dir(string $dir): void {
        if (!is_dir($dir)) return;
        if (!file_exists($dir . '/index.php')) {
            @file_put_contents($dir . '/index.php', "<?php\n// Silence is golden.\n");
        }
        if (!file_exists($dir . '/.htaccess')) {
            @file_put_contents(
                $dir . '/.htaccess',
                "# WPMaven: backup archives are never served.\n"
                . "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n"
                . "<IfModule !mod_authz_core.c>\n    Order deny,allow\n    Deny from all\n</IfModule>\n"
            );
        }
    }

    /** An unguessable suffix for an archive name (a timestamp alone is guessable to the second). */
    private function archive_nonce(): string {
        if (function_exists('wp_generate_password')) {
            $s = (string) wp_generate_password(24, false, false);
            if (preg_match('/^[A-Za-z0-9]{24}$/', $s)) return $s;
        }
        try {
            return bin2hex(random_bytes(12));
        } catch (\Throwable $e) {
            return substr(str_shuffle(str_repeat('abcdefghijklmnopqrstuvwxyz0123456789', 2)), 0, 24);
        }
    }

    public function webhook_backup_create($params) {
        $note = isset($params['note']) ? sanitize_text_field((string) $params['note']) : null;
        $upload_info = wp_upload_dir();
        $backup_root = trailingslashit($upload_info['basedir']) . 'webmaven-backups';
        wp_mkdir_p($backup_root);
        if (!wp_is_writable($backup_root)) {
            return ['success' => false, 'error' => "Backup directory not writable: $backup_root"];
        }
        $this->protect_private_dir($backup_root);

        // The folder stays bounded, or a site's disk would fill one backup at
        // a time. A staging
        // folder left by a backup that never finished holds a whole database
        // dump: those go first, after a day. Then, when the server tells its
        // free space and there is clearly no room for an archive the size of
        // the last one, the oldest archive goes first (two always stay to
        // fall back on while this one is written); still no room, and the
        // backup is refused instead of filling the disk the site runs on.
        WebMaven_Backup_Retention::sweep_stale_stages($backup_root);
        $room = WebMaven_Backup_Retention::make_room($backup_root);
        if ($room['problem'] !== null) {
            return ['success' => false, 'error' => $room['problem'], 'pruned' => $room['removed']];
        }

        // The archive holds every option value (the plugin's tokens, every
        // other plugin's keys) and every password hash, under wp-content/
        // uploads, which the web server serves. The name carries a random
        // part so it cannot be guessed from the time the backup was taken,
        // and the directory denies requests (protect_private_dir).
        $stamp = gmdate('Ymd-His') . '-' . $this->archive_nonce();
        $stage_dir = $backup_root . '/.stage-' . $stamp;
        wp_mkdir_p($stage_dir);

        // 1. DB dump
        $sql_path = $stage_dir . '/db.sql';
        $db_dumped = $this->dump_database($sql_path);
        if (!$db_dumped['ok']) {
            $this->rmrf($stage_dir);
            return ['success' => false, 'error' => 'DB dump failed: ' . $db_dumped['error']];
        }

        // 2. Zip uploads dir + db dump together
        if (!class_exists('ZipArchive')) {
            $this->rmrf($stage_dir);
            return ['success' => false, 'error' => 'ZipArchive not available; cannot create backup'];
        }
        $archive = $backup_root . "/backup-{$stamp}.zip";
        $zip = new \ZipArchive();
        if ($zip->open($archive, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            $this->rmrf($stage_dir);
            return ['success' => false, 'error' => 'Could not open archive for writing'];
        }
        $zip->addFile($sql_path, 'db.sql');
        if ($note) {
            $zip->addFromString('NOTE.txt', $note);
        }
        $zip->addFromString('META.json', wp_json_encode([
            'created_at' => gmdate('c'),
            'wp_version' => get_bloginfo('version'),
            'site_url' => get_site_url(),
            'home_url' => get_home_url(),
            'note' => $note,
        ]));
        // Walk uploads/ but skip the backup dir itself.
        $this->add_dir_to_zip($zip, $upload_info['basedir'], 'uploads', $backup_root);
        $zip->close();
        $this->rmrf($stage_dir);

        $size = filesize($archive);
        if (!$size) {
            return ['success' => false, 'error' => 'Archive ended up empty'];
        }

        // This archive is written: the newest ones stay (this one always),
        // older ones go. An archive that cannot be removed is logged there
        // and the backup is reported as made all the same.
        $retention = WebMaven_Backup_Retention::prune($backup_root, basename($archive));

        // The webhook layer wraps this in `wp_send_json_success({data: $result})`,
        // so we return the FLAT payload (no extra success/data nesting) — the
        // API's backupService reads it from `result.response.data.data.{field}`.
        $gcs_path = 'file://' . $archive;
        return [
            'gcsPath' => $gcs_path,
            'sizeBytes' => $size,
            'created_at' => gmdate('c'),
            'note' => $note,
            'archive' => basename($archive),
            // The older archives this backup replaced, by file name (the ones
            // that went to make room first): a restore of one of them answers
            // that it is no longer on the site.
            'kept' => WebMaven_Backup_Retention::KEEP,
            'pruned' => array_values(array_merge($room['removed'], $retention['removed'])),
        ];
    }

    /**
     * Restore from a previously-created backup.
     * Params: { gcsPath: string }   ← what the API stores in the Backup row.
     *
     * For dev (file:// scheme) we read directly. Production would download
     * from GCS first.
     */
    public function webhook_backup_restore($params) {
        $gcs_path = isset($params['gcsPath']) ? (string) $params['gcsPath'] : '';
        if ($gcs_path === '') {
            return ['success' => false, 'error' => 'gcsPath is required'];
        }
        $local_path = $gcs_path;
        if (str_starts_with($local_path, 'file://')) {
            $local_path = substr($local_path, 7);
        }
        // The archive is fed straight to ZipArchive
        // + import_database, so an arbitrary caller-named path could import a
        // db.sql from anywhere on disk. Constrain the source to the plugin's own
        // backups dir ({uploads}/webmaven-backups), resolved with realpath so ..
        // and symlinks cannot escape it. Fail closed.
        $wm_backup_root = realpath(trailingslashit(wp_upload_dir()['basedir']) . 'webmaven-backups');
        $wm_real = realpath($local_path);
        if ($wm_backup_root === false || $wm_real === false
            || strpos($wm_real, $wm_backup_root . DIRECTORY_SEPARATOR) !== 0
            || !preg_match('/\.(zip|sql)$/i', $wm_real)) {
            // An archive of ours that is simply gone: only the newest ones are
            // kept (WebMaven_Backup_Retention). Its name alone is read here,
            // and only to choose the sentence.
            $wm_name = basename(str_replace('\\', '/', $local_path));
            if ($wm_backup_root !== false && $wm_real === false && WebMaven_Backup_Retention::is_archive_name($wm_name)
                && !file_exists($wm_backup_root . DIRECTORY_SEPARATOR . $wm_name)) {
                return ['success' => false, 'error' => sprintf('This backup is no longer on the site: the newest %d backups are kept and older ones are removed.', WebMaven_Backup_Retention::KEEP)];
            }
            return ['success' => false, 'error' => 'Restore source must be a backup archive in the plugin backups directory'];
        }
        $local_path = $wm_real;
        if (!file_exists($local_path)) {
            return ['success' => false, 'error' => "Backup archive not found: $local_path"];
        }
        if (!class_exists('ZipArchive')) {
            return ['success' => false, 'error' => 'ZipArchive not available; cannot restore'];
        }

        $upload_info = wp_upload_dir();
        $stage = trailingslashit($upload_info['basedir']) . 'webmaven-restore-' . gmdate('Ymd-His') . '-' . $this->archive_nonce();
        wp_mkdir_p($stage);
        $this->protect_private_dir($stage);

        $zip = new \ZipArchive();
        if ($zip->open($local_path) !== true) {
            return ['success' => false, 'error' => 'Could not open backup archive'];
        }
        $zip->extractTo($stage);
        $zip->close();

        // WPMaven's connection and the site's administrators survive the
        // restore (2026-09-22). A dump is a copy of the whole options and
        // usermeta tables: an older one puts back rotated tokens and older
        // capability rows, a crafted one (any archive in this directory, put
        // there by an approved write) removes WPMaven's options, its place in
        // active_plugins or every administrator. The same snapshots every
        // other write path takes are taken here and put back after the
        // import, and the answer says what was preserved. A real restore of
        // an older dump always rewrites these rows, so the put-back is the
        // rule, not a failure.
        $protect_before = WebMaven_Self_Protect::snapshot();
        $admins_before = WebMaven_Admin_Guard::admin_rows();
        $acting_admin = function_exists('get_current_user_id') ? (int) get_current_user_id() : 0;
        // The site's keys and salts never change with a restore (1.6.0):
        // secret_key derives the key that reads WPMaven's connection.
        $keys_before = WebMaven_Self_Protect::site_keys_snapshot();

        // Restore DB if present
        $sql = $stage . '/db.sql';
        $db_result = ['ok' => true, 'note' => 'no db.sql in archive'];
        $percent_repaired = 0;
        if (file_exists($sql)) {
            $percent_repaired = $this->repair_dump_placeholders($sql);
            $db_result = $this->import_database($sql);
        }

        // Restore uploads if present (does NOT delete current files —
        // overwrites in place. Matches "rollback" semantics for dev).
        $extracted_uploads = $stage . '/uploads';
        if (is_dir($extracted_uploads)) {
            $this->copy_dir($extracted_uploads, $upload_info['basedir']);
        }

        $this->rmrf($stage);

        // Put WPMaven's rows and the protected administrators back, and make
        // sure WPMaven's own table exists again (a dump that dropped it
        // without recreating it would otherwise leave it gone).
        $wpmaven_preserved = WebMaven_Self_Protect::restore_if_changed($protect_before);
        $keys_preserved = WebMaven_Self_Protect::site_keys_restore($keys_before);
        $admins_lost = WebMaven_Admin_Guard::admins_lost($admins_before, $acting_admin);
        if ($admins_lost !== null) {
            WebMaven_Admin_Guard::restore_admin_rows($admins_before);
        }
        if ($this->plugin && method_exists($this->plugin, 'ensure_tables')) {
            try {
                $this->plugin->ensure_tables();
            } catch (\Throwable $e) {
                WebMaven_Log::write('WebMaven: could not recreate the plugin table after a restore: ' . $e->getMessage());
            }
        }

        if (!$db_result['ok']) {
            // For real failures, throw — wp_send_json_error path returns {success:false}.
            throw new \Exception('DB restore failed: ' . $db_result['error']);
        }
        return [
            'restored_from' => basename($local_path),
            'db' => $db_result,
            'uploads_restored' => is_dir($extracted_uploads),
            'wpmaven_preserved' => $wpmaven_preserved,
            'administrators_preserved' => $admins_lost !== null ? $admins_lost : null,
            'site_keys_preserved' => $keys_preserved,
            'percent_repaired' => $percent_repaired,
        ];
    }

    /**
     * List local backups for visibility / debugging.
     */
    public function webhook_backup_list($params) {
        $upload_info = wp_upload_dir();
        $backup_root = trailingslashit($upload_info['basedir']) . 'webmaven-backups';
        if (!is_dir($backup_root)) {
            return ['backups' => []];
        }
        $files = glob($backup_root . '/backup-*.zip') ?: [];
        $rows = [];
        foreach ($files as $f) {
            $rows[] = [
                'archive' => basename($f),
                'gcsPath' => 'file://' . $f,
                'sizeBytes' => filesize($f),
                'mtime' => gmdate('c', filemtime($f)),
            ];
        }
        usort($rows, fn($a, $b) => strcmp($b['mtime'], $a['mtime']));
        return ['backups' => $rows];
    }

    // ── Backup helpers ──────────────────────────────────────────────────

    /**
     * The database dump: WPMaven Agent's WP-CLI export when Agent is here
     * and it works (faster, complete; webmaven_backup_dump_database), else
     * the wpdb-driven dump. Returns { ok: bool, error?: string }.
     */
    private function dump_database(string $sql_path): array {
        $done = apply_filters('webmaven_backup_dump_database', null, $sql_path);
        if (is_array($done) && !empty($done['ok'])) {
            return $done;
        }
        return $this->dump_database_wpdb($sql_path);
    }

    /**
     * Pure-PHP fallback using wpdb. Slow on big sites but no exec()
     * dependency. Includes only WP core tables (prefix-matched).
     */
    // A database dump is written and read a line at a time: it can be larger
    // than PHP's memory, and WordPress's filesystem API reads and writes whole
    // files only. The file is the backup's own, under the uploads folder.
    // phpcs:disable WordPress.WP.AlternativeFunctions.file_system_operations_fopen, WordPress.WP.AlternativeFunctions.file_system_operations_fwrite, WordPress.WP.AlternativeFunctions.file_system_operations_fclose
    private function dump_database_wpdb(string $sql_path): array {
        global $wpdb;
        $fp = @fopen($sql_path, 'w');
        if (!$fp) return ['ok' => false, 'error' => 'cannot open dump file for writing'];
        try {
            $tables = $wpdb->get_col($wpdb->prepare(
                'SHOW TABLES LIKE %s',
                $wpdb->esc_like($wpdb->prefix) . '%',
            ));
            fwrite($fp, self::WPDB_DUMP_HEADER . gmdate('c') . "\n");
            fwrite($fp, self::WPDB_DUMP_PERCENT_SAFE . "\n");
            fwrite($fp, "SET FOREIGN_KEY_CHECKS=0;\n\n");
            foreach ($tables as $table) {
                $create = $wpdb->get_row("SHOW CREATE TABLE `$table`", ARRAY_N);
                if (!$create) continue;
                fwrite($fp, "DROP TABLE IF EXISTS `$table`;\n");
                fwrite($fp, $create[1] . ";\n\n");
                $rows = $wpdb->get_results("SELECT * FROM `$table`", ARRAY_A);
                foreach ($rows as $row) {
                    $cols = array_map(fn($c) => "`$c`", array_keys($row));
                    $vals = array_map(function ($v) use ($wpdb) {
                        if ($v === null) return 'NULL';
                        return "'" . self::dump_literal($wpdb, (string) $v) . "'";
                    }, array_values($row));
                    fwrite($fp, "INSERT INTO `$table` (" . implode(',', $cols) . ") VALUES (" . implode(',', $vals) . ");\n");
                }
                fwrite($fp, "\n");
            }
            fwrite($fp, "SET FOREIGN_KEY_CHECKS=1;\n");
            fclose($fp);
            return ['ok' => true];
        } catch (\Throwable $e) {
            @fclose($fp);
            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }

    /** The first line of every dump dump_database_wpdb writes. */
    const WPDB_DUMP_HEADER = '-- WebMaven backup ';

    /**
     * The second line of the dumps written since 1.6.0: their values carry
     * their own % (dump_literal). An older dump lacks it, and only such a
     * dump has its placeholders turned back (repair_dump_placeholders).
     */
    const WPDB_DUMP_PERCENT_SAFE = '-- wm-dump: percent-safe';

    /**
     * A value escaped for the dump: wpdb's escaping without its placeholder.
     * Since WordPress 4.8.3, _real_escape() turns every % into a placeholder
     * unique to the request ({64 hex}) that only that request's queries turn
     * back. Written to a file and imported by a later request, it stayed in
     * the restored rows: a % in secret_key changed the key that reads
     * WPMaven's connection (the site was cut off), and permalinks or a "20%
     * off" in a post came back with a long hex code instead.
     */
    private static function dump_literal($wpdb, string $value): string {
        $escaped = $wpdb->_real_escape($value);
        return method_exists($wpdb, 'remove_placeholder_escape')
            ? $wpdb->remove_placeholder_escape($escaped)
            : $escaped;
    }

    /**
     * Turn back into % the placeholders a dump written before 1.6.0 holds,
     * so a backup already taken restores the site as it was. Only a dump of
     * dump_database_wpdb without the percent-safe line is touched, never a
     * wp-cli export (mysqldump writes no placeholder); the one risk left is
     * a value of such an old dump that really was a { and 64 hex digits and
     * a }. Returns the number of placeholders put back.
     */
    private function repair_dump_placeholders(string $sql_path): int {
        $in = @fopen($sql_path, 'r');
        if (!$in) return 0;
        $first = fgets($in);
        $second = $first === false ? false : fgets($in);
        if ($first === false || strpos($first, self::WPDB_DUMP_HEADER) !== 0
            || ($second !== false && rtrim($second) === self::WPDB_DUMP_PERCENT_SAFE)) {
            fclose($in);
            return 0;
        }
        $tmp = $sql_path . '.repaired';
        $out = @fopen($tmp, 'w');
        if (!$out) { fclose($in); return 0; }
        $count = 0;
        fwrite($out, $first);
        $line = $second;
        while ($line !== false) {
            $n = 0;
            $fixed = preg_replace('/\{[0-9a-f]{64}\}/', '%', $line, -1, $n);
            $count += (int) $n;
            fwrite($out, $fixed ?? $line);
            $line = fgets($in);
        }
        fclose($in);
        fclose($out);
        if ($count === 0 || !WebMaven_Files::move($tmp, $sql_path)) {
            wp_delete_file($tmp);
            return 0;
        }
        return $count;
    }

    // phpcs:enable WordPress.WP.AlternativeFunctions.file_system_operations_fopen, WordPress.WP.AlternativeFunctions.file_system_operations_fwrite, WordPress.WP.AlternativeFunctions.file_system_operations_fclose

    /**
     * Restore the database: WPMaven Agent's WP-CLI import when Agent is
     * here and WP-CLI runs (webmaven_backup_import_database answers), else
     * the import through wpdb.
     */
    private function import_database(string $sql_path): array {
        $done = apply_filters('webmaven_backup_import_database', null, $sql_path);
        if (is_array($done)) {
            return $done;
        }
        return $this->import_database_mysqli($sql_path);
    }

    private function import_database_mysqli(string $sql_path): array {
        global $wpdb;
        $sql = @file_get_contents($sql_path);
        if ($sql === false) return ['ok' => false, 'error' => 'cannot read sql dump'];
        $statements = array_filter(array_map('trim', explode(";\n", $sql)));
        foreach ($statements as $stmt) {
            if ($stmt === '' || str_starts_with($stmt, '--')) continue;
            // A statement of the site's own backup dump, which backup_create wrote.
            $result = $wpdb->query($stmt); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
            if ($result === false) {
                return ['ok' => false, 'error' => "statement failed: " . substr($wpdb->last_error, 0, 200)];
            }
        }
        return ['ok' => true, 'method' => 'mysqli'];
    }

    /**
     * Recursively zip a directory, mapping into a target prefix inside
     * the archive. Skips $skip_dir to avoid backing up our own backups.
     */
    private function add_dir_to_zip(\ZipArchive $zip, string $src, string $prefix, ?string $skip_dir = null): void {
        if (!is_dir($src)) return;
        $iter = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($src, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST,
        );
        foreach ($iter as $entry) {
            $path = $entry->getPathname();
            if ($skip_dir && str_starts_with($path, $skip_dir)) continue;
            $rel = substr($path, strlen($src) + 1);
            $rel = str_replace(DIRECTORY_SEPARATOR, '/', $rel);
            if ($entry->isDir()) {
                $zip->addEmptyDir($prefix . '/' . $rel);
            } else {
                $zip->addFile($path, $prefix . '/' . $rel);
            }
        }
    }

    /** Recursively copy $src directory contents into $dst (overwrites). */
    private function copy_dir(string $src, string $dst): void {
        if (!is_dir($src)) return;
        if (!is_dir($dst)) wp_mkdir_p($dst);
        $iter = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($src, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST,
        );
        foreach ($iter as $entry) {
            $rel = substr($entry->getPathname(), strlen($src) + 1);
            $target = $dst . '/' . $rel;
            if ($entry->isDir()) {
                if (!is_dir($target)) wp_mkdir_p($target);
            } else {
                @copy($entry->getPathname(), $target);
            }
        }
    }

    /** rm -rf without a shell. */
    private function rmrf(string $path): void {
        if (!file_exists($path)) return;
        if (is_file($path) || is_link($path)) { wp_delete_file($path); return; } // only called on staging folders this class builds under uploads
        $entries = @scandir($path) ?: [];
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') continue;
            $this->rmrf($path . '/' . $entry);
        }
        WebMaven_Files::rmdir($path);
    }

}
