/**
 * The approval rows as the API sends them (GET /operators/approvals, the
 * decide answer), for both apps: the account's view (the dashboard) and a
 * site's view (the plugin, 2026-10-16), which carries a few fields of its
 * own (the end of OperatorApproval). Moved from the dashboard's
 * services/operators.ts, which re-exports them, so there is one copy.
 *
 * Types only: no runtime code.
 */
import type { SitePreviewData } from './sitePreview';

export type ApprovalStatus =
  | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED' | 'EXPIRED'
  /** The owner asked for a different version. This row's action never ran; a
   *  re-drafted approval pointing back at it (revisionOfId) took its place. */
  | 'CHANGES_REQUESTED'
  /** Approved work waiting on the action allowance. The owner already said
   *  yes and nothing broke: the month's actions ran out before the call could
   *  be made, so the API is holding the row and publishes it by itself when
   *  actions come back. Never render it as failed, and never as "waiting for
   *  you": there is no button for the owner to press. */
  | 'NEEDS_ACTIONS';

// ── TikTok Direct Post (mirrors the API's TikTok consent rules) ──
//
// TikTok's Content Sharing Guidelines make the owner choose every post
// setting on one screen, and the API refuses to send anything to TikTok
// without the consent object that screen produces. These types are the wire
// shape of that contract; keep them in step with the API file.

export type TikTokPrivacyLevel =
  | 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
export type TikTokDeclarationId = 'music' | 'branded_music';

/** How the owner sends it: Direct Post (video.publish) or to their TikTok drafts (video.upload). */
export type TikTokPostMode = 'direct' | 'draft';

/** What the Post to TikTok screen sends, as `tiktok` on decide, for a Direct Post. */
export interface TikTokConsentInput {
  /** Optional on the wire: without it the API reads a Direct Post. */
  mode?: 'direct';
  /** Echoed from GET /operators/approvals/:id/tiktok, so a swapped account is refused. */
  creatorOpenId: string;
  /** The exact caption from the textarea: never trimmed, cut, tagged or rewritten. */
  title: string;
  privacyLevel: TikTokPrivacyLevel;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  commercial: { enabled: boolean; yourBrand: boolean; brandedContent: boolean };
  isAigc: boolean;
  /** The URL the player showed, and the duration it reported on loadedmetadata. */
  video: { url: string; durationSec: number };
  declaration: { id: TikTokDeclarationId; version: string; accepted: true };
}

/**
 * "Send to TikTok drafts" (video.upload): only the file. The owner writes the
 * caption, picks the audience and posts it in TikTok's own editor.
 */
export interface TikTokDraftInput {
  mode: 'draft';
  creatorOpenId: string;
  video: { url: string; durationSec: number };
}

/**
 * What the API stored when the owner posted (operator_approvals.tiktokConsent).
 * A draft consent (mode 'draft') carries the account and the file only.
 */
export interface TikTokConsent {
  v: 1;
  mode?: TikTokPostMode;
  approvalId: string;
  userId: string;
  instanceId: string;
  creator: { openId: string; username: string; nickname: string };
  title?: string;
  privacyLevel?: TikTokPrivacyLevel;
  interactions?: { allowComment: boolean; allowDuet: boolean; allowStitch: boolean };
  commercial?: { enabled: boolean; yourBrand: boolean; brandedContent: boolean };
  isAigc?: boolean;
  isAigcLocked?: boolean;
  /** Draft only: a WPMaven render, so the owner is asked to label it as AI in TikTok. */
  aiMadeRender?: boolean;
  video: {
    url: string;
    source: 'wpmaven_render' | 'owner_url';
    assetToken: string | null;
    durationSec: number;
    clientDurationSec: number;
  };
  declaration?: { id: TikTokDeclarationId; version: string; text: string; acceptedAt: string };
  checkedAgainst?: {
    at: string;
    audited: boolean;
    privacyOptions: TikTokPrivacyLevel[];
    commentDisabled: boolean;
    duetDisabled: boolean;
    stitchDisabled: boolean;
    maxDurationSec: number;
  };
  consentedAt: string;
  expiresAt: string;
}

