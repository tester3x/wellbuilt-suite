// Run: npx tsx --test src/core/services/workPeriodAuthority/returnStateStore.test.ts
//
// Storage-level evidence for the return-state ownership guarantee.
//
// These tests drive the REAL `createReturnStateStore` — the same factory the
// production singleton in returnStatePersistence.ts wraps around SecureStore —
// and control only the three leaf operations SecureStore actually provides.
//
// The leaf KV here is deliberately NOT atomic: a paused `remove` leaves the
// value still physically present, and a paused `get` captures the value at call
// time but resolves later — so a stale reader really can observe an old attempt
// that has already been replaced, which is the window under test.
// That is the whole point: an atomic Map stub would assume the property under
// test. The earlier port test did exactly that, which is why it passed against
// a non-atomic read-then-delete.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReturnStateStore,
  RETURN_ATTEMPT_KEY,
  RETURN_DEPART_TIME_KEY,
  type ReturnStateKv,
} from './returnStateStore';
import { mintReturnAttemptId } from './returnAttempt';

const OLD_ATTEMPT = 'ret-2026-09-24_143000-old111';
const NEW_ATTEMPT = 'ret-2026-09-24_143000-new222';
const OLD_DEPART = '2026-09-24T19:00:00.000Z';
const NEW_DEPART = '2026-09-24T21:30:00.000Z';

type Op = 'get' | 'set' | 'remove';

function deferred() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => { open = resolve; });
  return { wait, open };
}

/** Drain microtasks so queued work reaches its next await. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function controllableKv(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const log: string[] = [];
  let hook: ((op: Op, key: string) => Promise<void> | void) | null = null;
  let failure: ((op: Op, key: string) => string | null) | null = null;

  const kv: ReturnStateKv = {
    async get(key) {
      log.push(`get:${key}`);
      // The value is captured when the call is made and the promise resolves
      // LATER — the real shape of a keychain read. This is what makes a stale
      // reader observe the OLD attempt even though a newer one has since been
      // persisted, which is the exact window the pre-fix code deleted into.
      const captured = data.has(key) ? (data.get(key) as string) : null;
      await hook?.('get', key);
      const f = failure?.('get', key);
      if (f) throw new Error(f);
      return captured;
    },
    async set(key, value) {
      log.push(`set:${key}`);
      await hook?.('set', key);
      const f = failure?.('set', key);
      if (f) throw new Error(f);
      data.set(key, value);
    },
    async remove(key) {
      log.push(`remove:${key}`);
      await hook?.('remove', key);
      const f = failure?.('remove', key);
      if (f) throw new Error(f);
      data.delete(key);
    },
  };

  return {
    kv,
    data,
    log,
    setHook(h: typeof hook) { hook = h; },
    setFailure(f: typeof failure) { failure = f; },
  };
}

/** Tracks whether a promise has settled, without awaiting it. */
function track<T>(p: Promise<T>) {
  const state = { settled: false, value: undefined as T | undefined };
  void p.then((v) => { state.settled = true; state.value = v; });
  return state;
}

test('clearIfOwner clears both keys together when the attempt still owns them', async () => {
  const s = controllableKv({ [RETURN_ATTEMPT_KEY]: OLD_ATTEMPT, [RETURN_DEPART_TIME_KEY]: OLD_DEPART });
  const store = createReturnStateStore(s.kv);
  const out = await store.clearIfOwner(OLD_ATTEMPT);
  assert.deepEqual(out, { ok: true, value: 'cleared' });
  assert.equal(s.data.has(RETURN_ATTEMPT_KEY), false);
  assert.equal(s.data.has(RETURN_DEPART_TIME_KEY), false);
  // Departure time is removed BEFORE the identity, so a partial failure leaves
  // the retryable state rather than an unattributable departure time.
  assert.deepEqual(
    s.log.filter((l) => l.startsWith('remove')),
    [`remove:${RETURN_DEPART_TIME_KEY}`, `remove:${RETURN_ATTEMPT_KEY}`],
  );
});

