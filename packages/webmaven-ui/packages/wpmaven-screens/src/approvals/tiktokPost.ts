/**
 * The Post to TikTok screen (an approval's own step, before a video goes to
 * the owner's TikTok account) and the words around a TikTok post: who can
 * see it, the commercial content disclosure, the caption, the length check,
 * the declaration above the button, a post waiting for the plan's actions,
 * and what TikTok answered. TikTok's own sentences are translated, keeping
 * TikTok's product and policy names as TikTok writes them in that language.
 *
 * English is the source; the French is written by hand (src/i18n/fr.json,
 * namespaces screensTikTokPost, screensTikTokScreen, screensTikTokPrivacy,
 * screensTikTokDeclarations and screensTikTokMissing), the other languages
 * by the dashboard's translation script.
 *
 * The rules of the screen, with no React in them. TikTok's Content Sharing
 * Guidelines (https://developers.tiktok.com/docs/en/content-sharing-guidelines,
 * "Last updated August 4, 2026") say exactly what this screen must show, what
 * starts unchecked, what is greyed out and when the post button may be
 * pressed. Each of those decisions is a function here so it can be tested on
 * its own (the dashboard's components/connect/__tests__/tiktokPost.node.test.ts)
 * and so the component that draws the screen only draws it. In this package
 * since 2026-10-16 (the dashboard's file re-exports it): the approval card
 * says its sentences in both apps.
 *
 * The API re-checks every one of these rules before it claims the approval,
 * and again before it sends a byte to TikTok. This file is the courtesy that
 * keeps the owner from pressing a button the server will refuse; it is not the
 * enforcement.
 *
 * No runtime imports but the product's name and the kit's language helper,
 * on purpose: the node unit tests load this file directly.
 */

import type {
  DecideResult, TikTokConsentInput, TikTokDeclarationId, TikTokDraftInput, TikTokPostScreenReady,
  TikTokPrivacyLevel, TikTokPublishState, OperatorApproval,
} from './types';
import { localized } from '@yotako/webmaven-ui';
import { postingApp, productName } from '@yotako/wpmaven-onboarding/shared';
import { formatTag } from '../copyLanguage';

// ── Copy ────────────────────────────────────────────────────────────────
//
// TikTok's own sentences are quoted exactly. Ours are American English with
// no em dashes, and match the API's strings for the same situations.

export const TIKTOK_TITLE_MAX_UTF16 = 2200;

/** TikTok's policy pages, linked from the declaration above the button. */
export const MUSIC_USAGE_URL = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';
export const BRANDED_CONTENT_POLICY_URL = 'https://www.tiktok.com/legal/page/global/bc-policy/en';

