import React, { useMemo, useState } from 'react';
import { Button, Checkbox } from '@yotako/webmaven-ui';
import type { FormChange, FormFieldType, SiteMapForm } from '../../types/edits';
import { KIND_COLORS, KIND_WORDS, pageFor } from './bindings';
import { useFrameFollows, type EditorEnv } from './env';
import { EditResultLine, PanelFrame, PreviewFlow, Working } from './ui';
import { useEditOperation } from './useEditOperation';

/** The kinds of field, in owner words. */
export const FIELD_KINDS: Array<{ type: FormFieldType; word: string }> = [
  { type: 'text', word: 'Text' },
  { type: 'email', word: 'Email' },
  { type: 'tel', word: 'Phone' },
  { type: 'textarea', word: 'Long text' },
  { type: 'date', word: 'Date' },
  { type: 'number', word: 'Number' },
  { type: 'select', word: 'List' },
  { type: 'radio', word: 'Choice' },
  { type: 'checkbox', word: 'Checkboxes' },
  { type: 'url', word: 'Website' },
];
const KIND_WORD = Object.fromEntries(FIELD_KINDS.map((k) => [k.type, k.word])) as Record<FormFieldType, string>;
const HAS_CHOICES = new Set<FormFieldType>(['select', 'radio', 'checkbox']);
const MAX_RECIPIENTS = 5;

type Field = SiteMapForm['fields'][number];

/** The form's name with a capital: "Contact form". */
export function formTitle(form: Pick<SiteMapForm, 'label'>): string {
  const what = form.label.replace(/^the /, '').replace(/ (on the .+ page|in the (header|footer))$/, '');
  return what.charAt(0).toUpperCase() + what.slice(1);
}

/** Where the form is: "On the Contact page", "In the footer". */
export function formPlace(form: SiteMapForm, pageTitle: (slug: string) => string): string {
  if (form.place.region) return `In the ${form.place.region}`;
  return form.place.page ? `On the ${pageTitle(form.place.page)} page` : '';
}

/** The fields after the pending changes, as the panel lists them (new ones get a stand-in id below zero). */
export function draftFields(fields: Field[], changes: FormChange[]): Array<Field & { pending?: boolean }> {
  let out: Array<Field & { pending?: boolean }> = fields.map((f) => ({ ...f }));
  let stand = -1;
  for (const c of changes) {
    if (c.change === 'add_field') {
      const f = { id: stand--, label: c.label, type: c.type, required: !!c.required, ...(c.placeholder ? { placeholder: c.placeholder } : {}), ...(c.options ? { options: c.options } : {}), origin: 'design' as const, pending: true };
      const at = c.afterFieldId === null ? 0 : c.afterFieldId === undefined ? out.filter((x) => x.origin === 'design').length : out.findIndex((x) => x.id === c.afterFieldId) + 1;
      out.splice(Math.max(0, at), 0, f);
    } else if (c.change === 'remove_field') {
      out = out.filter((x) => x.id !== c.fieldId);
    } else if (c.change === 'update_field') {
      out = out.map((x) => (x.id === c.fieldId ? { ...x, ...(c.label !== undefined ? { label: c.label } : {}), ...(c.required !== undefined ? { required: c.required } : {}), ...(c.placeholder !== undefined ? { placeholder: c.placeholder } : {}), ...(c.options ? { options: c.options } : {}), pending: true } : x));
    } else if (c.change === 'move_field') {
      const f = out.find((x) => x.id === c.fieldId);
      if (!f) continue;
      out = out.filter((x) => x.id !== c.fieldId);
      const at = c.afterFieldId === null ? 0 : out.findIndex((x) => x.id === c.afterFieldId) + 1;
      out.splice(Math.max(0, at), 0, { ...f, pending: true });
    }
  }
  return out;
}

