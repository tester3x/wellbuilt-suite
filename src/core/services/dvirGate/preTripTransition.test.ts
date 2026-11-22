import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkPreTripTransition } from './preTripTransition';
import { markArrived, getResumeArrivalView } from './arrivalCoordinator';
import { saveReceiptIdempotent } from './dvirReceiptStore';
import { writeArrivalRecord, readArrivalRecord } from './arrivalFlow';
import type { DvirGateDeps } from './dvirGateService';

const SHIFT = '2026-11-22_000833';
function fixture() {
  const data = new Map<string, string>();
  let launches = 0;
  const deps: DvirGateDeps = {
    kv: { getItem: async k => data.get(k) ?? null, setItem: async (k,v) => { data.set(k,v); }, removeItem: async k => { data.delete(k); } },
    getCurrentShiftId: async () => SHIFT,
    isShiftActive: () => true,
    isCurrentReceipt: async () => true,
    sha256Hex: async s => s,
    openUrl: async () => { launches++; },
  };
  const save = async (phase: 'pre_trip' | 'post_trip', shiftId = SHIFT) => saveReceiptIdempotent(deps.kv, { shiftId, phase, receiptId: phase + shiftId } as any);
  return { deps, data, save, launches: () => launches };
}

test('missing pre-trip refuses arrival without recording arrival or launching post-trip', async () => {
  const f = fixture();
  await f.save('post_trip'); // An erroneously completed post-trip is not a pre-trip.
  const before = [...f.data];
  assert.deepEqual(await checkPreTripTransition(f.deps), { allowed: false, reason: 'pre_trip_missing' });
  assert.equal((await markArrived(f.deps)).arrived, false);
  assert.deepEqual([...f.data], before);
  assert.equal(f.launches(), 0);
  assert.equal(await readArrivalRecord(f.deps.kv), null);
});

test('prior shift, wrong equipment, unreadable receipt and changing shifts all fail closed', async () => {
  const f = fixture();
  await f.save('pre_trip', '2026-11-21_000001');
  assert.equal((await checkPreTripTransition(f.deps)).allowed, false);
  await f.save('pre_trip');
  assert.equal((await checkPreTripTransition({ ...f.deps, isCurrentReceipt: async () => false })).allowed, false);
  assert.deepEqual(await checkPreTripTransition({ ...f.deps, kv: { ...f.deps.kv, getItem: async () => { throw Error('disk unavailable'); } } }), { allowed: false, reason: 'pre_trip_unverified' });
  let reads = 0;
  assert.deepEqual(await checkPreTripTransition({ ...f.deps, getCurrentShiftId: async () => ++reads === 1 ? SHIFT : 'new-shift' }), { allowed: false, reason: 'period_mismatch' });
  assert.equal((await checkPreTripTransition({ ...f.deps, isShiftActive: () => false })).allowed, false);
});

test('valid current pre-trip allows arrival, but post-trip remains separately required', async () => {
  const f = fixture();
  await f.save('pre_trip');
  assert.deepEqual(await checkPreTripTransition(f.deps), { allowed: true, shiftId: SHIFT });
  await f.save('post_trip');
  const result = await markArrived(f.deps);
  assert.equal(result.arrived, true);
  assert.equal(result.showFinalModal, true);
  assert.equal((await readArrivalRecord(f.deps.kv))?.shiftId, SHIFT);
});

test('an existing arrived shift can finish ending with verified post-trip while pre-trip remains missing', async () => {
  const f = fixture();
  await f.save('post_trip');
  await writeArrivalRecord(f.deps.kv, { shiftId: SHIFT, stage: 'awaiting_final', arrivedAtIso: '2026-11-22T06:12:00Z' });
  const before = [...f.data];
  const view = await getResumeArrivalView(f.deps, { shiftActive: true });
  assert.equal(view.show, 'final_modal');
  assert.equal(view.show === 'final_modal' && view.preTripUnconfirmed, true);
  assert.deepEqual([...f.data], before, 'recovery reads never write an inspection or arrival');
  assert.equal((await markArrived(f.deps)).arrived, false, 'terminal recovery never unlocks Mark Arrived');
  assert.equal((await checkPreTripTransition(f.deps)).allowed, false, 'return gate remains closed');
  await f.save('pre_trip');
  assert.equal((await getResumeArrivalView(f.deps, { shiftActive: true })).show, 'final_modal');
});

test('a completed post-trip alone cannot invent arrival; foreign equipment or closed shift cannot recover', async () => {
  const f = fixture();
  await f.save('post_trip');
  assert.equal((await getResumeArrivalView(f.deps, { shiftActive: true })).show, 'none');
  await writeArrivalRecord(f.deps.kv, { shiftId: SHIFT, stage: 'awaiting_final', arrivedAtIso: '2026-11-22T06:12:00Z' });
  assert.equal((await getResumeArrivalView({ ...f.deps, isCurrentReceipt: async () => false }, { shiftActive: true })).show, 'none');
  assert.equal((await getResumeArrivalView(f.deps, { shiftActive: false })).show, 'none');
  assert.equal((await getResumeArrivalView({ ...f.deps, getCurrentShiftId: async () => 'other' }, { shiftActive: true })).show, 'none');
  assert.equal(f.launches(), 0);
});

test('return service and UI keep the receipt gate ahead of mutations and expose disabled arrival', () => {
  const src = readFileSync('src/core/context/AuthContext.tsx', 'utf8');
  const start = src.slice(src.indexOf('  const startReturn = useCallback('), src.indexOf('  // Divert from the return-to-yard'));
  assert.ok(start.indexOf('checkPreTripTransition(createSuiteDvirGate') > 0);
  assert.ok(start.indexOf('checkPreTripTransition(createSuiteDvirGate') < start.indexOf('returnStateStore.reserveAttempt'));
  assert.ok(start.indexOf('if (!preTrip.allowed) return') < start.indexOf('recordEnforcedDepartReturn({'));
  assert.match(readFileSync('src/ui/shared/EnRouteYardCard.tsx', 'utf8'), /disabled=\{arrivalDisabled\}/);
  assert.match(readFileSync('src/ui/shared/ActionCardRow.tsx', 'utf8'), /arrivalDisabled=\{preTripMissing\}/);
});
