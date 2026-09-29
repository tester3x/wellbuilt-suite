/**
 * Fail-closed dispatch. A missing native bridge, unverified signing
 * configuration, hidden Activity, or timed-out call never becomes proof
 * that HOS failed or permission to mint another request.
 */
import { isEtcDispatchConfigured, type EtcReleaseIdentity } from './etcReleaseIdentity';
import {
  ETC_DISPATCH_TIMEOUT_MS,
  ETC_METHODS,
  type EtcGps,
  type EtcHos,
  type EtcMethod,
  type EtcStartRequest,
  type EtcState,
  acceptEchoedEtcStatus,
  assertExactRequestShape,
  classifyEtcFreshness,
  encodeEtcStartRequest,
  etcDriverText,
  isTerminalEtcResult,
} from './etcStartProtocol';
import { saveEtcStartObservation, type EtcKv, type StoredEtcStart } from './etcStartOutbox';

export type EtcPortFailure =
  | 'absent'
  | 'untrusted'
  | 'permission_denied'
  | 'timeout'
  | 'bridge_error'
  | 'signing_unverified'
  | 'dispatch_disabled'
  | 'native_unavailable'
  | 'package_mismatch'
  | 'pending_intent_creator_mismatch'
  | 'illegal_argument'
  | 'token_send_failed'
  | 'malformed_response';

export type EtcPortResult =
  | {
      ok: true;
      response: unknown;
      startIntent: 'absent' | 'present' | 'sent';
      pendingIntentCreatorPackage?: string | null;
    }
  | { ok: false; reason: EtcPortFailure };

export interface EtcPort {
  available: boolean;
  call(method: EtcMethod, payload: string): Promise<EtcPortResult>;
}

export interface EtcHandoffResult {
  emitted: boolean;
  blocksShift: false;
  request: EtcStartRequest | null;
  hos: EtcHos;
  gps: EtcGps;
  state: EtcState | 'unknown';
  transport: 'skipped' | 'not_sent' | 'sent' | 'reconciled';
  reason: string;
  driverText: string;
  etcShiftId?: string;
  observedAtMs?: number;
  gpsObservedAtMs?: number;
}

