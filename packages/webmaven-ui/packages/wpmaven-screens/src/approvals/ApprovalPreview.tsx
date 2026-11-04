/**
 * The real thing an approval would publish, shown where the decision is made.
 *
 * Owners were approving from a one-line summary: a title and, at best, the
 * first param that looked like text. The video was a URL, the picture was not
 * shown at all, and the copy was cut off. This renders what actually goes out:
 * the video in a player, the images in a grid with their caption, the full
 * post text, and the networks it is headed for. It is the same component on
 * the customer pages and in the staff console, so both sides of a review are
 * looking at one truth.
 *
 * Shared by the dashboard and the plugin (2026-10-16): what only one app
 * draws comes from its host's renderers, an edit operation's own preview card
 * and a video to choose. Styled inline on the kit's tokens.
 *
 * Two modes. Collapsed (the default, for a list) shows the media and about
 * three lines of copy with a "Show more" that opens the rest in place.
 * Expanded (`expanded`) never shortens anything: it is what "Open in full"
 * shows. Nothing here autoplays and nothing makes a sound until the person
 * presses play.
 *
 * `params` is `Json` in the schema. A row with no copy, no media and no
 * targets, or a payload of a shape we do not know, renders a plain
 * "Nothing to preview" and never throws. When the row's sentence already says
 * what the change does (a database write, a setting, a plugin), it renders
 * nothing at all: an empty box under that sentence read as if something were
 * missing (2026-09-29).
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import type { OperatorApproval } from './types';
import {
  approvalLinkPost, deriveApprovalPreview, isEmptyPreview, platformMeta, type ApprovalPreviewData,
} from './previewData';
import { drawableSitePreview, type SitePreviewBeforeAnswer } from './sitePreview';
import { approvalNetworkNotes, approvalSentence, type ApprovalNetworkNote } from './targets';
import { postingAccountsShown } from './postingAccounts';
import { SitePostPreview } from './SitePostPreview';
import { approvalLabelNote, isVideoChoiceApproval } from './videoLabel';
import { StoreApprovalView } from './storeApprovalViews';
import { HostLink } from '../host/HostLink';
import { useOptionalScreensHost } from '../host/HostContext';
import type { ScreensRenderers } from '../host/types';
import { TYPE, bareList, body, recessed, small, textLink } from './styles';

export interface ApprovalPreviewProps {
  /** The approval row as the API returns it. When the staff API has already
   *  attached `preview`, that is used as-is; otherwise it is derived from
   *  `params` with the same rules. A post, page, product or translation for
   *  the site (`sitePreview`, or read from params) is drawn as the site will
   *  show it (SitePostPreview), everywhere this component is used. */
  approval: Pick<OperatorApproval, 'params'>
    & Partial<Pick<OperatorApproval, 'id' | 'status' | 'toolName' | 'targets' | 'sitePreview' | 'networkNotes' | 'instanceId' | 'reason' | 'goesToTikTok' | 'youtube' | 'videoLabel' | 'postingAccounts' | 'linkPost' | 'edit'>>
    & { preview?: ApprovalPreviewData | null; metadata?: unknown };
  /** Where an update's Before comes from (the staff console passes its own). */
  loadBefore?: (approvalId: string) => Promise<SitePreviewBeforeAnswer>;
  /** Show everything at full length, with no "Show more". */
  expanded?: boolean;
  /**
   * Leave the video out. The Post to TikTok screen plays the exact file TikTok
   * would get in its own player and reads its duration from it; a second
   * player of the same file above it would only invite the question of which
   * one is the real one.
   */
  hideVideo?: boolean;
  /**
   * The app's own pieces (its edit preview, its video choice summary). By
   * default the host's; the dashboard's pages outside a screen pass theirs.
   */
  renderers?: Pick<ScreensRenderers, 'editPreview' | 'videoChoice'>;
  className?: string;
  style?: React.CSSProperties;
}

/** Roughly three lines at body size. A CSS clamp, so the text underneath is
 *  still whole: nothing is cut out of the string, only hidden until asked. */
const CLAMP_LINES = 3;

