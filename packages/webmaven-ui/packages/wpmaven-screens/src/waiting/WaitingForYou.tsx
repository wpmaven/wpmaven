/**
 * Waiting for you: everything that needs a decision from the owner, in one
 * place, the same screen in the dashboard and in the WordPress plugin
 * (2026-10-16). It was two pages that drifted: the plugin listed only the
 * changes to its own site and sent everything else to the dashboard.
 *
 * The nav research (2026-09-01) found that the sidebar had no destination
 * for the owner's main job. They approve what the team wants to publish,
 * answer customers who wrote in, and act on alerts, and those lived in three
 * different places. This is that destination.
 *
 * One tab per kind (tabs.ts), each with its count: the approvals waiting for
 * a yes, the ones said yes to and waiting for the plan's actions, the
 * changes a person on the team prepared, the alerts, and the customers who
 * can still be answered. Only the tabs with something show, the page opens
 * on the first of them, and a tab emptied during the visit stays with "All
 * done here". The tab is the app's to keep in its address (`tab`,
 * `onTabChange`).
 *
 * The host says whose data it is: the account (each card names its
 * business) or one site (every read names its instance, and no card names a
 * business). In a site's view the API says per row what the site may do;
 * the card follows it (ApprovalCard).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, PageHeader, Skeleton, Tabs, TabPanel } from '@yotako/webmaven-ui';
import {
  DECISION_OUTCOME_UNKNOWN, OperatorInline, bringIntoView, errorMessage, noAnswer, scrollBehavior,
} from '@yotako/wpmaven-onboarding/shared';
import type {
  DecideResult, OperatorApproval, SiteDecideResult, TikTokConsentInput, TikTokDraftInput, YouTubeUploadInput,
} from '../approvals/types';
import type { ScreensHost } from '../host/types';
import { ScreensHostProvider } from '../host/HostContext';
import { HostLink } from '../host/HostLink';
import { ApprovalCard } from '../approvals/ApprovalCard';
import { ReceiptNote } from '../approvals/ReceiptNote';
import { approvalGoesToTikTok, approvalPath } from '../approvals/targets';
import { decideFromCard, initialYouTubeForm, youtubeChoiceId, type YouTubeUploadForm } from '../approvals/youtubeVisibility';
import {
  cancelReceipt, changesReceipt, decisionReceipt, siteDecisionReceipt, type Receipt, type ReceiptTone,
} from '../approvals/receipts';
import { heldCancelWords } from '../approvals/heldItems';
import { isVideoChoiceApproval, skippedChoiceReceipt } from '../approvals/videoLabel';
import { TYPE } from '../approvals/styles';
import {
  ALL_DONE_TEXT, activeWaitingTab, nextWaitingTab, shownTabs, waitingBadgeCount, waitingTabLabel,
  type WaitingCounts, type WaitingTab,
} from './tabs';
import { readAlerts, readApprovals, readCustomers, type CustomerChannel, type WaitingAlert } from './reads';
import { PreparedChanges, usePreparedChanges } from './PreparedChanges';
import { SCREENS_VERSION } from '../version';

/** An approve publishes to each network in turn inside its call (an Instagram Reel alone can take minutes). */
export const DECIDE_TIMEOUT_MS = 10 * 60_000;

export interface WaitingForYouProps {
  host: ScreensHost;
  /** The tab the address names (the dashboard's ?tab=, the plugin's #/approvals/<tab>), or null. */
  tab: string | null | undefined;
  /** A tab was chosen: the app puts it in its address with a push, so Back returns to the one before. */
  onTabChange: (tab: WaitingTab) => void;
  /** The address of a tab, for the "Next:" link's href (a middle click opens it). */
  tabHref?: (tab: WaitingTab) => string;
}

export const WaitingForYou: React.FC<WaitingForYouProps> = (props) => (
  <ScreensHostProvider host={props.host}>
    <WaitingForYouScreen {...props} />
  </ScreensHostProvider>
);