export function unknownHandoff(reason: string, request: EtcStartRequest | null, transport: EtcHandoffResult['transport'] = 'not_sent'): EtcHandoffResult {
  return {
    emitted: request !== null,
    blocksShift: false,
    request,
    hos: 'unknown',
    gps: 'unknown',
    state: 'unknown',
    transport,
    reason,
    driverText: request ? etcDriverText({ hos: 'unknown', gps: 'unknown' }) : '',
  };
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const UNKNOWN_PORT_REASONS = new Set<EtcPortFailure>([
  'timeout',
  'bridge_error',
  'token_send_failed',
  'malformed_response',
  'absent',
  'illegal_argument',
  'permission_denied',
  'untrusted',
]);

/**
 * A startIntent is observation only. Absent is valid. Present-but-unsent or a
 * creator mismatch is not success. Sent is not proof the service ran.
 */
function classifyStartIntent(
  method: EtcMethod,
  result: Extract<EtcPortResult, { ok: true }>,
  identity: EtcReleaseIdentity,
): 'none' | 'accept' | { reason: string } {
  if (method !== 'prepareStart' || result.startIntent === 'absent') return 'none';
  const creator = result.pendingIntentCreatorPackage ?? null;
  if (!identity.etcPackageName || creator !== identity.etcPackageName) {
    return { reason: 'pending_intent_creator_mismatch' };
  }
  if (result.startIntent !== 'sent') return { reason: 'start_intent_not_sent' };
  return 'accept';
}

export async function dispatchStoredEtcStart(input: {
  kv: EtcKv;
  stored: StoredEtcStart;
  mode: 'confirmed_start' | 'resume';
  nowMs: number;
  activityVisible: boolean;
  identity: EtcReleaseIdentity;
  port: EtcPort;
  timeoutMs?: number;
}): Promise<EtcHandoffResult> {
  const request = input.stored.request;
  const shape = assertExactRequestShape(request);
  if (shape) return unknownHandoff(shape, request);

  const freshness = classifyEtcFreshness(request.requestedAtMs, input.nowMs);
  const terminal = isTerminalEtcResult(input.stored.lastHos, input.stored.lastState);
  const resume = input.mode === 'resume';
  let method: EtcMethod | null = null;
  let reason = 'not_sent';

  if (resume || terminal || input.stored.dispatchUncertain || freshness !== 'fresh') {
    method = 'getStartStatus';
    reason = resume ? 'resume_reconcile' : freshness !== 'fresh' ? freshness : terminal ? 'already_result' : 'dispatch_uncertain';
  } else if (!input.activityVisible) {
    return unknownHandoff('activity_not_visible', request);
  } else if (!isEtcDispatchConfigured(input.identity)) {
    return unknownHandoff('signing_unverified', request);
  } else if (!input.port.available) {
    return unknownHandoff('native_unavailable', request);
  } else {
    method = 'prepareStart';
    reason = 'prepare_start';
  }

  if (method === 'getStartStatus' && !isEtcDispatchConfigured(input.identity)) {
    return unknownHandoff('signing_unverified', request, 'reconciled');
  }
  if (method === 'getStartStatus' && !input.port.available) {
    return unknownHandoff('native_unavailable', request, 'reconciled');
  }
  if (!method || !ETC_METHODS.includes(method)) return unknownHandoff(reason, request);

  const payload = encodeEtcStartRequest(request);
  let portResult: EtcPortResult;
  try {
    portResult = await withTimeout(
      input.port.call(method, payload),
      input.timeoutMs ?? ETC_DISPATCH_TIMEOUT_MS,
    );
  } catch {
    await saveEtcStartObservation(input.kv, request, {
      dispatchUncertain: true,
      lastHos: input.stored.lastHos,
      lastState: input.stored.lastState,
      lastGps: input.stored.lastGps,
    });
    return unknownHandoff('timeout', request, method === 'getStartStatus' ? 'reconciled' : 'not_sent');
  }

  if (!portResult.ok) {
    const uncertain = UNKNOWN_PORT_REASONS.has(portResult.reason) || input.stored.dispatchUncertain;
    await saveEtcStartObservation(input.kv, request, {
      dispatchUncertain: uncertain,
      lastHos: input.stored.lastHos,
      lastState: input.stored.lastState,
      lastGps: input.stored.lastGps,
    });
    return unknownHandoff(portResult.reason, request, method === 'getStartStatus' ? 'reconciled' : 'not_sent');
  }

  const intent = classifyStartIntent(method, portResult, input.identity);
  if (typeof intent === 'object') {
    await saveEtcStartObservation(input.kv, request, {
      dispatchUncertain: true,
      lastHos: 'unknown',
      lastState: 'unknown',
      lastGps: 'unknown',
    });
    return unknownHandoff(intent.reason, request);
  }

  const response = acceptEchoedEtcStatus(request, portResult.response);
  if (!response) {
    await saveEtcStartObservation(input.kv, request, {
      dispatchUncertain: true,
      lastHos: 'unknown',
      lastState: 'unknown',
      lastGps: 'unknown',
    });
    return unknownHandoff('echo_mismatch', request);
  }

  // A sent token only resumes observation. Until ETC reports a terminal HOS
  // result, that send is not proof the service executed.
  const observationUnproven = intent === 'accept' && !isTerminalEtcResult(response.hos, response.state);
  await saveEtcStartObservation(input.kv, request, {
    dispatchUncertain: observationUnproven,
    lastHos: observationUnproven ? input.stored.lastHos : response.hos,
    lastState: observationUnproven ? input.stored.lastState : response.state,
    lastGps: observationUnproven ? input.stored.lastGps : response.gps,
  });
  if (observationUnproven) {
    return unknownHandoff('observation_unconfirmed', request);
  }
  const handoff: EtcHandoffResult = {
    emitted: true,
    blocksShift: false,
    request,
    hos: response.hos,
    gps: response.gps,
    state: response.state,
    transport: method === 'prepareStart' ? 'sent' : 'reconciled',
    reason,
    driverText: etcDriverText(response),
    etcShiftId: response.etcShiftId,
    observedAtMs: response.observedAtMs,
    gpsObservedAtMs: response.gpsObservedAtMs,
  };
  return handoff;
}
