<?php
/**
 * WebMaven WordPress Commands
 * WP operations: posts, pages, menus, widgets, themes, plugins, etc.
 * Extracted from the main plugin file.
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/class-webmaven-log.php';
require_once __DIR__ . '/class-webmaven-option-allowlist.php';

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

require_once __DIR__ . '/class-webmaven-hosting.php';

class WebMaven_WordPress_Commands {

    /**
     * Option keys stored RAW, bypassing content sanitization.
     * - wm_posts_tpl: the designed post-card HTML template. It carries literal
     *   %%URL%%/%%TITLE%%/%%IMG%% tokens that kses would mangle (a token inside
     *   href is not a valid URL); the theme escapes every token at render time.
     * - wm_posts_imgs: array of image URLs — each is passed through
     *   esc_url_raw and the list is stored JSON-encoded.
     */
    const RAW_OPTION_KEYS = ['wm_posts_tpl', 'wm_posts_imgs'];

    /**
     * webhook_* actions execute_command's convention bridge never reaches.
     * A restore imports whatever archive its gcsPath names; only the API's
     * top-level backup_restore, from a Backup row it created, may run it.
     */
    const BRIDGE_EXCLUDED_COMMANDS = ['backup_restore'];

    /** @var WebMaven_Webhook_Actions|null Injected so execute_command can delegate to webhook_<name> actions */
    private $webhook_actions = null;

    /** @var string[] Inline scripts sanitize_llm_content took out of the content it was given last. */
    private $_extracted_scripts = [];

    public function set_webhook_actions($webhook_actions) {
        $this->webhook_actions = $webhook_actions;
    }

    /**
     * Prepare the stored value for a RAW option key (see RAW_OPTION_KEYS).
     * wm_posts_tpl is stored as the raw string; wm_posts_imgs is stored as a
     * JSON-encoded array of esc_url_raw-sanitized URLs.
     */
    public static function prepare_raw_option_value($option, $value) {
        if ($option === 'wm_posts_imgs') {
            return wp_json_encode(array_map('esc_url_raw', (array) $value));
        }
        return (string) $value;
    }

    public function execute_command($command, $args) {
        switch ($command) {
            // Post operations
            case 'create_post':
                return $this->create_post($args);
            case 'update_post':
                return $this->update_post($args);
            case 'delete_post':
                return $this->delete_post($args);
            case 'get_posts':
                return $this->get_posts($args);

            // Comment operations
            case 'get_comments':
                return $this->get_comments_command($args);
            case 'update_comment':
                return $this->update_comment_command($args);
            case 'delete_comment':
                return $this->delete_comment_command($args);

            // Taxonomy operations
            case 'create_category':
                return $this->create_taxonomy_term($args, 'category');
            case 'create_tag':
                return $this->create_taxonomy_term($args, 'post_tag');
            case 'get_categories':
                return $this->get_taxonomy_terms('category', $args);
            case 'get_tags':
                return $this->get_taxonomy_terms('post_tag', $args);

            // Featured image
            case 'set_featured_image':
                return $this->set_featured_image_command($args);

            // User operations (creating or changing a user is WPMaven Agent's)
            case 'get_users':
                return $this->get_users($args);
                
            // Plugin operations (installing and switching plugins is WPMaven Agent's)
            case 'get_plugins':
                return $this->get_plugins($args);
                
            // Site front-page operations
            case 'set_homepage':
            case 'set_page_on_front':
                return $this->set_homepage($args);
            case 'set_page_for_posts':
                return $this->set_page_for_posts($args);

            // Option operations (support both prefixed and unprefixed)
            case 'update_option':
            case 'wp_update_option':
                return $this->update_option($args);
            case 'get_option':
            case 'wp_get_option':
                return $this->get_option($args);
            case 'delete_option':
            case 'wp_delete_option':
                return $this->delete_option($args);

            // Batch option operations (for plugin post-install configuration)
            case 'batch_update_options':
            case 'wp_batch_update_options':
                return $this->batch_update_options($args);

            // Media operations
            case 'upload_file':
                return $this->upload_file_command($args);
            case 'delete_file':
                return $this->delete_file($args);
            case 'get_files':
                return $this->get_files($args);
                
            // System operations
            case 'get_system_info':
                return $this->get_system_info($args);
            case 'clear_cache':
                return $this->clear_cache($args);
            case 'optimize_database':
                return $this->optimize_database($args);
            case 'backup_database':
                return $this->backup_database($args);
            case 'restore_database':
                return $this->restore_database($args);
            case 'update_core':
                return $this->update_core($args);
                
            // Theme operations (installing and switching themes is WPMaven Agent's)
            case 'get_themes':
            case 'wp_get_themes':
                return $this->wp_get_themes($args);

            // Menu operations (support both prefixed and unprefixed command names)
            case 'wp_create_menu':
            case 'create_menu':
                return $this->create_menu($args);
            case 'wp_update_menu':
            case 'update_menu':
                return $this->update_menu($args);
            case 'wp_delete_menu':
            case 'delete_menu':
                return $this->delete_menu($args);
            case 'wp_get_menus':
            case 'get_menus':
                return $this->get_menus($args);
                
            // Widget operations (a widget's HTML is WPMaven Agent's to write)
            case 'delete_widget':
                return $this->delete_widget($args);
            case 'get_widgets':
                return $this->get_widgets($args);
                
            // Theme Options
            case 'update_theme_options':
                return $this->update_theme_options($args);
            case 'get_theme_options':
                return $this->get_theme_options($args);
                
            default:
                // Convention bridge: delegate to any webhook_<command> action
                // before the REST fallback. Native cases above always win;
                // 'execute_command' is blocked case-insensitively (method
                // dispatch is case-insensitive too) to avoid self-recursion.
                // backup_restore is not reachable this way (2026-09-22): a
                // restore imports whatever archive its gcsPath names, so it
                // runs only as the top-level action the API sends from a
                // Backup row it created.
                if (in_array(strtolower($command), self::BRIDGE_EXCLUDED_COMMANDS, true)) {
                    throw new Exception('The command ' . $command . ' is not available through execute_command. Restores go through the backup tools, from a backup WPMaven created.');
                }
                if (strtolower($command) !== 'execute_command' && $this->webhook_actions && method_exists($this->webhook_actions, 'webhook_' . $command)) {
                    return $this->webhook_actions->{'webhook_' . $command}($args);
                }
                // WPMaven Agent's commands, when Agent is here.
                $handlers = self::command_handlers();
                if (isset($handlers[$command])) {
                    return call_user_func($handlers[$command], $args);
                }
                // WPMaven Agent maps any other command to the site's REST API.
                $answer = apply_filters('webmaven_command_fallback', null, $command, $args);
                if ($answer !== null) {
                    return $answer;
                }
                WebMaven_Requires_Agent::check($command);
                throw new Exception('Unknown command: ' . $command);
        }
    }

    /**
     * Commands an add-on registers (WPMaven Agent): command name =>
     * callable($args). Names must be lowercase snake_case; anything else, or
     * a non-callable, is dropped. A case of execute_command always wins.
     */
    public static function command_handlers() {
        $raw = apply_filters('webmaven_command_handlers', []);
        $handlers = [];
        if (!is_array($raw)) {
            return $handlers;
        }
        foreach ($raw as $name => $callable) {
            if (is_string($name) && preg_match('/^[a-z][a-z0-9_]{1,63}$/', $name) && is_callable($callable)) {
                $handlers[$name] = $callable;
            }
        }
        return $handlers;
    }

    // ===== REST API FALLBACK =====

    // ===== POST OPERATIONS =====

    /**
     * Sanitize LLM-generated content using wp_kses with extended allowed tags.
     * Allows semantic HTML tags, inline styles, and SVGs that LLMs legitimately generate,
     * while stripping dangerous elements like <script>, onclick handlers, etc.
     */
    /**
     * The tags and attributes a designed page keeps: WordPress's post
     * allowlist, the semantic HTML5 tags generation uses, style, class and
     * id on common tags, and the extensions the generation's zero-loss gate
     * proved necessary. Shared by the page commands and the block commands.
     */
    public function designed_allowed_html() {
        $allowed_tags = wp_kses_allowed_html('post');

        // Add semantic HTML5 tags that LLMs commonly generate
        $extra_tags = [
            'section' => ['class' => true, 'id' => true, 'style' => true, 'data-*' => true],
            'nav' => ['class' => true, 'id' => true, 'style' => true, 'aria-label' => true],
            'header' => ['class' => true, 'id' => true, 'style' => true],
            'footer' => ['class' => true, 'id' => true, 'style' => true],
            'main' => ['class' => true, 'id' => true, 'style' => true],
            'article' => ['class' => true, 'id' => true, 'style' => true],
            'aside' => ['class' => true, 'id' => true, 'style' => true],
            'figure' => ['class' => true, 'id' => true, 'style' => true],
            'figcaption' => ['class' => true, 'id' => true, 'style' => true],
            'details' => ['class' => true, 'id' => true, 'open' => true],
            'summary' => ['class' => true, 'id' => true],
            'svg' => ['class' => true, 'viewBox' => true, 'width' => true, 'height' => true, 'fill' => true, 'xmlns' => true, 'aria-hidden' => true],
            'path' => ['d' => true, 'fill' => true, 'stroke' => true, 'stroke-width' => true, 'stroke-linecap' => true, 'stroke-linejoin' => true],
            'circle' => ['cx' => true, 'cy' => true, 'r' => true, 'fill' => true, 'stroke' => true],
            'rect' => ['x' => true, 'y' => true, 'width' => true, 'height' => true, 'fill' => true, 'rx' => true, 'ry' => true],
            'line' => ['x1' => true, 'y1' => true, 'x2' => true, 'y2' => true, 'stroke' => true],
            'video' => ['src' => true, 'controls' => true, 'autoplay' => true, 'muted' => true, 'loop' => true, 'class' => true, 'poster' => true],
            'source' => ['src' => true, 'type' => true],
        ];

        // Add style attribute to existing tags that commonly need it
        $style_tags = ['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th'];
        foreach ($style_tags as $tag) {
            if (isset($allowed_tags[$tag])) {
                $allowed_tags[$tag]['style'] = true;
                $allowed_tags[$tag]['class'] = true;
                $allowed_tags[$tag]['id'] = true;
            }
        }

        $allowed_tags = array_merge($allowed_tags, $extra_tags);

        // Allowlist extensions: tags/attributes the generation pipeline's
        // zero-visual-loss gate proved necessary (form controls, inline SVG
        // internals, aria-*). Keys and attributes in the JSON are LOWERCASE
        // because wp_kses lowercases attribute names before matching — a
        // camelCase viewBox entry never matches and gets silently stripped.
        $ext_file = __DIR__ . '/wm-allowlist-extensions.json';
        if (file_exists($ext_file)) {
            $ext = json_decode((string) file_get_contents($ext_file), true);
            if (is_array($ext)) {
                foreach ($ext as $tag => $attrs) {
                    // Skip metadata keys like "_comment"
                    if (!is_array($attrs) || strpos($tag, '_') === 0) {
                        continue;
                    }
                    $tag = strtolower($tag);
                    if (!isset($allowed_tags[$tag])) {
                        $allowed_tags[$tag] = [];
                    }
                    foreach ($attrs as $attr) {
                        $allowed_tags[$tag][strtolower($attr)] = true;
                    }
                }
            }
        }

        return $allowed_tags;
    }

    public function sanitize_llm_content($content) {
        if (empty($content)) {
            return '';
        }

        // Extract <style> blocks before wp_kses (it would destroy CSS content inside them).
        // We sanitize the CSS separately: strip anything that could escape the style tag.
        $style_blocks = [];
        $content = preg_replace_callback(
            '/<style([^>]*)>(.*?)<\/style>/si',
            function ($match) use (&$style_blocks) {
                $css = $match[2];
                // Strip anything that could escape the <style> context
                $css = preg_replace('/<\/style/i', '', $css);
                $css = preg_replace('/<script/i', '', $css);
                // Remove CSS expressions (IE attack vector)
                $css = preg_replace('/expression\s*\(/i', '', $css);
                // Remove url() with javascript: protocol
                $css = preg_replace('/url\s*\(\s*["\']?\s*javascript:/i', 'url(', $css);
                $placeholder = '<!--STYLE_BLOCK_' . count($style_blocks) . '-->';
                $style_blocks[$placeholder] = '<style' . $match[1] . '>' . $css . '</style>';
                return $placeholder;
            },
            $content
        );

        // Extract <script> blocks before wp_kses (it strips them entirely).
        // Unlike styles, scripts are NOT re-inserted inline — they get saved as
        // separate .js files and enqueued via wp_enqueue_scripts.
        $script_blocks = [];
        $content = preg_replace_callback(
            '/<script\b([^>]*)>(.*?)<\/script>/si',
            function ($match) use (&$script_blocks) {
                // Skip external scripts (src attribute)
                if (preg_match('/\bsrc\s*=/i', $match[1])) return '';
                $js = trim($match[2]);
                if ($js === '') return '';
                $script_blocks[] = $js;
                return ''; // Remove from content — scripts go to files
            },
            $content
        );
        $this->_extracted_scripts = $script_blocks;

        $allowed_tags = $this->designed_allowed_html();

        $content = wp_kses($content, $allowed_tags);

        // Re-insert sanitized <style> blocks
        foreach ($style_blocks as $placeholder => $style_html) {
            $content = str_replace($placeholder, $style_html, $content);
        }

        return $content;
    }

    /**
     * Generate an idempotency key for webhook actions based on action type and critical params.
     */
    public function generate_action_idempotency_key($action, $params) {
        $key_parts = [$action];

        // Use critical identifying parameters based on action type
        switch ($action) {
            case 'create_menu':
                $key_parts[] = $params['name'] ?? '';
                $key_parts[] = $params['location'] ?? '';
                // Fingerprint the items so a re-run with changed items is not
                // masked by the 15-min replay cache (handler is replace-by-name).
                $item_sigs = array_map(function($i) {
                    return ($i['slug'] ?? $i['object_slug'] ?? ($i['url'] ?? '')) . '|' . ($i['title'] ?? '');
                }, is_array($params['items'] ?? null) ? $params['items'] : []);
                $key_parts[] = md5(json_encode($item_sigs));
                break;
            case 'create_page':
            case 'create_post':
                $key_parts[] = $params['slug'] ?? $params['title'] ?? '';
                // Upsert exists to re-apply changed content onto the same slug —
                // fingerprint it so the 15-min replay cache doesn't mask the
                // second apply. Non-upsert keys are unchanged.
                if (!empty($params['upsert'])) {
                    $key_parts[] = 'upsert';
                    $key_parts[] = $params['title'] ?? '';
                    $key_parts[] = md5((string) ($params['content'] ?? ''));
                }
                break;
            case 'upload_theme':
                $key_parts[] = $params['theme_name'] ?? $params['name'] ?? '';
                break;
            case 'install_theme_from_url':
                // Content-hash keyed: the finish build ships a NEW zip hash,
                // so it must never be masked as a replay of the first install.
                $key_parts[] = $params['sha256'] ?? $params['url'] ?? '';
                $key_parts[] = $params['theme_slug'] ?? '';
                break;
            case 'install_plugin':
                $key_parts[] = $params['plugin_slug'] ?? $params['slug'] ?? $params['plugin'] ?? '';
                break;
            case 'create_product':
                $key_parts[] = $params['name'] ?? $params['title'] ?? '';
                break;
            case 'woocommerce_create_product':
            case 'create_form':
                // Both upsert by a stable key (product name or SKU, form
                // name), so the replay cache only needs to skip an EXACT
                // retry: fingerprint the whole input, so a re-apply with a
                // changed price, image or form spec always runs.
                $key_parts[] = md5((string) json_encode($params));
                break;
        }

        return md5(implode('|', $key_parts));
    }

    /**
     * IDs of the pages WooCommerce is assigned to (cart, checkout, my account,
     * shop, terms). Read from WooCommerce's page options even while
     * WooCommerce is inactive, so re-activating it finds its pages intact.
     *
     * @return int[]
     */
    public function woocommerce_page_ids() {
        $ids = [];
        foreach (['cart', 'checkout', 'myaccount', 'shop', 'terms'] as $page) {
            $id = function_exists('wc_get_page_id') ? (int) wc_get_page_id($page) : (int) get_option('woocommerce_' . $page . '_page_id', 0);
            if ($id > 0) {
                $ids[] = $id;
            }
        }
        return array_values(array_unique($ids));
    }

    public function create_post($args) {
        $post_data = [
            'post_title' => $args['title'] ?? 'New Post',
            'post_content' => $this->sanitize_llm_content($args['content'] ?? ''),
            'post_status' => $args['status'] ?? 'draft',
            'post_type' => $args['post_type'] ?? 'post'
        ];

        // Original dates (1.2.6, site migration): `date` is the site's local
        // time and `date_gmt` UTC, both 'Y-m-d H:i:s'. An invalid one refuses
        // the call (before anything is written) rather than publishing under
        // today's date. WordPress then applies its own rules: a published
        // post with a past date stays published with that date, and a publish
        // date in the future makes it a scheduled ('future') post.
        $post_date = self::post_date_arg($args, 'date');
        $post_date_gmt = self::post_date_arg($args, 'date_gmt');
        if ($post_date !== null) {
            $post_data['post_date'] = $post_date;
        }
        if ($post_date_gmt !== null) {
            // Alone, WordPress derives the local date from it.
            $post_data['post_date_gmt'] = $post_date_gmt;
        }
        $dated = $post_date !== null || $post_date_gmt !== null;

        // ai_generated: false (1.2.6) says the content is not the agents'
        // (e.g. a migrated human-written post), so it is not marked below.
        $ai_generated = !array_key_exists('ai_generated', $args)
            || !in_array($args['ai_generated'], [false, 0, '0', 'false'], true);

        // Include slug/post_name if provided
        if (isset($args['post_name'])) {
            $post_data['post_name'] = sanitize_title($args['post_name']);
        } elseif (isset($args['slug'])) {
            $post_data['post_name'] = sanitize_title($args['slug']);
        }

        // Include excerpt if provided
        if (isset($args['excerpt'])) {
            $post_data['post_excerpt'] = $args['excerpt'];
        }

        // Include parent if provided
        if (isset($args['post_parent'])) {
            $post_data['post_parent'] = intval($args['post_parent']);
        }

        // Include page template if provided
        if (isset($args['page_template'])) {
            $post_data['page_template'] = $args['page_template'];
        }

        // Include menu order if provided
        if (isset($args['menu_order'])) {
            $post_data['menu_order'] = intval($args['menu_order']);
        }

        // Handle categories — create if they don't exist
        if (!empty($args['categories'])) {
            $cat_ids = [];
            foreach ((array) $args['categories'] as $cat_name) {
                $cat_name = trim($cat_name);
                if (empty($cat_name)) continue;
                $term = term_exists($cat_name, 'category');
                if (!$term) {
                    $term = wp_insert_term($cat_name, 'category');
                }
                if (!is_wp_error($term)) {
                    $cat_ids[] = is_array($term) ? (int) $term['term_id'] : (int) $term;
                }
            }
            if (!empty($cat_ids)) {
                $post_data['post_category'] = $cat_ids;
            }
        }

        // Handle tags — wp_insert_post auto-creates missing tags
        if (!empty($args['tags'])) {
            $post_data['tags_input'] = array_map('trim', (array) $args['tags']);
        }

        // Upsert-by-slug (opt-in): when the slug is already taken by a post of
        // the same type, update that post in place instead of letting WordPress
        // append a -2 suffix. Draft/auto-draft page placeholders are removed so
        // the fresh content claims a clean slug (mirrors the create path).
        $upsert = !empty($args['upsert']);
        // A connected site (the owner's existing WordPress, 2026-09-22): the
        // first build never rewrites a page or post the owner made and never
        // deletes their drafts. "Theirs" is any post without WPMaven's AI
        // marker. When the planned slug or the planned title is theirs, the
        // planned content is saved as a DRAFT under <slug>-wpmaven, the
        // answer names what was left alone (left_alone), and a build run
        // again updates that draft. Hosted, freshly provisioned sites keep
        // the plain upsert (protect_existing is not sent).
        $protect = $upsert && !empty($args['protect_existing']);
        // A new design for a site the owner runs ("New design, keep my
        // content", 2026-10-10): every designed page is a CANDIDATE, a draft
        // under <slug>-wpmaven that nobody sees until the design switch
        // publishes it at the owner's address (WPMaven Agent's design switch). A run
        // again updates its own draft; the owner's page at the slug, and any
        // page with the same title, are never read or touched here.
        $candidate = $upsert && !empty($args['candidate']);
        if ($candidate) {
            $protect = false;
        }
        $left_alone = null;
        $upsert_updated = false;
        // The planned page this content is (its slug in the site plan), kept
        // as _wm_page so the theme finds the page's styles wherever the page
        // lives, and so a later build knows which page is which.
        $wm_page = isset($args['wm_page']) && is_string($args['wm_page']) ? sanitize_title($args['wm_page']) : '';
        // A publish run again after a partial one says when it last wrote
        // each page: a page of ours changed since then was edited by someone,
        // so it is treated as the owner's (connected sites only).
        $unmodified_since = self::gmt_datetime_arg($args['if_unmodified_since'] ?? null);
        $replaced_default = null;
        if ($candidate && !empty($post_data['post_name'])) {
            $post_data['post_name'] .= self::branded_site() ? '-new' : '-wpmaven';
            $post_data['post_status'] = 'draft';
            $ours = get_page_by_path($post_data['post_name'], OBJECT, $post_data['post_type']);
            if ($ours && WebMaven_AI_Marking::is_ai_generated($ours->ID)) {
                $post_data['ID'] = $ours->ID;
                $upsert_updated = true;
            } elseif ($ours) {
                // Someone else's post at the candidate address: WordPress gives ours another one.
                $post_data['post_name'] .= '-2';
            }
        } elseif ($upsert && !empty($post_data['post_name'])) {
            $existing = get_page_by_path($post_data['post_name'], OBJECT, $post_data['post_type']);
            // WooCommerce's own pages (cart, checkout, my account, shop, terms)
            // are never overwritten or deleted: a generated page that happens
            // to share the slug is created as a new page instead (WordPress
            // gives it a -2 slug) and the store keeps working.
            if ($existing && $post_data['post_type'] === 'page' && in_array((int) $existing->ID, $this->woocommerce_page_ids(), true)) {
                $existing = null;
            }
            // WordPress's untouched sample content (its draft Privacy Policy,
            // Sample Page, Hello world) is nobody's: the planned page with its
            // title replaces it in place, so the privacy page keeps its id and
            // wp_page_for_privacy_policy stays right.
            if (!$existing && class_exists('WebMaven_Default_Content')) {
                $existing = WebMaven_Default_Content::untouched_titled($post_data['post_title'], $post_data['post_type']);
            }
            $existing_default = ($existing && class_exists('WebMaven_Default_Content')) ? WebMaven_Default_Content::untouched_kind($existing) : null;
            if ($protect) {
                $theirs = null;
                $reason = 'owner_content';
                if ($existing && $existing_default === null) {
                    if (!WebMaven_AI_Marking::is_ai_generated($existing->ID)) {
                        $theirs = $existing;
                    } elseif ($unmodified_since !== null && (string) ($existing->post_modified_gmt ?? '') !== $unmodified_since) {
                        $theirs = $existing;
                        $reason = 'edited_since';
                    }
                }
                if (!$theirs) {
                    $titled = $this->owners_post_titled($post_data['post_title'], $post_data['post_type']);
                    if ($titled && !($existing && (int) $titled->ID === (int) $existing->ID)) {
                        $theirs = $titled;
                    }
                }
                if ($theirs) {
                    $left_alone = [
                        'id' => (int) $theirs->ID,
                        'title' => (string) ($theirs->post_title ?? ''),
                        'slug' => (string) ($theirs->post_name ?? ''),
                        'status' => (string) ($theirs->post_status ?? ''),
                        'reason' => $reason,
                    ];
                    // "-new" on a site under an agency's or a partner's brand,
                    // where the Pages screen must not name us (1.2.31). The
                    // answer carries the slug (post_slug), so the API reads it.
                    $post_data['post_name'] .= self::branded_site() ? '-new' : '-wpmaven';
                    $post_data['post_status'] = 'draft';
                    // Our own draft from an earlier run of the build is updated in place.
                    $ours = get_page_by_path($post_data['post_name'], OBJECT, $post_data['post_type']);
                    $existing = ($ours && WebMaven_AI_Marking::is_ai_generated($ours->ID)) ? $ours : null;
                }
            }
            // A draft placeholder at the slug goes (hosted sites), except
            // WordPress's untouched privacy draft, which is replaced in place.
            if ($existing && $post_data['post_type'] === 'page' && in_array($existing->post_status, ['draft', 'auto-draft'], true) && !$protect
                && !(class_exists('WebMaven_Default_Content') && WebMaven_Default_Content::untouched_kind($existing) !== null)) {
                wp_delete_post($existing->ID, true);
                $existing = null;
            }
            if ($existing && class_exists('WebMaven_Default_Content')) {
                $replaced_default = WebMaven_Default_Content::untouched_kind($existing);
            }
            if ($existing) {
                $post_data['ID'] = $existing->ID;
                // Don't demote an already-published post to the 'draft' default
                // when the caller didn't ask for a status change.
                if (!isset($args['status'])) {
                    $post_data['post_status'] = $existing->post_status;
                }
                $upsert_updated = true;
            }
        }

        // WordPress unslashes what it is given, so the data is slashed: a
        // backslash in the content (a css escape, a path) is kept, as the
        // edit engine's rewrite_fullhtml_page keeps it.
        $post_id = wp_insert_post(wp_slash($post_data));

        if (is_wp_error($post_id)) {
            throw new Exception('Failed to create post: ' . $post_id->get_error_message());
        }

        // Mark as WebMaven-generated full-HTML content. The generated theme reads
        // this flag to skip wpautop on render — the content is complete, intentional
        // HTML, and autop would inject <p>/<br> and corrupt inline <style> blocks.
        // Set by default (legacy behavior); an explicit fullhtml=false opts out so
        // normal prose posts keep autop formatting (delete covers upserted posts
        // that carried the flag from an earlier write).
        if (!isset($args['fullhtml']) || $args['fullhtml']) {
            update_post_meta($post_id, '_webmaven_fullhtml', 1);
        } else {
            delete_post_meta($post_id, '_webmaven_fullhtml');
        }

        // Invisible AI-content marking (EU AI Act art. 50): stamp agent-created
        // content so the frontend emits machine-readable markers at every tier.
        // Content the caller says is not AI-generated is not stamped, and an
        // upserted post loses the stamp an earlier agent write left. (The
        // legacy _webmaven_fullhtml flag also reads as marked, so such a
        // caller sends fullhtml: false as well; the migration does.)
        if ($ai_generated) {
            WebMaven_AI_Marking::mark_post($post_id);
        } else {
            delete_post_meta($post_id, WebMaven_AI_Marking::META_KEY);
        }
        if ($wm_page !== '') {
            update_post_meta($post_id, '_wm_page', $wm_page);
        }

        // Save extracted LLM scripts as a page-specific .js file
        if (!empty($this->_extracted_scripts)) {
            do_action('webmaven_page_scripts', (int) $post_id, $this->_extracted_scripts);
            $this->_extracted_scripts = [];
        }

        // Set featured image
        if (!empty($args['featured_image_id'])) {
            set_post_thumbnail($post_id, intval($args['featured_image_id']));
        } elseif (!empty($args['featured_image_url'])) {
            // Download from URL and set as featured
            require_once ABSPATH . 'wp-admin/includes/media.php';
            require_once ABSPATH . 'wp-admin/includes/file.php';
            require_once ABSPATH . 'wp-admin/includes/image.php';
            $attachment_id = media_sideload_image($args['featured_image_url'], $post_id, '', 'id');
            if (!is_wp_error($attachment_id)) {
                set_post_thumbnail($post_id, $attachment_id);
            }
        }

        // Set meta description (Yoast SEO + generic fallback)
        if (!empty($args['meta_description'])) {
            $meta_desc = sanitize_text_field($args['meta_description']);
            update_post_meta($post_id, '_yoast_wpseo_metadesc', $meta_desc);
            update_post_meta($post_id, '_webmaven_meta_description', $meta_desc);
        }

        // Get the actual slug that was used (may differ if slug already existed)
        $post = get_post($post_id);

        $result = [
            'post_id' => $post_id,
            'post_slug' => $post->post_name,
            'post_url' => get_permalink($post_id),
            'edit_url' => get_edit_post_link($post_id),
        ];
        // Only reported when the caller opted into upsert, so the legacy
        // response shape stays byte-identical for everyone else.
        if ($upsert) {
            $result['updated'] = $upsert_updated;
        }
        // When WordPress last saved it, so a publish run again can tell an
        // edit made since (if_unmodified_since); and which of WordPress's
        // untouched sample pages it replaced in place.
        if ($upsert || $wm_page !== '') {
            $result['post_modified_gmt'] = (string) ($post->post_modified_gmt ?? '');
        }
        if ($replaced_default !== null) {
            $result['replaced_default'] = $replaced_default;
        }
        if ($candidate) {
            $result['candidate'] = true;
        }
        // Only in the connected-site mode: whether the content was saved as
        // a draft beside the owner's, and which post of theirs was left alone.
        if ($protect) {
            $result['saved_as_draft'] = $left_alone !== null;
            if ($left_alone !== null) {
                $result['left_alone'] = $left_alone;
            }
        }
        // Only when the caller sent a date or ai_generated (1.2.6), for the
        // same reason: what WordPress stored, so the caller can confirm it (a
        // plugin before 1.2.6 ignores both and answers without these keys).
        if ($dated) {
            $result['post_status'] = $post->post_status;
            $result['post_date'] = $post->post_date;
            $result['post_date_gmt'] = $post->post_date_gmt;
        }
        if (array_key_exists('ai_generated', $args)) {
            $result['ai_generated'] = $ai_generated;
        }
        return $result;
    }

    /**
     * A create_post date argument ('date' or 'date_gmt'): a real calendar
     * date and time as 'Y-m-d H:i:s', returned as given. null when absent,
     * empty, or WordPress's own "no date" (0000-00-00 00:00:00). Anything else
     * throws, so a bad date refuses the call instead of being ignored.
     * Pure function, tested on its own.
     */
    public static function post_date_arg($args, $key) {
        if (!is_array($args) || !array_key_exists($key, $args) || $args[$key] === null || $args[$key] === '') {
            return null;
        }
        $value = is_string($args[$key]) ? trim($args[$key]) : $args[$key];
        if ($value === '0000-00-00 00:00:00') {
            return null;
        }
        $parsed = is_string($value) ? \DateTime::createFromFormat('!Y-m-d H:i:s', $value, new \DateTimeZone('UTC')) : false;
        if (!$parsed || $parsed->format('Y-m-d H:i:s') !== $value || (int) $parsed->format('Y') < 1000) {
            $shown = is_scalar($value) ? (string) $value : gettype($value);
            throw new Exception("Invalid {$key} '{$shown}': expected a real date and time as 'Y-m-d H:i:s'" . ($key === 'date' ? ' in the site timezone' : ' in UTC'));
        }
        return $value;
    }

    /**
     * sanitize_llm_content with the inline scripts it took out of this
     * content (and only this content): [clean content, script blocks].
     */
    public function sanitize_page_content($content) {
        $this->_extracted_scripts = [];
        $clean = $this->sanitize_llm_content((string) $content);
        $scripts = $this->_extracted_scripts;
        $this->_extracted_scripts = [];
        return [$clean, $scripts];
    }

    /**
     * Rewrite a page's content in place the way create_post writes a
     * full-HTML page: sanitize_llm_content (the same kses allowlist, inline
     * scripts moved to the page's script file), the _webmaven_fullhtml flag
     * and the AI marker. Status, slug and dates stay as they are. The content
     * is slashed for wp_update_post, so a backslash in it is kept. Used by
     * the edit engine's wm_page_update (capabilities/edit-operations.php).
     * $keep, when given, takes the cleaned content and answers what is
     * saved (the owner's blocks of a designed page put back: they are what
     * WordPress already stored, never cleaned again).
     *
     * @return int|\WP_Error The post id, or why WordPress refused the save.
     */
    public function rewrite_fullhtml_page($post_id, $content, $title = null, $keep = null) {
        $post_id = (int) $post_id;
        list($clean, $scripts) = $this->sanitize_page_content($content);
        if (is_callable($keep)) {
            $clean = (string) $keep($clean);
        }
        $data = [
            'ID' => $post_id,
            'post_content' => $clean,
        ];
        if ($title !== null) {
            $data['post_title'] = (string) $title;
        }

        $result = wp_update_post(wp_slash($data), true);
        if (is_wp_error($result)) {
            return $result;
        }
        if (!$result) {
            return new \WP_Error('update_failed', 'The page could not be saved.');
        }

        update_post_meta($post_id, '_webmaven_fullhtml', 1);
        WebMaven_AI_Marking::mark_post($post_id);
        // The page's script file follows its content: written when the new
        // content has inline scripts, removed when it has none (WPMaven
        // Agent's; without it the scripts are left out).
        do_action('webmaven_page_scripts', $post_id, $scripts);
        return $post_id;
    }

    public function update_post($args) {
        if (!isset($args['id'])) {
            throw new Exception('Post ID is required for update');
        }
        $this->refuse_owners_post_if_protected($args, $args['id'], 'edit');

        $post_data = ['ID' => $args['id']];

        if (isset($args['title'])) $post_data['post_title'] = $args['title'];
        if (isset($args['content'])) $post_data['post_content'] = $this->sanitize_llm_content($args['content'] ?? '');
        if (isset($args['status'])) $post_data['post_status'] = $args['status'];
        if (isset($args['excerpt'])) $post_data['post_excerpt'] = $args['excerpt'];

        // Meta input (custom fields, Yoast, etc.)
        if (!empty($args['meta_input']) && is_array($args['meta_input'])) {
            $post_data['meta_input'] = $args['meta_input'];
        }

        $post_id = wp_update_post(wp_slash($post_data));

        if (is_wp_error($post_id)) {
            throw new Exception('Failed to update post: ' . $post_id->get_error_message());
        }

        // Keep the full-HTML flag in sync when content is (re)written, so edited
        // pages also skip wpautop. No-op for title/status-only updates.
        if (isset($args['content'])) {
            update_post_meta($post_id, '_webmaven_fullhtml', 1);
            // The agent (re)wrote the content: (re)stamp the AI marker too.
            WebMaven_AI_Marking::mark_post($post_id);
        }

        // Save extracted LLM scripts as a page-specific .js file
        if (!empty($this->_extracted_scripts)) {
            do_action('webmaven_page_scripts', (int) $post_id, $this->_extracted_scripts);
            $this->_extracted_scripts = [];
        }

        // Update individual meta fields if provided separately
        if (!empty($args['meta']) && is_array($args['meta'])) {
            foreach ($args['meta'] as $key => $value) {
                update_post_meta($post_id, sanitize_key($key), sanitize_text_field($value));
            }
        }

        return [
            'post_id' => $post_id,
            'post_url' => get_permalink($post_id),
            'edit_url' => get_edit_post_link($post_id)
        ];
    }

    public function delete_post($args) {
        if (!isset($args['id'])) {
            throw new Exception('Post ID is required for deletion');
        }
        $this->refuse_owners_post_if_protected($args, $args['id'], 'delete');

        $result = wp_delete_post($args['id'], $args['force'] ?? false);
        
        if (!$result) {
            throw new Exception('Failed to delete post');
        }
        
        return ['deleted' => true, 'post_id' => $args['id']];
    }
    
    public function get_posts($args) {
        $query_args = [
            'post_type' => $args['post_type'] ?? 'post',
            'post_status' => $args['status'] ?? 'publish',
            'numberposts' => $args['number'] ?? 10,
            'fields' => $args['fields'] ?? 'all'
        ];

        if (isset($args['date_query'])) {
            $query_args['date_query'] = $args['date_query'];
        }

        $posts = get_posts($query_args);

        // A page password is a secret like any other (2026-09-22): the rows
        // came back as WP_Post objects with post_password in the clear. Each
        // row now says whether the post is protected, never the password.
        $posts = array_map([__CLASS__, 'redact_post_row'], $posts);

        return [
            'posts' => $posts,
            'count' => count($posts)
        ];
    }

    /**
     * One post row as it may leave the site: a WP_Post (or any object) as
     * its public fields, post_password replaced by "[redacted]" when set,
     * and a password_protected flag beside it. Ids and other scalars pass.
     */
    public static function redact_post_row($post) {
        if (is_object($post)) {
            $post = get_object_vars($post);
        }
        if (!is_array($post)) {
            return $post;
        }
        if (array_key_exists('post_password', $post)) {
            $protected = is_string($post['post_password']) && $post['post_password'] !== '';
            $post['post_password'] = $protected ? WebMaven_User_Secrets::REDACTED : '';
            $post['password_protected'] = $protected;
        }
        return $post;
    }

    // ===== TAXONOMY OPERATIONS =====

    public function create_taxonomy_term($args, $taxonomy) {
        if (empty($args['name'])) {
            throw new \Exception('Term name is required');
        }

        $term_args = [];
        if (!empty($args['description'])) $term_args['description'] = sanitize_text_field($args['description']);
        if (!empty($args['slug'])) $term_args['slug'] = sanitize_title($args['slug']);
        if (!empty($args['parent'])) $term_args['parent'] = intval($args['parent']);

        // Check if it already exists
        $existing = term_exists($args['name'], $taxonomy);
        if ($existing) {
            $term_id = is_array($existing) ? $existing['term_id'] : $existing;
            return [
                'term_id' => (int) $term_id,
                'name' => $args['name'],
                'taxonomy' => $taxonomy,
                'already_existed' => true,
            ];
        }

        $result = wp_insert_term(sanitize_text_field($args['name']), $taxonomy, $term_args);

        if (is_wp_error($result)) {
            throw new \Exception($result->get_error_message());
        }

        return [
            'term_id' => (int) $result['term_id'],
            'name' => $args['name'],
            'taxonomy' => $taxonomy,
            'already_existed' => false,
        ];
    }

    public function get_taxonomy_terms($taxonomy, $args = []) {
        $query_args = [
            'taxonomy' => $taxonomy,
            'hide_empty' => !empty($args['hide_empty']),
            'number' => $args['number'] ?? 100,
            'orderby' => $args['orderby'] ?? 'name',
            'order' => $args['order'] ?? 'ASC',
        ];

        if (!empty($args['search'])) {
            $query_args['search'] = sanitize_text_field($args['search']);
        }

        $terms = get_terms($query_args);

        if (is_wp_error($terms)) {
            throw new \Exception($terms->get_error_message());
        }

        $result = [];
        foreach ($terms as $term) {
            $result[] = [
                'term_id' => $term->term_id,
                'name' => $term->name,
                'slug' => $term->slug,
                'description' => $term->description,
                'count' => $term->count,
                'parent' => $term->parent,
            ];
        }

        return [
            'terms' => $result,
            'count' => count($result),
            'taxonomy' => $taxonomy,
        ];
    }

    // ===== FEATURED IMAGE =====

    public function set_featured_image_command($args) {
        if (empty($args['post_id'])) {
            throw new \Exception('post_id is required');
        }

        $post_id = intval($args['post_id']);

        if (!empty($args['image_id'])) {
            // Set by attachment ID
            $result = set_post_thumbnail($post_id, intval($args['image_id']));
        } elseif (!empty($args['image_url'])) {
            // Download from URL and set
            require_once ABSPATH . 'wp-admin/includes/media.php';
            require_once ABSPATH . 'wp-admin/includes/file.php';
            require_once ABSPATH . 'wp-admin/includes/image.php';
            $attachment_id = media_sideload_image($args['image_url'], $post_id, '', 'id');
            if (is_wp_error($attachment_id)) {
                throw new \Exception('Failed to download image: ' . $attachment_id->get_error_message());
            }
            $result = set_post_thumbnail($post_id, $attachment_id);
        } else {
            throw new \Exception('image_id or image_url is required');
        }

        if (!$result) {
            throw new \Exception('Failed to set featured image');
        }

        return [
            'success' => true,
            'post_id' => $post_id,
            'thumbnail_id' => get_post_thumbnail_id($post_id),
        ];
    }

    // ===== COMMENT OPERATIONS =====

    public function get_comments_command($args) {
        $query_args = [
            'number' => $args['number'] ?? 20,
            'status' => $args['status'] ?? 'approve',
            'orderby' => $args['orderby'] ?? 'comment_date_gmt',
            'order' => $args['order'] ?? 'DESC',
        ];

        if (isset($args['post_id'])) {
            $query_args['post_id'] = intval($args['post_id']);
        }
        if (isset($args['search'])) {
            $query_args['search'] = sanitize_text_field($args['search']);
        }
        if (isset($args['type'])) {
            $query_args['type'] = sanitize_text_field($args['type']);
        }

        $comments = get_comments($query_args);

        $result = [];
        foreach ($comments as $comment) {
            $result[] = [
                'id' => $comment->comment_ID,
                'post_id' => $comment->comment_post_ID,
                'post_title' => get_the_title($comment->comment_post_ID),
                'author' => $comment->comment_author,
                'author_email' => $comment->comment_author_email,
                'content' => $comment->comment_content,
                'date' => $comment->comment_date,
                'status' => wp_get_comment_status($comment),
                'parent' => $comment->comment_parent,
            ];
        }

        return [
            'comments' => $result,
            'count' => count($result),
        ];
    }

    public function update_comment_command($args) {
        if (empty($args['comment_id'])) {
            throw new \Exception('comment_id is required');
        }

        $comment_data = ['comment_ID' => intval($args['comment_id'])];

        if (isset($args['status'])) {
            $status_map = [
                'approve' => 1,
                'approved' => 1,
                'hold' => 0,
                'pending' => 0,
                'spam' => 'spam',
                'trash' => 'trash',
            ];
            $comment_data['comment_approved'] = $status_map[$args['status']] ?? $args['status'];
        }
        if (isset($args['content'])) {
            $comment_data['comment_content'] = wp_kses_post($args['content']);
        }

        $result = wp_update_comment($comment_data);

        if (is_wp_error($result)) {
            throw new \Exception($result->get_error_message());
        }

        return ['success' => true, 'comment_id' => $args['comment_id']];
    }

    public function delete_comment_command($args) {
        if (empty($args['comment_id'])) {
            throw new \Exception('comment_id is required');
        }

        $force = !empty($args['force']);
        $result = wp_delete_comment(intval($args['comment_id']), $force);

        if (!$result) {
            throw new \Exception('Failed to delete comment');
        }

        return ['success' => true, 'comment_id' => $args['comment_id']];
    }

    // ===== USER OPERATIONS =====

    
    
    public function get_users($args) {
        // Never return user_pass, user_activation_key or session tokens,
        // whatever `fields` asks for (2026-09-22, "Users + AI WP-CLI"). Fetch
        // full objects so `roles` is available, then project every row through
        // the safe redactor before it can be json_encode'd back to the API.
        $query_args = [
            'number' => $args['number'] ?? 10,
            'role' => $args['role'] ?? '',
            'fields' => 'all',
        ];

        $users = get_users($query_args);
        $safe = array_map(['WebMaven_User_Secrets', 'redact_user'], $users);

        // An explicit (safe) fields subset narrows the projection; 'all' or no
        // fields returns every safe field.
        $subset = WebMaven_User_Secrets::safe_fields_subset($args['fields'] ?? 'all');
        if ($subset !== WebMaven_User_Secrets::SAFE_USER_FIELDS) {
            $safe = array_map(function ($row) use ($subset) {
                $out = [];
                foreach ($subset as $field) {
                    if (array_key_exists($field, $row)) {
                        $out[$field] = $row[$field];
                    }
                }
                return $out;
            }, $safe);
        }

        return [
            'users' => array_values($safe),
            'count' => count($safe),
        ];
    }

    // ===== PLUGIN OPERATIONS =====
    

    /** Whether this WordPress meets a plugin's "Requires at least". */
    /** The WordPress version this site runs. */
    public static function current_wp_version() {
        global $wp_version;
        if (is_string($wp_version) && $wp_version !== '') {
            return $wp_version;
        }
        return function_exists('get_bloginfo') ? (string) get_bloginfo('version') : '';
    }

    public static function wp_version_ok($required) {
        $required = trim((string) $required);
        if ($required === '') {
            return true;
        }
        if (function_exists('is_wp_version_compatible')) {
            return (bool) is_wp_version_compatible($required);
        }
        return version_compare(self::current_wp_version(), $required, '>=');
    }

    /** Whether this PHP meets a plugin's "Requires PHP". */
    public static function php_version_ok($required) {
        $required = trim((string) $required);
        if ($required === '') {
            return true;
        }
        if (function_exists('is_php_version_compatible')) {
            return (bool) is_php_version_compatible($required);
        }
        return version_compare(PHP_VERSION, $required, '>=');
    }

    /**
     * Find the main plugin file for a given slug
     */
    public function find_plugin_file($slug) {
        $plugins = get_plugins();
        foreach ($plugins as $file => $data) {
            // Check if plugin file starts with the slug directory
            if (strpos($file, $slug . '/') === 0) {
                return $file;
            }
        }
        return null;
    }

    
    
    
    public function get_plugins($args) {
        if (!function_exists('get_plugins')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        
        $plugins = get_plugins();
        $active_plugins = get_option('active_plugins', []);
        
        $plugin_list = [];
        foreach ($plugins as $plugin_file => $plugin_data) {
            $plugin_list[] = [
                'file' => $plugin_file,
                'name' => $plugin_data['Name'],
                'version' => $plugin_data['Version'],
                'active' => in_array($plugin_file, $active_plugins),
                'description' => $plugin_data['Description']
            ];
        }
        
        return [
            'plugins' => $plugin_list,
            'count' => count($plugin_list),
            'active_count' => count($active_plugins)
        ];
    }

    // ===== OPTION OPERATIONS =====
    
    public function update_option($args) {
        // Support both parameter naming conventions
        $option = $args['option'] ?? $args['option_name'] ?? null;
        $value = $args['value'] ?? $args['option_value'] ?? null;

        if (!$option || !isset($value)) {
            throw new Exception('Option name and value are required');
        }

        // Security: the core options that could compromise the site (one
        // list for every option command, see CORE_PROTECTED_OPTIONS).
        if (WebMaven_Self_Protect::is_core_protected_option($option)) {
            throw new Exception('Cannot modify protected option: ' . $option);
        }

        // WPMaven's connection and hosting options, and the plugin-state
        // options that keep it active (edge key + primary host: only
        // set_edge_config writes them).
        if (WebMaven_Self_Protect::is_protected_option($option)) {
            throw new Exception('Cannot modify protected option: ' . $option);
        }

        // The store currency relabels every price: only the Store currency
        // setting changes it (2026-09-30).
        if (WebMaven_Self_Protect::is_store_currency_option($option)) {
            throw new Exception(WebMaven_Self_Protect::STORE_CURRENCY_REFUSAL);
        }

        // Only the options on WPMaven's list; another plugin's are WPMaven Agent's.
        WebMaven_Option_Allowlist::check($option);

        // RAW keys are stored without content sanitization (see RAW_OPTION_KEYS)
        if (in_array($option, self::RAW_OPTION_KEYS, true)) {
            $value = self::prepare_raw_option_value($option, $value);
        }

        $result = update_option($option, $value);

        return ['updated' => $result, 'option' => $option, 'value' => $value];
    }
    
    public function get_option($args) {
        if (!isset($args['option'])) {
            throw new Exception('Option name is required');
        }
        
        // The edge key is a secret: no generic read of the edge options.
        if (WebMaven_Hosting::is_edge_option($args['option'])) {
            throw new Exception('Cannot read protected option: ' . $args['option']);
        }

        // Auth-related options (2026-09-22): the plugin's own OAuth credentials
        // and tokens (webmaven_wp_*) and the core secret keys/salts must never
        // be read back to the API. The write side already refuses webmaven_wp_;
        // this closes the read side too.
        if (WebMaven_User_Secrets::is_secret_option($args['option'])) {
            throw new Exception('Cannot read protected option: ' . $args['option']);
        }

        $default = $args['default'] ?? false;
        $value = get_option($args['option'], $default);

        // Every other secret stays on the site too (2026-09-22): a
        // secret-named option comes back as "[redacted]", and so do the
        // secret fields and secret-shaped strings inside any other value
        // (woocommerce_stripe_settings keeps "enabled", loses "secret_key").
        // The caller's own default passes untouched, so "not set" still reads
        // as not set.
        $redacted = 0;
        if ($value !== $default) {
            $value = WebMaven_User_Secrets::redact_option_value($args['option'], $value, $redacted);
        }

        $out = ['option' => $args['option'], 'value' => $value];
        if ($redacted > 0) {
            $out['redacted'] = $redacted;
        }
        return $out;
    }
    
    public function delete_option($args) {
        if (!isset($args['option'])) {
            throw new Exception('Option name is required');
        }

        // The same core options update_option refuses: deleting siteurl,
        // admin_email, a salt or the roles option is no safer than writing it.
        if (WebMaven_Self_Protect::is_core_protected_option($args['option'])) {
            throw new Exception('Cannot modify protected option: ' . $args['option']);
        }

        if (WebMaven_Self_Protect::is_protected_option($args['option'])) {
            throw new Exception('Cannot modify protected option: ' . $args['option']);
        }

        if (WebMaven_Self_Protect::is_store_currency_option($args['option'])) {
            throw new Exception(WebMaven_Self_Protect::STORE_CURRENCY_REFUSAL);
        }

        // Only the options on WPMaven's list; another plugin's are WPMaven Agent's.
        WebMaven_Option_Allowlist::check($args['option']);

        $result = delete_option($args['option']);

        return ['deleted' => $result, 'option' => $args['option']];
    }

    /**
     * Set the static front page (show_on_front=page + page_on_front=ID).
     * Accepts { page_id } | { slug } | { title }. Mirrors webhook_set_homepage
     * so the agent's `execute_command(set_homepage)` calls work.
     */
    public function set_homepage($args) {
        $page_id = isset($args['page_id']) ? (int) $args['page_id'] : 0;
        $slug = isset($args['slug']) ? sanitize_title((string) $args['slug']) : '';
        $title = isset($args['title']) ? sanitize_text_field((string) $args['title']) : '';

        if (!$page_id && $slug) {
            $page = get_page_by_path($slug);
            if ($page) $page_id = (int) $page->ID;
        }
        if (!$page_id && $title) {
            global $wpdb;
            $found = $wpdb->get_var($wpdb->prepare(
                "SELECT ID FROM {$wpdb->posts} WHERE post_title = %s AND post_type = 'page' AND post_status IN ('publish','draft','private') ORDER BY ID ASC LIMIT 1",
                $title
            ));
            if ($found) $page_id = (int) $found;
        }
        if (!$page_id) {
            throw new Exception('page_id, slug, or title required to set homepage');
        }
        if (!get_post($page_id)) {
            throw new Exception("Page {$page_id} not found");
        }
        $this->refuse_owners_post_if_protected($args, $page_id, 'make the homepage of');
        update_option('show_on_front', 'page');
        update_option('page_on_front', $page_id);
        return [
            'show_on_front' => 'page',
            'page_on_front' => $page_id,
            'page_title' => get_the_title($page_id),
            'permalink' => get_permalink($page_id),
        ];
    }

    /**
     * A connected site's first build (protect_existing, 2026-09-22): a page
     * or post without WPMaven's AI marker is the owner's, and the build never
     * edits, deletes or repurposes it (homepage, posts page). The API sends
     * the flag on every content action of that build; without it (a hosted
     * build, any later owner-approved change) nothing here changes.
     */
    private function refuse_owners_post_if_protected($args, $post_id, $verb) {
        if (empty($args['protect_existing'])) {
            return;
        }
        $post_id = (int) $post_id;
        if ($post_id > 0 && class_exists('WebMaven_AI_Marking') && WebMaven_AI_Marking::is_ai_generated($post_id)) {
            return;
        }
        throw new Exception("This page or post (#{$post_id}) is the owner's, not one WPMaven made: the first build leaves it alone and does not {$verb} it. Ask for the change after the build, so the owner can approve it.");
    }

    /**
     * Set the page that displays blog posts. Accepts { page_id } or { slug }.
     */
    public function set_page_for_posts($args) {
        $page_id = isset($args['page_id']) ? (int) $args['page_id'] : 0;
        $slug = isset($args['slug']) ? sanitize_title((string) $args['slug']) : '';
        if (!$page_id && $slug) {
            $page = get_page_by_path($slug);
            if ($page) $page_id = (int) $page->ID;
        }
        if (!$page_id) {
            throw new Exception('page_id or slug required');
        }
        $target = get_post($page_id);
        if (!$target || $target->post_type !== 'page') {
            throw new Exception('page_for_posts target must be an existing page');
        }
        $this->refuse_owners_post_if_protected($args, $page_id, 'make the posts page of');
        if ((int) get_option('page_on_front') === $page_id) {
            throw new Exception('page_for_posts cannot be the same as the front page');
        }
        update_option('page_for_posts', $page_id);
        // Only flip to a static front when one actually exists, else the
        // homepage goes blank (show_on_front='page' + page_on_front=0).
        if (get_option('show_on_front') !== 'page' && (int) get_option('page_on_front') > 0) {
            update_option('show_on_front', 'page');
        }
        return ['page_for_posts' => (int) $page_id, 'show_on_front' => get_option('show_on_front')];
    }

    /**
     * Batch update multiple options at once
     * Used primarily for plugin post-install configuration (skipping wizards, setting defaults)
     */
    public function batch_update_options($args) {
        $options = $args['options'] ?? [];
        $delete_transients = $args['delete_transients'] ?? [];

        if (empty($options) && empty($delete_transients)) {
            return [
                'success' => true,
                'options_updated' => 0,
                'transients_deleted' => 0,
                'message' => 'No options or transients to process'
            ];
        }

        $updated_options = [];
        $failed_options = [];
        $deleted_transients = [];

        // Process options
        foreach ($options as $opt) {
            $option_name = $opt['name'] ?? null;
            $option_value = $opt['value'] ?? null;

            if (empty($option_name)) {
                continue;
            }

            // Skip the core options (CORE_PROTECTED_OPTIONS and the roles
            // option; rewrite_rules stays writable, as onboarding needs it).
            // active_plugins and uninstall_plugins are plugin state, refused
            // just below.
            if (WebMaven_Self_Protect::is_core_protected_option($option_name)) {
                $failed_options[] = [
                    'name' => $option_name,
                    'error' => 'Protected option cannot be modified'
                ];
                continue;
            }

            // Skip webmaven internal options (and the edge options, which
            // only set_edge_config writes)
            if (WebMaven_Self_Protect::is_protected_option($option_name)) {
                $failed_options[] = [
                    'name' => $option_name,
                    'error' => 'Internal option cannot be modified'
                ];
                continue;
            }

            // Only the options on WPMaven's list; another plugin's are WPMaven Agent's.
            if (!WebMaven_Option_Allowlist::allows($option_name)) {
                $failed_options[] = [
                    'name' => $option_name,
                    'error' => WebMaven_Option_Allowlist::refusal($option_name),
                    'code' => WebMaven_Requires_Agent::CODE,
                ];
                continue;
            }

            // The store currency: only the Store currency setting changes it.
            if (WebMaven_Self_Protect::is_store_currency_option($option_name)) {
                $failed_options[] = [
                    'name' => $option_name,
                    'error' => WebMaven_Self_Protect::STORE_CURRENCY_REFUSAL
                ];
                continue;
            }

            // RAW keys are stored without content sanitization (see RAW_OPTION_KEYS)
            if (in_array($option_name, self::RAW_OPTION_KEYS, true)) {
                $option_value = self::prepare_raw_option_value($option_name, $option_value);
            }

            // Handle different value types
            if (is_array($option_value) || is_object($option_value)) {
                // For complex values, store as-is (WordPress will serialize)
                $result = update_option($option_name, $option_value);
            } else {
                $result = update_option($option_name, $option_value);
            }

            if ($result) {
                $updated_options[] = $option_name;
            }
        }

        // Delete transients. WPMaven's own (the updater's manifest cache, the
        // webhook replay nonces, the idempotency keys) ask the same list as
        // an option write, by their bare name and by the row WordPress
        // stores them in (2026-09-22).
        $failed_transients = [];
        foreach ($delete_transients as $transient) {
            if (empty($transient) || !is_scalar($transient)) {
                continue;
            }
            $transient = (string) $transient;
            if (WebMaven_Self_Protect::is_protected_option($transient)
                || WebMaven_Self_Protect::is_protected_option('_transient_' . $transient)) {
                $failed_transients[] = [
                    'name' => $transient,
                    'error' => 'Internal transient cannot be deleted'
                ];
                continue;
            }
            $deleted = delete_transient($transient);
            if ($deleted) {
                $deleted_transients[] = $transient;
            }
        }

        return [
            'success' => true,
            'options_updated' => count($updated_options),
            'options_updated_list' => $updated_options,
            'options_failed' => count($failed_options),
            'options_failed_list' => $failed_options,
            'transients_deleted' => count($deleted_transients),
            'transients_deleted_list' => $deleted_transients,
            'transients_failed' => count($failed_transients),
            'transients_failed_list' => $failed_transients,
        ];
    }

    // ===== MEDIA OPERATIONS =====
    
    public function upload_file_command($args) {
        if (!isset($args['file_content']) || !isset($args['filename'])) {
            throw new Exception('File content and filename are required');
        }
        
        if (!current_user_can('upload_files')) {
            throw new Exception('Insufficient permissions to upload files');
        }
        
        // Create temporary file
        $temp_file = wp_tempnam($args['filename']);
        file_put_contents($temp_file, base64_decode($args['file_content']));
        
        // Prepare file array for wp_handle_upload
        $file_array = [
            'name' => $args['filename'],
            'tmp_name' => $temp_file,
            'type' => $args['mime_type'] ?? 'application/octet-stream'
        ];
        
        $upload = wp_handle_upload($file_array, ['test_form' => false]);
        
        if (isset($upload['error'])) {
            throw new Exception('Upload failed: ' . $upload['error']);
        }
        
        // Create attachment
        $attachment = [
            'post_mime_type' => $upload['type'],
            'post_title' => sanitize_file_name($args['filename']),
            'post_content' => '',
            'post_status' => 'inherit'
        ];
        
        $attachment_id = wp_insert_attachment($attachment, $upload['file']);
        
        if (is_wp_error($attachment_id)) {
            throw new Exception('Failed to create attachment: ' . $attachment_id->get_error_message());
        }
        
        // Generate attachment metadata
        require_once ABSPATH . 'wp-admin/includes/image.php';
        $attachment_data = wp_generate_attachment_metadata($attachment_id, $upload['file']);
        wp_update_attachment_metadata($attachment_id, $attachment_data);
        
        return [
            'attachment_id' => $attachment_id,
            'url' => $upload['url'],
            'file' => $upload['file']
        ];
    }
    
    public function delete_file($args) {
        if (!isset($args['id'])) {
            throw new Exception('File ID is required');
        }
        
        if (!current_user_can('delete_posts')) {
            throw new Exception('Insufficient permissions to delete files');
        }
        
        $result = wp_delete_attachment($args['id'], $args['force'] ?? false);
        
        if (!$result) {
            throw new Exception('Failed to delete file');
        }
        
        return ['deleted' => true, 'file_id' => $args['id']];
    }
    
    public function get_files($args) {
        $query_args = [
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'numberposts' => $args['number'] ?? 20,
            'post_mime_type' => $args['mime_type'] ?? ''
        ];
        
        $files = get_posts($query_args);
        
        $file_list = [];
        foreach ($files as $file) {
            $file_list[] = [
                'id' => $file->ID,
                'title' => $file->post_title,
                'url' => wp_get_attachment_url($file->ID),
                'mime_type' => $file->post_mime_type,
                'date' => $file->post_date
            ];
        }
        
        return [
            'files' => $file_list,
            'count' => count($file_list)
        ];
    }

    // ===== SYSTEM OPERATIONS =====
    
    public function get_system_info($args) {
        global $wp_version, $wpdb;
        
        return [
            'wordpress_version' => $wp_version,
            'php_version' => PHP_VERSION,
            'mysql_version' => $wpdb->db_version(),
            'theme' => get_stylesheet(),
            'active_plugins' => get_option('active_plugins', []),
            'memory_limit' => ini_get('memory_limit'),
            'max_execution_time' => ini_get('max_execution_time'),
            'upload_max_filesize' => ini_get('upload_max_filesize'),
            'post_max_size' => ini_get('post_max_size')
        ];
    }
    
    public function clear_cache($args) {
        // Clear WordPress cache
        if (function_exists('wp_cache_flush')) {
            wp_cache_flush();
        }
        
        // Clear object cache
        if (function_exists('wp_cache_delete')) {
            wp_cache_delete('alloptions', 'options');
        }
        
        // Clear transients
        global $wpdb;
        $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_%'");
        $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '_site_transient_%'");
        
        return ['cache_cleared' => true];
    }
    
    public function optimize_database($args) {
        global $wpdb;
        
        $tables = $wpdb->get_results("SHOW TABLES", ARRAY_N);
        $optimized = 0;
        
        foreach ($tables as $table) {
            $table_name = $table[0];
            $result = $wpdb->query("OPTIMIZE TABLE {$table_name}");
            if ($result !== false) {
                $optimized++;
            }
        }
        
        return ['optimized_tables' => $optimized];
    }
    
    /**
     * Retired (1.2.6). It copied every table of the database into ONE
     * autoloaded wpai_backup_* option, which WordPress then loaded into memory
     * on every page, and nothing could restore it. Refuses and points to the
     * working path: the backup_create action (database dump plus media in an
     * archive), listed by backup_list and restored by backup_restore.
     */
    public function backup_database($args) {
        return [
            'success' => false,
            'error' => 'backup_database is retired: it copied the whole database into a WordPress option and could not be restored. Use the backup_create action instead (it saves the database and media as an archive); backup_list lists the archives and backup_restore restores one.',
        ];
    }

    /**
     * Retired (1.2.6). It restored from a file under
     * wp-content/ai-assistant-backups/ that nothing ever writes, dropping each
     * table first. Refuses and points to backup_restore.
     */
    public function restore_database($args) {
        return [
            'success' => false,
            'error' => 'restore_database is retired: it read a backup file that nothing creates. Use the backup_restore action with an archive made by backup_create (backup_list lists them).',
        ];
    }

    /** Set once the leftover wpai_backup_* options no longer autoload. */
    const LEGACY_BACKUPS_DONE_OPTION = 'webmaven_wp_legacy_backups_autoload_off';

    /**
     * Once, on the first request after the plugin update (hooked on init):
     * the wpai_backup_* options the retired backup_database wrote hold a copy
     * of the whole database and were autoloaded, so every page load read them
     * into memory. They are set to autoload off, NOT deleted (the owner may
     * still want the data), and a flag records that it is done. Returns the
     * number of options changed, or null when it had already run.
     */
    public static function retire_legacy_backup_options() {
        if (get_option(self::LEGACY_BACKUPS_DONE_OPTION)) {
            return null;
        }
        global $wpdb;
        $names = (array) $wpdb->get_col($wpdb->prepare(
            "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s",
            $wpdb->esc_like('wpai_backup_') . '%'
        ));
        if (!empty($names)) {
            if (function_exists('wp_set_option_autoload_values')) {
                // WordPress 6.4+: one query, and it refreshes the caches.
                wp_set_option_autoload_values(array_fill_keys($names, false));
            } else {
                foreach ($names as $name) {
                    $wpdb->update($wpdb->options, ['autoload' => 'no'], ['option_name' => $name]);
                }
                wp_cache_delete('alloptions', 'options');
            }
        }
        update_option(self::LEGACY_BACKUPS_DONE_OPTION, 1, true);
        return count($names);
    }
    
    public function update_core($args) {
        // Check if updates are available
        require_once ABSPATH . 'wp-admin/includes/update.php';
        wp_version_check();
        
        $core_update = get_core_updates();
        
        if (empty($core_update) || !isset($core_update[0])) {
            return [
                'updated' => false,
                'message' => 'WordPress is already up to date',
                'current_version' => get_bloginfo('version')
            ];
        }
        
        // Note: Actual core update requires filesystem access and should be done via WP-CLI or admin
        // This is a placeholder that returns update information
        return [
            'updated' => false,
            'message' => 'Core update requires manual intervention or WP-CLI',
            'current_version' => get_bloginfo('version'),
            'available_version' => $core_update[0]->version,
            'update_available' => true
        ];
    }

    // ===== THEME OPERATIONS =====
    
    
    
    
    public function wp_get_themes($args) {
        $themes = wp_get_themes();
        $active_theme = wp_get_theme();
        
        $themes_list = [];
        foreach ($themes as $slug => $theme) {
            $themes_list[] = [
                'slug' => $slug,
                'name' => $theme->get('Name'),
                'version' => $theme->get('Version'),
                'description' => $theme->get('Description'),
                'author' => $theme->get('Author'),
                'active' => $theme->get_stylesheet() === $active_theme->get_stylesheet()
            ];
        }
        
        return [
            'themes' => $themes_list,
            'count' => count($themes_list),
            'active_theme' => $active_theme->get_stylesheet()
        ];
    }

    // ===== MENU OPERATIONS =====
    
    /**
     * Create (or upsert) a navigation menu.
     * Upsert-by-name is the standing behavior: an existing menu with the same
     * name has its items replaced and the location assignment re-pointed. The
     * optional `upsert` flag other create_* handlers take is therefore
     * accepted here for driver symmetry but changes nothing.
     */
    public function create_menu($args) {
        if (empty($args['name'])) {
            throw new Exception('name parameter is required');
        }

        $name = sanitize_text_field($args['name']);
        $items = $args['items'] ?? [];
        $location = $args['location'] ?? null;
        // A connected site (the owner's existing WordPress, 2026-09-22): a
        // menu of theirs that happens to share the planned name keeps every
        // item. "Theirs" is a menu with any item WPMaven did not mark; the
        // planned menu is created under "<name> (WPMaven)" instead, and the
        // answer names the menu left alone. Hosted, fresh sites keep the
        // upsert-by-name (protect_existing is not sent).
        $protect = !empty($args['protect_existing']);
        $menu_left_alone = null;

        // Check if menu already exists
        $existing_menu = wp_get_nav_menu_object($name);
        if ($existing_menu && $protect && $this->menu_has_owner_items($existing_menu->term_id)) {
            $menu_left_alone = ['id' => (int) $existing_menu->term_id, 'name' => $name];
            $name = $name . (self::branded_site() ? ' (new)' : ' (WPMaven)');
            $existing_menu = wp_get_nav_menu_object($name);
            // Our own menu from an earlier run of the build is replaced;
            // a same-named menu of theirs is left alone too.
            if ($existing_menu && $this->menu_has_owner_items($existing_menu->term_id)) {
                $existing_menu = null;
                $name = $name . ' ' . gmdate('Ymd-His');
            }
        }
        if ($existing_menu) {
            $menu_id = $existing_menu->term_id;
            // Clear existing items
            $existing_items = wp_get_nav_menu_items($menu_id);
            if ($existing_items) {
                foreach ($existing_items as $item) {
                    wp_delete_post($item->ID, true);
                }
            }
        } else {
            $menu_id = wp_create_nav_menu($name);
            if (is_wp_error($menu_id)) {
                throw new Exception('Failed to create menu: ' . $menu_id->get_error_message());
            }
        }

        // Add menu items if provided
        $added_items = [];
        $skipped_items = [];
        if (!empty($items) && is_array($items)) {
            WebMaven_Log::write("[WebMaven Menu] Creating menu '{$name}' with " . count($items) . " items");
            WebMaven_Log::write("[WebMaven Menu] Menu items to add: " . json_encode(array_map(function($item) {
                return [
                    'title' => $item['title'] ?? '',
                    'object_slug' => $item['object_slug'] ?? $item['slug'] ?? '',
                    'object' => $item['object'] ?? ''
                ];
            }, $items)));

            // Get all existing pages for debugging
            $all_pages = get_posts([
                'post_type' => 'page',
                'post_status' => ['publish', 'draft', 'private'],
                'numberposts' => -1
            ]);
            $existing_page_slugs = array_map(function($p) {
                return $p->post_name;
            }, $all_pages);
            WebMaven_Log::write("[WebMaven Menu] Existing page slugs in WordPress: " . implode(', ', $existing_page_slugs));

            foreach ($items as $index => $item) {
                $menu_item_data = [
                    'menu-item-title' => $item['title'] ?? '',
                    'menu-item-status' => 'publish',
                    'menu-item-position' => $item['order'] ?? $index
                ];

                $item_slug = $item['object_slug'] ?? $item['slug'] ?? '';

                // Handle different item types
                if (!empty($item['object']) && $item['object'] === 'page') {
                    WebMaven_Log::write("[WebMaven Menu] Looking up page with slug: '{$item_slug}'");

                    // Page menu item - look up by slug
                    $page = get_page_by_path($item_slug);

                    // If found page is a draft, prefer a published page with the same slug
                    if ($page && $page->post_status !== 'publish') {
                        $published = get_posts(['post_type' => 'page', 'post_status' => 'publish', 'name' => $item_slug, 'numberposts' => 1]);
                        if (!empty($published)) {
                            $page = $published[0];
                        }
                    }

                    // Hold a non-published hit as a LAST resort instead of accepting
                    // it now: a published title-match (rungs below) must win, since a
                    // menu link to a draft 404s for visitors. Seen live: WP's default
                    // draft privacy page shadowing the real published one.
                    $non_published = null;
                    if ($page && $page->post_status !== 'publish') {
                        $non_published = $page;
                        $page = null;
                    }

                    // If not found by path, try querying by slug directly
                    if (!$page) {
                        $pages_query = get_posts([
                            'post_type' => 'page',
                            'name' => $item_slug,
                            'post_status' => ['publish', 'draft'],
                            'numberposts' => 1
                        ]);
                        if (!empty($pages_query)) {
                            $page = $pages_query[0];
                            if ($page->post_status !== 'publish') {
                                if (!$non_published) {
                                    $non_published = $page;
                                }
                                $page = null;
                            }
                        }
                    }

                    // Slug missed — fall back to the item title (exact match via
                    // the WP_Query 'title' var; the legacy title-lookup helper is
                    // deprecated since WP 6.2). Catches user-renamed/title-drifted pages.
                    if (!$page && !empty($item['title'])) {
                        $by_title = get_posts([
                            'post_type' => 'page',
                            'title' => sanitize_text_field($item['title']),
                            'post_status' => 'publish',
                            'numberposts' => 1
                        ]);
                        if (!empty($by_title)) {
                            $page = $by_title[0];
                            WebMaven_Log::write("[WebMaven Menu] Resolved '{$item_slug}' via title match '{$item['title']}'");
                        }
                    }

                    // Last rung: slug derived from the title, published only
                    if (!$page && !empty($item['title'])) {
                        $by_title_slug = get_page_by_path(sanitize_title($item['title']));
                        if ($by_title_slug && $by_title_slug->post_status === 'publish') {
                            $page = $by_title_slug;
                            WebMaven_Log::write("[WebMaven Menu] Resolved '{$item_slug}' via title-derived slug '" . sanitize_title($item['title']) . "'");
                        }
                    }

                    // Nothing published matched anywhere — fall back to the held
                    // draft/private hit (previous behavior, now demoted to last).
                    if (!$page && $non_published) {
                        $page = $non_published;
                        WebMaven_Log::write("[WebMaven Menu] Accepting non-published page for '{$item_slug}' (status: {$page->post_status}) — no published match found");
                    }

                    if ($page) {
                        $menu_item_data['menu-item-type'] = 'post_type';
                        $menu_item_data['menu-item-object'] = 'page';
                        $menu_item_data['menu-item-object-id'] = $page->ID;
                        WebMaven_Log::write("[WebMaven Menu] SUCCESS: Found page '{$item_slug}' with ID {$page->ID}, actual slug: '{$page->post_name}'");
                    } else {
                        // Page not found - log detailed info for debugging
                        WebMaven_Log::write("[WebMaven Menu] FAILED: Page NOT FOUND for slug '{$item_slug}'");
                        WebMaven_Log::write("[WebMaven Menu] Available pages at this moment: " . implode(', ', $existing_page_slugs));
                        $skipped_items[] = [
                            'slug' => $item_slug,
                            'title' => $item['title'] ?? '',
                            'reason' => 'page_not_found'
                        ];
                        continue;
                    }
                } elseif (!empty($item['url'])) {
                    // Custom URL
                    $menu_item_data['menu-item-type'] = 'custom';
                    $menu_item_data['menu-item-url'] = $item['url'];
                } else {
                    WebMaven_Log::write("WebMaven: Invalid menu item - no page object or URL: " . json_encode($item));
                    $skipped_items[] = [
                        'slug' => $item_slug,
                        'title' => $item['title'] ?? '',
                        'reason' => 'invalid_item'
                    ];
                    continue;
                }

                $item_id = wp_update_nav_menu_item($menu_id, 0, $menu_item_data);
                if (!is_wp_error($item_id)) {
                    // Ours: a later build on a connected site tells our menu
                    // items from the owner's by this marker.
                    if (class_exists('WebMaven_AI_Marking')) {
                        WebMaven_AI_Marking::mark_post((int) $item_id);
                    }
                    $added_items[] = [
                        'id' => $item_id,
                        'title' => $item['title'] ?? '',
                        'slug' => $item_slug
                    ];
                } else {
                    WebMaven_Log::write("WebMaven: Failed to add menu item '{$item_slug}': " . $item_id->get_error_message());
                    $skipped_items[] = [
                        'slug' => $item_slug,
                        'title' => $item['title'] ?? '',
                        'reason' => $item_id->get_error_message()
                    ];
                }
            }

            WebMaven_Log::write("WebMaven: Menu '{$name}' created with " . count($added_items) . " items, " . count($skipped_items) . " skipped");
        }

        // Assign menu to theme location if specified
        $location_assigned = false;
        $location_error = null;
        if ($location) {
            $registered_menus = get_registered_nav_menus();
            if (!isset($registered_menus[$location])) {
                $available = implode(', ', array_keys($registered_menus));
                WebMaven_Log::write("WebMaven: Menu location '{$location}' not registered in theme. Available: {$available}");
                $location_error = "Location '{$location}' not registered. Available: {$available}";
                $location_assigned = false;
            } else {
                $locations = get_theme_mod('nav_menu_locations', []);
                $locations[$location] = $menu_id;
                set_theme_mod('nav_menu_locations', $locations);
                $location_assigned = true;
            }
        }

        $out = [
            'menu_id' => $menu_id,
            'name' => $name,
            'items_count' => count($added_items),
            'items' => $added_items,
            'skipped_items' => $skipped_items,
            'skipped_count' => count($skipped_items),
            'location' => $location,
            'location_assigned' => $location_assigned,
            'location_error' => $location_error,
            'created' => true
        ];
        if ($protect) {
            $out['menu_left_alone'] = $menu_left_alone;
        }
        return $out;
    }

    /** Whether a menu holds any item WPMaven did not create (no AI marker). */
    private function menu_has_owner_items($menu_id): bool {
        $items = wp_get_nav_menu_items($menu_id);
        if (!$items) {
            return false;
        }
        foreach ($items as $item) {
            $id = (int) ($item->ID ?? 0);
            if ($id <= 0 || !class_exists('WebMaven_AI_Marking') || !WebMaven_AI_Marking::is_ai_generated($id)) {
                return true;
            }
        }
        return false;
    }
    
    public function update_menu($args) {
        if (empty($args['id'])) {
            throw new Exception('id parameter is required');
        }
        
        $menu_id = intval($args['id']);
        $menu = wp_get_nav_menu_object($menu_id);
        
        if (!$menu) {
            throw new Exception('Menu not found');
        }
        
        if (isset($args['name'])) {
            wp_update_nav_menu_object($menu_id, ['menu-name' => sanitize_text_field($args['name'])]);
        }
        
        if (isset($args['items']) && is_array($args['items'])) {
            // Clear existing items
            $existing_items = wp_get_nav_menu_items($menu_id);
            foreach ($existing_items as $item) {
                wp_delete_post($item->ID, true);
            }
            
            // Add new items
            foreach ($args['items'] as $item) {
                wp_update_nav_menu_item($menu_id, 0, [
                    'menu-item-title' => $item['title'] ?? '',
                    'menu-item-url' => $item['url'] ?? '',
                    'menu-item-type' => $item['type'] ?? 'custom',
                    'menu-item-status' => 'publish'
                ]);
            }
        }
        
        return [
            'menu_id' => $menu_id,
            'updated' => true
        ];
    }
    
    public function delete_menu($args) {
        if (empty($args['id'])) {
            throw new Exception('id parameter is required');
        }
        
        $menu_id = intval($args['id']);
        $result = wp_delete_nav_menu($menu_id);
        
        if (is_wp_error($result)) {
            throw new Exception('Failed to delete menu: ' . $result->get_error_message());
        }
        
        return [
            'deleted' => true,
            'menu_id' => $menu_id
        ];
    }
    
    public function get_menus($args) {
        $menus = wp_get_nav_menus();
        
        $menus_list = [];
        foreach ($menus as $menu) {
            $items = wp_get_nav_menu_items($menu->term_id);
            $items_list = [];
            
            if ($items) {
                foreach ($items as $item) {
                    $items_list[] = [
                        'id' => $item->ID,
                        'title' => $item->title,
                        'url' => $item->url,
                        'type' => $item->type
                    ];
                }
            }
            
            $menus_list[] = [
                'id' => $menu->term_id,
                'name' => $menu->name,
                'slug' => $menu->slug,
                'count' => $menu->count,
                'items' => $items_list
            ];
        }
        
        return [
            'menus' => $menus_list,
            'count' => count($menus_list)
        ];
    }

    // ===== WIDGET OPERATIONS =====
    
    
    
    public function delete_widget($args) {
        if (empty($args['id'])) {
            throw new Exception('id parameter is required');
        }
        
        $widget_id = sanitize_text_field($args['id']);
        
        // Remove widget from all sidebars
        $sidebars_widgets = get_option('sidebars_widgets', []);
        $removed = false;
        
        foreach ($sidebars_widgets as $sidebar => $widgets) {
            $key = array_search($widget_id, $widgets);
            if ($key !== false) {
                unset($sidebars_widgets[$sidebar][$key]);
                $sidebars_widgets[$sidebar] = array_values($sidebars_widgets[$sidebar]);
                $removed = true;
            }
        }
        
        if (!$removed) {
            throw new Exception('Widget not found in any sidebar');
        }
        
        update_option('sidebars_widgets', $sidebars_widgets);
        
        return [
            'widget_id' => $widget_id,
            'deleted' => true
        ];
    }
    
    public function get_widgets($args) {
        $sidebars_widgets = get_option('sidebars_widgets', []);
        $widgets_list = [];
        $redacted = 0;
        
        foreach ($sidebars_widgets as $sidebar => $widgets) {
            if ($sidebar === 'wp_inactive_widgets' || !is_array($widgets)) {
                continue;
            }
            
            foreach ($widgets as $widget_id) {
                $parts = explode('-', $widget_id);
                $type = $parts[0];
                
                $widget_settings = get_option('widget_' . $type, []);
                $settings = [];
                
                // Find widget settings
                foreach ($widget_settings as $key => $widget_setting) {
                    if (is_numeric($key) && strpos($widget_id, (string)$key) !== false) {
                        $settings = $widget_setting;
                        break;
                    }
                }
                
                $widgets_list[] = [
                    'id' => $widget_id,
                    'type' => $type,
                    'sidebar' => $sidebar,
                    // A widget's settings are a plugin's stored option: a
                    // newsletter or captcha widget keeps its API key there.
                    // Same redaction get_option applies (2026-09-22).
                    'settings' => WebMaven_User_Secrets::redact_value($settings, $redacted)
                ];
            }
        }

        return [
            'widgets' => $widgets_list,
            'count' => count($widgets_list),
            'redacted' => $redacted,
        ];
    }

    // ===== CUSTOM POST TYPE & TAXONOMY =====
    
    
    /**
     * A post of the given type, any status but trash, titled exactly $title
     * (as MySQL compares it) that WPMaven did not create (no AI marker), or
     * null. The connected-site mode of create_post leaves it alone.
     */
    private function owners_post_titled($title, $type) {
        $title = trim((string) $title);
        if ($title === '' || !function_exists('get_posts')) {
            return null;
        }
        $ids = get_posts([
            'post_type' => $type,
            'post_status' => 'any',
            'title' => $title,
            'numberposts' => -1,
            'fields' => 'ids',
            'orderby' => 'ID',
            'order' => 'ASC',
        ]);
        foreach ((array) $ids as $id) {
            $id = (int) $id;
            if ($id <= 0 || WebMaven_AI_Marking::is_ai_generated($id)) {
                continue;
            }
            $post = get_post($id);
            // WordPress's untouched sample content is nobody's.
            if ($post && class_exists('WebMaven_Default_Content') && WebMaven_Default_Content::untouched_kind($post) !== null) {
                continue;
            }
            if ($post) {
                return $post;
            }
        }
        return null;
    }

    /** A 'Y-m-d H:i:s' UTC time from a call, or null when absent or malformed. */
    private static function gmt_datetime_arg($value) {
        if (!is_string($value)) {
            return null;
        }
        $value = trim($value);
        return preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $value) ? $value : null;
    }

    // ===== THEME OPTIONS =====
    
    /**
     * A theme's settings are one array, theme_mods_{stylesheet}, which
     * get_theme_mod() reads and set_theme_mod() writes into. Until 1.2.22
     * each setting went to an option of its own,
     * theme_mods_{stylesheet}_{key}, which WordPress never reads, and the
     * call still answered updated (delete_theme_mod_junk_options() removes
     * them). The answer now lists what the theme reads back.
     */
    public function update_theme_options($args) {
        if (empty($args['options']) || !is_array($args['options'])) {
            throw new Exception('options parameter must be a non-empty array');
        }

        $requested = [];
        $failed = [];
        foreach ($args['options'] as $option_name => $option_value) {
            $name = sanitize_key((string) $option_name);
            if ($name === '') {
                $failed[] = ['name' => (string) $option_name, 'error' => 'Not a theme setting name'];
                continue;
            }
            set_theme_mod($name, $option_value);
            $requested[$name] = $option_value;
        }

        // What the theme reads now (a pre_set_theme_mod filter may change a value).
        $mods = get_theme_mods();
        $mods = is_array($mods) ? $mods : [];
        $updated = [];
        foreach ($requested as $name => $value) {
            if (array_key_exists($name, $mods) && $mods[$name] === $value) {
                $updated[] = $name;
            } else {
                $failed[] = [
                    'name' => $name,
                    'error' => 'The site kept a different value for this setting',
                    'value' => $mods[$name] ?? null,
                ];
            }
        }

        return [
            'updated' => $updated !== [] && $failed === [],
            'theme' => (string) get_option('stylesheet'),
            'options_updated' => $updated,
            'options_failed' => $failed,
            'count' => count($updated),
        ];
    }

    /** Set once the theme_mods_{stylesheet}_{key} options are gone. */
    const THEME_MOD_JUNK_DONE_OPTION = 'webmaven_wp_theme_mod_junk_deleted';

    /**
     * Once, on the first request after the 1.2.22 update (hooked on init):
     * deletes the options the old update_theme_options wrote, one per
     * setting, named theme_mods_{stylesheet}_{key}. WordPress never read them.
     * A name is one only when it starts with an installed theme's
     * theme_mods_{stylesheet}_ exactly as that code wrote it (same case) and
     * the rest is a key sanitize_key() gives back unchanged. The real
     * theme_mods_{stylesheet} arrays are never touched, the active theme's or
     * another installed theme's (theme_mods_acme_dark, the array of a theme
     * named acme_dark, is not a setting of acme). Returns the number deleted,
     * or null when it had already run.
     */
    public static function delete_theme_mod_junk_options() {
        if (get_option(self::THEME_MOD_JUNK_DONE_OPTION)) {
            return null;
        }
        global $wpdb;
        $stylesheets = array_map('strval', array_keys((array) wp_get_themes()));
        $theme_arrays = [];
        foreach ($stylesheets as $stylesheet) {
            $theme_arrays[strtolower('theme_mods_' . $stylesheet)] = true;
        }
        $deleted = 0;
        foreach ($stylesheets as $stylesheet) {
            $prefix = 'theme_mods_' . $stylesheet . '_';
            $names = (array) $wpdb->get_col($wpdb->prepare(
                "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s",
                $wpdb->esc_like($prefix) . '%'
            ));
            foreach ($names as $name) {
                $name = (string) $name;
                // LIKE ignores case; the old code wrote the stylesheet as it is.
                if (strncmp($name, $prefix, strlen($prefix)) !== 0) continue;
                if (isset($theme_arrays[strtolower($name)])) continue;
                $key = substr($name, strlen($prefix));
                if ($key === '' || sanitize_key($key) !== $key) continue;
                if (delete_option($name)) $deleted++;
            }
        }
        update_option(self::THEME_MOD_JUNK_DONE_OPTION, 1, true);
        return $deleted;
    }
    
    public function get_theme_options($args) {
        $theme_mods = get_theme_mods();
        $count = is_array($theme_mods) ? count($theme_mods) : 0;

        // Customizer settings hold API keys as often as plugin options do (a
        // maps key, a captcha secret). This is a free read whose answer goes
        // straight to the AI, so it is redacted like get_option's (2026-09-22).
        $redacted = 0;
        $theme_mods = WebMaven_User_Secrets::redact_value($theme_mods, $redacted);

        return [
            'options' => $theme_mods,
            'count' => $count,
            'redacted' => $redacted,
        ];
    }

    // ===== WEBHOOK ENDPOINT =====
    
    /**
     * Handle webhook requests from AI backend
     * Endpoint: /wp-admin/admin-ajax.php?action=ai_assistant_webhook
     */

    /** True on a site under an agency's or a partner's brand, or while it is unknown (WebMaven_Brand, 1.2.31). */
    private static function branded_site() {
        return class_exists('WebMaven_Brand') && !WebMaven_Brand::is_wpmaven();
    }
}
