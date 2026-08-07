// dvirCompletionAuthority.ts — vc51.9C clarification 2.
//
// WHAT PROVES A DVIR PHASE IS COMPLETE?
//
// Census finding (both allowed repositories, verified in source):
//   * the durable DVIR record lives ONLY in eQuipment's device-local
//     AsyncStorage (@wb/equipment-dvir/v1/shiftDvir/{shiftId});
//   * eQuipment's cloud writes are compiled off —
//     `DVIR_CLOUD_WRITES_ENABLED = false as const` — and its DVIR
//     Firestore project is a SEPARATE project that asserts isolation
//     from wellbuilt-sync, so no DVIR document is written to any server;
//   * no receipt collection exists in Firestore or RTDB;
//   * the only cross-app channel is the return deep link + a
//     device-local receipt whose `integrity` is a plain SHA-256 over its
//     own fields — corruption detection, NOT a MAC (no shared secret
//     exists), so it cannot distinguish a genuine receipt from a
//     well-formed fabricated one.
//
// Therefore, under canonical enforcement, WB-S CANNOT independently
// verify durable DVIR completion. A deep link may WAKE WB-S and tell it
// WHAT to verify; it is not itself proof.
//
// This module makes that boundary explicit instead of pretending the
// receipt is authority:
//   legacy / inert  → established behavior, unchanged (the local receipt
//                     unlocks the gate exactly as it does today);
//   active / invalid → `unverifiable_no_server_record`: enforcement
//                     cannot be honestly satisfied on the current
//                     architecture, and the caller fails CLOSED.
//
// Fail-closed is inert today: no company is enforced. It becomes
// deployable only when the server-side work named in
// MISSING_SERVER_AUTHORITY lands.

import type { SuiteEnforcement } from './suiteShiftAuthority';

/** A receipt as delivered by the return deep link / local store. */
export interface DvirReceiptClaim {
  shiftId?: string | null;
  phase?: 'pre_trip' | 'post_trip' | null;
  inspectionId?: string | null;
  receiptId?: string | null;
  driverHash?: string | null;
}

export type DvirCompletionVerdict =
  | { accepted: true; basis: 'legacy_local_receipt' }
  | { accepted: false; reason:
      | 'unverifiable_no_server_record'
      | 'no_active_shift'
      | 'shift_mismatch'
      | 'phase_mismatch'
      | 'driver_mismatch'
      | 'malformed_receipt'; detail?: string };

/**
 * Decide whether a returned DVIR receipt may mark a phase complete.
 *
 * `expected` is what WB-S itself knows: the verified open period, the
 * phase it launched, and the authenticated driver. The receipt must
 * match all of them (necessary), but under enforcement matching is not
 * SUFFICIENT — there is no independent durable record to confirm.
 */
export function verifyDvirCompletionAuthority(input: {
  enforcement: SuiteEnforcement;
  receipt: DvirReceiptClaim | null | undefined;
  expected: {
    verifiedPeriodId: string | null;
    phase: 'pre_trip' | 'post_trip';
    driverHash: string | null;
  };
}): DvirCompletionVerdict {
  const r = input.receipt;
  if (!r || !r.shiftId || !r.phase || !r.inspectionId || !r.receiptId) {
    return { accepted: false, reason: 'malformed_receipt' };
  }
  // Necessary conditions first — these hold in EVERY mode, so a
  // wrong-shift/phase/driver receipt is rejected even for legacy
  // companies (it was never valid evidence for this launch).
  if (r.phase !== input.expected.phase) return { accepted: false, reason: 'phase_mismatch' };
  if (input.expected.driverHash && r.driverHash && r.driverHash !== input.expected.driverHash) {
    return { accepted: false, reason: 'driver_mismatch' };
  }

  if (input.enforcement.state === 'legacy' || input.enforcement.state === 'inert') {
    // Established behavior: the local receipt unlocks the gate. WB-S
    // still binds it to the shift it believes is current when it has
    // one (today's dvirReceiptStore is shift-keyed).
    if (input.expected.verifiedPeriodId && r.shiftId !== input.expected.verifiedPeriodId) {
      return { accepted: false, reason: 'shift_mismatch' };
    }
    return { accepted: true, basis: 'legacy_local_receipt' };
  }

  // ── active / invalid enforcement ────────────────────────────────────
  if (!input.expected.verifiedPeriodId) {
    return { accepted: false, reason: 'no_active_shift' };
  }
  if (r.shiftId !== input.expected.verifiedPeriodId) {
    return { accepted: false, reason: 'shift_mismatch' };
  }
  // Everything the link CAN prove now matches — and it still is not
  // enough. There is no server-side DVIR record or receipt to read.
  return {
    accepted: false,
    reason: 'unverifiable_no_server_record',
    detail: 'no durable server-side DVIR record exists for WB-S to verify',
  };
}

/**
 * The exact missing server/schema work that would let WB-S verify DVIR
 * completion independently. Named here so the blocker is legible in
 * source, not only in a report.
 */
export const MISSING_SERVER_AUTHORITY = Object.freeze({
  summary:
    'Enforced DVIR completion needs a server-side record WB-S can read; the deep-link receipt is a client assertion.',
  required: Object.freeze([
    'A durable DVIR completion record written by an authenticated server path (callable/Admin SDK) — not a device-local store, and not a client direct-write.',
    'That record must carry: companyId, authenticated driverHash, phase (pre_trip|post_trip), the DVIR record id, the canonical verified periodId, and a server timestamp.',
    'Firestore rules (Dashboard repo) granting WB-S an exact-get on that record and denying client writes/list — the same shape as the JSA receipt rules.',
    'eQuipment must submit through that authenticated path; DVIR_CLOUD_WRITES_ENABLED is currently a compile-time false and its project is isolated from wellbuilt-sync.',
    'Optionally a period binding on the record (bindShiftScopedRecord output) so WB-S can re-verify the binding rather than re-deriving it.',
  ]),
  blockedUntilThen:
    'Canonical DVIR enforcement cannot be activated for any company. Legacy/unenforced behavior is unaffected.',
  outOfScopeHere:
    'That work touches Dashboard/Functions, which VC51.9C does not authorize editing.',
});

export function dvirCompletionBlockedCopy(reason: Extract<DvirCompletionVerdict, { accepted: false }>['reason']): string {
  switch (reason) {
    case 'unverifiable_no_server_record':
      return 'This inspection can’t be verified by WellBuilt Suite yet. Contract enforcement for DVIR is not available on this version.';
    case 'no_active_shift':
      return 'No verified active shift to attach this inspection to.';
    case 'shift_mismatch':
      return 'That inspection belongs to a different shift.';
    case 'phase_mismatch':
      return 'That inspection is for a different inspection type.';
    case 'driver_mismatch':
      return 'That inspection belongs to a different driver.';
    case 'malformed_receipt':
      return 'The inspection result could not be read. Reopen the inspection from WellBuilt Suite.';
  }
}
