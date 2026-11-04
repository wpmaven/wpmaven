import React, { ReactNode } from 'react';
import s from './Tabs.module.css';

export interface TabItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
}

/**
 * How the tab bar is drawn:
 *  - `segmented` (the default since 0.7.0): a rectangular track, radius 10,
 *    with tabs of radius 8, the design system's tab bar; for every page-level
 *    bar, filters included;
 *  - `underline`: a line under the active tab, for tabs inside a page section;
 *  - `pill`: 0.6's rounded pill (999px), kept for one release, then dropped.
 */
export type TabsLook = 'segmented' | 'underline' | 'pill';

export interface TabsProps {
  items?: TabItem[];
  tabs?: Array<{ id: string; label: string; icon?: ReactNode }>;
  activeKey?: string;
  activeTab?: string;
  onChange: (key: string) => void;
  look?: TabsLook;
  /** The active tab filled with the accent, white text (segmented and pill). */
  gradient?: boolean;
  /** 0.6's switch to the underline look; `look="underline"` says the same. A `look` wins over it. */
  underline?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Announced to screen readers for the bar as a whole. */
  ariaLabel?: string;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  items: itemsProp,
  tabs: tabsProp,
  activeKey: activeKeyProp,
  activeTab: activeTabProp,
  onChange,
  look: lookProp,
  gradient = false,
  underline = false,
  size = 'md',
  ariaLabel,
  className,
}) => {
  const items: TabItem[] = itemsProp || (tabsProp?.map(t => ({ key: t.id, label: t.label, icon: t.icon })) ?? []);
  const activeKey = activeKeyProp || activeTabProp || '';
  const look: TabsLook = lookProp ?? (underline ? 'underline' : 'segmented');

  if (look === 'underline') {
    return (
      <div className={`${s.underlineContainer} ${className || ''}`} role="tablist" aria-label={ariaLabel}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={item.key === activeKey}
            className={`${s.underlineTab}${item.key === activeKey ? ` ${s.underlineActive}` : ''}`}
            onClick={() => onChange(item.key)}
          >
            {item.icon && <span className={s.icon}>{item.icon}</span>}
            {item.label}
          </button>
        ))}
      </div>
    );
  }

  const containerCls = [
    s.container,
    s[look],
    gradient ? s.gradient : '',
    size !== 'md' ? s[size] : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={containerCls} role="tablist" aria-label={ariaLabel} data-look={look}>
      {items.map((item) => (
        <button
          key={item.key}
          // A tab never submits the form it sits in.
          type="button"
          role="tab"
          aria-selected={item.key === activeKey}
          className={`${s.tab}${item.key === activeKey ? ` ${s.active}` : ''}`}
          onClick={() => onChange(item.key)}
        >
          {item.icon && <span className={s.icon}>{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  );
};

export interface TabPanelProps {
  children: React.ReactNode;
  isActive: boolean;
  className?: string;
}

export const TabPanel: React.FC<TabPanelProps> = ({ children, isActive, className }) => {
  if (!isActive) return null;
  return <div className={`${s.panel} ${className || ''}`} role="tabpanel">{children}</div>;
};
