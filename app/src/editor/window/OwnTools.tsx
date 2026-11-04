import React, { useEffect, useState } from 'react';
import { Button, Checkbox } from '@yotako/webmaven-ui';
import type { StoreCategory } from '../../types/store';
import { formatStoreMoney } from '../../utils/storeMoney';
import { loadCategories } from '../../components/Dashboard/store/products/categories';
import { useStoreContext } from '../../components/Dashboard/store/shared/storeContext';
import { MediaPicker } from '../genstudio/ImagePanel';
import { listBlogTerms, loadPost, loadProduct, loadTerm, loadVariations, type TermItem } from '../genstudio/siteData';
import { ChoiceList, type ChoiceRow } from './ChoiceList';
import { optionFields, ownIdOf, PICTURE_TOOLS, type ElementSelection, type OptionVariation, type OwnInput, type OwnItem, type OwnTool, type TermRef } from './elementEdit';

/** The tools that change at once, without anything to type or choose. */
export const AT_ONCE: ReadonlySet<OwnTool> = new Set<OwnTool>(['end-sale', 'remove-picture', 'alt']);

/**
 * The post or the product a part of its own page belongs to, read once
 * for the window (2026-10-19): its prices and sale, its pictures, its
 * categories, the time it changed (the operations' guard). Null meanwhile,
 * and for any other part.
 */
export function useOwnItem(sel: ElementSelection): OwnItem | null {
  const [own, setOwn] = useState<OwnItem | null>(null);
  const id = sel.single ? ownIdOf(sel) : null;
  const kind = sel.single;
  useEffect(() => {
    setOwn(null);
    if (!id || !kind) return undefined;
    let live = true;
    const read: Promise<OwnItem | null> = kind === 'product'
      ? loadProduct(id).then((product) => (product ? { kind: 'product', product } : null))
      : loadPost(id).then((post) => (post ? { kind: 'post', post } : null));
    void read.then((item) => { if (live) setOwn(item); });
    return () => { live = false; };
  }, [id, kind]);
  return own;
}

/**
 * What a tool shows in the window before it changes anything: a price
 * field, the store's categories, the media library. submit answers why it
 * could not send (shown under it), or null once sent.
 */
