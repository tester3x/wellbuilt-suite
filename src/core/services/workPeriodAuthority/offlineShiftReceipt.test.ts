import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingOfflineShift } from './offlineShiftReceipt';
const owner = {uid:'u', driverId:'d', companyId:'c', grantId:'g'};
const period = {state:'open' as const, periodId:'2026-10-20_180221', originLocalDate:'2026-10-20', protocolVersion:1 as const};
test('verified period continues across midnight with the same owner and binding', () => {
  assert.deepEqual(matchingOfflineShift({owner,period}, owner,period.periodId),period);
});
test('foreign owner, replacement login, missing/closed binding cannot resume', () => {
  for (const key of ['uid','driverId','companyId','grantId']) assert.equal(matchingOfflineShift({owner,period},{...owner,[key]:'other'},period.periodId),null);
  assert.equal(matchingOfflineShift({owner,period},owner,null),null);
  assert.equal(matchingOfflineShift({owner,period},owner,'2026-10-20_190000'),null);
  assert.equal(matchingOfflineShift({owner,period},null,period.periodId),null);
});
test('corrupt or unverified records cannot create an active shift', () => {
  for (const raw of [null,{}, {owner,period:{...period,state:'none'}}, {owner,period:{...period,originLocalDate:'2026-10-21'}}, {owner,period:{...period,protocolVersion:2}}]) assert.equal(matchingOfflineShift(raw,owner,period.periodId),null);
});
