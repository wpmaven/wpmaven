import type { ComponentType, ReactNode } from 'react';

/**
 * The one contract between the wizard and the app that mounts it.
 *
 * The wizard reads no window global, no import.meta.env, no router and no
 * storage key of its own: everything that differs between the dashboard's
 * /create and the WordPress plugin arrives here. A host builds one
 * WizardHost and renders <OnboardingWizard host={host} />.
 */
export interface WizardHost {
  /** Rendered as data-wizard-host on the wizard's root. */
  kind: WizardHostKind;
  transport: WizardTransport;
  identity: WizardIdentity;
  /** The human check before the first spend: Turnstile on the dashboard, none for a site. */
  humanCheck: WizardHumanCheck;
  brand: WizardBrand;
  navigation: WizardNavigation;
  slots: WizardSlots;
  /** Per-browser memory: the resume text, the lines already played. */
  storage: WizardStorage;
  analytics: WizardAnalytics;
  /** The WordPress site the business is built onto, or null (the dashboard). */
  site: WizardSite | null;
  preview: WizardPreview;
  assets: WizardAssets;
  /**
   * Starting a plan from inside the wizard: the
   * dashboard opens its "Start for $1" sheet. Null or absent (the WordPress
   * plugin): no plan is started here; a build limit offers the API's fix
   * link instead, and other design directions say they come with a plan,
   * their button off.
   */
  billing?: WizardBilling | null;
  /**
   * What to do once when the wizard is mounted again after the sheet
   * (host.billing) took the visitor to the payment page: 'reroll' (paid)
   * asks for other directions on the style step, 'build' (paid) runs again
   * the build step the limit stopped, 'restore' (left without paying) only
   * reopens the step as it was, its limit card or its line under other
   * directions included, and runs nothing. The wizard reopens where the
   * visitor was from what it kept in `storage` when the sheet was asked for,
   * in the same browser tab and for the same session (a draft the sign-in
   * inside the sheet saved to the account included: its session id stays,
   * its anonymous key goes), read once at mount. Null or absent: nothing.
   */
  resumeAction?: WizardResumeAction | null;
  /**
   * The page's language (plan of 2026-10-29): a language tag ("fr", "fr-FR",
   * a WordPress locale such as "fr_FR"). Given, the wizard sets it as the
   * page's language before it draws (webmaven-ui's setLanguage), and draws
   * again when it changes. The texts are data: the package ships one
   * catalog per language (`@yotako/wpmaven-onboarding/i18n/fr.json`), which
   * the host gives to webmaven-ui's addTranslations(lang, catalog) before
   * the wizard mounts, or announces (announceLanguages) and loads later, the
   * wizard drawing again when the texts arrive. A language with neither
   * reads English. Absent: the wizard leaves the page's language as the
   * host set it.
   */
  locale?: string;
}

/** What the wizard does when it comes back from the payment page (WizardHost.resumeAction). */
export type WizardResumeAction = 'reroll' | 'build' | 'restore';

/** What a plan started from the wizard is for (WizardBilling.startPlan). */
export interface WizardStartPlanInput {
  /** 'rerolls': other design directions on the style step. 'build': a build the limit stopped. */
  reason: 'rerolls' | 'build';
  /** The browser's onboarding session, or null when it has none yet. */
  sessionId: string | null;
  /** The $1 first week is still open to this visitor, as the API said; null when it could not tell. */
  firstWeekAvailable: boolean | null;
}

/** The host's way to start a plan (the dashboard's "Start for $1" sheet). */
export interface WizardBilling {
  startPlan(input: WizardStartPlanInput): void;
}

export type WizardHostKind = 'dashboard' | 'plugin';

// ── transport ────────────────────────────────────────────────────────────

export interface WizardRequest {
  method: 'GET' | 'POST' | 'PUT';
  /** A path under the api's /api root, starting with a slash: '/onboarding/start'. */
  path: string;
  body?: unknown;
  query?: Record<string, string>;
  /** Give up after this long (the host's default otherwise). */
  timeoutMs?: number;
}

