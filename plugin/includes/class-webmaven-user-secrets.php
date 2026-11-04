<?php
/**
 * WebMaven user-secret guard (2026-09-22, "Users + AI WP-CLI").
 *
 * One place that decides what user data may leave the site. Password hashes
 * (user_pass), the password-reset nonce (user_activation_key) and the login
 * session tokens are NEVER returned to the API — and therefore never reach the
 * AI model or the logs — no matter what a caller (or the LLM) asks for.
 *
 * Consumers:
 *  - WebMaven_WordPress_Commands::get_option() and the plugin API bridge
 *    (capabilities/plugin-api-bridge.php) pass every value through
 *    redact_option_value() / redact_value(): passwords, tokens, API keys and
 *    similar come back as "[redacted]", inside arrays and serialized strings.
 *  - WebMaven_WordPress_Commands::get_users() projects every result through
 *    redact_user(), so `fields => 'all'` (the default) can no longer serialize
 *    a WP_User whose public `data` carries user_pass / user_activation_key.
 *  - WPMaven Agent's WP-CLI validator
 *    refuses `db query` against the users/usermeta tables and any command
 *    naming a secret, with is_secret_name() from here.
 */

if (!defined('ABSPATH')) exit;

class WebMaven_User_Secrets {

    /**
     * The only user fields that may be returned. Deliberately excludes
     * user_pass, user_activation_key, session tokens, and application
     * passwords.
     */
    const SAFE_USER_FIELDS = [
        'ID',
        'user_login',
        'display_name',
        'user_email',
        'user_registered',
        'roles',
    ];

    /**
     * Reduce any get_users() row to the safe projection. Accepts a WP_User,
     * an stdClass from a partial-fields query, or an associative array; the
     * output only ever carries SAFE_USER_FIELDS, so a secret column that rode
     * along in the source object is dropped here.
     */
    public static function redact_user($user) {
        if ($user instanceof WP_User) {
            $roles = array_values((array) $user->roles);
        } elseif (is_object($user)) {
            $roles = isset($user->roles) ? array_values((array) $user->roles) : [];
        } elseif (is_array($user)) {
            $roles = isset($user['roles']) ? array_values((array) $user['roles']) : [];
        } else {
            return ['ID' => 0];
        }

        $get = static function ($obj, $key) {
            if (is_object($obj)) {
                return isset($obj->$key) ? $obj->$key : null;
            }
            if (is_array($obj)) {
                return array_key_exists($key, $obj) ? $obj[$key] : null;
            }
            return null;
        };

        return [
            'ID'              => (int) $get($user, 'ID'),
            'user_login'      => (string) $get($user, 'user_login'),
            'display_name'    => (string) $get($user, 'display_name'),
            'user_email'      => (string) $get($user, 'user_email'),
            'user_registered' => (string) $get($user, 'user_registered'),
            'roles'           => $roles,
        ];
    }

    /**
     * Resolve a caller-supplied get_users `fields` argument to the subset of
     * SAFE_USER_FIELDS to expose. No fields / 'all' / '*' means the full safe
     * projection; an explicit list is intersected with the whitelist so a
     * request for user_pass simply yields nothing extra. Never widens beyond
     * the whitelist.
     *
     * @return string[] a non-empty subset of SAFE_USER_FIELDS.
     */
    public static function safe_fields_subset($requested) {
        if ($requested === null || $requested === '' || $requested === 'all' || $requested === '*') {
            return self::SAFE_USER_FIELDS;
        }
        $list = is_array($requested)
            ? $requested
            : preg_split('/\s*,\s*/', (string) $requested, -1, PREG_SPLIT_NO_EMPTY);

        $safe = [];
        foreach ((array) $list as $field) {
            $field = trim((string) $field);
            if ($field === '') continue;
            foreach (self::SAFE_USER_FIELDS as $allowed) {
                if (strcasecmp($field, $allowed) === 0) {
                    $safe[] = $allowed;
                    break;
                }
            }
        }
        return empty($safe) ? self::SAFE_USER_FIELDS : $safe;
    }

