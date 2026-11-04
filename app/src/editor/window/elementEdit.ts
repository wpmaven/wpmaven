/**
 * The editor window's element (what the frame's element map selected, as
 * before: a heading, a paragraph, a button, an image, a section...) and how
 * a change to it is carried out by the edit engine. The frame sends, with
 * each selection, the element's address in the engine: the section, header
 * or footer it sits in, the product or post card, and the image, fact, menu
 * item or form it is or sits in (wme:select, payload.engine). Pure.
 */
import type { EditOperation, EditResult, EditView, ImageTarget, PostFields, ProductFields, SiteMap } from '../../types/edits';
import { imageTargetFor, pageFor, parseSelection, sectionIdFor, type BindingSelection } from '../genstudio/bindings';
import { asUtc, productChanges, productValuesOf } from '../genstudio/itemChanges';
import type { PostSnapshot, ProductSnapshot } from '../genstudio/siteData';
import type { QuickEngine } from './quickActions';
import { CATEGORY_LABELS, TEMPLATE_REACH, type TemplateReach } from './labels';

export interface ElementRect { top: number; left: number; width: number; height: number; bottom: number; right: number }

export interface EngineAddress {
  container: BindingSelection | null;
  object: BindingSelection | null;
  drill: BindingSelection | null;
}

/** The selected element, as the frame describes it. */
export interface ElementSelection {
  uid: string;
  rect: ElementRect;
  source: string;
  blockName: string;
  postId: string;
  category: string;
  editable: boolean;
  content: string;
  textContent: string;
  /** Where a block's change is saved: the template part, the site setting, the menu item, the term. */
  templateSlug?: string;
  settingKey?: string;
  engine: EngineAddress | null;
  /** How the outline names it (the frame's describeEntry), with what it is, its plugin and whether it shows live items. */
  label?: string;
  kind?: ElementKind;
  plugin?: string;
  live?: boolean;
  /** The plugin draws it itself (its form, its shop block), not WPMaven's design. */
  drawn?: boolean;
  /** Where it goes: a link, a button that is a link, a part inside one. */
  link?: LinkInfo;
  /** A field (or a field's line): its state, for the window's actions. */
  field?: FieldInfo;
  /** What a button does on the site. */
  button?: ButtonInfo;
  /** The form it sits in (a field, a label, a send button): its uid in the frame's map, for the window's Whole Form. */
  inForm?: string;
  /** Part of a post's or a product's own content, on its page: changed in the post or the product, never in the template. */
  single?: 'post' | 'product';
  /**
   * The part of the post or the product it is in, as the frame names it
   * (Title, Price, Short description, Description, Pictures, Category,
   * Featured image, Content): the window's actions follow it.
   */
  ownPart?: string;
  /** A picture of a product's gallery, by its place (0: the main picture). */
  picture?: number;
  /** Which size an own Sizes part shows (height, width, length). */
  dimension?: 'height' | 'width' | 'length';
  /** An own part with nothing in it yet: the editor's own line (Add a description), the designed empty picture. */
  empty?: boolean;
  /** What it prints on beyond this page (the "Template" tag): every product page, every post page, the shop's or the blog list's pages. */
  template?: TemplateReach;
  /** A category it shows: its own name or description (a category page's heading), or the category itself (a filter chip). */
  term?: TermRef;
  /** A part of the product page (or post page) holding the record's own content (the picture's frame): Edit This Product. */
  holdsOwn?: boolean;
  /** How it looks, for the glass drawn over it while WPMaven works on it: its corner radius, light or dark behind it. */
  look?: ElementLook;
}

export interface ElementLook { radius: number; tone: 'light' | 'dark' }

/** A part's look as the frame read it (lookOf), or undefined. */
export function parseElementLook(v: unknown): ElementLook | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const l = v as { radius?: unknown; tone?: unknown };
  return { radius: Math.max(0, Number(l.radius) || 0), tone: l.tone === 'dark' ? 'dark' : 'light' };
}

/** A category a part shows, by its taxonomy and id. */
export interface TermRef { taxonomy: 'product_cat' | 'category'; id: number; field: 'name' | 'description' | 'chip' | 'category' }

/** A link as the frame read it: its address as written, the address it resolves to, its tab. */
export interface LinkInfo { href: string; url: string; target: string; download: boolean }
/** A field's state: its type (input type, select, textarea), its name in the owner's words, required, placeholder, choices. */
export interface FieldInfo { type: string; word: string; required: boolean; placeholder: string; options: string[]; multiple: boolean }
/** What a button does: sends its form (by the form's name), or adds a product to the cart. */
export type ButtonInfo = { does: 'submit'; form: string } | { does: 'add-to-cart'; product: string };

/**
 * What the frame says a part is: the engine's own parts, a list of live
 * cards, and a section's own parts (a card, a grid, a row or a group), a
 * form's field, an embed.
 */
export type ElementKind = 'section' | 'chrome' | 'product' | 'post' | 'collection' | 'form' | 'image' | 'fact' | 'menu-item' | 'social' | 'group' | 'field' | 'embed';
const ELEMENT_KINDS: readonly string[] = ['section', 'chrome', 'product', 'post', 'collection', 'form', 'image', 'fact', 'menu-item', 'social', 'group', 'field', 'embed'];

