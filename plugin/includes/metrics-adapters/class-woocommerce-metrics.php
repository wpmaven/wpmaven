<?php
/**
 * WooCommerce Metrics Adapter
 * Collects daily revenue, orders, top sellers, stock alerts, refunds.
 */

if (!defined('ABSPATH')) exit;

class WebMaven_WooCommerce_Metrics implements WebMaven_Metrics_Adapter {

    public function get_source(): string {
        return 'woocommerce';
    }

    public function get_daily_metrics(string $date): array {
        $start = $date . ' 00:00:00';
        $end   = $date . ' 23:59:59';

        return [
            'period'       => $date,
            'revenue'      => $this->get_revenue($start, $end),
            'comparison'   => $this->get_comparison($date),
            'topSellers'   => $this->get_top_sellers($start, $end),
            'stockAlerts'  => $this->get_stock_alerts(),
            'refunds'      => $this->get_refunds($start, $end),
            'conversionRate' => $this->get_conversion_rate($start, $end),
        ];
    }

    private function get_revenue(string $start, string $end): array {
        $orders = wc_get_orders([
            'date_created' => $start . '...' . $end,
            'status'       => ['completed', 'processing'],
            'limit'        => -1,
            'return'       => 'objects',
        ]);

        $total = 0.0;
        foreach ($orders as $order) {
            $total += (float) $order->get_total();
        }

        $count = count($orders);

        return [
            'total'         => round($total, 2),
            'currency'      => get_woocommerce_currency(),
            'orderCount'    => $count,
            'avgOrderValue' => $count > 0 ? round($total / $count, 2) : 0,
        ];
    }

    private function get_comparison(string $date): array {
        $current_ts = strtotime($date);

        // 7-day rolling average
        $seven_day_total = 0.0;
        $seven_day_orders = 0;
        for ($i = 1; $i <= 7; $i++) {
            $d = gmdate('Y-m-d', $current_ts - ($i * DAY_IN_SECONDS));
            $orders = wc_get_orders([
                'date_created' => $d . ' 00:00:00...' . $d . ' 23:59:59',
                'status'       => ['completed', 'processing'],
                'limit'        => -1,
                'return'       => 'objects',
            ]);
            foreach ($orders as $order) {
                $seven_day_total += (float) $order->get_total();
            }
            $seven_day_orders += count($orders);
        }

        $avg_revenue = $seven_day_total / 7;
        $avg_orders  = $seven_day_orders / 7;

        // Today's numbers
        $today_start = $date . ' 00:00:00';
        $today_end   = $date . ' 23:59:59';
        $today_orders = wc_get_orders([
            'date_created' => $today_start . '...' . $today_end,
            'status'       => ['completed', 'processing'],
            'limit'        => -1,
            'return'       => 'objects',
        ]);

        $today_revenue = 0.0;
        foreach ($today_orders as $order) {
            $today_revenue += (float) $order->get_total();
        }

        // Last week same day
        $last_week_date = gmdate('Y-m-d', $current_ts - (7 * DAY_IN_SECONDS));
        $lw_orders = wc_get_orders([
            'date_created' => $last_week_date . ' 00:00:00...' . $last_week_date . ' 23:59:59',
            'status'       => ['completed', 'processing'],
            'limit'        => -1,
            'return'       => 'objects',
        ]);
        $lw_revenue = 0.0;
        foreach ($lw_orders as $order) {
            $lw_revenue += (float) $order->get_total();
        }

        return [
            'vs7dayAvg'  => $avg_revenue > 0 ? round($today_revenue / $avg_revenue, 2) : null,
            'vsLastWeek' => $lw_revenue > 0 ? round($today_revenue / $lw_revenue, 2) : null,
        ];
    }

    private function get_top_sellers(string $start, string $end, int $limit = 5): array {
        global $wpdb;

        $results = $wpdb->get_results($wpdb->prepare(
            "SELECT oi_meta.meta_value AS product_id,
                    SUM(oi_qty.meta_value) AS quantity,
                    SUM(oi_total.meta_value) AS revenue
             FROM {$wpdb->prefix}woocommerce_order_items AS oi
             INNER JOIN {$wpdb->prefix}woocommerce_order_itemmeta AS oi_meta
                 ON oi.order_item_id = oi_meta.order_item_id AND oi_meta.meta_key = '_product_id'
             INNER JOIN {$wpdb->prefix}woocommerce_order_itemmeta AS oi_qty
                 ON oi.order_item_id = oi_qty.order_item_id AND oi_qty.meta_key = '_qty'
             INNER JOIN {$wpdb->prefix}woocommerce_order_itemmeta AS oi_total
                 ON oi.order_item_id = oi_total.order_item_id AND oi_total.meta_key = '_line_total'
             INNER JOIN {$wpdb->posts} AS p ON oi.order_id = p.ID
             WHERE p.post_type IN ('shop_order', 'shop_order_placehold')
               AND p.post_status IN ('wc-completed', 'wc-processing')
               AND p.post_date >= %s AND p.post_date <= %s
               AND oi.order_item_type = 'line_item'
             GROUP BY oi_meta.meta_value
             ORDER BY revenue DESC
             LIMIT %d",
            $start, $end, $limit
        ));

        // WC HPOS: if no results from posts table, try orders table
        if (empty($results) && class_exists('Automattic\\WooCommerce\\Utilities\\OrderUtil')
            && \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled()) {
            $results = $this->get_top_sellers_hpos($start, $end, $limit);
        }

        $sellers = [];
        foreach ($results ?: [] as $row) {
            $product = wc_get_product((int) $row->product_id);
            $sellers[] = [
                'productId' => (int) $row->product_id,
                'name'      => $product ? $product->get_name() : '(deleted)',
                'quantity'  => (int) $row->quantity,
                'revenue'   => round((float) $row->revenue, 2),
            ];
        }

        return $sellers;
    }