/** Where the TikTok leg stands after it was sent (operator_approvals.tiktokPublish). */
export interface TikTokPublishState {
  /** IN_INBOX: a draft TikTok delivered to the owner's TikTok inbox. */
  state: 'SENDING' | 'PROCESSING' | 'IN_INBOX' | 'POSTED' | 'FAILED' | 'UNCONFIRMED';
  /** Absent on rows from before drafts: a Direct Post. */
  mode?: TikTokPostMode;
  /** The sentence the card shows, written by the API. */
  message: string;
  /** Null for a draft: the owner chooses the audience in TikTok. */
  privacyLevel: TikTokPrivacyLevel | null;
  publishId: string | null;
  /** TikTok's id for the live post (publicaly_available_post_id), once it is public. */
  postIds?: string[];
  /** The TikTok username the post went to. */
  creatorUsername?: string;
  tiktokStatus?: string;
  failReason?: string;
  consumptionId?: string;
  sentAt: string;
  lastPolledAt?: string;
  nextPollAt?: string;
  polls: number;
  finishedAt?: string;
}

export interface TikTokDeclarationText {
  text: string;
  /** Link targets for phrases inside `text` (for example "Music Usage Confirmation"). */
  links: Array<{ label: string; href: string }> | Record<string, string>;
}

export interface TikTokPrivacyOption {
  value: TikTokPrivacyLevel;
  label: string;
  /** False for levels TikTok only allows once it has approved WPMaven. */
  available: boolean;
  note: string | null;
}

/** GET /operators/approvals/:id/tiktok when the TikTok leg can be posted. */
export interface TikTokPostScreenReady {
  approvalId: string;
  postable: true;
  /** avatarUrl is creator_info's, good for two hours, never stored. */
  creator: { openId: string; username: string; nickname: string; avatarUrl?: string | null };
  audited: boolean;
  accountMustBePrivate: boolean;
  /** The full creator_info list, in TikTok's order. Never a fixed list. */
  privacyOptions: TikTokPrivacyOption[];
  interactions: { commentDisabled: boolean; duetDisabled: boolean; stitchDisabled: boolean };
  maxDurationSec: number;
  brandedContent: { available: boolean; reason: string | null };
  video: { url: string; source: 'wpmaven_render' | 'owner_url'; durationSec: number | null; posterUrl: string | null };
  /** A WPMaven render is always labeled (locked true); an owner video starts unlabeled. */
  isAigc: { locked: boolean; value: boolean | null };
  title: { value: string; maxLength: number };
  otherTargets: string[];
  declarations: {
    version: string;
    music: TikTokDeclarationText;
    branded_music: TikTokDeclarationText;
  };
  processingNotice: string;
  /** Send to TikTok drafts (video.upload). Absent from an older API. */
  draft?: { available: boolean; reason: string | null; notice: string; aiNote: string | null };
  /** The action allowance, so a post that would wait for actions is said before the press. */
  actions?: {
    remaining: number; resetsAt: string | null; packsForSale: boolean;
    /** The last payment failed: nothing was used up, a post waits for the card. Absent on older APIs. */
    paymentFailed?: boolean;
  } | null;
}

export type TikTokBlockedCode =
  | 'TIKTOK_RAIL_CLOSED' | 'TIKTOK_NOT_CONNECTED' | 'TIKTOK_VIDEO_MISSING' | 'TIKTOK_VIDEO_HAS_LOGO'
  | 'TIKTOK_VIDEO_HAS_BRANDING' | 'TIKTOK_VIDEO_HAS_TEXT' | 'TIKTOK_VIDEO_OTHER_PLATFORM'
  | 'TIKTOK_VIDEO_NOT_MADE_FOR_TIKTOK' | 'TIKTOK_VIDEO_NOT_OUR_LINK'
  | 'TIKTOK_VIDEO_UNREADABLE' | 'TIKTOK_CANNOT_POST_NOW' | 'TIKTOK_RECONNECT' | 'TIKTOK_ACCOUNT_MUST_BE_PRIVATE'
  | 'TIKTOK_SCOPE_MISSING';

