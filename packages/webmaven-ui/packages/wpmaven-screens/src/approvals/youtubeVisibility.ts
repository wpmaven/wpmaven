/**
 * What a video WPMaven uploads to the owner's YouTube channel is, exactly:
 * the card's "Post to YouTube" section (YouTubeUploadSection.tsx).
 *
 * YouTube's API Services Developer Policies want the owner to have the final
 * say. III.C.3: a client "must not modify user-provided values before sending
 * them to YouTube by truncating, appending, or otherwise altering those
 * values"; III.E: an upload client must "clearly display an option for the
 * user to choose" public, private or unlisted. So every card that can approve
 * an upload shows:
 *  - the title and the description YouTube will get, in fields the owner
 *    edits, with YouTube's limits counted the way YouTube counts them (100
 *    characters for the title, 5,000 bytes for the description) and what
 *    YouTube refuses ("<" and ">", an empty title, over a limit) said under
 *    the field. Nothing is cut or changed for the owner: Approve waits until
 *    they fix it;
 *  - "Who can see this video on YouTube?", always starting with nothing
 *    chosen (2026-09-25): what the owner asked for before, in the chat or in
 *    their own request, is a hint line above the three choices, never
 *    preselected or sent for them;
 *  - "Is this video made for kids?", Yes or No, nothing chosen: WPMaven no
 *    longer answers it for them;
 *  - for a video WPMaven made with AI, that YouTube will show it as altered
 *    or synthetic content.
 * Approve waits for all of it, saying so beside it, and the approve carries
 * the four values as `youtube`; YouTube gets exactly that. The API refuses an
 * approve without them (400 YOUTUBE_PRIVACY_REQUIRED, or
 * YOUTUBE_UPLOAD_REQUIRED from a card loaded before this change), so a card
 * that did not know the row goes to YouTube shows the section when it is told.
 * A site's card (the plugin) never shows it: an upload to YouTube is approved
 * in the dashboard (ApprovalCard), and the API refuses `youtube` from a site.
 *
 * WPMaven only links a video's YouTube copy from the other networks when it
 * is public there, so Unlisted or Private on a row that also posts elsewhere
 * says, next to the choice, that those posts carry no link to it.
 *
 * The rules live here and the components (YouTubeUploadSection.tsx,
 * YouTubeVisibilityChoice.tsx) only draw them. No runtime imports beyond
 * ./targets (which has none), so the node unit tests load this file as it is.
 * The API holds the same rules.
 */

import type {
  OperatorApproval, TikTokConsentInput, TikTokDraftInput, YouTubePrivacy, YouTubeUploadInput,
} from './types';
import { approvalGoesToYouTube, approvalTargets } from './targets';

export const YOUTUBE_PRIVACY_VALUES: readonly YouTubePrivacy[] = ['public', 'unlisted', 'private'];

/** YouTube's limits: a title of 100 characters, a description of 5,000 bytes. */
export const YOUTUBE_TITLE_MAX_CHARS = 100;
export const YOUTUBE_DESCRIPTION_MAX_BYTES = 5000;

/** The words, so a test can pin them without copying them. */
export const YOUTUBE_VISIBILITY_COPY = {
  question: 'Who can see this video on YouTube?',
  labels: { public: 'Public', unlisted: 'Unlisted', private: 'Private' } as Record<YouTubePrivacy, string>,
  /** What each choice means, after "<label>: ". */
  hints: {
    public: 'anyone can find and watch it.',
    unlisted: 'only people with the link.',
    private: 'only you.',
  } as Record<YouTubePrivacy, string>,
  /** Beside a disabled Approve until a choice is made. */
  approveBlocked: 'Choose who can see this video on YouTube to approve.',
  /** The same item in the Post to TikTok screen's checklist. */
  todo: 'Choose who can see this video on YouTube',
  /** Staff viewing as the owner (the API answers 409 YOUTUBE_OWNER_ONLY). */
  staffRefusal: 'Only the owner can approve an upload to their YouTube channel.',
  /** The one-click surfaces (Home) send the owner to the card instead. */
  routeButton: 'Review and post to YouTube',
  routeFirst: 'Check its YouTube title and description and choose the settings first.',
  /** The staff console: approving for the owner is refused. */
  staffConsoleApprove: "This uploads to the customer's YouTube channel: only the owner can approve it",
  /** The hint line: a visibility the owner chose themselves (their own request filed the row). */
  hintOwner: (label: string) => `You asked for ${label}.`,
  /**
   * The hint line: a visibility the AI team passed, shown only when the API
   * found it in the owner's own messages in that conversation
   * (suggestedFromOwnerWords). A card once said this to an owner who had
   * never named one (2026-09-29).
   */
  hintTeam: (label: string) => `Your team noted you asked for ${label} in the chat.`,
  /** Next to the choice: Unlisted or Private on a row that also posts to other networks. */
  notLinked: 'Private and unlisted videos are not linked from your other networks.',
} as const;