/** The Post to TikTok screen's sentences, and a TikTok post's around it (namespace 'screensTikTokPost'). */
export const TIKTOK_COPY_EN = {
  /**
   * Said before the owner disconnects TikTok. The API deletes the connection
   * and then asks TikTok to revoke the app's access (best effort), which
   * takes it off the account's app permissions in TikTok, so the next
   * connect shows TikTok's permission page again. {0} the posting app's name
   * as TikTok shows it ("WPMaven", or "our posting app" on a branded address).
   */
  disconnectNoteFor: (app: string) => `We also ask TikTok to remove ${app} from your TikTok app permissions, so connecting again shows TikTok's permission page.`,
  /** disconnectNoteFor with the posting app's name (not a text of its own). */
  get disconnectNote(): string {
    return this.disconnectNoteFor(postingApp());
  },
  /**
   * Above the screen while TikTok has not approved the app for public posts
   * (word for word the API's TIKTOK_TEXT.unauditedNotice): the rule, how to
   * share a video now, and that the limit ends by itself. "Only you" and
   * "Everyone" are TikTok's audience names. {0} the posting app's name, twice.
   */
  unauditedNoticeFor: (app: string) => `TikTok has not approved ${app} for public posting yet, so for now it only takes posts from private accounts, and this video is posted as Only you. To share it now, after it posts, set your TikTok account to public and change who can watch the video to Everyone. Once TikTok approves ${app}, this limit lifts automatically: your account can stay public and you choose Everyone right here.`,
  /** unauditedNoticeFor with the posting app's name (not a text of its own). */
  get unauditedNotice(): string {
    return this.unauditedNoticeFor(postingApp());
  },
  /**
   * Beside the disabled button while the app is not approved yet and the
   * owner chose another audience: the one that can be posted. "Only you
   * (private)" is the audience's label on this screen. {0} the posting app's name.
   */
  privacyNeedsAuditFor: (app: string) => `Until TikTok approves ${app}, choose "Only you (private)" to post.`,
  /** privacyNeedsAuditFor with the posting app's name (not a text of its own). */
  get privacyNeedsAudit(): string {
    return this.privacyNeedsAuditFor(postingApp());
  },
  /**
   * Branded content ticked before TikTok approves the app: "Only you" is the
   * one audience it may post to, and branded content cannot be private, so
   * the way to post now is to turn Branded content off (word for word the
   * API's refusal). {0} the posting app's name.
   */
  brandedNeedsAuditFor: (app: string) => `Until TikTok approves ${app}, only "Only you (private)" posts can be sent, and branded content cannot be private. Turn off Branded content to post now.`,
  /** brandedNeedsAuditFor with the posting app's name (not a text of its own). */
  get brandedNeedsAudit(): string {
    return this.brandedNeedsAuditFor(postingApp());
  },
  /** After an audience an older API marks unavailable, in brackets. */
  unavailableFallback: 'Not available for this account',
  /** Under Branded content when it cannot be ticked: the audience chosen is "Only you". */
  brandedPrivate: "Branded content can't be private. Choose another audience to select it.",
  /** TikTok's hover text on the disabled "only me" audience while Branded content is ticked (TikTok's own sentence, translated). */
  selfOnlyBrandedHover: 'Branded content visibility cannot be set to private.',
  /** TikTok's hover text on the disabled post button while the disclosure is on and nothing is ticked (TikTok's own sentence, translated). */
  disclosureIncomplete: 'You need to indicate if your content promotes yourself, a third party, or both.',
  /** The audience picker's label. */
  privacyLabel: 'Who can see this video',
  /** The audience picker before a choice (TikTok forbids a default). */
  privacyPlaceholder: 'Select who can see this',
  /** Beside Comment, Duet or Stitch when the creator turned it off in TikTok. */
  interactionOff: 'Turned off for this TikTok account',
  /** The switch that discloses commercial content (TikTok's setting, as TikTok names it in this language). */
  disclosureSwitch: 'Disclose commercial content',
  /** Under that switch. */
  disclosureHelper: 'Turn this on if this video promotes yourself, a brand, a product or a service.',
  /** A disclosure box (TikTok's own name for it, as TikTok writes it in this language). */
  yourBrand: 'Your brand',
  /** Under Your brand. */
  yourBrandHelper: 'You are promoting yourself or your own business.',
  /** A disclosure box (TikTok's own name for it, as TikTok writes it in this language). */
  brandedContent: 'Branded content',
  /** Under Branded content. */
  brandedContentHelper: 'You are promoting another brand or a third party.',
  /**
   * TikTok's prompt once Your brand is ticked, word for word from its
   * Content Sharing Guidelines, "photo/video" included; the label in quotes
   * is TikTok's own, as TikTok writes it in this language.
   */
  promptPromotional: "Your photo/video will be labeled as 'Promotional content'",
  /** TikTok's prompt once Branded content is ticked; the label in quotes is TikTok's own, as TikTok writes it in this language. */
  promptPaidPartnership: "Your photo/video will be labeled as 'Paid partnership'",
  /** The caption field's label: TikTok's checklist calls it "Title". */
  captionLabel: 'Title',
  /** Under the caption field. */
  captionHelper: 'This is exactly what TikTok will show as the caption. Hashtags and mentions work here.',
  /** A video the team made with AI: TikTok's label is always on. */
  aiLocked: 'TikTok will label this video as AI-generated.',
  /** The owner's own box for a video made with AI. */
  aiOwnerChoice: 'This video was made with AI. TikTok will label it as AI-generated.',
  /** After the post is sent, while TikTok processes it. */
  processingNotice: 'Sent to TikTok. It may take a few minutes to process and appear on your profile.',
  /** Above the button, before the post is sent. */
  processingAhead: 'After you post, it may take a few minutes for TikTok to process the video and show it on your profile.',
  /** Staff viewing the account as its owner cannot post for them. */
  staffRefusal: "TikTok posts need the owner's own consent",
  /** Beside the disabled button: the audience comes first. */
  choosePrivacyFirst: 'Choose who can see this video first.',
  /** While the video's length is checked; some phones load nothing until play is pressed. */
  videoLoading: "Checking the video's length against what TikTok allows. If this does not change, press play on the video once.",
  /** The video could not be loaded on the screen. */
  videoUnreadable: 'This video could not be loaded here, so its length cannot be checked against what TikTok allows. Check again, or ask for changes.',
  /** TikTok did not say the account's longest video. */
  maxUnknown: 'TikTok did not say how long a video this account can post. Check again.',
  /** TikTok did not say which account the post goes to. */
  accountUnknown: 'TikTok did not say which account this would post to. Check again.',
  /** The audience chosen is not offered for this account any more. */
  privacyUnavailable: 'That audience is not available for this TikTok account. Choose another one.',
  /**
   * A TikTok post approved while the plan's actions are used up: it waits.
   * The 24 hours are OUR rule (the API's TIKTOK_CONSENT_TTL_MS), never
   * TikTok's: never say TikTok asks again. {0} the product's name.
   */
  heldTikTokFor: (product: string) => `You approved this. If your actions come back within 24 hours, it posts by itself; after that ${product} expires your confirmation and asks you again here, against your account settings at that moment. You can cancel it until it goes out.`,
  /** heldTikTokFor with the product's name (not a text of its own). */
  get heldTikTok(): string {
    return this.heldTikTokFor(productName());
  },
  /** The owner's way out of a waiting post (button). */
  cancelHeldButton: 'Cancel this TikTok post',
  /** The cancel confirm's title. */
  cancelHeldTitle: 'Cancel this TikTok post?',
  /** The cancel confirm's button. */
  cancelHeldConfirm: 'Cancel the post',
  /** The cancel confirm's button that keeps the post waiting. */
  cancelHeldKeep: 'Keep it waiting',
  /** A canceled post's badge (American spelling in English). */
  cancelledBadge: 'Canceled',
  /** On a canceled post's card. */
  cancelledLine: 'You canceled this before it went out. Nothing was posted, to TikTok or anywhere else.',
  /** Right after the cancel. */
  cancelledNotice: 'Canceled. Nothing was posted, to TikTok or anywhere else, and it will not go out when your actions come back.',
  /** The screen's visible title: TikTok's guidelines call it the "Post to TikTok page". */
  screenTitle: 'Post to TikTok',
  /** On Home, beside the button to the screen: choosing the settings first is TikTok's rule. */
  routeFirst: 'TikTok asks you to choose the post settings first.',
  /** A refusal the API sent without a sentence of its own. */
  notSent: 'Nothing was sent to TikTok.',
  /** On Home: the button to the Post to TikTok screen. */
  routeButton: 'Review and post to TikTok',
  /** The heading of the other way: finishing the post in TikTok's own app (Send to TikTok drafts). */
  draftHeading: 'Or finish it in TikTok',
  /** The button that sends the video to the owner's TikTok drafts (inbox). */
  draftButton: 'Send to TikTok drafts',
  /** What sending to drafts does. */
  draftNotice: 'TikTok puts the video in your TikTok inbox. Open the notification in the TikTok app to finish it there: write the caption, choose who can see it, add sound or effects, and post it. The settings above are not used.',
  /** After sending to drafts. */
  draftInbox: 'Sent to your TikTok inbox. Open the notification in the TikTok app to finish the post there and publish it.',
  /** A draft the owner posted from TikTok. */
  draftPosted: 'You posted this video from your TikTok drafts.',
  /**
   * Before the press, when the plan's actions are used up: nothing goes to
   * TikTok yet, it waits up to 24 hours (our rule, never TikTok's). {0} the
   * product's name.
   */
  actionsEmptyFor: (product: string) => `Your actions for this period are used up. If you post now, nothing goes to TikTok yet: it waits and is sent by itself when your actions come back, as long as that is within 24 hours. After that, ${product} asks you again here. You can cancel it while it waits.`,
  /** actionsEmptyFor with the product's name (not a text of its own). */
  get actionsEmpty(): string {
    return this.actionsEmptyFor(productName());
  },
  /**
   * Before the press, after a failed payment: nothing was used up, and the
   * card, not the reset, lets it go (our 24 hours, never TikTok's). {0} the
   * product's name.
   */
  actionsPaymentFailedFor: (product: string) => `Your last payment did not go through, so your plan's actions are paused. If you post now, nothing goes to TikTok yet: it waits and is sent by itself once your card is updated and the payment goes through, as long as that is within 24 hours. After that, ${product} asks you again here. You can cancel it while it waits.`,
  /** actionsPaymentFailedFor with the product's name (not a text of its own). */
  get actionsPaymentFailed(): string {
    return this.actionsPaymentFailedFor(productName());
  },
  /** A link to the posted video on TikTok. */
  viewOnTikTok: 'View on TikTok',
  /** A link to the post's numbers. */
  seeNumbers: 'See TikTok numbers',
} as const;

export const TIKTOK_COPY = localized(TIKTOK_COPY_EN, 'screensTikTokPost');