export interface WizardTransport {
  /**
   * One JSON call. Resolves with the answer's body exactly as the api sent
   * it (e.g. `{ success: true, data: {...} }`). Rejects with a
   * WizardApiError: an answer outside 2xx, no answer, or a timeout.
   */
  request<T = unknown>(call: WizardRequest): Promise<T>;
  /**
   * An absolute api URL the browser opens itself (EventSource, an iframe,
   * a fetch without headers), authorized by the ticket or the preview token
   * in `query`: the build stream, the static preview, the bundle.
   * `path` is under the api's /api root, like WizardRequest.path.
   */
  ticketedUrl(path: string, query: Record<string, string>): string;
  /**
   * The language the business's site is written in, chosen or changed by
   * the owner on the confirm step (the language question, "Site language",
   * an ISO 639-1 code such as "fr"): PUT /api/onboarding/site-language/
   * :sessionId with { language }. Resolves with the language the session now
   * holds and, when the API wrote them again in it, the analysis's summary
   * and pages and the business plan, which the wizard draws from then on.
   * Optional: without it, the confirm step asks nothing and shows the site's
   * language without its Change.
   */
  setSiteLanguage?(sessionId: string, language: string): Promise<SiteLanguageAnswer>;
}

/** What the API answers to a site language change (WizardTransport.setSiteLanguage). */
export interface SiteLanguageAnswer {
  language: string;
  /** The analysis's words in that language. */
  analysis?: {
    siteSummary?: string;
    suggestedPages?: Array<{ type?: string; slug?: string; title?: string; description?: string; required?: boolean }>;
  } | null;
  /** The business plan with its names in that language. */
  businessPlan?: unknown;
}

/**
 * Why a call failed. It keeps an axios-compatible face (`response`, and
 * `code` set to ERR_NETWORK or ECONNABORTED when no answer came back), so the
 * shared error helpers (errorMessage, noAnswer, apiErrorInfo, requestProblem)
 * read it the same way in both hosts.
 */
export class WizardApiError extends Error {
  /** The answer's HTTP status; 0 when no answer came back. */
  readonly status: number;
  /** The api's `code` when it answered, else ERR_NETWORK or ECONNABORTED. */
  readonly code: string | null;
  /** The answer's body, or null. */
  readonly data: unknown;
  /** Present when the api answered: `{ status, data }`, as axios has it. */
  readonly response?: { status: number; data: unknown };

  constructor(init: { status: number; code?: string | null; data?: unknown; message?: string }) {
    const data = init.data ?? null;
    const fromApi = data && typeof data === 'object'
      ? ((data as { error?: unknown; message?: unknown }).error ?? (data as { message?: unknown }).message)
      : null;
    super(init.message ?? (typeof fromApi === 'string' && fromApi ? fromApi : init.status ? `Request failed with status code ${init.status}` : 'No answer'));
    this.name = 'WizardApiError';
    this.status = init.status;
    this.data = data;
    const apiCode = data && typeof data === 'object' && typeof (data as { code?: unknown }).code === 'string'
      ? (data as { code: string }).code
      : null;
    this.code = init.code ?? apiCode;
    if (init.status > 0) this.response = { status: init.status, data };
  }
}

export function isWizardApiError(e: unknown): e is WizardApiError {
  return e instanceof WizardApiError || (!!e && typeof e === 'object' && (e as { name?: unknown }).name === 'WizardApiError');
}

// ── who is building ──────────────────────────────────────────────────────

/**
 * draft: the dashboard's anonymous draft (claimed at the end), or a signed-in
 * owner's session on the dashboard (the bearer owns it; the draft keys stay).
 * `signedIn` says which: a signed-in owner's draft is claimed directly, with
 * no account to make, so the last button says so. Absent means signed out.
 * site: the WordPress plugin, as the site principal. Never an anonymous id,
 * never a Turnstile token; the api binds every call to this site's instance
 * and its owner.
 */
export type WizardIdentity =
  | { mode: 'draft'; draft: DraftStore; signedIn?: boolean }
  | { mode: 'site'; instanceId: string; ownerFirstName: string | null; whatsappLinked: boolean };

/** The dashboard's draft keys (wm_anon_id, wm_onboarding_sid). */
export interface DraftStore {
  anonId(): string | null;
  sessionId(): string | null;
  save(sessionId: string, anonId?: string | null): void;
  clear(): void;
}

export type WizardHumanCheck = { kind: 'turnstile'; siteKey: string } | { kind: 'none' };

// ── brand ────────────────────────────────────────────────────────────────