/** The recipients in words: "anna@example.com and you". */
export function recipientsLine(list: Array<{ address: string; isOwner: boolean }>): string {
  const names = [...list.filter((r) => !r.isOwner).map((r) => r.address), ...(list.some((r) => r.isOwner) ? ['you'] : [])];
  if (names.length <= 1) return names[0] ?? 'nobody';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * A form WPMaven designed: its fields and button change on the page (a
 * preview first, then published, with an undo), its thank-you message and
 * who gets an email for each message are saved at once. A field added in
 * WPForms' own builder can be removed here; the email updates box stays.
 */
export function FormPanel({ env, name }: { env: EditorEnv; name: string }) {
  const form = useMemo(() => env.siteMap?.forms?.find((f) => f.name === name) ?? null, [env.siteMap, name]);
  const page = form?.place.page ?? env.currentPage;
  const flow = useEditOperation();
  useFrameFollows(flow, env, page);
  const settingsFlow = useEditOperation();
  const [changes, setChanges] = useState<FormChange[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<Field | null>(null);
  const [button, setButton] = useState<string | null>(null);
  const pageTitle = (slug: string) => pageFor(env.siteMap, slug)?.title ?? (slug === 'index' ? 'home' : slug);

  if (!form) {
    return (
      <PanelFrame chip={KIND_WORDS.form} color={KIND_COLORS.form} title="Form" onClose={env.closePanel}>
        <p className="wme-gs-hint">This form cannot be changed here yet. Publish the page that holds it, then open it again.</p>
      </PanelFrame>
    );
  }

  const title = formTitle(form);
  const fields = draftFields(form.fields, changes);
  const designFields = fields.filter((f) => f.origin === 'design');
  const busy = flow.state.phase === 'previewing' || flow.state.phase === 'publishing';
  const locked = busy || flow.state.phase === 'previewed';
  const push = (c: FormChange) => { setChanges((cur) => [...cur, c]); };
  const buttonText = button ?? form.submitText;
  const pendingButton = button !== null && button.trim() !== form.submitText && button.trim().length > 0;
  const allChanges: FormChange[] = [...changes, ...(pendingButton ? [{ change: 'submit_text' as const, text: button!.trim() }] : [])];

  // Every preview carries the whole list of changes (a new preview, never a refinement).
  const preview = () => {
    if (!allChanges.length) return;
    void flow.preview({ op: 'edit_form', form: form.name, changes: allChanges });
  };

  const moveUp = (f: Field) => {
    const i = designFields.findIndex((x) => x.id === f.id);
    if (i <= 0) return;
    push({ change: 'move_field', fieldId: f.id, afterFieldId: i >= 2 ? designFields[i - 2].id : null });
  };
  const moveDown = (f: Field) => {
    const i = designFields.findIndex((x) => x.id === f.id);
    if (i < 0 || i >= designFields.length - 1) return;
    push({ change: 'move_field', fieldId: f.id, afterFieldId: designFields[i + 1].id });
  };

  return (
    <PanelFrame
      chip={KIND_WORDS.form}
      color={KIND_COLORS.form}
      title={title}
      sub={formPlace(form, pageTitle)}
      onClose={env.closePanel}
      testId="form-panel"
      footer={(
        <PreviewFlow
          flow={flow}
          canPreview={allChanges.length > 0}
          onPreview={preview}
          workingText="Preparing the form with your changes."
          phoneFirst={env.viewport === 'mobile'}
          onUndo={env.undo}
          onDone={() => { flow.reset(); setChanges([]); setButton(null); }}
          extraActions={changes.length > 0 && !locked ? (
            <Button variant="ghost" size="sm" onClick={() => { setChanges([]); setButton(null); }}>Start over</Button>
          ) : undefined}
        />
      )}
    >
      <h3 className="wme-gs-label" style={{ marginTop: 0 }}>Fields</h3>
      <ul className="wme-gs-list" data-testid="form-fields">
        {fields.map((f) => (
          <li key={f.id} className="wme-gs-row" data-testid={`form-field-${f.id}`} data-origin={f.origin}>
            {f.origin === 'consent' ? (
              <span className="wme-gs-hint">Email updates box: always optional, never ticked in advance</span>
            ) : (
              <>
                <span style={{ flex: 1 }}>
                  <strong>{f.label}</strong>{' '}
                  <span className="wme-gs-hint">{KIND_WORD[f.type] ?? 'Text'}{f.pending ? ', changed' : ''}</span>
                  {f.origin === 'wpforms' && <span className="wme-gs-hint" style={{ display: 'block' }}>Added in WPForms. It shows at the end of the form.</span>}
                </span>
                {f.origin === 'design' && (
                  <>
                    <span style={{ whiteSpace: 'nowrap' }}>
                      <Checkbox
                        checked={f.required}
                        disabled={locked || f.id < 0}
                        onChange={(required) => push({ change: 'update_field', fieldId: f.id, required })}
                        label={<span data-testid={`form-required-${f.id}`}>Required</span>}
                      />
                    </span>
                    <button type="button" className="wme-gs-link" disabled={locked || f.id < 0} aria-label={`Move ${f.label} up`} onClick={() => moveUp(f)}>Up</button>
                    <button type="button" className="wme-gs-link" disabled={locked || f.id < 0} aria-label={`Move ${f.label} down`} onClick={() => moveDown(f)}>Down</button>
                    <button type="button" className="wme-gs-link" disabled={locked || f.id < 0} data-testid={`form-edit-${f.id}`} onClick={() => setEditing(f.id)}>Edit</button>
                  </>
                )}
                <button type="button" className="wme-gs-link" disabled={locked || f.id < 0} data-testid={`form-remove-${f.id}`} onClick={() => setRemoving(f)}>Remove</button>
              </>
            )}
            {editing === f.id && (
              <FieldEditor
                field={f}
                onCancel={() => setEditing(null)}
                onSave={(patch) => { push({ change: 'update_field', fieldId: f.id, ...patch }); setEditing(null); }}
                taken={fields.filter((x) => x.id !== f.id).map((x) => x.label.toLowerCase())}
              />
            )}
          </li>
        ))}
      </ul>

      {removing && (
        <RemoveField
          field={removing}
          messages={form.settings?.messages ?? null}
          busy={settingsFlow.state.phase === 'publishing'}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            if (removing.origin === 'wpforms') {
              const r = await settingsFlow.publishNow({ op: 'update_form_settings', form: form.name, removeFields: [removing.id] });
              if (r?.status === 'published') env.refreshSiteMap();
            } else {
              push({ change: 'remove_field', fieldId: removing.id });
            }
            setRemoving(null);
          }}
        />
      )}

      {adding ? (
        <AddField
          fields={designFields}
          taken={fields.map((x) => x.label.toLowerCase())}
          onCancel={() => setAdding(false)}
          onAdd={(c) => { push(c); setAdding(false); }}
        />
      ) : (
        <Button variant="outline" size="sm" data-testid="form-add-field" disabled={locked} onClick={() => setAdding(true)}>Add a field</Button>
      )}

      <label className="wme-gs-label" htmlFor="wme-gs-form-button">Button text</label>
      <input
        id="wme-gs-form-button"
        data-testid="form-button-text"
        className="wme-gs-input"
        value={buttonText}
        maxLength={40}
        disabled={locked}
        onChange={(e) => setButton(e.target.value)}
      />

      <AfterSending env={env} form={form} flow={settingsFlow} />
    </PanelFrame>
  );
}

