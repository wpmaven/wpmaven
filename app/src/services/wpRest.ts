/**
 * One client for WordPress's REST API as the signed-in user: wp/v2,
 * wc/v3 and the plugin's own webmaven_wp/v1, all from the REST root
 * WordPress reports (rest_url(): "https://site/wp-json/", or
 * "https://site/?rest_route=/" without pretty permalinks), never from the
 * site's address.
 *
 * The cookie authenticates only with a wp_rest nonce. WordPress sends a
 * fresh nonce back in X-WP-Nonce, which is kept; a request refused for a
 * stale nonce (rest_cookie_invalid_nonce, after a long idle tab) fetches a
 * new one from admin-ajax.php?action=rest-nonce once and is sent again.
 */

export class WpRestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly data: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'WpRestError';
  }
}

export interface WpRestAnswer<T> {
  data: T;
  /** X-WP-Total, when the answer is a list. */
  total: number;
  /** X-WP-TotalPages, when the answer is a list. */
  totalPages: number;
}

export type QueryValue = string | number | boolean | Array<string | number> | null | undefined;

export interface WpRestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

interface WpDataShape {
  nonce?: string;
  ajaxUrl?: string;
  wpRestUrl?: string;
  restUrl?: string;
  site?: { url?: string };
  storeApp?: { wpRestRoot?: string };
}

function wpData(): WpDataShape {
  return ((typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA : null) || {}) as WpDataShape;
}

/** The REST root, ending with "/" or with "rest_route=/". */
export function restRoot(data: WpDataShape = wpData()): string {
  const root = data.storeApp?.wpRestRoot;
  if (root) return root.endsWith('/') ? root : `${root}/`;
  // Older script data: WordPress's own wp/v2 base, or the plugin's REST base.
  for (const [base, suffix] of [[data.wpRestUrl, 'wp/v2'], [data.restUrl, 'webmaven_wp/v1']] as const) {
    if (base && base.replace(/\/+$/, '').endsWith(suffix)) return base.replace(/\/+$/, '').slice(0, -suffix.length);
  }
  return `${(data.site?.url || window.location.origin).replace(/\/+$/, '')}/wp-json/`;
}

/** Serializes a query: arrays become comma lists, empty values are left out. */
export function queryString(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    const v = Array.isArray(value) ? value.join(',') : typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return parts.join('&');
}

/** The URL of a route ("wc/v3/products") under a root, with its query. */
export function routeUrl(root: string, route: string, query?: Record<string, QueryValue>): string {
  const path = route.replace(/^\/+/, '');
  const qs = queryString(query);
  if (root.includes('rest_route=')) {
    const url = `${root}${path}`;
    return qs ? `${url}&${qs}` : url;
  }
  return qs ? `${root}${path}?${qs}` : `${root}${path}`;
}

let nonce: string | null = null;

function currentNonce(): string {
  if (nonce === null) nonce = wpData().nonce || '';
  return nonce;
}

/** Tests: forget the kept nonce. */
export function resetNonceForTests(): void {
  nonce = null;
}

async function freshNonce(): Promise<boolean> {
  const ajax = wpData().ajaxUrl;
  if (!ajax) return false;
  try {
    const res = await fetch(`${ajax}${ajax.includes('?') ? '&' : '?'}action=rest-nonce`, { credentials: 'same-origin' });
    const text = (await res.text()).trim();
    if (!res.ok || !/^[a-f0-9]{6,20}$/i.test(text)) return false;
    nonce = text;
    return true;
  } catch {
    return false;
  }
}