export function OwnToolPanel({ tool, own, term = null, picture = null, choices = null, onSubmit, onCancel }: {
  tool: OwnTool;
  own: OwnItem | null;
  /** The category a category tool changes (a category page's heading, a filter chip). */
  term?: TermRef | null;
  /** The picture a picture tool starts from (its address), when one shows. */
  picture?: string | null;
  /** A designed form's dropdown: its choices now. */
  choices?: string[] | null;
  onSubmit: (input: OwnInput) => string | null;
  onCancel: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { setProblem(null); }, [tool]);
  const submit = (input: OwnInput) => setProblem(onSubmit(input));
  let body: React.ReactNode = null;
  if (tool === 'price' || tool === 'sale') body = <PriceField tool={tool} own={own} onSubmit={submit} onCancel={onCancel} />;
  else if (tool === 'category') body = <CategoryPicker own={own} onSubmit={submit} onCancel={onCancel} />;
  else if (PICTURE_TOOLS.includes(tool)) body = <PicturePanel tool={tool as PictureToolName} own={own} picture={picture} onSubmit={submit} />;
  else if (tool === 'reorder') body = <PictureOrder own={own} onSubmit={submit} onCancel={onCancel} />;
  else if (tool === 'form-choices' && choices) body = <FormChoices choices={choices} onSubmit={submit} onCancel={onCancel} />;
  else if (tool === 'product-options') body = <ProductOptions own={own} onSubmit={submit} onCancel={onCancel} />;
  else if (tool === 'post-categories') body = <BlogCategoryPicker own={own} onSubmit={submit} onCancel={onCancel} />;
  else if (tool === 'tags') body = <TagsField own={own} onSubmit={submit} onCancel={onCancel} />;
  else if ((tool === 'term-name' || tool === 'term-description') && term) body = <TermField tool={tool} term={term} onSubmit={submit} onCancel={onCancel} />;
  if (!body) return null;
  return (
    <div data-testid={`editor-own-${tool}`} style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {tool === 'content-picture' && <p className="wme-gs-hint" style={{ margin: 0 }}>The picture you choose takes this one's place everywhere it shows on your site. You see the change before it goes live.</p>}
      {tool === 'add-picture' && <p className="wme-gs-hint" style={{ margin: 0 }}>It joins the product's pictures, after the others.</p>}
      {body}
      {problem && <p role="alert" className="wme-gs-note is-warn" style={{ margin: 0 }} data-testid="editor-own-problem">{problem}</p>}
    </div>
  );
}

type PictureToolName = 'picture' | 'add-picture' | 'content-picture' | 'page-picture';

/** Lines to start from, as the owner might say them. */
const CHANGE_EXAMPLES = ['Make it brighter', 'Same scene in another colour', 'A new one, wider'];
const ADD_EXAMPLES = ['Seen from the side', 'On a set table', 'A close-up'];

/**
 * Change The Picture, Add A Picture (2026-10-19): your images (search, upload)
 * or a picture made with AI. An AI picture starts from this one (an added
 * picture from the product's main one), so "make it blue" and "a new one like
 * this" both work; it is always a new picture placed here, the old one stays
 * in the library. A printed product's pictures show the real printed item:
 * never AI.
 */
function PicturePanel({ tool, own, picture, onSubmit }: {
  tool: PictureToolName;
  own: OwnItem | null;
  picture: string | null;
  onSubmit: (input: OwnInput) => void;
}) {
  const printed = own?.kind === 'product' && own.product.printed;
  const [tab, setTab] = useState<'library' | 'ai'>('library');
  const [words, setWords] = useState('');
  const adding = tool === 'add-picture';
  const from = adding && own?.kind === 'product' ? own.product.pictures[0]?.src ?? null : picture;
  return (
    <>
      {printed
        ? <p className="wme-gs-hint" style={{ margin: 0 }}>A printed product shows the real printed item, so its pictures come from your images, never AI.</p>
        : (
          <div className="wme-gs-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'library'} onClick={() => setTab('library')} data-testid="editor-picture-library">Your images</button>
            <button type="button" role="tab" aria-selected={tab === 'ai'} onClick={() => setTab('ai')} data-testid="editor-picture-ai">Make with AI</button>
          </div>
        )}
      {printed || tab === 'library' ? <MediaPicker selected={null} onPick={(m) => onSubmit({ tool, mediaId: m.id })} /> : (
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ tool, instruction: words }); }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {from && <img src={from} alt="" width={44} height={44} style={{ objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />}
            <p className="wme-gs-hint" style={{ margin: 0 }}>
              {adding
                ? (from ? 'Sees the main picture. The new one joins this product\'s pictures.' : 'The new one joins this product\'s pictures.')
                : 'Starts from this picture. It stays as it is in your library.'}
            </p>
          </div>
          <textarea className="wme-gs-textarea" data-testid="editor-picture-words" rows={3} value={words} onChange={(e) => setWords(e.target.value)} maxLength={1000}
            placeholder={adding ? 'What the new picture shows' : 'What to change, or what the new picture shows'} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(adding ? ADD_EXAMPLES : CHANGE_EXAMPLES).map((line) => (
              <button key={line} type="button" className="wme-gs-tool" style={{ height: 26, fontSize: 12, border: '1px dashed var(--glass-border)' }} onClick={() => setWords(line)}>{line}</button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span className="wme-gs-hint">Made in your site's style</span>
            <Button type="submit" variant="primary" size="sm" disabled={!words.trim()} data-testid="editor-picture-make">Make It</Button>
          </div>
        </form>
      )}
    </>
  );
}

/** A designed form's dropdown: its choices in a list (Change Choices), previewed first. */
function FormChoices({ choices, onSubmit, onCancel }: {
  choices: string[];
  onSubmit: (input: OwnInput) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<ChoiceRow[]>(() => choices.map((c, i) => ({ key: `c${i}`, text: c })));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ tool: 'form-choices', options: rows.map((r) => r.text) }); }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ChoiceList rows={rows} onChange={setRows} addHint="Add a choice, then Enter" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="wme-gs-hint">The form's answers keep their choice.</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" size="sm" data-testid="editor-own-save">Preview</Button>
        </span>
      </div>
    </form>
  );
}


/**
 * A product's options (Change Options, 2026-10-19): each option's values in a
 * list, in their order. A value WooCommerce keeps on its variation is moved
 * or removed, not retyped (renamed in the store). A product with one option
 * shows each value's price: optional, an empty one is the product's price.
 * Save sends the attributes, the new variations (a new value, with every
 * value of the other options), the prices changed and the variations of the
 * values taken away, at once, with Undo. A printed product's options are
 * what can be printed.
 */
