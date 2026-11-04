import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Avatar, NavIcon, PlanTag, ThemeToggle } from '@yotako/webmaven-ui';
import { useTheme, type ThemeMode } from '../../contexts/ThemeContext';
import { dashboardPhrase, isWpmavenSite, siteBrand, type SiteBrand } from '../../utils/brand';
import { dashboardLink, useSiteState, type SiteState } from '../../utils/siteState';
import { currentTier, type Tier } from '../../utils/tier';
import { isFocusMode, setFocusMode } from '../../utils/focusMode';

/**
 * The account button at the bottom of the sidebar, and its menu, as the
 * dashboard has them: what belongs to the account rather than to the site's
 * work. Settings, Billing and the theme live here, and the top bar keeps the
 * bell.
 *
 * No Sign out: the plugin's only way to sign out disconnects the whole site,
 * and that stays last on Settings, where it says what it does.
 *
 * The plugin has no menu library, so this is a small menu of its own with the
 * dashboard's keyboard: the arrows move between the items, Enter and Space
 * choose one, Escape and a click outside close the menu and give the focus
 * back to the button, and Tab goes to the theme, then out of the menu.
 */

export type AccountItem = 'settings' | 'billing';

/**
 * The menu's links, in order. Billing is the owner's, and only on a WPMaven
 * site: a brand bills its own customers, as the dashboard hides our plans on
 * a branded address.
 */
export function accountItems(tier: Tier | null, brand: SiteBrand = siteBrand()): AccountItem[] {
  return tier === 'owner' && brand.mode === 'wpmaven' ? ['settings', 'billing'] : ['settings'];
}

/**
 * The plan tag beside the name (the kit's PlanTag, its icon in the dot's
 * place): the account's plan (the site state, from GET /sites/me), or null. None while the plan is unknown or canceled, none
 * for a WordPress user who is not an administrator (Settings says the plan is
 * theirs), and none on a branded or neutral site.
 */
export function planTagOf(plan: SiteState['plan'], tier: Tier | null, brand: SiteBrand = siteBrand()): { code: string; name: string } | null {
  if (tier !== 'owner' || brand.mode !== 'wpmaven' || !plan) return null;
  if (plan.status.toUpperCase() === 'CANCELED') return null;
  return { code: plan.code, name: plan.name };
}

interface WpUser {
  firstName?: unknown;
  displayName?: unknown;
  display_name?: unknown;
  email?: unknown;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function wpUser(): WpUser {
  return (window as any).WEBMAVEN_WP_DATA?.user || {};
}

/** The WordPress user's one word: their first name, else their display name. */
export function buttonNameOf(user: WpUser): string {
  return text(user.firstName) || text(user.displayName) || text(user.display_name) || 'User';
}

/** The WordPress user's own name, as WordPress shows it. */
function fullNameOf(user: WpUser): string {
  return text(user.displayName) || text(user.display_name) || text(user.firstName);
}

/**
 * The WPMaven account holder's name (2026-10-16): the account's own (the
 * site state, from GET /sites/me), else what the page was drawn with
 * (WEBMAVEN_WP_DATA.account: the same name, or what an older link stored).
 * Both are an administrator's only: anyone else gets empty names here, and
 * the menu shows their WordPress name as before. The first and last names
 * come from the same place, never mixed.
 */
export function accountNameOf(account: SiteState['account'] | null | undefined, pageAccount?: unknown): { first: string; full: string } {
  const page = (pageAccount && typeof pageAccount === 'object' ? pageAccount : {}) as { firstName?: unknown; lastName?: unknown };
  const fromState = text(account?.firstName);
  const first = fromState || text(page.firstName);
  const last = fromState ? text(account?.lastName) : (first ? text(page.lastName) : '');
  return { first, full: [first, last].filter(Boolean).join(' ') };
}

const TABBABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]',
].map((s) => `${s}:not([tabindex="-1"])`).join(', ');

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

/** What Tab reaches next (or before) from `from`, leaving out the menu itself. */
function focusFrom(from: HTMLElement, step: 1 | -1, menu: HTMLElement | null): void {
  const all = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => !menu?.contains(el));
  const at = all.indexOf(from);
  (all[at + step] ?? from).focus();
}

/**
 * The keys the menu takes for itself, kept for the theme's buttons: Enter
 * and Space choose an item in a menu, and Tab leaves it. Inside the toggle
 * they press the button, and Tab and the arrows move between its three
 * buttons.
 */
