/**
 * What an owner agrees to when they connect a channel, and how they take our
 * access back, for the channels whose platform asks us to say it in the app.
 * One copy for every screen that shows a channel (2026-10-16): the
 * dashboard's Settings > Channels and both apps' Your team > Connect.
 *
 * YouTube is the one today. Its API Services Developer Policies ask any app
 * that works on somebody's channel to link the YouTube Terms of Service where
 * they connect and say that connecting means agreeing to them (III.A.1), to
 * link our privacy policy and Google's (III.A.2), and to tell the owner that
 * Google's security settings can remove our access, wherever the channel
 * shows as connected. The audit reviewer checks every place an owner can
 * press Connect, so each one renders these two pieces from here and never
 * writes its own copy.
 *
 * The ids are the network ids GET /operators/connect returns, which are also
 * the dashboard's channel guide ids, so either screen passes the id it has.
 */
import React from 'react';
import { postingApp, productName } from '@yotako/wpmaven-onboarding/shared';

export const YOUTUBE_TERMS_URL = 'https://www.youtube.com/t/terms';
/** Straight to the policy's YouTube section, where what we do with the data is said. */
export const WPMAVEN_PRIVACY_URL = 'https://wpmaven.ai/privacy-policy.html#youtube';
export const GOOGLE_PRIVACY_URL = 'https://www.google.com/policies/privacy';
export const GOOGLE_PERMISSIONS_URL = 'https://security.google.com/settings/security/permissions';

/** The sentences, so a test can pin them without copying them. */
export const CHANNEL_TERMS_COPY = {
  youtubeAgree: 'By connecting YouTube, you agree to the YouTube Terms of Service.',
  youtubeTermsLink: 'YouTube Terms of Service',
  privacy: 'Our Privacy Policy explains what we do with your YouTube data.',
  privacyLink: 'Our Privacy Policy',
  googlePrivacy: 'The Google Privacy Policy also applies.',
  googlePrivacyLink: 'Google Privacy Policy',
  get youtubeRevoke(): string {
    return `You can also remove ${postingApp()}'s access in your Google security settings.`;
  },
  youtubeRevokeLink: 'Google security settings',
  /** In the Disconnect YouTube confirm: what disconnecting does, and does not, delete. */
  get youtubeDisconnect(): string {
    return `${productName()} deletes the YouTube data it kept and asks Google to remove its access. Your videos and data on YouTube are not touched; to delete them, use YouTube.`;
  },
  /** Also in it, when the owner has more than one business: Google's grant covers the channel. */
  youtubeDisconnectShared: 'If another of your businesses uses this same YouTube channel, it is disconnected too.',
} as const;

/**
 * The Disconnect YouTube confirm's own sentences: what is deleted and what is
 * not, and, for an owner with other businesses, that one on the same channel
 * goes too (the API's `alsoDisconnected`). Empty for every other channel.
 */
export function disconnectNote(channelId: string, opts: { otherBusinesses: boolean }): string {
  if (channelId !== 'youtube') return '';
  const c = CHANNEL_TERMS_COPY;
  return opts.otherBusinesses ? `${c.youtubeDisconnect} ${c.youtubeDisconnectShared}` : c.youtubeDisconnect;
}

function andList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * After Disconnect YouTube: the owner's other businesses the API disconnected
 * with it (`alsoDisconnected`, business ids), named. A business this screen
 * does not know is still counted, never dropped. Empty when there are none.
 */
export function alsoDisconnectedSentence(
  ids: string[],
  businesses: Array<{ id: string; siteName?: string | null; siteUrl?: string | null }>,
  channelName = 'YouTube',
): string {
  const unique = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x)));
  if (unique.length === 0) return '';
  const names: string[] = [];
  let unknown = 0;
  for (const id of unique) {
    const b = businesses.find((x) => x.id === id);
    const name = (b?.siteName || b?.siteUrl || '').trim();
    if (name) names.push(name);
    else unknown += 1;
  }
  if (unknown > 0) {
    names.push(names.length
      ? (unknown === 1 ? 'one more of your businesses' : `${unknown} more of your businesses`)
      : (unknown === 1 ? 'Another of your businesses' : `${unknown} of your other businesses`));
  }
  const many = unique.length > 1;
  return `${andList(names)} used the same ${channelName} channel, so ${many ? 'they are' : 'it is'} disconnected too.`;
}

/** True for a channel that has a notice to show beside its Connect button. */
export function hasConnectTerms(channelId: string): boolean {
  return channelId === 'youtube';
}

/** Always a new tab, and the page it opens gets no handle back to ours. */
const Outbound: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
    {children}
  </a>
);

/**
 * Splits a sentence around the phrase that becomes the link, so the words the
 * owner reads are exactly the copy above, with the link in its place.
 */
function linked(sentence: string, phrase: string, href: string): React.ReactNode {
  const at = sentence.indexOf(phrase);
  if (at < 0) return sentence;
  return (
    <>
      {sentence.slice(0, at)}
      <Outbound href={href}>{phrase}</Outbound>
      {sentence.slice(at + phrase.length)}
    </>
  );
}

export interface ChannelTermsProps {
  channelId: string;
  className?: string;
  style?: React.CSSProperties;
}

const small: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, color: 'var(--text-dim)' };

/**
 * Beside a Connect (or Reconnect) button: the platform's terms the owner
 * agrees to by connecting, and where our privacy policy says what we do with
 * the data. Nothing for a channel that has no such rule.
 */
export const ChannelConnectTerms: React.FC<ChannelTermsProps> = ({ channelId, className, style }) => {
  if (!hasConnectTerms(channelId)) return null;
  const c = CHANNEL_TERMS_COPY;
  return (
    <div className={className} style={{ ...small, ...style }} data-testid="channel-connect-terms" data-channel={channelId}>
      <p style={{ margin: 0 }}>{linked(c.youtubeAgree, c.youtubeTermsLink, YOUTUBE_TERMS_URL)}</p>
      <p style={{ margin: '4px 0 0' }}>
        {linked(c.privacy, c.privacyLink, WPMAVEN_PRIVACY_URL)}
        {' '}
        {linked(c.googlePrivacy, c.googlePrivacyLink, GOOGLE_PRIVACY_URL)}
      </p>
    </div>
  );
};

/**
 * Wherever the channel shows as connected: the owner can also take our
 * access away from the platform's side, without coming back here.
 */
export const ChannelRevokeNote: React.FC<ChannelTermsProps> = ({ channelId, className, style }) => {
  if (!hasConnectTerms(channelId)) return null;
  const c = CHANNEL_TERMS_COPY;
  return (
    <p className={className} style={{ margin: 0, ...small, ...style }} data-testid="channel-revoke-note" data-channel={channelId}>
      {linked(c.youtubeRevoke, c.youtubeRevokeLink, GOOGLE_PERMISSIONS_URL)}
    </p>
  );
};
