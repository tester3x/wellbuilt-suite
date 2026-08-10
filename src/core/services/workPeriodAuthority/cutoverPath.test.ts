// Cutover path: force-refresh + live LKG persistence through real lifecycle
// wiring (secure login, session restore, autoClose / Start Shift, resume).
//
// Proves the gap that existed on vc13: forceRefresh existed but had ZERO
// production callers, so a stale pre-contract company-config cache could
// survive upgrade and re-confirm legacy without observing configurationVersion:3.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  createMemoryEnforcementSafetyStore,
  enforcementSafetyLkgKey,
  parseSuiteEnforcement,
  readConfigurationVersion,
  resolveSyntheticCloseDecision,
  type CompanyDocLoadOutcome,
  type LastKnownEnforcement,
} from './suiteShiftAuthority';

const COMPANY = 'liquid-gold';
const NOW = Date.parse('2026-08-09T00:00:00.000Z');
const root = join(__dirname, '..', '..', '..', '..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

const PRE_CONTRACT = { tier: 'suite', name: 'Liquid Gold' }; // no wellbuiltContract

const V3_ACTIVE = {
  tier: 'suite',
  name: 'Liquid Gold',
  wellbuiltContract: {
    contractEnforced: true,
    contractVersion: 1,
    configurationVersion: 3,
    workPeriodConfiguration: { mode: 'explicit_shift' },
  },
};

const V3_INERT_ROLLBACK = {
  tier: 'suite',
  wellbuiltContract: {
    contractEnforced: false,
    contractVersion: 1,
    configurationVersion: 4,
    workPeriodConfiguration: { mode: 'explicit_shift' },
  },
};

function live(doc: unknown): (id: string) => Promise<CompanyDocLoadOutcome> {
  return async () => ({ status: 'live', doc });
}
function cache(doc: unknown): (id: string) => Promise<CompanyDocLoadOutcome> {
  return async () => ({ status: 'cache', doc });
}
function unreadable(): (id: string) => Promise<CompanyDocLoadOutcome> {
  return async () => ({ status: 'unreadable' });
}

// ── Cutover matrix ────────────────────────────────────────────────────────

test('1. stale pre-contract cache exists and must not alone persist LKG as confirmed live', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, cache(PRE_CONTRACT), store, NOW);
  assert.equal(d.loadKind, 'cache');
  assert.equal(d.lkgUpdated, false, 'cache-only must not write durable LKG');
  assert.equal(d.source, 'cache_provisional');
  assert.equal(await store.load(COMPANY), null);
});

test('2. forced live refresh receives configurationVersion 3', async () => {
  assert.equal(readConfigurationVersion(V3_ACTIVE), 3);
  assert.equal(readConfigurationVersion(PRE_CONTRACT), null);
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, live(V3_ACTIVE), store, NOW);
  assert.equal(d.loadKind, 'live');
  assert.equal(d.enforcement.state, 'active');
  assert.equal(readConfigurationVersion(V3_ACTIVE), 3);
});

test('3. safety resolver consumes the same live result (active explicit_shift)', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, live(V3_ACTIVE), store, NOW);
  assert.equal(d.allow, false);
  assert.equal(d.source, 'confirmed_active');
  assert.equal(d.unreadable, false);
  if (d.enforcement.state === 'active') {
    assert.equal(d.enforcement.mode, 'explicit_shift');
  }
});

test('4. enforced LKG is durably persisted from live only', async () => {
  const durable = new Map<string, LastKnownEnforcement>();
  const store = createMemoryEnforcementSafetyStore(durable);
  const d = await resolveSyntheticCloseDecision(COMPANY, live(V3_ACTIVE), store, NOW);
  assert.equal(d.lkgUpdated, true);
  const lkg = await store.load(COMPANY);
  assert.ok(lkg);
  assert.equal(lkg!.enforcement.state, 'active');
  assert.equal(lkg!.observedAtMs, NOW);
  // Key shape for operator/docs (no secrets)
  assert.equal(enforcementSafetyLkgKey(COMPANY), `wellbuilt-enforcement-safety-lkg-${COMPANY}`);
  // Expected durable value after v3 enforced cutover
  assert.deepEqual(lkg!.enforcement, parseSuiteEnforcement(V3_ACTIVE));
});

