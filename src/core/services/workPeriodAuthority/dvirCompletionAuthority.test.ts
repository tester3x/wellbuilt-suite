// vc51.9C clarification 2 — receipt trust matrix.
// A deep link may WAKE WB-S and say what to verify; under enforcement it
// is never sufficient proof by itself.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  MISSING_SERVER_AUTHORITY, dvirCompletionBlockedCopy, verifyDvirCompletionAuthority,
} from './dvirCompletionAuthority';

const PERIOD = '2026-08-06_060000';
const expected = { verifiedPeriodId: PERIOD, phase: 'post_trip' as const, driverHash: 'hash-1' };
const receipt = (over = {}) => ({
  shiftId: PERIOD, phase: 'post_trip' as const, inspectionId: `dvir_shift_${PERIOD}`,
  receiptId: `rcpt_${PERIOD}_post_trip_dvir_shift_${PERIOD}`, driverHash: 'hash-1', ...over,
});
const legacy = { state: 'legacy' as const };
const inert = { state: 'inert' as const };
const active = { state: 'active' as const, mode: 'explicit_shift' as const };

// ── legacy / inert: established behavior preserved ────────────────────────
test('legacy: a matching local receipt still unlocks the gate', () => {
  const v = verifyDvirCompletionAuthority({ enforcement: legacy, receipt: receipt(), expected });
  assert.equal(v.accepted, true);
  assert.equal((v as { basis: string }).basis, 'legacy_local_receipt');
});
test('inert: assigned-but-unenforced keeps established behavior', () => {
  assert.equal(verifyDvirCompletionAuthority({ enforcement: inert, receipt: receipt(), expected }).accepted, true);
});

// ── necessary conditions hold in every mode ───────────────────────────────
test('altered phase rejected (even legacy)', () => {
  const v = verifyDvirCompletionAuthority({ enforcement: legacy, receipt: receipt({ phase: 'pre_trip' }), expected });
  assert.equal((v as { reason: string }).reason, 'phase_mismatch');
});
test('altered period/shift rejected', () => {
  const v = verifyDvirCompletionAuthority({ enforcement: legacy, receipt: receipt({ shiftId: '2026-08-05_180000' }), expected });
  assert.equal((v as { reason: string }).reason, 'shift_mismatch');
});
test('cross-driver receipt rejected', () => {
  const v = verifyDvirCompletionAuthority({ enforcement: legacy, receipt: receipt({ driverHash: 'hash-2' }), expected });
  assert.equal((v as { reason: string }).reason, 'driver_mismatch');
});
test('malformed / missing receipt rejected', () => {
  assert.equal((verifyDvirCompletionAuthority({ enforcement: legacy, receipt: null, expected }) as { reason: string }).reason, 'malformed_receipt');
  assert.equal((verifyDvirCompletionAuthority({ enforcement: legacy, receipt: receipt({ inspectionId: null }), expected }) as { reason: string }).reason, 'malformed_receipt');
  assert.equal((verifyDvirCompletionAuthority({ enforcement: legacy, receipt: receipt({ receiptId: null }), expected }) as { reason: string }).reason, 'malformed_receipt');
});

// ── enforced: the link is never sufficient ────────────────────────────────
test('ENFORCED: a perfectly matching receipt is still NOT sufficient proof', () => {
  const v = verifyDvirCompletionAuthority({ enforcement: active, receipt: receipt(), expected });
  assert.equal(v.accepted, false);
  assert.equal((v as { reason: string }).reason, 'unverifiable_no_server_record');
});
test('ENFORCED: a fabricated-but-well-formed receipt cannot complete a phase', () => {
  // Same shape a malicious/broken client could mint locally.
  const v = verifyDvirCompletionAuthority({
    enforcement: active,
    receipt: receipt({ receiptId: 'rcpt_forged', inspectionId: 'dvir_forged' }),
    expected,
  });
  assert.equal(v.accepted, false);
});
test('ENFORCED: no verified period → no_active_shift (never "complete")', () => {
  const v = verifyDvirCompletionAuthority({
    enforcement: active, receipt: receipt(),
    expected: { ...expected, verifiedPeriodId: null },
  });
  assert.equal((v as { reason: string }).reason, 'no_active_shift');
});
test('ENFORCED: stale receipt from a prior period rejected before the authority gap', () => {
  const v = verifyDvirCompletionAuthority({
    enforcement: active, receipt: receipt({ shiftId: '2026-08-05_180000' }), expected,
  });
  assert.equal((v as { reason: string }).reason, 'shift_mismatch');
});
test('ENFORCED: invalid/unknown contract also fails closed', () => {
  const v = verifyDvirCompletionAuthority({
    enforcement: { state: 'invalid', reason: 'unsupported_contract_version:7' },
    receipt: receipt(), expected,
  });
  assert.equal(v.accepted, false);
});

// ── the blocker is legible in source ──────────────────────────────────────
test('the missing server work is named explicitly', () => {
  assert.ok(MISSING_SERVER_AUTHORITY.required.length >= 4);
  const all = MISSING_SERVER_AUTHORITY.required.join(' ');
  assert.ok(/authenticated server path|callable|Admin SDK/i.test(all));
  assert.ok(/periodId/.test(all));
  assert.ok(/rules/i.test(all));
  assert.ok(/Dashboard\/Functions/.test(MISSING_SERVER_AUTHORITY.outOfScopeHere));
});
test('every rejection has honest copy that never implies completion', () => {
  for (const r of ['unverifiable_no_server_record', 'no_active_shift', 'shift_mismatch',
    'phase_mismatch', 'driver_mismatch', 'malformed_receipt'] as const) {
    const copy = dvirCompletionBlockedCopy(r);
    assert.ok(copy.length > 20);
    assert.ok(!/complete[d]?\b/i.test(copy) || /can’t|not/i.test(copy));
  }
});
