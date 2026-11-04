/** An amount in the smallest unit (cents) as the owner reads it: "$1,240.50", "€12". */
export function formatCents(amountCents: number, currency: string): string {
  const amount = (Number(amountCents) || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency || 'USD').toUpperCase() }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${(currency || '').toUpperCase()}`.trim();
  }
}

/** A date as the owner reads it ("Oct 7, 2026"), or '' for none. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "October 2026" from "2026-10". */
export function formatMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' });
}