/** GET /operators/approvals/:id/tiktok when the TikTok leg cannot be posted right now. */
export interface TikTokPostScreenBlocked {
  approvalId: string;
  postable: false;
  blocked: { code: TikTokBlockedCode | string; message: string; retryable: boolean };
  otherTargets: string[];
}

export type TikTokPostScreen = TikTokPostScreenReady | TikTokPostScreenBlocked;

/** The decide answer. `tiktok` is present when the TikTok leg was sent. */
/**
 * The public link of a post an approved action published ("View on YouTube"),
 * read by the API from the approval's stored result (2026-09-29). TikTok's
 * link rides on tiktokPublish instead; YouTube is left out in a staff session.
 */
export interface PublishedLink {
  network: string;
  url: string;
  /** The API's words: "View on YouTube". */
  label: string;
}

export interface DecideResult {
  id: string;
  status: string;
  summary?: string;
  /** EXECUTED, but some networks did not take it; `summary` names them. */
  partial?: boolean;
  error?: string;
  tiktok?: { state: TikTokPublishState['state']; message: string; privacyLevel: TikTokPrivacyLevel | null; mode?: TikTokPostMode };
  /**
   * Held for actions (NEEDS_ACTIONS): the way to more actions, the pack when
   * one is for sale, else Billing (raw from the API: read with heldNextStep).
   */
  nextStep?: unknown;
  /** EXECUTED: the public links of what it published; [] otherwise. */
  links?: PublishedLink[];
  /**
   * Held because this month's actions are used up: buy the plan's pack and it
   * goes out now, or wait (raw from the API: read with ./heldPack).
   */
  packChoice?: unknown;
}

/**
 * The decide answer as a WordPress site reads it (the API's decisionForSite,
 * 2026-10-16): the row's outcome and its own sentence, never the owner's
 * pack offer, its price or the step to Billing. A held row says the site's
 * held sentence and where billing is.
 */
export interface SiteDecideResult {
  id: string;
  status: string;
  error?: string;
  summary?: string;
  partial?: boolean;
  held?: boolean;
  heldText?: string;
  dashboardPath?: string;
  links?: PublishedLink[];
  /** A made change to the site: where it shows. */
  liveUrl?: string;
}

