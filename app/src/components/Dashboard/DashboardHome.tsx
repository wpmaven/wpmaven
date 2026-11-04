import React, { useCallback, useState } from 'react';
import { WELCOME_LINES_PX as LINES_PX, WelcomeHeader, useFirstWelcome, welcomeMarkSize as markSizeFor, welcomeTitle } from '@yotako/wpmaven-screens';
import { BrandStillMark } from '../BrandLoader';
import EmbeddedChat from './EmbeddedChat';
import { isSiteChatEnabled } from '../../utils/siteChat';
import NextStepCard, { PausedBanner } from './NextStepCard';
import DesignWayBackCard from './DesignWayBackCard';
import WhatsAppSetupCard, { wpUserId } from './WhatsAppSetupCard';
import {
  OverviewActivity, OverviewBuilt, OverviewBusinessDetails, OverviewFigures, OverviewGetPaid, OverviewGrowth, OverviewHealth,
  OverviewInsights, OverviewSitePreview, OverviewTeam, OverviewWebsite, useOverview,
} from './home/OverviewSections';
import { siteBrand, type SiteBrand } from '../../utils/brand';
import { useSiteState } from '../../utils/siteState';
import { currentTier } from '../../utils/tier';

/**
 * The greeting's name: the WordPress user's own first name, else, for an
 * administrator, the account holder's (the site state). Never the display
 * name or the login ("admin").
 */
export function greetingName(wpData: any, accountFirstName: string | null): string {
  const own = typeof wpData?.user?.firstName === 'string' ? wpData.user.firstName.trim() : '';
  if (own) return own;
  if (!wpData?.user?.isAdmin) return '';
  const account = (accountFirstName ?? '').trim() || (typeof wpData?.account?.firstName === 'string' ? wpData.account.firstName.trim() : '');
  return account;
}

/**
 * The greeting's two lines, from the top of Welcome back's tallest letters
 * to the baseline of the line under it, in px: the shared greeting's
 * (wpmaven-screens, WelcomeHeader).
 */
export const WELCOME_LINES_PX = LINES_PX;

/**
 * The box of the mark beside Welcome back, for the mark to be exactly as
 * tall as the two lines: the WPMaven mark's box is a little taller than the
 * mark, a brand's logo fills its own.
 */
export function welcomeMarkSize(brand: SiteBrand = siteBrand()): number {
  return markSizeFor(brand.mode === 'wpmaven');
}

/** The thread's height in Overview's chat card, as the dashboard's Home has it: it scrolls past it. */
export const CARD_THREAD_MAX = 'min(60vh, 520px)';

/** Each request a section puts in the chat's box, numbered for the page's life. */
let fillTokens = 0;

interface ChatBlockProps {
  full: boolean;
  onToggleFull: () => void;
  /** Words a section put in the box. */
  fill?: { text: string; token: number } | null;
}

/**
 * Overview's chat: the Co-CEO's card, and its full view (the button in the
 * chat's header; Esc leaves it). Both draw the same chat: the thread, the
 * turn in progress and what is typed stay as they are across the switch.
 */
function ChatBlock({ full, onToggleFull, fill = null }: ChatBlockProps) {
  // Chat off in WP-admin (1.2.9): the dashboard card in normal flow, and no
  // full view.
  if (!isSiteChatEnabled()) {
    return (
      <div className="wm-home__chat-card" data-tour="chat">
        <EmbeddedChat />
      </div>
    );
  }
  // The card is as tall as its thread, up to CARD_THREAD_MAX, as on the
  // dashboard's Home; the full view takes the page.
  return (
    <div className="wm-home__chat" data-tour="chat">
      <EmbeddedChat full={full} onToggleFull={onToggleFull} fill={fill} threadMaxHeight={full ? undefined : CARD_THREAD_MAX} />
    </div>
  );
}

