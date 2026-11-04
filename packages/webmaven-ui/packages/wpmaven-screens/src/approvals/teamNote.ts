/**
 * An approval's sentence, apart from the operator's own note on it.
 *
 * For a change made through the site's own interface (a REST call or an
 * admin-ajax action), the API now says what the call does from the call
 * itself, and puts the operator's summary after it as a note:
 *
 *   Creates the coupon "FREE100" in your store: 100% off. It makes what it
 *   applies to free. Your team's note: "Creates a 15% welcome coupon."
 *
 * (the API's ownerRestSentence). Before, the summary WAS the sentence,
 * and a planted or mistaken one could pass a refund, a 100% coupon or a new
 * account off as something harmless. The cards show the facts as the
 * sentence and the note on a line of its own under it, smaller, as the
 * team's words.
 *
 * MIRRORS the API's TEAM_NOTE_MARKER. The API keeps the marker out of the
 * facts, so its first use starts the note.
 */

export const TEAM_NOTE_MARKER = 'Your team\'s note: ';

/** How the note is introduced on a card. */
export const TEAM_NOTE_LABEL = 'Your team\'s note:';

export interface SentenceParts {
  /** What the change does: the sentence without the note. */
  facts: string;
  /** The operator's own words about it, without their quotes; null when there are none. */
  note: string | null;
}

/** The facts and the operator's note of an approval's sentence. A sentence without a note is all facts. */
export function splitTeamNote(sentence: string | null | undefined): SentenceParts {
  const s = typeof sentence === 'string' ? sentence : '';
  const at = s.indexOf(TEAM_NOTE_MARKER);
  if (at <= 0) return { facts: s, note: null };
  const facts = s.slice(0, at).trim();
  let note = s.slice(at + TEAM_NOTE_MARKER.length).trim();
  if (note.length >= 2 && note.startsWith('"') && note.endsWith('"')) note = note.slice(1, -1).trim();
  if (!facts) return { facts: s, note: null };
  return { facts, note: note || null };
}
