/**
 * @yotako/wpmaven-screens: the screens the WPMaven dashboard and the
 * WordPress plugin both show, with their data, written once (2026-10-16).
 * The kit (@yotako/webmaven-ui) draws and never knows an API path; a screen
 * here reads the API through its host's transport and follows the API's
 * rules, for the account (the dashboard) or for one site (the plugin).
 *
 * A host builds a ScreensHost (host/types.ts) and renders a screen with it:
 *   <WaitingForYou host={host} tab={tab} onTabChange={setTab} />
 *   <YourTeam host={host} instanceId={business} tab={tab} onTabChange={setTab} />
 * and the Home sections, on one business's reads:
 *   const home = useBusinessHome(host, business);
 *   <GrowthCard home={home} chartsActive /> <ThisWeekCard home={home} />
 *   <TeamWeekCard home={home} /> <WhatChangedCard home={home} />
 *   <StoredValueCard home={home} />
 *   <HomeInsights host={host} /> <SiteHealthCard host={host} /> <RecentActivityCard host={host} />
 * and the side column's:
 *   <SitePreviewCard siteUrl={url} thumbnailUrl={shot} name={name} /> <GetPaidCard host={host} />
 *   <BusinessDetailsPrompt host={host} /> <YourWebsiteCard host={host} siteUrl={url} />
 * The approval rules and pieces the screens use are in ./approvals; Your
 * team's rules (what the team says, the channels' state) in ./team; the Home
 * sections' rules and parts in ./home.
 */
export { SCREENS_VERSION } from './version';

// ── the host ─────────────────────────────────────────────────────────────
export { ScreensApiError, isScreensApiError, payloadOf } from './host/types';
export type {
  ScreensHost,
  ScreensTransport,
  ScreensQuery,
  ScreensCallOptions,
  ScreensScope,
  ScreensBusiness,
  ScreensViewer,
  ScreensRenderers,
  ReceiptNextProps,
  ApprovalShape,
  DecideExtra,
  SiteShare,
  SiteShareHook,
  HelpTipSpec,
} from './host/types';
export { ScreensHostProvider, ScreensHostContext, useScreensHost, useOptionalScreensHost } from './host/HostContext';
export { HostLink, isAbsoluteAddress } from './host/HostLink';

// ── Waiting for you ──────────────────────────────────────────────────────
export { WaitingForYou, WaitingForYouScreen, DECIDE_TIMEOUT_MS, severityLabel } from './waiting/WaitingForYou';
export type { WaitingForYouProps } from './waiting/WaitingForYou';
export {
  WAITING_TABS, NO_WAITING, ALL_DONE_TEXT, isWaitingTab, waitingTabLabel, shownTabs, activeWaitingTab, nextWaitingTab,
  waitingBadgeCount,
} from './waiting/tabs';
export type { WaitingTab, WaitingCounts } from './waiting/tabs';
export {
  readWaitingCount, readWaitingCounts, readApprovals, readAlerts, readPrepared, readCustomers, readChannels,
  readOpenConversations, approvalsLimit,
} from './waiting/reads';
export type { ApprovalsAnswer, WaitingAlert, PreparedChange, CustomerChannel } from './waiting/reads';
export {
  PreparedChanges, PreparedChangeCard, usePreparedChanges, preparedLink, preparedErrorText, readEditResult, editFailure,
  EDIT_CALL_TIMEOUT_MS,
} from './waiting/PreparedChanges';
export type { PreparedChangesState, PreparedEditResult } from './waiting/PreparedChanges';

// ── the approval card, for an app's own pages (the dashboard's Your team) ─
export { ApprovalCard, ApprovalDetail, siteDecisionOf, isHeldRow } from './approvals/ApprovalCard';
export type { ApprovalCardProps, ApprovalCardStatus } from './approvals/ApprovalCard';
export type {
  OperatorApproval, ApprovalStatus, DecideResult, SiteDecideResult, YouTubePrivacy, YouTubeUploadInput,
} from './approvals/types';

