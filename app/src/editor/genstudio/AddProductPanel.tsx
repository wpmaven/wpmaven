import React, { useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import type { ProductFields } from '../../types/store';
import { createdId } from './AddPostPanel';
import { useAppliedFollows, type EditorEnv } from './env';
import { normalizePrice } from './ProductForm';
import { EditResultLine, PanelFrame, Working } from './ui';
import { useEditOperation } from './useEditOperation';

export interface NewProductValues {
  name: string;
  price: string;
  shortDescription: string;
  status: 'draft' | 'publish';
  salePrice: string;
  sku: string;
  /** Category names, separated by commas: the store's own of that name, or a new one. */
  categories: string;
}

/** The fields of a new product, as the Store screen's product form maps them, or what is wrong with them. */
export function newProductFields(v: NewProductValues): { fields: ProductFields & { name: string; type: 'simple' }; problems: string[] } {
  const problems: string[] = [];
  const fields: ProductFields & { name: string; type: 'simple' } = { name: v.name.trim().slice(0, 200), type: 'simple', status: v.status };
  if (!fields.name) problems.push('The product needs a name.');
  const price = v.price.trim() ? normalizePrice(v.price) : null;
  if (v.price.trim() && !price) problems.push('A price is written like 14 or 14.50.');
  if (price) fields.regularPrice = price;
  const sale = v.salePrice.trim() ? normalizePrice(v.salePrice) : null;
  if (v.salePrice.trim() && !sale) problems.push('A sale price is written like 12 or 12.50.');
  else if (sale && price && Number(sale) >= Number(price)) problems.push('The sale price must be lower than the price.');
  else if (sale) fields.salePrice = sale;
  if (v.shortDescription.trim()) fields.shortDescription = v.shortDescription.trim().slice(0, 2000);
  if (v.sku.trim()) fields.sku = v.sku.trim().slice(0, 100);
  const names = [...new Set(v.categories.split(',').map((c) => c.trim()).filter(Boolean))].slice(0, 10);
  if (names.length) fields.newCategories = names;
  return { fields, problems };
}

const EMPTY: NewProductValues = { name: '', price: '', shortDescription: '', status: 'draft', salePrice: '', sku: '', categories: '' };

/**
 * A new product from the editor (2026-10-17, the sidebar's Add on its
 * Products tab): a name, a price, a short description, Draft or Publish;
 * More options: the sale price, the SKU, the categories. Create makes it
 * (add_product, a simple product) and opens it in the editor.
 */
export function AddProductPanel({ env }: { env: EditorEnv }) {
  const [values, setValues] = useState<NewProductValues>(EMPTY);
  const [more, setMore] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const flow = useEditOperation();
  useAppliedFollows(flow, env);
  const busy = flow.state.phase === 'publishing';
  const set = <K extends keyof NewProductValues>(key: K, value: NewProductValues[K]) => setValues((cur) => ({ ...cur, [key]: value }));

  const create = async () => {
    const { fields, problems: wrong } = newProductFields(values);
    setProblems(wrong);
    if (wrong.length) return;
    const r = await flow.publishNow({ op: 'add_product', fields });
    const id = r?.status === 'published' && r.ok ? createdId(r.changed, 'product') : null;
    if (id) env.openNew?.({ type: 'product', id, title: fields.name, draft: values.status === 'draft' });
  };

  return (
    <PanelFrame
      chip="New product"
      color="var(--purple)"
      title={values.name.trim() || 'Add a product'}
      onClose={env.closePanel}
      testId="editor-add-product"
      footer={(
        <>
          {busy && <Working text="Creating the product." />}
          {(flow.state.result || flow.state.error) && <EditResultLine result={flow.state.result} failure={flow.state.error} />}
          <div className="wme-gs-actions">
            <Button variant="primary" size="sm" className="wme-gs-push" data-testid="product-create" isLoading={busy} disabled={busy || !values.name.trim()} onClick={() => { void create(); }}>
              Create
            </Button>
          </div>
        </>
      )}
    >
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-new-product-name">Name</label>
        <input id="wme-gs-new-product-name" data-testid="new-product-name" className="wme-gs-input" value={values.name} onChange={(e) => set('name', e.target.value)} placeholder="For example: House blend, 250 g" maxLength={200} disabled={busy} />
      </div>
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-new-product-price">Price</label>
        <input id="wme-gs-new-product-price" data-testid="new-product-price" className="wme-gs-input" inputMode="decimal" value={values.price} onChange={(e) => set('price', e.target.value)} placeholder="14.50" disabled={busy} />
      </div>
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-new-product-short">Short description</label>
        <textarea id="wme-gs-new-product-short" data-testid="new-product-short" className="wme-gs-textarea" style={{ minHeight: 72 }} value={values.shortDescription} onChange={(e) => set('shortDescription', e.target.value)} maxLength={2000} disabled={busy} />
      </div>
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-new-product-status">Draft or publish</label>
        <select id="wme-gs-new-product-status" data-testid="new-product-status" className="wme-gs-select wm-select" value={values.status} onChange={(e) => set('status', e.target.value === 'publish' ? 'publish' : 'draft')} disabled={busy}>
          <option value="draft">Keep it as a draft</option>
          <option value="publish">Publish it</option>
        </select>
      </div>
      <button type="button" className="wme-gs-link" aria-expanded={more} aria-controls="wme-gs-product-more" data-testid="product-more-options" onClick={() => setMore((m) => !m)}>
        {more ? 'Fewer options' : 'More options'}
      </button>
      {more && (
        <div id="wme-gs-product-more" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="wme-gs-row2">
            <div>
              <label className="wme-gs-label" htmlFor="wme-gs-new-product-sale">Sale price</label>
              <input id="wme-gs-new-product-sale" data-testid="new-product-sale" className="wme-gs-input" inputMode="decimal" value={values.salePrice} onChange={(e) => set('salePrice', e.target.value)} placeholder="None" disabled={busy} />
            </div>
            <div>
              <label className="wme-gs-label" htmlFor="wme-gs-new-product-sku">SKU</label>
              <input id="wme-gs-new-product-sku" data-testid="new-product-sku" className="wme-gs-input" value={values.sku} onChange={(e) => set('sku', e.target.value)} maxLength={100} disabled={busy} />
            </div>
          </div>
          <div>
            <label className="wme-gs-label" htmlFor="wme-gs-new-product-categories">Categories</label>
            <input id="wme-gs-new-product-categories" data-testid="new-product-categories" className="wme-gs-input" value={values.categories} onChange={(e) => set('categories', e.target.value)} placeholder="Coffee, Gifts" disabled={busy} />
            <p className="wme-gs-hint" style={{ marginTop: 4 }}>Separated by commas. A category your store does not have yet is made.</p>
          </div>
        </div>
      )}
      {problems.length > 0 && <div className="wme-gs-note is-warn" role="alert">{problems.join(' ')}</div>}
    </PanelFrame>
  );
}