test('clearIfOwner refuses when a newer attempt already owns the state', async () => {
  const s = controllableKv({ [RETURN_ATTEMPT_KEY]: NEW_ATTEMPT, [RETURN_DEPART_TIME_KEY]: NEW_DEPART });
  const store = createReturnStateStore(s.kv);
  const out = await store.clearIfOwner(OLD_ATTEMPT);
  assert.deepEqual(out, { ok: true, value: 'not_owner' });
  assert.equal(s.data.get(RETURN_ATTEMPT_KEY), NEW_ATTEMPT);
  assert.equal(s.data.get(RETURN_DEPART_TIME_KEY), NEW_DEPART);
  assert.equal(s.log.some((l) => l.startsWith('remove')), false, 'nothing was deleted');
});

test("DIRECTOR'S INTERLEAVING: a newer return persisted mid-clear cannot be deleted", async () => {
  // The old abandonment enters clearIfOwner and is paused inside its ownership
  // READ — precisely the window where the pre-fix code lost the race.
  const s = controllableKv({ [RETURN_ATTEMPT_KEY]: OLD_ATTEMPT, [RETURN_DEPART_TIME_KEY]: OLD_DEPART });
  const store = createReturnStateStore(s.kv);

  const readGate = deferred();
  let paused = false;
  s.setHook((op, key) => {
    if (op === 'get' && key === RETURN_ATTEMPT_KEY && !paused) {
      paused = true;
      return readGate.wait;
    }
    return undefined;
  });

  const oldClear = track(store.clearIfOwner(OLD_ATTEMPT));
  await flush();
  assert.equal(oldClear.settled, false, 'old clear is parked inside its ownership read');

  // A new session starts its own return through the shared store.
  const newReserve = track(store.reserveAttempt(() => NEW_ATTEMPT));
  const newDepart = track(store.markDeparted(NEW_ATTEMPT, NEW_DEPART));
  await flush();
  // The guarantee: the new writers do NOT interleave with the critical section.
  assert.equal(newReserve.settled, false, 'new writer is serialized behind the clear');
  assert.equal(newDepart.settled, false);
  assert.equal(
    s.log.filter((l) => l.startsWith('set') || l.startsWith('remove')).length,
    0,
    'no mutation happened while the clear held the lock',
  );

  readGate.open();
  await flush();
  await flush();

  // The old attempt genuinely still owned the state when the section ran, so
  // clearing it was correct; the new attempt is then persisted after it and
  // survives intact. Nothing belonging to the new session was destroyed.
  assert.deepEqual(oldClear.value, { ok: true, value: 'cleared' });
  assert.deepEqual(newReserve.value, { ok: true, value: { attemptId: NEW_ATTEMPT, minted: true } });
  assert.deepEqual(newDepart.value, { ok: true, value: 'applied' });
  assert.equal(s.data.get(RETURN_ATTEMPT_KEY), NEW_ATTEMPT, 'newer identity survives');
  assert.equal(s.data.get(RETURN_DEPART_TIME_KEY), NEW_DEPART, 'newer departure time survives');
});

test('newer return persisted BEFORE the clear runs: the old clear is a no-op', async () => {
  // The realistic shape: the old abandonment was awaiting the server callable
  // (outside the store) while a login + new return completed. Its clear then
  // starts after the new attempt is already persisted.
  const s = controllableKv({ [RETURN_ATTEMPT_KEY]: OLD_ATTEMPT, [RETURN_DEPART_TIME_KEY]: OLD_DEPART });
  const store = createReturnStateStore(s.kv);

  assert.deepEqual(await store.clearAll(), { ok: true, value: null });            // logout
  const reserved = await store.reserveAttempt(() => NEW_ATTEMPT);                 // new return
  assert.equal(reserved.ok && reserved.value.attemptId, NEW_ATTEMPT);
  await store.markDeparted(NEW_ATTEMPT, NEW_DEPART);

  const out = await store.clearIfOwner(OLD_ATTEMPT);                              // old resumes
  assert.deepEqual(out, { ok: true, value: 'not_owner' });
  assert.equal(s.data.get(RETURN_ATTEMPT_KEY), NEW_ATTEMPT);
  assert.equal(s.data.get(RETURN_DEPART_TIME_KEY), NEW_DEPART);
});

