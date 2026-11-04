/**
 * The product's name on the address the dashboard is served on (White label,
 * WP1 2026-10-05): the brand's name on a branded address (an agency's or a
 * hosting partner's, lib/hostBrand.ts), "WPMaven" everywhere else. Every
 * sentence a client can read on a branded address says the product's name
 * through this file, never "WPMaven" itself; the render test
 * (components/__tests__/agencyHost.node.test.tsx) holds every swept screen
 * to it.
 *
 *   productName()      in plain modules (copy files, error text); in
 *                      components, useProductName() from
 *                      contexts/HostBrandContext (the same name).
 *   postingApp()       the app the networks show on their own consent and
 *                      permission screens. That app is ours and no code can
 *                      rename it per brand (decision D7), so a branded
 *                      address says "our posting app" instead of a name.
 *   brandedHost()      true on a branded address: hide what only makes
 *                      sense on ours (our referral program, our channels,
 *                      our support chat).
 *
 * The brand is known before anything renders: HostBrandProvider holds the
 * first paint on an address that is not ours until GET /white-label/by-host
 * answers, then calls setHostProductName(). On our own hosts it is never
 * set, so every word reads exactly as before.
 *
 * One import, webmaven-ui's language helper: "our posting app" reads in the
 * page's language (namespace 'productName').
 */
import { localized } from '@yotako/webmaven-ui';

export const OUR_NAME = 'WPMaven';
const OUR_POSTING_APP = 'WPMaven';

/** The words of this file, word for word. */
export const PRODUCT_NAME_EN = {
  brandedPostingApp: 'our posting app',
} as const;

/** Those words in the page's language. */
export const PRODUCT_NAME_WORDS = localized(PRODUCT_NAME_EN, 'productName');

let hostName: string | null = null;

/** Set once at boot by HostBrandProvider (tests set and clear it). */
export function setHostProductName(name: string | null | undefined): void {
  const n = typeof name === 'string' ? name.trim() : '';
  hostName = n || null;
}

/** "WPMaven", or the brand's name on a branded address. */
export function productName(): string {
  return hostName ?? OUR_NAME;
}

/** The posting app as the networks name it: "WPMaven" on our hosts, "our posting app" on a branded one. */
export function postingApp(): string {
  return hostName ? PRODUCT_NAME_WORDS.brandedPostingApp : OUR_POSTING_APP;
}

/**
 * A sentence written with our name, said with the product's name: the same
 * text on our hosts; "WPMaven" becomes the brand's name on a branded address.
 * For copy kept as a constant (and pinned by tests); never for a sentence
 * about the networks' posting app (postingApp).
 */
export function brandWords(text: string): string {
  return hostName ? text.replace(/WPMaven/g, hostName) : text;
}

/** True on a branded address. */
export function brandedHost(): boolean {
  return hostName !== null;
}
