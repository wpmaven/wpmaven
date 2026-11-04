<?php
/**
 * WooCommerce Bookings Metrics Adapter
 * Bookings stored as 'wc_booking' post type with WC order integration.
 */

if (!defined('ABSPATH')) exit;

class WebMaven_WCBookings_Metrics implements WebMaven_Metrics_Adapter {

    public function get_source(): string {
        return 'bookings';
    }

    public function get_daily_metrics(string $date): array {
        $args = [
            'post_type'      => 'wc_booking',
            'posts_per_page' => -1,
            'date_query'     => [
                ['after' => $date . ' 00:00:00', 'before' => $date . ' 23:59:59', 'inclusive' => true],
            ],
        ];

        $query = new \WP_Query($args);
        $bookings = $query->posts;
        $total = count($bookings);

        $by_status = [];
        $revenue = 0.0;
        foreach ($bookings as $booking_post) {
            $status = $booking_post->post_status;
            $by_status[$status] = ($by_status[$status] ?? 0) + 1;

            // Get cost from meta
            $cost = (float) get_post_meta($booking_post->ID, '_booking_cost', true);
            $revenue += $cost;
        }

        return [
            'period'        => $date,
            'plugin'        => 'woocommerce-bookings',
            'totalBookings' => $total,
            'byStatus'      => $by_status,
            'revenue'       => round($revenue, 2),
        ];
    }
}
