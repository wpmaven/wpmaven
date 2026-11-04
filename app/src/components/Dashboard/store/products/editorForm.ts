/**
 * The product editor's form: what it shows of a product, and the fields an
 * update_product sends, only what the owner changed.
 */

import { compareDecimal, moneyInputText, parseStoreMoney } from '../../../../utils/storeMoney';
import { STORE_FIELD_LIMITS } from '../../../../types/store';
import type {
  Decimal, NewVariation, ProductAttributeInput, ProductFields, StoreMoneyFormat, StoreProductDetail, VariationPatch,
} from '../../../../types/store';
import { cleanDescription } from './RichText';

export interface VariationForm {
  enabled: boolean;
  regular: string;
  sale: string;
  stockStatus: string;
  remove: boolean;
}

export interface AttributeForm {
  name: string;
  /** "Black, Yellow". */
  options: string;
  variation: boolean;
  visible: boolean;
}

export interface NewVariationForm {
  key: string;
  options: Record<string, string>;
  regular: string;
}

export interface EditorForm {
  name: string;
  status: string;
  /** null until the owner edits it (an untouched description is never sent). */
  shortDescription: string | null;
  description: string | null;
  regular: string;
  sale: string;
  sku: string;
  manageStock: boolean;
  qty: string;
  stockStatus: string;
  featured: { id: number; url: string } | null;
  gallery: Array<{ id: number; url: string }>;
  variations: Record<number, VariationForm>;
  attributes: AttributeForm[];
  newVariations: NewVariationForm[];
  cardSlots: Record<string, string>;
  categoryIds: number[];
  newCategories: string[];
  tags: string;
}

export function editorFormOf(d: StoreProductDetail, money: StoreMoneyFormat): EditorForm {
  const variations: Record<number, VariationForm> = {};
  for (const v of d.variations) {
    variations[v.variationId] = {
      enabled: v.enabled,
      regular: moneyInputText(v.regularPrice, money),
      sale: moneyInputText(v.salePrice, money),
      stockStatus: v.stockStatus,
      remove: false,
    };
  }
  return {
    name: d.name,
    status: d.status,
    shortDescription: null,
    description: null,
    regular: moneyInputText(d.regularPrice, money),
    sale: moneyInputText(d.salePrice, money),
    sku: d.sku,
    manageStock: d.manageStock,
    qty: d.stockQuantity === null ? '' : String(d.stockQuantity),
    stockStatus: d.stockStatus,
    featured: d.images.featured,
    gallery: d.images.gallery,
    variations,
    attributes: d.attributes.map((a) => ({ name: a.name, options: a.options.join(', '), variation: a.variation, visible: a.visible !== false })),
    newVariations: [],
    cardSlots: { ...d.cardSlots },
    categoryIds: [...d.categoryIds],
    newCategories: [],
    tags: d.tags.join(', '),
  };
}

