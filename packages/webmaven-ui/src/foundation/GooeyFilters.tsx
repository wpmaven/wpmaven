import React from 'react';

export const GooeyFilters: React.FC = () => (
  <svg style={{ position: 'absolute', width: 0, height: 0 }}>
    <defs>
      <filter id="goo-sm">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b" />
        <feColorMatrix
          in="b"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 14 -5"
          result="g"
        />
        <feComposite in="SourceGraphic" in2="g" operator="atop" />
      </filter>
    </defs>
  </svg>
);
