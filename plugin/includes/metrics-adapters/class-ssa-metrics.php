<?php
/**
 * Simply Schedule Appointments Metrics Adapter
 * SSA uses custom post type 'ssa_appointment'.
 */

if (!defined('ABSPATH')) exit;

class WebMaven_SSA_Metrics implements WebMaven_Metrics_Adapter {

    public function get_source(): string {
        return 'bookings';
    }

    public function get_daily_metrics(string $date): array {
        $args = [
            'post_type'      => 'ssa_appointment',
            'posts_per_page' => -1,
            'date_query'     => [
                ['after' => $date . ' 00:00:00', 'before' => $date . ' 23:59:59', 'inclusive' => true],
            ],
            'fields' => 'ids',
        ];

        $query = new \WP_Query($args);
        $ids = $query->posts;
        $total = count($ids);

        $by_status = [];
        foreach ($ids as $id) {
            $status = get_post_meta($id, '_ssa_status', true) ?: 'booked';
            $by_status[$status] = ($by_status[$status] ?? 0) + 1;
        }

        return [
            'period'        => $date,
            'plugin'        => 'simply-schedule-appointments',
            'totalBookings' => $total,
            'byStatus'      => $by_status,
        ];
    }
}
