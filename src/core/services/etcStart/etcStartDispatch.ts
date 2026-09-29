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
  type EtcProviderResponse,
  type EtcStartRequest,
  type EtcState,
  assertExactRequestShape,
  classifyEtcFreshness,
  encodeEtcStartRequest,
  etcDriverText,
  isTerminalEtcResult,
  parseEtcProviderResponse,
} from './etcStartProtocol';
import { saveEtcStartObservation, type EtcKv, type StoredEtcStart } from './etcStartOutbox';

export type EtcPortFailure =
  | 'absent'
  | 'untrusted'
  | 'permission_denied'
  | 'timeout'
  | 'bridge_error'
  | 'signing_unverified'
  | 'native_unavailable'
  | 'package_mismatch'
  | 'pending_intent_creator_mismatch';

export type EtcPortResult =
  | {
      ok: true;
      response: unknown;
      pendingIntentCreatorPackage?: string | null;
      pendingIntentSent?: boolean;
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

function trustedResponse(
  method: EtcMethod,
  result: Extract<EtcPortResult, { ok: true }>,
  identity: EtcReleaseIdentity,
): { response: EtcProviderResponse } | { reason: string } {
  if (method === 'prepareStart') {
    const creator = result.pendingIntentCreatorPackage ?? null;
    if (!identity.etcPackageName || creator !== identity.etcPackageName) {
      return { reason: 'pending_intent_creator_mismatch' };
    }
    if (result.pendingIntentSent === false) {
      return { reason: 'pending_intent_not_sent' };
    }
  }
  const response = parseEtcProviderResponse(result.response);
  if (!response) return { reason: 'malformed_response' };
  return { response };
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
    const uncertain = portResult.reason === 'timeout' || portResult.reason === 'bridge_error';
    await saveEtcStartObservation(input.kv, request, {
      dispatchUncertain: uncertain || input.stored.dispatchUncertain,
      lastHos: input.stored.lastHos,
      lastState: input.stored.lastState,
      lastGps: input.stored.lastGps,
    });
    return unknownHandoff(portResult.reason, request, method === 'getStartStatus' ? 'reconciled' : 'not_sent');
  }

  const trusted = trustedResponse(method, portResult, input.identity);
  if ('reason' in trusted) {
    await saveEtcStartObservation(input.kv, request, {
      dispatchUncertain: true,
      lastHos: 'unknown',
      lastState: 'unknown',
      lastGps: 'unknown',
    });
    return unknownHandoff(trusted.reason, request);
  }

  const response = trusted.response;
  await saveEtcStartObservation(input.kv, request, {
    dispatchUncertain: false,
    lastHos: response.hos,
    lastState: response.state,
    lastGps: response.gps,
  });
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
