import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import { KIND_COLORS } from './bindings';
import type { EditorEnv } from './env';
import { asUtc, postChanges, type PostValues } from './itemChanges';
import { loadPost, type PostSnapshot } from './siteData';
import { EditErrorBanner, EditResultLine, PanelFrame, PreviewFlow, Working } from './ui';
import { useEditOperation } from './useEditOperation';
import { useFrameFollows } from './env';
import { PostTextEditor } from './PostTextEditor';
import { isDictatedText } from './dictated';

// The change builders are shared with the page card (2026-10-19).
export { postChanges, slugOf, type PostValues } from './itemChanges';

/** A post card's own data: its title, its short text and whether it is published. */
export function PostForm({ env, postId, label }: { env: EditorEnv; postId: number; label: string }) {
  const [snapshot, setSnapshot] = useState<PostSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<PostValues>({ title: '', excerpt: '', status: 'publish' });
  const touched = useRef<Set<'title' | 'excerpt' | 'status'>>(new Set());
  const flow = useEditOperation();
  const s = flow.state;
  const busy = s.phase === 'publishing';
  // The post's text: rewritten from an instruction (a preview on the post's page), or edited by hand.
  const rewrite = useEditOperation();
  useFrameFollows(rewrite, env);
  const [instruction, setInstruction] = useState('');
  const [editingText, setEditingText] = useState(false);
  const textFlow = useEditOperation();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadPost(postId).then((p) => {
      if (!alive) return;
      setSnapshot(p);
      setValues((cur) => {
        const loaded: PostValues = { title: p?.title ?? label, excerpt: p?.excerpt ?? '', status: p?.status ?? 'publish' };
        touched.current.forEach((k) => { loaded[k] = cur[k]; });
        return loaded;
      });
      setLoading(false);
    });
    return () => { alive = false; };
  }, [postId, label]);

  const before: PostValues = { title: snapshot?.title ?? label, excerpt: snapshot?.excerpt ?? '', status: snapshot?.status ?? 'publish' };
  const { fields, problems } = postChanges(before, values);
  const changed = Object.keys(fields).length > 0;
  const set = (k: 'title' | 'excerpt' | 'status', v: string) => { touched.current.add(k); setValues((cur) => ({ ...cur, [k]: v })); };

  const save = async () => {
    if (!changed || problems.length) return;
    const r = await flow.publishNow({ op: 'update_post', postId, fields: { ...fields, ...(snapshot?.modifiedGmt ? { baseModified: asUtc(snapshot.modifiedGmt) } : {}) } });
    if (r?.status === 'published') {
      touched.current.clear();
      env.showLive();
      const fresh = await loadPost(postId);
      if (fresh) { setSnapshot(fresh); setValues({ title: fresh.title, excerpt: fresh.excerpt, status: fresh.status }); }
    }
  };

  const reload = async () => {
    const fresh = await loadPost(postId);
    if (fresh) { setSnapshot(fresh); setValues({ title: fresh.title, excerpt: fresh.excerpt, status: fresh.status }); }
  };

  const saveText = async (content: { html: string; baseHash: string }) => {
    const r = await textFlow.publishNow({ op: 'update_post', postId, fields: { content } });
    if (r?.status === 'published') {
      setEditingText(false);
      env.showLive();
      await reload();
    }
  };

  const textError = textFlow.state.error && textFlow.state.error.stage === 'publish' ? textFlow.state.error : null;

  return (
    <PanelFrame
      chip="Post"
      color={KIND_COLORS.post}
      title={values.title || label || 'Post'}
      sub="The card and the post itself show these"
      onClose={env.closePanel}
      footer={(
        <>
          {busy && <Working text="Saving the post." />}
          {s.result && <EditResultLine result={s.result} failure={s.error} />}
          {s.error && s.error.stage === 'publish' && (
            <EditErrorBanner code={s.error.code} message={s.error.message} busy={busy} onRetry={() => { void save(); }} onDiscard={() => { flow.reset(); touched.current.clear(); setValues(before); }} />
          )}
          <div className="wme-gs-actions">
            {s.phase === 'published' && s.result?.undoable && (
              <Button data-testid="editor-undo" variant="outline" size="sm" onClick={() => env.undo(s.result!)}>Undo</Button>
            )}
            <Button data-testid="post-save" variant="primary" size="sm" className="wme-gs-push" disabled={!changed || problems.length > 0 || busy || loading} isLoading={busy} onClick={() => { void save(); }}>
              Save
            </Button>
          </div>
        </>
      )}
    >
      {loading && <Working text="Reading the post." />}
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-post-title">Title</label>
        <input id="wme-gs-post-title" data-testid="post-title" className="wme-gs-input" value={values.title} onChange={(e) => set('title', e.target.value)} disabled={loading || busy} maxLength={200} />
      </div>
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-post-excerpt">Short text on the card</label>
        <textarea id="wme-gs-post-excerpt" className="wme-gs-textarea" value={values.excerpt} onChange={(e) => set('excerpt', e.target.value)} disabled={loading || busy} maxLength={600} />
      </div>
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-post-status">Visible on the site</label>
        <select id="wme-gs-post-status" className="wme-gs-select wm-select" value={values.status === 'draft' ? 'draft' : 'publish'} onChange={(e) => set('status', e.target.value)} disabled={loading || busy}>
          <option value="publish">Published</option>
          <option value="draft">Draft (hidden)</option>
        </select>
      </div>
      {problems.length > 0 && <div className="wme-gs-note is-warn" role="alert">{problems.join(' ')}</div>}

      <div data-testid="post-text-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p className="wme-gs-section-title">The text of the post</p>
        {!editingText && (
          <>
            <label className="wme-gs-label" htmlFor="wme-gs-post-rewrite">What should change in the post?</label>
            <textarea
              id="wme-gs-post-rewrite"
              data-testid="post-rewrite-instruction"
              className="wme-gs-textarea"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="For example: make the introduction shorter and mention the autumn blend"
              disabled={loading || rewrite.state.phase === 'previewing' || rewrite.state.phase === 'publishing'}
              maxLength={2000}
            />
            <PreviewFlow
              flow={rewrite}
              canPreview={instruction.trim().length >= 3 && !loading}
              onPreview={(refine) => { void rewrite.preview({ op: 'rewrite_post', postId, instruction: instruction.trim() }, { refine }); }}
              workingText="Rewriting the post. This can take up to a minute."
              phoneFirst={env.viewport === 'mobile'}
              onUndo={env.undo}
              onDone={() => { rewrite.reset(); setInstruction(''); void reload(); }}
              versionable={rewrite.state.operation?.op === 'rewrite_post' && !isDictatedText(instruction)}
            />
            {rewrite.state.phase === 'idle' && (
              <button type="button" className="wme-gs-link" data-testid="post-text-edit" disabled={loading || !snapshot?.content} onClick={() => { textFlow.reset(); setEditingText(true); }}>
                Edit the words yourself
              </button>
            )}
          </>
        )}
        {editingText && snapshot && (
          <>
            {textFlow.state.phase === 'publishing' && <Working text="Saving the text." />}
            {textError && (
              <div className="wme-gs-note is-bad" role="alert" data-testid="post-text-error">
                {textError.code === 'CHANGED_ELSEWHERE' ? 'This post changed somewhere else after you opened it. Nothing was saved.' : textError.message}
                {textError.code === 'CHANGED_ELSEWHERE' && (
                  <div style={{ marginTop: 6 }}>
                    <button type="button" className="wme-gs-link" data-testid="post-text-reload" onClick={() => { textFlow.reset(); void reload(); }}>Load the latest text</button>
                  </div>
                )}
              </div>
            )}
            <PostTextEditor
              postId={postId}
              html={snapshot.content}
              busy={textFlow.state.phase === 'publishing'}
              onSave={(content) => { void saveText(content); }}
              onCancel={() => { textFlow.reset(); setEditingText(false); }}
            />
          </>
        )}
        {textFlow.state.phase === 'published' && textFlow.state.result && (
          <>
            <EditResultLine result={textFlow.state.result} />
            {textFlow.state.result.undoable && (
              <div className="wme-gs-actions">
                <Button data-testid="post-text-undo" variant="outline" size="sm" onClick={() => env.undo(textFlow.state.result!)}>Undo</Button>
              </div>
            )}
          </>
        )}
      </div>
    </PanelFrame>
  );
}
