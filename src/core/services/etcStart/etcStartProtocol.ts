/**
 * Suite → ETC start-of-shift handoff contract.
 *
 * Checkpoint from the ETC receiver (not re-verified against that repo here):
 * authority `com.wellbuilt.electronictimecard.suitehos`; methods capabilities,
 * prepareStart, getStartStatus, cancelStart. The request is one JSON object
 * in a Bundle string. The extra key name was not specified; this module uses
 * `request` outbound and `result` inbound until the contract confirms them.
 * ETC's release allowlist is intentionally empty, and Suite does not embed
 * an ETC package name or signing certificate.
 */

export const ETC_PROVIDER_AUTHORITY = 'com.wellbuilt.electronictimecard.suitehos';
export const ETC_REQUEST_BUNDLE_KEY = 'request';
export const ETC_RESULT_BUNDLE_KEY = 'result';
export const ETC_PENDING_INTENT_BUNDLE_KEY = 'pendingIntent';
export const ETC_PROTOCOL_VERSION = 1;
export const ETC_START_ACTION = 'start_hos' as const;
export const ETC_MAX_PAYLOAD_BYTES = 8192;
export const ETC_REQUEST_MAX_AGE_MS = 10 * 60 * 1000;
export const ETC_REQUEST_MAX_FUTURE_SKEW_MS = 30 * 1000;
export const ETC_DISPATCH_TIMEOUT_MS = 4000;

export const ETC_METHODS = ['capabilities', 'prepareStart', 'getStartStatus', 'cancelStart'] as const;
export type EtcMethod = (typeof ETC_METHODS)[number];

export const ETC_STATES = ['prepared', 'processing', 'completed', 'rejected', 'cancelled', 'expired'] as const;
export const ETC_HOS = ['not_started', 'unknown', 'started', 'already_active'] as const;
export const ETC_GPS = ['unknown', 'starting', 'ready', 'unavailable', 'disabled'] as const;

export type EtcState = (typeof ETC_STATES)[number];
export type EtcHos = (typeof ETC_HOS)[number];
export type EtcGps = (typeof ETC_GPS)[number];

export interface EtcStartRequest {
  protocolVersion: 1;
  action: 'start_hos';
  requestId: string;
  companyId: string | null;
  driverId: string;
  suiteShiftId: string;
  requestedAtMs: number;
}

export interface EtcProviderResponse {
  state: EtcState | 'unknown';
  hos: EtcHos;
  gps: EtcGps;
  etcShiftId?: string;
  reason?: string;
  gpsObservedAtMs?: number;
  observedAtMs?: number;
}

export type EtcFreshness = 'fresh' | 'expired' | 'future_skew';

const REQUEST_KEYS = [
  'protocolVersion',
  'action',
  'requestId',
  'companyId',
  'driverId',
  'suiteShiftId',
  'requestedAtMs',
] as const;

