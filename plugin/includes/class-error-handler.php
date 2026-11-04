<?php
/**
 * Error Handling and Security Class
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-webmaven-log.php';

class WebMaven_WP_Error_Handler {
    
    /**
     * Validate API response
     */
    public static function validate_api_response($response) {
        if (!is_array($response)) {
            return false;
        }
        
        if (!isset($response['success'])) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Sanitize input data
     */
    public static function sanitize_input($input) {
        if (is_array($input)) {
            return array_map(array(self::class, 'sanitize_input'), $input);
        }
        
        return sanitize_text_field($input);
    }
    
    /**
     * Validate file upload
     */
    public static function validate_file_upload($file_path) {
        // Check if file exists
        if (!file_exists($file_path)) {
            return array('success' => false, 'error' => 'File not found');
        }
        
        // Check file size (max 10MB)
        $max_size = 10 * 1024 * 1024; // 10MB
        if (filesize($file_path) > $max_size) {
            return array('success' => false, 'error' => 'File too large (max 10MB)');
        }
        
        // Check file extension
        // This path sends file CONTENTS off the site, so never allow PHP source (wp-config.php etc.) and
        // reject protected files by name, mirroring the signed-webhook blocklist.
        $blocked_files = array('wp-config.php', 'wp-config-sample.php', '.htaccess', '.env', 'php.ini', '.user.ini');
        if (in_array(strtolower(basename($file_path)), $blocked_files, true)) {
            return array('success' => false, 'error' => 'File is protected');
        }
        $allowed_extensions = array('css', 'js', 'json', 'txt', 'md', 'xml', 'html');
        $extension = strtolower(pathinfo($file_path, PATHINFO_EXTENSION));
        
        if (!in_array($extension, $allowed_extensions)) {
            return array('success' => false, 'error' => 'File type not allowed');
        }
        
        return array('success' => true);
    }
    
    /**
     * Rate limiting
     */
    public static function check_rate_limit($action, $limit = 10, $window = 3600) {
        $transient_key = 'webmaven_wp_rate_limit_' . $action . '_' . get_current_user_id();
        $requests = get_transient($transient_key);
        
        if ($requests === false) {
            set_transient($transient_key, 1, $window);
            return true;
        }
        
        if ($requests >= $limit) {
            return false;
        }
        
        set_transient($transient_key, $requests + 1, $window);
        return true;
    }
    
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
     * Validate OAuth credentials
     */
    public static function validate_oauth_credentials($client_id, $client_secret) {
        if (empty($client_id) || empty($client_secret)) {
            return false;
        }
        
        // Basic format validation
        if (strlen($client_id) < 10 || strlen($client_secret) < 10) {
            return false;
        }
        
        return true;
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
    
    /**
     * Validate conversation ID
     */
    public static function validate_conversation_id($conversation_id) {
        if (empty($conversation_id)) {
            return false;
        }
        
        // Check format (UUID v4)
        $pattern = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';
        return preg_match($pattern, $conversation_id);
    }
    
    /**
     * Sanitize file path
     */
    public static function sanitize_file_path($file_path) {
        // Remove any path traversal attempts
        $file_path = str_replace(array('../', '..\\'), '', $file_path);
        
        // Ensure path is within WordPress directory
        $wp_path = ABSPATH;
        $real_path = realpath($wp_path . $file_path);
        
        if ($real_path === false || strpos($real_path, $wp_path) !== 0) {
            return false;
        }
        
        return $file_path;
    }
    
    /**
     * Check user permissions
     */
    public static function check_user_permissions($capability = 'edit_posts') {
        if (!is_user_logged_in()) {
            return false;
        }
        
        if (!current_user_can($capability)) {
            self::log_security_event('insufficient_permissions', array(
                'capability' => $capability,
                'user_id' => get_current_user_id()
            ));
            return false;
        }
        
        return true;
    }
    
    /**
     * Validate nonce
     */
    public static function validate_nonce($nonce, $action = 'wp_rest') {
        if (!wp_verify_nonce($nonce, $action)) {
            self::log_security_event('invalid_nonce', array(
                'action' => $action,
                'nonce' => $nonce
            ));
            return false;
        }
        
        return true;
    }
    
    /**
     * Handle WordPress errors
     */
    public static function handle_wp_error($wp_error, $context = '') {
        if (is_wp_error($wp_error)) {
            $error_message = $wp_error->get_error_message();
            WebMaven_Log::write("WebMaven WordPress WordPress Error ({$context}): {$error_message}");
            
            return array(
                'success' => false,
                'error' => $error_message
            );
        }
        
        return array('success' => true);
    }
}
