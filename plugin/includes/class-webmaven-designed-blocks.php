<?php
/**
 * Designed pages with the owner's own blocks.
 *
 * A page WPMaven designed carries each of its sections as a Custom HTML
 * block named after the section (`<!-- wp:html {"metadata":{"name":...}} -->`,
 * its markup bound with data-wm-page and data-wm-section). WordPress's block
 * editor shows one named block per section, and the owner can add blocks of
 * their own between them. Those are the owner's: a publish, a preview, an
 * undo and "Publish anyway" put them back after the designed section they
 * followed (merge), never drop them, and the page's hash the edit engine
 * compares leaves them out (designed_sha), so adding a paragraph in
 * WordPress is no change WPMaven has to warn about while changing a designed
 * section there still is.
 *
 * A page without designed blocks (one compiled before sections were blocks,
 * or any other page) is read and written as a whole, as before.
 */

if (!defined('ABSPATH')) {
    exit;
}

class WebMaven_Designed_Blocks {

    /** WordPress's block delimiter (wp-includes/class-wp-block-parser.php). */
    const DELIMITER = '/<!--\s+(?P<closer>\/)?wp:(?P<namespace>[a-z][a-z0-9_-]*\/)?(?P<name>[a-z][a-z0-9_-]*)\s+(?P<attrs>{(?:(?:[^}]+|}+(?=})|(?!}\s+\/?-->).)*+)?}\s+)?(?P<void>\/)?-->/s';

    /** How the block editor joins top-level blocks when it saves a page. */
    const GLUE = "\n\n";

    /**
     * The top level of a markup, in order: its blocks and the text between
     * them that is not blank (classic content), each
     * {start, end, name, designed, section}. A designed block is a Custom
     * HTML block bound to a designed page; section is the first
     * data-wm-section it holds (null when it has none).
     */
    public static function segments(string $markup): array {
        $out = [];
        $cursor = 0;
        $push_text = function (int $from, int $to) use ($markup, &$out) {
            if ($to <= $from) {
                return;
            }
            $text = substr($markup, $from, $to - $from);
            if (trim($text) === '') {
                return;
            }
            $lead = strlen($text) - strlen(ltrim($text));
            $trail = strlen($text) - strlen(rtrim($text));
            $out[] = ['start' => $from + $lead, 'end' => $to - $trail, 'name' => null, 'designed' => false, 'section' => null];
        };
        if (preg_match_all(self::DELIMITER, $markup, $m, PREG_SET_ORDER | PREG_OFFSET_CAPTURE)) {
            $depth = 0;
            $open = null;
            foreach ($m as $tok) {
                $at = $tok[0][1];
                $len = strlen($tok[0][0]);
                $is_closer = isset($tok['closer']) && $tok['closer'][0] === '/' && $tok['closer'][1] >= 0;
                $is_void = isset($tok['void']) && $tok['void'][0] === '/' && $tok['void'][1] >= 0;
                $ns = isset($tok['namespace']) && $tok['namespace'][1] >= 0 ? $tok['namespace'][0] : 'core/';
                $name = $ns . $tok['name'][0];
                if ($is_closer) {
                    if ($depth === 0) {
                        continue;
                    }
                    $depth--;
                    if ($depth === 0 && $open !== null) {
                        $open['end'] = $at + $len;
                        $out[] = self::describe($markup, $open);
                        $cursor = $open['end'];
                        $open = null;
                    }
                    continue;
                }
                if ($is_void) {
                    if ($depth === 0) {
                        $push_text($cursor, $at);
                        $out[] = ['start' => $at, 'end' => $at + $len, 'name' => $name, 'designed' => false, 'section' => null];
                        $cursor = $at + $len;
                    }
                    continue;
                }
                if ($depth === 0) {
                    $push_text($cursor, $at);
                    $open = ['start' => $at, 'end' => strlen($markup), 'name' => $name];
                }
                $depth++;
            }
            if ($open !== null) {
                $out[] = self::describe($markup, $open);
                $cursor = strlen($markup);
            }
        }
        $push_text($cursor, strlen($markup));
        return $out;
    }

    private static function describe(string $markup, array $open): array {
        $bytes = substr($markup, $open['start'], $open['end'] - $open['start']);
        $designed = $open['name'] === 'core/html' && strpos($bytes, 'data-wm-page=') !== false;
        $section = null;
        if ($designed && preg_match('/\sdata-wm-section="([^"]*)"/', $bytes, $s)) {
            $section = html_entity_decode($s[1], ENT_QUOTES);
        }
        return ['start' => $open['start'], 'end' => $open['end'], 'name' => $open['name'], 'designed' => $designed, 'section' => $section];
    }

