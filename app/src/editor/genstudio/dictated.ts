/**
 * Does the owner dictate new words for existing text ("the heading should say
 * Fresh bread every morning")? Such a change has one right answer, so the
 * editor offers no other version of it. Mirrors the generation engine's own
 * trigger for its text-only path.
 */
const TEXT_TARGET = /\b(headings?|headlines?|titles?|sub-?titles?|sub-?headings?|taglines?|text|copy|wording|words|buttons?|labels?|paragraphs?|sentences?|captions?|names?|eyebrow|kicker|intro|cta|call to action|link text|slogan|quote)\b/i;
const CHANGE_VERB = /\b(set|change|replace|rename|reword|update|edit|make|use|write|put|correct|fix|say|says|read|reads|should|call)\b/i;
const DICTATED = /(:\s*\S|["“‘«'][^"”’»']{1,300}["”’»']|\bto\s+\S|\b(say|says|read|reads)\s+\S|\bshould\s+(say|read|be)\s+\S)/i;
const VISUAL = /\b(colou?rs?|background|fonts?|typeface|size|bigger|smaller|larger|bold|bolder|italic|underline[sd]?|layout|columns?|grid|images?|photos?|pictures?|icons?|spacing|padding|margins?|align\w*|cent(?:er|re)d?|styles?|design|borders?|shadows?|animat\w*|width|height|darker|lighter|dark|light|order|move|swap|hide|show|link to|links? to|add|remove|delete)\b/i;

const SHORT_VISUAL_REST = (rest: string) => rest.trim().split(/\s+/).length <= 3 && VISUAL.test(rest);

const withoutDictated = (t: string) => t
  .replace(/["“«][^"”»]{1,300}["”»]|‘[^’]{1,300}’/g, ' ')
  .replace(/:\s*\S[\s\S]*$/, ' ')
  .replace(/\b(?:say|says|read|reads)\s+\S[\s\S]*$/i, ' ')
  .replace(/\bshould\s+be\s+(\S[\s\S]*)$/i, (m, rest: string) => (SHORT_VISUAL_REST(rest) ? m : ' '));

export function isDictatedText(instruction: string): boolean {
  const t = String(instruction || '');
  return TEXT_TARGET.test(t) && CHANGE_VERB.test(t) && DICTATED.test(t) && !VISUAL.test(withoutDictated(t));
}