export interface OperatorApproval {
  id: string;
  /**
   * A change to the site through the edit operations: the preview this
   * approval publishes (summary, checks, links, pictures), drawn by the
   * app's edit preview (renderers.editPreview). Absent for any other
   * approval, and from an API that does not send it yet.
   */
  edit?: unknown;
  /** EXECUTED: the public links of what it published ("View on YouTube"); [] otherwise. */
  links?: PublishedLink[];
  /** Which business this approval belongs to. Nullable in the schema, and
   *  needed to ask TikTok what that business's account may post, so the
   *  TikTok consent step is skipped when it is absent. */
  instanceId: string | null;
  operatorId: string;
  /** The same operator with its title, from the API (absent from an older API: the catalog's title then). */
  operator?: { id: string; title: string } | null;
  operatorTaskId: string | null;
  toolName: string;
  params: Record<string, unknown>;
  reason: string | null;
  status: ApprovalStatus;
  decidedAt: string | null;
  executedAt: string | null;
  error: string | null;
  /** What the owner asked to be different, on the row they said it about. */
  revisionNote: string | null;
  /** The approval this one re-drafts, so a card can say "version 2". */
  revisionOfId: string | null;
  /** 0 for a first draft, +1 per re-draft. */
  revisionRound: number;
  createdAt: string;
  task?: { id: string; title: string; operatorId: string; channel: string | null } | null;
  /** Every network the action reaches, computed by the API (including the
   *  old crosspost_video default). Optional only because an older API does
   *  not send it; ./targets falls back to params then. */
  targets?: string[];
  /** Server truth for "this row posts to TikTok". A TikTok row is approved on
   *  the Post to TikTok screen and nowhere else. */
  goesToTikTok?: boolean;
  /** Server truth for "this row changes the customer's site" (every change
   *  waits for the owner, 2026-09-22). Only the owner can approve one. */
  changesSite?: boolean;
  /** False when the row has no wording to rewrite (a site change): the inbox
   *  offers approve and reject only. Absent from an older API. */
  revisable?: boolean;
  /**
   * Approved on its card only, where all of it is shown (the API's
   * approvesOnCardOnly): a database write whose plain words
   * cannot say all it changes. Home sends the owner to the card instead of
   * offering Approve, and the card opens its Action details.
   */
  approveOnCard?: boolean;
  /** The owner's recorded TikTok consent, or null. */
  tiktokConsent?: TikTokConsent | null;
  /** Where the TikTok leg stands after posting, or null. */
  tiktokPublish?: TikTokPublishState | null;
  /**
   * The stored outcome snapshot; `{ cancelledByOwner: true }` on a held item
   * the owner canceled, and `{ staleHoldSince }` on one held past 72 hours
   * that the API asked again (PENDING again; ./heldItems).
   */
  result?: unknown;
  /**
   * Which accounts a post goes out as, in the API's words: "On Instagram as
   * @coppersmith and on Facebook as Copper Kettle." Null for anything that is
   * not a post to Instagram or Facebook (./postingAccounts).
   */
  postingAccounts?: string | null;
  /**
   * On a held row (NEEDS_ACTIONS), and on an older row the allowance stopped
   * (outOfActions): the way to more actions its card offers, the pack when
   * one is for sale, else Billing (raw from the API: read with
   * cardMoreActionsStep). Absent from an older API.
   */
  nextStep?: unknown;
  /**
   * An older row filed FAILED when the action allowance ran out (before
   * holding existed): shown as paused, with the way to more actions in
   * nextStep. Absent from an older API.
   */
  outOfActions?: boolean;
  /**
   * Held because this month's actions are used up: the
   * two choices, buy the plan's pack and it goes out now, or wait until the
   * actions come back (raw from the API: read with ./heldPack). Absent in
   * the $1 week, on a failed payment and on a plan that sells no pack.
   */
  packChoice?: unknown;
  /** A post, page, product or translation the row would put on the site,
   *  ready to draw as the site will show it (sanitized HTML, the site's
   *  address, its colors). Null for anything else; absent from an older API
   *  (./sitePreview reads params then). */
  sitePreview?: SitePreviewData | null;
  /**
   * Per-network facts the owner must see before approving, from the API
   * (e.g. "X and LinkedIn get the text only; the image is not posted
   * there."). Drawn next to the target chips. Absent from an older API.
   */
  networkNotes?: NetworkNote[] | null;
  /**
   * A shared video's second post (crosspost_video): its own words, the
   * video's link shown as "[link to the video]", and the networks it goes out
   * on by name. Shown on the card under the caption. Null when
   * there is none; absent from an older API (previewData reads params then).
   */
  linkPost?: { networks: string[]; text: string } | null;
  /**
   * Set on a row that uploads a video to YouTube, null on every other row
   * (the API's GET /operators/approvals). The card's
   * "Post to YouTube" section: YouTube's API Services Developer Policies
   * (III.C.3, III.E) want the owner to have the final say on what is
   * uploaded, so the card shows the title and the description YouTube will
   * get, in fields the owner edits, and asks who can see it (Public, Unlisted
   * or Private) and whether it is made for kids. The approve carries all four
   * as `youtube`, and YouTube gets exactly that; the API refuses an approve
   * without them (400 YOUTUBE_PRIVACY_REQUIRED, YOUTUBE_UPLOAD_REQUIRED or
   * YOUTUBE_UPLOAD_INVALID). The card always starts with nothing chosen; what
   * the owner asked for before (`privacy` with `chosenByOwner`, or the team's
   * `suggested` when it is in the owner's own words) is only a hint line
   * (./youtubeVisibility). Absent from an older API
   * (./targets reads the targets then).
   */
  youtube?: YouTubeChoice | null;
  /**
   * The label of the video the row would post, when it is one of ours
   * (the API's GET /operators/approvals reads the VideoAsset): its label,
   * and `onVideo`, whether the small "Includes AI" mark is on the picture
   * (false for a video made for TikTok, null when not recorded). Null for
   * every other row; absent from an older API. The card's note beside the
   * player reads it (./videoLabel approvalLabelNote).
   */
  videoLabel?: { label: string; onVideo: boolean | null } | null;

