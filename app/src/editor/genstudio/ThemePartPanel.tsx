import React, { useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import type { EditOperation, EditView } from '../../types/edits';
import { KIND_COLORS } from './bindings';
import { useFrameFollows, type EditorEnv } from './env';
import { PanelFrame, PreviewFlow, Thumbnails } from './ui';
import { useEditOperation } from './useEditOperation';
import { menuForRegion } from './ChromePanel';
import { wordChanges } from './SectionPanel';
import { isDictatedText } from './dictated';
import { siteBrand, type SiteBrand } from '../../utils/brand';

/** What the owner reads when a classic theme's header or footer is clicked, in the site's brand. */
export function classicPartText(b: SiteBrand = siteBrand()): string {
  const who = b.mode === 'neutral' ? 'you' : b.name;
  return `Your theme draws this part itself. Here ${who} can change your site's name, tagline and logo, your menus and your widgets. For the rest, use your theme's settings.`;
}

/** The confirmation of "Back to your theme's version" (plan copy). */
export function resetPartText(region: 'header' | 'footer'): string {
  return `Your ${region} goes back to the one your theme came with. Your changes to it are kept in History.`;
}

const KIND_TITLES: Record<string, string> = { heading: 'Heading', text: 'Text', button: 'Button', 'list item': 'List item', quote: 'Quote', caption: 'Caption', summary: 'Summary', verse: 'Verse' };

const SUGGESTIONS: Record<'header' | 'footer', string[]> = {
  header: ['Add a Book a table button beside the menu', 'Make the header background dark', 'Make the site name bigger'],
  footer: ['Put our opening hours in the footer', 'Make the footer more compact', 'Add a short line about us'],
};

/** The operation the panel sends: the typed words and names, an instruction (with the view it is read with), or the theme's version back. */
export function partOperation(region: 'header' | 'footer', input: {
  resetting: boolean; instruction: string; texts: Array<{ path: string; text: string }>; links: Array<{ path: string; url: string }>;
  name?: string; tagline?: string; view?: EditView;
}): EditOperation | null {
  if (input.resetting) return { op: 'edit_chrome', region, reset: true };
  const identity = { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.tagline !== undefined ? { tagline: input.tagline } : {}) };
  const typed = input.texts.length > 0 || input.links.length > 0 || Object.keys(identity).length > 0;
  if (!input.instruction.trim() && typed) {
    return {
      op: 'edit_chrome', region,
      ...(input.texts.length ? { texts: input.texts } : {}),
      ...(input.links[0] ? { link: input.links[0] } : {}),
      ...(Object.keys(identity).length ? { identity } : {}),
    };
  }
  if (input.instruction.trim().length >= 3) return { op: 'edit_chrome', region, instruction: input.instruction.trim(), ...(input.view ? { view: input.view } : {}) };
  return null;
}

/**
 * The header or footer of a site WPMaven did not design. A classic theme
 * draws them itself: what can change here (name, tagline, logo, menus) is
 * offered, the rest is the theme's. A block theme keeps them as template
 * parts, used on every page: their words, the site's name and tagline they
 * show, a change asked in words, and the theme's own version back.
 */
