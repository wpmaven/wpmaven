/**
 * The plugin's way to WPMaven for the shared screens and the setup wizard:
 * calls go through this plugin's wizard proxy, webmaven_wp/v1/wizard/<path>
 * (administrators, REST nonce), so the site's token stays on the server and
 * WPMaven's status and body come back as they are. The build stream, the
 * static preview and the bundle go straight from the browser to WPMaven,
 * authorized by the ticket or the preview token in the address.
 *
 * Kept apart from the wizard's host (pluginHost.ts) so the screens that only
 * call WPMaven do not bring the setup wizard into the app's bundle.
 */
import { WizardApiError, type WizardRequest, type WizardTransport } from '@yotako/wpmaven-onboarding/shared';
import { SITE_NOT_CONNECTED_CODE, SITE_NOT_CONNECTED_EVENT } from '../services/api';

/** A call gives up after this long (the proxy gives WPMaven 120 s, PHP 150 s). */
export const WIZARD_TIMEOUT_MS = 125_000;
/** WPMaven's api for the browser when the page names none (the plugin's own default). */
export const DEFAULT_BROWSER_API_BASE_URL = 'https://api.wpmaven.ai/api';
/** The proxy's code for an answer that is not JSON; the transport uses it for WordPress's own. */
export const UNREADABLE_CODE = 'wpmaven_api_unreadable';
export const UNREADABLE_TEXT = 'WordPress sent an answer the setup cannot read. Try again in a moment.';

type Json = Record<string, any>;

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

function wpData(): Json {
  return (typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA : null) || {};
}

// ── transport ──────────────────────────────────────────────────────────────

function withQuery(url: string, query?: Record<string, string>): string {
  const qs = query ? new URLSearchParams(query).toString() : '';
  if (!qs) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${qs}`;
}

/**
 * The proxy's address for an api path: `${restUrl}/wizard/onboarding/start`,
 * plus the query. Plain permalinks (restUrl `/?rest_route=/webmaven_wp/v1`)
 * take the query after an `&`.
 */
export function wizardUrl(path: string, query?: Record<string, string>): string {
  const rest = String(wpData().restUrl ?? '').replace(/\/+$/, '');
  return withQuery(`${rest}/wizard/${path.replace(/^\/+/, '')}`, query);
}

/**
 * WPMaven's /api root for the browser (remotes.browserApiBaseUrl), read as
 * backend/includes/class-realtime.php reads it for the chat's stream: no
 * trailing slash, ws(s) becomes http(s), https when it names no scheme, and
 * one /api at the end.
 */
export function browserApiRoot(raw: unknown = wpData().remotes?.browserApiBaseUrl): string {
  let url = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : DEFAULT_BROWSER_API_BASE_URL;
  url = url.replace(/\/+$/, '');
  if (/^wss:\/\//i.test(url)) url = `https://${url.slice(6)}`;
  else if (/^ws:\/\//i.test(url)) url = `http://${url.slice(5)}`;
  else if (!/^https?:\/\//i.test(url)) url = `https://${url.replace(/^\/+/, '')}`;
  if (url.endsWith('/api')) url = url.slice(0, -4);
  return `${url}/api`;
}

/** An address the browser opens itself (the stream, the preview, the bundle), authorized by its query. */
export function ticketedUrl(path: string, query: Record<string, string>): string {
  return withQuery(`${browserApiRoot()}${path.startsWith('/') ? path : `/${path}`}`, query);
}

interface Answer {
  status: number;
  data: unknown;
  /** False when the body was neither empty nor JSON. */
  readable: boolean;
}

function readBody(body: string): Pick<Answer, 'data' | 'readable'> {
  if (body.trim() === '') return { data: null, readable: true };
  try {
    return { data: JSON.parse(body), readable: true };
  } catch {
    return { data: null, readable: false };
  }
}

/** One call to WordPress with the REST nonce; rejects only when no answer came back. */
export async function send(url: string, method: WizardRequest['method'], body: unknown, timeoutMs: number): Promise<Answer> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const headers: Record<string, string> = { Accept: 'application/json', 'X-WP-Nonce': String(wpData().nonce ?? '') };
  // A PUT travels as a POST with X-HTTP-Method-Override, as WordPress's own
  // apiFetch sends it: some hosts refuse PUT, and the REST server hands the
  // proxy a PUT all the same.
  if (method === 'PUT') headers['X-HTTP-Method-Override'] = 'PUT';
  const init: RequestInit = {
    method: method === 'GET' ? 'GET' : 'POST',
    headers,
    credentials: 'same-origin',
    signal: controller.signal,
  };
  if (method !== 'GET' && body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  try {
    const response = await fetch(url, init);
    const raw = await response.text();
    return { status: response.status, ...readBody(raw) };
  } catch {
    throw timedOut
      ? new WizardApiError({ status: 0, code: 'ECONNABORTED', message: `timeout of ${timeoutMs}ms exceeded` })
      : new WizardApiError({ status: 0, code: 'ERR_NETWORK', message: 'Network Error' });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The wizard's calls, through the proxy. Resolves with the body WPMaven
 * sent; rejects with a WizardApiError outside 2xx (status and body), without
 * an answer (ERR_NETWORK) or after the call's time (ECONNABORTED). The
 * plugin's "this site is not connected" also tells the app, which reads the
 * connection again (as services/api.js does).
 */
export function createPluginTransport(): WizardTransport {
  return {
    async request<T = unknown>(call: WizardRequest): Promise<T> {
      const wanted = typeof call.timeoutMs === 'number' && call.timeoutMs > 0 ? call.timeoutMs : WIZARD_TIMEOUT_MS;
      const answer = await send(wizardUrl(call.path, call.query), call.method, call.body, Math.min(wanted, WIZARD_TIMEOUT_MS));
      if (answer.status >= 200 && answer.status < 300) {
        if (!answer.readable) throw new WizardApiError({ status: 502, code: UNREADABLE_CODE, message: UNREADABLE_TEXT });
        return answer.data as T;
      }
      if ((answer.status === 409 || answer.status === 401) && isObj(answer.data) && answer.data.code === SITE_NOT_CONNECTED_CODE) {
        window.dispatchEvent(new CustomEvent(SITE_NOT_CONNECTED_EVENT));
      }
      throw new WizardApiError({ status: answer.status, data: answer.data });
    },
    ticketedUrl,
  };
}
