/**
 * The plugin's own drawings inside the kit's chat (CoCeoChat's `renderers`
 * and `renderReply`):
 *  - an answer: the model's Markdown through marked, then the chat's
 *    sanitizer (nothing that can run is left); a change made in that turn
 *    shows its card again when the thread is read back;
 *  - a step: its sentence in the owner's words (never the tool's name), the
 *    change card of an edit (summary, what changed, View, Undo), or what the
 *    API lets an owner see of the result (pictures, an item, a few lines, a
 *    change left waiting and where its approval stands now);
 *  - an approval: the preview of a change (Approve publishes the version on
 *    screen), the whole email of a reply to a form message, a post, page or
 *    product shown as itself, or the sentence with its known details as
 *    plain lines. Once answered, the kit's card says what the owner said.
 * The owner's own words, the errors and the system's lines are the kit's.
 */
import React from 'react';
import { AgentTimeline, Button, GlassCard, type ChatMessage, type ChatRenderContext, type ChatRenderers } from '@yotako/webmaven-ui';
import { TeamFace } from '../team/TeamFace';
import { LEAD_OPERATOR, operatorRefOf, TEAM_COPY } from '../../utils/team';
import SitePostCard from '../SitePostCard';
import { plainLine, sitePostFromApproval } from '../../utils/sitePostPreview';
import { sanitizeChatHtml } from '../../utils/safeHtml';
import { EditPreviewCardView, EditResultCardView, OwnerDisplayView, paramLines, parseEditCard, parsePreviewCard } from '../edits/ChatEditCards';

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

type StepData = NonNullable<ChatMessage['step']>;
type ApprovalData = NonNullable<ChatMessage['approval']>;

/** A step's sentence in the owner's words (never the tool's name). */
export function stepSentence(step: Pick<StepData, 'summary' | 'status'>): string {
  const said = plainLine(step.summary || '');
  if (said) return said;
  if (step.status === 'error') return 'This step did not work.';
  if (step.status === 'completed') return 'Finished this step.';
  return 'Working on it';
}

/** What the plugin needs from its adapter to draw a step: the preview picked on an approval's card. */
export interface ChatRendererSource {
  pickedPreview(stepId: string): string | undefined;
}

/**
 * The preview a yes answered, for the step that asked for it: a change the
 * run then leaves waiting finds its approval by it (the receipt). The one
 * picked on the card (another version, the reviewed values), else the card's
 * own with its operation. Nothing after a no.
 */
export function approvalEditFor(messages: ChatMessage[], callId: string, pickedId?: string): { previewId: string; operationId?: string } | undefined {
  const asked = messages.find((m) => m.approval?.stepId === callId)?.approval;
  if (!asked || asked.status !== 'approved') return undefined;
  const edit = isObj(asked.edit) ? asked.edit : {};
  const previewId = pickedId || (typeof edit.previewId === 'string' ? edit.previewId : '');
  const operationId = !pickedId && typeof edit.operationId === 'string' ? edit.operationId : '';
  return previewId ? { previewId, ...(operationId ? { operationId } : {}) } : undefined;
}

/** The changes a stored answer made, as owners saw them: drawn under an answer read back from the thread. */
function ReplyEdits({ metadata }: { metadata: Record<string, unknown> }) {
  const raw = Array.isArray(metadata.edits) ? metadata.edits : [];
  const cards = raw.map(parseEditCard).filter((c): c is NonNullable<ReturnType<typeof parseEditCard>> => !!c && (c.status === 'published' || c.status === 'failed'));
  if (!cards.length) return null;
  return (
    <div data-testid="chat-reply-edits" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
      {cards.map((card) => (
        <GlassCard key={card.operationId} padding="12px"><EditResultCardView card={card} /></GlassCard>
      ))}
    </div>
  );
}

/**
 * An answer's body: the model's Markdown as marked renders it, through
 * DOMPurify first (sanitizeChatHtml, utils/safeHtml.ts). Without marked on
 * the page, the words as they are.
 */
