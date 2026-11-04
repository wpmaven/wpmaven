import type { ReactNode } from 'react';
import type { DecideResult, OperatorApproval, TikTokConsentInput, TikTokDraftInput, YouTubeUploadInput } from '../approvals/types';
import type { Receipt, ReceiptTone } from '../approvals/receipts';
import type { TeamConnectFlowProps } from '../team/ConnectTab';
import type { GatewaySetupHost } from '../home/getPaid';

/**
 * The one contract between a screen and the app that mounts it (2026-10-16).
 *
 * A screen reads no window global, no router, no storage and no API client
 * of its own: what differs between the dashboard and the WordPress plugin
 * arrives here. The dashboard builds a host on its API client and
 * react-router for the whole account; the plugin builds one on its REST
 * proxy for its own site. Both draw the same screen.
 */
export interface ScreensHost {
  transport: ScreensTransport;
  /** Whose data the screen reads: the account (the dashboard) or one site (the plugin). */
  scope: ScreensScope;
  /**
   * Go to a page. `to` is one of the dashboard's own addresses ('/engagement',
   * '/billing', '/instances/<id>'): the dashboard routes it, the plugin maps
   * it to its own page or opens the dashboard.
   */
  navigate(to: string): void;
  /**
   * The address of a page, for a link's href (the same addresses as
   * navigate). A relative address stays in the app (a click goes through
   * navigate); an absolute one (http or https) opens in a new tab, as the
   * plugin's links to the dashboard do.
   */
  link(to: string): string;
  /**
   * The account's businesses, by id and name (account scope): each card
   * names its business, and the customers are looked for on them. Null
   * while they load. Never read in site scope.
   */
  businesses?: ReadonlyArray<ScreensBusiness> | null;
  /** What the person looking at the screen may do. Absent: the owner. */
  viewer?: ScreensViewer;
  /** The pieces only the app draws. */
  renderers?: ScreensRenderers;
  /** Analytics (the dashboard's Matomo, with its value); absent: nothing is tracked. */
  track?(category: string, action: string, name?: string, value?: number): void;
  /**
   * A failure in the reader's words. Absent: the shared rule
   * (errorMessage of @yotako/wpmaven-onboarding/shared), which reads the
   * API's own sentence on a refusal and a plain one for no answer.
   */
  errorText?(error: unknown, fallback: string): string;
  /**
   * The decision call, when the app makes it its own way (the dashboard: its
   * service, which sends the version of an edit the owner picked on its
   * preview). Absent: POST /operators/approvals/:id/decide on the transport.
   */
  decide?(id: string, approved: boolean, extra: DecideExtra): Promise<DecideResult>;
  /**
   * Sharing the business's site (the milestones' Share your store): the
   * app's own share, as a hook (the dashboard's carries its referral link
   * and its analytics). Called as a hook, so it must stay the same function.
   * Absent: the browser's share sheet, else a copy of the address.
   */
  siteShare?: SiteShareHook;
  /**
   * The app is shown under another brand (White label, a hosting partner, a
   * site that names nobody): nothing names WPMaven's own programs, so a share
   * carries no referral link and Feature on WPMaven is not offered. Absent:
   * WPMaven's own.
   */
  whiteLabel?: boolean;
  /**
   * Whether a referral link at this address is recorded when someone opens
   * it (the dashboard: its own origin, or one declared for it; the plugin:
   * its dashboard's). Absent: a share never carries the account's referral
   * link (GET /referrals/me is not read).
   */
  referralLinkAttributes?(shareUrl: string): boolean;
  /**
   * The app's own address of the page being shown ('/instances/abc?tab=x'),
   * for a step of the dashboard that comes back to it (the Get paid step).
   * Absent: the step goes back to its own default.
   */
  here?(): string;
  /**
   * The dashboard's guided tour: a card that may draw nothing says it has
   * its answer for a business (Turn on a way to get paid), as a hook. Called
   * as a hook, so it must stay the same function. Absent: nothing.
   */
  tourSettled?: (key: string, scope: string | null | undefined, settled: boolean) => void;
  /**
   * Finishing a payment provider's setup on its own screen in WordPress
   * (Turn on a way to get paid): the dashboard signs the owner in to
   * wp-admin first, with its own question before it adds an account. Absent:
   * the tab opens the setup page the site sent (the plugin: the person is in
   * WordPress already).
   */
  gatewaySetup?: GatewaySetupHost;
}

/** What a share control reads and does (the milestones' Share your store). */
export interface SiteShare {
  share(): Promise<void>;
  state: 'idle' | 'copied' | 'unavailable';
  /** A native share sheet is there; otherwise the share is a copy. */
  canNative: boolean;
  /** The confirmation, or why it could not copy; '' with nothing to say. */
  status: string;
  /** What the owner is told about a link that goes with it; '' without one. */
  note: string;
  /** What is shared or copied. */
  message: string;
}

/** The app's share, as a hook: the site's address, its name, and where the control is (analytics). */
export type SiteShareHook = (siteUrl: string, siteName: string | null | undefined, where: string) => SiteShare;

