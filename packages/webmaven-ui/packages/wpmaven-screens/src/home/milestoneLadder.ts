/**
 * The business's milestones, from VERIFIED state only: steps are ticked
 * exactly when they really happened (endowed progress with genuine
 * endowment, never fake ticks). Drawn on Home, and on the plugin's Overview,
 * by MilestoneChecklist.
 */

export interface MilestoneInputs {
  /** true/false = verified; null = the source did not answer, so the step is
   *  HIDDEN rather than shown regressed (verified-state-only doctrine). */
  businessLive: boolean | null;
  /** A channel a post can really go out on (the API's `postable`). */
  channelsConnected: boolean | null;
  /** Some channel is connected, posting or not. Tells "connect one" apart
   *  from "the ones you connected cannot take posts yet". */
  anyChannelConnected?: boolean | null;
  firstPostPublished: boolean | null;
  /** A post to the business's channels waits for the owner's yes (the
   *  launch post, usually): the first post is theirs to approve. */
  firstPostWaiting?: boolean | null;
  orderCount: number | null; // null = unknown (endpoint unavailable)
}

/** Which step of the ladder: the rung a step's buttons belong to. */
export type StepKey = 'live' | 'channels' | 'post' | 'order' | 'orders10' | 'orders100';

interface Step { key: StepKey; label: string; done: boolean }

/** The picture on a milestone's button, which carries it alone on a narrow row. */
export type MilestoneIcon = 'publish' | 'connect' | 'approve' | 'ask' | 'share' | 'promotion';

interface ActionLook {
  label: string;
  /** The label in a word, part of it, for a row with little room. */
  short: string;
  icon: MilestoneIcon;
}

/**
 * What a milestone's button does, as data (the checklist wires it): open a
 * page (`to`), put a request in the Co-CEO's box for the owner to send
 * (`ask`), or share the business's site (`share`).
 */
export type MilestoneAction =
  | (ActionLook & { to: string })
  | (ActionLook & { ask: string })
  /** `copyLabel` and `copyShort` where the browser has no share sheet and the share is a copy. */
  | (ActionLook & { share: 'site'; copyLabel: string; copyShort: string });

/** The requests the milestones put in the Co-CEO's box. Never sent for the owner. */
export const MILESTONE_ASKS = {
  firstPost: 'Prepare my first post to announce the business.',
  firstOrder: 'Plan a promotion to get my first order.',
  first10: 'Plan a promotion to get my first 10 orders.',
  first100: 'Plan a promotion to reach 100 orders.',
} as const;

