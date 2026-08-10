/**
 * Thin authenticated client for server-owned explicit-shift authority.
 *
 * Uses the boundary-owned Firebase SDK session (Functions attaches the ID
 * token). Never supplies driverId/companyId. Never logs tokens or claims.
 *
 * Callables: resolveActiveDriverShift | claimDriverShift |
 * recordDepartReturn | closeDriverShift
 */
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp, FIREBASE_REGION } from '../firebaseApp';
import { getOwnedVerifiedIdentity } from '../firebaseAuthBoundary';

export const SHIFT_AUTHORITY_PROTOCOL_VERSION = 1 as const;

export const RESOLVE_ACTIVE_DRIVER_SHIFT = 'resolveActiveDriverShift';
export const CLAIM_DRIVER_SHIFT = 'claimDriverShift';
export const RECORD_DEPART_RETURN = 'recordDepartReturn';
export const CLOSE_DRIVER_SHIFT = 'closeDriverShift';

export const SHIFT_AUTHORITY_TIMEOUT_MS = 15_000;

/** Period id format owned by the product — client proposes, server decides. */
export const PERIOD_ID_RE = /^\d{4}-\d{2}-\d{2}_\d{6}$/;
export const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ShiftAuthorityCallableTransport = (
  name: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
) => Promise<unknown>;

export type ResolveActiveResult =
  | { state: 'open'; periodId: string; originLocalDate: string; protocolVersion: 1 }
  | { state: 'none'; protocolVersion: 1 }
  | { state: 'unverifiable'; reason: string; protocolVersion: 1 };

export type ClaimActiveResult = {
  protocolVersion: 1;
  state: 'open';
  periodId: string;
  originLocalDate: string;
  claimed: boolean;
};

export type DepartReturnResult = {
  protocolVersion: 1;
  periodId: string;
  recorded: boolean;
};

export type CloseActiveResult = {
  protocolVersion: 1;
  state: 'none';
  closedPeriodId: string;
  alreadyClosed: boolean;
};

export type ShiftAuthorityFailureClass =
  | 'driver_session_required'
  | 'driver_not_authoritative'
  | 'driver_inactive'
  | 'authority_absent'
  | 'authority_uninitialized'
  | 'authority_inconsistent'
  | 'driver_mismatch'
  | 'period_mismatch'
  | 'no_open_period'
  | 'period_date_mismatch'
  | 'implausible_origin_local_date'
  | 'invalid_odometer_miles'
  | 'malformed_response'
  | 'transport'
  | 'unknown';

export class ShiftAuthorityError extends Error {
  constructor(
    public readonly failure: ShiftAuthorityFailureClass,
    message: string,
    public readonly httpsCode?: string,
  ) {
    super(message);
    this.name = 'ShiftAuthorityError';
  }
}

const KNOWN_REASONS: ReadonlySet<string> = new Set([
  'driver_session_required',
  'driver_not_authoritative',
  'driver_inactive',
  'authority_absent',
  'authority_uninitialized',
  'authority_inconsistent',
  'driver_mismatch',
  'period_mismatch',
  'no_open_period',
  'period_date_mismatch',
  'implausible_origin_local_date',
  'invalid_odometer_miles',
  'malformed_period',
  'payload_not_object',
]);

export function mapHttpsError(err: unknown): ShiftAuthorityError {
  const code = String((err as { code?: unknown })?.code ?? '').toLowerCase();
  const message = String((err as { message?: unknown })?.message ?? '');
  // Firebase wraps as "functions/failed-precondition" and message often embeds reason.
  const reasonFromMsg = extractReasonToken(message);
  if (reasonFromMsg && KNOWN_REASONS.has(reasonFromMsg)) {
    return new ShiftAuthorityError(
      reasonFromMsg as ShiftAuthorityFailureClass,
      reasonFromMsg,
      code || undefined,
    );
  }
  if (code.includes('unauthenticated') || reasonFromMsg === 'driver_session_required') {
    return new ShiftAuthorityError('driver_session_required', 'driver_session_required', code || undefined);
  }
  if (code.includes('permission-denied')) {
    if (reasonFromMsg === 'driver_inactive') {
      return new ShiftAuthorityError('driver_inactive', 'driver_inactive', code || undefined);
    }
    return new ShiftAuthorityError(
      'driver_not_authoritative',
      reasonFromMsg || 'driver_not_authoritative',
      code || undefined,
    );
  }
  if (code.includes('invalid-argument')) {
    return new ShiftAuthorityError(
      (reasonFromMsg as ShiftAuthorityFailureClass) || 'unknown',
      reasonFromMsg || 'invalid_argument',
      code || undefined,
    );
  }
  if (code.includes('failed-precondition')) {
    return new ShiftAuthorityError(
      (reasonFromMsg as ShiftAuthorityFailureClass) || 'unknown',
      reasonFromMsg || 'failed_precondition',
      code || undefined,
    );
  }
  if (
    code.includes('unavailable')
    || code.includes('deadline')
    || code.includes('resource-exhausted')
    || code.includes('internal')
    || code.includes('network')
  ) {
    return new ShiftAuthorityError('transport', 'callable_unavailable', code || undefined);
  }
  return new ShiftAuthorityError('unknown', reasonFromMsg || 'callable_failed', code || undefined);
}

