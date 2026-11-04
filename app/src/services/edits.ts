/**
 * The plugin's client for edit operations (webmaven/v1/edits/*, proxied by
 * the plugin to the WPMaven API with the site's token). The editor, the
 * chat's edit cards and the Store use it.
 *
 * A change the API is still preparing answers 202 and is polled
 * (settleEdit); a refusal answers its row with ok:false and failures, or
 * { error, code } when there is no row. Nothing here invents a sentence the
 * API wrote: failures come through as written.
 */
import type {
  EditCheck, EditOperation, EditResult, EditStatus, SiteMap, SiteMapBlockText, SiteMapForm, SiteMapFact, SiteMapMenu, SiteMapPage, TokenColor,
} from '../types/edits';
import { nameOr, siteBrand, type SiteBrand } from '../utils/brand';

/** A request that did not reach the API, or a refusal without a row. */
export class EditsRequestError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = '') {
    super(message);
    this.name = 'EditsRequestError';
    this.status = status;
    this.code = code;
  }
}

function wpData(): any {
  return (typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA : null) || {};
}

/** webmaven/v1 on this site (pretty or plain permalinks). */
export function editsRestBase(): string {
  const d = wpData();
  const fromEditor = typeof d.editor?.restUrl === 'string' && d.editor.restUrl ? d.editor.restUrl : '';
  const base = fromEditor || (typeof d.restUrl === 'string' ? d.restUrl.replace('webmaven_wp/v1', 'webmaven/v1') : '/wp-json/webmaven/v1');
  return base.replace(/\/+$/, '');
}

/** The address of one route, with its query (a plain-permalink base already has a "?"). */
export function editsUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const base = editsRestBase();
  let url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const q = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  if (q.length) url += (url.includes('?') ? '&' : '?') + q.join('&');
  return url;
}

const DEFAULT_TIMEOUT = 45_000;

/**
 * One call to the edit routes as they answer: the status and the body (an
 * EditResult, or { error, code }). Throws only when no answer came back
 * (TIMEOUT, NETWORK). The shared screens' transport reads it as it is.
 */
