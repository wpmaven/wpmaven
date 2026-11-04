<?php
/**
 * Metrics Adapter Interface
 * All plugin-specific metrics adapters must implement this.
 */

if (!defined('ABSPATH')) exit;

interface WebMaven_Metrics_Adapter {
    /**
     * Return the adapter source identifier (e.g. 'woocommerce', 'forms', 'bookings').
     */
    public function get_source(): string;

    /**
     * Collect daily metrics for the given date.
     *
     * @param string $date Date in Y-m-d format.
     * @return array Metrics payload.
     */
    public function get_daily_metrics(string $date): array;
}
