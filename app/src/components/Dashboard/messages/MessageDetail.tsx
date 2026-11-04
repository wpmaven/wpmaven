import React, { useEffect, useRef, useState } from 'react';
import { Badge, Button } from '@yotako/webmaven-ui';
import { errorSentence, storeApi } from '../../../services/storeApi';
import type { Lead, LeadStatus } from '../../../types/store';
import { nameOr } from '../../../utils/brand';
import Confirm from '../store/shared/Confirm';
import { ErrorLine, Field, Loading, shortDate } from '../store/shared/ui';

export const STATUS_BADGE: Record<LeadStatus, { label: string; color: 'purple' | 'cyan' | 'mauve' | 'rose' }> = {
  new: { label: 'New', color: 'purple' },
  answered: { label: 'Answered', color: 'cyan' },
  archived: { label: 'Archived', color: 'mauve' },
  spam: { label: 'Spam', color: 'rose' },
};

/** Who sends a reply: the site's own mail, or the relay (named in the site's brand, white label included). */
function mailNote(mail: 'relay' | 'site'): string {
  if (mail === 'site') return 'Your site sends this email. If replies do not arrive, check your site\'s email settings.';
  return `${nameOr('A mail service')} sends this email for your site. Replies come back to your business email.`;
}

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

/** A mailto: address only for something that is an email address. */
export function mailtoHref(email: string, subject?: string, body?: string): string | null {
  const address = email.trim();
  if (!EMAIL.test(address)) return null;
  const params = [subject ? `subject=${encodeURIComponent(subject)}` : '', body ? `body=${encodeURIComponent(body)}` : ''].filter(Boolean).join('&');
  return `mailto:${address}${params ? `?${params}` : ''}`;
}

function telHref(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, '');
  return /\d{3,}/.test(digits) ? `tel:${digits}` : null;
}

/** The page a message was sent from, as its path ("/contact/"), linked only when it is a web address. */
function SentFrom({ url }: { url: string }) {
  let path = url;
  let web = false;
  try {
    const u = new URL(url);
    web = u.protocol === 'https:' || u.protocol === 'http:';
    if (web) path = u.pathname + u.search;
  } catch {
    web = false;
  }
  return web ? <a href={url} target="_blank" rel="noopener noreferrer">{path}</a> : <>{path}</>;
}

/**
 * One message: who wrote (only what they gave), the form and the page, the
 * message as plain text (never HTML), every field, the timeline, and what
 * the owner does with it: reply by email, mark it answered, archive, spam,
 * delete, a private note.
 */
