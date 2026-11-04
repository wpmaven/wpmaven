<?php
/**
 * Who may hand this site its WPMaven credentials (1.2.14).
 *
 * The WPMaven API sends a site its OAuth client credentials and an
 * authorization code server to server: POST /webmaven_wp/v1/activate (the
 * first link of a business) and POST /webmaven_wp/v1/oauth/callback (a
 * relink, often with rotated credentials). Whoever knows the client secret
 * signs the webhooks this site runs as its administrator, so these two routes
 * decide who controls the site.
 *
 * A site that holds no credentials yet (the plugin installed and not
 * connected, or signed out from WP-admin) must not take just any push whose
 * credentials exchange their code with the API: any WPMaven account could
 * then link somebody else's site to itself (register that site's address, or
 * replay the push its own site received), and its secret would sign webhooks
 * that run as the site's administrator. A Contributor must not be able to do
 * the same from WP-admin by signing in to their own account.
 *
 * So a push is accepted when one of these holds:
 *   1. An administrator of this site is signed in on the request: a WP-admin
 *      session (cookie and REST nonce) or an application password.
 *   2. It carries a link token this site gave one of its administrators.
 *      Sign In and Create Account in WP-admin ask for one (POST /link/start)
 *      and put it after the # of the dashboard address (never the query, so
 *      no server or request log sees it); the dashboard sends it to the API
 *      with the site's address, and the API puts it in the push. The
 *      dashboard's connect-with-WordPress flow asks for one with the
 *      application password the administrator approved. A token is 32 random
 *      bytes, stored only as a hash, good for an hour, and every token is
 *      dropped once the site is linked or signed out.
 *   3. The site holds credentials and the push is signed with them (the rule
 *      since 1.1.1, unchanged).
 * Anything else is refused and nothing is saved.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-webmaven-hosting.php';

class WebMaven_Link_Guard {

    /** Hashes of the tokens given out, with their expiry. Never autoloaded. */
    const OPTION = 'webmaven_wp_link_tokens';

    /** Seconds a token stays good: one sign-in, account creation included. */
    const TTL = 3600;

    /** Tokens kept at once, the newest ones (one per sign-in tab). */
    const MAX_TOKENS = 5;

    /** The field of the push body that carries the token. */
    const FIELD = 'linkToken';

    /** The error code of a push nobody at this site asked for. */
    const REFUSAL_CODE = 'wpmaven_link_not_requested';

    const REFUSAL = 'This site did not ask to be connected to WPMaven. To connect it, open WPMaven in your WordPress admin and choose Sign In.';

    /** POST /webmaven_wp/v1/link/start: a token for this administrator's sign-in. */
    public static function register_route() {
        register_rest_route('webmaven_wp/v1', '/link/start', [
            'methods' => 'POST',
            'permission_callback' => [__CLASS__, 'can_start'],
            'callback' => [__CLASS__, 'handle_start'],
        ]);
    }

    /** Only an administrator may choose which WPMaven account runs the site. */
    public static function can_start() {
        return is_user_logged_in() && current_user_can('manage_options');
    }

    public static function handle_start() {
        $body = [
            'success' => true,
            'linkToken' => self::mint(),
            'expiresIn' => self::TTL,
        ];
        // The hosting partner's code from the panel install kit (1.2.31), so
        // a site connected from the dashboard's own wizard (which asks this
        // route with the administrator's application password) can be
        // attributed too. Absent when the site carries none.
        $partner = WebMaven_Hosting::partner_for_script();
        if ($partner !== null) {
            if (($partner['code'] ?? '') !== '') {
                $body['partnerCode'] = $partner['code'];
                if (($partner['ref'] ?? '') !== '') {
                    $body['partnerRef'] = $partner['ref'];
                }
            }
        }
        $response = new \WP_REST_Response($body, 200);
        $response->header('Cache-Control', 'no-store, private');
        return $response;
    }

    /** A new token. Only its hash is stored; the token itself is returned once. */
    public static function mint() {
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $now = time();
        $kept = [];
        foreach (self::stored() as $entry) {
            if ($entry['expires'] > $now) {
                $kept[] = $entry;
            }
        }
        $kept[] = ['hash' => hash('sha256', $token), 'expires' => $now + self::TTL];
        update_option(self::OPTION, array_slice($kept, -self::MAX_TOKENS), false);
        return $token;
    }

    /** True when $token is one this site gave out and it has not expired. */
    public static function is_valid($token) {
        if (!is_string($token) || !preg_match('/^[A-Za-z0-9_-]{32,128}$/', $token)) {
            return false;
        }
        $hash = hash('sha256', $token);
        $now = time();
        $valid = false;
        foreach (self::stored() as $entry) {
            // Every entry is compared, so the answer takes the same time
            // whichever one matches.
            if ($entry['expires'] > $now && hash_equals($entry['hash'], $hash)) {
                $valid = true;
            }
        }
        return $valid;
    }

    /** Drop every token: the site is linked, or its administrator signed out. */
    public static function forget_all() {
        delete_option(self::OPTION);
    }

    /** The token a push carries, or ''. */
    public static function token_in($req) {
        $data = $req->get_json_params();
        if (!is_array($data) || !isset($data[self::FIELD]) || !is_string($data[self::FIELD])) {
            return '';
        }
        return $data[self::FIELD];
    }

    /**
     * The permission decision for /activate and /oauth/callback: true, or a
     * WP_Error. $verify_signed checks the API's signature made with the
     * credentials the site holds (WebMaven_Webhook_Handler::verify_api_request).
     */
    public static function authorize($req, $verify_signed) {
        if (is_user_logged_in() && current_user_can('manage_options')) {
            return true;
        }
        if (self::is_valid(self::token_in($req))) {
            return true;
        }
        if (!empty(get_option('webmaven_wp_client_secret'))) {
            return call_user_func($verify_signed, $req);
        }
        return new \WP_Error(self::REFUSAL_CODE, self::REFUSAL, ['status' => 403]);
    }

    /** The stored entries that have the expected shape. */
    private static function stored() {
        $list = get_option(self::OPTION, []);
        if (!is_array($list)) {
            return [];
        }
        $out = [];
        foreach ($list as $entry) {
            if (is_array($entry) && isset($entry['hash'], $entry['expires'])
                && is_string($entry['hash']) && is_numeric($entry['expires'])) {
                $out[] = ['hash' => $entry['hash'], 'expires' => (int) $entry['expires']];
            }
        }
        return $out;
    }
}
