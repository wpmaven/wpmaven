// Generated from branding/wpmaven-logo (the "Hand-off" mark, v2) by the kit's tools: static.
// Colours come from --wm-mark-ink / --wm-mark-violet / --wm-mark-orange (GlobalStyles, per theme).
import React from 'react';

interface WMLogoProps {
  size?: number;
  className?: string;
}

const MARK = "<path d=\"M7.589 47.186L7.589 40.036A2.263 2.263 0 0 1 10.172 37.796A18.275 18.275 0 0 1 13.485 38.59A2.089 2.089 0 0 1 14.9 40.567L14.9 41.964A7.136 7.136 0 0 0 22.036 49.1L23.079 49.1A2.089 2.089 0 0 1 25.078 50.583A18.275 18.275 0 0 1 25.681 53.306A2.263 2.263 0 0 1 23.441 55.888L16.292 55.888A8.703 8.703 0 0 1 7.589 47.186Z\" fill=\"var(--wm-mark-ink, #15121F)\"/><path d=\"M18.555 41.964L18.555 29.593A2.263 2.263 0 0 1 21.137 27.353A18.275 18.275 0 0 1 24.45 28.147A2.089 2.089 0 0 1 25.865 30.124L25.865 32.352A6.306 6.306 0 0 0 32.17 38.657L34.044 38.657A2.089 2.089 0 0 1 36.043 40.14A18.275 18.275 0 0 1 36.647 42.863A2.263 2.263 0 0 1 34.407 45.445L22.036 45.445A3.481 3.481 0 0 1 18.555 41.964Z\" fill=\"var(--wm-mark-ink, #15121F)\"/><path d=\"M32.17 35.002L38.443 35.002A0.53 0.53 0 0 0 38.973 34.472L38.973 28.199A2.651 2.651 0 0 0 36.323 25.549L30.05 25.549A0.53 0.53 0 0 0 29.52 26.079L29.52 32.352A2.651 2.651 0 0 0 32.17 35.002Z\" fill=\"var(--wm-mark-orange, #FF6A3D)\"/><path d=\"M33.784 21.949L33.784 7.875A2.263 2.263 0 0 1 36.269 5.624A25.237 25.237 0 0 1 58.899 28.253A2.263 2.263 0 0 1 56.647 30.738L42.574 30.738A0.522 0.522 0 0 1 42.051 30.216L42.051 25.082A2.611 2.611 0 0 0 39.441 22.471L34.306 22.471A0.522 0.522 0 0 1 33.784 21.949Z\" fill=\"var(--wm-mark-violet, #6A4BFF)\"/>";

/**
 * The WPMaven mark ("Hand-off"): two operators in ink hand a coral piece up to the
 * Co-CEO in violet. Inline SVG, no external files; follows the light/dark theme.
 */
export const WMLogo: React.FC<WMLogoProps> = ({ size = 64, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={size} height={size} className={className}
    role="img" aria-label="WPMaven" dangerouslySetInnerHTML={{ __html: MARK }} />
);
