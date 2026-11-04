/**
 * Store, Blog, Media and Messages: the site's products and orders, its
 * posts, its media library and the messages its forms received.
 *
 * Each screen needs the account's `store` flag (without it the sidebar
 * links to the dashboard page that does the job) and a WordPress capability
 * of the signed-in user (WEBMAVEN_WP_DATA.storeApp.caps, from the plugin):
 * a user without it gets no sidebar entry. The Store also needs WooCommerce.
 * The Store is for administrators and shop managers, the Blog and Media for
 * them and editors (the tiers of WebMaven_Store_Caps): another role's
 * pasted address sends to Overview, as every page of another tier does.
 */
import type { PageRoute } from './types';
import '../../../../styles/store.css';
import '../../../../styles/store-products.css';
import '../../../../styles/store-content.css';

interface StoreScriptData {
  caps?: Partial<Record<'products' | 'orders' | 'posts' | 'media' | 'messages', boolean>>;
  wooActive?: boolean;
}

function scriptData(): StoreScriptData {
  return ((typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA?.storeApp : null) || {}) as StoreScriptData;
}

const data = scriptData();
const can = (cap: 'products' | 'orders' | 'posts' | 'media' | 'messages') => data.caps?.[cap] === true;

/** This site's business in the dashboard's addresses (?business= pages, the business page's tabs). */
const instanceId = String((typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA?.instanceId : '') || '');
const business = instanceId ? `?business=${encodeURIComponent(instanceId)}` : '';
const businessTab = (tab: string) => (instanceId ? `/instances/${encodeURIComponent(instanceId)}?tab=${tab}` : '/instances');

/** A place in its sidebar group only for a user who may open the screen. */
const placed = (order: number, allowed: boolean) => (allowed ? order : undefined);

export const STORE_ROUTES: PageRoute[] = [
  {
    id: 'store', hash: 'store', group: 'store', order: placed(1, data.wooActive === true && (can('products') || can('orders'))), label: 'Store', feature: 'store', tiers: ['owner', 'store'],
    dashboardFallback: { path: `/store${business}`, testId: 'wm-sidebar-store-link' },
    icon: 'shopping-bag',
  },
  {
    id: 'blog', hash: 'blog', group: 'content', order: placed(1, can('posts')), label: 'Blog', feature: 'store', tiers: ['owner', 'store', 'content'],
    dashboardFallback: { path: businessTab('blog'), testId: 'wm-sidebar-blog-link' },
    icon: 'newspaper',
  },
  {
    id: 'media', hash: 'media', group: 'content', order: placed(2, can('media')), label: 'Media', feature: 'store', tiers: ['owner', 'store', 'content'],
    dashboardFallback: { path: businessTab('media'), testId: 'wm-sidebar-media-link' },
    icon: 'photo',
  },
  {
    // One click away, with Waiting for you, as the dashboard has it.
    id: 'messages', hash: 'messages', group: 'work', order: placed(2, can('messages')), label: 'Messages', feature: 'store',
    dashboardFallback: { path: `/messages${business}`, testId: 'wm-sidebar-messages-link' },
    icon: 'inbox',
    tour: 'messages',
  },
];
