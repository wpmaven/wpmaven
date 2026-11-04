import React, { useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import type { EditCheck, EditChange, EditResult } from '../../types/edits';
import { hasBrokenCheck, orderChecks } from '../../services/edits';
import { MAX_VERSIONS, type EditFlowState, type EditOperationApi } from './useEditOperation';
import { TeamFace } from '../../components/team/TeamFace';
import { operatorForOperation, signedWorking, type OperatorRef } from '../../utils/team';

/** The frame of every panel: what is selected, its name, a close button. */
export function PanelFrame({
  chip, color, title, sub, onClose, children, footer, testId = 'editor-panel',
}: {
  chip: string;
  color?: string;
  title: string;
  sub?: string;
  onClose?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testId?: string;
}) {
  return (
    <section className="wme-gs-panel" data-testid={testId} aria-label={`${chip}: ${title}`} style={color ? ({ '--gs-kind': color } as React.CSSProperties) : undefined}>
      <header className="wme-gs-head">
        <div className="wme-gs-head-text">
          <span className="wme-gs-chip">{chip}</span>
          <h2 className="wme-gs-title">{title}</h2>
          {sub && <p className="wme-gs-sub">{sub}</p>}
        </div>
        {onClose && (
          <button type="button" className="wme-gs-x" onClick={onClose} aria-label="Close">&times;</button>
        )}
      </header>
      <div className="wme-gs-body">{children}</div>
      {footer && <div className="wme-gs-foot">{footer}</div>}
    </section>
  );
}

const OkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
);
const BadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rose)" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);

/**
 * What a publish did, in the API's own summary (the last edit-result carries
 * data-ok and data-operation-id, and its text is the summary).
 */
export function EditResultLine({ result, failure }: { result: EditResult | null; failure?: { message: string } | null }) {
  const ok = !!result && result.status === 'published' && result.ok;
  const text = ok
    ? (result!.summary || 'Your change is live.')
    : (failure?.message || result?.failures?.[0]?.message || 'This change did not go through.');
  return (
    <div className={`wme-gs-result ${ok ? 'is-ok' : 'is-bad'}`} role="status">
      {ok ? <OkIcon /> : <BadIcon />}
      <span data-testid="edit-result" data-ok={ok ? 'true' : 'false'} data-operation-id={result?.operationId ?? ''}>{text}</span>
    </div>
  );
}

const SEVERITY_WORDS: Record<EditCheck['severity'], string> = { broken: 'Problem', warn: 'Check', info: 'Note' };

