/**
 * Production entry for the Suite Start Shift → ETC handoff.
 * Legacy shifts, failed claims, and stale sessions never create a request.
 * Passive resume only reconciles a request that already exists.
 */
import { ETC_RELEASE_IDENTITY, type EtcReleaseIdentity } from './etcReleaseIdentity';
import { dispatchStoredEtcStart, unknownHandoff, type EtcHandoffResult, type EtcPort } from './etcStartDispatch';
import { publishEtcNotice } from './etcNoticeStore';
import {
  buildEtcStartRequest,
  newEtcRequestId,
  requestIdentityKey,
} from './etcStartProtocol';
import {
  listEtcStartsForDriver,
  putEtcStartOnce,
  readEtcStart,
  type EtcKv,
} from './etcStartOutbox';

export interface ConfirmedClaim {
  ok: true;
  periodId: string;
}

export interface RefusedClaim {
  ok: false;
  reason: string;
}

/** Legacy, refused, and stale starts must not create an ETC request. */
export function mayEmitEtcStart(input: {
  branch: 'enforced' | 'legacy';
  claimOk: boolean;
  generationCurrent: boolean;
}): boolean {
  return input.branch === 'enforced' && input.claimOk && input.generationCurrent;
}

export async function etcHandoffThatCannotFailShift(
  run: () => Promise<EtcHandoffResult>,
): Promise<EtcHandoffResult> {
  try {
    const result = await run();
    return { ...result, blocksShift: false };
  } catch {
    return unknownHandoff('handoff_error', null);
  }
}

function publish(result: EtcHandoffResult): EtcHandoffResult {
  if (result.driverText) publishEtcNotice(result.driverText);
  return result;
}

export async function attachEtcHandoff(input: {
  claim: ConfirmedClaim | RefusedClaim;
  generationCurrent: boolean;
  isCurrent?: () => boolean;
  companyId: string | null;
  driverId: string;
  nowMs: number;
  activityVisible: boolean;
  kv: EtcKv;
  port: EtcPort;
  identity?: EtcReleaseIdentity;
  timeoutMs?: number;
  newRequestId?: () => string;
}): Promise<EtcHandoffResult> {
  const current = () => input.generationCurrent && (input.isCurrent ? input.isCurrent() : true);
  if (!current()) return unknownHandoff('stale_generation', null, 'skipped');
  if (!input.claim.ok) return unknownHandoff(input.claim.reason || 'claim_not_accepted', null, 'skipped');
  if (!input.driverId) return unknownHandoff('no_driver', null, 'skipped');

  const identityKey = requestIdentityKey({
    companyId: input.companyId,
    driverId: input.driverId,
    suiteShiftId: input.claim.periodId,
  });
  const existing = await readEtcStart(input.kv, identityKey);
  if (!current()) return unknownHandoff('stale_generation', null, 'skipped');
  if (existing.kind === 'corrupt') {
    return publish(unknownHandoff('corrupt_outbox', null));
  }

  let stored = existing.kind === 'ok' ? existing.record : null;
  if (!stored) {
    if (!current()) return unknownHandoff('stale_generation', null, 'skipped');
    const request = buildEtcStartRequest({
      requestId: input.newRequestId ? input.newRequestId() : newEtcRequestId(),
      companyId: input.companyId,
      driverId: input.driverId,
      suiteShiftId: input.claim.periodId,
      requestedAtMs: input.nowMs,
    });
    const wrote = await putEtcStartOnce(input.kv, request);
    if (wrote.corrupt || !wrote.record) return publish(unknownHandoff('corrupt_outbox', null));
    stored = wrote.record;
  }
  if (!current()) return unknownHandoff('stale_generation', stored.request, 'skipped');

  const result = await dispatchStoredEtcStart({
    kv: input.kv,
    stored,
    mode: 'confirmed_start',
    nowMs: input.nowMs,
    activityVisible: input.activityVisible,
    identity: input.identity ?? ETC_RELEASE_IDENTITY,
    port: input.port,
    timeoutMs: input.timeoutMs,
  });
  return publish(result);
}

export async function reconcileEtcOnResume(input: {
  companyId: string | null;
  driverId: string;
  nowMs: number;
  activityVisible: boolean;
  kv: EtcKv;
  port: EtcPort;
  identity?: EtcReleaseIdentity;
  timeoutMs?: number;
}): Promise<EtcHandoffResult[]> {
  const records = await listEtcStartsForDriver(input.kv, input.driverId, input.companyId);
  if (records.length === 0) return [];
  const results: EtcHandoffResult[] = [];
  for (const stored of records) {
    const result = await dispatchStoredEtcStart({
      kv: input.kv,
      stored,
      mode: 'resume',
      nowMs: input.nowMs,
      activityVisible: input.activityVisible,
      identity: input.identity ?? ETC_RELEASE_IDENTITY,
      port: input.port,
      timeoutMs: input.timeoutMs,
    });
    results.push(publish(result));
  }
  return results;
}