export interface HoverElement {
  uid: string;
  rect: ElementRect;
  category: string;
  blockName: string;
  editable: boolean;
  label?: string;
  kind?: ElementKind;
  plugin?: string;
  live?: boolean;
  drawn?: boolean;
  template?: TemplateReach;
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

export function parseElementRect(v: unknown): ElementRect {
  const r = isObj(v) ? v : {};
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  const top = num(r.top);
  const left = num(r.left);
  const width = num(r.width);
  const height = num(r.height);
  return { top, left, width, height, bottom: num(r.bottom) || top + height, right: num(r.right) || left + width };
}

/** The frame's description of a part (describeEntry), the fields it sent. */
function descriptionOf(p: Record<string, any>): Pick<HoverElement, 'label' | 'kind' | 'plugin' | 'live' | 'drawn' | 'template'> {
  return {
    ...(str(p.label) ? { label: str(p.label).slice(0, 60) } : {}),
    ...(ELEMENT_KINDS.includes(str(p.kind)) ? { kind: str(p.kind) as ElementKind } : {}),
    ...(str(p.plugin) ? { plugin: str(p.plugin).slice(0, 40) } : {}),
    ...(p.live === true ? { live: true } : {}),
    ...(p.drawn === true ? { drawn: true } : {}),
    ...(TEMPLATE_REACH.includes(str(p.template)) ? { template: str(p.template) as TemplateReach } : {}),
  };
}

/** A category a part shows, as the frame read it (data-wm-term), or null. */
function termOf(v: unknown): TermRef | null {
  if (!isObj(v) || (v.taxonomy !== 'product_cat' && v.taxonomy !== 'category')) return null;
  const id = Number(v.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const field = v.field === 'name' || v.field === 'description' || v.field === 'category' ? v.field : 'chip';
  return { taxonomy: v.taxonomy, id, field };
}

type Behavior = Pick<ElementSelection, 'link' | 'field' | 'button' | 'inForm' | 'single' | 'ownPart' | 'picture' | 'dimension' | 'empty' | 'term' | 'holdsOwn'>;

/** What the frame said a part does: where it goes, a field's state, a button's job; what it is to the record or the category it shows. */
function behaviorOf(p: Record<string, any>): Behavior {
  const out: Behavior = {};
  if (str(p.inForm)) out.inForm = str(p.inForm).slice(0, 120);
  if (p.single === 'post' || p.single === 'product') out.single = p.single;
  if (out.single && str(p.ownPart)) out.ownPart = str(p.ownPart).slice(0, 40);
  if (out.single && typeof p.picture === 'number' && Number.isInteger(p.picture) && p.picture >= 0 && p.picture < 100) out.picture = p.picture;
  if (out.single && (p.dimension === 'height' || p.dimension === 'width' || p.dimension === 'length')) out.dimension = p.dimension;
  if (out.single && p.empty === true) out.empty = true;
  const term = termOf(p.term);
  if (term) out.term = term;
  if (p.holdsOwn === true) out.holdsOwn = true;
  if (isObj(p.link)) {
    out.link = { href: str(p.link.href).slice(0, 2000), url: str(p.link.url).slice(0, 2000), target: str(p.link.target).slice(0, 40), download: p.link.download === true };
  }
  if (isObj(p.field) && str(p.field.type)) {
    const options = Array.isArray(p.field.options) ? p.field.options.map(str).filter(Boolean).slice(0, 30) : [];
    out.field = { type: str(p.field.type).slice(0, 30), word: str(p.field.word).slice(0, 40), required: p.field.required === true, placeholder: str(p.field.placeholder).slice(0, 120), options, multiple: p.field.multiple === true };
  }
  if (isObj(p.button)) {
    if (p.button.does === 'submit') out.button = { does: 'submit', form: str(p.button.form).slice(0, 80) };
    else if (p.button.does === 'add-to-cart') out.button = { does: 'add-to-cart', product: str(p.button.product).slice(0, 120) };
  }
  return out;
}

export function parseHoverElement(p: unknown): HoverElement | null {
  if (!isObj(p) || !str(p.uid)) return null;
  return { uid: str(p.uid), rect: parseElementRect(p.rect), category: str(p.category) || 'unknown', blockName: str(p.blockName), editable: p.editable === true, ...descriptionOf(p) };
}

function titleCase(s: string): string {
  return s.replace(/(^|[-/ ])(\w)/g, (_, sep, c) => sep + c.toUpperCase());
}

/**
 * What the outline and the window call a part: the frame's name for it (a
 * header, a section, a product list), else its block's, else its
 * category's; then the plugin it comes from ("Form · WPForms").
 */
export function elementTitle(el: Pick<HoverElement, 'category' | 'blockName' | 'label' | 'plugin'>): string {
  const name = el.label
    || (el.blockName ? titleCase(el.blockName.replace(/^core\//, '').replace(/^[a-z0-9-]+\//, '').replace(/-/g, ' ')) : '')
    || CATEGORY_LABELS[el.category]
    || 'Element';
  return el.plugin ? `${name} · ${el.plugin}` : name;
}

/**
 * The outline's families (2026-10-18): what a plugin draws itself; the
 * controls (buttons, fields, labels, forms); links and menus; live items
 * (the store's products, the blog's posts); and the page's structure
 * (sections, the header and footer, cards, words, pictures), as before.
 * The first that applies wins.
 */
export type OutlineFamily = 'plugin' | 'control' | 'link' | 'live' | 'structure';

const CONTROL_CATEGORIES: readonly string[] = ['text-button', 'text-label', 'interactive'];
const LINK_CATEGORIES: readonly string[] = ['text-link', 'navigation', 'social'];

export function outlineFamily(el: Pick<HoverElement, 'kind' | 'live' | 'category' | 'drawn'>): OutlineFamily {
  if (el.drawn) return 'plugin';
  if (el.kind === 'form' || el.kind === 'field' || CONTROL_CATEGORIES.includes(el.category)) return 'control';
  if (el.kind === 'menu-item' || el.kind === 'social' || LINK_CATEGORIES.includes(el.category)) return 'link';
  if (el.live) return 'live';
  return 'structure';
}

/** Each family's colour: the theme's own where it has one (violet, green, the brand's orange), else a set blue and teal. */
const FAMILY_COLORS: Record<OutlineFamily, string> = {
  plugin: 'var(--brand-orange-text, #E2531F)',
  control: 'var(--success, #2E9E63)',
  link: '#2F6FD6',
  live: '#0E8FA3',
  structure: 'var(--purple)',
};

/** The outline's colour for a part, by its family. */
export function elementColor(el: Pick<HoverElement, 'kind' | 'live' | 'category' | 'drawn'>): string {
  return FAMILY_COLORS[outlineFamily(el)];
}

export function parseElementSelection(p: unknown): ElementSelection | null {
  if (!isObj(p) || !str(p.uid)) return null;
  const e = isObj(p.engine) ? p.engine : null;
  const engine: EngineAddress | null = e
    ? { container: parseSelection(e.container), object: parseSelection(e.object), drill: parseSelection(e.drill) }
    : null;
  return {
    uid: str(p.uid),
    rect: parseElementRect(p.rect),
    source: str(p.source) || 'semantic',
    blockName: str(p.blockName),
    postId: str(p.postId),
    category: str(p.category) || 'unknown',
    editable: p.editable === true,
    content: str(p.content),
    textContent: str(p.textContent),
    ...(str(p.templateSlug) ? { templateSlug: str(p.templateSlug) } : {}),
    ...(str(p.settingKey) ? { settingKey: str(p.settingKey) } : {}),
    engine: engine && (engine.container || engine.object || engine.drill) ? engine : null,
    ...descriptionOf(p),
    ...behaviorOf(p),
    ...(parseElementLook(p.look) ? { look: parseElementLook(p.look) } : {}),
  };
}

/** The element's words on one line, bounded (the window's header, the instruction). */
export function squashText(text: string, max = 300): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

/** The element's kind in the owner's words ("heading", "button"). */
export function elementWord(category: string): string {
  return (CATEGORY_LABELS[category] || 'element').toLowerCase();
}

/** How a change is carried out: an engine operation, a question to the chat, or nothing (and why). */
export type ElementPlan =
  | { kind: 'operation'; operation: EditOperation; long: boolean }
  | { kind: 'chat'; text: string }
  | { kind: 'none'; reason: 'no-place' }
  | { kind: 'none'; reason: 'problem'; problem: string };

/** The section or the header or footer the element sits in, addressed as the engine names it. */
export function containerOf(sel: ElementSelection, map: SiteMap | null): { kind: 'section'; page: string; sectionId: string; designed: boolean } | { kind: 'chrome'; region: 'header' | 'footer' } | null {
  const c = sel.engine?.container;
  if (!c) return null;
  if (c.kind === 'chrome') return { kind: 'chrome', region: c.binding.region === 'footer' ? 'footer' : 'header' };
  if (c.kind !== 'section') return null;
  const page = c.binding.page || '';
  const sectionId = sectionIdFor(map, c.binding) || '';
  if (!page || !sectionId) return null;
  const mapSection = pageFor(map, page)?.sections.find((x) => x.id === sectionId);
  const designed = map?.engine !== 'wordpress' && !mapSection?.wordpress;
  return { kind: 'section', page, sectionId, designed };
}

/** One element's change, said so the engine changes that element only. */
export function scopedInstruction(prompt: string, sel: ElementSelection): string {
  const words = squashText(sel.textContent, 300);
  if (!words) return prompt;
  return `${prompt}\nApply this to one element only: the ${elementWord(sel.category)} that currently reads "${words}". Leave everything else exactly as it is.`;
}

/** A part of a section (a card, a field, a link, an image): what it says, so the engine changes that part of the section only. */
export function partInstruction(prompt: string, sel: ElementSelection): string {
  const what = (sel.label || elementWord(sel.category)).toLowerCase();
  const words = squashText(sel.textContent, 300);
  const which = !words ? `the ${what}` : sel.category === 'image' ? `the ${what} "${words}"` : `the ${what} that currently reads "${words}"`;
  return `${prompt}\nApply this to one part of the section only: ${which}. Leave the rest of the section as it is.`;
}

/** The section, the header or the footer itself (a change to it is not aimed at one of its parts). */
export function isContainerSelection(sel: Pick<ElementSelection, 'kind' | 'category'>): boolean {
  if (sel.kind) return sel.kind === 'section' || sel.kind === 'chrome';
  return ['layout-section', 'layout-cover', 'layout-media', 'template-part'].includes(sel.category);
}

/** A WordPress media id from the image's markup (wp-image-<id>), for its alt text. */
export function mediaIdOf(sel: ElementSelection): number | null {
  const m = /\bwp-image-(\d+)\b/.exec(sel.content) || /\bdata-id="(\d+)"/.exec(sel.content);
  const id = m ? Number(m[1]) : NaN;
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * A designed form's field the frame selected (a dropdown, a list of
 * choices), as the site map's forms hold it: by its label, else by its
 * choices (2026-10-19). Null for a field the form's plugin added.
 */
export function formFieldOf(sel: ElementSelection, map: SiteMap | null): { form: string; fieldId: number; options: string[] } | null {
  if (!sel.field || !map?.forms?.length) return null;
  const said = (t: string) => t.replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const label = said(sel.textContent);
  const shown = new Set(sel.field.options.map(said));
  for (const form of map.forms) {
    for (const f of form.fields) {
      if (f.origin !== 'design' || !f.options?.length) continue;
      const overlap = f.options.filter((o) => shown.has(said(o))).length;
      if ((label && said(f.label) === label) || overlap >= Math.max(2, Math.ceil(f.options.length / 2))) return { form: form.name, fieldId: f.id, options: f.options };
    }
  }
  return null;
}

/** A page's picture of the design as the site map names it (its file and its alt text), or null (2026-10-19). */
export function designPictureOf(sel: ElementSelection, map: SiteMap | null): { file: string; alt: string } | null {
  const drill = sel.engine?.drill;
  const target = drill && drill.kind === 'image' ? imageTargetFor(drill) : null;
  if (!target || target.kind !== 'section') return null;
  const section = pageFor(map, target.page)?.sections.find((s) => s.id === target.sectionId);
  const image = section?.images?.find((i) => i.slot === target.imageSlot);
  return image?.file ? { file: image.file, alt: image.alt } : null;
}

/** The post's or the product's id on its own page (the binding of the post or product the content belongs to, else the page's own id). */
export function ownIdOf(sel: ElementSelection): number | null {
  const b = sel.engine?.object?.binding;
  const v = sel.single === 'product' ? b?.productId : b?.postId;
  if (typeof v === 'number' && v > 0) return v;
  const page = Number(sel.postId);
  return sel.single && Number.isInteger(page) && page > 0 ? page : null;
}

/** What the window read of the post or the product a part belongs to (its pictures, its prices, its categories). */
export type OwnItem =
  | { kind: 'product'; product: ProductSnapshot }
  | { kind: 'post'; post: PostSnapshot };

/** The part a selection is in (its own name when it is the part itself). */
export function ownPartOf(sel: ElementSelection): string {
  return sel.ownPart || sel.label || '';
}

/** A product's descriptions by the part's name, as rewrite_product_text names them. */
const PRODUCT_TEXT: Record<string, 'shortDescription' | 'description'> = { 'Short description': 'shortDescription', Description: 'description' };

/**
 * The picture a picture part is (2026-10-19): a post's featured picture;
 * a product's main picture (its gallery, the gallery's first thumbnail) or
 * one of its gallery's by its media id (read with the product). Null when
 * it cannot be told.
 */
export function ownPictureTarget(sel: ElementSelection, own: OwnItem | null): ImageTarget | null {
  const id = ownIdOf(sel);
  if (!id) return null;
  const part = ownPartOf(sel);
  if (sel.single === 'post') return part === 'Featured image' ? { kind: 'post', postId: id, slot: 'featured' } : null;
  if (part !== 'Pictures') return null;
  const at = sel.picture ?? 0;
  if (at === 0) return { kind: 'product', productId: id, slot: 'featured' };
  const mediaId = own?.kind === 'product' ? own.product.galleryMediaIds[at - 1] : undefined;
  return mediaId ? { kind: 'product', productId: id, slot: 'gallery', mediaId } : null;
}

/** Whether the picture a picture part names is there (a product's main picture, a gallery's, a post's featured one). */
export function ownPictureShown(sel: ElementSelection, own: OwnItem | null): boolean {
  if (own?.kind === 'post') return own.post.featuredMediaId !== null;
  if (own?.kind !== 'product') return false;
  const at = sel.picture ?? 0;
  return at === 0 ? own.product.featuredMediaId !== null : !!own.product.galleryMediaIds[at - 1];
}

/**
 * The post editor and the product editor (2026-10-18, 2026-10-19): a change
 * to a post's words is the post's text rewritten from the instruction, a
 * change to a product's description or short description that text
 * rewritten (rewrite_product_text, the E-commerce Manager's words), aimed at
 * the one element selected (the whole text for the part itself); a new
 * picture for a post's featured picture or a product's is made in the
 * site's style (a preview to apply). Anything else (a title's rewrite, the
 * price in words) goes to the chat, whose Content Writer or E-commerce
 * Manager changes it.
 */
function planOwnContent(sel: ElementSelection, engine: QuickEngine | 'image', prompt: string, own: OwnItem | null, view?: EditView): ElementPlan {
  const id = ownIdOf(sel);
  const part = ownPartOf(sel);
  if (!id || engine === 'chat') return { kind: 'chat', text: prompt };
  if (engine === 'image') {
    const target = ownPictureTarget(sel, own);
    if (!target) return { kind: 'chat', text: prompt };
    return { kind: 'operation', operation: { op: 'replace_image', target, instruction: prompt, mode: 'new', ...(view ? { view } : {}) }, long: true };
  }
  if (sel.category === 'image' || part === 'Title') return { kind: 'chat', text: prompt };
  // The part itself is rewritten as a whole; an element inside it, that element only.
  const whole = sel.label === part;
  if (sel.single === 'post') {
    const instruction = whole && part === 'Content' ? prompt : scopedInstruction(prompt, sel);
    return { kind: 'operation', operation: { op: 'rewrite_post', postId: id, instruction }, long: false };
  }
  const field = PRODUCT_TEXT[part];
  if (!field) return { kind: 'chat', text: prompt };
  return { kind: 'operation', operation: { op: 'rewrite_product_text', productId: id, field, instruction: whole ? prompt : scopedInstruction(prompt, sel) }, long: false };
}

/**
 * What the window changes on a post's or a product's own part without AI,
 * or with it on a preview (2026-10-19): with the product page's marks, a
 * product's pictures in a new order, a post's categories and tags; and a
 * category's own name and description (a category page's heading, a
 * filter chip).
 */
export type OwnTool = 'price' | 'sale' | 'end-sale' | 'category' | 'picture' | 'add-picture' | 'remove-picture' | 'content-picture' | 'alt'
  | 'reorder' | 'post-categories' | 'tags' | 'term-name' | 'term-description' | 'page-picture' | 'form-choices' | 'product-options';

/** The tools that change a picture (Change The Picture, Add A Picture): from the library, or made with AI. */
export const PICTURE_TOOLS: readonly OwnTool[] = ['picture', 'add-picture', 'content-picture', 'page-picture'];
type PictureTool = 'picture' | 'add-picture' | 'content-picture' | 'page-picture';

/** A variation as Change Options reads it: its id, its value for each option, its price. */
export interface OptionVariation { id: number; values: Record<string, string>; price: string }

/**
 * What Change Options sends (2026-10-19), from the product's attributes,
 * its variations and the lists as the owner left them (by option name;
 * a line's extra is a value's typed price): the attributes when their values
 * or order changed; the variations of a value taken away, removed (the
 * plugin refuses a value taken away from a variation that stays); a new
 * value's variations, one with every value of the other options, at its
 * typed price (one option only) else the product's; an existing value's
 * price retyped (one option only).
 */
export function optionFields(
  attributes: ProductSnapshot['attributes'],
  variations: OptionVariation[],
  lists: Record<string, Array<{ text: string; extra?: string }>>,
  base: string,
): ProductFields {
  const options = attributes.filter((a) => a.variation);
  const single = options.length === 1;
  const fields: ProductFields = {};
  const next = attributes.map((a) => (a.variation && lists[a.name] ? { ...a, options: lists[a.name].map((r) => r.text.replace(/\s+/g, ' ').trim()).filter(Boolean) } : a));
  if (JSON.stringify(next) !== JSON.stringify(attributes)) fields.attributes = next;
  const after: Record<string, string[]> = Object.fromEntries(next.filter((a) => a.variation).map((a) => [a.name, a.options]));
  const patches: NonNullable<ProductFields['variations']> = variations
    .filter((v) => Object.entries(v.values).some(([name, value]) => after[name] && !after[name].includes(value)))
    .map((v) => ({ variationId: v.id, remove: true as const }));
  const fresh: NonNullable<ProductFields['newVariations']> = [];
  for (const a of options) {
    for (const row of lists[a.name] ?? []) {
      const text = row.text.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const typed = single ? (row.extra ?? '').trim() : '';
      if (a.options.includes(text)) {
        const v = variations.find((x) => x.values[a.name] === text);
        const price = typed || base;
        if (single && v && price && price !== v.price) patches.push({ variationId: v.id, regularPrice: price });
        continue;
      }
      let combos: Array<Record<string, string>> = [{ [a.name]: text }];
      for (const other of options) {
        if (other.name !== a.name) combos = combos.flatMap((c) => (after[other.name] ?? []).map((value) => ({ ...c, [other.name]: value })));
      }
      for (const c of combos) fresh.push({ options: c, regularPrice: typed || base });
    }
  }
  if (patches.length) fields.variations = patches;
  if (fresh.length) fields.newVariations = fresh;
  return fields;
}

/** A tool's input: the price typed, the categories ticked, the picture chosen from the library, the order, the words typed. */
export type OwnInput =
  | { tool: 'price' | 'sale'; price: string }
  | { tool: 'end-sale' | 'remove-picture' | 'alt' }
  | { tool: 'category' | 'post-categories'; categoryIds: number[]; newCategory: string }
  | { tool: PictureTool; mediaId: number }
  /** A picture made with AI, starting from the current one (the product's main one for an added picture). */
  | { tool: PictureTool; instruction: string }
  | { tool: 'reorder'; mediaIds: number[] }
  | { tool: 'tags'; tags: string[] }
  | { tool: 'term-name'; name: string }
  | { tool: 'term-description'; description: string }
  /** A designed form's dropdown: its choices in their order. */
  | { tool: 'form-choices'; options: string[] }
  /** A product's options as the list made them (attributes, new variations, prices, removals). */
  | { tool: 'product-options'; fields: ProductFields };

/** The operation a tool sends, published at once (no AI) or previewed first (AI); or why it cannot. */
export type OwnPlan = { operation: EditOperation; how: 'publish' | 'preview' } | { problem: string };

const STILL_READING = 'Still reading it from your store. Try again in a moment.';

/**
 * A post's or a product's own part changed directly (2026-10-19): a price,
 * a sale, the categories, a picture from the media library (replaced, added
 * to a product's gallery, removed), with the time the item was read
 * (refused when it changed elsewhere since). A picture in a post's words is
 * the file replaced wherever it shows, and a featured picture's alt text
 * written by AI, both previewed first.
 */
export function planOwnTool(sel: ElementSelection, input: OwnInput, own: OwnItem | null, map: SiteMap | null = null): OwnPlan {
  // A designed form's choices, in the list's order: the form changes, its answers keep theirs (no model call, a preview first).
  if (input.tool === 'form-choices') {
    const field = formFieldOf(sel, map);
    if (!field) return { problem: 'This field cannot be changed from here. Ask the chat about it.' };
    const options = [...new Set(input.options.map((o) => o.replace(/\s+/g, ' ').trim().slice(0, 200)).filter(Boolean))].slice(0, 50);
    if (options.length < 2) return { problem: 'A list of choices needs two at least.' };
    if (JSON.stringify(options) === JSON.stringify(field.options)) return { problem: 'Those are its choices already.' };
    return { how: 'preview', operation: { op: 'edit_form', form: field.form, changes: [{ change: 'update_field', fieldId: field.fieldId, options }] } };
  }
  const words = 'instruction' in input ? input.instruction.replace(/\s+/g, ' ').trim().slice(0, 1000) : '';
  if ('instruction' in input && !words) return { problem: 'Say what the new picture should show, or what to change in this one.' };
  // A page's picture (a section's, the header's or the footer's): the design's, from the library or made with
  // AI starting from this one (2026-10-19); the logo is drawn anew.
  if (input.tool === 'page-picture') {
    const drill = sel.engine?.drill;
    const target = drill && drill.kind === 'image' ? imageTargetFor(drill) : null;
    if (!target) return { problem: 'This picture cannot be changed from here. Ask the chat about it.' };
    if ('instruction' in input) return { how: 'preview', operation: { op: 'replace_image', target, instruction: words, mode: target.kind === 'site' ? 'new' : 'change' } };
    return { how: 'preview', operation: { op: 'replace_image', target, mediaId: input.mediaId } };
  }
  // A category's own words, wherever it shows (the shop's heading, a filter chip): the category itself.
  if (input.tool === 'term-name' || input.tool === 'term-description') {
    const term = sel.term;
    if (!term) return { problem: 'This part cannot be changed from here. Ask the chat about it.' };
    if (input.tool === 'term-name') {
      const name = input.name.replace(/\s+/g, ' ').trim();
      if (!name) return { problem: 'Type the category\'s new name.' };
      return { how: 'publish', operation: { op: 'update_term', taxonomy: term.taxonomy, termId: term.id, name: name.slice(0, 200) } };
    }
    return { how: 'publish', operation: { op: 'update_term', taxonomy: term.taxonomy, termId: term.id, description: input.description.trim().slice(0, 2000) } };
  }
  const id = ownIdOf(sel);
  if (!id) return { problem: 'This part cannot be changed from here. Ask the chat about it.' };
  const product = own?.kind === 'product' ? own.product : null;
  const post = own?.kind === 'post' ? own.post : null;
  const since = (gmt: string | undefined) => (gmt ? { baseModified: asUtc(gmt) } : {});
  const updateProduct = (p: ProductSnapshot, fields: ProductFields): OwnPlan => ({ how: 'publish', operation: { op: 'update_product', productId: id, fields: { ...fields, ...since(p.modifiedGmt) } } });
  switch (input.tool) {
    case 'price':
    case 'sale': {
      if (!product) return { problem: STILL_READING };
      if (!input.price.trim()) return { problem: 'Type a price, like 14 or 14.50.' };
      const before = productValuesOf(product);
      const after = input.tool === 'price' ? { ...before, regularPrice: input.price } : { ...before, salePrice: input.price };
      const { fields, problems } = productChanges(before, after, product.type === 'variable');
      if (problems.length) return { problem: problems.join(' ') };
      if (!Object.keys(fields).length) return { problem: 'That is its price already.' };
      return updateProduct(product, fields);
    }
    case 'product-options':
      if (!product) return { problem: STILL_READING };
      if (!Object.keys(input.fields).length) return { problem: 'Those are its options already.' };
      return updateProduct(product, input.fields);
    case 'end-sale':
      if (!product) return { problem: STILL_READING };
      return updateProduct(product, product.type === 'variable' ? { allVariations: { salePrice: null } } : { salePrice: null });
    case 'reorder': {
      if (!product) return { problem: STILL_READING };
      const [first, ...rest] = input.mediaIds;
      if (!first) return { problem: STILL_READING };
      return updateProduct(product, { featuredMediaId: first, galleryMediaIds: rest });
    }
    case 'post-categories': {
      if (!post) return { problem: STILL_READING };
      const names = input.newCategory.trim() ? [input.newCategory.trim().slice(0, 100)] : [];
      return { how: 'publish', operation: { op: 'update_post', postId: id, fields: { categoryIds: input.categoryIds.slice(0, 50), ...(names.length ? { newCategories: names } : {}), ...since(post.modifiedGmt) } } };
    }
    case 'tags': {
      if (!post) return { problem: STILL_READING };
      const tags = [...new Set(input.tags.map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 100)).filter(Boolean))].slice(0, 50);
      return { how: 'publish', operation: { op: 'update_post', postId: id, fields: { tags, ...since(post.modifiedGmt) } } };
    }
    case 'category': {
      if (!product) return { problem: STILL_READING };
      const names = input.newCategory.trim() ? [input.newCategory.trim().slice(0, 100)] : [];
      if (!input.categoryIds.length && !names.length) return { problem: 'Choose a category, or type a new one.' };
      return updateProduct(product, { categoryIds: input.categoryIds.slice(0, 50), ...(names.length ? { newCategories: names } : {}) });
    }
    case 'picture': {
      // Made with AI: starting from the picture there (the API reads it), placed where it was, a preview first.
      if ('instruction' in input) {
        const target = ownPictureTarget(sel, own);
        if (!target) return { problem: STILL_READING };
        return { how: 'preview', operation: { op: 'replace_image', target, instruction: words } };
      }
      if (sel.single === 'post') return { how: 'publish', operation: { op: 'update_post', postId: id, fields: { featuredMediaId: input.mediaId, ...since(post?.modifiedGmt) } } };
      const target = ownPictureTarget(sel, own);
      if (!target) return { problem: STILL_READING };
      return { how: 'publish', operation: { op: 'replace_image', target, mediaId: input.mediaId } };
    }
    case 'add-picture':
      if ('instruction' in input) return { how: 'preview', operation: { op: 'replace_image', target: { kind: 'product', productId: id, slot: 'add' }, instruction: words } };
      if (!product) return { problem: STILL_READING };
      if (product.featuredMediaId === input.mediaId || product.galleryMediaIds.includes(input.mediaId)) return { problem: 'This picture is already one of the product\'s.' };
      return updateProduct(product, { galleryMediaIds: [...product.galleryMediaIds, input.mediaId] });
    case 'remove-picture': {
      if (sel.single === 'post') return { how: 'publish', operation: { op: 'update_post', postId: id, fields: { featuredMediaId: null, ...since(post?.modifiedGmt) } } };
      if (!product) return { problem: STILL_READING };
      const at = sel.picture ?? 0;
      const gallery = product.galleryMediaIds;
      // The main picture goes: the gallery's first picture takes its place.
      if (at === 0) return updateProduct(product, gallery.length ? { featuredMediaId: gallery[0], galleryMediaIds: gallery.slice(1) } : { featuredMediaId: null });
      const gone = gallery[at - 1];
      if (!gone) return { problem: STILL_READING };
      return updateProduct(product, { galleryMediaIds: gallery.filter((m) => m !== gone) });
    }
    case 'content-picture': {
      const current = mediaIdOf(sel);
      if (!current) return { problem: 'This picture is not in your media library, so it cannot be replaced from here.' };
      if ('instruction' in input) return { how: 'preview', operation: { op: 'replace_image', target: { kind: 'media', mediaId: current }, instruction: words } };
      return { how: 'preview', operation: { op: 'replace_image', target: { kind: 'media', mediaId: current }, mediaId: input.mediaId } };
    }
    case 'alt': {
      // The picture shown: the post's featured one, the product's by its place (0: the main one), else the one in the words.
      const at = sel.picture ?? 0;
      const mediaId = post?.featuredMediaId ?? (product ? (at === 0 ? product.featuredMediaId : product.galleryMediaIds[at - 1]) : null) ?? mediaIdOf(sel);
      if (!mediaId) return { problem: STILL_READING };
      return { how: 'preview', operation: { op: 'describe_images', write: { mediaIds: [mediaId] } } };
    }
    default:
      return { problem: 'This part cannot be changed from here. Ask the chat about it.' };
  }
}

/**
 * How a quick action (or the box's words) is carried out for this element.
 * Advice goes to the chat; a change goes to the engine on the element's words,
 * its section (or header or footer), or its image, with the view the owner
 * looks at (context for the instruction).
 */
export function planQuickEdit(sel: ElementSelection, engine: QuickEngine | 'image', prompt: string, map: SiteMap | null, view?: EditView, own: OwnItem | null = null): ElementPlan {
  if (engine === 'chat') return { kind: 'chat', text: prompt };
  // A category's own name or description is the category's, never the design's words: the chat changes it.
  if (sel.term && (sel.term.field === 'name' || sel.term.field === 'description') && engine === 'element') return { kind: 'chat', text: prompt };
  const seen = view ? { view } : {};
  const container = containerOf(sel, map);
  if (engine === 'alt') {
    const mediaId = mediaIdOf(sel);
    if (mediaId) return { kind: 'operation', operation: { op: 'describe_images', write: { mediaIds: [mediaId] } }, long: false };
    // A picture of the design, by its file (2026-10-19).
    const design = designPictureOf(sel, map);
    if (design) return { kind: 'operation', operation: { op: 'describe_images', write: { files: [design.file] } }, long: false };
    return { kind: 'chat', text: prompt };
  }
  // A post's or a product's own page: the post or the product, never the template.
  if (sel.single) return planOwnContent(sel, engine, prompt, own, view);
  if (engine === 'image') {
    const drill = sel.engine?.drill;
    const target = drill && drill.kind === 'image' ? imageTargetFor(drill) : null;
    // A picture made with AI starts from this one (2026-10-19): "make it blue" and "a new one like this" alike; the logo is drawn anew.
    if (target) return { kind: 'operation', operation: { op: 'replace_image', target, instruction: prompt, mode: target.kind === 'site' ? 'new' : 'change', ...seen }, long: true };
    // An image the engine cannot address: its section draws it.
    engine = 'section';
  }
  if (!container) {
    // A product or post card, or a part outside any section: the chat knows how to change it.
    return { kind: 'chat', text: prompt };
  }
  const instruction = engine === 'element'
    ? scopedInstruction(prompt, sel)
    : isContainerSelection(sel) ? prompt : partInstruction(prompt, sel);
  if (container.kind === 'chrome') {
    return { kind: 'operation', operation: { op: 'edit_chrome', region: container.region, instruction, ...seen }, long: map?.engine !== 'wordpress' };
  }
  // One element's words: the engine changes that element only, in seconds (the section when it needs more).
  const words = squashText(sel.textContent, 600);
  if (engine === 'element' && words) {
    return { kind: 'operation', operation: { op: 'edit_section', page: container.page, sectionId: container.sectionId, instruction, focus: { kind: elementWord(sel.category), text: words }, ...seen }, long: false };
  }
  return { kind: 'operation', operation: { op: 'edit_section', page: container.page, sectionId: container.sectionId, instruction, ...seen }, long: container.designed };
}

/**
 * The owner's own words typed on the page, as the engine's exact change:
 * a block's words by its path (no model call), else the words dictated to
 * the section, which the engine changes as given.
 */
export function planTypedEdit(sel: ElementSelection, before: string, after: string, map: SiteMap | null, ctx: TypedContext = {}): ElementPlan {
  const from = squashText(before, 2000);
  const to = squashText(after, 2000);
  // A post's or a product's own page: its title (a product's name) as typed; a post's words and a product's descriptions as typed.
  if (sel.single) {
    const id = ownIdOf(sel);
    if (!id || !to || from === to) return { kind: 'none', reason: 'no-place' };
    if (sel.label === 'Title') {
      const operation: EditOperation = sel.single === 'product'
        ? { op: 'update_product', productId: id, fields: { name: to.slice(0, 200) } }
        : { op: 'update_post', postId: id, fields: { title: to.slice(0, 200) } };
      return { kind: 'operation', operation, long: false };
    }
    const value = typedOwnValue(sel, id, from, to, ctx);
    if (value) return value;
    const exactly = `Replace the words "${from}" with exactly "${to}" in this one ${elementWord(sel.category)}. Change nothing else.`;
    if (sel.single === 'post') return { kind: 'operation', operation: { op: 'rewrite_post', postId: id, instruction: exactly }, long: false };
    const field = PRODUCT_TEXT[ownPartOf(sel)];
    if (!field) return { kind: 'none', reason: 'no-place' };
    return { kind: 'operation', operation: { op: 'rewrite_product_text', productId: id, field, instruction: exactly }, long: false };
  }
  const container = containerOf(sel, map);
  if (!container || !to || from === to) return { kind: 'none', reason: 'no-place' };
  if (container.kind === 'section') {
    const blocks = pageFor(map, container.page)?.sections.find((x) => x.id === container.sectionId)?.blocks ?? [];
    const block = blocks.find((b) => b.path === sel.uid);
    if (block) {
      return { kind: 'operation', operation: { op: 'edit_section', page: container.page, sectionId: container.sectionId, texts: [{ path: block.path, text: to }] }, long: false };
    }
    return { kind: 'operation', operation: { op: 'edit_section', page: container.page, sectionId: container.sectionId, replacements: [{ find: from, replace: to }] }, long: false };
  }
  return { kind: 'operation', operation: { op: 'edit_chrome', region: container.region, replacements: [{ find: from, replace: to }] }, long: false };
}

/** What a typed own value needs besides the words: the record as the window read it, and the store's size unit. */
export interface TypedContext {
  own?: OwnItem | null;
  /** WooCommerce's dimension unit (mm, cm, m, in, yd). */
  sizeUnit?: string;
}

/** Millimetres in each unit a size may be typed or shown in. */
const MM: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, inch: 25.4, inches: 25.4, '"': 25.4, '″': 25.4, yd: 914.4 };

/**
 * A size typed on the page ("40mm", "4 cm", "1.5"), in the store's unit:
 * the unit typed, else the one the page showed, else the store's; null when
 * it is no size.
 */
export function sizeInStoreUnit(typed: string, shown: string, storeUnit = ''): string | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(mm|cm|m|inches|inch|in|yd|"|″)?/i.exec(typed);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  const shownUnit = (/\d\s*(mm|cm|m|inches|inch|in|yd|"|″)/i.exec(shown)?.[1] ?? '').toLowerCase();
  const from = (m[2] ?? '').toLowerCase() || shownUnit || storeUnit.toLowerCase();
  const to = storeUnit.toLowerCase() || from;
  const value = MM[from] && MM[to] ? (n * MM[from]) / MM[to] : n;
  return String(Math.round(value * 10000) / 10000);
}