  // ── The site's view (GET /operators/approvals from a WordPress site) ──
  // Only a site's list carries these (the API's approvalForSite,
  // 2026-10-16); the dashboard never reads them.

  /**
   * A post to TikTok or an upload to YouTube: its settings are chosen in the
   * dashboard, so the site may decline it or ask for changes, never approve
   * it. `approveInDashboardText` says so and `dashboardPath` is the card there.
   */
  approveInDashboard?: boolean;
  approveInDashboardText?: string;
  /** Where the dashboard shows this row: the TikTok or YouTube card, or Billing for a held one. */
  dashboardPath?: string;
  /** Money (a refund, a cancelled order, a payments setup): decided by the owner's own account only. */
  ownerOnly?: boolean;
  /** Whether this WordPress user may decide it (the owner's own account). */
  decidable?: boolean;
  /** Said instead of the decision when this WordPress user may not decide it. */
  ownerOnlyText?: string;
  /** A made change (EXECUTED): where it shows on the site. */
  liveUrl?: string;
  /** Approved and waiting for the plan's actions (NEEDS_ACTIONS), in the site's words. */
  held?: boolean;
  heldText?: string;
  /** The caption's AI line on a post, as the API words it. */
  aiCaptionLine?: string | null;
}

/** Who can see a video on YouTube, as YouTube names it (status.privacyStatus). */
export type YouTubePrivacy = 'public' | 'unlisted' | 'private';

/** The YouTube visibility question on an approval that uploads to YouTube. */
export interface YouTubeChoice {
  /**
   * The owner's own choice (made on their card, or sent by their own request
   * that filed the row), else null. An older API sent here what the AI team
   * filled in. Shown as a hint, never preselected.
   */
  privacy: YouTubePrivacy | null;
  /** True exactly when `privacy` is the owner's own choice. Absent from an older API. */
  chosenByOwner?: boolean;
  /**
   * What the AI team passed, sent only when the owner's own messages in that
   * conversation named it (suggestedFromOwnerWords). A hint, never
   * preselected. Null whenever `chosenByOwner` is true; absent from an older API.
   */
  suggested?: YouTubePrivacy | null;
  /**
   * True when `suggested` is in the owner's own words (the API read their
   * messages). The team's hint is shown only then; absent from an older API,
   * which could not say, so no hint is shown for it.
   */
  suggestedFromOwnerWords?: boolean;
  options: Array<{ value: YouTubePrivacy; label: string }>;
  /**
   * The title the card's field starts on: the AI team's proposal, else the
   * post's first line (or what the owner approved before, on a row that came
   * back). The owner edits it; YouTube gets exactly what they approve.
   */
  title?: string;
  /** The description the card's field starts on, the same way. */
  description?: string;
  /** YouTube is told the video is altered or synthetic content (a video WPMaven made with AI). */
  syntheticMedia?: boolean;
  /** YouTube's limits, for the counters: 100 characters, 5,000 bytes. */
  titleMaxChars?: number;
  descriptionMaxBytes?: number;
}

/**
 * The YouTube upload as the card shows it, sent as `youtube` with an approve
 * (the API's YouTube upload): uploaded exactly as it is.
 */
export interface YouTubeUploadInput {
  title: string;
  description: string;
  privacyStatus: YouTubePrivacy;
  madeForKids: boolean;
}

/** One network's fact on an approval card. */
export interface NetworkNote {
  network: string;
  note: string;
}

