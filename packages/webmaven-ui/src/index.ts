// Foundation
export { ThemeProvider, useTheme } from './foundation/ThemeProvider';
export { APP_FONTS_URL } from './foundation/GlobalStyles';
export {
  colors,
  brand,
  gradients,
  radii,
  blur,
  navHeight,
  ocean,
  oceanPastel,
  lerpColor,
} from './foundation/tokens';

// Components
export { GlassCard } from './components/GlassCard';
export { Button } from './components/Button';
export { Input } from './components/Input';
export { NumberInput } from './components/NumberInput';
export { SearchInput } from './components/SearchInput';
export { ChatInput, chatComposerKey, CHAT_NEWLINE_HINT } from './components/ChatInput';
export { Textarea } from './components/Textarea';
export { ChatBubble } from './components/ChatBubble';
export { ChatPanel } from './components/ChatPanel';
export { PipelineMessage } from './components/PipelineMessage';
export { Badge } from './components/Badge';
export { Tabs, TabPanel } from './components/Tabs';
export { RollingTabs } from './components/RollingTabs';
export { Card, CardHeader, CardTitle, CardContent } from './components/Card';
export { Modal } from './components/Modal';
export { EmptyState } from './components/EmptyState';
export { Toggle } from './components/Toggle';
export { Checkbox } from './components/Checkbox';
export { Radio } from './components/Radio';
export { Progress } from './components/Progress';
export { Stepper } from './components/Stepper';
export { Dropdown } from './components/Dropdown';
export { Toast } from './components/Toast';
export { Avatar } from './components/Avatar';
export { LogoAnimation } from './components/LogoAnimation';
export { Loader } from './components/Loader';
export { Nav } from './components/Nav';
export { Lockup } from './components/Lockup';
export { WMLogo } from './components/WMLogo';
export { WPMavenLockup, wpmavenLockupBox } from './components/WPMavenLockup';
export { PlanIcon, hasPlanIcon, PLAN_ICON_CODES } from './components/PlanIcon';
export { WMLogoProcessing } from './components/WMLogoProcessing';
export { QRCode } from './components/QRCode';
export { Skeleton } from './components/Skeleton';
export { Chart } from './components/Chart';
export { Blobs } from './components/Blobs';
export { NotificationBell } from './components/NotificationBell';
export { NotificationList } from './components/NotificationList';
export { ReportView } from './components/ReportView';
// The report's currency and its metric words, for a host that shapes reports itself.
export { reportCurrency, reportMetricWords } from './lib/reportMetrics';
export { ReportHistory } from './components/ReportHistory';
export { HealthBadge } from './components/HealthBadge';
export { ReportScheduleConfig } from './components/ReportScheduleConfig';
export { GoalWidget } from './components/GoalWidget';
export { Scrollbar } from './components/Scrollbar';
export { ThemeToggle } from './components/ThemeToggle';

// The pieces the plugin and the dashboard both draw (2026-10-16): one page
// title, one sidebar row and icon set, one plan tag, one numbers card, one
// activity list, one health card and one site icon.
export { PageHeader } from './components/PageHeader';
export type { PageHeaderProps } from './components/PageHeader';
export { SegmentedControl } from './components/SegmentedControl';
export type { SegmentedControlProps, SegmentedControlOption } from './components/SegmentedControl';
export { PlanTag } from './components/PlanTag';
export type { PlanTagProps } from './components/PlanTag';
export type { BadgeProps } from './components/Badge';
export { FiguresCard, figureColumns } from './components/FiguresCard';
export type { FiguresCardProps, FigureItem } from './components/FiguresCard';
export { ActivityList } from './components/ActivityList';
export type { ActivityListProps, ActivityRow } from './components/ActivityList';
export { HealthSummary, HEALTH_SUMMARY_LABELS, healthBadgeStatus } from './components/HealthSummary';
export type { HealthSummaryProps, HealthSummaryLabels, SiteHealthState, SiteHealthIssue } from './components/HealthSummary';
export { SiteIcon, siteIconRadius } from './components/SiteIcon';
export type { SiteIconProps } from './components/SiteIcon';
// The reader's language (any language): English is the
// source; other languages are catalogs (data) added at run time; a copy object
// reads the page's language where its catalog has a text, English otherwise.
export {
  languageCode, languageOf, isLanguage, availableLanguages, announceLanguages, addTranslations, hasTranslations,
  pickLanguage, getLanguage, setLanguage, onLanguageChange, textDirection, resetLanguages,
  localeTag, localized, fill, plural, formatNumber, formatMoney, formatDate,
} from './lib/language';
export type { Language, Translations, DeepPartial, PluralForms } from './lib/language';
// The kit's own labels (the chat box's hint, Send, a modal's Close) in the
// page's language: the catalogs' namespace "kit".
export { KIT_COPY, KIT_COPY_EN } from './lib/kitCopy';
export { useLanguage } from './lib/useLanguage';
// Times in short English words: "5 min ago", "Yesterday", "Oct 3".
export { formatRelativeTime, dateText, whenText } from './lib/timeWords';
export { NavItem, navBadgeText } from './components/NavItem';
export type { NavItemProps } from './components/NavItem';
export { NavIcon, NAV_ICON_NAMES, isNavIconName } from './icons/NavIcon';
export type { NavIconName, NavIconProps } from './icons/NavIcon';

