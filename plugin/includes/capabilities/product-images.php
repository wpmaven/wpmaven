<?php
/**
 * set_product_image_if_missing: give a product WPMaven made the photo its
 * build uploaded, when it has none.
 *
 * Stores published before photos travelled by attachment id lost them: the
 * site refused to download its own image address (a private or loopback
 * address) and the product went live without a photo, while the photo sat in
 * the media library. A staff repair names the product and the attachment.
 * Only a product WPMaven made (_webmaven_product_key) and only one without a
 * photo: the owner's products and photos are never touched.
 *
 *   in:  { product_id, attachment_id }
 *   out: { success: true, product_id, image_set: bool,
 *          reason?: 'has_image' | 'not_wpmaven' | 'not_image' | 'not_found' }
 */

if (!defined('ABSPATH')) {
    exit;
}

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['set_product_image_if_missing'] = ['WebMaven_Cap_Product_Images', 'set_if_missing'];
    return $handlers;
});

class WebMaven_Cap_Product_Images {

    /** The marker woocommerce_create_product leaves on the products it makes. */
    const PRODUCT_KEY_META = '_webmaven_product_key';

    public static function set_if_missing($params = [], $step_id = null) {
        $params = is_array($params) ? $params : [];
        $product_id = (int) ($params['product_id'] ?? 0);
        $attachment_id = (int) ($params['attachment_id'] ?? 0);
        $answer = function ($set, $reason = null) use ($product_id) {
            $out = ['success' => true, 'product_id' => $product_id, 'image_set' => $set];
            if ($reason !== null) {
                $out['reason'] = $reason;
            }
            return $out;
        };
        if ($product_id <= 0 || get_post_type($product_id) !== 'product') {
            return $answer(false, 'not_found');
        }
        if ((string) get_post_meta($product_id, self::PRODUCT_KEY_META, true) === '') {
            return $answer(false, 'not_wpmaven');
        }
        if ((int) get_post_thumbnail_id($product_id) > 0) {
            return $answer(false, 'has_image');
        }
        if ($attachment_id <= 0 || !wp_attachment_is_image($attachment_id)) {
            return $answer(false, 'not_image');
        }
        if (!set_post_thumbnail($product_id, $attachment_id)) {
            return ['success' => false, 'error' => 'WordPress did not set the product image', 'product_id' => $product_id];
        }
        if (function_exists('wc_delete_product_transients')) {
            wc_delete_product_transients($product_id);
        }
        return $answer(true);
    }
}
