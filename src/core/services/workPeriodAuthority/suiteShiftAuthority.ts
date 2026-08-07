// suiteShiftAuthority.ts — vc51.9C canonical work-period authority for WB-S.
//
// WB-S is the SOLE explicit-shift lifecycle owner. This module does not
// add a second lifecycle — it wraps the existing single open/close
// mutation (shiftTracking.recordShiftEvent) with the canonical
// @tester3x/wellbuilt-contracts decisions so that:
//
//   - a cached shift id is a HINT, verified against the authoritative
//     driver_shifts day documents through resolveWorkPeriod before it is
//     ever presented as current;
//   - a closed/superseded cached id is cleared, never reopened;
//   - unreadable/offline authority yields UNVERIFIED — never "open";
//   - no date-derived shift id is fabricated under enforcement;
//   - legacy/unenforced companies keep today's behavior (inert).
//
// Enforcement boundary (same shape as the reviewed WB-T/WB-JSA
// adapters — app glue, not package logic): the company document's
// wellbuiltContract decides legacy / inert / active / invalid.

import {
  CONTRACT_VERSION,
  isOperationallyOpen,
  resolveWorkPeriod,
  type WorkPeriodMode,
  type WorkPeriodResolution,
} from '@tester3x/wellbuilt-contracts';

export type SuiteEnforcement =
  | { state: 'legacy' }
  | { state: 'inert' }
  | { state: 'active'; mode: WorkPeriodMode;
      derivedConfig?: { timezone?: string; startLocalTime?: string; durationMinutes?: number } }
  | { state: 'invalid'; reason: string };

/** Company doc → activation boundary. Absent contract → legacy; tier is
 *  presentation only and NEVER activates enforcement. */
export function parseSuiteEnforcement(raw: unknown): SuiteEnforcement {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const contract = doc.wellbuiltContract as Record<string, unknown> | undefined;
  if (contract === undefined) return { state: 'legacy' };
  if (typeof contract !== 'object' || contract === null || Array.isArray(contract)) {
    return { state: 'invalid', reason: 'contract_not_object' };
  }
  if (contract.contractEnforced !== true) return { state: 'inert' };
  if (contract.contractVersion !== 1) {
    return { state: 'invalid', reason: `unsupported_contract_version:${String(contract.contractVersion)}` };
  }
  const wpc = contract.workPeriodConfiguration as Record<string, unknown> | undefined;
  const mode = wpc?.mode;
  if (mode !== 'explicit_shift' && mode !== 'company_defined_period') {
    return { state: 'invalid', reason: 'missing_or_unknown_work_period_mode' };
  }
  if (mode === 'company_defined_period' &&
      (typeof wpc?.timezone !== 'string' || typeof wpc?.startLocalTime !== 'string'
        || typeof wpc?.durationMinutes !== 'number')) {
    return { state: 'invalid', reason: 'incomplete_derived_configuration' };
  }
  return {
    state: 'active', mode,
    ...(mode === 'company_defined_period' ? {
      derivedConfig: {
        timezone: wpc?.timezone as string,
        startLocalTime: wpc?.startLocalTime as string,
        durationMinutes: wpc?.durationMinutes as number,
      },
    } : {}),
  };
}

export type DayDoc = { readable: boolean; present: boolean; currentShiftId?: string };

export type CachedShiftVerdict =
  | { verdict: 'verified_open'; periodId: string; resolution: WorkPeriodResolution }
  | { verdict: 'verified_closed'; reason: string }
  | { verdict: 'no_shift'; reason: string }
  | { verdict: 'unverified'; reason: string };

/**
 * Judge the cached shift id against AUTHORITY through the canonical
 * resolver (today's day doc + the cached id's origin day for overnight
 * shifts). Callers clear the cache on 'verified_closed', keep it (but
 * never present it as current) on 'unverified', and only present
 * 'verified_open' as the current shift.
 */
export async function verifyCachedShiftAgainstAuthority(deps: {
  companyId: string;
  driverId: string;
  cachedShiftId: string | null;
  localDate: string;
  nowMs: number;
  fetchDayDoc: (date: string) => Promise<DayDoc>;
}): Promise<CachedShiftVerdict> {
  const today = await deps.fetchDayDoc(deps.localDate);
  let cachedOriginDay: DayDoc | null = null;
  const cached = deps.cachedShiftId;
  const originDate = cached && /^\d{4}-\d{2}-\d{2}/.test(cached) ? cached.slice(0, 10) : null;
  if (cached && originDate && originDate !== deps.localDate) {
    cachedOriginDay = await deps.fetchDayDoc(originDate);
  }
  const resolution = resolveWorkPeriod({
    contractVersion: CONTRACT_VERSION,
    companyId: deps.companyId,
    driverId: deps.driverId,
    capabilities: {
      contractVersion: CONTRACT_VERSION,
      companyId: deps.companyId,
      suiteLoginRequired: true,
      workPeriodMode: 'explicit_shift',
      explicitShiftRequiredBeforeJobs: true,
      jsaEnabled: true,
      dvirEnabled: true,
      customerEditableFields: [],
    },
    config: { contractVersion: CONTRACT_VERSION, configurationVersion: 1, mode: 'explicit_shift' },
    evidence: { today, cachedShiftId: cached, cachedOriginDay },
    nowMs: deps.nowMs,
    todayLocalDate: deps.localDate,
  });
  switch (resolution.outcome) {
    case 'ACTIVE_EXPLICIT_SHIFT':
      return isOperationallyOpen(resolution)
        ? { verdict: 'verified_open', periodId: resolution.periodId, resolution }
        : { verdict: 'verified_closed', reason: 'not_operationally_open' };
    case 'CLOSED_OR_SUPERSEDED':
      return { verdict: 'verified_closed', reason: resolution.reason };
    case 'NO_ACTIVE_SHIFT':
      return { verdict: 'no_shift', reason: resolution.reason };
    case 'UNVERIFIED_OFFLINE':
      return { verdict: 'unverified', reason: resolution.reason };
    default:
      return { verdict: 'unverified', reason: resolution.outcome };
  }
}

/**
 * May a date-derived fallback shift id be used for scoping?
 * ONLY outside active enforcement — an enforced company never fabricates
 * a period from the calendar.
 */
export function mayUseDateFallback(enforcement: SuiteEnforcement): boolean {
  return enforcement.state === 'legacy' || enforcement.state === 'inert';
}
