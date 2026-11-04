import React from 'react';
import { Tabs } from '@yotako/webmaven-ui';
import { useStoreContext } from './shared/storeContext';
import { idFrom, useSubPath } from './shared/useSubPath';
import { ConnectionNote, StorePage } from './shared/ui';
import ProductsPanel, { PRODUCT_CHIPS, type ProductChip } from './products/ProductsPanel';
import ProductEditor from './products/ProductEditor';
import OrdersPanel, { ORDER_FILTERS, type OrderFilter } from './orders/OrdersPanel';
import OrderDetail from './orders/OrderDetail';

/** Where "Products" and "Orders" lead back to: each list as the owner left it. */
let lastProducts: string[] = ['products'];
let lastOrders: string[] = ['orders'];

/**
 * The Store: products (#/store/products, a product at #/store/products/31,
 * a filter at #/store/products/samples) and orders (#/store/orders, an order
 * at #/store/orders/1042). Each part shows for the WordPress capability it
 * needs; without WooCommerce the screen says so.
 */
export default function StoreScreen() {
  const { parts, go } = useSubPath('store');
  const { caps, wooActive, writesAvailable } = useStoreContext();

  if (!wooActive) {
    return (
      <StorePage title="Store" testId="store-root">
        <p className="wm-store-note" data-testid="store-no-woo">
          The Store shows your WooCommerce products and orders. Turn on the WooCommerce plugin on this site to sell here.
        </p>
        {/* WordPress's own installer: the owner adds WooCommerce themselves. */}
        <p className="wm-store-note">
          <a href={`${(window as any).WEBMAVEN_WP_DATA?.adminUrl || '/wp-admin/'}plugin-install.php?s=woocommerce&tab=search&type=term`} data-testid="store-install-woo">
            Find WooCommerce in WordPress's plugins
          </a>
        </p>
      </StorePage>
    );
  }
  if (!caps.products && !caps.orders) {
    return (
      <StorePage title="Store" testId="store-root">
        <p className="wm-store-note" data-testid="store-no-access">
          Your account on this site cannot open the Store. An administrator or a shop manager can.
        </p>
      </StorePage>
    );
  }

  const section: 'products' | 'orders' = parts[0] === 'orders' && caps.orders
    ? 'orders'
    : parts[0] === 'products' && caps.products ? 'products' : caps.products ? 'products' : 'orders';
  const sub = parts[0] === section ? parts[1] : undefined;
  const id = idFrom(sub);

  const tabs = [
    ...(caps.products ? [{ key: 'products', label: 'Products' }] : []),
    ...(caps.orders ? [{ key: 'orders', label: 'Orders' }] : []),
  ];

  let body: React.ReactNode;
  if (section === 'products') {
    if (id) {
      body = <ProductEditor key={id} productId={id} onBack={() => go(lastProducts)} />;
    } else {
      const chip: ProductChip = (PRODUCT_CHIPS as readonly string[]).includes(sub ?? '') ? sub as ProductChip : 'all';
      lastProducts = chip === 'all' ? ['products'] : ['products', chip];
      body = (
        <>
          <ConnectionNote available={writesAvailable} />
          <ProductsPanel
            chip={chip}
            onChip={(c) => go(c === 'all' ? ['products'] : ['products', c], { replace: true })}
            onOpen={(productId) => go(['products', productId])}
          />
        </>
      );
    }
  } else if (id) {
    body = <OrderDetail key={id} orderId={id} onBack={() => go(lastOrders)} />;
  } else {
    const filter: OrderFilter = (ORDER_FILTERS as readonly string[]).includes(sub ?? '') ? sub as OrderFilter : 'needs-action';
    lastOrders = filter === 'needs-action' ? ['orders'] : ['orders', filter];
    body = (
      <OrdersPanel
        filter={filter}
        onFilter={(f) => go(f === 'needs-action' ? ['orders'] : ['orders', f], { replace: true })}
        onOpen={(orderId) => go(['orders', orderId])}
      />
    );
  }

  return (
    <StorePage
      title="Store"
      testId="store-root"
      actions={tabs.length > 1 ? (
        <Tabs items={tabs} activeKey={section} onChange={(key) => go(key === 'orders' ? lastOrders : lastProducts)} size="sm" />
      ) : undefined}
    >
      {body}
    </StorePage>
  );
}
