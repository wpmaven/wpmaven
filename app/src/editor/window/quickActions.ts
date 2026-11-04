import type { SiteMap } from '../../types/edits';
import { CROSSING_WORDS, caseLabel } from './labels';
import { containerOf, designPictureOf, formFieldOf, mediaIdOf, ownPartOf, ownPictureShown, type ElementSelection, type OwnItem, type OwnTool } from './elementEdit';

/**
 * How a change is carried out by the edit engine:
 * - element: the clicked words only (a heading, a paragraph, a button...);
 * - section: the section, or the header or footer, the element sits in (a
 *   change aimed at the element when it is a part of it);
 * - alt: the image's alternative text, written by the engine;
 * - chat: the owner's own words about a part the engine has no place for,
 *   asked in the chat (the window's actions never go there).
 */
export type QuickEngine = 'element' | 'section' | 'alt' | 'chat';

/**
 * A quick action (2026-10-18: each one changes the site, tailored to what
 * was selected; advice is the chat's):
 * - run: the change at once, then its preview to Apply;
 * - fill: the window's box filled with a sentence to finish (its [blanks]
 *   typed in), then sent to `engine`;
 * - panel: the element's own panel (its product, its form, a business detail);
 * - pick: a list of this site's pages (and this page's sections) to choose
 *   from: where a link goes, or a page to add to a menu;
 * - own: a post's or a product's own part changed in the window itself
 *   (2026-10-19): a price field, a category list, the media library, or
 *   at once (End Sale, Remove);
 * - cross: the same part in the other editor (2026-10-19): the product page
 *   itself from a product's picture (Edit The Product Page), the product
 *   from the product page's picture frame (Edit This Product);
 * - open: somewhere else: the store's screen of the product (its options),
 *   a category's own page.
 */
export type QuickAction =
  | { id: string; label: string; does: 'run'; engine: QuickEngine | 'image'; prompt: string }
  | { id: string; label: string; does: 'fill'; engine: QuickEngine | 'image'; text: string }
  | { id: string; label: string; does: 'panel' }
  | { id: string; label: string; does: 'pick'; pick: 'link' | 'menu' }
  | { id: string; label: string; does: 'own'; own: OwnTool }
  | { id: string; label: string; does: 'cross'; to: 'record' | 'template' }
  | { id: string; label: string; does: 'open'; open: 'store-product' | 'category' };

type Engine = QuickEngine | 'image';

const run = (id: string, label: string, engine: Engine, prompt: string): QuickAction => ({ id, label, does: 'run', engine, prompt });
const fill = (id: string, label: string, engine: Engine, text: string): QuickAction => ({ id, label, does: 'fill', engine, text });
const panel = (id: string, label: string): QuickAction => ({ id, label, does: 'panel' });
const pick = (id: string, label: string, what: 'link' | 'menu'): QuickAction => ({ id, label, does: 'pick', pick: what });
const tool = (id: string, label: string, own: OwnTool): QuickAction => ({ id, label, does: 'own', own });
const cross = (to: 'record' | 'template', kind: 'product' | 'post'): QuickAction => ({
  id: `cross-${to}`, label: to === 'record' ? CROSSING_WORDS.editRecord[kind] : CROSSING_WORDS.editTemplate[kind], does: 'cross', to,
});
const open = (id: string, label: string, what: 'store-product' | 'category'): QuickAction => ({ id, label, does: 'open', open: what });

/** What the window's actions are tailored to. */
export type ActionType =
  | 'heading' | 'paragraph' | 'button' | 'link' | 'label' | 'quote' | 'list' | 'table'
  | 'textbox' | 'searchbox' | 'dropdown' | 'checkbox' | 'slider' | 'picker' | 'upload' | 'form'
  | 'image' | 'embed' | 'card' | 'grid' | 'row' | 'group' | 'section' | 'chrome' | 'navigation'
  | 'product' | 'products' | 'post' | 'posts' | 'fact' | 'social'
  | 'accordion' | 'cover' | 'media-text' | 'other';

