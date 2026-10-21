import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hosBlocksUnstartedCancellation } from './cancelUnstartedHos';
import type { StoredEtcStart } from '../etcStart/etcStartOutbox';
const record: StoredEtcStart = { request: { protocolVersion: 1, action: 'start_hos', requestId: 'test-request', companyId: 'c', driverId: 'd', suiteShiftId: '2026-10-20_180221', requestedAtMs: 1000 }, dispatchUncertain: false, lastHos: null, lastState: null, lastGps: null };
test('missing request needs no HOS mutation; corrupt request blocks', async () => {
  const port = { available: true, call: async () => { throw Error('must not call'); } };
  assert.equal(await hosBlocksUnstartedCancellation({ kind: 'missing' }, port), false);
  assert.equal(await hosBlocksUnstartedCancellation({ kind: 'corrupt' }, port), true);
});
for (const [state, hos, blocks] of [
  ['cancelled', 'not_started', false], ['rejected', 'not_started', false], ['expired', 'not_started', false],
  ['processing', 'unknown', true], ['prepared', 'not_started', true], ['completed', 'started', true], ['completed', 'already_active', true],
] as const) test(`HOS ${state}/${hos}: ${blocks ? 'blocks' : 'allows'} cancellation`, async () => {
  assert.equal(await hosBlocksUnstartedCancellation({ kind: 'ok', record }, { available: true, call: async (method) => {
    assert.equal(method, 'cancelStart');
    return { ok: true, startIntent: 'absent', response: { ...record.request, state, hos, gps: 'unknown', observedAtMs: 2000 } };
  } }), blocks);
});
test('wrong shift echoed by provider cannot authorize cancellation', async () => {
  assert.equal(await hosBlocksUnstartedCancellation({ kind: 'ok', record }, { available: true, call: async () => ({
    ok: true, startIntent: 'absent', response: { ...record.request, suiteShiftId: 'other', state: 'cancelled', hos: 'not_started', gps: 'unknown', observedAtMs: 2000 },
  }) }), true);
});
