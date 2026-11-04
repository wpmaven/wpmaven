import React, { useEffect, useRef, useState } from 'react';
import { ChatInput, Button } from '@yotako/webmaven-ui';
import { ChevronDown, CircleCheckBig, RefreshCw, X } from 'lucide-react';
import { BrandLogoAnimation } from '../../components/BrandLoader';
import DashboardOnlyCard from '../../components/Dashboard/DashboardOnlyCard';
import { isAiEditingEnabled } from '../../utils/siteChat';
import { stageBox, type IframeOffset } from '../components/SiteIframe';
import { SELECTED_TAG_HEIGHT, tagBox, tagWidth, windowPlacement } from './placement';
import { freeformEngine, quickActionsFor, type QuickAction, type QuickEngine } from './quickActions';
import { describeDestination, destinationsFor, type PickItem } from './destinations';
import { DestinationLine, DestinationPicker } from './DestinationParts';
import type { SiteMap } from '../../types/edits';
import { JOB_WORDS, TEMPLATE_LINES, WINDOW_WORDS, caseLabel, workingWords } from './labels';
import { elementColor, elementTitle, formFieldOf, planOwnTool, squashText, type ElementSelection, type OwnInput, type OwnTool } from './elementEdit';
import { AT_ONCE, OwnToolPanel, useOwnItem } from './OwnTools';
import type { QuickEditApi } from './useQuickEdit';

/**
 * The window's box and its Send: their own test ids, so the chat beside it
 * keeps chat-input and chat-send to itself.
 */
export const WINDOW_INPUT_IDS = { inputTestId: 'editor-window-input', sendTestId: 'editor-window-send' } as const;

/**
 * The editor window: beside the element the owner clicked, its quick actions
 * and a box to say what to change, then the change's preview with Retry,
 * Discard and Apply. Apply puts the change live at once, with its undo.
 * The same window as before; every change now goes through the edit engine.
 */
