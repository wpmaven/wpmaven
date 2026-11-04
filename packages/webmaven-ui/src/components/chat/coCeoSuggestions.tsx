import React from 'react';
import { NavIcon } from '../../icons/NavIcon';
import { ChatSuggestions, type ChatSuggestionCategory } from './ChatSuggestions';

/**
 * The empty chat's suggestions, one catalog for the plugin and the dashboard
 * (2026-10-17, the plugin's chips moved here). Each prompt has a `mode`:
 *   - 'send': a whole sentence, sent as it is;
 *   - 'fill': has [bracketed] parts the owner fills in: it seeds the input,
 *     which turns the brackets into slots and sends once they are filled.
 *
 * A chip shows only when the chat can do it on this site (`needs`): the kind
 * of site (designed by WPMaven, made of blocks the edit tools change, or
 * neither), a store or not, whether its theme lets the chat change its
 * colours, and the account's switch for an action that is not on everywhere
 * (campaigns, the SEO check, alt text for every picture, a page redesign).
 * Each app says what it knows of the site (ChatSiteFacts); until it knows,
 * only the chips with no condition show.
 */

/** The actions behind some chips, as the account's site state names them. */
export type ChatAbility = 'campaigns' | 'seoAudit' | 'altText' | 'pageRedesign';
export const CHAT_ABILITIES: readonly ChatAbility[] = ['campaigns', 'seoAudit', 'altText', 'pageRedesign'];

/** What an app knows of the site the chat works on. */
export interface ChatSiteFacts {
  /** False until the account answered: only the chips with no condition show. */
  known: boolean;
  /**
   * genstudio: designed by WPMaven. blocks: made of blocks the edit tools
   * change (a site WPMaven did not design). legacy: neither (the older tools).
   */
  kind: 'genstudio' | 'blocks' | 'legacy';
  /** The site is a store. */
  store: boolean;
  /**
   * The theme keeps its colours in theme.json, so the chat can change them on
   * a block site. Unknown (the dashboard cannot see the theme): a block site's
   * colour chips stay hidden.
   */
  themeJson?: boolean;
  /** The account's switches for the actions behind some chips. */
  abilities: Partial<Record<ChatAbility, boolean>>;
}

/** Nothing known yet: only the chips with no condition. */
export const UNKNOWN_SITE_FACTS: ChatSiteFacts = { known: false, kind: 'legacy', store: false, abilities: {} };

export type CoCeoSuggestionIcon =
  | 'sparkles' | 'document-text' | 'swatch' | 'magnifying-glass' | 'cog-6-tooth'
  | 'information-circle' | 'chat-bubble-left' | 'arrow-path' | 'check-circle';

export interface CoCeoSuggestionNeeds {
  /** That kind of site only ('legacy': one the edit tools do not change). */
  engine?: 'genstudio' | 'legacy';
  /** Its pages change through the edit tools (designed, or blocks). */
  edits?: boolean;
  /** The chat can change its colours and fonts. */
  colors?: boolean;
  /** The chat can put a picture it makes into a section. */
  aiImages?: boolean;
  /** A store, or a site that is not one. */
  store?: boolean;
  /** The account's switch for the action behind the chip. */
  ability?: ChatAbility;
}

export interface CoCeoSuggestion {
  text: string;
  mode: 'send' | 'fill';
  icon: CoCeoSuggestionIcon;
  /** When the chip may show. Absent: always. */
  needs?: CoCeoSuggestionNeeds;
}

export interface CoCeoSuggestionCategory {
  id: string;
  label: string;
  icon: CoCeoSuggestionIcon;
  suggestions: CoCeoSuggestion[];
}

/** Where the chat is: a site's home (the plugin's Home, the dashboard's), or the page editor. */
/** Home's chips, the page editor's, and the post editor's and product editor's (2026-10-18). */
export type CoCeoSuggestionsVariant = 'home' | 'editor' | 'post' | 'product';

