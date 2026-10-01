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
import { isReturnAttemptId } from './returnAttempt';

export const SHIFT_AUTHORITY_PROTOCOL_VERSION = 1 as const;

export const RESOLVE_ACTIVE_DRIVER_SHIFT = 'resolveActiveDriverShift';
export const CLAIM_DRIVER_SHIFT = 'claimDriverShift';
export const RECORD_DEPART_RETURN = 'recordDepartReturn';
export const RECORD_RETURN_ABANDONED = 'recordReturnAbandoned';
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

export type ReturnAbandonedResult = {
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

/**
 * Reason tokens the SERVER can send, and the single source of truth for both
 * the recognized-reason set and the extractor regex below.
 *
 * These two used to be written out separately and had drifted: the extractor
 * could not match `malformed_attempt` or `payload_not_object`, so when the
 * server sent either, `mapHttpsError` fell through to the literal
 * 'invalid_argument' and the driver was shown a generic "the app and server
 * need a matching update" with no way to tell WHICH field was rejected. That is
 * what the MikeS24 Return-to-Yard refusal looked like on 2026-09-30. Deriving
 * both from this one list is what stops them drifting again.
 *
 * Longest-first so a token can never be shadowed by a shorter prefix of itself.
 */
export const SHIFT_AUTHORITY_REASON_TOKENS = [
  'implausible_origin_local_date',
  'malformed_period_proposal',
  'driver_not_authoritative',
  'driver_session_required',
  'authority_uninitialized',
  'authority_inconsistent',
  'invalid_odometer_miles',
  'period_date_mismatch',
  'payload_not_object',
  'authority_absent',
  'malformed_attempt',
  'malformed_period',
  'driver_mismatch',
  'driver_inactive',
  'period_mismatch',
  'no_open_period',
  'unknown_fields',
] as const;

export type ShiftAuthorityServerReason = (typeof SHIFT_AUTHORITY_REASON_TOKENS)[number];

/** Server reasons plus the three the client itself raises. */
export type ShiftAuthorityFailureClass =
  | ShiftAuthorityServerReason
  | 'malformed_response'
  | 'transport'
  | 'unknown';

/**
 * Structured error data a callable may return alongside its message.
 * Only ever the sanitized subset — see sanitizeShiftAuthorityDetails.
 */
export type ShiftAuthorityDetails = Readonly<Record<string, string | number | boolean>>;

export class ShiftAuthorityError extends Error {
  constructor(
    public readonly failure: ShiftAuthorityFailureClass,
    message: string,
    public readonly httpsCode?: string,
    /** Sanitized `err.details`, which mapHttpsError previously discarded. */
    public readonly details?: ShiftAuthorityDetails,
  ) {
    super(message);
    this.name = 'ShiftAuthorityError';
  }
}

/**
 * Keys worth surfacing from a callable's `details`. Deliberately a small
 * allowlist of STRUCTURAL facts about the rejected request — which field, what
 * was expected — and never anything that could carry identity, credentials or
 * location. Anything not named here is dropped, so a server that starts
 * returning richer details cannot leak them through this client.
 *
 * The allowlist is the whole key-level mechanism on purpose. An earlier draft
 * also carried a deny-regex for credential-ish key names; mutation testing
 * showed it could never fire, because every key it named was already absent
 * from this list. Unreachable protection reads as a guarantee it does not
 * provide, so it is gone. Widening THIS list is the thing to review carefully.
 */
const DETAIL_KEY_ALLOWLIST: ReadonlySet<string> = new Set([
  'reason',
  'field',
  'fields',
  'unknownfields',
  'unexpectedkeys',
  'expectedkeys',
  'expected',
  'received',
  'pattern',
  'minlength',
  'maxlength',
  'length',
  'protocolversion',
]);


const DETAIL_VALUE_MAX = 120;
const DETAIL_MAX_KEYS = 8;

/** Values that look like an identity or a secret, whatever key they arrived under. */
function looksSensitive(value: string): boolean {
  if (/@/.test(value)) return true;                        // email-ish
  if (/^eyJ[A-Za-z0-9_-]{6,}\./.test(value)) return true;   // JWT header prefix
  if (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{8,}/.test(value)) return true;  // long dotted token
  if (/^[0-9+()\s-]{9,}$/.test(value)) return true;         // phone-ish
  if (/-?\d{1,3}\.\d{4,}/.test(value)) return true;         // coordinate-ish
  return false;
}

function cleanDetailString(value: string): string | null {
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!trimmed) return null;
  if (looksSensitive(trimmed)) return null;
  return trimmed.length > DETAIL_VALUE_MAX ? trimmed.slice(0, DETAIL_VALUE_MAX) : trimmed;
}

