// Run: npx tsx --test src/core/services/workPeriodAuthority/returnAbandonFlow.test.ts
//
// Executable coverage for the return-to-yard divert race. These tests drive
// `runReturnAbandon` with hand-interleaved promises, so each hazard is
// reproduced rather than asserted about in prose:
//
//   - double divert (two taps of "Back to work")
//   - logout / account switch while the governed callable is awaited
//   - a refused or throwing callable (state + attempt identity must survive)
//   - modal switching / a tap that lands after the session is gone
//   - return -> divert -> return in one shift (distinct attempt identities)
//
// The final test pins the regression itself: the PRE-FIX sequence (no latch, no
// generation re-check, unconditional delete) is modelled over the same ports and
// shown to delete a NEWER session's persisted return identity, which is exactly
// what the fixed flow refuses to do.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runReturnAbandon,
  createReturnAbandonLatch,
  type ReturnAbandonPorts,
} from './returnAbandonFlow';
import { isReturnAttemptId, mintReturnAttemptId } from './returnAttempt';

/** A promise whose settlement the test controls, to sit inside an await. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Drain pending microtasks so an in-flight call reaches its next await. */
function flush(): Promise<void> {
  return new Promise<void>(resolve => setImmediate(resolve));
}

type Harness = {
  ports: ReturnAbandonPorts;
  /** Stand-in for SecureStore. */
  store: Map<string, string>;
  /** Local UI state the flow may clear. */
  ui: { returningToYard: boolean; returnDepartTime: string | null };
  /** Every governed-callable payload, in order. */
  calls: Array<{ periodId: string | null; attemptId: string }>;
  legacyWrites: number;
  events: string[];
  /** Simulate logout / account switch: invalidates captured generations. */
  bumpGeneration: () => void;
};

const ATTEMPT = 'ret-2026-09-24_143000-abc123';
const PERIOD = '2026-09-24_143000';

function harness(opts: {
  enforced?: boolean;
  attemptId?: string | null;
  /** Gate the callable so the test can interleave inside it. */
  recordGate?: Promise<unknown>;
  recordResult?: { ok: boolean; reason?: string; recorded?: boolean };
  recordThrows?: unknown;
} = {}): Harness {
  const store = new Map<string, string>();
  const attemptId = opts.attemptId === undefined ? ATTEMPT : opts.attemptId;
  if (attemptId !== null) store.set('returnAttemptId', attemptId);
  store.set('returnDepartTime', '2026-09-24T19:00:00.000Z');

  const ui: { returningToYard: boolean; returnDepartTime: string | null } =
    { returningToYard: true, returnDepartTime: '2026-09-24T19:00:00.000Z' };
  const calls: Array<{ periodId: string | null; attemptId: string }> = [];
  const events: string[] = [];
  let generation = 0;
  const captured = generation;
  const h: Harness = {
    store,
    ui,
    calls,
    legacyWrites: 0,
    events,
    bumpGeneration: () => { generation += 1; },
    ports: {
      enforced: opts.enforced !== false,
      isCurrent: () => generation === captured,
      latch: createReturnAbandonLatch(),
      readAttemptId: async () => store.get('returnAttemptId') ?? null,
      readPeriodId: async () => PERIOD,
      async recordAbandoned(args) {
        calls.push(args);
        if (opts.recordGate) await opts.recordGate;
        if (opts.recordThrows !== undefined) throw opts.recordThrows;
        return opts.recordResult ?? { ok: true, recorded: true };
      },
      recordLegacyAbandoned: () => { h.legacyWrites += 1; },
      async clearAttemptIdIf(expected) {
        if (store.get('returnAttemptId') !== expected) return false;
        store.delete('returnAttemptId');
        return true;
      },
      async clearAttemptIdUnconditional() { store.delete('returnAttemptId'); },
      async clearDepartTime() { store.delete('returnDepartTime'); },
      clearReturnUi() { ui.returningToYard = false; ui.returnDepartTime = null; },
      isValidAttemptId: isReturnAttemptId,
      log: (event) => { events.push(event); },
    },
  };
  return h;
}

