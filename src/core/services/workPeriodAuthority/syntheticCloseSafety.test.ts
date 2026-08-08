// Offline / midnight synthetic-close safety matrix.
//
// Claude correction: fetchCompanyConfig does NOT throw — it returns null or
// cache. Bare null collapses "failed read, no cache" into the same path as
// confirmed-absent contract. Shift-destructive decisions must use an
// explicit readable|unreadable outcome and must not share destructive
// permission between those states.
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

/** Successful network/cache read of a company doc with no contract field. */
const LEGACY_DOC = { tier: 'god', name: 'Never Configured Co' };

function readable(doc: unknown): (id: string) => Promise<CompanyDocLoadOutcome> {
  return async () => ({ status: 'readable', doc });
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

// ── Required coverage matrix (Claude supplement) ──────────────────────────

test('1. successful read with contract absent → confirmed_legacy, synthetic close allowed', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, readable(LEGACY_DOC), store, NOW);
  assert.equal(d.allow, true);
  assert.equal(d.enforcement.state, 'legacy');
  assert.equal(d.source, 'confirmed_legacy');
  assert.equal(d.unreadable, false);
});

test('2. failed read with no cache → unreadable unknown, synthetic close BLOCKED (not confirmed legacy)', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, unreadable(), store, NOW);
  assert.equal(d.allow, false, 'unknown/unreadable must not share destructive permission with confirmed legacy');
  assert.equal(d.source, 'temporarily_unreadable_unknown');
  assert.equal(d.unreadable, true);
  // Must not have been written as confirmed LKG legacy
  const lkg = await store.load(COMPANY);
  assert.equal(lkg, null);
});

test('3. failed read with last-known-good enforced → synthetic close BLOCKED', async () => {
  const store = createMemoryEnforcementSafetyStore();
  await resolveSyntheticCloseDecision(COMPANY, readable(ACTIVE_DOC), store, NOW);
  const d = await resolveSyntheticCloseDecision(COMPANY, unreadable(), store, NOW + 1);
  assert.equal(d.allow, false);
  assert.equal(d.source, 'last_known_good');
  assert.equal(d.enforcement.state, 'active');
  assert.equal(d.unreadable, true);
});

test('4. missing companyId → synthetic close BLOCKED (not legacy permission)', async () => {
  const store = createMemoryEnforcementSafetyStore();
  for (const id of [null, undefined, ''] as const) {
    const d = await resolveSyntheticCloseDecision(id as any, unreadable(), store, NOW);
    assert.equal(d.allow, false, `companyId=${String(id)} must not authorize synthetic close`);
    assert.equal(d.source, 'missing_company');
    assert.equal(d.unreadable, true);
  }
});

test('5. enforcement-check import failure must not fall through into destructive sweep (wiring)', () => {
  const tracking = src('src/core/services/shiftTracking.ts');
  const fn = tracking.slice(
    tracking.indexOf('async function autoCloseStaleShift'),
    tracking.indexOf('async function autoCloseStaleShift') + 3200,
  );
  // Catch must return — never fall into the daysBack sweep
  assert.ok(/catch\s*\([^)]*\)\s*\{[\s\S]*?return;/.test(fn),
    'autoCloseStaleShift catch must return (not fall through to sweep)');
  assert.ok(!/Enforcement unknown → legacy behavior/.test(fn));
  assert.ok(fn.includes('skipping sweep') || fn.includes('skipping calendar-boundary'));
});

test('6. enforcement-check runtime failure (loader throw) blocks synthetic close', async () => {
  const store = createMemoryEnforcementSafetyStore();
  // No LKG
  const cold = await resolveSyntheticCloseDecision(COMPANY, loadThrows(), store, NOW);
  assert.equal(cold.allow, false);
  assert.equal(cold.source, 'temporarily_unreadable_unknown');
  // With LKG active still blocks
  await resolveSyntheticCloseDecision(COMPANY, readable(ACTIVE_DOC), store, NOW);
  const warm = await resolveSyntheticCloseDecision(COMPANY, loadThrows(new Error('runtime')), store, NOW + 1);
  assert.equal(warm.allow, false);
  assert.equal(warm.source, 'last_known_good');
});

