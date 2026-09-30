/**
 * Return-to-yard divert ("Back to Work") orchestration — the race-critical part.
 *
 * Kept RN/expo-free (every side effect is an injected port) so the concurrency
 * invariants below are executable in node:test without rendering AuthContext,
 * the same reason `returnDivert.ts` is pure.
 *
 * A divert exits the returning-to-yard state WITHOUT recording an arrival and
 * WITHOUT closing the shift: the server period stays OPEN and the depart_return
 * event stays in history, so the only durable write is the `return_abandoned`
 * marker keyed on (type, periodId, attemptId).
 *
 * The hazards this flow exists to close — all of them are "the await finished
 * in a session that no longer owns the screen":
 *
 *  1. DOUBLE DIVERT. "Back to work" is a modal button; two taps used to start
 *     two concurrent abandonments for the SAME attempt. The second one raced
 *     the first one's local clear, so both saw `returningToYard === true`, both
 *     invoked the governed callable, and both ran the SecureStore deletes.
 *     A single-owner latch now admits one abandonment at a time; the loser
 *     reports `in_flight` and touches nothing (in particular it never releases
 *     the winner's latch).
 *
 *  2. STALE SESSION COMMIT. The abandonment awaits company config, the period
 *     id and a network callable. A logout / account switch inside that window
 *     used to leave the resolved old-session abandonment free to delete
 *     `returnAttemptId` + `returnDepartTime` and to push `returningToYard=false`
 *     — i.e. an OLD session deleting a NEWER session's persisted return
 *     identity and clearing its yard card. The generation captured at entry is
 *     therefore re-checked before EVERY durable write and before the UI clear,
 *     exactly as `startReturn` and `applyRestoreAction` already do.
 *
 *  3. IDENTITY THEFT ACROSS THE LAST WINDOW. Generation checks still leave the
 *     width of one `await` between "current" and "deleted", and SecureStore has
 *     no compare-and-swap, so a read-compare-then-delete written as separate
 *     awaits still destroys a newer attempt persisted in one of the gaps. The
 *     clear is therefore delegated to the serialized return-state store, which
 *     decides ownership and clears BOTH keys inside one critical section that
 *     no other Suite writer can interleave (see returnStateStore.ts). Losing
 *     the ownership check aborts the rest of the commit.
 *
 * Failure stays visible, and that includes STORAGE failure: a refused or
 * throwing callable, or a keychain error during the clear, keeps the returning
 * state AND keeps the persisted attempt id, so the driver retries the SAME
 * attempt (server idempotency dedupes it) instead of being shown a divert that
 * was never durably recorded.
 */

/**
 * Single-owner latch for the abandonment (AuthContext backs it with a ref that
 * outlives logout, because AuthProvider never unmounts).
 *
 * Ownership is a TICKET, not a boolean. A session transition calls `reset()` to
 * hand the latch to the next session while an old abandonment may still be
 * awaiting; when that old call finally runs `release(itsTicket)` the ticket no
 * longer matches, so it cannot free the NEW session's latch and let a second
 * concurrent abandonment through.
 */
export type ReturnAbandonLatch = {
  /** A ticket iff ownership was taken; null when someone else holds it. */
  tryAcquire: () => number | null;
  /** Releases ONLY if `ticket` is still the holder. */
  release: (ticket: number) => void;
  /** Force-hand-off at a session transition (logout / login / unmount). */
  reset: () => void;
  held: () => boolean;
};

export function createReturnAbandonLatch(): ReturnAbandonLatch {
  let issued = 0;
  let holder: number | null = null;
  return {
    tryAcquire() {
      if (holder !== null) return null;
      issued += 1;
      holder = issued;
      return holder;
    },
    release(ticket) {
      // Tickets are monotonic, so a superseded holder never matches.
      if (holder === ticket) holder = null;
    },
    reset() {
      holder = null;
    },
    held() {
      return holder !== null;
    },
  };
}

