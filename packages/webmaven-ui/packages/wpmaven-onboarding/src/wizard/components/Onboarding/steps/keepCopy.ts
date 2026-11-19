/**
 * "Your business" and "What your team fixes" (Keep my site as it is, Fix and
 * improve my site): the words, the business as the site shows it, and the
 * findings each step lists. Pure, so each host's tests read the same lines.
 */
import { localized } from '@yotako/webmaven-ui';
import type { AdviceReason, SiteCheckFinding } from '../../../../api/onboarding';
import type { SiteProfile, WizardSite } from '../../../../host/types';

export const KEEP_COPY_EN = {
  businessEyebrow: 'Your business',
  businessTitle: 'Your business, from your site',
  hint: 'We filled this from your site. Change anything that is wrong.',
  fields: { name: 'Name', summary: 'What you do', phone: 'Phone', email: 'Email', address: 'Address', store: 'You sell online' },
  save: 'Save my business',
  saving: 'Saving your business…',
  back: 'Back to your check',
  keptDone: 'Your business is set up. Your team works on your site from today.',
  fixesEyebrow: 'Your fixes',
  fixesTitle: 'What your team fixes',
  withYou: 'These need you. Your team guides you through each one.',
  withPlan: 'Your team starts now. Each change waits for your yes in Waiting for you.',
  startFixing: 'Start fixing these',
  startPlan: 'Start my plan to fix these',
  notNow: 'Not now',
  saved: 'Your list is saved in Waiting for you. Start your plan when you are ready.',
  waitingPlan: 'Your plans page is open in a new tab. Once your plan is on, your team starts here.',
  nothingTicked: 'Tick at least one, or choose Not now.',
  open: (productName: string) => `Open ${productName}`,
  /** "What we recommend": the check's findings the owner does, when the team can fix none of them on this site. */
  adviceEyebrow: 'Your recommendations',
  /** Files the recommendations as Waiting for you items, each with its steps, and opens the app. */
  seeInWaiting: 'See them in Waiting for you',
  /** Under the recommendations, once, when the product's Agent and a plan would let the team do them ("With WPMaven Agent and a plan, ..."). */
  quietAgent: (productName: string) => `With ${productName} Agent and a plan, your team does this for you.`,
  /** Under the recommendations, once, when a plan alone would let the team do them. */
  quietPlan: 'With a plan, your team does this for you.',
} as const;

/** "Your business" and "What your team fixes" in the page's language (KEEP_COPY_EN; French in src/i18n, namespace 'keep'). */
export const KEEP_COPY = localized(KEEP_COPY_EN, 'keep');

/** "Open WPMaven", in the brand's name. Pure. */
export function openLabel(productName: string): string {
  return KEEP_COPY.open(productName);
}

export interface KeepValues {
  name: string;
  summary: string;
  phone: string;
  email: string;
  address: string;
  store: boolean;
}

/** "Your business" as the site shows it: its name, its tagline, a store when it sells. Pure. */
export function keptDefaults(site: Pick<WizardSite, 'name'> | null | undefined, profile: Pick<SiteProfile, 'kind' | 'store' | 'identity' | 'content'> | null): KeepValues {
  return {
    name: (site?.name ?? '').trim(),
    summary: (profile?.identity.tagline ?? '').trim(),
    phone: '',
    email: '',
    address: '',
    store: !!profile && (profile.kind === 'store' || (!!profile.store && profile.content.products > 0)),
  };
}

/** The kind of business the team runs: a store, a blog (mostly posts), or a business. Pure. */
export function keptSiteType(values: Pick<KeepValues, 'store'>, profile: Pick<SiteProfile, 'content'> | null): 'ecommerce' | 'blog' | 'business' {
  if (values.store) return 'ecommerce';
  const c = profile?.content;
  return c && c.posts >= 5 && c.posts > c.pages ? 'blog' : 'business';
}

/**
 * Whether the team fixes this finding on this site: the api's fixMode, and,
 * from an older api that sends none, who handles it. Pure.
 */
export function teamFixes(f: Pick<SiteCheckFinding, 'handledBy' | 'fixMode'>): boolean {
  return f.handledBy === 'team' && f.fixMode !== 'advice';
}

/**
 * The findings the team fixes once the owner says yes (ticked by default),
 * and those that need the owner: the guidance they always were, and every fix
 * the team can only advise on here (no plan, or one that needs WPMaven
 * Agent). A feature that keeps something right from today is in neither. Pure.
 */
export function fixLists(findings: SiteCheckFinding[]): { team: SiteCheckFinding[]; withYou: SiteCheckFinding[] } {
  const open = findings.filter((f) => f.level !== 'ok' && f.handledBy !== 'kept');
  return {
    team: open.filter(teamFixes),
    withYou: open.filter((f) => !teamFixes(f) && (f.handledBy === 'with_you' || f.fixMode === 'advice')),
  };
}

/**
 * The step is the list of recommendations: the api says how each finding is
 * handled on this site, the team can fix none of them, and some need the
 * owner. An older api, or a check with team fixes, keeps the step as it was. Pure.
 */
export function recommendsOnly(findings: SiteCheckFinding[]): boolean {
  const { team, withYou } = fixLists(findings);
  return team.length === 0 && withYou.length > 0 && findings.some((f) => f.fixMode !== undefined);
}

/** Some findings are advice to file as Waiting for you items with their steps. Pure. */
export function hasAdvice(findings: SiteCheckFinding[]): boolean {
  return fixLists(findings).withYou.some((f) => f.fixMode === 'advice');
}

/** The line under a finding's title: its advice in one or two sentences, else "What happens". Pure. */
export function findingLine(f: Pick<SiteCheckFinding, 'advice' | 'happens'>): string | null {
  const summary = typeof f.advice?.summary === 'string' ? f.advice.summary.trim() : '';
  return summary || f.happens?.trim() || null;
}

/**
 * What would let the team do the recommendations, said once under them: the
 * product's Agent and a plan when any needs Agent, else a plan when any needs
 * one, else nothing (no tool can do it yet). Pure.
 */
export function quietLine(findings: Array<{ adviceReason?: AdviceReason }>, productName: string): string | null {
  const reasons = findings.map((f) => f.adviceReason);
  if (reasons.some((r) => r === 'agent' || r === 'agent_and_plan')) return KEEP_COPY.quietAgent(productName);
  if (reasons.includes('plan')) return KEEP_COPY.quietPlan;
  return null;
}
