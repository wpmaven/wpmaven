<?php
/**
 * WebMaven Metrics Routes
 * REST endpoints for plugin-specific business metrics (WooCommerce, forms, bookings).
 * Called by the API via webhook or directly via REST for testing.
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/class-webmaven-log.php';

require_once WEBMAVEN_WP_DIR . 'includes/metrics-adapters/class-metrics-registry.php';

class WebMaven_Metrics_Routes {

    private $plugin;
    private $registry;

    public function __construct($plugin) {
        $this->plugin = $plugin;
        $this->registry = new WebMaven_Metrics_Registry();
    }

    /**
     * Who may read the business's numbers over REST (1.4.0, security review
     * 2026-10-08): an administrator or a shop manager, the two roles the
     * finance screens answer (WebMaven_Actor's 'owner' and 'store' tiers,
     * from capabilities, not filterable). These routes answered any user who
     * can edit posts, so a Contributor or an Author read the store's revenue,
     * its best sellers and its refunds straight from WordPress. The WPMaven
     * API never comes this way: it asks over the signed command channel.
     */
    public function can_read_metrics() {
        $tier = method_exists($this->plugin, 'current_user_api_tier') ? $this->plugin->current_user_api_tier() : null;
        return $tier === 'owner' || $tier === 'store';
    }

    public function register_routes() {
        // List available metrics sources on this site
        register_rest_route('webmaven_wp/v1', '/metrics/available', [
            'methods' => 'GET',
            'permission_callback' => [$this, 'can_read_metrics'],
            'callback' => [$this, 'get_available'],
        ]);

        // Generic metrics endpoint: /metrics/{source}?date=YYYY-MM-DD
        register_rest_route('webmaven_wp/v1', '/metrics/(?P<source>[a-z_]+)', [
            'methods' => 'GET',
            'permission_callback' => [$this, 'can_read_metrics'],
            'callback' => [$this, 'get_metrics'],
            'args' => [
                'source' => [
                    'type' => 'string',
                    'required' => true,
                    'validate_callback' => function($param) {
                        return preg_match('/^[a-z_]+$/', $param);
                    },
                ],
                'date' => [
                    'type' => 'string',
                    'required' => false,
                    'default' => '',
                    'validate_callback' => function($param) {
                        return empty($param) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $param);
                    },
                ],
            ],
        ]);
    }

    /**
     * GET /metrics/available — list which adapters are active on this site.
     */
    public function get_available() {
        return new \WP_REST_Response([
            'success' => true,
            'data' => [
                'sources' => $this->registry->get_available_sources(),
            ],
        ]);
    }

    /**
     * GET /metrics/{source}?date=YYYY-MM-DD — fetch metrics for a specific source.
     */
    public function get_metrics(\WP_REST_Request $request) {
        $source = $request->get_param('source');
        $date = $request->get_param('date') ?: gmdate('Y-m-d');

        if (!$this->registry->has_source($source)) {
            return new \WP_REST_Response([
                'success' => false,
                'error' => "Metrics source '{$source}' not available on this site",
            ], 404);
        }

        try {
            $metrics = $this->registry->get_metrics($source, $date);

            return new \WP_REST_Response([
                'success' => true,
                'data' => [
                    'source' => $source,
                    'date' => $date,
                    'metrics' => $metrics,
                ],
            ]);
        } catch (\Exception $e) {
            WebMaven_Log::write("WebMaven Metrics: Failed to collect {$source} metrics — " . $e->getMessage());

            return new \WP_REST_Response([
                'success' => false,
                'error' => "Failed to collect metrics: " . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Get the registry (used by webhook handler dispatch).
     */
    public function get_registry(): WebMaven_Metrics_Registry {
        return $this->registry;
    }
}
