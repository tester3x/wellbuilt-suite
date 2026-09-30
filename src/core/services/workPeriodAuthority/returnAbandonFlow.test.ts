// Run: npx tsx --test src/core/services/workPeriodAuthority/returnAbandonFlow.test.ts
//
// Executable coverage for the return-to-yard divert race.
//
// The persistence ports here are the REAL serialized store
// (createReturnStateStore — the same factory the production singleton wraps
// around SecureStore), driven over a leaf KV that is deliberately NOT atomic:
// a `get` captures its value at call time and resolves later, and a paused
// `remove` leaves the value physically present. An earlier version of this file
// used a synchronous Map, which assumed the very atomicity under test and so
// passed against a broken read-then-delete; that mistake is the reason the
// storage layer is now exercised through its real implementation.
//
// Covered: double divert, logout and account switch while the governed callable
// is awaited, a newer return persisting while the clear is mid-flight, storage
// rejection during the clear, latch hand-off across a session transition,
// refused and throwing callables, missing attempt identity, a tap landing after
// the session is gone, return -> divert -> return -> divert in one shift, and
// the legacy path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runReturnAbandon,
  createReturnAbandonLatch,
  type ReturnAbandonPorts,
} from './returnAbandonFlow';
import {
  createReturnStateStore,
  RETURN_ATTEMPT_KEY,
  RETURN_DEPART_TIME_KEY,
  type ReturnStateKv,
} from './returnStateStore';
import { isReturnAttemptId, mintReturnAttemptId } from './returnAttempt';

const ATTEMPT = 'ret-2026-09-24_143000-abc123';
const PERIOD = '2026-09-24_143000';
const DEPART = '2026-09-24T19:00:00.000Z';

type Op = 'get' | 'set' | 'remove';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Drain pending microtasks so an in-flight call reaches its next await. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function track<T>(p: Promise<T>) {
  const state = { settled: false, value: undefined as T | undefined };
  void p.then((v) => { state.settled = true; state.value = v; });
  return state;
}

type Harness = {
  ports: ReturnAbandonPorts;
  /** Backing data of the leaf KV — what SecureStore would physically hold. */
  data: Map<string, string>;
  /** Local UI state the flow may clear. */
  ui: { returningToYard: boolean; returnDepartTime: string | null };
  /** Every governed-callable payload, in order. */
  calls: Array<{ periodId: string | null; attemptId: string }>;
  legacyWrites: number;
  events: string[];
  /** Simulate logout / account switch: invalidates captured generations. */
  bumpGeneration: () => void;
  /** Pause the `nth` (1-based) occurrence of a leaf storage op. */
  pauseOn: (op: Op, key: string, nth?: number) => { open: () => void };
  /** Make a leaf storage op reject. */
  failOn: (op: Op | null, key?: string, reason?: string) => void;
  /** The shared store, for simulating another session's writers. */
  store: ReturnType<typeof createReturnStateStore>;
};

