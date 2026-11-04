import React, { useEffect, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import type { EditOperation, SiteMapBlockText } from '../../types/edits';
import { KIND_COLORS, KIND_WORDS, pageFor, placeTitle, sectionLabel, type BindingKind } from './bindings';
import { useFrameFollows, type EditorEnv } from './env';
import { PanelFrame, PreviewFlow, Thumbnails } from './ui';
import { useEditOperation } from './useEditOperation';
import { orderAfterMoves, stepMove, type SectionMove } from './sectionOrder';
import { isDictatedText } from './dictated';
import { siteBrand, type SiteBrand } from '../../utils/brand';

/** Owner copy for a section WordPress locks, in the site's brand. */
/** A page built with a page builder: what changes here, in the brand's words (null brand: neutral). */
export function builderText(builder: 'elementor' | 'divi', b: SiteBrand = siteBrand()): string {
  const who = b.mode === 'neutral' ? 'You can change' : `${b.name} changes`;
  return builder === 'elementor'
    ? `This page is built with Elementor. ${who} its words and pictures here. For its layout, open Elementor.`
    : 'This page is built with Divi. Ask the chat for help, or change it in Divi.';
}

export function lockedText(b: SiteBrand = siteBrand()): string {
  return b.mode === 'neutral' ? 'This part is locked in WordPress, so it stays as it is.' : `This part is locked in WordPress, so ${b.name} leaves it as it is.`;
}

const KIND_TITLES: Record<string, string> = { heading: 'Heading', text: 'Text', button: 'Button', 'list item': 'List item', quote: 'Quote', caption: 'Caption', summary: 'Summary', verse: 'Verse' };

/** The words and links of a block section the owner changed (a link at a time). */
export function wordChanges(blocks: SiteMapBlockText[], words: Record<string, string>, links: Record<string, string>): { texts: Array<{ path: string; text: string }>; links: Array<{ path: string; url: string }> } {
  return {
    texts: blocks.filter((b) => words[b.path] !== undefined && words[b.path].trim() !== b.text.trim()).map((b) => ({ path: b.path, text: words[b.path].trim() })),
    links: blocks.filter((b) => b.url !== undefined && links[b.path] !== undefined && links[b.path].trim() !== b.url && links[b.path].trim() !== '').map((b) => ({ path: b.path, url: links[b.path].trim() })),
  };
}

const SUGGESTIONS = [
  'Make it shorter',
  'Make the tone warmer',
  'Add a clear call to action',
  'Make it easier to read on phones',
];

/**
 * A section of a page: rewrite it from an instruction, or remove it. The
 * preview shows in the frame; checks name what a removal takes with it.
 * What a second click reaches inside it is listed too.
 */
export function SectionPanel({
  env, page, sectionId, label, inside,
}: {
  env: EditorEnv;
  page: string;
  sectionId: string;
  label: string;
  inside: Array<{ uid: string; kind: string; label: string }>;
}) {
  const flow = useEditOperation();
  useFrameFollows(flow, env, page);
  const [instruction, setInstruction] = useState('');
  const [removing, setRemoving] = useState(false);
  /** The moves of this session (one change: each one refines the preview on screen). */
  const [moves, setMoves] = useState<SectionMove[]>([]);
  useEffect(() => { if (flow.state.phase === 'idle') setMoves([]); }, [flow.state.phase]);
  const name = sectionLabel(env.siteMap, page, sectionId, label);
  // A page of WordPress blocks: the section's words by block, changed as typed (no model call).
  const mapSection = pageFor(env.siteMap, page)?.sections.find((x) => x.id === sectionId);
  // The owner's own blocks on a page WPMaven designed change the same way.
  const blockSection = env.siteMap?.engine === 'wordpress' || !!mapSection?.wordpress;
  const blockWords = blockSection ? (mapSection?.blocks ?? []) : [];
  const locked = blockSection && !!mapSection?.locked;
  // A section of a page built with Elementor: its words and pictures change here, its layout stays Elementor's.
  const builder = mapSection?.builder === 'elementor';
  const [words, setWords] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<Record<string, string>>({});
  const changes = wordChanges(blockWords, words, links);
  const wordsChanged = changes.texts.length > 0 || changes.links.length > 0;
  const pageTitle = placeTitle(env.siteMap, page);
  const busy = flow.state.phase === 'previewing' || flow.state.phase === 'publishing';
  const shown = flow.state.phase !== 'idle' && flow.state.phase !== 'failed';
  const moving = flow.state.operation?.op === 'move_section';
  // On a page WPMaven designed, its sections move among themselves (the owner's blocks
  // follow the section before them), and the owner's blocks do not move from here.
  const ownBlocks = env.siteMap?.engine !== 'wordpress' && !!mapSection?.wordpress;
  const pageSections = pageFor(env.siteMap, page)?.sections.filter((x) => env.siteMap?.engine === 'wordpress' || !x.wordpress).map((x) => x.id)
    ?? env.outline.filter((o) => o.page === page).map((o) => o.sectionId);
  const order = orderAfterMoves(pageSections, moves);
  const up = ownBlocks || builder ? null : stepMove(page, order, sectionId, 'up');
  const down = ownBlocks || builder ? null : stepMove(page, order, sectionId, 'down');

  const move = (m: SectionMove | null) => {
    if (!m) return;
    const refine = moving && flow.state.phase === 'previewed';
    void flow.preview(m, { refine }).then((r) => {
      if (r?.status === 'previewed' && r.ok) setMoves((cur) => [...(refine ? cur : []), m]);
    });
  };

  const preview = (refine: boolean) => {
    if (moving) {
      // The order on screen, prepared again from the live page, move by move.
      void (async () => {
        let ok = true;
        for (const [i, m] of moves.entries()) {
          if (!ok) break;
          const r = await flow.preview(m, { refine: i > 0 });
          ok = r?.status === 'previewed' && !!r.ok;
        }
      })();
      return;
    }
    const typed = !removing && !instruction.trim() && wordsChanged;
    const operation: EditOperation = removing
      ? { op: 'remove_section', page, sectionId }
      : typed
        ? { op: 'edit_section', page, sectionId, ...(changes.texts.length ? { texts: changes.texts } : {}), ...(changes.links[0] ? { link: changes.links[0] } : {}) }
        : { op: 'edit_section', page, sectionId, instruction: instruction.trim(), view: env.view };
    void flow.preview(operation, { refine: refine && !removing && !typed });
  };

  return (
    <PanelFrame
      chip={KIND_WORDS.section}
      color={KIND_COLORS.section}
      title={name}
      sub={`On ${pageTitle}`}
      onClose={env.closePanel}
      footer={(
        <PreviewFlow
          flow={flow}
          canPreview={!moving && !locked && (builder ? wordsChanged && changes.links.length <= 1 : removing || instruction.trim().length >= 3 || (wordsChanged && changes.links.length <= 1))}
          onPreview={preview}
          previewLabel={removing ? 'Preview without it' : 'Preview'}
          workingText={moving ? 'Moving the section.' : removing ? 'Preparing the page without this section.' : 'Rewriting this section. This can take up to a minute.'}
          phoneFirst={env.viewport === 'mobile'}
          onUndo={env.undo}
          onDone={() => { flow.reset(); setInstruction(''); setRemoving(false); setMoves([]); setWords({}); setLinks({}); }}
          versionable={!moving && !removing && flow.state.operation?.op === 'edit_section' && !!flow.state.operation.instruction && !isDictatedText(instruction)}
        />
      )}
    >
      {locked && <p className="wme-gs-note is-warn" data-testid="editor-locked">{lockedText()}</p>}
      {builder && <p className="wme-gs-note" data-testid="editor-builder-notice">{builderText('elementor')}</p>}
      {!locked && !removing && blockWords.length > 0 && (
        <div data-testid="editor-block-words">
          <p className="wme-gs-section-title" style={{ marginBottom: 8 }}>Its words</p>
          {blockWords.map((b) => (
            <div key={b.path} style={{ marginBottom: 10 }}>
              <label className="wme-gs-label" htmlFor={`wme-gs-words-${b.path}`}>{KIND_TITLES[b.kind] ?? 'Text'}</label>
              {b.kind === 'text' || b.kind === 'quote' || b.text.length > 80 ? (
                <textarea
                  id={`wme-gs-words-${b.path}`}
                  data-testid={`editor-words-${b.path}`}
                  className="wme-gs-textarea"
                  value={words[b.path] ?? b.text}
                  onChange={(e) => setWords((cur) => ({ ...cur, [b.path]: e.target.value }))}
                  disabled={busy || shown}
                  maxLength={2000}
                  rows={3}
                />
              ) : (
                <input
                  id={`wme-gs-words-${b.path}`}
                  data-testid={`editor-words-${b.path}`}
                  className="wme-gs-input"
                  value={words[b.path] ?? b.text}
                  onChange={(e) => setWords((cur) => ({ ...cur, [b.path]: e.target.value }))}
                  disabled={busy || shown}
                  maxLength={2000}
                />
              )}
              {b.url !== undefined && (
                <input
                  aria-label={`${KIND_TITLES[b.kind] ?? 'Link'} address`}
                  data-testid={`editor-link-${b.path}`}
                  className="wme-gs-input"
                  style={{ marginTop: 4 }}
                  value={links[b.path] ?? b.url}
                  onChange={(e) => setLinks((cur) => ({ ...cur, [b.path]: e.target.value }))}
                  disabled={busy || shown}
                  maxLength={2000}
                />
              )}
            </div>
          ))}
          {changes.links.length > 1 && <p className="wme-gs-hint">Change one link at a time.</p>}
          <p className="wme-gs-hint">{builder ? 'Change the words here and press Preview.' : 'Change the words here and press Preview, or say below what should change.'}</p>
        </div>
      )}
      {locked || builder ? null : removing ? (
        <div className="wme-gs-note is-warn">
          <p style={{ margin: '0 0 6px' }}>This takes the section {'“'}{name}{'”'} off {pageTitle}. The preview shows the page without it, and the checks name anything that leaves with it, like a signup form.</p>
          {!shown && <button type="button" className="wme-gs-link" onClick={() => setRemoving(false)}>Keep it and change it instead</button>}
        </div>
      ) : (
        <div>
          <label className="wme-gs-label" htmlFor="wme-gs-instruction">What should change?</label>
          <textarea
            id="wme-gs-instruction"
            data-testid="editor-instruction"
            className="wme-gs-textarea"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="For example: make the heading shorter and mention free delivery"
            disabled={busy}
            maxLength={2000}
          />
          <div className="wme-gs-suggest" style={{ marginTop: 8 }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => setInstruction((cur) => (cur.trim() ? `${cur.trim()}. ${s}` : s))} disabled={busy}>{s}</button>
            ))}
          </div>
          {flow.state.phase === 'previewed' && !moving && (
            <p className="wme-gs-hint" style={{ marginTop: 8 }}>
              {isDictatedText(instruction)
                ? 'Not quite right? Say what to change and press Preview again: it builds on this preview.'
                : 'Not quite right? Say what to change and press Preview again to build on this version, or try another version.'}
            </p>
          )}
          {flow.state.phase === 'previewed' && moving && (
            <p className="wme-gs-hint" style={{ marginTop: 8 }}>Keep moving it up or down. It stays one change.</p>
          )}
        </div>
      )}

      <Thumbnails result={flow.state.preview} phone={env.viewport === 'mobile'} />

      {!shown && inside.length > 0 && !removing && (
        <div>
          <p className="wme-gs-section-title" style={{ marginBottom: 8 }}>In this section</p>
          <div className="wme-gs-suggest">
            {inside.map((item) => (
              <button key={item.uid} type="button" onClick={() => env.select({ uid: item.uid })} title={`Change this ${KIND_WORDS[item.kind as BindingKind]?.toLowerCase() ?? 'part'}`}>
                {KIND_WORDS[item.kind as BindingKind] ?? 'Part'}{item.label ? `: ${item.label}` : ''}
              </button>
            ))}
          </div>
          <p className="wme-gs-hint" style={{ marginTop: 6 }}>Or click it in the page.</p>
        </div>
      )}

      {!removing && !ownBlocks && !builder && (!shown || moving) && (
        <div className="wme-gs-actions">
          <Button
            variant="outline"
            size="sm"
            data-testid="editor-move-up"
            disabled={!up || flow.state.phase === 'previewing' || flow.state.phase === 'publishing'}
            title={up ? 'Move this section above the one before it' : 'Already the first section'}
            onClick={() => move(up)}
          >
            Move up
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="editor-move-down"
            disabled={!down || flow.state.phase === 'previewing' || flow.state.phase === 'publishing'}
            title={down ? 'Move this section below the one after it' : 'Already the last section'}
            onClick={() => move(down)}
          >
            Move down
          </Button>
        </div>
      )}

      {!shown && !removing && !builder && (
        <div className="wme-gs-actions" style={{ marginTop: 'auto' }}>
          <Button variant="outline" size="sm" onClick={() => env.openPanel({ kind: 'add-section', page, afterSectionId: sectionId })} data-testid="editor-add-section-below">Add a section below</Button>
          <Button variant="ghost" size="sm" onClick={() => setRemoving(true)} style={{ color: 'var(--rose)' }} data-testid="editor-remove-section">Remove this section</Button>
        </div>
      )}
    </PanelFrame>
  );
}