/** The preview's checks: problems first; on the phone view, the phone checks first. */
export function ChecksList({ checks, phoneFirst = false }: { checks: EditCheck[]; phoneFirst?: boolean }) {
  if (!checks.length) return null;
  const ordered = orderChecks(checks, phoneFirst);
  return (
    <div>
      <p className="wme-gs-label">{phoneFirst ? 'Checks, phones first' : 'Checks'}</p>
      <ul className="wme-gs-checks" data-testid="edit-checks">
        {ordered.map((c, i) => (
          <li key={`${c.kind}-${i}`} className={`wme-gs-check is-${c.severity}`} data-severity={c.severity} data-width={c.width ?? ''}>
            <b>{c.width === 390 ? 'Phone' : c.width === 1440 ? 'Desktop' : SEVERITY_WORDS[c.severity]}</b>
            <span>{c.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What changed, as the API lists it (before and after when it has them). */
export function ChangesList({ changes }: { changes: EditChange[] }) {
  const shown = changes.filter((c) => c.label || c.after);
  if (!shown.length) return null;
  return (
    <ul className="wme-gs-changes">
      {shown.slice(0, 8).map((c, i) => (
        <li key={`${c.ref}-${i}`}>
          {c.label}
          {c.before !== undefined && c.after !== undefined && c.before !== c.after && (
            <>: <del>{c.before}</del> {'→'} <ins>{c.after}</ins></>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Work in progress. The team's work (an AI operation) shows who does it, working
 * on the face, and signs the sentence; an owner's own save keeps the spinner.
 */
export function Working({ text, progress, operator }: { text: string; progress?: EditResult | null; operator?: OperatorRef | null }) {
  const waiting = progress?.status === 'queued' && (progress.queuePosition ?? 0) > 0;
  const said = signedWorking(text, operator);
  return (
    <div className="wme-gs-working" role="status" aria-live="polite" data-operator={operator?.id}>
      {operator
        ? <TeamFace id={operator.id} title={operator.title} presence={waiting ? 'queued' : 'working'} size="card" decorative />
        : <span className="wme-gs-spin" aria-hidden="true" />}
      <span>{waiting
        ? `Another change to your site goes first (${progress!.queuePosition} ahead).${operator ? ` Your ${operator.title} starts right after.` : ` ${text}`}`
        : said}</span>
    </div>
  );
}

/** The before and after pictures of the touched part, when the API made them. */
export function Thumbnails({ result, phone }: { result: EditResult | null; phone: boolean }) {
  const thumbs = (result?.preview?.thumbnails ?? []).filter((t) => /^https:\/\//.test(t.after) && (!t.before || /^https:\/\//.test(t.before)));
  if (!thumbs.length) return null;
  const pick = thumbs.find((t) => t.width === (phone ? 390 : 1440)) ?? thumbs[0];
  return (
    <div className="wme-gs-thumbs">
      {pick.before && (
        <figure><img src={pick.before} alt="Before the change" loading="lazy" /><figcaption>Before</figcaption></figure>
      )}
      <figure><img src={pick.after} alt="After the change" loading="lazy" /><figcaption>After</figcaption></figure>
    </div>
  );
}

/** Codes a second publish fixes by overwriting (the owner confirms with Publish anyway). */
const FORCE_CODES = new Set(['DRIFT', 'CHECK_BROKEN']);
/** Codes that need a new preview. */
const REPREVIEW_CODES = new Set(['STALE_PREVIEW', 'PREVIEW_EXPIRED']);

/**
 * A publish that did not go through: the reason, and what to do next
 * (Try again, Publish anyway, or Make a new preview; Discard). Stays until
 * the owner acts on it.
 */
export function EditErrorBanner({
  code, message, busy, onRetry, onDiscard,
}: {
  code: string;
  message: string;
  busy?: boolean;
  onRetry: (how: 'retry' | 'force' | 'repreview') => void;
  onDiscard: () => void;
}) {
  const how = FORCE_CODES.has(code) ? 'force' : REPREVIEW_CODES.has(code) ? 'repreview' : 'retry';
  const label = how === 'force' ? 'Publish anyway' : how === 'repreview' ? 'Make a new preview' : 'Try again';
  return (
    <div className="wme-gs-note is-bad" role="alert" data-testid="editor-publish-error" data-code={code}>
      <p style={{ margin: '0 0 8px', fontWeight: 600 }}>This change was not published</p>
      <p style={{ margin: '0 0 10px' }} data-testid="editor-publish-error-reason">{message}</p>
      <div className="wme-gs-actions">
        <Button data-testid="editor-publish-discard" variant="ghost" size="sm" onClick={onDiscard} style={{ color: 'var(--rose)' }}>Discard</Button>
        <Button data-testid="editor-publish-retry" variant="primary" size="sm" onClick={() => onRetry(how)} disabled={busy} isLoading={busy} className="wme-gs-push">{label}</Button>
      </div>
    </div>
  );
}

/** "Share preview": a link anyone can open for 72 hours, made only when asked. */
export function SharePreview({ result, onShare }: { result: EditResult | null; onShare: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = result?.preview?.shareUrl;
  if (!result?.preview) return null;
  if (!link) {
    return (
      <button
        type="button"
        className="wme-gs-link"
        data-testid="editor-share-preview"
        disabled={busy}
        onClick={async () => { setBusy(true); try { await onShare(); } finally { setBusy(false); } }}
      >
        {busy ? 'Making a link...' : 'Share preview'}
      </button>
    );
  }
  const until = result.preview.shareExpiresAt ? new Date(result.preview.shareExpiresAt) : null;
  return (
    <div>
      <p className="wme-gs-hint" style={{ marginBottom: 6 }}>
        Anyone with this link can see the preview{until && !Number.isNaN(until.getTime()) ? ` until ${until.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ' for 72 hours'}.
      </p>
      <div className="wme-gs-share">
        <input className="wme-gs-input" readOnly value={link} aria-label="Preview link" data-testid="editor-share-link" onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            try { void navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the field is selectable */ }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

/**
 * The preview and publish controls every design panel shares. The publish
 * button exists only once a preview is ready (editor-publish), and reads
 * "Publish anyway" when a check found a problem: publishing over it is the
 * owner's explicit choice.
 */
export function PreviewFlow({
  flow, canPreview, onPreview, previewLabel = 'Preview', workingText = 'Preparing your preview. This can take up to a minute.',
  phoneFirst = false, onUndo, onDone, extraActions, versionable = false,
}: {
  flow: EditOperationApi;
  canPreview: boolean;
  onPreview: (refine: boolean) => void;
  previewLabel?: string;
  workingText?: string;
  phoneFirst?: boolean;
  onUndo?: (r: EditResult) => void;
  onDone?: () => void;
  extraActions?: React.ReactNode;
  /** The change can be composed again differently ("Try another version"): an AI change, not dictated words. */
  versionable?: boolean;
}) {
  const s: EditFlowState = flow.state;
  const versions = s.versions ?? [];
  const makingVersion = s.phase === 'previewing' && versions.length > 0;
  const previewed = s.phase === 'previewed' || (s.phase === 'publishing' && !!s.preview);
  const broken = hasBrokenCheck(s.preview?.checks);
  const publishError = s.error && s.error.stage === 'publish' ? s.error : null;
  const previewError = s.error && s.error.stage === 'preview' ? s.error : null;

  if (s.phase === 'published' && s.result) {
    return (
      <>
        <EditResultLine result={s.result} />
        <div className="wme-gs-actions">
          {onUndo && s.result.undoable && (
            <Button data-testid="editor-undo" variant="outline" size="sm" onClick={() => onUndo(s.result!)}>Undo</Button>
          )}
          {onDone && <Button variant="ghost" size="sm" onClick={onDone} className="wme-gs-push">Done</Button>}
        </div>
      </>
    );
  }

  return (
    <>
      {s.phase === 'previewing' && <Working text={makingVersion ? 'Making another version. This can take up to a minute.' : workingText} progress={s.progress} operator={operatorForOperation(s.operation?.op)} />}
      {s.phase === 'publishing' && <Working text="Publishing your change." progress={s.progress} />}
      {previewError && (
        <div className="wme-gs-note is-bad" role="alert" data-testid="editor-preview-error" data-code={previewError.code}>{previewError.message}</div>
      )}
      {previewed && versions.length > 1 && (
        <div>
          <div className="wme-gs-suggest" role="group" aria-label="Versions">
            {versions.map((v, i) => (
              <button
                key={v.operationId || i}
                type="button"
                data-testid="editor-version"
                aria-pressed={v.operationId === s.preview?.operationId}
                disabled={s.phase === 'publishing'}
                onClick={() => flow.showVersion(i)}
              >
                {`Version ${i + 1}`}
              </button>
            ))}
          </div>
          <p className="wme-gs-hint" style={{ marginTop: 6 }}>Each version is kept until you publish one. Publishing one discards the others.</p>
        </div>
      )}
      {previewed && s.preview && (
        <>
          {s.preview.summary && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }} data-testid="editor-preview-summary">{s.preview.summary}</p>}
          <ChangesList changes={s.preview.changed} />
          <ChecksList checks={s.preview.checks} phoneFirst={phoneFirst} />
          {broken && (
            <p className="wme-gs-note is-bad">This preview has a problem on your site. Fix it with another instruction, or publish it anyway.</p>
          )}
          <SharePreview result={s.preview} onShare={flow.share} />
        </>
      )}
      {publishError && s.result && <EditResultLine result={s.result} failure={publishError} />}
      {publishError && (
        <EditErrorBanner
          code={publishError.code}
          message={publishError.message}
          busy={s.phase === 'publishing'}
          onRetry={(how) => {
            if (how === 'repreview') onPreview(false);
            else void flow.publish({ force: how === 'force' });
          }}
          onDiscard={() => { void flow.discard(); }}
        />
      )}
      <div className="wme-gs-actions">
        <Button
          data-testid="editor-preview"
          variant={previewed ? 'outline' : 'primary'}
          size="sm"
          disabled={!canPreview || s.phase === 'previewing' || s.phase === 'publishing'}
          isLoading={s.phase === 'previewing'}
          onClick={() => onPreview(previewed)}
        >
          {s.phase === 'previewing' ? 'Preparing' : previewed ? 'Preview again' : previewLabel}
        </Button>
        {previewed && versionable && versions.length < MAX_VERSIONS && (
          <Button data-testid="editor-another-version" variant="outline" size="sm" onClick={() => { void flow.anotherVersion(); }} disabled={s.phase === 'publishing'}>
            Try another version
          </Button>
        )}
        {previewed && (
          <Button data-testid="editor-discard" variant="ghost" size="sm" onClick={() => { void flow.discard(); }} disabled={s.phase === 'publishing'}>
            Discard
          </Button>
        )}
        {extraActions}
        {previewed && (
          <Button
            data-testid="editor-publish"
            variant={broken ? 'danger' : 'primary'}
            size="sm"
            className="wme-gs-push"
            disabled={s.phase === 'publishing'}
            isLoading={s.phase === 'publishing'}
            onClick={() => { void flow.publish({ force: broken }); }}
          >
            {broken ? 'Publish anyway' : 'Publish'}
          </Button>
        )}
      </div>
    </>
  );
}