/** The rest of the Post to TikTok screen's words, and what TikTok answered after a post (namespace 'screensTikTokScreen'). */
export const TIKTOK_SCREEN_COPY_EN = {
  /** An audience TikTok does not offer this account, with why, in brackets; {0} the audience, {1} why. */
  withNote: (label: string, note: string) => `${label} (${note})`,
  /** A box under the audience (TikTok's own setting). */
  allowComments: 'Allow comments',
  /** A box under the audience: Duet is TikTok's feature, named as TikTok writes it in this language. */
  allowDuet: 'Allow Duet',
  /** A box under the audience: Stitch is TikTok's feature, named as TikTok writes it in this language. */
  allowStitch: 'Allow Stitch',
  /**
   * TikTok's policy's name, as TikTok writes it in this language: it must
   * appear word for word in both declarations, where it is the link.
   */
  musicUsageLink: 'Music Usage Confirmation',
  /**
   * TikTok's policy's name, as TikTok writes it in this language: it must
   * appear word for word in the branded declaration, where it is the link.
   */
  brandedPolicyLink: 'Branded Content Policy',
  /** The video is longer than the account may post; {0} its seconds ("62.5"), {1} the most it may post. */
  tooLong: (seconds: string, max: string) => `This video is ${seconds} seconds; this TikTok account can post up to ${max} seconds.`,
  /** The video's length is fine; {0} its seconds ("12"), {1} the most the account may post. */
  lengthOk: (seconds: string, max: string) => `This video is ${seconds} seconds. This TikTok account can post videos up to ${max} seconds.`,
  /** The caption is too long; {0} its characters, {1} the most TikTok allows. */
  captionTooLong: (length: number, max: number) => `The caption is ${length} characters; TikTok allows up to ${max}.`,
  /** The checklist item for a caption too long; {0} the most TikTok allows. */
  shortenTitle: (max: number) => `Shorten the title to ${max} characters or fewer`,
  /** The post button when the video goes to TikTok alone. */
  postButton: 'Post to TikTok',
  /** The post button when other networks come along. */
  approveAndPost: 'Approve and post',
  /** The cancel confirm: what will not happen. */
  cancelDetail: 'Nothing has been sent yet. If you cancel, it is not posted to TikTok, and it will not go out when your actions come back. Your team can make a new one.',
  /** The same, naming the other networks it was going to; {0} their names ("Facebook, Instagram"). */
  cancelDetailOthers: (others: string) => `Nothing has been sent yet. If you cancel, it is not posted to TikTok or to ${others}, and it will not go out when your actions come back. Your team can make a new one.`,
  /** The card's badge while TikTok is pending or after it answered (short). */
  badge: {
    /** A draft on its way to the owner's TikTok inbox. */
    sendingInbox: 'Sending to your TikTok inbox',
    /** A post TikTok is processing. */
    processing: 'Sent to TikTok, processing',
    /** A draft waiting in the owner's TikTok inbox. */
    inInbox: 'In your TikTok inbox',
    /** Posted. */
    posted: 'Posted on TikTok',
    /** TikTok refused it. */
    failed: 'TikTok did not post it',
    /** No answer from TikTok. */
    unconfirmed: 'Not confirmed by TikTok',
  },
  /** Under the badge once posted; {0} who can see it ("Your followers"). */
  postedVisibleTo: (audience: string) => `Posted on TikTok (visible to: ${audience}).`,
  /** Under the badge when TikTok refused it. */
  notPosted: 'TikTok did not post this video.',
  /** Under the badge when TikTok never answered. */
  notConfirmed: 'TikTok has not confirmed this post after a day. Check your TikTok profile before posting it again.',
};

export const TIKTOK_SCREEN_COPY = localized(TIKTOK_SCREEN_COPY_EN, 'screensTikTokScreen');

/** TikTok's audiences in words a person deciding in a hurry reads (namespace 'screensTikTokPrivacy'). */
export const PRIVACY_LABELS_EN: Record<TikTokPrivacyLevel, string> = {
  /** An audience: anyone on TikTok. */
  PUBLIC_TO_EVERYONE: 'Everyone on TikTok',
  /** An audience: mutual followers. */
  MUTUAL_FOLLOW_FRIENDS: 'Friends (people you follow who follow you back)',
  /** An audience: the account's followers. */
  FOLLOWER_OF_CREATOR: 'Your followers',
  /** An audience: the owner alone. */
  SELF_ONLY: 'Only you (private)',
};

/** TikTok's enum is not self-explanatory to a person deciding in a hurry. */
export const PRIVACY_LABELS: Record<TikTokPrivacyLevel, string> = localized(PRIVACY_LABELS_EN, 'screensTikTokPrivacy');

/**
 * The declaration TikTok requires directly above the publish button, as a
 * fallback for an API answer without `declarations` (namespace
 * 'screensTikTokDeclarations'). The server's text wins when it sends one,
 * and the server checks the id and version we echo.
 */
export const DECLARATION_FALLBACK_EN: Record<TikTokDeclarationId, string> = {
  /**
   * TikTok's required declaration, translated; "Music Usage Confirmation" is
   * TikTok's policy, named exactly as musicUsageLink says it.
   */
  music: "By posting, you agree to TikTok's Music Usage Confirmation.",
  /**
   * The same while Branded content is ticked; TikTok's two policies are
   * named exactly as brandedPolicyLink and musicUsageLink say them.
   */
  branded_music: "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation.",
};

export const DECLARATION_FALLBACK: Record<TikTokDeclarationId, string> = localized(DECLARATION_FALLBACK_EN, 'screensTikTokDeclarations');

/** TikTok's policies by name, in English and in the page's language, each to its page. */
function knownLinks(): Record<string, string> {
  return {
    [TIKTOK_SCREEN_COPY_EN.musicUsageLink]: MUSIC_USAGE_URL,
    [TIKTOK_SCREEN_COPY_EN.brandedPolicyLink]: BRANDED_CONTENT_POLICY_URL,
    [TIKTOK_SCREEN_COPY.musicUsageLink]: MUSIC_USAGE_URL,
    [TIKTOK_SCREEN_COPY.brandedPolicyLink]: BRANDED_CONTENT_POLICY_URL,
  };
}

/** A video's seconds as the page's language writes them: whole when whole, one decimal otherwise ("62.5"). */
function secondsText(sec: number): string {
  const tenths = Math.round(sec * 10) / 10;
  return new Intl.NumberFormat(formatTag('en-US'), { maximumFractionDigits: 1, useGrouping: false }).format(tenths);
}

// ── Form state ──────────────────────────────────────────────────────────

export interface TikTokPostForm {
  /** Exactly what the textarea holds. Never trimmed. */
  title: string;
  /** '' until the owner picks one: TikTok forbids a default. */
  privacyLevel: TikTokPrivacyLevel | '';
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  discloseCommercial: boolean;
  yourBrand: boolean;
  brandedContent: boolean;
  /** The owner's own AI-label choice. Ignored for a WPMaven render, which is always labeled. */
  isAigc: boolean;
}

