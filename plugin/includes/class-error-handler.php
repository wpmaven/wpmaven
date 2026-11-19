<?php
/**
 * The connection's secrets, encrypted at rest, and the security events the
 * plugin logs.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-webmaven-log.php';

class WebMaven_WP_Error_Handler {

    /**
     * Log security event
     */
    public static function log_security_event($event, $details = array()) {
        $log_entry = array(
            'timestamp' => current_time('mysql'),
            'user_id' => get_current_user_id(),
            'ip_address' => self::get_client_ip(),
            'user_agent' => sanitize_text_field(wp_unslash((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''))),
            'event' => $event,
            'details' => $details
        );
        
        WebMaven_Log::write('WebMaven WordPress Security Event: ' . json_encode($log_entry));
    }
    
    /**
     * Get client IP address
     */
    private static function get_client_ip() {
        $ip_keys = array('HTTP_CLIENT_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR');
        
        foreach ($ip_keys as $key) {
            if (array_key_exists($key, $_SERVER) === true) {
                foreach (explode(',', sanitize_text_field(wp_unslash((string) $_SERVER[$key]))) as $ip) {
                    $ip = trim($ip);
                    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false) {
                        return $ip;
                    }
                }
            }
        }
        
        return sanitize_text_field(wp_unslash((string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0')));
    }

    /**
     * SECURITY: Encrypt sensitive data using AES-256-GCM with random IV.
     * Format: base64(iv + tag + ciphertext)
     */
    public static function encrypt_data($data) {
        if (empty($data)) {
            return '';
        }

        $key = hash('sha256', wp_salt('AUTH_KEY'), true); // 32 bytes for AES-256
        $iv = random_bytes(12); // 12 bytes for GCM

        $ciphertext = openssl_encrypt(
            $data,
            'AES-256-GCM',
            $key,
            OPENSSL_RAW_DATA,
            $iv,
            $tag,      // Authentication tag (output)
            '',        // AAD (none)
            16         // Tag length
        );

        if ($ciphertext === false) {
            return '';
        }

        // Format: base64(iv + tag + ciphertext)
        return base64_encode($iv . $tag . $ciphertext);
    }

    /**
     * SECURITY: Decrypt sensitive data using AES-256-GCM.
     * Also supports legacy AES-256-CBC format for backward compatibility.
     */
    public static function decrypt_data($encrypted_data) {
        if (empty($encrypted_data)) {
            return '';
        }

        $key = hash('sha256', wp_salt('AUTH_KEY'), true);
        $decoded = base64_decode($encrypted_data);

        if ($decoded === false) {
            return '';
        }

        // Try GCM format first (12 IV + 16 tag + ciphertext = minimum 28 bytes)
        if (strlen($decoded) >= 28) {
            $iv = substr($decoded, 0, 12);
            $tag = substr($decoded, 12, 16);
            $ciphertext = substr($decoded, 28);

            $plaintext = openssl_decrypt( // nosemgrep: php.lang.security.audit.openssl-decrypt-validate.openssl-decrypt-validate (false is handled just below, spelled !== false)
                $ciphertext,
                'AES-256-GCM',
                $key,
                OPENSSL_RAW_DATA,
                $iv,
                $tag
            );

            if ($plaintext !== false) {
                return $plaintext;
            }
        }

        // Fallback to legacy CBC format for backward compatibility
        $legacy_key = wp_salt('AUTH_KEY');
        $legacy_iv = substr($legacy_key, 0, 16);
        $plaintext = openssl_decrypt( // nosemgrep: php.lang.security.audit.openssl-decrypt-validate.openssl-decrypt-validate (false is handled just below, spelled !== false)
            $decoded,
            'AES-256-CBC',
            $legacy_key,
            OPENSSL_RAW_DATA,
            $legacy_iv
        );

        if ($plaintext !== false) {
            return $plaintext;
        }

        // Try legacy format without OPENSSL_RAW_DATA flag
        $plaintext = openssl_decrypt( // nosemgrep: php.lang.security.audit.openssl-decrypt-validate.openssl-decrypt-validate (false is handled just below, spelled !== false)
            base64_decode($encrypted_data),
            'AES-256-CBC',
            $legacy_key,
            0,
            $legacy_iv
        );

        return $plaintext !== false ? $plaintext : '';
    }
}
