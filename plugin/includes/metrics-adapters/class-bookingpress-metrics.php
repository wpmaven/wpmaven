<?php
/**
 * BookingPress Metrics Adapter
 */

if (!defined('ABSPATH')) exit;

class WebMaven_BookingPress_Metrics implements WebMaven_Metrics_Adapter {

    public function get_source(): string {
        return 'bookings';
    }

    public function get_daily_metrics(string $date): array {
        global $wpdb;

        $table = $wpdb->prefix . 'bookingpress_appointment_bookings';
        if ($wpdb->get_var("SHOW TABLES LIKE '{$table}'") !== $table) {
            return ['period' => $date, 'plugin' => 'bookingpress', 'error' => 'Table not found'];
        }

        $stats = $wpdb->get_results($wpdb->prepare(
            "SELECT bookingpress_appointment_status AS status, COUNT(*) AS count
             FROM {$table}
             WHERE bookingpress_appointment_date = %s
             GROUP BY bookingpress_appointment_status",
            $date
        ));

        $by_status = [];
        $total = 0;
        foreach ($stats ?: [] as $row) {
            $by_status[$row->status] = (int) $row->count;
            $total += (int) $row->count;
        }

        // Revenue
        $payments_table = $wpdb->prefix . 'bookingpress_payment_logs';
        $revenue = 0.0;
        if ($wpdb->get_var("SHOW TABLES LIKE '{$payments_table}'") === $payments_table) {
            $revenue = (float) ($wpdb->get_var($wpdb->prepare(
                "SELECT COALESCE(SUM(bookingpress_payment_amount), 0) FROM {$payments_table}
                 WHERE bookingpress_payment_date = %s AND bookingpress_payment_status = 'paid'",
                $date
            )) ?: 0);
        }

        // Popular services
        $services_table = $wpdb->prefix . 'bookingpress_services';
        $popular = [];
        if ($wpdb->get_var("SHOW TABLES LIKE '{$services_table}'") === $services_table) {
            $popular = $wpdb->get_results($wpdb->prepare(
                "SELECT s.bookingpress_service_name AS name, COUNT(*) AS count
                 FROM {$table} a
                 INNER JOIN {$services_table} s ON a.bookingpress_service_id = s.bookingpress_service_id
                 WHERE a.bookingpress_appointment_date = %s
                 GROUP BY a.bookingpress_service_id
                 ORDER BY count DESC
                 LIMIT 5",
                $date
            )) ?: [];
        }

        return [
            'period'          => $date,
            'plugin'          => 'bookingpress',
            'totalBookings'   => $total,
            'byStatus'        => $by_status,
            'revenue'         => round($revenue, 2),
            'popularServices' => array_map(function($r) {
                return ['name' => $r->name, 'count' => (int) $r->count];
            }, $popular),
        ];
    }
}