function FieldEditor({ field, onSave, onCancel, taken }: {
  field: Field;
  onSave: (patch: { label?: string; placeholder?: string; options?: string[] }) => void;
  onCancel: () => void;
  taken: string[];
}) {
  const [label, setLabel] = useState(field.label);
  const [hint, setHint] = useState(field.placeholder ?? '');
  const [choices, setChoices] = useState((field.options ?? []).join('\n'));
  const problem = !label.trim() ? 'A field needs a name.' : taken.includes(label.trim().toLowerCase()) ? `This form already has a field called ${label.trim()}.` : null;
  const save = () => {
    if (problem) return;
    const patch: { label?: string; placeholder?: string; options?: string[] } = {};
    if (label.trim() !== field.label) patch.label = label.trim();
    if (!HAS_CHOICES.has(field.type) && hint.trim() !== (field.placeholder ?? '')) patch.placeholder = hint.trim();
    const list = choices.split('\n').map((c) => c.trim()).filter(Boolean);
    if (HAS_CHOICES.has(field.type) && JSON.stringify(list) !== JSON.stringify(field.options ?? [])) patch.options = list;
    if (Object.keys(patch).length) onSave(patch);
    else onCancel();
  };
  return (
    <div className="wme-gs-subform" style={{ width: '100%' }}>
      <label className="wme-gs-label" htmlFor={`wme-gs-field-${field.id}-label`}>Name of the field</label>
      <input id={`wme-gs-field-${field.id}-label`} data-testid="form-field-label" className="wme-gs-input" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
      {HAS_CHOICES.has(field.type) ? (
        <>
          <label className="wme-gs-label" htmlFor={`wme-gs-field-${field.id}-choices`}>Choices, one per line</label>
          <textarea id={`wme-gs-field-${field.id}-choices`} className="wme-gs-textarea" value={choices} onChange={(e) => setChoices(e.target.value)} />
        </>
      ) : (
        <>
          <label className="wme-gs-label" htmlFor={`wme-gs-field-${field.id}-hint`}>Hint inside the field (optional)</label>
          <input id={`wme-gs-field-${field.id}-hint`} className="wme-gs-input" value={hint} maxLength={120} onChange={(e) => setHint(e.target.value)} />
        </>
      )}
      {problem && <div className="wme-gs-note is-warn" role="alert">{problem}</div>}
      <div className="wme-gs-actions">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" data-testid="form-field-save" className="wme-gs-push" disabled={!!problem} onClick={save}>Keep this change</Button>
      </div>
    </div>
  );
}

