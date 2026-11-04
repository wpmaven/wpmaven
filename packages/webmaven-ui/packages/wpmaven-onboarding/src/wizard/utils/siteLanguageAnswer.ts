/**
 * A site language choice's answer applied to the wizard's state: the API
 * answers the language with the analysis's summary and
 * pages, and the plan, written again in it. Pure, so the tests read it.
 */
import type { SiteLanguageAnswer } from '../../host/types';
import type { OnboardingAnalysis, PageSelection } from '../types';

/** The analysis in the chosen language: its language, its summary and pages when the API sent them; the question closed. */
export function analysisWithLanguage(prev: OnboardingAnalysis, answer: SiteLanguageAnswer): OnboardingAnalysis {
  const a = answer.analysis ?? null;
  return {
    ...prev,
    language: answer.language,
    languageQuestion: null,
    ...(typeof a?.siteSummary === 'string' ? { siteSummary: a.siteSummary } : {}),
    ...(Array.isArray(a?.suggestedPages) ? { suggestedPages: a!.suggestedPages as unknown as OnboardingAnalysis['suggestedPages'] } : {}),
  };
}

/** The pages' titles in the chosen language, matched by type; the owner's own names and choices (included, renamed) stay. */
export function pagesWithLanguage(prev: PageSelection[], answer: SiteLanguageAnswer): PageSelection[] {
  const pages = answer.analysis?.suggestedPages;
  if (!Array.isArray(pages)) return prev;
  const titles = new Map<string, string>();
  for (const pg of pages) {
    const type = pg && (pg.type || pg.slug);
    if (type && typeof pg.title === 'string' && pg.title.trim()) titles.set(String(type), pg.title);
  }
  return prev.map((pg) => (titles.has(pg.type) ? { ...pg, title: titles.get(pg.type)! } : pg));
}
