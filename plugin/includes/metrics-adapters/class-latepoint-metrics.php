<?php
/**
 * LatePoint Metrics Adapter
 * Queries LatePoint custom tables.
 */

if (!defined('ABSPATH')) exit;

class WebMaven_LatePoint_Metrics implements WebMaven_Metrics_Adapter {

    public function get_source(): string {
        return 'bookings';
    }

    public function get_daily_metrics(string $date): array {
        global $wpdb;

        $table = $wpdb->prefix . 'latepoint_bookings';
        if ($wpdb->get_var("SHOW TABLES LIKE '{$table}'") !== $table) {
            return ['period' => $date, 'plugin' => 'latepoint', 'error' => 'Table not found'];
        }

        $stats = $wpdb->get_results($wpdb->prepare(
            "SELECT status, COUNT(*) AS count
             FROM {$table}
             WHERE start_date = %s
             GROUP BY status",
            $date
        ));

        $by_status = [];
        $total = 0;
        foreach ($stats ?: [] as $row) {
            $by_status[$row->status] = (int) $row->count;
            $total += (int) $row->count;
        }

        // Revenue
        $revenue = (float) ($wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(price), 0) FROM {$table}
             WHERE start_date = %s AND status IN ('approved', 'completed')",
            $date
        )) ?: 0);

        // Popular services
        $services_table = $wpdb->prefix . 'latepoint_services';
        $popular = [];
        if ($wpdb->get_var("SHOW TABLES LIKE '{$services_table}'") === $services_table) {
            $popular = $wpdb->get_results($wpdb->prepare(
                "SELECT s.name, COUNT(*) AS count
                 FROM {$table} b
                 INNER JOIN {$services_table} s ON b.service_id = s.id
                 WHERE b.start_date = %s
                 GROUP BY b.service_id
                 ORDER BY count DESC
                 LIMIT 5",
                $date
            )) ?: [];
        }

        return [
            'period'          => $date,
            'plugin'          => 'latepoint',
            'totalBookings'   => $total,
            'byStatus'        => $by_status,
            'revenue'         => round($revenue, 2),
            'popularServices' => array_map(function($r) {
                return ['name' => $r->name, 'count' => (int) $r->count];
            }, $popular),
        ];
    }
}
