// Offline / midnight synthetic-close safety matrix.
//
// Product: once WB-S has positively observed a valid enforced explicit-shift
// contract for a company, a transient company-doc read failure must never
// authorize a calendar-boundary synthetic logout. Never-configured companies
// stay legacy. Malformed contracts are invalid (diagnostic), not silent-valid.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  createMemoryEnforcementSafetyStore,
  enforcementAllowsSyntheticClose,
  parseSuiteEnforcement,
  resolveSyntheticCloseDecision,
  type LastKnownEnforcement,
  type SuiteEnforcement,
} from './suiteShiftAuthority';

const COMPANY = 'liquid-gold';
const NOW = Date.parse('2026-08-08T06:00:00.000Z'); // just after "midnight" sweep window

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

function loadOk(doc: unknown) {
  return async (_id: string) => doc;
}
function loadThrow(err: Error = new Error('firestore offline')) {
  return async (_id: string) => {
    throw err;
  };
}

// ── 1. Confirmed legacy retains synthetic-close authorization ─────────────
test('1. confirmed legacy company retains legacy synthetic-close behavior', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, loadOk(LEGACY_DOC), store, NOW);
  assert.equal(d.allow, true);
  assert.equal(d.enforcement.state, 'legacy');
  assert.equal(d.source, 'confirmed_legacy');
  assert.equal(d.unreadable, false);
  assert.equal(enforcementAllowsSyntheticClose(d.enforcement), true);
});

// ── 2. Valid enforced explicit-shift disables synthetic midnight close ────
test('2. valid enforced explicit-shift contract disables synthetic midnight close', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, loadOk(ACTIVE_DOC), store, NOW);
  assert.equal(d.allow, false);
  assert.equal(d.enforcement.state, 'active');
  assert.equal(d.source, 'confirmed_active');
  if (d.enforcement.state === 'active') {
    assert.equal(d.enforcement.mode, 'explicit_shift');
  }
});

// ── 3. Transient read failure after LKG enforced does not enable close ────
test('3. transient read failure after last-known-good enforced does not enable synthetic close', async () => {
  const store = createMemoryEnforcementSafetyStore();
  // Positive observation first
  const live = await resolveSyntheticCloseDecision(COMPANY, loadOk(ACTIVE_DOC), store, NOW);
  assert.equal(live.allow, false);
  // Transient failure
  const offline = await resolveSyntheticCloseDecision(
    COMPANY,
    loadThrow(new Error('UNAVAILABLE')),
    store,
    NOW + 3_600_000,
  );
  assert.equal(offline.allow, false, 'LKG enforced must block synthetic close while unreadable');
  assert.equal(offline.source, 'last_known_good');
  assert.equal(offline.unreadable, true);
  assert.equal(offline.enforcement.state, 'active');
});

// ── 4. Restart offline with durable LKG does not enable synthetic close ───
test('4. restart offline with durable last-known-good enforced state does not enable synthetic close', async () => {
  // Simulate process restart: new store instance seeded from durable payload
  const durable = new Map<string, LastKnownEnforcement>();
  const session1 = createMemoryEnforcementSafetyStore(durable);
  await resolveSyntheticCloseDecision(COMPANY, loadOk(ACTIVE_DOC), session1, NOW);

  const session2 = createMemoryEnforcementSafetyStore(durable); // "restart"
  const d = await resolveSyntheticCloseDecision(
    COMPANY,
    loadThrow(new Error('offline after restart')),
    session2,
    NOW + 86_400_000,
  );
  assert.equal(d.allow, false);
  assert.equal(d.source, 'last_known_good');
  assert.equal(d.enforcement.state, 'active');
});

// ── 5. Cache expiry alone does not erase the safety decision ──────────────
test('5. cache expiry alone does not erase the safety decision', async () => {
  const store = createMemoryEnforcementSafetyStore();
  await resolveSyntheticCloseDecision(COMPANY, loadOk(ACTIVE_DOC), store, NOW);
  // One hour later (companyConfig TTL would have expired); LKG still present.
  const afterTtl = await resolveSyntheticCloseDecision(
    COMPANY,
    loadThrow(new Error('network after ttl')),
    store,
    NOW + 60 * 60 * 1000 + 1,
  );
  assert.equal(afterTtl.allow, false);
  assert.equal(afterTtl.source, 'last_known_good');
  // LKG has no TTL field that gates the decision — only observedAtMs for diagnostics.
  const lkg = await store.load(COMPANY);
  assert.ok(lkg);
  assert.equal(typeof lkg!.observedAtMs, 'number');
  assert.ok(afterTtl.unreadable);
});

// ── 6. Malformed contract → invalid, does not authorize destructive close ─
test('6. malformed contract produces invalid/diagnostic state and does not authorize synthetic close', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, loadOk(INVALID_DOC), store, NOW);
  assert.equal(d.allow, false);
  assert.equal(d.enforcement.state, 'invalid');
  assert.equal(d.source, 'confirmed_invalid');
  if (d.enforcement.state === 'invalid') {
    assert.match(d.enforcement.reason, /unsupported_contract_version/);
  }
  // And LKG invalid continues to block while unreadable
  const offline = await resolveSyntheticCloseDecision(COMPANY, loadThrow(), store, NOW + 1);
  assert.equal(offline.allow, false);
  assert.equal(offline.enforcement.state, 'invalid');
});