const TEXT_TYPES: Record<string, ActionType> = {
  'text-heading': 'heading', 'text-paragraph': 'paragraph', 'text-button': 'button', 'text-link': 'link',
  'text-label': 'label', 'text-quote': 'quote', 'text-list': 'list', 'text-table': 'table',
  accordion: 'accordion', 'layout-cover': 'cover', 'layout-media': 'media-text', navigation: 'navigation', social: 'social', image: 'image',
};

/** A field's type from its name in the owner's words (the frame's fieldWord). */
function fieldType(word: string): ActionType {
  if (word === 'Search box') return 'searchbox';
  if (word === 'Dropdown' || word === 'Choice list') return 'dropdown';
  if (word === 'Checkbox' || word === 'Choice') return 'checkbox';
  if (word === 'Slider') return 'slider';
  if (/picker$/i.test(word)) return 'picker';
  if (word === 'File upload') return 'upload';
  return 'textbox';
}

/** What the selection is, for its actions. */
export function actionTypeOf(sel: ElementSelection): ActionType {
  switch (sel.kind) {
    case 'chrome': return 'chrome';
    case 'section': return 'section';
    case 'product': return 'product';
    case 'post': return 'post';
    case 'collection': return sel.label === 'Post list' ? 'posts' : 'products';
    case 'form': return 'form';
    case 'field': return fieldType(sel.field?.word || sel.label || '');
    case 'embed': return 'embed';
    case 'image': return 'image';
    case 'fact': return 'fact';
    case 'social': return 'social';
    case 'menu-item': return 'navigation';
    case 'group': return sel.label === 'Card' ? 'card' : sel.label === 'Grid' ? 'grid' : sel.label === 'Row' ? 'row' : 'group';
    default: break;
  }
  if (sel.category === 'layout-section') return 'section';
  if (sel.category === 'interactive' && sel.field) return fieldType(sel.field.word);
  if (sel.category === 'interactive' && /form/i.test(sel.label || '')) return 'form';
  return TEXT_TYPES[sel.category] || 'other';
}

const FIX = 'Fix any spelling, grammar or punctuation mistakes. Keep the meaning and the style.';
const ALT = 'Write descriptive, accessible alt text for this image, under 125 characters.';

