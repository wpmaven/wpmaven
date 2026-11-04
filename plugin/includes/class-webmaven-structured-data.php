<?php
/**
 * schema.org JSON-LD structured data for WPMaven-built sites (2026-09-14).
 *
 * Emitted into <head> on every front-end page so the business is legible to
 * Google (rich results) AND to LLMs (ChatGPT / Perplexity / Google AI grounding).
 * Types: Organization/LocalBusiness site-wide, WebSite on the front page,
 * Product + Offer on WooCommerce products, BlogPosting on posts, BreadcrumbList,
 * and FAQPage where the page has details/accordion Q&A.
 *
 * DEFERS to any real SEO plugin: if Yoast / Rank Math / AIOSEO / SEOPress / The
 * SEO Framework is active it already emits its own schema, so we stay silent
 * (WPMaven does not auto-install one, so on the default site OURS is the schema).
 *
 * The business identity (schema @type, description, social sameAs, optional
 * address/phone/priceRange) is seeded into the `webmaven_structured_data` option
 * by the API at generation time, the same way `webmaven_llms_summary` is; the
 * SEO-Specialist operator can refresh it. Live site data (name, logo, products,
 * posts, menu) is read fresh on each render.
 *
 * Business details (2026-10-02): the owner's confirmed phone, email, postal
 * address and opening hours are merged into the same option by the API on
 * every save. The address is a PostalAddress (streetAddress, addressLocality,
 * addressRegion, postalCode, addressCountry); a config from before then may
 * still hold a city string, printed as before. The hours are a list of
 * { dayOfWeek, opens, closes } (a closed day opens and closes at 00:00).
 * Every value is checked and stripped here, and printed through
 * wp_json_encode like the rest.
 */

defined('ABSPATH') || exit;

class WebMaven_Structured_Data {

    const OPTION = 'webmaven_structured_data';

    /** The PostalAddress fields a config may carry, in print order. */
    const ADDRESS_FIELDS = ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry'];

    /** dayOfWeek values an OpeningHoursSpecification may name. */
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    /** 'HH:MM', 24 hours. */
    const TIME = '/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/';