function ProductOptions({ own, onSubmit, onCancel }: {
  own: OwnItem | null;
  onSubmit: (input: OwnInput) => void;
  onCancel: () => void;
}) {
  const { money } = useStoreContext();
  const product = own?.kind === 'product' ? own.product : null;
  const [variations, setVariations] = useState<OptionVariation[] | null>(null);
  const [lists, setLists] = useState<Record<string, ChoiceRow[]> | null>(null);
  const options = (product?.attributes ?? []).filter((a) => a.variation);
  const single = options.length === 1;
  useEffect(() => {
    if (!product || product.printed) return undefined;
    let live = true;
    loadVariations(product.id, 'id,attributes,regular_price').then((rows) => {
      if (!live) return;
      setVariations(rows.map((v) => ({
        id: Number(v.id),
        values: Object.fromEntries((Array.isArray(v.attributes) ? v.attributes : []).map((a: any) => [String(a.name), String(a.option)])),
        price: String(v.regular_price ?? ''),
      })));
    }, () => { if (live) setVariations([]); });
    return () => { live = false; };
  }, [product]);
  // The product's price: its options' lowest.
  const prices = (variations ?? []).map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n > 0);
  const base = prices.length ? String(Math.min(...prices)) : product?.regularPrice ?? '';
  const priceOf = (name: string, value: string) => variations?.find((v) => v.values[name] === value)?.price ?? '';
  useEffect(() => {
    if (!variations || lists) return;
    setLists(Object.fromEntries(options.map((a) => [a.name, a.options.map((o) => ({ key: o, text: o, fixed: true, ...(single ? { extra: priceOf(a.name, o) === base ? '' : priceOf(a.name, o) } : {}) }))])));
  }, [variations]); // eslint-disable-line react-hooks/exhaustive-deps
  if (product?.printed) return <p className="wme-gs-hint" style={{ margin: 0 }}>A printed product's options are what can be printed, so they are not changed here.</p>;
  if (!product || !lists) return <p className="wme-gs-hint" style={{ margin: 0 }}>Reading this product's options.</p>;
  const save = () => onSubmit({ tool: 'product-options', fields: optionFields(product.attributes, variations ?? [], lists, base) });
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {options.map((a) => (
        <div key={a.name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="wme-gs-label" style={{ margin: 0 }}>{a.name}</span>
          <ChoiceList
            rows={lists[a.name] ?? []}
            onChange={(rows) => setLists({ ...lists, [a.name]: rows })}
            addHint={`Add a ${a.name.toLowerCase()}, then Enter`}
            extra={single ? { label: 'Price', placeholder: base ? formatStoreMoney(base, money) : 'Price' } : null}
          />
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="wme-gs-hint">{single ? 'An empty price is the product\'s price.' : 'A new value takes the product\'s price.'}</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" size="sm" data-testid="editor-own-save">Save</Button>
        </span>
      </div>
    </form>
  );
}

/** A product's price or sale price, typed in the window (Change Price, Put On Sale). */
function PriceField({ tool, own, onSubmit, onCancel }: {
  tool: 'price' | 'sale';
  own: OwnItem | null;
  onSubmit: (input: OwnInput) => void;
  onCancel: () => void;
}) {
  const { money } = useStoreContext();
  const product = own?.kind === 'product' ? own.product : null;
  const [price, setPrice] = useState('');
  const variable = product?.type === 'variable';
  const now = tool === 'price' ? product?.regularPrice : product?.salePrice;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ tool, price }); }} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label className="wme-gs-label" htmlFor="wme-own-price" style={{ margin: 0 }}>{tool === 'price' ? 'New price' : 'Sale price'}</label>
      {now && <p className="wme-gs-hint" style={{ margin: 0 }}>Now {formatStoreMoney(now, money)}.</p>}
      {tool === 'sale' && product?.regularPrice && <p className="wme-gs-hint" style={{ margin: 0 }}>Lower than its price, {formatStoreMoney(product.regularPrice, money)}.</p>}
      {variable && <p className="wme-gs-hint" style={{ margin: 0 }}>This product has options (like sizes). The price goes to every option.</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <input id="wme-own-price" data-testid="editor-own-price-input" className="wme-gs-input" style={{ flex: 1, minWidth: 0 }} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="14.50" autoFocus disabled={!product} />
        <Button type="submit" variant="primary" size="sm" disabled={!product || !price.trim()} data-testid="editor-own-save">Save</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

/** A product's categories: the store's, ticked as they are, and a new one by its name (Change Category). */
function CategoryPicker({ own, onSubmit, onCancel }: {
  own: OwnItem | null;
  onSubmit: (input: OwnInput) => void;
  onCancel: () => void;
}) {
  const product = own?.kind === 'product' ? own.product : null;
  const [all, setAll] = useState<StoreCategory[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [ticked, setTicked] = useState<number[] | null>(null);
  const [fresh, setFresh] = useState('');
  useEffect(() => {
    let live = true;
    loadCategories().then((list) => { if (live) setAll(list); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  const chosen = ticked ?? (product?.categories.map((c) => c.id) ?? []);
  const toggle = (id: number, on: boolean) => setTicked(on ? [...chosen.filter((c) => c !== id), id] : chosen.filter((c) => c !== id));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ tool: 'category', categoryIds: chosen, newCategory: fresh }); }} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {failed && <p className="wme-gs-hint" style={{ margin: 0 }}>Your store's categories could not be read. You can still add a new one.</p>}
      {!all && !failed && <p className="wme-gs-hint" style={{ margin: 0 }}>Reading your store's categories.</p>}
      {all && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflow: 'auto' }} data-testid="editor-own-categories">
          {all.map((c) => (
            <Checkbox key={c.id} checked={chosen.includes(c.id)} disabled={!product} onChange={(on) => toggle(c.id, on)} label={<span>{c.name}</span>} />
          ))}
        </div>
      )}
      <label className="wme-gs-label" htmlFor="wme-own-new-category" style={{ margin: 0 }}>A new category</label>
      <input id="wme-own-new-category" className="wme-gs-input" value={fresh} onChange={(e) => setFresh(e.target.value)} maxLength={100} placeholder="For example: Mugs" disabled={!product} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm" disabled={!product} data-testid="editor-own-save">Save</Button>
      </div>
    </form>
  );
}

