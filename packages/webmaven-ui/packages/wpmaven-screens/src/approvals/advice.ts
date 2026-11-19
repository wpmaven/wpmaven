/**
 * An advice item in Waiting for you, for both apps: something the site check
 * (or a later look at the site) found that the team cannot fix on this site,
 * because there is no plan, the fix needs WPMaven Agent, or no tool can do it
 * yet. The row (toolName site_advice, kind 'advice' in the listings) carries
 * the advice: what to do in a sentence or two, and the steps in WordPress.
 *
 * "Done" (approve) and "Not for me" (reject) both just settle the item:
 * nothing runs on the site either way, and neither counts as one of the
 * plan's actions. So the card has no preview, no Action details and no
 * approve of a change.
 *
 * The one runtime import is the product's name (the brand's on a branded
 * address), so the node tests still load it directly.
 */
import { productName } from '@yotako/wpmaven-onboarding/shared';
import type { OperatorApproval } from './types';
import type { Receipt } from './receipts';

/** The tool name of an advice row. */
export const SITE_ADVICE_TOOL = 'site_advice';

/** What would let the team do it: a plan, WPMaven Agent, both, or no tool can (yet). */
export type AdviceReason = 'plan' | 'agent' | 'agent_and_plan' | 'no_tool';

/** An advice row's words, read from its params. */
export interface ApprovalAdvice {
  findingId: string | null;
  title: string;
  area: string | null;
  /** One or two sentences: what to do. */
  summary: string;
  /** Short lines, each saying where in WordPress. */
  steps: string[];
  reason: AdviceReason | null;
}

export const ADVICE_COPY = {
  /** Its title when the row has none. */
  title: 'A recommendation for your site',
  done: 'Done',
  notForMe: 'Not for me',
  stepsLabel: 'How to do it',
  /** "With WPMaven Agent and a plan, ...": the product's Agent. */
  get quietAgent(): string {
    return `With ${productName()} Agent and a plan, your team does this for you.`;
  },
  quietPlan: 'With a plan, your team does this for you.',
  /** A site's view, for a person the API says may not decide it (and sent no sentence of its own). */
  ownerOnly: "Only the account's owner decides this.",
  doneReceipt: 'Marked as done.',
  notForMeReceipt: 'Taken off your list.',
} as const;

const REASONS: readonly AdviceReason[] = ['plan', 'agent', 'agent_and_plan', 'no_tool'];

/** An advice row (the listings' kind 'advice', or its tool name from a view that does not say the kind). */
export function isAdviceApproval(a: Pick<OperatorApproval, 'toolName'> & { kind?: unknown } | null | undefined): boolean {
  return !!a && (a.kind === 'advice' || a.toolName === SITE_ADVICE_TOOL);
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The advice an advice row carries, read safely (anything malformed is left out); null for any other row. */
export function adviceOf(a: Pick<OperatorApproval, 'toolName' | 'params'> & { kind?: unknown } | null | undefined): ApprovalAdvice | null {
  if (!a || !isAdviceApproval(a)) return null;
  const p = a.params && typeof a.params === 'object' && !Array.isArray(a.params) ? a.params : {};
  const advice = p.advice && typeof p.advice === 'object' && !Array.isArray(p.advice) ? p.advice as Record<string, unknown> : {};
  const steps = Array.isArray(advice.steps) ? advice.steps.map(text).filter(Boolean) : [];
  const reason = REASONS.includes(p.reason as AdviceReason) ? p.reason as AdviceReason : null;
  return {
    findingId: text(p.findingId) || null,
    title: text(p.title) || ADVICE_COPY.title,
    area: text(p.area) || null,
    summary: text(advice.summary),
    steps,
    reason,
  };
}

/** The one quiet line an advice item says by its reason: Agent and a plan, a plan, or nothing. */
export function adviceQuietLine(reason: AdviceReason | null | undefined): string | null {
  if (reason === 'agent' || reason === 'agent_and_plan') return ADVICE_COPY.quietAgent;
  if (reason === 'plan') return ADVICE_COPY.quietPlan;
  return null;
}

/** What the owner is told where the item was, after "Done" or "Not for me". */
export function adviceReceipt(id: string, done: boolean): Receipt {
  return done
    ? { id, message: ADVICE_COPY.doneReceipt, tone: 'done' }
    : { id, message: ADVICE_COPY.notForMeReceipt, tone: 'neutral' };
}