/** What the player reported about the file. */
export interface TikTokVideoProbe {
  url: string | null;
  durationSec: number | null;
  failed: boolean;
}

export const EMPTY_PROBE: TikTokVideoProbe = { url: null, durationSec: null, failed: false };

/** Everything starts off, nothing is preselected, and the caption is the draft. */
export function initialTikTokPostForm(screen: TikTokPostScreenReady): TikTokPostForm {
  return {
    title: typeof screen.title?.value === 'string' ? screen.title.value : '',
    privacyLevel: '',
    allowComment: false,
    allowDuet: false,
    allowStitch: false,
    discloseCommercial: false,
    yourBrand: false,
    brandedContent: false,
    isAigc: isAigcLocked(screen) ? true : false,
  };
}

export function isAigcLocked(screen: TikTokPostScreenReady): boolean {
  return !!screen.isAigc?.locked;
}

function optionAvailable(screen: TikTokPostScreenReady, level: string): boolean {
  return screen.privacyOptions.some((o) => o.value === level && o.available);
}

/**
 * Keep what the owner chose, minus anything a fresh creator_info no longer
 * allows. Used when the screen is fetched again ("Check again", or after the
 * API refused a post because the account changed).
 */
export function reconcileTikTokPostForm(screen: TikTokPostScreenReady, form: TikTokPostForm): TikTokPostForm {
  const next = { ...form };
  if (next.privacyLevel && !optionAvailable(screen, next.privacyLevel)) next.privacyLevel = '';
  if (screen.interactions.commentDisabled) next.allowComment = false;
  if (screen.interactions.duetDisabled) next.allowDuet = false;
  if (screen.interactions.stitchDisabled) next.allowStitch = false;
  if (!screen.brandedContent.available) next.brandedContent = false;
  if (next.privacyLevel === 'SELF_ONLY') next.brandedContent = false;
  if (!next.discloseCommercial) { next.yourBrand = false; next.brandedContent = false; }
  if (isAigcLocked(screen)) next.isAigc = true;
  return next;
}

/**
 * Apply one change the way the screen's controls do. Turning the disclosure
 * switch off clears both boxes, so turning it back on shows them unticked,
 * and so the consent never carries a box the owner can no longer see.
 */
export function updateTikTokPostForm(
  screen: TikTokPostScreenReady,
  form: TikTokPostForm,
  patch: Partial<TikTokPostForm>,
): TikTokPostForm {
  const next = { ...form, ...patch };
  if (!next.discloseCommercial) { next.yourBrand = false; next.brandedContent = false; }
  // Refuse the two combinations the controls already make impossible, in
  // case a patch arrives that the UI did not guard (keyboard, a test).
  if (next.brandedContent && (next.privacyLevel === 'SELF_ONLY' || !screen.brandedContent.available)) {
    next.brandedContent = false;
  }
  if (screen.interactions.commentDisabled) next.allowComment = false;
  if (screen.interactions.duetDisabled) next.allowDuet = false;
  if (screen.interactions.stitchDisabled) next.allowStitch = false;
  if (isAigcLocked(screen)) next.isAigc = true;
  return next;
}

function brandedTicked(form: TikTokPostForm): boolean {
  return form.discloseCommercial && form.brandedContent;
}

// ── What each control shows ─────────────────────────────────────────────

export interface PrivacyChoice {
  value: TikTokPrivacyLevel;
  label: string;
  disabled: boolean;
  /** Hover text for a disabled option, when TikTok gives one. */
  title: string | null;
}

/**
 * Every level creator_info returned, in TikTok's order, all selectable (2b).
 * "Only you" is disabled while Branded content is ticked, with TikTok's hover
 * text (3b). A level an older API marks unavailable is shown disabled with
 * its reason, never hidden.
 */
export function privacyChoices(screen: TikTokPostScreenReady, form: TikTokPostForm): PrivacyChoice[] {
  return screen.privacyOptions.map((o) => {
    const base = (o.label && o.label.trim()) || PRIVACY_LABELS[o.value] || o.value;
    if (!o.available) {
      const note = (o.note && o.note.trim()) || TIKTOK_COPY.unavailableFallback;
      return { value: o.value, label: TIKTOK_SCREEN_COPY.withNote(base, note), disabled: true, title: note };
    }
    if (o.value === 'SELF_ONLY' && brandedTicked(form)) {
      return { value: o.value, label: base, disabled: true, title: TIKTOK_COPY.selfOnlyBrandedHover };
    }
    return { value: o.value, label: base, disabled: false, title: null };
  });
}

export interface InteractionChoice {
  key: 'allowComment' | 'allowDuet' | 'allowStitch';
  label: string;
  checked: boolean;
  disabled: boolean;
  reason: string | null;
}

/** Comment, Duet and Stitch: unchecked until ticked, greyed out where the creator turned them off (2c). */
export function interactionChoices(screen: TikTokPostScreenReady, form: TikTokPostForm): InteractionChoice[] {
  const rows: Array<[InteractionChoice['key'], string, boolean]> = [
    ['allowComment', TIKTOK_SCREEN_COPY.allowComments, !!screen.interactions.commentDisabled],
    ['allowDuet', TIKTOK_SCREEN_COPY.allowDuet, !!screen.interactions.duetDisabled],
    ['allowStitch', TIKTOK_SCREEN_COPY.allowStitch, !!screen.interactions.stitchDisabled],
  ];
  return rows.map(([key, label, off]) => ({
    key,
    label,
    checked: !off && form[key],
    disabled: off,
    reason: off ? TIKTOK_COPY.interactionOff : null,
  }));
}

/** Why "Branded content" cannot be ticked right now, or null when it can. */
export function brandedContentBlock(screen: TikTokPostScreenReady, form: TikTokPostForm): string | null {
  if (!screen.brandedContent.available) {
    return (screen.brandedContent.reason && screen.brandedContent.reason.trim()) || TIKTOK_COPY.brandedPrivate;
  }
  if (form.privacyLevel === 'SELF_ONLY') return TIKTOK_COPY.brandedPrivate;
  return null;
}

/** TikTok's label prompt under the two boxes (3a), or null when nothing is ticked. */
export function disclosurePrompt(form: TikTokPostForm): string | null {
  if (!form.discloseCommercial) return null;
  if (form.brandedContent) return TIKTOK_COPY.promptPaidPartnership;
  if (form.yourBrand) return TIKTOK_COPY.promptPromotional;
  return null;
}

export interface DeclarationSegment { text: string; href: string | null }

export interface DeclarationView {
  id: TikTokDeclarationId;
  version: string;
  text: string;
  segments: DeclarationSegment[];
}

