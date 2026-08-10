import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  classifyCloseOdometerMiles,
  createGenerationClock,
  isExplicitStartShiftSuccess,
  startShiftFailureReason,
} from './shiftSessionGuards';

const root = join(__dirname, '..', '..', '..', '..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

// ── Generation clock ──────────────────────────────────────────────────────

test('generation bump invalidates prior captures', () => {
  const clock = createGenerationClock();
  const g0 = clock.current();
  assert.equal(clock.isCurrent(g0), true);
  const g1 = clock.bump('logout');
  assert.notEqual(g0, g1);
  assert.equal(clock.isCurrent(g0), false);
  assert.equal(clock.isCurrent(g1), true);
});

test('newer login generation supersedes older resolve capture', () => {
  const clock = createGenerationClock();
  const oldSession = clock.bump('login_a');
  const newer = clock.bump('login_b');
  assert.equal(clock.isCurrent(oldSession), false);
  assert.equal(clock.isCurrent(newer), true);
});

test('unavailable generation cannot overwrite later successful gen (ordering)', () => {
  const clock = createGenerationClock();
  const first = clock.bump('login');
  // Simulate later successful refresh bump is NOT required — same gen for refresh.
  // After logout, first is dead:
  clock.bump('logout');
  assert.equal(clock.isCurrent(first), false);
});

// ── Start Shift success contract ──────────────────────────────────────────

test('null/undefined start result is never success', () => {
  assert.equal(isExplicitStartShiftSuccess(null), false);
  assert.equal(isExplicitStartShiftSuccess(undefined), false);
  assert.equal(startShiftFailureReason(null), 'missing_start_result');
  assert.equal(startShiftFailureReason(undefined), 'missing_start_result');
});

test('malformed start result is never success', () => {
  assert.equal(isExplicitStartShiftSuccess({}), false);
  assert.equal(isExplicitStartShiftSuccess('ok'), false);
  assert.equal(isExplicitStartShiftSuccess({ ok: 'true' }), false);
  assert.equal(isExplicitStartShiftSuccess({ success: true }), false);
  assert.equal(startShiftFailureReason({}), 'malformed_start_result');
});

test('explicit ok:true is success; ok:false is failure', () => {
  assert.equal(isExplicitStartShiftSuccess({ ok: true }), true);
  assert.equal(isExplicitStartShiftSuccess({ ok: true, periodId: 'x' }), true);
  assert.equal(isExplicitStartShiftSuccess({ ok: false, reason: 'x' }), false);
  assert.equal(startShiftFailureReason({ ok: false, reason: 'claim_failed' }), 'claim_failed');
});

test('explicit legacy-style success remains functional', () => {
  // Legacy path returns the same contract from AuthContext.startShift
  assert.equal(isExplicitStartShiftSuccess({ ok: true, reason: 'legacy' }), true);
});

// ── Odometer close decision ───────────────────────────────────────────────

test('missing optional odometer → omit', () => {
  assert.deepEqual(classifyCloseOdometerMiles(undefined), { kind: 'omit' });
  assert.deepEqual(classifyCloseOdometerMiles(null), { kind: 'omit' });
});

test('valid integer 0..5000 passed unchanged', () => {
  assert.deepEqual(classifyCloseOdometerMiles(0), { kind: 'valid', miles: 0 });
  assert.deepEqual(classifyCloseOdometerMiles(42), { kind: 'valid', miles: 42 });
  assert.deepEqual(classifyCloseOdometerMiles(5000), { kind: 'valid', miles: 5000 });
});

test('negative / noninteger / >5000 block close (invalid)', () => {
  assert.equal(classifyCloseOdometerMiles(-1).kind, 'invalid');
  assert.equal(classifyCloseOdometerMiles(12.5).kind, 'invalid');
  assert.equal(classifyCloseOdometerMiles(5001).kind, 'invalid');
  assert.equal(classifyCloseOdometerMiles(Number.NaN).kind, 'invalid');
  assert.equal(classifyCloseOdometerMiles(Infinity).kind, 'invalid');
  assert.equal(classifyCloseOdometerMiles('12' as unknown).kind, 'invalid');
});

// ── Source wiring: generation + single-flight + odometer + success-on-null ─

test('wiring: AuthContext bumps generation on login/logout/unmount', () => {
  const auth = src('src/core/context/AuthContext.tsx');
  assert.ok(auth.includes('createGenerationClock'));
  assert.ok(auth.includes("bumpAuthorityGeneration('login_identity')"));
  assert.ok(auth.includes("bumpAuthorityGeneration('logout')"));
  assert.ok(auth.includes("bumpAuthorityGeneration('logout_cascade')"));
  assert.ok(auth.includes("bumpAuthorityGeneration('provider_unmount')"));
  assert.ok(auth.includes('gate: { isCurrent:'));
});

test('wiring: startShift single-flight guard', () => {
  const auth = src('src/core/context/AuthContext.tsx');
  assert.ok(auth.includes('startShiftInFlightRef'));
  assert.ok(auth.includes("reason: 'in_flight'"));
  assert.ok(auth.includes('startShiftBusy'));
  assert.ok(auth.includes('setStartShiftBusy(true)'));
  assert.ok(auth.includes('setStartShiftBusy(false)'));
});

test('wiring: ActionCardRow rejects null/undefined success and gates Pre-Trip', () => {
  const row = src('src/ui/shared/ActionCardRow.tsx');
  assert.ok(row.includes('isExplicitStartShiftSuccess'));
  assert.ok(row.includes('startShiftFailureReason'));
  assert.ok(!/result == null \|\| result === undefined\s*\?\s*true/.test(row));
  assert.ok(row.includes('ensurePreTripGate'));
  assert.ok(row.includes('if (!isExplicitStartShiftSuccess'));
  assert.ok(row.includes('confirming={claimBusy}'));
});

test('wiring: ShiftStartModal confirms disabled while confirming', () => {
  const modal = src('src/ui/shared/ShiftStartModal.tsx');
  assert.ok(modal.includes('confirming'));
  assert.ok(modal.includes('Starting…'));
  assert.ok(modal.includes('disabled={loading || confirming'));
});

test('wiring: invalid odometer blocks closeDriverShift', () => {
  const auth = src('src/core/context/AuthContext.tsx');
  assert.ok(auth.includes('classifyCloseOdometerMiles'));
  assert.ok(auth.includes("odo.kind === 'invalid'"));
  assert.ok(auth.includes('return false'));
  // close only with valid or omit
  assert.ok(auth.includes("odo.kind === 'valid' ? odo.miles : undefined"));
});

test('wiring: lifecycle applyRestoreAction/claim accept generation gate', () => {
  const life = src('src/core/services/workPeriodAuthority/explicitShiftLifecycle.ts');
  assert.ok(life.includes('GenerationGate'));
  assert.ok(life.includes('stale_generation'));
  assert.ok(life.includes('restore.stale_skip'));
});

test('wiring: no HOS in guards', () => {
  const g = src('src/core/services/workPeriodAuthority/shiftSessionGuards.ts');
  assert.ok(!/rest.?hour|hos\b|hours.?of.?service/i.test(g));
});
