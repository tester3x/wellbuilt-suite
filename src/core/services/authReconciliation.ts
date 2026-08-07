/**
 * Restored-session reconciliation.
 *
 * On cold launch WB-S restores a durable LOCAL identity with no network,
 * and that must keep working — ordinary app entry is offline-capable and
 * this module never blocks it. Separately, a persisted SDK Auth session
 * may or may not exist, and if it does it may or may not belong to the
 * driver whose local identity was restored (device handover, a driver
 * switch that failed midway, a stale session from a previous install).
 *
 * Verified cloud operations must run only when BOTH exist and agree.
 * Everything here is about establishing that agreement explicitly rather
 * than assuming it.
 *
 * Nothing in this module authorizes anything by itself: callers ask for
 * the current state at the moment they need it, so no cached boolean can
 * become durable authority.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirebaseApp } from './firebaseApp';
import {
  getOwnedVerifiedIdentity,
  initializePersistentAuth,
  signOutOwned,
  waitForAuthReady,
} from './firebaseAuthBoundary';

/**
 * Reconciliation outcome.
 *
 * - `local-only`      restored local identity, no SDK session. Ordinary
 *                     offline entry proceeds; verified operations are
 *                     unavailable.
 * - `verifying`       reconciliation has not completed yet.
 * - `verified`        local and SDK identities exist and agree.
 * - `rejected`        they disagree, or claims are malformed/not a driver.
 *                     The SDK session has been signed out.
 * - `unavailable`     claims could not be read (offline, refresh failed).
 *                     Local identity is preserved untouched; verified
 *                     operations stay unavailable until it can be retried.
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

let current: AuthReconciliationState = 'verifying';
const listeners = new Set<(s: AuthReconciliationState) => void>();

function set(next: AuthReconciliationState): void {
  if (current === next) return;
  current = next;
  for (const l of listeners) l(next);
}

/** Current state. Read at the point of use — never cached by callers. */
export function getAuthReconciliationState(): AuthReconciliationState {
  return current;
}

export function onAuthReconciliationChange(
  cb: (s: AuthReconciliationState) => void,
): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * The single gate protected cloud operations must pass.
 *
 * Deliberately NOT a stored flag: it re-reads state each call, so a
 * session that is later rejected cannot leave a stale `true` behind.
 */
export function isVerifiedReady(): boolean {
  return current === 'verified';
}

/** Read the restored local identity. Local storage only — never network. */
export async function readLocalIdentity(): Promise<LocalIdentity> {
  const [driverId, companyId] = await Promise.all([
    AsyncStorage.getItem('driverId').catch(() => null),
    AsyncStorage.getItem('selectedCompanyId').catch(() => null),
  ]);
  return { driverId, companyId };
}

/**
 * Reconcile the persisted SDK session against restored local identity.
 *
 * Safe to call during startup: it initializes the owned boundary and
 * awaits readiness, but callers must not await it before rendering —
 * ordinary offline entry does not depend on the result.
 */
export async function reconcileRestoredSession(
  local?: LocalIdentity,
): Promise<AuthReconciliationState> {
  set('verifying');
  const app = getFirebaseApp();

  try {
    initializePersistentAuth(app, AsyncStorage);
    await waitForAuthReady(app);
  } catch {
    // The boundary could not establish ownership (foreign instance, or a
    // missing capability). Local identity is untouched; nothing verified.
    set('unavailable');
    return current;
  }

  const identity = await (async () => {
    try {
      return await getOwnedVerifiedIdentity(app);
    } catch {
      return undefined; // distinguish "read failed" from "no user"
    }
  })();

  // Claims unreadable — offline or refresh failure. Preserve local
  // identity; do NOT sign out, and do NOT treat it as a mismatch.
  if (identity === undefined) {
    set('unavailable');
    return current;
  }

  const localIdentity = local ?? (await readLocalIdentity());
  const hasLocal = !!localIdentity.driverId;

  // No SDK user: ordinary offline entry continues, verified unavailable.
  if (identity === null) {
    set(hasLocal ? 'local-only' : 'local-only');
    return current;
  }

  // SDK user with no local identity — a session with nothing to bind it
  // to. Sign out rather than leave an orphan authenticated.
  if (!hasLocal) {
    await signOutOwned(app).catch(() => {});
    set('rejected');
    return current;
  }

  // Both exist: they must agree, and the claims must be a driver session.
  const matches =
    identity.kind === 'driver'
    && !!identity.driverId
    && identity.driverId === localIdentity.driverId
    && (!localIdentity.companyId || identity.companyId === localIdentity.companyId);

  if (!matches) {
    await signOutOwned(app).catch(() => {});
    set('rejected');
    return current;
  }

  set('verified');
  return current;
}

/** Test-only: restore the initial state between cases. */
export function __resetReconciliationForTests(): void {
  current = 'verifying';
  listeners.clear();
}
