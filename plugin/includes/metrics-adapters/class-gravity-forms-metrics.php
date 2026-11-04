<?php
/**
 * Gravity Forms Metrics Adapter
 * Collects submission counts via GFAPI.
 */

if (!defined('ABSPATH')) exit;

class WebMaven_GravityForms_Metrics implements WebMaven_Metrics_Adapter {

    public function get_source(): string {
        return 'forms';
    }

    public function get_daily_metrics(string $date): array {
        $forms = \GFAPI::get_forms(true); // active forms only
        $by_form = [];
        $total = 0;

        foreach ($forms as $form) {
            $search = [
                'status'        => 'active',
                'field_filters' => [],
            ];
            $entries = \GFAPI::get_entries($form['id'], $search, null, [
                'offset'    => 0,
                'page_size' => 0, // just count
            ], $count);

            // Filter to date range manually via date_created
            $day_count = 0;
            $day_entries = \GFAPI::get_entries($form['id'], $search);
            foreach ($day_entries as $entry) {
                $entry_date = substr($entry['date_created'] ?? '', 0, 10);
                if ($entry_date === $date) {
                    $day_count++;
                }
            }

            if ($day_count > 0) {
                $by_form[] = [
                    'name'        => $form['title'],
                    'formId'      => (int) $form['id'],
                    'submissions' => $day_count,
                ];
                $total += $day_count;
            }
        }

        return [
            'period'           => $date,
            'plugin'           => 'gravity-forms',
            'totalSubmissions' => $total,
            'byForm'           => $by_form,
            'trend'            => ['vs7dayAvg' => null], // GF doesn't have efficient date-range queries
        ];
    }
}
