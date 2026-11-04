import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import { WpRestError, wpRest } from '../../../../services/wpRest';
import { editFailure, errorSentence, storeApi } from '../../../../services/storeApi';
import { compareDecimal, moneyInputText, parseStoreMoney } from '../../../../utils/storeMoney';
import type {
  Decimal, ProductFields, ProductPricing, StoreEditResult, StoreMoneyFormat, StoreProductRow, StoreVariation, VariationPatch,
} from '../../../../types/store';
import EditOutcome from '../shared/EditOutcome';
import { useStoreContext } from '../shared/storeContext';
import { useStableMoney } from '../useStableMoney';
import TrashProduct from './TrashProduct';
import { ConnectionNote, Drawer, ErrorLine, Field, Loading } from '../shared/ui';
import { CHANGED_ELSEWHERE_SENTENCE, PRODUCT_STATUSES, PRODUCT_STATUS_LABEL, floorSentence, madeToOrderSentence } from '../storeCopy';
import { floorLine } from './pricing';
import { PRODUCT_LIST_FIELDS, VARIATION_FIELDS, asUtc, productRowFrom, variationFrom } from './productMapper';

export interface QuickValues {
  regular: string;
  sale: string;
  qty: string;
  stock: string;
}

type QuickErrors = Partial<Record<keyof QuickValues, string>>;

/** What the form shows for a product or an option. */
export function quickValuesOf(source: { regularPrice: Decimal | null; salePrice: Decimal | null; stockQuantity: number | null; stockStatus: string }, money: StoreMoneyFormat): QuickValues {
  return {
    regular: moneyInputText(source.regularPrice, money),
    sale: moneyInputText(source.salePrice, money),
    qty: source.stockQuantity === null ? '' : String(source.stockQuantity),
    stock: source.stockStatus,
  };
}

/** What every option shares ('' where they differ). */
export function sharedValuesOf(variations: StoreVariation[], money: StoreMoneyFormat): QuickValues {
  const same = <T,>(pick: (v: StoreVariation) => T): T | null => (
    variations.length && variations.every((v) => pick(v) === pick(variations[0])) ? pick(variations[0]) : null
  );
  return {
    regular: moneyInputText(same((v) => v.regularPrice), money),
    sale: moneyInputText(same((v) => v.salePrice), money),
    qty: '',
    stock: same((v) => v.stockStatus) ?? '',
  };
}

export interface QuickChange {
  /** simple: the product itself; all: every option at once; one: the option `variationId`. */
  scope: 'simple' | 'all' | 'one';
  variationId?: number;
  printed: boolean;
  manageStock: boolean;
  initial: QuickValues;
  values: QuickValues;
  initialStatus: string;
  status: string;
}

