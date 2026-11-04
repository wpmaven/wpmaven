import React, { useState } from 'react';
import { pageFor } from './bindings';
import { useFrameFollows, type EditorEnv, type RedesignMode } from './env';
import { PanelFrame, PreviewFlow, Thumbnails } from './ui';
import { useEditOperation } from './useEditOperation';
import { nameOr } from '../../utils/brand';

/** Ways to say it, offered to start from (the owner's own words win). */
export const REDESIGN_SUGGESTIONS = ['More visual', 'Simpler and calmer', 'Easier to read on phones'];
/** For a whole new homepage. */
export const NEW_HOMEPAGE_SUGGESTIONS = ['Bolder, with big photos', 'Calm and editorial', 'Warm and playful'];

/** The homepage's two ways, as the page menu and the panel name them. */
export const HOMEPAGE_CHOICES: Array<{ mode: RedesignMode; label: string }> = [
  { mode: 'refresh', label: 'Refresh the current look' },
  { mode: 'new', label: 'A completely new homepage' },
];

/** The note under the panel's title, by what kind of page it is (and, for the homepage, which way). */
export function redesignNote(page: string, template?: string, mode: RedesignMode = 'refresh'): string {
  if (page === 'index' && mode === 'new') return 'A new design for your homepage, drawn first as a picture, then built in your site\'s colors, fonts, header and footer. Your words, prices and forms come along, and your other pages do not change. It takes a few minutes and more AI work than other changes: once today\'s free previews are used, it uses your AI time.';
  if (page === 'index') return 'Your homepage keeps the look you chose when your site was built: each section gets a new layout in turn, and the top of the page keeps its style. You see all of it in one preview.';
  if (template && /product/.test(template)) return 'Every product page uses this layout.';
  return `Your words, prices and contact details stay. ${nameOr('Your site assistant')} composes a new layout for this page and shows it to you first.`;
}

/**
 * A new layout for one page, in the site's style: its words, facts, forms and
 * products stay unless the owner asks otherwise. The homepage is refreshed
 * section by section, or gets a whole new design. Versions to compare.
 */
export function RedesignPanel({ env, page, mode: initialMode = 'refresh' }: { env: EditorEnv; page: string; mode?: RedesignMode }) {
  const flow = useEditOperation();
  useFrameFollows(flow, env, page);
  const [instruction, setInstruction] = useState('');
  const [mode, setMode] = useState<RedesignMode>(initialMode);
  const p = pageFor(env.siteMap, page);
  const isHome = page === 'index';
  const fresh = isHome && mode === 'new';
  const title = isHome ? 'your homepage' : (p?.title ?? page);
  const busy = flow.state.phase === 'previewing' || flow.state.phase === 'publishing';
  // The choice is made before the preview: versions and refinements keep it.
  const chosen = flow.state.phase === 'previewed';

  return (
    <PanelFrame
      chip="Page"
      color="var(--purple)"
      title={fresh ? 'A new homepage' : `Redesign ${title}`}
      sub={fresh ? 'A new design in your site\'s colors and fonts' : 'A new layout in your site\'s style'}
      onClose={env.closePanel}
      testId="editor-redesign"
      footer={(
        <PreviewFlow
          flow={flow}
          canPreview={instruction.trim().length >= 3}
          onPreview={(refine) => { void flow.preview({ op: 'redesign_page', page, instruction: instruction.trim(), ...(isHome ? { mode } : {}) }, { refine }); }}
          workingText={fresh ? 'Drawing and building your new homepage. This takes a few minutes.' : 'Redesigning the page. This takes two to four minutes.'}
          phoneFirst={env.viewport === 'mobile'}
          onUndo={env.undo}
          onDone={() => { flow.reset(); setInstruction(''); env.refreshSiteMap(); }}
          versionable={flow.state.operation?.op === 'redesign_page'}
        />
      )}
    >
      {isHome && (
        <div className="wme-gs-suggest" role="radiogroup" aria-label="How to redesign your homepage" data-testid="redesign-modes">
          {HOMEPAGE_CHOICES.map((c) => (
            <button
              key={c.mode}
              type="button"
              role="radio"
              aria-checked={mode === c.mode}
              data-testid={`redesign-mode-${c.mode}`}
              className={mode === c.mode ? 'is-on' : undefined}
              style={mode === c.mode ? { borderColor: 'var(--purple)', color: 'var(--purple)', fontWeight: 600 } : undefined}
              disabled={busy || chosen}
              onClick={() => setMode(c.mode)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <p className="wme-gs-hint" style={{ margin: 0 }} data-testid="redesign-note">{redesignNote(page, p?.template, mode)}</p>
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-redesign">{fresh ? 'What should the new homepage feel like?' : 'How should it look?'}</label>
        <textarea
          id="wme-gs-redesign"
          data-testid="editor-instruction"
          className="wme-gs-textarea"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={fresh ? 'For example: bolder, with one big photo at the top and our coffees right after' : 'For example: more visual, with big photos and less text'}
          disabled={busy}
          maxLength={2000}
        />
        <div className="wme-gs-suggest" style={{ marginTop: 8 }}>
          {(fresh ? NEW_HOMEPAGE_SUGGESTIONS : REDESIGN_SUGGESTIONS).map((s) => (
            <button key={s} type="button" onClick={() => setInstruction((cur) => (cur.trim() ? `${cur.trim()}. ${s}` : s))} disabled={busy}>{s}</button>
          ))}
        </div>
      </div>
      <Thumbnails result={flow.state.preview} phone={env.viewport === 'mobile'} />
    </PanelFrame>
  );
}
