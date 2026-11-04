/**
 * The app's one way to the WPMaven API (1.3.0): the plugin's REST proxy,
 * webmaven_wp/v1/proxy/<path>, which forwards the API's route table for the
 * signed-in user's WordPress tier (backend WebMaven_Proxy).
 *
 * Every failure is a thrown ProxyError carrying the HTTP status and a code:
 * the API's own (SITE_ROLE, SITE_NOT_ENABLED, NO_ACCOUNT...), the proxy's
 * (wpmaven_role, wpmaven_not_allowed...) or WordPress's (rest_forbidden,
 * whose body says `message` where ours say `error`). Nothing here shows
 * text: screens turn a ProxyError into words with utils/apiWords.
 */

interface WpData {
  restUrl?: string;
  nonce?: string;
  instanceId?: string;
}

function getWpData(): WpData {
  return (typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA : null) || {};
}

/** Codes that mean "no" for this user, this site or this plugin: trying again changes nothing. */
const REFUSAL_CODES = new Set([
  'SITE_ROLE', 'wpmaven_role', 'rest_forbidden', 'rest_cookie_invalid_nonce',
  'SITE_NOT_ENABLED', 'SITE_SESSION_ONLY', 'wpmaven_not_allowed',
  'SITE_PLUGIN_UPDATE_REQUIRED', 'SITE_ACTOR_REQUIRED',
  'SITE_BUSINESS', 'wpmaven_business', 'SITE_SCOPE_MISSING',
  'SITE_PAUSED', 'SITE_FIRST_WEEK', 'SITE_NOT_ACTIVE',
  'wpmaven_site_not_connected', 'APPROVAL_IN_DASHBOARD',
]);

export class ProxyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
    public readonly code: string | null = null,
    public readonly retryAfter: number | null = null,
    /**
     * The answer's body as the API wrote it, when it answered: the proxy
     * passes it on in `data` (the API's { success, error, code }, or a
     * row a refusal still carries). Null otherwise.
     */
    public readonly data: unknown = null,
  ) {
    super(message);
    this.name = 'ProxyError';
  }

  /** The role, a switch or the plugin version said no: no Retry, no polling. */
  get refused(): boolean {
    return this.code !== null && REFUSAL_CODES.has(this.code);
  }
}

/** Whether an error is a refusal (see ProxyError.refused). */
export function isRefusal(err: unknown): boolean {
  return err instanceof ProxyError && err.refused;
}

/** ID of the instance this plugin install represents. */
export function getInstanceId(): string | undefined {
  return getWpData().instanceId || undefined;
}

export type ProxyQuery = Record<string, string | number | boolean | undefined | null>;

interface ProxyRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: ProxyQuery;
  body?: unknown;
  /** A route of the plugin itself (webmaven_wp/v1/<path>) instead of the API through the proxy. */
  local?: boolean;
}

/** The query string the proxy forwards ('' when none). */
export function queryString(query?: ProxyQuery): string {
  if (!query) return '';
  return Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** The proxy URL of an API path (or, local, of a route of the plugin itself). */
export function proxyUrl(path: string, query?: ProxyQuery, local = false): string {
  const wp = getWpData();
  const restUrl = wp.restUrl || '/wp-json/webmaven_wp/v1';
  const qs = queryString(query);
  const sep = restUrl.includes('?') ? '&' : '?';
  return `${restUrl}/${local ? '' : 'proxy/'}${path}${qs ? `${sep}${qs}` : ''}`;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

async function request<T>({ method, path, query, body, local }: ProxyRequest): Promise<T> {
  const headers: Record<string, string> = { 'X-WP-Nonce': getWpData().nonce || '' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(proxyUrl(path, query, local), {
      method,
      headers,
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ProxyError(`Network error: ${(err as Error).message}`, 0, path, 'network');
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    throw new ProxyError(`Non-JSON response (HTTP ${res.status})`, res.status, path, 'bad_response');
  }

  if (!res.ok || json?.success === false) {
    // The proxy's own refusal ({code, error}), the API's answer passed
    // through (its code on top, its body in data) or WordPress's ({code, message}).
    const inner = json && typeof json.data === 'object' && json.data !== null ? json.data : {};
    const code = str(json?.code) ?? str(inner.code);
    const message = str(json?.error) ?? str(inner.error) ?? str(json?.message) ?? `HTTP ${res.status}`;
    const retry = Number(inner.retryAfter ?? json?.retryAfter);
    throw new ProxyError(message, res.status, path, code, Number.isFinite(retry) && retry > 0 ? retry : null, json?.data ?? null);
  }

  return json.data as T;
}

export const proxy = {
  get: <T = unknown>(path: string, query?: ProxyQuery) =>
    request<T>({ method: 'GET', path, query }),
  post: <T = unknown>(path: string, body?: unknown) =>
    request<T>({ method: 'POST', path, body: body ?? {} }),
  put: <T = unknown>(path: string, body?: unknown) =>
    request<T>({ method: 'PUT', path, body: body ?? {} }),
  patch: <T = unknown>(path: string, body?: unknown) =>
    request<T>({ method: 'PATCH', path, body: body ?? {} }),
  delete: <T = unknown>(path: string) =>
    request<T>({ method: 'DELETE', path }),
};

/** The plugin's own routes (webmaven_wp/v1/<path>), with the same errors: nothing leaves the site. */
export const pluginRest = {
  get: <T = unknown>(path: string, query?: ProxyQuery) =>
    request<T>({ method: 'GET', path, query, local: true }),
  put: <T = unknown>(path: string, body?: unknown) =>
    request<T>({ method: 'PUT', path, body: body ?? {}, local: true }),
};
