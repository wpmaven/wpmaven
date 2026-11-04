<?php
/**
 * WPForms Metrics Adapter
 * Collects submission counts from the wpforms_entries table.
 */

if (!defined('ABSPATH')) exit;

class WebMaven_WPForms_Metrics implements WebMaven_Metrics_Adapter {

    public function get_source(): string {
        return 'forms';
    }

    public function get_daily_metrics(string $date): array {
        global $wpdb;

        $table = $wpdb->prefix . 'wpforms_entries';
        $start = $date . ' 00:00:00';
        $end   = $date . ' 23:59:59';

        // Check if table exists
        if ($wpdb->get_var("SHOW TABLES LIKE '{$table}'") !== $table) {
            return [
                'period'           => $date,
                'plugin'           => 'wpforms',
                'totalSubmissions' => 0,
                'byForm'           => [],
                'trend'            => ['vs7dayAvg' => null],
                'note'             => 'WPForms entries table not found (Lite version does not store entries)',
            ];
        }

        $results = $wpdb->get_results($wpdb->prepare(
            "SELECT e.form_id, COUNT(*) AS submissions
             FROM {$table} e
             WHERE e.date >= %s AND e.date <= %s
               AND e.status = 'publish'
             GROUP BY e.form_id
             ORDER BY submissions DESC",
            $start, $end
        ));

        $by_form = [];
        $total = 0;
        foreach ($results ?: [] as $row) {
            $form = wpforms()->form->get((int) $row->form_id);
            $by_form[] = [
                'name'        => $form ? $form->post_title : "Form #{$row->form_id}",
                'formId'      => (int) $row->form_id,
                'submissions' => (int) $row->submissions,
            ];
            $total += (int) $row->submissions;
        }

        return [
            'period'           => $date,
            'plugin'           => 'wpforms',
            'totalSubmissions' => $total,
            'byForm'           => $by_form,
            'trend'            => $this->get_trend($date, $total, $table),
        ];
    }

    private function get_trend(string $date, int $today_total, string $table): array {
        global $wpdb;

        $ts = strtotime($date);
        $week_start = gmdate('Y-m-d', $ts - (7 * DAY_IN_SECONDS)) . ' 00:00:00';
        $week_end   = gmdate('Y-m-d', $ts - DAY_IN_SECONDS) . ' 23:59:59';

        $week_total = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$table} WHERE date >= %s AND date <= %s AND status = 'publish'",
            $week_start, $week_end
        ));

        $avg = $week_total / 7;
        return [
            'vs7dayAvg' => $avg > 0 ? round($today_total / $avg, 2) : null,
        ];
    }
}
