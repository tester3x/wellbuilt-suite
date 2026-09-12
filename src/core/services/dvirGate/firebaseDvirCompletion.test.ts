import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as types from './receiptTypes';
import * as store from './dvirReceiptStore';
const hash = async (s: string) => createHash('sha256').update(s).digest('hex');
const identity = { uid: 'uid-a', kind: 'driver', driverId: 'driver-a', companyId: 'company-a' };
const shiftId = '2026-09-12_020000';
const data = { protocolVersion: 1, ...identity, shiftId, preTrip: {
  inspectionId: 'inspection-a', phase: 'pre_trip', completedAt: '2026-09-12T07:15:00Z', reportDigest: 'a'.repeat(64),
}, postTrip: null };
function harness(response: unknown = data, failure = false, switchOwner = false) {
  let current = identity;
  const values = new Map<string, string>();
  const kv = { getItem: async (k: string) => values.get(k) ?? null,
    setItem: async (k: string, v: string) => { values.set(k, v); }, removeItem: async (k: string) => { values.delete(k); } };
  const mocks: Record<string, unknown> = {
    'firebase/functions': { getFunctions: () => ({}), httpsCallable: () => async (request: any) => {
      assert.equal(request.expectedDriverId, 'driver-a');
      if (failure) throw new Error('offline');
      if (switchOwner) current = { ...identity, driverId: 'driver-b' };
      return { data: response };
    } },
    '../firebaseApp': { getFirebaseApp: () => ({}) },
    '../firebaseAuthBoundary': { getOwnedVerifiedIdentity: async () => current },
    './receiptTypes': types, './dvirReceiptStore': store,
  };
  const source = readFileSync(resolve('src/core/services/dvirGate/firebaseDvirCompletion.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  runInNewContext(code, { exports, require: (name: string) => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`);
    return mocks[name];
  } });
  return { values, run: () => exports.hydrateFirebaseDvirReceipts(shiftId, kv, hash) };
}
test('a second phone hydrates the authoritative Pre-Trip without inventing Post-Trip', async () => {
  const h = harness();
  await h.run();
  const receipt = JSON.parse(h.values.get(store.receiptKey(shiftId, 'pre_trip'))!);
  assert.equal(receipt.driverHash, identity.driverId);
  assert.equal(receipt.inspectionId, 'inspection-a');
  assert.equal(h.values.has(store.receiptKey(shiftId, 'post_trip')), false);
});
test('wrong owner, changed account and unavailable Firebase do not write completion receipts', async () => {
  for (const h of [harness({ ...data, driverId: 'driver-b' }), harness(data, true), harness(data, false, true)]) {
    await assert.rejects(h.run());
    assert.equal(h.values.size, 0);
  }
});