function keepThemeKeys(e: React.KeyboardEvent<HTMLDivElement>): void {
  if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); return; }
  const buttons = Array.from(e.currentTarget.querySelectorAll('button'));
  const at = buttons.indexOf(e.target as HTMLButtonElement);
  if (at < 0) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    e.stopPropagation();
    buttons[(at + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length].focus();
  } else if (e.key === 'Tab') {
    // Before the first button: back to the menu's items. After the last: out, as the menu does.
    if (e.shiftKey && at === 0) {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.closest<HTMLElement>('[role="menu"]')?.focus();
    } else if (e.shiftKey || at < buttons.length - 1) {
      e.stopPropagation();
    }
  }
}

/**
 * Appearance: the kit's ThemeToggle. Not a menu item: a menu item closes the
 * menu, and choosing a theme keeps it open so the owner sees the change.
 */
export function AppearanceRow({ mode, onChange }: { mode: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  return (
    <div className="wm-account__appearance">
      <span className="wm-account__appearance-label">Appearance</span>
      {/* The menu cancels Space on its way up, which would cancel the button's own click. */}
      <div onKeyDown={keepThemeKeys} onKeyUp={(e) => { if (e.key === ' ') e.stopPropagation(); }}>
        <ThemeToggle mode={mode} onChange={onChange} />
      </div>
    </div>
  );
}

/** Where the focus goes once the menu opens: the menu itself (a click), or its first or last item (the arrows). */
type OpenFocus = 'menu' | 'first' | 'last';

/**
 * The button (the initials, the first name, an up chevron) and its menu,
 * which opens upward as wide as the sidebar. `onSettings` opens Settings and,
 * on a phone, closes the drawer the button sits in.
 */
export function AccountMenu({ onSettings }: { onSettings: () => void }) {
  const site = useSiteState();
  const { mode, setMode } = useTheme();
  const tier = currentTier();
  const brand = siteBrand();
  const user = wpUser();
  const items = accountItems(tier, brand);
  const plan = planTagOf(site.plan, tier, brand);
  // The WPMaven account's name when it is known, else the WordPress user's, as before.
  const account = accountNameOf(site.account, (window as any).WEBMAVEN_WP_DATA?.account);
  const firstName = account.first || buttonNameOf(user);
  const wpName = fullNameOf(user);
  const name = account.full || wpName;
  const email = account.full ? '' : text(user.email);

  const [open, setOpen] = useState(false);
  const openFocus = useRef<OpenFocus>('menu');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const buttonId = `wm-account-button-${uid}`;
  const menuId = `wm-account-menu-${uid}`;

  const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  const openMenu = (focus: OpenFocus) => {
    openFocus.current = focus;
    setOpen(true);
  };

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const list = menuItems();
    const at = openFocus.current;
    (at === 'first' ? list[0] : at === 'last' ? list[list.length - 1] : menuRef.current)?.focus();
  }, [open]);

  // A click outside closes the menu. The focus goes back to the button,
  // unless the click lands on something that takes the focus itself.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target && rootRef.current?.contains(target)) return;
      const takesFocus = !!target?.closest(FOCUSABLE);
      if (!takesFocus) e.preventDefault();
      close(!takesFocus);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  const onButtonKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (open && e.key !== 'ArrowDown') close(true);
      else openMenu('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu('last');
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const list = menuItems();
    const target = e.target as HTMLElement;
    const at = list.indexOf(target);
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case 'ArrowDown':
        e.preventDefault();
        (at < 0 ? list[0] : list[Math.min(at + 1, list.length - 1)])?.focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        (at < 0 ? list[list.length - 1] : list[Math.max(at - 1, 0)])?.focus();
        break;
      case 'Home':
      case 'PageUp':
        e.preventDefault();
        list[0]?.focus();
        break;
      case 'End':
      case 'PageDown':
        e.preventDefault();
        list[list.length - 1]?.focus();
        break;
      case 'Enter':
      case ' ':
        if (at >= 0) {
          e.preventDefault();
          target.click();
        }
        break;
      case 'Tab': {
        // From the menu or one of its items, Tab goes to the theme rather than out of the menu.
        if (!e.shiftKey && (target === e.currentTarget || at >= 0)) {
          const current = e.currentTarget.querySelector<HTMLElement>('[role="radiogroup"] [aria-checked="true"]');
          if (current) {
            e.preventDefault();
            current.focus();
            break;
          }
        }
        // Past the theme, or back before the items: out of the menu, next to its button.
        e.preventDefault();
        close(false);
        if (buttonRef.current) focusFrom(buttonRef.current, e.shiftKey ? -1 : 1, menuRef.current);
        break;
      }
      default:
        break;
    }
  };

  // Focus mode: the app over the whole window, this user's choice.
  const [focus, setFocus] = useState(isFocusMode);
  const toggleFocus = () => {
    close(true);
    setFocusMode(!focus).then(setFocus).catch(() => undefined);
  };

  const chooseSettings = (e: React.MouseEvent) => {
    e.preventDefault();
    close(true);
    onSettings();
  };

  return (
    <div className="wm-account" ref={rootRef} data-tour="account">
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        className="wm-account__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (open ? close(true) : openMenu('menu'))}
        onKeyDown={onButtonKeyDown}
        // Space presses a button on its way up: the key down already chose.
        onKeyUp={(e) => { if (e.key === ' ') e.preventDefault(); }}
        data-testid="wm-account-button"
      >
        <Avatar size="sm">{firstName.charAt(0).toUpperCase()}</Avatar>
        {/* The first name alone: the full name is in the menu. */}
        <span className="wm-account__first">{firstName}</span>
        <NavIcon name="chevron-up" size={16} strokeWidth={2} className="wm-account__chevron" />
      </button>

      {/* Always in the page, hidden while closed: a link chosen in it is
          still there when the browser follows it. */}
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-labelledby={buttonId}
        tabIndex={-1}
        hidden={!open}
        className="wm-account__menu"
        onKeyDown={onMenuKeyDown}
        // Space would press the focused item a second time on its way up.
        onKeyUp={(e) => { if (e.key === ' ') e.preventDefault(); }}
      >
        <div className="wm-account__who">
          <div className="wm-account__names">
            {/* The account holder's full name, then this WordPress user's own
                after WordPress's mark: "Ana Martin (W ana.martin)". The
                WordPress email is left out there: it is not the account's. */}
            <p className="wm-account__name" data-testid="wm-account-name" title={account.full && wpName ? `${account.full} (${wpName})` : undefined}>
              {name || email}
              {account.full && wpName && (
                <span className="wm-account__wp">
                  {' ('}
                  <NavIcon name="wordpress" size={12} label="WordPress" className="wm-account__wp-mark" />
                  {` ${wpName})`}
                </span>
              )}
            </p>
            {name && email && <p className="wm-account__email">{email}</p>}
          </div>
          {plan && (
            <PlanTag code={plan.code} name={plan.name} showIcon={isWpmavenSite(brand)} className="wm-account__plan" testId="wm-account-plan" />
          )}
        </div>
        <div className="wm-account__group">
          {items.includes('settings') && (
            <a role="menuitem" tabIndex={-1} href="#/settings" className="wm-account__item" onClick={chooseSettings} data-testid="wm-account-settings">
              <NavIcon name="cog-6-tooth" strokeWidth={1.75} />
              <span>Settings</span>
            </a>
          )}
          {items.includes('billing') && (
            <a
              role="menuitem"
              tabIndex={-1}
              href={dashboardLink(site, '/billing')}
              target="_blank"
              rel="noopener noreferrer"
              title={`Opens ${dashboardPhrase(brand)}`}
              className="wm-account__item"
              onClick={() => close(true)}
              data-testid="wm-account-billing"
            >
              <NavIcon name="credit-card" strokeWidth={1.75} />
              <span>Billing</span>
              <NavIcon name="arrow-top-right-on-square" size={12} strokeWidth={2} className="wm-account__external" />
            </a>
          )}
        </div>
        <div className="wm-account__group">
          <button type="button" role="menuitem" tabIndex={-1} className="wm-account__item" onClick={toggleFocus} data-testid="wm-account-focus">
            <NavIcon name={focus ? 'arrows-pointing-in' : 'arrows-pointing-out'} strokeWidth={1.75} />
            <span>{focus ? 'Leave focus mode' : 'Focus mode'}</span>
          </button>
        </div>
        <AppearanceRow mode={mode} onChange={setMode} />
      </div>
    </div>
  );
}

export default AccountMenu;
