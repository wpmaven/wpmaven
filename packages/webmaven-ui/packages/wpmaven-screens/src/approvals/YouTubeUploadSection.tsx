import React, { useEffect, useRef } from 'react';
import type { OperatorApproval } from './types';
import { YouTubeVisibilityChoice } from './YouTubeVisibilityChoice';
import {
  YOUTUBE_DESCRIPTION_MAX_BYTES, YOUTUBE_TITLE_MAX_CHARS, YOUTUBE_UPLOAD_COPY,
  youtubeChoiceHint, youtubeDescriptionBytes, youtubeDescriptionProblem, youtubeFieldId, youtubeNotLinkedNote,
  youtubeOptions, youtubeSyntheticMedia, youtubeTitleLength, youtubeTitleProblem,
  type YouTubeUploadForm,
} from './youtubeVisibility';

type YouTubeSource = Pick<OperatorApproval, 'params'>
  & Partial<Pick<OperatorApproval, 'toolName' | 'targets' | 'goesToTikTok' | 'youtube'>>;

/**
 * "Post to YouTube" on an approval that uploads to YouTube: exactly what
 * YouTube will get, before the owner approves it (YouTube API Services
 * Developer Policies III.C.3 and III.E):
 *  - the title and the description, in fields the owner edits, each with its
 *    counter (100 characters; 5,000 bytes, as YouTube counts them) and, under
 *    it, what YouTube would refuse ("<" or ">", an empty title, over a limit).
 *    Nothing is cut or changed for the owner, and no length limit is set on
 *    the field itself (a pasted text is never shortened): the card says what
 *    is wrong and Approve waits. Both fields wrap and grow with their text,
 *    so the whole title and description can be read, on a phone too;
 *  - who can see it (YouTubeVisibilityChoice) and whether it is made for
 *    kids, both required, nothing chosen until the owner chooses;
 *  - for a video WPMaven made with AI, that YouTube will show it as altered
 *    or synthetic content.
 * The rules are in ./youtubeVisibility.ts; the card around it keeps the form
 * and sends it with the approve, exactly as it shows.
 *
 * Inline styles on the design tokens, so it reads the same inside Waiting for
 * you and inside Your team > Approvals. Only the account's card draws it: a
 * site's card says the upload is approved in the dashboard (ApprovalCard).
 */