function extractReasonToken(message: string): string | null {
  if (!message) return null;
  // "FAILED_PRECONDITION: period_mismatch" or bare "period_mismatch"
  const m = message.match(
    /\b(driver_session_required|driver_not_authoritative|driver_inactive|authority_absent|authority_uninitialized|authority_inconsistent|driver_mismatch|period_mismatch|no_open_period|period_date_mismatch|implausible_origin_local_date|invalid_odometer_miles|malformed_period)\b/,
  );
  return m ? m[1] : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireProtocol(raw: Record<string, unknown>): void {
  if (raw.protocolVersion !== SHIFT_AUTHORITY_PROTOCOL_VERSION) {
    throw new ShiftAuthorityError('malformed_response', 'unsupported_protocol_version');
  }
}

export function validateResolveResponse(raw: unknown): ResolveActiveResult {
  if (!isRecord(raw)) throw new ShiftAuthorityError('malformed_response', 'resolve_not_object');
  requireProtocol(raw);
  const state = raw.state;
  if (state === 'none') return { protocolVersion: 1, state: 'none' };
  if (state === 'open') {
    const periodId = raw.periodId;
    const originLocalDate = raw.originLocalDate;
    if (typeof periodId !== 'string' || !PERIOD_ID_RE.test(periodId)) {
      throw new ShiftAuthorityError('malformed_response', 'resolve_open_bad_period');
    }
    if (typeof originLocalDate !== 'string' || !LOCAL_DATE_RE.test(originLocalDate)) {
      throw new ShiftAuthorityError('malformed_response', 'resolve_open_bad_origin');
    }
    if (periodId.slice(0, 10) !== originLocalDate) {
      throw new ShiftAuthorityError('malformed_response', 'resolve_open_period_origin_mismatch');
    }
    return { protocolVersion: 1, state: 'open', periodId, originLocalDate };
  }
  if (state === 'unverifiable') {
    const reason = typeof raw.reason === 'string' && raw.reason ? raw.reason : 'authority_uninitialized';
    return { protocolVersion: 1, state: 'unverifiable', reason };
  }
  throw new ShiftAuthorityError('malformed_response', 'resolve_unknown_state');
}

export function validateClaimResponse(raw: unknown): ClaimActiveResult {
  if (!isRecord(raw)) throw new ShiftAuthorityError('malformed_response', 'claim_not_object');
  requireProtocol(raw);
  if (raw.state !== 'open') throw new ShiftAuthorityError('malformed_response', 'claim_not_open');
  const periodId = raw.periodId;
  const originLocalDate = raw.originLocalDate;
  if (typeof periodId !== 'string' || !PERIOD_ID_RE.test(periodId)) {
    throw new ShiftAuthorityError('malformed_response', 'claim_bad_period');
  }
  if (typeof originLocalDate !== 'string' || !LOCAL_DATE_RE.test(originLocalDate)) {
    throw new ShiftAuthorityError('malformed_response', 'claim_bad_origin');
  }
  if (typeof raw.claimed !== 'boolean') {
    throw new ShiftAuthorityError('malformed_response', 'claim_missing_claimed');
  }
  return {
    protocolVersion: 1,
    state: 'open',
    periodId,
    originLocalDate,
    claimed: raw.claimed,
  };
}

export function validateDepartReturnResponse(raw: unknown): DepartReturnResult {
  if (!isRecord(raw)) throw new ShiftAuthorityError('malformed_response', 'depart_not_object');
  requireProtocol(raw);
  const periodId = raw.periodId;
  if (typeof periodId !== 'string' || !PERIOD_ID_RE.test(periodId)) {
    throw new ShiftAuthorityError('malformed_response', 'depart_bad_period');
  }
  if (typeof raw.recorded !== 'boolean') {
    throw new ShiftAuthorityError('malformed_response', 'depart_missing_recorded');
  }
  return { protocolVersion: 1, periodId, recorded: raw.recorded };
}

export function validateCloseResponse(raw: unknown): CloseActiveResult {
  if (!isRecord(raw)) throw new ShiftAuthorityError('malformed_response', 'close_not_object');
  requireProtocol(raw);
  if (raw.state !== 'none') throw new ShiftAuthorityError('malformed_response', 'close_not_none');
  const closedPeriodId = raw.closedPeriodId;
  if (typeof closedPeriodId !== 'string' || !PERIOD_ID_RE.test(closedPeriodId)) {
    throw new ShiftAuthorityError('malformed_response', 'close_bad_period');
  }
  if (typeof raw.alreadyClosed !== 'boolean') {
    throw new ShiftAuthorityError('malformed_response', 'close_missing_alreadyClosed');
  }
  return {
    protocolVersion: 1,
    state: 'none',
    closedPeriodId,
    alreadyClosed: raw.alreadyClosed,
  };
}

/** Odometer for close is total shift miles (end − start), not absolute reading. */
export function normalizeOdometerMiles(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new ShiftAuthorityError('invalid_odometer_miles', 'invalid_odometer_miles');
  }
  const n = Math.round(raw);
  if (n < 0 || n > 5000) {
    throw new ShiftAuthorityError('invalid_odometer_miles', 'invalid_odometer_miles');
  }
  return n;
}

