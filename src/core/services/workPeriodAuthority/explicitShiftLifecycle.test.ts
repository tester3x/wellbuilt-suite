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
  assert.ok(row.includes('isExplicitStartShiftSuccess'));
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

test('wiring: lifecycle exports recordEnforcedReturnAbandoned over client.recordReturnAbandoned', () => {
  const life = src('src/core/services/workPeriodAuthority/explicitShiftLifecycle.ts');
  assert.ok(life.includes('export async function recordEnforcedReturnAbandoned'));
  assert.ok(life.includes('client.recordReturnAbandoned'));
});

test('wiring: abandonReturn enforced path uses the governed callable, not a direct write', () => {
  const auth = src('src/core/context/AuthContext.tsx');
  const abandon = auth.slice(
    auth.indexOf('const abandonReturn = useCallback'),
    auth.indexOf('const confirmArrival = useCallback'),
  );
  assert.ok(abandon.length > 100);
  assert.ok(abandon.includes('recordEnforcedReturnAbandoned'));
  // The enforced/legacy split now lives in runReturnAbandon (pure, so the race
  // is executable — see returnAbandonFlow.test.ts). AuthContext supplies the
  // ports, and each must land on the right writer: the governed callable for
  // enforced companies, the direct write only for the legacy port.
  assert.ok(/enforced:\s*isEnforcedExplicitShift\(enforcement\)/.test(abandon));
  assert.ok(abandon.includes('recordAbandoned: ({ periodId, attemptId }) => recordEnforcedReturnAbandoned({ periodId, attemptId })'));
  const governedPort = abandon.slice(
    abandon.indexOf('recordAbandoned:'),
    abandon.indexOf('recordLegacyAbandoned:'),
  );
  assert.ok(governedPort.length > 20);
  // A direct return_abandoned write must never hang off the governed port —
  // enforced companies deny it server-side.
  assert.ok(!/recordShiftEvent\(\s*'return_abandoned'/.test(governedPort));
  // ...and the legacy port is the only place that direct write may appear.
  const legacyPort = abandon.slice(abandon.indexOf('recordLegacyAbandoned:'));
  assert.ok(/recordShiftEvent\(\s*\n?\s*'return_abandoned'/.test(legacyPort));
  assert.equal((abandon.match(/recordShiftEvent\(/g) || []).length, 1, 'exactly one direct write');
  // On a refused/failed abandonment the local return state must survive.
  assert.ok(abandon.includes('keeping return state'));
  assert.ok(/if \(!outcome\.ok\)/.test(abandon));
});

test('wiring: abandonReturn is latched and generation-gated against a stale commit', () => {
  const auth = src('src/core/context/AuthContext.tsx');
  const abandon = auth.slice(
    auth.indexOf('const abandonReturn = useCallback'),
    auth.indexOf('const confirmArrival = useCallback'),
  );
  // The guards must be delegated to the audited flow, not re-implemented here.
  assert.ok(abandon.includes('await runReturnAbandon({'));
  // Generation captured BEFORE the first await, and re-checked across each one.
  assert.ok(abandon.includes('const gen = authorityGenRef.current.current();'));
  assert.ok(abandon.includes('const isCurrent = () => authorityGenRef.current.isCurrent(gen);'));
  // The gates must exist across the awaits. abandonReturn now RETURNS an
  // outcome instead of bare `return;`, so assert the guard, not the shape.
  assert.ok((abandon.match(/if \(!isCurrent\(\)\)\s*return/g) || []).length >= 2);
  // A refused divert must hand the reason back so the card can show it.
  assert.ok(abandon.includes("return { ok: false, reason: outcome.reason };"));
  assert.ok(abandon.includes("event: 'returnDivert.refused'"));
  assert.ok(abandon.includes('isCurrent,'));
  // One abandonment at a time, via a ref-held latch shared across renders.
  assert.ok(abandon.includes('latch: abandonLatchRef.current,'));
  assert.ok(auth.includes('const abandonLatchRef = useRef(createReturnAbandonLatch());'));
  // Ownership is decided inside the serialized store, not by a read-then-delete
  // written here: SecureStore has no compare-and-swap, so separate awaits would
  // still destroy a newer attempt persisted in the gap.
  assert.ok(abandon.includes('clearOwnedReturnState: (expected) => returnStateStore.clearIfOwner(expected)'));
  assert.ok(abandon.includes('clearAllReturnState: () => returnStateStore.clearAll()'));
  // The abandonment must not reach SecureStore for these keys at all.
  assert.ok(!/SecureStore\.\w+\(\s*'return(AttemptId|DepartTime)'/.test(abandon));
  // A session transition must never leave the latch held for the next session.
  for (const reason of ['provider_unmount', 'revalidation_hard_fail', 'login_identity', 'logout_cascade', 'logout']) {
    const at = auth.indexOf(`bumpAuthorityGeneration('${reason}')`);
    assert.ok(at > 0, `missing generation bump: ${reason}`);
    assert.ok(
      auth.slice(at, at + 320).includes('abandonLatchRef.current.reset();'),
      `latch not handed off at ${reason}`,
    );
  }
});

test('wiring: the return-abandon race guards live in a pure, testable module', () => {
  const flow = src('src/core/services/workPeriodAuthority/returnAbandonFlow.ts');
  // RN/expo-free so the interleavings are executable in node:test.
  assert.ok(!/from '(react|react-native|expo[-/][^']*)'/.test(flow));
  assert.ok(flow.includes('export async function runReturnAbandon'));
  assert.ok(flow.includes('export function createReturnAbandonLatch'));
  // Latch acquired before any await; never released by the loser.
  // Ticketed ownership: a superseded holder's release must be inert, so a
  // session hand-off cannot be undone by an old abandonment finishing.
  assert.ok(flow.includes('const ticket = ports.latch.tryAcquire();'));
  assert.ok(flow.includes('if (ticket === null) {'));
  assert.ok(flow.includes('ports.latch.release(ticket);'));
  assert.ok(/tryAcquire: \(\) => number \| null/.test(flow));
  assert.ok(/release: \(ticket: number\) => void/.test(flow));
  // Generation re-checked after the awaited governed callable, before commit.
  const enforcedBranch = flow.slice(flow.indexOf('if (ports.enforced) {'), flow.indexOf('async function commitLocalClear'));
  assert.ok(/result = await ports\.recordAbandoned/.test(enforcedBranch));
  const afterRecord = enforcedBranch.slice(enforcedBranch.indexOf('result = await ports.recordAbandoned'));
  assert.ok(afterRecord.indexOf('if (!ports.isCurrent())') < afterRecord.indexOf('if (!result.ok)'));
  // The commit is ONE owner-scoped store call, not a read-then-delete, and its
  // three outcomes are distinguished: only 'cleared' may clear the screen.
  assert.ok(flow.includes('const cleared = await ports.clearOwnedReturnState(attemptId);'));
  assert.ok(flow.includes("if (cleared.value === 'not_owner') {"));
  assert.ok(flow.includes('if (!cleared.ok) {'));
  // A storage failure must be reported, never reported as a completed clear.
  assert.ok(flow.includes("note(ports, 'abandon.storage_error'"));
  const commit = flow.slice(flow.indexOf('async function commitLocalClear'));
  assert.ok(
    commit.indexOf('clearReturnUi') > commit.indexOf("cleared.value === 'not_owner'"),
    'the UI is only cleared after ownership is confirmed',
  );
});

test('wiring: return-state persistence is serialized, owner-scoped and truthful', () => {
  const store = src('src/core/services/workPeriodAuthority/returnStateStore.ts');
  // Pure: the interleavings must be executable in node:test.
  assert.ok(!/from '(react|react-native|expo[-/][^']*)'/.test(store));
  // One FIFO queue, and every operation runs through it — that is the whole
  // ownership guarantee, since SecureStore offers no compare-and-swap.
  assert.ok(store.includes('function createSerialQueue'));
  for (const op of ['read()', 'reserveAttempt(mint)', 'markDeparted(attemptId, departTimeIso)',
                    'clearIfOwner(attemptId)', 'clearAll()']) {
    const at = store.indexOf(op + ' {');
    assert.ok(at > 0, `missing store operation: ${op}`);
    assert.ok(store.slice(at, at + 120).includes('return run('), `${op} does not hold the lock`);
  }
  // clearIfOwner re-decides ownership in the same section and clears both keys,
  // departure time first so a partial failure stays retryable.
  const clear = store.slice(store.indexOf('clearIfOwner(attemptId) {'), store.indexOf('clearAll() {'));
  assert.ok(clear.includes('if (current !== attemptId)'));
  assert.ok(
    clear.indexOf('kv.remove(RETURN_DEPART_TIME_KEY)') < clear.indexOf('kv.remove(RETURN_ATTEMPT_KEY)'),
    'departure time must be removed before the identity',
  );
  // Storage errors surface as reasons; nothing is swallowed with catch(() => {}).
  assert.ok(store.includes('function failure('));
  assert.ok(!/catch\s*\(\s*\)\s*=>\s*\{\s*\}/.test(store));
  assert.ok(!/\.catch\(\(\) => \{\}\)/.test(store));

  // Exactly one production store, because two would race each other.
  const prod = src('src/core/services/workPeriodAuthority/returnStatePersistence.ts');
  assert.ok(prod.includes('export const returnStateStore: ReturnStateStore = createReturnStateStore(secureStoreKv)'));
  assert.equal((prod.match(/createReturnStateStore\(/g) || []).length, 1);
});

test('wiring: NO AuthContext writer touches the return-state keys outside the store', () => {
  // The serialization guarantee holds only while every in-app writer goes
  // through the shared store, so this is the precondition, asserted directly.
  const auth = src('src/core/context/AuthContext.tsx');
  assert.ok(!/SecureStore\.\w+Async\(\s*'returnAttemptId'/.test(auth));
  assert.ok(!/SecureStore\.\w+Async\(\s*'returnDepartTime'/.test(auth));
  assert.ok(auth.includes("import { returnStateStore } from '../services/workPeriodAuthority/returnStatePersistence'"));
  // Every session transition and every return writer routes through it: mount
  // restore, login reset, startReturn reserve + depart stamp, the abandonment's
  // two ports, arrival, and both logout paths.
  for (const call of [
    'await returnStateStore.read()',
    'await returnStateStore.reserveAttempt(',
    'await returnStateStore.markDeparted(',
    'returnStateStore.clearIfOwner(expected)',
    'returnStateStore.clearAll()',
  ]) {
    assert.ok(auth.includes(call), `AuthContext does not use ${call}`);
  }
  assert.ok((auth.match(/returnStateStore\.clearAll\(\)/g) || []).length >= 4,
    'login reset, arrival and both logout paths must clear through the store');
  // startReturn must report a persistence failure rather than proceeding.
  const start = auth.slice(auth.indexOf('const startReturn = useCallback'), auth.indexOf('const abandonReturn = useCallback'));
  assert.ok(start.includes('if (!reserved.ok)'));
  assert.ok(start.includes('if (!departed.ok)'));
  assert.ok(start.includes("if (departed.value === 'not_owner')"));
});

test('wiring: shiftAuthorityClient forbids identity in payloads (source)', () => {
  const client = src('src/core/services/workPeriodAuthority/shiftAuthorityClient.ts');
  assert.ok(client.includes("call(CLAIM_DRIVER_SHIFT, { periodId, originLocalDate })"));
  assert.ok(client.includes("call(RECORD_DEPART_RETURN, { periodId, attemptId })"));
  assert.ok(client.includes("call(RECORD_RETURN_ABANDONED, { periodId, attemptId })"));
  assert.ok(client.includes("call(RESOLVE_ACTIVE_DRIVER_SHIFT, {})"));
  assert.ok(!client.includes('driverId:'));
  assert.ok(!client.includes('companyId:'));
});

test('wiring: return attempt id is minted, persisted, and threaded to both governed calls', () => {
  const auth = src('src/core/context/AuthContext.tsx');
  // startReturn mints/reuses a persisted attempt id and passes it to depart.
  const start = auth.slice(auth.indexOf('const startReturn = useCallback'), auth.indexOf('const abandonReturn = useCallback'));
  assert.ok(start.includes('mintReturnAttemptId'));
  // Read-or-mint-and-persist happens inside the store's critical section, so two
  // concurrent starts cannot mint two identities for one return.
  assert.ok(start.includes('await returnStateStore.reserveAttempt(() => mintReturnAttemptId(periodForAttempt))'));
  assert.ok(start.includes('recordEnforcedDepartReturn({ periodId, attemptId })'));
  // abandonReturn reads the SAME id, through the same store, and passes it on.
  const abandon = auth.slice(auth.indexOf('const abandonReturn = useCallback'), auth.indexOf('const confirmArrival = useCallback'));
  assert.ok(abandon.includes('await returnStateStore.read()'));
  assert.ok(abandon.includes('recordEnforcedReturnAbandoned({ periodId, attemptId })'));
  // The identity is cleared only by the owner-scoped clear.
  assert.ok(abandon.includes('returnStateStore.clearIfOwner(expected)'));
  // And the attempt id is still required by both governed wrappers.
  const life = src('src/core/services/workPeriodAuthority/explicitShiftLifecycle.ts');
  assert.ok(life.includes('client.recordDepartReturn(periodId, deps.attemptId)'));
  assert.ok(life.includes('client.recordReturnAbandoned(periodId, deps.attemptId)'));
});

test('wiring: enforced return wrappers require an attemptId', () => {
  const life = src('src/core/services/workPeriodAuthority/explicitShiftLifecycle.ts');
  assert.ok(life.includes('attemptId: string'));
  assert.ok(life.includes('client.recordDepartReturn(periodId, deps.attemptId)'));
  assert.ok(life.includes('client.recordReturnAbandoned(periodId, deps.attemptId)'));
});
