/**
 * The Store, Blog, Media and Messages shapes: a copy of the api's
 * src/types/storeFields.ts (what edit operations take) and
 * src/types/storeRead.ts (what the screens read). The dashboard keeps the
 * same copy (src/types/store.ts). A field is added in the api first, never
 * renamed.
 */

/** A WooCommerce decimal string in the store currency, with the store's decimals: "18.00", "1500". */
export type Decimal = string;

export interface ProductFields {
  /** Refused with CHANGED_ELSEWHERE when the product changed after this time (date_modified_gmt the form read). */
  baseModified?: string;
  /** Plain text, 1 to 200 characters. */
  name?: string;
  /** Limited HTML (wp_kses_post on the site), at most 2,000 characters. */
  shortDescription?: string;
  /** Limited HTML, at most 30,000 characters. */
  description?: string;
  status?: 'publish' | 'draft' | 'private';
  catalogVisibility?: 'visible' | 'catalog' | 'search' | 'hidden';
  featured?: boolean;
  /** Unique in the store; '' clears it. */
  sku?: string;
  /** product_cat ids, replaces the set. */
  categoryIds?: number[];
  /** Created, then added to the set. */
  newCategories?: string[];
  /** product_tag names, replaces the set. */
  tags?: string[];
  // Price and stock of a simple or external product; a variable product takes them per variation.
  regularPrice?: Decimal;
  /** null ends the sale. */
  salePrice?: Decimal | null;
  /** ISO dates, site time zone. */
  saleSchedule?: { from: string | null; to: string | null };
  manageStock?: boolean;
  stockQuantity?: number | null;
  stockStatus?: 'instock' | 'outofstock' | 'onbackorder';
  backorders?: 'no' | 'notify' | 'yes';
  /** Every variation at once: the quick edit and chat on a variable product. */
  allVariations?: { regularPrice?: Decimal; salePrice?: Decimal | null; stockStatus?: 'instock' | 'outofstock' };
  variations?: VariationPatch[];
  /** Own products only. A simple product given a variation attribute becomes a variable one. */
  attributes?: ProductAttributeInput[];
  /** Own products only. */
  newVariations?: NewVariation[];
  /** Own products only. */
  virtual?: boolean;
  /** Own products only, in the store's weight unit. */
  weight?: string;
  dimensions?: { length?: string; width?: string; height?: string };
  /** Media library ids: the file is uploaded first (WordPress), then pointed at. */
  featuredMediaId?: number | null;
  /** Ordered, replaces the gallery. */
  galleryMediaIds?: number[];
  /** The designed card's own text (_wm_card_slot_<key>); only keys the product already has. */
  cardSlots?: Record<string, string>;
  purchaseNote?: string;
  /** External products. */
  externalUrl?: string;
  /** External products. */
  buttonText?: string;
  /** The owner made a sample listing real: the sample marker goes. */
  sample?: false;
}

export interface VariationPatch {
  variationId: number;
  /** false hides that color or size from the shop. */
  enabled?: boolean;
  regularPrice?: Decimal;
  salePrice?: Decimal | null;
  sku?: string;
  manageStock?: boolean;
  stockQuantity?: number | null;
  stockStatus?: 'instock' | 'outofstock' | 'onbackorder';
  /** The variation's image. */
  mediaId?: number | null;
  /** Own products only. */
  remove?: true;
}

export interface ProductAttributeInput {
  /** "Size". */
  name: string;
  /** 1 to 50 values. */
  options: string[];
  /** Used for variations. */
  variation: boolean;
  /** Listed under "Additional information". */
  visible?: boolean;
}

export interface NewVariation {
  /** Attribute name to value, one per variation attribute. */
  options: Record<string, string>;
  regularPrice: Decimal;
  salePrice?: Decimal | null;
  stockStatus?: 'instock' | 'outofstock' | 'onbackorder';
  mediaId?: number | null;
}

