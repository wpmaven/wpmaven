/**
 * What a publish says to the owner: the panel after a press (on /welcome and
 * /deploying in the dashboard, and on the wizard's success step in
 * WordPress), the check before it, and the homepage switch.
 *
 * A publish answers with what really reached the site (its outcome): complete,
 * partial (the site is up, some required parts are not there), blocked (the
 * site was checked first and nothing changed) or failed. Before, the page
 * built one sentence from the product counts and said "Your site is
 * published" to a store that had no store. Now every line here comes from the
 * outcome, and a partial publish is never called published: it says what did
 * not finish, with "Publish again" and "Keep it as it is".
 *
 * Plain functions, no React and no API client (the unit tests load this file
 * directly). The product's name goes through productName(), so a branded
 * address says the brand's name.
 */
import { localized } from '@yotako/webmaven-ui';
import { productName } from './productName';
import type {
  FrontSetting, LeftAlonePage, PublishCheck, PublishCounts, PublishFact, PublishOutcome, PublishProblem,
} from '../api/onboarding';

export const PUBLISH_COPY_EN = {
  /** A partial publish: the site is up, some required parts are not. Never "published". */
  partialHeadline: 'Some parts of your site did not finish. Fix what is listed, then publish again. Everything that reached your site stays there.',
  /** The required parts that did not reach the site. */
  partialList: 'What did not finish:',
  /** Parts the business works without (journal posts, the site icon, the logo). */
  warningsList: 'Smaller things that did not finish:',
  /** A partial site the owner kept: what it still lacks. */
  stillMissing: 'Still missing:',
  /** A publish that stopped or was blocked: what stopped it. */
  whatStopped: 'What stopped it:',
  /** The site was checked first and cannot take the business yet. */
  blockedHeadline: 'Your site needs a change before your business can go live on it. Nothing has changed on your site.',
  /** The last publish stopped (a store plugin that would not install, for one). */
  failedHeadline: 'Your last publish did not finish.',
  /** A publish that stopped, when the API sent no sentence of its own. */
  failedFallback: 'Publishing did not finish. Try again in a few minutes.',
  /** A complete publish whose every part reached the site. */
  completeHeadline: 'Everything reached your site.',
  /** The business is partly published on another of the owner's sites. */
  partialElsewhere: 'This business is partly published on another of your sites. Publish it again there, or keep it as it is, before you publish it somewhere else.',
  /** After "Keep it as it is". */
  keptAsIs: 'You kept your site as it is. You can add what is missing from your dashboard whenever you are ready.',
  publishAgain: 'Publish again',
  publishingAgain: 'Publishing again.',
  keepAsIs: 'Keep it as it is',
  tryAgain: 'Try again',
  checkAgain: 'Check again',
  cancel: 'Cancel',
  /** The site is being checked before Publish can be pressed. */
  checking: 'Checking your site first.',
  /** Beside a Publish button the check holds: what unlocks it. */
  blockedReason: 'Fix what is listed above, then check again.',
  /** Beside a Publish button with no site chosen. */
  chooseSite: 'Choose which business to publish first.',
  /** Non-blocking notes of the check. */
  goodToKnow: 'Good to know:',
  updateWordPress: 'Update WordPress for me',
  confirmUpdate: 'Back up and update',
  updatingWordPress: 'Backing up your site, then updating WordPress. This can take a few minutes.',
  /** The homepage switch, once pressed. */
  useNewHomepage: 'Use the new homepage',
  putOldBack: 'Put the old one back',
  frontSwitched: 'Done. Visitors now land on your new homepage.',
  /** Asking for contact facts the build left empty instead of inventing them. */
  factsLead: 'We left out contact details you have not given us, so nothing on your site is made up.',
  addDetails: 'Add your business details',
  /** On a site the owner already ran: their pages were kept. */
  ownPagesKept: 'Your own pages were kept.',
} as const;

