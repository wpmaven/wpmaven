import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, SearchInput } from '@yotako/webmaven-ui';
import Pagination from '../../ui/Pagination';
import { wpRest } from '../../../../services/wpRest';
import { errorSentence, storeApi } from '../../../../services/storeApi';
import { formatOrderMoney } from '../../../../utils/storeMoney';
import type { PaymentsLedgerRow, StoreOrderRow } from '../../../../types/store';
import { useStoreContext } from '../shared/storeContext';
import { useStableMoney } from '../useStableMoney';
import { useDebounced } from '../shared/useDebounced';
import { Chips, ErrorLine, Loading, shortDate } from '../shared/ui';
import { ORDER_STATUS_LABEL, PRINTING_LABEL } from '../storeCopy';
import { ORDER_LIST_FIELDS, orderRowFrom } from './orderMapper';

export type OrderFilter = 'needs-action' | 'all' | 'completed' | 'cancelled' | 'refunded';
export const ORDER_FILTERS: readonly OrderFilter[] = ['needs-action', 'all', 'completed', 'cancelled', 'refunded'];

const FILTER_STATUS: Record<OrderFilter, string | undefined> = {
  'needs-action': 'processing,on-hold',
  all: undefined,
  completed: 'completed',
  cancelled: 'cancelled',
  refunded: 'refunded',
};

let rememberedPage = 1;
let rememberedSearch = '';

/** The badge colour of an order status. */
export function statusColor(status: string): 'cyan' | 'peach' | 'purple' | 'rose' | 'mauve' | 'blue' {
  switch (status) {
    case 'completed': return 'cyan';
    case 'processing': return 'blue';
    case 'on-hold': return 'peach';
    case 'pending': return 'purple';
    case 'cancelled':
    case 'failed':
    case 'refunded': return 'rose';
    default: return 'mauve';
  }
}

/** Every order of the store, the ones waiting for the owner first. */
export default function OrdersPanel({ filter, onFilter, onOpen }: {
  filter: OrderFilter;
  onFilter: (filter: OrderFilter) => void;
  onOpen: (orderId: number) => void;
}) {
  const { money: contextMoney, context } = useStoreContext();
  const money = useStableMoney(contextMoney);
  const [page, setPage] = useState(rememberedPage);
  const [searchText, setSearchText] = useState(rememberedSearch);
  const search = useDebounced(searchText);
  const [rows, setRows] = useState<StoreOrderRow[] | null>(null);
  const [ledger, setLedger] = useState<Record<number, PaymentsLedgerRow>>({});
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    rememberedPage = page;
    rememberedSearch = searchText;
  }, [page, searchText]);

  const load = useCallback(async () => {
    const id = ++request.current;
    setError(null);
    try {
      const answer = await wpRest.get<Array<Record<string, any>>>('wc/v3/orders', {
        query: { per_page: 20, page, status: FILTER_STATUS[filter], search: search.trim() || undefined, _fields: ORDER_LIST_FIELDS },
      });
      if (id !== request.current) return;
      const list = (Array.isArray(answer.data) ? answer.data : []).map((o) => orderRowFrom(o, money));
      setRows(list);
      setTotal(answer.total);
      setTotalPages(answer.totalPages);
      const paid = list.filter((o) => o.wpmaven.paymentsWpmaven).map((o) => o.id).slice(0, 50);
      if (paid.length) {
        storeApi.paymentsOrders(paid).then((found) => {
          if (id !== request.current) return;
          const byId: Record<number, PaymentsLedgerRow> = {};
          for (const r of found) byId[Number(r.orderId)] = r;
          setLedger(byId);
        }, () => undefined);
      } else {
        setLedger({});
      }
    } catch (err) {
      if (id !== request.current) return;
      setRows([]);
      setError(errorSentence(err, 'The orders did not load. Try again.'));
    }
  }, [filter, page, search, money]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = context?.counts;
  const options: Array<{ value: OrderFilter; label: string; count?: number | null }> = [
    { value: 'needs-action', label: 'Needs action', count: counts?.ordersToShip },
    { value: 'all', label: 'All' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'refunded', label: 'Refunded' },
  ];

  return (
    <section className="wm-store-orders" aria-label="Orders" data-testid="store-orders">
      <div className="wm-store-toolbar">
        <div className="wm-store-search">
          <SearchInput
            aria-label="Search orders"
            placeholder="Search orders"
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>
      <Chips label="Show" value={filter} options={options} onChange={(f) => { setPage(1); onFilter(f); }} />
      <ErrorLine message={error} onRetry={() => void load()} />
      {rows === null ? <Loading label="Reading the orders" /> : rows.length === 0 && !error ? (
        <div className="wm-store-empty">
          <p className="wm-store-strong">
            {search.trim() ? 'No order matches this search.' : filter === 'needs-action' ? 'No order is waiting for you.' : 'No orders here yet.'}
          </p>
        </div>
      ) : (
        <ul className="wm-store-list wm-store-plainlist" data-testid="store-orders-list">
          {rows.map((o) => {
            const l = ledger[o.id];
            const printing = l ? PRINTING_LABEL[l.fulfillment] : '';
            return (
              <li key={o.id}>
                <button type="button" className="wm-store-row wm-store-row--button" onClick={() => onOpen(o.id)} data-testid="store-order-row" data-order-id={o.id}>
                  <span className="wm-store-order__number">#{o.number}</span>
                  <span className="wm-store-grow">
                    <span className="wm-store-strong wm-store-ellipsis">{o.customerName}</span>
                    <span className="wm-store-muted wm-store-ellipsis">
                      {shortDate(o.createdAt)} · {o.itemCount === 1 ? '1 item' : `${o.itemCount} items`}
                      {o.paymentMethodTitle ? ` · ${o.paymentMethodTitle}` : ''}
                    </span>
                  </span>
                  {printing && <span className="wm-store-muted">{printing}</span>}
                  <span className="wm-store-badges">
                    <Badge color={statusColor(o.status)}>{ORDER_STATUS_LABEL[o.status] ?? o.status}</Badge>
                  </span>
                  <span className="wm-store-strong wm-store-order__total">{formatOrderMoney(o.total, o.currencySymbol, money)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Pagination currentPage={page} totalPages={totalPages} total={total} onPageChange={setPage} />
    </section>
  );
}