const list = (text: string): string[] => text.split(',').map((s) => s.trim()).filter(Boolean);
const sameList = (a: Array<string | number>, b: Array<string | number>) => a.length === b.length && a.every((x, i) => x === b[i]);
const lower = (s: string) => s.trim().toLowerCase();
/** A value as WordPress makes a slug of it, roughly: what the site also matches a stored value by. */
const slug = (s: string) => lower(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const sameValue = (a: string, b: string) => lower(a) === lower(b) || (slug(a) !== '' && slug(a) === slug(b));
/** One choice's values as a key, whatever the order of its options. */
const comboKey = (options: Record<string, string>) => Object.entries(options)
  .map(([name, value]) => `${lower(name)}=${lower(value)}`).sort().join('|');

/** The most options a product takes, and the longest name or value of one. */
const MAX_OPTIONS = 10;
const MAX_OPTION_TEXT = 100;

function attributesOf(form: AttributeForm[]): ProductAttributeInput[] {
  return form.map((a) => ({ name: a.name.trim(), options: list(a.options), variation: a.variation, visible: a.visible }));
}

/**
 * The fields of an update_product from the form (baseModified is added when
 * it is sent), and the sentences that stop the save.
 */
export function editorFields(d: StoreProductDetail, initial: EditorForm, form: EditorForm, money: StoreMoneyFormat): { fields: ProductFields; errors: string[] } {
  const fields: ProductFields = {};
  const errors: string[] = [];
  const example = moneyInputText('18.50', money);
  const price = (text: string, what: string): Decimal | null | undefined => {
    if (!text.trim()) return null;
    const d = parseStoreMoney(text, money);
    if (d === null) errors.push(`Enter ${what} like ${example}.`);
    return d ?? undefined;
  };

  const name = form.name.trim();
  if (name !== initial.name.trim()) {
    if (!name) errors.push('Give the product a name.');
    else if (name.length > STORE_FIELD_LIMITS.productName) errors.push(`The name is too long (${STORE_FIELD_LIMITS.productName} characters at most).`);
    else fields.name = name;
  }
  if (form.status !== initial.status && ['publish', 'draft', 'private'].includes(form.status)) {
    fields.status = form.status as ProductFields['status'];
  }
  if (form.shortDescription !== null) {
    const html = cleanDescription(form.shortDescription);
    if (html !== cleanDescription(d.shortDescription)) {
      if (html.length > STORE_FIELD_LIMITS.shortDescription) errors.push('The short description is too long (2,000 characters at most).');
      else fields.shortDescription = html;
    }
  }
  if (form.description !== null) {
    const html = cleanDescription(form.description);
    if (html !== cleanDescription(d.description)) {
      if (html.length > STORE_FIELD_LIMITS.description) errors.push('The description is too long (30,000 characters at most).');
      else fields.description = html;
    }
  }

  if (d.type !== 'variable' && d.type !== 'grouped') {
    let regular: Decimal | null | undefined;
    let sale: Decimal | null | undefined;
    if (form.regular !== initial.regular) {
      regular = price(form.regular, 'a price');
      if (regular === null) {
        if (initial.regular) errors.push('Enter a price.');
        regular = undefined;
      } else if (regular !== undefined && regular !== parseStoreMoney(initial.regular, money)) {
        fields.regularPrice = regular;
      }
    }
    if (form.sale !== initial.sale) {
      sale = price(form.sale, 'a sale price');
      if (sale === null) {
        if (initial.sale) fields.salePrice = null;
      } else if (sale !== undefined && sale !== parseStoreMoney(initial.sale, money)) {
        fields.salePrice = sale;
      }
    }
    const nowRegular = parseStoreMoney(form.regular, money);
    const nowSale = parseStoreMoney(form.sale, money);
    if ((fields.regularPrice || fields.salePrice) && nowSale && nowRegular && compareDecimal(nowSale, nowRegular) >= 0) {
      errors.push('The sale price must be lower than the price.');
    }
    if (form.sku.trim() !== initial.sku.trim()) fields.sku = form.sku.trim();
    if (!d.printed) {
      if (form.manageStock !== initial.manageStock) fields.manageStock = form.manageStock;
      if (form.manageStock) {
        if (form.qty !== initial.qty || form.manageStock !== initial.manageStock) {
          if (!/^\d{1,9}$/.test(form.qty.trim())) errors.push('Enter how many are in stock as a whole number, 0 or more.');
          else fields.stockQuantity = Number(form.qty.trim());
        }
      } else if (form.stockStatus !== initial.stockStatus) {
        fields.stockStatus = form.stockStatus as ProductFields['stockStatus'];
      }
    }
  }

  if (d.type === 'variable') {
    const patches: VariationPatch[] = [];
    for (const v of d.variations) {
      const was = initial.variations[v.variationId];
      const now = form.variations[v.variationId];
      if (!was || !now) continue;
      if (now.remove && !d.printed) {
        patches.push({ variationId: v.variationId, remove: true });
        continue;
      }
      const patch: VariationPatch = { variationId: v.variationId };
      if (now.enabled !== was.enabled) patch.enabled = now.enabled;
      if (now.regular !== was.regular) {
        const r = price(now.regular, `the price of ${v.label}`);
        if (r === null) errors.push(`Enter the price of ${v.label}.`);
        else if (r !== undefined && r !== parseStoreMoney(was.regular, money)) patch.regularPrice = r;
      }
      if (now.sale !== was.sale) {
        const s = price(now.sale, `the sale price of ${v.label}`);
        if (s === null) {
          if (was.sale) patch.salePrice = null;
        } else if (s !== undefined && s !== parseStoreMoney(was.sale, money)) {
          patch.salePrice = s;
        }
      }
      const r = parseStoreMoney(now.regular, money);
      const s = parseStoreMoney(now.sale, money);
      if ((patch.regularPrice || patch.salePrice) && r && s && compareDecimal(s, r) >= 0) {
        errors.push(`The sale price of ${v.label} must be lower than its price.`);
      }
      if (!d.printed && now.stockStatus !== was.stockStatus) patch.stockStatus = now.stockStatus as VariationPatch['stockStatus'];
      if (Object.keys(patch).length > 1) patches.push(patch);
    }
    if (patches.length) fields.variations = patches;
    // A product that keeps its options keeps one on sale (an own product may drop them all to sell as one item).
    const shown = d.variations.filter((v) => {
      const now = form.variations[v.variationId];
      return now ? now.enabled && !now.remove : v.enabled;
    });
    const keepsOptions = d.printed || attributesOf(form.attributes).some((a) => a.variation && a.name);
    if (d.variations.length && keepsOptions && !shown.length && !form.newVariations.length) {
      errors.push(d.printed ? 'Keep at least one color or size shown.' : 'Keep at least one option shown.');
    }
  }

  if (!d.printed) {
    const before = attributesOf(initial.attributes);
    const after = attributesOf(form.attributes);
    const attributesChanged = JSON.stringify(before) !== JSON.stringify(after);
    if (attributesChanged) {
      if (after.length > MAX_OPTIONS) errors.push(`A product takes at most ${MAX_OPTIONS} options.`);
      const names = new Set<string>();
      for (const a of after) {
        if (!a.name) errors.push('Give every option a name, like Size.');
        else if (a.name.length > MAX_OPTION_TEXT) errors.push(`The option name ${a.name.slice(0, 30)} is too long (${MAX_OPTION_TEXT} characters at most).`);
        else if (names.has(lower(a.name))) errors.push(`Two options are named "${a.name}".`);
        else if (!a.options.length) errors.push(`Give ${a.name} at least one value.`);
        else if (a.options.length > STORE_FIELD_LIMITS.attributeOptions) errors.push(`${a.name} has more than ${STORE_FIELD_LIMITS.attributeOptions} values.`);
        else if (a.options.some((o) => o.includes('|'))) errors.push(`A value of ${a.name} cannot hold "|".`);
        else if (a.options.some((o) => o.length > MAX_OPTION_TEXT)) errors.push(`A value of ${a.name} is too long (${MAX_OPTION_TEXT} characters at most).`);
        names.add(lower(a.name));
      }
      fields.attributes = after;
    }
    // What the change leaves: the options customers choose, the variations kept.
    const choosing = (attributesChanged ? after : before).filter((a) => a.variation && a.name);
    const kept = d.variations.filter((v) => !form.variations[v.variationId]?.remove);
    if (attributesChanged && d.type === 'variable') {
      if (!choosing.length) {
        if (kept.length) errors.push('Remove every variation in the same change, or keep an option customers choose.');
      } else {
        for (const v of kept) {
          const orphan = Object.entries(v.options).some(([name, value]) => {
            if (!value) return false;
            const a = choosing.find((x) => lower(x.name) === lower(name));
            return !a || !a.options.some((o) => sameValue(o, value));
          });
          if (orphan) errors.push(`"${v.label}" uses an option value this change takes away. Remove that variation in the same change, or keep its value.`);
        }
      }
    }
    if (attributesChanged && d.type === 'simple' && choosing.length && !form.newVariations.length) {
      errors.push('Add at least one choice customers can buy, with its price, in the same change.');
    }
    const combos = new Set(kept.map((v) => comboKey(v.options)));
    const added: NewVariation[] = [];
    for (const n of form.newVariations) {
      const label = Object.values(n.options).join(', ') || 'the new option';
      const key = comboKey(n.options);
      if (combos.has(key)) errors.push(`${label} is already a choice of this product.`);
      combos.add(key);
      const r = price(n.regular, `the price of ${label}`);
      if (r === null) errors.push(`Enter the price of ${label}.`);
      else if (r !== undefined) added.push({ options: n.options, regularPrice: r });
    }
    if (added.length) fields.newVariations = added;
  }

  if ((form.featured?.id ?? null) !== (initial.featured?.id ?? null)) fields.featuredMediaId = form.featured?.id ?? null;
  const gallery = form.gallery.map((g) => g.id);
  if (!sameList(gallery, initial.gallery.map((g) => g.id))) fields.galleryMediaIds = gallery;

  const slots: Record<string, string> = {};
  for (const key of Object.keys(initial.cardSlots)) {
    if ((form.cardSlots[key] ?? '') !== initial.cardSlots[key]) slots[key] = form.cardSlots[key] ?? '';
  }
  if (Object.keys(slots).length) fields.cardSlots = slots;

  const cats = [...form.categoryIds].sort((a, b) => a - b);
  if (!sameList(cats, [...initial.categoryIds].sort((a, b) => a - b))) fields.categoryIds = cats;
  if (form.newCategories.length) fields.newCategories = form.newCategories;
  const tags = list(form.tags);
  if (!sameList([...tags].sort(), list(initial.tags).sort())) {
    if (tags.length > 50) errors.push('A product takes at most 50 tags.');
    else if (tags.some((t) => t.length > 100)) errors.push('A tag has at most 100 characters.');
    else fields.tags = tags;
  }

  return { fields, errors };
}