// ── Your team ────────────────────────────────────────────────────────────
export { YourTeam, YourTeamScreen, YOUR_TEAM_COPY } from './team/YourTeam';
export type { YourTeamProps } from './team/YourTeam';
export { TEAM_TAB_LABELS, teamTabs, isTeamTab, activeTeamTab, teamTabLabel, waitingLine } from './team/tabs';
export type { TeamTab } from './team/tabs';
export {
  teamBusiness, readTeamMembers, readTeamFaces, readTeamPlan, readTeamTasks, readTeamRuns, readTeamProgress, readConnectCenter,
  readWaitingYes, setTaskStatus, runTaskNow, deleteTask, cancelRun, parseNewTask, createTask,
} from './team/reads';
export type { TeamFaceMember, TeamFacePresence } from './team/reads';
export { memberMeta, readCatalog, loadCatalog } from './team/catalog';
export type { TeamMemberMeta, TeamCatalog } from './team/catalog';
export { TeamFaces, TeamFacesView, teamFacesShown, teamFaceLine, TEAM_FACES_MAX, TEAM_FACES_COPY } from './team/TeamFaces';
export { TeamCard, TeamCardFrame, TeamCardHeader, TeamCardActions, OperatorChip, SpeakingCard } from './team/TeamCard';
export type { TeamCardMember, TeamCardStatus } from './team/TeamCard';
export {
  PlanTab, PlanView, PlanBoard, TaskCard, RunCard, PlanTaskCard, TaskButtons, CoCeoHint, speakerOf, planRights,
  PLAN_TWO_COLUMNS_PX, LIVE_POLL_MS, IDLE_POLL_MS,
} from './team/PlanTab';
export type { PlanTabProps, PlanViewProps, PlanRights, TaskActions } from './team/PlanTab';
export { NewTaskCard } from './team/NewTask';
export type { NewTaskCardProps } from './team/NewTask';
export { ProgressTab, ProgressWeeks } from './team/ProgressTab';
export type { ProgressTabProps } from './team/ProgressTab';
export {
  ConnectTab, TeamConnectView, TeamChannelCard, SiteChannelFlow, ChannelPermissions, CONNECT_COPY,
} from './team/ConnectTab';
export type { TeamConnectFlowProps, TeamConnectSlots } from './team/ConnectTab';
export type {
  TaskRow, TaskStatus, TaskOperator, TaskLastRun, BackgroundRun, RunStatus, TeamPlan, PlanTask, PlanScheduledTask,
  ParsedTask, NewTaskType, WorkBadge, TaskSubject, SpeechOptions,
} from './team/tasks';
export type { ConnectCenter, ConnectNetwork, ConnectStatus, ChannelPermission } from './team/connectRules';
export type { ProgressSnapshot } from './team/progress';

// ── The Home sections (the dashboard's Home, the plugin's Overview) ──────
export { useBusinessHome } from './home/useBusinessHome';
export type { BusinessHome, UseBusinessHomeOptions } from './home/useBusinessHome';
export { GrowthCard } from './home/GrowthCard';
export type { GrowthCardProps } from './home/GrowthCard';
export { ThisWeekCard } from './home/ThisWeek';
export type { ThisWeekCardProps } from './home/ThisWeek';
export { TeamWeekCard } from './home/TeamWeek';
export type { TeamWeekCardProps } from './home/TeamWeek';
export { WhatChangedCard, whatChangedItems, useWhatChanged } from './home/WhatChanged';
export type { WhatChangedCardProps } from './home/WhatChanged';
export { readWhatChanged } from './home/reads';
export type { HomeFinance, HomeTraffic, HomePlan } from './home/reads';
export { HomeInsights } from './home/HomeInsights';
export type { HomeInsightsProps, InsightsFaces } from './home/HomeInsights';
export { SiteHealthCard } from './home/SiteHealthCard';
export type { SiteHealthCardProps } from './home/SiteHealthCard';
export { RecentActivityCard } from './home/RecentActivityCard';
export type { RecentActivityCardProps } from './home/RecentActivityCard';
export { StoredValueCard } from './home/StoredValue';
export type { StoredValueCardProps } from './home/StoredValue';
// The side column (2026-10-17): the site's preview, Turn on a way to get
// paid, Check what your site says about you, Your website.
export { SitePreviewCard } from './home/SitePreviewCard';
export type { SitePreviewCardProps } from './home/SitePreviewCard';
export { WelcomeHeader, OurStillMark, welcomeTitle, welcomeMarkSize, useFirstWelcome, WELCOME_LINES_PX } from './home/Welcome';
export type { WelcomeHeaderProps } from './home/Welcome';
export { GetPaidCard } from './home/GetPaidCard';
export type { GetPaidCardProps } from './home/GetPaidCard';
export { BusinessDetailsPrompt, useBusinessDetailsPrompt } from './home/BusinessDetailsPrompt';
export type { BusinessDetailsPromptProps } from './home/BusinessDetailsPrompt';
export { YourWebsiteCard } from './home/YourWebsite';
export type { YourWebsiteCardProps } from './home/YourWebsite';
export { ShareYourSite } from './home/ShareYourSite';
export { FeatureOnWpmaven } from './home/FeatureOnWpmaven';
export type { GatewaySetupHost, GatewayTabResult, PendingTab, StoreGateway } from './home/getPaid';
