<?php
/**
 * AI crawler visits + AI readiness (2026-09-16).
 *
 * "AI ready" was a promise the customer could not see. This makes it
 * visible in two ways:
 *
 * 1. VISITS. Every frontend request whose user agent is a known AI crawler or
 *    AI assistant fetcher (ChatGPT, Claude, Perplexity, Meta AI, Mistral,
 *    Apple, Amazon, ByteDance, Common Crawl, DuckDuckGo, You.com) is counted,
 *    per day and per assistant, in one option (a rolling 56 days, no autoload,
 *    bounded). Browsers' analytics never see these: crawlers run no JavaScript,
 *    so the tracker cannot count them; PHP sees the user agent.
 *    The API pulls the counts through the `get_ai_crawler_stats` webhook
 *    action for the weekly report ("AI assistants read your site 14 times
 *    this week") and the Home screen.
 *
 * 2. READINESS. `get_ai_readiness` answers the technical half of the "AI
 *    ready" checklist from inside WordPress: llms.txt served, structured data
 *    emitted (or handled by a real SEO plugin), a business description,
 *    products and posts carrying schema, the site indexable. The API adds the
 *    account-side items (social profiles) and the dashboard shows the list.
 *
 * Nothing here is customer-facing text; the plugin only counts and reports.
 */

if (!defined('ABSPATH')) {
    exit;
}

class WebMaven_AI_Crawlers {

    /** Rolling daily counters: [ 'YYYY-MM-DD' => [ 'chatgpt' => 3, ... ], ... ]. */
    const OPTION = 'webmaven_ai_crawler_hits';

    /** Days kept in the option: eight weeks covers the weekly report's previous-period comparison. */
    const KEEP_DAYS = 56;

    /**
     * User-agent tokens -> assistant label. Order matters where tokens share a
     * prefix (OAI-SearchBot before GPTBot is not needed, both are ChatGPT).
     * Kept short and readable; this is the whole detector.
     */
    const AGENTS = [
        'GPTBot'              => 'chatgpt',
        'OAI-SearchBot'       => 'chatgpt',
        'ChatGPT-User'        => 'chatgpt',
        'ClaudeBot'           => 'claude',
        'Claude-Web'          => 'claude',
        'Claude-User'         => 'claude',
        'anthropic-ai'        => 'claude',
        'PerplexityBot'       => 'perplexity',
        'Perplexity-User'     => 'perplexity',
        'Google-Extended'     => 'gemini',
        'GoogleOther'         => 'gemini',
        'meta-externalagent'  => 'meta_ai',
        'Meta-ExternalFetcher'=> 'meta_ai',
        'FacebookBot'         => 'meta_ai',
        'MistralAI-User'      => 'mistral',
        'Applebot-Extended'   => 'apple',
        'Amazonbot'           => 'amazon',
        'Bytespider'          => 'bytedance',
        'CCBot'               => 'common_crawl',
        'DuckAssistBot'       => 'duckduckgo',
        'YouBot'              => 'you',
        'cohere-ai'           => 'cohere',
        'AI2Bot'              => 'ai2',
        'Diffbot'             => 'diffbot',
    ];

    /** Labels the dashboard and report print. */
    const LABELS = [
        'chatgpt' => 'ChatGPT', 'claude' => 'Claude', 'perplexity' => 'Perplexity', 'gemini' => 'Gemini',
        'meta_ai' => 'Meta AI', 'mistral' => 'Mistral', 'apple' => 'Apple Intelligence', 'amazon' => 'Amazon',
        'bytedance' => 'ByteDance', 'common_crawl' => 'Common Crawl', 'duckduckgo' => 'DuckDuckGo AI',
        'you' => 'You.com', 'cohere' => 'Cohere', 'ai2' => 'AI2', 'diffbot' => 'Diffbot',
    ];

