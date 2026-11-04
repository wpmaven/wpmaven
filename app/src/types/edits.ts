/**
 * Edit operations, as the WPMaven API defines them (its services/edits/types
 * and types/storeFields). The plugin keeps a copy: a field is added in the
 * API first, never renamed. Only what the plugin sends or reads is here.
 */

/** Plan slug of a page WPMaven designed ('index' is the homepage). */
export type PageSlug = string;
/** Id of a top-level section, as compiled into data-wm-section. */
export type SectionId = string;

export type TokenColor = 'bg' | 'surface' | 'ink' | 'accent' | 'accent2';
export const TOKEN_COLORS: readonly TokenColor[] = ['bg', 'surface', 'ink', 'accent', 'accent2'];

export type MenuLink =
  | { kind: 'page'; pageId: number }
  | { kind: 'post'; postId: number }
  | { kind: 'product'; productId: number }
  | { kind: 'term'; taxonomy: 'category' | 'product_cat'; termId: number }
  | { kind: 'shop' }
  | { kind: 'url'; url: string };

export interface MenuItemInput {
  /** An existing menu item to keep; existing items left out are removed. */
  id?: number;
  label: string;
  link: MenuLink;
  newTab?: boolean;
  /** One level deep. */
  children?: MenuItemInput[];
}

export type ImageTarget =
  | { kind: 'media'; mediaId: number }
  | { kind: 'product'; productId: number; slot: 'featured' }
  /** One picture of a product's gallery, by its media id. */
  | { kind: 'product'; productId: number; slot: 'gallery'; mediaId: number }
  /** A picture added to the product's gallery (from the library, or made starting from its main picture). */
  | { kind: 'product'; productId: number; slot: 'add' }
  | { kind: 'post'; postId: number; slot: 'featured' }
  | { kind: 'section'; page: PageSlug; sectionId: SectionId; imageSlot: string }
  /** An image of the site header or footer (its slot id or file name). */
  | { kind: 'chrome'; region: 'header' | 'footer'; imageSlot: string }
  | { kind: 'site'; slot: 'logo' | 'icon' };

export interface ProductFields {
  baseModified?: string;
  name?: string;
  shortDescription?: string;
  description?: string;
  status?: 'publish' | 'draft' | 'private';
  /** product_cat ids, replaces the set. */
  categoryIds?: number[];
  /** Categories by name, created when new, then added to the set. */
  newCategories?: string[];
  regularPrice?: string;
  /** null ends the sale. */
  salePrice?: string | null;
  stockStatus?: 'instock' | 'outofstock' | 'onbackorder';
  manageStock?: boolean;
  stockQuantity?: number | null;
  /** Every option of a variable product at once. */
  allVariations?: { regularPrice?: string; salePrice?: string | null; stockStatus?: 'instock' | 'outofstock' };
  /** One option's own prices (a printed option is checked against its lowest price). */
  variations?: Array<{ variationId: number; regularPrice?: string; salePrice?: string | null; remove?: true }>;
  /** New options' variations: one value per option used for variations (a new value in Change Options). */
  newVariations?: Array<{ options: Record<string, string>; regularPrice: string; salePrice?: string | null }>;
  featuredMediaId?: number | null;
  /** Ordered, replaces the gallery. */
  galleryMediaIds?: number[];
  /** Unique in the store; '' clears it (the product page's item number). */
  sku?: string;
  /** In the store's size unit, as decimal strings; '' clears one. */
  dimensions?: { length?: string; width?: string; height?: string };
  /** The whole set, replacing the product's (a spec line is one of them). */
  attributes?: Array<{ name: string; options: string[]; variation: boolean; visible?: boolean }>;
  /** The designed card's own text by its key; only keys the product already has. */
  cardSlots?: Record<string, string>;
}

/** The SEO field group of a post or page. */
export interface SeoFields {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: number | string | null;
  noindex?: boolean;
}

