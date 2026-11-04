import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import { TOKEN_COLORS, type TokenColor } from '../../types/edits';
import { contrastRatio, fontHref, FONT_SHORTLIST, normalizeHex, validFontName } from './color';
import { useFrameFollows, type EditorEnv } from './env';
import { PanelFrame, PreviewFlow } from './ui';
import { useEditOperation } from './useEditOperation';

const COLOR_WORDS: Record<TokenColor, { label: string; hint: string }> = {
  bg: { label: 'Background', hint: 'Behind every page' },
  surface: { label: 'Surfaces', hint: 'Cards and panels' },
  ink: { label: 'Text', hint: 'Headings and paragraphs' },
  accent: { label: 'Accent', hint: 'Buttons and links' },
  accent2: { label: 'Second accent', hint: 'Highlights' },
};

/** The design system variable each color drives (live in the frame while choosing). */
export const TOKEN_VARS: Record<TokenColor, string> = {
  bg: '--ds-bg',
  surface: '--ds-surface',
  ink: '--ds-ink',
  accent: '--ds-accent',
  accent2: '--ds-accent-2',
};

export interface ContrastHint {
  label: string;
  ratio: number;
  ok: boolean;
}

/** The three readings the panel shows under the colors. */
export function contrastHints(colors: Record<TokenColor, string>): ContrastHint[] {
  const out: ContrastHint[] = [];
  const pairs: Array<[string, TokenColor, TokenColor, number]> = [
    ['Text on the background', 'ink', 'bg', 4.5],
    ['Text on surfaces', 'ink', 'surface', 4.5],
    ['Accent on the background', 'accent', 'bg', 3],
  ];
  for (const [label, fg, bg, min] of pairs) {
    const ratio = contrastRatio(colors[fg], colors[bg]);
    if (ratio !== null) out.push({ label, ratio, ok: ratio >= min });
  }
  return out;
}

/**
 * The site's colors and fonts. Each change shows live in the frame (the
 * design system's variables), with readability hints; the preview then
 * shows every page with the new design before anything is published.
 */
