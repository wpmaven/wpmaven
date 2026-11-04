import React, { useEffect, useRef, useState } from 'react';
import { Button, Checkbox } from '@yotako/webmaven-ui';
import StatusBadge from '../../components/Dashboard/ui/StatusBadge';
import { ChevronDownIcon } from '../components/Icons';
import type { EditOperation, EditResult, SiteMap } from '../../types/edits';
import type { EditorItemKind } from '../../utils/editorAddress';
import { asUtc, postChanges, productChanges, productValuesOf, type PostValues, type ProductValues } from '../genstudio/itemChanges';
import { loadPost, loadProduct, type PostSnapshot, type ProductSnapshot } from '../genstudio/siteData';
import { EditErrorBanner, Working } from '../genstudio/ui';
import { useEditOperation } from '../genstudio/useEditOperation';
import { nameOr } from '../../utils/brand';

type Loaded =
  | { kind: 'product'; product: ProductSnapshot }
  | { kind: 'page' | 'post'; post: PostSnapshot };

/** A page or a post as the card reads it: by its kind, else the other one (a page id the frame named a post's). */
async function loadItem(kind: EditorItemKind, id: number): Promise<Loaded | null> {
  if (kind === 'product') {
    const product = await loadProduct(id);
    return product ? { kind: 'product', product } : null;
  }
  const other = kind === 'page' ? 'post' : 'page';
  const own = await loadPost(id, kind);
  if (own) return { kind, post: own };
  const post = await loadPost(id, other);
  return post ? { kind: other, post } : null;
}

/**
 * The address around a page's or a post's last part, from WordPress's
 * template ("https://site/%pagename%/" is "/" and "/"); null when its
 * addresses do not show it (plain addresses, ?page_id=12).
 */
export function addressParts(template: string): { before: string; after: string } | null {
  const m = /%(?:pagename|postname)%/.exec(template || '');
  if (!m) return null;
  let path = template;
  try { path = new URL(template.replace(m[0], 'wm-slug')).pathname; } catch { return null; }
  const at = path.indexOf('wm-slug');
  return at < 0 ? null : { before: path.slice(0, at), after: path.slice(at + 'wm-slug'.length) };
}

/** A page WPMaven designed: the design links it by its address (WordPress's mark, or a page of the design's site map). */
export function designedPage(post: PostSnapshot, map: SiteMap | null): boolean {
  if (post.designOwned) return true;
  return !!map && map.engine !== 'wordpress' && map.pages.some((p) => p.postId === post.id);
}

/** Why a designed page keeps its address, in the site's brand ("your team" on a site that names nobody). */
export function designedSlugWhy(): string {
  return `Pages ${nameOr('your team')} designed keep their address for now: your menus and pages link to it.`;
}

const postValues = (p: PostSnapshot): PostValues => ({ title: p.title, excerpt: p.excerpt, status: p.status, slug: p.slug });
const productValues = (p: ProductSnapshot): ProductValues => ({ ...productValuesOf(p), status: p.status });

/**
 * The card on top of the chat sidebar (2026-10-19): what the editor shows,
 * its title and whether it is live; open, its essentials, changed without
 * AI and saved at once with the usual Undo:
 *  - a page or a post: its title, its address (not the homepage's, and not
 *    a page WPMaven designed, whose address its design links), Published or
 *    Draft (a page the site needs stays published);
 *  - a product: its name, price and sale price (a product with options
 *    prices each option), in stock, Published or Draft, and the way to its
 *    screen in the store.
 * One Save sends only what changed, in one operation, with the time the
 * card read it (refused when it changed elsewhere since). The change builders
 * and the price checks are the post and product forms' own. After a save the
 * frame reloads the item (onSaved).
 */
