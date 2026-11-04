<?php
/**
 * The site's mail, as WPMaven reads it: whether an SMTP plugin delivers it,
 * and the month's email being used up (429 SITE_MAIL_MONTHLY_CAP), which the
 * account's reply route and WPMaven Agent's mail relay both answer.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Site_Mail {

    /** Constants defined by SMTP plugins that take over delivery themselves. */
    const SMTP_PLUGIN_CONSTANTS = ['WPMS_PLUGIN_VER', 'FLUENTMAIL_PLUGIN_VERSION', 'POST_SMTP_VER'];

    /** The API's answer when the site's email for this month is used. */
    const MONTHLY_CAP_CODE = 'SITE_MAIL_MONTHLY_CAP';

    /** The cap the mail relay last met: {resets_at, shown_on}. */
    const CAP_OPTION = 'webmaven_wp_mail_cap';

    /** Without a reset date from the API, the notice stops after this long. */
    const CAP_FALLBACK_SECONDS = 2678400; // 31 days

    public static function smtp_plugin_active() {
        foreach (self::SMTP_PLUGIN_CONSTANTS as $constant) {
            if (defined($constant)) {
                return true;
            }
        }
        return false;
    }

    public static function response_status($response) {
        return is_array($response) && isset($response['status_code']) ? (int) $response['status_code'] : 0;
    }

    public static function response_code($response) {
        if (is_array($response) && isset($response['data']) && is_array($response['data']) && isset($response['data']['code'])) {
            return (string) $response['data']['code'];
        }
        if (is_array($response) && isset($response['code']) && is_string($response['code'])) {
            return $response['code'];
        }
        return '';
    }

    /** 429 SITE_MAIL_MONTHLY_CAP: the site's email for this month is used (not a brief limit). */
    public static function is_monthly_cap($response) {
        return self::response_status($response) === 429 && self::response_code($response) === self::MONTHLY_CAP_CODE;
    }

    /** When the month starts over, from the API's resetsAt (unix time), or 0 when it sent none that reads. */
    public static function cap_resets_at($response) {
        $raw = '';
        if (is_array($response) && isset($response['data']) && is_array($response['data']) && isset($response['data']['resetsAt'])) {
            $raw = $response['data']['resetsAt'];
        } elseif (is_array($response) && isset($response['resetsAt'])) {
            $raw = $response['resetsAt'];
        }
        $ts = is_string($raw) && $raw !== '' ? strtotime($raw) : false;
        return $ts !== false && $ts > 0 ? (int) $ts : 0;
    }

    /** The remembered cap, or null (none, or its month is over: then it is removed). */
    public static function cap_state() {
        $state = get_option(self::CAP_OPTION, null);
        if (!is_array($state) || empty($state['resets_at'])) {
            return null;
        }
        if ((int) $state['resets_at'] <= time()) {
            delete_option(self::CAP_OPTION);
            return null;
        }
        return ['resets_at' => (int) $state['resets_at'], 'shown_on' => isset($state['shown_on']) ? (string) $state['shown_on'] : ''];
    }

    /** "October 28" (with the year when it is not this year's), in the site's own time zone. */
    public static function cap_reset_day($resets_at) {
        $format = gmdate('Y', (int) $resets_at) === gmdate('Y') ? 'F j' : 'F j, Y';
        if (function_exists('wp_date')) {
            $day = wp_date($format, (int) $resets_at);
            if (is_string($day) && $day !== '') {
                return $day;
            }
        }
        return gmdate($format, (int) $resets_at);
    }

    /** The notice's sentence, word for word. */
    public static function cap_notice_text($resets_at) {
        // The brand's name, or "your dashboard" while it is unknown (1.2.31).
        $where = class_exists('WebMaven_Brand') ? WebMaven_Brand::name_or('your dashboard') : 'WPMaven';
        return "This site's email for this month is used. Email resumes on " . self::cap_reset_day($resets_at) . '. Upgrade in ' . $where . ' for more.';
    }
}