export function DesignPanel({ env }: { env: EditorEnv }) {
  // A site WPMaven did not design: its theme's global styles (block themes); a classic theme keeps its colours itself.
  const blockSite = env.siteMap?.engine === 'wordpress';
  const styles = env.siteMap?.styles;
  const roles = blockSite ? TOKEN_COLORS.filter((k) => k === 'bg' || k === 'ink' || k === 'accent' || (k === 'surface' && !!env.siteMap?.tokens?.colors?.surface)) : TOKEN_COLORS;
  const fontList = blockSite ? (styles?.fonts ?? []) : FONT_SHORTLIST;
  const tokens = env.siteMap?.tokens;
  const initialColors = useMemo(() => Object.fromEntries(TOKEN_COLORS.map((k) => [k, normalizeHex(tokens?.colors?.[k] ?? '') ?? ''])) as Record<TokenColor, string>, [tokens]);
  const [colors, setColors] = useState<Record<TokenColor, string>>(initialColors);
  const [display, setDisplay] = useState(tokens?.fonts?.display ?? '');
  const [body, setBody] = useState(tokens?.fonts?.body ?? '');
  // What the owner has typed stays when the site map arrives (or comes back after a publish).
  const touched = useRef<Set<string>>(new Set());
  useEffect(() => {
    setColors((cur) => Object.fromEntries(TOKEN_COLORS.map((k) => [k, touched.current.has(k) ? cur[k] : initialColors[k]])) as Record<TokenColor, string>);
    if (!touched.current.has('display')) setDisplay(tokens?.fonts?.display ?? '');
    if (!touched.current.has('body')) setBody(tokens?.fonts?.body ?? '');
  }, [initialColors, tokens]);
  const flow = useEditOperation();
  useFrameFollows(flow, env);
  const busy = flow.state.phase === 'previewing' || flow.state.phase === 'publishing';
  const envRef = useRef(env);
  envRef.current = env;

  // Live values leave the frame with the panel (unless they were published).
  useEffect(() => () => { envRef.current.resetTokensLive(); }, []);
  useEffect(() => {
    if (flow.state.phase === 'published') {
      envRef.current.resetTokensLive();
      touched.current.clear();
    }
  }, [flow.state.phase]);

  const resolved = useMemo(() => Object.fromEntries(TOKEN_COLORS.map((k) => [k, normalizeHex(colors[k]) ?? ''])) as Record<TokenColor, string>, [colors]);
  const changedColors = TOKEN_COLORS.filter((k) => resolved[k] && resolved[k] !== initialColors[k]);
  const invalid = TOKEN_COLORS.filter((k) => colors[k].trim() !== '' && !normalizeHex(colors[k]));
  const fontsChanged = {
    ...(display.trim() && display.trim() !== (tokens?.fonts?.display ?? '') ? { display: display.trim() } : {}),
    ...(body.trim() && body.trim() !== (tokens?.fonts?.body ?? '') ? { body: body.trim() } : {}),
  };
  const badFonts = Object.values(fontsChanged).some((f) => !validFontName(f));
  const hasChange = changedColors.length > 0 || Object.keys(fontsChanged).length > 0;
  const hints = contrastHints(Object.fromEntries(TOKEN_COLORS.map((k) => [k, resolved[k] || initialColors[k]])) as Record<TokenColor, string>);

  const setColor = (k: TokenColor, value: string) => {
    touched.current.add(k);
    setColors((c) => ({ ...c, [k]: value }));
    const hex = normalizeHex(value);
    if (hex && !blockSite) env.setTokensLive({ [TOKEN_VARS[k]]: hex });
  };

  const setFont = (which: 'display' | 'body', name: string) => {
    touched.current.add(which);
    (which === 'display' ? setDisplay : setBody)(name);
    if (!blockSite && validFontName(name) && name.trim().length >= 3) {
      env.loadFont(fontHref(name));
      env.setTokensLive({ [which === 'display' ? '--ds-font-display' : '--ds-font-body']: `'${name.trim().replace(/'/g, '')}'` });
    }
  };

  const resetAll = () => {
    touched.current.clear();
    setColors(initialColors);
    setDisplay(tokens?.fonts?.display ?? '');
    setBody(tokens?.fonts?.body ?? '');
    env.resetTokensLive();
    if (flow.state.phase === 'previewed') void flow.discard();
  };

  if (blockSite && styles && !styles.canWrite) {
    return (
      <PanelFrame chip="Design" color="var(--purple)" title="Colors and fonts" sub="On every page" onClose={env.closePanel}>
        <p className="wme-gs-note" data-testid="editor-styles-classic">{styles.reason ?? 'Your theme sets its colours and fonts itself. Change them in Appearance, Customize.'}</p>
      </PanelFrame>
    );
  }

  return (
    <PanelFrame
      chip="Design"
      color="var(--purple)"
      title="Colors and fonts"
      sub="On every page"
      onClose={env.closePanel}
      footer={(
        <PreviewFlow
          flow={flow}
          canPreview={hasChange && invalid.length === 0 && !badFonts}
          onPreview={() => {
            void flow.preview({
              op: 'set_design_tokens',
              ...(changedColors.length ? { colors: Object.fromEntries(changedColors.map((k) => [k, resolved[k]])) } : {}),
              ...(Object.keys(fontsChanged).length ? { fonts: fontsChanged } : {}),
            });
          }}
          workingText="Preparing every page with the new design."
          phoneFirst={env.viewport === 'mobile'}
          onUndo={env.undo}
          onDone={env.closePanel}
          extraActions={flow.state.phase === 'idle' && hasChange ? <Button variant="ghost" size="sm" onClick={resetAll}>Reset</Button> : undefined}
        />
      )}
    >
      <div className="wme-gs-colors">
        {roles.map((k) => (
          <div className="wme-gs-color" key={k}>
            <input
              type="color"
              value={resolved[k] || initialColors[k] || '#000000'}
              onChange={(e) => setColor(k, e.target.value)}
              aria-label={`${COLOR_WORDS[k].label} color picker`}
              disabled={busy}
            />
            <span>
              {COLOR_WORDS[k].label}
              <small style={{ display: 'block', color: 'var(--text-dim)', fontSize: 11 }}>{COLOR_WORDS[k].hint}</small>
            </span>
            <input
              className="wme-gs-input"
              data-testid={`token-${k}`}
              value={colors[k]}
              onChange={(e) => setColor(k, e.target.value)}
              aria-label={`${COLOR_WORDS[k].label} color`}
              aria-invalid={invalid.includes(k) ? 'true' : undefined}
              placeholder="#000000"
              spellCheck={false}
              maxLength={7}
              disabled={busy}
            />
          </div>
        ))}
      </div>
      {invalid.length > 0 && <p className="wme-gs-note is-warn" role="alert">A color is written like #2F5D3A.</p>}

      {hints.length > 0 && (
        <div>
          <p className="wme-gs-label">Readability</p>
          {hints.map((h) => (
            <div key={h.label} className={`wme-gs-ratio${h.ok ? '' : ' is-low'}`} data-testid="contrast-hint" data-ok={h.ok ? 'true' : 'false'}>
              <span>{h.label}</span>
              <span><b>{h.ratio.toFixed(1)}:1</b> {h.ok ? 'easy to read' : 'hard to read'}</span>
            </div>
          ))}
        </div>
      )}

      <div className="wme-gs-row2">
        <div>
          <label className="wme-gs-label" htmlFor="wme-gs-font-display">Headings font</label>
          <input id="wme-gs-font-display" data-testid="font-display" className="wme-gs-input" list="wme-gs-fonts" value={display} onChange={(e) => setFont('display', e.target.value)} disabled={busy} maxLength={60} />
        </div>
        <div>
          <label className="wme-gs-label" htmlFor="wme-gs-font-body">Text font</label>
          <input id="wme-gs-font-body" data-testid="font-body" className="wme-gs-input" list="wme-gs-fonts" value={body} onChange={(e) => setFont('body', e.target.value)} disabled={busy} maxLength={60} />
        </div>
      </div>
      <datalist id="wme-gs-fonts">
        {fontList.map((f) => <option key={f} value={f} />)}
      </datalist>
      {badFonts && <p className="wme-gs-note is-warn" role="alert">A font name uses letters, digits, spaces, dots and hyphens.</p>}
      {blockSite ? (
        <p className="wme-gs-hint" data-testid="editor-styles-fonts">Your theme comes with these fonts: {fontList.join(', ')}. The preview shows every page with your choice before anything goes live.</p>
      ) : (
        <p className="wme-gs-hint">What you choose shows in the page right away. The preview prepares every page with it before anything goes live.</p>
      )}
    </PanelFrame>
  );
}
