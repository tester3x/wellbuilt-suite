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
  /**
   * Take reconciliation ownership. Logout and every identity transition
   * call this, so an in-flight reconciliation for the previous driver can
   * no longer publish state or sign anything out.
   */
  invalidate(): void;
  getState(): AuthReconciliationState;
  subscribe(cb: (s: AuthReconciliationState) => void): () => void;
  /** The single gate protected cloud operations pass. Never a cached flag. */
  isVerifiedReady(): boolean;
}

export function createReconciliationCore(ops: ReconciliationOps): ReconciliationCore {
  let state: AuthReconciliationState = 'verifying';
  let generation = 0;
  const listeners = new Set<(s: AuthReconciliationState) => void>();

  function publish(next: AuthReconciliationState, gen: number): void {
    // A reconciliation that no longer owns the generation publishes
    // nothing: driver A's late result must not overwrite driver B's.
    if (gen !== generation) return;
    if (state === next) return;
    state = next;
    for (const listener of listeners) listener(next);
  }

  return {
    async reconcile(local) {
      const gen = generation;
      publish('verifying', gen);

      try {
        ops.initializePersistentAuth();
        await ops.waitForAuthReady();
      } catch {
        // Ownership could not be established (foreign instance, missing
        // capability). Local identity untouched; nothing verified.
        publish('unavailable', gen);
        return gen === generation ? state : 'unavailable';
      }
      if (gen !== generation) return state;

      let identity: VerifiedIdentity | null;
      try {
        identity = await ops.getVerifiedIdentity();
      } catch {
        // Claims unreadable — offline or refresh failure. Preserve local
        // identity, do NOT sign out, and do NOT call it a mismatch.
        publish('unavailable', gen);
        return gen === generation ? state : 'unavailable';
      }
      if (gen !== generation) return state;

      const hasLocal = !!local?.driverId;

      // No SDK user: ordinary entry continues, verified unavailable.
      if (identity === null) {
        publish('local-only', gen);
        return gen === generation ? state : 'local-only';
      }

      // An SDK user with no local identity to bind it to is an orphan —
      // a session from a previous install or an abandoned driver switch.
      // Sign it out rather than leave it authenticated.
      if (!hasLocal) {
        await signOutQuietly(gen);
        publish('rejected', gen);
        return gen === generation ? state : 'rejected';
      }

      // vc51.9K: a session scoped to ANOTHER app is not a WB-S session.
      // WB-T sessions carry app:'wbt'; WB-S requests no audience at all,
      // so any marker here means a foreign-scoped session was restored —
      // device handover, a shared UID, or an abandoned switch. Handled as
      // a mismatch through the SAME bounded cleanup, not a new failure
      // mode, so protected WB-S operations simply stay unavailable.
      //
      // Deliberately NOT requiring app:'wbs'. Every existing install has
      // a session with no audience at all, and demanding one would sign
      // out every current driver.
      const foreignAudience = typeof identity.app === 'string' && identity.app.length > 0;

      const matches =
        identity.kind === 'driver'
        && !foreignAudience
        && !!identity.driverId
        && identity.driverId === local!.driverId
        && (!local!.companyId || identity.companyId === local!.companyId);

      if (!matches) {
        await signOutQuietly(gen);
        publish('rejected', gen);
        return gen === generation ? state : 'rejected';
      }

      publish('verified', gen);
      return gen === generation ? state : 'verified';
    },
    invalidate() {
      generation += 1;
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

  /**
   * Sign out an unwanted session, but only while we still own the
   * generation — a stale reconciliation must never sign out the session
   * belonging to a newer driver.
   */
  async function signOutQuietly(gen: number): Promise<void> {
    if (gen !== generation) return;
    try {
      await ops.signOut();
    } catch {
      // Best effort: the state we publish already says "not verified".
    }
  }
}