/** A "?" beside a control, which explains it when asked. */
export interface HelpTipSpec {
  /** Analytics id: which controls people ask about. */
  id: string;
  /** The guide page that explains it in full (the app's own key). */
  topic: string;
  /** Names the control for a screen reader: "What does this graph mean?" */
  label: string;
  /** One or two plain sentences. */
  children: ReactNode;
}

/** What goes with a decision besides yes or no. */
export interface DecideExtra {
  /** The Post to TikTok screen's consent (the dashboard's Your team only). */
  tiktok?: TikTokConsentInput | TikTokDraftInput;
  /**
   * The YouTube upload exactly as the card shows it (its "Post to YouTube"
   * section): the title and the description, who can see it, made for kids.
   * An approve of an upload to YouTube only; sent to the API as `youtube`.
   */
  youtube?: YouTubeUploadInput;
}

/** The account (the dashboard), or one site (the plugin): every read of a site screen names its instance. */
export type ScreensScope = { kind: 'account' } | { kind: 'site'; instanceId: string };

export interface ScreensBusiness {
  id: string;
  name: string;
}

export interface ScreensViewer {
  /**
   * Staff viewing as the owner: a post to TikTok or an upload to YouTube
   * stays the owner's own (its buttons greyed, with the reason).
   */
  staffViewing?: boolean;
  /**
   * May publish or discard the changes a team member prepared (the owner and
   * admins). Absent: yes. False: that tab is neither read nor counted.
   */
  publishesPrepared?: boolean;
  /**
   * May decide money (a refund, a payments setup). Absent: yes. A row's own
   * `decidable` (the API's site view) wins over it.
   */
  decidesMoney?: boolean;
  /**
   * May write the team's tasks: New task, Run now, Pause and Resume, Stop a
   * run (the owner, admins and editors of the account's team). Absent: yes.
   * A site's scope ignores it: there only a task made in WordPress changes.
   */
  writesTasks?: boolean;
  /** May delete a task (the owner and admins). Absent: yes. */
  deletesTasks?: boolean;
  /** May add a goal (Home's Goals: a site's administrators). Absent: yes. */
  addsGoals?: boolean;
  /**
   * May set up how the store gets paid (Turn on a way to get paid): the
   * account's owner and admins; in WordPress, the owner's own account only.
   * Absent: yes. False: the card says who can (renderers.getPaidNeedsOwner).
   */
  setsUpPayments?: boolean;
  /**
   * May change the business details (Check what your site says about you):
   * the account's owner and admins; a site's administrators. Absent: yes.
   * False: the card is not drawn and nothing is read.
   */
  editsBusinessDetails?: boolean;
  /**
   * May turn Feature my business on WPMaven's channels on or off (public
   * work): in WordPress, the owner's own account only. Absent: yes. False:
   * the control is not drawn and nothing is read.
   */
  featuresBusiness?: boolean;
}

/**
 * The pieces only one app draws, each optional. Without one the screen
 * draws its own plain version, or nothing.
 */
export interface ScreensRenderers {
  /**
   * A change through the edit operations: the app's own preview card (its
   * checks, its versions, Open preview). `matches` says which rows it draws;
   * those rows show it instead of the shared preview and never their call.
   */
  editPreview?: {
    matches(approval: { toolName?: string | null; params?: unknown; edit?: unknown; metadata?: unknown }): boolean;
    render(approval: ApprovalShape, opts: { className?: string }): ReactNode;
  };
  /** A video to choose (the dashboard's choice screen summary). Absent: nothing is drawn for it. */
  videoChoice?(approval: ApprovalShape): ReactNode;
  /**
   * What a receipt offers next: the dashboard's pack choice or its next step
   * button. Absent: the step's own button (it opens `nextStep.href`).
   */
  receiptNext?(props: ReceiptNextProps): ReactNode;
  /**
   * The way out of a held card (the dashboard: buy the pack or wait, or the
   * button for why it waits). Absent: the screen's Open billing.
   */
  heldWayOut?(approval: OperatorApproval, opts: {
    onSettled(settled: { text: string; tone: ReceiptTone }): void;
    /** Where it is drawn, for the app's analytics (Home's week: 'home_week'). Absent: Waiting for you's. */
    source?: string;
  }): ReactNode;
  /** Beside the page title: the dashboard's "?" with its help. */
  titleHelp?: ReactNode;
  /** Under the page title: a line of the app's own (the dashboard's WhatsApp note). */
  headerNote?: ReactNode;
  /**
   * Your team > Connect, the account's connect flows (the dashboard: the
   * buttons that open each network's sign-in, the Page picker, the linking
   * page, what a sign-in window said when it came back). It gets the
   * channels the screen read and draws the tab through `render`, with its
   * pieces in their places. Absent, or in a site's scope: each card links
   * to the dashboard's Connect tab instead.
   */
  teamConnect?(props: TeamConnectFlowProps): ReactNode;
  /**
   * Why this person cannot set up how the store gets paid, and where it is
   * done (Turn on a way to get paid, viewer.setsUpPayments false): the
   * plugin's link to the dashboard. Absent: the account's sentence (the
   * owner or an admin can).
   */
  getPaidNeedsOwner?(): ReactNode;
  /**
   * Stripe's notification banner for a WPMaven Payments account that needs
   * something from the owner (the dashboard's embed). Absent: nothing.
   */
  stripeNotices?(instanceId: string): ReactNode;
  /** Your team > Progress, above the weekly check-ins (the dashboard: TikTok's own numbers). */
  teamProgressTop?(ctx: { instanceId: string }): ReactNode;
  /**
   * The "?" beside a control (the growth chart, the week's approvals): the
   * dashboard's, with its guide link and its analytics. Absent: the kit's
   * HelpTip, without a link.
   */
  helpTip?(tip: HelpTipSpec): ReactNode;
  /**
   * Where a list shows Approve, a video to choose shows the way to its
   * choice screen (the dashboard's Choose your video). Absent: a button to
   * the approval's own card.
   */
  videoChoiceRoute?(approval: ApprovalShape): ReactNode;
}

