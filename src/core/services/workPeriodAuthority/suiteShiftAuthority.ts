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
  if (cached && originDate) {
    // The cached id's ORIGIN day is where its authoritative open/closed
    // state lives. When that day IS today we reuse the document already
    // fetched — omitting it would make a genuine same-day logout resolve
    // as UNVERIFIED instead of CLOSED (caught red-first by the duration
    // matrix: "resume after a genuine logout").
    cachedOriginDay = originDate === deps.localDate ? today : await deps.fetchDayDoc(originDate);
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

/**
 * vc51.9C clarification 1 — may a CALENDAR-BOUNDARY synthetic logout be
 * written? Only outside active enforcement.
 *
 * An enforced explicit period is owned by the genuine sign-in/Start
 * Shift → logout lifecycle: elapsed hours, midnight, and day boundaries
 * never end it, and crossing midnight never creates a replacement. For
 * legacy/unenforced companies the established DOT-hygiene behavior is
 * preserved unchanged (no canonical authority exists there to consult).
 *
 * Confirmed `invalid` is NOT authorized for synthetic close: a malformed
 * live contract is a diagnostic/fail-closed signal, not a free pass to
 * invent a calendar logout.
 */
export function enforcementAllowsSyntheticClose(enforcement: SuiteEnforcement): boolean {
  return enforcement.state === 'legacy' || enforcement.state === 'inert';
}

// ── Shift-destructive enforcement observation (offline midnight safety) ──
//
// Product rule: once WB-S has positively observed a valid *enforced*
// contract for a company, a transient Firestore/network failure must
// never downgrade that company to `legacy` in a way that authorizes a
// synthetic calendar-day logout.
//
// States distinguished for the synthetic-close decision:
//   confirmed_legacy      — live read: no contract (never-configured)
//   confirmed_inert       — live read: contract present, unenforced
//   confirmed_active      — live read: valid enforced contract
//   confirmed_invalid     — live read: malformed/unsupported contract
//   temporarily_unreadable — load threw / unreadable; may have LKG
//   last_known_good       — durable prior observation used for safety
//
// The 1-hour companyConfig AsyncStorage TTL is a fetch optimization only.
// The safety decision lives in a separate durable, company-scoped store
// that is NOT cleared by cache TTL expiry or clearCompanyConfigCache.

/** How the synthetic-close gate arrived at its decision (diagnostics). */
export type SyntheticCloseObservationSource =
  | 'confirmed_legacy'
  | 'confirmed_inert'
  | 'confirmed_active'
  | 'confirmed_invalid'
  | 'last_known_good'
  | 'temporarily_unreadable_default_legacy'
  | 'missing_company';

export type SyntheticCloseDecision = {
  allow: boolean;
  enforcement: SuiteEnforcement;
  source: SyntheticCloseObservationSource;
  /** True when the live company document could not be read. */
  unreadable: boolean;
};

/** Durable last-known-good payload (company-scoped, no TTL). */
export type LastKnownEnforcement = {
  enforcement: SuiteEnforcement;
  observedAtMs: number;
};

/** Injectable store so unit tests stay free of AsyncStorage / RN. */
export type EnforcementSafetyStore = {
  load: (companyId: string) => Promise<LastKnownEnforcement | null>;
  save: (companyId: string, value: LastKnownEnforcement) => Promise<void>;
};

const ENFORCEMENT_SAFETY_KEY_PREFIX = 'wellbuilt-enforcement-safety-lkg-';

/**
 * Default durable store: AsyncStorage, no TTL. Survives restart and the
 * 1h company-config cache expiry. Intentionally NOT wiped by
 * clearCompanyConfigCache — that is a fetch-cache invalidator, not a
 * safety-state reset. Survives logout (company-level, not session-level).
 */
export function createAsyncStorageEnforcementSafetyStore(
  storage: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
  },
): EnforcementSafetyStore {
  return {
    async load(companyId) {
      try {
        const raw = await storage.getItem(`${ENFORCEMENT_SAFETY_KEY_PREFIX}${companyId}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as LastKnownEnforcement;
        if (!parsed || typeof parsed !== 'object' || !parsed.enforcement) return null;
        if (typeof parsed.observedAtMs !== 'number') return null;
        return parsed;
      } catch {
        return null;
      }
    },
    async save(companyId, value) {
      try {
        await storage.setItem(
          `${ENFORCEMENT_SAFETY_KEY_PREFIX}${companyId}`,
          JSON.stringify(value),
        );
      } catch {
        // Persistence failure must not open a destructive path by itself;
        // the in-memory decision for this call already used the live read.
      }
    },
  };
}

/** In-memory store for deterministic unit tests. */
export function createMemoryEnforcementSafetyStore(
  seed?: Map<string, LastKnownEnforcement>,
): EnforcementSafetyStore {
  const map = seed ?? new Map<string, LastKnownEnforcement>();
  return {
    async load(companyId) {
      return map.get(companyId) ?? null;
    },
    async save(companyId, value) {
      map.set(companyId, value);
    },
  };
}

function observationSourceFor(enforcement: SuiteEnforcement): SyntheticCloseObservationSource {
  switch (enforcement.state) {
    case 'legacy': return 'confirmed_legacy';
    case 'inert': return 'confirmed_inert';
    case 'active': return 'confirmed_active';
    case 'invalid': return 'confirmed_invalid';
  }
}

/**
 * Shift-destructive synthetic-close gate.
 *
 * - Confirmed live reads update durable last-known-good and decide from
 *   the live SuiteEnforcement (legacy/inert allow; active/invalid block).
 * - Unreadable / thrown loads consult last-known-good: if a prior
 *   observation blocks synthetic close, it continues to block.
 * - Never-observed companies stay legacy (allow) — we never promote a
 *   never-configured company to enforced solely because the network failed.
 * - Cache TTL is irrelevant: LKG is separate and durable.
 */
export async function resolveSyntheticCloseDecision(
  companyId: string | null | undefined,
  loadCompanyDoc: (id: string) => Promise<unknown>,
  store: EnforcementSafetyStore,
  nowMs: number = Date.now(),
): Promise<SyntheticCloseDecision> {
  if (!companyId) {
    return {
      allow: true,
      enforcement: { state: 'legacy' },
      source: 'missing_company',
      unreadable: false,
    };
  }

  let raw: unknown;
  let liveReadable = false;
  try {
    raw = await loadCompanyDoc(companyId);
    liveReadable = true;
  } catch {
    liveReadable = false;
  }

  if (liveReadable) {
    // A successful load — including explicit null/absent doc — is a
    // confirmed observation. Null/undefined parses as legacy (never-
    // configured). Malformed contracts parse as invalid (not silent-valid).
    const enforcement = parseSuiteEnforcement(raw ?? undefined);
    try {
      await store.save(companyId, { enforcement, observedAtMs: nowMs });
    } catch {
      // already best-effort inside store.save
    }
    return {
      allow: enforcementAllowsSyntheticClose(enforcement),
      enforcement,
      source: observationSourceFor(enforcement),
      unreadable: false,
    };
  }

  // Temporarily unreadable: never invent "active", never invent a logout
  // when LKG says the company was enforced/invalid.
  const lkg = await store.load(companyId).catch(() => null);
  if (lkg?.enforcement) {
    return {
      allow: enforcementAllowsSyntheticClose(lkg.enforcement),
      enforcement: lkg.enforcement,
      source: 'last_known_good',
      unreadable: true,
    };
  }

  // No prior positive observation → genuine legacy / never-configured.
  return {
    allow: true,
    enforcement: { state: 'legacy' },
    source: 'temporarily_unreadable_default_legacy',
    unreadable: true,
  };
}

/**
 * Resolve the company's enforcement boundary for the app-side gates.
 * `loadCompanyDoc` is injected so this stays node-testable and so the
 * caller owns caching.
 *
 * NOTE: For shift-DESTRUCTIVE decisions (calendar synthetic logout), use
 * `resolveSyntheticCloseDecision` instead — this helper still maps a
 * thrown/unreadable load to legacy for non-destructive activation checks
 * and must not be the sole gate for autoCloseStaleShift.
 */
export async function canonicalEnforcementActive(
  companyId: string | null | undefined,
  loadCompanyDoc: (id: string) => Promise<unknown>,
): Promise<{ enforcement: SuiteEnforcement; active: boolean }> {
  if (!companyId) return { enforcement: { state: 'legacy' }, active: false };
  let raw: unknown;
  try {
    raw = await loadCompanyDoc(companyId);
  } catch {
    return { enforcement: { state: 'legacy' }, active: false };
  }
  const enforcement = parseSuiteEnforcement(raw ?? undefined);
  return { enforcement, active: enforcement.state === 'active' || enforcement.state === 'invalid' };
}