export interface PostFields {
  baseModified?: string;
  title?: string;
  excerpt?: string;
  status?: 'publish' | 'draft' | 'pending' | 'private' | 'future';
  /** The last part of its address; refused on a page WPMaven designed. */
  slug?: string;
  featuredMediaId?: number | null;
  seo?: SeoFields;
  /** The post's whole text, with the hash of the text it replaces (refused when the post changed since). */
  content?: { html: string; baseHash: string };
  /** ISO 8601, the site's time. */
  date?: string;
  /** Blog category ids, replacing the set; newCategories by name, made when new and added. */
  categoryIds?: number[];
  newCategories?: string[];
  /** Tag names, replacing the set. */
  tags?: string[];
}

/** The kinds of field a designed form takes (tel: phone, textarea: long text, select: list, radio: choice). */
export type FormFieldType = 'text' | 'email' | 'tel' | 'url' | 'number' | 'date' | 'textarea' | 'select' | 'radio' | 'checkbox';

/** One change to a designed form (fieldId: the field's id in the site map; afterFieldId null: first). */
export type FormChange =
  | { change: 'add_field'; label: string; type: FormFieldType; required?: boolean; placeholder?: string; options?: string[]; afterFieldId?: number | null }
  | { change: 'remove_field'; fieldId: number }
  | { change: 'update_field'; fieldId: number; label?: string; placeholder?: string; required?: boolean; options?: string[] }
  | { change: 'move_field'; fieldId: number; afterFieldId: number | null }
  | { change: 'submit_text'; text: string };

/** Words typed on the page: the element's text as it was, and as the owner wants it (applied as given, no model call). */
export interface TextReplacement { find: string; replace: string }

/** One element of a section the change is about (the editor window): its kind and its words now. */
export interface ElementFocus { kind: string; text: string }

/**
 * The screen size the owner looks at when they ask (2026-10-17): the view and
 * the width its page is laid out at. It rides with what a model reads (an
 * instruction, the chat's context) as context for a request that names no
 * size, like the open page for "this page"; never a rule by itself.
 */
export interface EditView { mode: 'desktop' | 'tablet' | 'mobile'; width: number }

