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
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) !== $table) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- whether LatePoint's table exists, which no WordPress function tells; asked once per report
            return ['period' => $date, 'plugin' => 'latepoint', 'error' => 'Table not found'];
        }

        $stats = $wpdb->get_results($wpdb->prepare( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- read-only counts from LatePoint's own tables, which no WordPress function reads; read for the reports, which need today's figures, so nothing is cached
            "SELECT status, COUNT(*) AS count
             FROM %i
             WHERE start_date = %s
             GROUP BY status",
            $table, $date
        ));

        $by_status = [];
        $total = 0;
        foreach ($stats ?: [] as $row) {
            $by_status[$row->status] = (int) $row->count;
            $total += (int) $row->count;
        }

        // Revenue
        $revenue = (float) ($wpdb->get_var($wpdb->prepare( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- read-only counts from LatePoint's own tables, which no WordPress function reads; read for the reports, which need today's figures, so nothing is cached
            "SELECT COALESCE(SUM(price), 0) FROM %i
             WHERE start_date = %s AND status IN ('approved', 'completed')",
            $table, $date
        )) ?: 0);

        // Popular services
        $services_table = $wpdb->prefix . 'latepoint_services';
        $popular = [];
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($services_table))) === $services_table) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- whether LatePoint's table exists, which no WordPress function tells; asked once per report
            $popular = $wpdb->get_results($wpdb->prepare(
                "SELECT s.name, COUNT(*) AS count
                 FROM %i b
                 INNER JOIN %i s ON b.service_id = s.id
                 WHERE b.start_date = %s
                 GROUP BY b.service_id
                 ORDER BY count DESC
                 LIMIT 5",
                $table, $services_table, $date
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