/** The SEO field group of a post or page (written by the plugin's SEO service). */
export interface SeoFields {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  /** A media library id or an https URL. */
  ogImage?: number | string | null;
  noindex?: boolean;
}

export interface PostFields {
  /** As in ProductFields. */
  baseModified?: string;
  /** Plain text, 1 to 200 characters. */
  title?: string;
  /** Plain text, at most 600 characters. */
  excerpt?: string;
  status?: 'publish' | 'draft' | 'pending' | 'private' | 'future';
  /** ISO 8601, required with 'future'. */
  date?: string;
  slug?: string;
  featuredMediaId?: number | null;
  categoryIds?: number[];
  /** Categories by name: the existing one of that name, or a new one, added to the set. */
  newCategories?: string[];
  tags?: string[];
  /** The editor's path; refused on a page the design owns (edit_section there). baseHash: sha256 of the content the edit started from. */
  content?: { html: string; baseHash: string };
  seo?: SeoFields;
}

export type ImageTarget =
  /** This file wherever it is used. */
  | { kind: 'media'; mediaId: number }
  | { kind: 'product'; productId: number; slot: 'featured' }
  | { kind: 'product'; productId: number; slot: 'gallery'; mediaId: number }
  | { kind: 'variation'; productId: number; variationId: number }
  | { kind: 'post'; postId: number; slot: 'featured' }
  /** A designed image (data-wm-section, data-slot). */
  | { kind: 'section'; page: string; sectionId: string; imageSlot: string }
  | { kind: 'site'; slot: 'logo' | 'icon' };

export type MenuLink =
  | { kind: 'page'; pageId: number }
  | { kind: 'post'; postId: number }
  | { kind: 'product'; productId: number }
  | { kind: 'term'; taxonomy: 'category' | 'product_cat'; termId: number }
  | { kind: 'shop' }
  /** https, http, mailto or tel. */
  | { kind: 'url'; url: string };

export interface MenuItemInput {
  /** An existing menu item to keep; existing items left out are removed. */
  id?: number;
  /** 1 to 60 characters. */
  label: string;
  link: MenuLink;
  newTab?: boolean;
  /** One level deep. */
  children?: MenuItemInput[];
}

/** The limits the validators and the plugin share. */
export const STORE_FIELD_LIMITS = {
  productName: 200,
  shortDescription: 2_000,
  description: 30_000,
  postTitle: 200,
  postExcerpt: 600,
  menuLabel: 60,
  menuItems: 30,
  attributeOptions: 50,
  seoTitle: 120,
  seoDescription: 320,
} as const;

/** How the store prints money (WooCommerce's settings, the wc_price rules). */
export interface StoreMoneyFormat {
  /** ISO 4217 code: "USD". */
  code: string;
  /** The symbol, HTML entities decoded: "$", "€". */
  symbol: string;
  position: 'left' | 'right' | 'left_space' | 'right_space';
  decimals: number;
  thousandSep: string;
  decimalSep: string;
}

/** own: the owner makes and ships it; sample: an own product still marked as a sample listing; printed: WPMaven prints it on order. */
export type ProductKind = 'own' | 'sample' | 'printed';

/** The `wpmaven` field the plugin adds to WooCommerce REST product answers (and the lists' rows). */
export interface WpmavenProductInfo {
  kind: ProductKind;
  /** The design key (_wm_product_slug): the product's slug in the site plan; null for a product WPMaven did not design. */
  designKey: string | null;
  /** False when the product shows WooCommerce's placeholder (no image, or the placeholder's own id). */
  hasPhoto: boolean;
  /** Printed products: the lowest price allowed (the lowest floor of its options), in the store currency. */
  floor: Decimal | null;
  /** The designed card's text (_wm_card_slot_<key>), since the meta itself is stripped from REST answers. */
  cardSlots: Record<string, string>;
  /** Variable products: the lowest and highest option price. */
  priceRange: { min: Decimal; max: Decimal } | null;
  /** The product photo (medium size when there is one), never the placeholder. */
  imageUrl: string | null;
}

