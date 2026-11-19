/**
 * A post, page, product or translation the AI team wants to put on the
 * owner's site, drawn the way the site will show it (SitePostPreview.tsx, on
 * an approval card), and its short card on Home (SiteChangeSummary.tsx): what
 * the change is, an update's After and Before, and the buttons that show the
 * whole post.
 *
 * English is the source; the French is written by hand (src/i18n/fr.json,
 * namespace screensSitePost), the other languages by the dashboard's
 * translation script.
 */
import { localized } from '@yotako/webmaven-ui';

export const SITE_POST_COPY_EN = {
  /** What the change is, above the drawn page (small, bold). */
  kind: {
    /** A new article for the site's blog. */
    post: 'New blog post',
    /** A new page of the site. */
    page: 'New page',
    /** An update of a page that is on the site now. */
    update: 'Change to a page on your site',
    /** A translation of a page (not "new": it may rewrite the one there now). */
    translation: 'Translation',
    /** A new product for sale on the site. */
    product: 'New product',
  },
  /** The name of the drawn page for screen readers, when it has a title; {0} its title. */
  frameNamed: (title: string) => `Preview of "${title}"`,
  /** The name of the drawn page for screen readers, when it has no title. */
  frame: {
    /** A blog post. */
    post: 'Preview of the post',
    /** A page. */
    page: 'Preview of the page',
    /** An update of a page. */
    update: 'Preview of the page',
    /** A translation. */
    translation: 'Preview of the translation',
    /** A product. */
    product: 'Preview of the product',
  },
  /** The button under a page cut short in a list: shows all of it. */
  showFull: {
    /** A blog post. */
    post: 'Show the full post',
    /** A page. */
    page: 'Show the full page',
    /** An update of a page. */
    update: 'Show the full page',
    /** A translation. */
    translation: 'Show the full translation',
    /** A product. */
    product: 'Show the full product',
  },
  /** The same button once the whole page shows: cuts it short again. */
  showLess: {
    /** A blog post. */
    post: 'Show less of the post',
    /** A page. */
    page: 'Show less of the page',
    /** An update of a page. */
    update: 'Show less of the page',
    /** A translation. */
    translation: 'Show less of the translation',
    /** A product. */
    product: 'Show less of the product',
  },
  /** Home's card of a change: the button to the approval's card, where the whole page is drawn. */
  seeFull: {
    /** A blog post. */
    post: 'See the full post',
    /** A page. */
    page: 'See the full page',
    /** An update of a page. */
    update: 'See the full change',
    /** A translation. */
    translation: 'See the full translation',
    /** A product. */
    product: 'See the full product',
  },
  /** Read by screen readers: the name of the two buttons that switch between the new version and the page as it is now. */
  versionsLabel: 'Which version to show',
  /** That switch's button: the page as the change makes it. */
  after: 'After this change',
  /** That switch's button: the page as it is now. */
  before: 'Before',
  /** While the page as it is now loads from the owner's site. */
  loadingBefore: 'Loading the current version from your site...',
  /** The button back to the new version when Before has nothing to show. */
  showNew: 'Show the new version',
  /** Before could not be loaded from the site. */
  beforeFailed: 'We could not load the current version from your site. Try again in a minute.',
  /** Before, once the change ran. */
  beforeAlreadyChanged: 'This change has already been made, so your site shows the new version now.',
  /** Before, for a change that never ran. */
  beforeNotMade: 'This change was not made, so your site still shows the page as it was.',
  /** Before, when the page had no earlier version. */
  beforeNone: 'There is no earlier version to show.',
};

export const SITE_POST_COPY = localized(SITE_POST_COPY_EN, 'screensSitePost');