/** The publish's fixed sentences in the page's language (namespace 'publish'). */
export const PUBLISH_COPY = localized(PUBLISH_COPY_EN, 'publish');

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The words of the sentences built below (counts, names and versions filled in), word for word. */
export const PUBLISH_SENTENCES_EN = {
  /** "a, b and c": the list's head and its last item. */
  and: (head: string, last: string) => `${head} and ${last}`,
  pages: (n: number) => count(n, 'page', 'pages'),
  products: (n: number) => count(n, 'product', 'products'),
  launchCodes: (n: number) => count(n, 'launch code', 'launch codes'),
  forms: (n: number) => count(n, 'form', 'forms'),
  journalPosts: (n: number) => count(n, 'journal post', 'journal posts'),
  onSiteNow: (list: string) => `On your site now: ${list}.`,
  withoutImage: (n: number) => (n === 1 ? '1 product is on your site without its photo.' : `${n} products are on your site without their photos.`),
  /** What a missing part is called in "Your business stays live without ...". */
  missingByCode: {
    product_image_missing: 'some product photos',
    product_failed: 'some products',
    coupon_failed: 'the launch code',
    form_failed: 'a form',
    page_failed: 'some pages',
    menu_failed: 'a menu',
    finalize_failed: 'its homepage and address settings',
    media_failed: 'some images',
    post_failed: 'some journal posts',
    site_icon_failed: 'the site icon',
    identity_failed: 'the logo',
    plugin_install_failed: 'the store',
    plugin_activation_failed: 'the store',
  } as Record<string, string>,
  missingByPart: {
    products: 'some products',
    coupon: 'the launch code',
    forms: 'a form',
    pages: 'some pages',
    menus: 'a menu',
    media: 'some images',
    front_page: 'its homepage setting',
    store: 'the store',
    plugin: 'the store',
    facts: 'some business details',
  } as Record<string, string>,
  partsListedAbove: 'the parts listed above',
  keepAsIsConfirm: (missing: string) => `Your business stays live without ${missing}. You can add them from your dashboard whenever you are ready.`,
  yourPage: (title: string) => `your page "${title}"`,
  anotherPage: 'another page',
  latestPosts: 'your latest posts',
  frontOffer: (where: string) => `Your new homepage is ready. Your site still opens on ${where}.`,
  frontRestored: (where: string) => `Your site opens on ${where} again.`,
  /** The contact facts, as "Add your ..." names them. */
  factNames: {
    phone: 'phone',
    email: 'email',
    address: 'address',
    hours: 'opening hours',
    social: 'social links',
  } as Record<PublishFact, string>,
  factsNudge: (list: string) => `Add your ${list} so visitors can reach you.`,
  /** WordPress's starter content, as the cleared line names it. */
  defaultNames: {
    hello_world: 'its sample post',
    sample_page: 'its sample page',
    privacy_draft: 'its draft privacy policy',
  } as Record<string, string>,
  privacyReplaced: 'your privacy policy took the place of its draft',
  defaultTrashed: (name: string) => `${name} went to the trash`,
  defaultRemoved: (name: string) => `${name} was removed`,
  defaultMadeWay: (name: string) => `${name} made way for your page`,
  defaultsCleared: (list: string) => `We cleared WordPress's starter content: ${list}.`,
  leftAloneLead: (product: string) => `Pages of yours the build left alone, with ${product}'s version saved as a draft next to each:`,
  leftAloneItem: (title: string, product: string, slug: string) => `${title} (kept); ${product}'s draft: ${slug}`,
  frontCheckNote: (where: string) => `Your site keeps opening on ${where} after this publish. You can switch to the new homepage in one click once it is live.`,
  updateFromTo: (from: string, to: string) => `updates WordPress ${from} to ${to}`,
  updateTo: (to: string) => `updates WordPress to ${to}`,
  updateLatest: 'updates WordPress to its latest version',
  updateConfirm: (product: string, what: string) => `${product} backs up your site first, then ${what}. Your site may show a short maintenance notice while WordPress updates. Nothing else on your site changes.`,
  alreadyUpToDate: 'WordPress was already up to date.',
  updatedTo: (to: string) => `WordPress is updated to ${to}. Your site was backed up first.`,
  updated: 'WordPress is updated. Your site was backed up first.',
  updateRefusedHosted: (product: string) => `${product} keeps WordPress up to date on the sites it hosts, so nothing changed here.`,
  backupFailed: 'We could not back up your site, so WordPress was not updated. Nothing changed. Try again in a few minutes.',
  updateFailed: 'The WordPress update did not finish. Your site was backed up first. Check that your site opens, then try again.',
  updateNotAllowed: 'WordPress on this site does not allow updates from outside. In WordPress, open Dashboard, then Updates, update WordPress there, then check again.',
  updateNotDone: 'WordPress was not updated. Try again in a few minutes.',
  /** The panel's own refusals. */
  frontNotChanged: 'Your homepage did not change. Try again in a minute.',
  notThrough: 'That did not go through. Try again in a minute.',
} as const;

