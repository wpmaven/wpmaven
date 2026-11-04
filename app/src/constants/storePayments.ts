/**
 * Store payment-gateway catalog.
 *
 * Display metadata + the per-gateway fee model used as a *fallback* estimate
 * when a gateway doesn't expose actual fee meta. The authoritative fee math
 * lives API-side (financeService); this mirror is only for the connect UI's
 * "typical fees" hint. Editable — keep in sync with the API constant.
 */
import type { StoreGateway } from '../types/storePayments.types';

export interface GatewayMeta {
  id: StoreGateway;
  title: string;
  /** Human blurb for the connect card. */
  blurb: string;
  /** Fallback fee model (percent of amount + fixed per-transaction). */
  fee: { pct: number; fixed: number };
  /** Highlighted with a "Recommended" frame in the connect UIs. */
  recommended?: boolean;
  /** WHY it's recommended: an unexplained badge on a money decision earns
      no trust. */
  recommendReason?: string;
}

export const STORE_GATEWAYS: GatewayMeta[] = [
  {
    id: 'woocommerce_payments',
    title: 'WooPayments',
    blurb: 'Accept cards directly in WooCommerce, no extra account needed.',
    fee: { pct: 2.9, fixed: 0.3 },
    recommended: true,
    recommendReason: 'Works natively with your store, no separate account needed.',
  },
  {
    id: 'stripe',
    title: 'Stripe',
    blurb: 'Cards, wallets and more via your Stripe account.',
    fee: { pct: 2.9, fixed: 0.3 },
  },
  {
    id: 'ppcp',
    title: 'PayPal',
    blurb: 'PayPal, Pay Later and card payments.',
    fee: { pct: 3.49, fixed: 0.49 },
  },
];

export function getGatewayMeta(id: string): GatewayMeta | undefined {
  return STORE_GATEWAYS.find((g) => g.id === id);
}

/** e.g. "2.9% + 0.30" — a light, currency-agnostic fee hint. */
export function formatFeeModel(meta: GatewayMeta): string {
  return `${meta.fee.pct}% + ${meta.fee.fixed.toFixed(2)}`;
}

/** Every way the store can get paid, as the Payments screen lists them (1.3.0). */
export type PaymentOptionId = 'webmaven_payments' | StoreGateway;

export interface PaymentOption {
  id: PaymentOptionId;
  title: string;
  blurb: string;
}

/**
 * WPMaven Payments first (printed products need it), then the gateways the
 * store can add itself. The Payments screen reads each one's state from
 * WooCommerce (webmaven_wp/v1/store/gateways); "Set up" opens WooCommerce's
 * own screens.
 */
export const PAYMENT_OPTIONS: PaymentOption[] = [
  {
    id: 'webmaven_payments',
    title: 'WPMaven Payments',
    blurb: 'Cards and wallets at your checkout, processed by Stripe and paid out to your bank.',
  },
  ...STORE_GATEWAYS.map(({ id, title, blurb }) => ({ id, title, blurb })),
];
