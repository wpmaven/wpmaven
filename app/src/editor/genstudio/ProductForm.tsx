import React, { useEffect, useRef, useState } from 'react';
import { Button, Checkbox } from '@yotako/webmaven-ui';
import type { ProductFields } from '../../types/edits';
import type { StoreVariation } from '../../types/store';
import { siteBrand, type SiteBrand } from '../../utils/brand';
import { formatStoreMoney } from '../../utils/storeMoney';
import { storeApi } from '../../services/storeApi';
import { useStoreContext } from '../../components/Dashboard/store/shared/storeContext';
import { VARIATION_FIELDS, variationFrom } from '../../components/Dashboard/store/products/productMapper';
import { KIND_COLORS } from './bindings';
import { useAppliedFollows, type EditorEnv } from './env';
import { MediaPicker } from './ImagePanel';
import { loadProduct, loadVariations, type MediaItem, type ProductSnapshot } from './siteData';
import { EditErrorBanner, EditResultLine, PanelFrame, Working } from './ui';
import { useEditOperation } from './useEditOperation';
import { EMPTY_PRODUCT as EMPTY, asUtc, normalizePrice, productChanges, productValuesOf, type ProductValues } from './itemChanges';

// The change builders and the price checks are shared with the page card (2026-10-19).
export { asUtc, normalizePrice, productChanges, productValuesOf, type ProductValues } from './itemChanges';

/** One option's prices as the owner types them. */
export interface OptionPrices {
  regular: string;
  sale: string;
}

/** Only the options whose prices changed, as the operation's variations; problems in plain words. */
export function optionChanges(options: StoreVariation[], edits: Record<number, OptionPrices>): { variations: NonNullable<ProductFields['variations']>; problems: string[] } {
  const variations: NonNullable<ProductFields['variations']> = [];
  const problems: string[] = [];
  for (const o of options) {
    const e = edits[o.variationId];
    if (!e) continue;
    const patch: { variationId: number; regularPrice?: string; salePrice?: string | null } = { variationId: o.variationId };
    const beforeRegular = o.regularPrice ?? '';
    const beforeSale = o.salePrice ?? '';
    if (e.regular.trim() !== beforeRegular) {
      const p = normalizePrice(e.regular);
      if (!p) { problems.push(`The price of ${o.label} is written like 14 or 14.50.`); continue; }
      if (p !== normalizePrice(beforeRegular)) patch.regularPrice = p;
    }
    if (e.sale.trim() !== beforeSale) {
      if (!e.sale.trim()) { if (beforeSale) patch.salePrice = null; } else {
        const p = normalizePrice(e.sale);
        if (!p) { problems.push(`The sale price of ${o.label} is written like 12 or 12.50.`); continue; }
        if (p !== normalizePrice(beforeSale)) patch.salePrice = p;
      }
    }
    const regular = Number(patch.regularPrice ?? normalizePrice(beforeRegular) ?? NaN);
    if (typeof patch.salePrice === 'string' && Number.isFinite(regular) && Number(patch.salePrice) >= regular) {
      problems.push(`The sale price of ${o.label} must be lower than its price.`);
      continue;
    }
    if (patch.regularPrice !== undefined || patch.salePrice !== undefined) variations.push(patch);
  }
  return { variations, problems };
}

/**
 * The product's main photo, from the library or made with AI in the site's
 * style (own products only: a printed product shows the real printed item).
 * Saved at once, with Undo, like the Store. The gallery and the options'
 * photos stay in the Store's product editor.
 */
