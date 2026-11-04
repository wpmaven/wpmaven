/**
 * The onboarding api the wizard calls, on the host's transport.
 *
 * One module for both hosts: the dashboard's /create builds an anonymous
 * draft (identity 'draft': the anonId and the session id live in the
 * dashboard's own keys, and the anonId and the Turnstile token go with the
 * calls); the WordPress plugin builds as the site principal (identity
 * 'site': no anonId, no Turnstile token, and the session id lives in memory,
 * since the api's start resumes the owner's open session for the site).
 *
 * Every call answers `{ success, data }` or refuses through the transport
 * with a WizardApiError, which keeps the axios face the shared error helpers
 * read (errorMessage, noAnswer, apiErrorInfo, requestProblem).
 */
import type { WizardApiError, WizardIdentity, WizardTransport } from '../host/types';
import { userFacingError } from '../shared/errorMessage';
import { AI_STEP_POLL_MS, AI_STEP_START_TIMEOUT_MS, DESIGN_DIRECTIONS_WORDS, PRODUCTS_WORDS, runAiStep } from './aiStep';
import { API_COPY } from './apiCopy';
import { inPageLanguage, pageLanguageQuery } from './pageLanguage';

export interface StartResult {
  sessionId: string;
  status: string;
  anonId: string | null;
}

/**
 * A build the API did not start (design 0.6, change #9): a signed-in account
 * with no paid plan builds 3 previews, and the 4th answers 'build_limit'
 * ("You built 3 previews. Start your plan to build another." with See
 * plans); a failed payment answers 'payment_failed' (Update your card). Sent
 * by the session start, the style step and the site build, with HTTP 200.
 *
 * A 'build_limit' also says which limit it is
 * (`scope`: this browser's day or month when signed out, the account's free
 * builds when signed in), when a build opens again (`retryAt`), whether the
 * $1 first week is still open (`firstWeekAvailable`) and that the way on is
 * starting a plan (`action: 'start_plan'`, the host's "Start for $1" sheet).
 * Each is present only when the API sent it.
 */
export interface BuildLimit {
  status: 'build_limit' | 'payment_failed';
  text: string;
  fix: { label: string; href: string } | null;
  scope?: BuildLimitScope;
  /** When a build opens again (ISO). */
  retryAt?: string | null;
  /** The $1 first week is still open to this visitor; null when the API cannot tell. */
  firstWeekAvailable?: boolean | null;
  /** 'start_plan': the card's way on is starting a plan (host.billing), its fix link the fallback. */
  action?: 'start_plan';
}

/** Which build limit answered: a signed-out browser's day or month, or a signed-in account's free builds. */
export type BuildLimitScope = 'day' | 'month' | 'account';

/** The API's words when it sent none: its own BUILD_LIMIT_TEXT and PAYMENT_FAILED text, in the page's language. */
function buildLimitFallback(status: BuildLimit['status']): BuildLimit {
  return status === 'build_limit'
    ? { status: 'build_limit', text: API_COPY.buildLimitText, fix: { label: API_COPY.buildLimitFix, href: '/billing#plans' } }
    : { status: 'payment_failed', text: API_COPY.paymentFailedText, fix: { label: API_COPY.paymentFailedFix, href: '/billing' } };
}

/** The build limit an onboarding answer carries, or null when it built (or is building). */
export function buildLimitOf(data: unknown): BuildLimit | null {
  const d = data && typeof data === 'object'
    ? (data as { status?: unknown; text?: unknown; message?: unknown; fix?: unknown; scope?: unknown; retryAt?: unknown; firstWeekAvailable?: unknown; action?: unknown })
    : null;
  if (!d || (d.status !== 'build_limit' && d.status !== 'payment_failed')) return null;
  const status = d.status;
  const fallback = buildLimitFallback(status);
  const text = typeof d.text === 'string' && d.text.trim()
    ? d.text.trim()
    : typeof d.message === 'string' && d.message.trim() ? d.message.trim() : fallback.text;
  const f = d.fix && typeof d.fix === 'object' ? (d.fix as { label?: unknown; href?: unknown }) : null;
  const href = typeof f?.href === 'string' && f.href.startsWith('/') && !f.href.startsWith('//') ? f.href : null;
  const label = typeof f?.label === 'string' && f.label.trim() ? f.label.trim() : null;
  const limit: BuildLimit = { status, text, fix: href && label ? { label, href } : fallback.fix };
  // These fields only when the API sent them (an API before them answers
  // the card it always had).
  if (status === 'build_limit') {
    if (d.scope === 'day' || d.scope === 'month' || d.scope === 'account') limit.scope = d.scope;
    if (d.retryAt === null || (typeof d.retryAt === 'string' && !Number.isNaN(Date.parse(d.retryAt)))) limit.retryAt = d.retryAt;
    if (d.firstWeekAvailable === null || typeof d.firstWeekAvailable === 'boolean') limit.firstWeekAvailable = d.firstWeekAvailable;
    if (d.action === 'start_plan') limit.action = 'start_plan';
  }
  return limit;
}

/**
 * Other design directions on the style step: the
 * concepts answer says whether this visitor may ask for them now (a paid
 * plan), how many are left this session, and whether the $1 first week is
 * still open (null when the API cannot tell).
 */
export interface RerollState {
  allowed: boolean;
  left: number;
  firstWeekAvailable: boolean | null;
}

/** The concepts answer's `rerolls`, or null when it sent none (an API before it: rerolls work as they did). */
export function rerollsOf(raw: unknown): RerollState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { allowed?: unknown; left?: unknown; firstWeekAvailable?: unknown };
  if (typeof r.allowed !== 'boolean') return null;
  return {
    allowed: r.allowed,
    left: typeof r.left === 'number' && Number.isFinite(r.left) ? Math.max(0, Math.floor(r.left)) : 0,
    firstWeekAvailable: typeof r.firstWeekAvailable === 'boolean' ? r.firstWeekAvailable : null,
  };
}

/**
 * A reroll refused because other directions come with a plan: HTTP 402
 * `{ code: 'plan_required', reason: 'rerolls', firstWeekAvailable }`. Null for
 * any other error (the per-session cap still answers 429).
 */
export function rerollPlanRequiredOf(e: unknown): { firstWeekAvailable: boolean | null } | null {
  const res = (e as { response?: { status?: unknown; data?: unknown } } | null)?.response;
  if (!res || res.status !== 402 || !res.data || typeof res.data !== 'object') return null;
  const body = res.data as { code?: unknown; reason?: unknown; firstWeekAvailable?: unknown };
  if (body.code !== 'plan_required' || (body.reason !== undefined && body.reason !== 'rerolls')) return null;
  return { firstWeekAvailable: typeof body.firstWeekAvailable === 'boolean' ? body.firstWeekAvailable : null };
}

/** Thrown by a call the build limit answered: the wizard shows its card instead of an error. */
export class BuildLimitError extends Error {
  readonly limit: BuildLimit;
  constructor(limit: BuildLimit) {
    super(limit.text);
    this.name = 'BuildLimitError';
    this.limit = limit;
  }
}

