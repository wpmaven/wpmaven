/**
 * WooCommerce's REST answers (wc/v3) as the Store's shapes. The plugin adds a
 * `wpmaven` field to product and variation answers (kind, photo, floor, card
 * text, price range) and strips its internal meta. Prices are WooCommerce
 * decimal strings normalized to the store's decimals ("18" is "18.00", an
 * empty price is null). Without the field (an older plugin) a product reads
 * as an own product and its photo comes from `images`.
 */

import { decodeHtmlEntities } from '../../../../utils/text';
import { formatStoreMoney, toDecimal } from '../../../../utils/storeMoney';
import type {
  ProductAttributeInput, ProductKind, StoreEditResult, StoreMoneyFormat, StoreProductDetail,
  StoreProductRow, StoreVariation, WpmavenProductInfo,
} from '../../../../types/store';

/** What the grid asks for (wc/v3/products _fields). */
export const PRODUCT_LIST_FIELDS = [
  'id', 'name', 'type', 'status', 'price', 'regular_price', 'sale_price', 'stock_status', 'stock_quantity',
  'manage_stock', 'categories', 'permalink', 'variations', 'date_modified_gmt', 'wpmaven',
].join(',');

/** What the editor reads of each option (wc/v3/products/:id/variations _fields). */
export const VARIATION_FIELDS = [
  'id', 'status', 'regular_price', 'sale_price', 'sku', 'manage_stock', 'stock_quantity', 'stock_status',
  'image', 'attributes', 'wpmaven',
].join(',');