/**
 * Narrow, allowlisted projection of a callable's `details`.
 * Returns undefined when nothing survives, so callers can tell "no details"
 * from "details that said nothing useful".
 */
export function sanitizeShiftAuthorityDetails(raw: unknown): ShiftAuthorityDetails | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (kept >= DETAIL_MAX_KEYS) break;
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!DETAIL_KEY_ALLOWLIST.has(normalized)) continue;
    if (typeof value === 'boolean') {
      out[key] = value;
      kept += 1;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;
      out[key] = value;
      kept += 1;
    } else if (typeof value === 'string') {
      const clean = cleanDetailString(value);
      if (clean === null) continue;
      out[key] = clean;
      kept += 1;
    } else if (Array.isArray(value)) {
      const items = value
        .filter((v): v is string => typeof v === 'string')
        .map(cleanDetailString)
        .filter((v): v is string => v !== null)
        .slice(0, 5);
      if (!items.length) continue;
      out[key] = items.join(',').slice(0, DETAIL_VALUE_MAX);
      kept += 1;
    }
    // objects / nested structures are never surfaced
  }
  return kept ? Object.freeze(out) : undefined;
}

const KNOWN_REASONS: ReadonlySet<string> = new Set(SHIFT_AUTHORITY_REASON_TOKENS);

export function mapHttpsError(err: unknown): ShiftAuthorityError {
  const code = String((err as { code?: unknown })?.code ?? '').toLowerCase();
  const message = String((err as { message?: unknown })?.message ?? '');
  const details = sanitizeShiftAuthorityDetails((err as { details?: unknown })?.details);

  // Firebase wraps as "functions/failed-precondition" and the message often
  // embeds the reason. A callable may instead put it in `details.reason`, which
  // this used to ignore entirely.
  const reasonFromMsg = extractReasonToken(message)
    ?? (typeof details?.reason === 'string' ? extractReasonToken(details.reason) : null);

  // A `details.field` names the offending field when the message did not.
  const detailField = typeof details?.field === 'string'
    ? details.field
    : typeof details?.fields === 'string'
      ? details.fields
      : null;

  /** token, or token:field when the field is known and not already present. */
  const withField = (token: string): string =>
    (detailField && !token.includes(':')) ? `${token}:${detailField}` : token;

  if (reasonFromMsg && KNOWN_REASONS.has(reasonTokenHead(reasonFromMsg))) {
    const reason = withField(reasonFromMsg);
    return new ShiftAuthorityError(failureClassFor(reason), reason, code || undefined, details);
  }
  if (code.includes('unauthenticated') || reasonTokenHead(reasonFromMsg ?? '') === 'driver_session_required') {
    return new ShiftAuthorityError('driver_session_required', 'driver_session_required', code || undefined, details);
  }
  if (code.includes('permission-denied')) {
    if (reasonTokenHead(reasonFromMsg ?? '') === 'driver_inactive') {
      return new ShiftAuthorityError('driver_inactive', 'driver_inactive', code || undefined, details);
    }
    return new ShiftAuthorityError(
      'driver_not_authoritative',
      reasonFromMsg || 'driver_not_authoritative',
      code || undefined,
      details,
    );
  }
  if (code.includes('invalid-argument')) {
    // Unrecognised reason: say invalid_argument, but keep whatever safe field
    // the server named rather than throwing the whole thing away.
    const fallback = detailField ? `invalid_argument:${detailField}` : 'invalid_argument';
    const reason = reasonFromMsg ? withField(reasonFromMsg) : fallback;
    return new ShiftAuthorityError(failureClassFor(reason), reason, code || undefined, details);
  }
  if (code.includes('failed-precondition')) {
    const reason = reasonFromMsg ? withField(reasonFromMsg) : 'failed_precondition';
    return new ShiftAuthorityError(failureClassFor(reason), reason, code || undefined, details);
  }
  if (
    code.includes('unavailable')
    || code.includes('deadline')
    || code.includes('resource-exhausted')
    || code.includes('internal')
    || code.includes('network')
  ) {
    return new ShiftAuthorityError('transport', 'callable_unavailable', code || undefined, details);
  }
  return new ShiftAuthorityError('unknown', reasonFromMsg || 'callable_failed', code || undefined, details);
}

