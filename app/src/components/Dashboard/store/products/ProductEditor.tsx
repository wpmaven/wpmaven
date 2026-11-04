import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import DashboardContext from '../../../../contexts/DashboardContext';
import { Badge, Button, Checkbox } from '@yotako/webmaven-ui';
import { WpRestError, wpRest } from '../../../../services/wpRest';
import { editFailure, errorSentence, storeApi } from '../../../../services/storeApi';
import { formatStoreMoney, moneyInputText } from '../../../../utils/storeMoney';
import type {
  ProductFields, ProductPricing, StoreCategory, StoreEditResult, StoreMoneyFormat, StoreProductDetail, StoreVariation,
} from '../../../../types/store';
import Confirm from '../shared/Confirm';
import EditHistory from '../shared/EditHistory';
import EditOutcome from '../shared/EditOutcome';
import MediaPicker from '../shared/MediaPicker';
import { useStoreContext } from '../shared/storeContext';
import { useStableMoney } from '../useStableMoney';
import { ConnectionNote, ErrorLine, Field, Loading } from '../shared/ui';
import {
  CHANGED_ELSEWHERE_SENTENCE, PRINTED_PHOTO_SENTENCE, PRODUCT_STATUSES, PRODUCT_STATUS_LABEL, SAMPLE_SENTENCE,
  aiPhotoHint, drawingSentence, floorSentence, madeToOrderSentence, newDesignSentence, printedOptionsSentence, printingSentence,
} from '../storeCopy';
import { loadCategories } from './categories';
import { editorFields, editorFormOf, type AttributeForm, type EditorForm, type VariationForm } from './editorForm';
import { floorLine } from './pricing';
import { VARIATION_FIELDS, asUtc, productDetailFrom } from './productMapper';
import RichText from './RichText';
import TrashProduct from './TrashProduct';

type Problem = { code: string; message: string } | null;
type Picking = 'featured' | 'gallery' | null;
type Redesign = { state: 'idle' | 'asking' | 'running' | 'done' | 'failed'; message?: string };

/** The most photos a product's gallery takes in one change. */
const MAX_GALLERY = 30;

const humanize = (key: string) => {
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
};

const problemOf = (error: unknown): Problem => ({
  code: error instanceof WpRestError ? error.code : '',
  message: errorSentence(error, 'This change did not go through. Try again.'),
});

function ProblemLine({ problem, onReload }: { problem: Problem; onReload: () => void }) {
  if (!problem) return null;
  const changed = problem.code === 'CHANGED_ELSEWHERE';
  return (
    <p className="wm-store-note wm-store-note--error" role="alert" data-testid="store-editor-error" data-code={problem.code}>
      {changed ? CHANGED_ELSEWHERE_SENTENCE : problem.message}
      {changed && <button type="button" className="wm-store-link" onClick={onReload}>Reload</button>}
    </p>
  );
}

function MoneyInput({ id, label, value, onChange, testId }: { id: string; label: string; value: string; onChange: (v: string) => void; testId?: string }) {
  return (
    <input id={id} aria-label={label} className="wm-store-input wm-store-input--money" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
  );
}