/** The `wpmaven` field the plugin adds to WooCommerce REST variation answers. */
export interface WpmavenVariationInfo {
  kind: ProductKind;
  /** This option's lowest allowed price (printed products). */
  floor: Decimal | null;
  hasPhoto: boolean;
  imageUrl: string | null;
}

/** One product of a list (the plugin's grid and the dashboard's). */
export interface StoreProductRow {
  id: number;
  name: string;
  type: 'simple' | 'variable' | 'external' | 'grouped';
  /** publish, draft, pending, private. */
  status: string;
  /** The price a shopper pays now (the lowest option's for a variable product). */
  price: Decimal | null;
  regularPrice: Decimal | null;
  salePrice: Decimal | null;
  priceRange: { min: Decimal; max: Decimal } | null;
  stockStatus: string;
  stockQuantity: number | null;
  manageStock: boolean;
  /** null when the product has no photo (never the placeholder). */
  imageUrl: string | null;
  categories: Array<{ id: number; name: string }>;
  permalink: string;
  /** How many options a variable product has (0 for the others). */
  variations: number;
  /** date_modified_gmt as ISO 8601 UTC ("2026-10-05T10:42:00"): the baseModified of the next change. */
  modified: string;
  wpmaven: WpmavenProductInfo;
}

/** One option of a variable product, as the product editor reads it. */
export interface StoreVariation {
  variationId: number;
  /** "Black, 11 oz". */
  label: string;
  /** Attribute name to value: { Color: "Black", Size: "11 oz" }. */
  options: Record<string, string>;
  /** false hides that option from the shop. */
  enabled: boolean;
  regularPrice: Decimal | null;
  salePrice: Decimal | null;
  sku: string;
  manageStock: boolean;
  stockQuantity: number | null;
  stockStatus: string;
  mediaId: number | null;
  imageUrl: string | null;
  floor: Decimal | null;
}

/**
 * One product as the product editor reads it (store_product_read, the
 * dashboard's product route). The ProductFields-shaped part is what an
 * update_product changes; the rest is for display.
 */
export interface StoreProductDetail {
  id: number;
  type: 'simple' | 'variable' | 'external' | 'grouped';
  status: string;
  name: string;
  shortDescription: string;
  description: string;
  sku: string;
  regularPrice: Decimal | null;
  salePrice: Decimal | null;
  saleSchedule: { from: string | null; to: string | null };
  manageStock: boolean;
  stockQuantity: number | null;
  stockStatus: string;
  backorders: string;
  catalogVisibility: string;
  featured: boolean;
  virtual: boolean;
  weight: string;
  dimensions: { length: string; width: string; height: string };
  categoryIds: number[];
  tags: string[];
  featuredMediaId: number | null;
  galleryMediaIds: number[];
  cardSlots: Record<string, string>;
  purchaseNote: string;
  externalUrl: string;
  buttonText: string;
  permalink: string;
  /** ISO 8601 UTC: send it back as baseModified. */
  modifiedGmt: string | null;
  printed: boolean;
  sample: boolean;
  variations: StoreVariation[];
  attributes: ProductAttributeInput[];
  images: { featured: { id: number; url: string } | null; gallery: Array<{ id: number; url: string }> };
  categories: Array<{ id: number; name: string }>;
  wpmaven: WpmavenProductInfo;
  /** WooCommerce's own product screen. */
  editUrl: string;
}

/** A product category of the store (filters and the editor). */
export interface StoreCategory {
  id: number;
  name: string;
  parent: number;
  count: number;
}

/** The floor and the earnings of each option of a printed product (GET .../pricing). */
export interface ProductPricing {
  currency: string;
  variations: Array<{ variationId: number | null; label: string; floor: Decimal; price: Decimal | null; earnings: Decimal | null }>;
}

// ── Orders ──────────────────────────────────────────────────────────────────