    public function __construct() {
        // Front-end page renders only (mirrors WebMaven_AI_Marking).
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }
        add_action('wp_head', [$this, 'emit'], 20);
    }

    /** True when another plugin already emits schema.org JSON-LD. */
    private function seo_plugin_active() {
        return defined('WPSEO_VERSION')             // Yoast SEO
            || defined('RANK_MATH_VERSION')         // Rank Math
            || defined('AIOSEO_VERSION')            // All in One SEO
            || defined('SEOPRESS_VERSION')          // SEOPress
            || defined('THE_SEO_FRAMEWORK_VERSION'); // The SEO Framework
    }

    /** Print the JSON-LD @graph on the current page. */
    public function emit() {
        $enabled = apply_filters('webmaven_structured_data_enabled', !$this->seo_plugin_active());
        if (!$enabled) {
            return;
        }

        $org = $this->organization_node();
        $graph = [$org];

        if (is_front_page()) {
            $graph[] = $this->website_node();
        }

        if (function_exists('is_product') && is_product()) {
            $product = $this->product_node();
            if ($product) {
                $graph[] = $product;
            }
        } elseif (is_singular('post')) {
            $graph[] = $this->article_node();
        }

        if (!is_front_page() && is_singular()) {
            $crumbs = $this->breadcrumb_node();
            if ($crumbs) {
                $graph[] = $crumbs;
            }
            $faq = $this->faq_node();
            if ($faq) {
                $graph[] = $faq;
            }
        }

        $doc = ['@context' => 'https://schema.org', '@graph' => $graph];
        // Default (slash-escaping) wp_json_encode turns </script> into <\/script>,
        // so no field value can break out of the script element.
        echo "\n<script type=\"application/ld+json\">" . wp_json_encode($doc) . "</script>\n";
    }

    /** The seeded identity config (@type, description, sameAs, optional local fields). */
    private function config() {
        $raw = get_option(self::OPTION, '');
        if (!is_string($raw) || $raw === '') {
            return [];
        }
        $cfg = json_decode($raw, true);
        return is_array($cfg) ? $cfg : [];
    }

    private function org_id() {
        return home_url('/#organization');
    }

    private function site_name() {
        return wp_strip_all_tags((string) (get_option('blogname') ?: get_bloginfo('name')));
    }

    private function logo_url() {
        $logo_id = (int) get_theme_mod('custom_logo');
        if ($logo_id) {
            $url = wp_get_attachment_image_url($logo_id, 'full');
            if ($url) {
                return $url;
            }
        }
        if (function_exists('get_site_icon_url')) {
            $icon = get_site_icon_url(512);
            if ($icon) {
                return $icon;
            }
        }
        return '';
    }

    /** Organization / LocalBusiness node, site-wide. */
    private function organization_node() {
        $cfg = $this->config();
        $type = (!empty($cfg['businessType']) && is_string($cfg['businessType'])) ? $cfg['businessType'] : 'Organization';

        $desc = (!empty($cfg['description']) && is_string($cfg['description'])) ? $cfg['description'] : get_option('webmaven_llms_summary');
        if (!is_string($desc) || $desc === '') {
            $desc = get_bloginfo('description');
        }

        $node = [
            '@type' => $type,
            '@id'   => $this->org_id(),
            'name'  => $this->site_name(),
            'url'   => home_url('/'),
        ];
        if ($desc) {
            $node['description'] = wp_strip_all_tags((string) $desc);
        }
        $logo = $this->logo_url();
        if ($logo) {
            $node['logo']  = esc_url_raw($logo);
            $node['image'] = esc_url_raw($logo);
        }
        // sameAs: the business's own public social profile URLs.
        if (!empty($cfg['sameAs']) && is_array($cfg['sameAs'])) {
            $same = [];
            foreach ($cfg['sameAs'] as $u) {
                $u = esc_url_raw((string) $u);
                if ($u) {
                    $same[] = $u;
                }
            }
            if ($same) {
                $node['sameAs'] = array_values(array_unique($same));
            }
        }
        // Optional local-business fields, ONLY when the config carries them.
        $phone = $this->text($cfg['telephone'] ?? null);
        if ($phone !== '') {
            $node['telephone'] = $phone;
        }
        $email = $this->text($cfg['email'] ?? null);
        if ($email !== '' && is_email($email)) {
            $node['email'] = $email;
        }
        if (!empty($cfg['priceRange'])) {
            $node['priceRange'] = wp_strip_all_tags((string) $cfg['priceRange']);
        }
        $address = $this->postal_address($cfg['address'] ?? null);
        if ($address) {
            $node['address'] = $address;
        }
        $hours = $this->opening_hours($cfg['openingHoursSpecification'] ?? null);
        if ($hours) {
            $node['openingHoursSpecification'] = $hours;
        }
        return $node;
    }

    /** A config value as one line of plain text ('' for anything else). */
    private function text($value) {
        if (!is_string($value) && !is_int($value) && !is_float($value)) {
            return '';
        }
        return trim(preg_replace('/\s+/u', ' ', wp_strip_all_tags((string) $value)) ?? '');
    }

    /**
     * The PostalAddress from the config: the five fields when it holds them
     * (Business details), or the city string configs held before. Null when
     * nothing usable is left.
     */
    private function postal_address($raw) {
        if (is_string($raw)) {
            $city = $this->text($raw);
            return $city === '' ? null : ['@type' => 'PostalAddress', 'addressLocality' => $city];
        }
        if (!is_array($raw)) {
            return null;
        }
        $address = ['@type' => 'PostalAddress'];
        foreach (self::ADDRESS_FIELDS as $field) {
            $value = $this->text($raw[$field] ?? null);
            if ($value !== '') {
                $address[$field] = $value;
            }
        }
        return count($address) > 1 ? $address : null;
    }

    /** The opening hours from the config: the days and times that read as such, nothing else. */
    private function opening_hours($raw) {
        if (!is_array($raw)) {
            return [];
        }
        $hours = [];
        foreach ($raw as $spec) {
            if (!is_array($spec)) {
                continue;
            }
            $day = $spec['dayOfWeek'] ?? null;
            $opens = $spec['opens'] ?? null;
            $closes = $spec['closes'] ?? null;
            if (!is_string($day) || !in_array($day, self::DAYS, true)) {
                continue;
            }
            if (!is_string($opens) || !is_string($closes) || !preg_match(self::TIME, $opens) || !preg_match(self::TIME, $closes)) {
                continue;
            }
            $hours[] = [
                '@type' => 'OpeningHoursSpecification',
                'dayOfWeek' => $day,
                'opens' => $opens,
                'closes' => $closes,
            ];
        }
        return $hours;
    }

    /** WebSite node (front page): identity + on-site search action. */
    private function website_node() {
        return [
            '@type' => 'WebSite',
            '@id'   => home_url('/#website'),
            'name'  => $this->site_name(),
            'url'   => home_url('/'),
            'publisher' => ['@id' => $this->org_id()],
            'potentialAction' => [
                '@type'  => 'SearchAction',
                'target' => [
                    '@type' => 'EntryPoint',
                    'urlTemplate' => home_url('/?s={search_term_string}'),
                ],
                'query-input' => 'required name=search_term_string',
            ],
        ];
    }

    /** Product + Offer node for a single WooCommerce product. */
    private function product_node() {
        if (!function_exists('wc_get_product')) {
            return null;
        }
        $product = wc_get_product(get_queried_object_id());
        if (!$product || !is_a($product, 'WC_Product')) {
            return null;
        }
        $url = get_permalink($product->get_id());
        $node = [
            '@type' => 'Product',
            '@id'   => $url . '#product',
            'name'  => wp_strip_all_tags($product->get_name()),
            'url'   => $url,
            'brand' => ['@id' => $this->org_id()],
        ];
        $desc = $product->get_short_description() ?: $product->get_description();
        if ($desc) {
            $node['description'] = wp_strip_all_tags($desc);
        }
        $sku = $product->get_sku();
        if ($sku) {
            $node['sku'] = wp_strip_all_tags($sku);
        }
        $img_id = $product->get_image_id();
        if ($img_id) {
            $img = wp_get_attachment_image_url($img_id, 'full');
            if ($img) {
                $node['image'] = esc_url_raw($img);
            }
        }
        $price = $product->get_price();
        if ($price !== '' && $price !== null) {
            $node['offers'] = [
                '@type' => 'Offer',
                'url'   => $url,
                'price' => (string) $price,
                'priceCurrency' => function_exists('get_woocommerce_currency') ? get_woocommerce_currency() : 'USD',
                'availability' => ($product->get_stock_status() === 'outofstock')
                    ? 'https://schema.org/OutOfStock'
                    : 'https://schema.org/InStock',
                'itemCondition' => 'https://schema.org/NewCondition',
            ];
        }
        return $node;
    }

    /** BlogPosting node for a single post. */
    private function article_node() {
        $post = get_queried_object();
        if (!$post || !isset($post->ID)) {
            return null;
        }
        $url = get_permalink($post->ID);
        $node = [
            '@type' => 'BlogPosting',
            '@id'   => $url . '#article',
            'mainEntityOfPage' => $url,
            'headline' => wp_strip_all_tags(get_the_title($post->ID)),
            'datePublished' => get_the_date('c', $post->ID),
            'dateModified'  => get_the_modified_date('c', $post->ID),
            'author' => [
                '@type' => 'Person',
                'name'  => wp_strip_all_tags(get_the_author_meta('display_name', $post->post_author)),
            ],
            'publisher' => ['@id' => $this->org_id()],
        ];
        $img = get_the_post_thumbnail_url($post->ID, 'full');
        if ($img) {
            $node['image'] = esc_url_raw($img);
        }
        if (has_excerpt($post->ID)) {
            $node['description'] = wp_strip_all_tags(get_the_excerpt($post->ID));
        }
        return $node;
    }

    /** BreadcrumbList from page ancestry (Home > ... > current). */
    private function breadcrumb_node() {
        $obj = get_queried_object();
        if (!$obj || !isset($obj->ID)) {
            return null;
        }
        $items = [['name' => 'Home', 'url' => home_url('/')]];
        if (is_page()) {
            foreach (array_reverse(get_post_ancestors($obj->ID)) as $aid) {
                $items[] = ['name' => wp_strip_all_tags(get_the_title($aid)), 'url' => get_permalink($aid)];
            }
        }
        $items[] = ['name' => wp_strip_all_tags(get_the_title($obj->ID)), 'url' => get_permalink($obj->ID)];
        if (count($items) < 2) {
            return null;
        }
        $list = [];
        $pos = 1;
        foreach ($items as $it) {
            $list[] = [
                '@type' => 'ListItem',
                'position' => $pos++,
                'name' => $it['name'],
                'item' => esc_url_raw($it['url']),
            ];
        }
        return ['@type' => 'BreadcrumbList', 'itemListElement' => $list];
    }

    /** FAQPage from core/details blocks (summary -> Question, body -> Answer). */
    private function faq_node() {
        $obj = get_queried_object();
        if (!$obj || empty($obj->post_content) || strpos($obj->post_content, '<!-- wp:details') === false) {
            return null; // fast bail: no details blocks on this page
        }
        $qas = $this->collect_details(parse_blocks($obj->post_content));
        if (count($qas) < 2) {
            return null;
        }
        $main = [];
        foreach ($qas as $qa) {
            $main[] = [
                '@type' => 'Question',
                'name' => $qa['q'],
                'acceptedAnswer' => ['@type' => 'Answer', 'text' => $qa['a']],
            ];
        }
        return ['@type' => 'FAQPage', 'mainEntity' => $main];
    }

    /** Walk blocks for core/details, pulling the <summary> and the body. */
    private function collect_details($blocks) {
        $out = [];
        foreach ($blocks as $b) {
            if (($b['blockName'] ?? '') === 'core/details') {
                $html = $b['innerHTML'] ?? '';
                if (preg_match('/<summary[^>]*>(.*?)<\/summary>/is', $html, $m)) {
                    $q = trim(wp_strip_all_tags($m[1]));
                    $a = trim(wp_strip_all_tags(preg_replace('/<summary[^>]*>.*?<\/summary>/is', '', $html)));
                    if ($a === '' && !empty($b['innerBlocks'])) {
                        foreach ($b['innerBlocks'] as $ib) {
                            $a .= ' ' . wp_strip_all_tags($ib['innerHTML'] ?? '');
                        }
                        $a = trim($a);
                    }
                    if ($q !== '' && $a !== '') {
                        $out[] = ['q' => $q, 'a' => $a];
                    }
                }
            }
            if (!empty($b['innerBlocks'])) {
                $out = array_merge($out, $this->collect_details($b['innerBlocks']));
            }
        }
        return $out;
    }
}
