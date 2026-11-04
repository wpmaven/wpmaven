/**
 * "Your business" and "What your team fixes" (Keep my site as it is, Fix and
 * improve my site): the words, the business as the site shows it, and the
 * findings each step lists. Pure, so each host's tests read the same lines.
 */
import { localized } from '@yotako/webmaven-ui';
import type { SiteCheckFinding } from '../../../../api/onboarding';
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

/** The findings the team fixes once the owner says yes (ticked by default), and those that need the owner. Pure. */
export function fixLists(findings: SiteCheckFinding[]): { team: SiteCheckFinding[]; withYou: SiteCheckFinding[] } {
  const open = findings.filter((f) => f.level !== 'ok');
  return { team: open.filter((f) => f.handledBy === 'team'), withYou: open.filter((f) => f.handledBy === 'with_you') };
}