export type EditOperation =
  /** texts and link (a page of WordPress blocks): the words and a link's address as given; instruction is then absent. */
  | { op: 'edit_section'; page: PageSlug; sectionId: SectionId; instruction?: string; texts?: Array<{ path: string; text: string }>; link?: { path: string; url: string }; replacements?: TextReplacement[]; focus?: ElementFocus; view?: EditView }
  | { op: 'add_section'; page: PageSlug; afterSectionId?: SectionId | null; instruction: string; view?: EditView }
  | { op: 'remove_section'; page: PageSlug; sectionId: SectionId }
  /**
   * parent, status, like and seo: Add a page's More options (1.8.0, when the
   * site's features.addPageOptions says the API takes them): the WordPress
   * page it goes under, published or a draft, a page of the site map whose
   * layout it takes, its search title and description.
   */
  | { op: 'add_page'; title: string; instruction: string; slug?: string; menu?: { location: string; position?: number; label?: string };
      parent?: number; status?: 'draft' | 'publish'; like?: PageSlug; seo?: { title?: string; description?: string } }
  | { op: 'remove_page'; page: PageSlug }
  /**
   * A block theme's header or footer: texts, link and identity (the site's name
   * and tagline) as given, no model call, instruction then absent; reset: back
   * to the theme's version.
   */
  | { op: 'edit_chrome'; region: 'header' | 'footer'; instruction?: string; texts?: Array<{ path: string; text: string }>; link?: { path: string; url: string }; identity?: { name?: string; tagline?: string }; reset?: true; replacements?: TextReplacement[]; focus?: ElementFocus; view?: EditView }
  | { op: 'set_design_tokens'; colors?: Partial<Record<TokenColor, string>>; fonts?: { display?: string; body?: string } }
  | { op: 'edit_site'; instruction: string; scope?: { pages?: PageSlug[]; chrome?: boolean }; view?: EditView }
  /** mode with an instruction: change starts from the picture as it is; new draws a different one. */
  | { op: 'replace_image'; target: ImageTarget; instruction?: string; mode?: 'change' | 'new'; mediaId?: number; alt?: string; view?: EditView }
  | { op: 'update_product'; productId: number; fields: ProductFields }
  | { op: 'update_post'; postId: number; fields: PostFields }
  | { op: 'update_facts'; values: Record<string, string> }
  | { op: 'update_menu'; location: string; items: MenuItemInput[] }
  /** The homepage switch: the designed homepage, or the one the site had before. */
  | { op: 'set_front_page'; use: 'designed' | 'previous' }
  /** A designed form's fields and button (no model call). */
  | { op: 'edit_form'; form: string; changes: FormChange[] }
  /** A designed form's thank-you message, who gets an email ('owner': the site's own address; none: no email), fields added in WPForms taken out. */
  | { op: 'update_form_settings'; form: string; confirmation?: string; recipients?: string[]; removeFields?: number[] }
  /** The whole site's search settings: its sharing picture (a media id, null removes it), whether search engines may list it, its tagline. */
  | { op: 'update_site_search'; fields: { shareImage?: number | string | null; hidden?: boolean; tagline?: string } }
  /** Several pages' search details: the exact values (items), or drafted by WPMaven from each page (write). */
  | { op: 'update_search_details'; items?: Array<{ postId: number; seo: SeoFields }>; write?: { postIds: number[]; fields?: Array<'title' | 'description'> } }
  /**
   * Descriptions of pictures: the exact texts (items), or written by WPMaven
   * from the pictures (write). A library file by mediaId, a picture of the
   * site's design by its file.
   */
  | { op: 'describe_images'; items?: Array<{ mediaId?: number; file?: string; alt: string }>; write?: { mediaIds?: number[]; files?: string[]; missing?: boolean } }
  /** The business's social profiles, the whole ordered list. */
  | { op: 'update_social_links'; links: SocialLink[] }
  /** One section above (before) or below (after) another of the same page; exactly one of the two. */
  | { op: 'move_section'; page: PageSlug; sectionId: SectionId; before?: SectionId; after?: SectionId }
  /** A post's text rewritten from an instruction (pictures and other blocks stay). */
  | { op: 'rewrite_post'; postId: number; instruction: string }
  /** A product's short description or description rewritten from an instruction, in the E-commerce Manager's words (a preview to apply). */
  | { op: 'rewrite_product_text'; productId: number; field: 'shortDescription' | 'description'; instruction: string }
  /** A new post or product from the editor's Add panels (a draft unless fields.status says publish). */
  | { op: 'add_post'; fields: import('./store').PostFields & { title: string } }
  | { op: 'add_product'; fields: import('./store').ProductFields & { name: string; type: 'simple' } }
  /** A new layout for one page, its words kept (the homepage refreshed section by section). */
  | { op: 'redesign_page'; page: PageSlug; instruction: string; mode?: 'refresh' | 'new' }
  /** A store category's or a blog category's name and description (a category page's heading, a filter chip). */
  | { op: 'update_term'; taxonomy: 'product_cat' | 'category'; termId: number; name?: string; description?: string };

/** One social profile of the business (network: instagram, facebook, ... or other with a label). */
export interface SocialLink {
  network: string;
  url: string;
  label?: string;
}

export type EditOpName = EditOperation['op'] | 'undo' | 'baseline' | 'mirror_data' | 'redesign_product'
  | 'add_product' | 'remove_product' | 'add_post' | 'remove_post' | 'update_products';

/** Operations that change design or structure (previewed, then published as a delta). */
export const DESIGN_OPS: ReadonlySet<string> = new Set([
  'edit_section', 'add_section', 'remove_section', 'add_page', 'remove_page',
  'edit_chrome', 'set_design_tokens', 'edit_site', 'replace_image', 'edit_form', 'move_section', 'redesign_page',
]);

export type EditStatus =
  | 'queued' | 'previewing' | 'previewed' | 'publishing' | 'published'
  | 'failed' | 'undone' | 'discarded' | 'expired';