function ProductPhoto({ env, productId, snapshot, onSaved }: { env: EditorEnv; productId: number; snapshot: ProductSnapshot | null; onSaved: () => void }) {
  const flow = useEditOperation();
  useAppliedFollows(flow, env);
  const [mode, setMode] = useState<'none' | 'library' | 'ai'>('none');
  const [instruction, setInstruction] = useState('');
  const [newDesign, setNewDesign] = useState(false);
  const s = flow.state;
  const busy = s.phase === 'publishing';
  const printed = !!snapshot?.printed;

  useEffect(() => {
    if (!printed) return undefined;
    let alive = true;
    storeApi.redesignOffer().then((o) => {
      if (alive) setNewDesign(!!o?.available && (o.products ?? []).some((p) => p.productId === productId));
    }, () => undefined);
    return () => { alive = false; };
  }, [printed, productId]);

  const send = async (op: { mediaId: number } | { instruction: string }) => {
    const r = await flow.publishNow({ op: 'replace_image', target: { kind: 'product', productId, slot: 'featured' }, ...op });
    if (r?.status === 'published') {
      setMode('none');
      setInstruction('');
      env.showLive();
      onSaved();
    }
  };

  return (
    <div data-testid="product-photo" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p className="wme-gs-label" style={{ margin: 0 }}>Photo</p>
      {snapshot?.imageUrl
        ? <img src={snapshot.imageUrl} alt={`The photo of ${snapshot.name}`} style={{ width: '100%', maxHeight: 160, objectFit: 'contain', borderRadius: 10, border: '1px solid var(--glass-border)', background: 'var(--bg)' }} />
        : <p className="wme-gs-hint">This product has no photo yet.</p>}
      {printed && (
        <p className="wme-gs-note" data-testid="product-photo-printed">
          Printed products show the real printed item. Upload a photo of it, or choose New design.
          {newDesign && <> <a className="wme-gs-link" href={`#/store/products/${productId}`} data-testid="product-new-design-link">New design</a></>}
        </p>
      )}
      <div className="wme-gs-actions">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setMode(mode === 'library' ? 'none' : 'library')} data-testid="product-photo-library">Choose from your library</Button>
        {!printed && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setMode(mode === 'ai' ? 'none' : 'ai')} data-testid="product-photo-ai">Make one with AI</Button>
        )}
      </div>
      {mode === 'library' && !busy && (
        <MediaPicker selected={null} onPick={(m: MediaItem) => { void send({ mediaId: m.id }); }} />
      )}
      {mode === 'ai' && !printed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label className="wme-gs-label" htmlFor="wme-gs-p-photo-ai">What should the photo show?</label>
          <textarea id="wme-gs-p-photo-ai" className="wme-gs-textarea" style={{ minHeight: 64 }} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="For example: the mug on a wooden table, morning light" maxLength={1000} disabled={busy} />
          <div className="wme-gs-actions">
            <Button variant="primary" size="sm" className="wme-gs-push" disabled={busy || instruction.trim().length < 3} isLoading={busy} onClick={() => { void send({ instruction: instruction.trim() }); }} data-testid="product-photo-make">Make the photo</Button>
          </div>
        </div>
      )}
      {busy && <Working text={mode === 'ai' ? 'Making the photo in your site\'s style. This can take up to a minute.' : 'Saving the photo to your store.'} progress={s.progress} />}
      {(s.result || s.error) && !busy && <EditResultLine result={s.result} failure={s.error} />}
      {s.phase === 'published' && s.result?.undoable && (
        <div className="wme-gs-actions"><Button variant="ghost" size="sm" onClick={() => env.undo(s.result!)}>Undo</Button></div>
      )}
      <a className="wme-gs-link" href={`#/store/products/${productId}`} data-testid="product-all-photos">All photos</a>
    </div>
  );
}

/** The form's warning for a card whose product is not in the store, in the site's brand (utils/brand.ts) or naming nobody. */
export function productNotFoundText(b: SiteBrand = siteBrand()): string {
  return `${b.mode === 'neutral' ? 'This product could not be found in your store.' : `${b.name} could not find this product in your store.`} It may be a sample that is not in the store yet.`;
}

/**
 * A product card's own data: name, price, sale price, short text and stock,
 * written to WooCommerce at once (every card and the product page show it).
 */
