/**
 * Serialized owner-safe persistence for the return-to-yard state.
 *
 * WHY THIS EXISTS
 *
 * The return state is two persisted keys — `returnAttemptId` (the identity of
 * the current return attempt) and `returnDepartTime` (when that attempt began)
 * — and they are shared mutable state between every session the app sees.
 * AuthProvider never unmounts, so driver A logging out and driver B logging in
 * happens inside one provider lifetime, and an async write started by A can
 * land after B has persisted its own return.
 *
 * `expo-secure-store` offers only getItemAsync / setItemAsync / deleteItemAsync:
 * there is NO compare-and-swap, no transaction, and no synchronous delete, so a
 * "delete only if it is still mine" cannot be built out of the native API. A
 * read, a comparison and a delete written as three awaits is three separate
 * trips to the keychain, and ANY of the gaps between them is long enough for
 * another writer to persist a newer attempt — after which the stale writer's
 * delete destroys state it does not own. A generation check placed before or
 * after the delete cannot fix this: it narrows the window but the mutation is
 * still asynchronous, and no check AFTER a delete can restore what was lost.
 *
 * SecureStore is private to this app, so the only writers that can race are the
 * app's own. Serializing them is therefore sufficient AND necessary: every
 * read, write and clear of these two keys goes through the single FIFO queue
 * below, so a read-compare-delete runs as one critical section with no other
 * Suite writer interleaved. That is what makes ownership decidable.
 *
 * Consequences of that choice, relied on by callers:
 *
 *  - `clearIfOwner` decides ownership and clears in the SAME critical section,
 *    so a newer attempt persisted by another writer can never be deleted: it
 *    either lands before the section (ownership check fails, nothing is
 *    touched) or after it (nothing of the new attempt existed to delete).
 *  - Both keys are cleared together, so `returnDepartTime` can no longer be
 *    orphaned by a separate unconditional delete.
 *  - Within the clear, the DEPART key goes first and the ATTEMPT key last. A
 *    failure partway therefore leaves the attempt identity in place, which is
 *    the retryable state: the same attempt can be cleared again. Clearing the
 *    identity first would leave a departure time no attempt owns, which no
 *    later call could attribute.
 *  - Storage failures are REPORTED, never swallowed. A caller must not tell the
 *    driver (or clear the screen) that a divert was durably recorded when the
 *    keychain write actually failed.
 *
 * This module is deliberately free of React, react-native and expo imports so
 * the interleavings above are executable in node:test against the real queue,
 * with only the leaf storage calls under test control.
 */
import { isReturnAttemptId } from './returnAttempt';

export const RETURN_ATTEMPT_KEY = 'returnAttemptId';
export const RETURN_DEPART_TIME_KEY = 'returnDepartTime';

/** Leaf storage. Exactly the three operations SecureStore actually provides. */
export type ReturnStateKv = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

export type ReturnStateSnapshot = {
  attemptId: string | null;
  departTimeIso: string | null;
};

export type StoreOk<T> = { ok: true; value: T };
export type StoreFail = { ok: false; reason: string };
export type StoreResult<T> = StoreOk<T> | StoreFail;

export type ClearOutcome = 'cleared' | 'not_owner';
/** A write that only applies while the caller still owns the return state. */
export type OwnedWriteOutcome = 'applied' | 'not_owner';

export type ReturnStateStore = {
  /** Consistent snapshot of both keys (serialized, so never a torn pair). */
  read: () => Promise<StoreResult<ReturnStateSnapshot>>;
  /**
   * Reuse the persisted attempt id, or mint and persist one. Read-modify-write,
   * so it must hold the lock: two concurrent starts would otherwise mint two
   * identities for one return.
   */
  reserveAttempt: (mint: () => string) => Promise<StoreResult<{ attemptId: string; minted: boolean }>>;
  /** Record the departure time, but only while `attemptId` still owns the state. */
  markDeparted: (attemptId: string, departTimeIso: string) => Promise<StoreResult<OwnedWriteOutcome>>;
  /** Clear BOTH keys iff `attemptId` is still the persisted owner. */
  clearIfOwner: (attemptId: string) => Promise<StoreResult<ClearOutcome>>;
  /** Clear both keys regardless of owner: logout, arrival, identity reset. */
  clearAll: () => Promise<StoreResult<null>>;
};