test('a paused deletion does not let another writer observe or lose half-cleared state', async () => {
  const s = controllableKv({ [RETURN_ATTEMPT_KEY]: OLD_ATTEMPT, [RETURN_DEPART_TIME_KEY]: OLD_DEPART });
  const store = createReturnStateStore(s.kv);

  const removeGate = deferred();
  let pausedOnce = false;
  s.setHook((op, key) => {
    if (op === 'remove' && key === RETURN_DEPART_TIME_KEY && !pausedOnce) {
      pausedOnce = true;
      return removeGate.wait;
    }
    return undefined;
  });

  const clearing = track(store.clearIfOwner(OLD_ATTEMPT));
  await flush();
  assert.equal(clearing.settled, false, 'parked mid-deletion');
  // Departure time is still physically present: the mutation window is real.
  assert.equal(s.data.get(RETURN_DEPART_TIME_KEY), OLD_DEPART);

  // A concurrent reader must not see a torn pair; it waits for the section.
  const snapshot = track(store.read());
  await flush();
  assert.equal(snapshot.settled, false, 'reads are serialized too');

  removeGate.open();
  await flush();
  await flush();
  assert.deepEqual(clearing.value, { ok: true, value: 'cleared' });
  assert.deepEqual(snapshot.value, { ok: true, value: { attemptId: null, departTimeIso: null } });
});

test('storage rejection during the ownership read is reported, and nothing is deleted', async () => {
  const s = controllableKv({ [RETURN_ATTEMPT_KEY]: OLD_ATTEMPT, [RETURN_DEPART_TIME_KEY]: OLD_DEPART });
  const store = createReturnStateStore(s.kv);
  s.setFailure((op, key) => (op === 'get' && key === RETURN_ATTEMPT_KEY ? 'keychain_unavailable' : null));

  const out = await store.clearIfOwner(OLD_ATTEMPT);
  assert.deepEqual(out, { ok: false, reason: 'keychain_unavailable' });
  assert.equal(s.data.get(RETURN_ATTEMPT_KEY), OLD_ATTEMPT, 'state preserved on failure');
  assert.equal(s.data.get(RETURN_DEPART_TIME_KEY), OLD_DEPART);
});

test('a failed identity deletion is reported, and the attempt stays retryable', async () => {
  const s = controllableKv({ [RETURN_ATTEMPT_KEY]: OLD_ATTEMPT, [RETURN_DEPART_TIME_KEY]: OLD_DEPART });
  const store = createReturnStateStore(s.kv);
  // Departure time removal succeeds; the identity removal fails.
  s.setFailure((op, key) => (op === 'remove' && key === RETURN_ATTEMPT_KEY ? 'keychain_write_failed' : null));

  const out = await store.clearIfOwner(OLD_ATTEMPT);
  assert.deepEqual(out, { ok: false, reason: 'keychain_write_failed' },
    'must NOT report a durable clear that did not happen');
  assert.equal(s.data.get(RETURN_ATTEMPT_KEY), OLD_ATTEMPT, 'identity kept, so a retry can finish');

  // The retry completes the job once storage recovers.
  s.setFailure(null);
  assert.deepEqual(await store.clearIfOwner(OLD_ATTEMPT), { ok: true, value: 'cleared' });
  assert.equal(s.data.size, 0);
});

test('a queue operation that rejects does not poison later operations', async () => {
  const s = controllableKv({ [RETURN_ATTEMPT_KEY]: OLD_ATTEMPT });
  const store = createReturnStateStore(s.kv);
  s.setFailure(() => 'boom');
  assert.equal((await store.read()).ok, false);
  s.setFailure(null);
  assert.deepEqual(await store.read(), { ok: true, value: { attemptId: OLD_ATTEMPT, departTimeIso: null } });
});

test('reserveAttempt: concurrent starts yield ONE identity, and a retry reuses it', async () => {
  const s = controllableKv();
  const store = createReturnStateStore(s.kv);
  let mints = 0;
  const mint = () => { mints += 1; return mintReturnAttemptId('2026-09-24_143000', 1_790_000_000_000 + mints, () => 0.5); };

  const [a, b] = await Promise.all([store.reserveAttempt(mint), store.reserveAttempt(mint)]);
  assert.equal(a.ok && b.ok, true);
  assert.ok(a.ok && b.ok && a.value.attemptId === b.value.attemptId, 'one identity for one return');
  assert.equal(a.ok && a.value.minted, true);
  assert.equal(b.ok && b.value.minted, false, 'the second call reuses the persisted id');
  assert.equal(s.data.get(RETURN_ATTEMPT_KEY), a.ok ? a.value.attemptId : null);
});