function harness(opts: {
  enforced?: boolean;
  attemptId?: string | null;
  recordGate?: Promise<unknown>;
  recordResult?: { ok: boolean; reason?: string; recorded?: boolean };
  recordThrows?: unknown;
} = {}): Harness {
  const data = new Map<string, string>();
  const attemptId = opts.attemptId === undefined ? ATTEMPT : opts.attemptId;
  if (attemptId !== null) data.set(RETURN_ATTEMPT_KEY, attemptId);
  data.set(RETURN_DEPART_TIME_KEY, DEPART);

  let pause: { op: Op; key: string; gate: Promise<void>; remaining: number } | null = null;
  let failure: { op: Op; key?: string; reason: string } | null = null;

  const kv: ReturnStateKv = {
    async get(key) {
      const captured = data.has(key) ? (data.get(key) as string) : null;
      await maybePause('get', key);
      maybeFail('get', key);
      return captured;
    },
    async set(key, value) {
      await maybePause('set', key);
      maybeFail('set', key);
      data.set(key, value);
    },
    async remove(key) {
      await maybePause('remove', key);
      maybeFail('remove', key);
      data.delete(key);
    },
  };

  async function maybePause(op: Op, key: string): Promise<void> {
    if (pause && pause.op === op && pause.key === key) {
      pause.remaining -= 1;
      if (pause.remaining > 0) return;   // an earlier occurrence — let it through
      const gate = pause.gate;
      pause = null;
      await gate;
    }
  }
  function maybeFail(op: Op, key: string): void {
    if (failure && failure.op === op && (failure.key === undefined || failure.key === key)) {
      throw new Error(failure.reason);
    }
  }

  const store = createReturnStateStore(kv);
  const ui: { returningToYard: boolean; returnDepartTime: string | null } =
    { returningToYard: true, returnDepartTime: DEPART };
  const calls: Array<{ periodId: string | null; attemptId: string }> = [];
  const events: string[] = [];
  let generation = 0;
  const captured = generation;

  const h: Harness = {
    data,
    ui,
    calls,
    legacyWrites: 0,
    events,
    store,
    bumpGeneration: () => { generation += 1; },
    pauseOn: (op, key, nth = 1) => {
      const d = deferred<void>();
      pause = { op, key, gate: d.promise, remaining: nth };
      return { open: () => d.resolve() };
    },
    failOn: (op, key, reason = 'keychain_unavailable') => {
      failure = op === null ? null : { op, key, reason };
    },
    ports: {
      enforced: opts.enforced !== false,
      isCurrent: () => generation === captured,
      latch: createReturnAbandonLatch(),
      readAttemptId: async () => {
        const snapshot = await store.read();
        return snapshot.ok ? snapshot.value.attemptId : null;
      },
      readPeriodId: async () => PERIOD,
      async recordAbandoned(args) {
        calls.push(args);
        if (opts.recordGate) await opts.recordGate;
        if (opts.recordThrows !== undefined) throw opts.recordThrows;
        return opts.recordResult ?? { ok: true, recorded: true };
      },
      recordLegacyAbandoned: () => { h.legacyWrites += 1; },
      clearOwnedReturnState: (expected) => store.clearIfOwner(expected),
      clearAllReturnState: () => store.clearAll(),
      clearReturnUi: () => { ui.returningToYard = false; ui.returnDepartTime = null; },
      isValidAttemptId: isReturnAttemptId,
      log: (event) => { events.push(event); },
    },
  };
  return h;
}

test('happy path: abandons with the attempt identity, then clears both keys and the UI', async () => {
  const h = harness();
  const out = await runReturnAbandon(h.ports);
  assert.deepEqual(out, { ok: true, recorded: true });
  assert.deepEqual(h.calls, [{ periodId: PERIOD, attemptId: ATTEMPT }]);
  assert.equal(h.data.has(RETURN_ATTEMPT_KEY), false);
  assert.equal(h.data.has(RETURN_DEPART_TIME_KEY), false);
  assert.equal(h.ui.returningToYard, false);
  assert.equal(h.ui.returnDepartTime, null);
  assert.equal(h.legacyWrites, 0, 'enforced path never direct-writes');
  assert.equal(h.ports.latch.held(), false, 'latch released');
});

test('double divert: two taps produce exactly one abandonment, and the loser mutates nothing', async () => {
  const gate = deferred<void>();
  const h = harness({ recordGate: gate.promise });

  const first = runReturnAbandon(h.ports);
  await flush();
  assert.equal(h.calls.length, 1);
  const second = await runReturnAbandon(h.ports);
  assert.deepEqual(second, { ok: false, reason: 'in_flight' });
  assert.equal(h.calls.length, 1);
  assert.equal(h.data.get(RETURN_ATTEMPT_KEY), ATTEMPT);
  assert.equal(h.ui.returningToYard, true);
  assert.equal(h.ports.latch.held(), true, "the loser did not release the winner's latch");

  gate.resolve();
  assert.deepEqual(await first, { ok: true, recorded: true });
  assert.equal(h.calls.length, 1, 'still exactly one governed call');
  assert.equal(h.data.has(RETURN_ATTEMPT_KEY), false);
  assert.equal(h.ui.returningToYard, false);
  assert.equal(h.ports.latch.held(), false);
});

test('logout while the callable is in flight: the resolved old abandonment commits nothing', async () => {
  const gate = deferred<void>();
  const h = harness({ recordGate: gate.promise });

  const inFlight = runReturnAbandon(h.ports);
  await flush();
  assert.equal(h.calls.length, 1, 'the callable is genuinely in flight');
  h.bumpGeneration();
  gate.resolve();

  assert.deepEqual(await inFlight, { ok: false, reason: 'stale_generation' });
  assert.equal(h.data.get(RETURN_ATTEMPT_KEY), ATTEMPT, 'persisted identity untouched');
  assert.equal(h.data.get(RETURN_DEPART_TIME_KEY), DEPART, 'persisted departure time untouched');
  assert.equal(h.ui.returningToYard, true);
  assert.ok(h.events.includes('abandon.stale_skip'));
});