export function ProductForm({ env, productId, productSlug, label }: { env: EditorEnv; productId?: number; productSlug?: string; label: string }) {
  const id = productId || env.siteMap?.products.find((p) => p.slug === productSlug)?.id || 0;
  const [snapshot, setSnapshot] = useState<ProductSnapshot | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [values, setValues] = useState<ProductValues>(EMPTY);
  const touched = useRef<Set<keyof ProductValues>>(new Set());
  const flow = useEditOperation();
  useAppliedFollows(flow, env);
  const s = flow.state;
  const busy = s.phase === 'publishing';
  const { money } = useStoreContext();
  const [options, setOptions] = useState<StoreVariation[]>([]);
  const [perOption, setPerOption] = useState(false);
  const [optionEdits, setOptionEdits] = useState<Record<number, OptionPrices>>({});

  const readOptions = async (productId: number) => {
    try {
      const rows = (await loadVariations(productId, VARIATION_FIELDS)).map((v) => variationFrom(v, money));
      setOptions(rows);
      setOptionEdits(Object.fromEntries(rows.map((o) => [o.variationId, { regular: o.regularPrice ?? '', sale: o.salePrice ?? '' }])));
    } catch {
      setOptions([]);
    }
  };

  useEffect(() => {
    let alive = true;
    if (!id) { setLoading(false); return () => { alive = false; }; }
    setLoading(true);
    loadProduct(id).then((p) => {
      if (!alive) return;
      setSnapshot(p);
      // What the owner already typed stays.
      setValues((cur) => {
        const loaded = productValuesOf(p);
        const next = { ...loaded };
        touched.current.forEach((k) => { (next as any)[k] = (cur as any)[k]; });
        return next;
      });
      setLoading(false);
      if (p?.type === 'variable') void readOptions(id);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const variable = snapshot?.type === 'variable';
  const before = productValuesOf(snapshot);
  const base = productChanges(before, perOption ? { ...values, regularPrice: before.regularPrice, salePrice: before.salePrice } : values, variable);
  const perOptionChanges = variable && perOption ? optionChanges(options, optionEdits) : { variations: [], problems: [] };
  const fields: ProductFields = perOptionChanges.variations.length ? { ...base.fields, variations: perOptionChanges.variations } : base.fields;
  const problems = [...base.problems, ...perOptionChanges.problems];
  const changed = Object.keys(fields).length > 0;
  const set = (k: keyof ProductValues, v: string) => {
    touched.current.add(k);
    setValues((cur) => ({ ...cur, [k]: v }));
  };

  const save = async () => {
    if (!id || !changed || problems.length) return;
    const r = await flow.publishNow({
      op: 'update_product',
      productId: id,
      fields: { ...fields, ...(snapshot?.modifiedGmt ? { baseModified: asUtc(snapshot.modifiedGmt) } : {}) },
    });
    if (r?.status === 'published') {
      touched.current.clear();
      env.showLive();
      env.refreshSiteMap();
      const fresh = await loadProduct(id);
      if (fresh) { setSnapshot(fresh); setValues(productValuesOf(fresh)); }
      if (fresh?.type === 'variable') await readOptions(id);
    }
  };

  const reloadPhoto = async () => {
    const fresh = await loadProduct(id);
    if (fresh) setSnapshot((cur) => (cur ? { ...cur, imageUrl: fresh.imageUrl, modifiedGmt: fresh.modifiedGmt } : fresh));
  };

  const name = values.name || snapshot?.name || label || 'Product';

  return (
    <PanelFrame
      chip="Product"
      color={KIND_COLORS.product}
      title={name}
      sub="Every card and the product page show these"
      onClose={env.closePanel}
      footer={(
        <>
          {busy && <Working text="Saving to your store." />}
          {s.result && <EditResultLine result={s.result} failure={s.error} />}
          {s.error && s.error.stage === 'publish' && (
            <EditErrorBanner
              code={s.error.code}
              message={s.error.message}
              busy={busy}
              onRetry={() => { void save(); }}
              onDiscard={() => { flow.reset(); touched.current.clear(); setValues(productValuesOf(snapshot)); }}
            />
          )}
          <div className="wme-gs-actions">
            {s.phase === 'published' && s.result?.undoable && (
              <Button data-testid="editor-undo" variant="outline" size="sm" onClick={() => env.undo(s.result!)}>Undo</Button>
            )}
            <Button
              data-testid="product-save"
              variant="primary"
              size="sm"
              className="wme-gs-push"
              disabled={!id || !changed || problems.length > 0 || busy || loading}
              isLoading={busy}
              onClick={() => { void save(); }}
            >
              Save
            </Button>
          </div>
        </>
      )}
    >
      {!id && <p className="wme-gs-note is-warn">{productNotFoundText()}</p>}
      {loading && <Working text="Reading the product from your store." />}
      {id > 0 && !loading && <ProductPhoto env={env} productId={id} snapshot={snapshot} onSaved={() => { void reloadPhoto(); }} />}
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-p-name">Name</label>
        <input id="wme-gs-p-name" data-testid="product-name" className="wme-gs-input" value={values.name} onChange={(e) => set('name', e.target.value)} disabled={loading || busy || !id} maxLength={200} />
      </div>
      {variable && (
        <Checkbox
          checked={!perOption}
          onChange={(one) => setPerOption(!one)}
          disabled={loading || busy || !options.length}
          label={<span data-testid="product-one-price">One price for every option</span>}
        />
      )}
      {variable && !perOption && <p className="wme-gs-note">This product has options (like sizes). A price here applies to every option.</p>}
      {variable && perOption && (
        <ul className="wme-gs-list" data-testid="product-option-prices">
          {options.map((o) => {
            const e = optionEdits[o.variationId] ?? { regular: '', sale: '' };
            const setOpt = (patch: Partial<OptionPrices>) => setOptionEdits((cur) => ({ ...cur, [o.variationId]: { ...e, ...patch } }));
            return (
              <li key={o.variationId} className="wme-gs-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }} data-testid="product-option-row">
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>{o.label}</p>
                <div className="wme-gs-row2">
                  <input className="wme-gs-input" inputMode="decimal" aria-label={`Price of ${o.label}`} value={e.regular} onChange={(ev) => setOpt({ regular: ev.target.value })} disabled={busy} placeholder="14.50" />
                  <input className="wme-gs-input" inputMode="decimal" aria-label={`Sale price of ${o.label}`} value={e.sale} onChange={(ev) => setOpt({ sale: ev.target.value })} disabled={busy} placeholder="No sale" />
                </div>
                {snapshot?.printed && o.floor && <p className="wme-gs-hint">Lowest price {formatStoreMoney(o.floor, money)}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {!(variable && perOption) && <div className="wme-gs-row2">
        <div>
          <label className="wme-gs-label" htmlFor="wme-gs-p-price">Price</label>
          <input id="wme-gs-p-price" data-testid="product-price" className="wme-gs-input" inputMode="decimal" value={values.regularPrice} onChange={(e) => set('regularPrice', e.target.value)} disabled={loading || busy || !id} placeholder="14.50" />
        </div>
        <div>
          <label className="wme-gs-label" htmlFor="wme-gs-p-sale">Sale price</label>
          <input id="wme-gs-p-sale" data-testid="product-sale-price" className="wme-gs-input" inputMode="decimal" value={values.salePrice} onChange={(e) => set('salePrice', e.target.value)} disabled={loading || busy || !id} placeholder="None" />
        </div>
      </div>}
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-p-short">Short description</label>
        <textarea id="wme-gs-p-short" className="wme-gs-textarea" style={{ minHeight: 72 }} value={values.shortDescription} onChange={(e) => set('shortDescription', e.target.value)} disabled={loading || busy || !id} maxLength={2000} />
      </div>
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-p-stock">Stock</label>
        <select id="wme-gs-p-stock" className="wme-gs-select wm-select" value={values.stockStatus} onChange={(e) => set('stockStatus', e.target.value)} disabled={loading || busy || !id}>
          <option value="instock">In stock</option>
          <option value="outofstock">Sold out</option>
          {!variable && <option value="onbackorder">On backorder</option>}
        </select>
      </div>
      {problems.length > 0 && <div className="wme-gs-note is-warn" role="alert">{problems.join(' ')}</div>}
    </PanelFrame>
  );
}