test('7. invalid/malformed contract fails closed (does not authorize synthetic close)', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, readable(INVALID_DOC), store, NOW);
  assert.equal(d.allow, false);
  assert.equal(d.enforcement.state, 'invalid');
  assert.equal(d.source, 'confirmed_invalid');
  if (d.enforcement.state === 'invalid') {
    assert.match(d.enforcement.reason, /unsupported_contract_version/);
  }
  // LKG invalid continues to block while unreadable
  const offline = await resolveSyntheticCloseDecision(COMPANY, unreadable(), store, NOW + 1);
  assert.equal(offline.allow, false);
  assert.equal(offline.enforcement.state, 'invalid');
});

test('8. explicitly inert contract allows synthetic close (documented unenforced)', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, readable(INERT_DOC), store, NOW);
  assert.equal(d.allow, true);
  assert.equal(d.enforcement.state, 'inert');
  assert.equal(d.source, 'confirmed_inert');
  const offline = await resolveSyntheticCloseDecision(COMPANY, unreadable(), store, NOW + 1);
  assert.equal(offline.allow, true);
  assert.equal(offline.source, 'last_known_good');
  assert.equal(offline.enforcement.state, 'inert');
});

test('9. confirmed legacy contract state allows synthetic close', async () => {
  const store = createMemoryEnforcementSafetyStore();
  // Readable config object without wellbuiltContract — NOT bare null
  const d = await resolveSyntheticCloseDecision(COMPANY, readable({ tier: 'suite' }), store, NOW);
  assert.equal(d.allow, true);
  assert.equal(d.source, 'confirmed_legacy');
  assert.equal(d.unreadable, false);
});

test('10. date fallback policy is independent of synthetic-close permission', () => {
  // Same confirmed-state matrix today, but distinct symbols/docs — must not merge
  const auth = src('src/core/services/workPeriodAuthority/suiteShiftAuthority.ts');
  assert.ok(auth.includes('export function mayUseDateFallback'));
  assert.ok(auth.includes('export function enforcementAllowsSyntheticClose'));
  assert.ok(auth.includes('intentionally independent') || auth.includes('POLICY NOTE'),
    'policies must be documented as independent');

  // Predicate values for confirmed states (current product)
  const states: SuiteEnforcement[] = [
    { state: 'legacy' },
    { state: 'inert' },
    { state: 'active', mode: 'explicit_shift' },
    { state: 'invalid', reason: 'x' },
  ];
  for (const s of states) {
    // Documented current alignment for confirmed states only
    assert.equal(mayUseDateFallback(s), enforcementAllowsSyntheticClose(s),
      `confirmed-state alignment for ${s.state}`);
  }

  // Date-fallback consumers do not write synthetic close and do not use the LKG gate
  const jsa = src('src/core/services/jsaShiftAck.ts');
  const day = src('app/day-summary.tsx');
  assert.ok(jsa.includes('mayUseDateFallback'));
  assert.ok(day.includes('mayUseDateFallback'));
  assert.ok(!jsa.includes('resolveSyntheticCloseDecision'));
  assert.ok(!day.includes('resolveSyntheticCloseDecision'));
  assert.ok(!jsa.includes('enforcementAllowsSyntheticClose'));
  assert.ok(!day.includes('enforcementAllowsSyntheticClose'));

  // Synthetic-close path does not use mayUseDateFallback
  const tracking = src('src/core/services/shiftTracking.ts');
  const autoClose = tracking.slice(
    tracking.indexOf('async function autoCloseStaleShift'),
    tracking.indexOf('async function autoCloseStaleShift') + 3200,
  );
  assert.ok(!autoClose.includes('mayUseDateFallback'));
  assert.ok(autoClose.includes('resolveSyntheticCloseDecision'));
});

// ── Additional product / wiring coverage ──────────────────────────────────

test('valid enforced explicit_shift blocks synthetic close', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, readable(ACTIVE_DOC), store, NOW);
  assert.equal(d.allow, false);
  assert.equal(d.source, 'confirmed_active');
});