/** Read the API's link list, whichever of the plain shapes it used. */
function linkMap(links: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (label: unknown, href: unknown) => {
    if (typeof label === 'string' && typeof href === 'string' && /^https:\/\//i.test(href) && label.trim()) {
      out[label.trim()] = href;
    }
  };
  if (Array.isArray(links)) {
    for (const l of links) {
      if (l && typeof l === 'object') {
        const o = l as Record<string, unknown>;
        add(o.label ?? o.text ?? o.phrase, o.href ?? o.url);
      }
    }
  } else if (links && typeof links === 'object') {
    for (const [k, v] of Object.entries(links as Record<string, unknown>)) {
      if (typeof v === 'string') add(k, v);
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        add(o.label ?? o.text ?? k, o.href ?? o.url);
      }
    }
  }
  return out;
}

/** Split a sentence into plain runs and linked phrases. */
export function linkifyDeclaration(text: string, links: unknown): DeclarationSegment[] {
  const map = { ...knownLinks(), ...linkMap(links) };
  const phrases = Object.keys(map).filter((p) => text.includes(p)).sort((a, b) => b.length - a.length);
  if (phrases.length === 0) return [{ text, href: null }];
  const out: DeclarationSegment[] = [];
  let rest = text;
  while (rest.length > 0) {
    let at = -1;
    let hit = '';
    for (const p of phrases) {
      const i = rest.indexOf(p);
      if (i >= 0 && (at < 0 || i < at)) { at = i; hit = p; }
    }
    if (at < 0) { out.push({ text: rest, href: null }); break; }
    if (at > 0) out.push({ text: rest.slice(0, at), href: null });
    out.push({ text: hit, href: map[hit] });
    rest = rest.slice(at + hit.length);
  }
  return out;
}

/**
 * The sentence above the button: the Music Usage Confirmation one, or the
 * Branded Content Policy one while Branded content is ticked, alone or with
 * Your brand (TikTok item 4). Your brand alone keeps the music sentence.
 */
export function declarationFor(screen: TikTokPostScreenReady, form: TikTokPostForm): DeclarationView {
  const id: TikTokDeclarationId = brandedTicked(form) ? 'branded_music' : 'music';
  const fromApi = screen.declarations?.[id];
  const text = (fromApi && typeof fromApi.text === 'string' && fromApi.text.trim()) || DECLARATION_FALLBACK[id];
  return {
    id,
    version: screen.declarations?.version ?? '',
    text,
    segments: linkifyDeclaration(text, fromApi?.links),
  };
}

/** Seconds as a person reads them: whole when whole, one decimal otherwise. */
export function formatSeconds(sec: number): string {
  const tenths = Math.round(sec * 10) / 10;
  return Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
}

export interface DurationCheck {
  state: 'loading' | 'unreadable' | 'unknown_max' | 'too_long' | 'ok';
  message: string;
  blocks: boolean;
}

/**
 * The 1c check: the length the player reported against
 * max_video_post_duration_sec from the fresh creator_info.
 */
export function durationCheck(screen: TikTokPostScreenReady, probe: TikTokVideoProbe): DurationCheck {
  const max = screen.maxDurationSec;
  const sameFile = probe.url === null || probe.url === screen.video.url;
  if (probe.failed && sameFile) return { state: 'unreadable', message: TIKTOK_COPY.videoUnreadable, blocks: true };
  if (!sameFile || probe.durationSec === null) return { state: 'loading', message: TIKTOK_COPY.videoLoading, blocks: true };
  if (!(typeof max === 'number' && Number.isFinite(max) && max > 0)) {
    return { state: 'unknown_max', message: TIKTOK_COPY.maxUnknown, blocks: true };
  }
  const n = secondsText(probe.durationSec);
  const m = secondsText(max);
  if (probe.durationSec > max) {
    return { state: 'too_long', message: TIKTOK_SCREEN_COPY.tooLong(n, m), blocks: true };
  }
  return { state: 'ok', message: TIKTOK_SCREEN_COPY.lengthOk(n, m), blocks: false };
}

/** A duration the player reported, or null when it is not a usable number. */
export function usableDuration(d: unknown): number | null {
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null;
}

/** JS string length is the UTF-16 unit count TikTok's 2200 limit is written in. */
export function captionLength(title: string): number {
  return title.length;
}

export function captionMax(screen: TikTokPostScreenReady): number {
  const m = screen.title?.maxLength;
  return typeof m === 'number' && m > 0 ? Math.min(m, TIKTOK_TITLE_MAX_UTF16) : TIKTOK_TITLE_MAX_UTF16;
}

export interface PostGate {
  canPost: boolean;
  /** The first reason the button is disabled, written for the owner. Null when it can be pressed. */
  reason: string | null;
}

/**
 * Whether "Post to TikTok" may be pressed, and why not. The order is the
 * order the owner fills the screen in, so the reason shown is the next thing
 * to do, with one exception: while the disclosure switch is on and nothing is
 * ticked, TikTok's own sentence is the reason (and so the button's hover
 * text), whatever else is still missing (3a). Loading and a postable answer
 * are the caller's job: this is only called with a ready screen.
 *
 * The audience and branded rules follow the API's assertChoicesAllowed, so
 * the button and a server refusal say the same thing: an audience TikTok no
 * longer offers, then (before the audit) Branded content, then (before the
 * audit) any audience but "Only you", then Branded content with "Only you".
 */
export function postGate(
  screen: TikTokPostScreenReady,
  form: TikTokPostForm,
  probe: TikTokVideoProbe,
  ctx: { impersonated: boolean; busy?: boolean },
): PostGate {
  const no = (reason: string | null): PostGate => ({ canPost: false, reason });
  if (ctx.impersonated) return no(TIKTOK_COPY.staffRefusal);
  if (!screen.creator?.openId) return no(TIKTOK_COPY.accountUnknown);
  if (form.discloseCommercial && !form.yourBrand && !form.brandedContent) return no(TIKTOK_COPY.disclosureIncomplete);
  if (!form.privacyLevel) return no(TIKTOK_COPY.choosePrivacyFirst);
  if (!optionAvailable(screen, form.privacyLevel)) return no(TIKTOK_COPY.privacyUnavailable);
  // Before the audit, branded content can never go out: it cannot be private,
  // and private is all an unaudited app may send. Saying "choose Only you"
  // here would point at the option the picker has just greyed out (3b).
  if (brandedTicked(form) && screen.audited !== true) return no(TIKTOK_COPY.brandedNeedsAudit);
  if (brandedTicked(form)) {
    if (form.privacyLevel === 'SELF_ONLY') return no(TIKTOK_COPY.selfOnlyBrandedHover);
    const blocked = brandedContentBlock(screen, form);
    if (blocked) return no(blocked);
  }
  // TikTok's list is all selectable, but an app TikTok has not approved may
  // post "Only you" and nothing else (the API refuses the rest too).
  if (screen.audited !== true && form.privacyLevel !== 'SELF_ONLY') return no(TIKTOK_COPY.privacyNeedsAudit);
  const d = durationCheck(screen, probe);
  if (d.blocks) return no(d.message);
  const max = captionMax(screen);
  const len = captionLength(form.title);
  if (len > max) return no(TIKTOK_SCREEN_COPY.captionTooLong(len, max));
  if (ctx.busy) return no(null);
  return { canPost: true, reason: null };
}

