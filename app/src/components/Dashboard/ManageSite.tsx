/**
 * Manage my site (2026-10-26): WPMaven's free way in on a site the owner
 * already runs, with WPMaven from WordPress.org alone. No build and no plan:
 * the business is made from the site itself.
 *
 *   1. Your site            the site's title (WordPress's own, set here) and
 *                           what the business does, written from the homepage
 *                           (POST onboarding/site-description); a homepage
 *                           that is still WordPress's sample asks instead, and
 *                           offers to build the business. Saved as the
 *                           business (POST onboarding/keep-site, kept).
 *   2. Your team            who works on the site in the free version, who
 *                           shows you how; WPMaven Agent unlocks the rest.
 *   3. What can be better   "Your team fixes these": the free fixes, ticked
 *                           (GET/POST onboarding/manage-fixes, run at once on
 *                           the owner's press); "These need you": the site
 *                           check's findings, each with "Show me how".
 *
 * Every call goes through the plugin's wizard proxy as the site
 * (onboarding/pluginTransport). The site itself shows on the left.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, OperatorAvatar, Checkbox } from '@yotako/webmaven-ui';
import BrandMark from '../BrandMark';
import { siteBrand } from '../../utils/brand';
import { createPluginTransport } from '../../onboarding/pluginTransport';

type Step = 'site' | 'team' | 'better';

interface SiteFacts {
  name: string;
  url: string;
  profile: null | {
    kind: 'empty' | 'site' | 'store';
    theme?: { name?: string };
    content?: { pages?: number; posts?: number; products?: number };
    store?: unknown;
    plugins?: { forms?: string[] | null };
  };
}

interface FreeFix { id: string; title: string; happens: string; operator: string }
interface Finding { id: string; title: string; detail?: string; happens?: string; level: string; operator?: string }

export const MANAGE_COPY = {
  steps: ['Your site', 'Your team', 'What can be better'] as const,
  siteTitle: 'Your site, as WPMaven reads it',
  siteSub: (host: string) => `We read ${host} and filled this in. Change anything that is wrong.`,
  siteSubBlank: 'Your homepage is still WordPress\'s sample, so there is nothing to read yet. Tell us about your business in a sentence or two.',
  titleLabel: 'Site title',
  titleHelp: 'The title WordPress shows in search results and browser tabs.',
  descLabel: 'What your business does',
  descChip: 'Written from your homepage',
  descHelp: 'Your team works from this. It is also your site\'s description for search engines and AI assistants.',
  descPlaceholder: 'What you do, for whom, and where. For example: a yoga studio in Nantes with small evening classes and weekend retreats.',
  found: 'What we found on your site',
  emptyTitle: 'Your site is still empty',
  emptyLine: 'WPMaven can build it for you: describe your business and get a finished site, designed and written, ready to publish here.',
  emptyButton: 'Build my business instead',
  teamTitle: (name: string) => `Your team for ${name}`,
  teamSub: 'They start today, free. Some of them work on your site; the others tell you exactly what to do, step by step.',
  coCeo: (name: string) => `I'm your Co-CEO. I keep an eye on ${name}, put the right person on each job, and bring you what matters each week.`,
  works: 'Work on your site',
  shows: 'Show you how',
  agentTitle: 'Want all of them to work on your site?',
  agentLine: 'Install WPMaven Agent, our companion plugin, and every member makes the changes themselves, each one waiting for your yes.',
  betterTitle: (name: string) => `What can be better on ${name}`,
  betterSub: 'From a check of your site just now. Your team fixes what it can; for the rest, it shows you how.',
  teamFixes: 'Your team fixes these',
  tickThem: 'Tick the ones you want',
  needYou: 'These need you',
  showsHow: 'Your team shows you how',
  showMe: 'Show me how',
  hide: 'Hide',
  checking: 'Checking your site…',
  nothing: 'Nothing to fix right now.',
  later: 'Everything here stays in Waiting for you, in WPMaven. With WPMaven Agent, your team fixes the second list too.',
  back: 'Back',
  next: 'Continue',
  notNow: 'Not now',
  fix: (n: number) => (n === 1 ? 'Fix the 1 ticked' : `Fix the ${n} ticked`),
  saveFailed: 'We could not save your business just now. Try again in a minute.',
} as const;

/** The team members of the free version: who works on the site, who shows how. */
export const FREE_TEAM: Array<{ id: string; title: string; line: string; works: boolean }> = [
  { id: 'seo_specialist', title: 'SEO Specialist', line: 'Writes your page titles and search descriptions, and tells search engines and AI assistants what you do.', works: true },
  { id: 'customer_support', title: 'Customer Support Agent', line: 'Collects your contact form messages in one inbox and drafts your replies.', works: true },
  { id: 'data_analyst', title: 'Data Analyst', line: 'Counts your visitors and the AI assistants that read your site, and says what to do next.', works: true },
  { id: 'content_writer', title: 'Content Writer', line: 'Writes posts in your voice in WPMaven, for you to paste into WordPress.', works: false },
  { id: 'webmaster', title: 'Webmaster', line: 'Checks speed, security, updates and backups every day, and walks you through each fix.', works: false },
  { id: 'web_developer', title: 'Web Developer', line: 'Explains each technical change, in the order to do it.', works: false },
  { id: 'web_designer', title: 'Web Designer', line: 'Suggests changes to your colors, fonts and layout.', works: false },
];

