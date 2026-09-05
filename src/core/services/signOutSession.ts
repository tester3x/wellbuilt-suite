/**
 * Sign Out session teardown — authentication cascade only.
 *
 * This executor cannot arm Post-Trip, write pendingEndShiftId, or close a
 * server shift: those operations are not in its dependency surface. Local
 * shift-pointer cleanup is injected so the next driver cannot inherit UI
 * hints; the authoritative server period is left open for re-login restore.
 */
export interface SignOutSessionDeps {
  /** RTDB cascade so sibling apps self-logout. */
  writeLogoutSignal: () => Promise<void>;
  /** Wipe local shiftStarted / currentShiftId / UI pointers. Not a server close. */
  clearLocalShiftPointers: () => Promise<void>;
  invalidateAuthEpoch: () => void;
  takeReconciliationOwnership: () => void;
  secureSignOut: () => Promise<void>;
  clearDriverSession: () => Promise<void>;
  clearMemoryUser: () => void;
}

export async function executeSignOutSession(deps: SignOutSessionDeps): Promise<void> {
  await deps.writeLogoutSignal();
  await deps.clearLocalShiftPointers();
  deps.invalidateAuthEpoch();
  deps.takeReconciliationOwnership();
  await deps.secureSignOut();
  await deps.clearDriverSession();
  deps.clearMemoryUser();
}
