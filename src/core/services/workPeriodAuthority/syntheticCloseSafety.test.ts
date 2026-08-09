// Offline / midnight synthetic-close safety matrix (post live|cache|unreadable).
// Cutover-specific forceRefresh/LKG lifecycle lives in cutoverPath.test.ts.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  createMemoryEnforcementSafetyStore,
  enforcementAllowsSyntheticClose,
  mayUseDateFallback,
  parseSuiteEnforcement,
  resolveSyntheticCloseDecision,
  type CompanyDocLoadOutcome,
  type LastKnownEnforcement,
  type SuiteEnforcement,
} from './suiteShiftAuthority';

const COMPANY = 'liquid-gold';
const NOW = Date.parse('2026-08-08T06:00:00.000Z');

const ACTIVE_DOC = {
  wellbuiltContract: {
    contractEnforced: true,
    contractVersion: 1,
    workPeriodConfiguration: { mode: 'explicit_shift' },
  },
};
const INERT_DOC = {
  wellbuiltContract: {
    contractEnforced: false,
    contractVersion: 1,
    workPeriodConfiguration: { mode: 'explicit_shift' },
  },
};
const INVALID_DOC = {
  wellbuiltContract: {
    contractEnforced: true,
    contractVersion: 9,
    workPeriodConfiguration: { mode: 'explicit_shift' },
  },
};
const LEGACY_DOC = { tier: 'god', name: 'Never Configured Co' };

function live(doc: unknown): (id: string) => Promise<CompanyDocLoadOutcome> {
  return async () => ({ status: 'live', doc });
}
function unreadable(): (id: string) => Promise<CompanyDocLoadOutcome> {
  return async () => ({ status: 'unreadable' });
}
function loadThrows(err: Error = new Error('loader boom')): (id: string) => Promise<CompanyDocLoadOutcome> {
  return async () => {
    throw err;
  };
}

const root = join(__dirname, '..', '..', '..', '..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

test('1. successful live read with contract absent → confirmed_legacy, allow', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, live(LEGACY_DOC), store, NOW);
  assert.equal(d.allow, true);
  assert.equal(d.source, 'confirmed_legacy');
  assert.equal(d.lkgUpdated, true);
  assert.equal(d.loadKind, 'live');
});

test('2. failed read with no cache → unreadable unknown, block', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, unreadable(), store, NOW);
  assert.equal(d.allow, false);
  assert.equal(d.source, 'temporarily_unreadable_unknown');
  assert.equal(d.lkgUpdated, false);
});

test('3. failed read with LKG enforced → block', async () => {
  const store = createMemoryEnforcementSafetyStore();
  await resolveSyntheticCloseDecision(COMPANY, live(ACTIVE_DOC), store, NOW);
  const d = await resolveSyntheticCloseDecision(COMPANY, unreadable(), store, NOW + 1);
  assert.equal(d.allow, false);
  assert.equal(d.source, 'last_known_good');
  assert.equal(d.enforcement.state, 'active');
});

test('4. missing companyId → block', async () => {
  const store = createMemoryEnforcementSafetyStore();
  for (const id of [null, undefined, ''] as const) {
    const d = await resolveSyntheticCloseDecision(id as any, unreadable(), store, NOW);
    assert.equal(d.allow, false);
    assert.equal(d.source, 'missing_company');
  }
});

test('5. import/runtime gate failure must not fall through into sweep (wiring)', () => {
  const tracking = src('src/core/services/shiftTracking.ts');
  const fn = tracking.slice(
    tracking.indexOf('async function autoCloseStaleShift'),
    tracking.indexOf('async function autoCloseStaleShift') + 2000,
  );
  assert.ok(fn.includes('observeEnforcementSafety'));
  assert.ok(/if \(!observed\)/.test(fn) || /observe failed/.test(fn));
  assert.ok(!/Enforcement unknown → legacy behavior/.test(fn));
});

test('6. loader throw blocks; with LKG active still blocks via LKG', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const cold = await resolveSyntheticCloseDecision(COMPANY, loadThrows(), store, NOW);
  assert.equal(cold.allow, false);
  await resolveSyntheticCloseDecision(COMPANY, live(ACTIVE_DOC), store, NOW);
  const warm = await resolveSyntheticCloseDecision(COMPANY, loadThrows(), store, NOW + 1);
  assert.equal(warm.allow, false);
  assert.equal(warm.source, 'last_known_good');
});

test('7. invalid contract fails closed and persists LKG on live', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, live(INVALID_DOC), store, NOW);
  assert.equal(d.allow, false);
  assert.equal(d.enforcement.state, 'invalid');
  assert.equal(d.lkgUpdated, true);
  const offline = await resolveSyntheticCloseDecision(COMPANY, unreadable(), store, NOW + 1);
  assert.equal(offline.allow, false);
  assert.equal(offline.enforcement.state, 'invalid');
});

