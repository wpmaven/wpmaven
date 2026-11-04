import React, { type ReactElement, type ReactNode } from 'react';
import { WMLogo } from './WMLogo';
import { WMLogoProcessing } from './WMLogoProcessing';
import styles from './LogoAnimation.module.css';

export type LogoAnimationState = 'idle' | 'absorbing' | 'processing' | 'working';

interface LogoAnimationProps {
  state: LogoAnimationState;
  size?: number;
  /** @deprecated Use idleLogo instead */
  idleSrc?: string;
  /** @deprecated Use processingLogo instead */
  processingSrc?: string;
  /** Inline ReactNode for the idle state logo (default: WMLogo) */
  idleLogo?: ReactNode;
  /** Inline ReactNode for the other states (default: WMLogoProcessing) */
  processingLogo?: ReactNode;
  className?: string;
}

/**
 * The Hand-off mark in a box of `size` pixels: `idle` draws it still (WMLogo),
 * `absorbing`, `processing` and `working` draw its working loop
 * (WMLogoProcessing, still under prefers-reduced-motion). Nothing is drawn
 * outside the box, and the mark keeps one size and one place in every state.
 *
 * Sizing: `size` is the mark's own 64-unit box, as for WMLogo, so the mark
 * covers about 80% of it. The first loader artwork, which the callers' sizes
 * were chosen for, covered the same 80%, and a still WMLogo of the same size
 * hands over to the loader without a jump.
 *
 * A brand's idleLogo or processingLogo is drawn in the same box, centred.
 */
export const LogoAnimation = ({
  state = 'idle',
  size = 150,
  idleSrc,
  processingSrc,
  idleLogo,
  processingLogo,
  className = '',
}: LogoAnimationProps): ReactElement => {
  const idle = state === 'idle';
  const logo = idle ? idleLogo : processingLogo;
  const src = idle ? idleSrc : processingSrc;

  let mark: ReactNode;
  if (logo) {
    mark = logo;
  } else if (src) {
    mark = <img className={styles.image} src={src} alt="" width={size} height={size} />;
  } else if (idle) {
    mark = <WMLogo size={size} className={styles.mark} />;
  } else {
    mark = <WMLogoProcessing size={size} className={styles.mark} />;
  }

  const containerCls = [styles.container, className].filter(Boolean).join(' ');

  return (
    <div
      className={containerCls}
      data-state={state}
      style={{ width: size, height: size }}
    >
      {mark}
    </div>
  );
};
