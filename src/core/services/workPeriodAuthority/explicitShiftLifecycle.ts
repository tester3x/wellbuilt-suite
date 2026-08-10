/**
 * Enforced explicit_shift lifecycle helpers — pure-ish orchestration over
 * the server callables + local binding storage. AuthContext wires UI state.
 *
 * Callers MUST pass `isCurrent` from the session generation clock so stale
 * async work never mutates local flags or bindings after logout/login.
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

export type GenerationGate = {
  /** True if this operation's captured generation is still live. */
  isCurrent: () => boolean;
};

export function defaultShiftAuthorityClient(): ShiftAuthorityClient {
  return createShiftAuthorityClient();
}

function stale(gate?: GenerationGate): boolean {
  return !!(gate && !gate.isCurrent());
}

/** Apply a restore action to local storage + React setters (generation-gated). */
export async function applyRestoreAction(
  action: ShiftUiRestoreAction,
  flags: LocalShiftFlags,
  gate?: GenerationGate,
): Promise<ShiftAuthorityUiState | null> {
  if (stale(gate)) {
    shiftAuthorityDiag('restore.stale_skip', { phase: 'entry' });
    return null;
  }
  if (action.kind === 'restore_active' && action.periodId) {
    const origin = action.originLocalDate || action.periodId.slice(0, 10);
    await setCurrentShiftBinding(action.periodId, origin);
    if (stale(gate)) {
      shiftAuthorityDiag('restore.stale_skip', { phase: 'after_bind' });
      return null;
    }
    await SecureStore.setItemAsync('shiftStarted', 'true');
    await SecureStore.deleteItemAsync('shiftEnded');
    const startIso =
      action.shiftStartTimeIso
      || shiftStartIsoFromShiftId(action.periodId)
      || (await SecureStore.getItemAsync('shiftStartTime'));
    if (stale(gate)) {
      shiftAuthorityDiag('restore.stale_skip', { phase: 'after_secure' });
      return null;
    }
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
    if (stale(gate)) {
      shiftAuthorityDiag('restore.stale_skip', { phase: 'after_clear' });
      return null;
    }
    flags.setShiftActive(false);
    flags.setShiftStartTime(null);
    return { kind: 'none' };
  }
  // block_start / unavailable — do not mint; clear active flags
  await SecureStore.deleteItemAsync('shiftStarted');
  await SecureStore.deleteItemAsync('shiftEnded');
  if (stale(gate)) {
    shiftAuthorityDiag('restore.stale_skip', { phase: 'after_block' });
    return null;
  }
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
    periodBound: result.state === 'open' ? 1 : 0,
    originLocalDate: result.state === 'open' ? result.originLocalDate : null,
  });
  return result;
}

export async function postLoginEnforcedRestore(deps: {
  enforcement: SuiteEnforcement;
  client?: ShiftAuthorityClient;
  flags: LocalShiftFlags;
  gate?: GenerationGate;
}): Promise<ShiftAuthorityUiState | null> {
  if (!isEnforcedExplicitShift(deps.enforcement)) {
    return { kind: 'legacy' };
  }
  if (stale(deps.gate)) return null;
  const client = deps.client ?? defaultShiftAuthorityClient();
  try {
    const resolved = await resolveEnforcedExplicit(client);
    if (stale(deps.gate)) {
      shiftAuthorityDiag('postLogin.stale_skip', { phase: 'after_resolve' });
      return null;
    }
    const action = mapServerResolveToRestoreAction(resolved);
    const ui = await applyRestoreAction(action, deps.flags, deps.gate);
    if (ui) {
      shiftAuthorityDiag('postLogin.ui', {
        kind: ui.kind,
        reason: ui.kind === 'unavailable' ? ui.reason : null,
      });
    }
    return ui;
  } catch (err) {
    if (stale(deps.gate)) {
      shiftAuthorityDiag('postLogin.stale_skip', { phase: 'after_error' });
      return null;
    }
    const reason = err instanceof Error ? err.message : 'resolve_failed';
    shiftAuthorityDiag('postLogin.error', { reason });
    return applyRestoreAction({ kind: 'block_start', reason }, deps.flags, deps.gate);
  }
}

export type ClaimStartResult =
  | { ok: true; periodId: string; originLocalDate: string; claimed: boolean }
  | { ok: false; reason: string; openPeriodId?: string; openOriginLocalDate?: string };

/**
 * Atomic claim for enforced explicit shift. Never appends client login.
 * Generation-gated: stale sessions never set active flags or Pre-Trip prerequisites.
 */
