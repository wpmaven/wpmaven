/**
 * What the API's session route sends versus what the wizard compares
 * (final verification round 5, 2026-09-22).
 *
 * GET /onboarding/session/:id answers with the lowercase mapping of the
 * Prisma enum ('generating', 'error', 'completed'; statusFromPrisma), and the
 * plugin proxy passes it through unchanged. The wizard's polling tick and its
 * reload rehydration compared the uppercase literals, so after an API
 * restart the theater polled forever: the row was reset to ERROR server-side
 * but the error card and its Try Again never appeared, and a build that
 * completed while polling never flipped to success either. Every read of a
 * polled or rehydrated status goes through sessionStatusOf.
 */

import type { OnboardingStatus } from '../types';

/** The session row's errorCode for a build refused because the site was built before. */
export const BUILD_REFUSED_CODE = 'build_refused';

/** The wizard's uppercase status for whatever casing the API sent. */
export function sessionStatusOf(raw: unknown): OnboardingStatus {
  const s = String(raw ?? '').trim().toUpperCase();
  return (s || 'DESCRIBING') as OnboardingStatus;
}

/**
 * Whether a session's last build was refused because the site was built
 * before: the explanation is shown and Try Again is not offered (a retry
 * would be refused again).
 */
export function buildRefused(session: { errorCode?: string | null } | null | undefined): boolean {
  return session?.errorCode === BUILD_REFUSED_CODE;
}

/** The same, read from the build stream's error event. */
export function errorEventRefused(data: { errorCode?: string; retryable?: boolean } | null | undefined): boolean {
  return data?.errorCode === BUILD_REFUSED_CODE || data?.retryable === false;
}