export type ReturnAbandonPorts = {
  /** Enforced explicit_shift routes through the governed callable. */
  enforced: boolean;
  /** True iff the session generation captured at entry is still live. */
  isCurrent: () => boolean;
  latch: ReturnAbandonLatch;
  /** Persisted id of the return attempt being abandoned (SecureStore). */
  readAttemptId: () => Promise<string | null>;
  /** Server period the abandonment belongs to. */
  readPeriodId: () => Promise<string | null>;
  /** Governed callable — enforced companies deny a direct client write. */
  recordAbandoned: (args: { periodId: string | null; attemptId: string }) =>
    Promise<{ ok: boolean; reason?: string; recorded?: boolean }>;
  /** Legacy (non-enforced) direct write; fire-and-forget, as today. */
  recordLegacyAbandoned: () => void;
  /**
   * Clear the whole return state (attempt id AND departure time) iff
   * `attemptId` is still its persisted owner, as ONE serialized critical
   * section. `not_owner` means a newer return owns the state and nothing was
   * touched; `ok: false` means storage genuinely failed and nothing may be
   * reported as durably cleared.
   */
  clearOwnedReturnState: (attemptId: string) =>
    Promise<{ ok: true; value: 'cleared' | 'not_owner' } | { ok: false; reason: string }>;
  /** Legacy path has no attempt identity to own; clears both keys. */
  clearAllReturnState: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** setReturningToYard(false) + setReturnDepartTime(null). */
  clearReturnUi: () => void;
  isValidAttemptId: (v: unknown) => v is string;
  log?: (event: string, detail?: Record<string, unknown>) => void;
};

export type ReturnAbandonOutcome =
  | { ok: true; recorded?: boolean }
  | { ok: false; reason: string };

function note(ports: ReturnAbandonPorts, event: string, detail?: Record<string, unknown>): void {
  ports.log?.(event, detail);
}

/**
 * Run one return abandonment. The caller has already established that a divert
 * is legal (`shouldDivertFromReturn`); everything below is the race discipline.
 *
 * Never throws: every exit is a reason the caller can surface, and every
 * non-`ok` exit leaves the returning state and the attempt identity intact.
 */
export async function runReturnAbandon(ports: ReturnAbandonPorts): Promise<ReturnAbandonOutcome> {
  // Entry generation check: a tap that lands after logout must do nothing.
  if (!ports.isCurrent()) {
    note(ports, 'abandon.stale_skip', { phase: 'entry' });
    return { ok: false, reason: 'stale_generation' };
  }
  // Hazard 1: one abandonment at a time. The loser must not run the commit and
  // must not release the winner's latch, so it returns before the try/finally.
  const ticket = ports.latch.tryAcquire();
  if (ticket === null) {
    note(ports, 'abandon.in_flight_skip');
    return { ok: false, reason: 'in_flight' };
  }
  try {
    const attemptId = await ports.readAttemptId();
    if (!ports.isCurrent()) {
      note(ports, 'abandon.stale_skip', { phase: 'after_attempt_read' });
      return { ok: false, reason: 'stale_generation' };
    }

    if (ports.enforced) {
      if (!ports.isValidAttemptId(attemptId)) {
        // No attempt identity on record: the server keys idempotency on it, so
        // inventing one would mint a second abandonment for the same attempt.
        // Keep the return state and let the authoritative state resolve it.
        note(ports, 'abandon.no_attempt');
        return { ok: false, reason: 'no_attempt' };
      }
      const periodId = await ports.readPeriodId();
      if (!ports.isCurrent()) {
        note(ports, 'abandon.stale_skip', { phase: 'after_period_read' });
        return { ok: false, reason: 'stale_generation' };
      }

      let result: { ok: boolean; reason?: string; recorded?: boolean };
      try {
        result = await ports.recordAbandoned({ periodId, attemptId });
      } catch (err) {
        if (!ports.isCurrent()) return { ok: false, reason: 'stale_generation' };
        const reason = err instanceof Error ? err.message : 'abandon_failed';
        note(ports, 'abandon.error', { reason });
        return { ok: false, reason: reason || 'abandon_failed' };
      }

      // Hazard 2, the sharp edge: the callable resolved, but this session may
      // have been replaced while it was in flight. A stale winner must NOT
      // commit — no deletes, no UI clear.
      if (!ports.isCurrent()) {
        note(ports, 'abandon.stale_skip', { phase: 'after_record' });
        return { ok: false, reason: 'stale_generation' };
      }
      if (!result.ok) {
        // Keep the yard card AND the attempt id: retry is the same attempt.
        note(ports, 'abandon.refused', { reason: result.reason ?? null });
        return { ok: false, reason: result.reason || 'abandon_failed' };
      }
      const committed = await commitLocalClear(ports, attemptId);
      if (!committed.ok) return committed;
      note(ports, 'abandon.outcome', { recorded: result.recorded ? 1 : 0 });
      return { ok: true, recorded: result.recorded };
    }

    // Legacy / non-enforced: the direct write is permitted and stays
    // fire-and-forget, but the local clear is still generation-gated so an old
    // session cannot clear a newer one.
    ports.recordLegacyAbandoned();
    if (!ports.isCurrent()) {
      note(ports, 'abandon.stale_skip', { phase: 'after_legacy_write' });
      return { ok: false, reason: 'stale_generation' };
    }
    const committed = ports.isValidAttemptId(attemptId)
      ? await commitLocalClear(ports, attemptId)
      : await commitLocalClearLegacy(ports);
    if (!committed.ok) return committed;
    note(ports, 'abandon.outcome', { recorded: 1, legacy: 1 });
    return { ok: true };
  } finally {
    // Ticketed: if a session transition already handed the latch on, this is a
    // no-op rather than an unlock of someone else's abandonment.
    ports.latch.release(ticket);
  }
}

