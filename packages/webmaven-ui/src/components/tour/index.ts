// The guided tour and the help pieces (0.9.0; step actions, variants, the
// phone's slim bar, insets, Show me and tours that save nothing in 0.10.0):
// one engine for the plugin and the dashboard. Each app keeps its steps
// (data-tour anchors) and its storage (a TourStore).
export { TourProvider, useTour, isShown } from './TourProvider';
export type { TourProviderProps } from './TourProvider';
export { TourOverlay, TOUR_Z, stepIsUsed } from './TourOverlay';
export type { TourOverlayProps } from './TourOverlay';
export { HelpTip } from './HelpTip';
export type { HelpTipProps } from './HelpTip';
export { HelpButton, isHelpSeparator } from './HelpButton';
export type { HelpButtonProps, HelpMenuItem, HelpMenuSeparator, HelpMenuEntry } from './HelpButton';
export {
  TOUR_LABELS,
  asTourRecord,
  makeTourRecord,
  memoryTourStore,
  anchorSelector,
  anchorsOf,
  targetSelectors,
  forwardLabel,
  forwardButton,
  stepWords,
  persists,
  closingSave,
  showMeSteps,
  actionsFor,
  opensKeyboard,
} from './rules';
export type { TourStepState } from './rules';
export { tourReducer, currentStep } from './machine';
export type { TourMachineState, TourAction, TourPhase } from './machine';
export { placeTour, scrollDelta, collapsedPlacement } from './placement';
export type { Placement, VisibleArea } from './placement';
export type {
  TourStep,
  TourDefinition,
  TourRecord,
  TourStatus,
  TourStore,
  TourOutcome,
  TourEnd,
  TourCurrent,
  TourStartOptions,
  TourShowMeOptions,
  TourApi,
  TourLabels,
  TourPlacementSide,
  TourStepAction,
  TourActionContext,
  TourStepVariant,
  TourInsets,
} from './types';
