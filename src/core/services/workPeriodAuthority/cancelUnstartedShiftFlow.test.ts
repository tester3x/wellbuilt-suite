import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelUnstartedShiftFlow, type CancelDependencies, type CancelContext } from './cancelUnstartedShiftFlow';
const owner: CancelContext = { uid: 'u', driverId: 'd', companyId: 'c', periodId: '2026-10-20_180221' };
const reason = 'Software switching test, no work performed.';
function setup(overrides: Partial<CancelDependencies> = {}) {
  const sent: unknown[] = [];
  const deps: CancelDependencies = { context: async () => owner, hasInspection: async () => false,
    hasHosRequest: async () => false, cancel: async p => {
      sent.push(p); return { protocolVersion: 1, cancelledPeriodId: owner.periodId, alreadyCancelled: false };
    }, ...overrides };
  return { deps, sent };
}
test('sends only exact period, reason and no-work attestation; no caller-selected owner', async () => {
  const f = setup(); await cancelUnstartedShiftFlow(reason, f.deps);
  assert.deepEqual(f.sent, [{ periodId: owner.periodId, reason, noWorkPerformed: true }]);
});
for (const field of ['hasInspection', 'hasHosRequest'] as const) test(`blocks ${field}`, async () => {
  const f = setup({ [field]: async () => true });
  await assert.rejects(cancelUnstartedShiftFlow(reason, f.deps)); assert.equal(f.sent.length, 0);
});
test('changed owner or period before request prevents cancellation', async () => {
  for (const key of ['uid', 'driverId', 'companyId', 'periodId'] as const) {
    let calls = 0;
    const f = setup({ context: async () => ++calls === 1 ? owner : { ...owner, [key]: 'other' } });
    await assert.rejects(cancelUnstartedShiftFlow(reason, f.deps)); assert.equal(f.sent.length, 0);
  }
});
test('transport error cannot report cancellation success', async () => {
  const f = setup({ cancel: async () => { throw Error('offline'); } });
  await assert.rejects(cancelUnstartedShiftFlow(reason, f.deps), /offline/);
});
test('wrong-period or missing acknowledgement cannot clear local shift', async () => {
  for (const result of [null, {}, { protocolVersion: 1, cancelledPeriodId: 'other', alreadyCancelled: false }]) {
    const f = setup({ cancel: async () => result });
    await assert.rejects(cancelUnstartedShiftFlow(reason, f.deps));
  }
});
test('acknowledged idempotent retry succeeds', async () => {
  const f = setup({ cancel: async () => ({ protocolVersion: 1, cancelledPeriodId: owner.periodId, alreadyCancelled: true }) });
  await cancelUnstartedShiftFlow(reason, f.deps);
});
