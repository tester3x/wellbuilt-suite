/**
 * Restored-session reconciliation — the wiring.
 *
 * On cold launch WB-S restores a durable LOCAL identity with no network,
 * and that must keep working — ordinary app entry is offline-capable and
 * this module never blocks it. Separately, a persisted SDK Auth session
 * may or may not exist, and if it does it may or may not belong to the
 * driver whose local identity was restored (device handover, a driver
 * switch that failed midway, a stale session from a previous install).
 *
 * Verified cloud operations must run only when BOTH exist and agree.
 *
 * The decision logic lives in reconciliationCore so the startup state
 * matrix and the identity-generation ownership rules can be proven under
 * `tsx --test`; this file only supplies the real boundary operations and
 * reads local identity from storage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirebaseApp } from './firebaseApp';
import {
  getOwnedVerifiedIdentity,
  initializePersistentAuth,
  signOutOwned,
  waitForAuthReady,
} from './firebaseAuthBoundary';
import {
  createReconciliationCore,
  type AuthReconciliationState,
  type LocalIdentity,
} from './reconciliationCore';

export type { AuthReconciliationState, LocalIdentity };

const core = createReconciliationCore({
  initializePersistentAuth: () => {
    initializePersistentAuth(getFirebaseApp(), AsyncStorage);
  },
  waitForAuthReady: () => waitForAuthReady(getFirebaseApp()),
  getVerifiedIdentity: () => getOwnedVerifiedIdentity(getFirebaseApp()),
  signOut: () => signOutOwned(getFirebaseApp()),
});

/** Current state. Read at the point of use — never cached by callers. */
export function getAuthReconciliationState(): AuthReconciliationState {
  return core.getState();
}

export function onAuthReconciliationChange(
  cb: (s: AuthReconciliationState) => void,
): () => void {
  return core.subscribe(cb);
}

/**
 * The single gate protected cloud operations must pass.
 *
 * Deliberately NOT a stored flag: it re-reads state each call, so a
 * session that is later rejected cannot leave a stale `true` behind.
 */
export function isVerifiedReady(): boolean {
  return core.isVerifiedReady();
}

/**
 * Take reconciliation ownership. Logout and every identity transition
 * call this so an in-flight reconciliation for the previous driver can no
 * longer publish state or sign the new driver out.
 */
export function invalidateReconciliation(): void {
  core.invalidate();
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
 * Pass `null` for "no durable local identity was restored" — that case
 * still has to run, because an SDK user with nothing to bind it to is an
 * orphan that must be signed out. Never fabricate a local identity to
 * stand in for it.
 *
 * Safe to call during startup: it initializes the owned boundary and
 * awaits readiness, but callers must not await it before rendering —
 * ordinary offline entry does not depend on the result.
 */
export function reconcileRestoredSession(
  local: LocalIdentity | null,
): Promise<AuthReconciliationState> {
  return core.reconcile(local);
}

/** Test-only: take a fresh generation between cases. */
export function __resetReconciliationForTests(): void {
  core.invalidate();
}
