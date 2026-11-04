/**
 * What an approval card says about a video, for both apps: the AI label
 * beside a video we made, and a video to choose (pricing v4), which is
 * skipped rather than rejected. Moved from the dashboard's lib/videoChoice,
 * which re-exports these and keeps the choice screen's own rules.
 *
 * No runtime imports, so the node tests load it directly.
 */

/** A video's AI label, as the API names it (the VideoAsset's label). */
export type VideoLabel = 'ai_generated' | 'ai_voice' | 'ai_music' | 'ai_voice_music' | 'none';

const LABELS: readonly VideoLabel[] = ['ai_generated', 'ai_voice', 'ai_music', 'ai_voice_music', 'none'];

export function isVideoLabel(v: unknown): v is VideoLabel {
  return typeof v === 'string' && (LABELS as readonly string[]).includes(v);
}

/** The note under a video made for TikTok: no text is drawn on it, TikTok labels it. */
export const LABEL_NOTE_TIKTOK = 'Made for TikTok, so there is no mark on the video itself. TikTok labels it as AI-generated.';

/**
 * Said under a finished video's player: the mark is in the file, not only
 * here (the same small "Includes AI" mark for every label). `onVideo` false
 * (the API's labelOnVideo or an approval's videoLabel.onVideo): a video made
 * for TikTok, which carries no text at all, so TikTok's own label is named
 * instead.
 */
export function labelNote(label: VideoLabel | string | null | undefined, onVideo?: boolean | null): string | null {
  if (label === 'ai_generated' || label === 'ai_voice' || label === 'ai_music' || label === 'ai_voice_music') {
    if (onVideo === false) return LABEL_NOTE_TIKTOK;
    return 'Marked "Includes AI" on the video itself, and the post says so too.';
  }
  return null;
}

/**
 * The label of the video an approval would post, when the API says it
 * (`params.videoLabel`, read from the VideoAsset). Null when not said.
 */
export function videoLabelFrom(params: unknown): VideoLabel | null {
  if (!params || typeof params !== 'object') return null;
  const v = (params as Record<string, unknown>).videoLabel;
  return isVideoLabel(v) ? v : null;
}

/**
 * The note beside an approval's video player: the API's `videoLabel` on the
 * row (GET /operators/approvals reads the VideoAsset: its label, and whether
 * the "Includes AI" mark is on the picture), else a `params.videoLabel`. Null
 * when the post carries none of our videos, or one with no AI label.
 */
export function approvalLabelNote(approval: { params?: unknown; videoLabel?: unknown }): string | null {
  const v = approval.videoLabel;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const { label, onVideo } = v as { label?: unknown; onVideo?: unknown };
    if (isVideoLabel(label)) return labelNote(label, typeof onVideo === 'boolean' ? onVideo : null);
  }
  return labelNote(videoLabelFrom(approval.params));
}

// ── A video to choose ─────────────────────────────────────────────────────

/** The approval row of a video to choose (the API's videoChoiceService.VIDEO_CHOICE_TOOL). */
export const VIDEO_CHOICE_TOOL = 'video_choice';

export function isVideoChoiceApproval(a: { toolName?: string | null } | null | undefined): boolean {
  return a?.toolName === VIDEO_CHOICE_TOOL;
}

/** A video choice's skip button, where a list says Reject for anything else. */
export const VIDEO_CHOICE_NOT_NOW = 'Not now';

/** Said where a skipped video choice was (Waiting for you, Your team). */
export const VIDEO_CHOICE_SKIPPED = 'Skipped. No video is made and nothing is billed.';

/** A video choice's heading when its row names no task or reason. */
export const VIDEO_CHOICE_TITLE = 'A video to choose';

/** The reject button's words for this row: "Not now" for a video choice. */
export function rejectLabelFor(a: { toolName?: string | null } | null | undefined, otherwise = 'Reject'): string {
  return isVideoChoiceApproval(a) ? VIDEO_CHOICE_NOT_NOW : otherwise;
}

/**
 * The receipt of a decision: a skipped video choice says what skipping
 * means (nothing made, nothing billed) instead of the generic "Rejected".
 */
export function skippedChoiceReceipt<R extends { message: string }>(
  receipt: R,
  row: { toolName?: string | null } | null | undefined,
  approved: boolean,
): R {
  return !approved && isVideoChoiceApproval(row) ? { ...receipt, message: VIDEO_CHOICE_SKIPPED } : receipt;
}
