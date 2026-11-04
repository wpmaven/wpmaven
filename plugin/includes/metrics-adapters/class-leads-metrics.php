<?php
/**
 * Form messages metrics (2026-10-05): the day's submissions counted from the
 * messages the site keeps itself ({prefix}wpmaven_leads, WebMaven_Leads),
 * which every form plugin feeds. WPForms Lite keeps no entries, so its own
 * adapter read 0 on every site that used it.
 *
 * The registry wraps the form plugin's adapter in this one. A day from the
 * first kept message on is counted from the table (spam left out); an
 * earlier day, or a site that kept none yet, is the form plugin's own count.
 * Only form titles and counts leave the site, never a message.
 */

if (!defined('ABSPATH')) exit;

class WebMaven_Leads_Metrics implements WebMaven_Metrics_Adapter {

    /** WebMaven_Leads::table() without the prefix, and its version option (this file may load first). */
    const TABLE = 'wpmaven_leads';
    const DB_VERSION_OPTION = 'webmaven_leads_db_version';

    /** The plugin slugs the other forms adapters report, by message source. */
    const PLUGINS = ['wpforms' => 'wpforms', 'cf7' => 'contact-form-7', 'gravityforms' => 'gravity-forms'];

    /** @var WebMaven_Metrics_Adapter|null */
    private $fallback;

    public function __construct($fallback = null) {
        $this->fallback = $fallback instanceof WebMaven_Metrics_Adapter ? $fallback : null;
    }

    public function get_source(): string {
        return 'forms';
    }

    public function get_daily_metrics(string $date): array {
        $first = $this->first_day();
        if ($first === null || $date < $first) {
            if ($this->fallback) {
                return $this->fallback->get_daily_metrics($date);
            }
            if ($first === null) {
                return $this->payload($date, 0, [], null, $this->latest_plugin());
            }
        }
        return $this->count_day($date);
    }

    /** The day (Y-m-d, UTC) of the oldest message kept, or null when none is. */
    private function first_day(): ?string {
        global $wpdb;
        if (!get_option(self::DB_VERSION_OPTION)) {
            return null;
        }
        $first = $wpdb->get_var($wpdb->prepare('SELECT MIN(created_at) FROM %i', $this->table()));
        return is_string($first) && $first !== '' ? substr($first, 0, 10) : null;
    }

    private function count_day(string $date): array {
        global $wpdb;
        $table = $this->table();
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT source, form_id, MAX(form_title) AS title, COUNT(*) AS submissions
             FROM {$table}
             WHERE created_at >= %s AND created_at <= %s AND status <> %s
             GROUP BY source, form_id
             ORDER BY submissions DESC",
            $date . ' 00:00:00',
            $date . ' 23:59:59',
            'spam'
        ), ARRAY_A);
        $by_form = [];
        $total = 0;
        $by_source = [];
        foreach ((array) $rows as $row) {
            $count = (int) $row['submissions'];
            $by_form[] = [
                'name' => (string) $row['title'] !== '' ? (string) $row['title'] : 'Form #' . (int) $row['form_id'],
                'formId' => (int) $row['form_id'],
                'submissions' => $count,
            ];
            $total += $count;
            $by_source[(string) $row['source']] = ($by_source[(string) $row['source']] ?? 0) + $count;
        }
        arsort($by_source);
        $plugin = $by_source ? (self::PLUGINS[(string) key($by_source)] ?? 'wpmaven') : $this->latest_plugin();

        $ts = strtotime($date . ' 00:00:00 UTC');
        $week = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$table} WHERE created_at >= %s AND created_at <= %s AND status <> %s",
            gmdate('Y-m-d', $ts - 7 * 86400) . ' 00:00:00',
            gmdate('Y-m-d', $ts - 86400) . ' 23:59:59',
            'spam'
        ));
        $avg = $week / 7;
        return $this->payload($date, $total, $by_form, $avg > 0 ? round($total / $avg, 2) : null, $plugin);
    }

    private function payload(string $date, int $total, array $by_form, $trend, string $plugin): array {
        return [
            'period' => $date,
            'plugin' => $plugin,
            'totalSubmissions' => $total,
            'byForm' => $by_form,
            'trend' => ['vs7dayAvg' => $trend],
        ];
    }

    /** The form plugin of the latest message, as the other adapters name it. */
    private function latest_plugin(): string {
        global $wpdb;
        if (!get_option(self::DB_VERSION_OPTION)) {
            return 'wpmaven';
        }
        $source = $wpdb->get_var($wpdb->prepare('SELECT source FROM %i ORDER BY id DESC LIMIT 1', $this->table()));
        return self::PLUGINS[(string) $source] ?? 'wpmaven';
    }

    private function table(): string {
        global $wpdb;
        return $wpdb->prefix . self::TABLE;
    }
}
