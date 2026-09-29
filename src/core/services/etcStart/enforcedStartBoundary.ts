/**
 * Best-effort ETC step after a server-confirmed enforced Start Shift.
 * Loading or running ETC must not change the Suite claim result.
 * The accepted period binding is owned by the caller and is not cleared here.
 */
import type { EtcHandoffResult, EtcPort } from './etcStartDispatch';
import type { EtcKv } from './etcStartOutbox';
import type { EtcReleaseIdentity } from './etcReleaseIdentity';

export interface AcceptedShiftBinding {
  periodId: string;
  originLocalDate: string;
}

export type EnforcedClaimDecision =
  | { ok: true; periodId: string; originLocalDate: string; claimed?: boolean }
  | { ok: false; reason: string };

export interface EtcShiftOutcome {
  hos: string;
  gps: string;
  driverText: string;
  blocksShift: false;
}

export interface EtcRuntime {
  mayEmitEtcStart(input: {
    branch: 'enforced' | 'legacy';
    claimOk: boolean;
    generationCurrent: boolean;
  }): boolean;
  etcHandoffThatCannotFailShift(
    run: () => Promise<EtcHandoffResult>,
  ): Promise<EtcHandoffResult>;
  attachEtcHandoff(input: {
    claim: { ok: true; periodId: string } | { ok: false; reason: string };
    generationCurrent: boolean;
    isCurrent?: () => boolean;
    companyId: string | null;
    driverId: string;
    nowMs: number;
    activityVisible: boolean;
    kv: EtcKv;
    port: EtcPort;
    identity?: EtcReleaseIdentity;
  }): Promise<EtcHandoffResult>;
  createEtcPort(activityVisible: boolean): EtcPort;
  productionEtcKv(): EtcKv;
}

export type SettledEnforcedStart =
  | { ok: true; etc: EtcShiftOutcome; binding: AcceptedShiftBinding }
  | { ok: false; reason: string; binding: AcceptedShiftBinding | null };

export const ETC_UNCONFIRMED_OUTCOME: EtcShiftOutcome = {
  hos: 'unknown',
  gps: 'unknown',
  driverText: 'ETC hours of service: not confirmed.',
  blocksShift: false,
};

async function defaultLoadEtc(): Promise<EtcRuntime> {
  const handoff = await import('./attachEtcHandoff');
  const production = await import('./etcProduction');
  return {
    mayEmitEtcStart: handoff.mayEmitEtcStart,
    etcHandoffThatCannotFailShift: handoff.etcHandoffThatCannotFailShift,
    attachEtcHandoff: handoff.attachEtcHandoff,
    createEtcPort: production.createEtcPort,
    productionEtcKv: production.productionEtcKv,
  };
}

async function publishUnconfirmed(): Promise<void> {
  try {
    const { publishEtcNotice } = await import('./etcNoticeStore');
    publishEtcNotice(ETC_UNCONFIRMED_OUTCOME.driverText);
  } catch {
    // The shift result still carries the same text when the notice module fails.
  }
}

/**
 * Refused claims and stale generations return failure and do not load ETC.
 * A confirmed current claim returns Suite success even when ETC's module import throws.
 */
export async function settleEnforcedShiftClaim(input: {
  claim: EnforcedClaimDecision;
  binding: AcceptedShiftBinding | null;
  isCurrent: () => boolean;
  companyId: string | null;
  driverId: string;
  activityVisible: boolean;
  nowMs?: number;
  kv?: EtcKv;
  port?: EtcPort;
  identity?: EtcReleaseIdentity;
  loadEtc?: () => Promise<EtcRuntime>;
}): Promise<SettledEnforcedStart> {
  if (!input.claim.ok) {
    return { ok: false, reason: input.claim.reason || 'claim_not_accepted', binding: input.binding };
  }
  const binding: AcceptedShiftBinding = input.binding ?? {
    periodId: input.claim.periodId,
    originLocalDate: input.claim.originLocalDate,
  };
  if (!input.isCurrent()) {
    return { ok: false, reason: 'stale_generation', binding };
  }
  if (binding.periodId !== input.claim.periodId) {
    return { ok: true, etc: ETC_UNCONFIRMED_OUTCOME, binding };
  }

  let etc: EtcShiftOutcome = ETC_UNCONFIRMED_OUTCOME;
  try {
    const runtime = await (input.loadEtc ?? defaultLoadEtc)();
    if (!input.isCurrent()) return { ok: false, reason: 'stale_generation', binding };
    if (runtime.mayEmitEtcStart({
      branch: 'enforced',
      claimOk: true,
      generationCurrent: true,
    })) {
      const kv = input.kv ?? runtime.productionEtcKv();
      const port = input.port ?? runtime.createEtcPort(input.activityVisible);
      const periodId = input.claim.periodId;
      const handoff = await runtime.etcHandoffThatCannotFailShift(() => runtime.attachEtcHandoff({
        claim: { ok: true, periodId },
        generationCurrent: true,
        isCurrent: input.isCurrent,
        companyId: input.companyId,
        driverId: input.driverId,
        nowMs: input.nowMs ?? Date.now(),
        activityVisible: input.activityVisible,
        kv,
        port,
        identity: input.identity,
      }));
      etc = {
        hos: handoff.hos,
        gps: handoff.gps,
        driverText: handoff.driverText || ETC_UNCONFIRMED_OUTCOME.driverText,
        blocksShift: false,
      };
    }
  } catch (err) {
    console.warn('[startShift] ETC module did not change the Suite shift:', err);
    etc = ETC_UNCONFIRMED_OUTCOME;
    await publishUnconfirmed();
  }

  if (!input.isCurrent()) return { ok: false, reason: 'stale_generation', binding };
  return { ok: true, etc, binding };
}