/** The screen itself, under its host (exported for the node tests' hook harness). */
export const WaitingForYouScreen: React.FC<WaitingForYouProps> = ({ host, tab: named, onTabChange, tabHref }) => {
  const { transport, scope } = host;
  const site = scope.kind === 'site';
  const scopeKey = site ? scope.instanceId : 'account';
  const track = (action: string, name?: string) => host.track?.('waiting', action, name);
  const errorText = host.errorText ?? errorMessage;
  const locked = host.viewer?.staffViewing === true;
  const businesses = site ? null : host.businesses;
  const businessKey = businesses ? businesses.map((b) => b.id).join(',') : null;
  const nameOf = (instanceId: string | null | undefined) => (
    site || !instanceId ? null : businesses?.find((b) => b.id === instanceId)?.name ?? null
  );

  const [approvals, setApprovals] = useState<OperatorApproval[]>([]);
  const [heldItems, setHeldItems] = useState<OperatorApproval[]>([]);
  const [alerts, setAlerts] = useState<WaitingAlert[]>([]);
  const [customers, setCustomers] = useState<{ channel: CustomerChannel; open: number } | null>(null);
  // Whether the customers were looked for (none connected counts as looked).
  const [customersChecked, setCustomersChecked] = useState(false);
  // Product and post changes team members prepared (the owner and admins decide them).
  const prepared = usePreparedChanges(host);
  // The tabs that had something during this visit: emptied, they stay (shownTabs).
  const [had, setHad] = useState<WaitingTab[]>([]);
  // The tab the page opened on, so a count that arrives later never moves it.
  const [landing, setLanding] = useState<WaitingTab | null>(null);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /*
   * Approve and Reject are both endings. Without a third answer an owner who
   * liked the idea but wanted different words had to reject good work, or
   * approve wording they were not happy with, and rejecting settles the task
   * so nothing comes back until the next scheduled run. `noteFor` holds the id
   * of the one card whose note box is open.
   */
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sendingNote, setSendingNote] = useState(false);
  /*
   * What the owner just did, said in the spot the card left (a
   * confirmation shows where the owner acted). `index` is
   * the card's place in its list when it was pressed, `tab` the list. It
   * stays until the next decision or until the page is left.
   */
  const [receipt, setReceipt] = useState<{ receipt: Receipt; index: number; tab: WaitingTab } | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);
  /*
   * Each YouTube upload's "Post to YouTube" section as the owner filled it in
   * on its card (YouTube API Services Developer Policies III.C.3 and III.E):
   * the title and the description as edited, who can see it, made for kids.
   * And the cards the API asked on after a refusal (YOUTUBE_PRIVACY_REQUIRED),
   * for a row that did not say it goes to YouTube.
   */
  const [ytForms, setYtForms] = useState<Record<string, YouTubeUploadForm>>({});
  const [ytAsked, setYtAsked] = useState<Record<string, true>>({});
  useEffect(() => {
    if (receipt) receiptRef.current?.scrollIntoView?.({ behavior: scrollBehavior(), block: 'nearest' });
  }, [receipt]);

  const load = useCallback(async () => {
    setLoading(true);
    setProblem(null);
    // Each source is allowed to fail on its own. One dead endpoint must not
    // blank the others, because this screen is where the work lives.
    const [ap, held, al] = await Promise.allSettled([
      readApprovals(transport, scope, 'PENDING'),
      readApprovals(transport, scope, 'NEEDS_ACTIONS'),
      readAlerts(transport, scope),
    ]);
    if (ap.status === 'fulfilled') setApprovals(ap.value.items);
    if (held.status === 'fulfilled') setHeldItems(held.value.items);
    if (al.status === 'fulfilled') setAlerts(al.value);
    if (ap.status === 'rejected' && al.status === 'rejected') {
      setProblem(errorText(ap.reason, 'We could not load what is waiting for you.'));
    }
    setLoading(false);
    // The host object may be new on each render: read again only for another scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useEffect(() => { void load(); }, [load]);

  /** The held list again, quietly (a yes that waits for actions moves there). */
  const reloadHeld = useCallback(async () => {
    try {
      setHeldItems((await readApprovals(transport, scope, 'NEEDS_ACTIONS')).items);
    } catch {
      // The optimistic card stays until the next visit.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  // Unanswered customer messages, counted rather than re-implemented: replying
  // lives on the conversation screen, one hop away, which keeps the reply box
  // in the one place that has the whole thread.
  useEffect(() => {
    // The businesses first: an empty list while they load is not "no channel".
    if (!site && businessKey === null) return undefined;
    let alive = true;
    (async () => {
      try {
        const found = await readCustomers(transport, scope, businesses);
        if (alive) setCustomers(found);
      } catch {
        // A channel that is not connected is not a failure worth reporting here.
      } finally {
        if (alive) setCustomersChecked(true);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, businessKey]);

  /*
   * A TikTok post is never approved here. TikTok makes the owner choose the
   * post settings and agree on its own screen first, and the API refuses any
   * other approval of such a row, so this sends the owner there instead (the
   * dashboard's Your team; a site's card says it is approved there).
   */
  const openTikTokScreen = (a: OperatorApproval) => {
    track('click', 'tiktok_screen');
    host.navigate(approvalPath(a.id));
  };

  /**
   * The card's YouTube section: what the owner filled in on it, else what it
   * opens on (the proposed title and description, nothing chosen; never a
   * visibility the API sent).
   */
  const ytForm = (a: OperatorApproval): YouTubeUploadForm => ytForms[a.id] ?? initialYouTubeForm(a);
  const changeYtForm = (a: OperatorApproval, patch: Partial<YouTubeUploadForm>) =>
    setYtForms((prev) => ({ ...prev, [a.id]: { ...(prev[a.id] ?? initialYouTubeForm(a)), ...patch } }));

  const sendDecide = (id: string, approved: boolean, tiktok?: TikTokConsentInput | TikTokDraftInput, youtube?: YouTubeUploadInput): Promise<DecideResult> => (
    host.decide
      ? host.decide(id, approved, { tiktok, youtube })
      : transport.post<DecideResult>(`/operators/approvals/${encodeURIComponent(id)}/decide`, {
        approved,
        ...(tiktok ? { tiktok } : {}),
        ...(approved && youtube ? { youtube } : {}),
      }, { timeoutMs: DECIDE_TIMEOUT_MS })
  );

  const decide = async (id: string, approved: boolean) => {
    const row = approvals.find((a) => a.id === id);
    if (approved && row && !site && approvalGoesToTikTok(row)) {
      openTikTokScreen(row);
      return;
    }
    setDeciding(id);
    setReceipt(null);
    setProblem(null);
    const index = approvals.findIndex((a) => a.id === id);
    // An upload to YouTube goes with its section exactly as the card shows
    // it (decideFromCard): Approve is disabled until it is complete, and a
    // refusal for want of it (a row that did not say it goes to YouTube)
    // shows the section on the card instead of reporting an error.
    const { outcome: out, asked } = await decideFromCard({
      row: row ?? { id, params: {} },
      approved,
      form: row ? ytForm(row) : null,
      asked: !!ytAsked[id],
      decide: sendDecide,
    });
    setDeciding(null);
    if (asked) setYtAsked((prev) => ({ ...prev, [id]: true }));
    if (out.kind === 'ask') {
      // The card shows the section, Approve waits until it is complete and
      // says so beside it, and the owner is taken to it.
      window.setTimeout(() => bringIntoView(document.getElementById(youtubeChoiceId(id, 'waiting'))), 0);
      return;
    }
    if (out.kind === 'failed') {
      if (noAnswer(out.error)) {
        // No answer is not a no: it may have gone through (a publish to
        // several networks outlasts any wait). The list is read again first,
        // so a card that was decided leaves instead of offering an Approve
        // that is refused, and then the page says why it cannot tell yet.
        await load();
      }
      setProblem(noAnswer(out.error) ? DECISION_OUTCOME_UNKNOWN : errorText(out.error, 'That decision did not go through. Try again.'));
      return;
    }
    const res = out.result;
    track('decide', approved ? 'approve' : 'reject');
    setApprovals((prev) => prev.filter((a) => a.id !== id));
    // Said where the card was. A multi-network publish can land on two
    // networks and be refused by a third while still reporting success:
    // the receipt names what did not go through, in the problem color.
    const said = site ? siteDecisionReceipt(id, approved, res as SiteDecideResult) : decisionReceipt(id, approved, res);
    // A skipped video choice says what skipping means: nothing made, nothing billed.
    setReceipt({ receipt: row ? skippedChoiceReceipt(said, row, approved) : said, index, tab: 'yes' });
    // A yes that waits for the plan's actions moves to its tab.
    if (approved && row && res?.status === 'NEEDS_ACTIONS') {
      const heldRow: OperatorApproval = {
        ...row,
        status: 'NEEDS_ACTIONS',
        ...(site ? { held: true, heldText: (res as SiteDecideResult).heldText, dashboardPath: (res as SiteDecideResult).dashboardPath || '/billing' } : {}),
      };
      setHeldItems((prev) => [heldRow, ...prev.filter((a) => a.id !== id)]);
      void reloadHeld();
    }
  };

  const requestChanges = async (id: string) => {
    if (!note.trim()) return;
    setSendingNote(true);
    const index = approvals.findIndex((a) => a.id === id);
    try {
      await transport.post(`/operators/approvals/${encodeURIComponent(id)}/request-changes`, { note: note.trim() });
      track('decide', 'request_changes');
      // The re-draft arrives as a new approval, so reload rather than guess.
      setNoteFor(null);
      setNote('');
      setReceipt({ receipt: changesReceipt(id), index, tab: 'yes' });
      await load();
    } catch (e) {
      setProblem(errorText(e, 'That did not go through. Try again.'));
    } finally {
      setSendingNote(false);
    }
  };

  /*
   * A held item, canceled before it goes out (any held item, the owner's;
   * a site's administrator for a change to their own site). The API says
   * what happened; a refusal is thrown back to the confirmation, which says
   * it.
   */
  const cancelHeld = async (a: OperatorApproval) => {
    const index = heldItems.findIndex((h) => h.id === a.id);
    let answer: { message?: unknown } | null = null;
    try {
      answer = await transport.post<{ message?: unknown } | null>(`/operators/approvals/${encodeURIComponent(a.id)}/cancel-held`);
    } catch (e) {
      throw new Error(errorText(e, 'That did not go through. Reload and try again.'));
    }
    track('decide', 'cancel_held');
    const fallback = heldCancelWords(approvalGoesToTikTok(a), [], a.changesSite === true).cancelledNotice;
    setHeldItems((prev) => prev.filter((h) => h.id !== a.id));
    setReceipt({ receipt: cancelReceipt(a.id, typeof answer?.message === 'string' ? answer.message : null, fallback), index, tab: 'held' });
  };

  /*
   * A yes held because this month's actions are used up: the receipt carries
   * its two choices (buy the pack and it goes out now, or wait), drawn by the
   * app (the dashboard; a site is never offered a pack). What the press ended
   * with replaces the receipt's sentence, where the owner acted.
   */
  const receiptNext = (r: Receipt) => host.renderers?.receiptNext?.({
    receipt: r,
    approval: heldItems.find((h) => h.id === r.id) ?? null,
    onSettled: (settled: { text: string; tone: ReceiptTone }) => {
      setReceipt((cur) => (cur && cur.receipt.id === r.id ? { ...cur, receipt: { id: r.id, message: settled.text, tone: settled.tone } } : cur));
      void load();
    },
  });

  const counts: WaitingCounts = {
    yes: approvals.length,
    held: heldItems.length,
    prepared: prepared.items.length,
    fix: alerts.length,
    customers: customers?.open ?? 0,
  };
  const total = waitingBadgeCount(counts);
  /*
   * The tabs wait for every count but the customers', so the page opens on
   * the right one instead of moving under the owner when a count arrives.
   * The customers are last in the order and only waited for when nothing
   * else is there: their tab can only appear at the end.
   */
  const settled = !loading && prepared.loaded && (customersChecked || total + counts.held > 0);
  const withSomething = (Object.keys(counts) as WaitingTab[]).filter((k) => counts[k] > 0).join(',');
  useEffect(() => {
    if (!settled || !withSomething) return;
    setHad((prev) => {
      const add = (withSomething.split(',') as WaitingTab[]).filter((k) => !prev.includes(k));
      return add.length ? [...prev, ...add] : prev;
    });
  }, [settled, withSomething]);
  const shown = useMemo(() => (settled ? shownTabs(counts, had) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settled, withSomething, had]);
  const opening = activeWaitingTab(null, shown, landing);
  useEffect(() => {
    if (!landing && opening) setLanding(opening);
  }, [landing, opening]);
  const tab = activeWaitingTab(named, shown, landing);
  const selectTab = (key: string) => {
    if (key === tab) return;
    track('tab', key);
    // A push: the browser's Back returns to the tab before.
    onTabChange(key as WaitingTab);
  };

  if (!settled) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="waiting-loading">
        <Skeleton height={28} width={240} />
        <Skeleton height={90} /><Skeleton height={90} />
      </div>
    );
  }

  /** Under a tab whose last item was just dealt with: no jump, a link to the next one. */
  const allDone = (current: WaitingTab) => {
    const next = nextWaitingTab(current, shown, counts);
    return (
      <p data-testid="waiting-all-done" style={{ margin: 0, fontSize: TYPE.data, color: 'var(--text-dim)' }}>
        {ALL_DONE_TEXT}
        {next && (
          <>
            {' '}
            <a
              href={tabHref ? tabHref(next) : `#${next}`}
              data-testid="waiting-next-tab"
              data-tab={next}
              onClick={(e) => { e.preventDefault(); selectTab(next); }}
              style={{ color: 'var(--purple)', textDecoration: 'underline' }}
            >
              Next: {waitingTabLabel(next, counts[next])}
            </a>
          </>
        )}
      </p>
    );
  };

  const receiptIn = (list: OperatorApproval[], at: WaitingTab) => {
    const r = receipt && receipt.tab === at ? receipt : null;
    const note = r ? (
      <ReceiptNote
        ref={receiptRef}
        message={r.receipt.message}
        tone={r.receipt.tone}
        nextStep={r.receipt.nextStep}
        next={r.receipt.packChoice || r.receipt.nextStep ? receiptNext(r.receipt) : undefined}
        links={r.receipt.links}
        testId="receipt-in-place"
      />
    ) : null;
    const slot = r ? (list.length === 0 ? 0 : Math.max(0, Math.min(r.index < 0 ? 0 : r.index, list.length))) : -1;
    return { note, slot };
  };

  const cardFor = (a: OperatorApproval, i: number, at: WaitingTab) => (
    <ApprovalCard
      approval={a}
      businessName={nameOf(a.instanceId)}
      tourAnchor={at === 'yes' && i === 0}
      deciding={deciding === a.id}
      locked={locked}
      youtubeForm={ytForm(a)}
      youtubeAsked={!!ytAsked[a.id]}
      onYouTubeChange={(patch) => changeYtForm(a, patch)}
      noteOpen={noteFor === a.id}
      note={note}
      sendingNote={sendingNote}
      onApprove={() => void decide(a.id, true)}
      onOpenTikTok={() => openTikTokScreen(a)}
      onReject={() => void decide(a.id, false)}
      onToggleNote={() => { setNoteFor(noteFor === a.id ? null : a.id); setNote(''); }}
      onNoteChange={setNote}
      onSendNote={() => void requestChanges(a.id)}
      onCancelNote={() => setNoteFor(null)}
      onOpenFull={() => track('click', 'open_full')}
      onCancelHeld={at === 'held' ? () => cancelHeld(a) : undefined}
      heldWayOut={at === 'held' && !site && host.renderers?.heldWayOut
        ? host.renderers.heldWayOut(a, {
          onSettled: (settled) => {
            setReceipt({ receipt: { id: a.id, message: settled.text, tone: settled.tone }, index: i, tab: 'held' });
            void load();
          },
        })
        : undefined}
    />
  );

  /** A list of cards with the receipt in the spot the acted-on card left. */
  const cardList = (list: OperatorApproval[], at: WaitingTab) => {
    const { note: said, slot } = receiptIn(list, at);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((a, i) => (
          <React.Fragment key={a.id}>
            {i === slot && said}
            {cardFor(a, i, at)}
          </React.Fragment>
        ))}
        {slot === list.length && said}
        {list.length === 0 && allDone(at)}
      </div>
    );
  };

  return (
    // data-tour-page / data-tour: the guided tour's stop on this screen. It
    // lights the first card's buttons when something waits, the heading when not.
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
      data-tour-page="waiting"
      data-screens-version={SCREENS_VERSION}
      data-scope={scope.kind}
    >
      <div data-tour="waiting-head">
        <PageHeader
          title={(
            <>
              Waiting for you
              {host.renderers?.titleHelp}
            </>
          )}
          subtitle={total === 0
            ? 'Nothing needs you right now. Your team keeps working, and anything they want to publish waits here for your yes.'
            : 'Your team keeps working while these wait. Nothing is published until you say so.'}
        />
        {host.renderers?.headerNote}
      </div>

      {problem && (
        <Card padding="md">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: TYPE.data, color: 'var(--danger)' }}>{problem}</span>
            <Button size="sm" variant="outline" onClick={() => void load()}>Try again</Button>
          </div>
        </Card>
      )}

      {tab && (
        <div>
          {/* A block around the bar: on a phone it scrolls sideways inside the
              page's width when the labels do not fit, and the page scrolls as one. */}
          <div data-testid="waiting-tabs" style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <Tabs
              items={shown.map((key) => ({ key, label: waitingTabLabel(key, counts[key]) }))}
              activeKey={tab}
              onChange={selectTab}
              ariaLabel="What waits for you"
            />
          </div>

          <TabPanel isActive={tab === 'yes'}>
            {cardList(approvals, 'yes')}
          </TabPanel>

          <TabPanel isActive={tab === 'held'}>
            {cardList(heldItems, 'held')}
          </TabPanel>

          <TabPanel isActive={tab === 'prepared'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <PreparedChanges state={prepared} showBusiness={!site} />
              {prepared.items.length === 0 && allDone('prepared')}
            </div>
          </TabPanel>

          {/* An alert links to its business, where it is dealt with. */}
          <TabPanel isActive={tab === 'fix'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {alerts.map((a) => (
                <AlertRow key={a.id} alert={a} onOpen={() => track('click', 'alert')} />
              ))}
              {alerts.length === 0 && allDone('fix')}
            </div>
          </TabPanel>

          <TabPanel isActive={tab === 'customers'}>
            {customers && counts.customers > 0 ? (
              <Card padding="md">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <span data-testid="waiting-customers" style={{ fontSize: TYPE.data, color: 'var(--text)' }}>
                    {counts.customers} {counts.customers === 1 ? 'conversation is' : 'conversations are'} still open
                    on {customers.channel.accountName}. Meta closes each one 24 hours after the
                    customer's last message.
                  </span>
                  <Button size="sm" variant="outline" onClick={() => host.navigate('/engagement')}>
                    Read and reply
                  </Button>
                </div>
              </Card>
            ) : allDone('customers')}
          </TabPanel>
        </div>
      )}

      {!tab && !problem && (
        <Card padding="lg">
          <div style={{ textAlign: 'center', padding: 20 }}>
            <p style={{ margin: 0, fontSize: TYPE.data, color: 'var(--text-dim)' }}>
              Nothing is waiting. This is what a good week looks like.
            </p>
            <div style={{ marginTop: 12 }}>
              <Button size="sm" variant="outline" onClick={() => host.navigate('/')}>
                See what your team is doing
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 12,
  padding: '12px 16px', borderRadius: 8, boxSizing: 'border-box',
  background: 'var(--bg-raised)', border: '1px solid var(--glass-border)',
  textDecoration: 'none', color: 'inherit',
};

const pillStyle: React.CSSProperties = {
  flexShrink: 0, marginTop: 1, padding: '2px 8px', borderRadius: 999,
  fontSize: TYPE.label, fontWeight: 600,
};

/** One alert, linking its business (in the dashboard, where it is dealt with). */
function AlertRow({ alert: a, onOpen }: { alert: WaitingAlert; onOpen: () => void }) {
  return (
    <HostLink to={`/instances/${encodeURIComponent(a.instanceId)}`} onClick={onOpen} style={rowStyle} testId="waiting-alert">
      <span style={{ ...pillStyle, background: tint(a.severity), color: severityColor(a.severity) }}>
        {severityLabel(a.severity)}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <OperatorInline text={a.title} style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }} />
        <OperatorInline text={a.message} style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }} />
      </span>
    </HostLink>
  );
}

export function severityLabel(s: string): string {
  if (s === 'CRITICAL') return 'Urgent';
  if (s === 'WARNING') return 'Needs attention';
  return 'Information';
}
function severityColor(s: string): string {
  if (s === 'CRITICAL') return 'var(--danger)';
  if (s === 'WARNING') return 'var(--warning)';
  return 'var(--text-mid, var(--text-dim))';
}
function tint(s: string): string {
  return `color-mix(in srgb, ${severityColor(s)} 12%, transparent)`;
}

export default WaitingForYou;