/** The `wpmaven` field the plugin adds to WooCommerce REST order answers (and the lists' rows). */
export interface WpmavenOrderInfo {
  /** Paid, or to be paid, through WPMaven Payments. */
  paymentsWpmaven: boolean;
  /** At least one line is a printed product. */
  printed: boolean;
  /** The printed order's shipping (_wm_tracking), when it has shipped. */
  tracking: { url: string | null; number: string | null; carrier: string | null } | null;
  /** The statuses the Store offers for this order (payment and printing allowing), WooCommerce's names without "wc-". */
  allowedStatuses: string[];
  /** Processing or on hold: the order waits for the owner. */
  needsAction: boolean;
  /** Parcels the owner sent themselves, oldest first (plugin 1.4.0 and later; never the printed parcels). */
  shipments?: OwnShipment[];
}

/** A parcel the owner sent: the carrier, the tracking number, its link, when it was recorded. */
export interface OwnShipment {
  carrier: string;
  number: string;
  url: string;
  at: string;
}

/** One order of a list. */
export interface StoreOrderRow {
  id: number;
  /** The number customers see ("1042"). */
  number: string;
  /** WooCommerce's status without "wc-": pending, processing, on-hold, completed, cancelled, refunded, failed. */
  status: string;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** The order's own currency. */
  currency: string;
  currencySymbol: string;
  total: Decimal;
  itemCount: number;
  /** The billing name, else the company, else "Guest". */
  customerName: string;
  paymentMethodTitle: string;
  wpmaven: WpmavenOrderInfo;
}

export interface StoreAddress {
  name: string;
  company: string;
  /** Street, city and postcode lines, as WooCommerce formats them. */
  lines: string[];
  country: string;
}

export interface StoreOrderItem {
  id: number;
  productId: number;
  variationId: number | null;
  name: string;
  quantity: number;
  /** The line total after discounts, in the order currency. */
  total: Decimal;
  options: Array<{ label: string; value: string }>;
  imageUrl: string | null;
  printed: boolean;
  /** An own product with managed stock: "Put items back in stock" applies. */
  restockable: boolean;
}

/** One order as the order screen reads it. */
export interface StoreOrderDetail extends StoreOrderRow {
  /** The gateway id ("wpmaven_payments", "cheque"). */
  paymentMethod: string;
  customer: {
    name: string;
    email: string;
    phone: string;
    billing: StoreAddress | null;
    shipping: StoreAddress | null;
    /** What the customer wrote at checkout. */
    note: string;
  };
  items: StoreOrderItem[];
  totals: { subtotal: Decimal; shipping: Decimal; tax: Decimal; discount: Decimal; refunded: Decimal; total: Decimal };
  notes: Array<{ id: number; at: string; text: string; customer: boolean; author: string }>;
  refunds: Array<{ id: number; at: string; amount: Decimal; reason: string }>;
  /** What is left to refund. */
  refundable: Decimal;
  /** The gateway refunds through its own plugin; otherwise a refund is only recorded (the money goes back by hand). */
  gatewayRefunds: boolean;
  /** WooCommerce's own order screen. */
  editUrl: string;
}

/** A WPMaven Payments ledger row (GET /instances/:instanceId/payments/wpmaven/orders), joined to an order by its id. */
export interface PaymentsLedgerRow {
  orderId: number;
  orderNumber: string | null;
  amountCents: number;
  currency: string;
  applicationFeeCents: number;
  /** What Stripe keeps if the owner refunds; null on a linked account. */
  stripeFeeCents: number | null;
  refundedCents: number;
  status: string;
  fulfillment: string;
  trackingUrl: string | null;
  createdAt: string;
}

// ── Posts ───────────────────────────────────────────────────────────────────

/** One blog post of a list. */
export interface StorePostRow {
  id: number;
  /** The raw title (no HTML entities). */
  title: string;
  /** The raw excerpt, plain text. */
  excerpt: string;
  /** publish, draft, pending, private, future. */
  status: string;
  /** ISO 8601, the site's time. */
  date: string;
  /** ISO 8601 UTC: send it back as baseModified. */
  modifiedGmt: string | null;
  slug: string;
  link: string;
  featuredMediaId: number | null;
  imageUrl: string | null;
  categories: Array<{ id: number; name: string }>;
  tags: string[];
  /** The design owns its content (a WPMaven-designed page): content changes go through the editor. */
  designOwned: boolean;
}

