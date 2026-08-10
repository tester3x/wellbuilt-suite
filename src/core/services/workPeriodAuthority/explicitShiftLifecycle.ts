/**
 * Enforced explicit_shift lifecycle helpers — pure-ish orchestration over
 * the server callables + local binding storage. AuthContext wires UI state.
 */
import * as SecureStore from 'expo-secure-store';
import {
  clearCurrentShiftId,
  mintShiftId,
  localOriginDateFromNow,
  setCurrentShiftBinding,
  getCurrentShiftId,
} from '../shiftTracking';
import {
  createShiftAuthorityClient,
  shiftAuthorityDiag,
  type ShiftAuthorityClient,
  type ResolveActiveResult,
} from './shiftAuthorityClient';
import {
  decidePostLoginShiftRestore,
  decidePreMintShiftGate,
  mapServerResolveToRestoreAction,
  restoreActionToUiState,
  shiftStartIsoFromShiftId,
  type ShiftAuthorityUiState,
  type ShiftUiRestoreAction,
  isEnforcedExplicitShift,
} from './postLoginShiftRestoration';
import type { SuiteEnforcement } from './suiteShiftAuthority';

export type LocalShiftFlags = {
  setShiftActive: (v: boolean) => void;
  setShiftStartTime: (v: string | null) => void;
  setReturningToYard?: (v: boolean) => void;
  setReturnDepartTime?: (v: string | null) => void;
};

export function defaultShiftAuthorityClient(): ShiftAuthorityClient {
  return createShiftAuthorityClient();
}

/** Apply a restore action to local storage + React setters. */
export async function applyRestoreAction(
  action: ShiftUiRestoreAction,
  flags: LocalShiftFlags,
): Promise<ShiftAuthorityUiState> {
  if (action.kind === 'restore_active' && action.periodId) {
    const origin = action.originLocalDate || action.periodId.slice(0, 10);
    await setCurrentShiftBinding(action.periodId, origin);
    await SecureStore.setItemAsync('shiftStarted', 'true');
    await SecureStore.deleteItemAsync('shiftEnded');
    const startIso =
      action.shiftStartTimeIso
      || shiftStartIsoFromShiftId(action.periodId)
      || (await SecureStore.getItemAsync('shiftStartTime'));
    if (startIso) {
      await SecureStore.setItemAsync('shiftStartTime', startIso);
      flags.setShiftStartTime(startIso);
    }
    flags.setShiftActive(true);
    return restoreActionToUiState(action);
  }
  if (action.kind === 'inactive_allow_start') {
    await SecureStore.deleteItemAsync('shiftStarted');
    await SecureStore.setItemAsync('shiftEnded', 'true');
    await clearCurrentShiftId();
    flags.setShiftActive(false);
    flags.setShiftStartTime(null);
    return { kind: 'none' };
  }
  // block_start / unavailable — do not mint; clear active flags; keep cache if any for retry
  await SecureStore.deleteItemAsync('shiftStarted');
  await SecureStore.deleteItemAsync('shiftEnded');
  flags.setShiftActive(false);
  flags.setShiftStartTime(null);
  return restoreActionToUiState(action);
}

export async function resolveEnforcedExplicit(
  client: ShiftAuthorityClient = defaultShiftAuthorityClient(),
): Promise<ResolveActiveResult> {
  shiftAuthorityDiag('resolve.invoke');
  const result = await client.resolve();
  shiftAuthorityDiag('resolve.outcome', {
    state: result.state,
    reason: result.state === 'unverifiable' ? result.reason : null,
    // Mask period: log only date prefix + whether present
    periodBound: result.state === 'open' ? 1 : 0,
    originLocalDate: result.state === 'open' ? result.originLocalDate : null,
  });
  return result;
}

export async function postLoginEnforcedRestore(deps: {
  enforcement: SuiteEnforcement;
  client?: ShiftAuthorityClient;
  flags: LocalShiftFlags;
}): Promise<ShiftAuthorityUiState> {
  if (!isEnforcedExplicitShift(deps.enforcement)) {
    return { kind: 'legacy' };
  }
  const client = deps.client ?? defaultShiftAuthorityClient();
  try {
    const resolved = await resolveEnforcedExplicit(client);
    const action = mapServerResolveToRestoreAction(resolved);
    const ui = await applyRestoreAction(action, deps.flags);
    shiftAuthorityDiag('postLogin.ui', { kind: ui.kind, reason: ui.kind === 'unavailable' ? ui.reason : null });
    return ui;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'resolve_failed';
    shiftAuthorityDiag('postLogin.error', { reason });
    await applyRestoreAction({ kind: 'block_start', reason }, deps.flags);
    return { kind: 'unavailable', reason };
  }
}

export type ClaimStartResult =
  | { ok: true; periodId: string; originLocalDate: string; claimed: boolean }
  | { ok: false; reason: string; openPeriodId?: string; openOriginLocalDate?: string };