/**
 * Built from SHIFT_AUTHORITY_REASON_TOKENS so it can never fall behind the set
 * of reasons the server can send. The optional `:suffix` captures the field a
 * reason refers to, e.g. "unknown_fields:attemptId".
 */
const REASON_TOKEN_RE = new RegExp(
  `\\b(${SHIFT_AUTHORITY_REASON_TOKENS.join('|')})(?::([A-Za-z0-9_,-]{1,64}))?\\b`,
);

/**
 * Pull the server's reason out of "FAILED_PRECONDITION: period_mismatch",
 * a bare "malformed_attempt", or "unknown_fields:attemptId".
 */
export function extractReasonToken(message: string): string | null {
  if (!message) return null;
  const m = message.match(REASON_TOKEN_RE);
  if (!m) return null;
  return m[2] ? `${m[1]}:${m[2]}` : m[1];
}

/** The bare token, without any `:field` suffix. */
export function reasonTokenHead(reason: string): string {
  const head = reason.split(':', 1)[0];
  return head || reason;
}

/**
 * The failure class for a reason string. A reason the client does not
 * recognise — including the generic `invalid_argument` fallback — classifies as
 * 'unknown'; only declared server tokens become their own class, so `failure`
 * stays a closed set that callers can switch on.
 */
function failureClassFor(reason: string): ShiftAuthorityFailureClass {
  const head = reasonTokenHead(reason);
  return KNOWN_REASONS.has(head) ? (head as ShiftAuthorityFailureClass) : 'unknown';
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

export function validateReturnAbandonedResponse(raw: unknown): ReturnAbandonedResult {
  if (!isRecord(raw)) throw new ShiftAuthorityError('malformed_response', 'abandon_not_object');
  requireProtocol(raw);
  const periodId = raw.periodId;
  if (typeof periodId !== 'string' || !PERIOD_ID_RE.test(periodId)) {
    throw new ShiftAuthorityError('malformed_response', 'abandon_bad_period');
  }
  if (typeof raw.recorded !== 'boolean') {
    throw new ShiftAuthorityError('malformed_response', 'abandon_missing_recorded');
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
  recordDepartReturn: (periodId: string, attemptId: string) => Promise<DepartReturnResult>;
  recordReturnAbandoned: (periodId: string, attemptId: string) => Promise<ReturnAbandonedResult>;
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
    async recordDepartReturn(periodId, attemptId) {
      if (!PERIOD_ID_RE.test(periodId)) {
        throw new ShiftAuthorityError('period_mismatch', 'malformed_period');
      }
      if (!isReturnAttemptId(attemptId)) {
        throw new ShiftAuthorityError('malformed_attempt', 'malformed_attempt');
      }
      const raw = await call(RECORD_DEPART_RETURN, { periodId, attemptId });
      return validateDepartReturnResponse(raw);
    },
    async recordReturnAbandoned(periodId, attemptId) {
      if (!PERIOD_ID_RE.test(periodId)) {
        throw new ShiftAuthorityError('period_mismatch', 'malformed_period');
      }
      if (!isReturnAttemptId(attemptId)) {
        throw new ShiftAuthorityError('malformed_attempt', 'malformed_attempt');
      }
      const raw = await call(RECORD_RETURN_ABANDONED, { periodId, attemptId });
      return validateReturnAbandonedResponse(raw);
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