test('5. subsequent offline resume blocks synthetic close via LKG', async () => {
  const durable = new Map<string, LastKnownEnforcement>();
  const s1 = createMemoryEnforcementSafetyStore(durable);
  await resolveSyntheticCloseDecision(COMPANY, live(V3_ACTIVE), s1, NOW);
  // "Restart" + offline + even stale pre-contract cache present
  const s2 = createMemoryEnforcementSafetyStore(durable);
  const offline = await resolveSyntheticCloseDecision(COMPANY, unreadable(), s2, NOW + 1);
  assert.equal(offline.allow, false);
  assert.equal(offline.source, 'last_known_good');
  assert.equal(offline.enforcement.state, 'active');
  assert.equal(offline.lkgUpdated, false);
  // Stale pre-contract cache must not clobber LKG or allow close
  const stale = await resolveSyntheticCloseDecision(COMPANY, cache(PRE_CONTRACT), s2, NOW + 2);
  assert.equal(stale.allow, false);
  assert.equal(stale.source, 'last_known_good');
  assert.equal(stale.lkgUpdated, false);
  assert.equal((await s2.load(COMPANY))!.enforcement.state, 'active');
});

test('6. observe/cutover path does not clear auth/shift/JSA/DVIR keys (wiring)', () => {
  const tracking = src('src/core/services/shiftTracking.ts');
  const observe = tracking.slice(
    tracking.indexOf('export async function observeEnforcementSafety'),
    tracking.indexOf('export async function observeEnforcementSafety') + 3500,
  );
  assert.ok(observe.includes('forceRefresh: true') || observe.includes('forceRefresh:true'));
  assert.ok(observe.includes('loadCompanyConfigResult'));
  assert.ok(observe.includes('resolveSyntheticCloseDecision'));
  // Must not wipe session/shift/JSA/DVIR stores
  assert.ok(!/clearCurrentShiftId|multiRemove|clearCompanyConfigCache|deleteItemAsync/.test(observe));
  const auth = src('src/core/context/AuthContext.tsx');
  assert.ok(auth.includes("observeEnforcementSafety(result.companyId, 'AuthContext.login')"));
  assert.ok(auth.includes("observeEnforcementSafety(session.companyId, 'AuthContext.sessionRestore')"));
  // Login observe is BEFORE the clean-slate SecureStore clears for shift flags —
  // those clears are intentional new-login slate, not caused by observe.
  // Observe itself must not be the clearer.
  assert.ok(auth.includes('observeEnforcementSafety'));
});

test('7. failed cutover read does not overwrite enforced LKG with legacy/unknown', async () => {
  const store = createMemoryEnforcementSafetyStore();
  await resolveSyntheticCloseDecision(COMPANY, live(V3_ACTIVE), store, NOW);
  // Network fail
  const u = await resolveSyntheticCloseDecision(COMPANY, unreadable(), store, NOW + 1);
  assert.equal(u.lkgUpdated, false);
  assert.equal((await store.load(COMPANY))!.enforcement.state, 'active');
  // Stale pre-contract cache after failed live
  const c = await resolveSyntheticCloseDecision(COMPANY, cache(PRE_CONTRACT), store, NOW + 2);
  assert.equal(c.lkgUpdated, false);
  assert.equal(c.allow, false);
  assert.equal((await store.load(COMPANY))!.enforcement.state, 'active');
});

test('8. confirmed later enforcement-off live read deliberately updates LKG (rollback)', async () => {
  const store = createMemoryEnforcementSafetyStore();
  await resolveSyntheticCloseDecision(COMPANY, live(V3_ACTIVE), store, NOW);
  const rolled = await resolveSyntheticCloseDecision(COMPANY, live(V3_INERT_ROLLBACK), store, NOW + 1);
  assert.equal(rolled.lkgUpdated, true);
  assert.equal(rolled.allow, true);
  assert.equal(rolled.source, 'confirmed_inert');
  assert.equal((await store.load(COMPANY))!.enforcement.state, 'inert');
});

test('9. genuine legacy companies retain allow-on-live-confirmed-legacy behavior', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, live(PRE_CONTRACT), store, NOW);
  assert.equal(d.allow, true);
  assert.equal(d.source, 'confirmed_legacy');
  assert.equal(d.lkgUpdated, true);
  assert.equal((await store.load(COMPANY))!.enforcement.state, 'legacy');
});