    /**
     * Core WordPress secret/salt option names. On most installs these live in
     * wp-config.php as constants (get_option returns false), but they can be
     * stored as options, so they are refused defensively — same as the write
     * side already does.
     */
    const SECRET_OPTION_NAMES = [
        'auth_key', 'secure_auth_key', 'logged_in_key', 'nonce_key',
        'auth_salt', 'secure_auth_salt', 'logged_in_salt', 'nonce_salt',
        'secret',
    ];

    /**
     * Whether an option name is auth-related and must never be read back to the
     * API: the plugin's own OAuth credentials and tokens (the webmaven_wp_
     * prefix) and the core secret/salt options. The edge key/primary host are
     * handled separately (WebMaven_Hosting::EDGE_OPTIONS).
     */
    public static function is_secret_option($name) {
        if (!is_scalar($name)) {
            return false;
        }
        $n = strtolower(trim((string) $name));
        if ($n === '') {
            return false;
        }
        if (strpos($n, 'webmaven_wp_') === 0) {
            return true;
        }
        return in_array($n, self::SECRET_OPTION_NAMES, true);
    }

    // ── Secret values (2026-09-22) ──────────────────────────────────────────
    //
    // One detector for what may reach the AI: the plugin API bridge's answers
    // (capabilities/plugin-api-bridge.php) and get_option reads both use it.
    // Passwords, tokens, API keys and similar are replaced with "[redacted]",
    // found by the field's name (api_key, clientSecret...) or by the value's
    // shape (sk_live_..., whsec_..., a JWT, a PEM private key, Bearer ...).

    const REDACTED = '[redacted]';
    const MAX_DEPTH = 12;

    /** Field-name tokens that mark a secret. */
    const SECRET_TOKENS = [
        'pass', 'pwd', 'pin', 'key', 'keys', 'hash', 'salt', 'nonce', 'auth', 'authorization',
        'cookie', 'cookies', 'session', 'license', 'otp', 'private', 'sig', 'jwt', 'bearer',
        'cvv', 'cvc', 'ssn', 'secret', 'secrets', 'token', 'tokens', 'password', 'passwords',
    ];

    /**
     * wp-config constants that are credentials without looking like one:
     * DB_USER and DB_HOST are half of a direct MySQL connection (the password
     * is the other half, and is_secret_name already catches it).
     */
    const CONFIG_CREDENTIAL_CONSTANTS = ['db_user', 'db_host', 'db_password'];

    /** Substrings (of the name with separators removed) that mark a secret. */
    const SECRET_SUBSTRINGS = [
        'password', 'passwd', 'passphrase', 'secret', 'token', 'apikey', 'privatekey',
        'accesskey', 'authkey', 'credential', 'signature', 'licensekey',
    ];