export const HOME_SUGGESTIONS: CoCeoSuggestionCategory[] = [
  {
    id: 'content',
    label: 'Content',
    icon: 'document-text',
    suggestions: [
      { mode: 'fill', icon: 'document-text',      text: 'Write a blog post about [topic]' },
      { mode: 'fill', icon: 'sparkles',           text: 'Create a landing page for [product/service]' },
      { mode: 'fill', icon: 'document-text',      text: 'Add a new product: [name]' },
      { mode: 'fill', icon: 'chat-bubble-left',   text: 'Draft a newsletter announcing [news]', needs: { ability: 'campaigns' } },
      { mode: 'fill', icon: 'document-text',      text: 'Draft a guide about [topic]' },
      { mode: 'send', icon: 'information-circle', text: "Suggest fresh content ideas based on what's already published" },
    ],
  },
  {
    id: 'design',
    label: 'Design',
    icon: 'swatch',
    suggestions: [
      { mode: 'fill', icon: 'swatch',             text: 'Build a [style] theme for my [type] site', needs: { engine: 'legacy' } },
      { mode: 'fill', icon: 'swatch',             text: 'Restyle my colors and fonts to feel [mood]', needs: { edits: true, colors: true } },
      { mode: 'fill', icon: 'swatch',             text: 'Change my color palette to match [brand/mood]', needs: { colors: true } },
      { mode: 'send', icon: 'information-circle', text: 'Suggest design improvements for my site and preview them' },
      { mode: 'fill', icon: 'sparkles',           text: 'Add a hero section with an AI-generated image about [topic]', needs: { aiImages: true } },
      { mode: 'send', icon: 'arrow-path',         text: 'Refresh my homepage design', needs: { ability: 'pageRedesign' } },
    ],
  },
  {
    id: 'seo',
    label: 'SEO',
    icon: 'magnifying-glass',
    suggestions: [
      { mode: 'send', icon: 'check-circle',     text: 'Audit my site and fix critical SEO issues', needs: { ability: 'seoAudit' } },
      { mode: 'send', icon: 'magnifying-glass', text: 'Write search titles and descriptions for my main pages' },
      { mode: 'send', icon: 'document-text',    text: 'Generate alt text for every missing image', needs: { ability: 'altText' } },
      { mode: 'fill', icon: 'magnifying-glass', text: 'Optimize [page] for search engines' },
    ],
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    icon: 'cog-6-tooth',
    suggestions: [
      { mode: 'send', icon: 'check-circle',       text: 'Run a security audit and fix critical vulnerabilities' },
      { mode: 'send', icon: 'arrow-path',         text: 'Update all plugins and check compatibility' },
      { mode: 'send', icon: 'cog-6-tooth',        text: 'Find unused plugins and themes I can remove' },
      { mode: 'send', icon: 'information-circle', text: "Check my site's speed and suggest fixes" },
      { mode: 'send', icon: 'cog-6-tooth',        text: 'Back up my site before I make more changes' },
      { mode: 'fill', icon: 'magnifying-glass',   text: 'Find plugins for [purpose] and recommend the best one' },
    ],
  },
  {
    id: 'strategy',
    label: 'Strategy',
    icon: 'sparkles',
    suggestions: [
      { mode: 'send', icon: 'information-circle', text: 'Review my progress on current goals' },
      { mode: 'send', icon: 'sparkles',           text: 'What should I focus on this week to grow my audience?' },
      { mode: 'send', icon: 'information-circle', text: 'What is stopping visitors from buying?', needs: { store: true } },
      { mode: 'send', icon: 'information-circle', text: 'What is stopping visitors from getting in touch?', needs: { store: false } },
      { mode: 'send', icon: 'information-circle', text: 'What are my top-performing pages and why?' },
      { mode: 'fill', icon: 'check-circle',       text: 'Set a goal to [outcome]' },
      { mode: 'fill', icon: 'sparkles',           text: 'Plan a [campaign type] campaign for [event/season]' },
    ],
  },
];