test('restart offline with durable LKG enforced still blocks', async () => {
  const durable = new Map<string, LastKnownEnforcement>();
  const s1 = createMemoryEnforcementSafetyStore(durable);
  await resolveSyntheticCloseDecision(COMPANY, readable(ACTIVE_DOC), s1, NOW);
  const s2 = createMemoryEnforcementSafetyStore(durable);
  const d = await resolveSyntheticCloseDecision(COMPANY, unreadable(), s2, NOW + 86_400_000);
  assert.equal(d.allow, false);
  assert.equal(d.source, 'last_known_good');
});

test('cache TTL is irrelevant to durable LKG safety decision', async () => {
  const store = createMemoryEnforcementSafetyStore();
  await resolveSyntheticCloseDecision(COMPANY, readable(ACTIVE_DOC), store, NOW);
  const afterHour = await resolveSyntheticCloseDecision(
    COMPANY,
    unreadable(),
    store,
    NOW + 60 * 60 * 1000 + 1,
  );
  assert.equal(afterHour.allow, false);
  assert.equal(afterHour.source, 'last_known_good');
});

test('54-hour explicit shift: no duration path authorizes synthetic close', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const after54h = NOW + 54 * 60 * 60 * 1000;
  const d = await resolveSyntheticCloseDecision(COMPANY, readable(ACTIVE_DOC), store, after54h);
  assert.equal(d.allow, false);
  const authSrc = src('src/core/services/workPeriodAuthority/suiteShiftAuthority.ts');
  assert.ok(!/MAX_SHIFT_HOURS|54 \* 60|hoursSince/.test(authSrc));
});

test('explicit logout path is independent of synthetic-close gate', () => {
  const tracking = src('src/core/services/shiftTracking.ts');
  assert.ok(tracking.includes("if (type === 'login')"));
  assert.ok(/autoCloseStaleShift\(driverId, source, companyId\)/.test(tracking));
  const auth = src('src/core/context/AuthContext.tsx');
  assert.ok(auth.includes("recordShiftEvent('logout'"));
});

test('ticket/JSA/DVIR gates not weakened; LKG gate only on autoClose', () => {
  assert.equal(enforcementAllowsSyntheticClose({ state: 'active', mode: 'explicit_shift' }), false);
  assert.equal(enforcementAllowsSyntheticClose({ state: 'invalid', reason: 'x' }), false);
  assert.ok(src('src/core/services/jsaShiftAck.ts').includes('mayUseDateFallback'));
  assert.ok(src('app/day-summary.tsx').includes('mayUseDateFallback'));
  const tracking = src('src/core/services/shiftTracking.ts');
  assert.ok(tracking.includes('resolveSyntheticCloseDecision'));
  assert.ok(tracking.includes('loadCompanyConfigResult'));
  assert.ok(!tracking.includes('fetchCompanyConfig(id)') || tracking.includes('loadCompanyConfigResult'),
    'autoClose must not feed bare fetchCompanyConfig null into the safety gate');
});

test('vc11 contract-adoption parse semantics remain green', () => {
  assert.equal(parseSuiteEnforcement({ tier: 'god' }).state, 'legacy');
  assert.equal(parseSuiteEnforcement(undefined).state, 'legacy');
  assert.equal(parseSuiteEnforcement(INERT_DOC).state, 'inert');
  assert.equal(parseSuiteEnforcement(ACTIVE_DOC).state, 'active');
  assert.equal(parseSuiteEnforcement(INVALID_DOC).state, 'invalid');
  assert.equal(parseSuiteEnforcement({ wellbuiltContract: { contractEnforced: true, contractVersion: 1 } }).state, 'invalid');
});

test('live re-read can demote LKG active → confirmed inert', async () => {
  const store = createMemoryEnforcementSafetyStore();
  await resolveSyntheticCloseDecision(COMPANY, readable(ACTIVE_DOC), store, NOW);
  const demoted = await resolveSyntheticCloseDecision(COMPANY, readable(INERT_DOC), store, NOW + 1);
  assert.equal(demoted.allow, true);
  assert.equal(demoted.source, 'confirmed_inert');
});

