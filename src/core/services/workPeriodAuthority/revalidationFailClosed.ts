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

export type UncertainSessionMemory = {
  user: null;
  shiftActive: false;
  startShiftBusy: false;
  shiftAuthorityUi: typeof REVALIDATION_FAILED_UI;
  ssoGate: 'failed';
};

export function uncertainSessionFailClosedMemory(): UncertainSessionMemory {
  return {
    user: null,
    shiftActive: false,
    startShiftBusy: false,
    shiftAuthorityUi: REVALIDATION_FAILED_UI,
    ssoGate: 'failed',
  };
}

/**
 * Apply fail-closed in-memory state first. Cleanup is best-effort and
 * must not reverse memory or drain the authorize inbox.
 */
export async function runUncertainSessionFailClosed(opts: {
  applyMemory: () => void;
  cleanup: () => Promise<void>;
}): Promise<'cleanup_ok' | 'cleanup_failed'> {
  opts.applyMemory();
  try {
    await opts.cleanup();
    return 'cleanup_ok';
  } catch {
    return 'cleanup_failed';
  }
}
