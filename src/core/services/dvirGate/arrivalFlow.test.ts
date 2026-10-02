// Run: npx tsx --test src/core/services/dvirGate/arrivalFlow.test.ts
//
// Two-stage arrival: Mark Arrived → Post-Trip DVIR → final mileage close.
//
// The order this replaces asked the driver to TICK a Post-Trip box before the
// inspection existed, and then closed the shift automatically the moment a
// receipt arrived — before any odometer or paperwork confirmation. Both
// receipt-return paths (app/_layout's listener and app/dvir-complete) now go
// through onPostTripReceipt, so a warm return and a cold launch cannot diverge.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginArrival,
  onPostTripReceipt,
  canSubmitFinal,
  afterFinalSubmit,
  resumeArrivalView,
  returnDriveDurationMs,
  readArrivalRecord,
  writeArrivalRecord,
  clearArrivalRecord,
  type ArrivalRecord,
} from './arrivalFlow';

const SHIFT = '2026-09-29_082000';
const OTHER_SHIFT = '2026-09-28_070000';
const ARRIVED = '2026-09-30T23:50:00.000Z';

function record(over: Partial<ArrivalRecord> = {}): ArrivalRecord {
  return { shiftId: SHIFT, arrivedAtIso: ARRIVED, stage: 'awaiting_post_trip', ...over };
}
function memKv() {
  const data = new Map<string, string>();
  return {
    data,
    kv: {
      getItem: async (k: string) => data.get(k) ?? null,
      setItem: async (k: string, v: string) => { data.set(k, v); },
      removeItem: async (k: string) => { data.delete(k); },
    },
  };
}

// ── Stage 1: Mark Arrived hands off FIRST, never closes ───────────────────
test('Mark Arrived records arrival and launches Post-Trip — it does not close', () => {
  const d = beginArrival({ shiftId: SHIFT, nowIso: ARRIVED, postTripAlreadyComplete: false, existing: null });
  assert.equal(d.launchPostTrip, true);
  assert.equal(d.record.stage, 'awaiting_post_trip');
  assert.equal(d.record.arrivedAtIso, ARRIVED);
  assert.equal(d.record.shiftId, SHIFT);
  // There is no 'closed' stage at all — closing deletes the record.
  assert.ok(!('closed' in d));
});

test('a Post-Trip receipt already valid for this shift skips the relaunch', () => {
  const d = beginArrival({ shiftId: SHIFT, nowIso: ARRIVED, postTripAlreadyComplete: true, existing: null });
  assert.equal(d.launchPostTrip, false, 'must not relaunch WB-E');
  assert.equal(d.record.stage, 'awaiting_final');
});

test('re-tapping Mark Arrived keeps the original arrival time and typed odometer', () => {
  const existing = record({ odometerMiles: 412 });
  const d = beginArrival({ shiftId: SHIFT, nowIso: '2026-10-01T00:30:00.000Z', postTripAlreadyComplete: false, existing });
  assert.equal(d.record.arrivedAtIso, ARRIVED, 'arrival time is set once');
  assert.equal(d.record.odometerMiles, 412);
});

test('a record from a previous shift is replaced, not reused', () => {
  const stale = record({ shiftId: OTHER_SHIFT, stage: 'awaiting_final', odometerMiles: 999 });
  const d = beginArrival({ shiftId: SHIFT, nowIso: ARRIVED, postTripAlreadyComplete: false, existing: stale });
  assert.equal(d.record.shiftId, SHIFT);
  assert.equal(d.record.stage, 'awaiting_post_trip');
  assert.equal(d.record.odometerMiles, undefined, "the old shift's odometer is not carried over");
  assert.equal(d.launchPostTrip, true);
});

test('once at the final stage, re-tapping cannot regress to awaiting_post_trip', () => {
  const d = beginArrival({
    shiftId: SHIFT, nowIso: ARRIVED, postTripAlreadyComplete: false,
    existing: record({ stage: 'awaiting_final' }),
  });
  assert.equal(d.record.stage, 'awaiting_final');
  assert.equal(d.launchPostTrip, false);
});

// ── Stage 2: the receipt opens the modal — it NEVER closes ────────────────
test('a valid current-shift receipt opens the final modal and closes nothing', () => {
  const r = onPostTripReceipt({ record: record(), receiptShiftId: SHIFT, receiptPhase: 'post_trip', shiftActive: true });
  assert.equal(r.action, 'open_final_modal');
  assert.equal(r.action === 'open_final_modal' && r.record.stage, 'awaiting_final');
  // The only two actions are open_final_modal and ignore.
  assert.notEqual(r.action as string, 'close');
});

test('duplicate receipt delivery is idempotent — one modal, not two', () => {
  const first = onPostTripReceipt({ record: record(), receiptShiftId: SHIFT, receiptPhase: 'post_trip', shiftActive: true });
  assert.equal(first.action, 'open_final_modal');
  const advanced = first.action === 'open_final_modal' ? first.record : record();
  const second = onPostTripReceipt({ record: advanced, receiptShiftId: SHIFT, receiptPhase: 'post_trip', shiftActive: true });
  assert.equal(second.action, 'ignore');
  assert.equal(second.action === 'ignore' && second.reason, 'already_awaiting_final');
});

