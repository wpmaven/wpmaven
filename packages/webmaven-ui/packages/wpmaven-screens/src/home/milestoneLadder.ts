/**
 * The business's milestones, a checklist on Home (the dashboard's Home and
 * the WordPress plugin's Overview): business live, channels connected (the
 * social networks the AI team posts to), first post, first orders, each with
 * the button that moves it, and the requests those buttons put in the
 * Co-CEO's chat box for the owner to send.
 *
 * English is the source; the French is written by hand (src/i18n/fr.json,
 * namespaces screensMilestones and screensMilestoneAsks), the other
 * languages by the dashboard's translation script.
 *
 * From VERIFIED state only: steps are ticked exactly when they really
 * happened (endowed progress with genuine endowment, never fake ticks).
 * Drawn by MilestoneChecklist.
 */
import { localized } from '@yotako/webmaven-ui';

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

/**
 * The requests the milestones put in the Co-CEO's chat box, in the owner's
 * own voice (first person), for the owner to send. Never sent for the owner
 * (namespace 'screensMilestoneAsks').
 */
export const MILESTONE_ASKS_EN = {
  /** Asks the Co-CEO (the AI team's lead) for the launch post. */
  firstPost: 'Prepare my first post to announce the business.',
  /** Asks for a promotion to get the first order. */
  firstOrder: 'Plan a promotion to get my first order.',
  /** Asks for a promotion to get the first 10 orders. */
  first10: 'Plan a promotion to get my first 10 orders.',
  /** Asks for a promotion to reach 100 orders. */
  first100: 'Plan a promotion to reach 100 orders.',
} as const;

export const MILESTONE_ASKS = localized(MILESTONE_ASKS_EN, 'screensMilestoneAsks');

/**
 * The milestones' words (namespace 'screensMilestones'): the steps' names,
 * the step being worked on, and its buttons, each in full and in a word for
 * a narrow row ("short").
 */
export const MILESTONE_COPY_EN = {
  /** The checklist's title (small capitals). */
  title: 'Milestones',
  /** A step: the business's site is published. */
  businessLive: 'Business live',
  /** A step: a social network the team can post to is connected. */
  channelsConnected: 'Channels connected',
  /** A step: the first post went out. */
  firstPostPublished: 'First post published',
  /** A step: the first order came in (also the step being worked on). */
  firstOrder: 'First order',
  /** A counted step; {0} the orders to reach (10 or 100). */
  firstOrders: (target: number) => `First ${target} orders`,
  /** The step being worked on: put the business live. */
  goLive: 'Go live',
  /** The step being worked on: channels are connected but none can take posts yet. */
  connectPostable: 'Connect a channel we can post to',
  /** The step being worked on: connect the business's social networks. */
  connectChannels: 'Connect your channels',
  /** The step being worked on: the first post. */
  firstPostOut: 'First post out',
  /** The step being worked on when the orders are not known. */
  running: 'Your business, running',
  /** A button: publish the site. */
  publish: 'Publish your site',
  /** The same button in a word. */
  publishShort: 'Publish',
  /** A button: see which connected channels can take posts. */
  seeWhich: 'See which ones can post',
  /** The same button in a word or two. */
  seeWhichShort: 'See which',
  /** A button: connect the channels. */
  connectNow: 'Connect them now',
  /** The same button in a word. */
  connectShort: 'Connect',
  /** A button: approve the launch post waiting for the owner's yes. */
  approveLaunch: 'Approve your launch post',
  /** The same button in a word. */
  approveShort: 'Approve',
  /** A button: ask the Co-CEO for the first post. */
  askFirstPost: 'Ask for your first post',
  /** The same button in a word. */
  askShort: 'Ask',
  /** A button: share the business's site. */
  shareStore: 'Share your store',
  /** The same button in a word. */
  shareShort: 'Share',
  /** The share button where the browser cannot share: copies the link. */
  copyStoreLink: 'Copy your store link',
  /** The same button in a word. */
  copyShort: 'Copy',
  /** A button: ask the Co-CEO for a promotion. */
  promotion: 'Plan a promotion',
  /** The same button in a word. */
  promotionShort: 'Promotion',
  /** The share button once the link is copied. */
  copied: 'Copied',
  /** Read by screen readers before a done step's name. */
  spokenDone: 'Done: ',
  /** Read by screen readers before the step being worked on. */
  spokenNow: 'Now: ',
  /** Read by screen readers before a step still to come. */
  spokenNext: 'Next: ',
  /** A counted step's progress bar, for screen readers; {0} the step ("First 10 orders"), {1} how many so far, {2} the goal. */
  progress: (step: string, value: number, target: number) => `${step}: ${value} of ${target}`,
};

