<?php
/**
 * The WordPress user behind an API call, signed (1.3.0).
 *
 * The WPMaven API sees one principal for this site, the site's own OAuth
 * token, and cannot tell WordPress users apart. Since 1.3.0 every call the
 * plugin makes for a signed-in WordPress user carries X-WPMaven-Actor: a
 * short claim naming the user and their tier, signed with a key derived from
 * the site's OAuth client secret, bound to the exact method, target and body
 * of that one request, valid two minutes, and single use for writes on the
 * API's side. The API enforces each route's tiers from it.
 *
 * Tiers come from capabilities, never role names (custom roles exist), are
 * computed here per request, and are deliberately not filterable:
 *   owner    manage_options       an Administrator (a multisite super admin)
 *   store    manage_woocommerce   a Shop manager
 *   content  edit_others_posts    an Editor
 *   null     below                Authors, Contributors, Subscribers: no API route
 *
 * A user below Administrator never sees the client secret: they reach the
 * API only through this plugin's PHP. Its limit is the site's own: whoever
 * controls the WordPress database and wp-config.php holds the secret.
 *
 * Format (the API's src/services/site/siteActorClaim.ts, asserted against
 * the shared vector in tests/fixtures/site-actor-vector.json):
 *   header  {"alg":"HS256","typ":"wpm-actor+jwt","kid":<client id>}
 *   payload {"iss","aud":"wpmaven-api","sub","login","tier","wpm","htm","htu","bsh","iat","exp","jti"}
 *   key     HMAC-SHA256 keyed with the client secret over "wpmaven/site-actor/v1"
 *   token   b64url(header).b64url(payload).b64url(HMAC-SHA256(key, signing input))
 * JSON with slashes and unicode unescaped, keys in that order.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Actor {

    const HEADER = 'X-WPMaven-Actor';
    const KEY_CONTEXT = 'wpmaven/site-actor/v1';
    const TYP = 'wpm-actor+jwt';
    const AUD = 'wpmaven-api';
    /** Seconds a claim lives. */
    const LIFETIME = 120;
    const TIERS = ['owner', 'store', 'content'];
    /** The marker WPMaven Agent's owner sign-in puts on an account it created. */
    const MARKER_META = '_webmaven_admin_login_created';

    /** The tier of a WordPress user: 'owner', 'store', 'content' or null. */
    public static function tier_for($user) {
        if (!is_object($user) || empty($user->ID) || !function_exists('user_can')) {
            return null;
        }
        if (user_can($user, 'manage_options')) {
            return 'owner';
        }
        if (user_can($user, 'manage_woocommerce')) {
            return 'store';
        }
        if (user_can($user, 'edit_others_posts')) {
            return 'content';
        }
        return null;
    }

    /** The signed-in user's tier, or null (nobody signed in, or below Editor). */
    public static function current_tier() {
        if (!function_exists('is_user_logged_in') || !function_exists('current_user_can') || !is_user_logged_in()) {
            return null;
        }
        if (current_user_can('manage_options')) {
            return 'owner';
        }
        if (current_user_can('manage_woocommerce')) {
            return 'store';
        }
        if (current_user_can('edit_others_posts')) {
            return 'content';
        }
        return null;
    }

    /** A login WPMaven made on this site: 'owner' (the owner's own) or 'staff' (WPMaven support), else null. */
    public static function wpm_marker($user_id) {
        if (!function_exists('get_user_meta') || (int) $user_id <= 0) {
            return null;
        }
        $key = self::MARKER_META;
        $marker = get_user_meta((int) $user_id, $key, true);
        return ($marker === 'owner' || $marker === 'staff') ? $marker : null;
    }

    /** user_login as the claim carries it: [A-Za-z0-9._@+-] only (others become "-"), 60 at most. */
    public static function login_for($user) {
        $raw = is_object($user) && isset($user->user_login) ? (string) $user->user_login : '';
        $clean = @preg_replace('/[^A-Za-z0-9._@+-]/u', '-', $raw);
        if (!is_string($clean)) {
            // Not valid UTF-8: byte by byte.
            $clean = preg_replace('/[^A-Za-z0-9._@+-]/', '-', $raw);
        }
        $clean = substr((string) $clean, 0, 60);
        return $clean !== '' ? $clean : 'user-' . (int) ($user->ID ?? 0);
    }

    /** The claim key: 32 raw bytes. */
    public static function derive_key($client_secret) {
        return hash_hmac('sha256', self::KEY_CONTEXT, (string) $client_secret, true);
    }

    public static function b64url($bytes) {
        return rtrim(strtr(base64_encode((string) $bytes), '+/', '-_'), '=');
    }

    /** base64url (no padding) of the SHA-256 of the exact body bytes ('' for none). */
    public static function body_hash($body) {
        return self::b64url(hash('sha256', (string) $body, true));
    }

    private static function json($value) {
        $flags = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;
        $out = function_exists('wp_json_encode') ? wp_json_encode($value, $flags) : json_encode($value, $flags);
        return is_string($out) ? $out : '';
    }

    /**
     * Sign a claim.
     *
     * @param array  $actor  ['sub' => '7', 'login' => 'ana', 'tier' => 'owner', 'wpm' => null]
     * @param string $target The path and query exactly as sent, from /api.
     * @param string $body   The exact body bytes ('' for none).
     */
    public static function sign($client_id, $client_secret, array $actor, $method, $target, $body, $iat = null, $jti = null, $lifetime = self::LIFETIME) {
        $iat = $iat === null ? time() : (int) $iat;
        $jti = $jti === null ? bin2hex(random_bytes(16)) : (string) $jti;
        $header = ['alg' => 'HS256', 'typ' => self::TYP, 'kid' => (string) $client_id];
        $payload = [
            'iss' => (string) $client_id,
            'aud' => self::AUD,
            'sub' => (string) $actor['sub'],
            'login' => (string) $actor['login'],
            'tier' => (string) $actor['tier'],
            'wpm' => isset($actor['wpm']) && in_array($actor['wpm'], ['owner', 'staff'], true) ? $actor['wpm'] : null,
            'htm' => strtoupper((string) $method),
            'htu' => (string) $target,
            'bsh' => self::body_hash($body),
            'iat' => $iat,
            'exp' => $iat + (int) $lifetime,
            'jti' => $jti,
        ];
        $signing_input = self::b64url(self::json($header)) . '.' . self::b64url(self::json($payload));
        return $signing_input . '.' . self::b64url(hash_hmac('sha256', $signing_input, self::derive_key($client_secret), true));
    }

    /**
     * The URL the HTTP layer will put on the wire. WordPress's HTTP library
     * normalizes a URL before sending it (unreserved characters decoded, hex
     * escapes upper-cased): the claim signs that form, and the client sends
     * it, so the API's request.url is what was signed.
     */
    public static function wire_url($url) {
        try {
            if (class_exists('\WpOrg\Requests\Iri')) {
                $iri = new \WpOrg\Requests\Iri($url);
                $out = $iri->uri;
            } elseif (class_exists('\Requests_IRI')) {
                $iri = new \Requests_IRI($url);
                $out = $iri->uri;
            } else {
                return $url;
            }
            return (is_string($out) && $out !== '') ? $out : $url;
        } catch (\Throwable $e) {
            return $url;
        }
    }

    /**
     * The claim's target for a URL the client sends: its path and query as
     * the API sees them. The API mounts every route under /api; a path in
     * front of /api in the base URL (a proxy prefix) is not part of it.
     */
    public static function target_for($url, $api_base_url) {
        $path = (string) wp_parse_url($url, PHP_URL_PATH);
        $query = wp_parse_url($url, PHP_URL_QUERY);
        $base_path = rtrim((string) wp_parse_url((string) $api_base_url, PHP_URL_PATH), '/');
        if (strlen($base_path) > 4 && substr($base_path, -4) === '/api') {
            $prefix = substr($base_path, 0, -4);
            if (strpos($path, $prefix . '/') === 0) {
                $path = substr($path, strlen($prefix));
            }
        }
        return $path . (is_string($query) ? '?' . $query : '');
    }

    /** What the signed-in user is, for the claim, or null when nobody may reach the API. */
    public static function current_actor() {
        $tier = self::current_tier();
        if ($tier === null || !function_exists('wp_get_current_user')) {
            return null;
        }
        $user = wp_get_current_user();
        if (!is_object($user) || empty($user->ID)) {
            return null;
        }
        return [
            'sub' => (string) (int) $user->ID,
            'login' => self::login_for($user),
            'tier' => $tier,
            'wpm' => self::wpm_marker((int) $user->ID),
        ];
    }

    /**
     * The X-WPMaven-Actor value for the signed-in user's call, or null: no
     * signed-in user (a cron push, a webhook), a user below Editor, or no
     * credentials to sign with.
     */
    public static function claim($method, $target, $body, $client_id, $client_secret) {
        if (empty($client_id) || empty($client_secret)) {
            return null;
        }
        $actor = self::current_actor();
        if ($actor === null) {
            return null;
        }
        return self::sign($client_id, $client_secret, $actor, $method, $target, $body);
    }
}