export function isBuildLimitError(e: unknown): e is BuildLimitError {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'BuildLimitError' && !!(e as { limit?: unknown }).limit;
}
export interface Analysis {
  siteName?: string;
  siteType?: string;
  industry?: string;
  /** The industry as the owner names it, in the page's language (the api's, 734 A); shown over `industry`. */
  industryLabel?: string;
  siteSummary?: string;
  earningModel?: string | null;
  suggestedPages?: Array<{ slug?: string; title?: string; required?: boolean; recommended?: boolean }>;
  team?: string[];
  /** What the store sells, a closed set driving the real-product
   *  source: own stock, print-on-demand, digital downloads, dropship, or services. */
  sellingType?: 'physical_own' | 'pod' | 'digital' | 'dropship' | 'services' | 'unknown';
  /** Print-on-demand detection: present when the store sells
   *  custom/printed products, so the flow can offer the print-on-demand partner's connect step. */
  pod?: { detected: boolean; provider: string };
  /** The business's own country (ISO 3166-1 alpha-2, "FR"), read from where
   *  it is: it sets the store's country and the WhatsApp picker's default. */
  country?: string;
  /** The language the site is written in (ISO 639-1, "fr"), when the API says it;
   *  changed with PUT /onboarding/site-language/:sessionId (host transport.setSiteLanguage). */
  language?: string;
  /** Which language the site should speak is the owner's to choose first: the options, the screen's language first. */
  languageQuestion?: { options: string[] } | null;
}
export interface DesignConcept {
  id: string;
  name: string;
  tagline?: string;
  /** Genstudio engine only: the concept rendered as a full-page design mock
   *  (tall data-URL screenshot). Studio-engine concepts have no image and
   *  carry cssVariables/preview instead. */
  image?: string;
  directionName?: string | null;
  cssVariables?: string;
  /** Full design-system object the theme build consumes; opaque here. */
  designSystem?: unknown;
  logo?: { url?: string } | null;
  preview?: {
    background?: string;
    text?: string;
    secondaryText?: string;
    primary?: string;
    primaryText?: string;
    accent?: string;
    accentText?: string;
    heading?: string;
    headingFont?: string;
    bodyFont?: string;
    radius?: string;
    outline?: string;
  };
}
export interface PlannedProduct {
  name: string;
  /** null: no price, on request (2026-11-03). */
  priceCents: number | null;
  priceMode?: 'fixed' | 'from' | 'on_request';
  priceSource?: 'owner' | 'suggested';
  durationMinutes?: number;
  shortDescription?: string;
}
export interface BusinessPlan {
  currency: string;
  products: PlannedProduct[];
}
export interface OperateTeamMember {
  id: string;
  title: string;
  task: string;
}
export interface ProjectedReport {
  currency: string;
  isProjection: boolean;
  workDone: string[];
  taskPath: string[];
  narrative: string;
}
export interface GrowthChannel {
  operator: string;
  /** The team member's id, when the api gave it: the screens show their title from the catalog, in the page's language (734 A). */
  operatorId?: string;
  channel: string;
  action: string;
  why: string;
}
export interface GrowthPlan {
  currency: string;
  isEcommerce: boolean;
  goal: string;
  traffic: { conversionRatePct: number; visitors: number; period: string; conversions: number; explanation: string };
  channels: GrowthChannel[];
}
/** A drafted, executable first-week marketing operation (published post-signup). */
export interface MarketingTask {
  operator: string;
  /** The team member's id, when the api gave it: the screens show their title from the catalog, in the page's language (734 A). */
  operatorId?: string;
  channel: string;
  title: string;
  draft: string;
}
export interface OperatePreview {
  team: OperateTeamMember[];
  launchPost: { platform: string; text: string };
  projectedReport: ProjectedReport;
  growthPlan: GrowthPlan;
  marketingTasks: MarketingTask[];
}

/** POST /onboarding/ticket — a 30s SSE ticket plus, once a genstudio direction
 *  is picked, a 6h preview token for the static site + wp-bundle routes. */
/**
 * A page of the owner's that the first build on a site they already run left
 * alone: WPMaven's version was saved as a draft next to theirs (draftSlug).
 */
export interface LeftAlonePage {
  slug: string;
  title: string;
  draftSlug: string;
  theirs: { id: number; slug: string; title: string; status: string };
}

// ── What a publish really did (POST /onboarding/publish, POST /instances/host,
// GET /onboarding/mine's lastPublish) ──────────────────────────────────────
// A publish is complete, partial (the site is up but some required parts did
// not reach it), blocked (the site was checked first and nothing changed) or
// failed. Only a complete publish, or a partial one the owner chose to keep,
// is a live business.

export type PublishStatus = 'complete' | 'partial' | 'blocked' | 'failed';

/** The button a problem offers: done for the owner, or steps they follow. */
export type PublishFixAction = 'update_wordpress' | 'update_plugin' | 'install_agent' | 'check_again' | 'publish_again' | 'ask_host';

/** The parts of a business a problem is about. */
export type PublishPart =
  | 'site' | 'plugin' | 'store' | 'products' | 'coupon' | 'forms' | 'pages' | 'menus' | 'media' | 'front_page' | 'facts';

export interface PublishProblem {
  /** site_unreachable, plugin_outdated, wp_too_old, php_too_old, plugin_installs_disabled,
   *  files_not_writable, disk_full, wordpress_org_unreachable, plugin_install_failed,
   *  plugin_activation_failed, page_failed, menu_failed, finalize_failed, product_failed,
   *  product_image_missing, coupon_failed, form_failed, media_failed, post_failed,
   *  site_icon_failed, identity_failed, agent_missing (kept a string: an API newer than this page may add one). */
  code: string;
  part: PublishPart;
  /** True: the publish cannot count as finished while it stands. */
  required: boolean;
  /** Written for the owner by the API. */
  message: string;
  fix?: { action: PublishFixAction; label: string };
  /** A download the fix needs (WPMaven Agent's zip, agent_missing), shown as its own button. */
  link?: { label: string; url: string };
}

/** The site's homepage setting, as WordPress holds it. */
export interface FrontSetting {
  showOnFront: 'posts' | 'page';
  pageOnFront: number;
  pageForPosts: number;
  /** The title of the page the site opens on, when it opens on a page. */
  title: string | null;
}

export interface PublishCounts {
  pages: { published: number; parked: number; failed: number };
  products: { created: number; updated: number; parked: number; failed: number; withoutImage: number };
  coupons: { created: number; failed: number };
  forms: { created: number; failed: number };
  posts: { created: number; failed: number };
  media: { uploaded: number; failed: number };
}

/** A fact the build left empty rather than invent it (the owner never gave it). */
export type PublishFact = 'phone' | 'email' | 'address' | 'hours' | 'social';

