import React, { useEffect, useRef, useState } from 'react';
import { Button, Checkbox } from '@yotako/webmaven-ui';
import { useDashboard } from '../../../contexts/DashboardContext';
import { editFailure, errorSentence, storeApi } from '../../../services/storeApi';
import { wpRest } from '../../../services/wpRest';
import type { StoreEditResult } from '../../../types/store';
import { nameOr } from '../../../utils/brand';
import Confirm from '../store/shared/Confirm';
import EditHistory from '../store/shared/EditHistory';
import EditOutcome from '../store/shared/EditOutcome';
import MediaPicker from '../store/shared/MediaPicker';
import { ConnectionNote, Drawer, ErrorLine, Field, Loading } from '../store/shared/ui';
import { POST_QUERY, changedFields, formOf, toPost, utc, type BlogPost, type PostForm, type WpPost } from './posts';
import { loadBlogCategories, type BlogCategory } from './categories';

const STATUS_OPTIONS = [
  { value: 'publish', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Waiting for review' },
  { value: 'private', label: 'Private' },
  { value: 'future', label: 'Scheduled' },
];

/**
 * The quick edit of one post: title, excerpt, status, date, featured image,
 * categories and tags, saved as one update_post with only what changed; the post's
 * history with Undo; Move to trash; Edit content opens the editor.
 */
export default function PostQuickEdit({ id, initial, writesAvailable, onClose, onDone, onChanged }: {
  id: number;
  /** The post as the list read it (the drawer reads it itself without). */
  initial?: BlogPost;
  writesAvailable: boolean;
  onClose: () => void;
  /** A change went through: the drawer closes and the list shows the outcome. */
  onDone: (result: StoreEditResult) => void;
  /** The post changed from inside the drawer (an undo in its history). */
  onChanged: () => void;
}) {
  const { openEditor } = useDashboard();
  const [post, setPost] = useState<BlogPost | null>(initial ?? null);
  const [form, setForm] = useState<PostForm | null>(initial ? formOf(initial) : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readKey, setReadKey] = useState(initial ? 0 : 1);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [failed, setFailed] = useState<StoreEditResult | null>(null);
  const [askTrash, setAskTrash] = useState(false);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const imageGroup = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    loadBlogCategories().then((c) => live && setCategories(c), () => undefined);
    return () => {
      live = false;
    };
  }, []);

  // The picker closed: the keyboard goes back to the image's buttons.
  const wasPicking = useRef(false);
  useEffect(() => {
    if (wasPicking.current && !picking) imageGroup.current?.querySelector<HTMLButtonElement>('button')?.focus();
    wasPicking.current = picking;
  }, [picking]);

  useEffect(() => {
    if (!readKey) return undefined;
    let live = true;
    setLoadError(null);
    wpRest.get<WpPost>(`wp/v2/posts/${id}`, { query: POST_QUERY }).then(
      (answer) => {
        if (!live) return;
        const fresh = toPost(answer.data);
        setPost(fresh);
        setForm(formOf(fresh));
      },
      (e) => live && setLoadError(errorSentence(e, 'This post could not be read. Try again.')),
    );
    return () => {
      live = false;
    };
  }, [id, readKey]);

  const set = (patch: Partial<PostForm>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const run = async (op: Parameters<typeof storeApi.edit>[0]) => {
    setBusy(true);
    setProblem(null);
    setFailed(null);
    try {
      const result = await storeApi.edit(op);
      if (editFailure(result)) setFailed(result);
      else onDone(result);
    } catch (e) {
      setProblem(errorSentence(e, 'The change did not go through. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!post || !form) return;
    if (!form.title.trim()) {
      setProblem('Give the post a title.');
      return;
    }
    if (form.status === 'future' && !form.date) {
      setProblem('Choose the date the post goes live.');
      return;
    }
    const fields = changedFields(post, form);
    if (!Object.keys(fields).length) {
      setProblem('Nothing changed yet.');
      return;
    }
    const base = utc(post.modifiedGmt);
    void run({ op: 'update_post', postId: post.id, fields: base ? { ...fields, baseModified: base } : fields });
  };

  const title = post?.title || 'Quick edit';
  const locked = !writesAvailable || busy;
  const designed = !!post?.designOwned;

  const footer = post && form && !picking ? (
    <>
      {!designed && (
        <Button variant="danger" size="sm" onClick={() => setAskTrash(true)} disabled={locked} className="wm-blog-edit__trash">
          Move to trash
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
      <Button variant="primary" size="sm" onClick={save} isLoading={busy} disabled={locked} data-testid="post-save">Save</Button>
    </>
  ) : undefined;

  return (
    <Drawer open title={title} onClose={onClose} footer={footer} testId="post-quick-edit">
      <ConnectionNote available={writesAvailable} />
      <ErrorLine message={loadError} onRetry={() => setReadKey((k) => k + 1)} />
      {!post || !form ? (!loadError && <Loading label="Reading the post" />) : picking ? (
        <MediaPicker
          title="Choose the featured image"
          onCancel={() => setPicking(false)}
          onPick={(m) => {
            set({ featured: { id: m.id, url: m.thumbUrl } });
            setPicking(false);
          }}
        />
      ) : (
        <>
          {designed && (
            <p className="wm-store-note" role="note">
              {nameOr('') ? `${nameOr('')} designed this page.` : 'This page is part of the site design.'} You can change its title here; change the rest in the editor.
            </p>
          )}
          <Field label="Title" htmlFor="post-title">
            <input id="post-title" className="wm-store-input" value={form.title} maxLength={200} required onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label="Excerpt" htmlFor="post-excerpt" hint="A short summary, shown where your site lists its posts.">
            <textarea id="post-excerpt" className="wm-store-textarea" value={form.excerpt} maxLength={600} disabled={designed} onChange={(e) => set({ excerpt: e.target.value })} />
          </Field>
          <div className="wm-store-field-row">
            <Field label="Status" htmlFor="post-status">
              <select id="post-status" className="wm-select" value={form.status} disabled={designed} onChange={(e) => set({ status: e.target.value })}>
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Date" htmlFor="post-date" hint={form.status === 'future' ? 'The post goes live at this time, in your site\'s time zone.' : 'In your site\'s time zone.'}>
              <input id="post-date" type="datetime-local" className="wm-store-input" value={form.date} disabled={designed} required={form.status === 'future'} onChange={(e) => set({ date: e.target.value })} />
            </Field>
          </div>
          <div className="wm-store-field">
            <span className="wm-store-field__label" id="post-image-label">Featured image</span>
            <div className="wm-blog-edit__image" aria-labelledby="post-image-label" role="group" ref={imageGroup}>
              <div className="wm-store-thumb wm-blog-edit__thumb">
                {form.featured?.url ? <img src={form.featured.url} alt="" /> : form.featured ? 'Image chosen' : 'No image'}
              </div>
              <Button variant="secondary" size="sm" onClick={() => setPicking(true)} disabled={designed}>
                {form.featured ? 'Change the image' : 'Choose an image'}
              </Button>
              {form.featured && (
                <Button variant="ghost" size="sm" onClick={() => set({ featured: null })} disabled={designed}>Remove the image</Button>
              )}
            </div>
          </div>
          {!designed && (
            <fieldset className="wm-store-fieldset" data-testid="post-categories">
              <legend className="wm-store-field__label">Categories</legend>
              {categories.length === 0 && form.newCategories.length === 0 && <span className="wm-store-muted">No categories yet.</span>}
              {categories.map((c) => (
                <Checkbox
                  key={c.id}
                  checked={form.categoryIds.includes(c.id)}
                  onChange={(on) => set({ categoryIds: on ? [...form.categoryIds, c.id] : form.categoryIds.filter((x) => x !== c.id) })}
                  label={c.name}
                />
              ))}
              {form.newCategories.map((name) => (
                <span key={name} className="wm-store-chip wm-store-chip--on">
                  {name}
                  <button type="button" className="wm-store-link" aria-label={`Do not add ${name}`} onClick={() => set({ newCategories: form.newCategories.filter((n) => n !== name) })}>&times;</button>
                </span>
              ))}
            </fieldset>
          )}
          {!designed && (
            <div className="wm-store-toolbar">
              <input className="wm-store-input" aria-label="New category" placeholder="New category" value={newCategory} maxLength={100} onChange={(e) => setNewCategory(e.target.value)} data-testid="post-new-category" />
              <Button variant="ghost" size="sm" disabled={!newCategory.trim()} onClick={() => {
                const name = newCategory.trim();
                const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
                if (existing) set({ categoryIds: form.categoryIds.includes(existing.id) ? form.categoryIds : [...form.categoryIds, existing.id] });
                else if (!form.newCategories.some((n) => n.toLowerCase() === name.toLowerCase())) set({ newCategories: [...form.newCategories, name] });
                setNewCategory('');
              }}>Add</Button>
            </div>
          )}
          {!designed && (
            <Field label="Tags" htmlFor="post-tags" hint="Separate them with commas.">
              <input id="post-tags" className="wm-store-input" value={form.tags} onChange={(e) => set({ tags: e.target.value })} data-testid="post-tags" />
            </Field>
          )}
          <div>
            <Button variant="secondary" size="sm" onClick={() => openEditor(post.id)}>Edit content</Button>
          </div>
          <EditOutcome result={failed} />
          <ErrorLine message={problem} />
          {writesAvailable && (
            <EditHistory
              target={`post:${post.id}`}
              onUndone={() => {
                setReadKey((k) => k + 1);
                onChanged();
              }}
            />
          )}
        </>
      )}
      <Confirm
        open={askTrash}
        title="Move this post to the trash?"
        message={`"${title}" comes off your site. You can undo this right after.`}
        confirmLabel="Move to trash"
        danger
        onCancel={() => setAskTrash(false)}
        onConfirm={() => {
          setAskTrash(false);
          if (post) void run({ op: 'remove_post', postId: post.id });
        }}
      />
    </Drawer>
  );
}
