import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, SearchInput } from '@yotako/webmaven-ui';
import Pagination from '../../ui/Pagination';
import StatusBadge from '../../ui/StatusBadge';
import { wpRest, type QueryValue } from '../../../../services/wpRest';
import { editFailure, errorSentence, storeApi } from '../../../../services/storeApi';
import { formatStoreMoney } from '../../../../utils/storeMoney';
import type { StoreCategory, StoreMoneyFormat, StoreProductRow } from '../../../../types/store';
import { useStoreContext } from '../shared/storeContext';
import { useStableMoney } from '../useStableMoney';
import { useDebounced } from '../shared/useDebounced';
import { Chips, Drawer, ErrorLine, Field, Loading } from '../shared/ui';
import { STOCK_LABEL } from '../storeCopy';
import { loadCategories } from './categories';
import ProductQuickEdit from './ProductQuickEdit';
import { PRODUCT_LIST_FIELDS, productIdFromResult, productRowFrom, rowPriceText } from './productMapper';

export type ProductChip = 'all' | 'printed' | 'own' | 'samples' | 'no-photo';
export const PRODUCT_CHIPS: readonly ProductChip[] = ['all', 'printed', 'own', 'samples', 'no-photo'];

interface Filters {
  page: number;
  search: string;
  status: string;
  category: string;
  stock: string;
}

/** The grid's filters survive a visit to a product and back. */
let remembered: Filters = { page: 1, search: '', status: '', category: '', stock: '' };

const VIEW_KEY = 'wm-store-products-view';

function readView(): 'grid' | 'list' {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function keepView(view: 'grid' | 'list'): void {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // A private window keeps no preference: the grid stays the default.
  }
}

/** Tests: forget the remembered filters. */
export function resetProductsPanelForTests(): void {
  remembered = { page: 1, search: '', status: '', category: '', stock: '' };
}

/** The wc/v3/products query of a page of the grid. */
export function productsQuery(f: Filters, chip: ProductChip): Record<string, QueryValue> {
  return {
    per_page: 24,
    page: f.page,
    search: f.search.trim() || undefined,
    status: f.status || 'any',
    category: f.category || undefined,
    stock_status: f.stock || undefined,
    wpmaven_kind: chip === 'printed' ? 'printed' : chip === 'own' ? 'own' : chip === 'samples' ? 'sample' : undefined,
    wpmaven_no_photo: chip === 'no-photo' ? true : undefined,
    _fields: PRODUCT_LIST_FIELDS,
  };
}

function stockText(row: StoreProductRow): string {
  if (row.wpmaven.kind === 'printed') return 'Made to order';
  if (row.manageStock && row.stockQuantity !== null && row.stockStatus === 'instock') return `${row.stockQuantity} in stock`;
  return STOCK_LABEL[row.stockStatus] ?? row.stockStatus;
}

function Price({ row, money }: { row: StoreProductRow; money: StoreMoneyFormat }) {
  const text = rowPriceText(row, money);
  const onSale = row.type !== 'variable' && row.salePrice && row.regularPrice && row.salePrice === row.price;
  return (
    <span className="wm-store-price" data-testid="store-product-price">
      {text || <span className="wm-store-muted">No price yet</span>}
      {onSale && <s className="wm-store-price__was">{formatStoreMoney(row.regularPrice, money)}</s>}
    </span>
  );
}

function Badges({ row }: { row: StoreProductRow }) {
  return (
    <span className="wm-store-badges" data-testid="store-product-badges">
      {row.wpmaven.kind === 'printed' && <Badge color="blue">Printed</Badge>}
      {row.wpmaven.kind === 'sample' && <Badge color="peach">Sample</Badge>}
      <StatusBadge status={row.status} />
    </span>
  );
}

function Photo({ row, className }: { row: StoreProductRow; className: string }) {
  return (
    <span className={className}>
      {row.imageUrl ? <img src={row.imageUrl} alt="" loading="lazy" /> : <span className="wm-store-nophoto">No photo yet</span>}
    </span>
  );
}

