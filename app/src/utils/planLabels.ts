/**
 * The plan and its state as the owner reads them in WP-admin (1.2.8).
 *
 * The API's GET /sites/me/plan names the plan the way the customer bought it
 * (`planName`: "Operator", "White label", "Free"). Older answers, and the
 * sidebar's cached value from before 1.2.8, carry only the plan code
 * ("OPERATOR", "AGENCY"), which is turned into a word; a code is never shown
 * raw. A status is a word too: "Trial", never "trialing" or "past_due".
 */

/** "OPERATOR" -> "Operator"; a name that is already a name stays as it is. */
export function planDisplayName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!/^[A-Z0-9_]+$/.test(raw)) return raw;
  const words = raw.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  TRIALING: 'Trial',
  PAST_DUE: 'Past due',
  UNPAID: 'Unpaid',
  CANCELED: 'Canceled',
  INCOMPLETE: 'Incomplete',
  PAUSED: 'Paused',
};

/** "PAST_DUE" -> "Past due". */
export function planStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Active';
  return STATUS_LABELS[status.toUpperCase()] ?? planDisplayName(status.toUpperCase()) ?? status;
}
