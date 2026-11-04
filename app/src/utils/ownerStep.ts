/**
 * The required step once the site's business is live (2026-10-25), the same
 * as the dashboard's Home asks: the owner's own names (no screen greets a
 * blank name), the business details to review, and the store's currency.
 * WPMaven's screens show it before the rest, to administrators, until it is
 * done once; the API says when (GET /instances/:id/owner-step, through the
 * proxy). The words, the reads and the save; OwnerStepScreen lays them out.
 */
import { getInstanceId, pluginRest, proxy } from '../services/proxyClient';

export const OWNER_STEP_COPY = {
  eyebrow: 'Before you start',
  title: 'Check your details',
  lead: 'Once, and you are done. Your name is how your team greets you, and your business details are what your site shows.',
  you: 'You',
  firstName: 'First name',
  lastName: 'Last name',
  fromCheckout: 'We filled this in from your payment. Check it.',
  business: 'Your business',
  businessName: 'Business name',
  phone: 'Public phone',
  email: 'Public email',
  street: 'Street',
  city: 'City',
  postcode: 'Postcode',
  country: 'Country',
  currency: (name: string, code: string) => `Your store sells in ${name} (${code}).`,
  changeCurrency: 'Change it in your dashboard',
  save: 'Save and continue',
  saving: 'Saving…',
  needNames: 'Enter your first and last name.',
  needBusinessName: 'Enter your business name.',
  failed: 'This was not saved. Try again.',
} as const;

export interface OwnerStepForm {
  firstName: string;
  lastName: string;
  name: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  postcode: string;
  country: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The step is required now (the API's word). A read that fails says no: nobody is held. */
export async function ownerStepRequired(): Promise<boolean> {
  const id = getInstanceId();
  if (!id) return false;
  try {
    const step = await proxy.get<{ required?: unknown }>(`instances/${encodeURIComponent(id)}/owner-step`);
    return isObj(step) && step.required === true;
  } catch {
    return false;
  }
}

/** The details record as it is saved now, else what the API suggests; null when it could not be read. */
export async function readDetails(): Promise<Record<string, unknown> | null> {
  const id = getInstanceId();
  if (!id) return null;
  try {
    const read = await proxy.get<Record<string, unknown>>(`instances/${encodeURIComponent(id)}/business-details`);
    const d = isObj(read) && isObj(read.details) ? read.details : isObj(read) && isObj(read.suggested) ? read.suggested : null;
    return d;
  } catch {
    return null;
  }
}

/** The form from the account's names and the details. Pure. */
export function formFrom(owner: unknown, details: Record<string, unknown> | null): OwnerStepForm & { fromCheckout: boolean } {
  const o = isObj(owner) ? owner : {};
  const s = isObj(o.suggested) ? o.suggested : {};
  const a = details && isObj(details.address) ? details.address : {};
  const first = str(o.firstName) || str(s.firstName);
  const last = str(o.lastName) || str(s.lastName);
  return {
    firstName: first,
    lastName: last,
    fromCheckout: !(str(o.firstName) && str(o.lastName)) && !!(str(s.firstName) || str(s.lastName)),
    name: str(details?.name),
    phone: str(details?.phone),
    email: str(details?.email),
    street: str(a.street),
    city: str(a.city),
    postcode: str(a.postcode),
    country: str(a.country),
  };
}

/** Why Save cannot be pressed yet, or null. Pure. */
export function saveBlocker(f: OwnerStepForm): string | null {
  if (!f.firstName.trim() || !f.lastName.trim()) return OWNER_STEP_COPY.needNames;
  if (!f.name.trim()) return OWNER_STEP_COPY.needBusinessName;
  return null;
}

/**
 * The details to send: the form's fields over what is saved now, so the
 * opening hours, their note and the region set in the dashboard stay. Pure.
 */
export function detailsBody(f: OwnerStepForm, current: Record<string, unknown> | null): Record<string, unknown> {
  const keep = current ?? {};
  const address = { ...(isObj(keep.address) ? keep.address : {}) } as Record<string, unknown>;
  for (const k of ['street', 'city', 'postcode', 'country'] as const) {
    const v = f[k].trim();
    if (v) address[k] = v; else delete address[k];
  }
  const body: Record<string, unknown> = { name: f.name.trim() };
  if (f.phone.trim()) body.phone = f.phone.trim();
  if (f.email.trim()) body.email = f.email.trim();
  if (Object.keys(address).length) body.address = address;
  if (isObj(keep.hours)) body.hours = keep.hours;
  if (typeof keep.hoursNote === 'string' && keep.hoursNote) body.hoursNote = keep.hoursNote;
  return body;
}

/** Saves the names on the account, then the details on the business. Rejects with the owner's sentence. */
export async function saveOwnerStep(f: OwnerStepForm, current: Record<string, unknown> | null): Promise<void> {
  const id = getInstanceId();
  if (!id) throw new Error(OWNER_STEP_COPY.failed);
  await pluginRest.put('owner', { firstName: f.firstName.trim(), lastName: f.lastName.trim() });
  await proxy.put(`instances/${encodeURIComponent(id)}/business-details`, detailsBody(f, current));
}

/** The store's currency, when the site has a store and it could be read. */
export async function readStoreCurrency(): Promise<{ code: string; name: string } | null> {
  const id = getInstanceId();
  if (!id) return null;
  try {
    const s = await proxy.get<Record<string, unknown>>(`instances/${encodeURIComponent(id)}/store-currency`);
    if (!isObj(s) || s.hasStore !== true || typeof s.currency !== 'string' || !s.currency) return null;
    return { code: s.currency, name: typeof s.name === 'string' && s.name ? s.name : s.currency };
  } catch {
    return null;
  }
}

/** The owner's names, read through WPMaven's own route (GET /sites/me/owner). */
export async function readOwner(): Promise<unknown> {
  try {
    return await pluginRest.get('owner');
  } catch {
    return null;
  }
}