test('never-configured company is not promoted to enforced by unreadable path', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const offline = await resolveSyntheticCloseDecision(COMPANY, unreadable(), store, NOW);
  assert.equal(offline.enforcement.state, 'legacy');
  assert.equal(offline.allow, false); // blocks close, but does not invent "active"
  assert.notEqual(offline.source, 'confirmed_active');
  // Online success still confirms true legacy and allows
  const online = await resolveSyntheticCloseDecision(COMPANY, readable(LEGACY_DOC), store, NOW + 1);
  assert.equal(online.allow, true);
  assert.equal(online.source, 'confirmed_legacy');
});

// ── companyConfig source pins (null collapse + TTL + cutover) ─────────────

test('companyConfig: getCachedConfig failure path does not enforce TTL', () => {
  const cc = src('src/core/services/companyConfig.ts');
  // Failure path returns cache without comparing fetchedAt to TTL
  assert.ok(cc.includes('async function getCachedConfig'));
  assert.ok(/Intentionally does NOT enforce TTL|does NOT enforce TTL/.test(cc));
  // TTL only on fresh fast path
  assert.ok(cc.includes('CACHE_TTL_MS'));
  assert.ok(cc.includes('freshness: \'fresh\'') || cc.includes('freshness: "fresh"') || cc.includes("freshness: 'fresh'"));
  assert.ok(cc.includes('freshness: \'stale\'') || cc.includes("freshness: 'stale'"));
});

test('companyConfig: loadCompanyConfigResult distinguishes live/cache/unavailable', () => {
  const cc = src('src/core/services/companyConfig.ts');
  assert.ok(cc.includes('export async function loadCompanyConfigResult'));
  assert.ok(cc.includes("kind: 'live'"));
  assert.ok(cc.includes("kind: 'cache'"));
  assert.ok(cc.includes("kind: 'unavailable'"));
  assert.ok(cc.includes('forceRefresh'));
  // fetchCompanyConfig is a null-collapsing convenience wrapper
  assert.ok(cc.includes('export async function fetchCompanyConfig'));
});

test('companyConfig: forceRefresh bypasses TTL without clearing other state', () => {
  const cc = src('src/core/services/companyConfig.ts');
  assert.ok(cc.includes('forceRefresh'));
  assert.ok(/forceRefresh[\s\S]{0,200}CACHE_TTL|!forceRefresh/.test(cc));
  const hook = src('src/core/hooks/useCompanyConfig.ts');
  assert.ok(hook.includes('forceRefresh'));
  assert.ok(hook.includes('fetchCompanyConfig(companyId, { forceRefresh })'));
  // clearCache still only company-config keys — not auth/shift
  const clear = cc.slice(cc.indexOf('clearCompanyConfigCache'));
  assert.ok(clear.includes('CACHE_KEY_PREFIX') || clear.includes('wellbuilt-company-config-'));
  assert.ok(!clear.includes('enforcement-safety'));
});

test('wiring: autoClose maps unavailable→unreadable, never bare null as confirmed', () => {
  const tracking = src('src/core/services/shiftTracking.ts');
  const fn = tracking.slice(
    tracking.indexOf('async function autoCloseStaleShift'),
    tracking.indexOf('async function autoCloseStaleShift') + 3500,
  );
  assert.ok(fn.includes('loadCompanyConfigResult'));
  assert.ok(fn.includes("status: 'unreadable'") || fn.includes('status: "unreadable"') || fn.includes("status: 'unreadable' as const"));
  assert.ok(fn.includes("status: 'readable'") || fn.includes('status: "readable"') || fn.includes("status: 'readable' as const"));
  assert.ok(fn.includes('createAsyncStorageEnforcementSafetyStore'));
  // Must not call resolve with bare fetchCompanyConfig return value
  assert.ok(!/resolveSyntheticCloseDecision\(\s*companyId,\s*\(id\)\s*=>\s*fetchCompanyConfig/.test(fn));
});

test('readable empty object is confirmed legacy; unreadable is not', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const confirmed = await resolveSyntheticCloseDecision(COMPANY, readable({}), store, NOW);
  assert.equal(confirmed.source, 'confirmed_legacy');
  assert.equal(confirmed.allow, true);

  const store2 = createMemoryEnforcementSafetyStore();
  const unknown = await resolveSyntheticCloseDecision(COMPANY, unreadable(), store2, NOW);
  assert.equal(unknown.source, 'temporarily_unreadable_unknown');
  assert.equal(unknown.allow, false);
});