/** Production transport: real httpsCallable on the project region. */
export const realShiftAuthorityTransport: ShiftAuthorityCallableTransport = async (
  name,
  payload,
  timeoutMs,
) => {
  const fns = getFunctions(getFirebaseApp(), FIREBASE_REGION);
  const callable = httpsCallable(fns, name, { timeout: timeoutMs });
  const result = await callable(payload);
  return result.data;
};

/**
 * True when the owned SDK session is a driver session with driverId + companyId.
 * Does not log claims. forceRefresh optional for critical mutations.
 */
export async function isCallableReadyDriverSession(forceRefresh = false): Promise<boolean> {
  try {
    const identity = await getOwnedVerifiedIdentity(getFirebaseApp(), forceRefresh);
    return !!(
      identity
      && identity.kind === 'driver'
      && identity.driverId
      && identity.companyId
    );
  } catch {
    return false;
  }
}

export type ShiftAuthorityClient = {
  resolve: () => Promise<ResolveActiveResult>;
  claim: (periodId: string, originLocalDate: string) => Promise<ClaimActiveResult>;
  recordDepartReturn: (periodId: string) => Promise<DepartReturnResult>;
  close: (periodId: string, odometerMiles?: number) => Promise<CloseActiveResult>;
};

/**
 * Build a client over an injectable transport (tests use fakes).
 * Production always uses realShiftAuthorityTransport.
 */
export function createShiftAuthorityClient(
  transport: ShiftAuthorityCallableTransport = realShiftAuthorityTransport,
  opts?: { requireSession?: () => Promise<boolean> },
): ShiftAuthorityClient {
  const requireSession = opts?.requireSession
    ?? (() => isCallableReadyDriverSession(true));

  async function call(name: string, payload: Record<string, unknown>): Promise<unknown> {
    const ready = await requireSession();
    if (!ready) {
      throw new ShiftAuthorityError('driver_session_required', 'driver_session_required');
    }
    try {
      return await transport(name, payload, SHIFT_AUTHORITY_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof ShiftAuthorityError) throw err;
      throw mapHttpsError(err);
    }
  }

  return {
    async resolve() {
      const raw = await call(RESOLVE_ACTIVE_DRIVER_SHIFT, {});
      return validateResolveResponse(raw);
    },
    async claim(periodId, originLocalDate) {
      if (!PERIOD_ID_RE.test(periodId) || !LOCAL_DATE_RE.test(originLocalDate)) {
        throw new ShiftAuthorityError('period_date_mismatch', 'malformed_period_proposal');
      }
      if (periodId.slice(0, 10) !== originLocalDate) {
        throw new ShiftAuthorityError('period_date_mismatch', 'period_date_mismatch');
      }
      // Exact keys only — never driverId/companyId/date/type.
      const raw = await call(CLAIM_DRIVER_SHIFT, { periodId, originLocalDate });
      return validateClaimResponse(raw);
    },
    async recordDepartReturn(periodId) {
      if (!PERIOD_ID_RE.test(periodId)) {
        throw new ShiftAuthorityError('period_mismatch', 'malformed_period');
      }
      const raw = await call(RECORD_DEPART_RETURN, { periodId });
      return validateDepartReturnResponse(raw);
    },
    async close(periodId, odometerMiles) {
      if (!PERIOD_ID_RE.test(periodId)) {
        throw new ShiftAuthorityError('period_mismatch', 'malformed_period');
      }
      const payload: Record<string, unknown> = { periodId };
      if (odometerMiles !== undefined) {
        payload.odometerMiles = normalizeOdometerMiles(odometerMiles);
      }
      const raw = await call(CLOSE_DRIVER_SHIFT, payload);
      return validateCloseResponse(raw);
    },
  };
}

/** Nonsecret diagnostic line — never tokens/hashes/passcodes. */
export function shiftAuthorityDiag(
  event: string,
  extra?: Record<string, string | number | boolean | null | undefined>,
): void {
  const safe: Record<string, string | number | boolean | null> = {};
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) continue;
      // Refuse anything that looks like a secret-bearing key.
      if (/token|passcode|hash|secret|credential|receipt/i.test(k)) continue;
      safe[k] = v;
    }
  }
  console.log(JSON.stringify({ tag: '[shiftAuthority]', event, ...safe }));
}
