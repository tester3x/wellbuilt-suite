/**
 * Wiring + source-level guards for enforced explicit_shift lifecycle.
 * Runtime claim/close unit tests that need SecureStore/RN live in
 * shiftAuthorityClient.test.ts and postLoginShiftRestoration.test.ts
 * (pure transport + decision matrix).
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(__dirname, '..', '..', '..', '..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

test('wiring: AuthContext enforced path uses claim/close/depart callables', () => {
  const auth = src('src/core/context/AuthContext.tsx');
  assert.ok(auth.includes('claimEnforcedExplicitStart'));
  assert.ok(auth.includes('closeEnforcedExplicit'));
  assert.ok(auth.includes('recordEnforcedDepartReturn'));
  assert.ok(auth.includes('postLoginEnforcedRestore'));
  assert.ok(auth.includes('shiftAuthorityUi'));
  // Login never claims
  const loginFn = auth.slice(auth.indexOf('const login = useCallback'), auth.indexOf('const startShift = useCallback'));
  assert.ok(!loginFn.includes('claimEnforcedExplicitStart'));
  assert.ok(!loginFn.includes('claimDriverShift'));
});

test('wiring: startShift returns ok and does not recordShiftEvent login under enforced branch', () => {
  const auth = src('src/core/context/AuthContext.tsx');
  const startFn = auth.slice(auth.indexOf('const startShift = useCallback'), auth.indexOf('const returnInFlight'));
  assert.ok(startFn.includes('isEnforcedExplicitShift'));
  assert.ok(startFn.includes('claimEnforcedExplicitStart'));
  // Enforced success path must not call recordShiftEvent('login'
  const enforcedBlock = startFn.slice(
    startFn.indexOf('if (isEnforcedExplicitShift'),
    startFn.indexOf('// ── Legacy'),
  );
  assert.ok(enforcedBlock.length > 100);
  assert.ok(!/recordShiftEvent\(\s*'login'/.test(enforcedBlock));
  assert.ok(!/recordShiftEvent\(\s*'logout'/.test(enforcedBlock));
  // Legacy path still has login writer
  assert.ok(startFn.includes("recordShiftEvent(\n        'login'") || startFn.includes("recordShiftEvent('login'") || startFn.includes("'login'"));
});

test('wiring: confirmArrival enforced uses closeEnforcedExplicit, no client logout', () => {
  const auth = src('src/core/context/AuthContext.tsx');
  const arrive = auth.slice(auth.indexOf('const confirmArrival = useCallback'), auth.indexOf('const logoutWithCascade'));
  assert.ok(arrive.includes('closeEnforcedExplicit'));
  const enforcedClose = arrive.slice(
    arrive.indexOf('if (isEnforcedExplicitShift(enforcement))'),
    arrive.indexOf('} else {'),
  );
  assert.ok(enforcedClose.includes('closeEnforcedExplicit'));
  assert.ok(!/recordShiftEvent\(\s*'logout'/.test(enforcedClose));
  assert.ok(!enforcedClose.includes('writeOdometerMiles'));
});

test('wiring: startReturn enforced uses recordEnforcedDepartReturn', () => {
  const auth = src('src/core/context/AuthContext.tsx');
  const ret = auth.slice(auth.indexOf('const startReturn = useCallback'), auth.indexOf('const confirmArrival'));
  assert.ok(ret.includes('recordEnforcedDepartReturn'));
  const enforced = ret.slice(ret.indexOf('if (isEnforcedExplicitShift'), ret.indexOf('} else {'));
  assert.ok(!/recordShiftEvent\(\s*'depart_return'/.test(enforced));
});

test('wiring: ActionCardRow gates checklist and Pre-Trip on claim ok', () => {
  const row = src('src/ui/shared/ActionCardRow.tsx');
  assert.ok(row.includes('mayOpenStartShiftChecklist'));
  assert.ok(row.includes('ensurePreTripGate'));
  assert.ok(row.includes('if (!ok)'));
  assert.ok(row.includes('Checking shift status'));
  assert.ok(row.includes('refreshShiftAuthority'));
});

test('wiring: enforced explicit refuses direct lifecycle writers in shiftTracking', () => {
  const tracking = src('src/core/services/shiftTracking.ts');
  assert.ok(tracking.includes('enforcedExplicit'));
  assert.ok(tracking.includes('refused direct'));
  assert.ok(tracking.includes('checkShiftOnResume skipped under enforced explicit_shift'));
  assert.ok(tracking.includes('setCurrentShiftBinding'));
  assert.ok(tracking.includes('getCurrentShiftOriginDate'));
});

test('wiring: no HOS / rest-period gate in shift authority modules', () => {
  const client = src('src/core/services/workPeriodAuthority/shiftAuthorityClient.ts');
  const life = src('src/core/services/workPeriodAuthority/explicitShiftLifecycle.ts');
  const post = src('src/core/services/workPeriodAuthority/postLoginShiftRestoration.ts');
  assert.ok(!/rest.?hour|hos\b|hours.?of.?service|mandatory.?rest/i.test(client + life + post));
});

test('wiring: day-summary uses origin-day fetch helper', () => {
  const day = src('app/day-summary.tsx');
  const svc = src('src/core/services/daySummary.ts');
  assert.ok(svc.includes('export function resolveShiftSummaryDate'));
  assert.ok(svc.includes('export async function fetchShiftDocForDate'));
  assert.ok(day.includes('fetchShiftDocForDate') || day.includes('resolveShiftSummaryDate'));
  assert.ok(day.includes('getCurrentShiftOriginDate') || day.includes('originDateFromShiftId'));
});

test('wiring: lifecycle module exports claim/close/depart/resolve helpers', () => {
  const life = src('src/core/services/workPeriodAuthority/explicitShiftLifecycle.ts');
  assert.ok(life.includes('export async function claimEnforcedExplicitStart'));
  assert.ok(life.includes('export async function closeEnforcedExplicit'));
  assert.ok(life.includes('export async function recordEnforcedDepartReturn'));
  assert.ok(life.includes('export async function postLoginEnforcedRestore'));
  assert.ok(life.includes('client.claim'));
  assert.ok(life.includes('client.close'));
  assert.ok(life.includes('client.recordDepartReturn'));
  assert.ok(life.includes('resolveEnforcedExplicit'));
});

test('wiring: shiftAuthorityClient forbids identity in payloads (source)', () => {
  const client = src('src/core/services/workPeriodAuthority/shiftAuthorityClient.ts');
  assert.ok(client.includes("call(CLAIM_DRIVER_SHIFT, { periodId, originLocalDate })"));
  assert.ok(client.includes("call(RECORD_DEPART_RETURN, { periodId })"));
  assert.ok(client.includes("call(RESOLVE_ACTIVE_DRIVER_SHIFT, {})"));
  assert.ok(!client.includes('driverId:'));
  assert.ok(!client.includes('companyId:'));
});
