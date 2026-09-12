// Execute the production loader with platform boundaries replaced in memory.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/core/services/companyConfig.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;

function harness(token = 'test-token') {
  const cache = new Map();
  const requests = [];
  const mod = { exports: {} };
  const app = {};
  const env = { token, status: 200 };
  const storage = {
    getItem: async key => cache.get(key) ?? null,
    setItem: async (key, value) => { cache.set(key, value); },
  };
  vm.runInNewContext(js, {
    exports: mod.exports, module: mod, AbortController, setTimeout, clearTimeout,
    console: { warn() {} },
    require(name) {
      if (name === '@react-native-async-storage/async-storage') return storage;
      if (name === './firebaseApp') return { getFirebaseApp: () => app };
      if (name === './firebaseAuthBoundary') return {
        getOwnedIdToken: async value => { assert.equal(value, app); return env.token; },
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: env.status === 200, json: async () => ({ fields: {
        name: { stringValue: 'Company' },
        wellbuiltContract: { mapValue: { fields: {
          contractVersion: { integerValue: '1' },
          contractEnforced: { booleanValue: true },
          workPeriodConfiguration: { mapValue: { fields: {
            mode: { stringValue: 'explicit_shift' },
          } } },
        } } },
      } }) };
    },
  });
  return { api: mod.exports, cache, requests, env };
}

test('uncached company read authenticates and restores the enforced shift configuration', async () => {
  const h = harness();
  const result = await h.api.loadCompanyConfigResult('liquid-gold');
  assert.equal(result.kind, 'live');
  assert.equal(result.config.wellbuiltContract.contractEnforced, true);
  assert.equal(result.config.wellbuiltContract.workPeriodConfiguration.mode, 'explicit_shift');
  assert.equal(h.requests[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(h.requests[0].options.signal.aborted, false);
  assert.ok(![...h.cache.values()].some(value => value.includes('test-token')));
  h.env.token = 'refreshed-token';
  await h.api.loadCompanyConfigResult('liquid-gold', { forceRefresh: true });
  assert.equal(h.requests[1].options.headers.Authorization, 'Bearer refreshed-token');
});

test('missing owned session does not send an anonymous request or invent a config', async () => {
  const h = harness(null);
  assert.equal((await h.api.loadCompanyConfigResult('liquid-gold')).kind, 'unavailable');
  assert.equal(h.requests.length, 0);
});

test('denied authenticated request remains unavailable; existing cache remains usable', async () => {
  const h = harness();
  h.env.status = 403;
  assert.equal((await h.api.loadCompanyConfigResult('liquid-gold')).kind, 'unavailable');
  h.env.status = 200;
  await h.api.loadCompanyConfigResult('liquid-gold');
  h.env.status = 403;
  const fallback = await h.api.loadCompanyConfigResult('liquid-gold', { forceRefresh: true });
  assert.equal(fallback.kind, 'cache');
  assert.equal(fallback.freshness, 'stale');
  assert.equal(fallback.config.wellbuiltContract.contractEnforced, true);
});
