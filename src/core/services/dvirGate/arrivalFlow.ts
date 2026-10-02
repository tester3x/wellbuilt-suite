/**
 * Two-stage yard arrival: Mark Arrived → Post-Trip DVIR → final mileage close.
 *
 * WHAT CHANGED AND WHY
 *
 * The old order asked the driver to tick a Post-Trip box BEFORE doing the
 * inspection: Mark Arrived opened ShiftArrivalModal, the driver manually
 * checked "Post-Trip DVIR" and paperwork, and only the confirm handler called
 * ensurePostTripGate, which launched WB-E. A manual tap therefore claimed an
 * inspection that had not happened yet. Worse, both receipt-return paths
 * (app/_layout's DvirReceiptListener and app/dvir-complete) then called
 * confirmArrival AUTOMATICALLY, closing the shift the moment a receipt landed —
 * before the driver had entered an odometer reading or confirmed paperwork.
 *
 * The order is now: arriving records a durable arrival and hands off to WB-E
 * immediately; a valid receipt for THIS shift opens the final modal with the
 * DVIR row already satisfied from that receipt; and only the driver's final
 * submit closes the shift.
 *
 * This module is the single decision point both return paths go through, so a
 * warm return and a cold launch cannot produce two different outcomes, and a
 * duplicate receipt delivery cannot produce two modals or two closes.
 *
 * Deliberately free of React, expo and storage imports: every transition below
 * is executable in node:test.
 */
import type { DvirReceiptKv } from './dvirReceiptStore';

/** Where the arrival has got to. There is no 'closed' stage: a successful
 *  close deletes the record, so a stale one can never gate the next shift. */
export type ArrivalStage = 'awaiting_post_trip' | 'awaiting_final';

export type ArrivalRecord = {
  shiftId: string;
  /** When the driver tapped Mark Arrived. The drive timer stops here. */
  arrivedAtIso: string;
  stage: ArrivalStage;
  /**
   * The end odometer the driver typed, kept ONLY so a failed close can be
   * retried without re-entering it. It is not a completed reading and must
   * never be promoted to the next shift's prefill from here.
   */
  odometerMiles?: number;
};

const ARRIVAL_KEY = 'wbs.dvir.arrivalFlow.v1';

