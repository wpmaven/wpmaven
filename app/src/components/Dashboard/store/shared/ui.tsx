/**
 * Small pieces the Store, Blog, Media and Messages screens share: the page
 * frame, a side panel, the note shown when changes cannot reach the account,
 * and a loading line. Styles: styles/store.css (wm-store-*).
 */

import React, { useEffect, useRef } from 'react';
import { PageHeader } from '@yotako/webmaven-ui';
import { X } from 'lucide-react';
import { accountPhrase, siteBrand, type SiteBrand } from '../../../../utils/brand';

export const NO_CONNECTION_SENTENCE = 'Changes to products and posts go through your WPMaven account, which this site cannot reach right now. You can still read everything here.';

/** NO_CONNECTION_SENTENCE in the site's brand (utils/brand.ts): "your Acme Studio account", or "your account". */
export function noConnectionSentence(b: SiteBrand = siteBrand()): string {
  if (b.mode === 'wpmaven') return NO_CONNECTION_SENTENCE;
  return `Changes to products and posts go through ${accountPhrase(b)}, which this site cannot reach right now. You can still read everything here.`;
}

export function StorePage({ title, actions, children, testId }: { title: string; actions?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <div className="wm-main__inner wm-store" data-testid={testId}>
      {/* The kit's page title (2026-10-16), the dashboard's own, with the screen's actions on the right. */}
      <PageHeader className="wm-store__header" title={title} actions={actions} />
      {children}
    </div>
  );
}

/** The note shown above a screen whose changes cannot reach the account right now. */
export function ConnectionNote({ available }: { available: boolean }) {
  if (available) return null;
  return <p className="wm-store-note wm-store-note--warn" role="note" data-testid="store-no-connection">{noConnectionSentence()}</p>;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="wm-store-loading" role="status" aria-label={label}>
      <div className="wpm-auth-loading__spinner" />
    </div>
  );
}

export function ErrorLine({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <p className="wm-store-note wm-store-note--error" role="alert">
      {message}
      {onRetry && (
        <button type="button" className="wm-store-link" onClick={onRetry}>Try again</button>
      )}
    </p>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab go round the panel's own controls, never to the page behind it. */
function keepFocusIn(panel: HTMLElement, e: KeyboardEvent): void {
  const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
  const active = document.activeElement;
  if (!items.length) {
    e.preventDefault();
    panel.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (!panel.contains(active)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && (active === first || active === panel)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * A panel from the right (quick edits, details on a narrow screen). Escape
 * and the backdrop close it; focus moves into it, stays in it, and goes
 * back where it was.
 */
export function Drawer({ open, title, onClose, children, footer, testId }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testId?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // The latest onClose, so a parent's new callback on each render never
  // moves the focus back to the panel.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab' && panel.current) keepFocusIn(panel.current, e);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="wm-store-drawer" data-testid={testId}>
      <div className="wm-store-drawer__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="wm-store-drawer__panel" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}>
        <div className="wm-store-drawer__head">
          <h2 className="wm-store-drawer__title">{title}</h2>
          <button type="button" className="wm-store-drawer__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="wm-store-drawer__body">{children}</div>
        {footer && <div className="wm-store-drawer__foot">{footer}</div>}
      </div>
    </div>
  );
}

/** A labelled form row. */
export function Field({ label, hint, children, htmlFor }: { label: string; hint?: React.ReactNode; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="wm-store-field">
      <label className="wm-store-field__label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="wm-store-field__hint">{hint}</div>}
    </div>
  );
}

/** Segmented choices (the filters' chips): one is pressed. */
export function Chips<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: Array<{ value: T; label: string; count?: number | null }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="wm-store-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`wm-store-chip ${o.value === value ? 'wm-store-chip--on' : ''}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {typeof o.count === 'number' && <span className="wm-store-chip__count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A date as the owner reads it ("3 Oct, 14:05"), in the browser's language. */
export function shortDate(iso: string | null | undefined, withTime = true): string {
  if (!iso) return '';
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, withTime
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}