/**
 * Atomic claim for enforced explicit shift. Never appends client login.
 */
export async function claimEnforcedExplicitStart(deps: {
  client?: ShiftAuthorityClient;
  flags: LocalShiftFlags;
  packageId?: string | null;
  startTimeIso?: string;
}): Promise<ClaimStartResult> {
  const client = deps.client ?? defaultShiftAuthorityClient();
  const startTime = deps.startTimeIso || new Date().toISOString();

  let resolved: ResolveActiveResult;
  try {
    resolved = await resolveEnforcedExplicit(client);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'resolve_failed';
    return { ok: false, reason };
  }

  if (resolved.state === 'open') {
    await setCurrentShiftBinding(resolved.periodId, resolved.originLocalDate);
    await SecureStore.setItemAsync('shiftStarted', 'true');
    await SecureStore.deleteItemAsync('shiftEnded');
    const startIso = shiftStartIsoFromShiftId(resolved.periodId) || startTime;
    await SecureStore.setItemAsync('shiftStartTime', startIso);
    deps.flags.setShiftStartTime(startIso);
    deps.flags.setShiftActive(true);
    shiftAuthorityDiag('claim.adopt_existing', {
      originLocalDate: resolved.originLocalDate,
      claimed: 0,
    });
    return {
      ok: true,
      periodId: resolved.periodId,
      originLocalDate: resolved.originLocalDate,
      claimed: false,
    };
  }
  if (resolved.state === 'unverifiable') {
    return { ok: false, reason: `server_unverifiable:${resolved.reason}` };
  }

  // none — propose and claim
  const now = new Date();
  const originLocalDate = localOriginDateFromNow(now);
  // Align mint wall-clock with originLocalDate (same local calendar).
  const periodId = mintShiftId();
  // If clock crossed midnight between origin and mint (rare), force consistent origin from periodId
  const proposalOrigin = periodId.slice(0, 10);
  const origin = proposalOrigin === originLocalDate ? originLocalDate : proposalOrigin;

  try {
    const claimed = await client.claim(periodId, origin);
    await setCurrentShiftBinding(claimed.periodId, claimed.originLocalDate);
    await SecureStore.setItemAsync('shiftStarted', 'true');
    await SecureStore.setItemAsync('shiftStartTime', startTime);
    await SecureStore.deleteItemAsync('shiftEnded');
    deps.flags.setShiftActive(true);
    deps.flags.setShiftStartTime(startTime);
    if (deps.packageId) {
      await SecureStore.setItemAsync('activePackageId', deps.packageId);
    }
    shiftAuthorityDiag('claim.outcome', {
      claimed: claimed.claimed ? 1 : 0,
      originLocalDate: claimed.originLocalDate,
    });
    return {
      ok: true,
      periodId: claimed.periodId,
      originLocalDate: claimed.originLocalDate,
      claimed: claimed.claimed,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'claim_failed';
    shiftAuthorityDiag('claim.error', { reason });
    deps.flags.setShiftActive(false);
    return { ok: false, reason };
  }
}

export async function recordEnforcedDepartReturn(deps: {
  client?: ShiftAuthorityClient;
  periodId?: string | null;
}): Promise<{ ok: boolean; reason?: string; recorded?: boolean }> {
  const client = deps.client ?? defaultShiftAuthorityClient();
  const periodId = deps.periodId ?? (await getCurrentShiftId());
  if (!periodId) return { ok: false, reason: 'no_period' };
  try {
    const result = await client.recordDepartReturn(periodId);
    shiftAuthorityDiag('departReturn.outcome', {
      recorded: result.recorded ? 1 : 0,
      originPrefix: result.periodId.slice(0, 10),
    });
    return { ok: true, recorded: result.recorded };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'depart_failed';
    shiftAuthorityDiag('departReturn.error', { reason });
    return { ok: false, reason };
  }
}

export async function closeEnforcedExplicit(deps: {
  client?: ShiftAuthorityClient;
  periodId?: string | null;
  odometerMiles?: number;
}): Promise<{ ok: boolean; reason?: string; alreadyClosed?: boolean }> {
  const client = deps.client ?? defaultShiftAuthorityClient();
  const periodId = deps.periodId ?? (await getCurrentShiftId());
  if (!periodId) return { ok: false, reason: 'no_period' };
  try {
    const result = await client.close(periodId, deps.odometerMiles);
    shiftAuthorityDiag('close.outcome', {
      alreadyClosed: result.alreadyClosed ? 1 : 0,
      originPrefix: result.closedPeriodId.slice(0, 10),
    });
    return { ok: true, alreadyClosed: result.alreadyClosed };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'close_failed';
    shiftAuthorityDiag('close.error', { reason });
    return { ok: false, reason };
  }
}

/** Re-export gate helpers for AuthContext wiring tests. */
export {
  decidePostLoginShiftRestore,
  decidePreMintShiftGate,
  isEnforcedExplicitShift,
};
