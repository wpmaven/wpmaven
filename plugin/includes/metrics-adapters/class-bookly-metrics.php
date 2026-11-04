<?php
/**
 * Bookly Metrics Adapter
 * Queries wp_bookly_appointments table.
 */

if (!defined('ABSPATH')) exit;

class WebMaven_Bookly_Metrics implements WebMaven_Metrics_Adapter {

    public function get_source(): string {
        return 'bookings';
    }

    public function get_daily_metrics(string $date): array {
        global $wpdb;

        $table = $wpdb->prefix . 'bookly_appointments';
        if ($wpdb->get_var("SHOW TABLES LIKE '{$table}'") !== $table) {
            return ['period' => $date, 'plugin' => 'bookly', 'error' => 'Table not found'];
        }

        $start = $date . ' 00:00:00';
        $end   = $date . ' 23:59:59';

        // Appointment counts
        $total = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$table} WHERE start_date >= %s AND start_date <= %s",
            $start, $end
        ));

        // Revenue from customer appointments table
        $ca_table = $wpdb->prefix . 'bookly_customer_appointments';
        $revenue = 0.0;
        if ($wpdb->get_var("SHOW TABLES LIKE '{$ca_table}'") === $ca_table) {
            $revenue = (float) ($wpdb->get_var($wpdb->prepare(
                "SELECT COALESCE(SUM(ca.payment_amount), 0)
                 FROM {$ca_table} ca
                 INNER JOIN {$table} a ON ca.appointment_id = a.id
                 WHERE a.start_date >= %s AND a.start_date <= %s",
                $start, $end
            )) ?: 0);
        }

        // Popular services
        $services_table = $wpdb->prefix . 'bookly_services';
        $popular = [];
        if ($wpdb->get_var("SHOW TABLES LIKE '{$services_table}'") === $services_table) {
            $popular = $wpdb->get_results($wpdb->prepare(
                "SELECT s.title AS name, COUNT(*) AS count
                 FROM {$table} a
                 INNER JOIN {$services_table} s ON a.service_id = s.id
                 WHERE a.start_date >= %s AND a.start_date <= %s
                 GROUP BY a.service_id
                 ORDER BY count DESC
                 LIMIT 5",
                $start, $end
            )) ?: [];
        }

        return [
            'period'          => $date,
            'plugin'          => 'bookly',
            'totalBookings'   => $total,
            'revenue'         => round($revenue, 2),
            'popularServices' => array_map(function($r) {
                return ['name' => $r->name, 'count' => (int) $r->count];
            }, $popular),
        ];
    }
}