export function ChatReply({ message }: { message: ChatMessage }) {
  const marked = typeof window !== 'undefined' ? (window as any).marked : undefined;
  const markdown = !!marked && typeof marked.parse === 'function';
  return (
    <div className="wm-chat-reply">
      {markdown ? (
        <div dangerouslySetInnerHTML={{ __html: sanitizeChatHtml(marked.parse(message.text)) }} /> // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
      ) : (
        <p className="wm-chat-reply__plain">{message.text}</p>
      )}
      {!message.answeredHere && <ReplyEdits metadata={message.metadata} />}
    </div>
  );
}

/** A step of the run: its change card, or its sentence with what the owner may see of its result. */
export function ChatStepView({ message, ctx, source }: { message: ChatMessage; ctx: ChatRenderContext; source: ChatRendererSource }) {
  const step = message.step;
  if (!step) return null;
  const edit = parseEditCard(step.edit);
  if (edit) {
    return <GlassCard padding="12px"><EditResultCardView card={edit} /></GlassCard>;
  }
  // A specialist's step shows their face with its state; the chat's lead's
  // own steps (reading, planning) keep the small dot. The lead is the
  // Co-CEO, or the Web Designer in the editor (1.8.0).
  const who = operatorRefOf(step.operator);
  const entry = {
    callId: step.callId,
    name: '',
    status: step.status,
    summary: stepSentence(step),
    ...(step.error ? { error: plainLine(step.error) } : {}),
    ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
    ...(who && who.id !== ctx.lead ? { operator: who.id, operatorTitle: who.title } : {}),
  };
  return (
    <>
      <AgentTimeline calls={[entry]} compact />
      <OwnerDisplayView result={step.result} approvalEdit={approvalEditFor(ctx.chat.state.messages, step.callId, source.pickedPreview(step.callId))} />
    </>
  );
}

const DETAILS_TEXT: React.CSSProperties = { fontSize: 13, color: 'var(--text-dim)', margin: '0 0 8px', lineHeight: 1.5 };
const ACTIONS: React.CSSProperties = { display: 'flex', gap: 8 };
const ACTION_BUTTON: React.CSSProperties = { fontSize: 12, padding: '6px 14px' };

