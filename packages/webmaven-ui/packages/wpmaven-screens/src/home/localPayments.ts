/**
 * Local payment services in Turn on a way to get paid (2026-11-16): Mollie,
 * Razorpay, Mercado Pago, Payfast and the others the API's registry of local
 * payment services holds. The payment status names the ones
 * that pay the business in its currency and country (storeCurrency.local),
 * with what the form shows: the service's name, what buyers pay with, where
 * the owner signs up and copies the keys, and the keys it asks for.
 *
 *   connect with keys     POST /instances/:id/payments/setup { gateway, credentials, mode }
 *   connect on its screen POST /instances/:id/payments/setup { gateway }, then its own page in WordPress
 *
 * The keys go to the API, which checks them and writes them into the
 * service's own plugin on the owner's site; nothing here keeps them after
 * the answer.
 */
import type { ScreensTransport } from '../host/types';
import type { PaymentSetupResult, PaymentStatus } from './getPaid';

const enc = encodeURIComponent;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** One key a service asks for, as the payment status describes it. */
export interface LocalServiceField {
  id: string;
  label: string;
  /** Where in the service's dashboard it is, one sentence. */
  help: string;
  /** Shown as dots. */
  secret: boolean;
  /** Only for live or only for test keys; null for both. */
  mode: 'live' | 'test' | null;
  optional: boolean;
  /** What it looks like ("starts with live_"), or null. */
  shape: string | null;
}

/** A local service the payment setup offers (PaymentStatus.storeCurrency.local). */
export interface LocalServiceInfo {
  id: string;
  name: string;
  /** 'keys': the owner pastes them here; 'plugin': its plugin connects the account on its own page in WordPress. */
  connect: 'keys' | 'plugin';
  methods: string[];
  signupUrl: string;
  keysUrl: string | null;
  fields: LocalServiceField[];
  /** It can be tried with test keys first. */
  testMode: boolean;
  subscriptions: boolean;
  note: string | null;
}

/** What a setup with keys answers: whether the service takes payments now, with live or test keys. */
export interface LocalSetupResult extends PaymentSetupResult {
  connected?: boolean;
  mode?: 'live' | 'test';
  available?: boolean | null;
}

function isField(v: unknown): v is LocalServiceField {
  return isObj(v) && typeof v.id === 'string' && typeof v.label === 'string' && typeof v.help === 'string';
}

function isService(v: unknown): v is LocalServiceInfo {
  return isObj(v) && typeof v.id === 'string' && typeof v.name === 'string'
    && (v.connect === 'keys' || v.connect === 'plugin')
    && Array.isArray(v.methods) && typeof v.signupUrl === 'string' && Array.isArray(v.fields) && v.fields.every(isField);
}

/** The local services the card offers, in the API's order; none from an older API. */
export function offeredLocalServices(status: PaymentStatus | null | undefined): LocalServiceInfo[] {
  const offer = status?.storeCurrency as (PaymentStatus['storeCurrency'] & { local?: unknown }) | undefined;
  const local = offer?.local;
  if (!Array.isArray(local)) return [];
  const services = offer?.services as unknown;
  return local.filter(isService).filter((s) => !Array.isArray(services) || (services as unknown[]).includes(s.id));
}

/** A local service's name for one of its gateway ids, or null. */
export function localServiceName(status: PaymentStatus | null | undefined, id: string): string | null {
  return offeredLocalServices(status).find((s) => s.id === id)?.name ?? null;
}

/** The keys a mode needs: the ones for both modes and that mode's own. */
export function fieldsForMode(service: LocalServiceInfo, mode: 'live' | 'test'): LocalServiceField[] {
  return service.fields.filter((f) => !f.mode || f.mode === mode);
}

/** What is sent: the mode's keys, trimmed, empty optional ones left out. */
export function keysPayload(service: LocalServiceInfo, mode: 'live' | 'test', values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fieldsForMode(service, mode)) {
    const v = (values[f.id] ?? '').trim();
    if (v) out[f.id] = v;
  }
  return out;
}

/** The keys the form still needs before anything is sent (each required one, empty). */
export function missingKeys(service: LocalServiceInfo, mode: 'live' | 'test', values: Record<string, string>): string[] {
  return fieldsForMode(service, mode).filter((f) => !f.optional && !(values[f.id] ?? '').trim()).map((f) => f.id);
}

/** Connects a service with the owner's keys: the API checks them, then writes them into its plugin on the site. */
export async function connectWithKeys(
  transport: ScreensTransport,
  instanceId: string,
  gateway: string,
  credentials: Record<string, string>,
  mode: 'live' | 'test',
): Promise<LocalSetupResult> {
  return transport.post<LocalSetupResult>(`/instances/${enc(instanceId)}/payments/setup`, { gateway, credentials, mode });
}

/** The sentence per field the API wrote when keys did not look right (a 400 INVALID_KEYS), else null. */
export function keysErrorFields(err: unknown): Record<string, string> | null {
  const res = (err as { response?: { status?: number; data?: { code?: unknown; fields?: unknown } } })?.response;
  if (res?.status !== 400 || res.data?.code !== 'INVALID_KEYS' || !isObj(res.data.fields)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.data.fields)) if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  return Object.keys(out).length ? out : null;
}

/** "A", "A and B", "A, B and C". */
export function andList(items: readonly string[]): string {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}