export interface WizardBrand {
  /** "WPMaven", or the brand's name under White label or a wholesale partner. */
  productName: string;
  /** False under a White label or wholesale brand: never show our mark or our name then. */
  ourMark: boolean;
  logoUrl: string | null;
  color: string | null;
  supportEmail: string | null;
}

// ── where the wizard sends the owner ─────────────────────────────────────

export interface WizardNavigation {
  /** A fix link from the api (e.g. "/billing#plans"): a page of the brand's dashboard. */
  openDashboardPath(path: string): void;
  /** An outside page: the live site, a policy page. */
  openExternal(url: string): void;
  /** The wizard is done. */
  finish(outcome: WizardOutcome): void | Promise<void>;
  /**
   * The way out without a business ("Continue in WordPress"), shown in the
   * wizard's header; null when there is none (the dashboard).
   */
  leave: WizardLeave | null;
}

export interface WizardLeave {
  /** The button's words, e.g. "Continue in WordPress". */
  label: string;
  run(): void | Promise<void>;
}

export type WizardOutcome =
  /** The dashboard: the draft is claimed (sign up, or a direct claim). */
  | { kind: 'claim'; sessionId: string }
  /** The plugin: the business was published onto this site. */
  | { kind: 'published'; sessionId: string; siteUrl: string | null }
  /** The build waiting list (high demand). */
  | { kind: 'waitlisted'; sessionId: string | null }
  /** The plugin: the owner's own site became their business as it is (Keep, Fix and improve). */
  | { kind: 'kept'; sessionId: string | null };

// ── pieces the host draws ────────────────────────────────────────────────

export interface WizardSlots {
  /** claim: the success step saves the draft (dashboard). publish-here: it publishes onto host.site (plugin). */
  finishAction: 'claim' | 'publish-here';
  /** The brand's lockup in the wizard's header and preview chrome; null draws the brand's name. */
  brandLockup: ReactNode | null;
  /** The host's in-app link (react-router's Link on the dashboard); null renders a plain anchor. */
  Link: ComponentType<WizardLinkProps> | null;
  /** Shown instead of the wizard when the owner's business cap refuses a new business. */
  BusinessCapWall: ComponentType<{ onRetry(): void }> | null;
  /** "A few quick things before you go" on the success step; null draws nothing. */
  NextSteps: ComponentType<{ sessionId: string }> | null;
  /**
   * Saving the business to a free account inside the wizard: the host's
   * own sign-in, drawn by the host
   * (the dashboard: Continue with Google first, the email and its code
   * second, the terms box). Optional: absent or null, the wizard is as it
   * was, with no card while the business builds, and the success step's
   * Save is navigation.finish (the host's sign-up).
   *
   * Given, on a draft with the claim finish, the wizard offers it to a
   * visitor who is not signed in (identity.signedIn not true):
   *   - while the business builds: a card in the step column on a computer,
   *     above the progress card; on a phone, a bar under the preview opens
   *     it in the wizard's bottom sheet;
   *   - on the finished business: the success step's Save opens the card in
   *     place on a computer and the sheet on a phone, as the bar under the
   *     finished preview and a claim from inside the preview do.
   * Once the visitor starts there (onStart), the wizard keeps it where it is
   * through the sign-in and the end of the build. Once it calls onSaved, the
   * wizard draws it with `saved` (its "Saved to your account" state), and on
   * the finished business it then finishes as for a signed-in owner
   * (navigation.finish, kind 'claim') as soon as identity.signedIn says so.
   */
  SaveBusiness?: ComponentType<WizardSaveBusinessProps> | null;
}

/** When the wizard offers to save the business (WizardSlots.SaveBusiness): while it builds, or finished. */
export type WizardSaveMoment = 'building' | 'ready';

/** Where the wizard draws it: a card in the step column (computer), or the body of its bottom sheet (phone). */
export type WizardSaveLayout = 'card' | 'sheet';

/** What the wizard gives WizardSlots.SaveBusiness. */
export interface WizardSaveBusinessProps {
  /** building: the business is being built (its link is emailed when it is ready). ready: the business is finished. */
  moment: WizardSaveMoment;
  layout: WizardSaveLayout;
  /** Saved through it in this wizard: draw the saved state. `email`: the account's address, when the host said it. */
  saved: { email: string | null } | null;
  /** The visitor began to save here (chose a way in, typed an address): the wizard keeps it in place until saved. */
  onStart(): void;
  /** The business is in the account now: the visitor is signed in and the claim was accepted. */
  onSaved(result: { email: string | null }): void;
  /** Closes the sheet ("Not now"); null on the card, which stays where it is. */
  onDismiss: (() => void) | null;
}