/** An approval still waiting for the owner's answer. */
export function ChatApprovalView({ approval, ctx }: { approval: ApprovalData; ctx: ChatRenderContext }) {
  const answering = approval.status === 'sending';
  // Who on the team asks for the yes; the chat's lead when the API did not say.
  const asker = operatorRefOf(approval.operator) || operatorRefOf(ctx.lead) || operatorRefOf(LEAD_OPERATOR)!;
  const title = TEAM_COPY.needsYes(asker.title);
  // Plain words: the sentence can quote a title as written, and this card
  // prints text as it comes ("&bull;" stays "&bull;").
  const reason = plainLine(approval.reason || '');
  const params = approval.params;
  // A change's card may answer for another preview of it than the first one
  // (a version, the values kept in its review): its id goes along.
  const answer = (approved: boolean, previewId?: string) => {
    void (previewId ? ctx.chat.approve(approval.stepId, approved, { previewId }) : ctx.chat.approve(approval.stepId, approved));
  };

  // An edit operation is approved as its preview: what changes, its checks
  // and pictures, Open preview (the run publishes exactly it).
  const parsed = parsePreviewCard(approval.edit);
  if (parsed) {
    const card = { ...parsed, operator: parsed.operator || asker };
    return (
      <GlassCard padding="16px" accent data-testid="approval-card" data-kind="edit" data-status={approval.status}>
        <EditPreviewCardView card={card} answering={answering} onApprove={(pickedId) => answer(true, pickedId)} onDecline={() => answer(false)} />
      </GlassCard>
    );
  }

  // A reply to someone who wrote through the site's forms: the whole email,
  // as it goes out, never cut (it reads like a message, not a setting).
  if (approval.name === 'reply_to_message') {
    const subject = typeof params?.subject === 'string' ? params.subject : '';
    const body = typeof params?.message === 'string' ? params.message : '';
    return (
      <GlassCard padding="16px" accent data-testid="approval-card" data-kind="reply" data-status={approval.status}>
        <strong style={{ fontSize: 14, color: 'var(--text)', display: 'block', marginBottom: 8 }}>{title}</strong>
        {reason && <p style={DETAILS_TEXT}>{reason}</p>}
        {subject && (
          <p data-testid="reply-subject" style={{ fontSize: 13, margin: '0 0 6px', color: 'var(--text)' }}>
            <span style={{ color: 'var(--text-dim)' }}>Subject: </span>{subject}
          </p>
        )}
        <div
          data-testid="reply-body"
          style={{
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflowY: 'auto', fontSize: 13, lineHeight: 1.5,
            color: 'var(--text)', background: 'var(--surface-2, rgba(127,127,127,0.08))', borderRadius: 8, padding: '10px 12px', margin: '0 0 12px',
          }}
        >
          {body}
        </div>
        <div style={ACTIONS}>
          <Button data-testid="approval-decline" variant="ghost" disabled={answering} onClick={() => answer(false)} style={ACTION_BUTTON}>Decline</Button>
          <Button data-testid="approval-approve" variant="primary" disabled={answering} onClick={() => answer(true)} style={ACTION_BUTTON}>Send</Button>
        </div>
      </GlassCard>
    );
  }

  // A post, page or product for the site is shown as itself (title, first
  // words, Open preview), never as its parameters.
  const sitePost = sitePostFromApproval(approval.name, params);
  const siteUrl = typeof window !== 'undefined' && window.location ? `${window.location.origin}/` : null;
  // Anything else: the sentence above says what it does, with its known
  // details as plain lines; never the call's name or its parameters as code.
  const lines = sitePost ? [] : paramLines(params);
  return (
    <GlassCard padding="16px" accent data-testid="approval-card" data-status={approval.status}>
      <strong style={{ fontSize: 14, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <TeamFace id={asker.id} title={asker.title} presence="waiting" size="card" decorative />
        {title}
      </strong>
      {reason && <p style={DETAILS_TEXT}>{reason}</p>}
      {sitePost && <SitePostCard post={sitePost} siteUrl={siteUrl} />}
      {lines.length > 0 && (
        <dl data-testid="approval-details" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 12, margin: '0 0 12px' }}>
          {lines.map((l) => (
            <React.Fragment key={l.label}>
              <dt style={{ color: 'var(--text-dim)' }}>{l.label}</dt>
              <dd style={{ margin: 0, color: 'var(--text)', overflowWrap: 'anywhere' }}>{l.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      <div style={ACTIONS}>
        <Button data-testid="approval-decline" variant="ghost" disabled={answering} onClick={() => answer(false)} style={ACTION_BUTTON}>Decline</Button>
        <Button data-testid="approval-approve" variant="primary" disabled={answering} onClick={() => answer(true)} style={ACTION_BUTTON}>Approve</Button>
      </div>
    </GlassCard>
  );
}

/** The kit's renderers for the plugin's chat. */
export function pluginChatRenderers(source: ChatRendererSource): ChatRenderers {
  return {
    step: (message, ctx) => (message.step ? <ChatStepView message={message} ctx={ctx} source={source} /> : undefined),
    // Answered: the kit's card says what the owner said.
    approval: (message, ctx) => (message.approval && (message.approval.status === 'waiting' || message.approval.status === 'sending')
      ? <ChatApprovalView approval={message.approval} ctx={ctx} />
      : undefined),
  };
}

/** The body of an answer, for CoCeoChat's renderReply. */
export function renderPluginReply(message: ChatMessage): React.ReactNode {
  return <ChatReply message={message} />;
}
