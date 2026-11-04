import React, { useCallback, useRef, useEffect, useLayoutEffect, useState } from 'react';
import type { EditView } from '../../types/edits';

export type ViewportMode = 'desktop' | 'tablet' | 'mobile';

/**
 * The width each view lays the page out at (2026-10-17). The desktop's is a
 * floor: the smallest desktop screen, so the site always shows its desktop
 * layout there, and the zone's own width once it is wider.
 */
export const VIEWPORT_WIDTHS: Record<ViewportMode, number> = {
	desktop: 1280,
	tablet: 768,
	// The width the checks of every preview measure phones at.
	mobile: 390,
};

/** How far Ctrl + wheel zooms: a quarter of the page's size up to twice it. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;

/** The tablet and phone views' room around the frame. */
const FRAME_GUTTER = 16;

/** The size line under the frame. */
const SIZE_LINE: React.CSSProperties = {
	position: 'absolute',
	bottom: 8,
	left: '50%',
	transform: 'translateX(-50%)',
	background: 'rgba(30,41,59,0.75)',
	color: 'var(--glass-border)',
	fontSize: 11,
	lineHeight: 1.4,
	padding: '3px 10px',
	borderRadius: 12,
	fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
	whiteSpace: 'nowrap',
};

export interface IframeOffset {
	top: number;
	left: number;
	/** The frame as drawn on the stage (after its scale). */
	width: number;
	height: number;
	/**
	 * How much the page is scaled on the stage: below 1 when it is laid out
	 * wider than the zone (or zoomed out), above when zoomed in. The frame's
	 * own coordinates (an element's rect) times this are the stage's.
	 */
	scale?: number;
}

/** A box in the frame's coordinates, in the stage's (its position and size times the frame's scale). */
export function stageBox<T extends { top: number; left: number; width: number; height: number }>(box: T, scale = 1): T {
	if (scale === 1) return box;
	const out = { ...box, top: box.top * scale, left: box.left * scale, width: box.width * scale, height: box.height * scale };
	const edges = box as T & { bottom?: unknown; right?: unknown };
	if (typeof edges.bottom === 'number') (out as typeof out & { bottom: number }).bottom = edges.bottom * scale;
	if (typeof edges.right === 'number') (out as typeof out & { right: number }).right = edges.right * scale;
	return out;
}

/**
 * The page's layout width and its fitted scale in a zone of `zoneWidth`
 * pixels (the room the view leaves for the frame). Pure.
 *
 * The page is laid out at its view's width, never at a narrower zone's, so
 * a small zone never turns the desktop into the site's phone layout: it is
 * scaled down instead, its whole width in view. The desktop takes the
 * zone's width once the zone is wider than its floor.
 */
export function frameFit(viewport: ViewportMode, zoneWidth: number): { width: number; scale: number } {
	const target = VIEWPORT_WIDTHS[viewport];
	const width = viewport === 'desktop' ? Math.max(target, zoneWidth) : target;
	const scale = zoneWidth > 0 ? Math.min(1, zoneWidth / width) : 1;
	return { width, scale };
}

/**
 * The view the owner looks at, as the chat and the edits read it
 * (2026-10-17): its mode and the width its page is laid out at, the
 * desktop's the zone's once wider than its floor (from the frame as drawn,
 * divided by its scale, so a zoom changes nothing). Pure.
 */
export function viewOf(viewport: ViewportMode, offset?: Pick<IframeOffset, 'width' | 'scale'> | null): EditView {
	const floor = VIEWPORT_WIDTHS[viewport];
	if (viewport !== 'desktop' || !offset || !(offset.width > 0)) return { mode: viewport, width: floor };
	return { mode: viewport, width: Math.max(floor, Math.round(offset.width / (offset.scale || 1))) };
}

/** The zoom after one Ctrl + wheel step from `current`, within the limits. Pure. */
export function zoomStep(current: number, deltaY: number): number {
	// Exponential, so a trackpad's pinch (many small deltas) and a mouse's
	// notches (a few large ones) zoom alike.
	const next = current * Math.exp(-deltaY * 0.0015);
	return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}

