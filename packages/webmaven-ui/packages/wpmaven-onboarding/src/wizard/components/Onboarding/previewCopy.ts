/**
 * The preview beside the steps (PreviewPane, MockBrowser, BrowserChrome,
 * BrowserFrame, ScaledSiteFrame, SiteIframe): its captions, its notices and
 * the stand-in words of the drawn site, in the page's language (French in
 * src/i18n, namespace 'preview').
 */
import { localized } from '@yotako/webmaven-ui';
import type { OnboardingStep } from '../../contexts/OnboardingContext';

const CAPTIONS: Record<OnboardingStep, string> = {
  describe:   'Your business, taking shape as you describe it.',
  confirm:    "Here's what we understood from your description.",
  forecast:   'The plan behind the site: products, prices and what they add up to.',
  whatsapp:   'Building your business…',
  style:      'Styles apply to this preview as you try them.',
  generating: 'Building your business…',
  clarify:    'Nothing built yet. One answer and the preview starts.',
  unsupported:'Nothing was built, and nothing was charged.',
  site:       'Your site stays exactly as it is while the team looks.',
  audit:      'Your site, exactly as it is. The check changed nothing.',
  liveStore:  'Your store, exactly as it is.',
  business:   'Your site, exactly as it is.',
  fixes:      'Your site, exactly as it is.',
  kept:       'Your site, exactly as it is.',
  redesign:   'Your site, exactly as it is, until you switch to the new design.',
  success:    'Your business is live.',
};

export const PREVIEW_COPY_EN = {
  /** The bar on the frame while it shows the picked style only. */
  styleNote: 'Only the style. Your real site appears here once it is built.',
  /** The line over the frame, by step. */
  captions: CAPTIONS,
  /** The address pill before the site has a name. */
  urlPreview: 'preview',
  /** The address pill's stand-in address. */
  sampleHost: 'your-site.com',
  sitePreview: 'Site preview',
  yourSite: 'Your site',
  yourSiteLower: 'your site',
  selectedDirection: 'selected direction',
  fullPageAlt: (name: string) => `Full-page design preview: ${name}`,
  previewTitle: (name: string) => `${name} preview`,
  asItIsToday: (name: string) => `${name}, as it is today`,
  preparingTitle: 'Preparing your preview inside WordPress',
  preparingSub: 'Almost there. This takes a few seconds.',
  stillBuilding: 'We are still building your site. Feel free to scroll and look around.',
  /** A click on the finished business's copy while its full site (the hosted preview) is on its way here. */
  fullSiteSoon: 'Your full site opens here in a moment.',
  // The drawn site's stand-ins (MockBrowser).
  nav: { home: 'Home', about: 'About', services: 'Services', contact: 'Contact' },
  fallbackTagline: 'Your business, coming together…',
  fallbackSubtitle: "We'll fill this in as you go. It's just a preview, no commitment yet.",
  getStarted: 'Get started',
  learnMore: 'Learn more',
  newPill: 'New',
  // The live site's frame (SiteIframe).
  loadingSite: 'Loading your site…',
  loadFailed: "Couldn't load the preview here.",
  openSiteInTab: 'Open your site in a new tab',
  generatedPreview: 'Generated site preview',
  openInTab: 'Open in a new tab',
} as const;

export const PREVIEW_COPY = localized(PREVIEW_COPY_EN, 'preview');