    /** Values that are secrets by their shape, whatever the field is called. */
    const SECRET_VALUE_PATTERNS = [
        '/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/',
        '/\bwhsec_[A-Za-z0-9]{8,}/',
        '/\b(?:ck|cs)_[a-f0-9]{40}\b/',
        '/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/',
        '/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/',
        '/\bAKIA[0-9A-Z]{16}\b/',
        '/\bgh[pousr]_[A-Za-z0-9]{20,}/',
        '/\bxox[abprs]-[A-Za-z0-9-]{10,}/',
        '/\bBearer\s+[A-Za-z0-9._~+\/-]{16,}=*/i',
        // Database account passwords: a mysql_native_password hash (*<40 hex>,
        // what MariaDB's SHOW GRANTS prints), and the value after IDENTIFIED
        // BY [PASSWORD] / IDENTIFIED WITH <plugin> AS / IDENTIFIED VIA <plugin>
        // USING [PASSWORD(...)] in a grant, a CREATE/ALTER USER or a query text.
        '/(?<![A-Za-z0-9])\*[0-9A-Fa-f]{40}(?![A-Za-z0-9])/',
        '/\bIDENTIFIED\s+(?:BY|WITH|VIA)\b[^\'"]{0,120}?(?:\'[^\']*\'|"[^"]*")(?:\s*(?:AS|BY|USING)\s*(?:PASSWORD\s*\(\s*)?(?:\'[^\']*\'|"[^"]*"))?/i',
        // Password hashes in text (a users row printed by a WP-CLI command,
        // a log line): phpass ($P$ / $H$), bcrypt and WordPress 6.8's $wp$
        // prefix, argon2, sha-crypt and md5-crypt, MySQL 8's caching_sha2.
        '/\$[PH]\$[.\/0-9A-Za-z]{31}/',
        '/(?:\$wp)?\$2[aby]\$\d{2}\$[.\/0-9A-Za-z]{53}/',
        '/\$argon2(?:id|i|d)?\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+\/=]+\$[A-Za-z0-9+\/=]+/',
        '/\$[56]\$[^\s$\'"]{1,16}\$[.\/0-9A-Za-z]{43,86}/',
        '/\$1\$[^\s$\'"]{1,8}\$[.\/0-9A-Za-z]{22}/',
        '/\$A\$\d{3}\$[^\s\'"]{20,}/',
    ];

    /** A field name that marks a secret (api_key, clientSecret, password...). */
    public static function is_secret_name($name) {
        if (!is_string($name) || $name === '') {
            return false;
        }
        $snake = strtolower(preg_replace('/([a-z0-9])([A-Z])/', '$1_$2', $name));
        $flat = preg_replace('/[^a-z0-9]/', '', $snake);
        foreach (self::SECRET_SUBSTRINGS as $s) {
            if (strpos($flat, $s) !== false) {
                return true;
            }
        }
        foreach (preg_split('/[^a-z0-9]+/', $snake) as $token) {
            if ($token !== '' && in_array($token, self::SECRET_TOKENS, true)) {
                return true;
            }
        }
        return false;
    }

    /** Replace the secret parts of a string (text, HTML, JSON or serialized PHP). */
    public static function redact_string($s, &$count = 0) {
        $s = (string) $s;
        foreach (self::SECRET_VALUE_PATTERNS as $p) {
            $s = preg_replace($p, self::REDACTED, $s, -1, $n);
            $count += (int) $n;
        }
        // name=value / "name": "value" pairs in text (HTML, query strings, logs, JSON).
        $s = preg_replace_callback(
            '/((?:["\']?)[A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?key)[A-Za-z0-9_.-]*["\']?\s*(?:=|:|=>)\s*["\']?)([^"\'\s&<>,}]{3,})/i',
            function ($m) use (&$count) {
                $count++;
                return $m[1] . self::REDACTED;
            },
            $s
        );
        // A wp-config constant: define( 'DB_PASSWORD', '...' ) names its
        // constant with a COMMA, which the name=value rule above never
        // matched, and salts and passwords have no detectable shape. WPMaven
        // Agent's file reads refuse a copy of wp-config left in the webroot by
        // name; this is the second line, for config text that reaches the
        // model any other way (a theme that includes it, a log, a migration
        // file). The value is redacted to the
        // end of its line, so a quote or a semicolon inside it hides nothing.
        $s = preg_replace_callback(
            '/((?:define\s*\(\s*|const\s+)(["\']?)([A-Za-z_][A-Za-z0-9_]*)\2\s*(?:,|=)\s*)[^\r\n]*(\)?\s*;)/',
            function ($m) use (&$count) {
                if (!self::is_secret_name($m[3]) && !in_array(strtolower($m[3]), self::CONFIG_CREDENTIAL_CONSTANTS, true)) {
                    return $m[0];
                }
                $count++;
                return $m[1] . "'" . self::REDACTED . "'" . $m[4];
            },
            $s
        );
        // A PHP-serialized pair inside a string (settings serialized a second
        // time): s:10:"secret_key";s:6:"abc123"; keeps its name, loses its value.
        $s = preg_replace_callback(
            '/(s:\d+:"([^"]{1,200})";s:)\d+:"(.*?)";(?=[}sibdNaO]|$)/s',
            function ($m) use (&$count) {
                if ($m[3] === '' || $m[3] === self::REDACTED || !self::is_secret_name($m[2])) {
                    return $m[0];
                }
                $count++;
                return $m[1] . strlen(self::REDACTED) . ':"' . self::REDACTED . '";';
            },
            $s
        );
        return $s;
    }