/** "atelier-nord.fr" from the site's address. Pure. */
export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/** What the site holds, in a few words, for "What we found". Pure. */
/** The site check's findings a free fix above already takes care of: shown once, in "Your team fixes these". */
const COVERED_BY_FREE_FIX: Record<string, string> = { description_missing: 'search_descriptions' };

/** "These need you": the check's findings, without the ones a free fix on offer covers. Pure. */
export function needYou<F extends { id: string }>(findings: F[] | null, fixes: Array<{ id: string }> | null): F[] {
  const offered = new Set((fixes ?? []).map((x) => x.id));
  return (findings ?? []).filter((f) => !(COVERED_BY_FREE_FIX[f.id] && offered.has(COVERED_BY_FREE_FIX[f.id])));
}

export function foundLines(profile: SiteFacts['profile']): Array<[string, string]> {
  if (!profile) return [];
  const c = profile.content ?? {};
  const out: Array<[string, string]> = [];
  if ((c.products ?? 0) > 0 || profile.kind === 'store') out.push(['Store', `WooCommerce, ${c.products ?? 0} products`]);
  if ((c.pages ?? 0) + (c.posts ?? 0) > 0) out.push(['Content', `${c.pages ?? 0} pages, ${c.posts ?? 0} posts`]);
  const forms = profile.plugins?.forms ?? [];
  if (forms && forms.length) out.push(['Forms', forms.join(', ')]);
  if (profile.theme?.name) out.push(['Theme', profile.theme.name]);
  return out;
}

const transport = createPluginTransport();
const data = <T,>(body: unknown): T => ((body as { data?: T } | null)?.data ?? (body as T));

