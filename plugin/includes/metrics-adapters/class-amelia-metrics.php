<?php
/**
 * Amelia Booking Metrics Adapter
 * Collects appointment counts, revenue, no-shows, popular services.
 */

if (!defined('ABSPATH')) exit;

class WebMaven_Amelia_Metrics implements WebMaven_Metrics_Adapter {

    public function get_source(): string {
        return 'bookings';
    }

    public function get_daily_metrics(string $date): array {
        global $wpdb;

        $table = $wpdb->prefix . 'amelia_appointments';
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) !== $table) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- whether Amelia's table exists, which no WordPress function tells; asked once per report
            return ['period' => $date, 'plugin' => 'amelia', 'error' => 'Table not found'];
        }

        $start = $date . ' 00:00:00';
        $end   = $date . ' 23:59:59';

        // Appointment counts by status
        $stats = $wpdb->get_results($wpdb->prepare( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- read-only counts from Amelia's own tables, which no WordPress function reads; read for the reports, which need today's figures, so nothing is cached
            "SELECT status, COUNT(*) AS count
             FROM %i
             WHERE bookingStart >= %s AND bookingStart <= %s
             GROUP BY status",
            $table, $start, $end
        ));

        $by_status = [];
        $total = 0;
        $no_shows = 0;
        foreach ($stats ?: [] as $row) {
            $by_status[$row->status] = (int) $row->count;
            $total += (int) $row->count;
            if ($row->status === 'no-show') $no_shows = (int) $row->count;
        }

        // Revenue
        $payments_table = $wpdb->prefix . 'amelia_payments';
        $revenue = 0.0;
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($payments_table))) === $payments_table) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- whether Amelia's table exists, which no WordPress function tells; asked once per report
            $revenue = (float) ($wpdb->get_var($wpdb->prepare(
                "SELECT COALESCE(SUM(amount), 0) FROM %i
                 WHERE dateTime >= %s AND dateTime <= %s AND status = 'paid'",
                $payments_table, $start, $end
            )) ?: 0);
        }

        // Popular services
        $services_table = $wpdb->prefix . 'amelia_services';
        $popular = [];
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($services_table))) === $services_table) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- whether Amelia's table exists, which no WordPress function tells; asked once per report
            $popular = $wpdb->get_results($wpdb->prepare(
                "SELECT s.name, COUNT(*) AS count
                 FROM %i a
                 INNER JOIN %i s ON a.serviceId = s.id
                 WHERE a.bookingStart >= %s AND a.bookingStart <= %s
                 GROUP BY a.serviceId
                 ORDER BY count DESC
                 LIMIT 5",
                $table, $services_table, $start, $end
            )) ?: [];
        }

        return [
            'period'          => $date,
            'plugin'          => 'amelia',
            'totalBookings'   => $total,
            'byStatus'        => $by_status,
            'noShows'         => $no_shows,
            'noShowRate'      => $total > 0 ? round($no_shows / $total, 3) : 0,
            'revenue'         => round($revenue, 2),
            'popularServices' => array_map(function($r) {
                return ['name' => $r->name, 'count' => (int) $r->count];
            }, $popular),
        ];
    }
}
