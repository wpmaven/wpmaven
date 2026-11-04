import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { fetchShowable, type EditorItem, type TemplateKind } from '../../utils/editorAddress';
import { WINDOW_WORDS } from './labels';

/** How long the search field waits after the last key before it asks WordPress. */
const SEARCH_WAIT_MS = 250;

/**
 * The product page's (or post page's) chooser in the editor's bar
 * (2026-10-19): "Showing: Stoneware Jug". It lists every published product
 * (or post), newest first, with search; the template looks different per
 * record (the tote shows its options, the jug its empty picture), so the
 * owner picks the one to see it with.
 */
export function TemplateChooser({ kind, shownId, shownTitle, onPick }: {
  kind: TemplateKind;
  shownId: number;
  shownTitle: string;
  onPick: (item: EditorItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<EditorItem[] | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // The list, read when it opens and again once the search rests.
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      void fetchShowable(kind, query).then((list) => { if (live) setItems(list); });
    }, query.trim() ? SEARCH_WAIT_MS : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [open, query, kind]);

  // An outside click or Escape closes it.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="wme-gs-page" ref={boxRef}>
      <button
        type="button"
        className="wme-gs-tool wme-gs-page-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setQuery(''); setItems(null); }}
        data-testid="editor-template-chooser"
      >
        <span>{WINDOW_WORDS.showing}: {shownTitle || '…'}</span>
        <ChevronDown />
      </button>
      {open && (
        <div className="wme-gs-menu" role="listbox" aria-label={kind === 'product' ? 'Products' : 'Posts'}>
          <div style={{ padding: '6px 8px' }}>
            <input
              className="wme-gs-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={WINDOW_WORDS.findShown}
              aria-label={kind === 'product' ? 'Find a product by its name' : 'Find a post by its title'}
              data-testid="editor-template-chooser-search"
              autoFocus
              style={{ width: '100%' }}
            />
          </div>
          {items === null && <p className="wme-gs-hint" style={{ margin: '6px 12px' }}>…</p>}
          {items !== null && !items.length && <p className="wme-gs-hint" role="status" style={{ margin: '6px 12px' }}>{WINDOW_WORDS.noneShown}</p>}
          {(items ?? []).map((item) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={item.id === shownId}
              aria-current={item.id === shownId}
              onClick={() => { setOpen(false); if (item.id !== shownId) onPick(item); }}
            >
              <span>{item.title}</span>
              {item.price_text ? <small>{item.price_text}</small> : <small />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
