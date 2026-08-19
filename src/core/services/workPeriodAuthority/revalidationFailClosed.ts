/**
 * Shared fail-closed outcome for secure-session revalidation.
 * Both `false` and unexpected rejection use this transition.
 * No shift claim/close. No SSO issuance.
 */
export type RevalidationObservation =
  | { outcome: 'ready' }
  | { outcome: 'failed'; cause: 'false' | 'rejected' };

export async function observeRevalidation(
  revalidate: () => Promise<boolean>,
): Promise<RevalidationObservation> {
  try {
    const stillValid = await revalidate();
    return stillValid ? { outcome: 'ready' } : { outcome: 'failed', cause: 'false' };
  } catch {
    return { outcome: 'failed', cause: 'rejected' };
  }
}

export const REVALIDATION_FAILED_UI = {
  kind: 'unavailable' as const,
  reason: 'revalidation_failed',
};
