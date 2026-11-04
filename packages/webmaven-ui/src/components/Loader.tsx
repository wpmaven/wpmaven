import React from 'react';
import type { ReactElement } from 'react';
import { LogoAnimation } from './LogoAnimation';

interface LoaderProps {
  variant?: 'spin' | 'spiral';
  size?: number;
  className?: string;
}

export const Loader = ({
  size = 40,
  className,
}: LoaderProps): ReactElement => {
  return (
    <div className={className}>
      <LogoAnimation state="processing" size={size} />
    </div>
  );
};