    public function __construct() {
        // Frontend pages only (mirrors WebMaven_Analytics and WebMaven_AI_Marking).
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }
        // Early and cheap: one stripos pass over the user agent, then a
        // bounded option write. Never on a page the plugin itself serves.
        add_action('template_redirect', [$this, 'maybe_count'], 5);
    }

    /** The assistant behind a user agent, or null for humans and other bots. */
    public static function detect($user_agent) {
        $ua = (string) $user_agent;
        if ($ua === '') {
            return null;
        }
        foreach (self::AGENTS as $token => $agent) {
            if (stripos($ua, $token) !== false) {
                return $agent;
            }
        }
        return null;
    }

    public function maybe_count() {
        $agent = self::detect(sanitize_text_field(wp_unslash((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''))));
        if ($agent === null) {
            return;
        }
        self::record($agent);
    }

    /** Increment today's counter for one assistant; trim the rolling window. */
    public static function record($agent, $day = null) {
        $day = $day ?: gmdate('Y-m-d');
        $hits = get_option(self::OPTION, []);
        if (!is_array($hits)) {
            $hits = [];
        }
        if (!isset($hits[$day]) || !is_array($hits[$day])) {
            $hits[$day] = [];
        }
        $hits[$day][$agent] = (int) ($hits[$day][$agent] ?? 0) + 1;
        // Rolling window: drop days older than KEEP_DAYS.
        $cutoff = gmdate('Y-m-d', time() - self::KEEP_DAYS * DAY_IN_SECONDS);
        foreach (array_keys($hits) as $d) {
            if ($d < $cutoff) {
                unset($hits[$d]);
            }
        }
        // autoload false: read on demand by the webhook action, never on every page.
        if (get_option(self::OPTION, null) === null) {
            add_option(self::OPTION, $hits, '', 'no');
        } else {
            update_option(self::OPTION, $hits, false);
        }
    }

    /**
     * Counts for a date range (inclusive, 'YYYY-MM-DD'), total and per
     * assistant, plus the same for the period before it of equal length.
     * The `get_ai_crawler_stats` webhook action.
     */
    public static function stats($params) {
        $days = max(1, min(56, (int) ($params['days'] ?? 7)));
        $end  = !empty($params['end']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $params['end'])
            ? (string) $params['end'] : gmdate('Y-m-d');
        $end_ts   = strtotime($end . ' 00:00:00 UTC');
        $start_ts = $end_ts - ($days - 1) * DAY_IN_SECONDS;
        $prev_end_ts   = $start_ts - DAY_IN_SECONDS;
        $prev_start_ts = $prev_end_ts - ($days - 1) * DAY_IN_SECONDS;

        $hits = get_option(self::OPTION, []);
        if (!is_array($hits)) {
            $hits = [];
        }
        $sum = function ($from_ts, $to_ts) use ($hits) {
            $total = 0;
            $by = [];
            foreach ($hits as $day => $agents) {
                $ts = strtotime($day . ' 00:00:00 UTC');
                if ($ts === false || $ts < $from_ts || $ts > $to_ts || !is_array($agents)) {
                    continue;
                }
                foreach ($agents as $agent => $n) {
                    $n = (int) $n;
                    $total += $n;
                    $by[$agent] = (int) ($by[$agent] ?? 0) + $n;
                }
            }
            arsort($by);
            $list = [];
            foreach ($by as $agent => $n) {
                $list[] = ['agent' => $agent, 'label' => self::LABELS[$agent] ?? $agent, 'count' => $n];
            }
            return ['total' => $total, 'byAgent' => $list];
        };

        $current  = $sum($start_ts, $end_ts);
        $previous = $sum($prev_start_ts, $prev_end_ts);
        return [
            'period'   => ['start' => gmdate('Y-m-d', $start_ts), 'end' => $end, 'days' => $days],
            'total'    => $current['total'],
            'byAgent'  => $current['byAgent'],
            'previous' => ['total' => $previous['total']],
            // How long we have been counting: a zero on a site that only
            // started counting yesterday is not "no AI reads your site".
            'trackingSince' => empty($hits) ? null : min(array_keys($hits)),
        ];
    }

    /**
     * The technical half of the "AI ready" checklist, answered from inside
     * WordPress. Each item: key, ok, and a short detail the dashboard may show.
     * The `get_ai_readiness` webhook action.
     */
    public static function readiness() {
        $items = [];

        // llms.txt: served by WebMaven_AI_Discovery unless a real SEO plugin owns it.
        $items[] = ['key' => 'llms_txt', 'ok' => class_exists('WebMaven_AI_Discovery'), 'detail' => home_url('/llms.txt')];

        // Structured data: ours, or a real SEO plugin's (both count as ready).
        $seo_plugin = defined('WPSEO_VERSION') || defined('RANK_MATH_VERSION') || defined('AIOSEO_VERSION')
            || defined('SEOPRESS_VERSION') || defined('THE_SEO_FRAMEWORK_VERSION');
        $items[] = [
            'key' => 'structured_data',
            'ok' => $seo_plugin || class_exists('WebMaven_Structured_Data'),
            'detail' => $seo_plugin ? 'by your SEO plugin' : 'Organization, products, posts, FAQs',
        ];

        // A business description AI can read (llms.txt summary or the tagline).
        $summary = trim((string) get_option('webmaven_llms_summary', ''));
        $tagline = trim((string) get_option('blogdescription', ''));
        $items[] = ['key' => 'description', 'ok' => $summary !== '' || strlen($tagline) > 20, 'detail' => $summary !== '' ? 'set' : ($tagline !== '' ? 'from the tagline' : 'missing')];

        // Indexable: search engines and AI crawlers are not told to stay out.
        $items[] = ['key' => 'indexable', 'ok' => (int) get_option('blog_public', 1) === 1, 'detail' => (int) get_option('blog_public', 1) === 1 ? 'open to search engines' : 'discouraged in Settings > Reading'];

        // Products and posts that AI can quote: a live catalog and content.
        $products = class_exists('WooCommerce') ? (int) wp_count_posts('product')->publish : null;
        if ($products !== null) {
            $items[] = ['key' => 'products', 'ok' => $products > 0, 'detail' => $products . ' published'];
        }
        $posts = (int) wp_count_posts('post')->publish;
        $items[] = ['key' => 'content', 'ok' => $posts > 0, 'detail' => $posts . ' published'];

        // Social profiles known to the structured data (sameAs): the API fills
        // the account-side truth; this is what the site currently declares.
        $cfg = json_decode((string) get_option(WebMaven_Structured_Data::OPTION, ''), true);
        $same_as = is_array($cfg) && !empty($cfg['sameAs']) && is_array($cfg['sameAs']) ? count($cfg['sameAs']) : 0;
        $items[] = ['key' => 'profiles', 'ok' => $same_as > 0, 'detail' => $same_as . ' linked'];

        return ['items' => $items];
    }
}