/** The actions of each type, before the ones the selection cannot run are left out. */
function actionsOf(type: ActionType, sel: ElementSelection): QuickAction[] {
  const required = sel.field?.required
    ? run('optional', 'Make It Optional', 'section', 'Make this field optional.')
    : run('required', 'Make It Required', 'section', 'Make this field required.');
  const newLabel = fill('label', 'New Label…', 'section', 'Change this field\'s label to [new label]');
  const goesTo = sel.link && !sel.button ? [pick('where', 'Change Where It Goes', 'link')] : [];
  const tab = sel.link
    ? sel.link.target === '_blank'
      ? [run('same-tab', 'Open In The Same Tab', 'section', 'Make this link open in the same tab.')]
      : [run('new-tab', 'Open In A New Tab', 'section', 'Make this link open in a new tab.')]
    : [];
  switch (type) {
    case 'heading': return [
      run('rewrite', 'Rewrite', 'element', 'Rewrite this heading to be more compelling. Keep it concise.'),
      run('shorter', 'Shorter', 'element', 'Make this heading shorter while keeping its meaning.'),
      run('punchier', 'Punchier', 'element', 'Make this heading punchier and more memorable, with the same meaning.'),
      run('fix', 'Fix Spelling', 'element', FIX),
    ];
    case 'paragraph': return [
      run('rewrite', 'Rewrite', 'element', 'Rewrite this paragraph to be clearer and more engaging.'),
      run('shorter', 'Shorter', 'element', 'Cut this paragraph to about half its length, keeping the key points.'),
      run('longer', 'Longer', 'element', 'Expand this paragraph with more detail or an example.'),
      run('simpler', 'Simpler', 'element', 'Simplify this paragraph: shorter sentences and everyday words.'),
      run('fix', 'Fix Spelling', 'element', FIX),
    ];
    case 'button':
      if (sel.button?.does === 'add-to-cart') return [
        run('rewrite', 'Rewrite', 'element', 'Rewrite this button\'s words to make adding to the cart more inviting. Keep it to 1 to 3 words.'),
        run('stand-out', 'Make It Stand Out', 'section', 'Make this button stand out more, with a stronger color or size that fits the design.'),
      ];
      return [
        run('rewrite', 'Rewrite', 'element', 'Rewrite this button\'s words to be more action-oriented.'),
        run('shorter', 'Shorter', 'element', 'Make this button\'s words shorter (2 to 4 words), keeping the call to action clear.'),
        run('urgent', 'More Urgent', 'element', 'Rewrite this button\'s words to encourage acting now.'),
        ...goesTo,
        run('stand-out', 'Make It Stand Out', 'section', 'Make this button stand out more, with a stronger color or size that fits the design.'),
      ];
    case 'link': return [
      run('rewrite', 'Rewrite', 'element', 'Rewrite this link\'s words to be clearer and more inviting. Keep it short.'),
      run('say-where', 'Say Where It Goes', 'element', 'Rewrite this link\'s words so they say where it leads (never "click here" or "read more" alone). Keep it short.'),
      ...goesTo,
      ...tab,
      run('to-button', 'Turn Into A Button', 'section', 'Turn this link into a button that matches the site\'s buttons.'),
    ];
    case 'label': return [
      run('rewrite', 'Rewrite', 'element', 'Rewrite this form label to be clearer and friendlier. Keep it short.'),
      run('shorter', 'Shorter', 'element', 'Make this form label shorter.'),
      run('fix', 'Fix Spelling', 'element', FIX),
    ];
    case 'quote': return [
      run('rewrite', 'Rewrite', 'element', 'Rewrite this quote to be more impactful, keeping who said it.'),
      run('shorter', 'Shorter', 'element', 'Make this quote more concise, keeping its core message.'),
    ];
    case 'list': return [
      run('rewrite', 'Rewrite', 'element', 'Rewrite the items of this list to be clearer and consistent.'),
      run('shorter', 'Shorter', 'element', 'Make each item of this list more concise.'),
      run('add-items', 'Add Items', 'element', 'Add 2 or 3 more relevant items to this list, in the same style.'),
    ];
    case 'table': return [
      run('rewrite', 'Rewrite', 'element', 'Rewrite the words in this table to be clearer, keeping its rows and columns.'),
      run('fix', 'Fix Spelling', 'element', FIX),
    ];
    case 'textbox': return [
      newLabel,
      fill('placeholder', 'New Placeholder…', 'section', 'Change this field\'s placeholder to [new placeholder]'),
      required,
      run('remove', 'Remove Field', 'section', 'Remove this field from the form.'),
    ];
    case 'searchbox': return [
      fill('placeholder', 'New Placeholder…', 'section', 'Change this search box\'s placeholder to [new placeholder]'),
      run('remove', 'Remove Search', 'section', 'Remove this search box.'),
    ];
    case 'dropdown': return [
      // A designed form's choices change in a list in the window (2026-10-19); another form's, in words.
      tool('form-choices', 'Change Choices', 'form-choices'),
      fill('choices', 'Edit Choices…', 'section', `Make this field's choices: [${sel.field?.options.length ? sel.field.options.slice(0, 6).join(', ') : 'choices, separated by commas'}]`),
      fill('add-choice', 'Add A Choice…', 'section', 'Add the choice [new choice] to this field'),
      newLabel,
      required,
    ];
    case 'checkbox': return [
      run('rewrite', 'Rewrite Its Words', 'section', 'Rewrite the words next to this box to be clearer.'),
      required,
      run('remove', 'Remove', 'section', 'Remove this box from the form.'),
    ];
    case 'slider': return [
      fill('range', 'Change Range…', 'section', 'Make this slider go from [lowest] to [highest]'),
      newLabel,
    ];
    case 'picker': return [newLabel, required];
    case 'upload': return [
      newLabel,
      fill('files', 'Allowed Files…', 'section', 'Only accept these files here: [file types]'),
      required,
    ];
    case 'form': return [
      fill('add-field', 'Add A Field…', 'section', 'Add a field asking for [what to ask]'),
      fill('remove-field', 'Remove A Field…', 'section', 'Remove the [which field] field'),
      run('button', 'Rewrite The Button', 'section', 'Rewrite the words of this form\'s send button to be more inviting.'),
      panel('panel', 'Where Messages Go'),
    ];
    // One way to another picture in every editor (2026-10-19): your images, an upload, or made with AI from this one.
    case 'image': return [
      tool('change', 'Change The Picture', 'page-picture'),
      run('alt', 'Write Alt Text', 'alt', ALT),
      run('caption', 'Add A Caption', 'section', 'Add a short caption under this image (1 or 2 sentences), from the page around it.'),
    ];
    case 'embed': return [
      fill('show', 'Change What It Shows…', 'section', 'Make this embed show [an address, a video or a link]'),
      run('taller', 'Taller', 'section', 'Make this embed taller.'),
      run('shorter', 'Shorter', 'section', 'Make this embed shorter.'),
      run('remove', 'Remove', 'section', 'Remove this embed.'),
    ];
    case 'card': return [
      run('words', 'Improve The Words', 'section', 'Rewrite the words in this card to be clearer and more engaging, keeping its layout.'),
      run('stand-out', 'Make It Stand Out', 'section', 'Make this card stand out from the ones around it, in a way that fits the design.'),
      fill('background', 'Background…', 'section', 'Give this card a [color or picture] background'),
      run('remove', 'Remove Card', 'section', 'Remove this card.'),
    ];
    case 'grid': return [
      run('add', 'Add An Item', 'section', 'Add one more item to this grid, like the others.'),
      fill('remove', 'Remove An Item…', 'section', 'Remove the item [which item] from this grid'),
      fill('columns', 'Columns…', 'section', 'Show this grid in [number] columns'),
      run('spacing', 'Even Spacing', 'section', 'Make the spacing in this grid even.'),
    ];
    case 'row': return [
      run('add', 'Add An Item', 'section', 'Add one more item to this row, like the others.'),
      fill('remove', 'Remove An Item…', 'section', 'Remove the item [which item] from this row'),
      run('spacing', 'Even Spacing', 'section', 'Make the spacing in this row even.'),
    ];
    case 'group': return [
      run('words', 'Improve The Words', 'section', 'Rewrite the words in this part to be clearer and more engaging, keeping its layout.'),
      run('spacing', 'More Space', 'section', 'Give this part more breathing room.'),
      fill('background', 'Background…', 'section', 'Give this part a [color or picture] background'),
    ];
    case 'section': return [
      run('words', 'Improve The Words', 'section', 'Rewrite all the words in this section to be clearer and more engaging, keeping its layout.'),
      fill('background', 'Background…', 'section', 'Give this section a [color, gradient or picture] background'),
      run('spacing', 'More Space', 'section', 'Give this section more breathing room.'),
      fill('add', 'Add Something…', 'section', 'Add [what to add] to this section'),
    ];
    case 'chrome': return [
      run('words', 'Improve The Words', 'section', 'Rewrite the words here to be clearer, keeping the layout.'),
      pick('add-link', 'Add A Link', 'menu'),
      fill('restyle', 'Restyle…', 'section', 'Restyle this: [how it should look]'),
    ];
    case 'navigation': return [
      pick('add-page', 'Add A Page', 'menu'),
      fill('rename', 'Rename A Link…', 'section', 'Rename the menu link [current name] to [new name]'),
      fill('move', 'Move A Link…', 'section', 'Move the menu link [which link] [where to]'),
      fill('remove', 'Remove A Link…', 'section', 'Remove the menu link [which link]'),
    ];
    case 'product': return [
      panel('panel', 'Edit This Product'),
      run('stand-out', 'Make It Stand Out', 'section', 'Make this product card stand out from the ones around it, in a way that fits the design.'),
      run('remove', 'Remove From Here', 'section', 'Remove this product card from here (the product stays in the store).'),
    ];
    case 'products': return [
      run('more', 'Show More', 'section', 'Show more products in this list, in the same style.'),
      run('fewer', 'Show Fewer', 'section', 'Show fewer products in this list.'),
      fill('choose', 'Choose Products…', 'section', 'Show these products here: [products]'),
    ];
    case 'post': return [panel('panel', 'Edit This Post')];
    case 'posts': return [
      run('more', 'Show More', 'section', 'Show more posts in this list, in the same style.'),
      run('fewer', 'Show Fewer', 'section', 'Show fewer posts in this list.'),
    ];
    case 'fact': return [panel('panel', 'Change It Everywhere')];
    case 'social': return [
      fill('add', 'Add A Network…', 'section', 'Add a link to our [network] profile: [web address]'),
      fill('remove', 'Remove One…', 'section', 'Remove the [network] link'),
    ];
    case 'accordion': return [
      run('rewrite', 'Rewrite All', 'section', 'Rewrite all questions and answers here to be clearer and more helpful, keeping the structure.'),
      run('expand', 'Longer Answers', 'section', 'Expand each answer with more helpful detail, keeping them scannable.'),
      run('shorten', 'Shorter Answers', 'section', 'Make each answer 1 or 2 sentences, keeping the key information.'),
      run('add', 'Add Questions', 'section', 'Add 3 more relevant questions with their answers, in the same style.'),
    ];
    case 'cover': return [
      run('rewrite', 'Rewrite', 'section', 'Rewrite the words on this cover to be more compelling.'),
      fill('background', 'Background…', 'section', 'Give this cover a background of [what it shows], keeping the words easy to read'),
      run('overlay', 'Clearer Words', 'section', 'Adjust the overlay on this cover so its words read clearly while the picture stays strong.'),
    ];
    case 'media-text': return [
      run('rewrite', 'Rewrite', 'section', 'Rewrite the words beside the picture to be more engaging.'),
      run('shorten', 'Shorter', 'section', 'Shorten the words beside the picture, keeping the key points.'),
      fill('picture', 'New Picture…', 'section', 'Replace the picture with one of [what it shows]'),
    ];
    default: return [];
  }
}