export async function readArrivalRecord(kv: DvirReceiptKv): Promise<ArrivalRecord | null> {
  const raw = await kv.getItem(ARRIVAL_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ArrivalRecord;
    if (!parsed || typeof parsed.shiftId !== 'string' || !parsed.shiftId) return null;
    if (parsed.stage !== 'awaiting_post_trip' && parsed.stage !== 'awaiting_final') return null;
    if (typeof parsed.arrivedAtIso !== 'string' || Number.isNaN(new Date(parsed.arrivedAtIso).getTime())) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeArrivalRecord(kv: DvirReceiptKv, record: ArrivalRecord): Promise<void> {
  await kv.setItem(ARRIVAL_KEY, JSON.stringify(record));
}

export async function clearArrivalRecord(kv: DvirReceiptKv): Promise<void> {
  await kv.removeItem(ARRIVAL_KEY);
}

// ── Stage 1: Mark Arrived ────────────────────────────────────────────────────

export type BeginArrivalDecision = {
  record: ArrivalRecord;
  /** False when a valid Post-Trip receipt for this shift already exists. */
  launchPostTrip: boolean;
};

/**
 * Decide what tapping Mark Arrived does. Never closes the shift.
 *
 * An existing arrival record for the SAME shift is reused rather than
 * overwritten, so a second tap does not reset the arrival time or drop an
 * odometer the driver already typed. A record for a DIFFERENT shift is
 * replaced — it belongs to a shift that is over.
 */
export function beginArrival(input: {
  shiftId: string;
  nowIso: string;
  postTripAlreadyComplete: boolean;
  existing: ArrivalRecord | null;
}): BeginArrivalDecision {
  const sameShift = input.existing && input.existing.shiftId === input.shiftId
    ? input.existing
    : null;

  const stage: ArrivalStage = input.postTripAlreadyComplete ? 'awaiting_final' : 'awaiting_post_trip';
  const record: ArrivalRecord = {
    shiftId: input.shiftId,
    // Arrival time is set once; re-tapping does not move it.
    arrivedAtIso: sameShift?.arrivedAtIso || input.nowIso,
    // Never regress a shift that already reached the final stage.
    stage: sameShift?.stage === 'awaiting_final' ? 'awaiting_final' : stage,
    ...(sameShift?.odometerMiles !== undefined ? { odometerMiles: sameShift.odometerMiles } : {}),
  };

  return {
    record,
    // Already satisfied for this shift → straight to the final modal, no relaunch.
    launchPostTrip: record.stage === 'awaiting_post_trip',
  };
}

// ── Stage 2: a Post-Trip receipt comes back ──────────────────────────────────

export type ReceiptAction =
  | { action: 'open_final_modal'; record: ArrivalRecord }
  /** Nothing to do. NEVER closes the shift — that is the driver's submit. */
  | { action: 'ignore'; reason: string };

/**
 * The single transition both the warm listener and the cold dvir-complete
 * route call. Idempotent: a duplicate delivery for a shift already at
 * 'awaiting_final' is ignored rather than re-opening the modal.
 */
export function onPostTripReceipt(input: {
  record: ArrivalRecord | null;
  receiptShiftId: string;
  receiptPhase: string;
  shiftActive: boolean;
}): ReceiptAction {
  if (input.receiptPhase !== 'post_trip') {
    return { action: 'ignore', reason: 'not_post_trip' };
  }
  if (!input.record) {
    // A receipt with no arrival in progress: the driver did Post-Trip early,
    // or this is a stale delivery. Either way it must not open anything.
    return { action: 'ignore', reason: 'no_arrival_in_progress' };
  }
  if (!input.shiftActive) {
    return { action: 'ignore', reason: 'shift_not_active' };
  }
  if (input.record.shiftId !== input.receiptShiftId) {
    // A valid receipt for ANOTHER shift must never unlock this one.
    return { action: 'ignore', reason: 'receipt_shift_mismatch' };
  }
  if (input.record.stage === 'awaiting_final') {
    return { action: 'ignore', reason: 'already_awaiting_final' };
  }
  return {
    action: 'open_final_modal',
    record: { ...input.record, stage: 'awaiting_final' },
  };
}

// ── Stage 3: the driver's final submit ───────────────────────────────────────

export type FinalSubmitCheck =
  | { ok: true; odometerMiles?: number }
  | { ok: false; reason: 'no_arrival' | 'wrong_shift' | 'post_trip_missing' | 'paperwork_unconfirmed' | 'odometer_invalid' };

/**
 * Every condition the close requires, in one place.
 *
 * The Post-Trip condition is `postTripReceiptValid` — derived from a verified
 * receipt for this exact shift, never from a checkbox the driver tapped.
 * Paperwork stays the driver's own manual confirmation.
 */
export function canSubmitFinal(input: {
  record: ArrivalRecord | null;
  shiftId: string;
  postTripReceiptValid: boolean;
  paperworkConfirmed: boolean;
  odometerMiles?: number;
}): FinalSubmitCheck {
  if (!input.record) return { ok: false, reason: 'no_arrival' };
  if (input.record.shiftId !== input.shiftId) return { ok: false, reason: 'wrong_shift' };
  if (!input.postTripReceiptValid) return { ok: false, reason: 'post_trip_missing' };
  if (!input.paperworkConfirmed) return { ok: false, reason: 'paperwork_unconfirmed' };
  if (input.odometerMiles !== undefined) {
    if (!Number.isFinite(input.odometerMiles) || !Number.isInteger(input.odometerMiles)
      || input.odometerMiles < 0 || input.odometerMiles > 5000) {
      return { ok: false, reason: 'odometer_invalid' };
    }
  }
  return { ok: true, odometerMiles: input.odometerMiles };
}

/**
 * What to persist after the close attempt.
 *
 * On success the arrival record is deleted, so no stale state can reopen WB-E
 * or the modal on the next shift. On failure the record is KEPT — including
 * the odometer the driver typed — so the modal stays recoverable and the
 * retry does not ask for the reading again. The next-shift odometer prefill
 * is only written on success; promoting an attempted value would carry a
 * reading from a shift that never closed into the next one.
 */
export function afterFinalSubmit(input: {
  record: ArrivalRecord;
  closed: boolean;
  odometerMiles?: number;
}): { clearRecord: boolean; keepRecord: ArrivalRecord | null; promoteOdometerPrefill: boolean } {
  if (input.closed) {
    return { clearRecord: true, keepRecord: null, promoteOdometerPrefill: true };
  }
  return {
    clearRecord: false,
    keepRecord: {
      ...input.record,
      ...(input.odometerMiles !== undefined ? { odometerMiles: input.odometerMiles } : {}),
    },
    promoteOdometerPrefill: false,
  };
}

// ── Recovery / restart ───────────────────────────────────────────────────────

export type ResumeView =
  | { show: 'none'; reason: string }
  /** Arrived, Post-Trip still outstanding — offer retry, do NOT claim it passed. */
  | { show: 'awaiting_post_trip'; record: ArrivalRecord }
  /** Post-Trip verified for this shift — show the final mileage modal. */
  | { show: 'final_modal'; record: ArrivalRecord };

/**
 * What a cold start (or a return to Home) should put back on screen.
 *
 * A process restart after Post-Trip must land on the final mileage step for
 * the SAME open shift. A record belonging to another shift, or any record at
 * all once the shift is closed, shows nothing.
 */
export function resumeArrivalView(input: {
  record: ArrivalRecord | null;
  activeShiftId: string | null;
  shiftActive: boolean;
  postTripReceiptValid: boolean;
}): ResumeView {
  if (!input.record) return { show: 'none', reason: 'no_record' };
  if (!input.shiftActive || !input.activeShiftId) return { show: 'none', reason: 'shift_not_active' };
  if (input.record.shiftId !== input.activeShiftId) return { show: 'none', reason: 'stale_shift' };
  if (input.postTripReceiptValid) {
    return { show: 'final_modal', record: { ...input.record, stage: 'awaiting_final' } };
  }
  return { show: 'awaiting_post_trip', record: input.record };
}

// ── Drive duration ───────────────────────────────────────────────────────────

/**
 * How long the return drive actually took.
 *
 * It ends at the Mark Arrived tap, not at the close. Measuring to the close
 * would silently fold the WB-E inspection and the paperwork step into "drive
 * time". `arrivedAtIso` is the durable client arrival stamp; the server events
 * carry no separate arrival marker, so this is the only arrival time there is
 * — a gap worth noting rather than papering over with the logout time.
 */
export function returnDriveDurationMs(input: {
  returnStartIso: string | null;
  arrivedAtIso: string | null;
  nowMs: number;
}): number | null {
  if (!input.returnStartIso) return null;
  const start = new Date(input.returnStartIso).getTime();
  if (Number.isNaN(start)) return null;
  const endMs = input.arrivedAtIso ? new Date(input.arrivedAtIso).getTime() : input.nowMs;
  if (Number.isNaN(endMs) || endMs < start) return null;
  return endMs - start;
}
