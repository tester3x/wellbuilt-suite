// vc51.9C — canonical WB-S shift-authority matrix (red-first: the
// wiring assertions at the bottom fail until AuthContext/shiftTracking
// consume the adapter).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  mayUseDateFallback,
  parseSuiteEnforcement,
  verifyCachedShiftAgainstAuthority,
} from './suiteShiftAuthority';

const NOW = Date.parse('2026-08-06T15:00:00.000Z');
const base = { companyId: 'liquid-gold', driverId: 'hash-1', localDate: '2026-08-06', nowMs: NOW };
const doc = (m: Record<string, { readable: boolean; present: boolean; currentShiftId?: string }>) =>
  async (d: string) => m[d] ?? { readable: false, present: false };

test('compatibility: no contract → legacy; tier alone never activates', () => {
  assert.equal(parseSuiteEnforcement({ tier: 'god' }).state, 'legacy');
  assert.equal(parseSuiteEnforcement(undefined).state, 'legacy');
});
test('compatibility: unenforced contract → inert; membership alone requires nothing', () => {
  assert.equal(parseSuiteEnforcement({ wellbuiltContract: { contractEnforced: false } }).state, 'inert');
});
test('compatibility: enforced valid → active; unknown/invalid → fail closed', () => {
  assert.equal(parseSuiteEnforcement({ wellbuiltContract: { contractEnforced: true, contractVersion: 1, workPeriodConfiguration: { mode: 'explicit_shift' } } }).state, 'active');
  assert.equal(parseSuiteEnforcement({ wellbuiltContract: { contractEnforced: true, contractVersion: 9, workPeriodConfiguration: { mode: 'explicit_shift' } } }).state, 'invalid');
  assert.equal(parseSuiteEnforcement({ wellbuiltContract: { contractEnforced: true, contractVersion: 1 } }).state, 'invalid');
});
test('date fallback allowed only outside active enforcement', () => {
  assert.equal(mayUseDateFallback({ state: 'legacy' }), true);
  assert.equal(mayUseDateFallback({ state: 'inert' }), true);
  assert.equal(mayUseDateFallback({ state: 'active', mode: 'explicit_shift' }), false);
  assert.equal(mayUseDateFallback({ state: 'invalid', reason: 'x' }), false);
});

test('lifecycle: cached id matching an open authoritative period verifies open', async () => {
  const v = await verifyCachedShiftAgainstAuthority({
    ...base, cachedShiftId: '2026-08-06_060000',
    fetchDayDoc: doc({ '2026-08-06': { readable: true, present: true, currentShiftId: '2026-08-06_060000' } }),
  });
  assert.equal(v.verdict, 'verified_open');
  assert.equal((v as { periodId: string }).periodId, '2026-08-06_060000');
});
test('lifecycle: overnight cached id verified against its ORIGIN day', async () => {
  const v = await verifyCachedShiftAgainstAuthority({
    ...base, cachedShiftId: '2026-08-05_180000',
    fetchDayDoc: doc({
      '2026-08-06': { readable: true, present: false },
      '2026-08-05': { readable: true, present: true, currentShiftId: '2026-08-05_180000' },
    }),
  });
  assert.equal(v.verdict, 'verified_open');
});
test('lifecycle: cached id whose authority is closed → verified_closed (cleared, never reopened)', async () => {
  const v = await verifyCachedShiftAgainstAuthority({
    ...base, cachedShiftId: '2026-08-05_180000',
    fetchDayDoc: doc({
      '2026-08-06': { readable: true, present: true, currentShiftId: '' },
      '2026-08-05': { readable: true, present: true, currentShiftId: '' },
    }),
  });
  assert.equal(v.verdict, 'verified_closed');
});
test('lifecycle: unreadable authority never becomes open', async () => {
  const v = await verifyCachedShiftAgainstAuthority({
    ...base, cachedShiftId: '2026-08-06_060000',
    fetchDayDoc: doc({}),
  });
  assert.equal(v.verdict, 'unverified');
});
test('lifecycle: no cache + no authoritative shift → no_shift (nothing synthesized from the date)', async () => {
  const v = await verifyCachedShiftAgainstAuthority({
    ...base, cachedShiftId: null,
    fetchDayDoc: doc({ '2026-08-06': { readable: true, present: false } }),
  });
  assert.equal(v.verdict, 'no_shift');
});

// ── wiring pins (RED until production consumption) ────────────────────────
const root = join(__dirname, '..', '..', '..', '..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

test('wiring: logout post-trip gate has NO null-shiftId escape hatch', () => {
  const auth = src('src/core/context/AuthContext.tsx');
  // The old pattern `if (shiftId) { ...ensurePostTripGate... }` silently
  // skipped the gate when the cache key was lost. The gate itself must
  // decide (it fails closed on a missing id).
  const logoutRegion = auth.slice(auth.indexOf('const logout'), auth.indexOf('const logout') + 2600);
  assert.ok(!/if \(shiftId\) \{[\s\S]{0,400}ensurePostTripGate/.test(logoutRegion),
    'logout still wraps the post-trip gate in if(shiftId)');
  const cascadeRegion = auth.slice(auth.indexOf('const logoutWithCascade'), auth.indexOf('const logoutWithCascade') + 2600);
  assert.ok(!/if \(shiftId\) \{[\s\S]{0,400}ensurePostTripGate/.test(cascadeRegion),
    'logoutWithCascade still wraps the post-trip gate in if(shiftId)');
});
test('wiring: resume verifies the cached shift through the canonical authority', () => {
  assert.ok(src('src/core/context/AuthContext.tsx').includes('verifyCachedShiftAgainstAuthority'),
    'AuthContext resume does not verify the cached shift');
});
test('wiring: resume login backfill carries the cached currentShiftId (no scope-less shifts)', () => {
  const tracking = src('src/core/services/shiftTracking.ts');
  const region = tracking.slice(tracking.indexOf('checkShiftOnResume'));
  assert.ok(/currentShiftId/.test(region.slice(0, 3500)),
    'checkShiftOnResume backfill still writes a login without currentShiftId');
});
test('wiring: UTC date fallbacks are enforcement-gated', () => {
  assert.ok(src('app/day-summary.tsx').includes('mayUseDateFallback'),
    'day-summary date fallback is not enforcement-gated');
  assert.ok(src('src/core/services/jsaShiftAck.ts').includes('mayUseDateFallback'),
    'jsaShiftAck date fallback is not enforcement-gated');
});