function AddProduct({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number | null) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const clean = name.trim();
    if (!clean) {
      setError('Give the product a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await storeApi.edit({ op: 'add_product', fields: { name: clean, type: 'simple', status: 'draft' } });
      const failure = editFailure(result);
      if (failure) setError(failure.message);
      else onCreated(productIdFromResult(result));
    } catch (err) {
      setError(errorSentence(err, 'Creating the product did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      title="New product"
      onClose={onClose}
      testId="store-add-product"
      footer={(
        <>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" onClick={() => void submit()} isLoading={busy} data-testid="store-add-product-create">Create the draft</Button>
        </>
      )}
    >
      <form id="wm-store-add-form" onSubmit={submit} className="wm-store-form">
        <Field label="Name" htmlFor="wm-store-add-name" hint="It starts as a draft. You add its price, photos and details next.">
          <input id="wm-store-add-name" className="wm-store-input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ErrorLine message={error} />
      </form>
    </Drawer>
  );
}

/**
 * The store's products: search, filters, a grid or a list, a quick edit of
 * price, stock and status, and "Add" for a new draft.
 */
export default function ProductsPanel({ chip, onChip, onOpen }: {
  chip: ProductChip;
  onChip: (chip: ProductChip) => void;
  onOpen: (productId: number) => void;
}) {
  const { money: contextMoney, caps, context, writesAvailable, refresh } = useStoreContext();
  const money = useStableMoney(contextMoney);
  const [filters, setFilters] = useState<Filters>(remembered);
  const search = useDebounced(filters.search);
  const [rows, setRows] = useState<StoreProductRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [view, setView] = useState<'grid' | 'list'>(readView);
  const [quick, setQuick] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    remembered = filters;
  }, [filters]);

  useEffect(() => {
    let live = true;
    loadCategories().then((c) => live && setCategories(c), () => undefined);
    return () => {
      live = false;
    };
  }, []);

  const { page, status, category, stock } = filters;
  const load = useCallback(async () => {
    const id = ++request.current;
    setError(null);
    try {
      const answer = await wpRest.get<Array<Record<string, any>>>('wc/v3/products', {
        query: productsQuery({ page, search, status, category, stock }, chip),
      });
      if (id !== request.current) return;
      setRows((Array.isArray(answer.data) ? answer.data : []).map((p) => productRowFrom(p, money)));
      setTotal(answer.total);
      setTotalPages(answer.totalPages);
    } catch (err) {
      if (id !== request.current) return;
      setRows([]);
      setError(errorSentence(err, 'The products did not load. Try again.'));
    }
  }, [chip, search, page, status, category, stock, money]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, page: 1, ...patch }));
  const counts = context?.counts;
  const chipOptions: Array<{ value: ProductChip; label: string; count?: number | null }> = [
    { value: 'all', label: 'All', count: counts?.products },
    { value: 'printed', label: 'Printed', count: counts?.printed },
    { value: 'own', label: 'Your products', count: counts ? Math.max(0, counts.products - counts.printed) : null },
    { value: 'samples', label: 'Samples to finish', count: counts?.samples },
    { value: 'no-photo', label: 'No photo yet', count: counts?.withoutPhoto },
  ];
  const filtered = chip !== 'all' || !!search.trim() || !!filters.status || !!filters.category || !!filters.stock;
  const canChange = caps.products && writesAvailable;

  // Stable, so an open panel keeps its focus while the grid reads again.
  const closeQuick = useCallback(() => setQuick(null), []);
  const closeAdd = useCallback(() => setAdding(false), []);
  const savedQuick = useCallback(() => {
    void load();
    refresh();
  }, [load, refresh]);

  const changeView = (next: 'grid' | 'list') => {
    setView(next);
    keepView(next);
  };

  const quickButton = (row: StoreProductRow) => canChange && (
    <Button type="button" variant="secondary" size="sm" onClick={() => setQuick(row.id)} data-testid="store-quick-edit-open" aria-label={`Quick edit ${row.name}`}>
      Quick edit
    </Button>
  );

  return (
    <section className="wm-store-products" aria-label="Products" data-testid="store-products">
      <div className="wm-store-toolbar">
        <div className="wm-store-search">
          <SearchInput
            aria-label="Search products"
            placeholder="Search products"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
          />
        </div>
        <label className="wm-store-inline">
          <span>Status</span>
          <select className="wm-select" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All</option>
            <option value="publish">Published</option>
            <option value="draft">Draft</option>
            <option value="pending">Pending review</option>
            <option value="private">Private</option>
          </select>
        </label>
        <label className="wm-store-inline">
          <span>Category</span>
          <select className="wm-select" value={filters.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">All</option>
            {categories.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </label>
        <label className="wm-store-inline">
          <span>Stock</span>
          <select className="wm-select" value={filters.stock} onChange={(e) => set({ stock: e.target.value })}>
            <option value="">All</option>
            <option value="instock">In stock</option>
            <option value="outofstock">Out of stock</option>
            <option value="onbackorder">On backorder</option>
          </select>
        </label>
        {canChange && (
          <Button type="button" variant="primary" size="sm" onClick={() => setAdding(true)} data-testid="store-add-product-open" className="wm-store-push">
            + Add
          </Button>
        )}
      </div>
      <div className="wm-store-toolbar wm-store-toolbar--chips">
        <Chips label="Show" value={chip} options={chipOptions} onChange={(c) => { setFilters((f) => ({ ...f, page: 1 })); onChip(c); }} />
        <div className="wm-store-chips wm-store-push" role="group" aria-label="Layout">
          <button type="button" className={`wm-store-chip ${view === 'grid' ? 'wm-store-chip--on' : ''}`} aria-pressed={view === 'grid'} onClick={() => changeView('grid')}>Grid</button>
          <button type="button" className={`wm-store-chip ${view === 'list' ? 'wm-store-chip--on' : ''}`} aria-pressed={view === 'list'} onClick={() => changeView('list')}>List</button>
        </div>
      </div>

      <ErrorLine message={error} onRetry={() => void load()} />
      {rows === null ? <Loading label="Reading the products" /> : rows.length === 0 && !error ? (
        <div className="wm-store-empty">
          <p className="wm-store-strong">{filtered ? 'No product matches these filters.' : 'Your store has no products yet.'}</p>
          {!filtered && canChange && <Button type="button" variant="primary" size="sm" onClick={() => setAdding(true)}>Add a product</Button>}
        </div>
      ) : view === 'grid' ? (
        <ul className="wm-store-grid wm-store-plainlist" data-testid="store-products-grid">
          {rows.map((row) => (
            <li key={row.id} className="wm-store-card" data-testid="store-product-card" data-product-id={row.id}>
              {/* The photo opens the product too; keyboards reach it through the title. */}
              <button type="button" className="wm-store-card__media wm-store-card__open" onClick={() => onOpen(row.id)} aria-label={`Open ${row.name}`} tabIndex={-1}>
                <Photo row={row} className="wm-store-card__photo" />
              </button>
              <div className="wm-store-card__body">
                <h3 className="wm-store-card__title">
                  <button type="button" className="wm-store-titlelink" onClick={() => onOpen(row.id)}>{row.name}</button>
                </h3>
                <Price row={row} money={money} />
                <Badges row={row} />
                <span className="wm-store-muted">{stockText(row)}</span>
              </div>
              {quickButton(row) && <div className="wm-store-card__foot">{quickButton(row)}</div>}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="wm-store-list wm-store-plainlist" data-testid="store-products-list">
          {rows.map((row) => (
            <li key={row.id} className="wm-store-row" data-testid="store-product-card" data-product-id={row.id}>
              <Photo row={row} className="wm-store-thumb" />
              <div className="wm-store-grow">
                <button type="button" className="wm-store-titlelink wm-store-ellipsis" onClick={() => onOpen(row.id)}>{row.name}</button>
                <div className="wm-store-muted wm-store-ellipsis">
                  {row.categories.map((c) => c.name).join(', ')}
                </div>
              </div>
              <Price row={row} money={money} />
              <Badges row={row} />
              <span className="wm-store-muted wm-store-row__stock">{stockText(row)}</span>
              {quickButton(row)}
            </li>
          ))}
        </ul>
      )}
      <Pagination currentPage={filters.page} totalPages={totalPages} total={total} onPageChange={(page) => setFilters((f) => ({ ...f, page }))} />

      {quick !== null && (
        <ProductQuickEdit productId={quick} onClose={closeQuick} onSaved={savedQuick} />
      )}
      {adding && (
        <AddProduct
          onClose={closeAdd}
          onCreated={(id) => {
            setAdding(false);
            refresh();
            if (id) onOpen(id);
            else void load();
          }}
        />
      )}
    </section>
  );
}
