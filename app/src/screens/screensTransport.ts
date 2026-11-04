/**
 * The plugin's transport for the screens it shares with the dashboard
 * (@yotako/wpmaven-screens, 1.7.0): the REST proxy
 * (webmaven_wp/v1/proxy/<path>), which forwards the API's site routes for
 * this WordPress user's tier and refuses another business. The screens name
 * the API's own paths ('/operators/approvals'); the proxy takes them
 * without the leading slash.
 *
 * The changes a team member prepared are published and discarded through
 * the plugin's own edit routes (webmaven/v1/edits), the way the editor, the
 * chat and the Store reach them: their answer is the EditResult itself.
 *
 * Each call resolves with the answer's payload and rejects with a
 * ScreensApiError: the API's status, code and body, its sentence as the
 * message; ECONNABORTED when no answer came back in time and ERR_NETWORK
 * when none came back at all, so the shared rules (noAnswer,
 * DECISION_OUTCOME_UNKNOWN) read it as they do in the dashboard. The
 * original ProxyError stays on it, for the plugin's own words (errorText).
 */
import {
  ScreensApiError, isScreensApiError, type ScreensCallOptions, type ScreensQuery, type ScreensTransport,
} from '@yotako/wpmaven-screens';
import { getInstanceId, ProxyError, proxy, type ProxyQuery } from '../services/proxyClient';
import { EditsRequestError, editsFetch } from '../services/edits';

/** A ScreensApiError that keeps the plugin's own error, for its words. */
export class PluginScreensError extends ScreensApiError {
  /** The proxy's or the edit routes' error it was made from. */
  readonly source: ProxyError | EditsRequestError | null;

  constructor(init: ConstructorParameters<typeof ScreensApiError>[0], source: ProxyError | EditsRequestError | null) {
    super(init);
    this.source = source;
  }
}

/**
 * The proxy answered for the API, which never did: WordPress could not
 * reach it, or gave up waiting (the proxy's 500 with the HTTP library's
 * own words, "cURL error 28: Operation timed out ...").
 */
function upstreamSilence(e: ProxyError): 'ECONNABORTED' | 'ERR_NETWORK' | null {
  if (e.status < 500 || e.code !== null || e.data !== null) return null;
  if (/timed out/i.test(e.message)) return 'ECONNABORTED';
  if (/^cURL error \d+/i.test(e.message) || /fsocket/i.test(e.message)) return 'ERR_NETWORK';
  return null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A proxy failure as the screens read it. */
export function screensErrorOf(e: unknown): ScreensApiError {
  if (isScreensApiError(e)) return e;
  if (e instanceof ProxyError) {
    if (e.status === 0 || e.code === 'network') {
      return new PluginScreensError({ status: 0, code: 'ERR_NETWORK', message: e.message }, e);
    }
    const silence = upstreamSilence(e);
    if (silence) return new PluginScreensError({ status: 0, code: silence, message: e.message }, e);
    // The API's body when it answered (its { success, error, code }, or a
    // row a refusal carries); else the proxy's or WordPress's own refusal,
    // in that shape. Nothing readable (a gateway answering in the API's or
    // WordPress's place) stays nothing, which the shared rules read as no
    // answer on a 502, 503 or 504.
    const own = !!e.code && e.code !== 'bad_response';
    const data = isObj(e.data) ? e.data : own ? { success: false, error: e.message, code: e.code } : null;
    return new PluginScreensError({ status: e.status, code: e.code, data, message: e.message }, e);
  }
  if (e instanceof EditsRequestError) {
    const code = e.code === 'TIMEOUT' ? 'ECONNABORTED' : 'ERR_NETWORK';
    return new PluginScreensError({ status: 0, code, message: e.message }, e);
  }
  const message = e instanceof Error && e.message ? e.message : 'The request could not be sent';
  return new PluginScreensError({ status: 0, code: null, message }, null);
}

/** The API's path as the proxy takes it: no leading slash. */
export function proxyPath(path: string): string {
  return path.replace(/^\/+/, '');
}

const OP = '[a-z0-9]{20,40}';
const EDIT_ACTIONS = new RegExp(`^/instances/([^/]+)/edits/(${OP})/(publish|discard|share|undo)$`);
const EDIT_ONE = new RegExp(`^/instances/([^/]+)/edits/(${OP})$`);
const EDIT_NEW = /^\/instances\/([^/]+)\/edits$/;

/**
 * The plugin's own edit route for an API edit path of this site
 * (webmaven/v1/edits...), or null: another site's path, or a path the
 * plugin's edit routes do not carry, goes through the proxy (which refuses
 * another business).
 */
export function editRoute(method: 'GET' | 'POST', path: string, instanceId: string | undefined = getInstanceId()): string | null {
  if (!instanceId) return null;
  const ours = (id: string) => decodeURIComponent(id) === instanceId;
  if (method === 'POST') {
    const created = EDIT_NEW.exec(path);
    if (created && ours(created[1])) return '/edits';
    const action = EDIT_ACTIONS.exec(path);
    if (action && ours(action[1])) return `/edits/${action[2]}/${action[3]}`;
  }
  if (method === 'GET') {
    const one = EDIT_ONE.exec(path);
    if (one && ours(one[1])) return `/edits/${one[2]}`;
  }
  return null;
}

/** An edit call's own wait: the screens ask for more than a usual call when a publish waits for the site. */
const EDIT_DEFAULT_TIMEOUT_MS = 60_000;

/** One call to the plugin's edit routes, read as the screens read an answer. */
async function editCall<T>(method: 'GET' | 'POST', route: string, body: unknown, opts?: ScreensCallOptions): Promise<T> {
  let answer: { status: number; body: unknown };
  try {
    answer = await editsFetch(route, {
      method,
      ...(method === 'POST' ? { body: body ?? {} } : {}),
      timeoutMs: opts?.timeoutMs ?? EDIT_DEFAULT_TIMEOUT_MS,
    });
  } catch (e) {
    throw screensErrorOf(e);
  }
  if (answer.status >= 200 && answer.status < 300) return answer.body as T;
  const data = isObj(answer.body) ? answer.body : null;
  const code = data && typeof data.code === 'string' ? data.code : null;
  const message = data && typeof data.error === 'string' && data.error.trim() ? data.error : undefined;
  throw new PluginScreensError({ status: answer.status, code, data, message }, null);
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw screensErrorOf(e);
  }
}

/** The proxy's query: the screens' own, as it is. */
const query = (q?: ScreensQuery): ProxyQuery | undefined => q as ProxyQuery | undefined;

/**
 * The screens' calls on the proxy. The proxy and WordPress keep their own
 * waits (a decision publishes inside its call, an AI call is given more),
 * so a screen's timeoutMs is read only by the edit routes.
 */
export const pluginScreensTransport: ScreensTransport = {
  get: <T = unknown>(path: string, q?: ScreensQuery, opts?: ScreensCallOptions) => {
    const route = editRoute('GET', path);
    return route ? editCall<T>('GET', route, undefined, opts) : call(() => proxy.get<T>(proxyPath(path), query(q)));
  },
  post: <T = unknown>(path: string, body?: unknown, opts?: ScreensCallOptions) => {
    const route = editRoute('POST', path);
    return route ? editCall<T>('POST', route, body, opts) : call(() => proxy.post<T>(proxyPath(path), body));
  },
  patch: <T = unknown>(path: string, body?: unknown) => call(() => proxy.patch<T>(proxyPath(path), body)),
  del: <T = unknown>(path: string) => call(() => proxy.delete<T>(proxyPath(path))),
};