/**
 * The rest of the "Post to YouTube" section. Plain American English, no em
 * dashes, in the tone of the Post to TikTok screen. A problem with a text
 * says what is wrong (the API's own sentences, services/youtubeUpload.ts),
 * never what WPMaven would change.
 */
export const YOUTUBE_UPLOAD_COPY = {
  heading: 'Post to YouTube',
  intro: 'YouTube gets exactly what you see here. Nothing is sent until you approve.',
  titleLabel: 'Title',
  titleHelper: 'This is exactly what YouTube will show as the title.',
  descriptionLabel: 'Description',
  descriptionHelper: 'This is exactly what YouTube will show under the video. Emoji and accented letters count as more than 1 byte.',
  kidsQuestion: 'Is this video made for kids?',
  kidsYes: 'Yes, it is made for kids',
  kidsNo: 'No, it is not made for kids',
  kidsHelper: 'YouTube asks this for every video. Videos made for kids have some features turned off, such as comments.',
  aiDisclosure: 'This video was made with AI. YouTube will show it as altered or synthetic content.',
  titleEmpty: 'The title is empty. YouTube needs one.',
  titleLineBreak: 'The title has a line break. A YouTube title is one line.',
  titleAngle: 'The title has < or >, which YouTube does not allow.',
  titleUnreadable: 'The title has a character YouTube cannot read.',
  titleTooLong: (chars: number) => `The title is ${chars} characters. YouTube allows up to ${YOUTUBE_TITLE_MAX_CHARS}.`,
  descriptionAngle: 'The description has < or >, which YouTube does not allow.',
  descriptionUnreadable: 'The description has a character YouTube cannot read.',
  descriptionTooLong: (bytes: number) => `The description is ${bytes.toLocaleString('en-US')} bytes. `
    + `YouTube allows up to ${YOUTUBE_DESCRIPTION_MAX_BYTES.toLocaleString('en-US')}.`,
  /** Beside a disabled Approve, and their Post to TikTok checklist items. */
  titleBlocked: 'Fix the YouTube title to approve.',
  titleTodo: 'Fix the YouTube title',
  descriptionBlocked: 'Fix the YouTube description to approve.',
  descriptionTodo: 'Fix the YouTube description',
  kidsBlocked: 'Choose whether this video is made for kids to approve.',
  kidsTodo: 'Choose whether the video is made for kids',
} as const;

/** The API's error codes for an approve without the YouTube values: the card asks. */
export const YOUTUBE_PRIVACY_REQUIRED = 'YOUTUBE_PRIVACY_REQUIRED';
export const YOUTUBE_UPLOAD_REQUIRED = 'YOUTUBE_UPLOAD_REQUIRED';

/** A valid YouTube visibility, or null. Case and spaces are forgiven, as the API does. */
export function parseYouTubePrivacy(v: unknown): YouTubePrivacy | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  return (YOUTUBE_PRIVACY_VALUES as readonly string[]).includes(t) ? (t as YouTubePrivacy) : null;
}

// ── The title and the description, as YouTube counts them ──────────────

/** A title's length as YouTube counts characters: Unicode code points (an emoji is one). */
export function youtubeTitleLength(title: string): number {
  return [...title].length;
}