export default function MessageDetail({ id, mail, onBack, onChanged, onDeleted, focusOnOpen = true }: {
  id: number;
  /** How a reply leaves the site: WPMaven's mail relay, or the site's own mail. */
  mail: 'relay' | 'site';
  onBack: () => void;
  /** The message changed (read, status, note): the list shows it. */
  onChanged: (lead: Lead) => void;
  onDeleted: (id: number) => void;
  /** The heading takes the focus once read; not for a message that opened by itself (the owner may be typing a search). */
  focusOnOpen?: boolean;
}) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [askDelete, setAskDelete] = useState(false);
  const [readKey, setReadKey] = useState(0);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    storeApi.lead(id).then(
      (l) => {
        if (!live) return;
        setLead(l);
        setNote(l.note ?? '');
        setSubject(`Re: ${l.formTitle || 'your message'}`);
        changed.current(l);
      },
      (e) => live && setLoadError(errorSentence(e, 'This message could not be read. Try again.')),
    );
    return () => {
      live = false;
    };
  }, [id, readKey]);

  const took = (l: Lead, sentence: string) => {
    setLead(l);
    changed.current(l);
    setNotice(sentence);
  };

  const act = async (key: string, work: () => Promise<void>, fallback: string) => {
    setBusy(key);
    setProblem(null);
    setNotice(null);
    try {
      await work();
    } catch (e) {
      setProblem(errorSentence(e, fallback));
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (status: LeadStatus, sentence: string) =>
    act(status, async () => took(await storeApi.updateLead(id, { status }), sentence), 'This did not go through. Try again.');

  const send = () => {
    if (!lead) return;
    if (!body.trim()) {
      setProblem('Write your reply first.');
      return;
    }
    void act('reply', async () => {
      const answer = await storeApi.replyLead(id, { subject: subject.trim() || `Re: ${lead.formTitle || 'your message'}`, body });
      if (!answer?.sent) {
        setProblem('The email did not go out. Try again, or use your email app.');
        return;
      }
      const next = answer.lead?.status === 'answered' ? answer.lead : await storeApi.updateLead(id, { status: 'answered' });
      setComposing(false);
      setBody('');
      took(next, `Your reply went to ${lead.email}.`);
    }, 'The email did not go out. Try again, or use your email app.');
  };

  const saveNote = () => act('note', async () => took(await storeApi.updateLead(id, { note: note.trim() }), 'Note saved.'), 'The note did not save. Try again.');

  const remove = () => {
    setAskDelete(false);
    void act('delete', async () => {
      await storeApi.deleteLead(id);
      onDeleted(id);
    }, 'The message was not deleted. Try again.');
  };

  useEffect(() => {
    if (lead && focusOnOpen) heading.current?.focus();
  }, [lead?.id]);

  if (!lead) {
    return (
      <article className="wm-msg__read" aria-label="Message" data-testid="message-detail">
        <button type="button" className="wm-store-link wm-msg__back" onClick={onBack}>Back to messages</button>
        <ErrorLine message={loadError} onRetry={() => setReadKey((k) => k + 1)} />
        {!loadError && <Loading label="Reading the message" />}
      </article>
    );
  }

  const who = lead.name || lead.email || lead.phone || 'Someone';
  const mailto = mailtoHref(lead.email);
  const tel = lead.phone ? telHref(lead.phone) : null;
  const fields = (lead.fields ?? []).filter((f) => String(f.value ?? '').trim());
  const badge = STATUS_BADGE[lead.status] ?? STATUS_BADGE.new;

  return (
    <article className="wm-msg__read" aria-label={`Message from ${who}`} data-testid="message-detail">
      <button type="button" className="wm-store-link wm-msg__back" onClick={onBack}>Back to messages</button>
      <header className="wm-msg__head">
        <h2 className="wm-msg__name" tabIndex={-1} ref={heading}>{who}</h2>
        <Badge color={badge.color}>{badge.label}</Badge>
      </header>
      {(lead.email || lead.phone) && (
        <p className="wm-msg__contact">
          {lead.email && (mailto ? <a href={mailto}>{lead.email}</a> : <span>{lead.email}</span>)}
          {lead.phone && (tel ? <a href={tel}>{lead.phone}</a> : <span>{lead.phone}</span>)}
        </p>
      )}
      <p className="wm-store-muted">
        {lead.formTitle || 'A form'}
        {lead.pageUrl && <>, on <SentFrom url={lead.pageUrl} /></>}
        {`, ${shortDate(lead.createdAt)}`}
      </p>
      {lead.consent && <p className="wm-msg__consent">Agreed to get your emails</p>}

      {lead.message && <p className="wm-store-plain wm-msg__text" data-testid="message-text">{lead.message}</p>}
      {fields.length > 0 && (
        <dl className="wm-msg__fields">
          {fields.map((f, i) => (
            <div key={`${f.label}-${i}`} className="wm-msg__field">
              <dt>{f.label}</dt>
              <dd className="wm-store-plain">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="wm-store-badges wm-msg__actions">
        {mailto && <Button variant="primary" size="sm" onClick={() => setComposing(true)} disabled={composing}>Reply by email</Button>}
        {lead.status !== 'answered' && lead.status !== 'spam' && (
          <Button variant="secondary" size="sm" onClick={() => void setStatus('answered', 'Marked as answered.')} isLoading={busy === 'answered'}>Mark as answered</Button>
        )}
        {lead.status !== 'archived' && lead.status !== 'spam' && (
          <Button variant="ghost" size="sm" onClick={() => void setStatus('archived', 'Archived.')} isLoading={busy === 'archived'}>Archive</Button>
        )}
        {lead.status === 'spam' ? (
          <Button variant="ghost" size="sm" onClick={() => void setStatus('new', 'Moved back to your messages.')} isLoading={busy === 'new'}>Not spam</Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => void setStatus('spam', 'Moved to spam.')} isLoading={busy === 'spam'}>Spam</Button>
        )}
        <Button variant="danger" size="sm" onClick={() => setAskDelete(true)} isLoading={busy === 'delete'}>Delete</Button>
      </div>

      {composing && mailto && (
        <section className="wm-store-panel wm-msg__composer" aria-label="Reply by email">
          <p className="wm-store-muted">To {lead.email}</p>
          <Field label="Subject" htmlFor="reply-subject">
            <input id="reply-subject" className="wm-store-input" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Your reply" htmlFor="reply-body">
            <textarea id="reply-body" className="wm-store-textarea wm-msg__body" value={body} maxLength={10000} autoFocus onChange={(e) => setBody(e.target.value)} />
          </Field>
          <p className="wm-store-field__hint" data-testid="reply-mail-note">{mailNote(mail)}</p>
          <div className="wm-store-badges">
            <Button variant="primary" size="sm" onClick={send} isLoading={busy === 'reply'} data-testid="reply-send">Send</Button>
            <Button variant="ghost" size="sm" onClick={() => setComposing(false)}>Cancel</Button>
            <a className="wm-store-link" href={mailtoHref(lead.email, subject, body) ?? mailto}>Open in my email app</a>
          </div>
        </section>
      )}

      {notice && <p className="wm-store-outcome wm-store-outcome--ok" role="status">{notice}</p>}
      <ErrorLine message={problem} />

      <section className="wm-msg__note">
        <Field label="Note" htmlFor="message-note" hint="Only you and the people who manage this site see it.">
          <textarea id="message-note" className="wm-store-textarea" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div>
          <Button variant="secondary" size="sm" onClick={() => void saveNote()} isLoading={busy === 'note'} disabled={note.trim() === (lead.note ?? '').trim()}>Save the note</Button>
        </div>
      </section>

      <section aria-label="Timeline">
        <h3 className="wm-store-panel__title">Timeline</h3>
        <ol className="wm-msg__timeline">
          <li><span className="wm-store-muted">{shortDate(lead.createdAt)}</span> Received</li>
          {(lead.events ?? []).map((ev, i) => (
            <li key={`${ev.at}-${i}`}>
              <span className="wm-store-muted">{shortDate(ev.at)}</span> {ev.summary}
              {ev.by && <span className="wm-store-muted"> ({ev.by})</span>}
            </li>
          ))}
        </ol>
      </section>

      <Confirm
        open={askDelete}
        title="Delete this message?"
        message={`The message from ${who} is deleted for good, from your site too.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setAskDelete(false)}
        onConfirm={remove}
      />
    </article>
  );
}