test('happy path: abandons with the attempt identity, then clears identity, depart time and UI', async () => {
  const h = harness();
  const out = await runReturnAbandon(h.ports);
  assert.deepEqual(out, { ok: true, recorded: true });
  // attempt identity is carried, never dropped
  assert.deepEqual(h.calls, [{ periodId: PERIOD, attemptId: ATTEMPT }]);
  assert.equal(h.store.has('returnAttemptId'), false);
  assert.equal(h.store.has('returnDepartTime'), false);
  assert.equal(h.ui.returningToYard, false);
  assert.equal(h.ui.returnDepartTime, null);
  // Enforced companies deny a direct driver_shifts write, so the enforced path
  // must route through the governed callable ONLY.
  assert.equal(h.legacyWrites, 0, 'enforced path never direct-writes');
  assert.equal(h.ports.latch.held(), false, 'latch released');
});

test('double divert: two taps produce exactly one abandonment, and the loser mutates nothing', async () => {
  const gate = deferred<void>();
  const h = harness({ recordGate: gate.promise });

  const first = runReturnAbandon(h.ports);
  await flush(); // let the first tap reach the (gated) governed callable
  assert.equal(h.calls.length, 1);
  // Second tap while the first is parked inside the callable.
  const second = await runReturnAbandon(h.ports);
  assert.deepEqual(second, { ok: false, reason: 'in_flight' });
  // The loser must not have called the server, cleared storage, or touched UI.
  assert.equal(h.calls.length, 1);
  assert.equal(h.store.get('returnAttemptId'), ATTEMPT);
  assert.equal(h.ui.returningToYard, true);
  // The loser must not have released the winner's latch either.
  assert.equal(h.ports.latch.held(), true);

  gate.resolve();
  assert.deepEqual(await first, { ok: true, recorded: true });
  assert.equal(h.calls.length, 1, 'still exactly one governed call');
  assert.equal(h.store.has('returnAttemptId'), false);
  assert.equal(h.ui.returningToYard, false);
  assert.equal(h.ports.latch.held(), false, 'latch released for a later legitimate divert');
});

test('logout while the callable is in flight: the resolved old abandonment commits nothing', async () => {
  const gate = deferred<void>();
  const h = harness({ recordGate: gate.promise });

  const inFlight = runReturnAbandon(h.ports);
  await flush(); // park inside the governed callable, not at an earlier await
  assert.equal(h.calls.length, 1, 'the callable is genuinely in flight');
  // Driver logs out mid-flight (AuthContext bumps the authority generation).
  h.bumpGeneration();
  gate.resolve();

  assert.deepEqual(await inFlight, { ok: false, reason: 'stale_generation' });
  // No durable write and no UI mutation from a session that no longer owns the screen.
  assert.equal(h.store.get('returnAttemptId'), ATTEMPT, 'persisted identity untouched');
  assert.equal(h.store.get('returnDepartTime'), '2026-09-24T19:00:00.000Z');
  assert.equal(h.ui.returningToYard, true);
  assert.ok(h.events.includes('abandon.stale_skip'));
});

test('account switch: an old abandonment must not delete a NEWER return identity', async () => {
  // Generation deliberately NOT bumped, to prove the compare-and-delete closes
  // the window that remains inside a single await even when the clock agrees.
  const gate = deferred<void>();
  const h = harness({ recordGate: gate.promise });

  const inFlight = runReturnAbandon(h.ports);
  await flush(); // park inside the governed callable
  assert.equal(h.calls.length, 1, 'the callable is genuinely in flight');
  // A newer return (new driver / new attempt in the same shift) mints and
  // persists its own identity while the old abandonment is parked.
  const newerAttempt = mintReturnAttemptId(PERIOD, 1_790_000_000_000, () => 0.42);
  assert.notEqual(newerAttempt, ATTEMPT);
  h.store.set('returnAttemptId', newerAttempt);
  h.store.set('returnDepartTime', '2026-09-24T21:30:00.000Z');
  h.ui.returningToYard = true;
  gate.resolve();

  assert.deepEqual(await inFlight, { ok: false, reason: 'stale_generation' });
  assert.equal(h.store.get('returnAttemptId'), newerAttempt, 'newer identity survives');
  assert.equal(h.store.get('returnDepartTime'), '2026-09-24T21:30:00.000Z', 'newer depart time survives');
  assert.equal(h.ui.returningToYard, true, "newer session's yard card stays up");
  assert.ok(h.events.includes('abandon.identity_superseded'));
});