/** The site at desktop width, scaled into its column. */
function SiteFrame({ url }: { url: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const fit = () => setScale(Math.min(1, el.clientWidth / 1280));
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: 14, overflow: 'hidden', background: '#fff', boxShadow: '0 16px 40px -12px rgba(23,24,28,.22), 0 0 0 1px var(--glass-border, #E2E4EA)' }}>
      <div style={{ height: 44, flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', borderBottom: '1px solid var(--glass-border, #EDEEF2)' }}>
        <span aria-hidden style={{ display: 'flex', gap: 7 }}>{['#FF5F57', '#FEBC2E', '#28C840'].map((c) => <i key={c} style={{ width: 11, height: 11, borderRadius: '50%', background: c, display: 'block' }} />)}</span>
        <span style={{ flex: 1, maxWidth: 380, margin: '0 auto', textAlign: 'center', font: '12px/24px ui-monospace, monospace', color: 'var(--text-dim)', background: 'var(--bg, #F5F6F8)', borderRadius: 999, border: '1px solid var(--glass-border, #E2E4EA)' }}>{hostOf(url)}</span>
      </div>
      <div ref={box} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <iframe
          title={hostOf(url)}
          src={url}
          tabIndex={-1}
          style={{ border: 0, width: 1280, height: `${100 / scale}%`, transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none', position: 'absolute', top: 0, left: 0 }}
        />
      </div>
    </div>
  );
}

function Stepper({ at }: { at: number }) {
  return (
    <ol aria-label="Steps" style={{ display: 'flex', alignItems: 'center', gap: 10, listStyle: 'none', margin: '0 0 20px', padding: 0, fontSize: 13.5, color: 'var(--text-dim)' }}>
      {MANAGE_COPY.steps.map((label, i) => (
        <React.Fragment key={label}>
          {i > 0 && <li aria-hidden style={{ flex: 1, height: 1, minWidth: 24, background: 'var(--glass-border, #E2E4EA)' }} />}
          <li aria-current={i === at ? 'step' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', color: i === at ? 'var(--text)' : undefined, fontWeight: i === at ? 550 : undefined }}>
            <span style={{
              width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, boxSizing: 'border-box',
              background: i < at ? 'var(--success, #2E9E63)' : 'var(--bg-raised, #fff)', color: i < at ? '#fff' : i === at ? '#6A4BFF' : undefined,
              border: i < at ? '1px solid var(--success, #2E9E63)' : i === at ? '2px solid #6A4BFF' : '1px solid var(--glass-border, #E2E4EA)',
            }}>{i < at ? '✓' : i + 1}</span>
            {label}
          </li>
        </React.Fragment>
      ))}
    </ol>
  );
}

const field: React.CSSProperties = { font: '400 15px/1.5 var(--font-ui, Inter, sans-serif)', color: 'var(--text)', background: 'var(--bg-raised, #fff)', border: '1px solid var(--glass-border, #CDD0DA)', borderRadius: 10, padding: '11px 14px', width: '100%', boxSizing: 'border-box' };
const help: React.CSSProperties = { fontSize: 12.5, color: 'var(--text-dim)' };
const chip = (bg: string, fg: string): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 550, background: bg, color: fg });

export interface ManageSiteProps {
  /** Where to start: the site, or its fixes (a business kept with its fixes not chosen yet). */
  startAt?: Step;
  /** The business is set up: the app takes over. */
  onDone: () => void;
  /** "Build my business instead": the dashboard's onboarding for this site. */
  onBuild: (() => void) | null;
}

export default function ManageSite({ startAt = 'site', onDone, onBuild }: ManageSiteProps) {
  const brand = siteBrand();
  const [step, setStep] = useState<Step>(startAt);
  const [facts, setFacts] = useState<SiteFacts | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fromHomepage, setFromHomepage] = useState(false);
  const [blank, setBlank] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixes, setFixes] = useState<FreeFix[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  // The site, its setup session (resumed, or started as the site), and the description.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const site = data<SiteFacts>(await transport.request({ method: 'GET', path: 'site' }));
        if (!alive) return;
        setFacts(site);
        setTitle(site.name ?? '');
        const state = data<{ session?: { id?: string; status?: string } | null }>(await transport.request({ method: 'GET', path: 'onboarding/site-session' }));
        let sid = state?.session?.id && state.session.status !== 'failed' ? state.session.id : null;
        if (!sid) sid = data<{ sessionId?: string }>(await transport.request({ method: 'POST', path: 'onboarding/start', body: {} }))?.sessionId ?? null;
        if (!alive || !sid) return;
        setSessionId(sid);
        if (startAt !== 'site') return;
        const d = data<{ description: string | null; fromHomepage: boolean; reason?: string }>(
          await transport.request({ method: 'POST', path: `onboarding/site-description/${sid}`, body: {}, timeoutMs: 60_000 }),
        );
        if (!alive) return;
        if (d?.description) { setDescription(d.description); setFromHomepage(true); }
        setBlank(site.profile?.kind === 'empty' || d?.reason === 'sample');
      } catch {
        if (alive) setError(MANAGE_COPY.saveFailed);
      }
    })();
    return () => { alive = false; };
  }, [startAt]);

  // Step 3: the free fixes and the site check, asked once. Each answer lands
  // on its own (the fixes come back in a moment, the check in seconds), so
  // neither waits on the other and only leaving the screen drops them.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const askedBetter = useRef(false);
  useEffect(() => {
    if (step !== 'better' || !sessionId || askedBetter.current) return;
    askedBetter.current = true;
    void transport.request({ method: 'GET', path: `onboarding/manage-fixes/${sessionId}` })
      .then((b) => { const f = data<{ fixes?: FreeFix[] }>(b)?.fixes ?? []; if (mounted.current) { setFixes(f); setTicked(new Set(f.map((x) => x.id))); } })
      .catch(() => { if (mounted.current) setFixes([]); });
    void transport.request({ method: 'POST', path: `onboarding/site-check/${sessionId}`, body: {}, timeoutMs: 120_000 })
      .then((b) => {
        const check = data<{ check?: { findings?: Finding[] } }>(b)?.check;
        if (mounted.current) setFindings((check?.findings ?? []).filter((f) => f.level !== 'ok'));
      })
      .catch((e: unknown) => {
        const msg = (e as { data?: { error?: unknown } })?.data?.error;
        if (mounted.current) { setFindings([]); setCheckNote(typeof msg === 'string' ? msg : null); }
      });
  }, [step, sessionId]);

  const host = facts ? hostOf(facts.url) : '';
  const name = title.trim() || facts?.name || host;
  const at = step === 'site' ? 0 : step === 'team' ? 1 : 2;

  const saveSite = async () => {
    if (!sessionId || !facts) return;
    setBusy(true);
    setError(null);
    try {
      if (title.trim() && title.trim() !== facts.name) {
        await transport.request({ method: 'POST', path: 'site-title', body: { title: title.trim() } }).catch(() => undefined);
      }
      const content = facts.profile?.content ?? {};
      await transport.request({
        method: 'POST',
        path: `onboarding/keep-site/${sessionId}`,
        body: { name: name.slice(0, 120), summary: description.trim().slice(0, 300), store: facts.profile?.kind === 'store' || (content.products ?? 0) > 0, fixes: true },
      });
      setStep('team');
    } catch {
      setError(MANAGE_COPY.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const finish = async (fix: boolean) => {
    if (!sessionId) return;
    setBusy(true);
    try {
      if (fix && ticked.size) {
        await transport.request({ method: 'POST', path: `onboarding/manage-fixes/${sessionId}`, body: { ids: [...ticked] } }).catch(() => undefined);
      }
      // The fixes are chosen: the business is set up.
      await transport.request({ method: 'POST', path: `onboarding/keep-site/${sessionId}`, body: { findingIds: [] } }).catch(() => undefined);
    } finally {
      setBusy(false);
      onDone();
    }
  };

  const panel = (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(var(--wm-app-height, 100vh) - 28px)' }}>
      <div style={{ marginTop: 10 }}><BrandMark size={36} brand={brand} /></div>
      {step === 'site' && (
        <>
          <h1 style={{ margin: '22px 0 6px', fontFamily: 'var(--font-title)', fontSize: 34, fontWeight: 400, lineHeight: 1.1, color: 'var(--text)' }}>{MANAGE_COPY.siteTitle}</h1>
          <p style={{ margin: '0 0 22px', fontSize: 15, lineHeight: 1.55, color: 'var(--text-dim)' }}>{blank ? MANAGE_COPY.siteSubBlank : MANAGE_COPY.siteSub(host)}</p>
          <Stepper at={at} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }} data-testid="wm-manage-site">
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13.5, fontWeight: 550, color: 'var(--text)' }}>{MANAGE_COPY.titleLabel}</span>
              <input style={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} data-testid="wm-manage-title" />
              <span style={help}>{MANAGE_COPY.titleHelp}</span>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13.5, fontWeight: 550, color: 'var(--text)', display: 'flex', gap: 8, alignItems: 'center' }}>
                {MANAGE_COPY.descLabel}
                {fromHomepage && <span style={chip('#EEEDF7', '#57509B')}>{MANAGE_COPY.descChip}</span>}
              </span>
              <textarea style={{ ...field, minHeight: 112, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder={MANAGE_COPY.descPlaceholder} data-testid="wm-manage-description" />
              <span style={help}>{MANAGE_COPY.descHelp}</span>
            </label>
            {!blank && foundLines(facts?.profile ?? null).length > 0 && (
              <div style={{ padding: '16px 18px', borderRadius: 16, border: '1px solid var(--glass-border, #E2E4EA)', background: 'var(--bg-raised, #fff)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
                <div style={{ gridColumn: '1 / -1', fontSize: 11, fontWeight: 650, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>{MANAGE_COPY.found}</div>
                {foundLines(facts?.profile ?? null).map(([k, v]) => (
                  <div key={k} style={{ fontSize: 13.5, color: 'var(--text)' }}><b>{k}</b> <span style={{ color: 'var(--text-dim)' }}>{v}</span></div>
                ))}
              </div>
            )}
            {blank && onBuild && (
              <div style={{ padding: '18px 20px', borderRadius: 16, border: '1px solid var(--glass-border, #E2E4EA)', background: 'var(--bg-raised, #fff)' }}>
                <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--text)', marginBottom: 4 }}>{MANAGE_COPY.emptyTitle}</div>
                <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.5, color: 'var(--text-dim)' }}>{MANAGE_COPY.emptyLine}</p>
                <Button variant="secondary" size="sm" onClick={onBuild}>{MANAGE_COPY.emptyButton}</Button>
              </div>
            )}
            {error && <p role="alert" style={{ margin: 0, fontSize: 13.5, color: 'var(--rose, #D6455D)' }}>{error}</p>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 0 40px', borderTop: '1px solid var(--glass-border, #E2E4EA)', marginTop: 16 }}>
            <Button variant="primary" style={{ marginLeft: 'auto' }} onClick={() => void saveSite()} isLoading={busy} disabled={busy || !sessionId || !name.trim()} data-testid="wm-manage-continue">{MANAGE_COPY.next}</Button>
          </div>
        </>
      )}
      {step === 'team' && (
        <>
          <h1 style={{ margin: '22px 0 6px', fontFamily: 'var(--font-title)', fontSize: 34, fontWeight: 400, lineHeight: 1.1, color: 'var(--text)' }}>{MANAGE_COPY.teamTitle(name)}</h1>
          <p style={{ margin: '0 0 22px', fontSize: 15, lineHeight: 1.55, color: 'var(--text-dim)' }}>{MANAGE_COPY.teamSub}</p>
          <Stepper at={at} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }} data-testid="wm-manage-team">
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <OperatorAvatar id="chief_of_staff" size={48} decorative />
              <div style={{ flex: 1, padding: '12px 16px', borderRadius: 14, background: 'var(--bg-raised, #fff)', border: '1px solid var(--glass-border, #E2E4EA)', fontSize: 15, lineHeight: 1.5, color: 'var(--text)' }}>
                <div style={{ fontSize: 11, fontWeight: 650, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6A4BFF', marginBottom: 4 }}>Co-CEO</div>
                {MANAGE_COPY.coCeo(name)}
              </div>
            </div>
            {[true, false].map((works) => (
              <div key={String(works)} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={chip(works ? '#E7F5EE' : '#EDEEF2', works ? '#2E9E63' : '#4A4E5A')}>{works ? MANAGE_COPY.works : MANAGE_COPY.shows}</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                  {FREE_TEAM.filter((m) => m.works === works).map((m) => (
                    <div key={m.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 14, background: 'var(--bg-raised, #fff)', border: '1px solid var(--glass-border, #E2E4EA)' }}>
                      <OperatorAvatar id={m.id} size={48} decorative />
                      <div>
                        <b style={{ display: 'block', fontSize: 14.5, color: 'var(--text)', marginBottom: 3 }}>{m.title}</b>
                        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-dim)' }}>{m.line}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ padding: '16px 18px', borderRadius: 14, border: '1px dashed var(--glass-border, #CDD0DA)', background: 'var(--bg-raised, #fff)', fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-dim)' }}>
              <b style={{ color: 'var(--text)' }}>{MANAGE_COPY.agentTitle}</b> {MANAGE_COPY.agentLine}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 0 40px', borderTop: '1px solid var(--glass-border, #E2E4EA)', marginTop: 16 }}>
            <Button variant="ghost" onClick={() => setStep('site')}>{MANAGE_COPY.back}</Button>
            <Button variant="primary" style={{ marginLeft: 'auto' }} onClick={() => setStep('better')} data-testid="wm-manage-team-continue">{MANAGE_COPY.next}</Button>
          </div>
        </>
      )}
      {step === 'better' && (
        <>
          <h1 style={{ margin: '22px 0 6px', fontFamily: 'var(--font-title)', fontSize: 34, fontWeight: 400, lineHeight: 1.1, color: 'var(--text)' }}>{MANAGE_COPY.betterTitle(name)}</h1>
          <p style={{ margin: '0 0 22px', fontSize: 15, lineHeight: 1.55, color: 'var(--text-dim)' }}>{MANAGE_COPY.betterSub}</p>
          <Stepper at={at} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }} data-testid="wm-manage-better">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={chip('#E7F5EE', '#2E9E63')}>{MANAGE_COPY.teamFixes}</span>
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>{MANAGE_COPY.tickThem}</span>
            </div>
            {fixes === null && <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-dim)' }}>{MANAGE_COPY.checking}</p>}
            {fixes !== null && fixes.length === 0 && <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-dim)' }}>{MANAGE_COPY.nothing}</p>}
            {(fixes ?? []).map((f) => (
              <div key={f.id} data-testid={`wm-manage-fix-${f.id}`} style={{ padding: '14px 16px', borderRadius: 14, background: 'var(--bg-raised, #fff)', border: '1px solid var(--glass-border, #E2E4EA)' }}>
                <Checkbox
                  checked={ticked.has(f.id)}
                  onChange={(on) => setTicked((prev) => { const next = new Set(prev); if (on) next.add(f.id); else next.delete(f.id); return next; })}
                  label={(
                    <div>
                      <b style={{ display: 'block', fontSize: 14.5, color: 'var(--text)', marginBottom: 3 }}>{f.title}</b>
                      <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text-dim)' }}>
                        <OperatorAvatar id={f.operator} size={24} decorative />{f.happens}
                      </span>
                    </div>
                  )}
                />
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <span style={chip('#FCF3E3', '#B7791F')}>{MANAGE_COPY.needYou}</span>
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>{MANAGE_COPY.showsHow}</span>
            </div>
            {findings === null && <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-dim)' }}>{MANAGE_COPY.checking}</p>}
            {checkNote && <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-dim)' }}>{checkNote}</p>}
            {needYou(findings, fixes).map((f) => (
              <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 12, alignItems: 'start', padding: '14px 16px', borderRadius: 14, background: 'var(--bg-raised, #fff)', border: '1px solid var(--glass-border, #E2E4EA)' }}>
                <span aria-hidden style={{ width: 20, height: 20, borderRadius: 6, background: '#FCF3E3', color: '#B7791F', font: '700 12px/20px var(--font-ui, Inter, sans-serif)', textAlign: 'center' }}>!</span>
                <div>
                  <b style={{ display: 'block', fontSize: 14.5, color: 'var(--text)', marginBottom: 3 }}>{f.title}</b>
                  {f.happens && (
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text-dim)' }}>
                      {f.operator && <OperatorAvatar id={f.operator} size={24} decorative />}{f.happens}
                    </span>
                  )}
                  {open === f.id && f.detail && (
                    <p style={{ margin: '8px 0 0', padding: '12px 14px', borderRadius: 10, background: 'var(--bg, #F5F6F8)', fontSize: 13.5, lineHeight: 1.55, color: 'var(--text)' }}>{f.detail}</p>
                  )}
                </div>
                {f.detail && (
                  <Button variant="ghost" size="sm" onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? MANAGE_COPY.hide : MANAGE_COPY.showMe}</Button>
                )}
              </div>
            ))}
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>{MANAGE_COPY.later}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 0 40px', borderTop: '1px solid var(--glass-border, #E2E4EA)', marginTop: 16 }}>
            <Button variant="ghost" onClick={() => setStep('team')}>{MANAGE_COPY.back}</Button>
            <Button variant="secondary" style={{ marginLeft: 'auto' }} onClick={() => void finish(false)} disabled={busy}>{MANAGE_COPY.notNow}</Button>
            <Button variant="primary" onClick={() => void finish(true)} isLoading={busy} disabled={busy || ticked.size === 0} data-testid="wm-manage-fix">{MANAGE_COPY.fix(ticked.size)}</Button>
          </div>
        </>
      )}
    </div>
  );

  return (
    // Its own scroll: WPMaven's screen in WordPress is a fixed box, so a long
    // list of findings would be cut off rather than scrolled.
    <div data-testid="wm-manage" style={{ height: 'var(--wm-app-height, 100vh)', overflowY: 'auto', background: 'var(--bg)', padding: '28px 32px 0 28px', boxSizing: 'border-box' }}>
      <div className="wm-manage-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(460px, 0.88fr)', gap: 48, alignItems: 'start' }}>
        <div style={{ position: 'sticky', top: 28, height: 'calc(var(--wm-app-height, 100vh) - 56px)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ font: 'italic 13px/1.4 var(--font-ui, Inter, sans-serif)', color: 'var(--text-dim)' }}>Your site as it is today. Nothing here changes until you say yes.</div>
          {facts ? <SiteFrame url={facts.url} /> : <div style={{ flex: 1, borderRadius: 14, background: 'var(--bg-raised, #fff)', border: '1px solid var(--glass-border, #E2E4EA)' }} />}
        </div>
        {panel}
      </div>
    </div>
  );
}
