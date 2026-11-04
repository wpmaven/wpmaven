/**
 * What you have built here, as a Home section (moved from the dashboard,
 * 2026-10-17): the dashboard's Home draws it beside What changed, the
 * plugin's Overview beside its numbers card. It reads GET
 * /operators/stored-value for the business, through the app's transport.
 */
import React, { useEffect, useState } from 'react';
import { GlassCard } from '@yotako/webmaven-ui';
import type { ScreensHost } from '../host/types';
import { teamBusiness } from '../team/reads';
import { readStoredValue, type StoredValueChannel, type StoredValueData } from './reads';
import { Figures, type Figure } from './Figures';
import type { BusinessHome } from './useBusinessHome';

/**
 * The narrowest a figure here may be: its captions are longer than the ones
 * under "What changed" ("Corrections in your words"), and their longest word,
 * "CORRECTIONS", is 84 px. At 110 px the four figures are two by two on a
 * phone and four across from the 1280 px laptop up, never three and one.
 */
export const STORED_VALUE_FIGURES = { minPx: 110, gapPx: 16 } as const;

/**
 * What the owner has put in, read back to them.
 *
 * Every screen on Home looks forward: the goal, the week, the work, the
 * numbers that arrived. Nothing looked back at what the OWNER has put into
 * this account, even though all of it is in the database already: the
 * decisions they made on drafts, the corrections they wrote in their own
 * words, the channels they connected, what went out and where, and the weeks
 * of their own history the plan now works from. Someone eight weeks in should
 * be able to see eight weeks of themselves here.
 *
 * WHAT THIS IS NOT, deliberately:
 *  - Not a game. No points, no badges, no levels, no streaks, and no progress
 *    bar toward a target we invented. A streak also stands in for an outcome
 *    that may not have happened, which would be a claim we cannot make.
 *  - Not a retention weapon. There is no "look what you would lose", no guilt
 *    and no loss-aversion line anywhere in this file, and the card is not
 *    rendered during or near a cancel flow. It is a statement of fact.
 *  - Not a forecast. Every figure is a count of something that already
 *    happened, straight from the payload. Nothing here is projected, and
 *    nothing here implies a business result.
 *  - Not a claim about the product either. The card says the owner MADE these
 *    decisions, never that the team "learned" from them: a decided approval is
 *    not fed into any later draft or prompt today. A change request drives one
 *    re-draft of the item it was about (operatorApprovalService.requestChanges)
 *    and is not kept as an accumulated voice, and brandVoice comes from the
 *    business description, not from corrections. Saying otherwise would be a
 *    capability claim the owner cannot verify, on the one card whose whole
 *    premise is that every line is a fact.
 *
 * The endpoint may not be deployed, or not be one the app may call (a site
 * may not, for now): then this renders nothing, like every other optional
 * surface on this screen.
 */

const label: React.CSSProperties = {
  fontSize: 'var(--text-label)', fontWeight: 700, letterSpacing: '0.6px',
  textTransform: 'uppercase', color: 'var(--text-dim)',
};

/** "a, b and c" — a list a person would read out loud, not a CSV. */
const joinList = (parts: string[]): string =>
  (parts.length <= 1
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/** "3 decisions" / "1 decision" — the count always leads. */
const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** A date the owner would recognize; the year appears only when it is not this one. */
function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const opts: Intl.DateTimeFormatOptions = d.getFullYear() === new Date().getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return d.toLocaleDateString('en-US', opts);
}

/** The Connect Center's networks, which carry the API's own names for them. */
export interface NetworkLabel { id: string; label: string }

const normalizeId = (v: string): string => v.trim().toLowerCase().replace(/[\s-]+/g, '_');

/**
 * Names for the handful of ids whose own spelling is not a name a customer
 * would recognize. This is a FALLBACK, not a catalog: the labels come from
 * the Connect Center payload this screen already loads, so there is no second
 * list of network names to keep in step with the API's.
 */
const FALLBACK_NAME: Record<string, string> = {
  gmb: 'Google Business Profile',
  google: 'Google Business Profile',
  google_business: 'Google Business Profile',
  google_business_profile: 'Google Business Profile',
  gbp: 'Google Business Profile',
  x: 'X',
  twitter: 'X',
  // Publication channels that are not social networks, so the Connect Center
  // payload never names them. Both come from the metered ledger.
  site: 'your site',
  email: 'email',
};