// The kit's own small icons (16px, a 2px stroke), as the README lists them.
export {
  SunIcon,
  MoonIcon,
  SearchIcon,
  CheckIcon,
  ChevronDownIcon,
  ArrowUpIcon,
  PlusIcon,
  PaperclipIcon,
  InfoIcon,
  SuccessIcon,
  WarningIcon,
  ErrorIcon,
  SettingsIcon,
} from './icons';
export type { IconProps } from './icons';

// The team: one face set, its colours and presence (working, waiting for
// you, done, failed, queued) for every surface that shows a member.
export {
  OperatorAvatar,
  OperatorStack,
  OperatorFace,
  hasOperatorFace,
  operatorAvatarLabel,
  operatorStackLabel,
  OPERATOR_PRESENCES,
  OPERATOR_PRESENCE_WORDS,
  OPERATOR_AVATAR_SIZES,
  OPERATOR_IDS,
  OPERATOR_TITLES,
  UNKNOWN_OPERATOR_TITLE,
  isOperatorId,
  operatorTitle,
  presenceFromState,
} from './components/operator';
export type {
  OperatorAvatarProps,
  OperatorStackProps,
  OperatorFaceProps,
  OperatorPresence,
  OperatorId,
  OperatorState,
} from './components/operator';
export { operatorAccents, operatorAccentsOnDark, operatorAccent } from './foundation/tokens';

// One chat for the plugin and the dashboard (2026-10-16): the Co-CEO's chat,
// its state from an app's adapter, the stream's events in the chat's words,
// and the empty chat's suggestions. Each app keeps its transport.
export * from './components/chat';

// The guided tour and the help button (0.9.0): the dashboard's tour engine,
// app-agnostic. Each app passes its steps, its page and its TourStore.
export * from './components/tour';

// Agent runtime UI (timeline + per-tool widgets)
export { AgentTimeline } from './components/AgentTimeline';
export { defaultToolRenderers, mergeRenderers } from './components/tools/registry';
export { JsonFallback } from './components/tools/JsonFallback';
export { PluginCard } from './components/tools/PluginCard';
export { ThemeCard } from './components/tools/ThemeCard';
export { SearchResults } from './components/tools/SearchResults';
export { ImageGrid } from './components/tools/ImageGrid';
export { PostPreview } from './components/tools/PostPreview';
export { AuditIssuesList } from './components/tools/AuditIssuesList';
export { CommandOutput } from './components/tools/CommandOutput';
export { StatusLine } from './components/tools/StatusLine';
export { FileDiff } from './components/tools/FileDiff';

// Types
export type { WPMavenLockupProps } from './components/WPMavenLockup';
export type { ButtonProps } from './components/Button';
export type { InputProps } from './components/Input';
export type { TextareaProps } from './components/Textarea';
export type { NumberInputProps } from './components/NumberInput';
export type { TabItem, TabsLook, TabsProps, TabPanelProps } from './components/Tabs';
export type { RollingTabItem, RollingTabsProps } from './components/RollingTabs';
export type { CardProps, CardHeaderProps, CardTitleProps, CardContentProps } from './components/Card';
export type { ModalProps } from './components/Modal';
export type { EmptyStateProps } from './components/EmptyState';
export type { BadgeColor, ToastVariant } from './foundation/tokens';
export type { LogoAnimationState } from './components/LogoAnimation';
export type { PlanIconCode, PlanIconProps } from './components/PlanIcon';
export type { ChatPanelStatus, ChatPanelProps } from './components/ChatPanel';
export type { ChatInputProps } from './components/ChatInput';
export type { PipelineStep, PipelineMessageProps } from './components/PipelineMessage';
export type { SkeletonProps } from './components/Skeleton';
export type { ChartProps, ChartDataset } from './components/Chart';
export type { NotificationBellProps } from './components/NotificationBell';
export type { Notification, NotificationListProps } from './components/NotificationList';
export type { ReportData, ReportViewProps } from './components/ReportView';
export type { ReportListItem, ReportHistoryProps } from './components/ReportHistory';
export type { HealthBadgeProps, HealthStatus } from './components/HealthBadge';
export type { ReportScheduleConfigProps } from './components/ReportScheduleConfig';
export type { GoalData, GoalWidgetProps } from './components/GoalWidget';
export type { ScrollbarProps } from './components/Scrollbar';
export type { ThemeToggleProps, ThemeToggleMode } from './components/ThemeToggle';
export type { AgentTimelineProps } from './components/AgentTimeline';
export type {
  ToolCallStatus,
  ToolCallEntry,
  ToolRenderProps,
  ToolRenderer,
  ToolRendererMap,
} from './components/tools/types';