/** A caption under its picture, or alone. */
const captionStyle: React.CSSProperties = { ...small, marginTop: 8, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', opacity: 0.8 };
const clampStyle: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: CLAMP_LINES,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

/**
 * An email campaign the team asks to send (email_campaign_send, 2026-10-03):
 * its subject, the test copy the owner already got, and the way to the
 * email's own page, where it can be read in full and changed. Null for any
 * other approval.
 */
export function campaignApprovalView(
  approval: Pick<OperatorApproval, 'params'> & Partial<Pick<OperatorApproval, 'toolName' | 'instanceId'>>,
): { subject: string | null; href: string | null } | null {
  if (approval.toolName !== 'email_campaign_send') return null;
  const p = (approval.params ?? {}) as Record<string, unknown>;
  const subject = typeof p.subject === 'string' && p.subject.trim() ? p.subject.trim() : null;
  const campaignId = typeof p.campaignId === 'string' ? p.campaignId : null;
  const href = campaignId && approval.instanceId
    ? `/instances/${encodeURIComponent(approval.instanceId)}/campaigns/${encodeURIComponent(campaignId)}`
    : null;
  return { subject, href };
}

export const ApprovalPreview: React.FC<ApprovalPreviewProps> = ({
  approval, expanded = false, hideVideo = false, className, style, loadBefore, renderers,
}) => {
  const host = useOptionalScreensHost();
  const editPreview = renderers?.editPreview ?? host?.renderers?.editPreview;
  const videoChoice = renderers?.videoChoice ?? host?.renderers?.videoChoice;
  const box: React.CSSProperties = { ...recessed, ...style };
  // A change to the site through the edit operations: its preview (what it
  // changes, its checks, Open preview), never its call. Each app draws its own.
  if (editPreview?.matches(approval)) {
    return <>{editPreview.render(approval, { className })}</>;
  }
  // A reply to a form message, an order change, a coupon: the thing itself.
  if (['reply_to_message', 'update_order', 'save_coupon'].includes(approval.toolName ?? '')) {
    return <StoreApprovalView approval={approval} className={className} style={style} />;
  }
  const campaign = campaignApprovalView(approval);
  if (campaign) {
    return (
      <div className={className} style={{ ...box, fontSize: TYPE.body, lineHeight: TYPE.bodyLeading }} data-testid="campaign-approval">
        {campaign.subject && <p style={{ margin: 0, fontWeight: 550, color: 'var(--text)', overflowWrap: 'break-word' }}>{campaign.subject}</p>}
        <p style={{ ...small, marginTop: 4, color: 'var(--text-dim)' }}>
          A test copy is in your inbox. It goes to everyone who agreed to get your emails.
        </p>
        {campaign.href && (
          <HostLink to={campaign.href} style={{ ...small, ...textLink, display: 'inline-block', marginTop: 8 }}>Open the email</HostLink>
        )}
      </div>
    );
  }
  // A video to choose: our pick, its price and the way to the choice screen
  // (pricing v4 3.6). Its params are the choice, not a post to draw. Only the
  // dashboard draws it (a site never lists one).
  if (isVideoChoiceApproval(approval)) {
    return videoChoice ? (
      <div className={className} style={box}>
        {videoChoice(approval)}
      </div>
    ) : null;
  }
  // A change that puts a post, a page or a product on the site: the post
  // itself, never its words run together (2026-09-24).
  const site = drawableSitePreview(approval);
  if (site) {
    return (
      <div className={className} style={box}>
        <SitePostPreview
          preview={site}
          expanded={expanded}
          approvalId={approval.id}
          approvalStatus={approval.status}
          loadBefore={loadBefore}
        />
      </div>
    );
  }
  const derived = approval.preview
    ?? deriveApprovalPreview(approval.params, { toolName: approval.toolName, targets: approval.targets });
  const preview = hideVideo ? { ...derived, videoUrl: null, posterUrl: null } : derived;
  const notes = approvalNetworkNotes(approval);
  const accounts = postingAccountsShown(approval);
  // A shared video's second post, in its own words: approved
  // with the video, so it is read here before the yes, never only the caption.
  const linkPost = approvalLinkPost(approval);

  if (isEmptyPreview(preview) && notes.length === 0 && !accounts) {
    // The sentence on the card already explains the change: nothing to add.
    if (approvalSentence(approval)) return null;
    return (
      <div className={className} style={{ ...box, ...small, padding: 12, opacity: 0.6 }}>
        Nothing to preview.
      </div>
    );
  }

  const hasMedia = !!preview.videoUrl || preview.imageUrls.length > 0;
  // The label of a video we made, said beside the player (EU AI Act art. 50(4)):
  // the API's videoLabel on the row (the "Includes AI" mark, or TikTok's own
  // label on a video made for TikTok), else params.videoLabel.
  const aiLabel = preview.videoUrl ? approvalLabelNote(approval) : null;

  return (
    <div className={className} style={box}>
      {preview.videoUrl && (
        <VideoPlayer url={preview.videoUrl} poster={preview.posterUrl ?? null} />
      )}
      {aiLabel && (
        <p data-testid="video-ai-label" style={{ ...small, marginTop: 4, opacity: 0.7 }}>{aiLabel}</p>
      )}
      {!preview.videoUrl && preview.imageUrls.length > 0 && (
        <ImageGrid urls={preview.imageUrls} />
      )}
      {/* The caption sits under the picture it belongs to, and only when it says
          something the post text does not. */}
      {hasMedia && preview.caption && (
        <p style={captionStyle}>{preview.caption}</p>
      )}
      {preview.text && (
        <PostText text={preview.text} expanded={expanded} style={hasMedia ? { marginTop: 12 } : undefined} />
      )}
      {/* A caption with no media to hang under is still copy that goes out. */}
      {!hasMedia && preview.caption && (
        <p style={captionStyle}>{preview.caption}</p>
      )}
      {/* The video's link post goes out as a post of its own on the link
          networks: its words, with where the link lands, under the caption. */}
      {linkPost && (
        <div data-testid="link-post" style={{ marginTop: hasMedia || preview.text ? 12 : 0, borderTop: '1px solid var(--glass-border)', paddingTop: 12 }}>
          <p style={{ ...small, fontWeight: 550, color: 'var(--text)' }}>Then on {andWords(linkPost.networks)}:</p>
          <PostText text={linkPost.text} expanded={expanded} style={{ marginTop: 4 }} />
        </div>
      )}
      {preview.platforms.length > 0 && (
        <PlatformChips platforms={preview.platforms} style={hasMedia || preview.text ? { marginTop: 12 } : undefined} />
      )}
      {/* Which accounts it goes out as, by the chips, before the yes: a post
          headed for another business's Instagram is seen here (API dev
          9eb23faf). Not once it went out: the accounts may have changed. */}
      {accounts && (
        <p
          data-testid="posting-accounts"
          style={{ ...small, fontWeight: 550, color: 'var(--text)', overflowWrap: 'anywhere', marginTop: preview.platforms.length > 0 || hasMedia || preview.text ? 8 : 0 }}
        >
          {accounts}
        </p>
      )}
      {/* What differs per network, right by the chips, before the yes: an
          image X and LinkedIn will not carry, a TikTok that stays private. */}
      {notes.length > 0 && (
        <NetworkNotes notes={notes} style={preview.platforms.length > 0 || hasMedia || preview.text ? { marginTop: 8 } : undefined} />
      )}
    </div>
  );
};

/**
 * `preload="metadata"` so a list of ten videos does not download ten files;
 * `playsInline` so a phone shows it in the card instead of taking over the
 * screen. No `autoPlay`, no `muted` trick to get one: nothing plays until the
 * owner presses play. When the file cannot be played here (an expired signed
 * URL, a codec the browser lacks) the URL is still offered as a link rather
 * than a black box with no explanation.
 */
function VideoPlayer({ url, poster }: { url: string; poster: string | null }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [url]);

  if (broken) {
    return (
      <p style={{ ...small, opacity: 0.7 }}>
        This video could not be played here.{' '}
        <a style={textLink} href={url} target="_blank" rel="noreferrer">Open the video</a>
      </p>
    );
  }
  return (
    <div>
      <video
        controls
        preload="metadata"
        playsInline
        src={url}
        poster={poster ?? undefined}
        onError={() => setBroken(true)}
        style={{ display: 'block', width: '100%', maxHeight: 420, borderRadius: 'var(--r-field, 10px)', background: '#000' }}
      >
        <a href={url} target="_blank" rel="noreferrer">Open the video</a>
      </video>
      <a
        style={{ ...small, ...textLink, marginTop: 4, display: 'inline-block', opacity: 0.6 }}
        href={url}
        target="_blank"
        rel="noreferrer"
      >
        Open video in a new tab
      </a>
    </div>
  );
}