function channelNamer(networks: NetworkLabel[] | null | undefined) {
  const byId = new Map<string, string>();
  for (const n of networks ?? []) {
    if (n?.id && n?.label) byId.set(normalizeId(n.id), n.label);
  }
  return (platform: string): string => {
    const key = normalizeId(platform);
    // The API's own customer-facing label first, then the few names we can
    // spell better than the id does, then the id made readable. A platform we
    // have never heard of still gets a row; it is never dropped.
    const words = platform.replace(/[_-]+/g, ' ').trim();
    return byId.get(key)
      ?? FALLBACK_NAME[key]
      ?? (words.charAt(0).toUpperCase() + words.slice(1));
  };
}

/**
 * Names for the deliverable kinds in the metered ledger.
 *
 * The ledger's `type` is what was published: 'social_post', 'page', 'post',
 * 'product', 'translation', 'email_campaign', 'gift_card_setup' and whatever
 * a new tool meters next. The
 * card needs these because the TOTAL is not a post count, and a caption that
 * called it one would be false. Unknown kinds are made readable rather than
 * dropped, so a kind added on the API side still shows up honestly here.
 */
const TYPE_NAME: Record<string, { one: string; many: string }> = {
  social_post: { one: 'social post', many: 'social posts' },
  post: { one: 'site post', many: 'site posts' },
  page: { one: 'page', many: 'pages' },
  product: { one: 'product', many: 'products' },
  translation: { one: 'translation', many: 'translations' },
  email_campaign: { one: 'email campaign', many: 'email campaigns' },
  gift_card_setup: { one: 'gift card setup', many: 'gift card setups' },
};