export const EDITOR_SUGGESTIONS: CoCeoSuggestionCategory[] = [
  {
    id: 'polish',
    label: 'Polish',
    icon: 'sparkles',
    suggestions: [
      { mode: 'send', icon: 'sparkles',           text: 'Improve the readability of this page', needs: { edits: true } },
      { mode: 'send', icon: 'information-circle', text: 'Suggest accessibility improvements' },
      { mode: 'send', icon: 'swatch',             text: 'Suggest design improvements for this page' },
      { mode: 'fill', icon: 'chat-bubble-left',   text: 'Translate this page to [language]' },
      // The chat changes the whole site too, from any page (2026-10-17).
      { mode: 'fill', icon: 'arrow-path',         text: 'Make every call to action say [words]' },
    ],
  },
  {
    id: 'seo',
    label: 'SEO',
    icon: 'magnifying-glass',
    suggestions: [
      { mode: 'send', icon: 'magnifying-glass', text: 'Generate SEO meta tags for this page' },
      { mode: 'send', icon: 'document-text',    text: 'Generate alt text for all images on this page', needs: { ability: 'altText' } },
      { mode: 'send', icon: 'document-text',    text: 'Improve the heading structure', needs: { engine: 'genstudio' } },
    ],
  },
  {
    id: 'generate',
    label: 'Generate',
    icon: 'sparkles',
    suggestions: [
      { mode: 'fill', icon: 'sparkles',      text: 'Add a section about [topic]' },
      { mode: 'send', icon: 'document-text', text: 'Add a contact form here', needs: { engine: 'genstudio' } },
      { mode: 'fill', icon: 'swatch',        text: 'Add a call-to-action for [goal]' },
      { mode: 'send', icon: 'sparkles',      text: 'Generate a hero image for this page', needs: { aiImages: true } },
    ],
  },
];

/** The post editor's chips: what its Content Writer changes in the post open there. */
export const POST_EDITOR_SUGGESTIONS: CoCeoSuggestionCategory[] = [
  {
    id: 'words',
    label: 'Words',
    icon: 'document-text',
    suggestions: [
      { mode: 'send', icon: 'sparkles',         text: 'Make this post easier to read' },
      { mode: 'send', icon: 'document-text',    text: 'Rewrite the opening so it hooks readers' },
      { mode: 'send', icon: 'check-circle',     text: 'Fix the spelling and grammar in this post' },
      { mode: 'fill', icon: 'arrow-path',       text: 'Give this post a new title about [angle]' },
    ],
  },
  {
    id: 'add',
    label: 'Add',
    icon: 'sparkles',
    suggestions: [
      { mode: 'fill', icon: 'sparkles',         text: 'Add a part about [topic]' },
      { mode: 'fill', icon: 'chat-bubble-left', text: 'End this post by inviting readers to [action]' },
    ],
  },
  {
    id: 'seo',
    label: 'SEO',
    icon: 'magnifying-glass',
    suggestions: [
      { mode: 'send', icon: 'magnifying-glass', text: 'Write this post\'s search title and description' },
      { mode: 'send', icon: 'document-text',    text: 'Write alt text for this post\'s images', needs: { ability: 'altText' } },
    ],
  },
];

/** The product editor's chips: what its E-commerce Manager changes in the product open there. */
export const PRODUCT_EDITOR_SUGGESTIONS: CoCeoSuggestionCategory[] = [
  {
    id: 'product',
    label: 'Product',
    icon: 'sparkles',
    suggestions: [
      { mode: 'send', icon: 'sparkles',         text: 'Make this product\'s description more compelling' },
      { mode: 'send', icon: 'document-text',    text: 'Write a short description for this product' },
      { mode: 'fill', icon: 'arrow-path',       text: 'Change this product\'s price to [price]' },
      { mode: 'fill', icon: 'check-circle',     text: 'Put this product on sale at [sale price]' },
    ],
  },
  {
    id: 'seo',
    label: 'SEO',
    icon: 'magnifying-glass',
    suggestions: [
      { mode: 'send', icon: 'magnifying-glass', text: 'Write this product\'s search title and description' },
      { mode: 'send', icon: 'document-text',    text: 'Write alt text for this product\'s pictures', needs: { ability: 'altText' } },
    ],
  },
];

