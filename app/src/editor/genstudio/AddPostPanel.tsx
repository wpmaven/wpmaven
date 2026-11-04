import React, { useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import { isSiteChatEnabled } from '../../utils/siteChat';
import { useAppliedFollows, type EditorEnv } from './env';
import { EditResultLine, PanelFrame, Working } from './ui';
import { useEditOperation } from './useEditOperation';

/** The id of what an add_post or add_product made ("post:42", "product:57" in its changes). */
export function createdId(changed: Array<{ ref: string }> | undefined, kind: 'post' | 'product'): number | null {
  for (const c of changed ?? []) {
    const m = new RegExp(`^${kind}:(\\d+)$`).exec(c.ref || ''); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- kind is 'post' or 'product'
    if (m) return Number(m[1]);
  }
  return null;
}

/** What the editor's chat is asked for "Write it for me" (the title, when there is one, rides along). */
export function writePostAsk(about: string, title = ''): string {
  const named = title.trim() ? `, titled "${title.trim()}"` : '';
  return `Write a blog post about ${about.trim().replace(/[.\s]+$/, '')}${named}`;
}

/**
 * A new post from the editor (2026-10-17, the sidebar's Add on its Posts
 * tab): a title, a sentence of what it is about, Draft or Publish. Create
 * makes it (add_post, the sentence as its short text) and opens it in the
 * editor; Write it for me asks the editor's chat to write it instead.
 */
export function AddPostPanel({ env }: { env: EditorEnv }) {
  const [title, setTitle] = useState('');
  const [about, setAbout] = useState('');
  const [status, setStatus] = useState<'draft' | 'publish'>('draft');
  const flow = useEditOperation();
  useAppliedFollows(flow, env);
  const busy = flow.state.phase === 'publishing';
  const canWrite = isSiteChatEnabled() && !!env.ask;

  const create = async () => {
    const name = title.trim().slice(0, 200);
    const r = await flow.publishNow({ op: 'add_post', fields: { title: name, status, ...(about.trim() ? { excerpt: about.trim().slice(0, 600) } : {}) } });
    const id = r?.status === 'published' && r.ok ? createdId(r.changed, 'post') : null;
    if (id) env.openNew?.({ type: 'post', id, title: name, draft: status === 'draft' });
  };

  return (
    <PanelFrame
      chip="New post"
      color="var(--purple)"
      title={title.trim() || 'Add a post'}
      onClose={env.closePanel}
      testId="editor-add-post"
      footer={(
        <>
          {busy && <Working text="Creating the post." />}
          {(flow.state.result || flow.state.error) && <EditResultLine result={flow.state.result} failure={flow.state.error} />}
          <div className="wme-gs-actions">
            {canWrite && (
              <Button variant="outline" size="sm" data-testid="post-write-for-me" disabled={busy || about.trim().length < 3} onClick={() => env.ask?.(writePostAsk(about, title))}>
                Write it for me
              </Button>
            )}
            <Button variant="primary" size="sm" className="wme-gs-push" data-testid="post-create" isLoading={busy} disabled={busy || !title.trim()} onClick={() => { void create(); }}>
              Create
            </Button>
          </div>
        </>
      )}
    >
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-new-post-title">Title</label>
        <input id="wme-gs-new-post-title" data-testid="new-post-title" className="wme-gs-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: How we roast our coffee" maxLength={200} disabled={busy} />
      </div>
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-new-post-about">What is it about?</label>
        <textarea id="wme-gs-new-post-about" data-testid="new-post-about" className="wme-gs-textarea" style={{ minHeight: 72 }} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="For example: the three roasts we sell and which one suits espresso" maxLength={600} disabled={busy} />
      </div>
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-new-post-status">Draft or publish</label>
        <select id="wme-gs-new-post-status" data-testid="new-post-status" className="wme-gs-select wm-select" value={status} onChange={(e) => setStatus(e.target.value === 'publish' ? 'publish' : 'draft')} disabled={busy}>
          <option value="draft">Keep it as a draft</option>
          <option value="publish">Publish it</option>
        </select>
      </div>
      <p className="wme-gs-hint">
        {canWrite
          ? 'Create makes the post with this title and opens it here. Write it for me asks the chat to write the whole post from what it is about.'
          : 'Create makes the post with this title and opens it here.'}
      </p>
    </PanelFrame>
  );
}