test('10. unreadable state grants no ticket/JSA/DVIR-style authorization (no date fallback promotion)', () => {
  // mayUseDateFallback only takes SuiteEnforcement — unreadable never produces
  // a fake active. Unreadable path never invents active enforcement.
  const auth = src('src/core/services/workPeriodAuthority/suiteShiftAuthority.ts');
  assert.ok(auth.includes("source: 'temporarily_unreadable_unknown'"));
  // JSA/day-summary still use live parseSuiteEnforcement of fetchCompanyConfig —
  // they do not use LKG to grant. Pin they still do not call resolveSyntheticCloseDecision.
  assert.ok(!src('src/core/services/jsaShiftAck.ts').includes('resolveSyntheticCloseDecision'));
  assert.ok(!src('app/day-summary.tsx').includes('resolveSyntheticCloseDecision'));
});

// ── Production caller census pins ─────────────────────────────────────────

test('production: observeEnforcementSafety is the real forceRefresh caller', () => {
  const tracking = src('src/core/services/shiftTracking.ts');
  assert.ok(tracking.includes('export async function observeEnforcementSafety'));
  assert.ok(/forceRefresh:\s*true/.test(tracking));
  // autoClose delegates to observe (not a separate non-forced path)
  const auto = tracking.slice(
    tracking.indexOf('async function autoCloseStaleShift'),
    tracking.indexOf('async function autoCloseStaleShift') + 1500,
  );
  assert.ok(auto.includes('observeEnforcementSafety'));
});

test('production: secure login + session restore call observe (not Start Shift only)', () => {
  const auth = src('src/core/context/AuthContext.tsx');
  assert.ok(auth.includes("'AuthContext.login'"));
  assert.ok(auth.includes("'AuthContext.sessionRestore'"));
  // Legacy Start Shift still records login; enforced path uses claimEnforcedExplicitStart
  assert.ok(auth.includes('claimEnforcedExplicitStart') || auth.includes("recordShiftEvent(\n        'login'"));
  assert.ok(auth.includes('claimEnforcedExplicitStart'));
});

test('production: useCompanyConfig.refresh(true) still has no UI caller (optional); lifecycle is authoritative', () => {
  // HomeScreen must not be the only cutover path
  const home = src('src/ui/v1-grid/screens/HomeScreen.tsx');
  assert.ok(!home.includes('refresh(true)'));
  assert.ok(!home.includes('forceRefresh'));
  // Authoritative path is AuthContext + observeEnforcementSafety
  assert.ok(src('src/core/context/AuthContext.tsx').includes('observeEnforcementSafety'));
});

test('bounded diagnostic does not log full company document', () => {
  const tracking = src('src/core/services/shiftTracking.ts');
  const observe = tracking.slice(
    tracking.indexOf('export async function observeEnforcementSafety'),
    tracking.indexOf('export async function observeEnforcementSafety') + 2800,
  );
  assert.ok(observe.includes('enforcement.safety.observe'));
  assert.ok(observe.includes('configurationVersion'));
  assert.ok(observe.includes('enforcementState'));
  assert.ok(observe.includes('lkgUpdated'));
  assert.ok(!observe.includes('wellbuiltContract:') || !/extra:[\s\S]*wellbuiltContract/.test(observe));
  assert.ok(!observe.includes('JSON.stringify(result.config)'));
});

test('end-to-end cutover sequence: stale cache → live v3 → offline block', async () => {
  const durable = new Map<string, LastKnownEnforcement>();
  const store = createMemoryEnforcementSafetyStore(durable);

  // Device after vc10→vc13 with stale pre-contract cache
  const before = await resolveSyntheticCloseDecision(COMPANY, cache(PRE_CONTRACT), store, NOW);
  assert.equal(before.lkgUpdated, false);
  assert.equal(before.allow, true); // provisional legacy, no LKG yet

  // Operator: configure LG v3, then secure login (live force-refresh)
  const cutover = await resolveSyntheticCloseDecision(COMPANY, live(V3_ACTIVE), store, NOW + 1000);
  assert.equal(cutover.lkgUpdated, true);
  assert.equal(cutover.allow, false);
  assert.equal(cutover.source, 'confirmed_active');
  assert.equal(readConfigurationVersion(V3_ACTIVE), 3);

  // Later offline midnight / resume
  const night = await resolveSyntheticCloseDecision(COMPANY, unreadable(), store, NOW + 86_400_000);
  assert.equal(night.allow, false);
  assert.equal(night.source, 'last_known_good');
});