export interface ReceiptNextProps {
  receipt: Receipt;
  /** The approval it is about, when it is still in a list. */
  approval: OperatorApproval | null;
  /** A press on the pack choice ended: said in the receipt's place. */
  onSettled(settled: { text: string; tone: ReceiptTone }): void;
}

/** The approval fields the renderers read: a row as either view of the API sends it. */
export type ApprovalShape = Pick<OperatorApproval, 'params'> & Partial<OperatorApproval> & { metadata?: unknown };

// ── transport ────────────────────────────────────────────────────────────

/**
 * The app's way to the API. Paths are the API's own, under its /api root
 * and starting with a slash ('/operators/approvals'): the dashboard passes
 * its API client, the plugin its proxy (which drops the leading slash).
 *
 * Each call resolves with the answer's payload: the `data` of the API's
 * `{ success, data }` envelope, or the body itself for a route that answers
 * without one (the edit operations answer their EditResult as it is). It
 * rejects with a ScreensApiError (or any error with the same face): an
 * answer outside 2xx, no answer, or a timeout.
 */
export interface ScreensTransport {
  get<T = unknown>(path: string, query?: ScreensQuery, opts?: ScreensCallOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: ScreensCallOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: ScreensCallOptions): Promise<T>;
  del<T = unknown>(path: string, opts?: ScreensCallOptions): Promise<T>;
}

export type ScreensQuery = Record<string, string | number | boolean | null | undefined>;

export interface ScreensCallOptions {
  /**
   * Give up after this long. A decision publishes to each network in turn
   * inside its call (minutes), and a prepared change waits for the site: the
   * screen asks for more than the app's default there.
   */
  timeoutMs?: number;
}

/**
 * Why a call failed. It keeps the axios face (`response`, and `code` set to
 * ERR_NETWORK or ECONNABORTED when no answer came back), so the shared
 * error helpers (errorMessage, noAnswer, decisionErrorMessage) read it the
 * same way in both apps, like the wizard's WizardApiError.
 */
export class ScreensApiError extends Error {
  /** The answer's HTTP status; 0 when no answer came back. */
  readonly status: number;
  /** The API's `code` when it answered, else ERR_NETWORK or ECONNABORTED. */
  readonly code: string | null;
  /** The answer's body, or null. */
  readonly data: unknown;
  /** Present when the API answered: `{ status, data }`, as axios has it. */
  readonly response?: { status: number; data: unknown };

  constructor(init: { status: number; code?: string | null; data?: unknown; message?: string }) {
    const data = init.data ?? null;
    const fromApi = data && typeof data === 'object'
      ? ((data as { error?: unknown; message?: unknown }).error ?? (data as { message?: unknown }).message)
      : null;
    super(init.message ?? (typeof fromApi === 'string' && fromApi ? fromApi : init.status ? `Request failed with status code ${init.status}` : 'No answer'));
    this.name = 'ScreensApiError';
    this.status = init.status;
    this.data = data;
    const apiCode = data && typeof data === 'object' && typeof (data as { code?: unknown }).code === 'string'
      ? (data as { code: string }).code
      : null;
    this.code = init.code ?? apiCode;
    if (init.status > 0) this.response = { status: init.status, data };
  }
}

export function isScreensApiError(e: unknown): e is ScreensApiError {
  return e instanceof ScreensApiError || (!!e && typeof e === 'object' && (e as { name?: unknown }).name === 'ScreensApiError');
}

/**
 * The payload of an answer: the `data` of a `{ success, data }` envelope,
 * else the body as it is. For an app's transport (the dashboard's reads the
 * axios answer's body with it).
 */
export function payloadOf<T = unknown>(body: unknown): T {
  if (body && typeof body === 'object' && 'success' in body && 'data' in body) return (body as { data: T }).data;
  return body as T;
}
