import { createContext, useContext } from 'react';
import { siteChatDashboardUrl } from './siteChat';

/**
 * What this site's business is, as the account says (GET /sites/me, kept by
 * the plugin's WebMaven_Site_State and handed over as
 * WEBMAVEN_WP_DATA.siteState, then refreshed by every /status read).
 *
 * The app decides from it, never from a local guess: whether the setup card
 * shows, the owner's next step and its link, and which screens may run. A
 * screen whose flag is false makes no call at all: it is hidden, or becomes
 * a link to the dashboard page that does the job. The account lights each
 * one up per site, without a plugin release.
 */

export type SiteFeature =
  | 'chat' | 'editorAI' | 'edits' | 'store'
  | 'reports' | 'notifications' | 'tasks' | 'analytics'
  | 'finance' | 'payments' | 'social' | 'approvals'
  | 'parity' | 'health' | 'activity'
  // The screens shared with the dashboard (1.7.0): Waiting for you with every
  // kind of approval, the store changes the team prepared, the alerts worth
  // fixing, the customers to answer, and Your team with the business's whole
  // plan, its progress and its milestones.
  | 'approvalsAll' | 'storeApprovals' | 'alerts' | 'customerReplies' | 'teamPlan'
  // Overview's side column, the dashboard Home's right column (1.7.0): the
  // site's screenshot, Turn on a way to get paid, Check what your site says
  // about you, the referral link a share carries, Feature on WPMaven.
  | 'sitePreview' | 'getPaid' | 'businessDetails' | 'referrals' | 'featureOnWpmaven'
  // The actions behind some of the chat's prompt chips (the kit's suggestions, chat/chatSiteFacts.ts).
  | 'campaigns' | 'seoAudit' | 'altText' | 'pageRedesign'
  // The editor's chat led by the Web Designer, who asks the Co-CEO when it
  // needs to (1.8.0; off again with the server's switch).
  | 'editorDesigner'
  // The editor's Search panel makes a picture for sharing a page (1.8.0).
  | 'shareImage'
  // The editor's Add a page shows its More options: the page it goes under,
  // published or a draft, a page to look like, its search details (1.8.0).
  | 'addPageOptions';

export const SITE_FEATURES: readonly SiteFeature[] = [
  'chat', 'editorAI', 'edits', 'store',
  'reports', 'notifications', 'tasks', 'analytics',
  'finance', 'payments', 'social', 'approvals',
  'parity', 'health', 'activity',
  'approvalsAll', 'storeApprovals', 'alerts', 'customerReplies', 'teamPlan',
  'sitePreview', 'getPaid', 'businessDetails', 'referrals', 'featureOnWpmaven',
  'campaigns', 'seoAudit', 'altText', 'pageRedesign',
  'editorDesigner',
  'shareImage',
  'addPageOptions',
];

export type Onboarding = 'completed' | 'skipped' | 'needed' | 'unknown';

/** One step of a publish running here, in the owner's words. */
export interface BuildStep {
  id: string;
  label: string;
  state: 'done' | 'running' | 'todo';
}

export interface BuildProgress {
  stage: string;
  stageAt: string | null;
  steps: BuildStep[];
}

/** The steps the account sent, or null when they are missing or unreadable. Pure. */
export function buildProgressOf(raw: unknown): BuildProgress | null {
  if (!isObj(raw) || !Array.isArray(raw.steps)) return null;
  const steps = raw.steps
    .filter((s: unknown): s is Record<string, unknown> => isObj(s) && typeof s.id === 'string' && typeof s.label === 'string')
    .map((s) => ({ id: s.id as string, label: s.label as string, state: (s.state === 'done' || s.state === 'running' ? s.state : 'todo') as BuildStep['state'] }));
  if (!steps.length) return null;
  return { stage: typeof raw.stage === 'string' ? raw.stage : '', stageAt: typeof raw.stageAt === 'string' ? raw.stageAt : null, steps };
}

