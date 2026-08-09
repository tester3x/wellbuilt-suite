import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  __resetEquipmentHandoffBindingForTests,
  clearGovernedEquipmentHandoff,
  peekGovernedEquipmentHandoff,
  rememberGovernedEquipmentHandoff,
  resolveAuthoritativeEquipmentShiftBinding,
} from './equipmentHandoffBinding';

test.beforeEach(() => {
  __resetEquipmentHandoffBindingForTests();
});

test('remember + resolve when shift active and matches', async () => {
  rememberGovernedEquipmentHandoff('2026-08-08_211725', 'pre_trip', 1000);
  const b = await resolveAuthoritativeEquipmentShiftBinding({
    getCurrentShiftId: async () => '2026-08-08_211725',
    isShiftActive: () => true,
    nowMs: () => 2000,
  });
  assert.deepEqual(b, { shiftId: '2026-08-08_211725', phase: 'pre_trip' });
});

test('no binding when shift missing or closed', async () => {
  rememberGovernedEquipmentHandoff('s1', 'post_trip', 1000);
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
      getCurrentShiftId: async () => 's1',
      isShiftActive: () => false,
      nowMs: () => 2000,
    }),
    null,
  );
});

test('no binding when local shift superseded', async () => {
  rememberGovernedEquipmentHandoff('old', 'pre_trip', 1000);
  assert.equal(
    await resolveAuthoritativeEquipmentShiftBinding({
      getCurrentShiftId: async () => 'new',
      isShiftActive: () => true,
      nowMs: () => 2000,
    }),
    null,
  );
});

test('TTL expires pending handoff', () => {
  rememberGovernedEquipmentHandoff('s1', 'pre_trip', 1000);
  assert.equal(peekGovernedEquipmentHandoff(1000 + 11 * 60 * 1000), null);
});

test('clear drops pending', () => {
  rememberGovernedEquipmentHandoff('s1', 'pre_trip', 1000);
  clearGovernedEquipmentHandoff();
  assert.equal(peekGovernedEquipmentHandoff(2000), null);
});
