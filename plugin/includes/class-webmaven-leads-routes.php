<?php
/**
 * The Messages screen's routes (webmaven_wp/v1, 2026-10-05): the form
 * messages the site keeps (WebMaven_Leads), for the signed-in WordPress user.
 *
 *   GET    /leads                 LeadsPage (status, form, search, page, per_page)
 *   GET    /leads/:id             {lead}, marked seen
 *   POST   /leads/:id             {status?, note?} -> {lead}
 *   POST   /leads/:id/reply       {subject, body} -> {sent, via, lead}
 *   GET    /leads/export          text/csv (from, to, status), an export event
 *   DELETE /leads/:id             {deleted: true}
 *   GET    /leads/settings        {retentionMonths, mail, removeOnUninstall, copy}
 *   POST   /leads/settings        {retentionMonths?, removeOnUninstall?} -> the same
 *
 * Every route takes the cookie and its wp_rest nonce (WordPress drops the
 * cookie's user without it) and checks the Messages capability
 * (WebMaven_Leads::capability(): editors and above unless the
 * wpmaven_messages_capability filter says otherwise); changing the settings
 * takes manage_options. The visitor's text comes back as plain text, never
 * HTML. Errors are WP_Error(code, the owner's sentence, status).
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-webmaven-log.php';

if (!class_exists('WebMaven_Leads')) {
    require_once __DIR__ . '/class-webmaven-leads.php';
}

final class WebMaven_Leads_Routes {

    const NS = 'webmaven_wp/v1';
    const EXPORT_ROUTE = '/leads/export';

    /** A command error code and the HTTP status the app gets for it. */
    const STATUS_FOR = [
        'NOT_FOUND' => 404,
        'VALIDATION' => 400,
        'RATE_LIMITED' => 429,
        'MAIL_FAILED' => 502,
        'WRITE_FAILED' => 500,
    ];

    private static $initialized = false;

    public static function init() {
        if (self::$initialized) {
            return;
        }
        self::$initialized = true;
        add_action('rest_api_init', [__CLASS__, 'register_routes']);
        add_filter('rest_pre_serve_request', [__CLASS__, 'serve_csv'], 10, 4);
    }

    public static function register_routes() {
        $id = [
            'id' => [
                'validate_callback' => function ($value) {
                    return is_numeric($value) && (int) $value > 0;
                },
            ],
        ];
        register_rest_route(self::NS, '/leads', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'list_leads'],
            'permission_callback' => [__CLASS__, 'can_read'],
        ]);
        register_rest_route(self::NS, self::EXPORT_ROUTE, [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'export'],
            'permission_callback' => [__CLASS__, 'can_read'],
        ]);
        register_rest_route(self::NS, '/leads/settings', [
            [
                'methods' => 'GET',
                'callback' => [__CLASS__, 'get_settings'],
                'permission_callback' => [__CLASS__, 'can_read'],
            ],
            [
                'methods' => 'POST',
                'callback' => [__CLASS__, 'save_settings'],
                'permission_callback' => [__CLASS__, 'can_change_settings'],
            ],
        ]);
        register_rest_route(self::NS, '/leads/(?P<id>\d+)', [
            [
                'methods' => 'GET',
                'callback' => [__CLASS__, 'read_lead'],
                'permission_callback' => [__CLASS__, 'can_read'],
                'args' => $id,
            ],
            [
                'methods' => 'POST',
                'callback' => [__CLASS__, 'update_lead'],
                'permission_callback' => [__CLASS__, 'can_read'],
                'args' => $id,
            ],
            [
                'methods' => 'DELETE',
                'callback' => [__CLASS__, 'delete_lead'],
                'permission_callback' => [__CLASS__, 'can_read'],
                'args' => $id,
            ],
        ]);
        register_rest_route(self::NS, '/leads/(?P<id>\d+)/reply', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'reply_lead'],
            'permission_callback' => [__CLASS__, 'can_read'],
            'args' => $id,
        ]);
    }

    // ── Who may ────────────────────────────────────────────────────────────

    public static function can_read() {
        if (current_user_can(WebMaven_Leads::capability())) {
            return true;
        }
        return new WP_Error('rest_forbidden', 'You do not have access to the messages on this site.', ['status' => self::denied_status()]);
    }

    public static function can_change_settings() {
        if (current_user_can(WebMaven_Leads::SETTINGS_CAPABILITY)) {
            return true;
        }
        return new WP_Error('rest_forbidden', 'Only an administrator can change these settings.', ['status' => self::denied_status()]);
    }

    private static function denied_status() {
        return function_exists('rest_authorization_required_code') ? rest_authorization_required_code() : 403;
    }

    // ── Handlers ───────────────────────────────────────────────────────────

    public static function list_leads($request) {
        return self::run(function () use ($request) {
            return WebMaven_Leads::list_page([
                'page' => $request->get_param('page'),
                'per_page' => $request->get_param('per_page'),
                'status' => $request->get_param('status'),
                'form' => $request->get_param('form'),
                'search' => $request->get_param('search'),
            ]);
        });
    }

    public static function read_lead($request) {
        return self::run(function () use ($request) {
            return ['lead' => WebMaven_Leads::read((int) $request->get_param('id'), true, self::actor())];
        });
    }

    public static function update_lead($request) {
        return self::run(function () use ($request) {
            $body = self::body($request);
            $patch = [];
            if (array_key_exists('status', $body)) {
                $patch['status'] = $body['status'];
            }
            if (array_key_exists('note', $body)) {
                $patch['note'] = $body['note'];
            }
            return ['lead' => WebMaven_Leads::update((int) $request->get_param('id'), $patch, self::actor())];
        });
    }

    public static function reply_lead($request) {
        return self::run(function () use ($request) {
            $body = self::body($request);
            return WebMaven_Leads::reply((int) $request->get_param('id'), $body['subject'] ?? '', $body['body'] ?? '', self::actor());
        });
    }

    public static function delete_lead($request) {
        return self::run(function () use ($request) {
            return WebMaven_Leads::delete((int) $request->get_param('id'));
        });
    }

    public static function get_settings($request = null) {
        return self::run(function () {
            return WebMaven_Leads::settings();
        });
    }

    public static function save_settings($request) {
        return self::run(function () use ($request) {
            return WebMaven_Leads::save_settings(self::body($request));
        });
    }

    /** The CSV as a download; serve_csv() sends it as is, not as JSON. */
    public static function export($request) {
        try {
            $out = WebMaven_Leads::export([
                'from' => $request->get_param('from'),
                'to' => $request->get_param('to'),
                'status' => $request->get_param('status'),
            ], self::actor());
        } catch (\Throwable $e) {
            return self::error_from($e);
        }
        $response = new WP_REST_Response($out['csv'], 200);
        $response->header('Content-Type', 'text/csv; charset=utf-8');
        $response->header('Content-Disposition', 'attachment; filename="' . $out['filename'] . '"');
        $response->header('Cache-Control', 'no-store');
        $response->header('X-Content-Type-Options', 'nosniff');
        return $response;
    }

    /**
     * rest_pre_serve_request: the export route's body goes out as the CSV
     * file itself (the headers were sent from the response just before).
     * Every other answer, and the export's errors, stay JSON.
     */
    public static function serve_csv($served, $result, $request, $server = null) {
        if ($served || !is_object($result) || !is_object($request) || !method_exists($request, 'get_route')) {
            return $served;
        }
        if ($request->get_route() !== '/' . self::NS . self::EXPORT_ROUTE || !method_exists($result, 'get_status') || $result->get_status() !== 200) {
            return $served;
        }
        $csv = method_exists($result, 'get_data') ? $result->get_data() : null;
        if (!is_string($csv)) {
            return $served;
        }
        echo $csv; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- a CSV file, not HTML.
        return true;
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private static function actor() {
        return function_exists('get_current_user_id') ? (int) get_current_user_id() : 0;
    }

    /** The JSON body (or the form body) as an array. */
    private static function body($request) {
        $json = method_exists($request, 'get_json_params') ? $request->get_json_params() : null;
        if (is_array($json)) {
            return $json;
        }
        $form = method_exists($request, 'get_body_params') ? $request->get_body_params() : [];
        return is_array($form) ? $form : [];
    }

    private static function run(callable $handler) {
        try {
            $out = $handler();
            return function_exists('rest_ensure_response') ? rest_ensure_response($out) : $out;
        } catch (\Throwable $e) {
            return self::error_from($e);
        }
    }

    /** "CODE: sentence" from WebMaven_Leads as a WP_Error the app reads. */
    public static function error_from(\Throwable $e) {
        if (preg_match('/^([A-Z_]+):\s*(.*)$/s', $e->getMessage(), $m)) {
            return new WP_Error(strtolower($m[1]), $m[2], ['status' => self::STATUS_FOR[$m[1]] ?? 400]);
        }
        WebMaven_Log::write('WPMaven messages: a request failed (' . get_class($e) . ').');
        return new WP_Error('messages_failed', 'Something went wrong with your messages. Try again.', ['status' => 500]);
    }
}
