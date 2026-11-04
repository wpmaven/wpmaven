<?php
/**
 * A period an owner names ("today", "the last 30 days", or two dates),
 * resolved on the site, in the site's own time zone (wp_timezone): the
 * Store's reads and the messages commands answer what they counted with
 * the period they used, so the chat can say it.
 *
 *   resolve({period?, after?, before?}) -> {from, to, label, fromDate, toDate, timeZone} | null
 *
 * from and to are Unix timestamps (to excluded); fromDate and toDate are the
 * local days the period covers (both included). after and before are local
 * days (YYYY-MM-DD, both included). A bad value throws "VALIDATION: ...".
 */

if (!defined('ABSPATH')) {
    exit;
}

// Exceptions here end as the "error" of a JSON answer (the signed webhook,
// execute_command or a REST route), never in a page.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped

final class WebMaven_Store_Periods {

    const NAMES = ['today', 'yesterday', 'this_week', 'last_7_days', 'this_month', 'last_30_days', 'last_90_days', 'this_year'];
    const LABELS = [
        'today' => 'Today',
        'yesterday' => 'Yesterday',
        'this_week' => 'This week',
        'last_7_days' => 'The last 7 days',
        'this_month' => 'This month',
        'last_30_days' => 'The last 30 days',
        'last_90_days' => 'The last 90 days',
        'this_year' => 'This year',
    ];
    /** The longest custom period: two years and a day. */
    const MAX_DAYS = 732;

    /** The site's time zone (UTC when WordPress cannot say). */
    public static function zone(): DateTimeZone {
        if (function_exists('wp_timezone')) {
            $zone = wp_timezone();
            if ($zone instanceof DateTimeZone) {
                return $zone;
            }
        }
        return new DateTimeZone('UTC');
    }

    /** The period asked for, or null when the parameters name none. */
    public static function resolve(array $params, ?int $now = null): ?array {
        $name = is_string($params['period'] ?? null) ? trim($params['period']) : '';
        $after = is_string($params['after'] ?? null) ? trim($params['after']) : '';
        $before = is_string($params['before'] ?? null) ? trim($params['before']) : '';
        if ($name === '' && $after === '' && $before === '') {
            return null;
        }
        $zone = self::zone();
        $today = (new DateTimeImmutable('@' . ($now ?? time())))->setTimezone($zone)->setTime(0, 0, 0);
        if ($name !== '') {
            if (!in_array($name, self::NAMES, true)) {
                throw new Exception('VALIDATION: period is one of: ' . implode(', ', self::NAMES) . '.');
            }
            switch ($name) {
                case 'today':
                    $start = $today;
                    $end = $today->modify('+1 day');
                    break;
                case 'yesterday':
                    $start = $today->modify('-1 day');
                    $end = $today;
                    break;
                case 'this_week':
                    $first = (int) (function_exists('get_option') ? get_option('start_of_week', 1) : 1);
                    $back = ((int) $today->format('w') - $first + 7) % 7;
                    $start = $today->modify('-' . $back . ' days');
                    $end = $today->modify('+1 day');
                    break;
                case 'this_month':
                    $start = $today->modify('first day of this month');
                    $end = $today->modify('+1 day');
                    break;
                case 'this_year':
                    $start = $today->setDate((int) $today->format('Y'), 1, 1);
                    $end = $today->modify('+1 day');
                    break;
                default:
                    $days = (int) preg_replace('/\D/', '', $name);
                    $start = $today->modify('-' . ($days - 1) . ' days');
                    $end = $today->modify('+1 day');
            }
            return self::answer($start, $end, self::LABELS[$name], $zone);
        }
        $start = $after !== '' ? self::day($after, $zone, 'after') : null;
        $last = $before !== '' ? self::day($before, $zone, 'before') : null;
        if ($start === null) {
            $start = $last->modify('-29 days');
        }
        if ($last === null) {
            $last = $today;
        }
        if ($last < $start) {
            throw new Exception('VALIDATION: The end date comes before the start date.');
        }
        $end = $last->modify('+1 day');
        if (($end->getTimestamp() - $start->getTimestamp()) / 86400 > self::MAX_DAYS) {
            throw new Exception('VALIDATION: A period covers at most two years.');
        }
        $label = $start->format('Y-m-d') === $last->format('Y-m-d')
            ? $start->format('j F Y')
            : 'From ' . $start->format('j F Y') . ' to ' . $last->format('j F Y');
        return self::answer($start, $end, $label, $zone);
    }

    /** UTC "Y-m-d H:i:s" of a timestamp (the messages table keeps UTC). */
    public static function utc_sql(int $ts): string {
        return gmdate('Y-m-d H:i:s', $ts);
    }

    /** ISO 8601 UTC of a timestamp, as WooCommerce's REST reads dates_are_gmt. */
    public static function utc_iso(int $ts): string {
        return gmdate('Y-m-d\TH:i:s', $ts);
    }

    /** The public part of a period, for an answer. */
    public static function public_part(array $period): array {
        return [
            'label' => $period['label'],
            'from' => $period['fromDate'],
            'to' => $period['toDate'],
            'timeZone' => $period['timeZone'],
        ];
    }

    private static function day(string $value, DateTimeZone $zone, string $what): DateTimeImmutable {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            throw new Exception('VALIDATION: ' . $what . ' is a day like 2026-10-01.');
        }
        $day = DateTimeImmutable::createFromFormat('!Y-m-d', $value, $zone);
        if (!$day || $day->format('Y-m-d') !== $value) {
            throw new Exception('VALIDATION: ' . $what . ' is not a real day.');
        }
        return $day;
    }

    private static function answer(DateTimeImmutable $start, DateTimeImmutable $end, string $label, DateTimeZone $zone): array {
        return [
            'from' => $start->getTimestamp(),
            'to' => $end->getTimestamp(),
            'label' => $label,
            'fromDate' => $start->format('Y-m-d'),
            'toDate' => $end->modify('-1 day')->format('Y-m-d'),
            'timeZone' => $zone->getName(),
        ];
    }
}