export type ChangeKind = 'page' | 'section' | 'chrome' | 'tokens' | 'product' | 'post' | 'facts' | 'menu' | 'media' | 'front_page' | 'form';

export interface EditChange {
  kind: ChangeKind;
  ref: string;
  label: string;
  before?: string;
  after?: string;
}

export interface EditCheck {
  kind: 'mobile' | 'desktop' | 'contrast' | 'facts' | 'markers' | 'page_job' | 'drift' | 'em_dash' | 'stale_preview';
  severity: 'info' | 'warn' | 'broken';
  page?: PageSlug;
  sectionId?: SectionId;
  width?: 390 | 1440;
  /** Owner words. */
  message: string;
}

export interface EditPreview {
  /** Private: works for a signed-in WordPress editor, for a short time. */
  url: string;
  /** Present once the owner pressed "Share preview" (72 hours). */
  shareUrl?: string;
  shareExpiresAt?: string;
  staticUrl?: string;
  expiresAt: string;
  pages: Array<{ slug: PageSlug; title: string; url: string }>;
  thumbnails?: Array<{ ref: string; width: 390 | 1440; before?: string; after: string }>;
  /** New images no page shows ('image:icon', 'image:logo'), as private preview links. */
  images?: Array<{ ref: string; url: string }>;
}

export interface EditFailure {
  code: string;
  message: string;
}

export interface EditResult {
  ok: boolean;
  operationId: string;
  mode: 'preview' | 'publish';
  status: EditStatus;
  kind: EditOpName;
  summary: string;
  changed: EditChange[];
  preview?: EditPreview;
  checks: EditCheck[];
  snapshotId?: string;
  failures: EditFailure[];
  undoable: boolean;
  undo?: { alsoUndoes: Array<{ operationId: string; summary: string }> };
  queuePosition?: number;
  previewId?: string;
  createdAt: string;
  publishedAt?: string;
  source: 'editor' | 'chat' | 'store' | 'dashboard' | 'whatsapp' | 'system';
  /** Who on the team made it (AI work); null for a change a person made. */
  operator?: { id: string; title: string } | null;
}

export interface SiteMapPage {
  slug: PageSlug;
  title: string;
  postId: number | null;
  url: string;
  /** What a page that is no WordPress page shows: woo_archive (the shop), woo_single (the product page), posts, post_single (the post page). */
  template?: string;
  /** A product page or a post page: the published product (or post) the editor opens it on. */
  showing?: { id: number; title: string; url: string };
  /** 'draft' for a page added on a connected site and not published yet (when the API says). */
  status?: string;
  sections: Array<{
    id: SectionId; label: string; excerpt: string;
    /** A page of WordPress blocks: the section's first block kind, its words by block (their paths in the page), and what changing it needs to know. */
    kind?: string;
    blocks?: SiteMapBlockText[];
    images?: Array<{ slot: string; file: string; alt: string }>;
    locked?: boolean;
    productGrid?: boolean;
    form?: boolean;
    /** On a page WPMaven designed: blocks the owner added in WordPress between its sections (changed as on a block page). */
    wordpress?: boolean;
    /** A section of a page built with Elementor: its words and pictures change, its layout stays Elementor's. */
    builder?: 'elementor';
  }>;
  /** A page built with a page builder, or classic content without blocks (no sections). */
  builder?: 'elementor' | 'divi';
  classic?: boolean;
}

/** One block of a section whose words the owner can change. */
export interface SiteMapBlockText {
  path: string;
  /** heading, text, button, list item, quote, caption... */
  kind: string;
  text: string;
  url?: string;
  level?: number;
}

export interface SiteMapMenu {
  location: string;
  label: string;
  maxDepth: number;
  items: Array<{ id: number; label: string; link: MenuLink; depth: number; parent: number }>;
}

export interface SiteMapFact {
  key: string;
  label: string;
  type: 'text' | 'tel' | 'email' | 'url';
  value: string;
}