/** A description's size as YouTube counts it: UTF-8 bytes. */
export function youtubeDescriptionBytes(description: string): number {
  let bytes = 0;
  for (const ch of description) {
    const cp = ch.codePointAt(0)!;
    // A lone surrogate is written as U+FFFD, three bytes, as the browser encodes it.
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** No lone surrogate: every character can be written as UTF-8. */
function wellFormed(s: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

/** Why YouTube would refuse this title, or null when it takes it as it is. */
export function youtubeTitleProblem(title: string): string | null {
  const c = YOUTUBE_UPLOAD_COPY;
  if (title.trim().length === 0) return c.titleEmpty;
  if (/[\r\n\u2028\u2029]/.test(title)) return c.titleLineBreak;
  if (/[<>]/.test(title)) return c.titleAngle;
  if (!wellFormed(title)) return c.titleUnreadable;
  const chars = youtubeTitleLength(title);
  if (chars > YOUTUBE_TITLE_MAX_CHARS) return c.titleTooLong(chars);
  return null;
}

/** Why YouTube would refuse this description, or null. An empty one is fine. */
export function youtubeDescriptionProblem(description: string): string | null {
  const c = YOUTUBE_UPLOAD_COPY;
  if (/[<>]/.test(description)) return c.descriptionAngle;
  if (!wellFormed(description)) return c.descriptionUnreadable;
  const bytes = youtubeDescriptionBytes(description);
  if (bytes > YOUTUBE_DESCRIPTION_MAX_BYTES) return c.descriptionTooLong(bytes);
  return null;
}

// ── The card's state ───────────────────────────────────────────────────

/** What the "Post to YouTube" section holds while the owner fills it in. */
export interface YouTubeUploadForm {
  /** Exactly what the title field shows. */
  title: string;
  /** Exactly what the description field shows. */
  description: string;
  /** Null until the owner chooses. */
  privacy: YouTubePrivacy | null;
  /** Null until the owner answers. */
  madeForKids: boolean | null;
}

type YouTubeSource = Pick<OperatorApproval, 'params'>
  & Partial<Pick<OperatorApproval, 'toolName' | 'targets' | 'goesToTikTok' | 'youtube'>>;

/**
 * The section as it opens: the API's proposed title and description, and
 * nothing chosen. A row from an API that sent no proposal opens with empty
 * fields (the owner writes them; YouTube needs a title).
 */
export function initialYouTubeForm(a: YouTubeSource): YouTubeUploadForm {
  const yt = a.youtube;
  return {
    title: typeof yt?.title === 'string' ? yt.title : '',
    description: typeof yt?.description === 'string' ? yt.description : '',
    privacy: null,
    madeForKids: null,
  };
}

/** Does YouTube get told this video is altered or synthetic content (the API says so)? */
export function youtubeSyntheticMedia(a: YouTubeSource): boolean {
  return a.youtube?.syntheticMedia === true;
}

/** One thing the section still needs, top to bottom, with where it is. */
export interface YouTubeFormMissing {
  field: 'title' | 'description' | 'privacy' | 'madeForKids';
  /** Beside the disabled Approve. */
  reason: string;
  /** The Post to TikTok screen's checklist item. */
  todo: string;
}

/** The first thing the section still needs, or null when it can be approved as it is. */
export function youtubeFormMissing(form: YouTubeUploadForm): YouTubeFormMissing | null {
  const c = YOUTUBE_UPLOAD_COPY;
  if (youtubeTitleProblem(form.title)) return { field: 'title', reason: c.titleBlocked, todo: c.titleTodo };
  if (youtubeDescriptionProblem(form.description)) return { field: 'description', reason: c.descriptionBlocked, todo: c.descriptionTodo };
  if (!parseYouTubePrivacy(form.privacy)) {
    return { field: 'privacy', reason: YOUTUBE_VISIBILITY_COPY.approveBlocked, todo: YOUTUBE_VISIBILITY_COPY.todo };
  }
  if (typeof form.madeForKids !== 'boolean') return { field: 'madeForKids', reason: c.kidsBlocked, todo: c.kidsTodo };
  return null;
}

/** The id of one part of the section, under the section's own id (youtubeChoiceId). */
export function youtubeFieldId(sectionId: string, field: YouTubeFormMissing['field']): string {
  if (field === 'privacy') return `${sectionId}-visibility`;
  if (field === 'madeForKids') return `${sectionId}-kids`;
  return `${sectionId}-${field}`;
}

/**
 * What the owner asked for before this card, and who says so: `owner` when
 * the API marks it as their own choice (chosenByOwner), `team` when the AI
 * team passed it and the API found it in the owner's own messages
 * (suggestedFromOwnerWords). Anything else is no hint at all: a visibility
 * the team filled in by itself, or one from an older API that cannot say
 * where it came from, would claim the owner asked for something they never
 * said (2026-09-29: "Your team noted you asked for Public in the chat." to an
 * owner who had only asked to post a video on YouTube). Never what the card
 * starts on: the card always starts with nothing chosen.
 */
export function youtubeAskedFor(a: YouTubeSource): { value: YouTubePrivacy; by: 'owner' | 'team' } | null {
  const yt = a.youtube;
  if (!yt) return null;
  if (yt.chosenByOwner === true) {
    const value = parseYouTubePrivacy(yt.privacy);
    return value ? { value, by: 'owner' } : null;
  }
  if (yt.suggestedFromOwnerWords !== true) return null;
  const value = parseYouTubePrivacy(yt.suggested);
  return value ? { value, by: 'team' } : null;
}

/**
 * The hint line above the choices: "You asked for Unlisted." (the owner's
 * own request) or "Your team noted you asked for Unlisted in the chat."
 * (the AI team's note). Null when nothing was asked for. The label is the
 * one the card shows for that choice.
 */
export function youtubeChoiceHint(a: YouTubeSource): string | null {
  const asked = youtubeAskedFor(a);
  if (!asked) return null;
  const label = youtubeOptions(a).find((o) => o.value === asked.value)?.label
    ?? YOUTUBE_VISIBILITY_COPY.labels[asked.value];
  return asked.by === 'owner' ? YOUTUBE_VISIBILITY_COPY.hintOwner(label) : YOUTUBE_VISIBILITY_COPY.hintTeam(label);
}

/**
 * Next to the choice, once it is Unlisted or Private on a row that also
 * posts to other networks: those posts carry no link to the video, because
 * WPMaven only links a public YouTube copy. Null otherwise.
 */
export function youtubeNotLinkedNote(a: YouTubeSource, choice: YouTubePrivacy | null | undefined): string | null {
  const value = parseYouTubePrivacy(choice);
  if (value !== 'unlisted' && value !== 'private') return null;
  const others = approvalTargets(a).filter((t) => t !== 'youtube');
  return others.length > 0 ? YOUTUBE_VISIBILITY_COPY.notLinked : null;
}

export interface YouTubeOption {
  value: YouTubePrivacy;
  label: string;
  /** "Public: anyone can find and watch it." */
  line: string;
}

/**
 * The three choices, in the API's order and with its labels when it sent
 * them (anything it sent that is not a YouTube visibility is left out), else
 * Public, Unlisted, Private. Each with its line.
 */
export function youtubeOptions(a: YouTubeSource): YouTubeOption[] {
  const c = YOUTUBE_VISIBILITY_COPY;
  const fromApi = Array.isArray(a.youtube?.options) ? a.youtube!.options : [];
  const seen = new Set<YouTubePrivacy>();
  const out: YouTubeOption[] = [];
  for (const o of fromApi) {
    const value = parseYouTubePrivacy(o?.value);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : c.labels[value];
    out.push({ value, label, line: `${label}: ${c.hints[value]}` });
  }
  // YouTube's policy is the three of them: an answer missing one is not what
  // the owner is shown.
  if (out.length !== YOUTUBE_PRIVACY_VALUES.length) {
    return YOUTUBE_PRIVACY_VALUES.map((value) => ({ value, label: c.labels[value], line: `${c.labels[value]}: ${c.hints[value]}` }));
  }
  return out;
}

/**
 * Does this card show the "Post to YouTube" section? A waiting row that
 * uploads to YouTube, or one the API said needs it (`asked`: it refused an
 * approve with YOUTUBE_PRIVACY_REQUIRED or YOUTUBE_UPLOAD_REQUIRED).
 */
export function asksYouTubeVisibility(
  a: YouTubeSource & Partial<Pick<OperatorApproval, 'status'>>,
  asked = false,
): boolean {
  if (a.status !== undefined && a.status !== 'PENDING') return false;
  return asked || approvalGoesToYouTube(a);
}

/**
 * Why Approve cannot be pressed yet because of YouTube, written beside it,
 * or null. Staff viewing as the owner can never approve an upload to the
 * owner's channel; the owner can once the section is complete and YouTube
 * would take it as it is.
 */
export function youtubeApproveBlock(opts: {
  asks: boolean;
  form: YouTubeUploadForm;
  locked?: boolean;
}): string | null {
  if (!opts.asks) return null;
  if (opts.locked) return YOUTUBE_VISIBILITY_COPY.staffRefusal;
  return youtubeFormMissing(opts.form)?.reason ?? null;
}

/**
 * The value the approve carries: the section exactly as it shows, when the
 * card asks and it is complete; else nothing. Never trimmed, cut or changed.
 */
export function youtubeUploadToSend(asks: boolean, form: YouTubeUploadForm): YouTubeUploadInput | undefined {
  if (!asks || youtubeFormMissing(form)) return undefined;
  return {
    title: form.title,
    description: form.description,
    privacyStatus: parseYouTubePrivacy(form.privacy)!,
    madeForKids: form.madeForKids as boolean,
  };
}

/** True when the API refused an approve because the YouTube values were missing. */
export function isYouTubePrivacyRequired(e: unknown): boolean {
  const data = (e as { response?: { data?: { code?: unknown } } } | null)?.response?.data;
  return !!data && (data.code === YOUTUBE_PRIVACY_REQUIRED || data.code === YOUTUBE_UPLOAD_REQUIRED);
}

/** The id of a card's section, so a refusal or a checklist item can bring the owner to it. */
export function youtubeChoiceId(approvalId: string, surface: string): string {
  return `yt-visibility-${surface}-${approvalId}`;
}

/** What became of a decision sent from a card. */
export type DecisionOutcome<R> =
  /** The API took it. */
  | { kind: 'sent'; result: R }
  /**
   * Nothing was approved: the card must ask for the YouTube values (they are
   * not complete yet, or the API refused with YOUTUBE_PRIVACY_REQUIRED).
   */
  | { kind: 'ask' }
  /** Any other refusal or failure, for the card to say. */
  | { kind: 'failed'; error: unknown };

/**
 * Send one decision from a card, with the YouTube rule every card shares: an
 * approve that asks for the YouTube values carries them as `youtube`, exactly
 * as the section shows them, is not sent at all until they are complete, and
 * a refusal for want of them (400 YOUTUBE_PRIVACY_REQUIRED, a row the card
 * did not know goes to YouTube) turns into the section rather than an error.
 * A reject carries nothing and is never turned into a question.
 */
export async function sendDecision<R>(opts: {
  approved: boolean;
  /** Does this card ask for the YouTube values (asksYouTubeVisibility)? */
  asks: boolean;
  form: YouTubeUploadForm | null;
  send: (youtube: YouTubeUploadInput | undefined) => Promise<R>;
}): Promise<DecisionOutcome<R>> {
  const youtube = opts.approved && opts.form ? youtubeUploadToSend(opts.asks, opts.form) : undefined;
  if (opts.approved && opts.asks && !youtube) return { kind: 'ask' };
  try {
    return { kind: 'sent', result: await opts.send(youtube) };
  } catch (error) {
    if (opts.approved && isYouTubePrivacyRequired(error)) return { kind: 'ask' };
    return { kind: 'failed', error };
  }
}

/**
 * A card's decide call, as operatorsService.decide takes it: the row, the
 * decision, the Post to TikTok consent (if any), and the YouTube upload (an
 * approve of an upload to YouTube only).
 */
export type CardDecide<R> = (
  id: string,
  approved: boolean,
  tiktok?: TikTokConsentInput | TikTokDraftInput,
  youtube?: YouTubeUploadInput,
) => Promise<R>;

/** What a card knows about the row it decides. */
export type CardRow = YouTubeSource & Pick<OperatorApproval, 'id'> & Partial<Pick<OperatorApproval, 'status'>>;

/**
 * Approve or reject from a card (Waiting for you, Your team > Approvals).
 * The one place the card's YouTube section meets the decide call: the card
 * asks when the row uploads to YouTube or the API already asked (`asked`),
 * an approve that asks carries the section as `youtube` and is not sent
 * until it is complete, and a 400 YOUTUBE_PRIVACY_REQUIRED turns into the
 * section. `asked` in the answer is what the card keeps: true from the first
 * refusal on, so the section stays on the card until it is complete. What
 * the owner asked for before (the API's `privacy` or `suggested`) is a hint
 * on the card, never sent for them.
 */
export async function decideFromCard<R>(opts: {
  row: CardRow;
  approved: boolean;
  /** The card's section as it shows now. */
  form: YouTubeUploadForm | null;
  /** The API already refused an approve on this card for want of the YouTube values. */
  asked: boolean;
  decide: CardDecide<R>;
}): Promise<{ outcome: DecisionOutcome<R>; asked: boolean }> {
  const { row, approved, decide } = opts;
  const outcome = await sendDecision({
    approved,
    asks: asksYouTubeVisibility(row, opts.asked),
    form: opts.form,
    send: (youtube) => decide(row.id, approved, undefined, youtube),
  });
  return { outcome, asked: opts.asked || outcome.kind === 'ask' };
}

/**
 * Approve from the card's Post to TikTok screen, for a video that may go to
 * YouTube too: the TikTok consent (or nothing, when only the other networks
 * go out) with the card's YouTube section. A 400 YOUTUBE_PRIVACY_REQUIRED
 * calls `onAsk` (the card shows the section, and the screen's buttons wait
 * for it), and every error is thrown on, so the screen says the API's
 * sentence above its button.
 */
export async function approveWithTikTokFromCard<R>(opts: {
  row: CardRow;
  tiktok: TikTokConsentInput | TikTokDraftInput | undefined;
  form: YouTubeUploadForm | null;
  asked: boolean;
  decide: CardDecide<R>;
  onAsk: () => void;
}): Promise<R> {
  const { row } = opts;
  const youtube = opts.form ? youtubeUploadToSend(asksYouTubeVisibility(row, opts.asked), opts.form) : undefined;
  try {
    return await opts.decide(row.id, true, opts.tiktok, youtube);
  } catch (e) {
    if (isYouTubePrivacyRequired(e)) opts.onAsk();
    throw e;
  }
}

/** Something outside the Post to TikTok screen that holds its buttons (TikTokConsent's OutsideRequirement). */
export interface YouTubeOutsideRequirement {
  reason: string;
  todo: string;
  elementId: string;
}

/**
 * What the Post to TikTok screen waits for, from the card's YouTube section:
 * the reason beside its buttons, its checklist item, and the part of the
 * section to go to. Null when nothing is missing, and for staff viewing as
 * the owner (the screen already says they cannot post).
 */
export function youtubeAlsoNeeded(opts: {
  block: string | null;
  locked: boolean;
  /** The section's id (youtubeChoiceId). */
  elementId: string;
  /** The section as it shows now: names the item and the field to go to. */
  form?: YouTubeUploadForm | null;
}): YouTubeOutsideRequirement | null {
  if (!opts.block || opts.locked) return null;
  const missing = opts.form ? youtubeFormMissing(opts.form) : null;
  if (missing && missing.reason === opts.block) {
    return { reason: opts.block, todo: missing.todo, elementId: youtubeFieldId(opts.elementId, missing.field) };
  }
  return { reason: opts.block, todo: YOUTUBE_VISIBILITY_COPY.todo, elementId: opts.elementId };
}