export async function editsFetch(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string | number | undefined>; timeoutMs?: number } = {}): Promise<{ status: number; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT);
  try {
    const res = await fetch(editsUrl(path, init.query), {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        'X-WP-Nonce': String(wpData().nonce || ''),
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new EditsRequestError('Your site took too long to answer. Try again in a moment.', 0, 'TIMEOUT');
    }
    throw new EditsRequestError('Your site could not be reached. Check your connection and try again.', 0, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

/** Plain words from an answer (never markup). */
function plain(text: string): string {
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Whether a body is an edit operation's row (possibly a refused one). */
export function isEditResult(body: unknown): boolean {
  return isObj(body) && typeof body.status === 'string' && (typeof body.operationId === 'string' || Array.isArray(body.failures));
}

/** Any row as a complete EditResult (unknown parts empty). */
export function normalizeEditResult(body: any): EditResult {
  const b = isObj(body) ? body : {};
  const failures = Array.isArray(b.failures)
    ? b.failures.filter((f: unknown) => isObj(f)).map((f: any) => ({ code: str(f.code, 'ENGINE'), message: plain(str(f.message)) }))
    : [];
  return {
    ok: b.ok === true,
    operationId: str(b.operationId),
    mode: b.mode === 'publish' ? 'publish' : 'preview',
    status: (str(b.status, 'failed') as EditStatus),
    kind: str(b.kind, 'edit_section') as EditResult['kind'],
    summary: plain(str(b.summary)),
    changed: Array.isArray(b.changed) ? b.changed.filter(isObj).map((c: any) => ({
      kind: str(c.kind, 'page') as any,
      ref: str(c.ref),
      label: plain(str(c.label)),
      ...(typeof c.before === 'string' ? { before: plain(c.before) } : {}),
      ...(typeof c.after === 'string' ? { after: plain(c.after) } : {}),
    })) : [],
    ...(isObj(b.preview) && typeof b.preview.url === 'string' ? {
      preview: {
        url: b.preview.url,
        ...(typeof b.preview.shareUrl === 'string' ? { shareUrl: b.preview.shareUrl } : {}),
        ...(typeof b.preview.shareExpiresAt === 'string' ? { shareExpiresAt: b.preview.shareExpiresAt } : {}),
        ...(typeof b.preview.staticUrl === 'string' ? { staticUrl: b.preview.staticUrl } : {}),
        expiresAt: str(b.preview.expiresAt),
        pages: Array.isArray(b.preview.pages) ? b.preview.pages.filter(isObj).map((p: any) => ({ slug: str(p.slug), title: plain(str(p.title)), url: str(p.url) })) : [],
        ...(Array.isArray(b.preview.images) ? {
          images: b.preview.images.filter((i: any) => isObj(i) && typeof i.url === 'string' && typeof i.ref === 'string').map((i: any) => ({ ref: i.ref, url: i.url })),
        } : {}),
        ...(Array.isArray(b.preview.thumbnails) ? {
          thumbnails: b.preview.thumbnails.filter((t: any) => isObj(t) && typeof t.after === 'string').map((t: any) => ({
            ref: str(t.ref), width: t.width === 390 ? 390 : 1440, after: t.after, ...(typeof t.before === 'string' ? { before: t.before } : {}),
          })),
        } : {}),
      },
    } : {}),
    checks: normalizeChecks(b.checks),
    ...(typeof b.snapshotId === 'string' ? { snapshotId: b.snapshotId } : {}),
    failures,
    undoable: b.undoable === true,
    ...(isObj(b.undo) && Array.isArray(b.undo.alsoUndoes) ? {
      undo: { alsoUndoes: b.undo.alsoUndoes.filter(isObj).map((u: any) => ({ operationId: str(u.operationId), summary: plain(str(u.summary)) })) },
    } : {}),
    ...(typeof b.queuePosition === 'number' ? { queuePosition: b.queuePosition } : {}),
    ...(typeof b.previewId === 'string' ? { previewId: b.previewId } : {}),
    createdAt: str(b.createdAt),
    ...(typeof b.publishedAt === 'string' ? { publishedAt: b.publishedAt } : {}),
    source: (str(b.source, 'editor') as EditResult['source']),
  };
}

export function normalizeChecks(raw: unknown): EditCheck[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObj).filter((c: any) => typeof c.message === 'string' && c.message.trim()).map((c: any) => ({
    kind: str(c.kind, 'page_job') as EditCheck['kind'],
    severity: c.severity === 'broken' ? 'broken' : c.severity === 'warn' ? 'warn' : 'info',
    ...(typeof c.page === 'string' ? { page: c.page } : {}),
    ...(typeof c.sectionId === 'string' ? { sectionId: c.sectionId } : {}),
    ...(c.width === 390 || c.width === 1440 ? { width: c.width } : {}),
    message: plain(c.message),
  }));
}

/** A row from an answer, or the refusal as an error. */
function rowOrThrow(res: { status: number; body: any }): EditResult {
  if (isEditResult(res.body)) return normalizeEditResult(res.body);
  const b = isObj(res.body) ? res.body : {};
  const message = typeof b.error === 'string' && b.error.trim() ? plain(b.error)
    : typeof b.message === 'string' && b.message.trim() ? plain(b.message)
      : couldNotDoText();
  throw new EditsRequestError(message, res.status, typeof b.code === 'string' ? b.code : '');
}

/** Words by block (a section's, a part's), as the site map sends them. */
function blockTexts(raw: unknown): SiteMapBlockText[] {
  return Array.isArray(raw)
    ? raw.filter((x: any) => isObj(x) && typeof x.path === 'string' && x.path && typeof x.text === 'string').map((x: any) => ({
      path: x.path, kind: str(x.kind, 'text'), text: plain(x.text),
      ...(typeof x.url === 'string' ? { url: x.url } : {}),
      ...(typeof x.level === 'number' ? { level: x.level } : {}),
    }))
    : [];
}

/** A section's pictures by their slot: their file and alt text (a designed section's too: the window names its picture, 2026-10-19). */
function sectionImages(s: any): Partial<SiteMapPage['sections'][number]> {
  const images = Array.isArray(s.images)
    ? s.images.filter((i: any) => isObj(i) && typeof i.slot === 'string').map((i: any) => ({ slot: i.slot, file: str(i.file), alt: str(i.alt) }))
    : [];
  return images.length ? { images } : {};
}

/** What a section of a page of WordPress blocks carries beyond its id, words and pictures (nothing on a designed site). */
function blockSectionFields(s: any): Partial<SiteMapPage['sections'][number]> {
  const blocks = blockTexts(s.blocks);
  return {
    ...(typeof s.kind === 'string' ? { kind: s.kind } : {}),
    ...(blocks.length ? { blocks } : {}),
    ...(s.locked === true ? { locked: true } : {}),
    ...(s.productGrid === true ? { productGrid: true } : {}),
    ...(s.form === true ? { form: true } : {}),
    ...(s.builder === 'elementor' ? { builder: 'elementor' as const } : {}),
  };
}

/** A block site's theme, parts, posts and classic menus (absent on a designed site). */
function blockSiteFields(b: any): Partial<SiteMap> {
  const t = isObj(b.theme) ? b.theme : null;
  return {
    ...(t && typeof t.slug === 'string' ? { theme: { slug: t.slug, name: plain(str(t.name, t.slug)), kind: t.kind === 'classic' ? 'classic' : 'block', supportsGlobalStyles: t.supportsGlobalStyles === true } } : {}),
    ...(Array.isArray(b.parts) ? {
      parts: b.parts.filter((p: any) => isObj(p) && typeof p.slug === 'string').map((p: any) => ({
        slug: p.slug, area: str(p.area), title: plain(str(p.title, p.slug)), customized: p.customized === true, excerpt: plain(str(p.excerpt)),
        ...(Array.isArray(p.blocks) ? { blocks: blockTexts(p.blocks) } : {}),
        ...(isObj(p.shows) ? { shows: { siteTitle: p.shows.siteTitle === true, tagline: p.shows.tagline === true } } : {}),
      })),
    } : {}),
    ...(isObj(b.styles) ? {
      styles: {
        canWrite: b.styles.canWrite === true,
        fonts: Array.isArray(b.styles.fonts) ? b.styles.fonts.filter((f: unknown) => typeof f === 'string').map((f: string) => plain(f)) : [],
        ...(typeof b.styles.reason === 'string' ? { reason: plain(b.styles.reason) } : {}),
      },
    } : {}),
    ...(Array.isArray(b.posts) ? { posts: b.posts.filter((p: any) => isObj(p) && typeof p.postId === 'number').map((p: any) => ({ postId: p.postId, title: plain(str(p.title)), url: str(p.url) })) } : {}),
    ...(isObj(b.classicTheme) ? {
      classicTheme: {
        menus: Array.isArray(b.classicTheme.menus) ? b.classicTheme.menus.filter((m: any) => isObj(m) && typeof m.location === 'string').map((m: any) => ({ location: m.location, label: plain(str(m.label, m.location)) })) : [],
        widgetAreas: Array.isArray(b.classicTheme.widgetAreas) ? b.classicTheme.widgetAreas.filter((w: any) => isObj(w) && typeof w.id === 'string').map((w: any) => ({ id: w.id, name: plain(str(w.name, w.id)) })) : [],
      },
    } : {}),
  };
}

export function normalizeSiteMap(body: any): SiteMap {
  const b = isObj(body) ? body : {};
  const colors = isObj(b.tokens?.colors) ? b.tokens.colors : {};
  const fonts = isObj(b.tokens?.fonts) ? b.tokens.fonts : {};
  const blockSite = b.engine === 'wordpress';
  return {
    engine: b.engine === 'genstudio' || blockSite ? b.engine : 'legacy',
    ...(blockSite ? blockSiteFields(b) : {}),
    editable: b.editable === true,
    ...(typeof b.reason === 'string' ? { reason: b.reason as SiteMap['reason'] } : {}),
    head: { operationId: str(b.head?.operationId) || null, at: str(b.head?.at) || null },
    pages: Array.isArray(b.pages) ? b.pages.filter(isObj).map((p: any): SiteMapPage => ({
      slug: str(p.slug),
      title: plain(str(p.title, p.slug)),
      postId: typeof p.postId === 'number' ? p.postId : null,
      url: str(p.url),
      ...(typeof p.template === 'string' ? { template: p.template } : {}),
      // A template page's record to open it on (the product page shows a product).
      ...(isObj(p.showing) && typeof p.showing.id === 'number' && p.showing.id > 0
        ? { showing: { id: p.showing.id, title: plain(str(p.showing.title)), url: str(p.showing.url) } }
        : {}),
      ...(typeof p.status === 'string' ? { status: p.status } : {}),
      // On a designed page, the blocks the owner added in WordPress carry their words like a block page's sections.
      sections: Array.isArray(p.sections) ? p.sections.filter(isObj).map((s: any) => ({
        id: str(s.id), label: plain(str(s.label, s.id)), excerpt: plain(str(s.excerpt)),
        ...sectionImages(s),
        ...(blockSite || s.wordpress === true ? blockSectionFields(s) : {}),
        ...(!blockSite && s.wordpress === true ? { wordpress: true } : {}),
      })) : [],
      ...(blockSite && (p.builder === 'elementor' || p.builder === 'divi') ? { builder: p.builder } : {}),
      ...(blockSite && p.classic === true ? { classic: true } : {}),
    })).filter((p: SiteMapPage) => p.slug) : [],
    chrome: {
      header: { excerpt: plain(str(b.chrome?.header?.excerpt)), ctas: Array.isArray(b.chrome?.header?.ctas) ? b.chrome.header.ctas.filter((c: unknown) => typeof c === 'string') : [] },
      footer: { excerpt: plain(str(b.chrome?.footer?.excerpt)), ctas: Array.isArray(b.chrome?.footer?.ctas) ? b.chrome.footer.ctas.filter((c: unknown) => typeof c === 'string') : [] },
    },
    menus: Array.isArray(b.menus) ? b.menus.filter(isObj).map((m: any): SiteMapMenu => ({
      location: str(m.location),
      label: plain(str(m.label, m.location)),
      maxDepth: typeof m.maxDepth === 'number' ? m.maxDepth : 1,
      items: Array.isArray(m.items) ? m.items.filter((i: any) => isObj(i) && typeof i.id === 'number' && isObj(i.link)).map((i: any) => ({
        id: i.id, label: plain(str(i.label)), link: i.link, depth: typeof i.depth === 'number' ? i.depth : 0, parent: typeof i.parent === 'number' ? i.parent : 0,
      })) : [],
    })).filter((m: SiteMapMenu) => m.location) : [],
    facts: Array.isArray(b.facts) ? b.facts.filter(isObj).map((f: any): SiteMapFact => ({
      key: str(f.key), label: plain(str(f.label, f.key)), type: ['tel', 'email', 'url'].includes(f.type) ? f.type : 'text', value: str(f.value),
    })).filter((f: SiteMapFact) => f.key) : [],
    tokens: {
      colors: Object.fromEntries((['bg', 'surface', 'ink', 'accent', 'accent2'] as TokenColor[]).map((k) => [k, str(colors[k])])) as Record<TokenColor, string>,
      fonts: { display: str(fonts.display), body: str(fonts.body) },
    },
    products: Array.isArray(b.products) ? b.products.filter(isObj).map((p: any) => ({
      slug: str(p.slug), id: typeof p.id === 'number' ? p.id : null, name: plain(str(p.name)), price: plain(str(p.price)),
    })) : [],
    ...(isObj(b.identity) ? {
      identity: {
        logoUrl: typeof b.identity.logoUrl === 'string' && b.identity.logoUrl ? b.identity.logoUrl : null,
        iconUrl: typeof b.identity.iconUrl === 'string' && b.identity.iconUrl ? b.identity.iconUrl : null,
        // A block site's name and tagline (its header panel's fields).
        ...(blockSite && typeof b.identity.name === 'string' ? { name: plain(b.identity.name) } : {}),
        ...(blockSite && typeof b.identity.tagline === 'string' ? { tagline: plain(b.identity.tagline) } : {}),
      },
    } : {}),
    ...(isObj(b.frontPage) && ['designed', 'previous', 'other'].includes(b.frontPage.showing) ? {
      frontPage: {
        showing: b.frontPage.showing,
        previousAvailable: b.frontPage.previousAvailable === true,
        ...(typeof b.frontPage.previousTitle === 'string' ? { previousTitle: plain(b.frontPage.previousTitle) } : {}),
        ...(typeof b.frontPage.currentTitle === 'string' ? { currentTitle: plain(b.frontPage.currentTitle) } : {}),
      },
    } : {}),
    ...(Array.isArray(b.forms) ? { forms: b.forms.filter((f: unknown) => isObj(f) && typeof (f as any).name === 'string').map(normalizeForm) } : {}),
    ...(isObj(b.social) ? {
      social: {
        links: Array.isArray(b.social.links)
          ? b.social.links.filter((l: any) => isObj(l) && typeof l.network === 'string' && typeof l.url === 'string')
            .map((l: any) => ({ network: l.network, url: l.url, ...(typeof l.label === 'string' && l.label ? { label: plain(l.label) } : {}) }))
          : [],
        menuLocation: typeof b.social.menuLocation === 'string' ? b.social.menuLocation : null,
      },
    } : {}),
  };
}

const FIELD_TYPES = ['text', 'email', 'tel', 'url', 'number', 'date', 'textarea', 'select', 'radio', 'checkbox'];

/** One designed form of the site map, checked. */
function normalizeForm(f: any): SiteMapForm {
  const s = isObj(f.settings) ? f.settings : null;
  return {
    name: str(f.name),
    intent: str(f.intent, 'contact'),
    label: plain(str(f.label, 'the form')),
    place: {
      ...(typeof f.place?.page === 'string' ? { page: f.place.page } : {}),
      ...(typeof f.place?.sectionId === 'string' ? { sectionId: f.place.sectionId } : {}),
      ...(f.place?.region === 'header' || f.place?.region === 'footer' ? { region: f.place.region } : {}),
    },
    fields: Array.isArray(f.fields) ? f.fields.filter((x: any) => isObj(x) && typeof x.id === 'number').map((x: any) => ({
      id: x.id,
      label: plain(str(x.label)),
      type: FIELD_TYPES.includes(x.type) ? x.type : 'text',
      required: x.required === true,
      ...(typeof x.placeholder === 'string' && x.placeholder ? { placeholder: x.placeholder } : {}),
      ...(Array.isArray(x.options) ? { options: x.options.filter((o: unknown) => typeof o === 'string') } : {}),
      origin: x.origin === 'consent' || x.origin === 'wpforms' ? x.origin : 'design',
    })) : [],
    submitText: plain(str(f.submitText)),
    ...(s ? {
      settings: {
        confirmation: str(s.confirmation),
        recipients: Array.isArray(s.recipients) ? s.recipients.filter(isObj).map((r: any) => ({ address: str(r.address), isOwner: r.isOwner === true })) : [],
        emailOn: s.emailOn !== false,
        messages: typeof s.messages === 'number' ? s.messages : null,
        provider: s.provider === 'none' ? 'none' : 'wpforms',
        nextFieldId: typeof s.nextFieldId === 'number' ? s.nextFieldId : 0,
      },
    } : {}),
  };
}

// ── routes ─────────────────────────────────────────────────────────────────

export interface EditRequestInput {
  operation: EditOperation;
  mode: 'preview' | 'publish';
  previewId?: string;
  basePreviewId?: string;
  /** Another version of this earlier preview (its preview id): the same request, composed again from the same start. */
  variantOf?: string;
  /** A bulk change's values edited in its review, previewed in place of this earlier preview (its preview id). */
  revisionOf?: string;
  force?: boolean;
  /** Wait for the API to finish (publish); a preview of a design change is polled instead. */
  wait?: boolean;
  source?: 'editor' | 'store' | 'chat';
  /** The same request asked again answers the same change (its row), never a second one. */
  idempotencyKey?: string;
}

export const editsApi = {
  async siteMap(): Promise<SiteMap> {
    const res = await editsFetch('/edits/site-map', { timeoutMs: 95_000 });
    if (res.status >= 200 && res.status < 300 && isObj(res.body)) return normalizeSiteMap(res.body);
    rowOrThrow(res);
    throw new EditsRequestError(couldNotReadText(), res.status);
  },

  async request(input: EditRequestInput): Promise<EditResult> {
    const body: Record<string, unknown> = { operation: input.operation, mode: input.mode, source: input.source ?? 'editor' };
    if (input.previewId) body.previewId = input.previewId;
    if (input.basePreviewId) body.basePreviewId = input.basePreviewId;
    if (input.variantOf) body.variantOf = input.variantOf;
    if (input.revisionOf) body.revisionOf = input.revisionOf;
    if (input.force) body.force = true;
    if (input.wait) body.wait = true;
    if (input.idempotencyKey) body.idempotencyKey = input.idempotencyKey;
    return rowOrThrow(await editsFetch('/edits', { method: 'POST', body, timeoutMs: input.wait ? 110_000 : 60_000 }));
  },

  /**
   * Another version of a preview by its id alone (a chat card, which never
   * holds the operation): the API composes the same change again from the
   * same start. A design change answers at once and is polled.
   */
  async anotherVersion(previewId: string, source: 'editor' | 'chat' = 'chat'): Promise<EditResult> {
    return rowOrThrow(await editsFetch('/edits', { method: 'POST', body: { mode: 'preview', variantOf: previewId, source }, timeoutMs: 60_000 }));
  },

  async get(operationId: string): Promise<EditResult> {
    return rowOrThrow(await editsFetch(`/edits/${encodeURIComponent(operationId)}`, { timeoutMs: 30_000 }));
  },

  async history(opts: { limit?: number; cursor?: string } = {}): Promise<{ items: EditResult[]; nextCursor: string | null }> {
    const res = await editsFetch('/edits/history', { query: { limit: opts.limit ?? 30, cursor: opts.cursor }, timeoutMs: 30_000 });
    if (res.status >= 200 && res.status < 300 && isObj(res.body)) {
      const items = Array.isArray(res.body.items) ? res.body.items.filter(isEditResult).map(normalizeEditResult) : [];
      return { items, nextCursor: typeof res.body.nextCursor === 'string' ? res.body.nextCursor : null };
    }
    rowOrThrow(res);
    return { items: [], nextCursor: null };
  },

  /** Publish a preview by its id alone: one made in another session, a chat or the dashboard too. */
  async publish(operationId: string, input: { force?: boolean; wait?: boolean } = {}): Promise<EditResult> {
    const body: Record<string, unknown> = { wait: input.wait !== false };
    if (input.force) body.force = true;
    return rowOrThrow(await editsFetch(`/edits/${encodeURIComponent(operationId)}/publish`, { method: 'POST', body, timeoutMs: 110_000 }));
  },

  async discard(operationId: string): Promise<EditResult> {
    return rowOrThrow(await editsFetch(`/edits/${encodeURIComponent(operationId)}/discard`, { method: 'POST', body: {} }));
  },

  async share(operationId: string): Promise<EditResult> {
    return rowOrThrow(await editsFetch(`/edits/${encodeURIComponent(operationId)}/share`, { method: 'POST', body: {} }));
  },

  async undo(operationId: string, input: { mode: 'preview' | 'publish'; previewId?: string; force?: boolean; wait?: boolean }): Promise<EditResult> {
    const body: Record<string, unknown> = { mode: input.mode, wait: input.wait === true };
    if (input.previewId) body.previewId = input.previewId;
    if (input.force) body.force = true;
    return rowOrThrow(await editsFetch(`/edits/${encodeURIComponent(operationId)}/undo`, { method: 'POST', body, timeoutMs: input.wait ? 110_000 : 60_000 }));
  },
};

// ── polling ────────────────────────────────────────────────────────────────

const WORKING: ReadonlySet<EditStatus> = new Set(['queued', 'previewing', 'publishing']);

/** The change is still being prepared or published. */
export function isWorking(status: EditStatus): boolean {
  return WORKING.has(status);
}

/**
 * Poll a change until it leaves queued, previewing and publishing (or the
 * time runs out, or the signal aborts). onUpdate sees every answer, so the
 * screen can say where the change waits in line.
 */
export async function settleEdit(
  first: EditResult,
  opts: { signal?: AbortSignal; onUpdate?: (r: EditResult) => void; intervalMs?: number; timeoutMs?: number; get?: (id: string) => Promise<EditResult> } = {},
): Promise<EditResult> {
  let current = first;
  const get = opts.get ?? editsApi.get;
  const until = Date.now() + (opts.timeoutMs ?? 240_000);
  const interval = opts.intervalMs ?? 2_000;
  while (current.operationId && isWorking(current.status) && Date.now() < until) {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, interval);
      opts.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      current = await get(current.operationId);
      opts.onUpdate?.(current);
    } catch (err) {
      // A missed poll is not a failed change: try again on the next tick.
      if (err instanceof EditsRequestError && err.status >= 400 && err.status < 500 && err.status !== 429) throw err;
    }
  }
  return current;
}

// ── owner words ────────────────────────────────────────────────────────────

/*
 * The client's own sentences in the site's brand (utils/brand.ts): the
 * brand's name under an agency's or a partner's brand, words that name
 * nobody while that brand has no name, and the same words as before on a
 * WPMaven site.
 */

/** A call that did not reach the account. */
export function requestFailedText(b: SiteBrand = siteBrand()): string {
  return `Something went wrong on the way to ${nameOr('your account', b)}. Try again in a moment.`;
}

/** A refusal that came with no sentence of its own. */
export function couldNotDoText(b: SiteBrand = siteBrand()): string {
  return b.mode === 'neutral'
    ? 'This could not be done right now. Try again in a moment.'
    : `${b.name} could not do this right now. Try again in a moment.`;
}

/** The site map did not come. */
export function couldNotReadText(b: SiteBrand = siteBrand()): string {
  return b.mode === 'neutral' ? 'Your site could not be read right now.' : `${b.name} could not read your site right now.`;
}

/** A change that failed with no reason given. */
export function notPreparedText(b: SiteBrand = siteBrand()): string {
  return b.mode === 'neutral'
    ? 'This change could not be prepared. Nothing on your site changed.'
    : `${b.name} could not prepare this change. Nothing on your site changed.`;
}

/** The first failure of a change, or null. */
export function failureOf(r: EditResult | null | undefined): { code: string; message: string } | null {
  const f = r?.failures?.[0];
  if (f) return { code: f.code, message: f.message || 'This change did not go through.' };
  if (r && !r.ok && r.status === 'failed') return { code: 'ENGINE', message: notPreparedText() };
  return null;
}

/** Whether a preview has a check that needs "Publish anyway". */
export function hasBrokenCheck(checks: EditCheck[] | undefined): boolean {
  return (checks ?? []).some((c) => c.severity === 'broken');
}

/** Checks in reading order: what breaks first; on the phone view, phone checks first. */
export function orderChecks(checks: EditCheck[], phoneFirst = false): EditCheck[] {
  const rank = (c: EditCheck) => (c.severity === 'broken' ? 0 : c.severity === 'warn' ? 1 : 2) * 2 + (phoneFirst && c.width === 390 ? 0 : phoneFirst ? 1 : 0);
  return [...checks].sort((a, b) => rank(a) - rank(b));
}

export const SOURCE_WORDS: Record<EditResult['source'], string> = {
  editor: 'From the editor',
  chat: 'From a chat',
  store: 'From the Store',
  dashboard: 'From your dashboard',
  whatsapp: 'From WhatsApp',
  system: 'By WPMaven',
};

/** SOURCE_WORDS in the site's brand: a change of ours reads "By Acme Studio", or "By your team" while the brand has no name. */
export function sourceWords(source: EditResult['source'], b: SiteBrand = siteBrand()): string {
  if (source === 'system' && b.mode !== 'wpmaven') return b.mode === 'brand' ? `By ${b.name}` : 'By your team';
  return SOURCE_WORDS[source] ?? '';
}

export const STATUS_WORDS: Record<EditStatus, string> = {
  queued: 'Waiting',
  previewing: 'Preparing',
  previewed: 'Preview',
  publishing: 'Publishing',
  published: 'Live',
  failed: 'Did not go through',
  undone: 'Undone',
  discarded: 'Discarded',
  expired: 'Preview expired',
};


// ── the SEO check, search suggestions and the picture for sharing (webmaven/v1/seo-check, seo-suggest, seo-share-image) ──

export type CheckLevel = 'fix' | 'improve' | 'ok';

export interface CheckFinding {
  id: string;
  group: string;
  level: CheckLevel;
  title: string;
  detail?: string;
  where: Array<{ label: string; url?: string; postId?: number; mediaId?: number }>;
  fix?:
    | { kind: 'operation'; label: string; operation: EditOperation; ai: boolean }
    | { kind: 'open'; label: string; target: string; params?: Record<string, unknown> };
}

export interface SeoCheck {
  ranAt: string;
  pagesRead: number;
  unreadable: Array<{ label: string; url: string }>;
  counts: { fix: number; improve: number; ok: number };
  findings: CheckFinding[];
}

function refusalOf(status: number, body: any, fallback: string): EditsRequestError {
  const message = isObj(body) && typeof body.error === 'string' && body.error.trim() ? plain(body.error) : fallback;
  return new EditsRequestError(message, status, isObj(body) && typeof body.code === 'string' ? body.code : '');
}

function normalizeCheck(raw: any): SeoCheck | null {
  if (!isObj(raw) || !Array.isArray(raw.findings)) return null;
  const counts = isObj(raw.counts) ? raw.counts : {};
  return {
    ranAt: str(raw.ranAt),
    pagesRead: typeof raw.pagesRead === 'number' ? raw.pagesRead : 0,
    unreadable: Array.isArray(raw.unreadable) ? raw.unreadable.filter(isObj).map((u: any) => ({ label: plain(str(u.label)), url: str(u.url) })) : [],
    counts: { fix: Number(counts.fix) || 0, improve: Number(counts.improve) || 0, ok: Number(counts.ok) || 0 },
    findings: raw.findings.filter((f: any) => isObj(f) && typeof f.title === 'string' && ['fix', 'improve', 'ok'].includes(f.level)).map((f: any): CheckFinding => ({
      id: str(f.id), group: str(f.group), level: f.level, title: plain(f.title),
      ...(typeof f.detail === 'string' ? { detail: plain(f.detail) } : {}),
      where: Array.isArray(f.where) ? f.where.filter(isObj).map((w: any) => ({ label: plain(str(w.label)), ...(typeof w.url === 'string' ? { url: w.url } : {}), ...(typeof w.postId === 'number' ? { postId: w.postId } : {}), ...(typeof w.mediaId === 'number' ? { mediaId: w.mediaId } : {}) })) : [],
      ...(isObj(f.fix) && typeof f.fix.label === 'string' ? { fix: f.fix } : {}),
    })),
  };
}

/** The last SEO check of this site (null before the first), or a new one when run is true. */
export async function fetchSeoCheck(run = false): Promise<SeoCheck | null> {
  const { status, body } = await editsFetch('/seo-check', { method: run ? 'POST' : 'GET', ...(run ? { body: {} } : {}), timeoutMs: run ? 130_000 : 30_000 });
  if (status >= 200 && status < 300) return normalizeCheck(isObj(body) ? body.check : null);
  throw refusalOf(status, body, couldNotReadText());
}

/** A picture made for sharing a page, already in the media library (the page keeps it once its search details are saved). */
export interface ShareImage {
  id: number;
  url: string;
  alt: string;
}

function shareImageOf(raw: unknown): ShareImage | null {
  if (!isObj(raw) || typeof raw.id !== 'number' || !Number.isInteger(raw.id) || raw.id <= 0) return null;
  const url = str(raw.url);
  return /^https?:\/\//i.test(url) ? { id: raw.id, url, alt: plain(str(raw.alt)) } : null;
}

export interface SeoSuggestion {
  title: string;
  description: string;
  /** Asked with image: a picture made for a page without one of its own (null: none was made). */
  image: ShareImage | null;
  /** Why the picture was not made, in the owner's words (the words still came). */
  imageError: string | null;
}

/**
 * A suggested search title and description for one page (nothing is
 * written). With image (1.8.0): a picture for sharing too, when the page has
 * none of its own; making it takes longer.
 */
export async function fetchSeoSuggestion(postId: number, opts: { image?: boolean } = {}): Promise<SeoSuggestion> {
  const { status, body } = await editsFetch(`/seo-suggest/${postId}`, {
    method: 'POST',
    body: opts.image ? { image: true } : {},
    timeoutMs: opts.image ? 170_000 : 70_000,
  });
  const s = isObj(body) && isObj(body.suggestion) ? body.suggestion : null;
  if (status >= 200 && status < 300 && s) {
    const imageError = isObj(body.imageError) && typeof body.imageError.error === 'string' ? plain(body.imageError.error) : '';
    return {
      title: plain(str(s.title)),
      description: plain(str(s.description)),
      image: shareImageOf(body.image),
      imageError: imageError || null,
    };
  }
  throw refusalOf(status, body, couldNotDoText());
}

/**
 * "Generate a picture" (1.8.0): one picture for sharing this page, made in
 * the site's look from what the page is about (the form's title and
 * description when given), put in the media library. Nothing is saved to the
 * page: Save does that, as with a picture chosen from the library.
 */
export async function generateShareImage(postId: number, words: { title?: string; description?: string } = {}): Promise<ShareImage> {
  const sent: Record<string, string> = {};
  if (words.title?.trim()) sent.title = words.title.trim();
  if (words.description?.trim()) sent.description = words.description.trim();
  const { status, body } = await editsFetch(`/seo-share-image/${postId}`, { method: 'POST', body: sent, timeoutMs: 170_000 });
  const image = status >= 200 && status < 300 && isObj(body) ? shareImageOf(body.image) : null;
  if (image) return image;
  throw refusalOf(status, body, couldNotDoText());
}

/**
 * "Make a picture" for the whole site (1.9.0, 2026-10-19), where the
 * homepage lists the latest posts (no page to make it from): one picture
 * for sharing the site, made from the header and the homepage's design,
 * with the site's name and tagline as its words, put in the media library.
 * Nothing is saved: the Whole site tab's Save makes it the site's picture.
 */
export async function generateSiteShareImage(words: { title?: string; description?: string } = {}): Promise<ShareImage> {
  const sent: Record<string, string> = {};
  if (words.title?.trim()) sent.title = words.title.trim();
  if (words.description?.trim()) sent.description = words.description.trim();
  const { status, body } = await editsFetch('/seo-share-image/site', { method: 'POST', body: sent, timeoutMs: 170_000 });
  // The page route's answer ({ image }), or the picture itself.
  const image = status >= 200 && status < 300 && isObj(body) ? shareImageOf(body.image) ?? shareImageOf(body) : null;
  if (image) return image;
  throw refusalOf(status, body, couldNotDoText());
}

export interface SiteSearch {
  shareImage: number | string | null;
  shareImageUrl: string;
  hidden: boolean;
  tagline: string;
  seoPlugin: string | null;
  canSetShareImage: boolean;
  frontPage: 'posts' | number;
}

/** The whole site's search settings, read on this site. */
export async function fetchSiteSearch(): Promise<SiteSearch> {
  const { status, body } = await editsFetch('/seo-site', { timeoutMs: 20_000 });
  if (status < 200 || status >= 300 || !isObj(body)) throw refusalOf(status, body, couldNotReadText());
  return {
    shareImage: typeof body.shareImage === 'number' || typeof body.shareImage === 'string' ? body.shareImage : null,
    shareImageUrl: str(body.shareImageUrl),
    hidden: body.hidden === true,
    tagline: plain(str(body.tagline)),
    seoPlugin: typeof body.seoPlugin === 'string' && body.seoPlugin ? body.seoPlugin : null,
    canSetShareImage: body.canSetShareImage !== false,
    frontPage: typeof body.frontPage === 'number' ? body.frontPage : 'posts',
  };
}