test('refused callable: return state stays and the attempt identity is kept for retry', async () => {
  const h = harness({ recordResult: { ok: false, reason: 'unsupported_return_contract' } });
  const out = await runReturnAbandon(h.ports);
  assert.deepEqual(out, { ok: false, reason: 'unsupported_return_contract' });
  assert.equal(h.store.get('returnAttemptId'), ATTEMPT, 'same attempt is retryable');
  assert.equal(h.store.get('returnDepartTime'), '2026-09-24T19:00:00.000Z');
  assert.equal(h.ui.returningToYard, true, 'never show a divert the server did not record');
  // A retry reuses the SAME attempt id, so the server dedupes instead of
  // recording a second abandonment for one attempt.
  const retry = await runReturnAbandon(h.ports);
  assert.equal(retry.ok, false);
  assert.deepEqual(h.calls.map(c => c.attemptId), [ATTEMPT, ATTEMPT]);
});

test('throwing callable: surfaced as a failure, nothing cleared', async () => {
  const h = harness({ recordThrows: new Error('unavailable') });
  const out = await runReturnAbandon(h.ports);
  assert.deepEqual(out, { ok: false, reason: 'unavailable' });
  assert.equal(h.store.get('returnAttemptId'), ATTEMPT);
  assert.equal(h.ui.returningToYard, true);
  assert.equal(h.ports.latch.held(), false, 'latch released after a throw');
});

test('enforced path with no usable attempt identity: keep return state, never mint a second one', async () => {
  for (const bad of [null, 'bad id', '']) {
    const h = harness({ attemptId: bad });
    const out = await runReturnAbandon(h.ports);
    assert.deepEqual(out, { ok: false, reason: 'no_attempt' });
    assert.equal(h.calls.length, 0, 'no governed call without attempt identity');
    assert.equal(h.ui.returningToYard, true);
  }
});

test('a tap that lands after the session is gone does nothing (modal switching / logout)', async () => {
  const h = harness();
  h.bumpGeneration();
  const out = await runReturnAbandon(h.ports);
  assert.deepEqual(out, { ok: false, reason: 'stale_generation' });
  assert.equal(h.calls.length, 0);
  assert.equal(h.store.get('returnAttemptId'), ATTEMPT);
  assert.equal(h.ui.returningToYard, true);
  assert.equal(h.ports.latch.held(), false, 'a stale entry never takes the latch');
});

test('return -> divert -> return -> divert in one shift: each attempt abandons under its own identity', async () => {
  const h = harness();
  assert.equal((await runReturnAbandon(h.ports)).ok, true);
  assert.equal(h.store.has('returnAttemptId'), false, 'first identity consumed');

  // Second return in the same shift mints a distinct attempt id.
  const second = mintReturnAttemptId(PERIOD, 1_790_000_100_000, () => 0.7);
  assert.notEqual(second, ATTEMPT);
  h.store.set('returnAttemptId', second);
  h.store.set('returnDepartTime', '2026-09-24T22:00:00.000Z');
  h.ui.returningToYard = true;

  assert.equal((await runReturnAbandon(h.ports)).ok, true);
  assert.deepEqual(h.calls.map(c => c.attemptId), [ATTEMPT, second]);
  assert.equal(h.store.has('returnAttemptId'), false);
  assert.equal(h.ui.returningToYard, false);
});

test('legacy (non-enforced) divert: direct write, and the local clear is still generation-gated', async () => {
  const ok = harness({ enforced: false });
  assert.deepEqual(await runReturnAbandon(ok.ports), { ok: true });
  assert.equal(ok.legacyWrites, 1);
  assert.equal(ok.calls.length, 0, 'legacy never uses the governed callable');
  assert.equal(ok.store.has('returnAttemptId'), false);
  assert.equal(ok.ui.returningToYard, false);

  const stale = harness({ enforced: false });
  stale.bumpGeneration();
  assert.deepEqual(await runReturnAbandon(stale.ports), { ok: false, reason: 'stale_generation' });
  assert.equal(stale.legacyWrites, 0);
  assert.equal(stale.ui.returningToYard, true);
});