/** The fields an update_product sends: only what changed (baseModified is added on save). */
export function quickFields(c: QuickChange, money: StoreMoneyFormat): { fields: ProductFields; errors: QuickErrors } {
  const fields: ProductFields = {};
  const errors: QuickErrors = {};
  const example = moneyInputText('18.50', money);
  if (c.status !== c.initialStatus && PRODUCT_STATUSES.some((s) => s.value === c.status)) {
    fields.status = c.status as ProductFields['status'];
  }
  let regular: Decimal | undefined;
  let sale: Decimal | null | undefined;
  if (c.values.regular !== c.initial.regular) {
    if (!c.values.regular.trim()) {
      if (c.initial.regular) errors.regular = 'Enter a price.';
    } else {
      const d = parseStoreMoney(c.values.regular, money);
      if (d === null) errors.regular = `Enter a price like ${example}.`;
      else if (d !== parseStoreMoney(c.initial.regular, money)) regular = d;
    }
  }
  if (c.values.sale !== c.initial.sale) {
    if (!c.values.sale.trim()) {
      if (c.initial.sale) sale = null;
    } else {
      const d = parseStoreMoney(c.values.sale, money);
      if (d === null) errors.sale = `Enter a price like ${example}.`;
      else if (d !== parseStoreMoney(c.initial.sale, money)) sale = d;
    }
  }
  const nowRegular = regular ?? parseStoreMoney(c.values.regular, money);
  const nowSale = sale === undefined ? parseStoreMoney(c.values.sale, money) : sale;
  if (!errors.sale && (regular !== undefined || sale) && nowSale && nowRegular && compareDecimal(nowSale, nowRegular) >= 0) {
    errors.sale = 'The sale price must be lower than the price.';
  }
  let stockQuantity: number | undefined;
  let stockStatus: string | undefined;
  if (!c.printed) {
    if (c.manageStock && c.scope !== 'all') {
      if (c.values.qty !== c.initial.qty) {
        if (!/^\d{1,9}$/.test(c.values.qty.trim())) errors.qty = 'Enter a whole number, 0 or more.';
        else stockQuantity = Number(c.values.qty.trim());
      }
    } else if (c.values.stock && c.values.stock !== c.initial.stock) {
      stockStatus = c.values.stock;
    }
  }
  if (c.scope === 'simple') {
    if (regular !== undefined) fields.regularPrice = regular;
    if (sale !== undefined) fields.salePrice = sale;
    if (stockQuantity !== undefined) fields.stockQuantity = stockQuantity;
    if (stockStatus) fields.stockStatus = stockStatus as ProductFields['stockStatus'];
  } else if (c.scope === 'all') {
    const all: NonNullable<ProductFields['allVariations']> = {};
    if (regular !== undefined) all.regularPrice = regular;
    if (sale !== undefined) all.salePrice = sale;
    if (stockStatus === 'instock' || stockStatus === 'outofstock') all.stockStatus = stockStatus;
    if (Object.keys(all).length) fields.allVariations = all;
  } else if (c.variationId) {
    const patch: VariationPatch = { variationId: c.variationId };
    if (regular !== undefined) patch.regularPrice = regular;
    if (sale !== undefined) patch.salePrice = sale;
    if (stockQuantity !== undefined) patch.stockQuantity = stockQuantity;
    if (stockStatus) patch.stockStatus = stockStatus as VariationPatch['stockStatus'];
    if (Object.keys(patch).length > 1) fields.variations = [patch];
  }
  return { fields, errors };
}

interface Loaded {
  row: StoreProductRow;
  variations: StoreVariation[];
}

/** What the form shows for the product, one of its options, or all of them. */
function valuesFor(row: StoreProductRow, variations: StoreVariation[], target: 'all' | number, money: StoreMoneyFormat): QuickValues {
  if (row.type !== 'variable') return quickValuesOf(row, money);
  const option = typeof target === 'number' ? variations.find((v) => v.variationId === target) : undefined;
  return option ? quickValuesOf(option, money) : sharedValuesOf(variations, money);
}

export interface ProductQuickEditProps {
  productId: number;
  onClose: () => void;
  /** After a change or its undo went through (the caller reads its rows again). */
  onSaved?: (result: StoreEditResult) => void;
}

/**
 * The quick edit of a product in a side panel: price, sale price, stock and
 * status; on a variable product, every option at once or one of them. A
 * printed product shows its lowest price and what a sale earns. Saving sends
 * one update_product with only what changed, and the time the product was
 * read, so a change made elsewhere meanwhile is refused instead of
 * overwritten.
 */