/** A product's pictures in a new order: the first is its main picture (Reorder). */
function PictureOrder({ own, onSubmit, onCancel }: {
  own: OwnItem | null;
  onSubmit: (input: OwnInput) => void;
  onCancel: () => void;
}) {
  const product = own?.kind === 'product' ? own.product : null;
  const [order, setOrder] = useState<Array<{ id: number; src: string }> | null>(null);
  const shown = order ?? product?.pictures ?? [];
  const move = (at: number, by: number) => {
    const next = [...shown];
    const [one] = next.splice(at, 1);
    next.splice(Math.max(0, Math.min(next.length, at + by)), 0, one);
    setOrder(next);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ tool: 'reorder', mediaIds: shown.map((p) => p.id) }); }} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p className="wme-gs-hint" style={{ margin: 0 }}>The first picture is the product's main picture.</p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflow: 'auto' }} data-testid="editor-own-order">
        {shown.map((p, i) => (
          <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {p.src ? <img src={p.src} alt="" width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} /> : <span style={{ width: 36 }} />}
            <span style={{ flex: 1, fontSize: 12, color: 'var(--text-dim)' }}>{i === 0 ? 'Main picture' : `Picture ${i + 1}`}</span>
            <Button type="button" variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move earlier">Up</Button>
            <Button type="button" variant="ghost" size="sm" disabled={i === shown.length - 1} onClick={() => move(i, 1)} aria-label="Move later">Down</Button>
          </li>
        ))}
      </ol>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm" disabled={!product || !order} data-testid="editor-own-save">Save</Button>
      </div>
    </form>
  );
}

