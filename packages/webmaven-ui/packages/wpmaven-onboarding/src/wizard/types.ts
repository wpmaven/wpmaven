// Types matching the API
export interface OnboardingAnalysis {
  siteType: string;
  industry: string;
  /** The industry as the owner names it, in the page's language (the api's, 734 A); shown over `industry`. */
  industryLabel?: string;
  location?: string;
  mainGoals: string[];
  suggestedPages: PageSuggestion[];
  suggestedPlugins: PluginRecommendation[];
  suggestedStyle: string;
  /** Human-friendly business/brand name (editable at the review step). */
  siteName?: string;
  /** One-sentence marketing-style summary of what the site offers visitors. */
  siteSummary?: string;
  /** Operator ids (the "team" for this business) — see constants/operators.ts. */
  team?: string[];
  /** How the business earns money: one of the API's earning models,
   *  or null/absent for non-commercial sites. Gates the forecast step. */
  earningModel?: string | null;
  /** What the store sells — closed set (POD roadmap). Drives the store preview:
   *  'pod' boots WooCommerce + real print-on-demand products in WP Playground. */
  sellingType?: 'physical_own' | 'pod' | 'digital' | 'dropship' | 'services';
  /** Print-on-demand detection — present when the store sells custom/printed goods. */
  pod?: { detected: boolean; provider: string };
  /** The business's own country (ISO 3166-1 alpha-2, "FR"), read from where it is. */
  country?: string;
  /** The language the site is written in (ISO 639-1, "fr"); the confirm step shows it, with Change when the host can change it. */
  language?: string;
  /**
   * The API could not tell which language the site should speak (the
   * screen's and the description's differ): the confirm step asks first,
   * one button per option (the screen's language first, the typed one
   * second), and goes on once one is chosen.
   */
  languageQuestion?: { options: string[] } | null;
  confidence: number;
  reasoning?: string;
}

export interface PageSuggestion {
  type: string;
  title: string;
  description: string;
  required: boolean;
  hints?: string[];
}

export interface PluginRecommendation {
  slug: string;
  name: string;
  reason: string;
  required: boolean;
}

export interface PageSelection {
  type: string;
  title: string;
  include: boolean;
  customTitle?: string;
}

export interface PluginSelection {
  slug: string;
  name: string;
  include: boolean;
}

/**
 * Design concept from Style Sampler
 */
export interface DesignConcept {
  id: string;
  name: string;
  tagline: string;
  personality: string[];
  uniqueHook: string;
  cssVariables: string;
  designSystem: any; // Full design system object
  /**
   * Name of the discovered creative direction this concept was expanded
   * from. Replaces the old `presetId` (which referenced a fixed preset
   * triad). Each direction is LLM-generated per brand, not picked from
   * a hard-coded catalog.
   */
  directionName: string;
  /**
   * Compact, opinionated mapping of role tokens → preview-render values.
   * Computed server-side via `derivePreview()` so the frontend doesn't
   * have to hunt through CSS-var fallback chains (which had bugs — dark
   * themes silently rendered with white backgrounds because the lookup
   * priority was wrong). Frontend MockBrowser consumes these directly.
   */
  preview: {
    background: string;
    text: string;
    secondaryText: string;
    primary: string;
    primaryText: string;
    accent: string;
    accentText: string;
    heading: string;
    headingFont: string;
    bodyFont: string;
    radius: string;
    outline?: string;
  };
  /** One brand logo generated for this concept (matches its palette). */
  logo?: LogoVariant;
  /**
   * Genstudio engine: the concept rendered as a full-page design
   * mock (tall data-URL screenshot). When present the card and the preview
   * pane show the mock itself; cssVariables/preview/logo may be absent.
   */
  image?: string;
}

export interface OnboardingConfig {
  sessionId: string;
  description: string;
  analysis: OnboardingAnalysis | null;
  selectedStyle: string;
  selectedPages: PageSelection[];
  /** Pre-selected design system from Style Sampler */
  selectedDesignSystem?: {
    id: string;
    name: string;
    cssVariables: string;
    designSystem: any;
  };
}

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  preview: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
}

export type OnboardingStep =
  | 'describe' | 'confirm' | 'forecast' | 'whatsapp' | 'style' | 'generating' | 'success'
  // Off the linear path on purpose: the gate diverts here and the visitor
  // comes back to 'describe' or leaves. They are NOT in STEPS, so next/prev
  // can never walk into them.
  | 'clarify' | 'unsupported'
  // A WordPress site that already holds the owner's content opens here
  // instead of describe (the plugin only, behind the api's existingSite),
  // then its check ('audit'). A store that already sells while that way is
  // not open hears it first ('liveStore').
  | 'site' | 'audit' | 'liveStore'
  // Keep my site as it is, Fix and improve my site: the business from the
  // site ('business'), the findings the team fixes ('fixes'), the last word ('kept').
  | 'business' | 'fixes' | 'kept'
  // New design, keep my content: what the site holds, read for it, before the looks.
  | 'redesign';

/**
 * Sub-phases of the describe step: the Co-CEO asks whether the user
 * has a business idea ('ask'); 'suggest' is the Data Analyst's weekly
 * blueprint interface; 'describe' is the classic input. The existing-content
 * path skips straight to 'describe' (an existing site already has a business).
 */
export type DescribePhase = 'ask' | 'suggest' | 'describe';
export type OnboardingStatus = 'DETECTING' | 'DESCRIBING' | 'ANALYZING' | 'CONFIRMED' | 'STYLING' | 'SELECTING_PAGES' | 'GENERATING' | 'COMPLETED' | 'ERROR';

export type InstallType = 'fresh' | 'existing' | null;

/** A generated brand logo candidate. */
export interface LogoVariant {
  id: string;
  svg: string;
  faviconDataUrl: string;
  source: 'traced' | 'monogram';
}

/** One row in a generation progress checklist (build steps / AI final pass). */
export interface ChecklistVM {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done';
  /** Operator (job role) this row is attributed to — see constants/operators.ts. */
  operator?: string;
}

/**
 * One streamed page of generated content (the post-"===CONTENT===" body),
 * grouped by fileName. Accumulated imperatively in a ref off the 'code' SSE
 * event — never via setState (a delta arrives per token, so per-delta setState
 * would thrash). The GenerationStage reads codeFilesRef during its own RAF loop.
 */
export type CodeFile = { fileName: string; code: string; label?: string; operator?: string; done: boolean };