test("another shift's valid receipt never unlocks this shift", () => {
  const r = onPostTripReceipt({ record: record(), receiptShiftId: OTHER_SHIFT, receiptPhase: 'post_trip', shiftActive: true });
  assert.equal(r.action, 'ignore');
  assert.equal(r.action === 'ignore' && r.reason, 'receipt_shift_mismatch');
});

test('wrong phase, no arrival in progress, or a closed shift all do nothing', () => {
  assert.equal(onPostTripReceipt({ record: record(), receiptShiftId: SHIFT, receiptPhase: 'pre_trip', shiftActive: true }).action, 'ignore');
  assert.equal(onPostTripReceipt({ record: null, receiptShiftId: SHIFT, receiptPhase: 'post_trip', shiftActive: true }).action, 'ignore');
  assert.equal(onPostTripReceipt({ record: record(), receiptShiftId: SHIFT, receiptPhase: 'post_trip', shiftActive: false }).action, 'ignore');
});

// ── Stage 3: only the driver's submit closes ──────────────────────────────
test('the DVIR condition comes from the receipt, never from a tap', () => {
  const blocked = canSubmitFinal({
    record: record({ stage: 'awaiting_final' }), shiftId: SHIFT,
    postTripReceiptValid: false, paperworkConfirmed: true, odometerMiles: 120,
  });
  assert.equal(blocked.ok, false);
  assert.equal(!blocked.ok && blocked.reason, 'post_trip_missing');
});

test('paperwork stays the driver manual gate', () => {
  const r = canSubmitFinal({
    record: record({ stage: 'awaiting_final' }), shiftId: SHIFT,
    postTripReceiptValid: true, paperworkConfirmed: false, odometerMiles: 120,
  });
  assert.equal(!r.ok && r.reason, 'paperwork_unconfirmed');
});

test('miles are validated; a good submit passes them through', () => {
  const base = { record: record({ stage: 'awaiting_final' }), shiftId: SHIFT, postTripReceiptValid: true, paperworkConfirmed: true };
  for (const bad of [-1, 5001, 12.5, Number.NaN]) {
    const r = canSubmitFinal({ ...base, odometerMiles: bad });
    assert.equal(!r.ok && r.reason, 'odometer_invalid', String(bad));
  }
  assert.deepEqual(canSubmitFinal({ ...base, odometerMiles: 120 }), { ok: true, odometerMiles: 120 });
  assert.deepEqual(canSubmitFinal({ ...base }), { ok: true, odometerMiles: undefined }, 'omitted is allowed');
});

test('a submit against another shift, or with no arrival, is blocked', () => {
  const base = { postTripReceiptValid: true, paperworkConfirmed: true, odometerMiles: 100 };
  assert.equal((canSubmitFinal({ ...base, record: null, shiftId: SHIFT }) as any).reason, 'no_arrival');
  assert.equal((canSubmitFinal({ ...base, record: record(), shiftId: OTHER_SHIFT }) as any).reason, 'wrong_shift');
});

// ── Close outcome: success clears, failure stays recoverable ──────────────
test('a successful close clears the record and only then promotes the prefill', () => {
  const r = afterFinalSubmit({ record: record({ stage: 'awaiting_final' }), closed: true, odometerMiles: 412 });
  assert.equal(r.clearRecord, true);
  assert.equal(r.keepRecord, null);
  assert.equal(r.promoteOdometerPrefill, true);
});

test('a FAILED close keeps the record, keeps the typed miles, and promotes nothing', () => {
  const r = afterFinalSubmit({ record: record({ stage: 'awaiting_final' }), closed: false, odometerMiles: 412 });
  assert.equal(r.clearRecord, false);
  assert.equal(r.promoteOdometerPrefill, false, "an attempted reading must not become the next shift's prefill");
  assert.equal(r.keepRecord?.odometerMiles, 412, 'retry does not ask for the reading again');
  assert.equal(r.keepRecord?.stage, 'awaiting_final', 'still recoverable at the final step');
});

// ── Restart / recovery ────────────────────────────────────────────────────
test('a restart after Post-Trip returns to the final mileage step for the same shift', () => {
  const v = resumeArrivalView({
    record: record(), activeShiftId: SHIFT, shiftActive: true, postTripReceiptValid: true,
  });
  assert.equal(v.show, 'final_modal');
  assert.equal(v.show === 'final_modal' && v.record.stage, 'awaiting_final');
});

test('a restart BEFORE Post-Trip offers retry and never claims DVIR passed', () => {
  const v = resumeArrivalView({
    record: record(), activeShiftId: SHIFT, shiftActive: true, postTripReceiptValid: false,
  });
  assert.equal(v.show, 'awaiting_post_trip');
});

test('stale state never reopens WB-E or the modal on the next shift', () => {
  // Different shift now active.
  assert.equal(resumeArrivalView({
    record: record(), activeShiftId: OTHER_SHIFT, shiftActive: true, postTripReceiptValid: true,
  }).show, 'none');
  // Shift already closed.
  assert.equal(resumeArrivalView({
    record: record(), activeShiftId: SHIFT, shiftActive: false, postTripReceiptValid: true,
  }).show, 'none');
  // Nothing in progress.
  assert.equal(resumeArrivalView({
    record: null, activeShiftId: SHIFT, shiftActive: true, postTripReceiptValid: true,
  }).show, 'none');
});

