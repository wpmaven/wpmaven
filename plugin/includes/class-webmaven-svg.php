<?php
/**
 * An SVG picture cleaned to drawing only, before it is saved to the media
 * library (upload_media).
 *
 * An SVG is an XML document, and opened on its own a browser runs what it
 * carries: scripts, event handlers, links to javascript: addresses (written
 * plainly or as character references such as &#x6A;avascript:), embedded
 * HTML in <foreignObject>, external entities. So the file is rebuilt from an
 * allowlist with WordPress's own wp_kses(): the elements a logo or an icon
 * draws with (shapes, paths, groups, gradients, clip paths and masks, text),
 * and their presentation attributes. Never kept: any on* attribute, <script>,
 * <style>, <foreignObject>, <image>, <a>, a DOCTYPE or an entity. A link
 * (href, xlink:href) may only point inside the picture (#id), a url() in an
 * attribute only to #id, and a style attribute goes through WordPress's CSS
 * filter (no url() and no expression). What is saved is one well-formed SVG
 * document, or nothing.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_SVG {

    /** Presentation attributes any drawing element may carry. */
    const PRESENTATION = [
        'id', 'class', 'style', 'transform', 'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'clip-path', 'mask',
        'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
        'stroke-dashoffset', 'stroke-opacity', 'opacity', 'color', 'display', 'visibility', 'vector-effect',
        'shape-rendering', 'paint-order', 'aria-hidden', 'aria-label', 'role', 'focusable',
        'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing',
    ];

    /** Each element kept, with the attributes of its own. */
    const ELEMENTS = [
        'svg' => ['xmlns', 'xmlns:xlink', 'viewbox', 'width', 'height', 'x', 'y', 'preserveaspectratio', 'version'],
        'g' => [],
        'defs' => [],
        'title' => [],
        'desc' => [],
        'symbol' => ['viewbox', 'preserveaspectratio', 'width', 'height', 'x', 'y'],
        'use' => ['href', 'xlink:href', 'x', 'y', 'width', 'height'],
        'path' => ['d', 'pathlength'],
        'circle' => ['cx', 'cy', 'r'],
        'ellipse' => ['cx', 'cy', 'rx', 'ry'],
        'rect' => ['x', 'y', 'width', 'height', 'rx', 'ry'],
        'line' => ['x1', 'y1', 'x2', 'y2'],
        'polyline' => ['points'],
        'polygon' => ['points'],
        'lineargradient' => ['x1', 'y1', 'x2', 'y2', 'gradientunits', 'gradienttransform', 'spreadmethod', 'href', 'xlink:href'],
        'radialgradient' => ['cx', 'cy', 'r', 'fx', 'fy', 'fr', 'gradientunits', 'gradienttransform', 'spreadmethod', 'href', 'xlink:href'],
        'stop' => ['offset', 'stop-color', 'stop-opacity'],
        'clippath' => ['clippathunits'],
        'mask' => ['maskunits', 'maskcontentunits', 'x', 'y', 'width', 'height'],
        'text' => ['x', 'y', 'dx', 'dy', 'rotate', 'textlength', 'lengthadjust'],
        'tspan' => ['x', 'y', 'dx', 'dy', 'rotate', 'textlength', 'lengthadjust'],
    ];

    /** The CSS properties a style attribute keeps, beside WordPress's own list. */
    const STYLE_PROPERTIES = [
        'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
        'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'stop-color', 'stop-opacity',
        'opacity', 'paint-order', 'vector-effect', 'text-anchor', 'dominant-baseline',
    ];

    /**
     * SVG's attribute names with capitals: wp_kses() writes every attribute
     * name in lower case, and SVG reads these only as written.
     */
    const CAMEL_ATTRIBUTES = [
        'viewbox' => 'viewBox', 'preserveaspectratio' => 'preserveAspectRatio', 'pathlength' => 'pathLength',
        'gradientunits' => 'gradientUnits', 'gradienttransform' => 'gradientTransform', 'spreadmethod' => 'spreadMethod',
        'clippathunits' => 'clipPathUnits', 'maskunits' => 'maskUnits', 'maskcontentunits' => 'maskContentUnits',
        'textlength' => 'textLength', 'lengthadjust' => 'lengthAdjust',
    ];

    /** wp_kses()'s allowlist: each element with its own and the presentation attributes. */
    public static function allowed_html(): array {
        $allowed = [];
        foreach (self::ELEMENTS as $element => $own) {
            $attributes = [];
            foreach (array_merge($own, self::PRESENTATION) as $name) {
                $attributes[$name] = true;
            }
            $allowed[$element] = $attributes;
        }
        return $allowed;
    }

    /**
     * The picture as drawing only, or null when nothing drawable is left or
     * it carries a DOCTYPE or an entity (never one of ours).
     */
    public static function clean(string $svg): ?string {
        if (preg_match('/<!\s*(DOCTYPE|ENTITY)/i', $svg)) {
            return null;
        }
        // Whole blocks whose content is code or markup, not drawing; then
        // comments, character data and processing instructions.
        $svg = preg_replace('#<(script|style|foreignObject|iframe|object|embed)\b.*?</\1\s*>#is', '', $svg);
        $svg = preg_replace('#<!--.*?-->|<!\[CDATA\[.*?\]\]>|<\?.*?\?>#s', '', (string) $svg);
        $svg = (string) $svg;

        add_filter('safe_style_css', [__CLASS__, 'style_properties']);
        try {
            $clean = wp_kses($svg, self::allowed_html(), ['http', 'https']);
        } finally {
            remove_filter('safe_style_css', [__CLASS__, 'style_properties']);
        }
        $clean = self::keep_inner_references($clean);
        $clean = trim($clean);
        if (!preg_match('/^<svg\b/i', $clean) || !preg_match('#</svg\s*>$#i', $clean)) {
            return null;
        }
        // What is saved must be one well-formed SVG document: markup that only
        // looked like attributes (a ">" inside a quoted value) leaves a broken
        // one, which is refused rather than saved.
        if (class_exists('DOMDocument')) {
            $doc = new \DOMDocument();
            $previous = libxml_use_internal_errors(true);
            $parsed = $doc->loadXML($clean, LIBXML_NONET);
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
            if (!$parsed || !$doc->documentElement || strtolower((string) $doc->documentElement->localName) !== 'svg') {
                return null;
            }
        }
        return $clean;
    }

    /** safe_style_css, while clean() runs: the SVG presentation properties too. */
    public static function style_properties($properties) {
        return array_values(array_unique(array_merge(is_array($properties) ? $properties : [], self::STYLE_PROPERTIES)));
    }

    /**
     * Links and url() that point anywhere but inside the picture are
     * dropped, read as a browser reads them (character references decoded),
     * and the attribute names SVG writes with capitals get them back.
     */
    private static function keep_inner_references(string $svg): string {
        // Each opening tag's attributes; the text between tags is left as it is.
        // A quoted value may hold a ">", so the tag ends at the first one outside quotes.
        return (string) preg_replace_callback('/<[a-zA-Z](?:[^>"\']|"[^"]*"|\'[^\']*\')*>/', static function ($tag) {
            return self::tag_attributes($tag[0]);
        }, $svg);
    }

    /** One opening tag, its attributes checked and named as SVG writes them. */
    private static function tag_attributes(string $tag): string {
        return (string) preg_replace_callback(
            '/\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|\'[^\']*\')/',
            static function ($m) {
                $name = strtolower($m[1]);
                $value = html_entity_decode(substr($m[2], 1, -1), ENT_QUOTES | ENT_HTML5, 'UTF-8');
                $value = trim(preg_replace('/[\x00-\x20]+/', '', $value));
                if ($name === 'href' || $name === 'xlink:href') {
                    return preg_match('/^#[A-Za-z_][-A-Za-z0-9_.:]*$/', $value) ? $m[0] : '';
                }
                if (stripos($value, 'url') !== false && preg_match_all('/url\(([^)]*)\)/i', $value, $urls)) {
                    foreach ($urls[1] as $target) {
                        if (!preg_match('/^["\']?#[A-Za-z_][-A-Za-z0-9_.:]*["\']?$/', trim($target))) {
                            return '';
                        }
                    }
                }
                if (preg_match('/(javascript|vbscript|data):/i', $value) || stripos($value, 'expression(') !== false) {
                    return '';
                }
                if (isset(self::CAMEL_ATTRIBUTES[$name])) {
                    return ' ' . self::CAMEL_ATTRIBUTES[$name] . '=' . $m[2];
                }
                return $m[0];
            },
            $tag
        );
    }
}
