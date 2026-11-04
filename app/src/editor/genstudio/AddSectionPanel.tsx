import React, { useMemo, useState } from 'react';
import { nameOr } from '../../utils/brand';
import { KIND_COLORS, pageFor, placeTitle } from './bindings';
import { useFrameFollows, type EditorEnv } from './env';
import { PanelFrame, PreviewFlow, Thumbnails } from './ui';
import { useEditOperation } from './useEditOperation';

/** A new section on a page, written in the site's own style from an instruction. */
export function AddSectionPanel({ env, page, afterSectionId }: { env: EditorEnv; page: string; afterSectionId: string | null }) {
  const flow = useEditOperation();
  useFrameFollows(flow, env, page);
  const [instruction, setInstruction] = useState('');
  const [after, setAfter] = useState<string>(afterSectionId ?? '');
  const pageTitle = placeTitle(env.siteMap, page);
  const busy = flow.state.phase === 'previewing' || flow.state.phase === 'publishing';

  // The page's sections, from the site map, else from the frame.
  const sections = useMemo(() => {
    const fromMap = pageFor(env.siteMap, page)?.sections ?? [];
    if (fromMap.length) return fromMap.map((s) => ({ id: s.id, label: s.label }));
    return env.outline.filter((o) => o.page === page || !o.page).map((o) => ({ id: o.sectionId, label: o.label }));
  }, [env.siteMap, env.outline, page]);

  return (
    <PanelFrame
      chip="New section"
      color={KIND_COLORS.section}
      title={`Add a section to ${pageTitle}`}
      onClose={env.closePanel}
      footer={(
        <PreviewFlow
          versionable={flow.state.operation?.op === 'add_section'}
          flow={flow}
          canPreview={instruction.trim().length >= 3}
          onPreview={(refine) => {
            void flow.preview({ op: 'add_section', page, afterSectionId: after || null, instruction: instruction.trim(), view: env.view }, { refine });
          }}
          workingText="Writing the new section. This can take up to a minute."
          phoneFirst={env.viewport === 'mobile'}
          onUndo={env.undo}
          onDone={env.closePanel}
        />
      )}
    >
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-where">Where</label>
        <select id="wme-gs-where" className="wme-gs-select wm-select" value={after} onChange={(e) => setAfter(e.target.value)} disabled={busy}>
          <option value="">At the top of the page</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>After {'“'}{s.label}{'”'}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-new-section">What should it say and do?</label>
        <textarea
          id="wme-gs-new-section"
          data-testid="editor-instruction"
          className="wme-gs-textarea"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="For example: a short FAQ with delivery times, returns and how to reach us"
          disabled={busy}
          maxLength={2000}
        />
        <p className="wme-gs-hint" style={{ marginTop: 6 }}>{nameOr('AI')} writes it in your site{'’'}s style and keeps your business details as they are.</p>
      </div>
      <Thumbnails result={flow.state.preview} phone={env.viewport === 'mobile'} />
    </PanelFrame>
  );
}
