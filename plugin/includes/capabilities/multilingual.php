<?php
/**
 * Multilingual (2026-09-22): the plugin side of the API's multilingual_setup
 * reads and its two owner-approved writes (multilingual_add_languages,
 * multilingual_save_translation).
 *
 * The API used to send wp_get_languages, wp_configure_languages and
 * wp_save_translation, which no plugin build ever handled. Contract, as the
 * API reads it (results arrive wrapped in response.data.data):
 *
 *   multilingual_status {}
 *     -> {plugin, plugin_version, languages: [{code, locale, name, default, rtl}],
 *         default_language, content: [{type, label, by_language, translated,
 *         source_total, without_language, capped}] | null,
 *         strings: {code: {total, translated, machine, reviewed}} | null,
 *         rtl_theme: {theme, declared, rtl_css, rtl_tag, block_theme},
 *         can: {add_languages, save_translations}}
 *   multilingual_post {post_id}
 *     -> {post: {id, type, status, title, content, excerpt, builder},
 *         language, translations: {code: {id, status, title}}}
 *   multilingual_add_languages {languages: [{locale, name, slug?, rtl?}], default_language?}
 *     -> {plugin, added, already, before: {languages, default_language},
 *         after: {languages, default_language}, language_packs}
 *   multilingual_save_translation {source_post_id, language, title, content,
 *                                  excerpt?, status?, slug?, overwrite?}
 *     -> {saved, created, post_id, language, source_post_id, source_language,
 *         status, before, after, edit_url, permalink, not_copied}
 *
 * Polylang: languages are added through Polylang's own model (the
 * Languages->add() of 3.7+, add_language() before it), exactly what its
 * Languages screen calls; translations are linked with
 * pll_set_post_language() + pll_save_post_translations().
 * WPML: translations are linked with the documented
 * wpml_set_element_language_details action. WPML has no public API for adding
 * languages, so that is refused with the WPML > Languages screen.
 * TranslatePress translates strings on the fly and keeps no translated posts;
 * both writes are refused with the screen where the owner does it.
 *
 * A refusal RETURNS {success: false, error, code} (never cached, read by the
 * API's pluginFailure). Nothing is written before every input is checked.
 * Only posts and pages are translated here: a product's price, stock and
 * variations live outside the post, and a copy without them would be a
 * broken product.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['multilingual_status'] = ['WebMaven_Cap_Multilingual', 'status'];
    $handlers['multilingual_post'] = ['WebMaven_Cap_Multilingual', 'post'];
    $handlers['multilingual_add_languages'] = ['WebMaven_Cap_Multilingual', 'add_languages'];
    $handlers['multilingual_save_translation'] = ['WebMaven_Cap_Multilingual', 'save_translation'];
    return $handlers;
});

final class WebMaven_Cap_Multilingual {

    /** Post types this ability reads and translates. */
    const CONTENT_TYPES = ['page' => 'Pages', 'post' => 'Posts'];

    /** Source posts looked at per type when counting translations. */
    const COUNT_CAP = 2000;

    /** Languages accepted in one call. */
    const MAX_LANGUAGES = 10;

    /** Language codes written right to left (WordPress locales, first part). */
    const RTL_CODES = ['ar', 'arc', 'ary', 'azb', 'ckb', 'dv', 'fa', 'haz', 'he', 'ps', 'sd', 'ug', 'ur', 'yi'];

    /** Where in wp-admin the owner does what this class cannot. */
    const SCREENS = [
        'polylang' => ['languages' => 'Languages', 'translations' => 'Pages or Posts (the language columns)'],
        'wpml' => ['languages' => 'WPML > Languages', 'translations' => 'WPML > Translation Management'],
        'translatepress' => ['languages' => 'Settings > TranslatePress > General', 'translations' => 'the TranslatePress editor (Translate Site in the admin bar)'],
        'none' => ['languages' => 'the multilingual plugin settings', 'translations' => 'the multilingual plugin settings'],
    ];

    // ── Commands ────────────────────────────────────────────────────────────

    /** multilingual_status: languages, content per language, RTL support. */
    public static function status($params = [], $step_id = null) {
        $plugin = self::detect();
        $out = [
            'plugin' => $plugin,
            'plugin_version' => self::plugin_version($plugin),
            'languages' => [],
            'default_language' => null,
            'content' => null,
            'strings' => null,
            'rtl_theme' => self::rtl_theme(),
            'can' => [
                'add_languages' => $plugin === 'polylang',
                'save_translations' => $plugin === 'polylang' || $plugin === 'wpml',
            ],
            'screens' => self::SCREENS[$plugin],
        ];
        if ($plugin === 'none') {
            return $out;
        }
        $state = self::languages($plugin);
        $out['languages'] = $state['languages'];
        $out['default_language'] = $state['default_language'];
        if ($plugin === 'polylang') {
            $out['content'] = self::polylang_content($state['default_language'], array_column($state['languages'], 'code'));
        } elseif ($plugin === 'wpml') {
            $out['content'] = self::wpml_content($state['default_language'], array_column($state['languages'], 'code'));
        } else {
            $out['strings'] = self::translatepress_strings($state);
        }
        return $out;
    }

    /** multilingual_post: one post or page, its language and its translations. */
    public static function post($params = [], $step_id = null) {
        $plugin = self::detect();
        $source = self::source_post($params['post_id'] ?? null);
        if (is_string($source)) {
            return self::fail($source, 'invalid_post');
        }
        $out = [
            'plugin' => $plugin,
            'post' => [
                'id' => (int) $source->ID,
                'type' => $source->post_type,
                'status' => $source->post_status,
                'title' => $source->post_title,
                'content' => $source->post_content,
                'excerpt' => $source->post_excerpt,
                'builder' => self::builder($source->ID),
            ],
            'language' => null,
            'translations' => (object) [],
        ];
        if ($plugin === 'polylang' || $plugin === 'wpml') {
            $out['language'] = self::post_language($plugin, $source);
            $translations = [];
            foreach (self::post_translations($plugin, $source) as $code => $id) {
                if ((int) $id === (int) $source->ID) {
                    continue;
                }
                $t = get_post($id);
                if ($t) {
                    $translations[$code] = ['id' => (int) $id, 'status' => $t->post_status, 'title' => $t->post_title];
                }
            }
            $out['translations'] = $translations ? $translations : (object) [];
        }
        return $out;
    }

    /** multilingual_add_languages: Polylang only; verified by reading the list again. */
    public static function add_languages($params = [], $step_id = null) {
        $plugin = self::detect();
        if ($plugin !== 'polylang') {
            return self::refuse_plugin($plugin, 'languages');
        }

        // Check every input before anything is written.
        $before = self::languages('polylang');
        $existing_locales = array_column($before['languages'], 'locale');
        $existing_slugs = array_column($before['languages'], 'code');
        $requested = isset($params['languages']) && is_array($params['languages']) ? array_values($params['languages']) : [];
        if (!$requested && empty($params['default_language'])) {
            return self::fail('Nothing was changed: no language was given.', 'invalid_input');
        }
        if (count($requested) > self::MAX_LANGUAGES) {
            return self::fail('Nothing was changed: at most ' . self::MAX_LANGUAGES . ' languages can be added at once.', 'invalid_input');
        }
        $problems = [];
        $to_add = [];
        $already = [];
        $slugs_taken = $existing_slugs;
        foreach ($requested as $i => $lang) {
            $n = $i + 1;
            if (!is_array($lang)) {
                $problems[] = "language $n is not an object";
                continue;
            }
            $locale = isset($lang['locale']) && is_string($lang['locale']) ? trim($lang['locale']) : '';
            if (!preg_match('/^[a-z]{2,3}(_[A-Z]{2})?(_[a-z0-9]+)?$/', $locale)) {
                $problems[] = "language $n has no valid WordPress locale (like fr_FR or pt_BR)";
                continue;
            }
            if (in_array($locale, $existing_locales, true)) {
                $already[] = $locale;
                continue;
            }
            $name = isset($lang['name']) && is_string($lang['name']) ? trim(wp_strip_all_tags($lang['name'])) : '';
            if ($name === '' || strlen($name) > 60) {
                $problems[] = "$locale needs a name of 1 to 60 characters";
                continue;
            }
            $slug = isset($lang['slug']) && is_string($lang['slug']) && $lang['slug'] !== '' ? strtolower(trim($lang['slug'])) : self::slug_for($locale, $slugs_taken);
            if (!preg_match('/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/', $slug)) {
                $problems[] = "$locale has an invalid language code \"$slug\"";
                continue;
            }
            if (in_array($slug, $slugs_taken, true)) {
                $problems[] = "the language code \"$slug\" is already used on this site";
                continue;
            }
            $slugs_taken[] = $slug;
            $primary = strtolower(explode('_', $locale)[0]);
            $rtl = array_key_exists('rtl', $lang) ? (bool) $lang['rtl'] : in_array($primary, self::RTL_CODES, true);
            $to_add[] = ['locale' => $locale, 'name' => $name, 'slug' => $slug, 'rtl' => $rtl];
        }
        $default = isset($params['default_language']) && is_string($params['default_language']) && $params['default_language'] !== ''
            ? strtolower(trim($params['default_language'])) : null;
        if ($default !== null && !in_array($default, $slugs_taken, true)) {
            $problems[] = "the default language \"$default\" is not one of the site's languages";
        }
        if ($problems) {
            return self::fail('Nothing was changed: ' . implode('; ', $problems) . '.', 'invalid_input', ['problems' => $problems]);
        }

        $added = [];
        $failed = [];
        $order = count($before['languages']);
        foreach ($to_add as $lang) {
            $args = [
                'name' => $lang['name'],
                'slug' => $lang['slug'],
                'locale' => $lang['locale'],
                'rtl' => $lang['rtl'] ? 1 : 0,
                'term_group' => $order++,
            ];
            $flag = self::flag_for($lang['locale']);
            if ($flag !== '') {
                $args['flag'] = $flag;
            }
            try {
                $result = self::polylang_add($args);
            } catch (\Throwable $e) {
                $result = new WP_Error('pll_add_failed', $e->getMessage());
            }
            if (self::is_error($result)) {
                $failed[] = ['locale' => $lang['locale'], 'error' => $result->get_error_message()];
            } elseif ($result === false) {
                $failed[] = ['locale' => $lang['locale'], 'error' => 'Polylang refused the language'];
            } else {
                $added[] = $lang;
            }
        }

        // Verified on the list Polylang reads, not on the calls' answers.
        self::polylang_clean_cache();
        $mid = self::languages('polylang');
        $mid_locales = array_column($mid['languages'], 'locale');
        foreach ($added as $k => $lang) {
            if (!in_array($lang['locale'], $mid_locales, true)) {
                $failed[] = ['locale' => $lang['locale'], 'error' => 'Polylang did not list the language after adding it'];
                unset($added[$k]);
            }
        }
        $added = array_values($added);

        $default_change = null;
        if ($default !== null && $default !== $mid['default_language']) {
            if (!in_array($default, array_column($mid['languages'], 'code'), true)) {
                $failed[] = ['locale' => $default, 'error' => 'the default language was not changed: that language is not on the site'];
            } else {
                try {
                    self::polylang_set_default($default);
                } catch (\Throwable $e) {
                    $failed[] = ['locale' => $default, 'error' => 'the default language was not changed: ' . $e->getMessage()];
                }
                self::polylang_clean_cache();
                $default_change = ['before' => $mid['default_language'], 'after' => pll_default_language('slug') ?: null];
                if ($default_change['after'] !== $default) {
                    $failed[] = ['locale' => $default, 'error' => 'Polylang did not make it the default language'];
                }
            }
        }

        // WordPress's own translation files for each new locale, as the
        // Languages screen downloads them. A failure leaves the language in
        // place with WordPress's own texts in English.
        $packs = [];
        foreach ($added as $lang) {
            $packs[$lang['locale']] = self::language_pack($lang['locale']);
        }

        $after = self::languages('polylang');
        $out = [
            'plugin' => 'polylang',
            'added' => array_map(function ($l) { return ['locale' => $l['locale'], 'code' => $l['slug'], 'name' => $l['name'], 'rtl' => $l['rtl']]; }, $added),
            'already' => $already,
            'failed' => $failed,
            'default_language' => $default_change,
            'language_packs' => $packs ? $packs : (object) [],
            'before' => ['languages' => $before['languages'], 'default_language' => $before['default_language']],
            'after' => ['languages' => $after['languages'], 'default_language' => $after['default_language']],
        ];
        $changed = $added || ($default_change && $default_change['before'] !== $default_change['after']);
        if (!$changed && $failed) {
            return self::fail('No language was added: ' . implode('; ', array_map(function ($f) { return $f['locale'] . ': ' . $f['error']; }, $failed)) . '.', 'not_saved', $out);
        }
        return $out;
    }

    /** multilingual_save_translation: a linked translation of a post or page. */
    public static function save_translation($params = [], $step_id = null) {
        $plugin = self::detect();
        if ($plugin !== 'polylang' && $plugin !== 'wpml') {
            return self::refuse_plugin($plugin, 'translations');
        }

        // Check every input before anything is written.
        $source = self::source_post($params['source_post_id'] ?? null);
        if (is_string($source)) {
            return self::fail('Nothing was saved: ' . $source, 'invalid_post');
        }
        if (!isset(self::CONTENT_TYPES[$source->post_type])) {
            return self::fail(
                "Nothing was saved: only posts and pages can be translated here, and {$source->ID} is a {$source->post_type}. "
                . 'Translate it in wp-admin under ' . self::SCREENS[$plugin]['translations'] . '.',
                'unsupported_type'
            );
        }
        $builder = self::builder($source->ID);
        if ($builder !== null) {
            return self::fail(
                "Nothing was saved: this page is built with $builder, which keeps its layout outside the page content, "
                . "so a translation saved here would lose the layout. Translate it with $builder in wp-admin.",
                'page_builder'
            );
        }
        $state = self::languages($plugin);
        $codes = array_column($state['languages'], 'code');
        $lang = isset($params['language']) && is_string($params['language']) ? strtolower(trim($params['language'])) : '';
        if (!in_array($lang, $codes, true)) {
            return self::fail(
                'Nothing was saved: "' . $lang . '" is not one of the site\'s languages (' . implode(', ', $codes) . ').',
                'unknown_language'
            );
        }
        if ($plugin === 'polylang' && function_exists('pll_is_translated_post_type') && !pll_is_translated_post_type($source->post_type)) {
            return self::fail("Nothing was saved: Polylang is not set to translate {$source->post_type}s (Languages > Settings > Custom post types).", 'not_translatable');
        }
        $title = isset($params['title']) && is_string($params['title']) ? trim($params['title']) : '';
        $content = isset($params['content']) && is_string($params['content']) ? $params['content'] : '';
        if ($title === '' && trim($content) === '') {
            return self::fail('Nothing was saved: the translation has no title and no content.', 'invalid_input');
        }
        $excerpt = isset($params['excerpt']) && is_string($params['excerpt']) ? $params['excerpt'] : null;
        $status = isset($params['status']) && is_string($params['status']) && $params['status'] !== '' ? $params['status'] : null;
        if ($status !== null && !in_array($status, ['draft', 'publish', 'pending'], true)) {
            return self::fail('Nothing was saved: the status must be draft, pending or publish.', 'invalid_input');
        }
        $overwrite = !empty($params['overwrite']);

        $source_lang = self::post_language($plugin, $source);
        if ($source_lang === $lang) {
            return self::fail("Nothing was saved: post {$source->ID} is already in \"$lang\".", 'same_language');
        }
        if ($plugin === 'wpml' && $source_lang === null) {
            return self::fail("Nothing was saved: WPML has no language for post {$source->ID}. Set it in wp-admin, then try again.", 'no_source_language');
        }
        $translations = self::post_translations($plugin, $source);
        $existing_id = isset($translations[$lang]) ? (int) $translations[$lang] : 0;
        $existing = $existing_id ? get_post($existing_id) : null;
        if ($existing && !$overwrite) {
            return self::fail(
                "Nothing was saved: a \"$lang\" translation already exists (post {$existing->ID}, \"{$existing->post_title}\"). Ask again with overwrite to replace it.",
                'translation_exists',
                ['existing_post_id' => (int) $existing->ID]
            );
        }

        // Write.
        $assigned_source_language = null;
        if ($plugin === 'polylang' && $source_lang === null) {
            // A post without a language cannot be linked; it takes the
            // site's default language, as Polylang's own screens would.
            $source_lang = $state['default_language'];
            if (!$source_lang) {
                return self::fail('Nothing was saved: the site has no default language in Polylang.', 'no_default_language');
            }
            pll_set_post_language($source->ID, $source_lang);
            $assigned_source_language = $source_lang;
        }

        $before = $existing ? self::post_snapshot($existing) : null;
        $postarr = [
            'post_title' => $title,
            'post_content' => $content,
        ];
        if ($excerpt !== null) {
            $postarr['post_excerpt'] = $excerpt;
        }
        if (isset($params['slug']) && is_string($params['slug']) && trim($params['slug']) !== '') {
            $postarr['post_name'] = sanitize_title($params['slug']);
        }
        if ($existing) {
            $postarr['ID'] = $existing->ID;
            if ($status !== null) {
                $postarr['post_status'] = $status;
            }
            $id = wp_update_post(wp_slash($postarr), true);
        } else {
            $postarr += [
                'post_type' => $source->post_type,
                'post_status' => $status !== null ? $status : 'draft',
                'post_author' => $source->post_author,
                'menu_order' => $source->menu_order,
                'comment_status' => $source->comment_status,
                'ping_status' => $source->ping_status,
                'post_parent' => self::translated_parent($plugin, $source, $lang),
            ];
            $id = wp_insert_post(wp_slash($postarr), true);
        }
        if (is_wp_error($id) || !$id) {
            return self::fail('The translation was not saved: ' . (is_wp_error($id) ? $id->get_error_message() : 'WordPress refused the post') . '.', 'not_saved');
        }
        $id = (int) $id;

        $not_copied = [];
        if (!$existing) {
            self::copy_attributes($plugin, $source, $id, $lang, $not_copied);
        }

        // Link, then verify the link on what the plugin reads back.
        if ($plugin === 'polylang') {
            pll_set_post_language($id, $lang);
            $group = $translations;
            $group[$source_lang] = (int) $source->ID;
            $group[$lang] = $id;
            pll_save_post_translations($group);
            $linked = (int) pll_get_post($source->ID, $lang) === $id;
        } else {
            $details = apply_filters('wpml_element_language_details', null, ['element_id' => $source->ID, 'element_type' => $source->post_type]);
            do_action('wpml_set_element_language_details', [
                'element_id' => $id,
                'element_type' => apply_filters('wpml_element_type', $source->post_type),
                'trid' => $details ? $details->trid : null,
                'language_code' => $lang,
                'source_language_code' => $source_lang,
            ]);
            $mine = apply_filters('wpml_element_language_details', null, ['element_id' => $id, 'element_type' => $source->post_type]);
            $linked = $mine && $details && $mine->language_code === $lang && (string) $mine->trid === (string) $details->trid;
        }
        $saved = get_post($id);
        $out = [
            'saved' => true,
            'linked' => (bool) $linked,
            'created' => !$existing,
            'plugin' => $plugin,
            'post_id' => $id,
            'post_type' => $source->post_type,
            'language' => $lang,
            'source_post_id' => (int) $source->ID,
            'source_language' => $source_lang,
            'source_language_assigned' => $assigned_source_language,
            'status' => $saved ? $saved->post_status : null,
            'before' => $before,
            'after' => $saved ? self::post_snapshot($saved) : null,
            'edit_url' => admin_url('post.php?post=' . $id . '&action=edit'),
            'permalink' => get_permalink($id) ?: null,
            'not_copied' => $not_copied,
        ];
        if (!$linked) {
            return self::fail(
                "The translation was saved as post $id but " . ($plugin === 'wpml' ? 'WPML' : 'Polylang') . " did not link it to post {$source->ID}. Link them in wp-admin under " . self::SCREENS[$plugin]['translations'] . '.',
                'not_linked',
                $out
            );
        }
        return $out;
    }

    // ── Reading ─────────────────────────────────────────────────────────────

    /** The active multilingual plugin. Polylang first: it answers WPML's filters too. */
    public static function detect() {
        if (function_exists('pll_languages_list') && function_exists('PLL')) {
            return 'polylang';
        }
        if (defined('ICL_SITEPRESS_VERSION')) {
            return 'wpml';
        }
        if (class_exists('TRP_Translate_Press')) {
            return 'translatepress';
        }
        return 'none';
    }

    private static function plugin_version($plugin) {
        $constants = ['polylang' => 'POLYLANG_VERSION', 'wpml' => 'ICL_SITEPRESS_VERSION', 'translatepress' => 'TRP_PLUGIN_VERSION'];
        return isset($constants[$plugin]) && defined($constants[$plugin]) ? (string) constant($constants[$plugin]) : null;
    }

    /** {languages: [{code, locale, name, default, rtl}], default_language} */
    public static function languages($plugin) {
        $languages = [];
        $default = null;
        if ($plugin === 'polylang') {
            $slugs = (array) pll_languages_list(['fields' => 'slug']);
            $locales = (array) pll_languages_list(['fields' => 'locale']);
            $names = (array) pll_languages_list(['fields' => 'name']);
            $rtl = (array) pll_languages_list(['fields' => 'is_rtl']);
            $default = pll_default_language('slug') ?: null;
            foreach (array_values($slugs) as $i => $slug) {
                $languages[] = [
                    'code' => (string) $slug,
                    'locale' => isset($locales[$i]) ? (string) $locales[$i] : null,
                    'name' => isset($names[$i]) ? (string) $names[$i] : (string) $slug,
                    'default' => $slug === $default,
                    'rtl' => !empty($rtl[$i]),
                ];
            }
        } elseif ($plugin === 'wpml') {
            $active = apply_filters('wpml_active_languages', null, ['skip_missing' => 0]);
            $default = apply_filters('wpml_default_language', null) ?: null;
            global $sitepress;
            foreach ((array) $active as $code => $l) {
                $l = (array) $l;
                $code = isset($l['code']) ? (string) $l['code'] : (string) $code;
                $rtl = is_object($sitepress) && method_exists($sitepress, 'is_rtl')
                    ? (bool) $sitepress->is_rtl($code)
                    : in_array(strtolower(explode('-', $code)[0]), self::RTL_CODES, true);
                $languages[] = [
                    'code' => $code,
                    'locale' => isset($l['default_locale']) ? (string) $l['default_locale'] : null,
                    'name' => (string) ($l['translated_name'] ?? $l['native_name'] ?? $code),
                    'default' => $code === $default,
                    'rtl' => $rtl,
                ];
            }
        } elseif ($plugin === 'translatepress') {
            $settings = get_option('trp_settings', []);
            $settings = is_array($settings) ? $settings : [];
            $default_locale = isset($settings['default-language']) ? (string) $settings['default-language'] : null;
            $locales = isset($settings['translation-languages']) && is_array($settings['translation-languages']) ? $settings['translation-languages'] : [];
            $slugs = isset($settings['url-slugs']) && is_array($settings['url-slugs']) ? $settings['url-slugs'] : [];
            $names = self::translatepress_names($locales);
            foreach ($locales as $locale) {
                $locale = (string) $locale;
                $code = isset($slugs[$locale]) && $slugs[$locale] !== '' ? (string) $slugs[$locale] : strtolower(explode('_', $locale)[0]);
                $languages[] = [
                    'code' => $code,
                    'locale' => $locale,
                    'name' => isset($names[$locale]) ? (string) $names[$locale] : $locale,
                    'default' => $locale === $default_locale,
                    'rtl' => in_array(strtolower(explode('_', $locale)[0]), self::RTL_CODES, true),
                ];
                if ($locale === $default_locale) {
                    $default = $code;
                }
            }
        }
        return ['languages' => $languages, 'default_language' => $default];
    }

    /** Posts and pages per language, and how many default-language ones have each translation. */
    private static function polylang_content($default, array $codes) {
        $out = [];
        foreach (self::CONTENT_TYPES as $type => $label) {
            if (!post_type_exists($type) || (function_exists('pll_is_translated_post_type') && !pll_is_translated_post_type($type))) {
                continue;
            }
            $by_language = [];
            foreach ($codes as $code) {
                $by_language[$code] = count(self::ids_in_language($type, $code));
            }
            $without = count(self::ids_in_language($type, null));
            $translated = [];
            foreach ($codes as $code) {
                if ($code !== $default) {
                    $translated[$code] = 0;
                }
            }
            $source_ids = $default ? self::ids_in_language($type, $default) : [];
            $capped = count($source_ids) > self::COUNT_CAP;
            foreach (array_slice($source_ids, 0, self::COUNT_CAP) as $id) {
                foreach ((array) pll_get_post_translations($id) as $code => $tid) {
                    if (isset($translated[$code]) && (int) $tid !== (int) $id) {
                        $translated[$code]++;
                    }
                }
            }
            $out[] = [
                'type' => $type,
                'label' => $label,
                'by_language' => $by_language ? $by_language : (object) [],
                'translated' => $translated ? $translated : (object) [],
                'source_total' => count($source_ids),
                'without_language' => $without,
                'capped' => $capped,
            ];
        }
        return $out;
    }

    /** Ids of a type in one Polylang language, or with none (null). Trash and auto-drafts excluded. */
    private static function ids_in_language($type, $code) {
        $tax = $code === null
            ? ['taxonomy' => 'language', 'operator' => 'NOT EXISTS']
            : ['taxonomy' => 'language', 'field' => 'slug', 'terms' => [$code]];
        return array_map('intval', (array) get_posts([
            'post_type' => $type,
            'post_status' => ['publish', 'draft', 'pending', 'private', 'future'],
            'posts_per_page' => -1,
            'fields' => 'ids',
            'orderby' => 'ID',
            'order' => 'ASC',
            // Polylang filters queries by the current language; this one names its own.
            'lang' => '',
            'tax_query' => [$tax],
            'no_found_rows' => true,
        ]));
    }

    /** The same numbers from WPML's own translations table. */
    private static function wpml_content($default, array $codes) {
        global $wpdb;
        $table = $wpdb->prefix . 'icl_translations';
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) !== $table) {
            return null;
        }
        $statuses = "'publish','draft','pending','private','future'";
        $out = [];
        foreach (self::CONTENT_TYPES as $type => $label) {
            if (!post_type_exists($type)) {
                continue;
            }
            $element = 'post_' . $type;
            $by_language = array_fill_keys($codes, 0);
            $rows = $wpdb->get_results($wpdb->prepare(
                "SELECT t.language_code AS code, COUNT(*) AS n FROM {$table} t JOIN {$wpdb->posts} p ON p.ID = t.element_id
                 WHERE t.element_type = %s AND p.post_status IN ({$statuses}) GROUP BY t.language_code",
                $element
            ));
            foreach ((array) $rows as $r) {
                if (array_key_exists($r->code, $by_language)) {
                    $by_language[$r->code] = (int) $r->n;
                }
            }
            $translated = [];
            foreach ($codes as $code) {
                if ($code !== $default) {
                    $translated[$code] = 0;
                }
            }
            if ($default) {
                $rows = $wpdb->get_results($wpdb->prepare(
                    "SELECT t2.language_code AS code, COUNT(DISTINCT t1.element_id) AS n
                     FROM {$table} t1
                     JOIN {$table} t2 ON t2.trid = t1.trid AND t2.language_code <> t1.language_code AND t2.element_type = t1.element_type
                     JOIN {$wpdb->posts} p1 ON p1.ID = t1.element_id
                     JOIN {$wpdb->posts} p2 ON p2.ID = t2.element_id
                     WHERE t1.element_type = %s AND t1.language_code = %s
                       AND p1.post_status IN ({$statuses}) AND p2.post_status IN ({$statuses})
                     GROUP BY t2.language_code",
                    $element,
                    $default
                ));
                foreach ((array) $rows as $r) {
                    if (array_key_exists($r->code, $translated)) {
                        $translated[$r->code] = (int) $r->n;
                    }
                }
            }
            $out[] = [
                'type' => $type,
                'label' => $label,
                'by_language' => $by_language ? $by_language : (object) [],
                'translated' => $translated ? $translated : (object) [],
                'source_total' => $default && isset($by_language[$default]) ? $by_language[$default] : 0,
                'without_language' => null,
                'capped' => false,
            ];
        }
        return $out;
    }

    /** TranslatePress keeps a dictionary table per language: strings found and translated. */
    private static function translatepress_strings(array $state) {
        global $wpdb;
        $default_locale = null;
        foreach ($state['languages'] as $l) {
            if ($l['default']) {
                $default_locale = $l['locale'];
            }
        }
        if (!$default_locale) {
            return null;
        }
        $out = [];
        foreach ($state['languages'] as $l) {
            if ($l['default']) {
                continue;
            }
            $table = $wpdb->prefix . 'trp_dictionary_' . strtolower($default_locale) . '_' . strtolower($l['locale']);
            if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) !== $table) {
                $out[$l['code']] = null;
                continue;
            }
            $counts = ['total' => 0, 'translated' => 0, 'machine' => 0, 'reviewed' => 0];
            // status: 0 not translated, 1 machine translated, 2 reviewed by a person.
            foreach ((array) $wpdb->get_results("SELECT status, COUNT(*) AS n FROM `{$table}` GROUP BY status") as $r) {
                $n = (int) $r->n;
                $counts['total'] += $n;
                if ((int) $r->status === 1) {
                    $counts['machine'] += $n;
                    $counts['translated'] += $n;
                } elseif ((int) $r->status === 2) {
                    $counts['reviewed'] += $n;
                    $counts['translated'] += $n;
                }
            }
            $out[$l['code']] = $counts;
        }
        return $out ? $out : (object) [];
    }

    private static function translatepress_names(array $locales) {
        try {
            if (class_exists('TRP_Translate_Press') && method_exists('TRP_Translate_Press', 'get_trp_instance')) {
                $languages = TRP_Translate_Press::get_trp_instance()->get_component('languages');
                if (is_object($languages) && method_exists($languages, 'get_language_names')) {
                    return (array) $languages->get_language_names($locales);
                }
            }
        } catch (\Throwable $e) {
            // Names are a nicety; the locales stand in.
        }
        return [];
    }

    /** Whether the active theme declares right-to-left support. */
    private static function rtl_theme() {
        $theme = wp_get_theme();
        $rtl_css = file_exists(trailingslashit(get_stylesheet_directory()) . 'rtl.css')
            || file_exists(trailingslashit(get_template_directory()) . 'rtl.css');
        $tags = array_map('strtolower', array_map('strval', (array) $theme->get('Tags')));
        $rtl_tag = in_array('rtl-language-support', $tags, true);
        return [
            'theme' => (string) $theme->get('Name'),
            'declared' => $rtl_css || $rtl_tag,
            'rtl_css' => $rtl_css,
            'rtl_tag' => $rtl_tag,
            'block_theme' => function_exists('wp_is_block_theme') ? (bool) wp_is_block_theme() : false,
        ];
    }

    private static function source_post($id) {
        if (!is_numeric($id) || (int) $id <= 0) {
            return 'no post id was given.';
        }
        $post = get_post((int) $id);
        if (!$post || in_array($post->post_status, ['trash', 'auto-draft', 'inherit'], true)) {
            return 'post ' . (int) $id . ' does not exist.';
        }
        return $post;
    }

    /** The page builder that owns this post's layout, if any. */
    private static function builder($id) {
        if (get_post_meta($id, '_elementor_edit_mode', true) === 'builder') {
            return 'Elementor';
        }
        if (get_post_meta($id, '_et_pb_use_builder', true) === 'on') {
            return 'Divi';
        }
        return null;
    }

    private static function post_language($plugin, $post) {
        if ($plugin === 'polylang') {
            $lang = pll_get_post_language($post->ID, 'slug');
            return $lang ? (string) $lang : null;
        }
        if ($plugin === 'wpml') {
            $details = apply_filters('wpml_element_language_details', null, ['element_id' => $post->ID, 'element_type' => $post->post_type]);
            return $details && !empty($details->language_code) ? (string) $details->language_code : null;
        }
        return null;
    }

    /** code => post id, the post itself included. */
    private static function post_translations($plugin, $post) {
        if ($plugin === 'polylang') {
            return array_map('intval', (array) pll_get_post_translations($post->ID));
        }
        if ($plugin === 'wpml') {
            $element = apply_filters('wpml_element_type', $post->post_type);
            $trid = apply_filters('wpml_element_trid', null, $post->ID, $element);
            if (!$trid) {
                return [];
            }
            $out = [];
            foreach ((array) apply_filters('wpml_get_element_translations', null, $trid, $element) as $code => $t) {
                if (is_object($t) && !empty($t->element_id)) {
                    $out[(string) $code] = (int) $t->element_id;
                }
            }
            return $out;
        }
        return [];
    }

    private static function post_snapshot($post) {
        return [
            'id' => (int) $post->ID,
            'title' => $post->post_title,
            'status' => $post->post_status,
            'content_length' => strlen((string) $post->post_content),
            'modified' => $post->post_modified_gmt,
        ];
    }

    private static function translated_parent($plugin, $source, $lang) {
        if (!$source->post_parent) {
            return 0;
        }
        $tr = self::post_translations($plugin, get_post($source->post_parent) ?: (object) ['ID' => $source->post_parent, 'post_type' => $source->post_type]);
        return isset($tr[$lang]) ? (int) $tr[$lang] : 0;
    }

    /** Template, featured image and the translated categories and tags. */
    private static function copy_attributes($plugin, $source, $id, $lang, array &$not_copied) {
        $template = get_post_meta($source->ID, '_wp_page_template', true);
        if ($template) {
            update_post_meta($id, '_wp_page_template', $template);
        }
        $thumb = get_post_thumbnail_id($source->ID);
        if ($thumb) {
            set_post_thumbnail($id, $thumb);
        }
        if ($source->post_parent && !get_post($id)->post_parent) {
            $not_copied[] = 'the parent page (it has no ' . $lang . ' translation yet)';
        }
        if ($source->post_type !== 'post') {
            return;
        }
        foreach (['category', 'post_tag'] as $taxonomy) {
            $terms = wp_get_object_terms($source->ID, $taxonomy, ['fields' => 'ids']);
            if (is_wp_error($terms) || !$terms) {
                continue;
            }
            $mapped = [];
            $missing = 0;
            foreach ($terms as $term_id) {
                $t = $plugin === 'polylang'
                    ? pll_get_term($term_id, $lang)
                    : apply_filters('wpml_object_id', $term_id, $taxonomy, false, $lang);
                if ($t) {
                    $mapped[] = (int) $t;
                } else {
                    $missing++;
                }
            }
            if ($mapped) {
                wp_set_object_terms($id, $mapped, $taxonomy);
            }
            if ($missing) {
                $not_copied[] = $missing . ' ' . ($taxonomy === 'category' ? 'categor' . ($missing === 1 ? 'y' : 'ies') : 'tag' . ($missing === 1 ? '' : 's')) . ' with no ' . $lang . ' translation';
            }
        }
    }

    // ── Polylang writes, across its versions ───────────────────────────────

    private static function polylang_add(array $args) {
        $model = PLL()->model;
        // 3.7+: languages live on PLL_Model::$languages.
        if (isset($model->languages) && is_object($model->languages) && method_exists($model->languages, 'add')) {
            return $model->languages->add($args);
        }
        if (method_exists($model, 'add_language')) {
            return $model->add_language($args);
        }
        // Before 3.7 only the admin model adds languages, and the webhook
        // request does not load it.
        if (class_exists('PLL_Admin_Model')) {
            $options = PLL()->options;
            $admin = new PLL_Admin_Model($options);
            return $admin->add_language($args);
        }
        return new WP_Error('pll_no_api', 'this Polylang version has no way to add a language from code');
    }

    private static function polylang_set_default($slug) {
        $model = PLL()->model;
        if (isset($model->languages) && is_object($model->languages) && method_exists($model->languages, 'update_default')) {
            $r = $model->languages->update_default($slug);
        } elseif (method_exists($model, 'update_default_lang')) {
            $r = $model->update_default_lang($slug);
        } elseif (class_exists('PLL_Admin_Model')) {
            $options = PLL()->options;
            $admin = new PLL_Admin_Model($options);
            $r = $admin->update_default_lang($slug);
        } else {
            throw new Exception('this Polylang version has no way to change the default language from code');
        }
        // Polylang 3.7 answers an EMPTY WP_Error on success.
        if (self::is_error($r)) {
            throw new Exception($r->get_error_message());
        }
    }

    /** A WP_Error that carries an error. Polylang returns empty ones for success. */
    private static function is_error($r) {
        return is_wp_error($r) && (!method_exists($r, 'has_errors') || $r->has_errors());
    }

    private static function polylang_clean_cache() {
        $model = PLL()->model;
        if (isset($model->languages) && is_object($model->languages) && method_exists($model->languages, 'clean_cache')) {
            $model->languages->clean_cache();
        } elseif (method_exists($model, 'clean_languages_cache')) {
            $model->clean_languages_cache();
        }
    }

    /** A code for the URL that no other language on the site uses: fr, then fr-ca. */
    private static function slug_for($locale, array $taken) {
        $parts = explode('_', $locale);
        $slug = strtolower($parts[0]);
        if (in_array($slug, $taken, true) && isset($parts[1])) {
            $slug .= '-' . strtolower($parts[1]);
        }
        return $slug;
    }

    /** Polylang's flag for the locale's country, only when Polylang ships it. */
    private static function flag_for($locale) {
        $parts = explode('_', $locale);
        if (!isset($parts[1]) || !defined('POLYLANG_DIR')) {
            return '';
        }
        $flag = strtolower($parts[1]);
        return file_exists(POLYLANG_DIR . '/flags/' . $flag . '.png') ? $flag : '';
    }

    /** installed | failed | not_needed */
    private static function language_pack($locale) {
        if ($locale === 'en_US') {
            return 'not_needed';
        }
        if (in_array($locale, get_available_languages(), true)) {
            return 'installed';
        }
        if (!current_user_can('install_languages')) {
            return 'failed';
        }
        try {
            require_once ABSPATH . 'wp-admin/includes/translation-install.php';
            if (!wp_can_install_language_pack()) {
                return 'failed';
            }
            return wp_download_language_pack($locale) ? 'installed' : 'failed';
        } catch (\Throwable $e) {
            return 'failed';
        }
    }

    // ── Answers ─────────────────────────────────────────────────────────────

    private static function refuse_plugin($plugin, $what) {
        if ($plugin === 'none') {
            return self::fail('Nothing was changed: no multilingual plugin is active on this site.', 'no_plugin');
        }
        $names = ['wpml' => 'WPML', 'translatepress' => 'TranslatePress'];
        $name = isset($names[$plugin]) ? $names[$plugin] : $plugin;
        $sentence = $what === 'languages'
            ? "$name has no safe way to add languages from outside wp-admin. Add them in wp-admin under " . self::SCREENS[$plugin]['languages'] . '.'
            : "$name translates text on the page, not by saving a translated copy of it. Translate it in " . self::SCREENS[$plugin]['translations'] . '.';
        return self::fail('Nothing was changed: ' . $sentence, 'unsupported_plugin', ['plugin' => $plugin, 'screen' => self::SCREENS[$plugin][$what]]);
    }

    private static function fail($error, $code, array $extra = []) {
        return array_merge($extra, ['success' => false, 'error' => $error, 'code' => $code]);
    }
}
