import React, { useEffect, useId, useState } from 'react';
import { NavIcon, NavItem } from '@yotako/webmaven-ui';

/** Where the browser keeps a group the person opened: one key per group. */
export const navGroupKey = (id: string): string => `webmaven-sidebar-group-${id}`;

function readOpen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function saveOpen(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(key, open ? '1' : '0');
  } catch {
    // Storage blocked: the group just starts closed next time.
  }
}

export interface NavGroupProps {
  /** The group's name in the storage key and the page's ids. */
  id: string;
  label: string;
  /** One of the group's pages is the one on screen: the group opens by itself. */
  hasActive?: boolean;
  /** The sum of its entries' counts, in the row's bubble while the group is closed. */
  count?: number;
  /** Where the open state is kept (navGroupKey(id) unless the group had a key before). */
  storageKey?: string;
  testId?: string;
  /** The group's data-tour value, where a guided tour points at it. */
  tour?: string;
  children: React.ReactNode;
}

/**
 * A sidebar group that folds (2026-10-16), the plugin's own: only its
 * sidebar has groups, the dashboard's has none. The row is the kit's NavItem
 * with a chevron in the icon's place; its entries sit under it, a step in.
 *
 *  - It opens by itself when one of its pages is open (from a link, Back, or
 *    a pasted address), and stays open after: it never shuts on its own.
 *  - It remembers being opened or closed by the person, per browser
 *    (localStorage, read and written in a try, so a blocked storage only
 *    means it starts closed). Opening by itself is not remembered.
 *  - Closed, its row shows the sum of its entries' counts.
 *  - The entries stay in the page while it is closed, hidden, so their counts
 *    keep coming in for the sum.
 */
export function NavGroup({ id, label, hasActive = false, count = 0, storageKey, testId, tour, children }: NavGroupProps) {
  const key = storageKey ?? navGroupKey(id);
  const [open, setOpen] = useState(() => hasActive || readOpen(key));
  const listId = `wm-navgroup-${id}-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;

  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    saveOpen(key, next);
  };

  return (
    <div className="wm-navgroup" data-open={open ? 'true' : 'false'} data-tour={tour}>
      <NavItem
        as="button"
        className="wm-navgroup__toggle"
        icon={<NavIcon name={open ? 'chevron-down' : 'chevron-right'} />}
        label={label}
        badge={open ? null : count}
        aria-expanded={open}
        aria-controls={listId}
        onClick={toggle}
        testId={testId}
      />
      <div id={listId} role="group" aria-label={label} className="wm-navgroup__items" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

export default NavGroup;
