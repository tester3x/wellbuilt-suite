import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createOwnedDvirKv } from './ownedDvirKv';
import { receiptKey, setPendingEndShift, getPendingEndShift, clearPendingEndShift } from './dvirReceiptStore';
import { PHASE_RECEIPT_SCHEMA, buildIntegrityPayload, type PhaseCompletionReceipt } from './receiptTypes';
const hash = async (s: string) => createHash('sha256').update(s).digest('hex');
function rawStore() {
  const values = new Map<string, string>();
  return { values, getItem: async (k: string) => values.get(k) ?? null,
    setItem: async (k: string, v: string) => { values.set(k, v); },
    removeItem: async (k: string) => { values.delete(k); } };
}
test('same timestamp shifts on different accounts do not share receipts; verified legacy data is preserved', async () => {
  const raw = rawStore();
  let owner = { driverId: 'driver-a', companyId: 'company' };
  const kv = createOwnedDvirKv(raw, async () => owner, hash);
  const receipt: PhaseCompletionReceipt = { schemaVersion: PHASE_RECEIPT_SCHEMA,
    version: 1, receiptId: 'receipt-a', shiftId: '2026-08-23_232617', inspectionId: 'inspection-a',
    phase: 'pre_trip', completedAt: '2026-08-23T23:30:00Z', driverHash: 'driver-a', integrity: '' };
  receipt.integrity = await hash(buildIntegrityPayload(receipt));
  const key = receiptKey(receipt.shiftId, receipt.phase);
  const legacy = JSON.stringify(receipt);
  await raw.setItem(key, legacy);
  assert.equal(await kv.getItem(key), legacy);
  owner = { ...owner, driverId: 'driver-b' };
  assert.equal(await kv.getItem(key), null);
  await assert.rejects(kv.setItem(key, legacy), /does not belong/);
  assert.equal(await raw.getItem(key), legacy);
  owner = { ...owner, driverId: 'driver-a' };
  assert.equal(await kv.getItem(key), legacy);
});
test('another account cannot replace or clear the original pending Post-Trip navigation', async () => {
  const raw = rawStore();
  let owner = { driverId: 'driver-a', companyId: 'company' };
  const kv = createOwnedDvirKv(raw, async () => owner, hash);
  const first = { shiftId: 'old', createdAt: '2026-09-12T00:00:00Z' };
  await setPendingEndShift(kv, first);
  owner = { ...owner, driverId: 'driver-b' };
  assert.equal(await getPendingEndShift(kv), null);
  await setPendingEndShift(kv, { ...first, shiftId: 'new' });
  await clearPendingEndShift(kv);
  owner = { ...owner, driverId: 'driver-a' };
  assert.deepEqual(await getPendingEndShift(kv), first);
});