// ── Durable record survives a process death ───────────────────────────────
test('the arrival record round-trips through storage and rejects corruption', async () => {
  const { kv, data } = memKv();
  assert.equal(await readArrivalRecord(kv), null);
  await writeArrivalRecord(kv, record({ stage: 'awaiting_final', odometerMiles: 412 }));
  const back = await readArrivalRecord(kv);
  assert.equal(back?.stage, 'awaiting_final');
  assert.equal(back?.odometerMiles, 412);
  assert.equal(back?.shiftId, SHIFT);

  for (const junk of ['not json', '{}', '{"shiftId":""}', '{"shiftId":"s","stage":"bogus"}',
                      '{"shiftId":"s","stage":"awaiting_final","arrivedAtIso":"nope"}']) {
    data.set('wbs.dvir.arrivalFlow.v1', junk);
    assert.equal(await readArrivalRecord(kv), null, junk);
  }
  await clearArrivalRecord(kv);
  assert.equal(await readArrivalRecord(kv), null);
});

// ── Drive timer stops at arrival ──────────────────────────────────────────
test('the drive timer stops at Mark Arrived, not at the close', () => {
  const depart = '2026-09-30T23:00:00.000Z';
  const arrived = '2026-09-30T23:50:00.000Z';
  const muchLater = Date.parse('2026-10-01T01:30:00.000Z');
  const ms = returnDriveDurationMs({ returnStartIso: depart, arrivedAtIso: arrived, nowMs: muchLater });
  assert.equal(ms, 50 * 60 * 1000, 'DVIR and paperwork time is not drive time');

  // Still driving: measured to now.
  const live = returnDriveDurationMs({ returnStartIso: depart, arrivedAtIso: null, nowMs: Date.parse(arrived) });
  assert.equal(live, 50 * 60 * 1000);

  // Nothing to measure, and no negative durations from a skewed clock.
  assert.equal(returnDriveDurationMs({ returnStartIso: null, arrivedAtIso: arrived, nowMs: muchLater }), null);
  assert.equal(returnDriveDurationMs({ returnStartIso: 'junk', arrivedAtIso: arrived, nowMs: muchLater }), null);
  assert.equal(returnDriveDurationMs({ returnStartIso: arrived, arrivedAtIso: depart, nowMs: muchLater }), null);
});

// ── source non-regression: the old order must not come back ───────────────
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const repoRoot = join(__dirname, '..', '..', '..', '..');
const readSrc = (p: string) => readFileSync(join(repoRoot, p), 'utf8');

test('REGRESSION (source): neither receipt route closes the shift automatically', () => {
  // Both used to call confirmArrival the moment a Post-Trip receipt landed,
  // ending the shift before any odometer or paperwork confirmation.
  for (const file of ['app/_layout.tsx', 'app/dvir-complete.tsx']) {
    const src = readSrc(file);
    const marker = src.indexOf('handlePostTripReceipt');
    assert.ok(marker > 0, `${file} must route through the shared transition`);
    // No confirmArrival in the receipt-handling path.
    assert.doesNotMatch(
      src.slice(marker, marker + 900),
      /confirmArrival\(/,
      `${file}: a receipt must never close the shift`,
    );
    assert.doesNotMatch(
      src.slice(marker, marker + 900),
      /consumePendingEndShiftIfReady/,
      `${file}: the auto-resume-and-close path is gone`,
    );
  }
});

test('REGRESSION (source): Mark Arrived hands off before the mileage modal', () => {
  const src = readSrc('src/ui/shared/ActionCardRow.tsx');
  // The old wiring sent Mark Arrived straight to the modal.
  assert.doesNotMatch(
    src,
    /onArrived=\{\(\) => setShowArrivalModal\(true\)\}/,
    'Mark Arrived must not open the mileage modal directly',
  );
  assert.ok(src.includes('onArrived={handleMarkArrived}'));
  assert.ok(src.includes('coordinator.markArrived(gate)'));
  // The final submit is the only close, and it goes through the checked path.
  assert.ok(src.includes('coordinator.finalizeArrival(gate, {'));
});

test('REGRESSION (source): the Post-Trip row is not driver-settable', () => {
  const src = readSrc('src/ui/shared/ShiftArrivalModal.tsx');
  assert.ok(src.includes('const postTripDone = postTripVerified;'));
  assert.doesNotMatch(src, /setPostTripDone/, 'no manual Post-Trip toggle may remain');
  // Paperwork stays manual.
  assert.ok(src.includes('setPaperworkDone'));
  // The next-shift prefill is not written on an attempt.
  const confirmIdx = src.indexOf('const handleConfirm');
  assert.doesNotMatch(
    src.slice(confirmIdx, confirmIdx + 800),
    /wellbuilt-last-odometer/,
    'an attempted reading must not be promoted before the close succeeds',
  );
});
