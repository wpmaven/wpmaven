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
        if ($wpdb->get_var("SHOW TABLES LIKE '{$table}'") !== $table) {
            return ['period' => $date, 'plugin' => 'amelia', 'error' => 'Table not found'];
        }

        $start = $date . ' 00:00:00';
        $end   = $date . ' 23:59:59';

        // Appointment counts by status
        $stats = $wpdb->get_results($wpdb->prepare(
            "SELECT status, COUNT(*) AS count
             FROM {$table}
             WHERE bookingStart >= %s AND bookingStart <= %s
             GROUP BY status",
            $start, $end
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
        if ($wpdb->get_var("SHOW TABLES LIKE '{$payments_table}'") === $payments_table) {
            $revenue = (float) ($wpdb->get_var($wpdb->prepare(
                "SELECT COALESCE(SUM(amount), 0) FROM {$payments_table}
                 WHERE dateTime >= %s AND dateTime <= %s AND status = 'paid'",
                $start, $end
            )) ?: 0);
        }

        // Popular services
        $services_table = $wpdb->prefix . 'amelia_services';
        $popular = [];
        if ($wpdb->get_var("SHOW TABLES LIKE '{$services_table}'") === $services_table) {
            $popular = $wpdb->get_results($wpdb->prepare(
                "SELECT s.name, COUNT(*) AS count
                 FROM {$table} a
                 INNER JOIN {$services_table} s ON a.serviceId = s.id
                 WHERE a.bookingStart >= %s AND a.bookingStart <= %s
                 GROUP BY a.serviceId
                 ORDER BY count DESC
                 LIMIT 5",
                $start, $end
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