export function newEtcRequestId(fill?: (bytes: Uint8Array) => void): string {
  const bytes = new Uint8Array(16);
  if (fill) fill(bytes);
  else if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildEtcStartRequest(input: {
  requestId: string;
  companyId: string | null;
  driverId: string;
  suiteShiftId: string;
  requestedAtMs: number;
}): EtcStartRequest {
  return {
    protocolVersion: ETC_PROTOCOL_VERSION,
    action: ETC_START_ACTION,
    requestId: input.requestId,
    companyId: input.companyId,
    driverId: input.driverId,
    suiteShiftId: input.suiteShiftId,
    requestedAtMs: input.requestedAtMs,
  };
}

export function encodeEtcStartRequest(request: EtcStartRequest): string {
  return JSON.stringify({
    protocolVersion: request.protocolVersion,
    action: request.action,
    requestId: request.requestId,
    companyId: request.companyId,
    driverId: request.driverId,
    suiteShiftId: request.suiteShiftId,
    requestedAtMs: request.requestedAtMs,
  });
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function etcRequestByteLength(request: EtcStartRequest): number {
  return utf8ByteLength(encodeEtcStartRequest(request));
}

export function requestIdentityKey(request: Pick<EtcStartRequest, 'companyId' | 'driverId' | 'suiteShiftId'>): string {
  return JSON.stringify([ETC_START_ACTION, request.companyId, request.driverId, request.suiteShiftId]);
}

export function classifyEtcFreshness(requestedAtMs: number, nowMs: number): EtcFreshness {
  if (requestedAtMs - nowMs > ETC_REQUEST_MAX_FUTURE_SKEW_MS) return 'future_skew';
  if (nowMs - requestedAtMs > ETC_REQUEST_MAX_AGE_MS) return 'expired';
  return 'fresh';
}

export function isTerminalEtcResult(hos: EtcHos | null, state: EtcState | 'unknown' | null): boolean {
  if (hos === 'started' || hos === 'already_active') return true;
  return state === 'completed' || state === 'rejected' || state === 'cancelled' || state === 'expired';
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseEtcProviderResponse(raw: unknown): EtcProviderResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const state = oneOf(body.state, ETC_STATES) ?? 'unknown';
  const hos = oneOf(body.hos, ETC_HOS) ?? 'unknown';
  const gps = oneOf(body.gps, ETC_GPS) ?? 'unknown';
  const response: EtcProviderResponse = { state, hos, gps };
  if (typeof body.etcShiftId === 'string' && body.etcShiftId) response.etcShiftId = body.etcShiftId;
  if (typeof body.reason === 'string' && body.reason) response.reason = body.reason;
  if (typeof body.gpsObservedAtMs === 'number' && Number.isFinite(body.gpsObservedAtMs)) {
    response.gpsObservedAtMs = body.gpsObservedAtMs;
  }
  if (typeof body.observedAtMs === 'number' && Number.isFinite(body.observedAtMs)) {
    response.observedAtMs = body.observedAtMs;
  }
  return response;
}

/** Honest driver copy. Unknown HOS is never described as started. */
export function etcDriverText(input: { hos: EtcHos; gps: EtcGps }): string {
  const hosLine = input.hos === 'started' || input.hos === 'already_active'
    ? 'ETC hours of service: started.'
    : 'ETC hours of service: not confirmed.';
  const gpsLine = input.gps === 'unavailable' || input.gps === 'disabled'
    ? ' GPS is not ready.'
    : '';
  return hosLine + gpsLine;
}

export function sameEtcRequest(a: EtcStartRequest, b: EtcStartRequest): boolean {
  return encodeEtcStartRequest(a) === encodeEtcStartRequest(b);
}

export function assertExactRequestShape(request: EtcStartRequest): string | null {
  const encoded = encodeEtcStartRequest(request);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(encoded) as Record<string, unknown>;
  } catch {
    return 'malformed_json';
  }
  const keys = Object.keys(parsed);
  if (keys.length !== REQUEST_KEYS.length || REQUEST_KEYS.some((key, i) => keys[i] !== key)) {
    return 'unexpected_keys';
  }
  if (parsed.protocolVersion !== 1 || parsed.action !== ETC_START_ACTION) return 'bad_protocol';
  if (typeof parsed.requestId !== 'string' || !parsed.requestId) return 'bad_request_id';
  if (!(parsed.companyId === null || typeof parsed.companyId === 'string')) return 'bad_company';
  if (typeof parsed.driverId !== 'string' || !parsed.driverId) return 'bad_driver';
  if (typeof parsed.suiteShiftId !== 'string' || !parsed.suiteShiftId) return 'bad_period';
  if (typeof parsed.requestedAtMs !== 'number' || !Number.isFinite(parsed.requestedAtMs)) return 'bad_time';
  if (utf8ByteLength(encoded) > ETC_MAX_PAYLOAD_BYTES) return 'payload_too_large';
  return null;
}
