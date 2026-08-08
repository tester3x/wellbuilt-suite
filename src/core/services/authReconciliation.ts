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
import { getDriverSession } from './driverAuth';
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

/**
 * Read the restored local identity. Local storage only — never network.
 *
 * Sourced from the authenticated session, because that is the only place
 * the identity actually exists. This previously read AsyncStorage keys
 * `driverId` and `selectedCompanyId`, but login persists to SecureStore
 * (`driverId`, `companyId`) — two different stores — and nothing in WB-S
 * has ever written `selectedCompanyId` at all: it had three readers and
 * zero writers.
 *
 * So the read returned {null, null} for every driver in every session.
 * Reconciliation treated a signed-in driver as having no durable identity,
 * and SSO issuance refused at its local-identity precondition with
 * `not_authorized` — the WB-S -> WB-T bridge was unreachable by
 * construction, not by state. Observed live 2026-08-08 when WB-T vc56
 * correctly requested authorization and WB-S declined.
 *
 * getDriverSession() returns null unless driverId, displayName and
 * passcodeHash are all present, so a partially-written session still
 * yields no identity. Nothing is defaulted or invented: an absent
 * companyId stays absent, and ssoRuntime still refuses to issue without
 * both identifiers.
 */
export async function readLocalIdentity(): Promise<LocalIdentity> {
  try {
    const session = await getDriverSession();
    return {
      driverId: session?.driverId ?? null,
      companyId: session?.companyId ?? null,
    };
  } catch {
    return { driverId: null, companyId: null };
  }
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
