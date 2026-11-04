/**
 * The plugin's three guided tours (1.7.0), on the kit's tour engine.
 *
 *   full       everything but the editor, for someone who signed in with
 *              WordPress's own form. Its last step points at the top bar's
 *              Editor and waits for the click; the editor's tour follows.
 *   wordpress  only what is the plugin's own, for someone who came from the
 *              dashboard, which already showed them the rest: the switch,
 *              their posts and pictures, WordPress's screens, View site,
 *              help. No Edit site step.
 *   editor     the editor: the page, the pages, the chat, all settings, and
 *              how a change goes live.
 *
 * Each step points at a `data-tour` value the app draws (a step with
 * several takes the first one on screen); a step whose element is not there
 * for this person (another role, no store) is passed. The full and
 * WordPress tours live on Overview, the editor's on the Editor page: started
 * from the "?" elsewhere, the tour opens its page first.
 *
 * The sidebar rows read their names from the route registry, so a renamed
 * entry (Tasks, now Your team) is named the same in the tour.
 */
import type { TourDefinition, TourStep } from '@yotako/webmaven-ui';
import { routeById } from '../pages/registry/routes';
import { dashboardPhrase } from '../../../utils/brand';

export type PluginTourId = 'full' | 'wordpress' | 'editor';

/** The pages the tours live on (DashboardContext's page ids). */
export const OVERVIEW_PAGE = 'home';
export const EDITOR_PAGE = 'site-editor';

/** Bumped when a tour changes enough to be offered again to everyone. */
export const TOUR_VERSIONS: Readonly<Record<PluginTourId, number>> = { full: 1, wordpress: 1, editor: 1 };

/** The editor has loaded: its toolbar, or the note that says it cannot open now. */
const EDITOR_READY = ['[data-tour="editor-bar"]', '[data-testid="editor-unavailable"]'] as const;

const label = (routeId: string, fallback: string): string => routeById(routeId)?.label ?? fallback;
const onOverview = (steps: TourStep[]): TourStep[] => steps.map((step) => ({ page: OVERVIEW_PAGE, screen: 'Overview', ...step }));
const inEditor = (steps: TourStep[]): TourStep[] => steps.map((step) => ({ page: EDITOR_PAGE, screen: 'the editor', ready: EDITOR_READY, ...step }));

const HELP_STEP: TourStep = {
  id: 'help',
  anchor: 'help',
  placement: 'below',
  title: 'Help, any time',
  body: 'Take this tour again, or the editor\'s, from this button whenever you like.',
};

const VIEW_SITE_STEP: TourStep = {
  id: 'view-site',
  anchor: ['view-site', 'open-site'],
  placement: 'right',
  title: 'View site',
  body: 'Opens your site in a new tab, the way your visitors see it.',
};

const WORDPRESS_STEP: TourStep = {
  id: 'wordpress',
  anchor: 'group-wordpress',
  placement: 'right',
  title: 'WordPress',
  body: 'WordPress\'s own screens are still here, for when you need them.',
};