function AddField({ fields, taken, onAdd, onCancel }: {
  fields: Field[];
  taken: string[];
  onAdd: (c: FormChange) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<FormFieldType>('text');
  const [required, setRequired] = useState(false);
  const [hint, setHint] = useState('');
  const [choices, setChoices] = useState('');
  const [after, setAfter] = useState<string>('end');
  const list = choices.split('\n').map((c) => c.trim()).filter(Boolean);
  const problem = !label.trim() ? null
    : taken.includes(label.trim().toLowerCase()) ? `This form already has a field called ${label.trim()}.`
      : (type === 'select' || type === 'radio') && list.length < 2 ? 'A list or a choice needs at least two choices.'
        : null;
  const add = () => {
    if (!label.trim() || problem) return;
    onAdd({
      change: 'add_field',
      label: label.trim(),
      type,
      required,
      ...(hint.trim() && !HAS_CHOICES.has(type) ? { placeholder: hint.trim() } : {}),
      ...(HAS_CHOICES.has(type) && list.length ? { options: list } : {}),
      ...(after === 'first' ? { afterFieldId: null } : after !== 'end' ? { afterFieldId: Number(after) } : {}),
    });
  };
  return (
    <div className="wme-gs-subform" data-testid="form-add">
      <label className="wme-gs-label" htmlFor="wme-gs-add-label">Name of the field</label>
      <input id="wme-gs-add-label" data-testid="form-add-label" className="wme-gs-input" value={label} maxLength={80} placeholder="For example: Phone" onChange={(e) => setLabel(e.target.value)} />
      <label className="wme-gs-label" htmlFor="wme-gs-add-kind">Kind</label>
      <select id="wme-gs-add-kind" data-testid="form-add-kind" className="wme-gs-select wm-select" value={type} onChange={(e) => setType(e.target.value as FormFieldType)}>
        {FIELD_KINDS.map((k) => <option key={k.type} value={k.type}>{k.word}</option>)}
      </select>
      <Checkbox checked={required} onChange={setRequired} label="Required" />
      {HAS_CHOICES.has(type) ? (
        <>
          <label className="wme-gs-label" htmlFor="wme-gs-add-choices">Choices, one per line</label>
          <textarea id="wme-gs-add-choices" data-testid="form-add-choices" className="wme-gs-textarea" value={choices} onChange={(e) => setChoices(e.target.value)} />
        </>
      ) : (
        <>
          <label className="wme-gs-label" htmlFor="wme-gs-add-hint">Hint inside the field (optional)</label>
          <input id="wme-gs-add-hint" className="wme-gs-input" value={hint} maxLength={120} onChange={(e) => setHint(e.target.value)} />
        </>
      )}
      <label className="wme-gs-label" htmlFor="wme-gs-add-where">Where</label>
      <select id="wme-gs-add-where" data-testid="form-add-where" className="wme-gs-select wm-select" value={after} onChange={(e) => setAfter(e.target.value)}>
        <option value="end">Before the button</option>
        <option value="first">First</option>
        {fields.filter((f) => f.id >= 0).map((f) => <option key={f.id} value={String(f.id)}>After {f.label}</option>)}
      </select>
      {problem && <div className="wme-gs-note is-warn" role="alert">{problem}</div>}
      <div className="wme-gs-actions">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" data-testid="form-add-confirm" className="wme-gs-push" disabled={!label.trim() || !!problem} onClick={add}>Add</Button>
      </div>
    </div>
  );
}

function RemoveField({ field, messages, busy, onConfirm, onCancel }: {
  field: Field;
  messages: number | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="wme-gs-note is-warn" role="alertdialog" data-testid="form-remove-confirm">
      {messages ? <p style={{ margin: '0 0 6px' }}>{messages} message{messages === 1 ? '' : 's'} came through this form.</p> : null}
      <p style={{ margin: '0 0 6px' }}>Remove the {field.label} field? Messages people already sent keep it. New messages will not ask for it.</p>
      <div className="wme-gs-actions">
        <Button variant="ghost" size="sm" onClick={onCancel}>Keep it</Button>
        <Button variant="primary" size="sm" data-testid="form-remove-yes" className="wme-gs-push" isLoading={busy} onClick={onConfirm}>Remove</Button>
      </div>
    </div>
  );
}

/** What happens after sending: the thank-you message and who gets an email, saved at once. */
function AfterSending({ env, form, flow }: { env: EditorEnv; form: SiteMapForm; flow: ReturnType<typeof useEditOperation> }) {
  const settings = form.settings;
  const ownerAddress = settings?.recipients.find((r) => r.isOwner)?.address ?? '';
  const [message, setMessage] = useState(settings?.confirmation ?? '');
  const [emailOn, setEmailOn] = useState(settings?.emailOn ?? true);
  const [owner, setOwner] = useState(settings ? settings.recipients.some((r) => r.isOwner) : true);
  const [others, setOthers] = useState<string[]>(settings?.recipients.filter((r) => !r.isOwner).map((r) => r.address) ?? []);
  const [draft, setDraft] = useState('');
  const busy = flow.state.phase === 'publishing';
  if (!settings) {
    return <p className="wme-gs-hint" data-testid="form-settings-missing">What this form says after sending and who gets an email can be changed once the plugin on this site is up to date.</p>;
  }
  const recipients = emailOn ? [...(owner ? ['owner'] : []), ...others] : [];
  const tooMany = recipients.length > MAX_RECIPIENTS;
  const bad = others.find((a) => !EMAIL.test(a) || /@example\.(com|org|net)$/i.test(a));
  const messageChanged = message.trim() !== settings.confirmation && message.trim().length > 0;
  const before = settings.emailOn ? settings.recipients.map((r) => (r.isOwner ? 'owner' : r.address)) : [];
  const recipientsChanged = JSON.stringify([...recipients].sort()) !== JSON.stringify([...before].sort());
  const problem = emailOn && !recipients.length ? 'Choose who gets an email, or turn the emails off.'
    : tooMany ? 'Choose one to five addresses.'
      : bad ? (/@example\./i.test(bad) ? 'Addresses at example.com never receive mail. Use a real address.' : `${bad} is not an email address.`)
        : message.length > 240 ? 'The thank-you message has at most 240 characters.' : null;
  const save = async () => {
    if (problem || (!messageChanged && !recipientsChanged)) return;
    const r = await flow.publishNow({
      op: 'update_form_settings', form: form.name,
      ...(messageChanged ? { confirmation: message.trim() } : {}),
      ...(recipientsChanged ? { recipients } : {}),
    });
    if (r?.status === 'published') env.refreshSiteMap();
  };
  const adminUrl = ((window as any).wmeConfig?.adminUrl as string | undefined) || '/wp-admin/';
  const saved = flow.state.phase === 'published' && flow.state.result;
  const shown = emailOn ? recipientsLine([...(owner ? [{ address: ownerAddress, isOwner: true }] : []), ...others.map((a) => ({ address: a, isOwner: false }))]) : '';
  return (
    <div data-testid="form-settings" style={{ marginTop: 16 }}>
      <h3 className="wme-gs-label">After sending</h3>
      <label className="wme-gs-label" htmlFor="wme-gs-form-thanks">Message shown after sending</label>
      <textarea id="wme-gs-form-thanks" data-testid="form-thanks" className="wme-gs-textarea" value={message} maxLength={240} disabled={busy} onChange={(e) => setMessage(e.target.value)} />
      <span className="wme-gs-label">Email each message to</span>
      <Checkbox checked={owner && emailOn} disabled={busy || !emailOn} onChange={setOwner} label={<span data-testid="form-email-owner">{`You${ownerAddress ? `, ${ownerAddress}` : ''}`}</span>} />
      {others.map((a) => (
        <div key={a} className="wme-gs-row">
          <span style={{ flex: 1 }}>{a}</span>
          <button type="button" className="wme-gs-link" disabled={busy} onClick={() => setOthers((cur) => cur.filter((x) => x !== a))}>Remove</button>
        </div>
      ))}
      {emailOn && recipients.length < MAX_RECIPIENTS && (
        <div className="wme-gs-row">
          <input data-testid="form-email-add" className="wme-gs-input" value={draft} placeholder="Add an address" disabled={busy} onChange={(e) => setDraft(e.target.value)} />
          <button
            type="button"
            className="wme-gs-link"
            disabled={busy || !EMAIL.test(draft.trim())}
            onClick={() => { const a = draft.trim().toLowerCase(); if (!others.includes(a)) setOthers((cur) => [...cur, a]); setDraft(''); }}
          >
            Add
          </button>
        </div>
      )}
      <Checkbox checked={!emailOn} disabled={busy} onChange={(off) => setEmailOn(!off)} label={<span data-testid="form-email-off">Do not email me, I read Messages</span>} />
      <p className="wme-gs-hint">
        Every message also lands in Messages.{' '}
        <a href={`${adminUrl}admin.php?page=webmaven-dashboard#/messages`} target="_top" rel="noreferrer">Open Messages</a>
      </p>
      {problem && <div className="wme-gs-note is-warn" role="alert">{problem}</div>}
      {busy && <Working text="Saving." />}
      {saved && <p className="wme-gs-hint" data-testid="form-settings-saved">{emailOn ? `Saved. The next message goes to ${shown}.` : 'Saved. New messages are no longer emailed, they stay in Messages.'}</p>}
      {flow.state.error && <EditResultLine result={flow.state.result} failure={flow.state.error} />}
      <div className="wme-gs-actions">
        {saved && flow.state.result?.undoable && <Button variant="outline" size="sm" onClick={() => env.undo(flow.state.result!)}>Undo</Button>}
        <Button data-testid="form-settings-save" variant="primary" size="sm" className="wme-gs-push" disabled={busy || !!problem || (!messageChanged && !recipientsChanged)} isLoading={busy} onClick={() => { void save(); }}>Save</Button>
      </div>
    </div>
  );
}
