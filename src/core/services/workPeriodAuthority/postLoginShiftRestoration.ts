/**
 * Post-login / pre-mint explicit-shift restoration against canonical authority.
 *
 * Enforced explicit_shift empty-cache path uses server resolveActiveDriverShift
 * (injected). Cache present still verifies origin-day day docs when no server
 * resolve is supplied, or prefers server resolve when provided.
 *
 * Legacy/inert keep local-flag / date-fallback behavior.
 */
import type { CachedShiftVerdict, DayDoc, SuiteEnforcement } from './suiteShiftAuthority';
import { mayUseDateFallback, verifyCachedShiftAgainstAuthority } from './suiteShiftAuthority';
import type { ResolveActiveResult } from './shiftAuthorityClient';

export type ShiftUiRestoreAction =
  | {
      kind: 'restore_active';
      periodId: string;
      originLocalDate?: string;
      /** ISO start time if known from local evidence; null → keep/leave unset */
      shiftStartTimeIso: string | null;
    }
  | {
      kind: 'inactive_allow_start';
      reason: string;
    }
  | {
      kind: 'block_start';
      reason: string;
    };

export type LocalDateString = string; // YYYY-MM-DD

/** Origin day from canonical shift id `${YYYY-MM-DD}_${HHMMSS}`. */
export function originDateFromShiftId(shiftId: string | null | undefined): string | null {
  if (!shiftId || !/^\d{4}-\d{2}-\d{2}/.test(shiftId)) return null;
  return shiftId.slice(0, 10);
}

export function isEnforcedExplicitShift(enforcement: SuiteEnforcement): boolean {
  return enforcement.state === 'active' && enforcement.mode === 'explicit_shift';
}

/**
 * Map a cached-shift authority verdict to local UI/persistence actions.
 * Requires periodId equality on verified_open (caller must pass the cache used).
 */
export function mapVerdictToRestoreAction(
  verdict: CachedShiftVerdict,
  cachedShiftId: string | null,
): ShiftUiRestoreAction {
  if (verdict.verdict === 'verified_open') {
    if (!cachedShiftId || verdict.periodId !== cachedShiftId) {
      return { kind: 'block_start', reason: 'period_id_mismatch' };
    }
    return {
      kind: 'restore_active',
      periodId: verdict.periodId,
      originLocalDate: originDateFromShiftId(verdict.periodId) || undefined,
      shiftStartTimeIso: null,
    };
  }
  if (verdict.verdict === 'verified_closed') {
    return { kind: 'inactive_allow_start', reason: verdict.reason };
  }
  if (verdict.verdict === 'no_shift') {
    return { kind: 'inactive_allow_start', reason: verdict.reason };
  }
  return { kind: 'block_start', reason: verdict.reason };
}

/** Map server resolveActiveDriverShift result to UI restore action. */
export function mapServerResolveToRestoreAction(resolved: ResolveActiveResult): ShiftUiRestoreAction {
  if (resolved.state === 'open') {
    return {
      kind: 'restore_active',
      periodId: resolved.periodId,
      originLocalDate: resolved.originLocalDate,
      shiftStartTimeIso: null,
    };
  }
  if (resolved.state === 'none') {
    return { kind: 'inactive_allow_start', reason: 'server_none' };
  }
  return { kind: 'block_start', reason: `server_unverifiable:${resolved.reason}` };
}

/**
 * Decide post-login shift UI from enforcement + cache + authority.
 *
 * Under active explicit_shift:
 *  - prefer server resolve when `resolveServer` is provided (authoritative)
 *  - with cache and no server: origin-day day-doc verify (legacy path)
 *  - without cache and no server: block (no discovery)
 * Under legacy/inert: local flags
 */
export async function decidePostLoginShiftRestore(deps: {
  enforcement: SuiteEnforcement;
  cachedShiftId: string | null;
  localDate: LocalDateString;
  nowMs: number;
  companyId: string;
  driverId: string;
  fetchDayDoc: (date: string) => Promise<DayDoc>;
  localShiftStarted?: boolean;
  /** Server-owned active-shift pointer (required for empty-cache under enforcement). */
  resolveServer?: () => Promise<ResolveActiveResult>;
}): Promise<ShiftUiRestoreAction> {
  const { enforcement, cachedShiftId } = deps;

  if (isEnforcedExplicitShift(enforcement)) {
    if (deps.resolveServer) {
      try {
        const resolved = await deps.resolveServer();
        return mapServerResolveToRestoreAction(resolved);
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'resolve_failed';
        return { kind: 'block_start', reason: `server_resolve_error:${reason}` };
      }
    }
    if (!cachedShiftId) {
      // No server client wired — fail closed (pre-integration residual).
      return {
        kind: 'block_start',
        reason: 'missing_cache_no_safe_discovery',
      };
    }
    const verdict = await verifyCachedShiftAgainstAuthority({
      companyId: deps.companyId,
      driverId: deps.driverId,
      cachedShiftId,
      localDate: deps.localDate,
      nowMs: deps.nowMs,
      fetchDayDoc: deps.fetchDayDoc,
    });
    return mapVerdictToRestoreAction(verdict, cachedShiftId);
  }

  if (enforcement.state === 'invalid') {
    return { kind: 'block_start', reason: `enforcement_invalid:${enforcement.reason}` };
  }

  if (deps.localShiftStarted) {
    return {
      kind: 'restore_active',
      periodId: cachedShiftId || '',
      shiftStartTimeIso: null,
    };
  }
  return { kind: 'inactive_allow_start', reason: 'legacy_or_inert_no_local_flags' };
}