export function fullTour(): TourDefinition {
  return {
    id: 'full',
    version: TOUR_VERSIONS.full,
    steps: onOverview([
      {
        id: 'welcome',
        anchor: 'welcome',
        placement: 'below',
        title: 'Welcome to your site',
        body: 'This is Overview: what is happening on your site, and what your team is doing. Here is a quick look around.',
      },
      {
        id: 'chat',
        anchor: 'chat',
        title: 'Ask your Co-CEO',
        body: 'Write what you want in your own words, like "add a spring sale banner". Your team plans it and gets it done.',
      },
      {
        id: 'waiting',
        anchor: 'waiting',
        placement: 'right',
        title: label('approvals', 'Waiting for you'),
        body: 'Nothing goes live without your yes. What your team prepared waits here for you to approve.',
      },
      {
        id: 'messages',
        anchor: 'messages',
        placement: 'right',
        title: label('messages', 'Messages'),
        body: 'What people send through your site\'s forms lands here, so you can answer them.',
      },
      {
        id: 'team',
        anchor: 'team',
        placement: 'right',
        title: label('team', 'Your team'),
        body: 'What your team plans to do next, and when.',
      },
      {
        id: 'content',
        anchor: 'group-content',
        placement: 'right',
        title: 'Content',
        body: 'Your blog posts and your pictures.',
      },
      {
        id: 'store',
        anchor: 'group-store',
        placement: 'right',
        title: 'Store',
        body: 'Your products and orders, how you get paid, and what you earn.',
      },
      {
        id: 'insights',
        anchor: 'group-insights',
        placement: 'right',
        title: 'Insights',
        body: 'Who visits your site, your reports, and everything your team did.',
      },
      WORDPRESS_STEP,
      VIEW_SITE_STEP,
      {
        id: 'account',
        anchor: 'account',
        placement: 'right',
        title: 'Your account',
        body: 'Your settings, your plan, and the light or dark look.',
      },
      {
        id: 'bell',
        anchor: 'bell',
        placement: 'below',
        title: 'Alerts',
        body: 'The bell tells you when something on your site needs a look.',
      },
      HELP_STEP,
      // The Editor in the top bar's switch, on every screen, not the menu's row.
      {
        id: 'edit-site',
        anchor: 'switch-editor',
        placement: 'below',
        waitFor: 'click',
        title: 'Edit your site',
        body: 'Click Editor to change your pages yourself: their words, pictures and colors. A short tour of the editor comes next.',
      },
    ]),
  };
}

export function wordpressTour(): TourDefinition {
  return {
    id: 'wordpress',
    version: TOUR_VERSIONS.wordpress,
    steps: onOverview([
      {
        id: 'welcome',
        anchor: 'welcome',
        placement: 'below',
        title: 'Your site, in WordPress',
        body: `Everything from ${dashboardPhrase()} is here too. Here is what only your site has.`,
      },
      {
        id: 'switch',
        anchor: 'switch',
        placement: 'below',
        title: 'Overview and Editor',
        body: 'Switch between this page and the editor, where you change your pages yourself.',
      },
      {
        id: 'content',
        anchor: 'group-content',
        placement: 'right',
        title: 'Your posts and pictures',
        body: 'They live on your site. Change them here, without leaving WordPress.',
      },
      WORDPRESS_STEP,
      VIEW_SITE_STEP,
      HELP_STEP,
    ]),
  };
}

export function editorTour(): TourDefinition {
  return {
    id: 'editor',
    version: TOUR_VERSIONS.editor,
    steps: inEditor([
      {
        id: 'canvas',
        anchor: ['editor-quick', 'editor-hint', 'editor-canvas'],
        title: 'Click to change',
        body: 'This is your page as visitors see it. Click any text, picture or button, and a small window opens to change it.',
      },
      {
        id: 'pages',
        anchor: ['editor-pages', 'editor-page-picker'],
        placement: 'right',
        title: 'Your pages',
        body: 'Pick the page, post or product to work on.',
      },
      {
        id: 'chat',
        anchor: ['editor-chat', 'editor-chat-toggle'],
        placement: 'left',
        title: 'Ask for bigger changes',
        body: 'Tell your Co-CEO what you want on this page, like "make the header darker", and your team does it.',
      },
      {
        id: 'settings',
        anchor: 'editor-settings',
        placement: 'left',
        title: 'All settings',
        body: 'Colors and fonts, your details, menus and search, for the whole site.',
      },
      {
        id: 'publish',
        anchor: ['editor-history', 'editor-undo'],
        placement: 'below',
        title: 'Live right away',
        body: 'A change goes live as soon as you apply it. Undo takes back the last one, and History keeps them all.',
      },
    ]),
  };
}

/** The three tours, read when the app starts (the brand and the routes' names are known by then). */
export function pluginTours(): TourDefinition[] {
  return [fullTour(), wordpressTour(), editorTour()];
}