/**
 * Overview, the dashboard's Home for this one site, laid out as the
 * dashboard lays out Home (2026-10-17), top to bottom:
 *
 *  1. WhatsApp, until it is linked (the owner can put it off);
 *  2. Welcome back, and nothing else on its row: the site and the "?" are
 *     in the top bar, the tours start by themselves or from the "?";
 *  3. what asks for something: a paused site, the next step, the design's
 *     way back;
 *  4. on the right, the site, in the dashboard Home's side column and order
 *     (2026-10-17): its screenshot, Turn on a way to get paid, Check what
 *     your site says about you, Your website (the address, Share, Feature
 *     on WPMaven), then the plugin's own Site health, with Check now
 *     (administrators);
 *  5. beside it, the main column: Report / Your team's plan / Goals, the
 *     Co-CEO's chat, the growth card ("Your plan, and where you are" with
 *     the milestones beside it) and This week;
 *  6. under both, across the page: the team and the week's plan, then the
 *     numbers card and What you have built here side by side, then Recent
 *     activity (administrators).
 *
 * The two columns come at the width the dashboard's Home takes them, the
 * room the page really has (dashboard.css, .wm-home__layout), and the side
 * column floats right as the dashboard's does: when it is the taller, the
 * cards under the main column start beside it and widen once it ends. Below
 * that width, one column (2026-10-18): the main column (the chat), then the
 * side column's cards, then the rest. The page scrolls as one, at every
 * width.
 */
function DashboardHome() {
  const site = useSiteState();
  const firstName = greetingName((window as any).WEBMAVEN_WP_DATA, site.account.firstName);
  // "Welcome" the first time this WordPress user opens Overview, then "Welcome back".
  const firstTime = useFirstWelcome(wpUserId());
  const owner = currentTier() === 'owner';
  const overview = useOverview();
  const [chatFull, setChatFull] = useState(false);
  const toggleFull = useCallback(() => setChatFull((v) => !v), []);

  // A milestone's request goes into the chat's box, never sent for the
  // owner, and the chat comes into view.
  const [fill, setFill] = useState<{ text: string; token: number } | null>(null);
  const chatOn = isSiteChatEnabled();
  const onAsk = useCallback((text: string) => {
    fillTokens += 1;
    setFill({ text, token: fillTokens });
    document.querySelector('.wm-home [data-tour="chat"]')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, []);

  if (chatFull) {
    // The chat takes the whole page; everything else waits behind it.
    return (
      <div className="wm-home wm-home--chat-fullscreen">
        <div className="wm-home__body">
          <ChatBlock full onToggleFull={toggleFull} fill={fill} />
        </div>
      </div>
    );
  }

  return (
    <div className="wm-home">
      <div className="wm-home__lead" data-testid="wm-home-lead">
        <WhatsAppSetupCard />
      </div>

      {/* The dashboard's greeting (wpmaven-screens), with the product's mark,
          still: the team's work shows on their faces below. Exactly as tall
          as the title and the line under it, and centred on them
          (welcomeMarkSize). */}
      <WelcomeHeader
        className="wm-home__welcome"
        data-tour="welcome"
        mark={<BrandStillMark size={welcomeMarkSize()} />}
        title={welcomeTitle(firstName, firstTime)}
        subtitle="Here's what's happening with your site."
      />

      {/* What asks for something. Each draws nothing when it does not apply,
          and an empty row takes no room. */}
      <div className="wm-home__notices" data-testid="wm-home-notices">
        <PausedBanner />
        <NextStepCard />
        {owner && <DesignWayBackCard />}
      </div>

      <div className="wm-home__layout" data-testid="wm-home-layout">
        {/* First in the page, so it floats right beside the main column; on a
            phone the stylesheet puts it after the main column. Each card
            draws nothing when it has nothing to say, and an empty column
            takes no room. */}
        <div className="wm-home__col wm-home__side" data-testid="wm-home-side">
          <OverviewSitePreview overview={overview} />
          <OverviewGetPaid overview={overview} />
          <OverviewBusinessDetails overview={overview} />
          <OverviewWebsite overview={overview} />
          <OverviewHealth overview={overview} />
        </div>
        <div className="wm-home__col wm-home__main" data-testid="wm-home-main">
          <OverviewInsights overview={overview} />
          <ChatBlock full={false} onToggleFull={toggleFull} fill={fill} />
          <OverviewGrowth overview={overview} onAsk={chatOn ? onAsk : undefined} />
        </div>
        <div className="wm-home__lower" data-testid="wm-home-lower">
          <OverviewTeam overview={overview} />
          {/* The numbers and what was built, side by side, half the width
              each and the same height; one under the other where two would
              be narrower than 360px; the one alone takes the row. */}
          <div className="wm-home__pair" data-testid="wm-home-pair">
            <OverviewFigures overview={overview} />
            <OverviewBuilt overview={overview} />
          </div>
          <OverviewActivity overview={overview} />
        </div>
      </div>
    </div>
  );
}

export default DashboardHome;
