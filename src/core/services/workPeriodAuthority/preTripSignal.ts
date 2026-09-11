// src/core/services/workPeriodAuthority/preTripSignal.ts
//
// PURE, period-scoped derivation of the Pre-Trip signal for the authoritative
// active period. No storage, no time cutoffs, no side effects.
//
// Policy (decided):
//   - A completed Pre-Trip receipt whose identity matches the exact active
//     periodId → 'yes'.
//   - A receipt belonging to another period is stale evidence and is ignored for
//     the active period (it lives under a different store key, so it is simply
//     not read here).
//   - An armed / pending End Shift flag by itself is NEVER evidence that a
//     Pre-Trip occurred — it is not consulted by this derivation at all.
//   - A successful read with no exact-period Pre-Trip evidence → 'no'.
//   - A receipt present but with no trustworthy period identity (empty/mismatched
//     shiftId, or unparseable) → 'legacy_unscoped' (ask the driver).
//   - A storage/read failure → 'indeterminate' (never assume yes or no).
//   - returningToYard alone changes none of these.
import type { PreTripSignal } from './endShiftDvirRouting';

export interface PreTripEvidence {
  /** The authoritative active period id the signal is being derived FOR. */
  activePeriodId: string;
  /** Did the local receipt-store read succeed (no thrown storage error)? */
  readOk: boolean;
  /** Was a raw Pre-Trip receipt present at the active-period key? */
  rawPresent: boolean;
  /** Was a present raw receipt unparseable (corrupt JSON)? */
  parseError: boolean;
  /** The internal shiftId of a present, parsed receipt (null if none/unparsed). */
  receiptShiftId: string | null;
  /** Was the present, parsed receipt's phase === 'pre_trip'? */
  receiptPhaseIsPreTrip: boolean;
}

/**
 * Derive the period-scoped Pre-Trip signal from gathered evidence. Deterministic.
 * The pending End Shift flag is intentionally NOT a parameter — it can never make
 * this return 'yes'.
 */
export function derivePreTripSignal(e: PreTripEvidence): PreTripSignal {
  // Storage/read failure → unverifiable. Never assume presence or absence.
  if (!e.readOk) return 'indeterminate';
  // No receipt at the exact active-period key → no exact-period evidence.
  // (Another period's receipt is under a different key and is not read here;
  //  a pending End Shift flag is not evidence.)
  if (!e.rawPresent) return 'no';
  // Present but unreadable identity → cannot trust; ask the driver.
  if (e.parseError) return 'legacy_unscoped';
  // Present with a trustworthy exact-period identity → genuine Pre-Trip.
  const trustworthyExactMatch =
    !!e.receiptShiftId &&
    e.receiptShiftId === e.activePeriodId &&
    e.receiptPhaseIsPreTrip;
  if (trustworthyExactMatch) return 'yes';
  // Present but no trustworthy period identity (empty/mismatched shiftId, or a
  // non-pre_trip payload at this key) → legacy/unscoped; ask the driver.
  return 'legacy_unscoped';
}
