/**
 * Guidance: the rules that keep every next move obvious.
 *
 *  - Every answer that leads to an action carries a direct button to the
 *    exact screen where it is taken (NextStep, drawn by NextStepButtons).
 *  - Every disabled button says next to it what unlocks it (WhyDisabled).
 *  - A confirmation shows where the owner acted, not only at the top.
 *
 * The API computes the next steps from facts; this file only reads them, and refuses any
 * link that is not a path inside the dashboard.
 *
 * One runtime import: webmaven-ui's language helper (the sentences read in
 * the page's language, namespace 'guidance').
 */
import { localized } from '@yotako/webmaven-ui';

/** The sentences of this file, word for word. */
export const GUIDANCE_EN = {
  openInApprovals: 'Open it in Approvals',
  whatsappNumberAndBox: 'Enter your WhatsApp number and tick the box below to continue.',
  whatsappNumber: 'Enter your WhatsApp number first.',
  whatsappBox: 'Tick the box below to agree to WhatsApp messages.',
  /** The holder fields a domain registration needs, in the owner's words. */
  domainFields: {
    firstName: 'first name',
    lastName: 'last name',
    email: 'email',
    address1: 'street address',
    city: 'city',
    country: 'country',
    phoneCountryCode: 'phone country code',
    phoneNumber: 'phone number',
  } as Record<string, string>,
  fillHolder: (fields: string) => `Fill in the holder's ${fields}.`,
  termsLoading: 'The price and terms are still loading. This unlocks when they arrive.',
  tickBoth: 'Tick both boxes above to confirm.',
  tickBox: 'Tick the box above to confirm the details and the terms.',
  tickSecond: 'Tick the second box above to confirm.',
} as const;

/** Those sentences in the page's language. */
export const GUIDANCE = localized(GUIDANCE_EN, 'guidance');

/** One button under an answer: the action in plain words and where it is taken. */
export interface NextStep {
  label: string;
  /** A dashboard path, always "/...". */
  href: string;
  kind?: string;
  /** The one action to take now: the primary button. */
  primary?: boolean;
}

/** A path inside the dashboard: "/..." and nothing that could leave the app or run script. */
export function isDashboardPath(href: unknown): href is string {
  return typeof href === 'string'
    && href.startsWith('/')
    && !href.startsWith('//')
    && !href.includes('\\')
    // eslint-disable-next-line no-control-regex
    && !/[\u0000-\u001f]/.test(href);
}

const MAX_STEPS = 3;
const MAX_LABEL = 60;

/** One step from the API, or null when it is not one the dashboard may follow. */
export function sanitizeNextStep(raw: unknown): NextStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isDashboardPath(r.href)) return null;
  const label = typeof r.label === 'string' ? r.label.replace(/\s+/g, ' ').trim() : '';
  if (!label) return null;
  return {
    label: label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label,
    href: r.href,
    ...(typeof r.kind === 'string' ? { kind: r.kind } : {}),
    ...(r.primary === true ? { primary: true } : {}),
  };
}

/**
 * The steps from the API, cleaned: only dashboard paths, no duplicates, at
 * most three, and exactly one primary (the first, when the API marked none).
 */
export function sanitizeNextSteps(raw: unknown): NextStep[] {
  if (!Array.isArray(raw)) return [];
  const out: NextStep[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const s = sanitizeNextStep(item);
    if (!s || seen.has(s.href)) continue;
    seen.add(s.href);
    out.push(s);
    if (out.length >= MAX_STEPS) break;
  }
  const primaryAt = out.findIndex((s) => s.primary);
  return out.map((s, i) => {
    const { primary: _drop, ...rest } = s;
    return i === (primaryAt >= 0 ? primaryAt : 0) ? { ...rest, primary: true } : rest;
  });
}

/** Where one approval's card is on Your team > Approvals. Same as targets.approvalPath. */
function approvalHref(id: string): string {
  return `/team?tab=approvals&approval=${encodeURIComponent(id)}`;
}

/**
 * The button on a notification: the server's `nextStep` when it sent one, and
 * for an older API the one fact every approval notification carries, its id.
 */
export function notificationStep(n: { nextStep?: unknown; data?: unknown }): NextStep | null {
  const server = sanitizeNextStep(n.nextStep);
  if (server) return { ...server, primary: true };
  const d = n.data && typeof n.data === 'object' ? (n.data as Record<string, unknown>) : null;
  if (d && typeof d.approvalId === 'string' && d.approvalId
    && (d.kind === 'operator_approval' || d.kind === 'operator_approval_tiktok')) {
    return { label: GUIDANCE.openInApprovals, href: approvalHref(d.approvalId), kind: 'approval', primary: true };
  }
  return null;
}