export const MILESTONE_COPY = localized(MILESTONE_COPY_EN, 'screensMilestones');

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
  const c = MILESTONE_COPY;
  const steps: Step[] = [];
  if (m.businessLive != null) steps.push({ key: 'live', label: c.businessLive, done: m.businessLive });
  if (m.channelsConnected != null) steps.push({ key: 'channels', label: c.channelsConnected, done: m.channelsConnected });
  if (m.firstPostPublished != null) steps.push({ key: 'post', label: c.firstPostPublished, done: m.firstPostPublished });
  if (m.orderCount != null) steps.push({ key: 'order', label: c.firstOrder, done: m.orderCount > 0 });

  // The current milestone is the first VERIFIED-unfinished stage; unknown
  // stages are skipped, and the counted goal needs a real order count.
  // Not live: /welcome is where a business that is not live yet is put
  // live (its go-live panel: publish, follow a build, or finish one).
  if (m.businessLive === false) {
    return { steps, current: { title: c.goLive, progress: 0, target: 1, step: 'live', action: { label: c.publish, short: c.publishShort, icon: 'publish', to: '/welcome' } } };
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
        title: waiting ? c.connectPostable : c.connectChannels,
        progress: 0,
        target: 1,
        step: 'channels',
        action: waiting
          ? { label: c.seeWhich, short: c.seeWhichShort, icon: 'connect', to: '/team?tab=connect' }
          : { label: c.connectNow, short: c.connectShort, icon: 'connect', to: '/team?tab=connect' },
      },
    };
  }
  if (m.firstPostPublished === false) {
    // A post already drafted only needs the owner's yes; otherwise the
    // Co-CEO is asked for one, in words the owner sends themselves.
    const action: MilestoneAction = m.firstPostWaiting === true
      ? { label: c.approveLaunch, short: c.approveShort, icon: 'approve', to: '/waiting?tab=yes' }
      : { label: c.askFirstPost, short: c.askShort, icon: 'ask', ask: MILESTONE_ASKS.firstPost };
    return { steps, current: { title: c.firstPostOut, progress: 0, target: 1, step: 'post', action } };
  }
  if (m.orderCount == null) {
    return steps.length ? { steps, current: { title: c.running, progress: 0, target: 1 } } : { steps, current: null };
  }
  const share: MilestoneAction = {
    label: c.shareStore, short: c.shareShort, icon: 'share', share: 'site', copyLabel: c.copyStoreLink, copyShort: c.copyShort,
  };
  const promotion = (ask: string): MilestoneAction => ({ label: c.promotion, short: c.promotionShort, icon: 'promotion', ask });
  // No order yet: the first one is the step, with the same two ways to get it.
  if (m.orderCount <= 0) {
    return {
      steps,
      current: {
        title: c.firstOrder, progress: 0, target: 1, step: 'order',
        action: share,
        secondary: promotion(MILESTONE_ASKS.firstOrder),
      },
    };
  }
  if (m.orderCount < 10) {
    return {
      steps,
      current: {
        title: c.firstOrders(10), progress: m.orderCount, target: 10, step: 'orders10',
        action: share,
        secondary: promotion(MILESTONE_ASKS.first10),
      },
    };
  }
  const progress = Math.min(m.orderCount, 100);
  return {
    steps,
    current: {
      title: c.firstOrders(100), progress, target: 100, step: 'orders100',
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
        label: MILESTONE_COPY.firstOrders(target),
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