// ── Media ───────────────────────────────────────────────────────────────────

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'other';

/** One file of the media library. */
export interface StoreMediaRow {
  id: number;
  title: string;
  filename: string;
  url: string;
  /** A small size for grids (medium, else thumbnail), else null. */
  thumbUrl: string | null;
  mime: string;
  kind: MediaKind;
  width: number | null;
  height: number | null;
  bytes: number | null;
  alt: string;
  caption: string;
  /** ISO 8601 UTC. */
  date: string;
  /** How many places use it; null when not counted. */
  uses: number | null;
}

/**
 * A picture of the site's design (its pages' sections, its header and
 * footer), as GET /media/designed lists it: where the site shows it, and its
 * library file when the design shows one (the description is written there
 * too).
 */
export interface DesignedPicture {
  file: string;
  /** Where it is: "Homepage, Our story section", "Footer". */
  name: string;
  places: string[];
  alt: string;
  missing: boolean;
  mediaId: number | null;
  url: string | null;
}

/** One place a file is used (WebMaven_Media_Usage). */
export interface MediaUse {
  kind: 'page' | 'post' | 'product' | 'variation' | 'blog-cards' | 'logo' | 'icon' | 'placeholder' | 'fact';
  id: number | null;
  title: string;
  how: 'content' | 'featured' | 'gallery' | 'setting';
  /** A page the design owns: changed through the editor or replace_image. */
  designed: boolean;
  /** A path in wp-admin that edits this use ("post.php?post=12&action=edit"), or null. */
  editPath: string | null;
}

export interface MediaUsageAnswer {
  /** By media id. */
  uses: Record<string, MediaUse[]>;
  /** The scan stopped at its limit (2,000 posts): the counts are "at least". */
  partial: boolean;
}

// ── Messages (form submissions kept on the site) ─────────────────────────────

export type LeadStatus = 'new' | 'answered' | 'archived' | 'spam';
export type LeadSource = 'wpforms' | 'cf7' | 'gravityforms';

export interface LeadEvent {
  at: string;
  kind: 'reply' | 'status' | 'note' | 'export';
  /** The WordPress user's display name, or "WPMaven" for the dashboard. */
  by: string;
  summary: string;
}

/** One message, as the inbox's detail shows it. Visitor text is plain text: never render it as HTML. */
export interface Lead {
  id: number;
  createdAt: string;
  source: LeadSource;
  formTitle: string;
  /** contact, quote, booking, feedback, newsletter, order, or ''. */
  intent: string;
  pageUrl: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  fields: Array<{ label: string; value: string }>;
  /** Agreed to get the business's emails. */
  consent: boolean;
  status: LeadStatus;
  seenAt: string | null;
  answeredAt: string | null;
  note: string | null;
  events: LeadEvent[];
}

/** One message of the inbox's list. */
export interface LeadRow {
  id: number;
  createdAt: string;
  source: LeadSource;
  formTitle: string;
  intent: string;
  name: string;
  email: string;
  phone: string;
  /** The first line of the message, at most 140 characters. */
  firstLine: string;
  status: LeadStatus;
  seen: boolean;
  consent: boolean;
}

export interface LeadsPage {
  items: LeadRow[];
  total: number;
  totalPages: number;
  counts: Record<LeadStatus, number>;
  forms: Array<{ source: LeadSource; formId: number; title: string }>;
}

// ── Context ─────────────────────────────────────────────────────────────────