/** The built sentences in the page's language (namespace 'publishSentences'). */
export const PUBLISH_SENTENCES = localized(PUBLISH_SENTENCES_EN, 'publishSentences');

/** "a", "a and b", "a, b and c". */
export function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return PUBLISH_SENTENCES.and(items.slice(0, -1).join(', '), items[items.length - 1]);
}

/** What is on the site now, from the outcome's counts ("On your site now: 7 pages, 6 products and 1 launch code."), or null. */
export function countsLine(counts: PublishCounts | null | undefined): string | null {
  if (!counts) return null;
  const items: string[] = [];
  const pages = counts.pages?.published ?? 0;
  const products = (counts.products?.created ?? 0) + (counts.products?.updated ?? 0);
  const codes = counts.coupons?.created ?? 0;
  const forms = counts.forms?.created ?? 0;
  const posts = counts.posts?.created ?? 0;
  if (pages > 0) items.push(PUBLISH_SENTENCES.pages(pages));
  if (products > 0) items.push(PUBLISH_SENTENCES.products(products));
  if (codes > 0) items.push(PUBLISH_SENTENCES.launchCodes(codes));
  if (forms > 0) items.push(PUBLISH_SENTENCES.forms(forms));
  if (posts > 0) items.push(PUBLISH_SENTENCES.journalPosts(posts));
  return items.length ? PUBLISH_SENTENCES.onSiteNow(listJoin(items)) : null;
}

/** Products that went up without their photo, said beside the count (the problem list says why). */
export function withoutImageLine(counts: PublishCounts | null | undefined): string | null {
  const n = counts?.products?.withoutImage ?? 0;
  if (n <= 0) return null;
  return PUBLISH_SENTENCES.withoutImage(n);
}

/** Only a complete publish, or a partial one the owner kept as it is, is a live business. */
export function outcomeIsLive(outcome: Pick<PublishOutcome, 'status' | 'acceptedAt'> | null | undefined): boolean {
  if (!outcome) return false;
  return outcome.status === 'complete' || (outcome.status === 'partial' && !!outcome.acceptedAt);
}

/** A partial publish the owner has not kept yet: its door stays open (Publish again, Keep it as it is). */
export function outcomeUnfinished(outcome: Pick<PublishOutcome, 'status' | 'acceptedAt'> | null | undefined): boolean {
  return !!outcome && outcome.status === 'partial' && !outcome.acceptedAt;
}

/** The problems a publish cannot count as finished with, and the ones it can. */
export function splitProblems(problems: PublishProblem[] | null | undefined): { required: PublishProblem[]; warnings: PublishProblem[] } {
  const list = Array.isArray(problems) ? problems.filter((p) => p && typeof p.message === 'string' && p.message.trim()) : [];
  return { required: list.filter((p) => p.required), warnings: list.filter((p) => !p.required) };
}

/** The problems a 422 publish_blocked or publish_failed answer carries (empty for any other error). */
export function publishProblemsOf(e: unknown): PublishProblem[] {
  const data = (e as { response?: { data?: { problems?: unknown } } } | null)?.response?.data;
  const list = data && Array.isArray(data.problems) ? data.problems : [];
  return list.filter((p): p is PublishProblem =>
    !!p && typeof p === 'object'
    && typeof (p as PublishProblem).code === 'string'
    && typeof (p as PublishProblem).message === 'string'
    && (p as PublishProblem).message.trim() !== '');
}

/** The API's own sentence on a refusal, when it sent one. */
function apiSentence(e: unknown): string | null {
  const sentence = (e as { response?: { data?: { error?: unknown } } } | null)?.response?.data?.error;
  return typeof sentence === 'string' && sentence.trim() ? sentence.trim() : null;
}

