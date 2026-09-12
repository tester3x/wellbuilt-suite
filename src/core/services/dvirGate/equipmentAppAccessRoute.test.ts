import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
async function run(gate = 'ready', wrongOwner = false) {
  const opened: string[] = []; const requests: any[] = []; const effects: Array<() => void> = [];
  const identity = { uid: 'u', kind: 'driver', driverId: wrongOwner ? 'other' : 'd', companyId: 'c' };
  const exports: any = {};
  const mocks: Record<string, any> = {
    react: { default: { createElement: () => null }, useEffect: (fn: () => void) => effects.push(fn),
      useRef: (current: any) => ({ current }), useState: (value: any) => [value, () => {}] },
    'react-native': { Linking: { openURL: async (url: string) => { opened.push(url); } } },
    'expo-splash-screen': { hideAsync: async () => {} },
    'expo-router': { router: { replace: () => {} }, useLocalSearchParams: () => ({ state: 'S'.repeat(43), codeChallenge: 'C'.repeat(43) }) },
    'firebase/functions': { getFunctions: () => ({}), httpsCallable: () => async (data: any) => {
      requests.push(data); return { data: { version: 1, code: 'A'.repeat(43) } }; } },
    '@/core/context/AuthContext': { useAuth: () => ({ loading: false, isAuthenticated: true, user: { passcodeHash: 'd', companyId: 'c' } }) },
    '@/core/hooks/useSsoSessionGate': { useSsoSessionGate: () => gate },
    '@/core/services/firebaseApp': { getFirebaseApp: () => ({}), FIREBASE_REGION: 'test' },
    '@/core/services/firebaseAuthBoundary': { getOwnedVerifiedIdentity: async () => identity },
    '@/core/services/appLauncher': { trackSSOApp: async () => {} },
  };
  runInNewContext(ts.transpileModule(readFileSync('app/equipment-access.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText, { exports, require: (id: string) => { if (!(id in mocks)) throw new Error(id); return mocks[id]; } });
  exports.default(); effects.forEach(fn => fn());
  await new Promise(resolve => setImmediate(resolve));
  return { opened, requests };
}
test('general Equipment route waits for verified Suite readiness and matching owner', async () => {
  assert.equal((await run('pending')).requests.length, 0);
  assert.equal((await run('ready', true)).requests.length, 0);
});
test('general Equipment route issues no shift binding and sends only code/state back', async () => {
  const r = await run();
  assert.deepEqual(JSON.parse(JSON.stringify(r.requests)), [{ version: 1, codeChallenge: 'C'.repeat(43) }]);
  const url = new URL(r.opened[0]); assert.equal(url.host, 'app-callback');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['code', 'state']);
});