/**
 * The post editor and the product editor (2026-10-18, 2026-10-19), by the
 * part of the post or the product selected:
 * - a title, a product's name: typed in place, or rewritten in the chat
 *   (the Content Writer, the E-commerce Manager);
 * - a post's words: rewritten like a page's (the post's text, aimed at the
 *   element), its tone too;
 * - a product's descriptions: rewritten (rewrite_product_text, a preview
 *   to apply), or typed in place;
 * - a price: a field in the window (Change Price, Put On Sale), or End Sale
 *   at once;
 * - pictures: replaced from the media library, added (a product's gallery),
 *   made in the site's style (a preview), removed; a featured picture's alt
 *   text; a picture in a post's words replaced wherever it shows;
 * - a product's category: a list of the store's, or a new one.
 * own: the post or the product as the window read it (its prices, its pictures).
 */
function ownContentActions(sel: ElementSelection, own: OwnItem | null): QuickAction[] {
  const part = ownPartOf(sel);
  if (sel.single === 'product') {
    const product = own?.kind === 'product' ? own.product : null;
    switch (part) {
      case 'Title': return [run('rewrite', 'Rewrite', 'chat', 'Rewrite this product\'s name to be clearer and more appealing. Keep it short.')];
      case 'Price': return [
        tool('price', 'Change Price', 'price'),
        ...(product?.onSale ? [tool('end-sale', 'End Sale', 'end-sale')] : [tool('sale', 'Put On Sale', 'sale')]),
      ];
      case 'Short description':
      case 'Description':
        // None yet (the editor's own line where it would show): written from what the store knows, or typed.
        if (sel.empty) return [
          run('write', 'Write It', 'element', `Write this product's ${part.toLowerCase()} from what the store knows about it, without inventing facts.`),
          fill('write-about', 'Write About…', 'element', `Write the ${part.toLowerCase()} about [what to say]`),
        ];
        return [
          run('rewrite', 'Rewrite', 'element', 'Rewrite this to be more compelling, keeping every fact.'),
          run('shorter', 'Shorter', 'element', 'Make this shorter, keeping the key facts.'),
          run('longer', 'Longer', 'element', 'Make this longer with more useful detail about the product, without inventing facts.'),
          run('simpler', 'Simpler', 'element', 'Make this simpler: shorter sentences and everyday words, keeping every fact.'),
          run('fix', 'Fix Spelling', 'element', FIX),
        ];
      case 'Pictures': {
        const shown = ownPictureShown(sel, own);
        // Change and Add open your images, an upload, or a picture made with AI (a printed product: never AI, its panel says so).
        return [
          tool('replace', shown ? 'Change The Picture' : 'Choose A Picture', 'picture'),
          tool('add', 'Add A Picture', 'add-picture'),
          ...((product?.pictures.length ?? 0) > 1 ? [tool('reorder', 'Reorder', 'reorder')] : []),
          ...(shown ? [tool('remove', 'Remove', 'remove-picture'), tool('alt', 'Write Alt Text', 'alt')] : []),
          // How the picture is framed is the product page's (every product's).
          cross('template', 'product'),
        ];
      }
      case 'Category': return [tool('category', 'Change Category', 'category')];
      // Its options (colours, sizes): their values and prices in a list in the window (2026-10-19).
      case 'Options': return [tool('options', 'Change Options', 'product-options')];
      // Typed in place, or read only (Reviews).
      default: return [];
    }
  }
  if (part === 'Title') return [run('rewrite', 'Rewrite', 'chat', 'Rewrite this post\'s title to be more compelling. Keep it short.')];
  if (part === 'Featured image') return [
    tool('replace', ownPictureShown(sel, own) ? 'Change The Picture' : 'Choose A Picture', 'picture'),
    ...(ownPictureShown(sel, own) ? [tool('remove', 'Remove', 'remove-picture'), tool('alt', 'Write Alt Text', 'alt')] : []),
    cross('template', 'post'),
  ];
  if (part === 'Categories') return [tool('categories', 'Change Categories', 'post-categories')];
  if (part === 'Tags') return [tool('tags', 'Change Tags', 'tags')];
  // Typed in place; an empty one written by the Content Writer.
  if (part === 'Summary') return sel.empty ? [run('write', 'Write It', 'chat', 'Write a summary of this post in one or two sentences and save it as its excerpt.')] : [];
  if (part === 'Date') return [];
  if (sel.label === 'Content') return [
    run('words', 'Improve The Words', 'element', 'Rewrite this post\'s words to be clearer and more engaging, keeping its structure and its headings.'),
    run('shorter', 'Shorter', 'element', 'Make this post shorter, keeping its key points.'),
    run('longer', 'Longer', 'element', 'Expand this post with more useful detail and examples.'),
    run('fix', 'Fix Spelling', 'element', FIX),
    fill('tone', 'Change Tone…', 'element', 'Change the tone of this post to [the tone], keeping what it says'),
    fill('add', 'Add A Part…', 'element', 'Add [what to add] to this post'),
  ];
  // A picture in the post's words: the file, wherever it shows; its alt text.
  if (sel.category === 'image') return mediaIdOf(sel) !== null ? [tool('replace', 'Change The Picture', 'content-picture'), run('alt', 'Write Alt Text', 'alt', ALT)] : [];
  const type = actionTypeOf(sel);
  return ['heading', 'paragraph', 'list', 'quote', 'table'].includes(type) ? actionsOf(type, sel) : [];
}

