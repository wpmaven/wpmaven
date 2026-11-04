<?php
/**
 * Pages built with a page builder (2026-10-09): their words and pictures,
 * read and changed in the builder's own data, never their layout.
 *
 * Elementor keeps a page as a JSON tree in the post's `_elementor_data`
 * meta. Its top-level elements (containers, or sections of the older
 * layout) are the page's sections; inside them, the classic widgets carry
 * what the owner can change here:
 *   heading      settings.title                 (plain words)
 *   text-editor  settings.editor, one field per paragraph when the text is
 *                only paragraphs (or plain words); anything else is left to
 *                Elementor
 *   button       settings.text (plain words) and settings.link.url
 *   image        settings.image {id, url, alt}
 * A field's path is the widget's id, with ".p<n>" for a paragraph.
 *
 * Divi pages are recognised only: without a Divi licence there is no site
 * to prove a write on, so WPMaven says what it can do there and leaves the
 * page to Divi.
 *
 * Pure: no WordPress call beyond the text cleaning, so the tests run it with
 * the plain PHP CLI.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Builder_Content {

    const MAX_FIELDS = 200;
    const LABEL_CHARS = 60;
    /** Inline formatting a paragraph keeps. */
    const INLINE = ['a' => ['href' => true, 'target' => true, 'rel' => true], 'strong' => [], 'em' => [], 'b' => [], 'i' => [], 'br' => [], 'span' => ['class' => true]];

    /** The builder a post is built with: 'elementor', 'divi', or null. */
    public static function builder_of(array $meta): ?string {
        if (($meta['_elementor_edit_mode'] ?? '') === 'builder') {
            return 'elementor';
        }
        if (($meta['_et_pb_use_builder'] ?? '') === 'on') {
            return 'divi';
        }
        return null;
    }

    /** Elementor's tree from the stored meta (a JSON string, or the array an older save left). */
    public static function elementor_tree($raw): array {
        if (is_array($raw)) {
            return $raw;
        }
        if (!is_string($raw) || trim($raw) === '') {
            return [];
        }
        $tree = json_decode($raw, true);
        if (!is_array($tree)) {
            throw new Exception('UNREADABLE: The Elementor data of this page could not be read.');
        }
        return $tree;
    }

    /** The stored form of a tree, as Elementor saves it. */
    public static function encode(array $tree): string {
        return (string) wp_json_encode($tree);
    }

    /**
     * The page's sections with the fields and pictures the owner can change:
     * [{id, label, excerpt, fields: [{path, kind, text, url?, level?}], images: [{slot, file, alt}]}].
     */
    public static function sections(array $tree): array {
        $out = [];
        foreach ($tree as $element) {
            if (!is_array($element) || !isset($element['id'])) {
                continue;
            }
            $fields = [];
            $images = [];
            self::collect($element, $fields, $images);
            $first_heading = null;
            $words = [];
            foreach ($fields as $f) {
                if ($first_heading === null && $f['kind'] === 'heading') {
                    $first_heading = $f['text'];
                }
                $words[] = self::plain($f['text']);
            }
            $excerpt = self::squash(implode(' ', $words), 160);
            $label = $first_heading !== null ? self::squash(self::plain($first_heading), self::LABEL_CHARS) : self::squash($excerpt, 40);
            $out[] = [
                'id' => (string) $element['id'],
                'label' => $label !== '' ? $label : 'Section',
                'excerpt' => $excerpt,
                'fields' => $fields,
                'images' => $images,
            ];
        }
        return $out;
    }

    private static function collect(array $element, array &$fields, array &$images): void {
        if (($element['elType'] ?? '') === 'widget') {
            self::widget_fields($element, $fields, $images);
            return;
        }
        foreach ((array) ($element['elements'] ?? []) as $child) {
            if (is_array($child) && count($fields) < self::MAX_FIELDS) {
                self::collect($child, $fields, $images);
            }
        }
    }

    private static function widget_fields(array $w, array &$fields, array &$images): void {
        $id = (string) ($w['id'] ?? '');
        $s = is_array($w['settings'] ?? null) ? $w['settings'] : [];
        if ($id === '' || !preg_match('/^[0-9a-z]{1,16}$/i', $id)) {
            return;
        }
        switch ((string) ($w['widgetType'] ?? '')) {
            case 'heading':
                if (is_string($s['title'] ?? null) && trim($s['title']) !== '') {
                    $size = (string) ($s['header_size'] ?? 'h2');
                    $fields[] = ['path' => $id, 'kind' => 'heading', 'text' => self::plain($s['title']), 'level' => preg_match('/^h([1-6])$/', $size, $m) ? (int) $m[1] : 2];
                }
                break;
            case 'text-editor':
                foreach (self::paragraphs((string) ($s['editor'] ?? '')) ?? [] as $n => $p) {
                    $fields[] = ['path' => $id . '.p' . $n, 'kind' => 'text', 'text' => $p];
                }
                break;
            case 'button':
                if (is_string($s['text'] ?? null) && trim($s['text']) !== '') {
                    $f = ['path' => $id, 'kind' => 'button', 'text' => self::plain($s['text'])];
                    if (is_array($s['link'] ?? null) && is_string($s['link']['url'] ?? null)) {
                        $f['url'] = (string) $s['link']['url'];
                    }
                    $fields[] = $f;
                }
                break;
            case 'image':
                $img = is_array($s['image'] ?? null) ? $s['image'] : [];
                if (is_string($img['url'] ?? null) && $img['url'] !== '') {
                    $images[] = ['slot' => $id, 'file' => (string) $img['url'], 'alt' => (string) ($img['alt'] ?? '')];
                }
                break;
        }
    }

    /**
     * A text widget's paragraphs as fields: each <p>'s inner words, or the
     * whole text when it holds no element at all; null when it holds more
     * than paragraphs (a list, a heading: Elementor's to change).
     */
    public static function paragraphs(string $html): ?array {
        if (trim($html) === '') {
            return null;
        }
        if (strpos($html, '<') === false) {
            return [trim($html)];
        }
        if (!preg_match_all('#<p\b[^>]*>(.*?)</p>#is', $html, $m)) {
            return null;
        }
        $rest = preg_replace('#<p\b[^>]*>.*?</p>#is', '', $html);
        if (trim(str_replace('&nbsp;', '', (string) $rest)) !== '') {
            return null;
        }
        return array_map('trim', $m[1]);
    }

    /**
     * The tree with a change applied: texts [{path, text}], link {path, url},
     * image {slot, id?, url?, alt?}. A path that is not on the page fails.
     */
    public static function apply(array $tree, array $change): array {
        $texts = (array) ($change['texts'] ?? []);
        $link = $change['link'] ?? null;
        $image = $change['image'] ?? null;
        if (!$texts && !is_array($link) && !is_array($image)) {
            throw new Exception('VALIDATION: Nothing to change.');
        }
        foreach ($texts as $t) {
            if (!is_array($t) || !is_string($t['path'] ?? null) || !is_string($t['text'] ?? null)) {
                throw new Exception('VALIDATION: A text change is {path, text}.');
            }
            $tree = self::at($tree, $t['path'], function (array $w, ?int $para) use ($t) {
                return self::set_text($w, $para, $t['text']);
            });
        }
        if (is_array($link)) {
            if (!is_string($link['path'] ?? null) || !is_string($link['url'] ?? null)) {
                throw new Exception('VALIDATION: A link change is {path, url}.');
            }
            $tree = self::at($tree, $link['path'], function (array $w) use ($link) {
                if (($w['widgetType'] ?? '') !== 'button') {
                    throw new Exception('VALIDATION: Only a button\'s address changes here.');
                }
                $s = is_array($w['settings'] ?? null) ? $w['settings'] : [];
                $l = is_array($s['link'] ?? null) ? $s['link'] : [];
                $l['url'] = esc_url_raw(trim($link['url']));
                $s['link'] = $l;
                $w['settings'] = $s;
                return $w;
            });
        }
        if (is_array($image)) {
            if (!is_string($image['slot'] ?? null)) {
                throw new Exception('VALIDATION: A picture change names its slot.');
            }
            $tree = self::at($tree, $image['slot'], function (array $w) use ($image) {
                if (($w['widgetType'] ?? '') !== 'image') {
                    throw new Exception('VALIDATION: This is not a picture.');
                }
                $s = is_array($w['settings'] ?? null) ? $w['settings'] : [];
                $img = is_array($s['image'] ?? null) ? $s['image'] : [];
                if (isset($image['id'], $image['url'])) {
                    $img = ['url' => esc_url_raw((string) $image['url']), 'id' => (int) $image['id'], 'size' => '', 'source' => 'library'];
                }
                if (isset($image['alt'])) {
                    $img['alt'] = wp_strip_all_tags((string) $image['alt']);
                }
                $s['image'] = $img;
                $w['settings'] = $s;
                return $w;
            });
        }
        return $tree;
    }

    /** The widget a path names, changed by $fn; fails when it is not on the page. */
    private static function at(array $tree, string $path, callable $fn): array {
        if (!preg_match('/^([0-9a-z]{1,16})(?:\.p(\d{1,3}))?$/i', $path, $m)) {
            throw new Exception('NOT_FOUND: That part of the page is not there any more.');
        }
        $para = isset($m[2]) && $m[2] !== '' ? (int) $m[2] : null;
        $found = false;
        $tree = self::walk($tree, $m[1], function (array $w) use ($fn, $para, &$found) {
            $found = true;
            return $fn($w, $para);
        });
        if (!$found) {
            throw new Exception('NOT_FOUND: That part of the page is not there any more.');
        }
        return $tree;
    }

    private static function walk(array $elements, string $id, callable $fn): array {
        foreach ($elements as $i => $el) {
            if (!is_array($el)) {
                continue;
            }
            if (($el['elType'] ?? '') === 'widget' && (string) ($el['id'] ?? '') === $id) {
                $elements[$i] = $fn($el);
                return $elements;
            }
            if (!empty($el['elements']) && is_array($el['elements'])) {
                $elements[$i]['elements'] = self::walk($el['elements'], $id, $fn);
            }
        }
        return $elements;
    }

    private static function set_text(array $w, ?int $para, string $text): array {
        $s = is_array($w['settings'] ?? null) ? $w['settings'] : [];
        $type = (string) ($w['widgetType'] ?? '');
        $words = trim($text);
        if ($words === '') {
            throw new Exception('VALIDATION: Words cannot be empty here.');
        }
        if ($type === 'heading' && $para === null) {
            $s['title'] = wp_strip_all_tags($words);
        } elseif ($type === 'button' && $para === null) {
            $s['text'] = wp_strip_all_tags($words);
        } elseif ($type === 'text-editor') {
            $html = (string) ($s['editor'] ?? '');
            $current = self::paragraphs($html);
            if ($current === null) {
                throw new Exception('VALIDATION: Change this text in Elementor.');
            }
            $clean = wp_kses($words, self::INLINE);
            if (strpos($html, '<') === false) {
                $s['editor'] = $clean;
            } else {
                $n = $para ?? 0;
                if (!isset($current[$n])) {
                    throw new Exception('NOT_FOUND: That paragraph is not there any more.');
                }
                $i = -1;
                $s['editor'] = preg_replace_callback('#(<p\b[^>]*>)(.*?)(</p>)#is', function ($m) use (&$i, $n, $clean) {
                    $i++;
                    return $i === $n ? $m[1] . $clean . $m[3] : $m[0];
                }, $html);
            }
        } else {
            throw new Exception('VALIDATION: Change this part in Elementor.');
        }
        $w['settings'] = $s;
        return $w;
    }

    private static function plain(string $s): string {
        return trim(preg_replace('/\s+/', ' ', html_entity_decode(wp_strip_all_tags($s), ENT_QUOTES, 'UTF-8')));
    }

    private static function squash(string $s, int $max): string {
        $s = trim(preg_replace('/\s+/', ' ', $s));
        return function_exists('mb_strlen') && mb_strlen($s) > $max ? rtrim(mb_substr($s, 0, $max - 1)) . '…' : $s;
    }
}
