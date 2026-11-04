<?php
/**
 * Store commands for the API (2026-10-05): the site's products and blog
 * posts, changed through WooCommerce's and WordPress's own CRUD, for the edit
 * engine's data operations (update_product, add_product, remove_product,
 * update_post, add_post, remove_post) and the dashboard's Store.
 *
 *   store_product_read    {product_id, internal?}       -> {product: StoreProductDetail}
 *   store_product_update  {product_id, fields, floors?} -> {product_id, before, after, changed, modifiedGmt}
 *   store_product_create  {fields}                      -> {product_id, permalink, status}
 *   store_product_trash   {product_id, restore?}        -> {product_id, status}
 *   content_post_read     {post_id, with_content?}      -> {post: PostSnap (+ content: {html, baseHash})}
 *   content_post_update   {post_id, fields}             -> {post_id, before, after, changed, modifiedGmt}
 *   content_post_create   {fields}                      -> {post_id, permalink, status}
 *   content_post_trash    {post_id, restore?}           -> {post_id, status}
 *   store_term_read       {taxonomy, term_id}           -> {term: {id, taxonomy, name, description, slug, link, count}}
 *   store_term_update     {taxonomy, term_id, fields}   -> {term_id, taxonomy, before, after, changed}
 *
 * The term commands (2026-10-19) read and write a store category
 * (product_cat) or a blog category (category): its name and its
 * description, as a category page's heading shows them (the editor's
 * Rename category and Change description, the update_term operation).
 * Its address (slug) stays as it is. before and after are patches as for
 * a product.
 *
 * fields are ProductFields or PostFields (camelCase, unknown keys refused).
 * Prices are decimal strings in the store currency with the store's
 * decimals ("14.50"). before and after hold only the fields the call touched,
 * in the same shape as fields, so before is the patch that undoes the call
 * (a variable product's prices come back per variation under "variations").
 * changed lists the fields whose value moved. modifiedGmt is the modified
 * time after the call, the baseModified of the next one (a time within two
 * seconds of the current one still passes: WooCommerce saves a product with
 * options once more when the request ends).
 *
 * store_product_read answers the product as the product editor reads it:
 * the fields an update_product changes, then what the editor shows (the
 * options and their values, the photos, the categories, the wpmaven info).
 * With internal (the API's own handlers, never forwarded), it adds
 * product.internal: the design key, the print product and each option's
 * print variant id.
 *
 * An own product takes attributes (the set replaces the product's: a simple
 * product given an attribute used for variations becomes a variable one, and
 * a variable one whose last variation goes in the same change becomes a
 * simple one again), newVariations (one value per attribute used for
 * variations) and variations[].remove. A variation still using a value the
 * change takes away is refused unless the same change removes it. before
 * lists a created variation as {variationId, remove: true}: the undo patch.
 *
 * A printed product (_wm_pod_product set) is made to order from a fixed set
 * of options: its options, its stock and its shipping data are refused
 * (POD_OPTIONS_LOCKED, POD_MADE_TO_ORDER), one option at least stays on sale,
 * and no price may go under its floor (PRICE_BELOW_FLOOR): the floors the
 * API sends, else the ones the site keeps (_wm_price_floor). The floors the
 * API sends are kept on the site, so WooCommerce's own screens hold the same
 * line (WebMaven_Pod_Guards). These commands never write the _wm_pod* meta.
 *
 * Failures THROW an Exception whose message is "CODE: sentence" (the API
 * reads ^([A-Z_]+):\s*(.*)$ and may show the sentence to the owner). Codes:
 * NOT_FOUND, NO_STORE, VALIDATION, CHANGED_ELSEWHERE,
 * DESIGN_OWNED, POD_OPTIONS_LOCKED, POD_MADE_TO_ORDER, PRICE_BELOW_FLOOR,
 * PROTECTED_PAGE (the homepage, the blog page, the privacy page and the
 * store's own pages stay published), TRASH_DISABLED (a site whose trash is
 * off would delete for good), WRITE_FAILED. Registered through the filter, so the execute_command bridge
 * (webhook_<name>) cannot reach these. More store commands (lists, orders)
 * join this class.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['store_product_read'] = ['WebMaven_Cap_Store', 'product_read'];
    $handlers['store_product_update'] = ['WebMaven_Cap_Store', 'product_update'];
    $handlers['store_product_create'] = ['WebMaven_Cap_Store', 'product_create'];
    $handlers['store_product_trash'] = ['WebMaven_Cap_Store', 'product_trash'];
    $handlers['content_post_read'] = ['WebMaven_Cap_Store', 'post_read'];
    $handlers['content_post_update'] = ['WebMaven_Cap_Store', 'post_update'];
    $handlers['content_post_create'] = ['WebMaven_Cap_Store', 'post_create'];
    $handlers['content_post_trash'] = ['WebMaven_Cap_Store', 'post_trash'];
    $handlers['store_term_read'] = ['WebMaven_Cap_Store', 'term_read'];
    $handlers['store_term_update'] = ['WebMaven_Cap_Store', 'term_update'];
    return $handlers;
});

final class WebMaven_Cap_Store {

    const POD_PRODUCT_META = '_wm_pod_product';
    const SAMPLE_META = '_wm_sample_product';
    const CARD_SLOT_PREFIX = '_wm_card_slot_';
    const FULLHTML_META = '_webmaven_fullhtml';
    const POD_META = '_wm_pod';
    const DESIGN_KEY_META = '_wm_product_slug';

    /** Every ProductFields key. */
    const PRODUCT_FIELDS = [
        'baseModified', 'name', 'shortDescription', 'description', 'status', 'catalogVisibility', 'featured', 'sku',
        'categoryIds', 'newCategories', 'tags', 'regularPrice', 'salePrice', 'saleSchedule', 'manageStock',
        'stockQuantity', 'stockStatus', 'backorders', 'allVariations', 'variations', 'attributes', 'newVariations',
        'virtual', 'weight', 'dimensions', 'featuredMediaId', 'galleryMediaIds', 'cardSlots', 'purchaseNote',
        'externalUrl', 'buttonText', 'sample',
    ];

    /** ProductFields set on the product itself, in the order they are applied. */
    const PRODUCT_LEVEL_FIELDS = [
        'name', 'shortDescription', 'description', 'status', 'catalogVisibility', 'featured', 'sku',
        'regularPrice', 'salePrice', 'saleSchedule', 'manageStock', 'stockQuantity', 'stockStatus', 'backorders',
        'virtual', 'weight', 'dimensions', 'featuredMediaId', 'galleryMediaIds', 'purchaseNote', 'externalUrl', 'buttonText',
    ];

    const VARIATION_FIELDS = ['variationId', 'enabled', 'regularPrice', 'salePrice', 'saleSchedule', 'sku', 'manageStock', 'stockQuantity', 'stockStatus', 'mediaId', 'remove'];
    const ALL_VARIATIONS_FIELDS = ['regularPrice', 'salePrice', 'saleSchedule', 'stockStatus'];
    const ATTRIBUTE_FIELDS = ['name', 'options', 'variation', 'visible'];
    const NEW_VARIATION_FIELDS = ['options', 'regularPrice', 'salePrice', 'stockStatus', 'mediaId'];
    const MAX_ATTRIBUTES = 20;
    const MAX_ATTRIBUTE_VALUES = 50;
    const MAX_NEW_VARIATIONS = 100;

    /** Stock fields a printed product never takes: it is made to order. */
    const MADE_TO_ORDER_FIELDS = ['manageStock', 'stockQuantity', 'stockStatus', 'backorders', 'virtual', 'weight', 'dimensions'];

    const PRODUCT_STATUSES = ['publish', 'draft', 'private'];
    const PRODUCT_TYPES = ['simple', 'variable', 'external'];
    const STOCK_STATUSES = ['instock', 'outofstock', 'onbackorder'];

    const POST_FIELDS = ['baseModified', 'title', 'excerpt', 'status', 'date', 'slug', 'featuredMediaId', 'categoryIds', 'newCategories', 'tags', 'content', 'seo'];

    /** Seconds a baseModified may trail the current modified time and still pass. */
    const MODIFIED_TOLERANCE = 2;
    const POST_STATUSES = ['publish', 'draft', 'pending', 'private', 'future'];
    const POST_TYPES = ['post', 'page'];

    /** "CODE: sentence", the shape the API parses. */
    private static function error(string $code, string $message): Exception {
        return new Exception($code . ': ' . $message);
    }

    // ── store_product_read ──────────────────────────────────────────────────

    public static function product_read($params = [], $step_id = null) {
        $product = self::product($params['product_id'] ?? null);
        $snapshot = self::product_snapshot($product);
        if (($params['internal'] ?? false) === true) {
            $snapshot['internal'] = self::internal_of($product);
        }
        return ['product' => $snapshot];
    }

    /**
     * The product as the Store and the edit engine read it (StoreProductDetail):
     * the ProductFields part first, then what the editor shows.
     */
    public static function product_snapshot($product): array {
        $id = (int) $product->get_id();
        $variations = [];
        if ($product->is_type('variable')) {
            foreach ((array) $product->get_children() as $vid) {
                $variation = wc_get_product($vid);
                if (!$variation) {
                    continue;
                }
                $variations[] = self::variation_snapshot($product, $variation);
            }
        }
        $featured = (int) $product->get_image_id('edit');
        $gallery = [];
        foreach ((array) $product->get_gallery_image_ids('edit') as $image_id) {
            $ref = self::image_ref((int) $image_id);
            if ($ref !== null) {
                $gallery[] = $ref;
            }
        }
        return [
            'id' => $id,
            'type' => (string) $product->get_type(),
            'status' => (string) $product->get_status('edit'),
            'name' => (string) $product->get_name('edit'),
            'shortDescription' => (string) $product->get_short_description('edit'),
            'description' => (string) $product->get_description('edit'),
            'sku' => (string) $product->get_sku('edit'),
            'regularPrice' => self::price_out($product->get_regular_price('edit')),
            'salePrice' => self::price_out($product->get_sale_price('edit')),
            'manageStock' => (bool) $product->get_manage_stock('edit'),
            'stockQuantity' => self::quantity_out($product->get_stock_quantity('edit')),
            'stockStatus' => (string) $product->get_stock_status('edit'),
            'categoryIds' => array_map('intval', (array) $product->get_category_ids('edit')),
            'tags' => self::term_names((array) $product->get_tag_ids('edit'), 'product_tag'),
            'featuredMediaId' => ((int) $product->get_image_id('edit')) ?: null,
            'galleryMediaIds' => array_map('intval', (array) $product->get_gallery_image_ids('edit')),
            'cardSlots' => (object) self::card_slots($id),
            'permalink' => (string) get_permalink($id),
            'modifiedGmt' => self::modified_out($product->get_date_modified('edit')),
            'printed' => self::is_printed($id),
            'sample' => (bool) get_post_meta($id, self::SAMPLE_META, true),
            'variations' => $variations,
            'saleSchedule' => self::product_value($product, 'saleSchedule'),
            'backorders' => (string) $product->get_backorders('edit'),
            'catalogVisibility' => (string) $product->get_catalog_visibility('edit'),
            'featured' => (bool) $product->get_featured('edit'),
            'virtual' => (bool) $product->get_virtual('edit'),
            'weight' => (string) $product->get_weight('edit'),
            'dimensions' => self::product_value($product, 'dimensions'),
            'purchaseNote' => (string) $product->get_purchase_note('edit'),
            'externalUrl' => self::product_value($product, 'externalUrl'),
            'buttonText' => self::product_value($product, 'buttonText'),
            'attributes' => self::attributes_snapshot($product),
            'images' => ['featured' => $featured > 0 ? self::image_ref($featured) : null, 'gallery' => $gallery],
            'categories' => self::category_refs((array) $product->get_category_ids('edit')),
            'wpmaven' => class_exists('WebMaven_Store_Rest_Filters') ? WebMaven_Store_Rest_Filters::product_info($product) : null,
            'editUrl' => (string) admin_url('post.php?post=' . $id . '&action=edit'),
        ];
    }

    /** One option of a variable product (StoreVariation): what update_product changes first. */
    private static function variation_snapshot($product, $variation): array {
        $options = self::variation_options($product, $variation);
        $manage = $variation->get_manage_stock('edit');
        $floor = class_exists('WebMaven_Pod_Guards') ? WebMaven_Pod_Guards::applicable_floor($variation) : null;
        $photo = class_exists('WebMaven_Store_Rest_Filters') ? WebMaven_Store_Rest_Filters::photo($variation) : null;
        return [
            'variationId' => (int) $variation->get_id(),
            'enabled' => $variation->get_status('edit') === 'publish',
            'regularPrice' => self::price_out($variation->get_regular_price('edit')),
            'salePrice' => self::price_out($variation->get_sale_price('edit')),
            'stockStatus' => (string) $variation->get_stock_status('edit'),
            'label' => implode(', ', array_values($options)),
            'options' => (object) $options,
            'sku' => (string) $variation->get_sku('edit'),
            'manageStock' => $manage === true || $manage === 'yes',
            'stockQuantity' => self::quantity_out($variation->get_stock_quantity('edit')),
            'mediaId' => ((int) $variation->get_image_id('edit')) ?: null,
            'imageUrl' => $photo['url'] ?? null,
            'floor' => $floor === null ? null : WebMaven_Pod_Guards::decimal_of($floor),
        ];
    }

    /** A variation's options: {attribute name: value} ("Any" for a value it leaves open). */
    private static function variation_options($product, $variation): array {
        $attributes = (array) $product->get_attributes('edit');
        $out = [];
        foreach ((array) $variation->get_attributes('edit') as $key => $value) {
            $key = (string) $key;
            $value = (string) $value;
            $attribute = $attributes[$key] ?? null;
            $taxonomy = is_object($attribute) && method_exists($attribute, 'is_taxonomy') && $attribute->is_taxonomy();
            $label = is_object($attribute) ? self::attribute_label($attribute) : $key;
            if ($taxonomy && $value !== '' && function_exists('get_term_by')) {
                $term = get_term_by('slug', $value, $attribute->get_name());
                if ($term && !is_wp_error($term)) {
                    $value = (string) $term->name;
                }
            }
            $out[$label] = $value === '' ? 'Any' : self::plain(html_entity_decode($value, ENT_QUOTES, 'UTF-8'));
        }
        return $out;
    }

    /** The product's attributes as ProductAttributeInput (names and values as people read them). */
    private static function attributes_snapshot($product): array {
        $out = [];
        foreach ((array) $product->get_attributes('edit') as $attribute) {
            if (!is_object($attribute) || !method_exists($attribute, 'get_options')) {
                continue;
            }
            $taxonomy = method_exists($attribute, 'is_taxonomy') && $attribute->is_taxonomy();
            $options = [];
            foreach ((array) $attribute->get_options() as $option) {
                if ($taxonomy) {
                    $term = get_term((int) $option, $attribute->get_name());
                    if ($term && !is_wp_error($term)) {
                        $options[] = (string) $term->name;
                    }
                } else {
                    $options[] = (string) $option;
                }
            }
            $out[] = [
                'name' => self::attribute_label($attribute),
                'options' => $options,
                'variation' => (bool) $attribute->get_variation(),
                'visible' => (bool) $attribute->get_visible(),
            ];
        }
        return $out;
    }

    private static function attribute_label($attribute): string {
        $name = (string) $attribute->get_name();
        $taxonomy = method_exists($attribute, 'is_taxonomy') && $attribute->is_taxonomy();
        $label = $taxonomy && function_exists('wc_attribute_label') ? (string) wc_attribute_label($name) : $name;
        return self::plain(html_entity_decode($label, ENT_QUOTES, 'UTF-8'));
    }

    /** {id, url} of a library image (its medium size), or null. */
    private static function image_ref(int $id): ?array {
        if ($id <= 0 || !get_post($id)) {
            return null;
        }
        $url = function_exists('wp_get_attachment_image_url') ? wp_get_attachment_image_url($id, 'medium') : false;
        if (!$url) {
            $url = wp_get_attachment_url($id);
        }
        return $url ? ['id' => $id, 'url' => (string) $url] : null;
    }

    /** [{id, name}] of product category ids. */
    private static function category_refs(array $ids): array {
        $out = [];
        foreach ($ids as $id) {
            $term = get_term((int) $id, 'product_cat');
            if ($term && !is_wp_error($term)) {
                $out[] = ['id' => (int) $term->term_id, 'name' => self::plain(html_entity_decode((string) $term->name, ENT_QUOTES, 'UTF-8'))];
            }
        }
        return $out;
    }

    /**
     * What only the API reads (store_product_read with internal; never
     * forwarded to a screen): the design key, the print product and each
     * option's print variant id.
     */
    private static function internal_of($product): array {
        $id = (int) $product->get_id();
        $variants = [];
        if ($product->is_type('variable')) {
            foreach ((array) $product->get_children() as $vid) {
                $pod = self::decode_json(get_post_meta((int) $vid, self::POD_META, true));
                $variants[] = ['variationId' => (int) $vid, 'printVariantId' => isset($pod['printful_variant_id']) ? (int) $pod['printful_variant_id'] : null];
            }
        } else {
            $pod = self::decode_json(get_post_meta($id, self::POD_META, true));
            if ($pod !== null) {
                $variants[] = ['variationId' => null, 'printVariantId' => isset($pod['printful_variant_id']) ? (int) $pod['printful_variant_id'] : null];
            }
        }
        $design = trim((string) get_post_meta($id, self::DESIGN_KEY_META, true));
        return [
            'designKey' => $design !== '' ? $design : null,
            'podProduct' => (object) (self::decode_json(get_post_meta($id, self::POD_PRODUCT_META, true)) ?? []),
            'variants' => $variants,
        ];
    }

    private static function decode_json($raw): ?array {
        if (is_array($raw)) {
            return $raw;
        }
        if (!is_string($raw) || $raw === '') {
            return null;
        }
        $value = json_decode($raw, true);
        return is_array($value) ? $value : null;
    }

    // ── store_product_update ────────────────────────────────────────────────

    public static function product_update($params = [], $step_id = null) {
        $product = self::product($params['product_id'] ?? null);
        $fields = $params['fields'] ?? null;
        if (!is_array($fields) || !$fields || array_keys($fields) === range(0, count($fields) - 1)) {
            throw self::error('VALIDATION', 'fields must name what changes.');
        }
        $sent = $params['floors'] ?? [];
        $floors = self::floors($sent);
        // The floors the API sends decide; without any, the ones the site keeps.
        if (($sent === [] || $sent === null) && class_exists('WebMaven_Pod_Guards')) {
            $floors = WebMaven_Pod_Guards::stored_floors($product);
        }
        $plan = self::product_plan($product, $fields, $floors, false);
        $before = self::touched($product, $plan);
        self::keep_floors($product, $sent === [] || $sent === null ? [] : $floors);
        $created = self::guarded_apply($product, $plan);
        $fresh = wc_get_product($product->get_id());
        $after = self::touched($fresh ? $fresh : $product, $plan);
        // A created variation: the undo patch removes it.
        foreach ($created as $variation) {
            $before['variations'][] = ['variationId' => $variation['variationId'], 'remove' => true];
            $after['variations'][] = $variation;
        }
        return [
            'product_id' => (int) $product->get_id(),
            'before' => (object) $before,
            'after' => (object) $after,
            'changed' => self::changed_keys($before, $after),
            'modifiedGmt' => self::modified_out(($fresh ? $fresh : $product)->get_date_modified('edit')),
        ];
    }

    // ── store_product_create ────────────────────────────────────────────────

    public static function product_create($params = [], $step_id = null) {
        self::require_store();
        $fields = $params['fields'] ?? null;
        if (!is_array($fields)) {
            throw self::error('VALIDATION', 'fields must describe the new product.');
        }
        $type = $fields['type'] ?? null;
        if (!in_array($type, self::PRODUCT_TYPES, true)) {
            throw self::error('VALIDATION', 'A new product is simple, variable or external.');
        }
        if (!isset($fields['name'])) {
            throw self::error('VALIDATION', 'A new product needs a name.');
        }
        unset($fields['type']);
        if (!isset($fields['status'])) {
            $fields['status'] = 'draft';
        }
        $class = ['simple' => 'WC_Product_Simple', 'variable' => 'WC_Product_Variable', 'external' => 'WC_Product_External'][$type];
        $product = new $class();
        $plan = self::product_plan($product, $fields, [], true);
        $id = (int) self::guarded_apply($product, $plan, true);
        if ($id <= 0) {
            throw self::error('WRITE_FAILED', 'The product could not be created.');
        }
        return [
            'product_id' => $id,
            'permalink' => (string) get_permalink($id),
            'status' => (string) get_post_status($id),
        ];
    }

    // ── store_product_trash ─────────────────────────────────────────────────

    public static function product_trash($params = [], $step_id = null) {
        $product = self::product($params['product_id'] ?? null);
        $id = (int) $product->get_id();
        $status = self::trash_or_restore($id, !empty($params['restore']));
        if (function_exists('wc_delete_product_transients')) {
            wc_delete_product_transients($id);
        }
        return ['product_id' => $id, 'status' => $status];
    }

    // ── The product plan: every field checked before anything is written ───

    /**
     * Reads ProductFields into a plan the apply step follows: the product's
     * own fields, categories, tags, card text, the sample marker, and per
     * variation patches. Throws on the first refusal; writes nothing.
     */
    private static function product_plan($product, array $fields, array $floors, bool $creating): array {
        foreach (array_keys($fields) as $key) {
            if (!in_array($key, self::PRODUCT_FIELDS, true)) {
                throw self::error('VALIDATION', 'Unknown product field: ' . self::plain((string) $key) . '.');
            }
        }
        $id = (int) $product->get_id();
        $printed = !$creating && self::is_printed($id);
        $variable = $product->is_type('variable');
        $external = $product->is_type('external');
        $name = $creating ? 'the new product' : '"' . self::plain((string) $product->get_name('edit')) . '"';

        if (!$creating && isset($fields['baseModified'])) {
            self::refuse_if_changed_since($fields['baseModified'], $product->get_date_modified('edit'), $name);
        }

        // A printed product is made to order from fixed options.
        if ($printed) {
            foreach (['attributes', 'newVariations'] as $key) {
                if (array_key_exists($key, $fields)) {
                    throw self::error('POD_OPTIONS_LOCKED', 'The options of a printed product are set by what can be printed, so ' . $name . ' keeps its options.');
                }
            }
            foreach (self::MADE_TO_ORDER_FIELDS as $key) {
                if (array_key_exists($key, $fields)) {
                    throw self::error('POD_MADE_TO_ORDER', 'A printed product is made to order, so ' . $name . ' has no stock, weight or size to set.');
                }
            }
            if (is_array($fields['allVariations'] ?? null) && array_key_exists('stockStatus', $fields['allVariations'])) {
                throw self::error('POD_MADE_TO_ORDER', 'A printed product is made to order, so its options are never out of stock.');
            }
        }
        $plan = [
            'id' => $id,
            'printed' => $printed,
            'product' => [],
            'categories' => null,
            'new_categories' => [],
            'tags' => null,
            'card_slots' => [],
            'clear_sample' => false,
            'variations' => [],
            'remove' => [],
            'floors' => $floors,
            'implicit' => [],
            'attributes' => null,
            'to_type' => null,
            'new_variations' => [],
        ];

        // The options of an own product: the attribute set, and the type it gives the product.
        $variable_after = $variable;
        if (array_key_exists('attributes', $fields)) {
            $plan['attributes'] = self::attributes_plan($product, $fields['attributes']);
            $for_variations = (bool) array_filter($plan['attributes'], function ($attribute) {
                return $attribute['variation'];
            });
            if ($for_variations && !$variable) {
                if (!$product->is_type('simple')) {
                    throw self::error('VALIDATION', 'Only a product sold here can have options for variations.');
                }
                $plan['to_type'] = 'variable';
                $variable_after = true;
            } elseif (!$for_variations && $variable) {
                $children = array_map('intval', (array) $product->get_children());
                if (array_diff($children, self::removals($fields))) {
                    throw self::error('VALIDATION', 'Remove the variations of ' . $name . ' in the same change, or keep an option used for variations.');
                }
                $plan['to_type'] = 'simple';
                $variable_after = false;
            }
        }
        if (array_key_exists('newVariations', $fields) && !$variable_after) {
            throw self::error('VALIDATION', 'Add an option used for variations to ' . $name . ' first, then its variations.');
        }

        // Plain text and HTML.
        if (array_key_exists('name', $fields)) {
            $plan['product']['name'] = self::plain_text($fields['name'], 'The product name', 1, 200);
        }
        if (array_key_exists('shortDescription', $fields)) {
            $plan['product']['shortDescription'] = self::html($fields['shortDescription'], 'The short description', 2000);
        }
        if (array_key_exists('description', $fields)) {
            $plan['product']['description'] = self::html($fields['description'], 'The description', 30000);
        }
        if (array_key_exists('purchaseNote', $fields)) {
            $plan['product']['purchaseNote'] = self::html($fields['purchaseNote'], 'The purchase note', 5000);
        }
        if (array_key_exists('status', $fields)) {
            $plan['product']['status'] = self::one_of($fields['status'], self::PRODUCT_STATUSES, 'status');
        }
        if (array_key_exists('catalogVisibility', $fields)) {
            $plan['product']['catalogVisibility'] = self::one_of($fields['catalogVisibility'], ['visible', 'catalog', 'search', 'hidden'], 'catalogVisibility');
        }
        if (array_key_exists('featured', $fields)) {
            $plan['product']['featured'] = self::boolean($fields['featured'], 'featured');
        }
        if (array_key_exists('sku', $fields)) {
            $plan['product']['sku'] = self::sku($fields['sku'], $id);
        }
        if (array_key_exists('backorders', $fields)) {
            $plan['product']['backorders'] = self::one_of($fields['backorders'], ['no', 'notify', 'yes'], 'backorders');
        }
        if (array_key_exists('manageStock', $fields)) {
            $plan['product']['manageStock'] = self::boolean($fields['manageStock'], 'manageStock');
        }
        if (array_key_exists('stockQuantity', $fields)) {
            $plan['product']['stockQuantity'] = self::quantity($fields['stockQuantity'], 'stockQuantity');
        }
        if (array_key_exists('stockStatus', $fields)) {
            $plan['product']['stockStatus'] = self::one_of($fields['stockStatus'], self::STOCK_STATUSES, 'stockStatus');
        }
        if (array_key_exists('virtual', $fields)) {
            $plan['product']['virtual'] = self::boolean($fields['virtual'], 'virtual');
        }
        if (array_key_exists('weight', $fields)) {
            $plan['product']['weight'] = self::measure($fields['weight'], 'weight');
        }
        if (array_key_exists('dimensions', $fields)) {
            if (!is_array($fields['dimensions'])) {
                throw self::error('VALIDATION', 'dimensions holds length, width and height.');
            }
            $dimensions = [];
            foreach ($fields['dimensions'] as $key => $value) {
                if (!in_array($key, ['length', 'width', 'height'], true)) {
                    throw self::error('VALIDATION', 'Unknown dimension: ' . self::plain((string) $key) . '.');
                }
                $dimensions[$key] = self::measure($value, $key);
            }
            $plan['product']['dimensions'] = $dimensions;
        }

        // Media.
        if (array_key_exists('featuredMediaId', $fields)) {
            $plan['product']['featuredMediaId'] = $fields['featuredMediaId'] === null ? null : self::image_id($fields['featuredMediaId']);
        }
        if (array_key_exists('galleryMediaIds', $fields)) {
            if (!is_array($fields['galleryMediaIds']) || count($fields['galleryMediaIds']) > 50) {
                throw self::error('VALIDATION', 'galleryMediaIds is a list of at most 50 images.');
            }
            $plan['product']['galleryMediaIds'] = array_values(array_unique(array_map([__CLASS__, 'image_id'], $fields['galleryMediaIds'])));
        }

        // External products.
        foreach (['externalUrl', 'buttonText'] as $key) {
            if (array_key_exists($key, $fields) && !$external) {
                throw self::error('VALIDATION', 'Only an external product has ' . ($key === 'externalUrl' ? 'a link to another shop' : 'a button text') . '.');
            }
        }
        if (array_key_exists('externalUrl', $fields)) {
            $url = is_string($fields['externalUrl']) ? trim($fields['externalUrl']) : '';
            if (!preg_match('~^https?://[^\s/]+~i', $url) || esc_url_raw($url) === '') {
                throw self::error('VALIDATION', 'The external link must be a web address (http or https).');
            }
            $plan['product']['externalUrl'] = esc_url_raw($url);
        }
        if (array_key_exists('buttonText', $fields)) {
            $plan['product']['buttonText'] = self::plain_text($fields['buttonText'], 'The button text', 0, 100);
        }

        // Categories and tags.
        if (array_key_exists('categoryIds', $fields)) {
            if (!is_array($fields['categoryIds'])) {
                throw self::error('VALIDATION', 'categoryIds is a list of category ids.');
            }
            $ids = [];
            foreach ($fields['categoryIds'] as $raw) {
                $term_id = self::positive_int($raw);
                $term = $term_id > 0 ? get_term($term_id, 'product_cat') : null;
                if (!$term || is_wp_error($term)) {
                    throw self::error('NOT_FOUND', 'Product category ' . $term_id . ' was not found.');
                }
                $ids[] = $term_id;
            }
            $plan['categories'] = array_values(array_unique($ids));
        }
        if (array_key_exists('newCategories', $fields)) {
            $plan['new_categories'] = self::names($fields['newCategories'], 'newCategories');
            if ($plan['categories'] === null) {
                $plan['categories'] = array_map('intval', (array) $product->get_category_ids('edit'));
            }
        }
        if (array_key_exists('tags', $fields)) {
            $plan['tags'] = self::names($fields['tags'], 'tags');
        }

        // The designed card's own text: only the slots the card already has.
        if (array_key_exists('cardSlots', $fields)) {
            if (!is_array($fields['cardSlots'])) {
                throw self::error('VALIDATION', 'cardSlots maps each card text to its new words.');
            }
            $existing = self::card_slots($id);
            foreach ($fields['cardSlots'] as $key => $value) {
                $key = (string) $key;
                if (!array_key_exists($key, $existing)) {
                    throw self::error('VALIDATION', 'The product card has no text named ' . self::plain($key) . '.');
                }
                if (!is_string($value) || strlen($value) > 500) {
                    throw self::error('VALIDATION', 'A card text is at most 500 characters.');
                }
                $plan['card_slots'][$key] = sanitize_text_field($value);
            }
        }
        if (array_key_exists('sample', $fields)) {
            if ($fields['sample'] !== false) {
                throw self::error('VALIDATION', 'sample only takes false: the owner made the listing real.');
            }
            $plan['clear_sample'] = true;
        }

        // Prices and sale dates of the product itself.
        $decimals = self::decimals();
        foreach (['regularPrice', 'salePrice', 'saleSchedule'] as $key) {
            if (array_key_exists($key, $fields) && $variable_after) {
                throw self::error('VALIDATION', 'This product has options, so its prices are set per option (allVariations or variations).');
            }
        }
        if (array_key_exists('regularPrice', $fields)) {
            $plan['product']['regularPrice'] = self::decimal($fields['regularPrice'], 'The regular price', $decimals);
        }
        if (array_key_exists('salePrice', $fields)) {
            $plan['product']['salePrice'] = $fields['salePrice'] === null ? null : self::decimal($fields['salePrice'], 'The sale price', $decimals);
        }
        if (array_key_exists('saleSchedule', $fields)) {
            $plan['product']['saleSchedule'] = self::schedule($fields['saleSchedule']);
        } elseif (array_key_exists('salePrice', $fields) && $fields['salePrice'] === null && !$creating) {
            // Ending the sale ends its schedule too.
            $schedule = self::product_value($product, 'saleSchedule');
            if ($schedule['from'] !== null || $schedule['to'] !== null) {
                $plan['product']['saleSchedule'] = ['from' => null, 'to' => null];
                $plan['implicit'][] = 'saleSchedule';
            }
        }
        if (array_key_exists('regularPrice', $fields) || array_key_exists('salePrice', $fields)) {
            $regular = array_key_exists('regularPrice', $plan['product']) ? $plan['product']['regularPrice'] : self::price_out($product->get_regular_price('edit'));
            $sale = array_key_exists('salePrice', $plan['product']) ? $plan['product']['salePrice'] : self::price_out($product->get_sale_price('edit'));
            self::refuse_bad_sale($regular, $sale, $name);
            self::refuse_under_floor($floors[0] ?? null, [$regular, $sale], self::plain((string) ($plan['product']['name'] ?? $product->get_name('edit'))), $decimals);
        }

        // Variations.
        foreach (['allVariations', 'variations'] as $key) {
            if (array_key_exists($key, $fields) && !$variable) {
                throw self::error('VALIDATION', 'This product has no options.');
            }
        }
        if ($variable && (array_key_exists('allVariations', $fields) || array_key_exists('variations', $fields))) {
            self::plan_variations($product, $fields, $plan, $decimals);
        }

        // A simple product turning variable: its own prices move to the variations.
        if ($plan['to_type'] === 'variable') {
            foreach (['regularPrice', 'salePrice'] as $key) {
                if (!array_key_exists($key, $plan['product']) && self::product_value($product, $key) !== null) {
                    $plan['product'][$key] = null;
                    $plan['implicit'][] = $key;
                }
            }
        }
        if ($plan['attributes'] !== null && $variable && $plan['to_type'] === null) {
            self::refuse_orphaned_variations($product, $plan);
        }
        if (array_key_exists('newVariations', $fields)) {
            self::plan_new_variations($product, $fields['newVariations'], $plan, $decimals);
        }

        return $plan;
    }

    /** The variation ids a patch removes (variations[].remove). */
    private static function removals(array $fields): array {
        $out = [];
        foreach (is_array($fields['variations'] ?? null) ? $fields['variations'] : [] as $entry) {
            if (is_array($entry) && ($entry['remove'] ?? null) === true) {
                $out[] = self::positive_int($entry['variationId'] ?? null);
            }
        }
        return $out;
    }

    /**
     * ProductAttributeInput[] read into the attribute set to write. An
     * attribute the product has from a global attribute (pa_color) stays one,
     * its values as terms; any other is the product's own.
     */
    private static function attributes_plan($product, $raw): array {
        if (!is_array($raw) || count($raw) > self::MAX_ATTRIBUTES) {
            throw self::error('VALIDATION', 'attributes is a list of at most ' . self::MAX_ATTRIBUTES . ' options.');
        }
        $current = [];
        foreach ((array) $product->get_attributes('edit') as $attribute) {
            if (is_object($attribute) && method_exists($attribute, 'get_name')) {
                $current[self::lower(self::attribute_label($attribute))] = $attribute;
            }
        }
        $out = [];
        $names = [];
        $keys = [];
        foreach (array_values($raw) as $position => $entry) {
            if (!is_array($entry)) {
                throw self::error('VALIDATION', 'Each option has a name, its values and whether variations use it.');
            }
            foreach (array_keys($entry) as $key) {
                if (!in_array($key, self::ATTRIBUTE_FIELDS, true)) {
                    throw self::error('VALIDATION', 'Unknown option field: ' . self::plain((string) $key) . '.');
                }
            }
            $name = self::plain_text($entry['name'] ?? null, 'An option name', 1, 100);
            if (isset($names[self::lower($name)])) {
                throw self::error('VALIDATION', 'Two options are named "' . self::plain($name) . '".');
            }
            $names[self::lower($name)] = true;
            if (!is_array($entry['options'] ?? null) || !$entry['options'] || count($entry['options']) > self::MAX_ATTRIBUTE_VALUES) {
                throw self::error('VALIDATION', 'The option "' . self::plain($name) . '" has 1 to ' . self::MAX_ATTRIBUTE_VALUES . ' values.');
            }
            $values = [];
            foreach ($entry['options'] as $value) {
                $value = self::plain_text($value, 'A value of "' . self::plain($name) . '"', 1, 200);
                if (strpos($value, '|') !== false) {
                    throw self::error('VALIDATION', 'A value cannot hold "|": ' . self::plain($value) . '.');
                }
                $values[self::lower($value)] = $value;
            }
            $existing = $current[self::lower($name)] ?? null;
            $taxonomy = is_object($existing) && method_exists($existing, 'is_taxonomy') && $existing->is_taxonomy() ? (string) $existing->get_name() : null;
            $key = $taxonomy !== null ? $taxonomy : sanitize_title($name);
            if ($key === '' || isset($keys[$key])) {
                throw self::error('VALIDATION', 'The option name "' . self::plain($name) . '" needs letters or numbers of its own.');
            }
            $keys[$key] = true;
            $out[] = [
                'name' => $name,
                'options' => array_values($values),
                'variation' => self::boolean($entry['variation'] ?? null, 'variation'),
                'visible' => array_key_exists('visible', $entry) ? self::boolean($entry['visible'], 'visible') : true,
                'taxonomy' => $taxonomy,
                'id' => $taxonomy !== null && method_exists($existing, 'get_id') ? (int) $existing->get_id() : 0,
                'key' => $key,
                'position' => $position,
            ];
        }
        return $out;
    }

    /** VALIDATION when a variation that stays would use a value or an option the change takes away. */
    private static function refuse_orphaned_variations($product, array $plan): void {
        $by_key = [];
        foreach ($plan['attributes'] as $attribute) {
            if ($attribute['variation']) {
                $by_key[$attribute['key']] = $attribute;
            }
        }
        foreach (array_map('intval', (array) $product->get_children()) as $vid) {
            if (in_array($vid, $plan['remove'], true)) {
                continue;
            }
            $variation = wc_get_product($vid);
            if (!$variation) {
                continue;
            }
            foreach ((array) $variation->get_attributes('edit') as $key => $value) {
                $value = (string) $value;
                if ($value === '') {
                    continue; // any value
                }
                $attribute = $by_key[(string) $key] ?? null;
                if ($attribute === null || self::attribute_value($attribute, $value) === null) {
                    throw self::error('VALIDATION', '"' . self::plain((string) $variation->get_name('edit')) . '" uses an option value this change takes away. Remove that variation in the same change, or keep its value.');
                }
            }
        }
    }

    /** The value of an attribute a stored variation value (a text, or a term slug) names, or null. */
    private static function attribute_value(array $attribute, string $stored): ?string {
        foreach ($attribute['options'] as $option) {
            if (self::lower($option) === self::lower($stored) || sanitize_title($option) === sanitize_title($stored)) {
                return $option;
            }
        }
        if ($attribute['taxonomy'] !== null && function_exists('get_term_by')) {
            $term = get_term_by('slug', $stored, $attribute['taxonomy']);
            if ($term && !is_wp_error($term)) {
                foreach ($attribute['options'] as $option) {
                    if (self::lower($option) === self::lower((string) $term->name)) {
                        return $option;
                    }
                }
            }
        }
        return null;
    }

    /** newVariations, each checked: one value per attribute used for variations, no combination twice. */
    private static function plan_new_variations($product, $raw, array &$plan, int $decimals): void {
        if (!is_array($raw) || count($raw) > self::MAX_NEW_VARIATIONS) {
            throw self::error('VALIDATION', 'newVariations is a list of at most ' . self::MAX_NEW_VARIATIONS . ' variations.');
        }
        $attributes = $plan['attributes'];
        if ($attributes === null) {
            $attributes = [];
            foreach ((array) $product->get_attributes('edit') as $key => $attribute) {
                if (!is_object($attribute) || !method_exists($attribute, 'get_options')) {
                    continue;
                }
                $snapshot = self::attributes_snapshot_of($attribute);
                $attributes[] = $snapshot + ['key' => (string) $key];
            }
        }
        $by_name = [];
        foreach ($attributes as $attribute) {
            if ($attribute['variation']) {
                $by_name[self::lower($attribute['name'])] = $attribute;
            }
        }
        // The combinations already there (the variations that stay).
        $seen = [];
        foreach (array_map('intval', (array) $product->get_children()) as $vid) {
            if (in_array($vid, $plan['remove'], true)) {
                continue;
            }
            $variation = wc_get_product($vid);
            if ($variation) {
                $seen[self::combination((array) $variation->get_attributes('edit'))] = true;
            }
        }
        foreach ($raw as $entry) {
            if (!is_array($entry)) {
                throw self::error('VALIDATION', 'Each new variation names its options and its price.');
            }
            foreach (array_keys($entry) as $key) {
                if (!in_array($key, self::NEW_VARIATION_FIELDS, true)) {
                    throw self::error('VALIDATION', 'Unknown variation field: ' . self::plain((string) $key) . '.');
                }
            }
            if (!is_array($entry['options'] ?? null) || !$entry['options']) {
                throw self::error('VALIDATION', 'Each new variation names its value for every option used for variations.');
            }
            $values = [];
            $labels = [];
            foreach ($entry['options'] as $name => $value) {
                $attribute = $by_name[self::lower((string) $name)] ?? null;
                if ($attribute === null) {
                    throw self::error('VALIDATION', '"' . self::plain((string) $name) . '" is not an option used for variations.');
                }
                $match = is_string($value) ? self::attribute_value($attribute, $value) : null;
                if ($match === null) {
                    throw self::error('VALIDATION', '"' . self::plain(is_string($value) ? $value : '') . '" is not a value of "' . self::plain($attribute['name']) . '".');
                }
                $values[$attribute['key']] = $match;
                $labels[$attribute['name']] = $match;
            }
            if (count($values) !== count($by_name)) {
                throw self::error('VALIDATION', 'Each new variation names one value for every option used for variations: ' . implode(', ', array_map(function ($a) {
                    return self::plain($a['name']);
                }, array_values($by_name))) . '.');
            }
            $combination = self::combination($values);
            if (isset($seen[$combination])) {
                throw self::error('VALIDATION', 'Two variations would have the same options: ' . self::plain(implode(', ', $labels)) . '.');
            }
            $seen[$combination] = true;
            $regular = self::decimal($entry['regularPrice'] ?? null, 'The regular price', $decimals);
            $sale = array_key_exists('salePrice', $entry) && $entry['salePrice'] !== null ? self::decimal($entry['salePrice'], 'The sale price', $decimals) : null;
            self::refuse_bad_sale($regular, $sale, '"' . self::plain(implode(', ', $labels)) . '"');
            $taxonomies = [];
            foreach ($attributes as $attribute) {
                if (isset($values[$attribute['key']])) {
                    $taxonomies[$attribute['key']] = $attribute['taxonomy'] ?? null;
                }
            }
            $plan['new_variations'][] = [
                'values' => $values,
                'taxonomies' => $taxonomies,
                'options' => $labels,
                'regularPrice' => $regular,
                'salePrice' => $sale,
                'stockStatus' => array_key_exists('stockStatus', $entry) ? self::one_of($entry['stockStatus'], self::STOCK_STATUSES, 'stockStatus') : 'instock',
                'mediaId' => isset($entry['mediaId']) && $entry['mediaId'] !== null ? self::image_id($entry['mediaId']) : null,
            ];
        }
    }

    /** An existing attribute in the plan's shape (name, options, variation, taxonomy). */
    private static function attributes_snapshot_of($attribute): array {
        $taxonomy = method_exists($attribute, 'is_taxonomy') && $attribute->is_taxonomy();
        $options = [];
        foreach ((array) $attribute->get_options() as $option) {
            if ($taxonomy) {
                $term = get_term((int) $option, $attribute->get_name());
                if ($term && !is_wp_error($term)) {
                    $options[] = (string) $term->name;
                }
            } else {
                $options[] = (string) $option;
            }
        }
        return [
            'name' => self::attribute_label($attribute),
            'options' => $options,
            'variation' => (bool) $attribute->get_variation(),
            'taxonomy' => $taxonomy ? (string) $attribute->get_name() : null,
        ];
    }

    /** A variation's combination, whatever the case or the slug form of its values. */
    private static function combination(array $values): string {
        $out = [];
        foreach ($values as $key => $value) {
            $out[sanitize_title(preg_replace('/^attribute_/', '', (string) $key))] = sanitize_title((string) $value);
        }
        ksort($out);
        return (string) wp_json_encode($out);
    }

    private static function lower(string $value): string {
        return function_exists('mb_strtolower') ? mb_strtolower(trim($value), 'UTF-8') : strtolower(trim($value));
    }

    /** allVariations and variations, read into per-variation patches, with their checks. */
    private static function plan_variations($product, array $fields, array &$plan, int $decimals) {
        $children = array_map('intval', (array) $product->get_children());
        $patches = [];

        if (array_key_exists('allVariations', $fields)) {
            $all = $fields['allVariations'];
            if (!is_array($all) || !$all) {
                throw self::error('VALIDATION', 'allVariations names what changes on every option.');
            }
            $patch = [];
            foreach ($all as $key => $value) {
                if (!in_array($key, self::ALL_VARIATIONS_FIELDS, true)) {
                    throw self::error('VALIDATION', 'Unknown field for every option: ' . self::plain((string) $key) . '.');
                }
                if ($key === 'regularPrice') {
                    $patch['regularPrice'] = self::decimal($value, 'The regular price', $decimals);
                } elseif ($key === 'salePrice') {
                    $patch['salePrice'] = $value === null ? null : self::decimal($value, 'The sale price', $decimals);
                } elseif ($key === 'saleSchedule') {
                    $patch['saleSchedule'] = self::schedule($value);
                } else {
                    $patch['stockStatus'] = self::one_of($value, ['instock', 'outofstock'], 'stockStatus');
                }
            }
            foreach ($children as $vid) {
                $patches[$vid] = $patch;
            }
        }

        if (array_key_exists('variations', $fields)) {
            if (!is_array($fields['variations'])) {
                throw self::error('VALIDATION', 'variations is a list of option changes.');
            }
            foreach ($fields['variations'] as $entry) {
                if (!is_array($entry)) {
                    throw self::error('VALIDATION', 'Each option change names its variationId.');
                }
                foreach (array_keys($entry) as $key) {
                    if (!in_array($key, self::VARIATION_FIELDS, true)) {
                        throw self::error('VALIDATION', 'Unknown option field: ' . self::plain((string) $key) . '.');
                    }
                }
                $vid = self::positive_int($entry['variationId'] ?? null);
                if (!in_array($vid, $children, true)) {
                    throw self::error('NOT_FOUND', 'Option ' . $vid . ' is not an option of this product.');
                }
                if ($plan['printed']) {
                    if (!empty($entry['remove'])) {
                        throw self::error('POD_OPTIONS_LOCKED', 'The options of a printed product are set by what can be printed, so none can be removed. Turn it off instead.');
                    }
                    foreach (['manageStock', 'stockQuantity', 'stockStatus'] as $key) {
                        if (array_key_exists($key, $entry)) {
                            throw self::error('POD_MADE_TO_ORDER', 'A printed product is made to order, so its options have no stock to set.');
                        }
                    }
                }
                if (array_key_exists('remove', $entry)) {
                    if ($entry['remove'] !== true) {
                        throw self::error('VALIDATION', 'remove only takes true.');
                    }
                    $plan['remove'][] = $vid;
                    unset($patches[$vid]);
                    continue;
                }
                $patch = $patches[$vid] ?? [];
                if (array_key_exists('enabled', $entry)) {
                    $patch['enabled'] = self::boolean($entry['enabled'], 'enabled');
                }
                if (array_key_exists('regularPrice', $entry)) {
                    $patch['regularPrice'] = self::decimal($entry['regularPrice'], 'The regular price', $decimals);
                }
                if (array_key_exists('salePrice', $entry)) {
                    $patch['salePrice'] = $entry['salePrice'] === null ? null : self::decimal($entry['salePrice'], 'The sale price', $decimals);
                }
                if (array_key_exists('saleSchedule', $entry)) {
                    $patch['saleSchedule'] = self::schedule($entry['saleSchedule']);
                }
                if (array_key_exists('sku', $entry)) {
                    $patch['sku'] = self::sku($entry['sku'], $vid);
                }
                if (array_key_exists('manageStock', $entry)) {
                    $patch['manageStock'] = self::boolean($entry['manageStock'], 'manageStock');
                }
                if (array_key_exists('stockQuantity', $entry)) {
                    $patch['stockQuantity'] = self::quantity($entry['stockQuantity'], 'stockQuantity');
                }
                if (array_key_exists('stockStatus', $entry)) {
                    $patch['stockStatus'] = self::one_of($entry['stockStatus'], self::STOCK_STATUSES, 'stockStatus');
                }
                if (array_key_exists('mediaId', $entry)) {
                    $patch['mediaId'] = $entry['mediaId'] === null ? null : self::image_id($entry['mediaId']);
                }
                $patches[$vid] = $patch;
            }
        }
        $plan['remove'] = array_values(array_unique($plan['remove']));

        // Ending an option's sale ends its dates too, as on the product itself.
        foreach ($patches as $vid => $patch) {
            if (array_key_exists('salePrice', $patch) && $patch['salePrice'] === null && !array_key_exists('saleSchedule', $patch)) {
                $variation = wc_get_product($vid);
                if ($variation) {
                    $dates = self::variation_value($variation, 'saleSchedule');
                    if ($dates['from'] !== null || $dates['to'] !== null) {
                        $patches[$vid]['saleSchedule'] = ['from' => null, 'to' => null];
                    }
                }
            }
        }

        // Every resulting price: a sale under its regular price, nothing under its floor.
        $enabled = 0;
        foreach ($children as $vid) {
            if (in_array($vid, $plan['remove'], true)) {
                continue;
            }
            $variation = wc_get_product($vid);
            if (!$variation) {
                continue;
            }
            $patch = $patches[$vid] ?? [];
            $on = array_key_exists('enabled', $patch) ? $patch['enabled'] : $variation->get_status('edit') === 'publish';
            if ($on) {
                $enabled++;
            }
            if (array_key_exists('regularPrice', $patch) || array_key_exists('salePrice', $patch)) {
                $regular = array_key_exists('regularPrice', $patch) ? $patch['regularPrice'] : self::price_out($variation->get_regular_price('edit'));
                $sale = array_key_exists('salePrice', $patch) ? $patch['salePrice'] : self::price_out($variation->get_sale_price('edit'));
                $label = self::plain((string) $variation->get_name('edit'));
                self::refuse_bad_sale($regular, $sale, '"' . $label . '"');
                $floor = $plan['floors'][$vid] ?? ($plan['floors'][0] ?? null);
                self::refuse_under_floor($floor, [$regular, $sale], $label, $decimals);
            }
        }
        if ($plan['printed'] && $children && $enabled === 0) {
            throw self::error('POD_OPTIONS_LOCKED', 'A printed product keeps at least one option on sale.');
        }
        $plan['variations'] = $patches;
    }

    // ── Applying a plan ─────────────────────────────────────────────────────

    /**
     * Applies a plan the checks passed (they used the floors this command
     * reads), with the WooCommerce doors' own floor and options checks
     * standing aside: they would only say again what was checked here.
     * Answers the variations created (a new product: its id).
     */
    private static function guarded_apply($product, array $plan, bool $answer_id = false) {
        $apply = function () use ($product, $plan, $answer_id) {
            $created = self::apply_product_plan($product, $plan);
            return $answer_id ? (int) $product->get_id() : $created;
        };
        return class_exists('WebMaven_Pod_Guards') ? WebMaven_Pod_Guards::trusted($apply) : $apply();
    }

    /** Keeps the floors the API sent (store currency only) on a printed product and its options. */
    private static function keep_floors($product, array $floors): void {
        $id = (int) $product->get_id();
        if (!$floors || !class_exists('WebMaven_Pod_Guards') || !self::is_printed($id)) {
            return;
        }
        $children = $product->is_type('variable') ? array_map('intval', (array) $product->get_children()) : [];
        foreach ($floors as $vid => $minor) {
            $target = (int) $vid === 0 ? $id : (int) $vid;
            if ($target === $id || in_array($target, $children, true)) {
                WebMaven_Pod_Guards::write_floor($target, (int) $minor, self::currency());
            }
        }
    }

    private static function apply_product_plan($product, array $plan) {
        // A change of type: the same product, loaded into the class of its new type (WooCommerce rewrites its type on save).
        if (!empty($plan['to_type'])) {
            $class = $plan['to_type'] === 'variable' ? 'WC_Product_Variable' : 'WC_Product_Simple';
            $product = new $class((int) $product->get_id());
        }
        try {
            if ($plan['attributes'] !== null) {
                $product->set_attributes(self::build_attributes($plan['attributes']));
            }
            foreach (self::PRODUCT_LEVEL_FIELDS as $field) {
                if (array_key_exists($field, $plan['product'])) {
                    self::set_product_value($product, $field, $plan['product'][$field]);
                }
            }
            if ($plan['categories'] !== null) {
                $ids = $plan['categories'];
                foreach ($plan['new_categories'] as $name) {
                    $ids[] = self::term_id_for($name, 'product_cat');
                }
                $product->set_category_ids(array_values(array_unique(array_filter($ids))));
            }
            if ($plan['tags'] !== null) {
                $tag_ids = [];
                foreach ($plan['tags'] as $name) {
                    $tag_ids[] = self::term_id_for($name, 'product_tag');
                }
                $product->set_tag_ids(array_values(array_unique(array_filter($tag_ids))));
            }
            foreach ($plan['card_slots'] as $key => $value) {
                $product->update_meta_data(self::CARD_SLOT_PREFIX . $key, $value);
            }
            // A change to the options alone saves the options; WooCommerce
            // then syncs (and saves) the product itself, once.
            $touches_product = $plan['product'] || $plan['categories'] !== null || $plan['tags'] !== null || $plan['card_slots']
                || $plan['attributes'] !== null || !empty($plan['to_type']);
            if ($touches_product || (int) $product->get_id() <= 0) {
                $product->save();
            }
        } catch (\Exception $e) {
            if (strpos($e->getMessage(), ': ') !== false && preg_match('/^[A-Z_]+: /', $e->getMessage())) {
                throw $e;
            }
            throw self::error('VALIDATION', self::plain(wp_strip_all_tags($e->getMessage())));
        }
        $id = (int) $product->get_id();
        if ($plan['clear_sample']) {
            delete_post_meta($id, self::SAMPLE_META);
        }

        foreach ($plan['variations'] as $vid => $patch) {
            if (!$patch) {
                continue;
            }
            $variation = wc_get_product($vid);
            if (!$variation) {
                continue;
            }
            try {
                foreach ($patch as $field => $value) {
                    self::set_variation_value($variation, $field, $value);
                }
                $variation->save();
            } catch (\Exception $e) {
                throw self::error('VALIDATION', self::plain(wp_strip_all_tags($e->getMessage())));
            }
        }
        foreach ($plan['remove'] as $vid) {
            $variation = wc_get_product($vid);
            if ($variation) {
                $variation->delete(true);
            }
        }
        $created = self::create_variations($id, $plan['new_variations']);
        $variable_now = ($plan['to_type'] ?? null) !== 'simple' && ($plan['to_type'] === 'variable' || $product->is_type('variable'));
        if ($variable_now && ($plan['variations'] || $plan['remove'] || $created || !empty($plan['to_type']))
            && class_exists('WC_Product_Variable') && method_exists('WC_Product_Variable', 'sync')) {
            WC_Product_Variable::sync($id);
        }
        if (function_exists('wc_delete_product_transients')) {
            wc_delete_product_transients($id);
        }
        return $created;
    }

    /** WC_Product_Attribute objects of a planned attribute set (a global attribute's values as its terms). */
    private static function build_attributes(array $planned): array {
        $out = [];
        foreach ($planned as $entry) {
            $attribute = new WC_Product_Attribute();
            if ($entry['taxonomy'] !== null) {
                $attribute->set_id((int) $entry['id']);
                $attribute->set_name($entry['taxonomy']);
                $terms = [];
                foreach ($entry['options'] as $value) {
                    $terms[] = self::term_id_for($value, $entry['taxonomy']);
                }
                $attribute->set_options($terms);
            } else {
                $attribute->set_id(0);
                $attribute->set_name($entry['name']);
                $attribute->set_options($entry['options']);
            }
            $attribute->set_position((int) $entry['position']);
            $attribute->set_visible((bool) $entry['visible']);
            $attribute->set_variation((bool) $entry['variation']);
            $out[$entry['key']] = $attribute;
        }
        return $out;
    }

    /** The planned new variations, created on sale; what each one is (the after side of the answer). */
    private static function create_variations(int $product_id, array $planned): array {
        $created = [];
        foreach ($planned as $entry) {
            $attributes = [];
            foreach ($entry['values'] as $key => $value) {
                $taxonomy = $entry['taxonomies'][$key] ?? null;
                if ($taxonomy !== null && function_exists('get_term_by')) {
                    $term = get_term_by('name', $value, $taxonomy);
                    $attributes[$key] = $term && !is_wp_error($term) ? (string) $term->slug : sanitize_title($value);
                } else {
                    $attributes[$key] = $value;
                }
            }
            try {
                $variation = new WC_Product_Variation();
                $variation->set_parent_id($product_id);
                $variation->set_attributes($attributes);
                $variation->set_regular_price($entry['regularPrice']);
                $variation->set_sale_price($entry['salePrice'] === null ? '' : $entry['salePrice']);
                $variation->set_stock_status($entry['stockStatus']);
                $variation->set_image_id($entry['mediaId'] === null ? '' : $entry['mediaId']);
                $variation->set_status('publish');
                $variation_id = (int) $variation->save();
            } catch (\Exception $e) {
                throw self::error('VALIDATION', self::plain(wp_strip_all_tags($e->getMessage())));
            }
            if ($variation_id <= 0) {
                throw self::error('WRITE_FAILED', 'A new variation could not be created.');
            }
            $created[] = [
                'variationId' => $variation_id,
                'options' => (object) $entry['options'],
                'enabled' => true,
                'regularPrice' => $entry['regularPrice'],
                'salePrice' => $entry['salePrice'],
                'stockStatus' => $entry['stockStatus'],
                'mediaId' => $entry['mediaId'],
            ];
        }
        return $created;
    }

    private static function set_product_value($product, string $field, $value) {
        switch ($field) {
            case 'name': $product->set_name($value); break;
            case 'shortDescription': $product->set_short_description($value); break;
            case 'description': $product->set_description($value); break;
            case 'status': $product->set_status($value); break;
            case 'catalogVisibility': $product->set_catalog_visibility($value); break;
            case 'featured': $product->set_featured($value); break;
            case 'sku': $product->set_sku($value); break;
            case 'regularPrice': $product->set_regular_price($value === null ? '' : $value); break;
            case 'salePrice': $product->set_sale_price($value === null ? '' : $value); break;
            case 'saleSchedule':
                $product->set_date_on_sale_from($value['from'] === null ? '' : $value['from']);
                $product->set_date_on_sale_to($value['to'] === null ? '' : $value['to']);
                break;
            case 'manageStock': $product->set_manage_stock($value); break;
            // WooCommerce clears the quantity on '' (null would store 0).
            case 'stockQuantity': $product->set_stock_quantity($value === null ? '' : $value); break;
            case 'stockStatus': $product->set_stock_status($value); break;
            case 'backorders': $product->set_backorders($value); break;
            case 'virtual': $product->set_virtual($value); break;
            case 'weight': $product->set_weight($value); break;
            case 'dimensions':
                foreach ($value as $key => $measure) {
                    $product->{'set_' . $key}($measure);
                }
                break;
            case 'featuredMediaId': $product->set_image_id($value === null ? '' : $value); break;
            case 'galleryMediaIds': $product->set_gallery_image_ids($value); break;
            case 'purchaseNote': $product->set_purchase_note($value); break;
            case 'externalUrl': $product->set_product_url($value); break;
            case 'buttonText': $product->set_button_text($value); break;
        }
    }

    private static function set_variation_value($variation, string $field, $value) {
        switch ($field) {
            case 'enabled': $variation->set_status($value ? 'publish' : 'private'); break;
            case 'regularPrice': $variation->set_regular_price($value); break;
            case 'salePrice': $variation->set_sale_price($value === null ? '' : $value); break;
            case 'saleSchedule':
                $variation->set_date_on_sale_from($value['from'] === null ? '' : $value['from']);
                $variation->set_date_on_sale_to($value['to'] === null ? '' : $value['to']);
                break;
            case 'sku': $variation->set_sku($value); break;
            case 'manageStock': $variation->set_manage_stock($value); break;
            case 'stockQuantity': $variation->set_stock_quantity($value === null ? '' : $value); break;
            case 'stockStatus': $variation->set_stock_status($value); break;
            case 'mediaId': $variation->set_image_id($value === null ? '' : $value); break;
        }
    }

    // ── before and after ────────────────────────────────────────────────────

    /** The touched fields of a plan, as the product holds them now. */
    private static function touched($product, array $plan): array {
        $out = [];
        foreach (self::PRODUCT_LEVEL_FIELDS as $field) {
            if (array_key_exists($field, $plan['product'])) {
                $out[$field] = self::product_value($product, $field);
            }
        }
        if ($plan['categories'] !== null) {
            $out['categoryIds'] = array_map('intval', (array) $product->get_category_ids('edit'));
        }
        if ($plan['tags'] !== null) {
            $out['tags'] = self::term_names((array) $product->get_tag_ids('edit'), 'product_tag');
        }
        if ($plan['card_slots']) {
            $slots = self::card_slots((int) $product->get_id());
            $out['cardSlots'] = [];
            foreach (array_keys($plan['card_slots']) as $key) {
                $out['cardSlots'][$key] = $slots[$key] ?? '';
            }
        }
        if ($plan['clear_sample']) {
            $out['sample'] = (bool) get_post_meta((int) $product->get_id(), self::SAMPLE_META, true);
        }
        if ($plan['attributes'] !== null) {
            $out['attributes'] = self::attributes_snapshot($product);
        }
        if ($plan['variations'] || $plan['remove']) {
            $out['variations'] = [];
            foreach ($plan['variations'] as $vid => $patch) {
                if (!$patch) {
                    continue;
                }
                $variation = wc_get_product($vid);
                $entry = ['variationId' => (int) $vid];
                foreach (array_keys($patch) as $field) {
                    $entry[$field] = $variation ? self::variation_value($variation, $field) : null;
                }
                $out['variations'][] = $entry;
            }
            foreach ($plan['remove'] as $vid) {
                $variation = wc_get_product($vid);
                $out['variations'][] = $variation ? [
                    'variationId' => (int) $vid,
                    'enabled' => $variation->get_status('edit') === 'publish',
                    'regularPrice' => self::price_out($variation->get_regular_price('edit')),
                    'salePrice' => self::price_out($variation->get_sale_price('edit')),
                    'sku' => (string) $variation->get_sku('edit'),
                    'stockStatus' => (string) $variation->get_stock_status('edit'),
                ] : ['variationId' => (int) $vid, 'removed' => true];
            }
        }
        return $out;
    }

    private static function product_value($product, string $field) {
        switch ($field) {
            case 'name': return (string) $product->get_name('edit');
            case 'shortDescription': return (string) $product->get_short_description('edit');
            case 'description': return (string) $product->get_description('edit');
            case 'status': return (string) $product->get_status('edit');
            case 'catalogVisibility': return (string) $product->get_catalog_visibility('edit');
            case 'featured': return (bool) $product->get_featured('edit');
            case 'sku': return (string) $product->get_sku('edit');
            case 'regularPrice': return self::price_out($product->get_regular_price('edit'));
            case 'salePrice': return self::price_out($product->get_sale_price('edit'));
            case 'saleSchedule':
                return ['from' => self::date_out($product->get_date_on_sale_from('edit')), 'to' => self::date_out($product->get_date_on_sale_to('edit'))];
            case 'manageStock': return (bool) $product->get_manage_stock('edit');
            case 'stockQuantity': return self::quantity_out($product->get_stock_quantity('edit'));
            case 'stockStatus': return (string) $product->get_stock_status('edit');
            case 'backorders': return (string) $product->get_backorders('edit');
            case 'virtual': return (bool) $product->get_virtual('edit');
            case 'weight': return (string) $product->get_weight('edit');
            case 'dimensions':
                return ['length' => (string) $product->get_length('edit'), 'width' => (string) $product->get_width('edit'), 'height' => (string) $product->get_height('edit')];
            case 'featuredMediaId': return ((int) $product->get_image_id('edit')) ?: null;
            case 'galleryMediaIds': return array_map('intval', (array) $product->get_gallery_image_ids('edit'));
            case 'purchaseNote': return (string) $product->get_purchase_note('edit');
            case 'externalUrl': return method_exists($product, 'get_product_url') ? (string) $product->get_product_url('edit') : '';
            case 'buttonText': return method_exists($product, 'get_button_text') ? (string) $product->get_button_text('edit') : '';
        }
        return null;
    }

    private static function variation_value($variation, string $field) {
        switch ($field) {
            case 'enabled': return $variation->get_status('edit') === 'publish';
            case 'regularPrice': return self::price_out($variation->get_regular_price('edit'));
            case 'salePrice': return self::price_out($variation->get_sale_price('edit'));
            case 'saleSchedule':
                return ['from' => self::date_out($variation->get_date_on_sale_from('edit')), 'to' => self::date_out($variation->get_date_on_sale_to('edit'))];
            case 'sku': return (string) $variation->get_sku('edit');
            case 'manageStock': return (bool) $variation->get_manage_stock('edit');
            case 'stockQuantity': return self::quantity_out($variation->get_stock_quantity('edit'));
            case 'stockStatus': return (string) $variation->get_stock_status('edit');
            case 'mediaId': return ((int) $variation->get_image_id('edit')) ?: null;
        }
        return null;
    }

    private static function changed_keys(array $before, array $after): array {
        $changed = [];
        foreach ($after as $key => $value) {
            if (!array_key_exists($key, $before) || wp_json_encode($before[$key]) !== wp_json_encode($value)) {
                $changed[] = $key;
            }
        }
        return $changed;
    }

    // ── content_post_read ───────────────────────────────────────────────────

    public static function post_read($params = [], $step_id = null) {
        $post = self::content_post($params['post_id'] ?? null);
        $snap = self::post_snapshot($post);
        // with_content: its text and the hash a rewrite of it is computed on (the same pair a content write answers).
        if (!empty($params['with_content'])) {
            $snap['content'] = ['html' => (string) $post->post_content, 'baseHash' => $snap['contentSha256']];
        }
        return ['post' => $snap];
    }

    /** A post or page as the edit engine and the dashboard read it. */
    public static function post_snapshot($post): array {
        $id = (int) $post->ID;
        $is_post = $post->post_type === 'post';
        return [
            'id' => $id,
            'type' => (string) $post->post_type,
            'status' => (string) $post->post_status,
            'title' => (string) $post->post_title,
            'excerpt' => (string) $post->post_excerpt,
            'slug' => (string) $post->post_name,
            'date' => self::mysql_out((string) $post->post_date),
            'featuredMediaId' => ((int) get_post_thumbnail_id($id)) ?: null,
            'categoryIds' => $is_post ? array_map('intval', (array) wp_get_post_categories($id)) : [],
            'tags' => $is_post ? array_values(array_map(function ($tag) { return (string) $tag->name; }, (array) wp_get_post_tags($id))) : [],
            'contentSha256' => hash('sha256', (string) $post->post_content),
            'modifiedGmt' => self::mysql_out((string) $post->post_modified_gmt),
            'designOwned' => (bool) get_post_meta($id, self::FULLHTML_META, true),
            'permalink' => (string) get_permalink($id),
        ];
    }

    // ── content_post_update / content_post_create ───────────────────────────

    public static function post_update($params = [], $step_id = null) {
        $post = self::content_post($params['post_id'] ?? null);
        $fields = $params['fields'] ?? null;
        if (!is_array($fields) || !$fields || array_keys($fields) === range(0, count($fields) - 1)) {
            throw self::error('VALIDATION', 'fields must name what changes.');
        }
        $plan = self::post_plan($post, $fields);
        $role = self::site_page((int) $post->ID);
        if ($role !== '' && isset($plan['post']['post_status']) && $plan['post']['post_status'] !== 'publish') {
            throw self::error('PROTECTED_PAGE', 'This is ' . $role . ', which the site needs, so it stays published.');
        }
        $before = self::post_touched($post, $plan);
        self::apply_post_plan((int) $post->ID, $plan);
        clean_post_cache((int) $post->ID);
        $after = self::post_touched(get_post((int) $post->ID), $plan);
        // Each side is the patch that leads back to the other.
        if (isset($before['content'], $after['content'])) {
            $old = $before['content']['baseHash'];
            $before['content']['baseHash'] = $after['content']['baseHash'];
            $after['content']['baseHash'] = $old;
        }
        $fresh = get_post((int) $post->ID);
        return [
            'post_id' => (int) $post->ID,
            'before' => (object) $before,
            'after' => (object) $after,
            'changed' => self::changed_keys($before, $after),
            'modifiedGmt' => self::mysql_out((string) ($fresh ? $fresh->post_modified_gmt : $post->post_modified_gmt)),
        ];
    }

    public static function post_create($params = [], $step_id = null) {
        $fields = $params['fields'] ?? null;
        if (!is_array($fields) || !array_key_exists('title', $fields)) {
            throw self::error('VALIDATION', 'A new post needs a title.');
        }
        unset($fields['baseModified']);
        if (!isset($fields['status'])) {
            $fields['status'] = 'draft';
        }
        $plan = self::post_plan(null, $fields);
        $data = $plan['post'] + ['post_type' => 'post', 'post_status' => 'draft'];
        $id = wp_insert_post(wp_slash($data), true);
        if (is_wp_error($id) || (int) $id <= 0) {
            throw self::error('WRITE_FAILED', 'The post could not be created: ' . (is_wp_error($id) ? self::plain($id->get_error_message()) : 'unknown error') . '.');
        }
        $plan['post'] = [];
        self::apply_post_plan((int) $id, $plan);
        return [
            'post_id' => (int) $id,
            'permalink' => (string) get_permalink((int) $id),
            'status' => (string) get_post_status((int) $id),
        ];
    }

    /**
     * PostFields read into the wp_update_post data and the term and
     * thumbnail changes, every field checked first. $post null: a new post.
     */
    private static function post_plan($post, array $fields): array {
        foreach (array_keys($fields) as $key) {
            if (!in_array($key, self::POST_FIELDS, true)) {
                throw self::error('VALIDATION', 'Unknown post field: ' . self::plain((string) $key) . '.');
            }
        }
        $is_post = $post === null || $post->post_type === 'post';
        $name = $post === null ? 'the new post' : '"' . self::plain((string) $post->post_title) . '"';
        if ($post !== null && isset($fields['baseModified'])) {
            self::refuse_if_changed_since($fields['baseModified'], (string) $post->post_modified_gmt, $name);
        }

        $plan = ['post' => [], 'thumbnail' => false, 'categories' => null, 'new_categories' => [], 'tags' => null, 'touched' => []];
        if (array_key_exists('title', $fields)) {
            $plan['post']['post_title'] = self::plain_text($fields['title'], 'The title', 1, 200);
            $plan['touched'][] = 'title';
        }
        if (array_key_exists('excerpt', $fields)) {
            $plan['post']['post_excerpt'] = self::plain_text($fields['excerpt'], 'The excerpt', 0, 600);
            $plan['touched'][] = 'excerpt';
        }
        if (array_key_exists('slug', $fields)) {
            $slug = is_string($fields['slug']) ? sanitize_title($fields['slug']) : '';
            if ($slug === '') {
                throw self::error('VALIDATION', 'The slug must hold letters or numbers.');
            }
            $plan['post']['post_name'] = $slug;
            $plan['touched'][] = 'slug';
        }
        $status = null;
        if (array_key_exists('status', $fields)) {
            $status = self::one_of($fields['status'], self::POST_STATUSES, 'status');
            $plan['post']['post_status'] = $status;
            $plan['touched'][] = 'status';
        }
        if (array_key_exists('date', $fields)) {
            $local = self::local_date($fields['date']);
            $plan['post']['post_date'] = $local;
            $plan['post']['post_date_gmt'] = get_gmt_from_date($local);
            $plan['post']['edit_date'] = true;
            $plan['touched'][] = 'date';
        }
        if ($status === 'future') {
            if (!isset($plan['post']['post_date_gmt']) || strtotime($plan['post']['post_date_gmt'] . ' UTC') <= time()) {
                throw self::error('VALIDATION', 'A scheduled post needs a date in the future.');
            }
        }
        if (array_key_exists('featuredMediaId', $fields)) {
            $plan['thumbnail'] = ['id' => $fields['featuredMediaId'] === null ? 0 : self::image_id($fields['featuredMediaId'])];
            $plan['touched'][] = 'featuredMediaId';
        }
        if (array_key_exists('categoryIds', $fields)) {
            if (!$is_post) {
                throw self::error('VALIDATION', 'A page has no categories.');
            }
            if (!is_array($fields['categoryIds'])) {
                throw self::error('VALIDATION', 'categoryIds is a list of category ids.');
            }
            $ids = [];
            foreach ($fields['categoryIds'] as $raw) {
                $term_id = self::positive_int($raw);
                $term = $term_id > 0 ? get_term($term_id, 'category') : null;
                if (!$term || is_wp_error($term)) {
                    throw self::error('NOT_FOUND', 'Category ' . $term_id . ' was not found.');
                }
                $ids[] = $term_id;
            }
            $plan['categories'] = array_values(array_unique($ids));
            $plan['touched'][] = 'categoryIds';
        }
        if (array_key_exists('newCategories', $fields)) {
            if (!$is_post) {
                throw self::error('VALIDATION', 'A page has no categories.');
            }
            // Categories by name: the existing one of that name (any letter case), or a new one, added to the set.
            $plan['new_categories'] = self::names($fields['newCategories'], 'newCategories');
            if ($plan['categories'] === null) {
                $plan['categories'] = $post === null ? [] : array_map('intval', (array) wp_get_post_categories((int) $post->ID));
            }
            if (!in_array('categoryIds', $plan['touched'], true)) {
                $plan['touched'][] = 'categoryIds';
            }
        }
        if (array_key_exists('tags', $fields)) {
            if (!$is_post) {
                throw self::error('VALIDATION', 'A page has no tags.');
            }
            $plan['tags'] = self::names($fields['tags'], 'tags');
            $plan['touched'][] = 'tags';
        }
        if (array_key_exists('content', $fields)) {
            $content = $fields['content'];
            if (!is_array($content) || !is_string($content['html'] ?? null)) {
                throw self::error('VALIDATION', 'content holds the new html and the hash it was edited from.');
            }
            if ($post !== null) {
                if (get_post_meta((int) $post->ID, self::FULLHTML_META, true)) {
                    throw self::error('DESIGN_OWNED', 'The content of ' . $name . ' is part of the site design, so it changes through the design editor.');
                }
                $base = $content['baseHash'] ?? null;
                if (!is_string($base) || !preg_match('/^[a-f0-9]{64}$/i', $base)) {
                    throw self::error('VALIDATION', 'content.baseHash must be the sha256 of the content the edit started from.');
                }
                if (!hash_equals(strtolower($base), hash('sha256', (string) $post->post_content))) {
                    throw self::error('CHANGED_ELSEWHERE', 'The content of ' . $name . ' was changed elsewhere after this edit started.');
                }
            }
            if (strlen($content['html']) > 500000) {
                throw self::error('VALIDATION', 'The content is too long.');
            }
            $plan['post']['post_content'] = wp_kses_post($content['html']);
            $plan['touched'][] = 'content';
        }
        // fields.seo is another command's (seo_update): ignored here.
        return $plan;
    }

    private static function apply_post_plan(int $id, array $plan) {
        if ($plan['post']) {
            $result = wp_update_post(wp_slash(['ID' => $id] + $plan['post']), true);
            if (is_wp_error($result) || !$result) {
                throw self::error('WRITE_FAILED', 'The post could not be saved: ' . (is_wp_error($result) ? self::plain($result->get_error_message()) : 'unknown error') . '.');
            }
        }
        if ($plan['thumbnail'] !== false) {
            if ($plan['thumbnail']['id'] > 0) {
                set_post_thumbnail($id, $plan['thumbnail']['id']);
            } else {
                delete_post_thumbnail($id);
            }
        }
        if ($plan['categories'] !== null) {
            $ids = $plan['categories'];
            foreach ($plan['new_categories'] ?? [] as $name) {
                $ids[] = self::term_id_for($name, 'category');
            }
            wp_set_post_categories($id, array_values(array_unique(array_filter($ids))), false);
        }
        if ($plan['tags'] !== null) {
            wp_set_post_tags($id, $plan['tags'], false);
        }
    }

    /** The touched PostFields, as the post holds them now. */
    private static function post_touched($post, array $plan): array {
        $snap = self::post_snapshot($post);
        $out = [];
        foreach ($plan['touched'] as $field) {
            if ($field === 'content') {
                $out['content'] = ['html' => (string) $post->post_content, 'baseHash' => $snap['contentSha256']];
            } else {
                $out[$field] = $snap[$field];
            }
        }
        return $out;
    }

    // ── content_post_trash ──────────────────────────────────────────────────

    public static function post_trash($params = [], $step_id = null) {
        $post = self::content_post($params['post_id'] ?? null);
        $role = self::site_page((int) $post->ID);
        if ($role !== '' && empty($params['restore'])) {
            throw self::error('PROTECTED_PAGE', 'This is ' . $role . ', which the site needs, so it cannot be moved to the trash.');
        }
        $status = self::trash_or_restore((int) $post->ID, !empty($params['restore']));
        return ['post_id' => (int) $post->ID, 'status' => $status];
    }

    /** To the trash, or back from it to the status it had. Answers the status now. */
    private static function trash_or_restore(int $id, bool $restore): string {
        $status = (string) get_post_status($id);
        if ($restore) {
            if ($status === 'trash') {
                add_filter('wp_untrash_post_status', 'wp_untrash_post_set_previous_status', 10, 3);
                $done = wp_untrash_post($id);
                remove_filter('wp_untrash_post_status', 'wp_untrash_post_set_previous_status', 10);
                if (!$done) {
                    throw self::error('WRITE_FAILED', 'This could not be taken out of the trash.');
                }
            }
        } elseif ($status !== 'trash') {
            // With the trash turned off, WordPress deletes for good: no undo.
            if (defined('EMPTY_TRASH_DAYS') && !EMPTY_TRASH_DAYS) {
                throw self::error('TRASH_DISABLED', 'The trash is turned off on this site, so this would be deleted for good. Nothing was removed.');
            }
            if (!wp_trash_post($id)) {
                throw self::error('WRITE_FAILED', 'This could not be moved to the trash.');
            }
        }
        clean_post_cache($id);
        return (string) get_post_status($id);
    }

    // ── store_term_read / store_term_update ─────────────────────────────────

    /** The categories the term commands change: the store's and the blog's. */
    const TERM_TAXONOMIES = ['product_cat', 'category'];
    const TERM_FIELDS = ['name', 'description'];

    public static function term_read($params = [], $step_id = null) {
        return ['term' => self::term_snapshot(self::term($params['taxonomy'] ?? null, $params['term_id'] ?? null))];
    }

    /** A category as the edit engine reads it. */
    private static function term_snapshot($term): array {
        $link = get_term_link($term);
        return [
            'id' => (int) $term->term_id,
            'taxonomy' => (string) $term->taxonomy,
            'name' => (string) $term->name,
            'description' => (string) $term->description,
            'slug' => (string) $term->slug,
            'link' => is_wp_error($link) ? '' : (string) $link,
            'count' => (int) $term->count,
        ];
    }

    public static function term_update($params = [], $step_id = null) {
        $term = self::term($params['taxonomy'] ?? null, $params['term_id'] ?? null);
        $fields = $params['fields'] ?? null;
        if (!is_array($fields) || !$fields || array_keys($fields) === range(0, count($fields) - 1)) {
            throw self::error('VALIDATION', 'fields must name what changes.');
        }
        $set = [];
        foreach ($fields as $key => $value) {
            if (!in_array($key, self::TERM_FIELDS, true)) {
                throw self::error('VALIDATION', $key . ' is not a field of a category.');
            }
            $set[$key] = $key === 'name' ? self::plain_text($value, 'The name', 1, 200) : self::html($value, 'The description', 5000);
        }
        $id = (int) $term->term_id;
        $taxonomy = (string) $term->taxonomy;
        $before = [];
        foreach (array_keys($set) as $key) {
            $before[$key] = (string) $term->{$key};
        }
        // The name and the description only: its address (slug) stays, so links to it keep working.
        $result = wp_update_term($id, $taxonomy, $set);
        if (is_wp_error($result)) {
            if (in_array($result->get_error_code(), ['duplicate_term_slug', 'term_exists'], true)) {
                throw self::error('VALIDATION', 'Another category is already called ' . self::plain((string) ($set['name'] ?? '')) . '.');
            }
            throw self::error('WRITE_FAILED', 'The category could not be saved.');
        }
        clean_term_cache($id, $taxonomy);
        $fresh = get_term($id, $taxonomy);
        $after = [];
        foreach (array_keys($set) as $key) {
            $after[$key] = $fresh && !is_wp_error($fresh) ? (string) $fresh->{$key} : $set[$key];
        }
        return [
            'term_id' => $id,
            'taxonomy' => $taxonomy,
            'before' => (object) $before,
            'after' => (object) $after,
            'changed' => self::changed_keys($before, $after),
        ];
    }

    /** The category a command names (a store's needs WooCommerce); NOT_FOUND otherwise. */
    private static function term($taxonomy, $raw) {
        if (!is_string($taxonomy) || !in_array($taxonomy, self::TERM_TAXONOMIES, true)) {
            throw self::error('VALIDATION', 'taxonomy must be product_cat or category.');
        }
        if ($taxonomy === 'product_cat') {
            self::require_store();
        }
        $id = self::positive_int($raw);
        $term = $id > 0 ? get_term($id, $taxonomy) : null;
        if (!$term || is_wp_error($term)) {
            throw self::error('NOT_FOUND', 'Category ' . $id . ' was not found.');
        }
        return $term;
    }

    // ── Lookups ─────────────────────────────────────────────────────────────

    private static function require_store() {
        if (!function_exists('wc_get_product') || !class_exists('WC_Product')) {
            throw self::error('NO_STORE', 'WooCommerce is not active on this site, so it has no products.');
        }
    }

    /** The product a command names (never a variation); NOT_FOUND otherwise. */
    private static function product($raw) {
        self::require_store();
        $id = self::positive_int($raw);
        $product = $id > 0 ? wc_get_product($id) : null;
        if (!$product || $product->is_type('variation')) {
            throw self::error('NOT_FOUND', 'Product ' . $id . ' was not found.');
        }
        return $product;
    }

    /** The post or page a command names; NOT_FOUND otherwise. */
    private static function content_post($raw) {
        $id = self::positive_int($raw);
        $post = $id > 0 ? get_post($id) : null;
        if (!$post || !in_array($post->post_type, self::POST_TYPES, true)) {
            throw self::error('NOT_FOUND', 'Post ' . $id . ' was not found.');
        }
        return $post;
    }

    /**
     * What a page is to the site when it runs it ("the homepage", "the shop
     * page"...), or '' for any other post. The editor's page card reads it
     * too (the wpmaven REST field), to keep Draft off such a page (2026-10-19).
     */
    public static function site_page(int $id): string {
        $roles = [
            (int) get_option('page_on_front', 0) => 'the homepage',
            (int) get_option('page_for_posts', 0) => 'the blog page',
            (int) get_option('wp_page_for_privacy_policy', 0) => 'the privacy policy page',
        ];
        if (function_exists('wc_get_page_id')) {
            foreach (['shop' => 'the shop page', 'cart' => 'the cart page', 'checkout' => 'the checkout page', 'myaccount' => 'the account page', 'terms' => 'the terms page'] as $key => $label) {
                $roles[(int) wc_get_page_id($key)] = $label;
            }
        }
        return $id > 0 && isset($roles[$id]) ? $roles[$id] : '';
    }

    public static function is_printed(int $id): bool {
        return $id > 0 && (string) get_post_meta($id, self::POD_PRODUCT_META, true) !== '';
    }

    /** The designed card's text of a product: {key: text} from its _wm_card_slot_<key> meta. */
    private static function card_slots(int $id): array {
        $out = [];
        if ($id <= 0) {
            return $out;
        }
        foreach ((array) get_post_meta($id) as $key => $values) {
            if (is_string($key) && strpos($key, self::CARD_SLOT_PREFIX) === 0 && strlen($key) > strlen(self::CARD_SLOT_PREFIX)) {
                $out[substr($key, strlen(self::CARD_SLOT_PREFIX))] = (string) (is_array($values) ? reset($values) : $values);
            }
        }
        ksort($out);
        return $out;
    }

    private static function term_names(array $ids, string $taxonomy): array {
        $names = [];
        foreach ($ids as $id) {
            $term = get_term((int) $id, $taxonomy);
            if ($term && !is_wp_error($term)) {
                $names[] = (string) $term->name;
            }
        }
        return $names;
    }

    /** The id of a term by its name, created when the taxonomy has none. */
    private static function term_id_for(string $name, string $taxonomy): int {
        $found = term_exists($name, $taxonomy);
        if (!$found) {
            $found = wp_insert_term($name, $taxonomy);
        }
        if (is_wp_error($found)) {
            throw self::error('WRITE_FAILED', 'The ' . ($taxonomy === 'product_tag' ? 'tag' : 'category') . ' "' . self::plain($name) . '" could not be created.');
        }
        return (int) (is_array($found) ? $found['term_id'] : $found);
    }

    // ── Checks ──────────────────────────────────────────────────────────────

    /** CHANGED_ELSEWHERE when the object changed after baseModified (a GMT time). */
    private static function refuse_if_changed_since($base, $modified, string $name) {
        $base_ts = is_string($base) ? self::gmt_timestamp($base) : null;
        if ($base_ts === null) {
            throw self::error('VALIDATION', 'baseModified must be the modified time the edit started from.');
        }
        if (is_object($modified) && method_exists($modified, 'getTimestamp')) {
            $current = (int) $modified->getTimestamp();
        } else {
            $current = is_string($modified) ? self::gmt_timestamp($modified) : null;
        }
        if ($current !== null && $current > $base_ts + self::MODIFIED_TOLERANCE) {
            throw self::error('CHANGED_ELSEWHERE', ucfirst($name) . ' was changed elsewhere after this edit started.');
        }
    }

    private static function gmt_timestamp(string $value) {
        $value = trim($value);
        if ($value === '' || strpos($value, '0000-00-00') === 0) {
            return null;
        }
        $has_zone = (bool) preg_match('/(Z|[+-]\d{2}:?\d{2})$/i', $value);
        $ts = strtotime($has_zone ? $value : $value . ' UTC');
        return $ts === false ? null : $ts;
    }

    private static function refuse_bad_sale($regular, $sale, string $name) {
        if ($sale === null) {
            return;
        }
        if ($regular === null) {
            throw self::error('VALIDATION', 'A sale price needs a regular price for ' . $name . '.');
        }
        if ((float) $sale >= (float) $regular) {
            throw self::error('VALIDATION', 'The sale price of ' . $name . ' (' . $sale . ') must be below its regular price (' . $regular . ').');
        }
    }

    /** PRICE_BELOW_FLOOR when a price is under the floor (in minor units). */
    private static function refuse_under_floor($floor_minor, array $prices, string $label, int $decimals) {
        if ($floor_minor === null) {
            return;
        }
        foreach ($prices as $price) {
            if ($price === null) {
                continue;
            }
            if (self::to_minor($price, $decimals) < $floor_minor) {
                $floor = number_format($floor_minor / (10 ** $decimals), $decimals, '.', '');
                throw self::error('PRICE_BELOW_FLOOR', 'The price of "' . $label . '" cannot be under ' . $floor . ' ' . self::currency() . ', what it costs to make.');
            }
        }
    }

    /**
     * Floors by variation (0: the product itself), in minor units of the
     * store currency. A floor in another currency is left out until the API
     * sends one in the store's.
     */
    private static function floors($raw): array {
        if ($raw === null || $raw === []) {
            return [];
        }
        if (!is_array($raw)) {
            throw self::error('VALIDATION', 'floors is a list of {variation_id, minor, currency}.');
        }
        $currency = self::currency();
        $out = [];
        foreach ($raw as $floor) {
            if (!is_array($floor) || !is_int($floor['minor'] ?? null) || $floor['minor'] < 0 || !is_string($floor['currency'] ?? null)) {
                throw self::error('VALIDATION', 'Each floor has a variation_id (or null), minor units and a currency.');
            }
            if (strtoupper($floor['currency']) !== $currency) {
                continue;
            }
            $vid = ($floor['variation_id'] ?? null) === null ? 0 : self::positive_int($floor['variation_id']);
            $out[$vid] = $floor['minor'];
        }
        return $out;
    }

    // ── Values ──────────────────────────────────────────────────────────────

    private static function decimals(): int {
        return function_exists('wc_get_price_decimals') ? max(0, (int) wc_get_price_decimals()) : 2;
    }

    private static function currency(): string {
        return strtoupper(function_exists('get_woocommerce_currency') ? (string) get_woocommerce_currency() : (string) get_option('woocommerce_currency', ''));
    }

    /** A Decimal with at most the store's decimals ("14", "14.5", "14.50"), normalized ("14.50"). */
    private static function decimal($value, string $what, int $decimals): string {
        $pattern = $decimals > 0 ? '/^\d{1,12}(\.\d{1,' . $decimals . '})?$/' : '/^\d{1,12}$/';
        if (!is_string($value) || !preg_match($pattern, $value)) {
            throw self::error('VALIDATION', $what . ' must be a number like ' . ($decimals > 0 ? '14.' . str_repeat('5', $decimals) : '14') . '.');
        }
        return number_format((float) $value, $decimals, '.', '');
    }

    private static function to_minor(string $price, int $decimals): int {
        return (int) round(((float) $price) * (10 ** $decimals));
    }

    private static function price_out($value) {
        if ($value === '' || $value === null) {
            return null;
        }
        return number_format((float) $value, self::decimals(), '.', '');
    }

    private static function quantity_out($value) {
        return $value === null || $value === '' ? null : (int) $value;
    }

    private static function date_out($value) {
        if (is_object($value) && method_exists($value, 'date')) {
            return (string) $value->date('Y-m-d\TH:i:s');
        }
        return null;
    }

    private static function modified_out($value) {
        if (is_object($value) && method_exists($value, 'getTimestamp')) {
            return gmdate('Y-m-d\TH:i:s', (int) $value->getTimestamp());
        }
        return null;
    }

    /** A MySQL datetime as ISO 8601 ('Y-m-d\TH:i:s'), null for WordPress's empty date. */
    private static function mysql_out(string $value) {
        if ($value === '' || strpos($value, '0000-00-00') === 0) {
            return null;
        }
        return str_replace(' ', 'T', $value);
    }

    /** An ISO 8601 date as the site's local 'Y-m-d H:i:s'. */
    private static function local_date($value): string {
        if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i', trim($value))) {
            throw self::error('VALIDATION', 'date must be an ISO 8601 date, like 2026-10-12T09:00:00.');
        }
        $value = trim($value);
        $zone = function_exists('wp_timezone') ? wp_timezone() : new DateTimeZone('UTC');
        try {
            $date = preg_match('/(Z|[+-]\d{2}:?\d{2})$/i', $value) ? new DateTime($value) : new DateTime($value, $zone);
        } catch (\Exception $e) {
            throw self::error('VALIDATION', 'date is not a real date.');
        }
        $date->setTimezone($zone);
        return $date->format('Y-m-d H:i:s');
    }

    private static function schedule($value): array {
        if (!is_array($value)) {
            throw self::error('VALIDATION', 'saleSchedule holds from and to (dates or null).');
        }
        $out = [];
        foreach (['from', 'to'] as $key) {
            $date = $value[$key] ?? null;
            if ($date !== null && (!is_string($date) || !preg_match('/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/', $date))) {
                throw self::error('VALIDATION', 'The sale ' . $key . ' date must be a date like 2026-10-12.');
            }
            // A date alone covers the whole day, as WooCommerce's own screen does:
            // the sale starts at midnight and ends at 23:59:59.
            if ($date !== null && strlen($date) === 10) {
                $date .= $key === 'from' ? ' 00:00:00' : ' 23:59:59';
            }
            $out[$key] = $date;
        }
        foreach (array_keys($value) as $key) {
            if (!in_array($key, ['from', 'to'], true)) {
                throw self::error('VALIDATION', 'saleSchedule holds from and to only.');
            }
        }
        if ($out['from'] !== null && $out['to'] !== null && strtotime($out['from']) > strtotime($out['to'])) {
            throw self::error('VALIDATION', 'The sale ends before it starts.');
        }
        return $out;
    }

    private static function plain_text($value, string $what, int $min, int $max): string {
        if (!is_string($value)) {
            throw self::error('VALIDATION', $what . ' must be text.');
        }
        $text = trim(wp_strip_all_tags($value));
        $length = function_exists('mb_strlen') ? mb_strlen($text, 'UTF-8') : strlen($text);
        if ($length < $min || $length > $max) {
            throw self::error('VALIDATION', $what . ' has ' . ($min > 0 ? $min . ' to ' : 'at most ') . $max . ' characters.');
        }
        return $text;
    }

    private static function html($value, string $what, int $max): string {
        if (!is_string($value)) {
            throw self::error('VALIDATION', $what . ' must be text.');
        }
        if ((function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value)) > $max) {
            throw self::error('VALIDATION', $what . ' has at most ' . $max . ' characters.');
        }
        return wp_kses_post($value);
    }

    private static function one_of($value, array $allowed, string $what) {
        if (!in_array($value, $allowed, true)) {
            throw self::error('VALIDATION', $what . ' must be one of: ' . implode(', ', $allowed) . '.');
        }
        return $value;
    }

    private static function boolean($value, string $what): bool {
        if (!is_bool($value)) {
            throw self::error('VALIDATION', $what . ' must be true or false.');
        }
        return $value;
    }

    private static function quantity($value, string $what) {
        if ($value === null) {
            return null;
        }
        if (!is_int($value) || abs($value) > 1000000000) {
            throw self::error('VALIDATION', $what . ' must be a whole number or null.');
        }
        return $value;
    }

    private static function measure($value, string $what): string {
        if (!is_string($value) || ($value !== '' && !preg_match('/^\d{1,9}(\.\d{1,4})?$/', $value))) {
            throw self::error('VALIDATION', 'The ' . $what . ' must be a number like 0.5, or empty.');
        }
        return $value;
    }

    private static function sku($value, int $id): string {
        if (!is_string($value) || strlen($value) > 100) {
            throw self::error('VALIDATION', 'The SKU is text of at most 100 characters.');
        }
        $sku = trim(wp_strip_all_tags($value));
        if ($sku !== '' && function_exists('wc_product_has_unique_sku') && !wc_product_has_unique_sku($id, $sku)) {
            throw self::error('VALIDATION', 'The SKU ' . self::plain($sku) . ' is already used by another product.');
        }
        return $sku;
    }

    /** A media library image id; NOT_FOUND when the library has no such image. */
    private static function image_id($value): int {
        $id = self::positive_int($value);
        $post = $id > 0 ? get_post($id) : null;
        if (!$post || $post->post_type !== 'attachment' || !wp_attachment_is_image($id)) {
            throw self::error('NOT_FOUND', 'Image ' . $id . ' was not found in the media library.');
        }
        return $id;
    }

    /** A list of term names: 1 to 100 characters each, at most 50. */
    private static function names($value, string $what): array {
        if (!is_array($value) || count($value) > 50) {
            throw self::error('VALIDATION', $what . ' is a list of at most 50 names.');
        }
        $out = [];
        foreach ($value as $name) {
            $out[] = self::plain_text($name, 'A name in ' . $what, 1, 100);
        }
        return array_values(array_unique($out));
    }

    private static function positive_int($value): int {
        if (is_int($value)) {
            return $value > 0 ? $value : 0;
        }
        if (is_string($value) && preg_match('/^\d{1,18}$/', $value)) {
            return (int) $value;
        }
        return 0;
    }

    /** A value shown inside a sentence: no markup, no control characters, not too long. */
    private static function plain(string $value): string {
        $value = preg_replace('/[\x00-\x1F\x7F]/', '', wp_strip_all_tags($value));
        return strlen($value) > 120 ? substr($value, 0, 117) . '...' : $value;
    }
}