/**
 * The quick actions of a selection, labelled in the window's casing: its
 * type's, without the ones it cannot run (a change with no place in the
 * engine, an image with no media id for its alt text, a panel it has not).
 * own: the post or the product a part of its own page belongs to, once read.
 */
export function quickActionsFor(sel: ElementSelection, map: SiteMap | null, own: OwnItem | null = null): QuickAction[] {
  const place = !!containerOf(sel, map);
  const panelKind = (sel.engine?.drill || sel.engine?.object || sel.engine?.container)?.kind || '';
  // A post's or a product's own page: its content changes in the post or the product.
  if (sel.single) {
    return ownContentActions(sel, own)
      .filter((a) => a.does !== 'run' || a.engine !== 'alt' || mediaIdOf(sel) !== null)
      .map((a) => ({ ...a, label: caseLabel(a.label) }));
  }
  // A category's own words (a category page's heading) and a filter chip: the category itself (2026-10-19).
  if (sel.term && sel.term.field !== 'category') {
    return [
      tool('rename', 'Rename Category', 'term-name'),
      tool('describe', 'Change Description', 'term-description'),
      ...(sel.term.field === 'chip' && sel.link?.url ? [open('open-category', 'Open This Category', 'category')] : []),
    ].map((a) => ({ ...a, label: caseLabel(a.label) }));
  }
  // The product page's part showing the product's own (the picture's frame): that product, in its editor.
  const crossing = sel.holdsOwn && (sel.template === 'product' || sel.template === 'post') ? [cross('record', sel.template)] : [];
  const can = (a: QuickAction): boolean => {
    if (a.does === 'panel') {
      const wants = actionTypeOf(sel);
      return (wants === 'product' && panelKind === 'product') || (wants === 'post' && panelKind === 'post')
        || (wants === 'form' && panelKind === 'form') || (wants === 'fact' && panelKind === 'fact');
    }
    if (a.does === 'pick') return place;
    // A page's parts have no tools of their own (a post's or a product's do), but a picture the engine addresses.
    if (a.does === 'own') {
      if (a.own === 'form-choices') return !!formFieldOf(sel, map);
      return a.own === 'page-picture' && sel.engine?.drill?.kind === 'image';
    }
    // The list replaces the words for a designed form's choices.
    if (a.does === 'fill' && (a.id === 'choices' || a.id === 'add-choice') && formFieldOf(sel, map)) return false;
    if (a.does === 'cross' || a.does === 'open') return true;
    if (a.engine === 'alt') return mediaIdOf(sel) !== null || !!designPictureOf(sel, map);
    if (a.engine === 'image') return (sel.engine?.drill?.kind === 'image') || place;
    return place;
  };
  return [...crossing, ...actionsOf(actionTypeOf(sel), sel).filter(can)].map((a) => ({ ...a, label: caseLabel(a.label) }));
}

/**
 * How the box's own words are carried out for an element category; a
 * section's own part (a card, a field, an embed) changes in its section.
 */
export function freeformEngine(category: string, kind?: string): QuickEngine {
  if (kind === 'group' || kind === 'field' || kind === 'embed') return 'section';
  if (category.startsWith('text-') && category !== 'text-code') return 'element';
  if (category.startsWith('layout-') || category === 'accordion' || category === 'image' || category === 'media' || category === 'gallery') return 'section';
  return 'chat';
}
