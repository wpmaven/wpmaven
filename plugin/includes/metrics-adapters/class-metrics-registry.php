<?php
/**
 * Metrics Registry
 * Auto-detects active plugins and instantiates the appropriate metrics adapters.
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/interface-metrics-adapter.php';

class WebMaven_Metrics_Registry {

    /** @var WebMaven_Metrics_Adapter[] */
    private $adapters = [];

    public function __construct() {
        $this->detect_adapters();
    }

    private function detect_adapters(): void {
        // E-commerce
        if (class_exists('WooCommerce')) {
            require_once __DIR__ . '/class-woocommerce-metrics.php';
            $this->adapters['woocommerce'] = new WebMaven_WooCommerce_Metrics();
        }

        // Forms (first detected wins — sites rarely run multiple form plugins)
        if (defined('WPCF7_VERSION')) {
            require_once __DIR__ . '/class-cf7-metrics.php';
            $this->adapters['forms'] = new WebMaven_CF7_Metrics();
        } elseif (function_exists('wpforms')) {
            require_once __DIR__ . '/class-wpforms-metrics.php';
            $this->adapters['forms'] = new WebMaven_WPForms_Metrics();
        } elseif (class_exists('GFAPI')) {
            require_once __DIR__ . '/class-gravity-forms-metrics.php';
            $this->adapters['forms'] = new WebMaven_GravityForms_Metrics();
        }
        // The form messages the site keeps itself (WebMaven_Leads) count every
        // form plugin once the table has rows; WPForms Lite keeps no entries.
        if (isset($this->adapters['forms']) && file_exists(__DIR__ . '/class-leads-metrics.php')) {
            require_once __DIR__ . '/class-leads-metrics.php';
            $this->adapters['forms'] = new WebMaven_Leads_Metrics($this->adapters['forms']);
        }

        // Bookings (first detected wins)
        if (class_exists('AmeliaBooking\\Infrastructure\\WP\\InstallActions\\ActivationAction')) {
            require_once __DIR__ . '/class-amelia-metrics.php';
            $this->adapters['bookings'] = new WebMaven_Amelia_Metrics();
        } elseif (class_exists('BookingPress') || defined('JEsuspended_BOOKINGPRESS_VERSION')) {
            require_once __DIR__ . '/class-bookingpress-metrics.php';
            $this->adapters['bookings'] = new WebMaven_BookingPress_Metrics();
        } elseif (class_exists('SSA\\Scheduling\\Appointment_Model') || defined('SSA_VERSION')) {
            require_once __DIR__ . '/class-ssa-metrics.php';
            $this->adapters['bookings'] = new WebMaven_SSA_Metrics();
        } elseif (class_exists('WC_Bookings')) {
            require_once __DIR__ . '/class-wc-bookings-metrics.php';
            $this->adapters['bookings'] = new WebMaven_WCBookings_Metrics();
        } elseif (class_exists('Bookly\\Lib\\Plugin')) {
            require_once __DIR__ . '/class-bookly-metrics.php';
            $this->adapters['bookings'] = new WebMaven_Bookly_Metrics();
        } elseif (defined('LATEPOINT_VERSION')) {
            require_once __DIR__ . '/class-latepoint-metrics.php';
            $this->adapters['bookings'] = new WebMaven_LatePoint_Metrics();
        }
    }

    /**
     * Get metrics for a specific source and date.
     */
    public function get_metrics(string $source, string $date): ?array {
        if (!isset($this->adapters[$source])) {
            return null;
        }
        return $this->adapters[$source]->get_daily_metrics($date);
    }

    /**
     * List all available sources on this site.
     */
    public function get_available_sources(): array {
        $sources = [];
        foreach ($this->adapters as $key => $adapter) {
            $sources[] = [
                'key' => $key,
                'source' => $adapter->get_source(),
            ];
        }
        return $sources;
    }

    /**
     * Check if a source is available.
     */
    public function has_source(string $source): bool {
        return isset($this->adapters[$source]);
    }
}
