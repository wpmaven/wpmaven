/**
 * Every word the editor window shows, in one place (the quick actions keep
 * theirs beside them, in quickActions.ts), in Title Case; LABEL_CASE turns
 * them all into sentence case in one line if WPMaven decides so.
 */
export const LABEL_CASE: 'title' | 'sentence' = 'title';

/** A label in the window's casing (acronyms like SEO, FAQ or CTA keep their capitals). */
export function caseLabel(label: string, casing: 'title' | 'sentence' = LABEL_CASE): string {
  if (casing === 'title') return label;
  return label.split(' ').map((w, i) => (i === 0 || /^[A-Z0-9&]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');
}

/** The window's own words. */
export const WINDOW_WORDS = {
  describe: 'Describe what you want to change...',
  describeAnother: 'Describe another change...',
  apply: 'Apply',
  retry: 'Retry',
  discard: 'Discard',
  close: 'Close',
  moreOptions: 'More Options',
  wholeSection: 'Whole Section',
  wholeForm: 'Whole Form',
  goesTo: 'Goes to',
  does: 'Does',
  copy: 'Copy the address',
  copied: 'Copied',
  open: 'Open in a new browser tab',
  nowhere: 'Goes nowhere',
  pickPage: 'Pages',
  pickSection: 'On this page',
  pickPosts: 'Posts',
  pickSearch: 'Find a page',
  otherSite: 'Another website…',
  emailAddress: 'An email address…',
  phoneNumber: 'A phone number…',
  yourEdit: 'Your edit',
  live: 'Done. It is live.',
  undo: 'Undo',
  inChat: 'The answer is in the chat.',
  longWork: 'Rewriting this section. This can take a minute.',
  ambiguous: 'That text appears twice in this section. Say which one in the box.',
  noPlace: 'This part cannot be changed from here. Ask the chat about it.',
  emptyHint: 'Hover and click any element to start editing with AI',
  backToChat: 'Back to the chat',
  allSettings: 'All settings',
  leave: 'Your change is still in preview. Apply it or discard it before leaving?',
  unsavedTitle: 'Unsaved changes',
  applyAndContinue: 'Apply & Continue',
  allLive: 'Every change is live',
  template: 'Template',
  showing: 'Showing',
  findShown: 'Find one to show',
  noneShown: 'Nothing published matches.',
  reviews: 'Visitors\' reviews. Your customers write them, so they are not changed here.',
  altText: 'Alt text:',
  noAltText: 'none yet',
  makingPicture: 'Making the picture',
  writingAlt: 'Writing the alt text',
} as const;

/**
 * What the glass over a part says while WPMaven works on it (2026-10-19), by
 * the quick action's id; a change in the owner's own words says WORKING.
 */
const WORKING_WORDS: Record<string, string> = {
  rewrite: 'Rewriting', button: 'Rewriting', words: 'Rewriting', overlay: 'Rewriting', 'say-where': 'Rewriting', write: 'Writing',
  shorter: 'Shortening', shorten: 'Shortening', longer: 'Expanding', expand: 'Expanding', simpler: 'Simplifying',
  punchier: 'Making it punchier', urgent: 'Making it more urgent', fix: 'Fixing the spelling', alt: 'Writing the alt text',
  caption: 'Writing a caption', add: 'Adding', 'add-items': 'Adding', remove: 'Removing', 'stand-out': 'Making it stand out',
  spacing: 'Adjusting the spacing', taller: 'Making it taller', 'to-button': 'Turning it into a button',
  'new-tab': 'Changing the link', 'same-tab': 'Changing the link', required: 'Changing the field', optional: 'Changing the field',
  more: 'Changing what it shows', fewer: 'Changing what it shows',
};
export const WORKING = 'Working on it';
export const PUBLISHING = 'Publishing';
/** The badge by a part whose change is prepared, and by one that could not be. */
export const JOB_WORDS = {
  waiting: 'Waiting for your approval',
  failed: 'Could not finish',
  stop: 'Stop',
  /** The badge's own name for a screen reader: "Your Web Designer's change to this heading". */
  open: (who: string, what: string) => `Open your ${who}'s change to this ${what}`,
  leaveTitle: 'Changes in progress',
  leave: 'Your team is still on some changes, or they wait for your approval. If you leave the editor, the ones prepared wait in History.',
  stay: 'Stay',
  leaveAnyway: 'Leave',
} as const;
export function workingWords(actionId: string | null): string {
  return (actionId && WORKING_WORDS[actionId]) || WORKING;
}

/**
 * What a part tagged "Template" prints on (2026-10-19): the window's first
 * line says what a change to it reaches.
 */
export type TemplateReach = 'product' | 'post' | 'shop' | 'blog';
export const TEMPLATE_REACH: readonly string[] = ['product', 'post', 'shop', 'blog'];

export const TEMPLATE_LINES: Record<TemplateReach, string> = {
  product: 'Changes every product page',
  post: 'Changes every post page',
  shop: 'Changes the shop and its category pages',
  blog: 'Changes every page of the blog list',
};

/** The crossings between the product page (or post page) and the product (or post) editor. */
export const CROSSING_WORDS = {
  editRecord: { product: 'Edit This Product', post: 'Edit This Post' },
  editTemplate: { product: 'Edit The Product Page', post: 'Edit The Post Page' },
  shared: { product: 'Shared by every product', post: 'Shared by every post' },
} as const;

/** An own part's name in the crossing note ("The Stoneware Jug's own picture"). */
const OWN_NOTE_WORDS: Record<string, string> = {
  Title: 'name', Pictures: 'pictures', 'Featured image': 'picture', Content: 'words', Description: 'description',
  'Short description': 'short description', Price: 'price', Category: 'category', 'Item number': 'item number',
  Sizes: 'sizes', 'Spec line': 'spec line', Options: 'options', Reviews: 'reviews', Date: 'date',
  Categories: 'categories', Tags: 'tags',
};

/** "The Stoneware Jug's own pictures"; "This product's own pictures" without its name. */
export function ownNote(word: string, title: string, kind: 'product' | 'post'): string {
  const what = OWN_NOTE_WORDS[word] || 'content';
  const name = title.trim();
  const whose = name ? `${/^the\s/i.test(name) ? '' : 'The '}${name}'s` : `This ${kind}'s`;
  return `${whose} own ${kind === 'post' && word === 'Title' ? 'title' : what}`;
}

/** The category badge and the outline's label. */
export const CATEGORY_LABELS: Record<string, string> = {
  'text-heading': 'Heading',
  'text-paragraph': 'Paragraph',
  'text-button': 'Button',
  'text-quote': 'Quote',
  'text-list': 'List',
  'text-table': 'Table',
  'text-code': 'Code',
  'text-meta': 'Meta',
  'text-label': 'Label',
  'text-link': 'Link',
  'image': 'Image',
  'media': 'Media',
  'layout-section': 'Section',
  'layout-group': 'Group',
  'layout-cover': 'Cover',
  'layout-media': 'Media & Text',
  'navigation': 'Navigation',
  'social': 'Social',
  'video': 'Video',
  'audio': 'Audio',
  'gallery': 'Gallery',
  'accordion': 'Accordion / FAQ',
  'embed': 'Embed',
  'interactive': 'Interactive',
  'template-part': 'Template Part',
  'style-element': 'Style',
  'unknown': 'Element',
};