export default function ProductQuickEdit({ productId, onClose, onSaved }: ProductQuickEditProps) {
  const { money: contextMoney, writesAvailable, caps } = useStoreContext();
  const money = useStableMoney(contextMoney);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<ProductPricing | null>(null);
  const [target, setTargetState] = useState<'all' | number>('all');
  const targetRef = useRef<'all' | number>('all');
  const [initial, setInitial] = useState<QuickValues>({ regular: '', sale: '', qty: '', stock: '' });
  const [values, setValues] = useState<QuickValues>(initial);
  const [status, setStatus] = useState('');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<StoreEditResult | null>(null);
  const [problem, setProblem] = useState<{ code: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const answer = await wpRest.get<Record<string, any>>(`wc/v3/products/${productId}`, { query: { context: 'edit', _fields: PRODUCT_LIST_FIELDS } });
      const row = productRowFrom(answer.data ?? {}, money);
      let variations: StoreVariation[] = [];
      if (row.type === 'variable') {
        const v = await wpRest.get<Array<Record<string, any>>>(`wc/v3/products/${productId}/variations`, {
          query: { per_page: 100, context: 'edit', _fields: VARIATION_FIELDS },
        });
        variations = (Array.isArray(v.data) ? v.data : []).map((x) => variationFrom(x, money));
      }
      const next = valuesFor(row, variations, targetRef.current, money);
      setLoaded({ row, variations });
      setInitial(next);
      setValues(next);
      setStatus(row.status);
      setTried(false);
      setProblem(null);
    } catch (error) {
      setLoadError(errorSentence(error, 'This product did not load. Try again.'));
    }
  }, [productId, money]);

  useEffect(() => {
    void load();
  }, [load]);

  const printed = loaded?.row.wpmaven.kind === 'printed';
  useEffect(() => {
    if (!printed) return undefined;
    let live = true;
    storeApi.pricing(productId).then((p) => live && setPricing(p && Array.isArray(p.variations) ? p : null), () => undefined);
    return () => {
      live = false;
    };
  }, [printed, productId]);

  // The form starts again from what the chosen option holds now.
  const setTarget = (next: 'all' | number) => {
    targetRef.current = next;
    setTargetState(next);
    if (!loaded) return;
    const values = valuesFor(loaded.row, loaded.variations, next, money);
    setInitial(values);
    setValues(values);
  };

  if (!loaded) {
    return (
      <Drawer open title="Quick edit" onClose={onClose} testId="store-quick-edit">
        {loadError ? <ErrorLine message={loadError} onRetry={() => void load()} /> : <Loading label="Reading the product" />}
      </Drawer>
    );
  }

  const { row, variations } = loaded;
  const variable = row.type === 'variable';
  const option = typeof target === 'number' ? variations.find((v) => v.variationId === target) : undefined;
  const scope: QuickChange['scope'] = !variable ? 'simple' : option ? 'one' : 'all';
  const manageStock = scope === 'one' ? !!option?.manageStock : row.manageStock;
  const { fields, errors } = quickFields({
    scope, variationId: option?.variationId, printed, manageStock, initial, values, initialStatus: row.status, status,
  }, money);
  const changed = Object.keys(fields).length > 0;
  const shownErrors: QuickErrors = tried ? errors : {};
  const line = printed ? floorLine(scope === 'simple' ? 'product' : scope === 'all' ? 'all' : (option?.variationId ?? 'all'), pricing, row.wpmaven.floor, variations) : null;
  const canSave = writesAvailable && caps.products && changed && !saving;
  const set = (key: keyof QuickValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const several = scope === 'all' && variations.length > 1;

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setTried(true);
    if (!canSave || Object.keys(errors).length) return;
    setSaving(true);
    setProblem(null);
    setResult(null);
    try {
      const base = asUtc(row.modified);
      const answer = await storeApi.edit({ op: 'update_product', productId, fields: { ...fields, ...(base ? { baseModified: base } : {}) } });
      const failure = editFailure(answer);
      if (failure) {
        setProblem(failure);
      } else {
        setResult(answer);
        onSaved?.(answer);
        await load();
      }
    } catch (error) {
      setProblem({
        code: error instanceof WpRestError ? error.code : '',
        message: errorSentence(error, 'This change did not go through. Try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  const statusOptions = PRODUCT_STATUSES.some((s) => s.value === row.status)
    ? PRODUCT_STATUSES
    : [{ value: row.status, label: PRODUCT_STATUS_LABEL[row.status] ?? row.status }, ...PRODUCT_STATUSES];

  return (
    <Drawer
      open
      title={`Quick edit: ${row.name}`}
      onClose={onClose}
      testId="store-quick-edit"
      footer={(
        <>
          {writesAvailable && caps.products && row.status !== 'trash' && (
            <TrashProduct
              productId={productId}
              name={row.name}
              printed={printed}
              disabled={saving}
              onDone={(answer) => { setProblem(null); setResult(answer); onSaved?.(answer); void load(); }}
              onError={(p) => setProblem(p)}
            />
          )}
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
          <Button type="button" variant="primary" onClick={() => void save()} isLoading={saving} disabled={!canSave} data-testid="store-quick-save">Save</Button>
        </>
      )}
    >
      <ConnectionNote available={writesAvailable} />
      <form id="wm-store-quick-form" className="wm-store-form" onSubmit={save} noValidate>
        {variable && (
          <Field label="Change" htmlFor="wm-qe-target">
            <select
              id="wm-qe-target"
              className="wm-select"
              value={String(target)}
              onChange={(e) => setTarget(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              data-testid="store-quick-target"
            >
              <option value="all">All variations</option>
              {variations.map((v) => (
                <option key={v.variationId} value={String(v.variationId)}>{v.enabled ? v.label : `${v.label} (hidden)`}</option>
              ))}
            </select>
          </Field>
        )}
        <div className="wm-store-field-row">
          <Field label="Price" htmlFor="wm-qe-price">
            <input
              id="wm-qe-price"
              className="wm-store-input"
              inputMode="decimal"
              value={values.regular}
              placeholder={several && !initial.regular ? 'Several prices' : ''}
              onChange={set('regular')}
              aria-invalid={!!shownErrors.regular}
              aria-describedby={shownErrors.regular ? 'wm-qe-price-error' : undefined}
              data-testid="store-quick-price"
            />
          </Field>
          <Field label="Sale price" htmlFor="wm-qe-sale">
            <input
              id="wm-qe-sale"
              className="wm-store-input"
              inputMode="decimal"
              value={values.sale}
              placeholder={several && !initial.sale ? 'Leave as they are' : 'No sale'}
              onChange={set('sale')}
              aria-invalid={!!shownErrors.sale}
              aria-describedby={shownErrors.sale ? 'wm-qe-sale-error' : undefined}
              data-testid="store-quick-sale"
            />
          </Field>
        </div>
        {shownErrors.regular && <p id="wm-qe-price-error" className="wm-store-field__error" role="alert">{shownErrors.regular}</p>}
        {shownErrors.sale && <p id="wm-qe-sale-error" className="wm-store-field__error" role="alert">{shownErrors.sale}</p>}
        {line && <p className="wm-store-note" data-testid="store-floor-line">{floorSentence(line.floor, line.price, line.earnings, money)}</p>}
        {printed ? (
          <p className="wm-store-muted">{madeToOrderSentence()}</p>
        ) : manageStock ? (
          <Field label="In stock" htmlFor="wm-qe-qty">
            <input
              id="wm-qe-qty"
              className="wm-store-input"
              inputMode="numeric"
              value={values.qty}
              onChange={set('qty')}
              aria-invalid={!!shownErrors.qty}
              aria-describedby={shownErrors.qty ? 'wm-qe-qty-error' : undefined}
              data-testid="store-quick-qty"
            />
          </Field>
        ) : (
          <Field label="Stock" htmlFor="wm-qe-stock">
            <select id="wm-qe-stock" className="wm-select" value={values.stock} onChange={set('stock')} data-testid="store-quick-stock">
              {!values.stock && <option value="">Leave as they are</option>}
              <option value="instock">In stock</option>
              <option value="outofstock">Out of stock</option>
              {scope !== 'all' && <option value="onbackorder">On backorder</option>}
            </select>
          </Field>
        )}
        {shownErrors.qty && <p id="wm-qe-qty-error" className="wm-store-field__error" role="alert">{shownErrors.qty}</p>}
        <Field label="Status" htmlFor="wm-qe-status">
          <select id="wm-qe-status" className="wm-select" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="store-quick-status">
            {statusOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        {tried && !changed && !result && <p className="wm-store-muted" role="status">Nothing changed yet.</p>}
      </form>
      {problem && (
        <p className="wm-store-note wm-store-note--error" role="alert" data-testid="store-quick-error" data-code={problem.code}>
          {problem.code === 'CHANGED_ELSEWHERE' ? CHANGED_ELSEWHERE_SENTENCE : problem.message}
          {problem.code === 'CHANGED_ELSEWHERE' && (
            <button type="button" className="wm-store-link" onClick={() => void load()} data-testid="store-quick-reload">Reload</button>
          )}
        </p>
      )}
      <EditOutcome
        key={result?.operationId ?? 'none'}
        result={result}
        onUndone={(undo) => {
          onSaved?.(undo);
          void load();
        }}
      />
    </Drawer>
  );
}