// ── What is still missing ───────────────────────────────────────────────

/** The control a missing item is fixed at ('checkAgain': the screen's Check again). */
export type MissingTarget = 'privacy' | 'yourBrand' | 'brandedContent' | 'title' | 'video' | 'checkAgain';

export interface MissingItem {
  key: string;
  /** postGate's sentence for it (TikTok's own where TikTok wrote one). */
  reason: string;
  /** What to do, in plain words, for the checklist beside the button. */
  todo: string;
  /** Where pressing it takes the owner; null when nothing on this screen fixes it. */
  target: MissingTarget | null;
}

/**
 * The checklist beside the disabled Post to TikTok button: everything still
 * missing, each item with the way to the control that fixes it (namespace
 * 'screensTikTokMissing'). The names in quotes are the screen's own labels
 * (Your brand, Branded content, Only you), said the same way here.
 */
export const MISSING_COPY_EN = {
  /** The checklist's title. */
  heading: 'Before you can post:',
  /** An item's button: takes the owner to the control that fixes it. */
  showMe: 'Show me',
  /** Before the items after the first. */
  alsoNeeded: 'Also still needed:',
  /** An item: TikTok did not say which account; "Check again" is the screen's button. */
  account: 'Check again, so TikTok says which account this posts to',
  /** An item: the disclosure is on and neither box is ticked. */
  disclosure: 'Tick "Your brand", "Branded content", or both',
  /** An item: no audience chosen yet. */
  privacy: 'Choose who can see this video',
  /** An item: the audience chosen is not offered any more. */
  privacyOther: 'Choose another audience',
  /** An item: branded content cannot be posted yet. */
  brandedOff: 'Turn off "Branded content"',
  /** An item: branded content cannot be private. */
  brandedNotPrivate: 'Choose an audience other than "Only you"',
  /** An item: only "Only you" can be posted for now. */
  onlyYou: 'Choose "Only you (private)"',
  /** An item: the video's length is still being checked. */
  videoLoading: 'Wait for the length check, or press play on the video once',
  /** An item: the video could not be loaded. */
  videoCheck: 'Check the video again',
  /** An item: TikTok did not say the account's longest video. */
  maxUnknown: 'Check again, so TikTok says how long a video this account can post',
  /** An item: the video is too long; "Request changes" is the approval card's button. */
  tooLong: 'Use a shorter video: ask your team for one with Request changes',
} as const;

export const MISSING_COPY = localized(MISSING_COPY_EN, 'screensTikTokMissing');

/**
 * Everything that still keeps "Post to TikTok" disabled, in the order
 * postGate checks it, so the first item is always the button's own reason
 * (and so its hover text). postGate stops at the first; this keeps going, so
 * the owner sees the whole list at once and each item takes them to the
 * control that fixes it (an owner's words: the button "was grayed and it
 * was not obvious what action I needed to do to unlock it"). Nothing here
 * changes a choice: it only points at the control.
 *
 * Empty when the button can be pressed, and for a staff member viewing as the
 * owner (nothing on the screen is theirs to fix).
 */
export function postMissing(
  screen: TikTokPostScreenReady,
  form: TikTokPostForm,
  probe: TikTokVideoProbe,
  ctx: { impersonated: boolean },
): MissingItem[] {
  if (ctx.impersonated) return [];
  const out: MissingItem[] = [];
  if (!screen.creator?.openId) {
    out.push({ key: 'account', reason: TIKTOK_COPY.accountUnknown, todo: MISSING_COPY.account, target: 'checkAgain' });
  }
  if (form.discloseCommercial && !form.yourBrand && !form.brandedContent) {
    out.push({ key: 'disclosure', reason: TIKTOK_COPY.disclosureIncomplete, todo: MISSING_COPY.disclosure, target: 'yourBrand' });
  }
  const chosen = !!form.privacyLevel;
  const available = chosen && optionAvailable(screen, form.privacyLevel as TikTokPrivacyLevel);
  if (!chosen) {
    out.push({ key: 'privacy', reason: TIKTOK_COPY.choosePrivacyFirst, todo: MISSING_COPY.privacy, target: 'privacy' });
  } else if (!available) {
    out.push({ key: 'privacy', reason: TIKTOK_COPY.privacyUnavailable, todo: MISSING_COPY.privacyOther, target: 'privacy' });
  }
  if (brandedTicked(form)) {
    if (screen.audited !== true) {
      out.push({ key: 'branded', reason: TIKTOK_COPY.brandedNeedsAudit, todo: MISSING_COPY.brandedOff, target: 'brandedContent' });
    } else if (form.privacyLevel === 'SELF_ONLY') {
      out.push({ key: 'branded', reason: TIKTOK_COPY.selfOnlyBrandedHover, todo: MISSING_COPY.brandedNotPrivate, target: 'privacy' });
    } else if (chosen && available) {
      const blocked = brandedContentBlock(screen, form);
      if (blocked) out.push({ key: 'branded', reason: blocked, todo: MISSING_COPY.brandedOff, target: 'brandedContent' });
    }
  }
  // Not while Branded content is ticked before the audit: "Only you" is the
  // option the picker greys out for branded content (3b), so asking for it
  // would point at a choice the owner cannot make. The branded item above
  // already says what unlocks posting (turn Branded content off); once it is
  // off, this item comes back.
  if (chosen && available && screen.audited !== true && form.privacyLevel !== 'SELF_ONLY' && !brandedTicked(form)) {
    out.push({ key: 'onlyYou', reason: TIKTOK_COPY.privacyNeedsAudit, todo: MISSING_COPY.onlyYou, target: 'privacy' });
  }
  const d = durationCheck(screen, probe);
  if (d.blocks) {
    const todo = d.state === 'loading'
      ? MISSING_COPY.videoLoading
      : d.state === 'unreadable'
        ? MISSING_COPY.videoCheck
        : d.state === 'unknown_max'
          ? MISSING_COPY.maxUnknown
          : MISSING_COPY.tooLong;
    const target: MissingTarget | null = d.state === 'loading'
      ? 'video'
      : d.state === 'unreadable' || d.state === 'unknown_max'
        ? 'checkAgain'
        : null;
    out.push({ key: 'video', reason: d.message, todo, target });
  }
  const max = captionMax(screen);
  const len = captionLength(form.title);
  if (len > max) {
    out.push({
      key: 'title',
      reason: TIKTOK_SCREEN_COPY.captionTooLong(len, max),
      todo: TIKTOK_SCREEN_COPY.shortenTitle(max),
      target: 'title',
    });
  }
  return out;
}

