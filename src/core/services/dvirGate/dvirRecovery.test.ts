import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const who = { driverId: 'driver-a', companyId: 'company-a' };
const answer = { protocolVersion: 1, ...who, recovery: { shiftId: '2026-09-01_070000', phase: 'post_trip' } };
function load(response: unknown, switchOwner = false, unavailable = false) {
  let current = who;
  const calls: string[] = [];
  const mocks: Record<string, unknown> = {
    'firebase/functions': { getFunctions() {}, httpsCallable: (_: unknown, name: string) => async (data: any) => {
      calls.push(name);
      assert.equal(data.expectedDriverId, who.driverId);
      if (unavailable) throw new Error('offline');
      if (switchOwner) current = { ...who, driverId: 'driver-b' };
      return { data: response };
    } },
    '../firebaseApp': { getFirebaseApp() {} },
    './firebaseDvirCompletion': { getDvirOwner: async () => current },
  };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync('src/core/services/dvirGate/dvirRecovery.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name: string) => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected boundary ${name}`); return mocks[name];
  } });
  return { run: exports.resolveDvirRecovery, calls };
}
test('recovery lookup returns own Post-Trip without any shift or completion write', async () => {
  const r = load(answer);
  assert.equal((await r.run()).shiftId, answer.recovery.shiftId);
  assert.deepEqual(r.calls, ['resolveDriverDvirRecovery']);
  assert.equal(await load({ ...answer, recovery: null }).run(), null);
});
test('recovery lookup rejects owner drift, malformed phase, unavailable state and foreign responses', async () => {
  for (const r of [load(answer, true), load(answer, false, true), load({ ...answer, driverId: 'foreign' }),
    load({ ...answer, recovery: { ...answer.recovery, phase: 'pre_trip' } })]) await assert.rejects(r.run());
});

test('recovery host checks off-shift Home only after verified session readiness', async () => {
  const recoveryHandoff = { purpose: 'recovery', shiftId: answer.recovery.shiftId };
  for (const [gate, path, handoff, next, expected, cleared] of [
    ['pending', '/home', null, null, 0, 0], ['ready', '/sso-authorize', null, null, 0, 0],
    ['ready', '/home', null, null, 1, 0],
    ['ready', '/home', { purpose: undefined }, null, 0, 0],
    ['ready', '/home', recoveryHandoff, answer.recovery, 1, 0],
    ['ready', '/home', recoveryHandoff, null, 1, 1],
    ['ready', '/home', recoveryHandoff, { shiftId: '2026-09-02_070000', phase: 'post_trip' }, 1, 1],
  ]) {
    let reads = 0;
    let clears = 0;
    const effects: Array<() => unknown> = [];
    const mocks: Record<string, any> = {
      react: { createElement: () => null, useState: (x: unknown) => [x, () => {}],
        useRef: (current: unknown) => ({ current }), useEffect: (f: () => unknown) => effects.push(f) },
      'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
        StyleSheet: { create: (s: unknown) => s } },
      'expo-router': { usePathname: () => path },
      '@/core/context/AuthContext': { useAuth: () => ({ user: who, loading: false, shiftActive: false }) },
      '@/core/hooks/useSsoSessionGate': { useSsoSessionGate: () => gate },
      '@/core/services/dvirGate/dvirRecovery': { resolveDvirRecovery: async () => { reads++; return next; } },
      '@/core/services/dvirGate': { createSuiteDvirGate: () => assert.fail('must not launch during lookup') },
      '@/core/services/dvirGate/dvirGateService': {},
      '@/core/services/dvirGate/equipmentHandoffBinding': {
        hydrateGovernedEquipmentHandoff: async () => handoff, subscribeGovernedHandoffChanged: () => () => {},
        clearGovernedEquipmentHandoff: async () => { clears++; },
      },
    };
    const exports: any = {};
    runInNewContext(ts.transpileModule(readFileSync('src/ui/shared/DvirRecoveryHost.tsx', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText, { exports, require: (name: string) => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected boundary ${name}`); return mocks[name];
    } });
    exports.default();
    effects.forEach(f => f());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, expected);
    assert.equal(clears, cleared);
  }
});