test('latch hand-off: an old abandonment completing must not unlock the NEW session', async () => {
  const gate = deferred<void>();
  const h = harness({ recordGate: gate.promise });

  // Old session takes the latch and parks inside the callable.
  const oldCall = runReturnAbandon(h.ports);
  await flush();
  assert.equal(h.ports.latch.held(), true);

  // Logout / account switch: AuthContext hands the latch to the next session so
  // a stuck abandonment cannot block it.
  h.bumpGeneration();
  h.ports.latch.reset();
  const newTicket = h.ports.latch.tryAcquire();
  assert.notEqual(newTicket, null, 'the new session can take the latch');

  // The old call now resolves and runs its finally. It must NOT free the ticket
  // the new session is holding.
  gate.resolve();
  assert.deepEqual(await oldCall, { ok: false, reason: 'stale_generation' });
  assert.equal(h.ports.latch.held(), true, "new session's latch survives the old release");

  // ...and while the new owner holds it, nobody else can take it. (A fresh
  // runReturnAbandon here would stop at the entry generation check first, since
  // this harness' captured generation is now stale, so assert on the latch.)
  assert.equal(h.ports.latch.tryAcquire(), null, 'no second owner while held');
  h.ports.latch.release(newTicket as number);
  assert.equal(h.ports.latch.held(), false);
});

test('latch tickets are monotonic so a stale release is inert', () => {
  const latch = createReturnAbandonLatch();
  const a = latch.tryAcquire();
  assert.notEqual(a, null);
  assert.equal(latch.tryAcquire(), null, 'no second owner');
  latch.reset();
  const b = latch.tryAcquire();
  assert.notEqual(b, null);
  assert.notEqual(a, b, 'a reissued ticket is never the old one');
  latch.release(a as number);
  assert.equal(latch.held(), true, 'the stale holder cannot release');
  latch.release(b as number);
  assert.equal(latch.held(), false);
});

test('REGRESSION: the pre-fix sequence deletes a newer session state; the fixed flow does not', async () => {
  // Model of the shipped-before behaviour over the SAME ports: no latch, no
  // generation re-check after the awaited callable, unconditional delete.
  async function preFixAbandon(h: Harness): Promise<void> {
    const attemptId = await h.ports.readAttemptId();
    if (!h.ports.isValidAttemptId(attemptId)) return;
    const periodId = await h.ports.readPeriodId();
    const result = await h.ports.recordAbandoned({ periodId, attemptId });
    if (!result.ok) return;
    await h.ports.clearAttemptIdUnconditional();
    await h.ports.clearDepartTime();
    h.ports.clearReturnUi();
  }

  // --- pre-fix: double divert reaches the server twice for ONE attempt ---
  const dupGate = deferred<void>();
  const dup = harness({ recordGate: dupGate.promise });
  const a = preFixAbandon(dup);
  const b = preFixAbandon(dup);
  await flush();
  dupGate.resolve();
  await Promise.all([a, b]);
  assert.equal(dup.calls.length, 2, 'pre-fix: duplicate abandonment for one attempt');

  // --- pre-fix: an old session destroys a newer session's return identity ---
  const gate = deferred<void>();
  const old = harness({ recordGate: gate.promise });
  const inFlight = preFixAbandon(old);
  await flush();                              // park inside the callable
  old.bumpGeneration();                       // logout / account switch
  const newerAttempt = mintReturnAttemptId(PERIOD, 1_790_000_200_000, () => 0.11);
  old.store.set('returnAttemptId', newerAttempt);
  old.store.set('returnDepartTime', '2026-09-25T02:00:00.000Z');
  old.ui.returningToYard = true;
  gate.resolve();
  await inFlight;
  assert.equal(old.store.has('returnAttemptId'), false, 'pre-fix: newer identity destroyed');
  assert.equal(old.ui.returningToYard, false, 'pre-fix: newer yard card cleared');

  // --- fixed flow, identical interleaving: both are preserved ---
  const fixGate = deferred<void>();
  const fixed = harness({ recordGate: fixGate.promise });
  const fixedInFlight = runReturnAbandon(fixed.ports);
  await flush();                              // park inside the callable
  fixed.bumpGeneration();
  const keep = mintReturnAttemptId(PERIOD, 1_790_000_200_000, () => 0.11);
  fixed.store.set('returnAttemptId', keep);
  fixed.store.set('returnDepartTime', '2026-09-25T02:00:00.000Z');
  fixed.ui.returningToYard = true;
  fixGate.resolve();
  assert.deepEqual(await fixedInFlight, { ok: false, reason: 'stale_generation' });
  assert.equal(fixed.store.get('returnAttemptId'), keep, 'fixed: newer identity preserved');
  assert.equal(fixed.store.get('returnDepartTime'), '2026-09-25T02:00:00.000Z');
  assert.equal(fixed.ui.returningToYard, true, 'fixed: newer yard card preserved');
});