/** English plural for an unknown snake_case noun. Never invents a word. */
function pluralize(word: string): string {
  if (/(?:s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

function typeName(type: string, n: number): string {
  const known = TYPE_NAME[normalizeId(type)];
  if (known) return n === 1 ? known.one : known.many;
  const words = type.replace(/[_-]+/g, ' ').trim().toLowerCase() || type;
  return n === 1 ? words : pluralize(words);
}

/** Statuses that mean "this is connected and nothing needs doing". */
const HEALTHY_STATUS = ['live', 'connected', 'active', 'ok'];

function statusNote(status: string | null): string | null {
  if (!status) return null;
  const s = status.trim().toLowerCase();
  if (!s || HEALTHY_STATUS.includes(s)) return null;
  // Say what the API says, in words. A channel that needs attention must not
  // be rendered as if it were fine.
  const words = s.replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Long notes are trimmed for the card; the owner's wording is never rewritten. */
const NOTE_MAX = 200;
const trimNote = (note: string): string =>
  note.length <= NOTE_MAX ? note : `${note.slice(0, NOTE_MAX).trimEnd()}…`;

const ChannelChip: React.FC<{ channel: StoredValueChannel; name: string }> = ({ channel, name }) => {
  const since = shortDate(channel.connectedAt);
  const note = statusNote(channel.status);
  return (
    <span
      style={{
        fontSize: 'var(--text-meta)', padding: '4px 10px', borderRadius: 999,
        border: '1px solid var(--glass-border)', background: 'var(--glass)',
        color: 'var(--text-dim)',
      }}
    >
      <span style={{ color: 'var(--text)', fontWeight: 600 }}>{name}</span>
      {since ? ` · since ${since}` : ''}
      {note ? <span style={{ color: 'var(--warning)' }}>{` · ${note}`}</span> : null}
    </span>
  );
};

/**
 * What the owner has built here, for one business: null until it answers,
 * and when it could not be read (readStoredValue). Another business never
 * shows the one read before.
 */
export function useStoredValue(host: ScreensHost, instanceId?: string | null): StoredValueData | null {
  const business = teamBusiness(host.scope, instanceId);
  const [state, setState] = useState<{ id: string | null; data: StoredValueData | null }>({ id: null, data: null });
  useEffect(() => {
    if (!business) return undefined;
    let alive = true;
    // A failure is our problem, not a message for the owner: the card just stays away.
    void readStoredValue(host.transport, business).then((data) => { if (alive) setState({ id: business, data }); });
    return () => { alive = false; };
    // The transport may be a new object on each render: read again only for another business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business]);
  return state.id === business ? state.data : null;
}

export interface StoredValueCardProps {
  /** The business's Home (useBusinessHome): the business, and its channels' names. */
  home: BusinessHome;
  /** In its own card (the default), or bare inside the app's (the dashboard's Home card). */
  card?: boolean;
}

/** What you have built here, as a Home section: nothing at all until it has been read (no empty card). */
export const StoredValueCard: React.FC<StoredValueCardProps> = ({ home, card = true }) => {
  const data = useStoredValue(home.host, home.instanceId);
  if (!data) return null;
  // The Connect Center's networks name each platform as the API does.
  const body = <StoredValueView data={data} networks={home.connect?.networks ?? null} />;
  return card ? <GlassCard padding={24} data-testid="stored-value-card">{body}</GlassCard> : body;
};

/** The card for a loaded payload. */
export const StoredValueView: React.FC<{
  data: StoredValueData;
  networks?: NetworkLabel[] | null;
}> = ({ data, networks }) => {
  const { decisions, voice, channels, published, history, sinceDays } = data;
  const decisionCount = decisions.approved + decisions.changesRequested + decisions.rejected;

  // The count tiles, in the same shape as the evidence tiles above them. Each
  // one appears only when it has something real to say.
  const tiles: Figure[] = [];
  if (voice.corrections > 0) {
    tiles.push({ value: voice.corrections.toLocaleString('en-US'), label: 'Corrections in your words' });
  }
  if (channels.length > 0) {
    tiles.push({ value: channels.length.toLocaleString('en-US'), label: 'Channels you connected' });
  }
  if (published.total > 0) {
    // NOT "Posts published". This total is every metered publication of every
    // kind — social posts, site pages, site posts, email campaigns, setup
    // actions — so calling it posts would state a false fact, and it would
    // also collide with the end-of-bridge panel, which shows a real "Posts
    // published" number computed from executed approvals. The kinds are named
    // on their own line below, from published.byType.
    tiles.push({ value: published.total.toLocaleString('en-US'), label: 'Published by your team' });
  }
  if (history.weeks > 0) {
    tiles.push({ value: history.weeks.toLocaleString('en-US'), label: 'Weeks of your history' });
  }

  const decisionParts: string[] = [];
  if (decisions.approved > 0) decisionParts.push(`${decisions.approved.toLocaleString('en-US')} approved`);
  if (decisions.changesRequested > 0) {
    decisionParts.push(`${decisions.changesRequested.toLocaleString('en-US')} you asked to change`);
  }
  if (decisions.rejected > 0) decisionParts.push(`${decisions.rejected.toLocaleString('en-US')} rejected`);

  const firstDecision = shortDate(decisions.firstDecisionAt);
  const firstPublished = shortDate(published.firstAt);
  const firstWeek = shortDate(history.firstWeekStart);
  const notes = voice.latestNotes.slice(0, 3);

  const channelName = channelNamer(networks);
  const publishedLine = published.byChannel.length
    ? joinList(published.byChannel
      .map((b) => `${b.count.toLocaleString('en-US')} on ${channelName(b.channel)}`))
    : null;
  // What those publications actually were. This is the line that keeps the
  // total above from being read as a post count.
  const typeLine = published.byType.length
    ? joinList(published.byType
      .map((b) => `${b.count.toLocaleString('en-US')} ${typeName(b.type, b.count)}`))
    : null;

  /*
   * What went out, as one sentence: the kinds first, then where they landed.
   * Kept together because neither half stands alone. "12 on Facebook Page, 9
   * on Instagram and 6 on your site" has no subject on its own, and the kinds
   * without the channels leave the tile's total unplaced.
   */
  const publishedDetail = (() => {
    // One kind on one channel is one phrase: "21 social posts on Facebook
    // Page". Both lists sum to the same total, so with a single entry each
    // there is nothing to split apart and "21 social posts: 21 on Facebook
    // Page" would just say the number twice.
    const single = published.byType.length === 1 && published.byChannel.length === 1
      ? `${typeName(published.byType[0].type, published.byType[0].count)} on ${channelName(published.byChannel[0].channel)}`
      : null;
    const body = single
      ? `${published.byType[0].count.toLocaleString('en-US')} ${single}`
      : (typeLine && publishedLine ? `${typeLine}: ${publishedLine}` : (typeLine ?? publishedLine));
    if (!body) return null;
    return firstPublished ? `${body}. The first one went out ${firstPublished}.` : `${body}.`;
  })();

  // True when the card has at least one thing to show. Derived from every
  // render condition below, not from the counts alone: a payload that sent
  // corrections the card can quote but a corrections count it could not read
  // would otherwise print "nothing has built up here yet" directly above the
  // owner's own words, which is both false and insulting to the one person it
  // would reach — someone who has been here long enough to have written them.
  const anything = decisionCount > 0 || tiles.length > 0 || channels.length > 0
    || publishedDetail !== null || history.weeks > 0
    || notes.length > 0;

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <div style={label}>What you have built here</div>
        {sinceDays != null && sinceDays > 0 && (
          <span style={{ fontSize: 'var(--text-meta)', color: 'var(--text-dim)' }}>
            {plural(sinceDays, 'day', 'days')} with your team
          </span>
        )}
      </div>

      {!anything && (
        // Day two. Nothing has accumulated yet, and saying so plainly is
        // better than an empty box or a number dressed up to look like one.
        <p style={{ margin: 0, fontSize: 'var(--text-body)', color: 'var(--text)', lineHeight: 'var(--leading-body)' }}>
          Nothing has built up here yet. This fills as you go: every draft you approve or reject,
          every change you ask for in your own words, each channel you connect, and everything
          your team publishes.
        </p>
      )}

      {decisionCount > 0 && (
        // "You have made", not "your team has learned from". Nothing reads a
        // decided approval back into a later draft or prompt, so the second
        // sentence would be a capability claim the code does not keep.
        <p style={{ margin: 0, fontSize: 'var(--text-body)', color: 'var(--text)', lineHeight: 'var(--leading-body)' }}>
          You have made {plural(decisionCount, 'decision', 'decisions')} on your team's work
          {firstDecision ? ` since ${firstDecision}` : ''}.
        </p>
      )}

      {/* The split is only worth a line when it says something the sentence
          above does not: with one kind of decision it would just repeat the
          total back. */}
      {decisionParts.length > 1 && (
        <p style={{ margin: '4px 0 0', fontSize: 'var(--text-data)', color: 'var(--text-dim)' }}>
          {joinList(decisionParts)}.
        </p>
      )}

      {tiles.length > 0 && (
        // Fixed, even columns measured on the card: four, two or one across,
        // never three and one (Figures).
        <div style={{ marginTop: 12 }}>
          <Figures groups={[{ key: 'built', figures: tiles }]} {...STORED_VALUE_FIGURES} />
        </div>
      )}

      {channels.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {channels.map((c, i) => (
            <ChannelChip
              // Two accounts on the same platform are possible, so the index
              // is part of the key rather than the platform alone.
              key={`${c.platform}-${i}`}
              channel={c}
              name={channelName(c.platform)}
            />
          ))}
        </div>
      )}

      {publishedDetail && (
        <p style={{ margin: '10px 0 0', fontSize: 'var(--text-data)', color: 'var(--text-dim)' }}>
          {publishedDetail}
        </p>
      )}

      {history.weeks > 0 && (
        <p style={{ margin: '4px 0 0', fontSize: 'var(--text-data)', color: 'var(--text-dim)' }}>
          Your team has measured {plural(history.weeks, 'week', 'weeks')} of your own history
          {firstWeek ? `, starting the week of ${firstWeek}` : ''}.
        </p>
      )}

      {notes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...label, marginBottom: 6 }}>In your own words</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {notes.map((n, i) => {
              const at = shortDate(n.at);
              return (
                <blockquote
                  key={`${n.at ?? 'note'}-${i}`}
                  style={{
                    margin: 0, padding: '8px 12px', borderLeft: '3px solid var(--glass-border)',
                    fontSize: 'var(--text-body)', lineHeight: 'var(--leading-body)',
                    color: 'var(--text)', whiteSpace: 'pre-wrap',
                  }}
                >
                  {trimNote(n.note)}
                  {at && (
                    <span style={{ display: 'block', fontSize: 'var(--text-meta)', color: 'var(--text-dim)' }}>
                      {at}
                    </span>
                  )}
                </blockquote>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default StoredValueCard;
