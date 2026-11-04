<?php
/**
 * The WPMaven API routes a WordPress site may call, and by whom (1.3.0).
 *
 * The API keeps the reviewed list of what a site may call with its own token
 * and exports it with, for
 * each route, the WordPress tiers that may use it, whether the plugin's
 * generic proxy forwards it and whether it spends AI. The plugin ships that
 * export as site-route-policy.json (copied from the API at each release) and
 * the proxy forwards exactly its routes: a route the table does not list,
 * or lists for other tiers, is refused here before any call. A table older
 * than the API's can only refuse; the site state's policyVersion tells the
 * app to ask for an update.
 *
 * Matching: the method, then the same number of path segments; a static
 * segment matches itself, :instanceId only this site's own business, any
 * other parameter one plain segment. With two matches, the one with more
 * static segments wins (as the API's router does).
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Site_Routes {

    const FILE = 'site-route-policy.json';
    const TIERS = ['owner', 'store', 'content'];
    /** One path parameter: letters, digits, dash and underscore. */
    const PARAM = '/^[A-Za-z0-9_-]{1,128}$/';

    /** @var array|null */
    private static $table = null;

    /** The table, read once per request; empty (everything refused) when the file is missing or unreadable. */
    public static function table() {
        if (self::$table === null) {
            $raw = @file_get_contents(__DIR__ . '/' . self::FILE);
            self::$table = self::normalize(is_string($raw) ? json_decode($raw, true) : null);
        }
        return self::$table;
    }

    /** Use this table instead of the shipped one (tests); null reads the file again. */
    public static function use_table($data) {
        self::$table = $data === null ? null : self::normalize($data);
    }

    /** The version of the shipped table (the API's SITE_POLICY_VERSION when it was copied). */
    public static function version() {
        return (int) self::table()['version'];
    }

    public static function min_plugin() {
        return (string) self::table()['minPlugin'];
    }

    private static function normalize($data) {
        $out = ['version' => 0, 'minPlugin' => '', 'rules' => []];
        if (!is_array($data)) {
            return $out;
        }
        $out['version'] = isset($data['version']) && is_int($data['version']) ? $data['version'] : 0;
        $out['minPlugin'] = isset($data['minPlugin']) && is_string($data['minPlugin']) ? $data['minPlugin'] : '';
        foreach ((array) ($data['rules'] ?? []) as $rule) {
            if (!is_array($rule) || !is_string($rule['method'] ?? null) || !is_string($rule['path'] ?? null) || strpos($rule['path'], '/') !== 0) {
                continue;
            }
            $tiers = $rule['tiers'] ?? [];
            $tiers = $tiers === 'any' ? 'any' : array_values(array_intersect(is_array($tiers) ? $tiers : [], self::TIERS));
            $segments = explode('/', trim($rule['path'], '/'));
            $static = 0;
            foreach ($segments as $segment) {
                if ($segment === '' || $segment[0] !== ':') {
                    $static++;
                }
            }
            $out['rules'][] = [
                'method' => strtoupper($rule['method']),
                'path' => $rule['path'],
                'segments' => $segments,
                'static' => $static,
                'tiers' => $tiers,
                'gate' => is_string($rule['gate'] ?? null) ? $rule['gate'] : '',
                'proxy' => ($rule['proxy'] ?? false) === true,
                'spendsAi' => ($rule['spendsAi'] ?? false) === true,
            ];
        }
        return $out;
    }

    /**
     * The rule for a call: the method and the API path (no leading slash
     * needed, no query), with :instanceId pinned to $instance_id. Null when
     * no rule matches.
     */
    public static function match($method, $path, $instance_id) {
        $method = strtoupper((string) $method);
        if ($method === 'HEAD') {
            $method = 'GET';
        }
        $parts = explode('/', trim((string) $path, '/'));
        $best = null;
        foreach (self::table()['rules'] as $rule) {
            if ($rule['method'] !== $method || count($rule['segments']) !== count($parts)) {
                continue;
            }
            if (!self::segments_match($rule['segments'], $parts, (string) $instance_id)) {
                continue;
            }
            if ($best === null || $rule['static'] > $best['static']) {
                $best = $rule;
            }
        }
        return $best;
    }

    private static function segments_match(array $pattern, array $parts, $instance_id) {
        foreach ($pattern as $i => $segment) {
            $part = $parts[$i];
            if ($segment !== '' && $segment[0] === ':') {
                if ($segment === ':instanceId') {
                    if ($instance_id === '' || $part !== $instance_id) {
                        return false;
                    }
                } elseif (!preg_match(self::PARAM, $part)) {
                    return false;
                }
            } elseif ($segment !== $part) {
                return false;
            }
        }
        return true;
    }

    /** The rule of one routed pattern ('/reports/:reportId/pdf'), or null. */
    public static function rule($method, $pattern) {
        $method = strtoupper((string) $method);
        foreach (self::table()['rules'] as $rule) {
            if ($rule['method'] === $method && $rule['path'] === $pattern) {
                return $rule;
            }
        }
        return null;
    }

    /** Whether a WordPress tier may use a rule ('any' needs no user at all). */
    public static function tier_allowed(array $rule, $tier) {
        if ($rule['tiers'] === 'any') {
            return true;
        }
        return is_string($tier) && in_array($tier, $rule['tiers'], true);
    }
}
