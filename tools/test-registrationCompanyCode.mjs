import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Execute the real registration service and callable adapter, with only
// native dependencies and the HTTP transport replaced. No live registrations.
function harness(response = { result: { pendingId: 'pending-test' } }) {
  const requests = [];
  const stored = new Map([['pendingCompanyName', 'Old company']]);
  const native = {
    'expo-secure-store': {
      setItemAsync: async (key, value) => stored.set(key, value),
      getItemAsync: async (key) => stored.get(key) ?? null,
      deleteItemAsync: async (key) => stored.delete(key),
    },
    'expo-crypto': {},
    '@react-native-async-storage/async-storage': {},
    './firebaseApp': {},
    './firebaseAuthBoundary': {},
    './authSessionCore': { createAuthSessionCore: () => ({}) },
    './attemptToken': { createAttemptTokenizer: () => ({}) },
    './shiftTracking': {},
  };
  function load(name) {
    const source = readFileSync(join(root, 'src/core/services', `${name}.ts`), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    });
    const exports = {};
    runInNewContext(outputText, {
      exports,
      require: (id) => {
        if (!(id in native)) throw new Error(`Unexpected dependency: ${id}`);
        return native[id];
      },
      console,
      fetch: async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return { ok: !response.error, status: response.error ? 400 : 200, json: async () => response };
      },
    });
    return exports;
  }
  native['./secureDriverAuth'] = load('secureDriverAuth');
  return { register: load('driverAuth').submitRegistration, requests, stored };
}

const registration = {
  displayName: 'ExampleDriver', legalName: 'Example Driver',
  passcode: 'test-only-pass', companyCode: ' abcd-1234 ',
};

test('registration sends the normalized join code, not a client-supplied company identity', async () => {
  const h = harness();
  const result = await h.register({ ...registration, companyName: 'Untrusted company', companyId: 'untrusted' });
  assert.equal(result.success, true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, 'https://us-central1-wellbuilt-sync.cloudfunctions.net/requestDriverRegistration');
  assert.deepEqual(h.requests[0].body.data, {
    displayName: 'ExampleDriver', legalName: 'Example Driver',
    passcode: 'test-only-pass', companyCode: 'ABCD-1234', source: 'wbs',
  });
  assert.equal(h.stored.get('pendingSecureId'), 'pending-test');
  assert.equal(h.stored.has('pendingCompanyName'), false);
  assert.equal([...h.stored.values()].some(value => /ABCD-1234|test-only-pass/.test(value)), false);
});

test('blank join code is refused without a network request or new pending registration', async () => {
  const h = harness();
  const result = await h.register({ ...registration, companyCode: '   ' });
  assert.equal(result.success, false);
  assert.equal(result.error, 'Company join code is required');
  assert.equal(h.requests.length, 0);
  assert.equal(h.stored.has('pendingSecureId'), false);
});

test('server rejection remains a failed registration with no pending state', async () => {
  const h = harness({ error: { message: 'Company join code is invalid' } });
  const result = await h.register(registration);
  assert.equal(result.success, false);
  assert.equal(result.error, 'Company join code is invalid');
  assert.equal(h.stored.has('pendingSecureId'), false);
});

test('a server response without a pending id cannot report successful registration', async () => {
  const h = harness({ result: {} });
  const result = await h.register(registration);
  assert.equal(result.success, false);
  assert.equal(h.stored.has('pendingSecureId'), false);
});
