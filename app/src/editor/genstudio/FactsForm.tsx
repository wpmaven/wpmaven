import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import type { SiteMapFact } from '../../types/edits';
import { siteBrand, type SiteBrand } from '../../utils/brand';
import { KIND_COLORS } from './bindings';
import { useFrameFollows, type EditorEnv } from './env';
import { EditErrorBanner, EditResultLine, PanelFrame, PreviewFlow, Working } from './ui';
import { useEditOperation } from './useEditOperation';

const INPUT_TYPES: Record<SiteMapFact['type'], string> = { text: 'text', tel: 'tel', email: 'email', url: 'url' };

/** What is wrong with a fact's new value, or null. */
export function factProblem(fact: SiteMapFact, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length > 500) return `${fact.label} has at most 500 characters.`;
  if (fact.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `${fact.label} is an email address, like hello@example.com.`;
  if (fact.type === 'url' && !/^https?:\/\/\S+$/i.test(v)) return `${fact.label} is a web address starting with https://.`;
  if (fact.type === 'tel' && !/^[+()\d\s./-]{5,30}$/.test(v)) return `${fact.label} is a phone number.`;
  return null;
}

/** The form's line while the site has no details to change, in the site's brand (utils/brand.ts) or naming nobody. */
export function noFactsText(b: SiteBrand = siteBrand()): string {
  return b.mode === 'neutral'
    ? 'This site has no business details that can be changed here yet.'
    : `This site has no business details ${b.name} can change yet.`;
}

/**
 * The business details the site shows wherever it names them (phone, email,
 * address, hours, promo code...). An empty field takes the line off the
 * site; nothing is ever filled in for the owner.
 */
export function FactsForm({ env, focusKey }: { env: EditorEnv; focusKey?: string }) {
  // The social handle is the Social links panel's (the whole list of profiles, not one fact).
  const facts = useMemo(() => (env.siteMap?.facts ?? []).filter((f) => f.key !== 'social'), [env.siteMap]);
  const initial = useMemo(() => Object.fromEntries(facts.map((f) => [f.key, f.value])), [facts]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const flow = useEditOperation();
  // A site WPMaven did not design shows them as words in its pages, header and footer: previewed first, never left empty.
  const blockSite = env.siteMap?.engine === 'wordpress';
  useFrameFollows(flow, env);
  const s = flow.state;
  const busy = s.phase === 'publishing' || s.phase === 'previewing';
  const focusRef = useRef<HTMLInputElement | null>(null);

  // The site map read again after a save: the form starts from what the site has.
  useEffect(() => { setValues(initial); }, [initial]);
  useEffect(() => { focusRef.current?.focus(); }, [focusKey]);

  const changed = facts.filter((f) => (values[f.key] ?? '').trim() !== (initial[f.key] ?? '').trim());
  const problems = [
    ...changed.map((f) => factProblem(f, values[f.key] ?? '')),
    ...(blockSite ? changed.filter((f) => !(values[f.key] ?? '').trim()).map((f) => `${f.label} cannot be left empty here: change the page that shows it to take it off.`) : []),
  ].filter((p): p is string => !!p);
  const operation = { op: 'update_facts' as const, values: Object.fromEntries(changed.map((f) => [f.key, (values[f.key] ?? '').trim()])) };

  const save = async () => {
    if (!changed.length || problems.length) return;
    const r = await flow.publishNow({ op: 'update_facts', values: Object.fromEntries(changed.map((f) => [f.key, (values[f.key] ?? '').trim()])) });
    if (r?.status === 'published') {
      env.showLive();
      env.refreshSiteMap();
    }
  };

  return (
    <PanelFrame
      chip="Business details"
      color={KIND_COLORS.fact}
      title="Your business details"
      sub="Shown wherever your site names them"
      onClose={env.closePanel}
      footer={blockSite ? (
        <PreviewFlow
          flow={flow}
          canPreview={changed.length > 0 && problems.length === 0}
          onPreview={() => { void flow.preview(operation); }}
          workingText="Finding every place your site shows them."
          phoneFirst={env.viewport === 'mobile'}
          onUndo={env.undo}
          onDone={() => { flow.reset(); env.refreshSiteMap(); }}
        />
      ) : (
        <>
          {busy && <Working text="Saving your details." />}
          {s.result && <EditResultLine result={s.result} failure={s.error} />}
          {s.error && s.error.stage === 'publish' && (
            <EditErrorBanner code={s.error.code} message={s.error.message} busy={busy} onRetry={() => { void save(); }} onDiscard={() => { flow.reset(); setValues(initial); }} />
          )}
          <div className="wme-gs-actions">
            {s.phase === 'published' && s.result?.undoable && (
              <Button data-testid="editor-undo" variant="outline" size="sm" onClick={() => env.undo(s.result!)}>Undo</Button>
            )}
            <Button data-testid="facts-save" variant="primary" size="sm" className="wme-gs-push" disabled={!changed.length || problems.length > 0 || busy} isLoading={busy} onClick={() => { void save(); }}>
              Save
            </Button>
          </div>
        </>
      )}
    >
      {facts.length === 0 && <p className="wme-gs-hint">{noFactsText()}</p>}
      {facts.map((f) => (
        <div key={f.key}>
          <label className="wme-gs-label" htmlFor={`wme-gs-fact-${f.key}`}>{f.label}</label>
          <input
            id={`wme-gs-fact-${f.key}`}
            ref={f.key === focusKey ? focusRef : undefined}
            data-testid={`fact-${f.key}`}
            className="wme-gs-input"
            type={INPUT_TYPES[f.type]}
            value={values[f.key] ?? ''}
            onChange={(e) => setValues((cur) => ({ ...cur, [f.key]: e.target.value }))}
            placeholder={`Add ${f.label.toLowerCase()}`}
            disabled={busy}
            maxLength={500}
            style={f.key === focusKey ? { borderColor: 'var(--peach)' } : undefined}
          />
        </div>
      ))}
      {problems.length > 0 && <div className="wme-gs-note is-warn" role="alert">{problems.join(' ')}</div>}
      {facts.length > 0 && <p className="wme-gs-hint">{blockSite ? 'Changed everywhere your pages, header and footer show them.' : 'Leave a field empty to take that line off your site.'}</p>}
      <Button variant="outline" size="sm" data-testid="facts-social-links" onClick={() => env.openPanel({ kind: 'social' })}>Social links</Button>
    </PanelFrame>
  );
}
