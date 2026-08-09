/**
 * Post-login / pre-mint explicit-shift restoration against canonical authority.
 *
 * Does NOT invent a second work-period resolver. Uses
 * verifyCachedShiftAgainstAuthority → resolveWorkPeriod only.
 *
 * Missing cached shiftId: no safe unbounded discovery seam exists on the
 * client. Do not treat "today absent" as proof of no open overnight shift.
 * That case is fail-closed for UI mint enablement unless the canonical
 * verifier returns a positive no_shift with a present-but-empty today
 * AND no cache (same-day no-open only). Overnight without cache remains
 * an architectural gap (documented).
 */
import type { CachedShiftVerdict, DayDoc, SuiteEnforcement } from './suiteShiftAuthority';
import { mayUseDateFallback, verifyCachedShiftAgainstAuthority } from './suiteShiftAuthority';

export type ShiftUiRestoreAction =
  | {
      kind: 'restore_active';
      periodId: string;
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
      shiftStartTimeIso: null,
    };
  }
  if (verdict.verdict === 'verified_closed') {
    return { kind: 'inactive_allow_start', reason: verdict.reason };
  }
  if (verdict.verdict === 'no_shift') {
    // Positive no-open only when the verifier said so with the evidence given.
    // Callers must not pass a fabricated empty today for overnight without cache.
    return { kind: 'inactive_allow_start', reason: verdict.reason };
  }
  // unverified
  return { kind: 'block_start', reason: verdict.reason };
}

/**
 * Decide post-login shift UI from enforcement + cache + authority.
 *
 * Under active explicit_shift:
 *  - never blind-clear without consulting authority when cache exists
 *  - missing cache → block_start (no discovery seam; do not assume no shift)
 * Under legacy/inert:
 *  - may fall back to local flags or clean inactive start
 */
export async function decidePostLoginShiftRestore(deps: {
  enforcement: SuiteEnforcement;
  cachedShiftId: string | null;
  localDate: LocalDateString;
  nowMs: number;
  companyId: string;
  driverId: string;
  fetchDayDoc: (date: string) => Promise<DayDoc>;
  /** Prior local flags only used outside active explicit enforcement */
  localShiftStarted?: boolean;
}): Promise<ShiftUiRestoreAction> {
  const { enforcement, cachedShiftId } = deps;

  // Enforced explicit_shift — authority owns restoration
  if (enforcement.state === 'active' && enforcement.mode === 'explicit_shift') {
    if (!cachedShiftId) {
      // Architectural gap: cannot discover open overnight shifts without cache.
      // Fail closed — do not enable Start Shift from "today missing" alone.
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

  // invalid enforcement: fail closed (no mint from unknown contract)
  if (enforcement.state === 'invalid') {
    return { kind: 'block_start', reason: `enforcement_invalid:${enforcement.reason}` };
  }

  // legacy / inert — retain prior local-flag behavior when present
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
 * Pre-mint gate: may Start Shift mint a new id under this enforcement?
 * Does not rely on React shiftActive alone.
 */
export async function decidePreMintShiftGate(deps: {
  enforcement: SuiteEnforcement;
  cachedShiftId: string | null;
  localDate: LocalDateString;
  nowMs: number;
  companyId: string;
  driverId: string;
  fetchDayDoc: (date: string) => Promise<DayDoc>;
}): Promise<
  | { allowMint: true; reason: string }
  | { allowMint: false; reason: string; openPeriodId?: string }
> {
  // Outside enforcement, date fallback / established DOT hygiene may mint.
  if (mayUseDateFallback(deps.enforcement)) {
    return { allowMint: true, reason: 'legacy_or_inert' };
  }

  if (deps.enforcement.state !== 'active' || deps.enforcement.mode !== 'explicit_shift') {
    return { allowMint: false, reason: 'enforcement_not_active_explicit' };
  }

  // Enforced explicit_shift: always re-verify before mint.
  if (!deps.cachedShiftId) {
    // Without cache we cannot prove no overnight open shift.
    // Residual blocker: refuse mint rather than dual-open risk.
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
  // closed or no_shift with a cache that was re-checked — allow mint
  return { allowMint: true, reason: verdict.reason };
}

/** Derive a plausible ISO start time from shift id wall-clock (local, not authoritative GPS). */
export function shiftStartIsoFromShiftId(shiftId: string): string | null {
  // `${YYYY-MM-DD}_${HHMMSS}` — best-effort local wall time for UI timer only.
  const m = shiftId.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  // Construct as local Date components
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
