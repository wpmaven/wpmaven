/**
 * Your team (the AI team page, in the dashboard and in the WordPress plugin):
 * its title and tabs (Approvals, Plan, Progress, Connect), the team's faces
 * and what each member is doing, the Plan tab's buttons and its plan line,
 * the Progress tab's link to Analytics, and the Connect tab: each channel
 * card's state, why a channel cannot take posts, the summary line, and the
 * YouTube terms the owner agrees to when connecting YouTube. The team's
 * members are AI operators with job titles (the Co-CEO, a Data Analyst...);
 * {places} carry their titles, a network's name ("Pinterest"), dates and the
 * product's name ("WPMaven", or a brand's on a branded address), all kept as
 * written.
 *
 * English is the source; the French is written by hand (src/i18n/fr.json,
 * one namespace per object below), the other languages by the dashboard's
 * translation script.
 */
import { localized } from '@yotako/webmaven-ui';

export const YOUR_TEAM_COPY_EN = {
  /** The page's title. */
  title: 'Your team',
  /** Under it, in the dashboard. */
  subtitle: "Your team's plan, its weekly progress, and the actions waiting for your yes.",
  /** Under it, in the WordPress plugin (a site), where approvals open in the dashboard. */
  siteSubtitle: "Your team's plan, its weekly progress, and the channels it posts to.",
  /** Read by screen readers: the name of the page's tabs. */
  tabsLabel: 'Your team',
  /** Button: open the Approvals tab. */
  openApprovals: 'Open Approvals',
  /** Button: open the Waiting for you page. */
  openWaiting: 'Open Waiting for you',
};

export const YOUR_TEAM_COPY = localized(YOUR_TEAM_COPY_EN, 'screensYourTeam');

export const TEAM_TABS_COPY_EN = {
  /** Tab: the work waiting for the owner's approval. */
  approvals: 'Approvals',
  /** Tab: the team's plan of tasks. */
  plan: 'Plan',
  /** Tab: the weekly check-ins against the forecast. */
  progress: 'Progress',
  /** Tab: the channels the team posts to. */
  connect: 'Connect',
  /** A tab's label with how many items wait ("Approvals (3)"); {0} the label, {1} the count. */
  withCount: (label: string, count: number) => `${label} (${count})`,
  /** The line a site shows above the tabs; {0} is how many approvals wait (a count). */
  waitingLine: (count: number) => `${count} waiting for your yes`,
};

export const TEAM_TABS_COPY = localized(TEAM_TABS_COPY_EN, 'screensTeamTabs');

export const TEAM_FACES_COPY_EN = {
  /** The heading over the team's faces. */
  heading: 'Your team',
  /** Under a face: what the member is working on; {0} is the work, as the task names it. */
  workingOn: (line: string) => `Working: ${line}`,
  /** Under a face: working, with nothing more known. */
  working: 'Working',
  /** Under a face: waiting for the owner's approval. */
  waiting: 'Waiting for your yes',
};

export const TEAM_FACES_COPY = localized(TEAM_FACES_COPY_EN, 'screensTeamFaces');

export const TEAM_PLAN_COPY_EN = {
  /** A task's button: run it now. */
  runNow: 'Run now',
  /** A task's button: pause it. */
  pause: 'Pause',
  /** A task's button: resume it. */
  resume: 'Resume',
  /** A task's button: delete it. */
  delete: 'Delete',
  /** A background run's button: stop it. */
  stop: 'Stop',
  /** A background run could not be stopped. */
  stopFailed: 'This could not be stopped. Try again in a minute.',
  /** The name in the Co-CEO's chat bubble; {0} is the member's title ("Your Co-CEO"). */
  yourMember: (title: string) => `Your ${title}`,
  /** A link from the WordPress plugin to the team's plan in the dashboard. */
  openDashboard: 'Open your dashboard',
  /** The plan's line: when it started; {0} is the date. */
  activated: (date: string) => `Activated ${date}`,
  /** After it: when the plan was last reviewed; {0} is the date. The line's parts are joined with " · ". */
  lastReviewed: (date: string) => `last reviewed ${date}`,
  /** After it: the plan's version; {0} is its number. */
  version: (n: string) => `version ${n}`,
};

export const TEAM_PLAN_COPY = localized(TEAM_PLAN_COPY_EN, 'screensTeamPlan');

export const TEAM_PROGRESS_COPY_EN = {
  /** Above the check-ins; {0} is the product's name. */
  seeEveryPost: (product: string) => `See every post ${product} published and its numbers over time.`,
  /** The link after it. */
  openAnalytics: 'Open Analytics',
};

export const TEAM_PROGRESS_COPY = localized(TEAM_PROGRESS_COPY_EN, 'screensTeamProgress');