function apiCode(e: unknown): string | null {
  const code = (e as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * A publish the API stopped, in its own words (written for the owner, so shown
 * whole), with its problems: 'blocked' (the site was checked first, nothing
 * changed), 'failed' (it stopped), 'elsewhere' (partly published on another
 * site). Null for any other error.
 */
export function publishRefusalOf(e: unknown): { kind: 'blocked' | 'failed' | 'elsewhere'; message: string; problems: PublishProblem[] } | null {
  const code = apiCode(e);
  if (code === 'publish_blocked') return { kind: 'blocked', message: apiSentence(e) ?? PUBLISH_COPY.blockedHeadline, problems: publishProblemsOf(e) };
  if (code === 'publish_failed') return { kind: 'failed', message: apiSentence(e) ?? PUBLISH_COPY.failedFallback, problems: publishProblemsOf(e) };
  if (code === 'publish_partial_elsewhere') return { kind: 'elsewhere', message: apiSentence(e) ?? PUBLISH_COPY.partialElsewhere, problems: [] };
  return null;
}

/** The required parts that did not reach the site, named ("some product photos and the launch code"). */
export function missingParts(problems: PublishProblem[] | null | undefined): string {
  const names: string[] = [];
  const byCode = PUBLISH_SENTENCES.missingByCode;
  const byPart = PUBLISH_SENTENCES.missingByPart;
  for (const p of splitProblems(problems).required) {
    const name = byCode[p.code] ?? byPart[p.part] ?? PUBLISH_SENTENCES.partsListedAbove;
    if (!names.includes(name)) names.push(name);
  }
  return names.length ? listJoin(names) : PUBLISH_SENTENCES.partsListedAbove;
}

/** The confirmation of "Keep it as it is". */
export function keepAsIsConfirm(problems: PublishProblem[] | null | undefined): string {
  return PUBLISH_SENTENCES.keepAsIsConfirm(missingParts(problems));
}

/** Where the owner's site opens today: "your latest posts", or "your page "About us"". */
export function previousFrontName(previous: FrontSetting | null | undefined): string {
  if (previous?.showOnFront === 'page') {
    const title = previous.title?.trim();
    return title ? PUBLISH_SENTENCES.yourPage(title) : PUBLISH_SENTENCES.anotherPage;
  }
  return PUBLISH_SENTENCES.latestPosts;
}

/** The homepage offer on a site the owner already ran (their front page was kept). */
export function frontOfferText(previous: FrontSetting | null | undefined): string {
  return PUBLISH_SENTENCES.frontOffer(previousFrontName(previous));
}

/** After "Put the old one back". */
export function frontRestoredText(previous: FrontSetting | null | undefined): string {
  return PUBLISH_SENTENCES.frontRestored(previousFrontName(previous));
}

const FACT_ORDER: PublishFact[] = ['phone', 'email', 'address', 'hours', 'social'];

/** The ask for the contact facts the build left empty: "Add your phone, email and address so visitors can reach you." */
export function factsNudge(facts: PublishFact[] | null | undefined): string | null {
  const wanted = FACT_ORDER.filter((f) => (facts ?? []).includes(f));
  if (!wanted.length) return null;
  const names = PUBLISH_SENTENCES.factNames;
  return PUBLISH_SENTENCES.factsNudge(listJoin(wanted.map((f) => names[f])));
}

/** WordPress's starter content the build moved out of the way, in one sentence, or null. */
export function defaultsLine(defaults: PublishOutcome['defaultsReplaced'] | null | undefined): string | null {
  const items: string[] = [];
  const names = PUBLISH_SENTENCES.defaultNames;
  for (const d of defaults ?? []) {
    const name = names[d.kind];
    if (!name) continue;
    if (d.kind === 'privacy_draft' && d.action === 'replaced') items.push(PUBLISH_SENTENCES.privacyReplaced);
    else if (d.action === 'trashed') items.push(PUBLISH_SENTENCES.defaultTrashed(name));
    else if (d.action === 'deleted') items.push(PUBLISH_SENTENCES.defaultRemoved(name));
    else items.push(PUBLISH_SENTENCES.defaultMadeWay(name));
  }
  return items.length ? PUBLISH_SENTENCES.defaultsCleared(listJoin(items)) : null;
}

/** The pages of the owner's the build left alone, as the list's lead-in. */
export function leftAloneLead(): string {
  return PUBLISH_SENTENCES.leftAloneLead(productName());
}

/** One line of that list. */
export function leftAloneItem(p: LeftAlonePage): string {
  return PUBLISH_SENTENCES.leftAloneItem(p.theirs.title, productName(), p.draftSlug);
}

/** The check's blocking problems (required), or none. */
export function blockingProblems(check: PublishCheck | null | undefined): PublishProblem[] {
  return check ? splitProblems(check.problems).required : [];
}

/** True when a check came back and holds the Publish button (a check that says it is not ready holds it even without a reason). */
export function checkBlocks(check: PublishCheck | null | undefined): boolean {
  return !!check && (check.ready === false || blockingProblems(check).length > 0);
}

/** On a site the owner already runs, the check says the new homepage waits for their click. */
export function frontCheckNote(front: PublishCheck['front'] | null | undefined): string | null {
  if (!front || front.wouldSet) return null;
  const where = front.showOnFront === 'page'
    ? (front.pageOnFrontTitle?.trim() ? PUBLISH_SENTENCES.yourPage(front.pageOnFrontTitle.trim()) : PUBLISH_SENTENCES.anotherPage)
    : PUBLISH_SENTENCES.latestPosts;
  return PUBLISH_SENTENCES.frontCheckNote(where);
}

/**
 * Why the door's Publish button cannot be pressed, said beside it, or null:
 * no site chosen yet, or the site's check holds it (a check that is still
 * running or could not be made holds nothing: publishing checks again).
 */
export function doorBlocker(opts: { selected: boolean; check: PublishCheck | null | undefined }): string | null {
  if (!opts.selected) return PUBLISH_COPY.chooseSite;
  if (checkBlocks(opts.check)) return PUBLISH_COPY.blockedReason;
  return null;
}

/** "Update WordPress for me" is offered when a problem asks for it and the site can take the update. */
export function canOfferWordPressUpdate(check: PublishCheck | null | undefined): boolean {
  if (!check?.wordpress?.canUpdate) return false;
  return blockingProblems(check).some((p) => p.fix?.action === 'update_wordpress' || p.code === 'wp_too_old');
}

/** The confirmation of "Update WordPress for me": the backup first, what changes, the maintenance notice. */
export function wordPressUpdateConfirm(wordpress: PublishCheck['wordpress'] | null | undefined): string {
  const from = wordpress?.version?.trim();
  const to = wordpress?.updateTo?.trim();
  const what = from && to ? PUBLISH_SENTENCES.updateFromTo(from, to) : to ? PUBLISH_SENTENCES.updateTo(to) : PUBLISH_SENTENCES.updateLatest;
  return PUBLISH_SENTENCES.updateConfirm(productName(), what);
}

/** After the update answered. */
export function wordPressUpdateDone(r: { updated: boolean; to: string | null }): string {
  if (!r.updated) return PUBLISH_SENTENCES.alreadyUpToDate;
  return r.to ? PUBLISH_SENTENCES.updatedTo(r.to) : PUBLISH_SENTENCES.updated;
}

const UPDATE_REFUSALS: Record<string, () => string> = {
  update_refused_hosted: () => PUBLISH_SENTENCES.updateRefusedHosted(productName()),
  backup_failed: () => PUBLISH_SENTENCES.backupFailed,
  update_failed: () => PUBLISH_SENTENCES.updateFailed,
  not_allowed: () => PUBLISH_SENTENCES.updateNotAllowed,
};

/** Why the update did not run: the API's sentence when it sent one, ours for its code otherwise. */
export function wordPressUpdateError(e: unknown, fallback: string = PUBLISH_SENTENCES.updateNotDone): string {
  const sentence = apiSentence(e);
  const status = (e as { response?: { status?: number } } | null)?.response?.status ?? 0;
  if (sentence && status >= 400 && status < 500) return sentence;
  const code = apiCode(e);
  if (code && UPDATE_REFUSALS[code]) return UPDATE_REFUSALS[code]();
  return fallback;
}

/**
 * The outcome of an API older than the outcome (only the old fields): a
 * deployed answer reads as a complete publish, with what it said.
 */
export function legacyOutcome(
  r: {
    deployed: boolean;
    productsCreated?: number;
    productsSkipped?: number;
    productsFailed?: number;
    siteUrl: string | null;
    leftAlone?: LeftAlonePage[];
    storeCurrencyNote?: string | null;
  },
  instanceId: string,
  at = new Date().toISOString(),
): PublishOutcome {
  return {
    status: r.deployed ? 'complete' : 'failed',
    instanceId,
    siteUrl: r.siteUrl ?? null,
    at,
    counts: {
      pages: { published: 0, parked: 0, failed: 0 },
      products: { created: r.productsCreated ?? 0, updated: 0, parked: r.productsSkipped ?? 0, failed: r.productsFailed ?? 0, withoutImage: 0 },
      coupons: { created: 0, failed: 0 },
      forms: { created: 0, failed: 0 },
      posts: { created: 0, failed: 0 },
      media: { uploaded: 0, failed: 0 },
    },
    frontPage: { state: 'kept', designedPageId: null, previous: null },
    defaultsReplaced: [],
    factsLeftEmpty: [],
    leftAlone: r.leftAlone ?? [],
    storeCurrencyNote: typeof r.storeCurrencyNote === 'string' && r.storeCurrencyNote.trim() ? r.storeCurrencyNote.trim() : null,
    problems: [],
    canPublishAgain: !r.deployed,
  };
}