    /** Whether a markup is a designed page as blocks. */
    public static function has_designed(string $markup): bool {
        foreach (self::segments($markup) as $seg) {
            if ($seg['designed']) {
                return true;
            }
        }
        return false;
    }

    /**
     * The owner's blocks of a designed page, in order, each with the
     * designed sections before it (closest first, null for one without an
     * id) and how many designed blocks come before it:
     * {markup, before: [section ids], ordinal}.
     * Empty for a page without designed blocks.
     */
    public static function owner_blocks(string $markup): array {
        $segments = self::segments($markup);
        if (!array_filter($segments, function ($s) { return $s['designed']; })) {
            return [];
        }
        $out = [];
        $before = [];
        $ordinal = 0;
        foreach ($segments as $seg) {
            if ($seg['designed']) {
                $ordinal++;
                array_unshift($before, $seg['section']);
                continue;
            }
            $out[] = ['markup' => substr($markup, $seg['start'], $seg['end'] - $seg['start']), 'before' => $before, 'ordinal' => $ordinal];
        }
        return $out;
    }

    /**
     * The new designed markup with the owner's blocks of the current one put
     * back: each after the designed section it followed, else after the
     * closest one before it that the new markup still has, else after the
     * designed block at its place in order, else first. Never dropped. A new
     * markup without designed blocks is returned as it is.
     *
     * $memory: the section each owner block followed before a write moved it
     * (its section had gone), by the block's hash; a block goes back there as
     * soon as that section is back (the undo of a removal). $memory_out: the
     * memory after this write, for the page to keep.
     */
    public static function merge(string $new, string $current, array $memory = [], &$memory_out = null): string {
        $memory_out = [];
        $owners = self::owner_blocks($current);
        if (!$owners) {
            return $new;
        }
        $designed = array_values(array_filter(self::segments($new), function ($s) { return $s['designed']; }));
        if (!$designed) {
            return $new;
        }
        $by_section = [];
        foreach ($designed as $i => $seg) {
            if ($seg['section'] !== null && !isset($by_section[$seg['section']])) {
                $by_section[$seg['section']] = $i;
            }
        }
        // What goes after each designed block (by its index), in order; -1 is "before the first one".
        $after = [];
        foreach ($owners as $owner) {
            $at = null;
            $key = sha1($owner['markup']);
            $home = isset($memory[$key]) && is_string($memory[$key]) ? $memory[$key] : ($owner['before'][0] ?? null);
            if ($home !== null && isset($by_section[$home])) {
                // Where it was before a write moved it, now that its section is back.
                $at = $by_section[$home];
            } elseif ($owner['ordinal'] === 0 && !isset($memory[$key])) {
                $at = -1;
            } elseif ($owner['before'][0] !== null) {
                // The section it followed, else the closest one before it the new markup still has.
                foreach ($owner['before'] as $id) {
                    if ($id !== null && isset($by_section[$id])) {
                        $at = $by_section[$id];
                        break;
                    }
                }
            }
            if ($at === null) {
                // A designed block without an id, or none of them left: its place in order.
                $at = min($owner['ordinal'], count($designed)) - 1;
            }
            $after[$at][] = $owner['markup'];
            if ($home !== null && ($at < 0 || $designed[$at]['section'] !== $home)) {
                $memory_out[$key] = $home;
            }
        }
        $out = '';
        $cursor = 0;
        if (isset($after[-1])) {
            $first = $designed[0]['start'];
            $out .= substr($new, 0, $first) . implode(self::GLUE, $after[-1]) . self::GLUE;
            $cursor = $first;
        }
        foreach ($designed as $i => $seg) {
            if (!isset($after[$i])) {
                continue;
            }
            $out .= substr($new, $cursor, $seg['end'] - $cursor);
            foreach ($after[$i] as $markup) {
                $out .= self::GLUE . $markup;
            }
            $cursor = $seg['end'];
        }
        return $out . substr($new, $cursor);
    }

    /**
     * The hash the edit engine compares for a page: of its designed blocks
     * alone (joined as the block editor joins them) when it has any, so the
     * owner's blocks are no change; of the whole content otherwise. A
     * designed page without blocks of the owner hashes as its content.
     */
    public static function designed_sha(string $markup): string {
        $designed = array_filter(self::segments($markup), function ($s) { return $s['designed']; });
        if (!$designed) {
            return hash('sha256', $markup);
        }
        $parts = array_map(function ($s) use ($markup) {
            return substr($markup, $s['start'], $s['end'] - $s['start']);
        }, $designed);
        return hash('sha256', implode(self::GLUE, $parts));
    }
}
