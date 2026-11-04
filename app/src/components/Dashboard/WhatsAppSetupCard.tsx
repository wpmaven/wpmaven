/**
 * "Run your business from anywhere": a small card in Home's notices while
 * WhatsApp is not linked to the account, with the way to link it in the
 * dashboard (the dashboard's own card, in its words).
 *
 * Shown only when all of these hold:
 *   - the account answered and says WhatsApp is not linked (the site state's
 *     whatsappLinked): never a card that flashes and goes;
 *   - the WordPress user is the owner tier: linking is the owner's, on the
 *     dashboard's Settings;
 *   - this is a WPMaven site: the messages come from WPMaven's own WhatsApp
 *     number and name, which a brand's site never shows;
 *   - "Not now" was not pressed in the last 14 days, by this WordPress user,
 *     in this browser.
 *
 * "Set up WhatsApp" opens the dashboard's Settings on Channels, at the
 * WhatsApp card, in a new tab.
 */
import React, { useState } from 'react';
import { Button, GlassCard } from '@yotako/webmaven-ui';
import { dashboardLink, useSiteState, type SiteState } from '../../utils/siteState';
import { isWpmavenSite } from '../../utils/brand';
import { currentTier } from '../../utils/tier';

export const WHATSAPP_CARD_COPY = {
  title: 'Run your business from anywhere',
  line: "Link WhatsApp to approve your team's work, ask for anything and get your weekly report from your phone.",
  setUp: 'Set up WhatsApp',
  notNow: 'Not now',
} as const;

/** The dashboard's Settings, on the tab where WhatsApp is linked, at its card. */
export const WHATSAPP_SETUP_PATH = '/settings?tab=channels&channel=whatsapp';

/** How long "Not now" hides the card. */
export const WHATSAPP_CARD_SNOOZE_DAYS = 14;
const DAY_MS = 86_400_000;

/** WhatsApp's own green, as the channel cards draw it. */
const WHATSAPP_GREEN = '#25D366';
const WHATSAPP_GLYPH = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z';

type KeyStore = Pick<Storage, 'getItem' | 'setItem'>;

/** Where "Not now" is kept: per WordPress user, in this browser. */
export function whatsappCardKey(userId: string): string {
  return `wm-whatsapp-card-not-now:${userId}`;
}

function browserStorage(): KeyStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The WordPress user's id, as the page was drawn (WEBMAVEN_WP_DATA.user.id), or null. */
/** The signed-in WordPress user's id, the key of what this browser remembers for them. */
export function wpUserId(): string | null {
  const id = typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA?.user?.id : null;
  return typeof id === 'number' || (typeof id === 'string' && id.trim() !== '') ? String(id) : null;
}

/** Until when "Not now" hides the card for this user, or null. */
export function readSnoozedUntil(userId: string | null, storage: KeyStore | null = browserStorage()): number | null {
  if (!userId || !storage) return null;
  try {
    const until = Number(storage.getItem(whatsappCardKey(userId)));
    return Number.isFinite(until) && until > 0 ? until : null;
  } catch {
    return null;
  }
}

/** "Not now": hidden for 14 days from `now`. Kept when the browser lets us; hidden for this visit either way. */
export function snoozeWhatsAppCard(userId: string | null, now = Date.now(), storage: KeyStore | null = browserStorage()): number {
  const until = now + WHATSAPP_CARD_SNOOZE_DAYS * DAY_MS;
  if (userId && storage) {
    try { storage.setItem(whatsappCardKey(userId), String(until)); } catch { /* a convenience only */ }
  }
  return until;
}

/** Whether Home shows the card (the rules above). */
export function whatsappCardShows(s: { site: SiteState; owner: boolean; wpmaven: boolean; snoozedUntil: number | null; now: number }): boolean {
  if (!s.site.known || s.site.whatsappLinked) return false;
  if (!s.owner || !s.wpmaven) return false;
  return !(s.snoozedUntil != null && s.now < s.snoozedUntil);
}

const WhatsAppGlyph = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill={WHATSAPP_GREEN} style={{ flexShrink: 0, marginTop: 2 }}>
    <path d={WHATSAPP_GLYPH} />
  </svg>
);

export function WhatsAppSetupCardView({ href, onNotNow }: { href: string; onNotNow: () => void }) {
  return (
    <div data-testid="wm-whatsapp-card">
      <GlassCard padding="14px 18px">
        {/* One row on a computer; on a phone the words take the whole width
            and the buttons wrap under them, at the right. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: '1 1 300px', minWidth: 0 }}>
            <WhatsAppGlyph />
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>{WHATSAPP_CARD_COPY.title}</h2>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>{WHATSAPP_CARD_COPY.line}</p>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
            <Button size="sm" variant="ghost" onClick={onNotNow} data-testid="wm-whatsapp-not-now">
              {WHATSAPP_CARD_COPY.notNow}
            </Button>
            <Button
              size="sm"
              variant="primary"
              title="Opens your dashboard in a new tab"
              data-testid="wm-whatsapp-set-up"
              data-href={href}
              onClick={() => { window.open(href, '_blank', 'noopener,noreferrer'); }}
            >
              {WHATSAPP_CARD_COPY.setUp}
            </Button>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

export default function WhatsAppSetupCard() {
  const site = useSiteState();
  const userId = wpUserId();
  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(() => readSnoozedUntil(userId));
  const shows = whatsappCardShows({
    site,
    owner: currentTier() === 'owner',
    wpmaven: isWpmavenSite(),
    snoozedUntil,
    now: Date.now(),
  });
  if (!shows) return null;
  return (
    <WhatsAppSetupCardView
      href={dashboardLink(site, WHATSAPP_SETUP_PATH)}
      onNotNow={() => setSnoozedUntil(snoozeWhatsAppCard(userId))}
    />
  );
}