export interface PublishOutcome {
  status: PublishStatus;
  instanceId: string;
  siteUrl: string | null;
  at: string;
  counts: PublishCounts;
  frontPage: {
    /** set: the site opens on the new homepage; offered: the owner's own front was kept and the switch is one click;
     *  kept: the owner's front was kept on purpose; switched: the owner switched to the new homepage. */
    state: 'set' | 'offered' | 'kept' | 'switched';
    designedPageId: number | null;
    previous: FrontSetting | null;
  };
  /** WordPress's untouched starter content the build replaced or moved out of the way. */
  defaultsReplaced: Array<{ kind: 'hello_world' | 'sample_page' | 'privacy_draft'; id: number; action: 'replaced' | 'trashed' | 'deleted' }>;
  factsLeftEmpty: PublishFact[];
  leftAlone: LeftAlonePage[];
  storeCurrencyNote: string | null;
  problems: PublishProblem[];
  /** Partial or failed, on the same site. */
  canPublishAgain: boolean;
  /** The owner kept a partial site as it is. */
  acceptedAt?: string;
  /** "New design, keep my content": the switch to the new design and the way back. */
  designSwitch?: DesignSwitchState;
}

/** What the switch to a new design did (switched, stopped and undone, or put back). */
export interface DesignSwitchState {
  status: 'switched' | 'stopped' | 'restored';
  at: string;
  /** The last day "Put my old design back" is offered. */
  until: string | null;
  step: string | null;
  undone: boolean | null;
  backup: boolean;
  restoredAt?: string;
}

/** POST /onboarding/site-brief: what a new design of the owner's site is made from. */
export interface SiteBriefAnswer {
  siteName: string;
  summary: string | null;
  pages: Array<{ slug: string; title: string; front: boolean; builder: 'elementor' | null }>;
  /** Published pages the new design leaves as they are. */
  pagesLeft: number;
  products: number;
  store: boolean;
  /** The site's colours and fonts, when they were read well enough to keep. */
  look: { background: string; surface: string | null; ink: string; accent: string; display: string; body: string } | null;
  keepLook: boolean;
  logo: string | null;
}

/**
 * GET /onboarding/site-session: the calling WordPress site's setup state
 * (site tokens only). Whether the wizard opens on this site, the brand it
 * wears, the owner's business cap, and the site's setup session: its build,
 * a publish running (the background publish holds the build claim), and the
 * last publish's outcome onto this site.
 */
export interface SiteOnboardingState {
  wizard: { open: boolean; closedReason: 'agency_managed' | 'built' | null };
  brand: { name: string | null; logoUrl: string | null; color: string | null; supportEmail: string | null; ourMark: boolean };
  canCreate: { allowed: boolean; reason: string | null };
  /** The wizard may open on "Your site" for a site that holds the owner's content; absent from an older api (no). */
  existingSite?: boolean;
  /**
   * A store that already sells while "Your site" is not open: the idea flow
   * would end at a refused publish, so the wizard says this first. Absent or
   * null otherwise.
   */
  liveStore?: { text: string } | null;
  session: SiteOnboardingSession | null;
}

/** One finding of the site check, in the owner's words (POST /onboarding/site-check). */
export interface SiteCheckFinding {
  id: string;
  area: string;
  /** fix, improve, or ok (shown folded as "Fine"). */
  level: 'fix' | 'improve' | 'ok';
  /** Who presents it (an operator id). */
  operator: string;
  title: string;
  detail?: string;
  where: Array<{ label: string; url?: string }>;
  /** The team once the owner says yes, the owner with the team's guidance, or a feature that keeps it right from now on. */
  handledBy?: 'team' | 'with_you' | 'kept';
  /** "What happens". */
  happens?: string;
}

export interface SiteCheckArea {
  area: string;
  title: string;
  operator: string;
  status: 'checked' | 'unread';
  counts: { fix: number; improve: number; ok: number };
}

/** The site check of a site the owner already runs: fixed words, counts only, no score. */
export interface SiteCheckResult {
  id: string;
  ranAt: string;
  durationMs: number;
  counts: { fix: number; improve: number; ok: number };
  /** "2 to fix, 4 to improve, 11 fine." and its kinder forms. */
  summary: string;
  areas: SiteCheckArea[];
  findings: SiteCheckFinding[];
  unreadable: Array<{ area: string; title: string; sentence: string }>;
}

/** The checks a site has left this hour (the site check's read, its run and its refusal answer it). */
export interface SiteCheckLimit {
  left: number;
  perHour: number;
  /** When a check opens again, ISO; null while one is left. */
  nextAt: string | null;
}

/** The api's `limit`, or null when it sent none (an api before it). Pure. */
export function readCheckLimit(raw: unknown): SiteCheckLimit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.left !== 'number' || !Number.isFinite(r.left)) return null;
  const nextAt = typeof r.nextAt === 'string' && !Number.isNaN(Date.parse(r.nextAt)) ? r.nextAt : null;
  return { left: Math.max(0, Math.floor(r.left)), perHour: typeof r.perHour === 'number' && r.perHour > 0 ? r.perHour : 3, nextAt };
}

/** "Save my business" (Keep my site, Fix and improve my site): the business from the site, no build. */
export interface KeepSiteInput {
  name: string;
  summary: string;
  store: boolean;
  siteType: 'blog' | 'business' | 'ecommerce';
  phone: string;
  email: string;
  address: string;
  /** Fix and improve: the fixes are chosen next, so a reload comes back to them until they are. */
  fixes?: boolean;
  /** Fix and improve: the check's findings the owner ticked, filed as Waiting for you items; a list, even empty, ends the choice. */
  findingIds?: string[];
}

export interface KeepSiteAnswer {
  business: { name: string; store: boolean };
  /** A plan that runs the team's work is on. */
  plan: boolean;
  /** The ticked findings filed (null when none were sent). */
  fixes: { filed: number; waiting: number } | null;
}

/** "Save my business" refused a field: the field's sentence, by name ('name', 'phone', 'address.street'). */
export class KeepFieldsError extends Error {
  constructor(readonly fields: Record<string, string>, message: string) {
    super(message);
    this.name = 'KeepFieldsError';
  }
}

export interface SiteOnboardingSession {
  id: string;
  /** The lowercase session status ('describing', 'generating', 'completed'...). */
  status: string;
  /** A site build runs or finished. */
  hasBuild: boolean;
  /** A publish of this session onto this site is running now. */
  publishing: boolean;
  /** What the last publish onto this site did, in the owner's words; null before any. */
  publishOutcome: PublishOutcome | null;
  /** The business is kept from the site (Fix and improve) and its fixes are not chosen yet: the wizard opens on them. */
  fixesToChoose?: boolean;
}

/** GET /onboarding/publish-check: whether the site can take the business, before anything is written. */
export interface PublishCheck {
  /** No required problem stands. */
  ready: boolean;
  problems: PublishProblem[];
  front: { wouldSet: boolean; showOnFront: 'posts' | 'page'; pageOnFrontTitle: string | null } | null;
  plugins: Array<{ slug: string; installed: boolean; active: boolean; compatible: boolean; reason: string | null }>;
  /** What "Update WordPress for me" would do: from this version to updateTo. */
  wordpress: { version: string | null; updateTo: string | null; canUpdate: boolean };
}

