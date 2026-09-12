import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function route(file: string, loading: boolean, mounted: boolean, authenticated: boolean, sessionGate = 'ready') {
  const calls = { hidden: 0, navigated: [] as string[], shiftReads: 0, gates: 0 };
  const mocks: Record<string, unknown> = {
    react: { createElement: (type: unknown, props: unknown) => ({ type, props }),
      useEffect: (effect: () => void) => effect(), useRef: (current: unknown) => ({ current }),
      useState: (value: unknown) => [value, () => {}] },
    'react-native': { View: 'View', Text: 'Text', ActivityIndicator: 'Spinner', StyleSheet: { create: (v: unknown) => v } },
    'expo-router': { Redirect: 'Redirect', useRootNavigationState: () => mounted ? { key: 'root' } : undefined,
      useLocalSearchParams: () => ({ shiftId: '2026-09-12_110729', phase: 'pre_trip' }),
      useRouter: () => ({ replace: (url: string) => calls.navigated.push(url) }) },
    'expo-splash-screen': { hideAsync: async () => { calls.hidden++; } },
    '@/core/context/SkinContext': { useSkin: () => ({ skin: { screens: { HomeScreen: 'HomeScreen' } } }) },
    '@/core/context/AuthContext': { useAuth: () => ({ loading, isAuthenticated: authenticated,
      user: authenticated ? { displayName: 'Test' } : null, shiftActive: true }) },
    '@/core/services/dvirGate': { createSuiteDvirGate: () => { calls.gates++; throw new Error('Unexpected early receipt read'); } },
    '@/core/hooks/useSsoSessionGate': { useSsoSessionGate: () => sessionGate },
    '@/core/theme': { colors: { bg: { primary: '#000' }, text: { secondary: '#fff' }, brand: { accent: '#fff' } } },
    '@/core/services/shiftTracking': { getCurrentShiftId: async () => { calls.shiftReads++; return null; } },
  };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
    esModuleInterop: true,
  } }).outputText, { exports, require: (name: string) => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`);
    return mocks[name];
  }, React: mocks.react });
  return { rendered: exports.default(), calls };
}

test('cold Home never mounts the redirecting skin before both auth and navigator are ready', () => {
  for (const [loading, mounted] of [[true, false], [true, true], [false, false]]) {
    const r = route('app/home.tsx', loading, mounted, false);
    assert.equal(r.rendered.type, 'View');
    assert.equal(r.calls.hidden, 0);
  }
  assert.equal(route('app/home.tsx', false, true, false).rendered.type, 'Redirect');
  const ready = route('app/home.tsx', false, true, true);
  assert.equal(ready.rendered.type, 'HomeScreen');
  assert.equal(ready.calls.hidden, 1);
});

test('cold recovery return waits for auth and navigation instead of consuming its request early', () => {
  for (const [loading, mounted] of [[true, false], [true, true], [false, false]]) {
    const r = route('app/dvir-resume.tsx', loading, mounted, true);
    assert.equal(r.calls.shiftReads, 0);
    assert.equal(r.calls.navigated.length, 0);
  }
  const signedOut = route('app/dvir-resume.tsx', false, true, false);
  assert.deepEqual(signedOut.calls.navigated, ['/']);
  assert.equal(signedOut.calls.shiftReads, 0);
});

test('completion and recovery routes wait for verified Firebase reconciliation after optimistic login', () => {
  for (const file of ['app/dvir-complete.tsx', 'app/dvir-resume.tsx']) {
    const r = route(file, false, true, true, 'pending');
    assert.equal(r.calls.gates, 0);
    assert.equal(r.calls.shiftReads, 0);
    assert.equal(r.calls.navigated.length, 0);
    assert.equal(r.calls.hidden, 0);
  }
});