test('reserveAttempt reports a storage failure instead of returning an unpersisted id', async () => {
  const s = controllableKv();
  const store = createReturnStateStore(s.kv);
  s.setFailure((op) => (op === 'set' ? 'keychain_full' : null));
  const out = await store.reserveAttempt(() => NEW_ATTEMPT);
  assert.deepEqual(out, { ok: false, reason: 'keychain_full' });
  assert.equal(s.data.has(RETURN_ATTEMPT_KEY), false);
});

test('reserveAttempt rejects an invalid minted id rather than persisting it', async () => {
  const s = controllableKv();
  const store = createReturnStateStore(s.kv);
  assert.deepEqual(await store.reserveAttempt(() => 'bad id'), { ok: false, reason: 'minted_attempt_invalid' });
  assert.equal(s.data.has(RETURN_ATTEMPT_KEY), false);
});

test('markDeparted will not stamp a departure time onto a newer attempt', async () => {
  const s = controllableKv({ [RETURN_ATTEMPT_KEY]: NEW_ATTEMPT, [RETURN_DEPART_TIME_KEY]: NEW_DEPART });
  const store = createReturnStateStore(s.kv);
  assert.deepEqual(await store.markDeparted(OLD_ATTEMPT, OLD_DEPART), { ok: true, value: 'not_owner' });
  assert.equal(s.data.get(RETURN_DEPART_TIME_KEY), NEW_DEPART, 'newer departure time untouched');
});

test('read never returns a torn pair while a start is mid-write', async () => {
  const s = controllableKv({ [RETURN_ATTEMPT_KEY]: NEW_ATTEMPT });
  const store = createReturnStateStore(s.kv);
  const setGate = deferred();
  let once = false;
  s.setHook((op, key) => {
    if (op === 'set' && key === RETURN_DEPART_TIME_KEY && !once) { once = true; return setGate.wait; }
    return undefined;
  });

  const departing = track(store.markDeparted(NEW_ATTEMPT, NEW_DEPART));
  await flush();
  const snapshot = track(store.read());
  await flush();
  assert.equal(snapshot.settled, false, 'the reader waits rather than seeing an id with no time');
  setGate.open();
  await flush();
  await flush();
  assert.equal(departing.value?.ok, true);
  assert.deepEqual(snapshot.value, { ok: true, value: { attemptId: NEW_ATTEMPT, departTimeIso: NEW_DEPART } });
});

test('clearAll (logout / arrival / identity reset) serializes against an in-flight clear', async () => {
  const s = controllableKv({ [RETURN_ATTEMPT_KEY]: OLD_ATTEMPT, [RETURN_DEPART_TIME_KEY]: OLD_DEPART });
  const store = createReturnStateStore(s.kv);
  const gate = deferred();
  let once = false;
  s.setHook((op, key) => {
    if (op === 'get' && key === RETURN_ATTEMPT_KEY && !once) { once = true; return gate.wait; }
    return undefined;
  });

  const owner = track(store.clearIfOwner(OLD_ATTEMPT));
  await flush();
  const wipe = track(store.clearAll());
  await flush();
  assert.equal(wipe.settled, false, 'logout waits for the critical section');
  gate.open();
  await flush();
  await flush();
  assert.deepEqual(owner.value, { ok: true, value: 'cleared' });
  assert.deepEqual(wipe.value, { ok: true, value: null });
  assert.equal(s.data.size, 0);
});

test('read tolerates a malformed persisted attempt id', async () => {
  const s = controllableKv({ [RETURN_ATTEMPT_KEY]: 'bad id', [RETURN_DEPART_TIME_KEY]: OLD_DEPART });
  const store = createReturnStateStore(s.kv);
  assert.deepEqual(await store.read(), { ok: true, value: { attemptId: null, departTimeIso: OLD_DEPART } });
});

