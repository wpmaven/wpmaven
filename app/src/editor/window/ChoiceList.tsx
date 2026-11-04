import React, { useState } from 'react';
import { X } from 'lucide-react';

/** One line of the list: its words, and its second field (a value's price) when the list has one. */
export interface ChoiceRow {
  key: string;
  text: string;
  extra?: string;
  /** Its words cannot be retyped (an option value WooCommerce keeps on its variation): moved or removed only. */
  fixed?: boolean;
}

/**
 * A list of choices changed in the editor window (2026-10-19): a form's
 * dropdown, a product's option values. One line each, typed in place,
 * dragged to reorder, removed by its x; a line at the end adds one (Enter).
 * A second field per line (extra) carries a value's price, optional.
 */
export function ChoiceList({ rows, onChange, addHint, extra = null }: {
  rows: ChoiceRow[];
  onChange: (rows: ChoiceRow[]) => void;
  addHint: string;
  extra?: { label: string; placeholder: string } | null;
}) {
  const [fresh, setFresh] = useState('');
  const [freshExtra, setFreshExtra] = useState('');
  const [dragged, setDragged] = useState<number | null>(null);
  const set = (i: number, patch: Partial<ChoiceRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => {
    const text = fresh.replace(/\s+/g, ' ').trim();
    if (!text) return;
    onChange([...rows, { key: `new-${rows.length}-${text}`, text, ...(extra ? { extra: freshExtra.trim() } : {}) }]);
    setFresh('');
    setFreshExtra('');
  };
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    add();
  };
  return (
    <div className="wme-gs-choices" data-testid="editor-choice-list">
      {rows.map((r, i) => (
        <div
          key={r.key}
          className="wme-gs-choice"
          draggable
          onDragStart={() => setDragged(i)}
          onDragOver={(e) => {
            e.preventDefault();
            if (dragged === null || dragged === i) return;
            const next = rows.slice();
            const [moved] = next.splice(dragged, 1);
            next.splice(i, 0, moved);
            onChange(next);
            setDragged(i);
          }}
          onDragEnd={() => setDragged(null)}
        >
          <span className="wme-gs-grip" aria-hidden="true">⋮⋮</span>
          {r.fixed
            ? <span className="wme-gs-choice-text">{r.text}</span>
            : <input className="wme-gs-choice-text" value={r.text} onChange={(e) => set(i, { text: e.target.value })} aria-label={r.text || addHint} maxLength={200} />}
          {extra && (
            <input className="wme-gs-choice-extra" inputMode="decimal" value={r.extra ?? ''} onChange={(e) => set(i, { extra: e.target.value })} placeholder={extra.placeholder} aria-label={`${extra.label}: ${r.text}`} />
          )}
          <button type="button" className="wme-gs-choice-x" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove ${r.text}`}><X size={13} /></button>
        </div>
      ))}
      <div className="wme-gs-choice is-new">
        <span className="wme-gs-grip" aria-hidden="true">+</span>
        <input className="wme-gs-choice-text" data-testid="editor-choice-add" value={fresh} onChange={(e) => setFresh(e.target.value)} onKeyDown={onEnter} onBlur={extra ? undefined : add} placeholder={addHint} maxLength={200} />
        {extra && (
          <input className="wme-gs-choice-extra" inputMode="decimal" value={freshExtra} onChange={(e) => setFreshExtra(e.target.value)} onKeyDown={onEnter} placeholder={extra.placeholder} aria-label={extra.label} />
        )}
      </div>
    </div>
  );
}