export function QuickWindow({
  selected,
  iframeOffset,
  quick,
  notice = null,
  isEditing = false,
  siteMap = null,
  page = '',
  origin = '',
  onClose,
  onMore,
  onWholeSection,
  onWholeForm = null,
  onCross = null,
  onOpen = null,
}: {
  selected: ElementSelection;
  iframeOffset: IframeOffset;
  quick: QuickEditApi;
  /** Why this element cannot be changed here (a part the theme draws); the window says only that. */
  notice?: string | null;
  /** The owner is typing in the element (its tag then says "editing"). */
  isEditing?: boolean;
  /** The site map (where a link goes, the pages to point it to, what the actions can change). */
  siteMap?: SiteMap | null;
  /** The page in the frame (its slug), and this site's address. */
  page?: string;
  origin?: string;
  onClose: () => void;
  /** The element's own panel, in the sidebar over the chat. */
  onMore: (() => void) | null;
  /** The section, header or footer it sits in. */
  onWholeSection: (() => void) | null;
  /** The form it sits in (a field, a label, a send button): offered instead of the section. */
  onWholeForm?: (() => void) | null;
  /** The same part in the other editor: the product (or post) from the product page, the product page from the product. */
  onCross?: ((to: 'record' | 'template') => void) | null;
  /** Somewhere else: the store's screen of the product, a category's own page. */
  onOpen?: ((what: 'store-product' | 'category') => void) | null;
}) {
  // Chat and AI editing run in the dashboard while the switch is off (1.2.9).
  const aiOn = isAiEditingEnabled();
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(400);
  // A post's or a product's own part: the item, read for its actions (its prices, its pictures) and the operations they send.
  const own = useOwnItem(selected);
  const setOwn = quick.setOwn;
  useEffect(() => { setOwn?.(own); }, [own, setOwn]);
  // A crossing or a place to open shows only when the editor can take it there.
  const actions = quickActionsFor(selected, siteMap, own).filter((a) => (a.does !== 'cross' || !!onCross) && (a.does !== 'open' || !!onOpen));
  // Visitors' reviews are theirs: the window says so, and offers nothing.
  const note = notice ?? (selected.single && selected.ownPart === 'Reviews' ? WINDOW_WORDS.reviews : null);
  // A sentence to finish, put in the box by an action ("Change the placeholder to [new placeholder]"), and the engine it goes to.
  const [seed, setSeed] = useState<{ text: string; token: number } | null>(null);
  const fillEngine = useRef<QuickEngine | 'image' | null>(null);
  // The list of places a link can go to (or pages a menu can add), open under the actions.
  const [picking, setPicking] = useState<'link' | 'menu' | null>(null);
  // A post's or a product's own part: the tool open under the actions (a price field, the categories, the media library), and why one could not send.
  const [ownTool, setOwnTool] = useState<OwnTool | null>(null);
  const [ownProblem, setOwnProblem] = useState<string | null>(null);
  useEffect(() => { setSeed(null); setPicking(null); setOwnTool(null); setOwnProblem(null); fillEngine.current = null; }, [selected.uid]);
  const siteOrigin = origin || (typeof window === 'undefined' ? '' : window.location.origin);
  const destination = describeDestination(selected.link, selected.button, { map: siteMap, page, origin: siteOrigin });

  // The window's height follows its content.
  useEffect(() => {
    if (!panelRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setPanelHeight(entry.contentRect.height);
    });
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, []);

  // The element on the stage (the frame's own pixels times its scale), and
  // its tag over the outline, which the window keeps clear of.
  const onStage = stageBox(selected.rect, iframeOffset.scale);
  const tagWords = tagWidth(elementTitle(selected), [selected.template ? WINDOW_WORDS.template : '', isEditing ? 'editing' : selected.live ? 'live' : ''].filter(Boolean).join(' '));
  const tag = tagBox(onStage, SELECTED_TAG_HEIGHT, tagWords, typeof window === 'undefined' ? 0 : window.innerWidth);
  const place = windowPlacement(onStage, iframeOffset, panelHeight, tag);
  const freeform = (msg: string) => {
    if (!msg.trim()) return;
    const engine = fillEngine.current || (selected.category === 'image' ? 'image' : freeformEngine(selected.category, selected.kind));
    fillEngine.current = null;
    void quick.run(engine, msg);
  };
  const fillBox = (text: string, engine: QuickEngine | 'image') => {
    fillEngine.current = engine;
    setPicking(null);
    setOwnTool(null);
    setSeed({ text, token: Date.now() });
  };
  /** A tool's change: sent (at once, or previewed first), or why it cannot be. */
  const sendOwn = (input: OwnInput): string | null => {
    const plan = planOwnTool(selected, input, own, siteMap);
    if ('problem' in plan) return plan.problem;
    setOwnTool(null);
    setOwnProblem(null);
    void quick.send(plan.operation, plan.how, 'instruction' in input ? WINDOW_WORDS.makingPicture : input.tool === 'alt' ? WINDOW_WORDS.writingAlt : undefined);
    return null;
  };
  const runAction = (a: QuickAction) => {
    setOwnProblem(null);
    if (a.does === 'cross') { onCross?.(a.to); return; }
    if (a.does === 'open') { onOpen?.(a.open); return; }
    if (a.does === 'run') { setPicking(null); setOwnTool(null); void quick.run(a.engine, a.prompt, workingWords(a.id)); }
    else if (a.does === 'fill') fillBox(a.text, a.engine);
    else if (a.does === 'panel') onMore?.();
    else if (a.does === 'own') {
      setPicking(null);
      if (AT_ONCE.has(a.own)) setOwnProblem(sendOwn({ tool: a.own } as OwnInput));
      else setOwnTool((cur) => (cur === a.own ? null : a.own));
    } else {
      setOwnTool(null);
      setPicking((cur) => (cur === a.pick ? null : a.pick));
    }
  };
  const pickPlace = (item: PickItem) => { setPicking(null); void quick.run('section', item.prompt); };
  const boxSeed = seed ? { seedText: seed.text, seedToken: seed.token } : {};

  // A picture (2026-10-19): its alt text on a line of its own, read only (Write Alt Text writes it); the label names it.
  const picturePart = selected.category === 'image' || selected.ownPart === 'Pictures' || selected.ownPart === 'Featured image';
  const snippet = picturePart ? '' : squashText(selected.textContent, 83);
  // Its alt text: the picture's own (a gallery's words are its zoom button's), else what the frame read.
  const altMatch = /<img\b[^>]*\balt="([^"]*)"/i.exec(selected.content);
  const pictureAlt = altMatch ? altMatch[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'") : selected.category === 'image' ? selected.textContent : '';
  // The picture a picture tool starts from: the product's by its place, else the one the part shows.
  const shownPicture = (own?.kind === 'product' && selected.ownPart === 'Pictures' ? own.product.pictures[selected.picture ?? 0]?.src : undefined)
    ?? /<img\b[^>]*\bsrc="([^"]+)"/i.exec(selected.content)?.[1] ?? null;
  const busy = quick.phase === 'working' || quick.phase === 'applying';
  const errorText = quick.error === 'no-place' ? WINDOW_WORDS.noPlace : quick.error;

  const presets = actions.length > 0 ? (
    <>
      <div style={{ padding: '10px 16px', display: 'flex', flexWrap: 'wrap', gap: 6 }} data-testid="editor-quick-actions">
        {actions.map((a) => (
          <Button
            key={a.id}
            variant="outline"
            size="sm"
            onClick={() => runAction(a)}
            aria-expanded={a.does === 'pick' ? picking === a.pick : a.does === 'own' && !AT_ONCE.has(a.own) ? ownTool === a.own : undefined}
            rightIcon={a.does === 'pick' || (a.does === 'own' && !AT_ONCE.has(a.own)) ? <ChevronDown size={12} /> : undefined}
            data-testid={`quick-${a.id}`}
          >
            {a.label}
          </Button>
        ))}
      </div>
      {picking && (
        <DestinationPicker
          lists={destinationsFor(siteMap, page, picking, siteOrigin)}
          what={picking}
          onPick={pickPlace}
          onFill={(text) => fillBox(text, 'section')}
        />
      )}
      {ownTool && <OwnToolPanel tool={ownTool} own={own} term={selected.term ?? null} picture={shownPicture} choices={ownTool === 'form-choices' ? formFieldOf(selected, siteMap)?.options ?? null : null} onSubmit={sendOwn} onCancel={() => setOwnTool(null)} />}
      {ownProblem && <p role="alert" className="wme-gs-note is-warn" style={{ margin: '0 16px 12px' }} data-testid="editor-own-problem">{ownProblem}</p>}
    </>
  ) : <div style={{ height: 10 }} />;
  const whole = onWholeForm
    ? <Button variant="ghost" size="sm" onClick={onWholeForm} data-testid="editor-whole-form">{caseLabel(WINDOW_WORDS.wholeForm)}</Button>
    : onWholeSection
      ? <Button variant="ghost" size="sm" onClick={onWholeSection} data-testid="editor-whole-section">{caseLabel(WINDOW_WORDS.wholeSection)}</Button>
      : null;
  const extras = (onMore || whole) ? (
    <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      {whole}
      {onMore && (
        <Button variant="ghost" size="sm" onClick={onMore} data-testid="editor-more-options">{caseLabel(WINDOW_WORDS.moreOptions)}</Button>
      )}
    </div>
  ) : null;

  return (
    <div
      ref={panelRef}
      data-testid="editor-window"
      data-tour="editor-quick"
      data-side={place.side}
      style={{
        position: 'absolute',
        top: place.top,
        left: place.left,
        width: place.width,
        maxHeight: place.maxHeight,
        transition: 'top 0.2s ease, left 0.2s ease',
        background: 'color-mix(in srgb, var(--bg) 85%, transparent)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid var(--glass-border)',
        borderRadius: 16,
        boxShadow: 'var(--glass-shadow)',
        zIndex: 300,
        fontFamily: '"Inter", sans-serif',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header: what was clicked */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            data-testid="editor-window-kind"
            style={{ background: `color-mix(in srgb, ${elementColor(selected)} 12%, transparent)`, color: elementColor(selected), padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', flexShrink: 0 }}
          >
            {elementTitle(selected)}
            {selected.template && <span data-testid="editor-window-template" style={{ marginLeft: 6, opacity: 0.85 }}>· {WINDOW_WORDS.template}</span>}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={selected.textContent}>
            {snippet}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={WINDOW_WORDS.close}
          data-testid="editor-window-close"
          style={{ width: 28, height: 28, border: '1px solid var(--glass-border)', borderRadius: '50%', background: 'var(--bg-raised)', cursor: 'pointer', color: 'var(--text-dim)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <X size={14} />
        </button>
      </div>

      {picturePart && !note && (
        <p data-testid="editor-window-alt" style={{ margin: 0, padding: '8px 16px 0', fontSize: 12, lineHeight: 1.45, color: 'var(--text-dim)' }}>
          <b style={{ color: 'var(--text)', fontWeight: 600 }}>{WINDOW_WORDS.altText}</b>{' '}
          {squashText(pictureAlt, 300) || <i>{WINDOW_WORDS.noAltText}</i>}
        </p>
      )}

      {/* A part printed on more than one page: what a change to it reaches */}
      {selected.template && (
        <p data-testid="editor-window-reach" style={{ margin: 0, padding: '8px 16px', fontSize: 12, fontWeight: 600, color: 'var(--purple)', borderBottom: '1px solid var(--glass-border)' }}>
          {TEMPLATE_LINES[selected.template]}
        </p>
      )}

      {/* Where it goes (a link), or what it does (a button) */}
      {!note && destination && <DestinationLine dest={destination} />}

      {/* A part the theme draws: where to change it, nothing else */}
      {note && (
        <div role="note" data-testid="editor-theme-part" style={{ margin: 16, padding: '10px 12px', borderRadius: 8, background: 'var(--glass)', border: '1px solid var(--glass-border)', fontSize: 13, lineHeight: 1.5, color: 'var(--text)' }}>
          {note}
        </div>
      )}

      {/* AI editing off in WP-admin (1.2.9): the dashboard card, nothing else */}
      {!note && !aiOn && <DashboardOnlyCard variant="editorAI" compact bare />}

      {/* Working: the logo, and for a long change what it is doing */}
      {!note && aiOn && busy && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '32px 16px' }} data-testid="editor-window-working">
          {/* The mark at half its old size (2026-10-17): the window stays about the change, not the logo. */}
          <BrandLogoAnimation state="working" size={48} />
          {quick.long && quick.phase === 'working' && <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>{WINDOW_WORDS.longWork}</p>}
          {/* The change goes on when the window closes or another part is chosen: Stop is the way to drop it. */}
          {quick.phase === 'working' && (
            <Button variant="ghost" size="sm" onClick={() => { void quick.discard(); }} data-testid="editor-window-stop">
              {caseLabel(JOB_WORDS.stop)}
            </Button>
          )}
        </div>
      )}

      {/* Error: the reason, then the actions again */}
      {!note && aiOn && quick.phase === 'error' && (
        <>
          <div role="alert" data-testid="editor-window-error" style={{ padding: '10px 16px', margin: '12px 16px', background: 'color-mix(in srgb, var(--rose) 12%, transparent)', color: 'var(--rose)', borderRadius: 8, fontSize: 13 }}>
            {errorText}
          </div>
          <div style={{ flex: 1 }} />
          {presets}
          <div style={{ padding: '0 16px 12px' }}>
            <ChatInput placeholder={WINDOW_WORDS.describe} onSend={freeform} {...boxSeed} {...WINDOW_INPUT_IDS} />
          </div>
          {extras}
        </>
      )}

      {/* The owner's own words, typed on the page */}
      {!note && quick.phase === 'typed' && quick.typed && (
        <>
          <div style={{ padding: '12px 16px' }} data-testid="editor-window-typed">
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>{WINDOW_WORDS.yourEdit}</p>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{squashText(quick.typed.after, 300)}</p>
            {quick.error && <p role="alert" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--rose)' }}>{errorText}</p>}
          </div>
          <div style={{ padding: '8px 16px 12px', display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--glass-border)' }}>
            <Button variant="bare" onClick={() => { void quick.discard(); }} title={WINDOW_WORDS.discard} data-testid="editor-window-discard">
              <X size={16} />
            </Button>
            <Button variant="primary" size="sm" style={{ marginLeft: 'auto' }} leftIcon={<CircleCheckBig size={14} />} onClick={() => { void quick.apply(); }} data-testid="editor-window-apply">
              {caseLabel(WINDOW_WORDS.apply)}
            </Button>
          </div>
        </>
      )}

      {/* The preview: what changed, another change, Retry, Discard, Apply */}
      {!note && aiOn && quick.phase === 'result' && quick.preview && (
        <>
          <div style={{ padding: '12px 16px' }} data-testid="editor-window-result">
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>{quick.preview.summary}</p>
            {quick.error && <p role="alert" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--rose)' }}>{errorText}</p>}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ padding: '0 16px 8px' }}>
            <ChatInput placeholder={WINDOW_WORDS.describeAnother} onSend={freeform} {...boxSeed} {...WINDOW_INPUT_IDS} />
          </div>
          <div style={{ padding: '8px 16px 12px', display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--glass-border)' }}>
            <Button variant="bare" onClick={() => { void quick.retry(); }} title={WINDOW_WORDS.retry} data-testid="editor-window-retry">
              <RefreshCw size={16} />
            </Button>
            <Button variant="bare" onClick={() => { void quick.discard(); }} title={WINDOW_WORDS.discard} data-testid="editor-window-discard">
              <X size={16} />
            </Button>
            <Button variant="primary" size="sm" style={{ marginLeft: 'auto' }} leftIcon={<CircleCheckBig size={14} />} onClick={() => { void quick.apply(); }} data-testid="editor-window-apply">
              {caseLabel(WINDOW_WORDS.apply)}
            </Button>
          </div>
        </>
      )}

      {/* Idle (or the answer went to the chat): the quick actions and the box */}
      {!note && aiOn && (quick.phase === 'idle' || quick.phase === 'asked') && (
        <>
          {quick.phase === 'asked' && (
            <p role="status" data-testid="editor-window-asked" style={{ margin: '12px 16px 0', fontSize: 13, color: 'var(--text-dim)' }}>{WINDOW_WORDS.inChat}</p>
          )}
          <div style={{ flex: 1 }} />
          {presets}
          <div style={{ padding: '0 16px 12px' }}>
            <ChatInput placeholder={WINDOW_WORDS.describe} onSend={freeform} {...boxSeed} {...WINDOW_INPUT_IDS} />
          </div>
          {extras}
        </>
      )}
    </div>
  );
}