/** FIFO serialization. One operation at a time, and a rejection never poisons the chain. */
function createSerialQueue(): <T>(op: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(op: () => Promise<T>): Promise<T> {
    // `then(op, op)` so a previous failure still lets the next operation run.
    const result = tail.then(op, op);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

function failure(err: unknown, fallback: string): StoreFail {
  const reason = err instanceof Error && err.message ? err.message : fallback;
  return { ok: false, reason };
}

export function createReturnStateStore(kv: ReturnStateKv): ReturnStateStore {
  const run = createSerialQueue();

  return {
    read() {
      return run(async (): Promise<StoreResult<ReturnStateSnapshot>> => {
        try {
          const attemptId = await kv.get(RETURN_ATTEMPT_KEY);
          const departTimeIso = await kv.get(RETURN_DEPART_TIME_KEY);
          return {
            ok: true,
            value: {
              attemptId: isReturnAttemptId(attemptId) ? attemptId : null,
              departTimeIso: typeof departTimeIso === 'string' && departTimeIso ? departTimeIso : null,
            },
          };
        } catch (err) {
          return failure(err, 'return_state_read_failed');
        }
      });
    },

    reserveAttempt(mint) {
      return run(async (): Promise<StoreResult<{ attemptId: string; minted: boolean }>> => {
        try {
          const existing = await kv.get(RETURN_ATTEMPT_KEY);
          if (isReturnAttemptId(existing)) {
            // Idempotent retry of the SAME attempt.
            return { ok: true, value: { attemptId: existing, minted: false } };
          }
          const attemptId = mint();
          if (!isReturnAttemptId(attemptId)) {
            return { ok: false, reason: 'minted_attempt_invalid' };
          }
          await kv.set(RETURN_ATTEMPT_KEY, attemptId);
          return { ok: true, value: { attemptId, minted: true } };
        } catch (err) {
          return failure(err, 'return_attempt_reserve_failed');
        }
      });
    },

    markDeparted(attemptId, departTimeIso) {
      return run(async (): Promise<StoreResult<OwnedWriteOutcome>> => {
        try {
          const current = await kv.get(RETURN_ATTEMPT_KEY);
          if (current !== attemptId) {
            // A newer attempt owns the state; do not stamp it with our time.
            return { ok: true, value: 'not_owner' };
          }
          await kv.set(RETURN_DEPART_TIME_KEY, departTimeIso);
          return { ok: true, value: 'applied' };
        } catch (err) {
          return failure(err, 'return_depart_write_failed');
        }
      });
    },

    clearIfOwner(attemptId) {
      return run(async (): Promise<StoreResult<ClearOutcome>> => {
        try {
          const current = await kv.get(RETURN_ATTEMPT_KEY);
          if (current !== attemptId) {
            return { ok: true, value: 'not_owner' };
          }
          // Departure time first, identity last: see the header note on which
          // partial failure is recoverable.
          await kv.remove(RETURN_DEPART_TIME_KEY);
          await kv.remove(RETURN_ATTEMPT_KEY);
          return { ok: true, value: 'cleared' };
        } catch (err) {
          return failure(err, 'return_state_clear_failed');
        }
      });
    },

    clearAll() {
      return run(async (): Promise<StoreResult<null>> => {
        try {
          await kv.remove(RETURN_DEPART_TIME_KEY);
          await kv.remove(RETURN_ATTEMPT_KEY);
          return { ok: true, value: null };
        } catch (err) {
          return failure(err, 'return_state_clear_failed');
        }
      });
    },
  };
}