// ── 7. Explicitly unenforced contract follows documented inert behavior ───
test('7. explicitly unenforced contract follows inert behavior (synthetic close allowed)', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, loadOk(INERT_DOC), store, NOW);
  assert.equal(d.allow, true);
  assert.equal(d.enforcement.state, 'inert');
  assert.equal(d.source, 'confirmed_inert');
  // After inert LKG, unreadable still allows (genuine unenforced)
  const offline = await resolveSyntheticCloseDecision(COMPANY, loadThrow(), store, NOW + 1);
  assert.equal(offline.allow, true);
  assert.equal(offline.source, 'last_known_good');
  assert.equal(offline.enforcement.state, 'inert');
});

// ── 8. Never-configured company is not promoted to enforced ───────────────
test('8. never-configured company is not incorrectly promoted to enforced', async () => {
  const store = createMemoryEnforcementSafetyStore();
  // Offline with empty store — no positive observation ever
  const d = await resolveSyntheticCloseDecision(COMPANY, loadThrow(), store, NOW);
  assert.equal(d.allow, true);
  assert.equal(d.enforcement.state, 'legacy');
  assert.equal(d.source, 'temporarily_unreadable_default_legacy');
  assert.equal(d.unreadable, true);
  // Live absent contract also stays legacy
  const live = await resolveSyntheticCloseDecision(COMPANY, loadOk(undefined), store, NOW);
  assert.equal(live.allow, true);
  assert.equal(live.enforcement.state, 'legacy');
  assert.equal(live.source, 'confirmed_legacy');
});

// ── 9. 54-hour explicit shift remains open (authority matrix + close gate) ─
test('9. a 54-hour explicit shift remains open (no duration / midnight synthetic path)', async () => {
  // Gate: active enforcement never authorizes synthetic close regardless of elapsed hours.
  const store = createMemoryEnforcementSafetyStore();
  const start = Date.parse('2026-08-05T12:00:00.000Z');
  const after54h = start + 54 * 60 * 60 * 1000;
  const d = await resolveSyntheticCloseDecision(COMPANY, loadOk(ACTIVE_DOC), store, after54h);
  assert.equal(d.allow, false, 'elapsed hours must never authorize synthetic close under explicit_shift');
  // No MAX duration constant in the authority module
  const authSrc = readFileSync(join(__dirname, 'suiteShiftAuthority.ts'), 'utf8');
  assert.ok(!/MAX_SHIFT_HOURS|54 \* 60|hoursSince/.test(authSrc));
});

