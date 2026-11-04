import React from 'react';
import { stageBox, type IframeOffset } from '../components/SiteIframe';
import { KIND_COLORS, kindWord, type BindingHover, type BindingSelection, type FrameRect } from './bindings';

/**
 * Labelled outlines over the site frame: a dashed one for what a click
 * would select, a solid one for the selection. Each kind has its color
 * (sections, header and footer, cards, menu items, facts, images).
 */
export function BindingOverlay({
  hovered, selected, offset,
}: {
  hovered: BindingHover | null;
  selected: BindingSelection | null;
  offset: IframeOffset;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: offset.top,
        left: offset.left,
        width: offset.width || '100%',
        height: offset.height || '100%',
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 100,
      }}
    >
      {hovered && (!selected || hovered.uid !== selected.uid) && (
        <Outline rect={stageBox(hovered.rect, offset.scale)} color={KIND_COLORS[hovered.kind]} label={`${kindWord(hovered)}${hovered.label ? ` · ${hovered.label}` : ''}`} dashed />
      )}
      {selected && (
        <Outline rect={stageBox(selected.rect, offset.scale)} color={KIND_COLORS[selected.kind]} label={`${kindWord(selected)}${selected.label ? ` · ${selected.label}` : ''}`} />
      )}
    </div>
  );
}

function Outline({ rect, color, label, dashed = false }: { rect: FrameRect; color: string; label: string; dashed?: boolean }) {
  const labelAbove = rect.top >= 22;
  return (
    <div
      style={{
        position: 'absolute',
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        border: `${dashed ? 1 : 2}px ${dashed ? 'dashed' : 'solid'} ${color}`,
        borderRadius: 3,
        background: dashed ? 'transparent' : `color-mix(in srgb, ${color} 7%, transparent)`,
        transition: 'all .12s ease-out',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: labelAbove ? -21 : 2,
          left: labelAbove ? -1 : 2,
          maxWidth: 'min(360px, 90vw)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          padding: '2px 8px',
          borderRadius: labelAbove ? '4px 4px 0 0' : 4,
          background: dashed ? `color-mix(in srgb, ${color} 14%, var(--bg))` : color,
          color: dashed ? color : '#fff',
          font: `600 11px "DM Sans", sans-serif`,
        }}
      >
        {label}
      </span>
    </div>
  );
}
