import React, { useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import type { SiteMapMenu } from '../../types/edits';
import { KIND_COLORS } from './bindings';
import { useFrameFollows, type EditorEnv } from './env';
import { PanelFrame, PreviewFlow, Thumbnails } from './ui';
import { useEditOperation } from './useEditOperation';

const SUGGESTIONS: Record<'header' | 'footer', string[]> = {
  header: ['Make the header background dark', 'Make the logo bigger', 'Make the button stand out more'],
  footer: ['Make the footer lighter', 'Put our opening hours in the footer', 'Make the footer more compact'],
};

/** The menu a region most likely shows (by its location's name), else the first or last. */
export function menuForRegion(menus: SiteMapMenu[], region: 'header' | 'footer'): SiteMapMenu | null {
  if (!menus.length) return null;
  const words = region === 'header' ? /primary|main|header|top|nav/i : /footer|bottom|secondary/i;
  return menus.find((m) => words.test(m.location) || words.test(m.label)) ?? (region === 'header' ? menus[0] : menus[menus.length - 1]);
}

/**
 * The header or the footer: they are the theme itself, so a change here
 * shows on every page. Menu links are changed in the menu editor.
 */
export function ChromePanel({ env, region }: { env: EditorEnv; region: 'header' | 'footer' }) {
  const flow = useEditOperation();
  useFrameFollows(flow, env);
  const [instruction, setInstruction] = useState('');
  const busy = flow.state.phase === 'previewing' || flow.state.phase === 'publishing';
  const chrome = env.siteMap?.chrome?.[region];
  const menu = menuForRegion(env.siteMap?.menus ?? [], region);
  const word = region === 'header' ? 'Header' : 'Footer';

  return (
    <PanelFrame
      chip={word}
      color={KIND_COLORS.chrome}
      title={`Your site${'’'}s ${region}`}
      sub="On every page"
      onClose={env.closePanel}
      footer={(
        <PreviewFlow
          versionable={flow.state.operation?.op === 'edit_chrome'}
          flow={flow}
          canPreview={instruction.trim().length >= 3}
          onPreview={(refine) => { void flow.preview({ op: 'edit_chrome', region, instruction: instruction.trim(), view: env.view }, { refine }); }}
          workingText={`Changing the ${region} on every page. This can take up to a minute.`}
          phoneFirst={env.viewport === 'mobile'}
          onUndo={env.undo}
          onDone={() => { flow.reset(); setInstruction(''); }}
        />
      )}
    >
      {chrome?.excerpt && <p className="wme-gs-hint">{chrome.excerpt}</p>}
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-chrome">What should change?</label>
        <textarea
          id="wme-gs-chrome"
          data-testid="editor-instruction"
          className="wme-gs-textarea"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={region === 'header' ? 'For example: make the header background dark' : 'For example: make the footer lighter'}
          disabled={busy}
          maxLength={2000}
        />
        <div className="wme-gs-suggest" style={{ marginTop: 8 }}>
          {SUGGESTIONS[region].map((s) => (
            <button key={s} type="button" onClick={() => setInstruction(s)} disabled={busy}>{s}</button>
          ))}
        </div>
      </div>
      <Thumbnails result={flow.state.preview} phone={env.viewport === 'mobile'} />
      {flow.state.phase === 'idle' && (
        <div className="wme-gs-note">
          <p style={{ margin: '0 0 8px' }}>The links in the menu are changed in the menu editor, so they stay in step with your pages.</p>
          <Button variant="outline" size="sm" onClick={() => env.openPanel({ kind: 'menu', location: menu?.location })} data-testid="editor-open-menu">
            Edit the menu
          </Button>
        </div>
      )}
    </PanelFrame>
  );
}