export const CONNECT_COPY_EN = {
  /** The Connect tab could not load. */
  loadFailed: 'Could not load the Connect Center.',
  /** Button: load it again. */
  refresh: 'Refresh',
  /** When linking several networks is not set up on this server. "X" is the network, formerly Twitter. */
  notConfigured: 'Multi-network linking is not enabled on this server yet. Only the native X connection applies.',
  /** On a channel card: before the link to make an account on that network. */
  noAccount: 'No account yet?',
  /** That link. */
  createOne: 'Create one',
  /** A channel's badge: posts can go out there now. */
  live: 'Live',
  /** A channel's badge: connected, but posts cannot go out yet. */
  notPostingBadge: 'Connected, not posting yet',
  /** A channel's badge: the login must be renewed. */
  reconnectBadge: 'Needs reconnecting',
  /** A channel's badge: not connected. */
  notConnected: 'Not connected',
  /** Under a connected channel that cannot take posts, with its reason below. */
  notPostingWithReason: 'We cannot post here yet, for the reason below.',
  /** The same with no reason known. */
  notPosting: 'We cannot post here yet.',
  /** A site's note over its cards: where connecting happens; {0} is the product's name. */
  siteNote: (product: string) => `Channels belong to your ${product} account. Connect opens your dashboard in a new tab.`,
  /** Next to Reconnect; {0} is the network's name, twice. "Reconnect" is the button's name. */
  reconnectPress: (name: string) => `Your ${name} login expired or was removed, so we cannot post there. Press Reconnect and sign in to ${name} again.`,
  /** The same when Reconnect cannot be pressed; {0} is the network's name. */
  reconnect: (name: string) => `Your ${name} login expired or was removed, so we cannot post there.`,
  /** Why Reconnect cannot be pressed; {0} is the product's name, {1} the network's. */
  cannotReconnect: (product: string, name: string) => `${product} cannot reconnect ${name} from here yet.`,
  /** The summary over the cards: {0} channels can take posts, out of {1}. */
  summaryLive: (live: number, total: number) => `${live} of ${total} channels live.`,
  /** After it, when some are connected but cannot take posts yet; {0} is how many (a count). */
  summaryWaiting: (n: number) => (n === 1 ? `${n} more is connected but cannot take posts yet.` : `${n} more are connected but cannot take posts yet.`),
  /** The summary's end. */
  summaryEnd: 'Your team only posts to live channels, and always with your approval.',
  /** TikTok's card: the heading of what the app may do with the account; {0} is the product's name. */
  tiktokCan: (product: string) => `What ${product} can do with this TikTok account`,
  /** After a permission TikTok did not grant. */
  notAllowed: '(not allowed)',
  /** A channel card's button; {0} is the network's name. */
  reconnectNamed: (name: string) => `Reconnect ${name}`,
  /** A channel card's button; {0} is the network's name. */
  connectNamed: (name: string) => `Connect ${name}`,
};

export const CONNECT_COPY = localized(CONNECT_COPY_EN, 'screensTeamConnect');

export const CHANNEL_TERMS_COPY_EN = {
  /** Under YouTube's Connect: the terms the owner agrees to (YouTube's own name for them is kept as YouTube writes it in this language). */
  youtubeAgree: 'By connecting YouTube, you agree to the YouTube Terms of Service.',
  /** The link's words inside that sentence. */
  youtubeTermsLink: 'YouTube Terms of Service',
  /** Our privacy policy. */
  privacy: 'Our Privacy Policy explains what we do with your YouTube data.',
  /** The link's words inside that sentence. */
  privacyLink: 'Our Privacy Policy',
  /** Google's privacy policy. */
  googlePrivacy: 'The Google Privacy Policy also applies.',
  /** The link's words inside that sentence. */
  googlePrivacyLink: 'Google Privacy Policy',
  /** How to remove the app's access; {0} is the posting app's name. */
  youtubeRevokeBy: (app: string) => `You can also remove ${app}'s access in your Google security settings.`,
  /** The link's words inside that sentence. */
  youtubeRevokeLink: 'Google security settings',
  /** In the Disconnect YouTube confirm: what disconnecting does, and does not, delete; {0} is the product's name. */
  youtubeDisconnectBy: (product: string) => `${product} deletes the YouTube data it kept and asks Google to remove its access. Your videos and data on YouTube are not touched; to delete them, use YouTube.`,
  /** Also in it, when the owner has more than one business: Google's grant covers the channel. */
  youtubeDisconnectShared: 'If another of your businesses uses this same YouTube channel, it is disconnected too.',
  /** After disconnecting: the other businesses disconnected with it; {0} is how many (a count), {1} their names as a list, {2} the channel ("YouTube"). */
  alsoDisconnected: (n: number, names: string, channel: string) => (n === 1
    ? `${names} used the same ${channel} channel, so it is disconnected too.`
    : `${names} used the same ${channel} channel, so they are disconnected too.`),
  /** In that list, after named businesses: the ones without a name; {0} is how many (a count). */
  moreOfYours: (n: number) => (n === 1 ? 'one more of your businesses' : `${n} more of your businesses`),
  /** The same when no business in the list has a name, at the start of the sentence; {0} is how many (a count). */
  othersOfYours: (n: number) => (n === 1 ? 'Another of your businesses' : `${n} of your other businesses`),
};

export const CHANNEL_TERMS_WORDS = localized(CHANNEL_TERMS_COPY_EN, 'screensChannelTerms');