export const YouTubeUploadSection: React.FC<{
  /** The section's id (youtubeChoiceId): a refusal or a checklist item brings the owner here. */
  id: string;
  approval: YouTubeSource;
  form: YouTubeUploadForm;
  onChange: (patch: Partial<YouTubeUploadForm>) => void;
  /** Staff viewing as the owner: shown, not changeable. */
  disabled?: boolean;
  /** The API asked for it (YOUTUBE_PRIVACY_REQUIRED): what is missing is outlined. */
  highlight?: boolean;
}> = ({ id, approval, form, onChange, disabled = false, highlight = false }) => {
  const c = YOUTUBE_UPLOAD_COPY;
  const titleId = youtubeFieldId(id, 'title');
  const descriptionId = youtubeFieldId(id, 'description');
  const kidsId = youtubeFieldId(id, 'madeForKids');
  const titleProblem = youtubeTitleProblem(form.title);
  const descriptionProblem = youtubeDescriptionProblem(form.description);
  const titleChars = youtubeTitleLength(form.title);
  const descriptionBytes = youtubeDescriptionBytes(form.description);
  const kidsWanted = highlight && form.madeForKids === null;
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  useGrowWithText(titleRef, form.title, 160);
  useGrowWithText(descriptionRef, form.description, 360);
  return (
    <section
      id={id}
      tabIndex={-1}
      data-testid="yt-post"
      aria-labelledby={`${id}-heading`}
      style={{
        display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, scrollMarginTop: 16, outline: 'none',
        padding: 12, borderRadius: 10, border: '1px solid var(--glass-border)',
      }}
    >
      <div>
        <h3 id={`${id}-heading`} style={{ margin: 0, fontSize: 'var(--text-body, 14px)', fontWeight: 600, color: 'var(--text)' }}>
          {c.heading}
        </h3>
        <p style={{ margin: '2px 0 0', fontSize: 'var(--text-data, 13px)', lineHeight: 1.4, color: 'var(--text-dim)' }}>
          {c.intro}
        </p>
      </div>

      <div>
        <label htmlFor={titleId} style={LABEL}>{c.titleLabel}</label>
        {/* A title is one line: Enter adds no line break (a pasted one is
            kept and said under the field, never taken out for the owner). */}
        <textarea
          ref={titleRef}
          id={titleId}
          rows={1}
          value={form.title}
          disabled={disabled}
          aria-invalid={!!titleProblem}
          aria-describedby={`${titleId}-help`}
          onChange={(e) => onChange({ title: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
          data-testid="yt-title"
          style={{ ...field(!!titleProblem), resize: 'none' }}
        />
        <div id={`${titleId}-help`} style={UNDER}>
          <span aria-live="polite" data-testid="yt-title-note" style={titleProblem ? PROBLEM : DIM}>
            {titleProblem ?? c.titleHelper}
          </span>
          <span data-testid="yt-title-count" style={{ ...(titleChars > YOUTUBE_TITLE_MAX_CHARS ? PROBLEM : DIM), whiteSpace: 'nowrap' }}>
            {titleChars}/{YOUTUBE_TITLE_MAX_CHARS}
          </span>
        </div>
      </div>

      <div>
        <label htmlFor={descriptionId} style={LABEL}>{c.descriptionLabel}</label>
        <textarea
          ref={descriptionRef}
          id={descriptionId}
          rows={6}
          value={form.description}
          disabled={disabled}
          aria-invalid={!!descriptionProblem}
          aria-describedby={`${descriptionId}-help`}
          onChange={(e) => onChange({ description: e.target.value })}
          data-testid="yt-description"
          style={{ ...field(!!descriptionProblem), resize: 'vertical' }}
        />
        <div id={`${descriptionId}-help`} style={UNDER}>
          <span aria-live="polite" data-testid="yt-description-note" style={descriptionProblem ? PROBLEM : DIM}>
            {descriptionProblem ?? c.descriptionHelper}
          </span>
          <span
            data-testid="yt-description-count"
            style={{ ...(descriptionBytes > YOUTUBE_DESCRIPTION_MAX_BYTES ? PROBLEM : DIM), whiteSpace: 'nowrap' }}
          >
            {descriptionBytes.toLocaleString('en-US')}/{YOUTUBE_DESCRIPTION_MAX_BYTES.toLocaleString('en-US')} bytes
          </span>
        </div>
      </div>

      <YouTubeVisibilityChoice
        id={youtubeFieldId(id, 'privacy')}
        options={youtubeOptions(approval)}
        value={form.privacy}
        disabled={disabled}
        highlight={highlight}
        hint={youtubeChoiceHint(approval)}
        note={youtubeNotLinkedNote(approval, form.privacy)}
        onChange={(privacy) => onChange({ privacy })}
      />

      <fieldset
        id={kidsId}
        tabIndex={-1}
        data-testid="yt-kids"
        data-chosen={form.madeForKids === null ? '' : String(form.madeForKids)}
        aria-describedby={`${kidsId}-help`}
        style={{
          margin: 0, padding: '10px 12px', borderRadius: 10, minWidth: 0, scrollMarginTop: 16, outline: 'none',
          border: `1px solid ${kidsWanted ? 'color-mix(in srgb, var(--peach) 70%, transparent)' : 'var(--glass-border)'}`,
          background: kidsWanted ? 'color-mix(in srgb, var(--peach) 10%, transparent)' : undefined,
        }}
      >
        <legend style={{ padding: '0 4px', fontSize: 'var(--text-body, 14px)', fontWeight: 600, color: 'var(--text)' }}>
          {c.kidsQuestion}
        </legend>
        <div role="radiogroup" aria-required="true" aria-label={c.kidsQuestion} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {([[true, c.kidsYes, 'yes'], [false, c.kidsNo, 'no']] as const).map(([value, label, key]) => (
            <label
              key={key}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, minHeight: 32,
                cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
                fontSize: 'var(--text-data, 13px)', color: 'var(--text)',
              }}
            >
              <input
                type="radio"
                name={`${kidsId}-answer`}
                value={key}
                checked={form.madeForKids === value}
                disabled={disabled}
                required
                onChange={() => onChange({ madeForKids: value })}
                data-testid={`yt-kids-${key}`}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p id={`${kidsId}-help`} style={{ margin: '6px 0 0', fontSize: 'var(--text-data, 13px)', lineHeight: 1.4, color: 'var(--text-dim)' }}>
          {c.kidsHelper}
        </p>
      </fieldset>

      {youtubeSyntheticMedia(approval) && (
        <p role="note" data-testid="yt-ai" style={{ margin: 0, fontSize: 'var(--text-data, 13px)', lineHeight: 1.4, color: 'var(--text)' }}>
          {c.aiDisclosure}
        </p>
      )}
    </section>
  );
};

/**
 * A text field as tall as its text, up to `maxPx` (then it scrolls), so the
 * owner reads all of what YouTube will get without scrolling inside a box.
 */
function useGrowWithText(ref: React.RefObject<HTMLTextAreaElement | null>, value: string, maxPx: number): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      el.style.height = 'auto';
      const wanted = el.scrollHeight + 2;
      el.style.height = `${Math.min(wanted, maxPx)}px`;
      el.style.overflowY = wanted > maxPx ? 'auto' : 'hidden';
    };
    fit();
    // A phone turned sideways rewraps the text.
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [ref, value, maxPx]);
}

const LABEL: React.CSSProperties = {
  display: 'block', marginBottom: 4, fontSize: 'var(--text-data, 13px)', fontWeight: 600, color: 'var(--text)',
};
const UNDER: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginTop: 4,
  fontSize: 12, lineHeight: 1.4,
};
const DIM: React.CSSProperties = { color: 'var(--text-dim)' };
const PROBLEM: React.CSSProperties = { color: 'var(--danger)' };

/**
 * A field shows its characters as they are: the font's ligatures and
 * contextual alternates are off, or Inter draws "->" as one arrow and the
 * owner could not see the ">" the card says YouTube refuses.
 */
function field(problem: boolean): React.CSSProperties {
  return {
    width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 8, scrollMarginTop: 16,
    border: `1px solid ${problem ? 'var(--danger)' : 'var(--glass-border)'}`,
    background: 'var(--bg-raised)', color: 'var(--text)',
    fontSize: 'var(--text-data, 13px)', fontFamily: 'inherit', lineHeight: 1.45,
    fontVariantLigatures: 'none', fontFeatureSettings: '"calt" 0, "liga" 0',
  };
}

export default YouTubeUploadSection;
