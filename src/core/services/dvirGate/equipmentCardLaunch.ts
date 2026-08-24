/**
 * Home eQuipment card launch contract.
 *
 * Never a silent no-op while a required DVIR is outstanding.
 * Never emits hash/name/passcode/token. Never writes a completion receipt.
 */
import type { DvirReceiptPhase } from './receiptTypes';

export type EquipmentCardDecision =
  | { action: 'open_equipment_credential_free' }
  | { action: 'launch_pre_trip'; shiftId: string }
  | { action: 'launch_post_trip'; shiftId: string };

export function decideEquipmentCardLaunch(input: {
  shiftActive: boolean;
  openPeriodId: string | null;
  preTripComplete: boolean;
  postTripComplete: boolean;
  pendingEndShiftId: string | null;
}): EquipmentCardDecision {
  if (!input.shiftActive || !input.openPeriodId) {
    return { action: 'open_equipment_credential_free' };
  }
  const period = input.openPeriodId;
  if (!input.preTripComplete) {
    return { action: 'launch_pre_trip', shiftId: period };
  }
  const pendingMatches = !!input.pendingEndShiftId && input.pendingEndShiftId === period;
  if (!input.postTripComplete && pendingMatches) {
    return { action: 'launch_post_trip', shiftId: period };
  }
  // Same open period, Pre-Trip done, Post-Trip still required to end shift.
  if (!input.postTripComplete) {
    return { action: 'launch_post_trip', shiftId: period };
  }
  return { action: 'open_equipment_credential_free' };
}

export type EquipmentCardLaunchDeps = {
  shiftActive: boolean;
  getOpenPeriodId: () => Promise<string | null>;
  isPreTripComplete: (shiftId: string) => Promise<boolean>;
  isPostTripComplete: (shiftId: string) => Promise<boolean>;
  getPendingEndShiftId: () => Promise<string | null>;
  launchPhase: (
    phase: DvirReceiptPhase,
    shiftId: string,
  ) => Promise<{ launched: boolean; error?: string }>;
  openEquipmentCredentialFree: () => Promise<void>;
  confirmLeave?: (phase: DvirReceiptPhase) => Promise<boolean>;
};

export type EquipmentCardLaunchResult = {
  action: EquipmentCardDecision['action'];
  launched: boolean;
  shiftId: string | null;
  phase: DvirReceiptPhase | null;
};

export async function runEquipmentCardLaunch(
  deps: EquipmentCardLaunchDeps,
): Promise<EquipmentCardLaunchResult> {
  const openPeriodId = deps.shiftActive ? await deps.getOpenPeriodId() : null;
  const preTripComplete = openPeriodId ? await deps.isPreTripComplete(openPeriodId) : true;
  const postTripComplete = openPeriodId ? await deps.isPostTripComplete(openPeriodId) : true;
  const pendingEndShiftId = await deps.getPendingEndShiftId();
  const decision = decideEquipmentCardLaunch({
    shiftActive: deps.shiftActive,
    openPeriodId,
    preTripComplete,
    postTripComplete,
    pendingEndShiftId,
  });

  if (decision.action === 'open_equipment_credential_free') {
    await deps.openEquipmentCredentialFree();
    return {
      action: decision.action,
      launched: true,
      shiftId: openPeriodId,
      phase: null,
    };
  }

  const phase: DvirReceiptPhase =
    decision.action === 'launch_pre_trip' ? 'pre_trip' : 'post_trip';
  if (deps.confirmLeave) {
    const ok = await deps.confirmLeave(phase);
    if (!ok) {
      return { action: decision.action, launched: false, shiftId: decision.shiftId, phase };
    }
  }
  const launched = await deps.launchPhase(phase, decision.shiftId);
  return {
    action: decision.action,
    launched: launched.launched,
    shiftId: decision.shiftId,
    phase,
  };
}