export function ThemePartPanel({ env, region }: { env: EditorEnv; region: 'header' | 'footer' }) {
  const map = env.siteMap;
  const classic = map?.theme?.kind === 'classic';
  const part = map?.parts?.find((p) => p.slug === region);
  const menu = menuForRegion(map?.menus ?? [], region);
  const word = region === 'header' ? 'Header' : 'Footer';
  const flow = useEditOperation();
  useFrameFollows(flow, env);
  const [instruction, setInstruction] = useState('');
  const [words, setWords] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<Record<string, string>>({});
  const [name, setName] = useState<string | undefined>(undefined);
  const [tagline, setTagline] = useState<string | undefined>(undefined);
  const [resetting, setResetting] = useState(false);
  const blocks = part?.blocks ?? [];
  const changes = wordChanges(blocks, words, links);
  const siteName = map?.identity?.name ?? '';
  const siteTagline = map?.identity?.tagline ?? '';
  const nameChanged = name !== undefined && name.trim() !== siteName && name.trim() !== '' ? name.trim() : undefined;
  const taglineChanged = tagline !== undefined && tagline.trim() !== siteTagline ? tagline.trim() : undefined;
  const busy = flow.state.phase === 'previewing' || flow.state.phase === 'publishing';
  const shown = flow.state.phase !== 'idle' && flow.state.phase !== 'failed';
  const operation = partOperation(region, { resetting, instruction, texts: changes.texts, links: changes.links, name: nameChanged, tagline: taglineChanged, view: env.view });

  const actions = (
    <div className="wme-gs-actions">
      <Button variant="outline" size="sm" onClick={() => env.openPanel({ kind: 'identity' })}>Logo and site icon</Button>
      {menu && <Button variant="outline" size="sm" onClick={() => env.openPanel({ kind: 'menu', location: menu.location })} data-testid="editor-open-menu">Edit the menu</Button>}
      {region === 'footer' && !classic && <Button variant="outline" size="sm" onClick={() => env.openPanel({ kind: 'social' })} data-testid="editor-open-social">Social links</Button>}
    </div>
  );

  // A classic theme (or a block theme without this part): its name and tagline here, the rest is the theme's.
  if (classic || !part) {
    return (
      <PanelFrame
        chip={word}
        color={KIND_COLORS.chrome}
        title={`${word}, used on every page.`}
        sub={map?.theme?.name ? `Part of ${map.theme.name}` : undefined}
        onClose={env.closePanel}
        testId="editor-theme-part"
        footer={(nameChanged !== undefined || taglineChanged !== undefined || flow.state.phase !== 'idle') ? (
          <PreviewFlow
            flow={flow}
            canPreview={!!operation}
            onPreview={() => { if (operation) void flow.preview(operation); }}
            workingText="Preparing your site's new name."
            phoneFirst={env.viewport === 'mobile'}
            onUndo={env.undo}
            onDone={() => { flow.reset(); setName(undefined); setTagline(undefined); env.refreshSiteMap(); }}
          />
        ) : undefined}
      >
        <p className="wme-gs-note" data-testid="editor-classic-part">{classicPartText()}</p>
        <div data-testid="editor-part-identity">
          <label className="wme-gs-label" htmlFor={`wme-gs-site-name-${region}`}>Site name</label>
          <input id={`wme-gs-site-name-${region}`} data-testid="editor-site-name" className="wme-gs-input" value={name ?? siteName} onChange={(e) => setName(e.target.value)} disabled={busy || shown} maxLength={120} />
          <label className="wme-gs-label" htmlFor={`wme-gs-tagline-${region}`} style={{ marginTop: 8 }}>Tagline</label>
          <input id={`wme-gs-tagline-${region}`} data-testid="editor-site-tagline" className="wme-gs-input" value={tagline ?? siteTagline} onChange={(e) => setTagline(e.target.value)} disabled={busy || shown} maxLength={240} />
        </div>
        {flow.state.phase === 'idle' && actions}
      </PanelFrame>
    );
  }

  return (
    <PanelFrame
      chip={word}
      color={KIND_COLORS.chrome}
      title={`${word}, used on every page.`}
      sub={part.customized ? `Your own version of ${map?.theme?.name ?? 'your theme'}'s ${region}` : `As ${map?.theme?.name ?? 'your theme'} ships it`}
      onClose={env.closePanel}
      testId="editor-theme-part"
      footer={(
        <PreviewFlow
          flow={flow}
          canPreview={!!operation && changes.links.length <= 1}
          onPreview={(refine) => { if (operation) void flow.preview(operation, { refine: refine && operation.op === 'edit_chrome' && !!operation.instruction }); }}
          previewLabel={resetting ? 'Preview your theme\'s version' : 'Preview'}
          workingText={resetting ? `Preparing your theme's ${region}.` : `Changing the ${region} on every page. This can take up to a minute.`}
          phoneFirst={env.viewport === 'mobile'}
          onUndo={env.undo}
          onDone={() => { flow.reset(); setInstruction(''); setWords({}); setLinks({}); setName(undefined); setTagline(undefined); setResetting(false); env.refreshSiteMap(); }}
          versionable={!resetting && flow.state.operation?.op === 'edit_chrome' && !!flow.state.operation.instruction && !isDictatedText(instruction)}
        />
      )}
    >
      <p className="wme-gs-note" data-testid="editor-block-part">
        {part.customized ? `Your ${region} is your own version of the one your theme came with.` : `Your ${region} is the one your theme came with. Your first change makes it your own version.`}
      </p>
      {resetting ? (
        <div className="wme-gs-note is-warn" data-testid="editor-part-reset">
          <p style={{ margin: '0 0 6px' }}>{resetPartText(region)}</p>
          {!shown && <button type="button" className="wme-gs-link" onClick={() => setResetting(false)}>Keep my version</button>}
        </div>
      ) : (
        <>
          {(part.shows?.siteTitle || part.shows?.tagline) && (
            <div data-testid="editor-part-identity">
              {part.shows?.siteTitle && (
                <>
                  <label className="wme-gs-label" htmlFor={`wme-gs-site-name-${region}`}>Site name</label>
                  <input id={`wme-gs-site-name-${region}`} data-testid="editor-site-name" className="wme-gs-input" value={name ?? siteName} onChange={(e) => setName(e.target.value)} disabled={busy || shown} maxLength={120} />
                </>
              )}
              {part.shows?.tagline && (
                <>
                  <label className="wme-gs-label" htmlFor={`wme-gs-tagline-${region}`} style={{ marginTop: 8 }}>Tagline</label>
                  <input id={`wme-gs-tagline-${region}`} data-testid="editor-site-tagline" className="wme-gs-input" value={tagline ?? siteTagline} onChange={(e) => setTagline(e.target.value)} disabled={busy || shown} maxLength={240} />
                </>
              )}
              <p className="wme-gs-hint">Your site{'’'}s name and tagline show here and in browser tabs.</p>
            </div>
          )}
          {blocks.length > 0 && (
            <div data-testid="editor-block-words">
              <p className="wme-gs-section-title" style={{ marginBottom: 8 }}>Its words</p>
              {blocks.map((b) => (
                <div key={b.path} style={{ marginBottom: 10 }}>
                  <label className="wme-gs-label" htmlFor={`wme-gs-part-words-${b.path}`}>{KIND_TITLES[b.kind] ?? 'Text'}</label>
                  {b.kind === 'text' || b.text.length > 80 ? (
                    <textarea id={`wme-gs-part-words-${b.path}`} data-testid={`editor-words-${b.path}`} className="wme-gs-textarea" value={words[b.path] ?? b.text} onChange={(e) => setWords((cur) => ({ ...cur, [b.path]: e.target.value }))} disabled={busy || shown} maxLength={2000} rows={3} />
                  ) : (
                    <input id={`wme-gs-part-words-${b.path}`} data-testid={`editor-words-${b.path}`} className="wme-gs-input" value={words[b.path] ?? b.text} onChange={(e) => setWords((cur) => ({ ...cur, [b.path]: e.target.value }))} disabled={busy || shown} maxLength={2000} />
                  )}
                  {b.url !== undefined && (
                    <input aria-label={`${KIND_TITLES[b.kind] ?? 'Link'} address`} data-testid={`editor-link-${b.path}`} className="wme-gs-input" style={{ marginTop: 4 }} value={links[b.path] ?? b.url} onChange={(e) => setLinks((cur) => ({ ...cur, [b.path]: e.target.value }))} disabled={busy || shown} maxLength={2000} />
                  )}
                </div>
              ))}
              {changes.links.length > 1 && <p className="wme-gs-hint">Change one link at a time.</p>}
            </div>
          )}
          <div>
            <label className="wme-gs-label" htmlFor="wme-gs-part-instruction">What should change?</label>
            <textarea
              id="wme-gs-part-instruction"
              data-testid="editor-instruction"
              className="wme-gs-textarea"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={region === 'header' ? 'For example: add a Book a table button beside the menu' : 'For example: put our opening hours in the footer'}
              disabled={busy}
              maxLength={2000}
            />
            <div className="wme-gs-suggest" style={{ marginTop: 8 }}>
              {SUGGESTIONS[region].map((s) => (
                <button key={s} type="button" onClick={() => setInstruction(s)} disabled={busy}>{s}</button>
              ))}
            </div>
            <p className="wme-gs-hint">Change the words above and press Preview, or say what should change. Menus change in the menu editor.</p>
          </div>
        </>
      )}
      <Thumbnails result={flow.state.preview} phone={env.viewport === 'mobile'} />
      {flow.state.phase === 'idle' && (
        <>
          {actions}
          {part.customized && !resetting && (
            <Button variant="ghost" size="sm" onClick={() => setResetting(true)} data-testid="editor-part-back-to-theme">Back to your theme{'’'}s version</Button>
          )}
        </>
      )}
    </PanelFrame>
  );
}