/** The options of a variable product: printed ones show Shown and prices only; own ones also stock and Remove. */
function VariationsTable({ detail, form, money, pricing, onChange }: {
  detail: StoreProductDetail;
  form: EditorForm;
  money: StoreMoneyFormat;
  pricing: ProductPricing | null;
  onChange: (id: number, patch: Partial<VariationForm>) => void;
}) {
  const printed = detail.printed;
  return (
    <div className="wm-store-tablewrap">
      <table className="wm-store-table" data-testid="store-variations">
        <thead>
          <tr>
            <th scope="col">Option</th>
            <th scope="col">Shown</th>
            <th scope="col">Price</th>
            <th scope="col">Sale price</th>
            {printed ? <th scope="col">Lowest</th> : <th scope="col">Stock</th>}
            {!printed && <th scope="col">Remove</th>}
          </tr>
        </thead>
        <tbody>
          {detail.variations.map((v: StoreVariation) => {
            const f = form.variations[v.variationId];
            if (!f) return null;
            const lowest = printed ? floorLine(v.variationId, pricing, null, detail.variations)?.floor : null;
            return (
              <tr key={v.variationId} className={f.remove ? 'wm-store-table__removed' : undefined}>
                <th scope="row">{v.label}</th>
                <td>
                  <Checkbox checked={f.enabled} disabled={f.remove} onChange={(enabled) => onChange(v.variationId, { enabled })} label={<span className="wm-visually-hidden">{`Show ${v.label}`}</span>} />
                </td>
                <td>
                  <MoneyInput id={`pe-v-${v.variationId}-price`} label={`Price of ${v.label}`} value={f.regular} onChange={(regular) => onChange(v.variationId, { regular })} />
                </td>
                <td>
                  <MoneyInput id={`pe-v-${v.variationId}-sale`} label={`Sale price of ${v.label}`} value={f.sale} onChange={(sale) => onChange(v.variationId, { sale })} />
                </td>
                {printed ? (
                  <td className="wm-store-muted">{lowest ? formatStoreMoney(lowest, money) : ''}</td>
                ) : (
                  <td>
                    <select className="wm-select" aria-label={`Stock of ${v.label}`} value={f.stockStatus} onChange={(e) => onChange(v.variationId, { stockStatus: e.target.value })}>
                      <option value="instock">In stock</option>
                      <option value="outofstock">Out of stock</option>
                      <option value="onbackorder">On backorder</option>
                    </select>
                  </td>
                )}
                {!printed && (
                  <td>
                    <Checkbox checked={f.remove} onChange={(remove) => onChange(v.variationId, { remove })} label={<span className="wm-visually-hidden">{`Remove ${v.label}`}</span>} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Own products: their attributes (Size: S, M, L) and new options built from them. */
function OwnOptions({ form, set, money }: { form: EditorForm; set: (patch: Partial<EditorForm>) => void; money: StoreMoneyFormat }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [price, setPrice] = useState('');
  const optionAttrs = form.attributes.filter((a) => a.variation && a.name.trim());
  const values = (a: AttributeForm) => a.options.split(',').map((s) => s.trim()).filter(Boolean);
  const change = (i: number, patch: Partial<AttributeForm>) => set({ attributes: form.attributes.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const ready = optionAttrs.length > 0 && optionAttrs.every((a) => draft[a.name.trim()]) && price.trim();
  return (
    <div className="wm-store-options">
      <h3 className="wm-store-subtitle">Options like size or color</h3>
      {form.attributes.map((a, i) => (
        <div key={i} className="wm-store-attr" data-testid="store-attribute-row">
          <input className="wm-store-input" aria-label={`Name of option ${i + 1}`} placeholder="Size" value={a.name} onChange={(e) => change(i, { name: e.target.value })} />
          <input className="wm-store-input wm-store-grow" aria-label={`Values of option ${i + 1}`} placeholder="Small, Medium, Large" value={a.options} onChange={(e) => change(i, { options: e.target.value })} />
          <Checkbox checked={a.variation} onChange={(variation) => change(i, { variation })} label="Customers choose it" />
          <button type="button" className="wm-store-link" onClick={() => set({ attributes: form.attributes.filter((_, j) => j !== i) })} aria-label={`Remove option ${i + 1}`}>Remove</button>
        </div>
      ))}
      <button type="button" className="wm-store-link" onClick={() => set({ attributes: [...form.attributes, { name: '', options: '', variation: true, visible: true }] })}>
        + Add an option
      </button>
      {optionAttrs.length > 0 && (
        <div className="wm-store-newvar">
          <h3 className="wm-store-subtitle">Add a choice customers can buy</h3>
          <div className="wm-store-toolbar">
            {optionAttrs.map((a) => (
              <label key={a.name} className="wm-store-inline">
                <span>{a.name.trim()}</span>
                <select className="wm-select" value={draft[a.name.trim()] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [a.name.trim()]: e.target.value }))}>
                  <option value="">Choose</option>
                  {values(a).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            ))}
            <label className="wm-store-inline">
              <span>Price</span>
              <input className="wm-store-input wm-store-input--money" inputMode="decimal" value={price} placeholder={moneyInputText('18.50', money)} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <Button type="button" size="sm" variant="secondary" disabled={!ready} onClick={() => {
              const options: Record<string, string> = {};
              for (const a of optionAttrs) options[a.name.trim()] = draft[a.name.trim()];
              set({ newVariations: [...form.newVariations, { key: `${Date.now()}-${form.newVariations.length}`, options, regular: price }] });
              setDraft({});
              setPrice('');
            }}>Add</Button>
          </div>
          {form.newVariations.length > 0 && (
            <ul className="wm-store-plainlist wm-store-newvar__list">
              {form.newVariations.map((n) => (
                <li key={n.key}>
                  {Object.values(n.options).join(', ')}: {n.regular}
                  <button type="button" className="wm-store-link" onClick={() => set({ newVariations: form.newVariations.filter((x) => x.key !== n.key) })}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One product, every part of it: text, photos, price and stock, options,
 * card text, categories and tags, printing, history. Save sends one
 * update_product with what changed since the product was read.
 */
export default function ProductEditor({ productId, onBack }: { productId: number; onBack: () => void }) {
  const { money: contextMoney, caps, writesAvailable, context, refresh } = useStoreContext();
  const money = useStableMoney(contextMoney);
  // wp-admin's address: the page's own, never a reason to read the product again.
  const adminUrl = useRef(context?.adminUrl || String((window as any).WEBMAVEN_WP_DATA?.adminUrl || '/wp-admin/')).current;
  const [detail, setDetail] = useState<StoreProductDetail | null>(null);
  const [initial, setInitial] = useState<EditorForm | null>(null);
  const [form, setForm] = useState<EditorForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [pricing, setPricing] = useState<ProductPricing | null>(null);
  const [canRedesign, setCanRedesign] = useState(false);
  // Why New design cannot run, in the account's words (printing paused, designs unreadable here).
  const [redesignNote, setRedesignNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const [result, setResult] = useState<StoreEditResult | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [picking, setPicking] = useState<Picking>(null);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [onePrice, setOnePrice] = useState('');
  const [leaving, setLeaving] = useState<null | (() => void)>(null);
  const [redesign, setRedesign] = useState<Redesign>({ state: 'idle' });
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [p, v] = await Promise.all([
        wpRest.get<Record<string, any>>(`wc/v3/products/${productId}`, { query: { context: 'edit', image_size: 'medium' } }),
        wpRest.get<Array<Record<string, any>>>(`wc/v3/products/${productId}/variations`, { query: { per_page: 100, context: 'edit', _fields: VARIATION_FIELDS } })
          .catch(() => ({ data: [] as Array<Record<string, any>> })),
      ]);
      const d = productDetailFrom(p.data ?? {}, Array.isArray(v.data) ? v.data : [], money, adminUrl);
      const f = editorFormOf(d, money);
      setDetail(d);
      setInitial(f);
      setForm(f);
      setTried(false);
      setProblem(null);
    } catch (error) {
      setLoadError(errorSentence(error, 'This product did not load. Try again.'));
    }
  }, [productId, money, adminUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let live = true;
    loadCategories().then((c) => live && setCategories(c), () => undefined);
    return () => {
      live = false;
    };
  }, []);

  const printed = !!detail?.printed;
  const designKey = detail?.wpmaven.designKey ?? null;
  useEffect(() => {
    if (!printed) return undefined;
    let live = true;
    storeApi.pricing(productId).then((p) => live && setPricing(p && Array.isArray(p.variations) ? p : null), () => undefined);
    if (caps.spend) {
      storeApi.redesignOffer().then((offer) => {
        if (!live) return;
        const listed = Array.isArray(offer?.products) && offer.products.some((o) => o.productId === productId || (!!designKey && o.productKey === designKey));
        setCanRedesign(!!offer?.available && listed);
        setRedesignNote(!offer?.available && typeof offer?.message === 'string' && offer.message ? offer.message : null);
      }, () => undefined);
    }
    return () => {
      live = false;
    };
  }, [printed, productId, caps.spend, designKey]);

  // Unsaved changes: another page of the app asks first, and so does closing the tab.
  const dirtyNow = !!detail && !!form && !!initial && Object.keys(editorFields(detail, initial, form, money).fields).length > 0;
  const setGuard = useContext(DashboardContext)?.setNavigationGuard;
  useEffect(() => {
    if (!dirtyNow) return undefined;
    setGuard?.((_page, proceed) => {
      setLeaving(() => proceed);
      return false;
    });
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      setGuard?.(null);
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirtyNow, setGuard]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (poll.current) clearTimeout(poll.current);
    };
  }, []);

  if (!detail || !form || !initial) {
    return (
      <div className="wm-store-editor" data-testid="store-product-editor">
        <button type="button" className="wm-store-back" onClick={onBack}>&lsaquo; Products</button>
        {loadError ? <ErrorLine message={loadError} onRetry={() => void load()} /> : <Loading label="Reading the product" />}
      </div>
    );
  }

  const set = (patch: Partial<EditorForm>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setVariation = (id: number, patch: Partial<VariationForm>) => setForm((f) => (f ? { ...f, variations: { ...f.variations, [id]: { ...f.variations[id], ...patch } } } : f));
  const { fields, errors } = editorFields(detail, initial, form, money);
  const dirty = Object.keys(fields).length > 0;
  const mayChange = writesAvailable && caps.products;
  const busy = saving || aiBusy || redesign.state === 'running';
  const variable = detail.type === 'variable';
  const sample = detail.wpmaven.kind === 'sample';

  const save = async (extra: ProductFields = {}) => {
    setTried(true);
    const all = { ...fields, ...extra };
    if (errors.length || !Object.keys(all).length || !mayChange) return;
    setSaving(true);
    setProblem(null);
    setResult(null);
    try {
      const answer = await storeApi.edit({
        op: 'update_product',
        productId,
        fields: { ...all, ...(detail.modifiedGmt ? { baseModified: asUtc(detail.modifiedGmt) } : {}) },
      });
      const failure = editFailure(answer);
      if (failure) {
        setProblem(failure);
      } else {
        setResult(answer);
        setHistoryKey((k) => k + 1);
        refresh();
        await load();
      }
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setSaving(false);
    }
  };

  const createPhoto = async () => {
    const instruction = aiText.trim();
    if (instruction.length < 3 || dirty) return;
    setAiBusy(true);
    setProblem(null);
    setResult(null);
    try {
      const answer = await storeApi.edit({ op: 'replace_image', target: { kind: 'product', productId, slot: 'featured' }, instruction });
      const failure = editFailure(answer);
      if (failure) setProblem(failure);
      else {
        setResult(answer);
        setAiText('');
        setHistoryKey((k) => k + 1);
        refresh();
        await load();
      }
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setAiBusy(false);
    }
  };

  const watchJob = (jobId: string, tries = 0) => {
    poll.current = setTimeout(async () => {
      try {
        const job = await storeApi.redesignJob(jobId);
        if (!alive.current) return;
        if (job?.status === 'done') {
          setRedesign({ state: 'done', message: 'The new design is ready. Its photos are on the product now.' });
          setHistoryKey((k) => k + 1);
          void load();
          return;
        }
        if (job?.status === 'failed') {
          setRedesign({ state: 'failed', message: 'The new design did not finish. Try again later.' });
          return;
        }
      } catch {
        // A missed poll is tried again on the next tick.
      }
      if (!alive.current) return;
      if (tries < 120) watchJob(jobId, tries + 1);
      else setRedesign({ state: 'failed', message: 'The new design is taking longer than usual. Check this product again in a few minutes.' });
    }, 5000);
  };

  const startRedesign = async () => {
    setRedesign({ state: 'running', message: drawingSentence() });
    try {
      const job = await storeApi.startRedesign(productId);
      if (!job?.jobId) throw new Error('');
      watchJob(job.jobId);
    } catch (error) {
      setRedesign({ state: 'failed', message: errorSentence(error, 'The new design could not start. Try again later.') });
    }
  };

  const movePhoto = (i: number, by: -1 | 1) => {
    const gallery = [...form.gallery];
    const [item] = gallery.splice(i, 1);
    gallery.splice(i + by, 0, item);
    set({ gallery });
  };

  const makeMain = (i: number) => {
    const gallery = [...form.gallery];
    const [item] = gallery.splice(i, 1, ...(form.featured ? [form.featured] : []));
    set({ featured: item, gallery });
  };

  const toggleCategory = (id: number, on: boolean) => set({ categoryIds: on ? [...form.categoryIds, id] : form.categoryIds.filter((c) => c !== id) });

  const productLine = printed ? floorLine('product', pricing, detail.wpmaven.floor, detail.variations) : null;
  const statusOptions = PRODUCT_STATUSES.some((s) => s.value === detail.status)
    ? PRODUCT_STATUSES
    : [{ value: detail.status, label: PRODUCT_STATUS_LABEL[detail.status] ?? detail.status }, ...PRODUCT_STATUSES];

  return (
    <div className="wm-store-editor" data-testid="store-product-editor">
      <div className="wm-store-editor__head">
        <button type="button" className="wm-store-back" onClick={() => (dirty ? setLeaving(() => onBack) : onBack())}>&lsaquo; Products</button>
        <h2 className="wm-store-editor__title">{form.name.trim() || 'Untitled product'}</h2>
        <span className="wm-store-badges">
          {printed && <Badge color="blue">Printed</Badge>}
          {sample && <Badge color="peach">Sample</Badge>}
        </span>
        <label className="wm-store-inline wm-store-push">
          <span>Status</span>
          <select className="wm-select" value={form.status} onChange={(e) => set({ status: e.target.value })} data-testid="store-editor-status">
            {statusOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <Button type="button" variant="primary" onClick={() => void save()} isLoading={saving} disabled={!dirty || !mayChange || busy} data-testid="store-editor-save">
          Save
        </Button>
      </div>

      <ConnectionNote available={writesAvailable} />
      {sample && (
        <div className="wm-store-note wm-store-note--warn wm-store-banner" data-testid="store-sample-banner">
          <span>{SAMPLE_SENTENCE}</span>
          {mayChange && (
            <Button type="button" size="sm" variant="secondary" onClick={() => void save({ sample: false })} disabled={busy} data-testid="store-mark-ready">
              Mark as ready
            </Button>
          )}
        </div>
      )}
      {tried && errors.length > 0 && (
        <ul className="wm-store-note wm-store-note--error wm-store-plainlist" role="alert" data-testid="store-editor-invalid">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      <ProblemLine problem={problem} onReload={() => void load()} />
      <EditOutcome key={result?.operationId ?? 'none'} result={result} onUndone={() => { setHistoryKey((k) => k + 1); refresh(); void load(); }} />

      <div className="wm-store-split">
        <div className="wm-store-stack">
          <section className="wm-store-panel" aria-labelledby="pe-general">
            <h3 id="pe-general" className="wm-store-panel__title">General</h3>
            <Field label="Name" htmlFor="pe-name">
              <input id="pe-name" className="wm-store-input" value={form.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} data-testid="store-editor-name" />
            </Field>
            <RichText id="pe-short" label="Short description" value={form.shortDescription ?? detail.shortDescription} onChange={(html) => set({ shortDescription: html })} testId="store-editor-short" />
            <RichText id="pe-description" label="Description" value={form.description ?? detail.description} onChange={(html) => set({ description: html })} testId="store-editor-description" />
          </section>

          {!variable && detail.type !== 'grouped' && (
            <section className="wm-store-panel" aria-labelledby="pe-price">
              <h3 id="pe-price" className="wm-store-panel__title">Price and stock</h3>
              <div className="wm-store-field-row">
                <Field label="Price" htmlFor="pe-regular">
                  <input id="pe-regular" className="wm-store-input" inputMode="decimal" value={form.regular} onChange={(e) => set({ regular: e.target.value })} data-testid="store-editor-price" />
                </Field>
                <Field label="Sale price" htmlFor="pe-sale">
                  <input id="pe-sale" className="wm-store-input" inputMode="decimal" value={form.sale} placeholder="No sale" onChange={(e) => set({ sale: e.target.value })} />
                </Field>
                <Field label="SKU" htmlFor="pe-sku">
                  <input id="pe-sku" className="wm-store-input" value={form.sku} maxLength={100} onChange={(e) => set({ sku: e.target.value })} />
                </Field>
              </div>
              {productLine && <p className="wm-store-note" data-testid="store-floor-line">{floorSentence(productLine.floor, productLine.price, productLine.earnings, money)}</p>}
              {printed ? (
                <p className="wm-store-muted">{madeToOrderSentence()}</p>
              ) : (
                <div className="wm-store-field-row">
                  <Checkbox checked={form.manageStock} onChange={(manageStock) => set({ manageStock })} label="Count the stock" />
                  {form.manageStock ? (
                    <Field label="In stock" htmlFor="pe-qty">
                      <input id="pe-qty" className="wm-store-input" inputMode="numeric" value={form.qty} onChange={(e) => set({ qty: e.target.value })} />
                    </Field>
                  ) : (
                    <Field label="Stock" htmlFor="pe-stock">
                      <select id="pe-stock" className="wm-select" value={form.stockStatus} onChange={(e) => set({ stockStatus: e.target.value })}>
                        <option value="instock">In stock</option>
                        <option value="outofstock">Out of stock</option>
                        <option value="onbackorder">On backorder</option>
                      </select>
                    </Field>
                  )}
                </div>
              )}
            </section>
          )}

          {(variable || !printed) && (
            <section className="wm-store-panel" aria-labelledby="pe-options" data-testid="store-editor-options">
              <h3 id="pe-options" className="wm-store-panel__title">{printed ? 'Colors and sizes' : 'Options and variations'}</h3>
              {printed && <p className="wm-store-muted">{printedOptionsSentence()}</p>}
              {variable && detail.variations.length > 0 && (
                <VariationsTable detail={detail} form={form} money={money} pricing={pricing} onChange={setVariation} />
              )}
              {variable && detail.variations.length > 1 && (
                <div className="wm-store-toolbar">
                  <label className="wm-store-inline">
                    <span>One price for all</span>
                    <input className="wm-store-input wm-store-input--money" inputMode="decimal" value={onePrice} onChange={(e) => setOnePrice(e.target.value)} />
                  </label>
                  <Button type="button" size="sm" variant="secondary" disabled={!onePrice.trim()} onClick={() => {
                    const next: Record<number, VariationForm> = {};
                    for (const [id, v] of Object.entries(form.variations)) next[Number(id)] = { ...v, regular: onePrice.trim() };
                    set({ variations: next });
                  }}>Set one price for all</Button>
                </div>
              )}
              {!printed && <OwnOptions form={form} set={set} money={money} />}
            </section>
          )}

          {Object.keys(initial.cardSlots).length > 0 && (
            <section className="wm-store-panel" aria-labelledby="pe-card">
              <h3 id="pe-card" className="wm-store-panel__title">Card text</h3>
              <p className="wm-store-muted">The words on this product's card in your site's design.</p>
              {Object.keys(initial.cardSlots).map((key) => (
                <Field key={key} label={humanize(key)} htmlFor={`pe-slot-${key}`}>
                  <input id={`pe-slot-${key}`} className="wm-store-input" value={form.cardSlots[key] ?? ''} maxLength={300} onChange={(e) => set({ cardSlots: { ...form.cardSlots, [key]: e.target.value } })} />
                </Field>
              ))}
            </section>
          )}

          <section className="wm-store-panel">
            <EditHistory target={`product:${productId}`} refreshKey={historyKey} onUndone={() => { refresh(); void load(); }} />
          </section>
        </div>

        <div className="wm-store-stack">
          <section className="wm-store-panel" aria-labelledby="pe-photos" data-testid="store-editor-photos">
            <h3 id="pe-photos" className="wm-store-panel__title">Photos</h3>
            <ul className="wm-store-photos wm-store-plainlist">
              <li className="wm-store-photo wm-store-photo--main">
                {form.featured ? <img src={form.featured.url} alt="Main photo" /> : <span className="wm-store-nophoto">No photo yet</span>}
                <span className="wm-store-photo__label">Main photo</span>
                {form.featured && <button type="button" className="wm-store-link" onClick={() => set({ featured: null })}>Remove</button>}
              </li>
              {form.gallery.map((g, i) => (
                <li key={g.id} className="wm-store-photo">
                  <img src={g.url} alt={`Photo ${i + 2}`} />
                  <span className="wm-store-photo__tools">
                    <button type="button" aria-label={`Move photo ${i + 2} earlier`} disabled={i === 0} onClick={() => movePhoto(i, -1)}>&larr;</button>
                    <button type="button" aria-label={`Move photo ${i + 2} later`} disabled={i === form.gallery.length - 1} onClick={() => movePhoto(i, 1)}>&rarr;</button>
                    <button type="button" aria-label={`Make photo ${i + 2} the main photo`} onClick={() => makeMain(i)}>Main</button>
                    <button type="button" aria-label={`Remove photo ${i + 2}`} onClick={() => set({ gallery: form.gallery.filter((_, j) => j !== i) })}>&times;</button>
                  </span>
                </li>
              ))}
            </ul>
            {picking ? (
              <MediaPicker
                title={picking === 'featured' ? 'Choose the main photo' : 'Add a photo'}
                excludeId={picking === 'featured' ? form.featured?.id : undefined}
                onCancel={() => setPicking(null)}
                onPick={(m) => {
                  const photo = { id: m.id, url: m.thumbUrl || m.url };
                  if (picking === 'featured') set({ featured: photo, gallery: form.gallery.filter((g) => g.id !== m.id) });
                  else if (form.featured?.id !== m.id && !form.gallery.some((g) => g.id === m.id)) set({ gallery: [...form.gallery, photo] });
                  setPicking(null);
                }}
              />
            ) : (
              <div className="wm-store-toolbar">
                <Button type="button" size="sm" variant="secondary" onClick={() => setPicking('featured')}>{form.featured ? 'Change the main photo' : 'Choose a main photo'}</Button>
                {form.gallery.length < MAX_GALLERY
                  ? <Button type="button" size="sm" variant="secondary" onClick={() => setPicking('gallery')}>Add a photo</Button>
                  : <span className="wm-store-muted">A product shows up to {MAX_GALLERY} photos.</span>}
              </div>
            )}
            {printed ? (
              <p className="wm-store-muted">{PRINTED_PHOTO_SENTENCE}</p>
            ) : caps.spend && mayChange && (
              <div className="wm-store-ai">
                <Field label="Create a photo with AI" htmlFor="pe-ai" hint={aiPhotoHint()}>
                  <textarea id="pe-ai" className="wm-store-textarea" rows={2} maxLength={500} value={aiText} onChange={(e) => setAiText(e.target.value)} />
                </Field>
                <Button type="button" size="sm" variant="secondary" onClick={() => void createPhoto()} isLoading={aiBusy} disabled={aiText.trim().length < 3 || dirty || busy} data-testid="store-ai-photo">
                  Create the photo
                </Button>
                {dirty && <span className="wm-store-muted"> Save your changes first.</span>}
              </div>
            )}
          </section>

          <section className="wm-store-panel" aria-labelledby="pe-cats">
            <h3 id="pe-cats" className="wm-store-panel__title">Categories and tags</h3>
            <fieldset className="wm-store-fieldset">
              <legend className="wm-store-field__label">Categories</legend>
              {categories.length === 0 && <span className="wm-store-muted">No categories yet.</span>}
              {categories.map((c) => (
                <Checkbox key={c.id} checked={form.categoryIds.includes(c.id)} onChange={(on) => toggleCategory(c.id, on)} label={c.name} />
              ))}
              {form.newCategories.map((name) => (
                <span key={name} className="wm-store-chip wm-store-chip--on">
                  {name}
                  <button type="button" className="wm-store-link" aria-label={`Do not add ${name}`} onClick={() => set({ newCategories: form.newCategories.filter((n) => n !== name) })}>&times;</button>
                </span>
              ))}
            </fieldset>
            <div className="wm-store-toolbar">
              <input className="wm-store-input" aria-label="New category" placeholder="New category" value={newCategory} maxLength={100} onChange={(e) => setNewCategory(e.target.value)} />
              <Button type="button" size="sm" variant="ghost" disabled={!newCategory.trim()} onClick={() => {
                const name = newCategory.trim();
                if (!form.newCategories.includes(name)) set({ newCategories: [...form.newCategories, name] });
                setNewCategory('');
              }}>Add</Button>
            </div>
            <Field label="Tags" htmlFor="pe-tags" hint="Separate them with commas.">
              <input id="pe-tags" className="wm-store-input" value={form.tags} onChange={(e) => set({ tags: e.target.value })} />
            </Field>
          </section>

          {printed && (
            <section className="wm-store-panel" aria-labelledby="pe-printing" data-testid="store-printing">
              <h3 id="pe-printing" className="wm-store-panel__title">Printing</h3>
              <p className="wm-store-plain">{printingSentence()}</p>
              {productLine && <p className="wm-store-muted">{floorSentence(productLine.floor, productLine.price, productLine.earnings, money)}</p>}
              {caps.spend && canRedesign && (
                <>
                  <p className="wm-store-muted">{newDesignSentence()}</p>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setRedesign({ state: 'asking' })} disabled={busy || dirty} data-testid="store-new-design">
                    New design
                  </Button>
                  {dirty && <span className="wm-store-muted"> Save your changes first.</span>}
                </>
              )}
              {caps.spend && !canRedesign && redesignNote && <p className="wm-store-muted" data-testid="store-new-design-note">{redesignNote}</p>}
              {redesign.message && <p className="wm-store-note" role="status">{redesign.message}</p>}
            </section>
          )}

          <div className="wm-store-trash-row">
            <a className="wm-store-link wm-store-woo" href={detail.editUrl}>Open in WooCommerce</a>
            {mayChange && detail.status !== 'trash' && (
              <TrashProduct
                productId={productId}
                name={form.name.trim() || detail.name}
                printed={printed}
                disabled={busy}
                onDone={(answer) => { setProblem(null); setResult(answer); setHistoryKey((k) => k + 1); refresh(); void load(); }}
                onError={(p) => setProblem(p)}
              />
            )}
          </div>
        </div>
      </div>

      <Confirm
        open={redesign.state === 'asking'}
        title="Make a new design?"
        message={newDesignSentence()}
        confirmLabel="Make a new design"
        onConfirm={() => void startRedesign()}
        onCancel={() => setRedesign({ state: 'idle' })}
      />
      <Confirm
        open={!!leaving}
        title="Leave without saving?"
        message="You have not saved your changes to this product."
        confirmLabel="Leave without saving"
        danger
        onConfirm={() => {
          const go = leaving;
          setLeaving(null);
          setGuard?.(null);
          go?.();
        }}
        onCancel={() => setLeaving(null)}
      />
    </div>
  );
}