/** What the editor reads to address operations. */
export interface SiteMap {
  /** wordpress: a site WPMaven did not design, edited block by block. */
  engine: 'genstudio' | 'legacy' | 'wordpress';
  editable: boolean;
  reason?: 'NOT_GENSTUDIO' | 'PLUGIN_UPDATE_REQUIRED' | 'NO_LIVE_RUN' | 'EDITS_DISABLED';
  head: { operationId: string | null; at: string | null };
  pages: SiteMapPage[];
  chrome: Record<'header' | 'footer', { excerpt: string; ctas: string[] }>;
  menus: SiteMapMenu[];
  facts: SiteMapFact[];
  tokens: { colors: Record<TokenColor, string>; fonts: { display: string; body: string } };
  products: Array<{ slug: string; id: number | null; name: string; price: string }>;
  /** The logo and the site icon in WordPress (absent when the site did not answer); a block site: its name and tagline too. */
  identity?: { logoUrl: string | null; iconUrl: string | null; name?: string; tagline?: string };
  /** Which homepage visitors land on (absent when it could not be read). */
  frontPage?: SiteMapFrontPage;
  /** Every designed form with its fields (absent before the API read forms). */
  forms?: SiteMapForm[];
  /** The business's social profiles, and the theme's social menu location (null when it has none). */
  social?: { links: SocialLink[]; menuLocation: string | null };
  /** A block site: its theme, its header and footer parts, its latest posts, a classic theme's menus and widget areas. */
  theme?: { slug: string; name: string; kind: 'block' | 'classic'; supportsGlobalStyles: boolean };
  /** blocks: the part's words by block (paths in the part); shows: whether it shows the site's name and tagline. */
  parts?: Array<{ slug: string; area: string; title: string; customized: boolean; excerpt: string; blocks?: SiteMapBlockText[]; shows?: { siteTitle: boolean; tagline: boolean } }>;
  /** A block site: what the colours and fonts panel can change (a classic theme without theme.json: nothing, and why). */
  styles?: { canWrite: boolean; fonts: string[]; reason?: string };
  posts?: Array<{ postId: number; title: string; url: string }>;
  classicTheme?: { menus: Array<{ location: string; label: string }>; widgetAreas: Array<{ id: string; name: string }> };
}

/** A designed form, as the editor's form panel reads it. */
export interface SiteMapForm {
  name: string;
  intent: string;
  /** "the contact form on the Contact page". */
  label: string;
  place: { page?: string; sectionId?: string; region?: 'header' | 'footer' };
  fields: Array<{
    id: number; label: string; type: FormFieldType; required: boolean; placeholder?: string; options?: string[];
    origin: 'design' | 'consent' | 'wpforms';
  }>;
  submitText: string;
  /** Read from the site; absent when it did not answer or its plugin is older. */
  settings?: {
    confirmation: string;
    recipients: Array<{ address: string; isOwner: boolean }>;
    emailOn: boolean;
    messages: number | null;
    provider: 'wpforms' | 'none';
    nextFieldId: number;
  };
}

export interface SiteMapFrontPage {
  /** designed: the homepage WPMaven made; previous: the one the site had before; other: one chosen in WordPress since. */
  showing: 'designed' | 'previous' | 'other';
  previousAvailable: boolean;
  previousTitle?: string;
  currentTitle?: string;
}

/** An edit operation's result as a chat shows it (the API's EditResultCard). */
export interface EditResultCard {
  operationId: string;
  status: EditStatus;
  summary: string;
  changed: EditChange[];
  checks: EditCheck[];
  undoable: boolean;
  previewUrl?: string;
  liveUrl?: string;
  /** Who on the team made it; null for a change a person made (no face then). */
  operator?: { id: string; title: string } | null;
}

/** The preview an approval card shows (the API's EditPreviewCard). */
export interface EditPreviewCard extends EditResultCard {
  previewId: string;
  shareUrl?: string;
  thumbnails?: EditPreview['thumbnails'];
  /** The change's kind (what the card offers: versions, the review of every line). */
  kind?: string;
  /** The API offers another version of this change (a change composed from the owner's words). */
  anotherVersion?: boolean;
}
