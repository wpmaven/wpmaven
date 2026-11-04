import React from 'react';
import { elementColor, elementTitle, type HoverElement, type ElementSelection } from './elementEdit';
import { stageBox } from '../components/SiteIframe';
import { HOVER_TAG_HEIGHT, SELECTED_TAG_HEIGHT, tagPlacement } from './placement';
import { WINDOW_WORDS } from './labels';

interface OverlayLayerProps {
	hovered: HoverElement | null;
	selected: ElementSelection | null;
	/** The frame on the stage, and its scale (an element's rect is in the frame's own pixels). */
	iframeOffset: { top: number; left: number; scale?: number };
	isEditing?: boolean;
	/** WPMaven works on the selection: its glass shows instead of the outline. */
	working?: boolean;
}

/**
 * Renders hover highlights and selection outlines over the iframe.
 * Positioned absolutely to overlay the iframe area.
 */
export function OverlayLayer({ hovered: hoveredInFrame, selected: selectedInFrame, iframeOffset, isEditing, working }: OverlayLayerProps) {
	// The boxes on the stage: the frame's own pixels times its scale.
	const hovered = hoveredInFrame && { ...hoveredInFrame, rect: stageBox(hoveredInFrame.rect, iframeOffset.scale) };
	const selected = selectedInFrame && { ...selectedInFrame, rect: stageBox(selectedInFrame.rect, iframeOffset.scale) };
	return (
		<div
			style={{
				position: 'absolute',
				top: iframeOffset.top,
				left: iframeOffset.left,
				right: 0,
				bottom: 0,
				pointerEvents: 'none',
				zIndex: 100,
			}}
		>
			{/* Hover highlight */}
			{hovered && (!selected || hovered.uid !== selected.uid) && (() => {
				const badge = tagPlacement(hovered.rect, HOVER_TAG_HEIGHT, window.innerWidth);
				const color = elementColor(hovered);
				return (
				<div
					data-testid="editor-hover-outline"
					style={{
						position: 'absolute',
						top: hovered.rect.top,
						left: hovered.rect.left,
						width: hovered.rect.width,
						height: hovered.rect.height,
						border: `1px dashed ${color}`,
						borderRadius: 3,
						pointerEvents: 'none',
						transition: 'all 0.12s ease-out',
					}}
				>
					<span
						style={{
							position: 'absolute',
							top: badge.top,
							left: badge.left,
							right: badge.right,
							background: `color-mix(in srgb, ${color} 12%, transparent)`,
							color,
							fontSize: 10,
							fontWeight: 500,
							padding: '2px 6px',
							borderRadius: badge.radius,
							whiteSpace: 'nowrap',
							fontFamily: '"DM Sans", sans-serif',
							transition: 'all 0.12s ease-out',
						}}
					>
						{elementTitle(hovered)}
						{/* A part printed on more than one page (2026-10-19): the outline keeps its family's colour, the chip is the mark. */}
						{hovered.template && <span data-testid="editor-hover-template" style={{ marginLeft: 4, padding: '0 5px', borderRadius: 999, border: `1px solid ${color}`, fontWeight: 600 }}>{WINDOW_WORDS.template}</span>}
						{hovered.live && <span style={{ opacity: 0.8, marginLeft: 4 }}>live</span>}
					</span>
				</div>
				);
			})()}

			{/* Selection outline */}
			{selected && !working && (() => {
				const badge = tagPlacement(selected.rect, SELECTED_TAG_HEIGHT, window.innerWidth);
				const color = elementColor(selected);
				return (
				<div
					data-testid="editor-selected-outline"
					style={{
						position: 'absolute',
						top: selected.rect.top,
						left: selected.rect.left,
						width: selected.rect.width,
						height: selected.rect.height,
						border: `2px solid ${color}`,
						borderRadius: 3,
						background: isEditing ? 'transparent' : `color-mix(in srgb, ${color} 12%, transparent)`,
						pointerEvents: 'none',
						transition: 'all 0.15s ease-out',
					}}
				>
					<span
						style={{
							position: 'absolute',
							top: badge.top,
							left: badge.left,
							right: badge.right,
							background: color,
							color: 'var(--text-bright)',
							fontSize: 11,
							fontWeight: 600,
							padding: '3px 10px',
							borderRadius: badge.radius,
							whiteSpace: 'nowrap',
							fontFamily: '"DM Sans", sans-serif',
							display: 'flex',
							alignItems: 'center',
							gap: 4,
							transition: 'all 0.15s ease-out',
						}}
					>
						{elementTitle(selected)}
						{selected.template && (
							<span data-testid="editor-selected-template" style={{ padding: '0 6px', borderRadius: 999, border: '1px solid var(--text-bright)', fontSize: 10 }}>
								{WINDOW_WORDS.template}
							</span>
						)}
						{selected.live && !isEditing && (
							<span style={{ opacity: 0.8, fontSize: 10 }}>
								live
							</span>
						)}
						{isEditing && (
							<span style={{ opacity: 0.8, fontSize: 10 }}>
								editing
							</span>
						)}
					</span>
				</div>
				);
			})()}
		</div>
	);
}