async function errorFrom(res: Response): Promise<WpRestError> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  // A route that forwards to the WPMaven account passes its answer through:
  // { error, code } for a refusal, or a failed edit's result ({ ok: false,
  // failures: [{ code, message }] }) when the change never got a history row.
  const failure = Array.isArray(body?.failures)
    ? body.failures.find((f: any) => f && typeof f.message === 'string' && f.message.trim())
    : null;
  const message = failure
    ? failure.message
    : typeof body?.error === 'string' && body.error.trim() ? body.error
      : typeof body?.message === 'string' && body.message.trim() ? body.message
        : res.status === 0 ? 'Your site did not answer. Check your connection, then try again.' : `The request failed (${res.status}).`;
  const code = typeof failure?.code === 'string' && failure.code
    ? failure.code
    : typeof body?.code === 'string' ? body.code : `http_${res.status}`;
  const data = body && typeof body.data === 'object' && body.data ? body.data : null;
  return new WpRestError(message, res.status, code, data);
}

async function send<T>(method: string, route: string, opts: WpRestOptions = {}, retried = false): Promise<WpRestAnswer<T>> {
  const headers: Record<string, string> = { 'X-WP-Nonce': currentNonce(), ...(opts.headers ?? {}) };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (typeof Blob !== 'undefined' && opts.body instanceof Blob) {
      body = opts.body;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
  }
  let res: Response;
  try {
    res = await fetch(routeUrl(restRoot(), route, opts.query), { method, headers, body, credentials: 'same-origin', signal: opts.signal });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new WpRestError('Your site did not answer. Check your connection, then try again.', 0, 'network');
  }
  const kept = res.headers.get('X-WP-Nonce');
  if (kept) nonce = kept;
  if (!res.ok) {
    const error = await errorFrom(res);
    if (!retried && error.code === 'rest_cookie_invalid_nonce' && (await freshNonce())) {
      return send<T>(method, route, opts, true);
    }
    throw error;
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return {
    data: data as T,
    total: Number(res.headers.get('X-WP-Total') ?? 0) || 0,
    totalPages: Number(res.headers.get('X-WP-TotalPages') ?? 0) || 0,
  };
}

export const wpRest = {
  get: <T>(route: string, opts?: WpRestOptions) => send<T>('GET', route, opts),
  post: <T>(route: string, body?: unknown, opts?: WpRestOptions) => send<T>('POST', route, { ...opts, body }),
  put: <T>(route: string, body?: unknown, opts?: WpRestOptions) => send<T>('PUT', route, { ...opts, body }),
  del: <T>(route: string, opts?: WpRestOptions) => send<T>('DELETE', route, opts),
};

/**
 * Upload one file to the media library (POST wp/v2/media), with progress
 * (fetch has none). WordPress keeps its own type and size checks.
 */
export function uploadMedia<T = any>(file: File, opts: { onProgress?: (fraction: number) => void; fields?: Record<string, string> } = {}): Promise<T> {
  const send = (retried: boolean): Promise<T> => new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', routeUrl(restRoot(), 'wp/v2/media'));
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-WP-Nonce', currentNonce());
    // The header carries the name; a name WordPress cannot read gets a safe one.
    const safeName = file.name.replace(/[^\w.\- ]+/g, '-') || 'upload';
    xhr.setRequestHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    if (xhr.upload && opts.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress!(e.loaded / e.total);
      };
    }
    xhr.onerror = () => reject(new WpRestError('The upload did not reach your site. Check your connection, then try again.', 0, 'network'));
    xhr.onload = () => {
      const kept = xhr.getResponseHeader('X-WP-Nonce');
      if (kept) nonce = kept;
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T);
        return;
      }
      const code = typeof body?.code === 'string' ? body.code : `http_${xhr.status}`;
      if (!retried && code === 'rest_cookie_invalid_nonce') {
        void freshNonce().then((ok) => (ok ? send(true).then(resolve, reject) : reject(new WpRestError(body?.message || 'Reload the page, then try again.', xhr.status, code))));
        return;
      }
      reject(new WpRestError(typeof body?.message === 'string' ? body.message : `The upload failed (${xhr.status}).`, xhr.status, code, body?.data ?? null));
    };
    xhr.send(file);
  });
  return send(false).then(async (media) => {
    const fields = opts.fields ?? {};
    const id = (media as { id?: number })?.id;
    if (!id || !Object.keys(fields).length) return media;
    const updated = await wpRest.post<T>(`wp/v2/media/${id}`, fields);
    return updated.data;
  });
}
