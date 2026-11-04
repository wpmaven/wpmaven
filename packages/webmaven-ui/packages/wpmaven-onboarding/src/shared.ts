
export { WizardApiError, isWizardApiError } from './host/types';
export type { WizardTransport, WizardRequest, WizardIdentity, DraftStore, WizardStorage, WizardLinkProps } from './host/types';

// ── helpers ──────────────────────────────────────────────────────────────
export * from './shared/errorMessage';
export * from './shared/productName';
export * from './shared/guidance';

// ── components other screens draw ────────────────────────────────────────
export { WhyDisabled } from './shared/WhyDisabled';
export type { StoreCurrencyDialogProps } from './shared/StoreCurrencyDialog';
export type { WhatsAppTransport } from './wizard/components/WhatsAppLinkCard';
export type { BrowserFrameProps } from './wizard/components/Onboarding/BrowserFrame';
export type { ScaledSiteFrameProps } from './wizard/components/Onboarding/ScaledSiteFrame';
export type { OperatorState } from './wizard/components/Onboarding/OperatorPortrait';
export type { OperatorInfo } from './wizard/constants/operators';
export * from './wizard/utils/forecastEngine';
export type {
  BusinessPlanAssumptions,
  BusinessPlanStrategy,
  BusinessPlanMove,
  PlannedCatalogChoice,
} from './wizard/types/businessPlan';
export type { PublishOutcomePanelProps, PublishFixHandler } from './shared/PublishOutcomePanel';