test('8. inert contract allows synthetic close', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, live(INERT_DOC), store, NOW);
  assert.equal(d.allow, true);
  assert.equal(d.source, 'confirmed_inert');
  const offline = await resolveSyntheticCloseDecision(COMPANY, unreadable(), store, NOW + 1);
  assert.equal(offline.allow, true);
  assert.equal(offline.source, 'last_known_good');
});

test('9. confirmed live legacy allows synthetic close', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, live({ tier: 'suite' }), store, NOW);
  assert.equal(d.allow, true);
  assert.equal(d.source, 'confirmed_legacy');
});

test('10. date fallback policy independent of synthetic-close path', () => {
  const auth = src('src/core/services/workPeriodAuthority/suiteShiftAuthority.ts');
  assert.ok(auth.includes('export function mayUseDateFallback'));
  assert.ok(auth.includes('export function enforcementAllowsSyntheticClose'));
  assert.ok(auth.includes('POLICY NOTE') || auth.includes('intentionally independent'));
  const states: SuiteEnforcement[] = [
    { state: 'legacy' },
    { state: 'inert' },
    { state: 'active', mode: 'explicit_shift' },
    { state: 'invalid', reason: 'x' },
  ];
  for (const s of states) {
    assert.equal(mayUseDateFallback(s), enforcementAllowsSyntheticClose(s));
  }
  assert.ok(src('src/core/services/jsaShiftAck.ts').includes('mayUseDateFallback'));
  assert.ok(src('app/day-summary.tsx').includes('mayUseDateFallback'));
  assert.ok(!src('src/core/services/jsaShiftAck.ts').includes('resolveSyntheticCloseDecision'));
  const tracking = src('src/core/services/shiftTracking.ts');
  assert.ok(tracking.includes('observeEnforcementSafety'));
  assert.ok(tracking.includes('resolveSyntheticCloseDecision'));
});

test('valid enforced explicit_shift blocks on live', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, live(ACTIVE_DOC), store, NOW);
  assert.equal(d.allow, false);
  assert.equal(d.source, 'confirmed_active');
});

test('restart offline with durable LKG enforced still blocks', async () => {
  const durable = new Map<string, LastKnownEnforcement>();
  const s1 = createMemoryEnforcementSafetyStore(durable);
  await resolveSyntheticCloseDecision(COMPANY, live(ACTIVE_DOC), s1, NOW);
  const s2 = createMemoryEnforcementSafetyStore(durable);
  const d = await resolveSyntheticCloseDecision(COMPANY, unreadable(), s2, NOW + 86_400_000);
  assert.equal(d.allow, false);
  assert.equal(d.source, 'last_known_good');
});

test('live demote active → inert updates LKG', async () => {
  const store = createMemoryEnforcementSafetyStore();
  await resolveSyntheticCloseDecision(COMPANY, live(ACTIVE_DOC), store, NOW);
  const demoted = await resolveSyntheticCloseDecision(COMPANY, live(INERT_DOC), store, NOW + 1);
  assert.equal(demoted.allow, true);
  assert.equal(demoted.source, 'confirmed_inert');
  assert.equal(demoted.lkgUpdated, true);
});

test('never-configured unreadable does not invent active', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const offline = await resolveSyntheticCloseDecision(COMPANY, unreadable(), store, NOW);
  assert.equal(offline.allow, false);
  assert.notEqual(offline.source, 'confirmed_active');
  const online = await resolveSyntheticCloseDecision(COMPANY, live(LEGACY_DOC), store, NOW + 1);
  assert.equal(online.allow, true);
  assert.equal(online.source, 'confirmed_legacy');
});

test('vc11 parse semantics remain green', () => {
  assert.equal(parseSuiteEnforcement({ tier: 'god' }).state, 'legacy');
  assert.equal(parseSuiteEnforcement(undefined).state, 'legacy');
  assert.equal(parseSuiteEnforcement(INERT_DOC).state, 'inert');
  assert.equal(parseSuiteEnforcement(ACTIVE_DOC).state, 'active');
  assert.equal(parseSuiteEnforcement(INVALID_DOC).state, 'invalid');
});

test('wiring: observe forceRefresh + live/cache mapping', () => {
  const tracking = src('src/core/services/shiftTracking.ts');
  assert.ok(tracking.includes('export async function observeEnforcementSafety'));
  assert.ok(/forceRefresh:\s*true/.test(tracking));
  assert.ok(tracking.includes("status: 'live'") || tracking.includes('status: "live"') || tracking.includes("status: 'live' as const"));
  assert.ok(tracking.includes("status: 'cache'") || tracking.includes('status: "cache"') || tracking.includes("status: 'cache' as const"));
  assert.ok(tracking.includes("status: 'unreadable'") || tracking.includes("status: 'unreadable' as const"));
});