    private function get_top_sellers_hpos(string $start, string $end, int $limit): array {
        global $wpdb;

        return $wpdb->get_results($wpdb->prepare(
            "SELECT oi_meta.meta_value AS product_id,
                    SUM(oi_qty.meta_value) AS quantity,
                    SUM(oi_total.meta_value) AS revenue
             FROM {$wpdb->prefix}woocommerce_order_items AS oi
             INNER JOIN {$wpdb->prefix}woocommerce_order_itemmeta AS oi_meta
                 ON oi.order_item_id = oi_meta.order_item_id AND oi_meta.meta_key = '_product_id'
             INNER JOIN {$wpdb->prefix}woocommerce_order_itemmeta AS oi_qty
                 ON oi.order_item_id = oi_qty.order_item_id AND oi_qty.meta_key = '_qty'
             INNER JOIN {$wpdb->prefix}woocommerce_order_itemmeta AS oi_total
                 ON oi.order_item_id = oi_total.order_item_id AND oi_total.meta_key = '_line_total'
             INNER JOIN {$wpdb->prefix}wc_orders AS o ON oi.order_id = o.id
             WHERE o.type = 'shop_order'
               AND o.status IN ('wc-completed', 'wc-processing')
               AND o.date_created_gmt >= %s AND o.date_created_gmt <= %s
               AND oi.order_item_type = 'line_item'
             GROUP BY oi_meta.meta_value
             ORDER BY revenue DESC
             LIMIT %d",
            $start, $end, $limit
        )) ?: [];
    }

    private function get_stock_alerts(): array {
        $low_stock = $this->get_low_stock(20);

        $out_of_stock = wc_get_products([
            'stock_status' => 'outofstock',
            'limit'        => 20,
            'return'       => 'objects',
        ]);

        $format = function($product) {
            return [
                'id'    => $product->get_id(),
                'name'  => self::alert_name($product),
                'stock' => $product->get_stock_quantity(),
                'sku'   => $product->get_sku(),
            ];
        };

        return [
            'low' => array_map($format, $low_stock),
            'out' => array_map($format, $out_of_stock),
        ];
    }

    /**
     * Products and options (variations) on sale whose own stock is at or
     * under their low-stock amount, lowest first. wc_get_products() matches
     * 'stock_quantity' exactly, so a '<=' filter there found nothing: the
     * numbers come from WooCommerce's lookup table instead, and each row is
     * held to its own amount (the product's, else its parent's, else the
     * store's), as WooCommerce's own low-stock email does.
     */
    private function get_low_stock(int $limit): array {
        global $wpdb;
        $table = $wpdb->wc_product_meta_lookup ?? '';
        if ($table === '') {
            return [];
        }

        $store_amount = (int) get_option('woocommerce_notify_low_stock_amount', 2);
        $highest_own = (int) $wpdb->get_var(
            "SELECT MAX(CAST(meta_value AS SIGNED)) FROM {$wpdb->postmeta}
             WHERE meta_key = '_low_stock_amount' AND meta_value <> ''"
        );
        $ceiling = max($store_amount, $highest_own);

        // The lookup table holds a quantity only for stock WooCommerce manages.
        $ids = $wpdb->get_col($wpdb->prepare(
            "SELECT l.product_id FROM {$table} AS l
             INNER JOIN {$wpdb->posts} AS p ON p.ID = l.product_id
             WHERE l.stock_quantity IS NOT NULL
               AND l.stock_quantity <= %d
               AND l.stock_status = 'instock'
               AND p.post_type IN ('product', 'product_variation')
               AND p.post_status = 'publish'
             ORDER BY l.stock_quantity ASC, l.product_id ASC
             LIMIT 200",
            $ceiling
        )) ?: [];

        $low = [];
        foreach ($ids as $id) {
            $product = wc_get_product((int) $id);
            if (!$product || $product->get_stock_quantity() === null || $product->get_stock_status() !== 'instock') {
                continue;
            }
            if ($product->is_type('variation')) {
                $parent = wc_get_product($product->get_parent_id());
                if (!$parent || $parent->get_status() !== 'publish') {
                    continue;
                }
            }
            $amount = function_exists('wc_get_low_stock_amount')
                ? (int) wc_get_low_stock_amount($product)
                : $store_amount;
            if ($product->get_stock_quantity() > $amount) {
                continue;
            }
            $low[] = $product;
            if (count($low) >= $limit) {
                break;
            }
        }
        return $low;
    }

    /** A variation reads "Product - options" (Mug - Blue, Large), a product its name. */
    private static function alert_name($product): string {
        if (!$product->is_type('variation')) {
            return $product->get_name();
        }
        $parent = wc_get_product($product->get_parent_id());
        $base = $parent ? $parent->get_name() : $product->get_name();
        $options = function_exists('wc_get_formatted_variation')
            ? wc_get_formatted_variation($product, true, false, false)
            : '';
        return $options !== '' ? $base . ' - ' . $options : $base;
    }

    private function get_refunds(string $start, string $end): array {
        $refunds = wc_get_orders([
            'type'         => 'shop_order_refund',
            'date_created' => $start . '...' . $end,
            'limit'        => -1,
            'return'       => 'objects',
        ]);

        $total = 0.0;
        foreach ($refunds as $refund) {
            $total += abs((float) $refund->get_total());
        }

        return [
            'count' => count($refunds),
            'total' => round($total, 2),
        ];
    }

    private function get_conversion_rate(string $start, string $end): ?float {
        // Conversion rate requires session/visit data which WooCommerce doesn't track natively.
        // Return null unless an analytics integration provides this.
        return null;
    }
}