/** POST /onboarding/publish/:sessionId/update-wordpress: backed up first, then updated, then checked again. */
export interface WordPressUpdateResult {
  updated: boolean;
  from: string | null;
  to: string | null;
  backup: { id: string } | null;
  check: PublishCheck;
}

/** POST /instances/:instanceId/front-page: the one-click homepage switch, and its way back. */
export interface FrontPageSwitchResult {
  ok: boolean;
  use: 'designed' | 'previous';
  state: 'set' | 'offered' | 'kept' | 'switched';
  summary: string;
  changed: Array<{ kind: 'page'; ref: string; label: string; before?: string; after?: string }>;
  before: FrontSetting | null;
  after: FrontSetting | null;
  failures: Array<{ code: string; message: string }>;
  undoable: boolean;
}

export interface OnboardingTicket {
  ticket: string;
  expiresIn?: number;
  previewToken: string | null;
  previewExpiresIn?: number | null;
}

/** POST /onboarding/site-build — kick (or attach to) the engine's real build. */
export interface SiteBuildStart {
  started: boolean;
  alreadyBuilt: boolean;
  /** True when an update of the API had stopped this session's build and
   *  this start began it again, free for the visitor (2026-10-19). */
  resumed?: boolean;
  /** 'running' | 'complete' | 'error' for an existing run; 'high_demand' when
   *  the anonymous build fences answered instead of building; 'build_limit'
   *  or 'payment_failed' when a signed-in build was not started (text, fix). */
  status?: string;
  message?: string;
  text?: string;
  fix?: { label: string; href: string } | null;
  /** A 'build_limit': which limit, when a build opens again, the $1 first week, the way on (buildLimitOf). */
  scope?: BuildLimitScope;
  retryAt?: string | null;
  firstWeekAvailable?: boolean | null;
  action?: 'start_plan';
  /** The final instance's predicted plugin set (wpforms-lite always in
   *  practice, woocommerce with store intent) — the wizard preboots the
   *  in-browser Playground with it while the site generates. */
  predicted_plugins?: string[];
  /** The hosted preview: true when the
   *  API makes a private WordPress site for this build. The wizard then reads
   *  hostedPreview() and frames that site; no in-browser WordPress starts.
   *  Absent while the API's preview is off. */
  hosted_preview?: boolean;
}

/** GET /onboarding/hosted-preview: the private WordPress site made while the build runs. */
export interface HostedPreviewState {
  /** preparing: ask again soon; ready: frame `url`; unavailable: keep the static copy, stop asking. */
  state: 'preparing' | 'ready' | 'unavailable';
  /** The site's private address (its access token inside), only when ready. */
  url?: string;
}

/** GET /onboarding/wp-bundle — everything the in-browser Playground applier
 *  needs to reproduce the server-side WordPress apply: the compiled theme,
 *  the mu driver, the page payloads, and the resources manifest. `content`
 *  and `resources` pass through the engine's compile output verbatim. */
export interface WpBundle {
  themeSlug: string;
  theme: Array<{ path: string; base64: string }>;
  mu: Array<{ name: string; base64: string }>;
  content: Array<{
    slug: string;
    title: string;
    post_content: string;
    meta_description?: string;
    fullhtml?: boolean;
    is_front?: boolean;
    is_posts_page?: boolean;
  }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resources: Record<string, any>;
  assets: Array<{ file: string; base64: string }>;
  siteIcon: { file: string; base64: string } | null;
  logo: { file: string; base64: string } | null;
  /** The currency the store sells in (the session's, store currency
   *  contract 6.3): the applier sets woocommerce_currency and the price
   *  decimals from it after the products. Absent from older bundles. */
  storeCurrency?: WpBundleStoreCurrency | null;
}
/** The store's currency as the build carries it (bundle and zip manifest). */
export interface WpBundleStoreCurrency {
  /** ISO 4217 ("EUR"). */
  code: string;
  /** Price decimals: 0 for JPY, KRW and CLP, 2 for the rest. */
  digits: number;
}
/** A real, buyable product for the store preview (the print-on-demand partner's public catalog). */
export interface StoreCatalogProduct {
  source: string;
  externalId: number;
  name: string;
  brand?: string;
  category?: string;
  imageUrl?: string;
  /** The currency of priceCents: the store's (store currency contract 6.1). */
  currency?: string;
  /** The supplier's base cost, kept in its own currency for margin math. */
  baseCostCents?: number;
  /** The currency of baseCostCents ('USD' for print-on-demand base costs). */
  baseCostCurrency?: string;
  priceCents: number;
  colors?: string[];
  sizes?: string[];
  shortDescription?: string;
  /** Color name to hex, for the swatches. */
  colorCodes?: Record<string, string>;
  /** Each catalog variant, with its own photo when the catalog has one. */
  variants?: Array<{ id: number; color?: string; size?: string; inStock: boolean; image?: string }>;
  /** What one sells for at cost: the base, standard shipping to the owner's country (row currency). */
  costCents?: number;
  /** The lowest price that still covers printing, shipping and fees (row currency). */
  minPriceCents?: number;
}
export interface StoreCatalog {
  products: StoreCatalogProduct[];
  currency: string;
  source: string | null;
}

/** What the feasibility gate can say about a described project. */
export type ProjectType =
  | 'store' | 'services' | 'restaurant' | 'content' | 'portfolio'
  | 'nonprofit' | 'events' | 'membership'
  | 'mobile_app' | 'desktop_software' | 'saas' | 'marketplace'
  | 'game' | 'hardware' | 'crypto' | 'ai_product'
  | 'unclear';

export interface Feasibility {
  projectType: ProjectType;
  /** Customer-facing sentence naming what the idea needs that we lack. */
  reason?: string;
}

/**
 * analyze() no longer always returns an analysis. When the gate refuses, the
 * body carries the verdict instead, so callers MUST check `supported` before
 * reaching for `analysis`. Modelled as a union rather than optional fields so
 * the compiler enforces that.
 */
export interface Clarification {
  needsClarification: true;
  /** One question, written about THIS description, whose answer places it. */
  question: string;
  /** Echo back on the retry so the server can stop asking. Capped at 1. */
  clarifyRound: number;
}

/**
 * analyze() has three outcomes, modelled as a union so the compiler forces
 * every caller to handle them rather than reaching for `analysis` and getting
 * undefined: it understood the business, it could not place it and wants to ask
 * one question, or it refused (legacy shape, kept for older clients).
 */
/** Asked once, still could not place it. Offer the shelf instead of asking again. */
export interface SuggestionsNeeded {
  needsSuggestions: true;
}

export type AnalyzeResult =
  | { analysis: Analysis; supported?: true }
  | Clarification
  | SuggestionsNeeded
  | { supported: false; feasibility: Feasibility };

export function isRefusal(r: AnalyzeResult): r is { supported: false; feasibility: Feasibility } {
  return (r as { supported?: boolean }).supported === false;
}