/** One picture takes the width; two or more share it. A picture the browser
 *  cannot load drops out of the grid and leaves its link, so a bad URL never
 *  shows as a broken-image glyph next to good ones. */
function ImageGrid({ urls }: { urls: string[] }) {
  // Two side by side; three or more in columns of at least 120px, never
  // more than three across (the dashboard's two, then three on a wide screen).
  const grid: React.CSSProperties | undefined = urls.length === 1
    ? undefined
    : urls.length === 2
      ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }
      : { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(max(120px, calc((100% - 16px) / 3)), 1fr))', gap: 8 };
  return (
    <div style={grid}>
      {urls.map((u, i) => <PreviewImage key={`${i}-${u}`} url={u} single={urls.length === 1} />)}
    </div>
  );
}

function PreviewImage({ url, single }: { url: string; single: boolean }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [url]);
  if (broken) {
    return (
      <a style={{ ...small, ...textLink, display: 'block', wordBreak: 'break-all', opacity: 0.6 }} href={url} target="_blank" rel="noreferrer">
        Image could not be loaded. Open it
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
      <img
        src={url}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        style={single
          ? { display: 'block', maxHeight: 420, width: '100%', borderRadius: 'var(--r-field, 10px)', objectFit: 'contain', background: 'rgba(0, 0, 0, 0.05)' }
          : { display: 'block', aspectRatio: '1 / 1', width: '100%', borderRadius: 'var(--r-field, 10px)', objectFit: 'cover' }}
      />
    </a>
  );
}