    /**
     * Walk a value and replace its secrets: a field whose name looks secret,
     * the value of a { key|id|name: <secret-looking>, value } pair, and any
     * string that is a secret by its shape. true/false and null carry no
     * secret and are kept ("password_set": true is useful).
     */
    public static function redact_value($data, &$count = 0, $depth = 0) {
        if ($depth > self::MAX_DEPTH) {
            return '[truncated]';
        }
        if (is_object($data)) {
            $json = function_exists('wp_json_encode') ? wp_json_encode($data) : json_encode($data);
            $data = json_decode((string) $json, true);
        }
        if (is_string($data)) {
            return self::redact_string($data, $count);
        }
        if (!is_array($data)) {
            return $data;
        }
        // { key: "stripe_secret_key", value: "..." } style pairs.
        $pair_secret = false;
        foreach (['key', 'id', 'name', 'option', 'option_name', 'meta_key', 'setting', 'slug', 'field'] as $k) {
            if (isset($data[$k]) && is_string($data[$k]) && self::is_secret_name($data[$k])) {
                $pair_secret = true;
                break;
            }
        }
        $out = [];
        foreach ($data as $k => $v) {
            $name = is_string($k) ? $k : '';
            $is_pair_value = $pair_secret && in_array($name, ['value', 'default', 'current', 'val', 'data', 'option_value', 'meta_value', 'setting_value', 'placeholder'], true);
            // The name half of a { key, value } pair ("key": "api_key") is an
            // identifier, not a secret. A lone "key" field is redacted.
            $is_pair_name = in_array($name, ['key', 'meta_key'], true)
                && (array_key_exists('value', $data) || array_key_exists('meta_value', $data))
                && is_string($v) && strlen($v) <= 100 && preg_match('/^[A-Za-z0-9_.:\-\/ ]*$/', $v);
            $blank = $v === '' || $v === null || is_bool($v);
            if (($is_pair_value && !$blank) || ($name !== '' && !$is_pair_name && !$blank && self::is_secret_name($name))) {
                $out[$k] = self::REDACTED;
                $count++;
                continue;
            }
            $out[$k] = self::redact_value($v, $count, $depth + 1);
        }
        return $out;
    }

    /**
     * An option's value as it may leave the site: the whole value when the
     * option's own name looks secret (acme_api_key), else the value with its
     * secret fields and secret-shaped strings replaced, arrays and serialized
     * strings included (woocommerce_stripe_settings keeps "enabled" and
     * "title" and loses "secret_key").
     */
    public static function redact_option_value($name, $value, &$count = 0) {
        if ($value === '' || $value === null || is_bool($value) || $value === []) {
            return $value;
        }
        if (is_string($name) && self::is_secret_name($name)) {
            $count++;
            return self::REDACTED;
        }
        return self::redact_value($value, $count);
    }

    /**
     * Whether a value sent to the site carries the "[redacted]" placeholder.
     * Written back, it would replace a real secret the AI never saw.
     */
    public static function carries_redaction_marker($value, $depth = 0) {
        if ($depth > self::MAX_DEPTH) {
            return false;
        }
        if (is_string($value)) {
            return strpos($value, self::REDACTED) !== false;
        }
        if (is_object($value)) {
            $value = get_object_vars($value);
        }
        if (is_array($value)) {
            foreach ($value as $v) {
                if (self::carries_redaction_marker($v, $depth + 1)) {
                    return true;
                }
            }
        }
        return false;
    }
}