export const CO_CEO_SUGGESTIONS: Record<CoCeoSuggestionsVariant, CoCeoSuggestionCategory[]> = {
  home: HOME_SUGGESTIONS,
  editor: EDITOR_SUGGESTIONS,
  post: POST_EDITOR_SUGGESTIONS,
  product: PRODUCT_EDITOR_SUGGESTIONS,
};

/** The line above the chips. */
export const CO_CEO_SUGGESTION_HEADINGS: Record<CoCeoSuggestionsVariant, string> = {
  home: 'Try asking me to…',
  editor: 'Help me edit this page…',
  post: 'Help me with this post…',
  product: 'Help me with this product…',
};

/** Whether a chip may show on this site. */
export function suggestionShows(suggestion: CoCeoSuggestion, facts: ChatSiteFacts): boolean {
  const needs = suggestion.needs;
  if (!needs) return true;
  if (!facts.known) return false;
  const kind = facts.kind;
  if (needs.engine && kind !== needs.engine) return false;
  if (needs.edits && kind === 'legacy') return false;
  if (needs.colors && kind === 'blocks' && facts.themeJson !== true) return false;
  if (needs.aiImages && kind === 'blocks') return false;
  if (needs.store !== undefined && facts.store !== needs.store) return false;
  if (needs.ability && facts.abilities[needs.ability] !== true) return false;
  return true;
}

/** The categories with the chips this site can do; a category left empty goes. */
export function visibleSuggestions(categories: CoCeoSuggestionCategory[], facts: ChatSiteFacts): CoCeoSuggestionCategory[] {
  return categories
    .map((c) => ({ ...c, suggestions: c.suggestions.filter((p) => suggestionShows(p, facts)) }))
    .filter((c) => c.suggestions.length > 0);
}

/** A chip's icon at 13px, the Heroicons outline set NavIcon draws, at a stroke of 2. */
export const SuggestionIcon: React.FC<{ name: CoCeoSuggestionIcon; size?: number }> = ({ name, size = 13 }) => (
  <NavIcon
    name={name}
    size={size}
    strokeWidth={2}
    style={{ display: 'inline-block', verticalAlign: 'middle' }}
    focusable="false"
    data-suggestion-icon={name}
  />
);

/** The categories as ChatSuggestions takes them, each with its icon. */
export function suggestionCategoriesOf(categories: CoCeoSuggestionCategory[]): ChatSuggestionCategory[] {
  return categories.map((c) => ({
    id: c.id,
    label: c.label,
    icon: <SuggestionIcon name={c.icon} />,
    suggestions: c.suggestions.map((p) => ({ text: p.text, mode: p.mode, icon: <SuggestionIcon name={p.icon} /> })),
  }));
}

export interface CoCeoSuggestionsProps {
  variant?: CoCeoSuggestionsVariant;
  /** What the app knows of the site; nothing known shows only the chips with no condition. */
  facts?: ChatSiteFacts | null;
  /** A `send` chip: the sentence goes out as it is. */
  onSend: (text: string) => void;
  /** A `fill` chip: the input takes the sentence, its [brackets] to fill in. */
  onFill: (text: string) => void;
  disabled?: boolean;
  /** Drawn beside the heading. */
  lead?: React.ReactNode;
}

/** The chips this site can do, for a home or for the editor. */
export const CoCeoSuggestions: React.FC<CoCeoSuggestionsProps> = ({ variant = 'home', facts, onSend, onFill, disabled = false, lead }) => {
  const categories = suggestionCategoriesOf(visibleSuggestions(CO_CEO_SUGGESTIONS[variant], facts ?? UNKNOWN_SITE_FACTS));
  return (
    <ChatSuggestions
      categories={categories}
      heading={CO_CEO_SUGGESTION_HEADINGS[variant]}
      lead={lead}
      onSend={onSend}
      onFill={onFill}
      disabled={disabled}
    />
  );
};