const KINDS: readonly ProductKind[] = ['own', 'sample', 'printed'];
const TYPES: ReadonlyArray<StoreProductRow['type']> = ['simple', 'variable', 'external', 'grouped'];

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? decodeHtmlEntities(v) : '');
const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** A real photo of `images` (id > 0, not WooCommerce's placeholder). */
function realImages(images: unknown): Array<{ id: number; url: string }> {
  if (!Array.isArray(images)) return [];
  return images
    .filter((i) => isObj(i) && Number(i.id) > 0 && typeof i.src === 'string' && i.src && !/woocommerce-placeholder/i.test(i.src))
    .map((i) => ({ id: Number(i.id), url: i.src as string }));
}

function cardSlotsFrom(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [key, value] of Object.entries(v)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/** The plugin's `wpmaven` field, normalized (or what can be read without it). */
export function productInfoFrom(raw: unknown, decimals: number, images?: unknown): WpmavenProductInfo {
  if (!isObj(raw)) {
    const photo = realImages(images)[0] ?? null;
    return { kind: 'own', designKey: null, hasPhoto: !!photo, floor: null, cardSlots: {}, priceRange: null, imageUrl: photo?.url ?? null };
  }
  const hasPhoto = raw.hasPhoto === true;
  const min = isObj(raw.priceRange) ? toDecimal(raw.priceRange.min, decimals) : null;
  const max = isObj(raw.priceRange) ? toDecimal(raw.priceRange.max, decimals) : null;
  return {
    kind: KINDS.includes(raw.kind) ? raw.kind : 'own',
    designKey: typeof raw.designKey === 'string' && raw.designKey ? raw.designKey : null,
    hasPhoto,
    floor: toDecimal(raw.floor ?? null, decimals),
    cardSlots: cardSlotsFrom(raw.cardSlots),
    priceRange: min !== null && max !== null ? { min, max } : null,
    imageUrl: hasPhoto && typeof raw.imageUrl === 'string' && raw.imageUrl ? raw.imageUrl : null,
  };
}

/** One product of wc/v3/products as a row of the grid. */
export function productRowFrom(raw: Record<string, any>, money: StoreMoneyFormat): StoreProductRow {
  const d = money.decimals;
  const info = productInfoFrom(raw.wpmaven, d, raw.images);
  return {
    id: Number(raw.id),
    name: text(raw.name).trim() || 'Untitled product',
    type: TYPES.includes(raw.type) ? raw.type : 'simple',
    status: typeof raw.status === 'string' ? raw.status : 'publish',
    price: toDecimal(raw.price ?? null, d),
    regularPrice: toDecimal(raw.regular_price ?? null, d),
    salePrice: toDecimal(raw.sale_price ?? null, d),
    priceRange: info.priceRange,
    stockStatus: typeof raw.stock_status === 'string' && raw.stock_status ? raw.stock_status : 'instock',
    stockQuantity: int(raw.stock_quantity),
    manageStock: raw.manage_stock === true,
    imageUrl: info.imageUrl,
    categories: Array.isArray(raw.categories)
      ? raw.categories.filter(isObj).map((c) => ({ id: Number(c.id), name: text(c.name) }))
      : [],
    permalink: typeof raw.permalink === 'string' ? raw.permalink : '',
    variations: Array.isArray(raw.variations) ? raw.variations.length : 0,
    modified: typeof raw.date_modified_gmt === 'string' ? raw.date_modified_gmt : '',
    wpmaven: info,
  };
}

/** One option of a variable product (wc/v3/products/:id/variations). */
export function variationFrom(raw: Record<string, any>, money: StoreMoneyFormat): StoreVariation {
  const d = money.decimals;
  const options: Record<string, string> = {};
  for (const a of Array.isArray(raw.attributes) ? raw.attributes : []) {
    if (isObj(a) && typeof a.name === 'string') options[text(a.name)] = text(a.option);
  }
  const w = isObj(raw.wpmaven) ? raw.wpmaven : {};
  const own = isObj(raw.image) && Number(raw.image.id) > 0 && typeof raw.image.src === 'string' ? raw.image : null;
  const label = Object.entries(options).map(([name, value]) => value || `Any ${name.toLowerCase()}`).join(', ');
  return {
    variationId: Number(raw.id),
    label: label || `Option ${raw.id}`,
    options,
    enabled: typeof w.enabled === 'boolean' ? w.enabled : raw.status === undefined || raw.status === 'publish',
    regularPrice: toDecimal(raw.regular_price ?? null, d),
    salePrice: toDecimal(raw.sale_price ?? null, d),
    sku: typeof raw.sku === 'string' ? raw.sku : '',
    manageStock: raw.manage_stock === true,
    stockQuantity: int(raw.stock_quantity),
    stockStatus: typeof raw.stock_status === 'string' && raw.stock_status ? raw.stock_status : 'instock',
    mediaId: own ? Number(own.id) : null,
    imageUrl: w.hasPhoto === true && typeof w.imageUrl === 'string' ? w.imageUrl : own ? own.src : null,
    floor: toDecimal(w.floor ?? null, d),
  };
}

/** One product as the editor reads it (wc/v3/products/:id in the edit context, plus its options). */
export function productDetailFrom(raw: Record<string, any>, variations: Array<Record<string, any>>, money: StoreMoneyFormat, adminUrl: string): StoreProductDetail {
  const row = productRowFrom(raw, money);
  const info = row.wpmaven;
  const real = realImages(raw.images);
  // WooCommerce lists the featured image first, then the gallery; a product
  // without a photo of its own lists only its gallery.
  const featured = info.hasPhoto ? real[0] ?? null : null;
  const gallery = info.hasPhoto ? real.slice(1) : real;
  const attributes: ProductAttributeInput[] = (Array.isArray(raw.attributes) ? raw.attributes : [])
    .filter(isObj)
    .map((a) => ({
      name: text(a.name),
      options: Array.isArray(a.options) ? a.options.map((o: unknown) => text(o)) : [],
      variation: a.variation === true,
      visible: a.visible !== false,
    }));
  const dims = isObj(raw.dimensions) ? raw.dimensions : {};
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    name: row.name === 'Untitled product' && !text(raw.name).trim() ? '' : row.name,
    shortDescription: typeof raw.short_description === 'string' ? raw.short_description : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    sku: typeof raw.sku === 'string' ? raw.sku : '',
    regularPrice: row.regularPrice,
    salePrice: row.salePrice,
    saleSchedule: { from: raw.date_on_sale_from || null, to: raw.date_on_sale_to || null },
    manageStock: row.manageStock,
    stockQuantity: row.stockQuantity,
    stockStatus: row.stockStatus,
    backorders: typeof raw.backorders === 'string' ? raw.backorders : 'no',
    catalogVisibility: typeof raw.catalog_visibility === 'string' ? raw.catalog_visibility : 'visible',
    featured: raw.featured === true,
    virtual: raw.virtual === true,
    weight: typeof raw.weight === 'string' ? raw.weight : '',
    dimensions: { length: String(dims.length ?? ''), width: String(dims.width ?? ''), height: String(dims.height ?? '') },
    categoryIds: row.categories.map((c) => c.id),
    tags: Array.isArray(raw.tags) ? raw.tags.filter(isObj).map((t) => text(t.name)).filter(Boolean) : [],
    featuredMediaId: featured?.id ?? null,
    galleryMediaIds: gallery.map((g) => g.id),
    cardSlots: info.cardSlots,
    purchaseNote: typeof raw.purchase_note === 'string' ? raw.purchase_note : '',
    externalUrl: typeof raw.external_url === 'string' ? raw.external_url : '',
    buttonText: typeof raw.button_text === 'string' ? raw.button_text : '',
    permalink: row.permalink,
    modifiedGmt: row.modified || null,
    printed: info.kind === 'printed',
    sample: info.kind === 'sample',
    variations: variations.filter(isObj).map((v) => variationFrom(v, money)),
    attributes,
    images: { featured, gallery },
    categories: row.categories,
    wpmaven: info,
    editUrl: `${adminUrl}post.php?post=${row.id}&action=edit`,
  };
}

/** The price a card shows: "$18.00", "From $20.00" (a variable product with several prices), or '' when none is set. */
export function rowPriceText(row: Pick<StoreProductRow, 'type' | 'price' | 'priceRange'>, money: StoreMoneyFormat): string {
  if (row.type === 'variable') {
    const r = row.priceRange;
    if (r) return r.min === r.max ? formatStoreMoney(r.min, money) : `From ${formatStoreMoney(r.min, money)}`;
    return row.price ? `From ${formatStoreMoney(row.price, money)}` : '';
  }
  return row.price ? formatStoreMoney(row.price, money) : '';
}

/**
 * A time WooCommerce gives in GMT without a zone ("2026-10-04T09:12:00") as
 * explicit UTC, so the account and the site read the same instant: the
 * baseModified of a change.
 */
export function asUtc(gmt: string | null | undefined): string | undefined {
  if (!gmt) return undefined;
  return /([zZ]|[+-]\d{2}:?\d{2})$/.test(gmt) ? gmt : `${gmt}Z`;
}

/** The product an add_product created ("product:57" in what it changed). */
export function productIdFromResult(result: StoreEditResult | null | undefined): number | null {
  for (const c of result?.changed ?? []) {
    const m = /^product:(\d+)$/.exec(c.ref || '');
    if (m) return Number(m[1]);
  }
  return null;
}