export interface SiteState {
  /** False until the account answered once (no state never blocks anything). */
  known: boolean;
  version: number;
  onboarding: Onboarding;
  setupNeeded: boolean;
  /** thumbnailUrl: the site's screenshot (a signed https address, as the dashboard shows it), or null. */
  instance: { id: string; siteName: string; siteUrl: string; status: string; paused: boolean; thumbnailUrl: string | null } | null;
  /** The WPMaven account holder's name (administrators only; never an email). */
  account: { firstName: string | null; lastName: string | null };
  onboardingCompleted: boolean;
  onboardingSkipped: boolean;
  business: { name: string; sessionId: string | null; builtByWpmaven: boolean; engine: 'genstudio' | 'legacy' | null; store: boolean; origin: 'designed' | 'kept'; fixesToChoose: boolean } | null;
  /**
   * The owner's saved business that can still go live here, and the steps of
   * its publish while it runs here (the API's buildStage; null otherwise).
   */
  draft: { name: string; sessionId: string; publishingHere: boolean; buildProgress: BuildProgress | null } | null;
  lastPublish: { state: 'complete' | 'partial' | 'blocked' | 'failed'; at: string; problems: Array<{ code: string; message: string }> } | null;
  plan: { code: string; name: string; status: string } | null;
  payments: { wpmaven: 'none' | 'pending' | 'active'; needsAction: boolean; available: boolean };
  whatsappLinked: boolean;
  dashboardUrl: string;
  links: { business: string | null; create: string | null; publish: string | null; installAgent: string | null; getPaid: string | null };
  next: 'publish' | 'create' | 'get_paid' | null;
  features: Record<SiteFeature, boolean>;
  policyVersion: number;
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null);
const httpUrl = (v: unknown): string | null => (typeof v === 'string' && /^https?:\/\/[^\s"'<>]+$/.test(v) ? v : null);

/** Any value as a site state: the shape always complete, unknown parts empty. */
export function normalizeSiteState(raw: unknown): SiteState {
  const r = isObj(raw) ? raw : {};
  const features = Object.fromEntries(SITE_FEATURES.map((f) => [f, isObj(r.features) && r.features[f] === true])) as Record<SiteFeature, boolean>;
  const inst = isObj(r.instance) ? r.instance : null;
  const business = isObj(r.business) && str(r.business.name) ? r.business : null;
  const draft = isObj(r.draft) && str(r.draft.name) && str(r.draft.sessionId) ? r.draft : null;
  const last = isObj(r.lastPublish) ? r.lastPublish : null;
  const lastState = last ? oneOf(last.state, ['complete', 'partial', 'blocked', 'failed'] as const) : null;
  const links = isObj(r.links) ? r.links : {};
  return {
    known: r.known === true,
    version: typeof r.version === 'number' ? r.version : 0,
    onboarding: oneOf(r.onboarding, ['completed', 'skipped', 'needed', 'unknown'] as const) ?? 'unknown',
    setupNeeded: r.setupNeeded === true,
    instance: inst && str(inst.id)
      ? {
        id: inst.id,
        siteName: str(inst.siteName) ?? '',
        siteUrl: str(inst.siteUrl) ?? '',
        status: str(inst.status) ?? '',
        paused: inst.paused === true,
        thumbnailUrl: typeof inst.thumbnailUrl === 'string' && /^https:\/\/[^\s"'<>]+$/.test(inst.thumbnailUrl) ? inst.thumbnailUrl : null,
      }
      : null,
    account: { firstName: isObj(r.account) ? str(r.account.firstName) : null, lastName: isObj(r.account) ? str(r.account.lastName) : null },
    onboardingCompleted: r.onboardingCompleted === true,
    onboardingSkipped: r.onboardingSkipped === true,
    business: business
      ? {
        name: business.name,
        sessionId: str(business.sessionId),
        builtByWpmaven: business.builtByWpmaven === true,
        engine: oneOf(business.engine, ['genstudio', 'legacy'] as const),
        store: business.store === true,
        // kept: the owner's own site, kept as it was (no build behind it).
        origin: business.origin === 'kept' ? 'kept' : 'designed',
        // Kept by Fix and improve, its fixes not chosen yet: the setup wizard opens on them.
        fixesToChoose: business.fixesToChoose === true,
      }
      : null,
    draft: draft
      ? { name: draft.name, sessionId: draft.sessionId, publishingHere: draft.publishingHere === true, buildProgress: buildProgressOf(draft.buildProgress) }
      : null,
    lastPublish: last && lastState && str(last.at)
      ? {
        state: lastState,
        at: last.at,
        problems: (Array.isArray(last.problems) ? last.problems : [])
          .filter((p: unknown) => isObj(p) && str(p.code) && str(p.message))
          .map((p: any) => ({ code: p.code, message: p.message })),
      }
      : null,
    plan: isObj(r.plan) && str(r.plan.name) ? { code: str(r.plan.code) ?? '', name: r.plan.name, status: str(r.plan.status) ?? '' } : null,
    payments: {
      wpmaven: oneOf(isObj(r.payments) ? r.payments.wpmaven : null, ['none', 'pending', 'active'] as const) ?? 'none',
      needsAction: isObj(r.payments) && r.payments.needsAction === true,
      available: isObj(r.payments) && r.payments.available === true,
    },
    whatsappLinked: r.whatsappLinked === true,
    dashboardUrl: httpUrl(r.dashboardUrl) ?? '',
    links: {
      business: httpUrl(links.business),
      create: httpUrl(links.create),
      publish: httpUrl(links.publish),
      installAgent: httpUrl(links.installAgent),
      getPaid: httpUrl(links.getPaid),
    },
    next: oneOf(r.next, ['publish', 'create', 'get_paid'] as const),
    features,
    policyVersion: typeof r.policyVersion === 'number' ? r.policyVersion : 1,
  };
}

function wpData(): any {
  return (typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA : null) || {};
}

/** The state the page was drawn with (WEBMAVEN_WP_DATA.siteState). */
export function initialSiteState(): SiteState {
  return normalizeSiteState(wpData().siteState);
}

/** AuthProvider keeps the current state here; outside it, the page's own. */
export const SiteStateContext = createContext<SiteState | null>(null);

export function useSiteState(): SiteState {
  return useContext(SiteStateContext) ?? initialSiteState();
}

/** Whether the account lets this site show a screen. */
export function hasFeature(state: SiteState, name: SiteFeature): boolean {
  return state.features[name] === true;
}

/** A page of the dashboard: on the brand's live address under White label, else ours. */
export function dashboardLink(state: SiteState, path: string): string {
  const base = (state.dashboardUrl || siteChatDashboardUrl()).replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export interface WpAdminLink {
  key: string;
  label: string;
  url: string;
}

/** WordPress's own screens this user may open (WEBMAVEN_WP_DATA.wpAdminLinks, built from capabilities). */
export function wpAdminLinks(): WpAdminLink[] {
  const raw = wpData().wpAdminLinks;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l: unknown) => isObj(l) && str(l.key) && str(l.label) && httpUrl(l.url))
    .map((l: any) => ({ key: l.key, label: l.label, url: l.url }));
}
