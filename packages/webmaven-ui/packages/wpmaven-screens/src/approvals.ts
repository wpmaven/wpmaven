/**
 * @yotako/wpmaven-screens/approvals: the approval rows' rules and pieces, one
 * copy for the dashboard and the plugin (2026-10-16). What an approval
 * shows (its preview, its title, its Action details without internal data),
 * which networks it reaches, what a held one says, the receipts after a
 * decision. The dashboard's files at the old paths re-export these.
 */
export * from './approvals/types';
export * from './approvals/previewData';
export * from './approvals/networkLook';
export * from './approvals/targets';
export * from './approvals/teamNote';
export * from './approvals/sitePreview';
export * from './approvals/sanitizePostHtml';
export * from './approvals/postingAccounts';
export * from './approvals/youtubeVisibility';
export * from './approvals/tiktokPost';
export * from './approvals/heldReason';
export * from './approvals/heldPack';
export * from './approvals/heldItems';
export * from './approvals/receipts';
export * from './approvals/videoLabel';
export * from './approvals/words';

// ── components ────────────────────────────────────────────────────────────
export { ApprovalPreview, campaignApprovalView } from './approvals/ApprovalPreview';
export type { ApprovalPreviewProps } from './approvals/ApprovalPreview';
export { SitePostPreview, COLLAPSED_PX, beforeMessage, readApprovalBefore } from './approvals/SitePostPreview';
export type { SitePostPreviewProps } from './approvals/SitePostPreview';
export { StoreApprovalView, replyApprovalView, orderApprovalView, couponApprovalView } from './approvals/storeApprovalViews';
export { ActionDetails } from './approvals/ActionDetails';
export type { ActionDetailsProps } from './approvals/ActionDetails';
export { SiteChangeSummary, SUMMARY_CHARS } from './approvals/SiteChangeSummary';
export { TeamNoteLine } from './approvals/TeamNoteLine';
export type { TeamNoteLineProps } from './approvals/TeamNoteLine';
export { YouTubeVisibilityChoice } from './approvals/YouTubeVisibilityChoice';
export { YouTubeUploadSection } from './approvals/YouTubeUploadSection';
export { ReceiptNote, PublishedLinks, NextStepButton, PageButton, openPage } from './approvals/ReceiptNote';
export type { ReceiptNoteProps } from './approvals/ReceiptNote';
export { ModalScrollBody, MODAL_SCROLL_MAX_HEIGHT } from './approvals/ModalScrollBody';
export {
  ApprovalCard, ApprovalDetail, siteDecisionOf, isHeldRow,
  OWNER_ONLY_TEXT, APPROVE_IN_DASHBOARD_TEXT, SITE_HELD_TEXT,
} from './approvals/ApprovalCard';
export type { ApprovalCardProps, ApprovalCardStatus, ApprovalDetailProps, SiteDecision } from './approvals/ApprovalCard';
export { CheckCircleIcon, ClockIcon, ExclamationTriangleIcon, InformationCircleIcon } from './approvals/icons';
