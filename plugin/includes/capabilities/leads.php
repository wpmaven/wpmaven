<?php
/**
 * Messages commands for the API (2026-10-05): the form messages the site
 * keeps (WebMaven_Leads), read live by the dashboard's Messages. The API
 * never caches them and keeps no copy.
 *
 *   leads_list    {page, per_page (1 to 50, default 25), status, form ("<source>:<formId>"), search,
 *                  kind ('conversation'|'signup'), period | after/before (local days)} -> LeadsPage (+ period)
 *   leads_stats   {period | after/before}                -> LeadsStats (numbers only) + period
 *   lead_read     {lead_id, mark_seen (default true)}  -> {lead: Lead}
 *   lead_update   {lead_id, status?, note?}            -> {lead: Lead}
 *   lead_reply    {lead_id, subject, body}             -> {sent: true, via: 'relay'|'site', lead: Lead}
 *   leads_export  {from?, to? (days), status?}         -> {filename, csv, rows} (UTF-8 with BOM, formula cells escaped)
 *   lead_delete   {lead_id}                            -> {deleted: true}
 *
 * Failures THROW an Exception "CODE: sentence" (the API reads
 * ^([A-Z_]+):\s*(.*)$ and may show the sentence to the owner): NOT_FOUND,
 * VALIDATION, RATE_LIMITED, MAIL_FAILED, WRITE_FAILED. What the dashboard
 * does shows in a message's timeline under the dashboard's name (actor 0),
 * not under the webhook's administrator. Registered through the filter, so
 * the execute_command bridge (webhook_<name>) cannot reach these.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!class_exists('WebMaven_Leads')) {
    require_once dirname(__DIR__) . '/class-webmaven-leads.php';
}
if (!class_exists('WebMaven_Store_Periods')) {
    require_once dirname(__DIR__) . '/class-webmaven-store-periods.php';
}

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['leads_list'] = ['WebMaven_Cap_Leads', 'leads_list'];
    $handlers['lead_read'] = ['WebMaven_Cap_Leads', 'lead_read'];
    $handlers['lead_update'] = ['WebMaven_Cap_Leads', 'lead_update'];
    $handlers['lead_reply'] = ['WebMaven_Cap_Leads', 'lead_reply'];
    $handlers['leads_export'] = ['WebMaven_Cap_Leads', 'leads_export'];
    $handlers['lead_delete'] = ['WebMaven_Cap_Leads', 'lead_delete'];
    $handlers['leads_stats'] = ['WebMaven_Cap_Leads', 'leads_stats'];
    return $handlers;
});

final class WebMaven_Cap_Leads {

    /** The dashboard: its actions carry no WordPress user. */
    const ACTOR = 0;

    public static function leads_list($params = [], $step_id = null) {
        $p = is_array($params) ? $params : [];
        $kind = $p['kind'] ?? '';
        if ($kind !== '' && !in_array($kind, WebMaven_Leads::KINDS, true)) {
            throw new Exception('VALIDATION: kind is conversation or signup.');
        }
        $period = WebMaven_Store_Periods::resolve($p);
        $page = WebMaven_Leads::list_page([
            'page' => $p['page'] ?? 1,
            'per_page' => $p['per_page'] ?? ($p['perPage'] ?? null),
            'status' => $p['status'] ?? '',
            'form' => $p['form'] ?? '',
            'search' => $p['search'] ?? '',
            'kind' => $kind,
            'since' => $period ? WebMaven_Store_Periods::utc_sql($period['from']) : '',
        ]);
        if ($period) {
            $page['period'] = WebMaven_Store_Periods::public_part($period);
        }
        return $page;
    }

    /** The messages of a period in numbers (the last 30 days when none is named). */
    public static function leads_stats($params = [], $step_id = null) {
        $p = is_array($params) ? $params : [];
        $period = WebMaven_Store_Periods::resolve($p) ?? WebMaven_Store_Periods::resolve(['period' => 'last_30_days']);
        $stats = WebMaven_Leads::stats(WebMaven_Store_Periods::utc_sql($period['from']), WebMaven_Store_Periods::utc_sql($period['to']));
        $stats['period'] = WebMaven_Store_Periods::public_part($period);
        return $stats;
    }

    public static function lead_read($params = [], $step_id = null) {
        $p = is_array($params) ? $params : [];
        return ['lead' => WebMaven_Leads::read(self::lead_id($p), self::flag($p['mark_seen'] ?? null, true), self::ACTOR)];
    }

    public static function lead_update($params = [], $step_id = null) {
        $p = is_array($params) ? $params : [];
        $patch = [];
        if (array_key_exists('status', $p)) {
            $patch['status'] = $p['status'];
        }
        if (array_key_exists('note', $p)) {
            $patch['note'] = $p['note'];
        }
        return ['lead' => WebMaven_Leads::update(self::lead_id($p), $patch, self::ACTOR)];
    }

    public static function lead_reply($params = [], $step_id = null) {
        $p = is_array($params) ? $params : [];
        return WebMaven_Leads::reply(self::lead_id($p), $p['subject'] ?? '', $p['body'] ?? '', self::ACTOR);
    }

    public static function leads_export($params = [], $step_id = null) {
        $p = is_array($params) ? $params : [];
        return WebMaven_Leads::export([
            'from' => $p['from'] ?? '',
            'to' => $p['to'] ?? '',
            'status' => $p['status'] ?? '',
        ], self::ACTOR);
    }

    public static function lead_delete($params = [], $step_id = null) {
        $p = is_array($params) ? $params : [];
        return WebMaven_Leads::delete(self::lead_id($p));
    }

    private static function lead_id(array $p) {
        $id = $p['lead_id'] ?? ($p['leadId'] ?? null);
        if (!is_numeric($id) || (int) $id <= 0) {
            throw new Exception('VALIDATION: Choose a message first.');
        }
        return (int) $id;
    }

    private static function flag($value, $default) {
        if ($value === null || $value === '') {
            return $default;
        }
        if (is_bool($value)) {
            return $value;
        }
        $parsed = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        return $parsed === null ? $default : $parsed;
    }
}
