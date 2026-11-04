/**
 * The plugin's own routes for the Store, Blog, Media and Messages screens
 * (webmaven_wp/v1). Each route checks the WordPress capability it needs;
 * the ones that change a product, a post or an image forward an edit
 * operation to the WPMaven account (history and undo), the others work on
 * the site itself. Lists and details come from WordPress's own REST
 * (wpRest), enriched by the plugin.
 */

import { WpRestError, restRoot, routeUrl, wpRest, type QueryValue } from './wpRest';
import type {
  DesignedPicture, LeadsPage, Lead, LeadStatus, MediaUsageAnswer, PaymentsLedgerRow, ProductPricing,
  StoreAppContext, StoreEditResult, StoreOperation,
} from '../types/store';

const NS = 'webmaven_wp/v1';

export interface EditOptions {
  /** 'publish' (the default) changes the site; 'preview' answers what would change. */
  mode?: 'preview' | 'publish';
  previewId?: string;
  /** The owner confirmed: write over a change made elsewhere. */
  force?: boolean;
  idempotencyKey?: string;
}

export interface EditHistory {
  items: StoreEditResult[];
  nextCursor: string | null;
}

export interface RedesignOffer {
  available: boolean;
  products: Array<{ productKey: string; name: string; imageUrl?: string; productId?: number | null }>;
  /** Why not, when not available (printing_off, not_designed, run_missing, no_printed_products). */
  reason?: string;
  /** The owner's sentence for it, shown where the button would be (none when there is nothing to offer). */
  message?: string;
}

export interface LeadsSettings {
  retentionMonths: 3 | 6 | 12 | 24;
  mail: 'relay' | 'site';
  removeOnUninstall?: boolean;
}

export interface LeadsQuery {
  status?: LeadStatus | '';
  /** "<source>:<formId>". */
  form?: string;
  search?: string;
  page?: number;
  per_page?: number;
}

/**
 * The answer's body. A route that forwards to the WPMaven account passes the
 * account's own answer through, which wraps its data ({ success: true, data });
 * the site's own routes and an edit's result come plain.
 */
const data = <T>(p: Promise<{ data: T }>): Promise<T> => p.then((a) => {
  const body = a.data as unknown;
  if (body && typeof body === 'object' && (body as { success?: unknown }).success === true && 'data' in (body as object)) {
    return (body as { data: T }).data;
  }
  return a.data;
});

