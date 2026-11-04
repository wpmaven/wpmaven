<?php
/**
 * API Client for AI Backend Communication
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-webmaven-log.php';

// The signed WordPress actor on every call made for a signed-in user (1.3.0).
require_once __DIR__ . '/class-webmaven-actor.php';

class WebMaven_WP_API_Client {

    public $api_base_url;
    private $access_token;
    private $refresh_token;
    private $client_id;
    private $client_secret;
    private $last_response_code = 0;
    /** The last API answer's body as it came, '' when none came (the setup wizard's proxy passes it on). */
    private $last_response_body = '';

    /** Extra headers every request of this object sends (with_header). */
    private $extra_headers = array();

    /**
     * Send this header with every request of this object, e.g. the WordPress
     * user an edit came from (X-WPMaven-WP-User, recorded by the API, never
     * trusted). Never Authorization or Content-Type. Returns $this.
     */
    public function with_header($name, $value) {
        $name = (string) $name;
        if ($name !== '' && preg_match('/^X-[A-Za-z0-9-]{1,60}$/', $name) && is_scalar($value)) {
            $this->extra_headers[$name] = substr(preg_replace('/[\r\n]+/', ' ', (string) $value), 0, 200);
        }
        return $this;
    }

    public function __construct() {
        WebMaven_Log::write('=== WebMaven WordPress: API Client constructor called ===');
        
        $stored_api_url = get_option('webmaven_wp_api_url');
        $fallback_url = WEBMAVEN_WP_API_BASE_URL;
        
        WebMaven_Log::write('WebMaven WordPress: Stored API URL from database: ' . ($stored_api_url ?: 'NOT_SET'));
        WebMaven_Log::write('WebMaven WordPress: Fallback API URL constant: ' . $fallback_url);
        
        $this->api_base_url = $stored_api_url ?: $fallback_url;
        
        // Ensure the stored URL matches the current constant (auto-update if different)
        if ($stored_api_url && $stored_api_url !== $fallback_url) {
            WebMaven_Log::write('WebMaven WordPress: Stored API URL differs from constant, updating database');
            update_option('webmaven_wp_api_url', $fallback_url);
            $this->api_base_url = $fallback_url;
        }
        // SECURITY: Decrypt OAuth tokens (stored encrypted in database)
        $encrypted_access = get_option('webmaven_wp_access_token');
        $encrypted_refresh = get_option('webmaven_wp_refresh_token');

        $this->access_token = $encrypted_access ?
            WebMaven_WP_Error_Handler::decrypt_data($encrypted_access) : null;
        $this->refresh_token = $encrypted_refresh ?
            WebMaven_WP_Error_Handler::decrypt_data($encrypted_refresh) : null;

        // Only log token status in debug mode, never log actual tokens
        if (defined('WP_DEBUG') && WP_DEBUG && defined('WEBMAVEN_DEBUG') && WEBMAVEN_DEBUG) {
            WebMaven_Log::write('WebMaven WordPress: Access token status: ' . ($this->access_token ? 'present' : 'absent'));
            WebMaven_Log::write('WebMaven WordPress: Refresh token status: ' . ($this->refresh_token ? 'present' : 'absent'));
        }
        
        WebMaven_Log::write('WebMaven WordPress: API Client initialized with base URL: ' . $this->api_base_url);
        
        // Decrypt stored credentials
        $encrypted_client_id = get_option('webmaven_wp_client_id');
        $encrypted_client_secret = get_option('webmaven_wp_client_secret');
        
        if ($encrypted_client_id) {
            $this->client_id = WebMaven_WP_Error_Handler::decrypt_data($encrypted_client_id);
        }
        
        if ($encrypted_client_secret) {
            $this->client_secret = WebMaven_WP_Error_Handler::decrypt_data($encrypted_client_secret);
        }
    }
    
    /**
     * Use these OAuth client credentials for this object only, without
     * persisting them. The link handlers call this to prove pushed credentials
     * against the WPMaven API before anything is saved.
     */
    public function use_credentials($client_id, $client_secret) {
        $this->client_id = $client_id;
        $this->client_secret = $client_secret;
    }

    /**
     * Make authenticated API request
     */
    public function make_request($endpoint, $method = 'GET', $data = null, $query_params = null, $timeout = null, $retry_count = 0, $log_payload = false, $actor_retry = 0) {
        $url = $this->api_base_url . $endpoint;

        // Add query parameters if provided
        if ($query_params && is_array($query_params)) {
            $url .= '?' . http_build_query($query_params);
        }

        // The request URL and the request/response payloads can carry customer
        // PII (emails, chat, billing) and credentials, so they never reach the
        // PHP error log on production: a caller must pass $log_payload=true AND
        // the site must define WP_DEBUG and WEBMAVEN_DEBUG. WebMaven_Log::write() ignores
        // WP_DEBUG by itself, so without this gate these wrote PII to the log.
        $debug_log = defined('WP_DEBUG') && WP_DEBUG && defined('WEBMAVEN_DEBUG') && WEBMAVEN_DEBUG;
        if ($debug_log) {
            WebMaven_Log::write('WebMaven WordPress API Client: Making ' . $method . ' request to: ' . $url);
        }
        if ($data && $log_payload && $debug_log) {
            WebMaven_Log::write('WebMaven WordPress API Client: Request data: ' . json_encode($data));
        }

        $headers = array(
            'Authorization' => 'Bearer ' . $this->access_token,
            'User-Agent' => 'WebMaven-WordPress/' . WEBMAVEN_WP_VERSION
        );
        foreach ($this->extra_headers as $header_name => $header_value) {
            $headers[$header_name] = $header_value;
        }

        // Only set Content-Type for methods that send a body
        if (in_array($method, array('POST', 'PUT', 'PATCH'))) {
            $headers['Content-Type'] = 'application/json';
        }

        // Never any part of the token in the log (1.2.9): presence only.
        WebMaven_Log::write('WebMaven WordPress API Client: Authorization header: ' . ($this->access_token ? 'present' : 'absent'));

        // Determine timeout: use provided value, or longer timeout for AI/onboarding endpoints
        if ($timeout === null) {
            $timeout = 30; // Default
            // AI and onboarding operations can take longer
            if (strpos($endpoint, '/onboarding/') !== false ||
                strpos($endpoint, '/ai/') !== false ||
                strpos($endpoint, '/canvas/') !== false) {
                $timeout = 120; // 2 minutes for AI operations
            }
        }

        $args = array(
            'method' => $method,
            'headers' => $headers,
            'timeout' => $timeout
        );
        
        if (in_array($method, array('POST', 'PUT', 'PATCH'))) {
            // Always send a body for POST/PUT/PATCH to avoid "empty body" errors
            // when Content-Type is application/json
            $args['body'] = json_encode($data ?? new \stdClass());
            if ($log_payload && $debug_log) {
                WebMaven_Log::write('WebMaven WordPress API Client: Request body: ' . $args['body']);
            }
        }

        $claim = $this->attach_actor_claim($url, $args, $method);

        $response = wp_remote_request($url, $args);
        
        if (is_wp_error($response)) {
            WebMaven_Log::write('WebMaven WordPress API Client: WP Error: ' . $response->get_error_message());
            $this->last_response_code = 0; // 0 = network error / unreachable
            $this->last_response_body = '';
            return array('success' => false, 'error' => $response->get_error_message());
        }

        $status_code = wp_remote_retrieve_response_code($response);
        $this->last_response_code = $status_code;
        $body = wp_remote_retrieve_body($response);
        $this->last_response_body = (string) $body;
        $decoded_body = json_decode($body, true);

        WebMaven_Log::write('WebMaven WordPress API Client: Response status: ' . $status_code);
        if ($log_payload && $debug_log) {
            WebMaven_Log::write('WebMaven WordPress API Client: Response body: ' . $body);
        }
        
        // A 401 refreshes the token only when the token itself failed (1.2.9).
        // A route that does not take a site token also answers 401 ("Authentication
        // failed"): a new token changes nothing there, and every refresh rotates
        // the token, so refreshing on it turned each refused call into a token
        // rotation (the WP-admin Sign In loop). One refresh at most per call.
        if ($status_code === 401) {
            if ($retry_count < 1 && self::is_token_failure($decoded_body, $this->access_token) && $this->refresh_access_token()) {
                // Retry the request with new token (forward all parameters)
                return $this->make_request($endpoint, $method, $data, $query_params, $timeout, $retry_count + 1, $log_payload, $actor_retry);
            }
            $failure = array(
                'success' => false,
                'error' => (is_array($decoded_body) && !empty($decoded_body['error']) && is_string($decoded_body['error'])) ? $decoded_body['error'] : 'Authentication failed',
                'status_code' => 401,
            );
            if (is_array($decoded_body) && !empty($decoded_body['code']) && is_string($decoded_body['code'])) {
                $failure['code'] = $decoded_body['code'];
            }
            return $failure;
        }
        
        // The API could not check the claim (1.3.0): a relink rotated the
        // client secret since this object read it, or a parallel request
        // stored new tokens. Read the credentials again and sign once more.
        if ($status_code === 403 && $claim !== null && $actor_retry < 1
            && is_array($decoded_body) && ($decoded_body['code'] ?? '') === 'SITE_ACTOR_INVALID') {
            $this->reload_credentials();
            return $this->make_request($endpoint, $method, $data, $query_params, $timeout, $retry_count, $log_payload, $actor_retry + 1);
        }

        $is_success = $status_code >= 200 && $status_code < 300;

        // The API returns responses in format: {success: bool, data: {...}, error?: string}
        // We unwrap this to provide a consistent interface
        $unwrapped_data = $decoded_body;
        $api_success = $is_success;
        $api_error = null;

        if (is_array($decoded_body)) {
            // Check if this is a standard API response format
            if (isset($decoded_body['success'])) {
                $api_success = $is_success && $decoded_body['success'];
            }
            // Extract inner data if present
            if (isset($decoded_body['data'])) {
                $unwrapped_data = $decoded_body['data'];
            }
            // Extract error message if present
            if (isset($decoded_body['error'])) {
                $api_error = $decoded_body['error'];
            } elseif (isset($decoded_body['message'])) {
                $api_error = $decoded_body['message'];
            }
        }

        $result = array(
            'success' => $api_success,
            'data' => $unwrapped_data,
            'status_code' => $status_code
        );

        if ($api_error) {
            $result['error'] = $api_error;
        }
        // The API's refusal code (e.g. a future SITE_SESSION_ONLY), passed on as is.
        if (is_array($decoded_body) && !empty($decoded_body['code']) && is_string($decoded_body['code'])) {
            $result['code'] = $decoded_body['code'];
        }

        return $result;
    }

    /**
     * A 401 that a token refresh can fix (1.2.9): the API says the token is
     * invalid or expired (siteAuth and the session guard both answer "Invalid
     * or expired token"), names TOKEN_EXPIRED / TOKEN_INVALID, or no token was
     * sent at all. Not "Authentication failed": that is a route that does not
     * take a site token, and a new token of the same kind changes nothing.
     *
     * @param mixed       $body         The decoded 401 body.
     * @param string|null $access_token The token the request carried.
     */
    public static function is_token_failure($body, $access_token = null) {
        if (empty($access_token)) {
            return true;
        }
        if (!is_array($body)) {
            return false;
        }
        $code = isset($body['code']) && is_string($body['code']) ? strtoupper($body['code']) : '';
        if ($code === 'TOKEN_EXPIRED' || $code === 'TOKEN_INVALID') {
            return true;
        }
        $error = isset($body['error']) && is_string($body['error']) ? $body['error'] : '';
        return $error === 'Invalid or expired token';
    }

    /**
     * True when the stored access token's own expiry (the JWT `exp` claim,
     * read without verifying the signature) has passed or is within $leeway
     * seconds. False when the token has no readable expiry.
     */
    public function access_token_expired($leeway = 30) {
        $parts = explode('.', (string) $this->access_token);
        if (count($parts) !== 3) {
            return false;
        }
        $payload = json_decode((string) base64_decode(strtr($parts[1], '-_', '+/'), false), true);
        if (!is_array($payload) || empty($payload['exp']) || !is_numeric($payload['exp'])) {
            return false;
        }
        return (int) $payload['exp'] <= time() + (int) $leeway;
    }

    /**
     * Re-read the tokens from the database. Another request (a cron push, a
     * parallel admin screen, a re-link) may have stored new ones since this
     * object was built. Returns true when the access token changed.
     */
    public function reload_tokens() {
        $encrypted_access = get_option('webmaven_wp_access_token');
        $encrypted_refresh = get_option('webmaven_wp_refresh_token');
        $access = $encrypted_access ? WebMaven_WP_Error_Handler::decrypt_data($encrypted_access) : null;
        $refresh = $encrypted_refresh ? WebMaven_WP_Error_Handler::decrypt_data($encrypted_refresh) : null;
        $changed = !empty($access) && $access !== $this->access_token;
        if (!empty($access)) {
            $this->access_token = $access;
        }
        if (!empty($refresh)) {
            $this->refresh_token = $refresh;
        }
        return $changed;
    }

    /**
     * The WordPress user behind a call, signed (1.3.0, WebMaven_Actor): bound
     * to the exact URL the HTTP layer sends and the exact body bytes. Nothing
     * without a signed-in user who may reach the API (cron, webhooks). Returns
     * the claim it attached, or null.
     */
    private function attach_actor_claim(&$url, array &$args, $method) {
        if (!class_exists('WebMaven_Actor')) {
            return null;
        }
        $wire_url = WebMaven_Actor::wire_url($url);
        $claim = WebMaven_Actor::claim($method, WebMaven_Actor::target_for($wire_url, $this->api_base_url), $args['body'] ?? '', $this->client_id, $this->client_secret);
        if ($claim !== null) {
            $url = $wire_url;
            $args['headers'][WebMaven_Actor::HEADER] = $claim;
        }
        return $claim;
    }

    /**
     * A GET whose answer is a file (a report's PDF, 1.3.0): the same
     * authorization, actor claim, single token refresh and single claim
     * retry as make_request, the body kept as bytes.
     *
     * @return array success, status_code, body, content_type, disposition,
     *               and error and code when it failed.
     */
    public function fetch_binary($endpoint, $timeout = 30, $retry_count = 0, $actor_retry = 0) {
        $url = $this->api_base_url . $endpoint;
        $args = array(
            'method' => 'GET',
            'headers' => array(
                'Authorization' => 'Bearer ' . $this->access_token,
                'User-Agent' => 'WebMaven-WordPress/' . WEBMAVEN_WP_VERSION,
            ),
            'timeout' => $timeout,
        );
        $claim = $this->attach_actor_claim($url, $args, 'GET');
        $response = wp_remote_request($url, $args);
        if (is_wp_error($response)) {
            $this->last_response_code = 0;
            return array('success' => false, 'status_code' => 0, 'error' => $response->get_error_message());
        }
        $status = (int) wp_remote_retrieve_response_code($response);
        $this->last_response_code = $status;
        $body = (string) wp_remote_retrieve_body($response);
        $type = function_exists('wp_remote_retrieve_header') ? (string) wp_remote_retrieve_header($response, 'content-type') : '';
        $decoded = strpos($type, 'json') !== false ? json_decode($body, true) : null;
        if ($status === 401 && $retry_count < 1 && self::is_token_failure($decoded, $this->access_token) && $this->refresh_access_token()) {
            return $this->fetch_binary($endpoint, $timeout, $retry_count + 1, $actor_retry);
        }
        if ($status === 403 && $claim !== null && $actor_retry < 1 && is_array($decoded) && ($decoded['code'] ?? '') === 'SITE_ACTOR_INVALID') {
            $this->reload_credentials();
            return $this->fetch_binary($endpoint, $timeout, $retry_count, $actor_retry + 1);
        }
        if ($status < 200 || $status >= 300) {
            $out = array('success' => false, 'status_code' => $status, 'error' => (is_array($decoded) && is_string($decoded['error'] ?? null)) ? $decoded['error'] : '');
            if (is_array($decoded) && is_string($decoded['code'] ?? null)) {
                $out['code'] = $decoded['code'];
            }
            return $out;
        }
        return array(
            'success' => true,
            'status_code' => $status,
            'body' => $body,
            'content_type' => $type,
            'disposition' => function_exists('wp_remote_retrieve_header') ? (string) wp_remote_retrieve_header($response, 'content-disposition') : '',
        );
    }

    /**
     * Re-read the client credentials and the tokens from the database (1.3.0):
     * a relink rotates the client secret, which signs the actor claim.
     */
    public function reload_credentials() {
        $encrypted_client_id = get_option('webmaven_wp_client_id');
        $encrypted_client_secret = get_option('webmaven_wp_client_secret');
        if ($encrypted_client_id) {
            $this->client_id = WebMaven_WP_Error_Handler::decrypt_data($encrypted_client_id);
        }
        if ($encrypted_client_secret) {
            $this->client_secret = WebMaven_WP_Error_Handler::decrypt_data($encrypted_client_secret);
        }
        $this->reload_tokens();
    }

    /**
     * An id that goes into an API path (a conversation, a step): letters,
     * digits, dash and underscore only, so it can never climb out of its
     * route ("../payments/portal"). Returns '' for anything else.
     */
    public static function path_id($id) {
        $id = is_scalar($id) ? (string) $id : '';
        return preg_match('/^[A-Za-z0-9_-]{1,128}$/', $id) ? $id : '';
    }
    
    /**
     * Refresh access token
     */
    public function refresh_access_token() {
        // Another request may have refreshed since this object read the
        // tokens: use its new tokens instead of rotating them again (1.2.9).
        if ($this->reload_tokens()) {
            WebMaven_Log::write('WebMaven WordPress: Token refresh skipped - newer tokens already stored');
            return true;
        }

        if (empty($this->client_id) || empty($this->client_secret) || empty($this->refresh_token)) {
            WebMaven_Log::write('WebMaven WordPress: refresh_access_token - missing credentials');
            return false;
        }

        // One refresh at a time for the whole site (1.2.9). Every refresh
        // rotates both tokens, so two parallel refreshes kill each other's
        // result. A request that finds the lock taken does not refresh.
        if (get_transient(self::REFRESH_LOCK)) {
            WebMaven_Log::write('WebMaven WordPress: Token refresh skipped - another refresh is running');
            return false;
        }
        set_transient(self::REFRESH_LOCK, 1, 45); // longer than the 30 s refresh call
        try {
            return $this->do_refresh_access_token();
        } finally {
            delete_transient(self::REFRESH_LOCK);
        }
    }

    /**
     * Whether WPMaven's stored connection can no longer be read: the client
     * secret is stored but does not decrypt. Its key comes from the site's
     * secret_key (wp_salt('AUTH_KEY')), so a change to that option, which a
     * restore of an older or broken dump made before 1.6.0, leaves every
     * stored credential unreadable. /status then asks for a reconnect and
     * says why, instead of failing refresh after refresh.
     */
    public static function stored_connection_unreadable(): bool {
        $stored = get_option('webmaven_wp_client_secret');
        if (empty($stored) || !is_string($stored)) return false;
        return WebMaven_WP_Error_Handler::decrypt_data($stored) === '';
    }

    /** Transient that serializes token refreshes across requests. */
    const REFRESH_LOCK = 'webmaven_wp_token_refresh_lock';

    /**
     * Transient set by a refresh of an expired token from a read: no other one
     * for EXPIRY_REFRESH_GAP seconds, across the site, whatever the API says.
     */
    const EXPIRY_REFRESH_GUARD = 'webmaven_wp_expiry_refresh';
    const EXPIRY_REFRESH_GAP = 300;

    /**
     * A read that never refreshes a token the API refuses (make_request with
     * $retry_count = 1: a poll must not rotate anything, the Sign In loop of
     * 1.2.9), but refreshes an access token that has only expired: ahead, by
     * the token's own expiry, and once more when the API answers
     * TOKEN_EXPIRED, then reads again. Reads used to wait for the owner's next
     * action to refresh it, so an idle site's state could not be read once its
     * hour was up (GET /sites/me answered 401 until a refresh by hand).
     *
     * @param string $endpoint the route, e.g. '/sites/me'
     * @param int    $timeout  seconds
     * @return array make_request's result.
     */
    public function read_refreshing_expired($endpoint, $timeout) {
        $this->refresh_if_expired();
        $response = $this->make_request($endpoint, 'GET', null, null, (int) $timeout, 1);
        if ((int) ($response['status_code'] ?? 0) === 401 && ($response['code'] ?? '') === 'TOKEN_EXPIRED'
            && $this->refresh_if_expired(true)) {
            $response = $this->make_request($endpoint, 'GET', null, null, (int) $timeout, 1);
        }
        return $response;
    }

    /**
     * Refresh the access token when it has expired: by its own expiry, or
     * because the API just said so ($api_said_expired, a clock that differs).
     * An expired token needs a new one whatever happens, and the new one has
     * not expired, so this cannot loop; it still runs at most once every
     * EXPIRY_REFRESH_GAP seconds for the whole site, and inside that gap it
     * only picks up tokens another request stored. A refresh the API refuses
     * counts in REFRESH_REJECTIONS as before, so /status asks for a reconnect
     * as it did.
     *
     * @return bool true when this object now holds other tokens.
     */
    public function refresh_if_expired($api_said_expired = false) {
        if (empty($this->access_token) || (!$api_said_expired && !$this->access_token_expired())) {
            return false;
        }
        if (get_transient(self::EXPIRY_REFRESH_GUARD)) {
            return $this->reload_tokens();
        }
        set_transient(self::EXPIRY_REFRESH_GUARD, 1, self::EXPIRY_REFRESH_GAP);
        return $this->refresh_access_token();
    }

    /**
     * Consecutive refreshes the API refused (HTTP 400 or 401 from /oauth/token:
     * the client or the refresh token is no longer accepted). Network errors
     * and API outages never count. Reset by any successful refresh or code
     * exchange. /status reads it to tell a broken link from a passing error.
     */
    const REFRESH_REJECTIONS = 'webmaven_wp_refresh_rejections';

    /**
     * Consecutive connection checks (/status) the API refused with a token that
     * had not expired. Reset by a successful check and by fresh tokens.
     */
    const CONNECTION_REJECTIONS = 'webmaven_wp_connection_rejections';

    private function do_refresh_access_token() {
        WebMaven_Log::write('WebMaven WordPress: Attempting token refresh');

        $response = wp_remote_post($this->api_base_url . '/oauth/token', array(
            'headers' => array(
                'Content-Type' => 'application/json',
            ),
            'body' => json_encode(array(
                'grant_type' => 'refresh_token',
                'client_id' => $this->client_id,
                'client_secret' => $this->client_secret,
                'refresh_token' => $this->refresh_token
            )),
            'timeout' => 30
        ));

        if (is_wp_error($response)) {
            WebMaven_Log::write('WebMaven WordPress: Token refresh WP error: ' . $response->get_error_message());
            $this->last_response_code = 0;
            return false;
        }

        $status_code = wp_remote_retrieve_response_code($response);
        $this->last_response_code = $status_code;
        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        WebMaven_Log::write('WebMaven WordPress: Token refresh response status: ' . $status_code);

        // Check if tokens are in the response directly or nested in a 'data' object
        // API returns: { success: true, data: { access_token, refresh_token, ... } }
        $tokens = $data;
        if (isset($data['data']) && is_array($data['data'])) {
            $tokens = $data['data'];
        }

        if (isset($tokens['access_token']) && isset($tokens['refresh_token'])) {
            // SECURITY: Store tokens encrypted
            $this->store_tokens($tokens['access_token'], $tokens['refresh_token']);
            WebMaven_Log::write('WebMaven WordPress: Token refresh successful');
            return true;
        }

        if ($status_code === 400 || $status_code === 401) {
            update_option(self::REFRESH_REJECTIONS, (int) get_option(self::REFRESH_REJECTIONS, 0) + 1, false);
        }
        WebMaven_Log::write('WebMaven WordPress: Token refresh failed - invalid response format');
        return false;
    }

    /**
     * SECURITY: Store OAuth tokens encrypted in database.
     */
    private function store_tokens($access_token, $refresh_token) {
        update_option('webmaven_wp_access_token',
            WebMaven_WP_Error_Handler::encrypt_data($access_token));
        update_option('webmaven_wp_refresh_token',
            WebMaven_WP_Error_Handler::encrypt_data($refresh_token));
        $this->access_token = $access_token;
        $this->refresh_token = $refresh_token;
        // Fresh tokens: the link works, and the connection check reads again.
        update_option(self::REFRESH_REJECTIONS, 0, false);
        update_option(self::CONNECTION_REJECTIONS, 0, false);
        delete_transient(self::CONNECTION_CACHE);
    }

    /**
     * Exchange authorization code for access token
     */
    public function exchange_authorization_code($authorization_code) {
        if (empty($this->client_id) || empty($this->client_secret)) {
            return array('success' => false, 'error' => 'OAuth credentials not configured');
        }

        $url = $this->api_base_url . '/oauth/token';
        $body_data = array(
            'grant_type' => 'authorization_code',
            'client_id' => $this->client_id,
            'client_secret' => $this->client_secret,
            'code' => $authorization_code,
            'scope' => 'read write conversations files'
        );

        $response = wp_remote_post($url, array(
            'headers' => array(
                'Content-Type' => 'application/json',
            ),
            'body' => json_encode($body_data),
            'timeout' => 30
        ));

        if (is_wp_error($response)) {
            return array('success' => false, 'error' => $response->get_error_message());
        }

        $status_code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        // Check if tokens are in the response directly or nested in a 'data' object
        $tokens = $data;
        if (isset($data['data']) && is_array($data['data'])) {
            $tokens = $data['data'];
        }

        if (isset($tokens['access_token']) && isset($tokens['refresh_token'])) {
            // SECURITY: Store tokens encrypted
            $this->store_tokens($tokens['access_token'], $tokens['refresh_token']);
            return array('success' => true, 'data' => $tokens);
        }

        return array('success' => false, 'error' => 'Failed to exchange authorization code');
    }
    
    /**
     * Test API connectivity with the site's own route (1.2.9). It asked
     * GET /instances, which takes dashboard sign-ins only, so it always
     * answered 401.
     */
    public function test_connection() {
        return $this->make_request('/sites/me/plan');
    }
    
    /**
     * Create a new conversation
     */
    public function create_conversation($title, $initial_message = null, $client_type = null, $editor_kind = null) {
        $data = array(
            'title' => $title
        );

        if ($initial_message) {
            $data['initialMessage'] = $initial_message;
        }

        if ($client_type) {
            $data['clientType'] = $client_type;
        }
        // The editor's chat of one editor (2026-10-18): post or product; none is the page editor's.
        if ($editor_kind) {
            $data['editorKind'] = $editor_kind;
        }

        return $this->make_request('/conversations', 'POST', $data);
    }
    
    /**
     * Send a message to the conversation
     */
    public function send_message($conversation_id, $content, $metadata = array()) {
        $data = array(
            'content' => $content,
            'metadata' => array_merge(array(
                'platform' => 'wordpress',
                'version' => get_bloginfo('version'),
                'theme' => get_template()
            ), $metadata)
        );
        
        return $this->make_request(
            '/conversations/' . $conversation_id . '/messages',
            'POST',
            $data
        );
    }
    
    /**
     * Get conversation history
     */
    public function get_conversation($conversation_id) {
        return $this->make_request('/conversations/' . $conversation_id);
    }
    
    /**
     * List all conversations
     */
    public function list_conversations($page = 1, $limit = 10, $client_type = null, $editor_kind = null) {
        WebMaven_Log::write("WebMaven_WP_API_Client: list_conversations called with page=$page, limit=$limit, clientType=" . ($client_type ?: 'null'));
        $params = ['page' => $page, 'limit' => $limit];
        if ($client_type) {
            $params['clientType'] = $client_type;
        }
        if ($editor_kind) {
            $params['editorKind'] = $editor_kind;
        }
        return $this->make_request('/conversations', 'GET', null, $params);
    }

    /**
     * Get the latest conversation
     */
    public function get_latest_conversation($client_type = null, $editor_kind = null) {
        $path = '/conversations/latest';
        $query = [];
        if ($client_type) {
            $query['clientType'] = $client_type;
        }
        if ($editor_kind) {
            $query['editorKind'] = $editor_kind;
        }
        if ($query) {
            $path .= '?' . http_build_query($query);
        }
        return $this->make_request($path);
    }
    
    // 1.2.9: upload_file, get_files (/conversations/:id/files),
    // process_ai_request (/agent/process) and search_code (/rag/search) are
    // gone. The API has none of those routes; every call answered 404.

    /**
     * Get the HTTP status code from the last API request.
     * Returns 0 if the request failed at the network level (timeout, unreachable, etc.)
     */
    public function get_last_response_code() {
        return $this->last_response_code;
    }

    /**
     * The body of the last API answer, exactly as the API sent it ('' after a
     * network failure). Never logged.
     */
    public function get_last_response_body() {
        return $this->last_response_body;
    }

    /** Transient that holds the last connection check for a few minutes (1.2.9). */
    const CONNECTION_CACHE = 'webmaven_wp_connection_check';

    /**
     * Ask the API whether it still accepts this site, and what its business
     * is: GET /sites/me, the site state (2026-10-05; GET /sites/me/plan since
     * 1.2.9, and /auth/me before that, which takes dashboard sign-ins only).
     * This check never refreshes a token the API refuses: the WP-admin screen
     * polls /status, and a poll must not rotate anything. It does refresh a
     * token that has only expired (read_refreshing_expired). A successful answer also
     * names the plan for the WP-admin sidebar (state.plan.name). It is never
     * passed to remember_plan_name(): it carries no brand, which the brand
     * would read as WPMaven's, so a White label site keeps its own hourly
     * plan read for that (WebMaven_Brand::maybe_refresh).
     *
     * @param int $timeout seconds
     * @return array make_request's result (success, data, status_code, error).
     */
    public function check_site_connection($timeout = 15) {
        $response = $this->read_refreshing_expired('/sites/me', (int) $timeout);
        if (!empty($response['success']) && isset($response['data']['plan']['name']) && is_string($response['data']['plan']['name'])) {
            $name = trim(wp_strip_all_tags($response['data']['plan']['name']));
            if ($name !== '') {
                set_transient('webmaven_user_plan', function_exists('mb_substr') ? mb_substr($name, 0, 60) : substr($name, 0, 60), DAY_IN_SECONDS);
            }
        }
        return $response;
    }

    // 1.2.9: get_websocket_config() is gone. It put the raw access token in a
    // plain websocket URL ending in /ws?token= for the browser (and in the PHP
    // log); the API has no /ws route and nothing in the UI read it.

    /**
     * Check if API is configured
     */
    public function is_configured() {
        return !empty($this->client_id) && !empty($this->client_secret) && !empty($this->access_token);
    }
    
    /**
     * Get configuration status
     */
    public function get_config_status() {
        return array(
            'api_url' => !empty($this->api_base_url),
            'client_id' => !empty($this->client_id),
            'client_secret' => !empty($this->client_secret),
            'access_token' => !empty($this->access_token),
            'refresh_token' => !empty($this->refresh_token)
        );
    }

    /**
     * The owner's plan as this site may read it: plan, status, period, usage
     * and the footer badge decision (data.badge.showBadge / aiMarking).
     *
     * GET /sites/me/plan takes this site's own OAuth token. It used to call
     * GET /payments/subscription, which takes dashboard sign-ins only, so
     * every call answered 401: the badge never showed and the WP-admin plan
     * stayed blank (API prod check M5, 2026-09-27).
     */
    public function get_subscription_info() {
        return $this->make_request('/sites/me/plan');
    }

    /**
     * Keep the plan's name for the WP-admin sidebar (the webmaven_user_plan
     * transient, read on every WP-admin page load) from a /sites/me/plan
     * answer. Every successful plan read calls this: the hourly badge read
     * and the settings screen, so the sidebar is filled without the owner
     * ever opening Settings. The customer's name for the plan ("Operator",
     * "White label") when the API sends it, else the plan code.
     *
     * @param mixed $data The `data` of a successful /sites/me/plan answer.
     */
    public static function remember_plan_name($data) {
        if (!is_array($data)) {
            return;
        }
        // The same answer says whose brand the site carries (1.2.31): every
        // successful plan read keeps it for the WP-admin screens.
        if (class_exists('WebMaven_Brand')) {
            WebMaven_Brand::remember($data);
        }
        $name = $data['planName'] ?? ($data['subscription']['plan'] ?? ($data['plan'] ?? null));
        if (is_string($name) && $name !== '') {
            set_transient('webmaven_user_plan', $name, DAY_IN_SECONDS);
        }
    }

    /**
     * Get SSE configuration for real-time updates.
     * SECURITY: No longer returns token - use get_sse_ticket() instead.
     */
    public function get_sse_config() {
        // Get Browser API base URL (for browser connections)
        $browser_api_url = WEBMAVEN_WP_BROWSER_API_BASE_URL;

        // Build SSE URL (without token - ticket will be added separately)
        $sse_url = rtrim($browser_api_url, '/') . '/agent/sse';

        return array(
            'url' => $sse_url,
            'reconnect_interval' => 5000,
            'max_reconnect_attempts' => 10
        );
    }

    /**
     * SECURITY: Get a short-lived SSE ticket from the API.
     * This keeps the JWT server-side - only a 30-second single-use ticket is exposed to frontend.
     *
     * @param string $conversation_id The conversation ID for the SSE connection
     * @param string|null $instance_id Optional instance ID
     * @return array Result with ticket or error
     */
    public function get_sse_ticket($conversation_id, $instance_id = null) {
        if (empty($this->access_token)) {
            return array(
                'success' => false,
                'error' => 'Not authenticated'
            );
        }

        $data = array(
            'conversationId' => $conversation_id
        );

        if ($instance_id) {
            $data['instanceId'] = $instance_id;
        }

        $response = $this->make_request('/agent/sse/ticket', 'POST', $data);

        // The SSE ticket is a short-lived stream credential and never goes to
        // the PHP error log; make_request already logs the response status.

        // make_request already unwraps data, so ticket is at $response['data']['ticket']
        if ($response['success'] && isset($response['data']['ticket'])) {
            return array(
                'success' => true,
                'ticket' => $response['data']['ticket'],
                'expiresIn' => $response['data']['expiresIn'] ?? 30
            );
        }

        // Log the full error for debugging
        $error_msg = 'Failed to get SSE ticket';
        if (isset($response['error'])) {
            $error_msg = $response['error'];
        } elseif (isset($response['data']['error'])) {
            $error_msg = $response['data']['error'];
        } elseif (isset($response['data']) && is_string($response['data'])) {
            $error_msg = $response['data'];
        }
        WebMaven_Log::write('WebMaven API Client: SSE ticket error: ' . $error_msg);

        // The API's status travels with the error (1.2.9): it used to be lost,
        // so every refusal reached the browser as a 500.
        return array(
            'success' => false,
            'error' => $error_msg,
            'status_code' => (int) ($response['status_code'] ?? 0) ?: 502,
        );
    }
}
