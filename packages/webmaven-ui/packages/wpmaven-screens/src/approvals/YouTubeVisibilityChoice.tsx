import React from 'react';
import type { YouTubePrivacy } from './types';
import { YOUTUBE_VISIBILITY_COPY, type YouTubeOption } from './youtubeVisibility';

/**
 * "Who can see this video on YouTube?" on an approval that uploads to
 * YouTube: Public, Unlisted and Private as one required radio group, each
 * with its line, nothing chosen until the owner chooses (what they asked for
 * before is a hint line above the choices, never a preselection), and next
 * to it what Unlisted or Private means for the other networks. Part of the
 * card's "Post to YouTube" section (YouTubeUploadSection.tsx), which asks
 * whether it is made for kids right under it. The rules are in
 * ./youtubeVisibility.ts; the card around it keeps the answer and disables
 * Approve until there is one.
 *
 * Inline styles on the design tokens, so it reads the same inside Waiting for
 * you and inside Your team > Approvals, in the dashboard and the plugin.
 */
export const YouTubeVisibilityChoice: React.FC<{
  /** The group's id: a refusal or a checklist item brings the owner here. */
  id: string;
  options: YouTubeOption[];
  value: YouTubePrivacy | null;
  onChange: (value: YouTubePrivacy) => void;
  /** Staff viewing as the owner: shown, not changeable. */
  disabled?: boolean;
  /** The API asked for it (YOUTUBE_PRIVACY_REQUIRED): outlined until chosen. */
  highlight?: boolean;
  /** What the owner asked for before (youtubeChoiceHint), shown above the choices. Never selects anything. */
  hint?: string | null;
  /** Next to the choice: what it means for the other networks (youtubeNotLinkedNote), or null. */
  note?: string | null;
}> = ({ id, options, value, onChange, disabled = false, highlight = false, hint = null, note = null }) => {
  const c = YOUTUBE_VISIBILITY_COPY;
  const wanted = highlight && !value;
  const describedBy = [hint ? `${id}-hint` : null, note ? `${id}-links` : null].filter(Boolean).join(' ');
  return (
    <fieldset
      id={id}
      tabIndex={-1}
      data-testid="yt-visibility"
      data-chosen={value ?? ''}
      aria-describedby={describedBy || undefined}
      style={{
        margin: 0, padding: '10px 12px', borderRadius: 10, minWidth: 0, scrollMarginTop: 16, outline: 'none',
        border: `1px solid ${wanted ? 'color-mix(in srgb, var(--peach) 70%, transparent)' : 'var(--glass-border)'}`,
        background: wanted ? 'color-mix(in srgb, var(--peach) 10%, transparent)' : undefined,
      }}
    >
      <legend style={{ padding: '0 4px', fontSize: 'var(--text-body, 14px)', fontWeight: 600, color: 'var(--text)' }}>
        {c.question}
      </legend>
      {hint && (
        <p id={`${id}-hint`} data-testid="yt-hint" style={{ margin: '0 0 4px', fontSize: 'var(--text-data, 13px)', lineHeight: 1.4, color: 'var(--text-dim)' }}>
          {hint}
        </p>
      )}
      <div role="radiogroup" aria-required="true" aria-label={c.question} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {options.map((o) => (
          <label
            key={o.value}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, minHeight: 32,
              cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
              fontSize: 'var(--text-data, 13px)', color: 'var(--text)',
            }}
          >
            <input
              type="radio"
              name={`${id}-privacy`}
              value={o.value}
              checked={value === o.value}
              disabled={disabled}
              required
              onChange={() => onChange(o.value)}
              data-testid={`yt-visibility-${o.value}`}
            />
            <span>
              <strong style={{ fontWeight: 600 }}>{o.label}</strong>
              {o.line.slice(o.label.length)}
            </span>
          </label>
        ))}
      </div>
      {/* Said as the choice changes, right under it. */}
      <div aria-live="polite">
        {note && (
          <p id={`${id}-links`} role="note" data-testid="yt-not-linked" style={{ margin: '6px 0 0', fontSize: 'var(--text-data, 13px)', lineHeight: 1.4, color: 'var(--text)' }}>
            {note}
          </p>
        )}
      </div>
    </fieldset>
  );
};

export default YouTubeVisibilityChoice;