/**
 * Pre-mint / pre-claim gate under enforcement.
 * When resolveServer provided: only allow claim when server says none.
 * open → refuse with openPeriodId; unverifiable → refuse.
 */
export async function decidePreMintShiftGate(deps: {
  enforcement: SuiteEnforcement;
  cachedShiftId: string | null;
  localDate: LocalDateString;
  nowMs: number;
  companyId: string;
  driverId: string;
  fetchDayDoc: (date: string) => Promise<DayDoc>;
  resolveServer?: () => Promise<ResolveActiveResult>;
}): Promise<
  | { allowMint: true; reason: string }
  | { allowMint: false; reason: string; openPeriodId?: string; openOriginLocalDate?: string }
> {
  if (mayUseDateFallback(deps.enforcement)) {
    return { allowMint: true, reason: 'legacy_or_inert' };
  }

  if (!isEnforcedExplicitShift(deps.enforcement)) {
    return { allowMint: false, reason: 'enforcement_not_active_explicit' };
  }

  if (deps.resolveServer) {
    try {
      const resolved = await deps.resolveServer();
      if (resolved.state === 'none') {
        return { allowMint: true, reason: 'server_none' };
      }
      if (resolved.state === 'open') {
        return {
          allowMint: false,
          reason: 'open_explicit_shift_exists',
          openPeriodId: resolved.periodId,
          openOriginLocalDate: resolved.originLocalDate,
        };
      }
      return { allowMint: false, reason: `server_unverifiable:${resolved.reason}` };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'resolve_failed';
      return { allowMint: false, reason: `server_resolve_error:${reason}` };
    }
  }

  if (!deps.cachedShiftId) {
    return { allowMint: false, reason: 'missing_cache_no_safe_discovery' };
  }

  const verdict = await verifyCachedShiftAgainstAuthority({
    companyId: deps.companyId,
    driverId: deps.driverId,
    cachedShiftId: deps.cachedShiftId,
    localDate: deps.localDate,
    nowMs: deps.nowMs,
    fetchDayDoc: deps.fetchDayDoc,
  });

  if (verdict.verdict === 'verified_open') {
    return {
      allowMint: false,
      reason: 'open_explicit_shift_exists',
      openPeriodId: verdict.periodId,
    };
  }
  if (verdict.verdict === 'unverified') {
    return { allowMint: false, reason: `authority_unreadable:${verdict.reason}` };
  }
  return { allowMint: true, reason: verdict.reason };
}

export type ColdStartFlagDecision =
  | 'set_active'
  | 'set_inactive'
  | 'preserve_active_offline'
  | 'leave_inactive';

export function decideColdStartFlagAction(input: {
  priorLocalActive: boolean;
  action: ShiftUiRestoreAction;
}): ColdStartFlagDecision {
  if (input.action.kind === 'restore_active') return 'set_active';
  if (input.action.kind === 'inactive_allow_start') return 'set_inactive';
  if (input.priorLocalActive) return 'preserve_active_offline';
  return 'leave_inactive';
}

/** Derive a plausible ISO start time from shift id wall-clock (local, not authoritative GPS). */
export function shiftStartIsoFromShiftId(shiftId: string): string | null {
  const m = shiftId.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const dt = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  );
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

/**
 * UI authority state for Home / Start Shift card (enforced explicit path).
 * checking → none → open | unavailable
 */
export type ShiftAuthorityUiState =
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'open'; periodId: string; originLocalDate: string }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'legacy' };

export function restoreActionToUiState(action: ShiftUiRestoreAction): ShiftAuthorityUiState {
  if (action.kind === 'restore_active' && action.periodId) {
    return {
      kind: 'open',
      periodId: action.periodId,
      originLocalDate: action.originLocalDate || originDateFromShiftId(action.periodId) || '',
    };
  }
  if (action.kind === 'inactive_allow_start') return { kind: 'none' };
  return { kind: 'unavailable', reason: action.kind === 'block_start' ? action.reason : 'blocked' };
}

/** Checklist / Start Shift only when authority is none (or legacy). */
export function mayOpenStartShiftChecklist(ui: ShiftAuthorityUiState): boolean {
  return ui.kind === 'none' || ui.kind === 'legacy';
}