interface SiteIframeProps {
	src: string;
	setIframeRef: (el: HTMLIFrameElement | null) => void;
	onLoad?: () => void;
	onOffsetChange?: (offset: IframeOffset) => void;
	viewport?: ViewportMode;
}

/**
 * Renders the live WordPress frontend in an iframe, at a fixed scale.
 *
 * The page is laid out at its view's width (the desktop's at least 1280px,
 * a tablet's 768, a phone's 390) and scaled to fit the zone's width, so the
 * desktop stays the desktop on a small screen (2026-10-17). Ctrl + wheel
 * (a trackpad's pinch) zooms in and out, over the page too; the size line
 * at the bottom says the scale and brings the fit back.
 *
 * Reports its position and scale within the container, so overlays drawn
 * over it (outlines, the editor's window) land on the element.
 */
export function SiteIframe({ src, setIframeRef, onLoad, onOffsetChange, viewport = 'desktop' }: SiteIframeProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const localIframeRef = useRef<HTMLIFrameElement | null>(null);
	const [zone, setZone] = useState({ width: 0, height: 0 });
	// The owner's own zoom (Ctrl + wheel); null keeps the page fitted to the zone.
	const [zoom, setZoom] = useState<number | null>(null);

	const isResponsive = viewport !== 'desktop';
	const gutter = isResponsive ? FRAME_GUTTER : 0;
	const room = { width: Math.max(0, zone.width - 2 * gutter), height: Math.max(0, zone.height - 2 * gutter) };
	const fit = frameFit(viewport, room.width);
	const scale = zoom ?? fit.scale;
	// The page's own height: the zone's, in the page's pixels.
	const frameHeight = scale > 0 ? room.height / scale : room.height;

	// A new view starts fitted.
	useEffect(() => setZoom(null), [viewport]);

	const handleRef = useCallback(
		(el: HTMLIFrameElement | null) => {
			localIframeRef.current = el;
			setIframeRef(el);
		},
		[setIframeRef]
	);

	// The zone's size, as it changes (the window, the panels beside it).
	useLayoutEffect(() => {
		const el = containerRef.current;
		if (!el) return undefined;
		const measure = () => setZone({ width: el.clientWidth, height: el.clientHeight });
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	// Ctrl + wheel zooms, over the stage and over the page itself (the frame
	// is the site's own origin; a frame from elsewhere keeps its own wheel).
	const scaleRef = useRef(scale);
	scaleRef.current = scale;
	const onZoomWheel = useCallback((e: WheelEvent) => {
		if (!e.ctrlKey) return;
		e.preventDefault();
		setZoom(zoomStep(scaleRef.current, e.deltaY));
	}, []);
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return undefined;
		el.addEventListener('wheel', onZoomWheel, { passive: false });
		return () => el.removeEventListener('wheel', onZoomWheel);
	}, [onZoomWheel]);
	const frameWindowRef = useRef<Window | null>(null);
	const detachFrameWheel = useCallback(() => {
		try {
			frameWindowRef.current?.removeEventListener('wheel', onZoomWheel);
		} catch {
			// The frame went away or changed origin: nothing to detach.
		}
		frameWindowRef.current = null;
	}, [onZoomWheel]);
	const handleLoad = useCallback(() => {
		detachFrameWheel();
		try {
			const win = localIframeRef.current?.contentWindow ?? null;
			win?.addEventListener('wheel', onZoomWheel, { passive: false });
			frameWindowRef.current = win;
		} catch {
			// Another origin: the browser's own zoom stays.
		}
		onLoad?.();
	}, [detachFrameWheel, onZoomWheel, onLoad]);
	useEffect(() => detachFrameWheel, [detachFrameWheel]);

	// Measure and report the frame's offset and scale whenever the view, the
	// size or the zoom changes, and as a zoomed-in page scrolls sideways.
	useEffect(() => {
		function measureOffset() {
			if (!localIframeRef.current || !containerRef.current || !onOffsetChange) return;
			const containerRect = containerRef.current.getBoundingClientRect();
			const iframeRect = localIframeRef.current.getBoundingClientRect();
			onOffsetChange({
				top: iframeRect.top - containerRect.top,
				left: iframeRect.left - containerRect.left,
				width: iframeRect.width,
				height: iframeRect.height,
				scale,
			});
		}

		measureOffset();

		// Re-measure on resize: the container (the window), and the frame
		// itself, which narrows to a tablet or a phone over 0.3s and is then
		// centred. Measured only when the view changed, the outline of a
		// selected element stayed where the desktop frame was.
		const observer = new ResizeObserver(measureOffset);
		const container = containerRef.current;
		if (container) {
			observer.observe(container);
			container.addEventListener('scroll', measureOffset, { passive: true });
		}
		if (localIframeRef.current) {
			observer.observe(localIframeRef.current);
		}

		return () => {
			observer.disconnect();
			container?.removeEventListener('scroll', measureOffset);
		};
	}, [viewport, onOffsetChange, scale, fit.width, frameHeight]);

	const drawnWidth = fit.width * scale;
	const drawnHeight = frameHeight * scale;
	const zoomed = zoom !== null;
	const percent = Math.round(scale * 100);
	const viewName = viewport === 'desktop' ? 'Desktop' : viewport === 'tablet' ? 'Tablet' : 'Phone';

	return (
		<div
			ref={containerRef}
			data-testid="editor-stage"
			style={{
				width: '100%',
				height: '100%',
				display: 'flex',
				// Centred while it fits; from the left edge once zoomed wider, so it scrolls.
				justifyContent: drawnWidth > room.width + 1 ? 'flex-start' : 'center',
				alignItems: 'flex-start',
				background: isResponsive ? 'var(--bg)' : 'transparent',
				overflowX: drawnWidth > room.width + 1 ? 'auto' : 'hidden',
				overflowY: 'hidden',
				padding: gutter,
				boxSizing: 'border-box',
				position: 'relative',
			}}
		>
			{/* The frame as drawn: the page's size times its scale. */}
			<div
				style={{
					flex: 'none',
					width: drawnWidth,
					height: drawnHeight,
					borderRadius: isResponsive ? 12 : 0,
					overflow: 'hidden',
					boxShadow: isResponsive ? '0 4px 24px rgba(0,0,0,0.12)' : 'none',
					border: isResponsive ? '1px solid var(--glass-border)' : 'none',
					boxSizing: 'content-box',
					position: 'relative',
				}}
			>
				{/* The page at its own width, scaled from the top left corner. */}
				<div
					style={{
						position: 'absolute',
						top: 0,
						left: 0,
						width: fit.width,
						height: frameHeight,
						transform: scale === 1 ? undefined : `scale(${scale})`,
						transformOrigin: '0 0',
					}}
				>
					<iframe
						data-testid="editor-frame"
						ref={handleRef}
						src={src}
						onLoad={handleLoad}
						style={{
							width: '100%',
							height: '100%',
							border: 'none',
							display: 'block',
						}}
						title="Site preview"
					/>
				</div>
			</div>
			{/* The size line: the view, its width and the scale. Zoomed by
			    hand, it is a button that fits the page again. */}
			{(isResponsive || scale !== 1) && (zoomed ? (
				<button
					type="button"
					data-testid="editor-frame-size"
					onClick={() => setZoom(null)}
					title="Fit the page to the space"
					aria-label={`${viewName} ${fit.width}px at ${percent}%. Fit the page to the space`}
					style={{ ...SIZE_LINE, border: 'none', margin: 0, cursor: 'pointer' }}
				>
					{viewName} ({fit.width}px) · {percent}% · Fit
				</button>
			) : (
				<div data-testid="editor-frame-size" title="Ctrl + wheel to zoom" style={{ ...SIZE_LINE, pointerEvents: 'none' }}>
					{viewName} ({fit.width}px){scale !== 1 ? ` · ${percent}%` : ''}
				</div>
			))}
		</div>
	);
}
