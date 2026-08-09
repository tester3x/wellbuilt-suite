import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  __resetEquipmentHandoffBindingForTests,
  clearGovernedEquipmentHandoff,
  completeGovernedHandoffIfMatches,
  GOVERNED_HANDOFF_KEY,
  GOVERNED_HANDOFF_TTL_MS,
  hydrateGovernedEquipmentHandoff,
  rememberGovernedEquipmentHandoff,
  resolveAuthoritativeEquipmentShiftBinding,
  setGovernedHandoffKv,
  type SecureKv,
} from './equipmentHandoffBinding';

function memoryKv(): SecureKv & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
    removeItem: async (k) => {
      map.delete(k);
    },
  };
}

test.beforeEach(async () => {
  const kv = memoryKv();
  setGovernedHandoffKv(kv);
  await __resetEquipmentHandoffBindingForTests();
  setGovernedHandoffKv(kv);
});

test('durably written before launch semantics: remember persists to kv', async () => {
  const kv = memoryKv();
  setGovernedHandoffKv(kv);
  const rec = await rememberGovernedEquipmentHandoff('2026-08-08_211725', 'pre_trip', 1000);
  assert.ok(rec);
  assert.ok(kv.map.has(GOVERNED_HANDOFF_KEY));
  const raw = kv.map.get(GOVERNED_HANDOFF_KEY)!;
  assert.ok(raw.includes('2026-08-08_211725'));
  assert.ok(raw.includes('pre_trip'));
  assert.ok(!raw.includes('hash'));
  assert.ok(!raw.includes('verifier'));
});

test('cold-start hydrate restores intent', async () => {
  await rememberGovernedEquipmentHandoff('s1', 'post_trip', 1000);
  // Simulate process death: new resolve with same kv still has data
  const h = await hydrateGovernedEquipmentHandoff(2000);
  assert.ok(h);
  assert.equal(h!.shiftId, 's1');
  assert.equal(h!.phase, 'post_trip');
});

test('resolve when shift active and matches', async () => {
  await rememberGovernedEquipmentHandoff('2026-08-08_211725', 'pre_trip', 1000);
  const b = await resolveAuthoritativeEquipmentShiftBinding({
    getCurrentShiftId: async () => '2026-08-08_211725',
    isShiftActive: () => true,
    nowMs: () => 2000,
  });
  assert.deepEqual(b, { shiftId: '2026-08-08_211725', phase: 'pre_trip' });
});

test('refuse wrong/closed/superseded shift after hydration', async () => {
  await rememberGovernedEquipmentHandoff('old', 'pre_trip', 1000);
  assert.equal(
    await resolveAuthoritativeEquipmentShiftBinding({
      getCurrentShiftId: async () => null,
      isShiftActive: () => true,
      nowMs: () => 2000,
    }),
    null,
  );
  assert.equal(
    await resolveAuthoritativeEquipmentShiftBinding({
      getCurrentShiftId: async () => 'old',
      isShiftActive: () => false,
      nowMs: () => 2000,
    }),
    null,
  );
  assert.equal(
    await resolveAuthoritativeEquipmentShiftBinding({
      getCurrentShiftId: async () => 'new',
      isShiftActive: () => true,
      nowMs: () => 2000,
    }),
    null,
  );
});

test('TTL expires and clears', async () => {
  await rememberGovernedEquipmentHandoff('s1', 'pre_trip', 1000);
  const h = await hydrateGovernedEquipmentHandoff(1000 + GOVERNED_HANDOFF_TTL_MS + 1);
  assert.equal(h, null);
});

test('malformed persisted data fails closed and clears', async () => {
  const kv = memoryKv();
  setGovernedHandoffKv(kv);
  await kv.setItem(GOVERNED_HANDOFF_KEY, '{not-json');
  assert.equal(await hydrateGovernedEquipmentHandoff(1000), null);
  assert.equal(await kv.getItem(GOVERNED_HANDOFF_KEY), null);
});

test('accepted terminal receipt clears matching intent', async () => {
  await rememberGovernedEquipmentHandoff('s1', 'pre_trip', 1000);
  await completeGovernedHandoffIfMatches('s1', 'pre_trip');
  assert.equal(await hydrateGovernedEquipmentHandoff(2000), null);
});

test('clear drops pending', async () => {
  await rememberGovernedEquipmentHandoff('s1', 'pre_trip', 1000);
  await clearGovernedEquipmentHandoff('cancel');
  assert.equal(await hydrateGovernedEquipmentHandoff(2000), null);
});

test('valid intent survives restart (hydrate after remember)', async () => {
  await rememberGovernedEquipmentHandoff('s1', 'pre_trip', 1000);
  // "restart": only hydrate API
  const a = await hydrateGovernedEquipmentHandoff(1500);
  const b = await hydrateGovernedEquipmentHandoff(1600);
  assert.equal(a!.correlationId, b!.correlationId);
});
