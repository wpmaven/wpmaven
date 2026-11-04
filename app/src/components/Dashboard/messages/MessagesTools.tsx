import React, { useEffect, useState } from 'react';
import { Button, Checkbox, Radio } from '@yotako/webmaven-ui';
import { errorSentence, storeApi, type LeadsSettings } from '../../../services/storeApi';
import type { LeadStatus } from '../../../types/store';
import { nameOr } from '../../../utils/brand';
import { Drawer, ErrorLine, Field, Loading } from '../store/shared/ui';

type Months = LeadsSettings['retentionMonths'];
const PERIODS: Months[] = [3, 6, 12, 24];
/** "Remove WPMaven's data when the plugin is deleted", in the site's brand (white label) or naming nobody. */
function removeLabel(): string {
  const brand = nameOr('');
  return `Remove ${brand ? `${brand}'s` : 'the plugin\'s'} data when the plugin is deleted`;
}

export function retentionSentence(months: Months): string {
  return `Messages are kept for ${months} months, then deleted.`;
}

/** Export: the messages of a period (and a status) as a CSV file. */
export function ExportMessages({ onClose }: { onClose: () => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const run = async () => {
    if (from && to && from > to) {
      setProblem('The first day comes after the last one.');
      return;
    }
    setBusy(true);
    setProblem(null);
    setDone(false);
    try {
      await storeApi.exportLeads({ from, to, status });
      setDone(true);
    } catch (e) {
      setProblem(errorSentence(e, 'The export did not finish. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      title="Export messages"
      onClose={onClose}
      testId="messages-export"
      footer={(
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          <Button variant="primary" size="sm" onClick={run} isLoading={busy}>Download the file</Button>
        </>
      )}
    >
      <p className="wm-store-muted">A CSV file of your messages, for Excel, Numbers or Google Sheets. Leave the dates empty to export them all.</p>
      <div className="wm-store-field-row">
        <Field label="From" htmlFor="export-from">
          <input id="export-from" type="date" className="wm-store-input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To" htmlFor="export-to">
          <input id="export-to" type="date" className="wm-store-input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Field label="Messages" htmlFor="export-status">
        <select id="export-status" className="wm-select" value={status} onChange={(e) => setStatus(e.target.value as LeadStatus | '')}>
          <option value="">All messages</option>
          <option value="new">New</option>
          <option value="answered">Answered</option>
          <option value="archived">Archived</option>
          <option value="spam">Spam</option>
        </select>
      </Field>
      {done && <p className="wm-store-outcome wm-store-outcome--ok" role="status">Your file is downloading.</p>}
      <ErrorLine message={problem} />
    </Drawer>
  );
}

/**
 * Settings: how long the site keeps messages (3, 6, 12 or 24 months) and
 * whether deleting the plugin removes WPMaven's data, messages included.
 */
export function MessagesSettings({ onClose }: { onClose: () => void }) {
  const [saved, setSaved] = useState<LeadsSettings | null>(null);
  const [months, setMonths] = useState<Months>(12);
  const [remove, setRemove] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readKey, setReadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const label = removeLabel();
  const brand = nameOr('');

  useEffect(() => {
    let live = true;
    setLoadError(null);
    storeApi.leadsSettings().then(
      (s) => {
        if (!live) return;
        const period = PERIODS.includes(s?.retentionMonths as Months) ? s.retentionMonths : 12;
        setSaved({ ...s, retentionMonths: period, removeOnUninstall: s?.removeOnUninstall === true });
        setMonths(period);
        setRemove(s?.removeOnUninstall === true);
      },
      (e) => live && setLoadError(errorSentence(e, 'The settings could not be read. Try again.')),
    );
    return () => {
      live = false;
    };
  }, [readKey]);

  const save = async () => {
    if (!saved) return;
    const patch: Partial<LeadsSettings> = {};
    if (months !== saved.retentionMonths) patch.retentionMonths = months;
    if (remove !== (saved.removeOnUninstall === true)) patch.removeOnUninstall = remove;
    if (!Object.keys(patch).length) {
      setProblem('Nothing changed yet.');
      return;
    }
    setBusy(true);
    setProblem(null);
    setDone(false);
    try {
      const answer = await storeApi.saveLeadsSettings(patch);
      setSaved({ ...saved, ...patch, ...(answer ?? {}) });
      setDone(true);
    } catch (e) {
      setProblem(errorSentence(e, 'The settings did not save. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      title="Message settings"
      onClose={onClose}
      testId="messages-settings"
      footer={saved ? (
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          <Button variant="primary" size="sm" onClick={save} isLoading={busy} data-testid="settings-save">Save</Button>
        </>
      ) : undefined}
    >
      <ErrorLine message={loadError} onRetry={() => setReadKey((k) => k + 1)} />
      {!saved ? (!loadError && <Loading label="Reading the settings" />) : (
        <>
          <fieldset className="wm-msg__periods">
            <legend className="wm-store-field__label">Keep messages for</legend>
            {PERIODS.map((p) => (
              <Radio key={p} name="retention" value={String(p)} checked={months === p} onChange={() => setMonths(p)} label={`${p} months`} />
            ))}
          </fieldset>
          <p data-testid="retention-sentence">{retentionSentence(months)}</p>
          <Checkbox checked={remove} onChange={setRemove} label={label} />
          <p className="wm-store-muted">{`Deleting the ${brand ? `${brand} ` : ''}plugin keeps them, unless "${label}" is on.`}</p>
          {done && <p className="wm-store-outcome wm-store-outcome--ok" role="status">Saved.</p>}
          <ErrorLine message={problem} />
        </>
      )}
    </Drawer>
  );
}