export function needsClarification(r: AnalyzeResult): r is Clarification {
  return (r as Clarification).needsClarification === true;
}

export function needsSuggestions(r: AnalyzeResult): r is SuggestionsNeeded {
  return (r as SuggestionsNeeded).needsSuggestions === true;
}

export interface InspirationIdea {
  id: string;
  icon: string;
  hook: string;
  pitch: string;
  earnTag: string;
  seedText: string;
  whyNow?: string;
}
export interface InspirationSource {
  title?: string;
  uri: string;
  domain?: string;
}

/** Bundled fallback ideas — always shown, even when the weekly research is empty. */
export const DEFAULT_INSPIRATIONS: InspirationIdea[] = [
  { id: 'default-jewelry', icon: 'Gift', hook: 'Handmade jewelry shop', pitch: 'Small-batch pieces sold as gifts, shipped anywhere.', earnTag: 'Sells products', seedText: 'I make handmade jewelry: earrings, necklaces and custom pieces for gifts and special occasions. I want an online store where people anywhere can browse the collection, buy pieces shipped to them, and request custom work.' },
  { id: 'default-apparel', icon: 'Shirt', hook: 'Niche apparel brand', pitch: 'Designs for one passionate audience, printed and shipped per order.', earnTag: 'Sells products', seedText: 'I run an apparel brand with original designs for a niche audience, printed on tees, hoodies and caps as orders come in. I want an online store where fans browse the designs, pick sizes and buy, with everything shipped to their door.' },
  { id: 'default-digital', icon: 'Palette', hook: 'Digital planners & templates', pitch: 'Downloadable products: make once, sell forever, zero shipping.', earnTag: 'Sells downloads', seedText: 'I design digital planners, journals and templates that customers download instantly after purchase. I want an online store that sells the downloads, shows previews of each product, and delivers files automatically after payment.' },
  { id: 'default-coffee', icon: 'Coffee', hook: 'Small-batch coffee roastery', pitch: 'Beans roasted weekly, shipped nationwide, customers who reorder.', earnTag: 'Sells products', seedText: 'I roast small-batch specialty coffee every week and ship it nationwide. I want an online store where customers buy bags, discover the story behind each origin, and come back to reorder their favorites.' },
  { id: 'default-coaching', icon: 'Dumbbell', hook: 'Online fitness programs', pitch: 'Training plans and video coaching, delivered entirely online.', earnTag: 'Sells plans & sessions', seedText: 'I coach fitness clients entirely online: downloadable training programs plus one-on-one video sessions. I want a site where clients buy my programs directly and book video coaching sessions from anywhere.' },
  { id: 'default-bakery', icon: 'Cake', hook: 'Home bakery with online orders', pitch: 'Cakes and pastries pre-ordered online, picked up fresh.', earnTag: 'Takes orders', seedText: 'I run a home bakery making cakes, pastries and custom orders for birthdays and events. I want customers to see the menu, pre-order and pay online for pickup, and request quotes for event catering.' },
];

/** Does this business sell products (→ a WooCommerce store preview) vs services
 *  (→ the studio homepage)? Mirrors the API's isStoreSellingType. */
export const isStoreType = (a?: Pick<Analysis, 'sellingType' | 'siteType'> | null): boolean => {
  if (!a) return false;
  // 'unknown' means the API could not identify a product source. It reads as
  // not-a-store on both sides, or the preview promises a shop the build has no
  // catalogue for. Mirrors isStoreSellingType in onboarding.types.ts.
  if (a.sellingType === 'services' || a.sellingType === 'unknown') return false;
  if (a.sellingType && ['pod', 'physical_own', 'digital', 'dropship'].includes(a.sellingType)) return true;
  return a.siteType === 'ecommerce';
};

/**
 * How long a publish may take: the finish build runs inside the call, so
 * minutes, not the host's default (the dashboard's 35 s).
 */
export const PUBLISH_TIMEOUT_MS = 10 * 60_000;

/**
 * How long reading a description may take: the model can be asked again when
 * it is busy, and each plugin it names is looked up on WordPress.org, so the
 * answer can take close to a minute (52 s seen on 2026-10-06). Past the host's
 * default (the dashboard's 35 s) the owner read "We couldn't reach WPMaven"
 * while the analysis was finishing on the server.
 */
export const ANALYZE_TIMEOUT_MS = 2 * 60_000;

/**
 * The ceiling of the design directions' start (0.3.7's call ceiling, kept):
 * a new set takes 45 to 55 s (every new set on production from 2026-10-11 to
 * 2026-10-14, the slowest 55.2 s), and an API from before the jobs
 * (./aiStep) makes the whole set inside its start. An API with the
 * jobs answers the start at once.
 */
export const DESIGN_CONCEPTS_TIMEOUT_MS = AI_STEP_START_TIMEOUT_MS;

/**
 * The wait before the design directions are asked about again: when the
 * server says it is still working on them, and when no answer came back (a
 * timeout, a dropped connection, a gateway answering in the API's place).
 * The server keeps the set it finished and joins the one still being made,
 * so asking again makes nothing new.
 */
export const DESIGN_CONCEPTS_RETRY_DELAY_MS = AI_STEP_POLL_MS;

/** Best-effort browser locale (e.g. "fr-FR"): drives the forecast currency. */
const browserLocale = (): string | undefined =>
  typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language
    ? navigator.language
    : undefined;

/** An api answer, as the transport resolves it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = { success?: boolean; error?: unknown; data?: any } | null | undefined;

/**
 * The calls the wizard makes, plus publish and keep-as-is, for one host.
 * `identity` decides what goes with them: a draft sends its anonId (and the
 * Turnstile token on analyze), a site never does.
 */
