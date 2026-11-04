import React from 'react';

/**
 * The outline icons a receipt draws (Heroicons v2, MIT), the same glyphs the
 * dashboard drew with @heroicons/react, inline so the plugin needs no icon
 * package for them.
 */
function outline(d: string, name: string) {
  const Icon = ({ size = 20 }: { size?: number }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden="true"
      width={size}
      height={size}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
  Icon.displayName = name;
  return Icon;
}

export const CheckCircleIcon = outline('M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'CheckCircleIcon');
export const ClockIcon = outline('M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'ClockIcon');
export const ExclamationTriangleIcon = outline(
  'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
  'ExclamationTriangleIcon',
);
export const InformationCircleIcon = outline(
  'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
  'InformationCircleIcon',
);