export async function claimEnforcedExplicitStart(deps: {
  client?: ShiftAuthorityClient;
  flags: LocalShiftFlags;
  packageId?: string | null;
  startTimeIso?: string;
  gate?: GenerationGate;
}): Promise<ClaimStartResult> {
  if (stale(deps.gate)) {
    return { ok: false, reason: 'stale_generation' };
  }
  const client = deps.client ?? defaultShiftAuthorityClient();
  const startTime = deps.startTimeIso || new Date().toISOString();

  let resolved: ResolveActiveResult;
  try {
    resolved = await resolveEnforcedExplicit(client);
  } catch (err) {
    if (stale(deps.gate)) return { ok: false, reason: 'stale_generation' };
    const reason = err instanceof Error ? err.message : 'resolve_failed';
    return { ok: false, reason };
  }
  if (stale(deps.gate)) return { ok: false, reason: 'stale_generation' };

  if (resolved.state === 'open') {
    await setCurrentShiftBinding(resolved.periodId, resolved.originLocalDate);
    if (stale(deps.gate)) return { ok: false, reason: 'stale_generation' };
    await SecureStore.setItemAsync('shiftStarted', 'true');
    await SecureStore.deleteItemAsync('shiftEnded');
    const startIso = shiftStartIsoFromShiftId(resolved.periodId) || startTime;
    await SecureStore.setItemAsync('shiftStartTime', startIso);
    if (stale(deps.gate)) return { ok: false, reason: 'stale_generation' };
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

  const now = new Date();
  const originLocalDate = localOriginDateFromNow(now);
  const periodId = mintShiftId();
  const proposalOrigin = periodId.slice(0, 10);
  const origin = proposalOrigin === originLocalDate ? originLocalDate : proposalOrigin;

  try {
    const claimed = await client.claim(periodId, origin);
    if (stale(deps.gate)) return { ok: false, reason: 'stale_generation' };
    await setCurrentShiftBinding(claimed.periodId, claimed.originLocalDate);
    await SecureStore.setItemAsync('shiftStarted', 'true');
    await SecureStore.setItemAsync('shiftStartTime', startTime);
    await SecureStore.deleteItemAsync('shiftEnded');
    if (stale(deps.gate)) return { ok: false, reason: 'stale_generation' };
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
    if (stale(deps.gate)) return { ok: false, reason: 'stale_generation' };
    const reason = err instanceof Error ? err.message : 'claim_failed';
    shiftAuthorityDiag('claim.error', { reason });
    deps.flags.setShiftActive(false);
    return { ok: false, reason };
  }
}

export async function recordEnforcedDepartReturn(deps: {
  client?: ShiftAuthorityClient;
  periodId?: string | null;
  gate?: GenerationGate;
}): Promise<{ ok: boolean; reason?: string; recorded?: boolean }> {
  if (stale(deps.gate)) return { ok: false, reason: 'stale_generation' };
  const client = deps.client ?? defaultShiftAuthorityClient();
  const periodId = deps.periodId ?? (await getCurrentShiftId());
  if (!periodId) return { ok: false, reason: 'no_period' };
  try {
    const result = await client.recordDepartReturn(periodId);
    if (stale(deps.gate)) return { ok: false, reason: 'stale_generation' };
    shiftAuthorityDiag('departReturn.outcome', {
      recorded: result.recorded ? 1 : 0,
      originPrefix: result.periodId.slice(0, 10),
    });
    return { ok: true, recorded: result.recorded };
  } catch (err) {
    if (stale(deps.gate)) return { ok: false, reason: 'stale_generation' };
    const reason = err instanceof Error ? err.message : 'depart_failed';
    shiftAuthorityDiag('departReturn.error', { reason });
    return { ok: false, reason };
  }
}

export async function closeEnforcedExplicit(deps: {
  client?: ShiftAuthorityClient;
  periodId?: string | null;
  odometerMiles?: number;
  gate?: GenerationGate;
}): Promise<{ ok: boolean; reason?: string; alreadyClosed?: boolean }> {
  if (stale(deps.gate)) return { ok: false, reason: 'stale_generation' };
  const client = deps.client ?? defaultShiftAuthorityClient();
  const periodId = deps.periodId ?? (await getCurrentShiftId());
  if (!periodId) return { ok: false, reason: 'no_period' };
  try {
    const result = await client.close(periodId, deps.odometerMiles);
    if (stale(deps.gate)) return { ok: false, reason: 'stale_generation' };
    shiftAuthorityDiag('close.outcome', {
      alreadyClosed: result.alreadyClosed ? 1 : 0,
      originPrefix: result.closedPeriodId.slice(0, 10),
    });
    return { ok: true, alreadyClosed: result.alreadyClosed };
  } catch (err) {
    if (stale(deps.gate)) return { ok: false, reason: 'stale_generation' };
    const reason = err instanceof Error ? err.message : 'close_failed';
    shiftAuthorityDiag('close.error', { reason });
    return { ok: false, reason };
  }
}

export {
  decidePostLoginShiftRestore,
  decidePreMintShiftGate,
  isEnforcedExplicitShift,
};
