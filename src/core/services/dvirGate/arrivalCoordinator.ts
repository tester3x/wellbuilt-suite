/**
 * The one place the two-stage arrival is executed.
 *
 * arrivalFlow.ts holds the decisions; this composes them with the real gate
 * (receipt store, shift binding, WB-E launch). Both receipt-return paths —
 * app/_layout's warm DvirReceiptListener and app/dvir-complete's cold route —
 * call `handlePostTripReceipt` here, so a warm return and a cold launch cannot
 * reach different outcomes and a duplicate delivery cannot act twice.
 *
 * Nothing in this module closes a shift. The close is the driver's final
 * submit, and it stays in AuthContext.confirmArrival.
 */
import type { DvirGateDeps } from './dvirGateService';
import { isPostTripCompleteForShift, launchEquipmentPhase } from './dvirGateService';
import {
  beginArrival,
  onPostTripReceipt,
  canSubmitFinal,
  afterFinalSubmit,
  resumeArrivalView,
  readArrivalRecord,
  writeArrivalRecord,
  clearArrivalRecord,
  type ArrivalRecord,
  type ResumeView,
} from './arrivalFlow';

export type MarkArrivedResult = {
  /** The driver is at the yard and the record is durable. */
  arrived: boolean;
  /** WB-E Post-Trip was launched for this shift. */
  launched: boolean;
  /** Post-Trip is already satisfied — show the final modal now. */
  showFinalModal: boolean;
  shiftId: string | null;
  reason?: string;
};

/**
 * Stage 1. Records a durable arrival and hands off to WB-E immediately —
 * before any mileage or checkbox. Never closes or logs out.
 */
export async function markArrived(
  deps: DvirGateDeps,
  opts?: { nowIso?: string },
): Promise<MarkArrivedResult> {
  const shiftId = await deps.getCurrentShiftId();
  if (!shiftId) {
    return { arrived: false, launched: false, showFinalModal: false, shiftId: null, reason: 'No active shift' };
  }
  const postTripAlreadyComplete = await isPostTripCompleteForShift(deps, shiftId);
  const existing = await readArrivalRecord(deps.kv);
  const decision = beginArrival({
    shiftId,
    nowIso: opts?.nowIso ?? new Date().toISOString(),
    postTripAlreadyComplete,
    existing,
  });

  // Persist BEFORE launching: a process death during the handoff must still
  // come back to an arrived shift, not to the en-route card.
  await writeArrivalRecord(deps.kv, decision.record);

  if (!decision.launchPostTrip) {
    return { arrived: true, launched: false, showFinalModal: true, shiftId };
  }

  const { launched, error } = await launchEquipmentPhase(deps, 'post_trip', shiftId);
  if (!launched) {
    // Arrival stands; the driver retries the handoff from the arrived state.
    // DVIR is NOT shown as done and the final modal is NOT opened.
    return {
      arrived: true,
      launched: false,
      showFinalModal: false,
      shiftId,
      reason: error || 'Could not open the Post-Trip inspection',
    };
  }
  return { arrived: true, launched: true, showFinalModal: false, shiftId };
}

/**
 * Stage 2. The single transition for BOTH receipt-return routes.
 * Returns whether the final mileage modal should now be shown. Never closes.
 */
export async function handlePostTripReceipt(
  deps: DvirGateDeps,
  receipt: { shiftId: string; phase: string },
  shiftActive: boolean,
): Promise<{ openFinalModal: boolean; reason?: string; shiftId?: string }> {
  const record = await readArrivalRecord(deps.kv);
  const decision = onPostTripReceipt({
    record,
    receiptShiftId: receipt.shiftId,
    receiptPhase: receipt.phase,
    shiftActive,
  });
  if (decision.action === 'ignore') {
    return { openFinalModal: false, reason: decision.reason };
  }
  await writeArrivalRecord(deps.kv, decision.record);
  return { openFinalModal: true, shiftId: decision.record.shiftId };
}

/** What a cold start or a return to Home should put back on screen. */
export async function getResumeArrivalView(
  deps: DvirGateDeps,
  opts: { shiftActive: boolean },
): Promise<ResumeView> {
  const record = await readArrivalRecord(deps.kv);
  const activeShiftId = await deps.getCurrentShiftId();
  const postTripReceiptValid = record && activeShiftId && record.shiftId === activeShiftId
    ? await isPostTripCompleteForShift(deps, activeShiftId)
    : false;
  return resumeArrivalView({
    record,
    activeShiftId,
    shiftActive: opts.shiftActive,
    postTripReceiptValid,
  });
}

/** Is the final modal's DVIR row satisfied? Derived from the receipt only. */
export async function postTripSatisfiedForCurrentShift(deps: DvirGateDeps): Promise<boolean> {
  const shiftId = await deps.getCurrentShiftId();
  if (!shiftId) return false;
  return isPostTripCompleteForShift(deps, shiftId);
}

export type FinalizeResult =
  | { ok: true }
  | { ok: false; reason: string; recoverable: true };

/**
 * Stage 3. Checks every condition, then runs the caller's close exactly once.
 *
 * `close` is AuthContext.confirmArrival. On success the arrival record is
 * cleared and the caller may promote the odometer prefill; on failure the
 * record and the typed reading are kept so the modal stays recoverable.
 */
export async function finalizeArrival(
  deps: DvirGateDeps,
  opts: {
    paperworkConfirmed: boolean;
    odometerMiles?: number;
    close: (odometerMiles?: number) => Promise<boolean>;
    onPrefillOdometer?: (miles: number) => Promise<void> | void;
  },
): Promise<FinalizeResult> {
  const shiftId = await deps.getCurrentShiftId();
  const record = await readArrivalRecord(deps.kv);
  const postTripReceiptValid = shiftId ? await isPostTripCompleteForShift(deps, shiftId) : false;

  const check = canSubmitFinal({
    record,
    shiftId: shiftId || '',
    postTripReceiptValid,
    paperworkConfirmed: opts.paperworkConfirmed,
    odometerMiles: opts.odometerMiles,
  });
  if (!check.ok) return { ok: false, reason: check.reason, recoverable: true };

  let closed = false;
  try {
    closed = await opts.close(check.odometerMiles);
  } catch {
    closed = false;
  }

  const after = afterFinalSubmit({
    record: record as ArrivalRecord,
    closed,
    odometerMiles: opts.odometerMiles,
  });
  if (after.clearRecord) {
    await clearArrivalRecord(deps.kv);
  } else if (after.keepRecord) {
    await writeArrivalRecord(deps.kv, after.keepRecord);
  }
  if (after.promoteOdometerPrefill && opts.odometerMiles !== undefined && opts.onPrefillOdometer) {
    await opts.onPrefillOdometer(opts.odometerMiles);
  }

  return closed ? { ok: true } : { ok: false, reason: 'close_failed', recoverable: true };
}