/**
 * The consent the API stores, built only from what is on screen. Returns null
 * whenever postGate would refuse, so a caller cannot send a half-made one.
 */
export function buildTikTokConsentInput(
  screen: TikTokPostScreenReady,
  form: TikTokPostForm,
  probe: TikTokVideoProbe,
): TikTokConsentInput | null {
  if (!postGate(screen, form, probe, { impersonated: false }).canPost) return null;
  if (!form.privacyLevel || probe.durationSec === null) return null;
  const enabled = form.discloseCommercial;
  const declaration = declarationFor(screen, form);
  return {
    creatorOpenId: screen.creator.openId,
    title: form.title,
    privacyLevel: form.privacyLevel,
    allowComment: form.allowComment && !screen.interactions.commentDisabled,
    allowDuet: form.allowDuet && !screen.interactions.duetDisabled,
    allowStitch: form.allowStitch && !screen.interactions.stitchDisabled,
    commercial: {
      enabled,
      yourBrand: enabled && form.yourBrand,
      brandedContent: enabled && form.brandedContent,
    },
    isAigc: isAigcLocked(screen) ? true : form.isAigc,
    video: { url: screen.video.url, durationSec: probe.durationSec },
    declaration: { id: declaration.id, version: declaration.version, accepted: true },
  };
}

/** Can "Send to TikTok drafts" be offered at all (an API with the drafts path)? */
export function draftOffered(screen: TikTokPostScreenReady): boolean {
  return !!screen.draft;
}

/**
 * Whether "Send to TikTok drafts" may be pressed, and why not. Drafts skip
 * the Direct Post settings (TikTok's editor asks for them), but not the
 * account, the permission or the file's length check.
 */
export function draftGate(
  screen: TikTokPostScreenReady,
  probe: TikTokVideoProbe,
  ctx: { impersonated: boolean; busy?: boolean },
): PostGate {
  const no = (reason: string | null): PostGate => ({ canPost: false, reason });
  if (!screen.draft) return no(null);
  if (ctx.impersonated) return no(TIKTOK_COPY.staffRefusal);
  if (!screen.draft.available) return no(screen.draft.reason || null);
  if (!screen.creator?.openId) return no(TIKTOK_COPY.accountUnknown);
  const d = durationCheck(screen, probe);
  if (d.blocks) return no(d.message);
  if (ctx.busy) return no(null);
  return { canPost: true, reason: null };
}

/** The draft consent: the account and the file, nothing else. Null when draftGate refuses. */
export function buildTikTokDraftInput(screen: TikTokPostScreenReady, probe: TikTokVideoProbe): TikTokDraftInput | null {
  if (!draftGate(screen, probe, { impersonated: false }).canPost) return null;
  if (probe.durationSec === null) return null;
  return { mode: 'draft', creatorOpenId: screen.creator.openId, video: { url: screen.video.url, durationSec: probe.durationSec } };
}

/** The sentence before the press when a post made now would wait for actions, or null. */
export function actionsNotice(screen: TikTokPostScreenReady): string | null {
  if (!screen.actions || screen.actions.remaining > 0) return null;
  return screen.actions.paymentFailed ? TIKTOK_COPY.actionsPaymentFailed : TIKTOK_COPY.actionsEmpty;
}

/** "Post to TikTok" alone, "Approve and post" when other networks come along. */
export function postButtonLabel(otherTargets: string[]): string {
  return otherTargets.length === 0 ? TIKTOK_SCREEN_COPY.postButton : TIKTOK_SCREEN_COPY.approveAndPost;
}

// ── A post held for actions ─────────────────────────────────────────────

/*
 * A TikTok post the owner approved while their actions were used up waits
 * (NEEDS_ACTIONS) and goes out by itself when they come back. Until then the
 * owner can cancel it: TikTok's guideline 5 says the owner keeps full control
 * of what is posted. Any held item can be canceled now, not only TikTok's
 * (components/approvals/heldItems.ts canCancelHeld); a TikTok post keeps the
 * words below. Only the owner, never staff viewing as them.
 */

/** A row the owner cancelled while it waited (the API's result.cancelledByOwner). */
export function cancelledWhileHeld(approval: Pick<OperatorApproval, 'status' | 'result'>): boolean {
  const r = approval.result as { cancelledByOwner?: unknown } | null | undefined;
  return approval.status === 'REJECTED' && !!r && typeof r === 'object' && r.cancelledByOwner === true;
}

/** What the confirm dialog says will not happen, naming every network the post was going to. */
export function cancelHeldDetail(otherNetworkLabels: string[]): string {
  return otherNetworkLabels.length
    ? TIKTOK_SCREEN_COPY.cancelDetailOthers(otherNetworkLabels.join(', '))
    : TIKTOK_SCREEN_COPY.cancelDetail;
}

// ── After posting ───────────────────────────────────────────────────────

export type PublishTone = 'blue' | 'cyan' | 'rose' | 'mauve';

export interface PublishBadge { label: string; color: PublishTone }

/** The card's badge while TikTok is pending or after it answered. */
export function tiktokPublishBadge(p: TikTokPublishState): PublishBadge {
  switch (p.state) {
    case 'SENDING':
    case 'PROCESSING':
      return p.mode === 'draft'
        ? { label: TIKTOK_SCREEN_COPY.badge.sendingInbox, color: 'blue' }
        : { label: TIKTOK_SCREEN_COPY.badge.processing, color: 'blue' };
    case 'IN_INBOX': return { label: TIKTOK_SCREEN_COPY.badge.inInbox, color: 'blue' };
    case 'POSTED': return { label: TIKTOK_SCREEN_COPY.badge.posted, color: 'cyan' };
    case 'FAILED': return { label: TIKTOK_SCREEN_COPY.badge.failed, color: 'rose' };
    default: return { label: TIKTOK_SCREEN_COPY.badge.unconfirmed, color: 'mauve' };
  }
}

/** The sentence under the badge. The API writes it; this only fills a gap. */
export function tiktokPublishMessage(p: TikTokPublishState): string {
  if (typeof p.message === 'string' && p.message.trim()) return p.message;
  if (p.state === 'IN_INBOX') return TIKTOK_COPY.draftInbox;
  if (p.state === 'SENDING' || p.state === 'PROCESSING') return TIKTOK_COPY.processingNotice;
  if (p.state === 'POSTED') {
    if (p.mode === 'draft' || !p.privacyLevel) return TIKTOK_COPY.draftPosted;
    return TIKTOK_SCREEN_COPY.postedVisibleTo(PRIVACY_LABELS[p.privacyLevel] ?? p.privacyLevel);
  }
  if (p.state === 'FAILED') return TIKTOK_SCREEN_COPY.notPosted;
  return TIKTOK_SCREEN_COPY.notConfirmed;
}

