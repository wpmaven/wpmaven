/**
 * What the post and product forms and the editor's page card change (2026-10-19):
 * only what the owner changed, in the operation's shape, with the checks a
 * price and an address need. Pure.
 */
import type { PostFields, ProductFields } from '../../types/edits';
import type { ProductSnapshot } from './siteData';

/** "13", "13.5", "13,50" as the decimal WooCommerce takes; null when it is not a price. */
export function normalizePrice(value: string): string | null {
  const v = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  return /^\d{1,9}(\.\d{1,4})?$/.test(v) ? v : null;
}

/** ISO time with its zone, as the API compares it. */
export function asUtc(gmt: string): string | undefined {
  if (!gmt) return undefined;
  return /[zZ]|[+-]\d\d:?\d\d$/.test(gmt) ? gmt : `${gmt}Z`;
}

export interface ProductValues {
  name: string;
  regularPrice: string;
  salePrice: string;
  shortDescription: string;
  stockStatus: 'instock' | 'outofstock' | 'onbackorder';
  /** Published or a draft (the page card changes it; the product form leaves it out). */
  status?: string;
}
export const EMPTY_PRODUCT: ProductValues = { name: '', regularPrice: '', salePrice: '', shortDescription: '', stockStatus: 'instock' };

/** A product's values as the forms show them. */
export function productValuesOf(p: ProductSnapshot | null): ProductValues {
  if (!p) return EMPTY_PRODUCT;
  return { name: p.name, regularPrice: p.regularPrice, salePrice: p.salePrice, shortDescription: p.shortDescription, stockStatus: p.stockStatus };
}

/** Only what the owner changed, in the operation's shape (a variable product's prices go to every option). */
export function productChanges(before: ProductValues, after: ProductValues, variable: boolean): { fields: ProductFields; problems: string[] } {
  const fields: ProductFields = {};
  const problems: string[] = [];
  if (after.name.trim() !== before.name.trim()) {
    if (!after.name.trim()) problems.push('The product needs a name.');
    else fields.name = after.name.trim().slice(0, 200);
  }
  const prices: { regularPrice?: string; salePrice?: string | null } = {};
  if (after.regularPrice.trim() !== before.regularPrice.trim()) {
    const p = normalizePrice(after.regularPrice);
    if (!p) problems.push('A price is written like 14 or 14.50.');
    else prices.regularPrice = p;
  }
  if (after.salePrice.trim() !== before.salePrice.trim()) {
    if (!after.salePrice.trim()) prices.salePrice = null;
    else {
      const p = normalizePrice(after.salePrice);
      if (!p) problems.push('A sale price is written like 12 or 12.50.');
      else prices.salePrice = p;
    }
  }
  const regular = Number(prices.regularPrice ?? normalizePrice(after.regularPrice) ?? NaN);
  if (typeof prices.salePrice === 'string' && Number.isFinite(regular) && Number(prices.salePrice) >= regular) {
    problems.push('The sale price must be lower than the regular price.');
  }
  if (Object.keys(prices).length) {
    if (variable) fields.allVariations = prices;
    else Object.assign(fields, prices);
  }
  if (after.shortDescription.trim() !== before.shortDescription.trim()) fields.shortDescription = after.shortDescription.trim().slice(0, 2000);
  if (after.stockStatus !== before.stockStatus) {
    if (variable) fields.allVariations = { ...(fields.allVariations ?? {}), stockStatus: after.stockStatus === 'outofstock' ? 'outofstock' : 'instock' };
    else fields.stockStatus = after.stockStatus;
  }
  if (after.status !== undefined && after.status !== before.status && (after.status === 'publish' || after.status === 'draft')) fields.status = after.status;
  return { fields, problems };
}

export interface PostValues {
  title: string;
  excerpt: string;
  status: string;
  /** The last part of its address (the page card changes it; the post form leaves it out). */
  slug?: string;
}

/** An address part as WordPress keeps it ("Our Café" is "our-cafe"): lowercase letters, digits and hyphens. */
export function slugOf(text: string): string {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 190)
    .replace(/-+$/, '');
}

/** Only what the owner changed, in the operation's shape (a page's, with noun 'page'). */
export function postChanges(before: PostValues, after: PostValues, noun: 'post' | 'page' = 'post'): { fields: PostFields; problems: string[] } {
  const fields: PostFields = {};
  const problems: string[] = [];
  if (after.title.trim() !== before.title.trim()) {
    if (!after.title.trim()) problems.push(`The ${noun} needs a title.`);
    else fields.title = after.title.trim().slice(0, 200);
  }
  if (after.excerpt.trim() !== before.excerpt.trim()) fields.excerpt = after.excerpt.trim().slice(0, 600);
  if (after.status !== before.status && (after.status === 'publish' || after.status === 'draft')) fields.status = after.status;
  if (after.slug !== undefined && after.slug.trim() !== (before.slug ?? '').trim()) {
    const slug = slugOf(after.slug);
    if (!slug) problems.push(`The ${noun}'s address needs letters or numbers.`);
    else if (slug !== before.slug) fields.slug = slug;
  }
  return { fields, problems };
}