// ── 10. Explicit Shift Close still closes normally (gate is synthetic-only)
test('10. explicit Shift Close path is not blocked by synthetic-close safety (gate is synthetic-only)', () => {
  // The safety gate only feeds autoCloseStaleShift. Genuine logout is
  // recordShiftEvent('logout') — independent. Pin the production wiring.
  const root = join(__dirname, '..', '..', '..', '..');
  const tracking = readFileSync(join(root, 'src/core/services/shiftTracking.ts'), 'utf8');
  const autoClose = tracking.slice(
    tracking.indexOf('async function autoCloseStaleShift'),
    tracking.indexOf('async function autoCloseStaleShift') + 2500,
  );
  assert.ok(autoClose.includes('resolveSyntheticCloseDecision'));
  // Genuine logout recording is a separate export/path
  assert.ok(tracking.includes("type: 'login' | 'logout' | 'depart_return'"));
  assert.ok(tracking.includes("if (type === 'login')"));
  assert.ok(
    /autoCloseStaleShift\(driverId, source, companyId\)/.test(tracking),
    'autoClose only from login/resume paths, not from explicit logout',
  );
  // AuthContext logout still records genuine logout (post-trip gated separately)
  const auth = readFileSync(join(root, 'src/core/context/AuthContext.tsx'), 'utf8');
  assert.ok(/recordShiftEvent\(\s*['"]logout['"]/.test(auth) || auth.includes("recordShiftEvent('logout'"),
    'explicit logout still records a genuine logout event');
});

// ── 11. Ticket/JSA/DVIR gates not weakened ────────────────────────────────
test('11. ticket/JSA/DVIR gates are not weakened by synthetic-close LKG path', () => {
  const root = join(__dirname, '..', '..', '..', '..');
  // mayUseDateFallback still blocks under active/invalid — LKG not wired into
  // date fallback (which would be a separate authorization concern).
  assert.equal(enforcementAllowsSyntheticClose({ state: 'active', mode: 'explicit_shift' }), false);
  assert.equal(enforcementAllowsSyntheticClose({ state: 'invalid', reason: 'x' }), false);
  // JSA still gates date fallback via parseSuiteEnforcement on live config
  const jsa = readFileSync(join(root, 'src/core/services/jsaShiftAck.ts'), 'utf8');
  assert.ok(jsa.includes('mayUseDateFallback'));
  assert.ok(jsa.includes('parseSuiteEnforcement'));
  // Day summary still enforcement-gates date fallback
  const day = readFileSync(join(root, 'app/day-summary.tsx'), 'utf8');
  assert.ok(day.includes('mayUseDateFallback'));
  // DVIR completion authority still imports SuiteEnforcement (unchanged surface)
  const dvir = readFileSync(join(root, 'src/core/services/workPeriodAuthority/dvirCompletionAuthority.ts'), 'utf8');
  assert.ok(dvir.includes('SuiteEnforcement') || dvir.includes('suiteShiftAuthority'));
  // resolveSyntheticCloseDecision is only consumed by autoCloseStaleShift
  const tracking = readFileSync(join(root, 'src/core/services/shiftTracking.ts'), 'utf8');
  assert.ok(tracking.includes('resolveSyntheticCloseDecision'));
  assert.ok(!jsa.includes('resolveSyntheticCloseDecision'));
  assert.ok(!day.includes('resolveSyntheticCloseDecision'));
});

// ── 12. Existing parse/adoption semantics remain (vc11 contract consumer) ─
test('12. existing vc11 contract-adoption parse semantics remain green', () => {
  assert.equal(parseSuiteEnforcement({ tier: 'god' }).state, 'legacy');
  assert.equal(parseSuiteEnforcement(undefined).state, 'legacy');
  assert.equal(parseSuiteEnforcement(INERT_DOC).state, 'inert');
  assert.equal(parseSuiteEnforcement(ACTIVE_DOC).state, 'active');
  assert.equal(parseSuiteEnforcement(INVALID_DOC).state, 'invalid');
  assert.equal(parseSuiteEnforcement({ wellbuiltContract: { contractEnforced: true, contractVersion: 1 } }).state, 'invalid');
});

// ── Additional matrix coverage ────────────────────────────────────────────
test('matrix: online midnight with active contract blocks synthetic close', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, loadOk(ACTIVE_DOC), store, NOW);
  assert.equal(d.allow, false);
  assert.equal(d.unreadable, false);
});

test('matrix: offline midnight with LKG active blocks synthetic close', async () => {
  const store = createMemoryEnforcementSafetyStore();
  await resolveSyntheticCloseDecision(COMPANY, loadOk(ACTIVE_DOC), store, NOW - 1000);
  const d = await resolveSyntheticCloseDecision(COMPANY, loadThrow(), store, NOW);
  assert.equal(d.allow, false);
  assert.equal(d.source, 'last_known_good');
});

test('matrix: live re-read can demote LKG active → confirmed inert (real unenforce)', async () => {
  const store = createMemoryEnforcementSafetyStore();
  await resolveSyntheticCloseDecision(COMPANY, loadOk(ACTIVE_DOC), store, NOW);
  const demoted = await resolveSyntheticCloseDecision(COMPANY, loadOk(INERT_DOC), store, NOW + 1);
  assert.equal(demoted.allow, true);
  assert.equal(demoted.source, 'confirmed_inert');
  // Subsequent offline uses the new LKG
  const offline = await resolveSyntheticCloseDecision(COMPANY, loadThrow(), store, NOW + 2);
  assert.equal(offline.allow, true);
  assert.equal(offline.enforcement.state, 'inert');
});

test('matrix: missing companyId allows synthetic close (no activation signal)', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(null, loadThrow(), store, NOW);
  assert.equal(d.allow, true);
  assert.equal(d.source, 'missing_company');
});

test('matrix: null live doc is confirmed legacy (not unreadable)', async () => {
  const store = createMemoryEnforcementSafetyStore();
  const d = await resolveSyntheticCloseDecision(COMPANY, loadOk(null), store, NOW);
  assert.equal(d.allow, true);
  assert.equal(d.source, 'confirmed_legacy');
  assert.equal(d.unreadable, false);
});

test('wiring: autoCloseStaleShift uses resolveSyntheticCloseDecision + durable store', () => {
  const root = join(__dirname, '..', '..', '..', '..');
  const tracking = readFileSync(join(root, 'src/core/services/shiftTracking.ts'), 'utf8');
  const fn = tracking.slice(
    tracking.indexOf('async function autoCloseStaleShift'),
    tracking.indexOf('async function autoCloseStaleShift') + 2800,
  );
  assert.ok(fn.includes('resolveSyntheticCloseDecision'));
  assert.ok(fn.includes('createAsyncStorageEnforcementSafetyStore'));
  // Must not fail-open to the sweep on gate errors
  assert.ok(/skipping sweep|skipping calendar-boundary/i.test(fn));
  assert.ok(!/Enforcement unknown → legacy behavior/.test(fn),
    'old fail-open catch comment/path must be gone');
});

test('parseSuiteEnforcement still treats absent contract as legacy (never auto-promote)', () => {
  const e: SuiteEnforcement = parseSuiteEnforcement({});
  assert.equal(e.state, 'legacy');
  assert.equal(enforcementAllowsSyntheticClose(e), true);
});