// ── More actions ─────────────────────────────────────────────────────────

/** Billing, scrolled to "Need more actions?" (the pack button). */
export const MORE_ACTIONS_STEP: NextStep = { label: 'Get more actions', href: '/billing#more-actions', kind: 'actions', primary: true };

/** Billing itself: right whether or not a pack is for sale (the $1 week sells none). */
export const BILLING_STEP: NextStep = { label: 'Open Billing', href: '/billing', kind: 'billing', primary: true };

/**
 * The way to more actions for an approval held for them (approved, waiting:
 * NEEDS_ACTIONS): the API's own step when it sent one (the pack when one is
 * for sale, else "Open Billing", the held notice's button), and `fallback`
 * otherwise: the pack, as the held notice did before the API said which.
 */
export function heldNextStep(fromApi: unknown, fallback: NextStep = MORE_ACTIONS_STEP): NextStep {
  const s = sanitizeNextStep(fromApi);
  return s ? { ...s, primary: true } : fallback;
}

/**
 * The way to more actions on a card the allowance stopped. A held row
 * (NEEDS_ACTIONS) from an API that sent no step gets the pack, as before.
 * An older row filed FAILED gets the API's step (it sends one now), and
 * Billing when it sent none: the pack was offered there even when no pack
 * was for sale.
 */
export function cardMoreActionsStep(approval: { status: string; nextStep?: unknown }): NextStep {
  return heldNextStep(approval.nextStep, approval.status === 'FAILED' ? BILLING_STEP : MORE_ACTIONS_STEP);
}

// ── Moving the owner to the right place ──────────────────────────────────

/**
 * Whether a card a link points at takes the scroll and the focus when it
 * mounts. Not while the guided tour is up: the tour opens the same link for
 * its Post to TikTok stop, scrolls to the picker itself and keeps the focus
 * on its own Next button, and the card taking the focus left Enter and the
 * screen reader on the page behind the tour.
 */
export function linkedCardTakesFocus(focused: boolean, tourOpen: boolean): boolean {
  return focused && !tourOpen;
}

/** Smooth scrolling, unless the owner asked their system for less motion. */
export function scrollBehavior(): ScrollBehavior {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'auto';
  } catch { /* no matchMedia */ }
  return 'smooth';
}

/**
 * Scroll an element into view and give it the keyboard focus, so a screen
 * reader and a keyboard land where the eye is sent.
 */
export function bringIntoView(el: HTMLElement | null | undefined, block: ScrollLogicalPosition = 'center'): boolean {
  if (!el) return false;
  try { el.scrollIntoView({ behavior: scrollBehavior(), block }); } catch { /* old browsers */ }
  try { el.focus({ preventScroll: true }); } catch { /* not focusable */ }
  return true;
}

// ── What unlocks a disabled button (shared sentences) ────────────────────

/**
 * Why "Send confirmation" (link WhatsApp) cannot be pressed yet. The consent
 * box sits under the button, so the sentence says where it is.
 */
export function whatsappSendBlocker(phone: string, consent: boolean): string | null {
  const hasPhone = phone.trim().length > 0;
  if (!hasPhone && !consent) return GUIDANCE.whatsappNumberAndBox;
  if (!hasPhone) return GUIDANCE.whatsappNumber;
  if (!consent) return GUIDANCE.whatsappBox;
  return null;
}

/** The holder fields a domain registration needs, in order (their names: GUIDANCE.domainFields). */
const DOMAIN_FIELDS: string[] = ['firstName', 'lastName', 'email', 'address1', 'city', 'country', 'phoneCountryCode', 'phoneNumber'];

/**
 * Why "Register" / "Pay and register" cannot be pressed yet: the empty holder
 * fields by name, then the two boxes, then terms that have not loaded.
 */
export function domainRegisterBlocker(s: {
  form: Record<string, string | undefined>;
  agreed: boolean;
  acknowledged: boolean;
  /** The second box is only there when the API sent purchase terms. */
  hasAckBox: boolean;
  termsReady: boolean;
}): string | null {
  const names = GUIDANCE.domainFields;
  const missing = DOMAIN_FIELDS.filter((k) => !String(s.form[k] ?? '').trim()).map((k) => names[k]);
  if (missing.length) return GUIDANCE.fillHolder(missing.join(', '));
  if (!s.termsReady) return GUIDANCE.termsLoading;
  if (!s.agreed && s.hasAckBox && !s.acknowledged) return GUIDANCE.tickBoth;
  if (!s.agreed) return GUIDANCE.tickBox;
  if (s.hasAckBox && !s.acknowledged) return GUIDANCE.tickSecond;
  return null;
}