export function PageContextCard({
  kind, postId, pageTitle, siteMap = null, refreshKey = '', onApplied, onSaved,
}: {
  kind: EditorItemKind;
  postId: number;
  pageTitle: string;
  siteMap?: SiteMap | null;
  /** Read again when it changes (a change made elsewhere in the editor went live). */
  refreshKey?: string;
  /** A change went live: the editor's toast with its Undo. */
  onApplied?: (result: EditResult) => void;
  /** The frame reloads the item at its address now. */
  onSaved?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Read and not found (or not readable): nothing to change.
  const [missing, setMissing] = useState(false);
  const [post, setPost] = useState<PostValues | null>(null);
  const [product, setProduct] = useState<ProductValues | null>(null);
  const flow = useEditOperation();
  const busy = flow.state.phase === 'publishing';
  const error = flow.state.error && flow.state.error.stage === 'publish' ? flow.state.error : null;
  const seq = useRef(0);

  const read = async () => {
    const mine = ++seq.current;
    const item = postId > 0 ? await loadItem(kind, postId) : null;
    if (mine !== seq.current) return;
    setLoaded(item);
    setMissing(!item);
    setPost(item && item.kind !== 'product' ? postValues(item.post) : null);
    setProduct(item && item.kind === 'product' ? productValues(item.product) : null);
  };

  useEffect(() => {
    flow.reset();
    setLoaded(null);
    setMissing(false);
    void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, postId]);

  // A change made elsewhere in the editor (a typed title, a form): the card shows it, unless the owner is typing in it.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (refreshKey && !dirtyRef.current && !busy) void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  let problems: string[] = [];
  let operation: EditOperation | null = null;
  if (loaded && loaded.kind !== 'product' && post) {
    const out = postChanges(postValues(loaded.post), post, loaded.kind);
    problems = out.problems;
    if (Object.keys(out.fields).length) {
      operation = { op: 'update_post', postId: loaded.post.id, fields: { ...out.fields, ...(loaded.post.modifiedGmt ? { baseModified: asUtc(loaded.post.modifiedGmt) } : {}) } };
    }
  } else if (loaded && loaded.kind === 'product' && product) {
    const out = productChanges(productValues(loaded.product), product, loaded.product.type === 'variable');
    problems = out.problems;
    if (Object.keys(out.fields).length) {
      operation = { op: 'update_product', productId: loaded.product.id, fields: { ...out.fields, ...(loaded.product.modifiedGmt ? { baseModified: asUtc(loaded.product.modifiedGmt) } : {}) } };
    }
  }
  const changed = !!operation;
  dirtyRef.current = changed;

  const save = async () => {
    if (!operation || problems.length) return;
    const r = await flow.publishNow(operation);
    if (r?.status === 'published' && r.ok) {
      onApplied?.(r);
      onSaved?.();
      dirtyRef.current = false;
      await read();
      flow.reset();
    }
  };

  const discard = () => {
    flow.reset();
    if (loaded && loaded.kind !== 'product') setPost(postValues(loaded.post));
    if (loaded && loaded.kind === 'product') setProduct(productValues(loaded.product));
  };

  const status = loaded ? (loaded.kind === 'product' ? loaded.product.status : loaded.post.status) : '';
  const title = loaded ? (loaded.kind === 'product' ? loaded.product.name : loaded.post.title) : '';
  const heading = (/^\d+$/.test(pageTitle) && title) || pageTitle || title || 'Untitled';
  const disabled = busy || !loaded;

  return (
    <div style={{ borderBottom: '1px solid var(--glass-border)', flexShrink: 0 }}>
      <button
        type="button"
        data-testid="editor-page-card"
        aria-expanded={expanded}
        onClick={() => setExpanded((p) => !p)}
        style={{
          width: '100%', padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)', fontSize: 13, fontFamily: 'inherit',
        }}
      >
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
          {/* A page known only by its id: the title WordPress gives it. */}
          {heading}
        </span>
        {status && <StatusBadge status={status} />}
        <ChevronDownIcon size={14} style={{ transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none', flexShrink: 0, color: 'var(--text-dim)' }} />
      </button>
      {expanded && (
        <div data-testid="editor-page-card-form" style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!loaded && (
            <p className="wme-gs-hint" style={{ margin: 0 }} data-testid="page-card-nothing">
              {postId > 0 && !missing ? 'Reading it from your site.' : 'This page shows other content (like your latest posts or your products), so it has nothing to change here.'}
            </p>
          )}
          {loaded && loaded.kind !== 'product' && post && (
            <PostFieldsForm item={loaded.post} kind={loaded.kind} values={post} siteMap={siteMap} disabled={disabled} onChange={setPost} />
          )}
          {loaded && loaded.kind === 'product' && product && (
            <ProductFieldsForm item={loaded.product} values={product} disabled={disabled} onChange={setProduct} />
          )}
          {problems.length > 0 && <p className="wme-gs-note is-warn" role="alert" style={{ margin: 0 }}>{problems.join(' ')}</p>}
          {busy && <Working text="Saving." />}
          {error && (
            <EditErrorBanner
              code={error.code}
              message={error.code === 'CHANGED_ELSEWHERE' ? 'This changed somewhere else after the card read it. Load it again, then save.' : error.message}
              busy={busy}
              onRetry={() => { if (error.code === 'CHANGED_ELSEWHERE') { flow.reset(); void read(); } else void save(); }}
              onDiscard={discard}
            />
          )}
          {loaded && (
            <div className="wme-gs-actions">
              {changed && !busy && <Button variant="ghost" size="sm" onClick={discard} data-testid="page-card-discard">Discard</Button>}
              <Button variant="primary" size="sm" className="wme-gs-push" data-testid="page-card-save" disabled={!changed || problems.length > 0 || busy} isLoading={busy} onClick={() => { void save(); }}>
                Save
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A page's or a post's title, address and status. */
function PostFieldsForm({ item, kind, values, siteMap, disabled, onChange }: {
  item: PostSnapshot;
  kind: 'page' | 'post';
  values: PostValues;
  siteMap: SiteMap | null;
  disabled: boolean;
  onChange: (v: PostValues) => void;
}) {
  const set = (patch: Partial<PostValues>) => onChange({ ...values, ...patch });
  const homepage = item.sitePage === 'the homepage';
  const parts = homepage ? null : addressParts(item.permalinkTemplate);
  const designed = designedPage(item, siteMap);
  const needed = kind === 'page' && !!item.sitePage;
  const known = values.status === 'publish' || values.status === 'draft';
  return (
    <>
      <div>
        <label className="wme-gs-label" htmlFor="wme-card-title">Title</label>
        <input id="wme-card-title" data-testid="page-card-title" className="wme-gs-input" value={values.title} onChange={(e) => set({ title: e.target.value })} disabled={disabled} maxLength={200} />
      </div>
      {parts && (
        <div>
          <label className="wme-gs-label" htmlFor="wme-card-slug">Address</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-dim)' }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '45%' }} title={parts.before}>{parts.before}</span>
            <input
              id="wme-card-slug"
              data-testid="page-card-slug"
              className="wme-gs-input"
              style={{ flex: 1, minWidth: 0 }}
              value={values.slug ?? ''}
              onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
              disabled={disabled || designed}
              maxLength={190}
              aria-describedby={designed ? 'wme-card-slug-why' : undefined}
            />
            <span>{parts.after}</span>
          </div>
          {designed && <p id="wme-card-slug-why" className="wme-gs-hint" data-testid="page-card-slug-designed" style={{ margin: '4px 0 0' }}>{designedSlugWhy()}</p>}
        </div>
      )}
      <div>
        <label className="wme-gs-label" htmlFor="wme-card-status">Visible on the site</label>
        <select id="wme-card-status" data-testid="page-card-status" className="wme-gs-select wm-select" value={values.status} onChange={(e) => set({ status: e.target.value })} disabled={disabled}>
          {!known && <option value={values.status}>{values.status === 'private' ? 'Private' : values.status === 'pending' ? 'Waiting for review' : values.status === 'future' ? 'Scheduled' : values.status}</option>}
          <option value="publish">Published</option>
          <option value="draft" disabled={needed && values.status !== 'draft'}>Draft (hidden)</option>
        </select>
        {needed && <p className="wme-gs-hint" data-testid="page-card-needed" style={{ margin: '4px 0 0' }}>This is {item.sitePage}, which your site needs, so it stays published.</p>}
      </div>
    </>
  );
}

/** A product's name, prices, stock and status. */
function ProductFieldsForm({ item, values, disabled, onChange }: {
  item: ProductSnapshot;
  values: ProductValues;
  disabled: boolean;
  onChange: (v: ProductValues) => void;
}) {
  const set = (patch: Partial<ProductValues>) => onChange({ ...values, ...patch });
  const variable = item.type === 'variable';
  const known = values.status === 'publish' || values.status === 'draft';
  return (
    <>
      <div>
        <label className="wme-gs-label" htmlFor="wme-card-name">Name</label>
        <input id="wme-card-name" data-testid="page-card-name" className="wme-gs-input" value={values.name} onChange={(e) => set({ name: e.target.value })} disabled={disabled} maxLength={200} />
      </div>
      {variable ? (
        <p className="wme-gs-hint" data-testid="page-card-option-prices" style={{ margin: 0 }}>Each option has its own price.</p>
      ) : (
        <div className="wme-gs-row2">
          <div>
            <label className="wme-gs-label" htmlFor="wme-card-price">Price</label>
            <input id="wme-card-price" data-testid="page-card-price" className="wme-gs-input" inputMode="decimal" value={values.regularPrice} onChange={(e) => set({ regularPrice: e.target.value })} disabled={disabled} placeholder="14.50" />
          </div>
          <div>
            <label className="wme-gs-label" htmlFor="wme-card-sale">Sale price</label>
            <input id="wme-card-sale" data-testid="page-card-sale-price" className="wme-gs-input" inputMode="decimal" value={values.salePrice} onChange={(e) => set({ salePrice: e.target.value })} disabled={disabled} placeholder="None" />
          </div>
        </div>
      )}
      <Checkbox
        checked={values.stockStatus !== 'outofstock'}
        disabled={disabled}
        // Back in stock as it was (on backorder stays on backorder).
        onChange={(on) => set({ stockStatus: on ? (item.stockStatus !== 'outofstock' ? item.stockStatus : 'instock') : 'outofstock' })}
        label={<span data-testid="page-card-in-stock">In stock</span>}
      />
      <div>
        <label className="wme-gs-label" htmlFor="wme-card-p-status">Visible in the store</label>
        <select id="wme-card-p-status" data-testid="page-card-status" className="wme-gs-select wm-select" value={values.status ?? 'publish'} onChange={(e) => set({ status: e.target.value })} disabled={disabled}>
          {!known && <option value={values.status}>{values.status === 'private' ? 'Private' : values.status === 'pending' ? 'Waiting for review' : values.status}</option>}
          <option value="publish">Published</option>
          <option value="draft">Draft (hidden)</option>
        </select>
      </div>
      {/* Everything else of the product (stock, shipping, options, reviews) is the store's (2026-10-19). */}
      <a className="wme-gs-link" data-testid="page-card-store-link" href={`#/store/products/${item.id}`}>Manage this product in your store</a>
    </>
  );
}