/**
 * Words typed over a value the page showed in capitals (a spec line, a
 * name the design sets in capitals), in the case the store keeps it:
 * "PORTUGUESE GREEN" over "Portuguese blue" is kept as "Portuguese green".
 */
export function inStoredCase(typed: string, stored: string): string {
  if (typed !== typed.toUpperCase() || stored === stored.toUpperCase() || !/[a-z]/i.test(typed)) return typed;
  const lower = typed.toLowerCase();
  const titled = stored.split(/\s+/).filter(Boolean).every((w) => w.charAt(0) === w.charAt(0).toUpperCase());
  return titled ? lower.replace(/(^|\s)(\S)/g, (_, sp: string, c: string) => sp + c.toUpperCase()) : lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** A date typed on the page ("October 2, 2026", "2026-10-02") at the post's own time of day; null when it is no date. */
export function typedDate(typed: string, current: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typed.trim());
  const at = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(typed);
  if (Number.isNaN(at.getTime())) return null;
  const time = /T(\d{2}:\d{2}(?::\d{2})?)/.exec(current)?.[1] ?? '09:00:00';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${time.length === 5 ? `${time}:00` : time}`;
}

/**
 * An own value typed on the page (2026-10-19): a product's item number, a
 * size, its spec line (the attribute, or the card's text, that shows those
 * words), its first short description; a post's date and summary. Null for
 * any other part (its words are rewritten as typed).
 */
function typedOwnValue(sel: ElementSelection, id: number, from: string, to: string, ctx: TypedContext): ElementPlan | null {
  const part = ownPartOf(sel);
  const product = ctx.own?.kind === 'product' ? ctx.own.product : null;
  const post = ctx.own?.kind === 'post' ? ctx.own.post : null;
  const since = (gmt: string | undefined) => (gmt ? { baseModified: asUtc(gmt) } : {});
  const problem = (text: string): ElementPlan => ({ kind: 'none', reason: 'problem', problem: text });
  const reading = problem(STILL_READING);
  const updateProduct = (fields: ProductFields): ElementPlan => ({ kind: 'operation', operation: { op: 'update_product', productId: id, fields: { ...fields, ...since(product?.modifiedGmt) } }, long: false });
  const updatePost = (fields: PostFields): ElementPlan => ({ kind: 'operation', operation: { op: 'update_post', postId: id, fields: { ...fields, ...since(post?.modifiedGmt) } }, long: false });
  if (sel.single === 'product') {
    switch (part) {
      case 'Item number': return updateProduct({ sku: to.slice(0, 100) });
      case 'Sizes': {
        const size = sel.dimension ? sizeInStoreUnit(to, from, ctx.sizeUnit) : null;
        if (!size || !sel.dimension) return problem('Type a size, like 35mm or 4 cm.');
        return updateProduct({ dimensions: { [sel.dimension]: size } });
      }
      case 'Spec line': {
        if (!product) return reading;
        const same = (v: string) => squashText(v, 2000).toLowerCase() === from.toLowerCase();
        const attribute = product.attributes.find((a) => !a.variation && same(a.options.join(', ')));
        if (attribute) {
          const options = [inStoredCase(to, attribute.options.join(', '))];
          return updateProduct({ attributes: product.attributes.map((a) => (a === attribute ? { ...a, options } : a)) });
        }
        const slot = Object.entries(product.cardSlots).find(([, v]) => same(v));
        if (slot) return updateProduct({ cardSlots: { [slot[0]]: inStoredCase(to, slot[1]) } });
        return problem('These words come from the product\'s details in your store. Change them there.');
      }
      case 'Short description': return sel.empty ? updateProduct({ shortDescription: to.slice(0, 2000) }) : null;
      default: return null;
    }
  }
  switch (part) {
    case 'Date': {
      if (!post) return reading;
      const date = typedDate(to, post.date);
      return date ? updatePost({ date }) : problem('Type the date like October 2, 2026.');
    }
    case 'Summary': return updatePost({ excerpt: to.slice(0, 600) });
    default: return null;
  }
}

const escHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The element's markup with the change's new words, for the preview in the
 * page itself (as before): the words the change replaced in it, or its whole
 * words when the change replaced them all. Null when the change says nothing
 * about this element's words (the engine's preview shows instead).
 */
export function inPageHtml(sel: ElementSelection, result: EditResult, textOf: (html: string) => string): string | null {
  const own = squashText(textOf(sel.content), 5000);
  if (!own) return null;
  const pairs = (result.changed || []).filter((c) => typeof c.before === 'string' && typeof c.after === 'string' && c.before.trim() && (c.ref.startsWith('words:') || squashText(c.before, 5000) === own));
  if (!pairs.length) return null;
  let html = sel.content;
  let text = own;
  let hit = false;
  for (const p of pairs) {
    const before = squashText(p.before as string, 5000);
    const after = squashText(p.after as string, 5000);
    if (before === text) return escHtml(after);
    if (!text.includes(before)) continue;
    const esc = escHtml(before);
    if (html.includes(esc)) {
      html = html.replace(esc, escHtml(after));
      text = text.replace(before, after);
      hit = true;
    } else if (html.includes(before)) {
      html = html.replace(before, escHtml(after));
      text = text.replace(before, after);
      hit = true;
    }
  }
  return hit ? html : null;
}
