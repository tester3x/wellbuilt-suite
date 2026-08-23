import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  __resetLiveEquipmentShiftAuthorityForTests,
  peekLiveEquipmentShiftAuthority,
  registerLiveEquipmentShiftAuthority,
} from './equipmentShiftLiveAuthority.js';
import { resolveAuthoritativeEquipmentShiftBinding } from './equipmentHandoffBinding.js';
import {
  __resetEquipmentHandoffBindingForTests,
  rememberGovernedEquipmentHandoff,
  setGovernedHandoffKv,
  type SecureKv,
} from './equipmentHandoffBinding.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function memoryKv(): SecureKv {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
    removeItem: async (k) => {
      map.delete(k);
    },
  };
}

describe('live equipment shift authority', () => {
  it('unpublished live authority is null (fail closed)', () => {
    __resetLiveEquipmentShiftAuthorityForTests();
    assert.equal(peekLiveEquipmentShiftAuthority(), null);
  });

  it('cached shift id alone is not enough — inactive live flag refuses binding', async () => {
    __resetLiveEquipmentShiftAuthorityForTests();
    const kv = memoryKv();
    setGovernedHandoffKv(kv);
    await __resetEquipmentHandoffBindingForTests();
    setGovernedHandoffKv(kv);
    await rememberGovernedEquipmentHandoff('2026-08-23_070000', 'post_trip', 1000);

    registerLiveEquipmentShiftAuthority({
      isShiftActive: () => false,
      getPeriodId: async () => '2026-08-23_070000',
    });
    const live = peekLiveEquipmentShiftAuthority();
    assert.ok(live);
    const active = await live!.isShiftActive();
    assert.equal(active, false);
    const binding = await resolveAuthoritativeEquipmentShiftBinding({
      getCurrentShiftId: () => live!.getPeriodId(),
      isShiftActive: () => false,
      nowMs: () => 2000,
    });
    assert.equal(binding, null);
    __resetLiveEquipmentShiftAuthorityForTests();
  });

  it('live open period matching the handoff issues the same period', async () => {
    const kv = memoryKv();
    setGovernedHandoffKv(kv);
    await __resetEquipmentHandoffBindingForTests();
    setGovernedHandoffKv(kv);
    await rememberGovernedEquipmentHandoff('2026-08-23_070000', 'post_trip', 1000);
    registerLiveEquipmentShiftAuthority({
      isShiftActive: () => true,
      getPeriodId: async () => '2026-08-23_070000',
    });
    const live = peekLiveEquipmentShiftAuthority()!;
    const binding = await resolveAuthoritativeEquipmentShiftBinding({
      getCurrentShiftId: () => live.getPeriodId(),
      isShiftActive: async () => live.isShiftActive(),
      nowMs: () => 2000,
    });
    assert.deepEqual(binding, { shiftId: '2026-08-23_070000', phase: 'post_trip' });
    __resetLiveEquipmentShiftAuthorityForTests();
  });

  it('ssoRuntime never treats a cached shift id as isShiftActive', () => {
    const src = readFileSync(join(HERE, '..', 'ssoRuntime.ts'), 'utf8');
    assert.doesNotMatch(src, /isShiftActive:\s*\(\)\s*=>\s*!!shiftId/);
    assert.match(src, /peekLiveEquipmentShiftAuthority/);
    assert.match(src, /if \(!live\) return null/);
    assert.match(src, /if \(!active\) return null/);
  });

  it('useAppLauncher never attaches hash/name to wbequipment', () => {
    const hook = readFileSync(join(HERE, '..', '..', 'hooks', 'useAppLauncher.ts'), 'utf8');
    assert.match(hook, /scheme === 'wbequipment'/);
    assert.match(hook, /return launchWBApp\(\{ \.\.\.options, sso: undefined \}\)/);
  });
});
