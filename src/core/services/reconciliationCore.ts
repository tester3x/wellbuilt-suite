/**
 * Restored-session reconciliation — the decision logic, isolated.
 *
 * Same seam as authSessionCore, for the same reason: authReconciliation.ts
 * imports AsyncStorage and therefore react-native, so it cannot run under
 * `tsx --test`. The parts that must be proven — the startup state matrix,
 * and that a reconciliation for driver A cannot publish over driver B —
 * live here with no react-native / firebase / expo imports.
 */
import type { VerifiedIdentity } from './authSessionCore';

/**
 * Reconciliation outcome.
 *
 * - `local-only`   ordinary offline entry proceeds; verified operations
 *                  are unavailable. Also the correct answer when neither
 *                  a local identity nor an SDK user exists.
 * - `verifying`    reconciliation has not completed yet.
 * - `verified`     local and SDK identities exist and agree.
 * - `rejected`     they disagree, the claims are malformed or not a
 *                  driver, or an SDK user exists with no local identity
 *                  to bind it to. The SDK session has been signed out.
 * - `unavailable`  claims could not be read (offline, refresh failure).
 *                  Local identity is preserved untouched and verified
 *                  operations stay unavailable until this can be retried.
 */
export type AuthReconciliationState =
  | 'local-only'
  | 'verifying'
  | 'verified'
  | 'rejected'
  | 'unavailable';

export interface LocalIdentity {
  driverId: string | null;
  companyId: string | null;
}

/** The boundary operations reconciliation needs. A subset of the Auth ops. */
export interface ReconciliationOps {
  initializePersistentAuth(): void;
  waitForAuthReady(): Promise<void>;
  getVerifiedIdentity(): Promise<VerifiedIdentity | null>;
  signOut(): Promise<void>;
}

export interface ReconciliationCore {
  /**
   * Reconcile a persisted SDK session against the restored local identity.
   *
   * `local` is explicit: pass null for "no durable local identity was
   * restored". Never fabricate one — an SDK user with nothing to bind it
   * to is an orphan and must be signed out, which is not the same as a
   * mismatch against a driver who is not there.
   */
  reconcile(local: LocalIdentity | null): Promise<AuthReconciliationState>;
  /** Reset to the initial state. */
  reset(): void;
  getState(): AuthReconciliationState;
  subscribe(cb: (s: AuthReconciliationState) => void): () => void;
  /** The single gate protected cloud operations pass. Never a cached flag. */
  isVerifiedReady(): boolean;
}

export function createReconciliationCore(ops: ReconciliationOps): ReconciliationCore {
  let state: AuthReconciliationState = 'verifying';
  const listeners = new Set<(s: AuthReconciliationState) => void>();

  function publish(next: AuthReconciliationState): void {
    if (state === next) return;
    state = next;
    for (const listener of listeners) listener(next);
  }

  return {
    async reconcile(local) {
      publish('verifying');

      try {
        ops.initializePersistentAuth();
        await ops.waitForAuthReady();
      } catch {
        // Ownership could not be established (foreign instance, missing
        // capability). Local identity untouched; nothing verified.
        publish('unavailable');
        return 'unavailable';
      }

      let identity: VerifiedIdentity | null;
      try {
        identity = await ops.getVerifiedIdentity();
      } catch {
        // Claims unreadable — offline or refresh failure. Preserve local
        // identity, do NOT sign out, and do NOT call it a mismatch.
        publish('unavailable');
        return 'unavailable';
      }

      const hasLocal = !!local?.driverId;

      // No SDK user: ordinary entry continues, verified unavailable.
      if (identity === null) {
        publish('local-only');
        return 'local-only';
      }

      // An SDK user with no local identity to bind it to is an orphan —
      // a session from a previous install or an abandoned driver switch.
      // Sign it out rather than leave it authenticated.
      if (!hasLocal) {
        await signOutQuietly();
        publish('rejected');
        return 'rejected';
      }

      const matches =
        identity.kind === 'driver'
        && !!identity.driverId
        && identity.driverId === local!.driverId
        && (!local!.companyId || identity.companyId === local!.companyId);

      if (!matches) {
        await signOutQuietly();
        publish('rejected');
        return 'rejected';
      }

      publish('verified');
      return 'verified';
    },
    reset() {
      state = 'verifying';
    },
    getState() {
      return state;
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    isVerifiedReady() {
      return state === 'verified';
    },
  };

  /** Sign out an unwanted session; the published state already says "not verified". */
  async function signOutQuietly(): Promise<void> {
    try {
      await ops.signOut();
    } catch {
      // Best effort: the state we publish already says "not verified".
    }
  }
}
