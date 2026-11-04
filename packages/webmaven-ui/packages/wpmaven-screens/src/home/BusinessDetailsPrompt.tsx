/**
 * "Check what your site says about you", as a Home section (moved from the
 * dashboard's business details card, 2026-10-17): the dashboard's Home and
 * the plugin's Overview draw it in their side column until the owner has
 * saved the business details once. It reads GET
 * /instances/:id/business-details through the app's transport; its button
 * opens the business page at the card that saves them
 * (/instances/:id#business-details, through the host: the dashboard's
 * router, the dashboard in a new tab from WordPress).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Button, GlassCard } from '@yotako/webmaven-ui';
import type { ScreensHost, ScreensTransport } from '../host/types';
import { teamBusiness } from '../team/reads';

const enc = encodeURIComponent;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const BUSINESS_DETAILS_PROMPT_COPY = {
  title: 'Check what your site says about you',
  body: 'Your name, phone, email, address, and opening hours: your site uses them wherever it shows how to reach you. Check them once, so customers reach the right place.',
  button: 'Check my details',
} as const;

/** Where the business page's Business details card is (its anchor on the Overview). */
export const BUSINESS_DETAILS_ANCHOR = 'business-details';

/** "/instances/<id>#business-details": the business page, at this card. */
export function businessDetailsPath(instanceId: string): string {
  return `/instances/${enc(instanceId)}#${BUSINESS_DETAILS_ANCHOR}`;
}

/** What the prompt reads of the business details: whether they were ever saved. */
export interface BusinessDetailsSavedRead {
  details: { confirmedAt?: string } | null;
}

/** The answer's object that carries `key`: the body, or its `data`. */
function payloadWith(body: unknown, key: string): Record<string, unknown> | null {
  if (!isObj(body)) return null;
  if (key in body) return body;
  const inner = isObj(body.data) ? body.data : null;
  return inner && key in inner ? inner : null;
}

/**
 * The business details' read as the prompt needs it, or null for an answer
 * that is not one. Saved details are a record with a name; their
 * confirmedAt says when the owner saved them.
 */
export function detailsSavedOf(body: unknown): BusinessDetailsSavedRead | null {
  const p = payloadWith(body, 'details') ?? payloadWith(body, 'suggested');
  if (!p) return null;
  const d = isObj(p.details) && typeof p.details.name === 'string' ? p.details : null;
  return { details: d ? (typeof d.confirmedAt === 'string' ? { confirmedAt: d.confirmedAt } : {}) : null };
}

/** GET /instances/:id/business-details, as the prompt reads it. Rejects on a failure or an answer that is not one. */
export async function readBusinessDetailsSaved(transport: ScreensTransport, instanceId: string): Promise<BusinessDetailsSavedRead> {
  const read = detailsSavedOf(await transport.get<unknown>(`/instances/${enc(instanceId)}/business-details`));
  if (!read) throw new Error('The business details answer was not one.');
  return read;
}

/** The Home card shows until the owner has saved them once (confirmedAt), and only to someone who can. */
export function promptShows(read: { details?: { confirmedAt?: string } | null } | null, canEdit: boolean): boolean {
  return canEdit && !!read && !read.details?.confirmedAt;
}

/**
 * Whether Home shows "Check what your site says about you": until the
 * owner has saved the details once, and only to someone who can change
 * them (viewer.editsBusinessDetails). Nothing while the call is on its way,
 * and nothing when it fails or the route is not one the app may call.
 */
export function useBusinessDetailsPrompt(host: ScreensHost, instanceId?: string | null): { show: boolean } {
  const business = teamBusiness(host.scope, instanceId);
  const canEdit = host.viewer?.editsBusinessDetails !== false;
  const hostRef = useRef(host);
  hostRef.current = host;
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(false);
    if (!business || !canEdit) return undefined;
    let cancelled = false;
    readBusinessDetailsSaved(hostRef.current.transport, business)
      .then((read) => { if (!cancelled) setShow(promptShows(read, canEdit)); })
      .catch(() => { if (!cancelled) setShow(false); });
    return () => { cancelled = true; };
  }, [business, canEdit]);
  return { show };
}

export interface BusinessDetailsPromptProps {
  host: ScreensHost;
  /** The business (the account's scope); a site's scope reads its own. */
  instanceId?: string | null;
  /**
   * In its own card (the default), shown only once useBusinessDetailsPrompt
   * says so; bare inside the app's card (the dashboard's Home decides when
   * to draw it).
   */
  card?: boolean;
}

/** The card's words and the button straight to the business details card. */
export const BusinessDetailsPromptView: React.FC<{ host: ScreensHost; instanceId: string }> = ({ host, instanceId }) => (
  <div data-testid="details-prompt" style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
    <h3 style={{ margin: 0, fontSize: 'var(--text-body)', lineHeight: 'var(--leading-body)', fontWeight: 650, color: 'var(--text)' }}>
      {BUSINESS_DETAILS_PROMPT_COPY.title}
    </h3>
    <p style={{ margin: 0, fontSize: 'var(--text-body)', lineHeight: 'var(--leading-body)', color: 'var(--text-dim)' }}>
      {BUSINESS_DETAILS_PROMPT_COPY.body}
    </p>
    <Button
      size="sm"
      variant="primary"
      onClick={() => { host.track?.('business_details', 'prompt_opened'); host.navigate(businessDetailsPath(instanceId)); }}
    >
      {BUSINESS_DETAILS_PROMPT_COPY.button}
    </Button>
  </div>
);

/**
 * Check what your site says about you, as a Home section. In its own card,
 * it reads whether to show itself; bare, the app has read it
 * (useBusinessDetailsPrompt) and draws it inside its own card.
 */
export const BusinessDetailsPrompt: React.FC<BusinessDetailsPromptProps> = ({ host, instanceId, card = true }) => {
  const business = teamBusiness(host.scope, instanceId);
  if (!card) return business ? <BusinessDetailsPromptView host={host} instanceId={business} /> : null;
  return <BusinessDetailsPromptCard host={host} instanceId={business} />;
};

const BusinessDetailsPromptCard: React.FC<{ host: ScreensHost; instanceId: string | null }> = ({ host, instanceId }) => {
  const { show } = useBusinessDetailsPrompt(host, instanceId);
  if (!show || !instanceId) return null;
  return (
    <GlassCard padding={24} data-testid="details-prompt-card">
      <BusinessDetailsPromptView host={host} instanceId={instanceId} />
    </GlassCard>
  );
};

export default BusinessDetailsPrompt;