export function createOnboardingApi(hostTransport: WizardTransport, identity: WizardIdentity) {
  // The page's language on every call (734 A): the api answers the owner in it.
  const transport = inPageLanguage(hostTransport);
  const draft = identity.mode === 'draft' ? identity.draft : null;
  /** The site's session id, known once start answered (site mode only). */
  let siteSessionId: string | null = null;

  /** The session this browser builds: the draft's, or the site's open one. */
  const getSessionId = (): string | null => (draft ? draft.sessionId() : siteSessionId);
  /** The draft's anonymous id; never sent for a site. */
  const getAnonId = (): string | null => (draft ? draft.anonId() : null);
  /** `{ anonId }` for a draft (null when it has none yet, as the api always read it), nothing for a site. */
  const anon = (): { anonId?: string | null } => (draft ? { anonId: getAnonId() } : {});
  /** The store catalog asked for per session: the preview and the lineup ask at once and share one wait. */
  const catalogRuns = new Map<string, Promise<StoreCatalog>>();

  async function post<T>(path: string, body: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    const data = await transport.request<Body>({ method: 'POST', path, body, ...(timeoutMs ? { timeoutMs } : {}) });
    if (!data?.success) {
      throw userFacingError(typeof data?.error === 'string' && data.error.trim() ? data.error : API_COPY.somethingWrong);
    }
    return data.data as T;
  }

  /** A site route's answer, or its own sentence when it refused (any status). */
  async function siteCall<T>(path: string, body: Record<string, unknown>, fallback: string, timeoutMs?: number): Promise<T> {
    let data: Body | null = null;
    try {
      data = await transport.request<Body>({ method: 'POST', path, body, ...(timeoutMs ? { timeoutMs } : {}) });
    } catch (e) {
      const answer = (e as WizardApiError | null)?.data;
      data = answer && typeof answer === 'object' ? (answer as Body) : null;
      if (!data) throw e;
    }
    if (data?.success) return data.data as T;
    throw userFacingError(typeof data?.error === 'string' && data.error.trim() ? data.error : fallback);
  }

  return {
    getSessionId,
    getAnonId,

    /** Create (or resume) the session: a draft stores its sessionId + anonId, a site keeps its session id in memory. */
    async start(): Promise<StartResult> {
      const anonId = getAnonId();
      const r = await post<StartResult>('/onboarding/start', anonId ? { anonId } : {});
      // No session was started (3 previews built before the first payment, or
      // a failed payment): the card says why, nothing is stored.
      const limit = buildLimitOf(r);
      if (limit) throw new BuildLimitError(limit);
      if (draft) draft.save(r.sessionId, r.anonId ?? anonId);
      else siteSessionId = r.sessionId;
      return r;
    },

    /** Understand the business. Passing the locale here is what sets the forecast currency.
     *  turnstileToken: the bot-gate token, verified once per session (strategy doc 22.7); a draft's only. */
    async analyze(
      description: string,
      turnstileToken?: string | null,
      clarifyRound = 0,
    ): Promise<AnalyzeResult> {
      const r = await post<AnalyzeResult>('/onboarding/analyze', {
        sessionId: getSessionId(),
        description,
        clarifyRound,
        installType: 'fresh',
        locale: browserLocale(),
        ...anon(),
        ...(draft && turnstileToken ? { turnstileToken } : {}),
      }, ANALYZE_TIMEOUT_MS);
      // A draft that already used its build's AI time does not start another
      // step (the API decides a build at its start): the card says why and the
      // way on, never a "Something went wrong".
      const limit = buildLimitOf(r);
      if (limit) throw new BuildLimitError(limit);
      return r;
    },

    /** Leave an address against an idea we could not build. Never throws for the
     *  caller's benefit: the idea itself is already recorded server-side. */
    async leaveRoadmapEmail(email: string, description: string): Promise<void> {
      await post('/onboarding/roadmap-interest', {
        email,
        description,
        sessionId: getSessionId(),
      });
    },

    /** Design directions (the style step). Pass `regenerate` only for an
     *  explicit reroll: re-entering the step without it reuses the session's
     *  existing concepts for free, while rerolls are capped per session (the
     *  server answers 429 at the cap) and come with a paid plan (a visitor
     *  without one is answered 402 plan_required: rerollPlanRequiredOf).
     *  `rerolls` says which, before any is asked for (null from an API before it).
     *  A job on the API (./aiStep): the wait lasts as long as
     *  the server works on it, a moment with no answer is asked about again,
     *  and a reroll is asked for once (never again on a later ask);
     *  `stillWanted` false stops the wait (AiStepStoppedError). */
    async designConcepts(businessDescription: string, siteType: string, industry?: string, opts?: { regenerate?: boolean; stillWanted?: () => boolean }): Promise<{ concepts: DesignConcept[]; rerolls: RerollState | null }> {
      const r = await runAiStep<{ concepts: DesignConcept[]; rerolls?: unknown }>(transport, '/onboarding/design-concepts', {
        sessionId: getSessionId(),
        businessDescription,
        siteType,
        industry,
        ...anon(),
        ...(opts?.regenerate ? { regenerate: true } : {}),
      }, DESIGN_DIRECTIONS_WORDS, { stillWanted: opts?.stillWanted });
      // The style step is part of the session's build: the limit answers here too.
      const limit = buildLimitOf(r);
      if (limit) throw new BuildLimitError(limit);
      return { ...r, rerolls: rerollsOf(r?.rerolls) };
    },

    /** Persist the confirmed (possibly edited) analysis - brand name, summary,
     *  plugin removals - so the theme build sees the user's edits. */
    async confirm(editedAnalysis?: Record<string, unknown>): Promise<void> {
      const data = await transport.request<Body>({
        method: 'PUT',
        path: `/onboarding/confirm/${getSessionId()}`,
        body: { ...anon(), ...(editedAnalysis ? { editedAnalysis } : {}) },
      });
      if (!data?.success) throw new Error((data?.error as string) || API_COPY.confirmAnalysisFailed);
    },

    /** Persist the picked design concept: the studio theme build reads it from
     *  the session, so an unpersisted pick means the generated site ignores the
     *  user's chosen style. */
    async selectStyle(conceptId: string): Promise<void> {
      const data = await transport.request<Body>({
        method: 'PUT',
        path: `/onboarding/style/${getSessionId()}`,
        body: { style: conceptId, ...anon() },
      });
      if (!data?.success) throw new Error((data?.error as string) || API_COPY.saveStyleFailed);
    },

    /** The forecast/projections (local currency, USD fallback). `scenario` is
     *  the line the owner accepted on the forecast step ('cautious' |
     *  'expected' | 'ambitious'); sent only when there is one to send, so the
     *  first, generating call is unchanged. `businessPlan` is the plan as the
     *  owner edited it (the lineup's names, prices and ticks, the forecast's
     *  numbers): saved with the scenario, and the answer is the plan as saved.
     *  Refused with BUILD_STARTED once the site build has its lineup. A
     *  business that sells nothing online gets no plan, and `reason` says so:
     *  'not_commercial'. */
    async forecast(scenario?: string, businessPlan?: BusinessPlan | null): Promise<{ businessPlan: BusinessPlan | null; reason?: 'not_commercial' | null }> {
      const r = await post<{ businessPlan: BusinessPlan | null; reason?: 'not_commercial' | null }>(`/onboarding/business-plan/${getSessionId()}`, {
        locale: browserLocale(),
        ...anon(),
        ...(scenario ? { scenario } : {}),
        ...(businessPlan ? { businessPlan } : {}),
      });
      // The same build limit as the other steps: the card, not an error.
      const limit = buildLimitOf(r);
      if (limit) throw new BuildLimitError(limit);
      return r;
    },

    /** The operate demonstration: team + drafted launch post + the work-to-MRR report. */
    async operatePreview(): Promise<OperatePreview> {
      return post(`/onboarding/operate-preview/${getSessionId()}`, { ...anon() });
    },

    /** Mint an SSE ticket (30s) + the static-preview token (6h; null until a
     *  genstudio direction is picked). Pass a sessionId post-signup (authed);
     *  defaults to this browser's session. */
    async ticket(sessionId?: string): Promise<OnboardingTicket> {
      return post(`/onboarding/ticket/${sessionId || getSessionId()}`, sessionId ? {} : { ...anon() });
    },

    /** Start (or attach to) the engine's real site build. Idempotent server-side:
     *  alreadyBuilt / status:'running' both mean "open the event stream": it
     *  replays the journal and completes instantly when artifacts exist.
     *  `retry` restarts a FAILED build instead of replaying its error. */
    async siteBuild(opts?: { retry?: boolean }): Promise<SiteBuildStart> {
      return post(`/onboarding/site-build/${getSessionId()}`, { ...anon(), ...(opts?.retry ? { retry: true } : {}) });
    },

    /** Absolute URL of the site-build SSE stream (EventSource sends no headers;
     *  the ticket in the query string is the auth). */
    siteBuildEventsUrl(ticket: string, sessionId?: string): string {
      return transport.ticketedUrl(`/onboarding/site-build/${sessionId || getSessionId()}/events`, { ticket, ...pageLanguageQuery() });
    },

    /** The hosted preview of this session: preparing, ready with its private
     *  address (https only), or unavailable. The preview token is the auth,
     *  as for the static preview. A failed read rejects (the wizard asks again). */
    async hostedPreview(previewToken: string, sessionId?: string): Promise<HostedPreviewState> {
      const sid = sessionId || getSessionId();
      if (!sid) return { state: 'unavailable' };
      const data = await transport.request<Body>({ method: 'GET', path: `/onboarding/hosted-preview/${sid}`, query: { t: previewToken } });
      const d = data?.success ? (data.data as { state?: unknown; url?: unknown } | undefined) : undefined;
      if (d?.state === 'ready' && typeof d.url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(d.url)) return { state: 'ready', url: d.url };
      if (d?.state === 'unavailable') return { state: 'unavailable' };
      return { state: 'preparing' };
    },

    /** Absolute URL of a static-site preview path. `path` is the server-relative
     *  route from preview_ready (e.g. '/onboarding/site-preview/<sid>/'); the
     *  token rides the query string because an iframe can't send auth headers. */
    sitePreviewUrl(path: string, previewToken: string): string {
      return transport.ticketedUrl(path, { t: previewToken });
    },

    /** Real, buyable products for the store preview (the print-on-demand partner's public catalog).
     *  A job on the API (./aiStep): the pictures can take a
     *  while, and the wait lasts as long as the server works on them. Two
     *  callers at once (the preview and the lineup) share one wait. */
    async storeCatalog(sessionId?: string): Promise<StoreCatalog> {
      // No session yet: there is nothing to look up, and the path must never be
      // /store-catalog/null (every such call was a 404 on production).
      const sid = sessionId || getSessionId();
      if (!sid) return { products: [], currency: '', source: null };
      const running = catalogRuns.get(sid);
      if (running) return running;
      const run = runAiStep<StoreCatalog>(transport, `/onboarding/store-catalog/${sid}`, sessionId ? {} : { ...anon() }, PRODUCTS_WORDS)
        .finally(() => { catalogRuns.delete(sid); });
      catalogRuns.set(sid, run);
      return run;
    },

    /** Save the WhatsApp number on the session (capture only - the real link
     *  happens in the dashboard, prefilled from this). The picker's country goes
     *  with it, so a national number ("06 12 34 56 78") is stored with its
     *  country code instead of as bare digits. */
    async saveWhatsappIntent(phone: string, country?: string | null): Promise<void> {
      const code = typeof country === 'string' && /^[A-Za-z]{2}$/.test(country.trim()) ? country.trim().toUpperCase() : null;
      const data = await transport.request<Body>({
        method: 'POST',
        path: `/onboarding/whatsapp-intent/${getSessionId()}`,
        body: { phone, ...(code ? { country: code } : {}), ...anon() },
      });
      if (!data?.success) throw new Error((data?.error as string) || API_COPY.saveNumberFailed);
    },

    /** Email capture behind the build fences' 'high_demand' response: the API
     *  builds the site from the waiting list (usually within a day) and emails
     *  the link, which opens /your-site. */
    async joinBuildWaitlist(email: string, description?: string): Promise<{ message: string }> {
      const sessionId = getSessionId();
      const anonId = getAnonId();
      return post('/onboarding/build-waitlist', {
        email,
        ...(description ? { description } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(anonId ? { anonId } : {}),
        // The language the waiting-list email and the site it builds should
        // follow (the API trims it to 20 characters).
        ...(browserLocale() ? { locale: browserLocale()!.slice(0, 20) } : {}),
      });
    },

    /**
     * Publish a session's site to one of the owner's instances. On a site the
     * owner already runs the build keeps their pages (protectedExisting) and
     * lists the ones it left alone. A site built before answers 409 with code
     * 'build_refused'. The account's plan refusing the finish build (its free
     * builds used, or a failed payment) answers 402 with the build limit's
     * sentence and fix: thrown as a BuildLimitError, so the page shows the
     * card with the way on instead of an error.
     *
     * From a WordPress site (identity 'site') the publish runs in the
     * background: 202 `{ publishing: true }` at once, and the outcome is read
     * from siteSession() until the publish ends.
     *
     * 200 for a complete and for a partial publish: `outcome` says which, and
     * `deployed` is true only for a complete one. A site that cannot take the
     * business answers 422 'publish_blocked' (checked first, nothing changed)
     * and a publish that stopped answers 422 'publish_failed', both with the
     * problems (publishProblemsOf). 409 'publish_partial_elsewhere': the
     * business is partly published on another site of the owner's.
     */
    async publish(sessionId: string, instanceId: string): Promise<{
      deployed: boolean;
      filesDeployed: number;
      productsCreated: number;
      productsSkipped: number;
      productsFailed: number;
      siteUrl: string | null;
      protectedExisting?: boolean;
      leftAlone?: LeftAlonePage[];
      /** Set when the site already sold in another currency: it kept it, and
       *  the new products were converted into it (store currency contract 10.5). */
      storeCurrencyNote?: string | null;
      /** What reached the site and what did not (absent from an API older than it). */
      outcome?: PublishOutcome;
      /** A WordPress site's publish: started, running in the background (202). */
      publishing?: boolean;
    }> {
      try {
        // The finish build runs inside this call: minutes, not the host's default.
        return await post(`/onboarding/publish/${sessionId}`, { instanceId }, PUBLISH_TIMEOUT_MS);
      } catch (e) {
        const limit = publishBuildLimitOf(e);
        if (limit) throw new BuildLimitError(limit);
        throw e;
      }
    },

    /**
     * "Check my site": the site's session (start), then the check of it
     * (POST /onboarding/site-check/:sessionId). The first moment anything
     * about the site leaves it.
     */
    async startSiteCheck(): Promise<SiteCheckResult> {
      return (await this.runSiteCheck()).check;
    },

    /**
     * A check run now, with the checks left this hour. A refusal (three an
     * hour) throws the api's error, its body carrying `limit` (readCheckLimit).
     */
    async runSiteCheck(): Promise<{ check: SiteCheckResult; limit: SiteCheckLimit | null }> {
      const sessionId = getSessionId() ?? (await this.start()).sessionId;
      const r = await post<{ check: SiteCheckResult; limit?: unknown }>(`/onboarding/site-check/${sessionId}`, {}, 120_000);
      return { check: r.check, limit: readCheckLimit(r.limit) };
    },

    /** The site's last check (GET /onboarding/site-check/:sessionId), or null. */
    async lastSiteCheck(): Promise<SiteCheckResult | null> {
      return (await this.readSiteCheck()).check;
    },

    /** The site's last check and the checks left this hour. */
    async readSiteCheck(): Promise<{ check: SiteCheckResult | null; limit: SiteCheckLimit | null }> {
      const sessionId = getSessionId();
      if (!sessionId) return { check: null, limit: null };
      const data = await transport.request<Body>({ method: 'GET', path: `/onboarding/site-check/${sessionId}` });
      if (!data?.success) return { check: null, limit: null };
      return { check: (data.data?.check ?? null) as SiteCheckResult | null, limit: readCheckLimit(data.data?.limit) };
    },

    /**
     * "Save my business": the business made from the site as it is, with the
     * details the owner checked; with findingIds, the ticked findings filed
     * as Waiting for you items. A field to correct throws KeepFieldsError.
     */
    async keepSite(input: KeepSiteInput): Promise<KeepSiteAnswer> {
      const sessionId = getSessionId();
      if (!sessionId) throw userFacingError(API_COPY.checkSiteFirst);
      let data: Body | null = null;
      try {
        data = await transport.request<Body>({ method: 'POST', path: `/onboarding/keep-site/${sessionId}`, body: { ...input } });
      } catch (e) {
        // An answer outside 2xx carries the api's sentence and, for a field to correct, the fields.
        const body = (e as WizardApiError | null)?.data;
        data = body && typeof body === 'object' ? (body as Body) : null;
        if (!data) throw e;
      }
      if (data?.success) return data.data as KeepSiteAnswer;
      const message = typeof data?.error === 'string' && data.error.trim() ? data.error : API_COPY.saveBusinessFailed;
      const fields = (data as { fields?: unknown } | null)?.fields;
      if (fields && typeof fields === 'object') throw new KeepFieldsError(fields as Record<string, string>, message);
      throw userFacingError(message);
    },

    /**
     * "New design, keep my content": the site read for its new design (its
     * pages and words, products, name and look), set on the session. No
     * model call, nothing changes on the site.
     */
    async siteBrief(input: { keepLook?: boolean } = {}): Promise<{ brief: SiteBriefAnswer; analysis: Record<string, unknown> }> {
      const sessionId = getSessionId() ?? (await this.start()).sessionId;
      return siteCall(`/onboarding/site-brief/${sessionId}`, { ...input }, API_COPY.readSiteFailed);
    },

    /** "Put my old design back": the site's design from before the switch (30 days). */
    async designRestore(): Promise<{ restored: boolean; outcome: PublishOutcome }> {
      const sessionId = getSessionId();
      if (!sessionId) throw userFacingError(API_COPY.noEarlierDesign);
      return siteCall(`/onboarding/design-restore/${sessionId}`, {}, API_COPY.restoreFailed, 150_000);
    },

    /** Whether the owner's plan is on now and how many fixes wait (read on the way back from Plans). */
    async siteFixesState(): Promise<{ plan: boolean; waiting: number } | null> {
      const sessionId = getSessionId();
      if (!sessionId) return null;
      const data = await transport.request<Body>({ method: 'GET', path: `/onboarding/site-fixes/${sessionId}` });
      return data?.success ? (data.data as { plan: boolean; waiting: number }) : null;
    },

    /** GET /onboarding/site-session: the site's setup state (a WordPress site's token only). */
    async siteSession(): Promise<SiteOnboardingState> {
      const data = await transport.request<Body>({ method: 'GET', path: '/onboarding/site-session' });
      if (!data?.success || !data.data) {
        throw userFacingError(typeof data?.error === 'string' && data.error.trim() ? data.error : API_COPY.setupReadFailed);
      }
      return data.data as SiteOnboardingState;
    },

    /**
     * A site's session named by GET /onboarding/site-session (a reload during
     * its build or its publish): the calls go to it without a start, which
     * would open a new session once this one is done. A draft keeps its own.
     */
    adoptSession(sessionId: string): void {
      if (!draft && sessionId) siteSessionId = sessionId;
    },

    /** "Keep it as it is": the partly published site becomes the live business, its problems kept on record. */
    async keepAsIs(sessionId: string, instanceId: string): Promise<{ outcome: PublishOutcome; operatorsActivated: boolean }> {
      return post(`/onboarding/publish/${sessionId}/keep-as-is`, { instanceId });
    },

    /** The operator catalog (id/title/sigil/color/intro): the single source of
     *  truth for team labels; without it every operator shows as "Team member". */
    async operators(): Promise<Array<{ id: string; title: string; sigil: string; color: string; intro: string; introPicked?: string; introMet?: string }>> {
      const data = await transport.request<Body>({ method: 'GET', path: '/onboarding/operators' });
      return data?.data?.operators ?? [];
    },

    /** This week's researched venture ideas, as the api answered them (throws when it did not). */
    async weeklyInspirations(): Promise<{ ideas?: unknown; sources?: unknown; researchedAt?: unknown }> {
      const data = await transport.request<Body | { ideas?: unknown }>({ method: 'GET', path: '/onboarding/inspirations' });
      const d = data as { data?: unknown } | null | undefined;
      return ((d?.data ?? d ?? {}) as { ideas?: unknown; sources?: unknown; researchedAt?: unknown });
    },

    /** This week's researched venture ideas for the describe step (public, no session). */
    async inspirations(): Promise<{ ideas: InspirationIdea[]; sources: InspirationSource[] }> {
      try {
        const data = await transport.request<Body | { ideas?: unknown }>({ method: 'GET', path: '/onboarding/inspirations' });
        const raw = data as { data?: unknown } | null | undefined;
        const d = (raw?.data ?? raw ?? {}) as { ideas?: InspirationIdea[]; sources?: InspirationSource[] };
        return {
          ideas: Array.isArray(d.ideas) ? d.ideas : [],
          sources: Array.isArray(d.sources) ? d.sources.filter((s) => s?.uri) : [],
        };
      } catch {
        return { ideas: [], sources: [] };
      }
    },
  };
}

/** The wizard's api for one host (createOnboardingApi). */
export type OnboardingApi = ReturnType<typeof createOnboardingApi>;

/**
 * The build limit a refused publish carries: 402 with the fields every
 * refused build has (status 'build_limit' or 'payment_failed', text, fix),
 * when the account's plan refused the finish build. Null for any other error.
 */
export function publishBuildLimitOf(e: unknown): BuildLimit | null {
  const res = (e as { response?: { status?: unknown; data?: unknown } } | null)?.response;
  if (!res || res.status !== 402) return null;
  return buildLimitOf(res.data);
}
