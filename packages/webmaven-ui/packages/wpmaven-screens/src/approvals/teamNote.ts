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
 * facts, so its first use starts the note. The marker is the API's, in
 * English, and is only read; the label a card draws before the note is in
 * the page's language (TEAM_NOTE_COPY; English is the source, the French is
 * written by hand in src/i18n/fr.json, namespace screensTeamNote, the other
 * languages by the dashboard's translation script).
 */
import { localized } from '@yotako/webmaven-ui';

export const TEAM_NOTE_MARKER = 'Your team\'s note: ';

/** The label before the AI team's own note on a change, on an approval card (namespace 'screensTeamNote'). */
export const TEAM_NOTE_COPY_EN = {
  /** Before the note, which follows in quotes on the same line: the words are the team's (AI operators), not facts. */
  label: 'Your team\'s note:',
};

export const TEAM_NOTE_COPY = localized(TEAM_NOTE_COPY_EN, 'screensTeamNote');

/** How the note is introduced on a card. In English, for importers; a card reads TEAM_NOTE_COPY.label when it draws. */
export const TEAM_NOTE_LABEL = TEAM_NOTE_COPY_EN.label;

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