/** A post's categories: the blog's, ticked as they are, and a new one by its name (Change Categories). */
function BlogCategoryPicker({ own, onSubmit, onCancel }: {
  own: OwnItem | null;
  onSubmit: (input: OwnInput) => void;
  onCancel: () => void;
}) {
  const post = own?.kind === 'post' ? own.post : null;
  const [all, setAll] = useState<TermItem[] | null>(null);
  const [ticked, setTicked] = useState<number[] | null>(null);
  const [fresh, setFresh] = useState('');
  useEffect(() => {
    let live = true;
    void listBlogTerms('categories').then((list) => { if (live) setAll(list); });
    return () => { live = false; };
  }, []);
  const chosen = ticked ?? post?.categoryIds ?? [];
  const toggle = (id: number, on: boolean) => setTicked(on ? [...chosen.filter((c) => c !== id), id] : chosen.filter((c) => c !== id));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ tool: 'post-categories', categoryIds: chosen, newCategory: fresh }); }} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {!all && <p className="wme-gs-hint" style={{ margin: 0 }}>Reading your blog's categories.</p>}
      {all && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflow: 'auto' }} data-testid="editor-own-categories">
          {all.map((c) => (
            <Checkbox key={c.id} checked={chosen.includes(c.id)} disabled={!post} onChange={(on) => toggle(c.id, on)} label={<span>{c.name}</span>} />
          ))}
        </div>
      )}
      <label className="wme-gs-label" htmlFor="wme-own-new-blog-category" style={{ margin: 0 }}>A new category</label>
      <input id="wme-own-new-blog-category" className="wme-gs-input" value={fresh} onChange={(e) => setFresh(e.target.value)} maxLength={100} placeholder="For example: Studio news" disabled={!post} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm" disabled={!post} data-testid="editor-own-save">Save</Button>
      </div>
    </form>
  );
}

/** A post's tags, typed with commas between them (Change Tags). */
function TagsField({ own, onSubmit, onCancel }: {
  own: OwnItem | null;
  onSubmit: (input: OwnInput) => void;
  onCancel: () => void;
}) {
  const post = own?.kind === 'post' ? own.post : null;
  const [text, setText] = useState<string | null>(null);
  const [now, setNow] = useState<string | null>(null);
  const tagIds = post?.tagIds;
  useEffect(() => {
    if (!tagIds) return undefined;
    let live = true;
    void listBlogTerms('tags', tagIds).then((list) => { if (live) setNow(list.map((t) => t.name).join(', ')); });
    return () => { live = false; };
  }, [tagIds]);
  const value = text ?? now ?? '';
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ tool: 'tags', tags: value.split(',') }); }} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label className="wme-gs-label" htmlFor="wme-own-tags" style={{ margin: 0 }}>Tags, with commas between them</label>
      <input id="wme-own-tags" data-testid="editor-own-tags-input" className="wme-gs-input" value={value} onChange={(e) => setText(e.target.value)} placeholder="kiln, glazes" disabled={!post || now === null} autoFocus />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm" disabled={!post || now === null} data-testid="editor-own-save">Save</Button>
      </div>
    </form>
  );
}

/** A category's own name or description, read from WordPress and typed in the window (Rename Category, Change Description). */
function TermField({ tool, term, onSubmit, onCancel }: {
  tool: 'term-name' | 'term-description';
  term: TermRef;
  onSubmit: (input: OwnInput) => void;
  onCancel: () => void;
}) {
  const [now, setNow] = useState<TermItem | null | undefined>(undefined);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setNow(undefined);
    setText(null);
    void loadTerm(term.taxonomy, term.id).then((t) => { if (live) setNow(t); });
    return () => { live = false; };
  }, [term.taxonomy, term.id]);
  const naming = tool === 'term-name';
  const value = text ?? (now ? (naming ? now.name : now.description) : '');
  const submit = () => onSubmit(naming ? { tool, name: value } : { tool, description: value });
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label className="wme-gs-label" htmlFor="wme-own-term" style={{ margin: 0 }}>{naming ? 'The category\'s name' : 'The category\'s description'}</label>
      {now === null && <p className="wme-gs-hint" style={{ margin: 0 }}>This category could not be read. You can still type its new {naming ? 'name' : 'description'}.</p>}
      {naming
        ? <input id="wme-own-term" data-testid="editor-own-term-input" className="wme-gs-input" value={value} onChange={(e) => setText(e.target.value)} maxLength={200} disabled={now === undefined} autoFocus />
        : <textarea id="wme-own-term" data-testid="editor-own-term-input" className="wme-gs-input" value={value} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={4} disabled={now === undefined} autoFocus />}
      <p className="wme-gs-hint" style={{ margin: 0 }}>{term.taxonomy === 'product_cat' ? 'It changes everywhere your store shows this category.' : 'It changes everywhere your blog shows this category.'}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm" disabled={now === undefined || (naming && !value.trim())} data-testid="editor-own-save">Save</Button>
      </div>
    </form>
  );
}
