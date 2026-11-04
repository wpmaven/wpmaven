/**
 * Store payments: the app's mirror of the API's store payment types.
 *
 * These describe the WooCommerce payment-gateway connect flow, NOT WPMaven's
 * own Stripe billing (that lives under /payments/*, a different thing with a
 * similar name). Store-gateway calls are instance-scoped under
 * /instances/:instanceId/payments/*.
 */

export type StoreGateway = 'woocommerce_payments' | 'stripe' | 'ppcp';

export type GatewayConnection = 'connected' | 'pending' | 'none';

export interface PaymentStatus {
  gateways: Array<{ id: string; title: string; enabled: boolean; connected: GatewayConnection }>;
  primary: string | null;
}

export interface PaymentSetupResult {
  gateway: StoreGateway;
  connectUrl: string | null;
  alreadyConnected: boolean;
}