test('REGRESSION: the pre-fix read-then-delete loses a newer identity the store preserves', async () => {
  // The shipped-at-9f59b4f port: three separate awaits over raw storage, with no
  // serialization. Same controllable KV, same interleaving.
  const s = controllableKv({ [RETURN_ATTEMPT_KEY]: OLD_ATTEMPT, [RETURN_DEPART_TIME_KEY]: OLD_DEPART });
  async function preFixClearAttemptIdIf(expected: string): Promise<boolean> {
    const current = await s.kv.get(RETURN_ATTEMPT_KEY).catch(() => null);
    if (current !== expected) return false;
    await s.kv.remove(RETURN_ATTEMPT_KEY).catch(() => {});
    return true;                                    // ...even if the delete failed
  }

  const readGate = deferred();
  let once = false;
  s.setHook((op, key) => {
    if (op === 'get' && key === RETURN_ATTEMPT_KEY && !once) { once = true; return readGate.wait; }
    return undefined;
  });

  const stale = track(preFixClearAttemptIdIf(OLD_ATTEMPT));
  await flush();
  // A newer session persists its return in the unguarded gap.
  s.data.set(RETURN_ATTEMPT_KEY, NEW_ATTEMPT);
  s.data.set(RETURN_DEPART_TIME_KEY, NEW_DEPART);
  readGate.open();
  await flush();
  await flush();

  assert.equal(stale.value, true, 'pre-fix reported success');
  assert.equal(s.data.has(RETURN_ATTEMPT_KEY), false, "pre-fix DELETED the newer session's identity");
  assert.equal(s.data.get(RETURN_DEPART_TIME_KEY), NEW_DEPART, 'and orphaned its departure time');

  // Now the same interleaving where the newer return uses the app's CURRENT
  // persistence path — the store — as every AuthContext writer now does. The
  // raw writes above were faithful to the code at 9f59b4f, where SecureStore
  // was called directly; these are faithful to the code under test.
  //
  // (The guarantee is scoped to writers that go through the store. A writer that
  // bypassed it would defeat serialization, which is why AuthContext is asserted
  // to retain no direct SecureStore access to these keys — see
  // explicitShiftLifecycle.test.ts.)
  const s2 = controllableKv({ [RETURN_ATTEMPT_KEY]: OLD_ATTEMPT, [RETURN_DEPART_TIME_KEY]: OLD_DEPART });
  const store = createReturnStateStore(s2.kv);
  const gate2 = deferred();
  let once2 = false;
  s2.setHook((op, key) => {
    if (op === 'get' && key === RETURN_ATTEMPT_KEY && !once2) { once2 = true; return gate2.wait; }
    return undefined;
  });
  const fixed = track(store.clearIfOwner(OLD_ATTEMPT));
  await flush();
  const newerReserve = track(store.reserveAttempt(() => NEW_ATTEMPT));
  const newerDepart = track(store.markDeparted(NEW_ATTEMPT, NEW_DEPART));
  await flush();
  assert.equal(newerReserve.settled, false, 'the newer writer is serialized, not interleaved');
  gate2.open();
  await flush();
  await flush();

  // What matters is the end state, and it is the opposite of the pre-fix one:
  // the newer session's identity AND its departure time both survive.
  assert.equal(fixed.value?.ok, true);
  assert.equal(newerReserve.value?.ok, true);
  assert.equal(newerDepart.value?.ok, true);
  assert.equal(s2.data.get(RETURN_ATTEMPT_KEY), NEW_ATTEMPT, 'newer identity preserved');
  assert.equal(s2.data.get(RETURN_DEPART_TIME_KEY), NEW_DEPART, 'newer departure time preserved');
});

test('REGRESSION: the pre-fix port claimed success after a failed deletion', async () => {
  const s = controllableKv({ [RETURN_ATTEMPT_KEY]: OLD_ATTEMPT });
  s.setFailure((op, key) => (op === 'remove' && key === RETURN_ATTEMPT_KEY ? 'keychain_write_failed' : null));
  async function preFixClearAttemptIdIf(expected: string): Promise<boolean> {
    const current = await s.kv.get(RETURN_ATTEMPT_KEY).catch(() => null);
    if (current !== expected) return false;
    await s.kv.remove(RETURN_ATTEMPT_KEY).catch(() => {});
    return true;
  }
  assert.equal(await preFixClearAttemptIdIf(OLD_ATTEMPT), true, 'pre-fix said cleared');
  assert.equal(s.data.get(RETURN_ATTEMPT_KEY), OLD_ATTEMPT, 'but nothing was cleared');

  const store = createReturnStateStore(s.kv);
  assert.deepEqual(await store.clearIfOwner(OLD_ATTEMPT), { ok: false, reason: 'keychain_write_failed' });
});
