import React from 'react';
import { KIND_COLORS } from './bindings';
import type { EditorEnv } from './env';
import { PanelFrame, Working } from './ui';

/** One of the two pictures: what it is, the current one (or none), and a way to change it. */
function IdentityTile({ title, hint, url, onOpen, testId, square }: { title: string; hint: string; url: string | null; onOpen: () => void; testId: string; square?: boolean }) {
  return (
    <button type="button" className="wme-gs-entry" onClick={onOpen} data-testid={testId} style={{ alignItems: 'center' }}>
      <span
        aria-hidden="true"
        style={{
          width: square ? 40 : 64, height: 40, flex: 'none', borderRadius: 8, border: '1px solid var(--glass-border)', background: 'var(--glass)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}
      >
        {url ? <img src={url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : null}
      </span>
      <span style={{ minWidth: 0 }}>
        {title}
        <small>{url ? hint : 'None yet'}</small>
      </span>
    </button>
  );
}

/**
 * The logo and the site icon: the picture in the header, and the small one
 * browsers show in tabs, bookmarks and on phone home screens. Each opens the
 * image panel on its own target.
 */
export function IdentityPanel({ env }: { env: EditorEnv }) {
  const identity = env.siteMap?.identity;
  return (
    <PanelFrame chip="Logo and site icon" color={KIND_COLORS.image} title="Your logo and site icon" sub="The picture in your header and the small one in browser tabs" onClose={env.closePanel} testId="editor-identity">
      {!env.siteMap && <Working text="Reading your site." />}
      <IdentityTile
        title="Your logo"
        hint="In your header, and wherever your site shows its name"
        url={identity?.logoUrl ?? null}
        testId="identity-logo"
        onOpen={() => env.openPanel({ kind: 'image', target: { kind: 'site', slot: 'logo' }, src: identity?.logoUrl ?? '', alt: '', label: 'Your logo' })}
      />
      <IdentityTile
        title="Your site icon"
        hint="In browser tabs, bookmarks and phone home screens"
        url={identity?.iconUrl ?? null}
        square
        testId="identity-icon"
        onOpen={() => env.openPanel({ kind: 'image', target: { kind: 'site', slot: 'icon' }, src: identity?.iconUrl ?? '', alt: '', label: 'Your site icon' })}
      />
      {env.siteMap && !identity?.iconUrl && (
        <p className="wme-gs-hint">Your site has no icon yet, so browsers show a blank page symbol.</p>
      )}
    </PanelFrame>
  );
}

/** The site's name as WordPress prints it (the tab mock's title). */
export function siteTitle(): string {
  const name = (typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA?.site?.name : '') as unknown;
  return typeof name === 'string' && name.trim() ? name.trim() : 'Your site';
}

/** A browser tab with the new icon next to the site's name: how the change looks, since no page shows it. */
export function BrowserTabMock({ iconUrl }: { iconUrl: string }) {
  return (
    <div data-testid="icon-tab-mock" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: '10px 10px 0 0', background: 'var(--glass)', border: '1px solid var(--glass-border)', borderBottom: 0, maxWidth: 260 }}>
        <img src={iconUrl} alt="Your new site icon" width={16} height={16} style={{ width: 16, height: 16, objectFit: 'contain', flex: 'none' }} />
        <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{siteTitle()}</span>
      </div>
      <p className="wme-gs-hint">This is how it looks in a browser tab.</p>
    </div>
  );
}