export function deriveMilestone(m: MilestoneInputs): {
  steps: Step[];
  current: {
    title: string; progress: number; target: number;
    /** The step it is: the rung its buttons sit on. */
    step?: StepKey;
    /** The step's button, and a second, quieter one where there are two. */
    action?: MilestoneAction; secondary?: MilestoneAction;
  } | null;
} {
  const steps: Step[] = [];
  if (m.businessLive != null) steps.push({ key: 'live', label: 'Business live', done: m.businessLive });
  if (m.channelsConnected != null) steps.push({ key: 'channels', label: 'Channels connected', done: m.channelsConnected });
  if (m.firstPostPublished != null) steps.push({ key: 'post', label: 'First post published', done: m.firstPostPublished });
  if (m.orderCount != null) steps.push({ key: 'order', label: 'First order', done: m.orderCount > 0 });

  // The current milestone is the first VERIFIED-unfinished stage; unknown
  // stages are skipped, and the counted goal needs a real order count.
  // Not live: /welcome is where a business that is not live yet is put
  // live (its go-live panel: publish, follow a build, or finish one).
  if (m.businessLive === false) {
    return { steps, current: { title: 'Go live', progress: 0, target: 1, step: 'live', action: { label: 'Publish your site', short: 'Publish', icon: 'publish', to: '/welcome' } } };
  }
  if (m.channelsConnected === false) {
    // The blocking step: the launch post has nowhere to go until a network is
    // linked. An owner who connected only channels that cannot take posts
    // yet (a network still reviewing WPMaven) is not told to connect again as
    // if they had done nothing: the Connect tab says which channels can post.
    const waiting = m.anyChannelConnected === true;
    return {
      steps,
      current: {
        title: waiting ? 'Connect a channel we can post to' : 'Connect your channels',
        progress: 0,
        target: 1,
        step: 'channels',
        action: waiting
          ? { label: 'See which ones can post', short: 'See which', icon: 'connect', to: '/team?tab=connect' }
          : { label: 'Connect them now', short: 'Connect', icon: 'connect', to: '/team?tab=connect' },
      },
    };
  }
  if (m.firstPostPublished === false) {
    // A post already drafted only needs the owner's yes; otherwise the
    // Co-CEO is asked for one, in words the owner sends themselves.
    const action: MilestoneAction = m.firstPostWaiting === true
      ? { label: 'Approve your launch post', short: 'Approve', icon: 'approve', to: '/waiting?tab=yes' }
      : { label: 'Ask for your first post', short: 'Ask', icon: 'ask', ask: MILESTONE_ASKS.firstPost };
    return { steps, current: { title: 'First post out', progress: 0, target: 1, step: 'post', action } };
  }
  if (m.orderCount == null) {
    return steps.length ? { steps, current: { title: 'Your business, running', progress: 0, target: 1 } } : { steps, current: null };
  }
  const share: MilestoneAction = {
    label: 'Share your store', short: 'Share', icon: 'share', share: 'site', copyLabel: 'Copy your store link', copyShort: 'Copy',
  };
  const promotion = (ask: string): MilestoneAction => ({ label: 'Plan a promotion', short: 'Promotion', icon: 'promotion', ask });
  // No order yet: the first one is the step, with the same two ways to get it.
  if (m.orderCount <= 0) {
    return {
      steps,
      current: {
        title: 'First order', progress: 0, target: 1, step: 'order',
        action: share,
        secondary: promotion(MILESTONE_ASKS.firstOrder),
      },
    };
  }
  if (m.orderCount < 10) {
    return {
      steps,
      current: {
        title: 'First 10 orders', progress: m.orderCount, target: 10, step: 'orders10',
        action: share,
        secondary: promotion(MILESTONE_ASKS.first10),
      },
    };
  }
  const progress = Math.min(m.orderCount, 100);
  return {
    steps,
    current: {
      title: 'First 100 orders', progress, target: 100, step: 'orders100',
      // Reached: nothing left to push for on this ladder.
      ...(m.orderCount < 100 ? { action: promotion(MILESTONE_ASKS.first100) } : {}),
    },
  };
}

/** Done, the one being worked on now, or one still to come. */
export type RungState = 'done' | 'current' | 'next';

export interface Rung {
  key: StepKey;
  label: string;
  state: RungState;
  /** A counted goal (10 orders, 100 orders): how far along it is. */
  count?: { value: number; target: number };
  /** The current rung's buttons, the first one the main one. Only the
   *  current rung has any: a step done or still to come has nothing to press. */
  actions?: MilestoneAction[];
}

/** The counted goals after the first order, when the order count is known. */
const ORDER_GOALS = [10, 100] as const;

/**
 * The whole ladder, top to bottom, as the checklist draws it: the verified
 * steps deriveMilestone reads (a step whose source did not answer is left
 * out, never shown undone), then the counted order goals. The current rung
 * is the first one not done, so nothing below an open step reads as the one
 * to work on. Its buttons are deriveMilestone's, on the rung of the step
 * they act on, and on no other.
 */
export function milestoneLadder(m: MilestoneInputs): { rungs: Rung[] } {
  const { steps, current } = deriveMilestone(m);
  const all: Array<{ key: StepKey; label: string; done: boolean; count?: Rung['count'] }> = [...steps];
  if (m.orderCount != null) {
    for (const target of ORDER_GOALS) {
      all.push({
        key: target === 10 ? 'orders10' : 'orders100',
        label: `First ${target} orders`,
        done: m.orderCount >= target,
        count: { value: Math.min(Math.max(0, m.orderCount), target), target },
      });
    }
  }
  const at = all.findIndex((s) => !s.done);
  const actions = [current?.action, current?.secondary].filter((a): a is MilestoneAction => !!a);
  const rungs = all.map((s, i): Rung => {
    const isCurrent = i === at;
    return {
      key: s.key,
      label: s.label,
      state: s.done ? 'done' : isCurrent ? 'current' : 'next',
      ...(s.count && !s.done ? { count: s.count } : {}),
      // Every rung done: no button, whatever the last step offered.
      ...(isCurrent && current?.step === s.key && actions.length ? { actions } : {}),
    };
  });
  return { rungs };
}

/** Whether the checklist has anything to show: its placeholder while the
 *  sources load, then any rung at all. */
export function checklistShows(m: MilestoneInputs, loading: boolean): boolean {
  return loading || milestoneLadder(m).rungs.length > 0;
}