/** The API's refusal for a TikTok post, without the tool's "tiktok: " prefix. */
function tiktokRefusal(error: string | undefined): string {
  const e = typeof error === 'string' ? error.trim().replace(/^tiktok:\s*/i, '') : '';
  return e || TIKTOK_COPY.notSent;
}

/**
 * Did the publish land on some networks and not others? The API says so
 * (`partial`) and words the missed half for the owner ("Your post did not go
 * out on Instagram."); an API from before the flag is read by its wording, old
 * ("These did not go through") or new.
 */
export function isPartialOutcome(
  res: Pick<DecideResult, 'status' | 'summary' | 'partial'> | null | undefined,
): boolean {
  if (!res || res.status !== 'EXECUTED') return false;
  if (res.partial === true) return true;
  const summary = typeof res.summary === 'string' ? res.summary : '';
  return /did not go through|did not go out on /i.test(summary);
}

/**
 * The line at the top of the inbox after a decision.
 *
 * "Sent to TikTok" is said only when the API says the TikTok leg was sent
 * (`tiktok` in its answer). A consent the API could not use is reported as
 * what happened to the approval: the refusal when it FAILED (the creator
 * cannot post now, the video changed, the account went public), the hold when
 * it is waiting for actions. A partial publish adds the networks that did not
 * go through, as before. Null when there is nothing to say.
 */
export function decideNotice(
  res: Pick<DecideResult, 'status' | 'summary' | 'partial' | 'error' | 'tiktok'> | null | undefined,
  ctx: { approved: boolean; tiktokConsentSent: boolean },
): string | null {
  const parts: string[] = [];
  const summary = typeof res?.summary === 'string' ? res.summary.trim() : '';
  if (res?.tiktok?.message) {
    parts.push(res.tiktok.message);
  } else if (ctx.approved && ctx.tiktokConsentSent) {
    if (res?.status === 'FAILED') parts.push(tiktokRefusal(res.error));
    else if (res?.status === 'NEEDS_ACTIONS') parts.push(summary || TIKTOK_COPY.heldTikTok);
  }
  if (ctx.approved && summary && isPartialOutcome(res) && !parts.includes(summary)) parts.push(summary);
  return parts.length ? parts.join(' ') : null;
}

/**
 * Still on its way to TikTok, so the inbox re-reads it often. A draft in the
 * owner's TikTok inbox is not: it waits on the owner, and the API checks it
 * hourly.
 */
export function isTikTokInFlight(p: TikTokPublishState | null | undefined): boolean {
  return !!p && (p.state === 'SENDING' || p.state === 'PROCESSING');
}

/**
 * Where a posted video is on TikTok: the video itself once TikTok gave its id
 * (only for a public post), otherwise the account's profile. Null until it is
 * posted, or when we do not know the account.
 */
export function tiktokPostLink(
  approval: Pick<OperatorApproval, 'tiktokPublish' | 'tiktokConsent'>,
): string | null {
  const p = approval.tiktokPublish;
  if (!p || p.state !== 'POSTED') return null;
  const raw = p.creatorUsername || approval.tiktokConsent?.creator?.username || '';
  const user = String(raw).trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9._]{1,64}$/.test(user)) return null;
  const id = p.postIds?.find((x) => /^\d{5,30}$/.test(x));
  return id ? `https://www.tiktok.com/@${user}/video/${id}` : `https://www.tiktok.com/@${user}`;
}

export function anyTikTokInFlight(rows: Array<Pick<OperatorApproval, 'tiktokPublish'>> | null | undefined): boolean {
  return !!rows?.some((r) => isTikTokInFlight(r.tiktokPublish));
}

export const POLL_FAST_MS = 15_000;
export const POLL_SLOW_MS = 60_000;
export const POLL_FAST_WINDOW_MS = 10 * 60_000;

/** Every 15 s for the first ten minutes of waiting, then every minute. */
export function pollDelayMs(pollingSince: number, now: number): number {
  return now - pollingSince < POLL_FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS;
}

// ── Blocked screen ──────────────────────────────────────────────────────

/**
 * Blocked codes where the API skips the TikTok leg and lets the other networks
 * go ahead (the "TikTok leg needs consent" test in the API contract is false).
 * For the other codes the leg still needs consent, so approving without it is
 * refused with TIKTOK_CONSENT_REQUIRED; offering that button would only
 * produce the refusal. TIKTOK_VIDEO_OTHER_PLATFORM is here too: a video on
 * another social or video platform is refused for TikTok only (TikTok's
 * Intended Use), so the other networks can still go ahead. So is
 * TIKTOK_VIDEO_HAS_TEXT: a WPMaven video with text or graphics drawn on it
 * cannot go to TikTok (Watermark Guidelines), and every other network can
 * still take it. So is TIKTOK_VIDEO_NOT_MADE_FOR_TIKTOK: a WPMaven video
 * whose footage was never checked for writing (a raw clip, a video made for
 * other networks) cannot go to TikTok either, and the other networks can.
 * So is TIKTOK_VIDEO_NOT_OUR_LINK: a WPMaven video linked from an address
 * that is not WPMaven's own is never sent to TikTok (what is there is not
 * the file that was checked), and the other networks can still take it.
 * So is TIKTOK_ACCOUNT_MUST_BE_PRIVATE (2026-09-25): until TikTok approves
 * WPMaven for public posting it only takes posts from a private account, and
 * a public TikTok used to hold the whole post back, Instagram and YouTube
 * included, until the owner made TikTok private, rejected the post or
 * disconnected TikTok. Now the others go ahead and TikTok is skipped.
 */
export const TIKTOK_LEG_SKIPPED_CODES: readonly string[] = [
  'TIKTOK_RAIL_CLOSED', 'TIKTOK_NOT_CONNECTED', 'TIKTOK_VIDEO_MISSING', 'TIKTOK_VIDEO_HAS_LOGO',
  'TIKTOK_VIDEO_HAS_BRANDING', 'TIKTOK_VIDEO_HAS_TEXT', 'TIKTOK_VIDEO_OTHER_PLATFORM',
  'TIKTOK_VIDEO_NOT_MADE_FOR_TIKTOK', 'TIKTOK_VIDEO_NOT_OUR_LINK', 'TIKTOK_ACCOUNT_MUST_BE_PRIVATE',
];

export function canApproveWithoutTikTok(code: string, otherTargets: string[]): boolean {
  return otherTargets.length > 0 && TIKTOK_LEG_SKIPPED_CODES.includes(code);
}

/** Codes where reconnecting TikTok is the fix. */
export function needsReconnect(code: string): boolean {
  return code === 'TIKTOK_RECONNECT' || code === 'TIKTOK_NOT_CONNECTED' || code === 'TIKTOK_SCOPE_MISSING';
}