/** What the Store screens need to know about the site (store_context, GET .../store/context). */
export interface StoreContext {
  woocommerce: { active: boolean; version: string | null };
  /** null without WooCommerce. */
  money: StoreMoneyFormat | null;
  /** WooCommerce's weight and size units ("kg", "cm"); null without WooCommerce. */
  units: { weight: string; dimension: string } | null;
  /** The WPMaven Payments gateway is on. */
  paymentsWpmaven: boolean;
  counts: {
    products: number;
    printed: number;
    samples: number;
    withoutPhoto: number;
    /** Processing and on-hold orders. */
    ordersToShip: number;
    newMessages: number;
    imagesWithoutAlt: number;
    posts: number;
  };
  uploads: { maxBytes: number };
  /** How a reply to a message leaves the site: WPMaven's mail relay (hosted sites) or the site's own mail. */
  mail: 'relay' | 'site';
}

/** What the signed-in WordPress user may do in the plugin's screens (WordPress capabilities). */
export interface StoreCaps {
  products: boolean;
  orders: boolean;
  orderChanges: boolean;
  refunds: boolean;
  posts: boolean;
  media: boolean;
  messages: boolean;
  messagesSettings: boolean;
  /** May spend AI time (descriptions written by AI, AI photos, New design). */
  spend: boolean;
}

/** The plugin's GET webmaven_wp/v1/store/context: the store's context for the signed-in user. */
export interface StoreAppContext extends StoreContext {
  caps: StoreCaps;
  /** Changes go through the account: available when this site is linked and allowed to make them. */
  writes: { available: boolean; reason: 'not_connected' | 'not_allowed' | null };
  instanceId: string | null;
  adminUrl: string;
}

/** A list page of any of the shapes above. */
export interface ListPage<T> {
  items: T[];
  total: number;
  totalPages: number;
}

// ── The plugin app's own ─────────────────────────────────────────────────────

/** The part of an edit operation's result the screens show (the api's EditResult). */
export interface StoreEditResult {
  ok: boolean;
  operationId: string;
  mode: 'preview' | 'publish';
  /** queued, previewing, previewed, publishing, published, failed, undone, discarded, expired. */
  status: string;
  /** The operation: update_product, add_post, undo... */
  kind: string;
  /** Owner-facing, built from what changed. */
  summary: string;
  changed: Array<{ kind: string; ref: string; label: string; before?: string; after?: string }>;
  checks?: Array<{ kind: string; severity: 'info' | 'warn' | 'broken'; message: string }>;
  failures: Array<{ code: string; message: string }>;
  undoable: boolean;
  undo?: { alsoUndoes: Array<{ operationId: string; summary: string }> };
  previewId?: string;
  createdAt: string;
  publishedAt?: string;
  source: string;
}

/** The edit operations the Store, Blog and Media screens send (the api validates them). */
export type StoreOperation =
  | { op: 'update_product'; productId: number; fields: ProductFields }
  | { op: 'add_product'; fields: ProductFields & { name: string; type: 'simple' | 'variable' | 'external' } }
  | { op: 'remove_product'; productId: number }
  | { op: 'update_post'; postId: number; fields: PostFields }
  | { op: 'add_post'; fields: PostFields & { title: string } }
  | { op: 'remove_post'; postId: number }
  | { op: 'replace_image'; target: ImageTarget; instruction?: string; mediaId?: number; alt?: string }
  /** Descriptions of pictures, one change with one undo (1.5.0): library files (mediaId) and pictures of the site's design (file). */
  | { op: 'describe_images'; items?: Array<{ mediaId?: number; file?: string; alt: string }>; write?: { mediaIds?: number[]; missing?: boolean } };

/** WEBMAVEN_WP_DATA.storeApp: what the page was drawn with (the plugin's inline script data). */
export interface StoreAppData {
  caps: StoreCaps;
  wooActive: boolean;
  money: StoreMoneyFormat | null;
  paymentsWpmaven: boolean;
  /** rest_url(): the REST root ("https://site/wp-json/" or "https://site/?rest_route=/"). */
  wpRestRoot: string;
  uploads: { maxBytes: number };
  units: { weight: string; dimension: string } | null;
  mail: 'relay' | 'site';
}
