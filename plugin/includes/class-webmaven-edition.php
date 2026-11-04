<?php
/**
 * Which WPMaven runs here, for the API: WPMaven from WordPress.org alone
 * ('wpmaven'), with WPMaven Agent ('wpmaven+agent'), or the single plugin
 * hosted and older sites run ('full'). With what this site cannot do
 * without Agent, so the API's team never offers it here (the tool catalog
 * reads this report from the ping answer).
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-webmaven-requires-agent.php';

final class WebMaven_Edition {

    /** 'wpmaven', 'wpmaven+agent' or 'full' (WPMaven Agent answers webmaven_edition). */
    public static function name(): string {
        $name = function_exists('apply_filters') ? apply_filters('webmaven_edition', 'wpmaven') : 'wpmaven';
        return in_array($name, ['wpmaven', 'wpmaven+agent', 'full'], true) ? $name : 'wpmaven';
    }

    public static function has_agent(): bool {
        return self::name() !== 'wpmaven';
    }

    /** The report: edition, Agent's version, and the actions that need Agent here. */
    public static function report(): array {
        $agent = self::has_agent();
        $version = function_exists('apply_filters') ? apply_filters('webmaven_agent_version', null) : null;
        return [
            'edition' => self::name(),
            'agentVersion' => $agent && is_string($version) && $version !== '' ? $version : null,
            // Every action and command only WPMaven Agent runs, and whether
            // names WordPress's REST API takes reach its fallback; empty with Agent.
            'requiresAgent' => $agent ? [] : array_values(WebMaven_Requires_Agent::NAMES),
            'restFallback' => $agent,
        ];
    }
}
