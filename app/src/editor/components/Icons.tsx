import React from 'react';

interface IconProps {
	size?: number;
	color?: string;
	style?: React.CSSProperties;
}

function svg(props: IconProps, children: React.ReactNode) {
	const { size = 16, color = 'currentColor', style } = props;
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke={color}
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			style={{ display: 'inline-block', verticalAlign: 'middle', ...style }}
		>
			{children}
		</svg>
	);
}

export function SparklesIcon(props: IconProps) {
	return svg(props, <>
		<path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z" />
		<path d="M5 3v4" /><path d="M3 5h4" />
		<path d="M19 17v4" /><path d="M17 19h4" />
	</>);
}

export function ArrowLeftIcon(props: IconProps) {
	return svg(props, <>
		<path d="M19 12H5" />
		<path d="M12 19l-7-7 7-7" />
	</>);
}

export function XIcon(props: IconProps) {
	return svg(props, <>
		<path d="M18 6L6 18" />
		<path d="M6 6l12 12" />
	</>);
}

export function UndoIcon(props: IconProps) {
	return svg(props, <>
		<path d="M3 7v6h6" />
		<path d="M21 17a9 9 0 00-9-9 9 9 0 00-6.69 3L3 13" />
	</>);
}

export function MonitorIcon(props: IconProps) {
	return svg(props, <>
		<rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
		<path d="M8 21h8" /><path d="M12 17v4" />
	</>);
}

export function TabletIcon(props: IconProps) {
	return svg(props, <>
		<rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
		<path d="M12 18h.01" />
	</>);
}

export function SmartphoneIcon(props: IconProps) {
	return svg(props, <>
		<rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
		<path d="M12 18h.01" />
	</>);
}

export function ChevronDownIcon(props: IconProps) {
	return svg(props, <path d="M6 9l6 6 6-6" />);
}

export function CheckCircleIcon(props: IconProps) {
	return svg(props, <>
		<path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
		<path d="M22 4L12 14.01l-3-3" />
	</>);
}

export function AlertTriangleIcon(props: IconProps) {
	return svg(props, <>
		<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
		<path d="M12 9v4" /><path d="M12 17h.01" />
	</>);
}

export function RefreshCwIcon(props: IconProps) {
	return svg(props, <>
		<path d="M21 2v6h-6" />
		<path d="M3 12a9 9 0 0115-6.7L21 8" />
		<path d="M3 22v-6h6" />
		<path d="M21 12a9 9 0 01-15 6.7L3 16" />
	</>);
}

export function SendIcon(props: IconProps) {
	return svg(props, <>
		<path d="M22 2L11 13" />
		<path d="M22 2l-7 20-4-9-9-4 20-7z" />
	</>);
}

export function FileTextIcon(props: IconProps) {
	return svg(props, <>
		<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
		<path d="M14 2v6h6" />
		<path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" />
	</>);
}

export function PaletteIcon(props: IconProps) {
	return svg(props, <>
		<circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
		<circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
		<circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
		<circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
		<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
	</>);
}

export function SearchIcon(props: IconProps) {
	return svg(props, <>
		<circle cx="11" cy="11" r="8" />
		<path d="M21 21l-4.35-4.35" />
	</>);
}

export function SettingsIcon(props: IconProps) {
	return svg(props, <>
		<circle cx="12" cy="12" r="3" />
		<path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
	</>);
}

export function InfoIcon(props: IconProps) {
	return svg(props, <>
		<circle cx="12" cy="12" r="10" />
		<line x1="12" y1="16" x2="12" y2="12" />
		<line x1="12" y1="8" x2="12.01" y2="8" />
	</>);
}

export function MessageIcon(props: IconProps) {
	return svg(props, <>
		<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
	</>);
}