/**
 * Commit phase for an abandonment that owns `attemptId`.
 *
 * The clear is ONE serialized store call, so ownership and both deletes happen
 * without another Suite writer interleaving (hazard 3). Three distinct outcomes,
 * and only the first may clear the screen:
 *
 *   cleared    — we owned the state and it is durably gone.
 *   not_owner  — a newer return owns it; nothing was touched, and the newer
 *                session's yard card must stay up.
 *   ok: false  — storage failed. Nothing is claimed as cleared, the attempt id
 *                is still on record, and the driver keeps the return state so a
 *                retry can finish the job.
 */
async function commitLocalClear(
  ports: ReturnAbandonPorts,
  attemptId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!ports.isCurrent()) {
    note(ports, 'abandon.stale_skip', { phase: 'before_commit' });
    return { ok: false, reason: 'stale_generation' };
  }
  const cleared = await ports.clearOwnedReturnState(attemptId);
  if (!cleared.ok) {
    note(ports, 'abandon.storage_error', { phase: 'clear', reason: cleared.reason });
    return { ok: false, reason: cleared.reason || 'return_state_clear_failed' };
  }
  if (cleared.value === 'not_owner') {
    note(ports, 'abandon.identity_superseded');
    return { ok: false, reason: 'identity_superseded' };
  }
  if (!ports.isCurrent()) {
    // The state we owned is gone (correctly — it was ours), but a newer session
    // now owns the screen, so it decides what the driver sees, not us.
    note(ports, 'abandon.stale_skip', { phase: 'after_clear' });
    return { ok: false, reason: 'stale_generation' };
  }
  ports.clearReturnUi();
  return { ok: true };
}

/** Commit phase with no attempt identity to own (legacy only). */
async function commitLocalClearLegacy(
  ports: ReturnAbandonPorts,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!ports.isCurrent()) return { ok: false, reason: 'stale_generation' };
  const cleared = await ports.clearAllReturnState();
  if (!cleared.ok) {
    note(ports, 'abandon.storage_error', { phase: 'clear_legacy', reason: cleared.reason });
    return { ok: false, reason: cleared.reason || 'return_state_clear_failed' };
  }
  if (!ports.isCurrent()) return { ok: false, reason: 'stale_generation' };
  ports.clearReturnUi();
  return { ok: true };
}