export interface WizardLinkProps {
  to: string;
  className?: string;
  style?: Record<string, string | number>;
  children: ReactNode;
}

export interface WizardStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface WizardAnalytics {
  track(category: string, action: string, name?: string, value?: number): void;
}

// ── the site the business goes onto (plugin) ────────────────────────────

export interface WizardSite {
  instanceId: string;
  /** The site's name, as WordPress holds it. */
  name: string;
  /** The site's address (home). */
  url: string;
  /** wp-admin's address, ending with a slash. */
  adminUrl: string;
  /** WordPress locale, e.g. fr_FR. */
  locale: string;
  /** The site's time zone as WordPress holds it ("Europe/Paris", or an offset such as "+02:00"); absent from a plugin before it. */
  timeZone?: string | null;
  /** What the site already holds (WordPress's untouched defaults left out), or null when unknown. */
  existing: { pages: number; posts: number; products: number } | null;
  /**
   * What the site holds and how it is made, read by the plugin and sent
   * nowhere (GET /wizard/site). Absent or null from a plugin before it.
   * Not empty, the wizard opens on "Your site" instead of the idea, when
   * the api's setup state allows it (existingSite).
   */
  profile?: SiteProfile | null;
}

/** empty: today's flow. site: the owner's own content. store: WooCommerce that sold in the last 90 days, or has customers. */
export type SiteKind = 'empty' | 'site' | 'store';

export type SiteBuilder = 'elementor' | 'divi' | 'beaver' | 'wpbakery' | 'bricks' | 'oxygen';

export interface SiteProfile {
  kind: SiteKind;
  theme: { name: string; stylesheet: string; isDefault: boolean; isBlockTheme: boolean; isWpmaven: boolean };
  builder: SiteBuilder | null;
  content: { pages: number; posts: number; products: number; menus: number; widgets: number };
  /** Counts only: never a customer's details. */
  store: null | { orders90: number; customers: number; lastOrderAt: string | null; currency: string };
  identity: { hasLogo: boolean; hasIcon: boolean; tagline: string };
  plugins: { seo: string | null; forms: string[]; cache: string | null; backup: string | null; smtp: string | null };
}

// ── preview ──────────────────────────────────────────────────────────────

/**
 * The preview ladder is the concept's mock picture, then the static site
 * served by the api, then (dashboard only) WordPress running in the browser.
 * With `playgroundRemoteUrl` or `Applier` null the wizard ends on the static
 * preview; the WordPress plugin never loads the in-browser WordPress.
 */
export interface WizardPreview {
  playgroundRemoteUrl: string | null;
  /** The in-browser WordPress stage (the dashboard's, loaded lazily). */
  Applier: ComponentType<PlaygroundApplierProps> | null;
}

export interface PlaygroundApplierProps {
  /** The remote frame's address (WizardPreview.playgroundRemoteUrl). */
  remoteUrl: string;
  /** The 6 h preview token minted with the stream ticket; authorizes the bundle. Null until the compile finished. */
  previewToken: string | null;
  /** The compiled bundle can be fetched (the build's terminal complete carried wp_ready). */
  bundleReady: boolean;
  /** The bucket-hosted bundle zip (signed GET URL and integrity hash), or null for the JSON route. */
  bundleZip?: { url: string; sha256: string; bytes: number } | null;
  /** The predicted plugin set, used to boot early; null until known. */
  predictedPlugins: string[] | null;
  siteName?: string;
  /** Called on every apply step, so the wizard's fail-open fires on silence only. */
  onProgress?: () => void;
  /** The in-browser WordPress answers. */
  onReady?: () => void;
  /** The apply failed: the wizard stops on an error card showing the message (name what failed in it), with a Try Again for the preview only. */
  onFailed?: (error: unknown) => void;
}

// ── pictures ─────────────────────────────────────────────────────────────

/**
 * Where the wizard's pictures live. They are never bundled: the dashboard
 * serves them from its public folder, and the plugin, whose zip must stay
 * small, points at the same files on the brand's dashboard.
 */
export interface WizardAssets {
  /** The URL of an idea picture by name ('bakery', 'ask-idea'), or null to draw the card without it. */
  ideaImage(name: string): string | null;
}