test('account switch: a newer return persisted before the clear is never deleted', async () => {
  // Generation deliberately NOT bumped, so the ownership decision — not the
  // generation clock — is what has to save the newer session's state.
  const gate = deferred<void>();
  const h = harness({ recordGate: gate.promise });

  const inFlight = runReturnAbandon(h.ports);
  await flush();
  assert.equal(h.calls.length, 1, 'the callable is genuinely in flight');

  // A newer return (new driver / new attempt) persists through the shared store
  // while the old abandonment is still awaiting the server.
  const newer = mintReturnAttemptId(PERIOD, 1_790_000_000_000, () => 0.42);
  assert.notEqual(newer, ATTEMPT);
  await h.store.clearAll();
  assert.equal((await h.store.reserveAttempt(() => newer)).ok, true);
  assert.equal((await h.store.markDeparted(newer, '2026-09-24T21:30:00.000Z')).ok, true);
  h.ui.returningToYard = true;
  gate.resolve();

  assert.deepEqual(await inFlight, { ok: false, reason: 'identity_superseded' });
  assert.equal(h.data.get(RETURN_ATTEMPT_KEY), newer, 'newer identity survives');
  assert.equal(h.data.get(RETURN_DEPART_TIME_KEY), '2026-09-24T21:30:00.000Z', 'newer departure time survives');
  assert.equal(h.ui.returningToYard, true, "newer session's yard card stays up");
  assert.ok(h.events.includes('abandon.identity_superseded'));
});

test('a newer return that lands while the clear is mid-flight is serialized, not clobbered', async () => {
  // The clear is paused inside its ownership read; a newer session's writers are
  // issued in that window. They must queue behind the critical section, and the
  // end state must keep the newer identity and departure time.
  const h = harness();
  // Occurrence 2 of get(attempt) is clearIfOwner's ownership read; occurrence 1
  // is the flow's own identity read earlier in the abandonment.
  const paused = h.pauseOn('get', RETURN_ATTEMPT_KEY, 2);

  const abandoning = track(runReturnAbandon(h.ports));
  await flush();
  await flush();
  assert.equal(abandoning.settled, false, 'parked inside the clear critical section');

  // A newer session logs out and starts its own return in that window.
  const newer = mintReturnAttemptId(PERIOD, 1_790_000_300_000, () => 0.9);
  const wipe = track(h.store.clearAll());
  const reserve = track(h.store.reserveAttempt(() => newer));
  await flush();
  assert.equal(wipe.settled, false, 'the newer writers wait for the lock');
  assert.equal(reserve.settled, false);
  assert.equal(h.data.get(RETURN_ATTEMPT_KEY), ATTEMPT, 'nothing mutated mid-section');

  paused.open();
  await flush();
  await flush();
  await flush();

  assert.equal(abandoning.value?.ok, true, 'the old attempt was still the owner when it ran');
  assert.equal(wipe.value?.ok, true);
  assert.equal(reserve.value?.ok, true);
  assert.equal(h.data.get(RETURN_ATTEMPT_KEY), newer, 'newer identity present and intact');
});

test('storage failure during the clear is reported, and nothing is claimed as cleared', async () => {
  const h = harness();
  h.failOn('remove', RETURN_ATTEMPT_KEY, 'keychain_write_failed');

  const out = await runReturnAbandon(h.ports);
  assert.deepEqual(out, { ok: false, reason: 'keychain_write_failed' });
  // The attempt identity must survive so the driver can retry the SAME attempt.
  assert.equal(h.data.get(RETURN_ATTEMPT_KEY), ATTEMPT, 'identity kept for retry');
  // And the screen must NOT show a divert that was not durably recorded.
  assert.equal(h.ui.returningToYard, true, 'yard card stays up on storage failure');
  assert.ok(h.events.includes('abandon.storage_error'));

  // Once storage recovers, the retry finishes the job under the same identity.
  h.failOn(null);
  const retry = await runReturnAbandon(h.ports);
  assert.equal(retry.ok, true);
  assert.deepEqual(h.calls.map((c) => c.attemptId), [ATTEMPT, ATTEMPT]);
  assert.equal(h.data.size, 0);
  assert.equal(h.ui.returningToYard, false);
});

test('storage failure reading the attempt identity keeps the return state', async () => {
  const h = harness();
  h.failOn('get', RETURN_ATTEMPT_KEY, 'keychain_unavailable');
  const out = await runReturnAbandon(h.ports);
  assert.deepEqual(out, { ok: false, reason: 'no_attempt' });
  assert.equal(h.calls.length, 0, 'no governed call without a readable identity');
  assert.equal(h.data.get(RETURN_ATTEMPT_KEY), ATTEMPT);
  assert.equal(h.ui.returningToYard, true);
});