/**
 * The full copy, whole in the DOM, clamped by CSS until asked. The toggle only
 * appears when the text really overflows three lines; a two-line post gets no
 * button to press for nothing. Measured after layout rather than guessed from
 * length, because a post of six short lines overflows and a post of two long
 * ones may not.
 */
function PostText({ text, expanded, style }: { text: string; expanded: boolean; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(expanded);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => { if (expanded) setOpen(true); }, [expanded]);

  useLayoutEffect(() => {
    if (open) return;
    const el = ref.current;
    if (!el) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);

  return (
    <div style={style}>
      <p
        ref={ref}
        style={{ ...body, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', color: 'var(--text)', ...(open ? {} : clampStyle) }}
      >
        {text}
      </p>
      {!expanded && (overflows || open) && (
        <Button
          size="sm"
          variant="bare"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Show less' : 'Show more'}
        </Button>
      )}
    </div>
  );
}

/** Per-network facts, each with the logo of the network it is about. */
function NetworkNotes({ notes, style }: { notes: ApprovalNetworkNote[]; style?: React.CSSProperties }) {
  return (
    <ul style={{ ...bareList, display: 'flex', flexDirection: 'column', gap: 4, ...style }} data-testid="network-notes">
      {notes.map((n) => {
        const meta = n.network ? platformMeta(n.network) : null;
        return (
          <li
            key={n.note}
            data-network={n.network || undefined}
            style={{ ...small, display: 'flex', alignItems: 'flex-start', gap: 6, color: 'var(--text)' }}
          >
            {meta?.Icon
              ? <meta.Icon size={12} color={meta.color} aria-hidden="true" style={{ marginTop: 2, flexShrink: 0 }} />
              : <span aria-hidden="true" style={{ width: 12, flexShrink: 0 }} />}
            <span style={{ overflowWrap: 'anywhere' }}>{n.note}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Where it goes, with the logo the owner knows the account by. */
function PlatformChips({ platforms, style }: { platforms: string[]; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, ...style }}>
      <span style={{ ...small, opacity: 0.6 }}>Goes to</span>
      {platforms.map((p) => {
        const meta = platformMeta(p);
        return (
          <span
            key={p}
            style={{
              ...small, display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 9999,
              border: '1px solid var(--glass-border)', background: 'var(--bg-raised)', padding: '2px 8px', color: 'var(--text)',
            }}
          >
            {meta.Icon && <meta.Icon size={12} color={meta.color} aria-hidden="true" />}
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}

export default ApprovalPreview;

/** "Facebook, LinkedIn and X". */
function andWords(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
