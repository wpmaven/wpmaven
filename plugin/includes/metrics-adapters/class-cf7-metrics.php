<?php
/**
 * Contact Form 7 Metrics Adapter
 * Collects submission counts via Flamingo (if installed) or CF7 hooks.
 */

if (!defined('ABSPATH')) exit;

class WebMaven_CF7_Metrics implements WebMaven_Metrics_Adapter {

    public function get_source(): string {
        return 'forms';
    }

    public function get_daily_metrics(string $date): array {
        $start = $date . ' 00:00:00';
        $end   = $date . ' 23:59:59';

        $by_form = [];
        $total = 0;

        if (post_type_exists('flamingo_inbound')) {
            $by_form = $this->get_flamingo_submissions($start, $end);
            foreach ($by_form as $form) {
                $total += $form['submissions'];
            }
        }

        return [
            'period'           => $date,
            'plugin'           => 'contact-form-7',
            'totalSubmissions' => $total,
            'byForm'           => $by_form,
            'trend'            => $this->get_trend($date, $total),
        ];
    }

    private function get_flamingo_submissions(string $start, string $end): array {
        global $wpdb;

        $results = $wpdb->get_results($wpdb->prepare(
            "SELECT pm.meta_value AS channel,
                    COUNT(*) AS submissions
             FROM {$wpdb->posts} p
             INNER JOIN {$wpdb->postmeta} pm ON p.ID = pm.post_id AND pm.meta_key = '_channel'
             WHERE p.post_type = 'flamingo_inbound'
               AND p.post_date >= %s AND p.post_date <= %s
             GROUP BY pm.meta_value
             ORDER BY submissions DESC",
            $start, $end
        ));

        $forms = [];
        foreach ($results ?: [] as $row) {
            $forms[] = [
                'name'        => $row->channel ?: 'Unknown Form',
                'submissions' => (int) $row->submissions,
            ];
        }
        return $forms;
    }

    private function get_trend(string $date, int $today_total): array {
        if (!post_type_exists('flamingo_inbound')) {
            return ['vs7dayAvg' => null];
        }

        $ts = strtotime($date);
        $week_total = 0;
        for ($i = 1; $i <= 7; $i++) {
            $d = gmdate('Y-m-d', $ts - ($i * DAY_IN_SECONDS));
            $count = (int) (new \WP_Query([
                'post_type'      => 'flamingo_inbound',
                'date_query'     => [['after' => $d . ' 00:00:00', 'before' => $d . ' 23:59:59', 'inclusive' => true]],
                'posts_per_page' => -1,
                'fields'         => 'ids',
                'no_found_rows'  => true,
            ]))->post_count;
            $week_total += $count;
        }

        $avg = $week_total / 7;
        return [
            'vs7dayAvg' => $avg > 0 ? round($today_total / $avg, 2) : null,
        ];
    }
}
