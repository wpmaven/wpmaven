import React, { useEffect, useState } from 'react';
import { GlassCard, type FigureItem } from '@yotako/webmaven-ui';
import type { ScreensHost } from '../host/types';
import { teamBusiness } from '../team/reads';
import { PROGRESS_COPY } from '../team/progress';
import { readWhatChanged, type HomeFinance, type HomeTraffic } from './reads';
import { Figures, type FigureGroup } from './Figures';
import { SampleFiguresChip } from './SampleFiguresChip';
import type { BusinessHome } from './useBusinessHome';

/** Under Visitors: how the site counts them (the daily salt counts each person once a day). */
export const VISITORS_NOTE = PROGRESS_COPY.visitorsNote;

/**
 * The narrowest a figure here may be: a five-digit count ("12345", 76 px at
 * the hero size) and the longest label word ("PAGEVIEWS", 70 px) still fit.
 * At 80 px with a 16 px gap, the three figures of the last 7 days stand side
 * by side on a 360 px phone (278 px of card), and all five share one row from
 * the 1280 px laptop up (530 px of card).
 */
export const WHAT_CHANGED_FIGURES = { minPx: 80, gapPx: 16 } as const;

/**
 * The figures, in their two natural groups: what the site saw over the last
 * 7 days, and what the store took this week. The group names the period, so
 * the labels no longer repeat it. Each figure appears only when its source
 * actually answered; null when there is nothing to show, or only zeros.
 */
export function whatChangedGroups(finance: HomeFinance | null, traffic: HomeTraffic | null): FigureGroup[] | null {
  const week: FigureGroup = { key: 'last-7-days', heading: 'Last 7 days', figures: [] };
  // Counted once a day per person (a daily salt): said under the short label, as Analytics says it.
  if (traffic?.uniqueVisitors != null) week.figures.push({ value: String(traffic.uniqueVisitors), label: 'Visitors', detail: VISITORS_NOTE });
  if (traffic?.pageviews != null) week.figures.push({ value: String(traffic.pageviews), label: 'Pageviews' });
  // AI assistants reading the site (2026-09-16): fetches by ChatGPT, Claude,
  // Perplexity and the rest, counted by the plugin. What "AI ready" looks like.
  // The assistants are a line of their own, so the label stays one word wide.
  if (traffic?.aiVisits && traffic.aiVisits.total > 0) {
    const who = traffic.aiVisits.byAgent.slice(0, 2).map((a) => a.label).join(', ');
    week.figures.push({ value: String(traffic.aiVisits.total), label: 'AI reads', detail: who || undefined });
  }
  const store: FigureGroup = { key: 'this-week', heading: 'This week', figures: [] };
  if (finance?.orderCount != null) store.figures.push({ value: String(finance.orderCount), label: 'Orders' });
  if (finance?.netRevenue != null && finance.netRevenue > 0) {
    const SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };
    const code = (finance.currency || 'USD').toUpperCase();
    const cur = SYMBOL[code] ?? `${code} `;
    store.figures.push({ value: `${cur}${Math.round(finance.netRevenue)}`, label: 'Revenue' });
  }
  const groups = [week, store].filter((g) => g.figures.length > 0);
  // Day 0 is all zeros by definition; three zeros under a "what changed"
  // heading reads as failure rather than as a business that started today.
  const anythingHappened = groups.some((g) => g.figures.some((f) => f.value !== '0'));
  return groups.length && anythingHappened ? groups : null;
}

/**
 * The evidence block: verified numbers only, each figure rendered
 * only when its source actually answered. No estimates, no projections.
 */
export const WhatChanged: React.FC<{ finance: HomeFinance | null; traffic: HomeTraffic | null }> = ({ finance, traffic }) => {
  const groups = whatChangedGroups(finance, traffic);
  if (!groups) return null;
  // The store's figures came from the API's development sample: said here.
  const sample = finance?.sample === true && groups.some((g) => g.key === 'this-week');
  return (
    <div>
      <div style={{ fontSize: 'var(--text-label)', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 8 }}>
        What changed
      </div>
      {sample && <div style={{ marginBottom: 8 }}><SampleFiguresChip /></div>}
      <Figures groups={groups} {...WHAT_CHANGED_FIGURES} />
    </div>
  );
};

/**
 * What changed's numbers as one flat list, for a numbers card of the app's
 * own (the plugin's, beside its site's counts, the kit's FiguresCard): the
 * same figures by the same rule, each saying its period. Empty when there
 * is nothing to show, or only zeros.
 */
export function whatChangedItems(finance: HomeFinance | null, traffic: HomeTraffic | null): FigureItem[] {
  const groups = whatChangedGroups(finance, traffic);
  if (!groups) return [];
  return groups.flatMap((g) => g.figures.map((f): FigureItem => ({
    key: `${g.key}:${f.label}`,
    label: f.label,
    value: f.value,
    hint: [g.heading, f.detail].filter(Boolean).join('. '),
    testId: `what-changed-${f.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  })));
}

/**
 * What changed's reads for one business, on their own (the plugin's numbers
 * card): this week's money and the last 7 days' visitors, read once.
 * `loaded` once both have answered (a failed read answers null).
 */
export function useWhatChanged(host: ScreensHost, instanceId?: string | null): {
  finance: HomeFinance | null;
  traffic: HomeTraffic | null;
  loaded: boolean;
} {
  const business = teamBusiness(host.scope, instanceId);
  const [state, setState] = useState<{ id: string | null; finance: HomeFinance | null; traffic: HomeTraffic | null }>({ id: null, finance: null, traffic: null });
  useEffect(() => {
    if (!business) return undefined;
    let alive = true;
    readWhatChanged(host.transport, business).then((r) => { if (alive) setState({ id: business, ...r }); });
    return () => { alive = false; };
    // The transport may be a new object on each render: read again only for another business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business]);
  const current = state.id === business;
  return { finance: current ? state.finance : null, traffic: current ? state.traffic : null, loaded: current };
}

export interface WhatChangedCardProps {
  /** The business's Home (useBusinessHome): its week's money and its visitors. */
  home: BusinessHome;
  /** In its own card (the default), or bare inside the app's (the dashboard's Home card). */
  card?: boolean;
}

/** What changed, as a Home section: nothing at all while there is nothing to show (no empty card). */
export const WhatChangedCard: React.FC<WhatChangedCardProps> = ({ home, card = true }) => {
  if (!whatChangedGroups(home.finance, home.traffic)) return null;
  const body = <WhatChanged finance={home.finance} traffic={home.traffic} />;
  return card ? <GlassCard padding={24} data-testid="what-changed-card">{body}</GlassCard> : body;
};

export default WhatChanged;