export const storeApi = {
  context: () => data(wpRest.get<StoreAppContext>(`${NS}/store/context`)),

  /** One edit operation (preview or publish); the answer is the operation's result, ok or not. */
  edit: (operation: StoreOperation, opts: EditOptions = {}) => data(wpRest.post<StoreEditResult>(`${NS}/store/edits`, {
    operation,
    mode: opts.mode ?? 'publish',
    ...(opts.previewId ? { previewId: opts.previewId } : {}),
    ...(opts.force ? { force: true } : {}),
    ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
  })),
  /** The changes made to one object: ref "product:31", "post:12", "media:73". */
  history: (ref: string, limit = 20) => data(wpRest.get<EditHistory>(`${NS}/store/edits`, { query: { ref, limit } })),
  undo: (operationId: string, opts: Omit<EditOptions, 'idempotencyKey'> = {}) => data(wpRest.post<StoreEditResult>(
    `${NS}/store/edits/${encodeURIComponent(operationId)}/undo`,
    { mode: opts.mode ?? 'publish', ...(opts.previewId ? { previewId: opts.previewId } : {}), ...(opts.force ? { force: true } : {}) },
  )),

  pricing: (productId: number) => data(wpRest.get<ProductPricing>(`${NS}/store/products/${productId}/pricing`)),
  redesignOffer: () => data(wpRest.get<RedesignOffer>(`${NS}/store/redesign/available`)),
  startRedesign: (productId: number) => data(wpRest.post<{ jobId: string }>(`${NS}/store/products/${productId}/redesign`)),
  redesignJob: (jobId: string) => data(wpRest.get<{ status: 'running' | 'done' | 'failed'; imageUrl?: string }>(`${NS}/store/redesign/${encodeURIComponent(jobId)}`)),
  /** WPMaven Payments ledger rows of these orders (fee, printing, tracking). */
  paymentsOrders: (ids: number[]) => ids.length
    ? data(wpRest.get<{ orders: PaymentsLedgerRow[] }>(`${NS}/store/payments/orders`, { query: { ids } })).then((d) => d?.orders ?? [])
    : Promise.resolve([] as PaymentsLedgerRow[]),

  /** Marks the order shipped with the parcel the owner sent; the customer gets the tracking unless notify is false. */
  markShipped: (orderId: number, parcel: { carrier: string; number: string; url: string; notify: boolean }) =>
    data(wpRest.post<{ status: string; customerEmailed?: 'completed_email' | 'note' | 'none' }>(`${NS}/store/orders/${orderId}/shipment`, parcel)),

  mediaUsage: (ids: number[]) => data(wpRest.get<MediaUsageAnswer>(`${NS}/media/usage`, { query: { ids } })),
  /** Deletes an unused file; a used one is refused (WpRestError code in_use, data.uses). */
  deleteMedia: (id: number) => data(wpRest.del<{ deleted: true }>(`${NS}/media/${id}`)),
  /**
   * Descriptions written by AI from the pictures themselves (at most 10 in
   * all): library files by id, pictures of the site's design by their file.
   */
  suggestAltText: (ids: number[], files: string[] = []) => data(wpRest.post<{ suggestions: Array<{ mediaId?: number; file?: string; alt: string }> }>(
    `${NS}/media/alt-text`, files.length ? { ids, files } : { ids },
  )).then((d) => d?.suggestions ?? []),
  /**
   * The pictures of the site's design without a description (1.5.0). A site
   * WPMaven did not design, or an account that cannot say, answers none.
   */
  designedPictures: () => data(wpRest.get<{ canDescribe: boolean; pictures: DesignedPicture[] }>(`${NS}/media/designed`, { query: { missing: 'true' } }))
    .then((d) => ({ canDescribe: d?.canDescribe === true, pictures: Array.isArray(d?.pictures) ? d.pictures : [] }))
    .catch(() => ({ canDescribe: false, pictures: [] as DesignedPicture[] })),

  leads: (query: LeadsQuery = {}) => data(wpRest.get<LeadsPage>(`${NS}/leads`, { query: query as Record<string, QueryValue> })),
  lead: (id: number) => data(wpRest.get<{ lead: Lead }>(`${NS}/leads/${id}`)).then((d) => d.lead),
  updateLead: (id: number, patch: { status?: LeadStatus; note?: string }) => data(wpRest.post<{ lead: Lead }>(`${NS}/leads/${id}`, patch)).then((d) => d.lead),
  replyLead: (id: number, reply: { subject: string; body: string }) => data(wpRest.post<{ sent: boolean; via: 'relay' | 'site'; lead: Lead }>(`${NS}/leads/${id}/reply`, reply)),
  deleteLead: (id: number) => data(wpRest.del<{ deleted: true }>(`${NS}/leads/${id}`)),
  leadsSettings: () => data(wpRest.get<LeadsSettings>(`${NS}/leads/settings`)),
  saveLeadsSettings: (patch: Partial<LeadsSettings>) => data(wpRest.post<LeadsSettings>(`${NS}/leads/settings`, patch)),
  /** Downloads the CSV export (the browser saves it). */
  exportLeads: async (query: { from?: string; to?: string; status?: LeadStatus | '' } = {}): Promise<void> => {
    const nonce = ((window as any).WEBMAVEN_WP_DATA?.nonce as string) || '';
    const res = await fetch(routeUrl(restRoot(), `${NS}/leads/export`, query), { credentials: 'same-origin', headers: { 'X-WP-Nonce': nonce } });
    if (!res.ok) {
      let body: any = null;
      try { body = await res.json(); } catch { body = null; }
      throw new WpRestError(body?.message || 'The export did not finish. Try again.', res.status, body?.code || `http_${res.status}`);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || 'messages.csv';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

/** The sentence to show for a failed call: the site's or the account's own words, else a plain one. */
export function errorSentence(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (error instanceof WpRestError && error.message && !/^The request failed/.test(error.message)) return error.message;
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' && message.trim() && !/^(HTTP|Request failed|Failed to fetch)/i.test(message) ? message : fallback;
}

/** The first failure of an edit result, in the account's words. */
export function editFailure(result: StoreEditResult | null | undefined): { code: string; message: string } | null {
  if (!result || result.ok) return null;
  return result.failures?.[0] ?? { code: 'ENGINE', message: 'This change did not go through. Try again.' };
}