test('refused callable: return state stays and the attempt identity is kept for retry', async () => {
  const h = harness({ recordResult: { ok: false, reason: 'unsupported_return_contract' } });
  const out = await runReturnAbandon(h.ports);
  assert.deepEqual(out, { ok: false, reason: 'unsupported_return_contract' });
  assert.equal(h.data.get(RETURN_ATTEMPT_KEY), ATTEMPT, 'same attempt is retryable');
  assert.equal(h.data.get(RETURN_DEPART_TIME_KEY), DEPART);
  assert.equal(h.ui.returningToYard, true, 'never show a divert the server did not record');
  const retry = await runReturnAbandon(h.ports);
  assert.equal(retry.ok, false);
  assert.deepEqual(h.calls.map((c) => c.attemptId), [ATTEMPT, ATTEMPT]);
});

test('throwing callable: surfaced as a failure, nothing cleared', async () => {
  const h = harness({ recordThrows: new Error('unavailable') });
  const out = await runReturnAbandon(h.ports);
  assert.deepEqual(out, { ok: false, reason: 'unavailable' });
  assert.equal(h.data.get(RETURN_ATTEMPT_KEY), ATTEMPT);
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
  assert.equal(h.data.get(RETURN_ATTEMPT_KEY), ATTEMPT);
  assert.equal(h.ui.returningToYard, true);
  assert.equal(h.ports.latch.held(), false, 'a stale entry never takes the latch');
});

test('latch hand-off: an old abandonment completing must not unlock the NEW session', async () => {
  const gate = deferred<void>();
  const h = harness({ recordGate: gate.promise });

  const oldCall = runReturnAbandon(h.ports);
  await flush();
  assert.equal(h.ports.latch.held(), true);

  // Logout / account switch: AuthContext hands the latch to the next session so
  // a stuck abandonment cannot block it.
  h.bumpGeneration();
  h.ports.latch.reset();
  const newTicket = h.ports.latch.tryAcquire();
  assert.notEqual(newTicket, null, 'the new session can take the latch');

  gate.resolve();
  assert.deepEqual(await oldCall, { ok: false, reason: 'stale_generation' });
  assert.equal(h.ports.latch.held(), true, "new session's latch survives the old release");
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

test('return -> divert -> return -> divert in one shift: each attempt abandons under its own identity', async () => {
  const h = harness();
  assert.equal((await runReturnAbandon(h.ports)).ok, true);
  assert.equal(h.data.has(RETURN_ATTEMPT_KEY), false, 'first identity consumed');

  const second = mintReturnAttemptId(PERIOD, 1_790_000_100_000, () => 0.7);
  assert.notEqual(second, ATTEMPT);
  assert.equal((await h.store.reserveAttempt(() => second)).ok, true);
  assert.equal((await h.store.markDeparted(second, '2026-09-24T22:00:00.000Z')).ok, true);
  h.ui.returningToYard = true;

  assert.equal((await runReturnAbandon(h.ports)).ok, true);
  assert.deepEqual(h.calls.map((c) => c.attemptId), [ATTEMPT, second]);
  assert.equal(h.data.size, 0);
  assert.equal(h.ui.returningToYard, false);
});

test('legacy (non-enforced) divert: direct write, generation-gated clear, truthful storage failure', async () => {
  const ok = harness({ enforced: false });
  assert.deepEqual(await runReturnAbandon(ok.ports), { ok: true });
  assert.equal(ok.legacyWrites, 1);
  assert.equal(ok.calls.length, 0, 'legacy never uses the governed callable');
  assert.equal(ok.data.size, 0, 'both keys cleared together');
  assert.equal(ok.ui.returningToYard, false);

  const stale = harness({ enforced: false });
  stale.bumpGeneration();
  assert.deepEqual(await runReturnAbandon(stale.ports), { ok: false, reason: 'stale_generation' });
  assert.equal(stale.legacyWrites, 0);
  assert.equal(stale.ui.returningToYard, true);

  // A legacy clear that fails in storage must not report a completed divert.
  const broken = harness({ enforced: false, attemptId: null });
  broken.failOn('remove', RETURN_DEPART_TIME_KEY, 'keychain_write_failed');
  assert.deepEqual(await runReturnAbandon(broken.ports), { ok: false, reason: 'keychain_write_failed' });
  assert.equal(broken.ui.returningToYard, true);
  assert.equal(broken.data.get(RETURN_DEPART_TIME_KEY), DEPART);
});
