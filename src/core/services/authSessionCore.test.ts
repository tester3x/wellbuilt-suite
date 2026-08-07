/**
 * Deterministic ordering tests for the Auth session core.
 *
 * Every asynchronous boundary operation is gated, so a test can hold a
 * Firebase call open, drive other work past it, and release it last. That
 * is the only way to prove the stale-completion races: an ownership epoch
 * detects a stale completion AFTER the awaited operation returns, but it
 * cannot stop Firebase from mutating currentUser when an older sign-in
 * finally resolves.
 *
 * Run: npm run test:auth-core
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAuthSessionCore,
  SupersededAttemptError,
  UnresolvedAuthStateError,
  type AuthSessionOps,
  type VerifiedIdentity,
} from './authSessionCore.js';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (e: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every pending microtask and immediate callback run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const driver = (uid: string, driverId: string, companyId = 'co-1'): VerifiedIdentity => ({
  uid,
  kind: 'driver',
  driverId,
  companyId,
});

/**
 * A controllable stand-in for the boundary-owned Firebase Auth instance.
 * `uid` is the analogue of currentUser: sign-in sets it, sign-out clears
 * it, and a stale sign-in resolving late overwrites it — exactly as the
 * real SDK behaves.
 */
class FakeAuth {
  uid: string | null = null;
  events: string[] = [];

  private readonly tokenToUid = new Map<string, string>();
  private readonly claims = new Map<string, VerifiedIdentity>();
  private readonly signInGates = new Map<string, Deferred>();

  readyGate: Deferred | null = null;
  identityGate: Deferred | null = null;
  signOutGate: Deferred | null = null;

  /** Throw on the next identity read. */
  identityError: Error | null = null;
  /** Throw on the next sign-out. */
  signOutError: Error | null = null;
  /** signOut resolves but leaves the user current (silent failure). */
  signOutSilentlyFails = false;
  /** Runs at the top of every identity read — lets a test mutate state. */
  onIdentityRead: (() => void) | null = null;

  register(token: string, identity: VerifiedIdentity): void {
    this.tokenToUid.set(token, identity.uid);
    this.claims.set(identity.uid, identity);
  }

  holdSignIn(token: string): void {
    this.signInGates.set(token, deferred());
  }

  releaseSignIn(token: string): void {
    const gate = this.signInGates.get(token);
    if (!gate) throw new Error(`no held sign-in for ${token}`);
    this.signInGates.delete(token);
    gate.resolve();
  }

  /** Current claims, or null when signed out. */
  identity(): VerifiedIdentity | null {
    return this.uid ? this.claims.get(this.uid) ?? null : null;
  }

  readonly ops: AuthSessionOps = {
    initializePersistentAuth: () => {
      this.events.push('init');
    },
    signInWithCustomToken: async (token) => {
      this.events.push(`signIn:start:${token}`);
      const gate = this.signInGates.get(token);
      if (gate) await gate.promise;
      this.uid = this.tokenToUid.get(token) ?? null;
      this.events.push(`signIn:done:${token}=>${this.uid}`);
    },
    waitForAuthReady: async () => {
      this.events.push('ready:start');
      if (this.readyGate) await this.readyGate.promise;
      this.events.push('ready:done');
    },
    getVerifiedIdentity: async () => {
      this.events.push(`read:${this.uid}`);
      if (this.identityGate) await this.identityGate.promise;
      this.onIdentityRead?.();
      if (this.identityError) {
        const err = this.identityError;
        this.identityError = null;
        throw err;
      }
      return this.identity();
    },
    getCurrentUserId: () => this.uid,
    signOut: async () => {
      this.events.push(`signOut:${this.uid}`);
      if (this.signOutGate) await this.signOutGate.promise;
      if (this.signOutError) {
        const err = this.signOutError;
        this.signOutError = null;
        throw err;
      }
      if (!this.signOutSilentlyFails) this.uid = null;
    },
  };
}

/** A core wired to a fresh fake. No shared state between tests. */
function harness(options?: Parameters<typeof createAuthSessionCore>[1]) {
  const fake = new FakeAuth();
  fake.register('tok-A', driver('uid-A', 'driver-A'));
  fake.register('tok-B', driver('uid-B', 'driver-B'));
  const core = createAuthSessionCore(fake.ops, options);
  return { fake, core };
}

/** Settle a promise without letting a rejection escape. */
function settle<T>(p: Promise<T>): Promise<T | Error> {
  return p.then(
    (v) => v,
    (e: Error) => e,
  );
}

describe('stale sign-in must not replace a newer session', () => {
  it('A pending sign-in, logout, B logs in, A resolves last', async () => {
    const { fake, core } = harness();

    // 1. Login A enters signInWithCustomToken and stays pending.
    fake.holdSignIn('tok-A');
    const epochA = core.captureEpoch();
    const attemptA = settle(core.establish('tok-A', { driverId: 'driver-A' }, epochA));
    await flush();
    assert.ok(
      fake.events.includes('signIn:start:tok-A'),
      'A must be parked inside signInWithCustomToken',
    );
    assert.equal(fake.uid, null, 'A has not signed in yet');

    // 2. Logout invalidates A and clears application login ownership.
    core.invalidateEpoch();

    // 3. Login B begins and establishes verified user B.
    const epochB = core.captureEpoch();
    const attemptB = core.establish('tok-B', { driverId: 'driver-B' }, epochB);

    // 4. The older sign-in for A resolves afterwards.
    await flush();
    fake.releaseSignIn('tok-A');

    await attemptB; // B must succeed
    const outcomeA = await attemptA;

    // 5. The final SDK session must still be verified user B.
    assert.ok(outcomeA instanceof Error, 'A must not report success');
    assert.ok(
      outcomeA instanceof SupersededAttemptError || outcomeA instanceof UnresolvedAuthStateError,
      `A must fail as superseded/unresolved, got ${String(outcomeA)}`,
    );
    assert.equal(
      fake.uid,
      'uid-B',
      `final session must be B — a stale operation may neither leave A current `
      + `nor erase B and leave no session (events: ${fake.events.join(' | ')})`,
    );
    assert.deepEqual(fake.identity(), driver('uid-B', 'driver-B'));
  });
});

describe('logout during each awaited phase', () => {
  // Phase 1 (custom-token acquisition) happens in secureDriverAuth before
  // the core is entered, so it is exercised through the epoch the caller
  // captured BEFORE acquisition: an attempt whose token arrives after a
  // logout must never mutate Auth at all.
  it('phase 1 — logout during custom-token acquisition: no Auth mutation', async () => {
    const { fake, core } = harness();
    const epochA = core.captureEpoch();
    core.invalidateEpoch(); // logout while the callable was still in flight

    const outcome = await settle(core.establish('tok-A', { driverId: 'driver-A' }, epochA));

    assert.ok(outcome instanceof SupersededAttemptError, String(outcome));
    assert.equal(fake.uid, null, 'no session may be created');
    assert.ok(!fake.events.some((e) => e.startsWith('signIn:done')), 'sign-in must not complete');
  });

  it('phase 2 — logout during signInWithCustomToken: session rolled back', async () => {
    const { fake, core } = harness();
    fake.holdSignIn('tok-A');
    const epochA = core.captureEpoch();
    const attempt = settle(core.establish('tok-A', { driverId: 'driver-A' }, epochA));
    await flush();

    core.invalidateEpoch();
    fake.releaseSignIn('tok-A');
    const outcome = await attempt;

    assert.ok(outcome instanceof SupersededAttemptError, String(outcome));
    assert.equal(fake.uid, null, 'the session this attempt created must be removed');
    assert.ok(fake.events.includes('signOut:uid-A'), 'rollback must have run');
  });

  it('phase 3 — logout during readiness: session rolled back', async () => {
    const { fake, core } = harness();
    fake.readyGate = deferred();
    const epochA = core.captureEpoch();
    const attempt = settle(core.establish('tok-A', { driverId: 'driver-A' }, epochA));
    await flush();
    assert.equal(fake.uid, 'uid-A', 'sign-in landed; we are parked in readiness');

    core.invalidateEpoch();
    fake.readyGate.resolve();
    const outcome = await attempt;

    assert.ok(outcome instanceof SupersededAttemptError, String(outcome));
    assert.equal(fake.uid, null);
  });

  it('phase 4 — logout during the verified-claims read: session rolled back', async () => {
    const { fake, core } = harness();
    fake.readyGate = deferred();
    const epochA = core.captureEpoch();
    const attempt = settle(core.establish('tok-A', { driverId: 'driver-A' }, epochA));
    await flush();

    // Park the post-readiness claims read, then log out while it is open.
    const claimsGate = deferred();
    fake.identityGate = claimsGate;
    fake.readyGate.resolve();
    await flush();

    core.invalidateEpoch();
    fake.identityGate = null;
    claimsGate.resolve();
    const outcome = await attempt;

    assert.ok(outcome instanceof Error, String(outcome));
    assert.equal(fake.uid, null, 'no session may survive a logout mid-verification');
  });
});

describe('stale completion cannot disturb a newer login', () => {
  it('A pending claim read, logout, B logs in — B survives', async () => {
    const { fake, core } = harness();
    fake.readyGate = deferred();
    const epochA = core.captureEpoch();
    const attemptA = settle(core.establish('tok-A', { driverId: 'driver-A' }, epochA));
    await flush();

    const claimsGate = deferred();
    fake.identityGate = claimsGate;
    fake.readyGate.resolve();
    await flush();

    core.invalidateEpoch();
    const epochB = core.captureEpoch();
    const attemptB = core.establish('tok-B', { driverId: 'driver-B' }, epochB);
    await flush();

    fake.identityGate = null;
    claimsGate.resolve();

    await attemptB;
    const outcomeA = await attemptA;

    assert.ok(outcomeA instanceof Error, 'A must not succeed');
    assert.equal(fake.uid, 'uid-B', 'final session must be B: ' + fake.events.join(' | '));
  });

  it('A cleanup delayed while B attempts login — B waits, then wins', async () => {
    const { fake, core } = harness();
    fake.holdSignIn('tok-A');
    const epochA = core.captureEpoch();
    const attemptA = settle(core.establish('tok-A', { driverId: 'driver-A' }, epochA));
    await flush();

    core.invalidateEpoch();
    // Hold A's rollback sign-out open.
    fake.signOutGate = deferred();
    fake.releaseSignIn('tok-A');
    await flush();

    const epochB = core.captureEpoch();
    let bDone = false;
    const attemptB = core.establish('tok-B', { driverId: 'driver-B' }, epochB).then(() => {
      bDone = true;
    });
    await flush();
    assert.equal(bDone, false, 'B must not finish while A is still cleaning up');
    assert.ok(!fake.events.includes('signIn:start:tok-B'), 'B must not have started signing in');

    const gate = fake.signOutGate;
    fake.signOutGate = null;
    gate.resolve();
    await attemptB;
    await attemptA;

    assert.equal(bDone, true);
    assert.equal(fake.uid, 'uid-B');
  });

  it('a stale cleanup never signs out a newer uid', async () => {
    const { fake, core } = harness();
    await core.establish('tok-A', { driverId: 'driver-A' }, core.captureEpoch());
    assert.equal(fake.uid, 'uid-A');

    core.invalidateEpoch();
    await core.establish('tok-B', { driverId: 'driver-B' }, core.captureEpoch());
    assert.equal(fake.uid, 'uid-B');

    // An attempt carrying a stale epoch must decline to touch B.
    const epochStale = core.captureEpoch() - 1;
    const outcome = await settle(core.establish('tok-A', { driverId: 'driver-A' }, epochStale));

    assert.ok(outcome instanceof Error, String(outcome));
    assert.equal(fake.uid, 'uid-B', 'B must still be current');
    assert.ok(!fake.events.includes('signOut:uid-B'), 'must never sign out the newer uid');
  });

  it('bounded drain fails closed when a prior mutation never settles', async () => {
    const { fake, core } = harness({
      maxDrainWaits: 2,
      // Deterministic: the timeout resolves immediately instead of sleeping.
      awaitWithTimeout: async () => 'timeout',
    });
    fake.holdSignIn('tok-A');
    const epochA = core.captureEpoch();
    const attemptA = settle(core.establish('tok-A', { driverId: 'driver-A' }, epochA));
    await flush();

    core.invalidateEpoch();
    const outcome = await settle(
      core.establish('tok-B', { driverId: 'driver-B' }, core.captureEpoch()),
    );

    assert.ok(outcome instanceof UnresolvedAuthStateError, 'must fail closed: ' + String(outcome));
    assert.match((outcome as UnresolvedAuthStateError).cause, /drain/);
    assert.ok(!fake.events.includes('signIn:start:tok-B'), 'B must not have mutated Auth');

    fake.releaseSignIn('tok-A');
    await attemptA;
  });

  it('retry after the stale operation is fully drained establishes B normally', async () => {
    const { fake, core } = harness({ maxDrainWaits: 2, awaitWithTimeout: async () => 'timeout' });
    fake.holdSignIn('tok-A');
    const attemptA = settle(core.establish('tok-A', { driverId: 'driver-A' }, core.captureEpoch()));
    await flush();
    core.invalidateEpoch();

    const failed = await settle(
      core.establish('tok-B', { driverId: 'driver-B' }, core.captureEpoch()),
    );
    assert.ok(failed instanceof UnresolvedAuthStateError);

    // Drain A completely, then retry.
    fake.releaseSignIn('tok-A');
    await attemptA;
    assert.equal(core.hasPendingMutation(), false, 'the slot must be free again');

    await core.establish('tok-B', { driverId: 'driver-B' }, core.captureEpoch());
    assert.equal(fake.uid, 'uid-B');
  });
});

describe('cleanup outcome classification', () => {
  it('sign-out rejection is unresolved, not an ordinary failure', async () => {
    const { fake, core } = harness();
    fake.readyGate = deferred();
    const epochA = core.captureEpoch();
    const attempt = settle(core.establish('tok-A', { driverId: 'driver-A' }, epochA));
    await flush();

    core.invalidateEpoch();
    fake.signOutError = new Error('network down');
    fake.readyGate.resolve();
    const outcome = await attempt;

    assert.ok(outcome instanceof UnresolvedAuthStateError, String(outcome));
    assert.equal((outcome as UnresolvedAuthStateError).cause, 'rollback-failed');
    assert.equal(fake.uid, 'uid-A', 'the unremoved session is still current — hence unresolved');
  });

  it('a sign-out that silently leaves the user current is unresolved', async () => {
    const { fake, core } = harness();
    fake.readyGate = deferred();
    const attempt = settle(core.establish('tok-A', { driverId: 'driver-A' }, core.captureEpoch()));
    await flush();

    core.invalidateEpoch();
    fake.signOutSilentlyFails = true;
    fake.readyGate.resolve();
    const outcome = await attempt;

    assert.ok(outcome instanceof UnresolvedAuthStateError, String(outcome));
    assert.equal((outcome as UnresolvedAuthStateError).cause, 'rollback-failed');
  });

  it('identity reread rejection is unresolved', async () => {
    const { fake, core } = harness();
    fake.readyGate = deferred();
    const attempt = settle(core.establish('tok-A', { driverId: 'driver-A' }, core.captureEpoch()));
    await flush();

    core.invalidateEpoch();
    fake.identityError = new Error('claims unreadable');
    fake.readyGate.resolve();
    const outcome = await attempt;

    assert.ok(outcome instanceof UnresolvedAuthStateError, String(outcome));
    assert.equal((outcome as UnresolvedAuthStateError).cause, 'rollback-failed');
  });

  it('identity changing before sign-out is "not ours" — nothing is touched', async () => {
    const { fake, core } = harness();
    fake.readyGate = deferred();
    const attempt = settle(core.establish('tok-A', { driverId: 'driver-A' }, core.captureEpoch()));
    await flush();
    assert.equal(fake.uid, 'uid-A');

    core.invalidateEpoch();
    // Between the ownership check and the sign-out, a newer session lands.
    fake.onIdentityRead = () => {
      fake.uid = 'uid-B';
      fake.onIdentityRead = null;
    };
    fake.readyGate.resolve();
    const outcome = await attempt;

    assert.ok(outcome instanceof SupersededAttemptError, String(outcome));
    assert.equal(fake.uid, 'uid-B', 'the newer session must be untouched');
    assert.ok(!fake.events.includes('signOut:uid-B'), 'must never sign out the newer uid');
  });

  it('identity changing between sign-out and confirmation is "not ours"', async () => {
    const { fake, core } = harness();
    fake.readyGate = deferred();
    const attempt = settle(core.establish('tok-A', { driverId: 'driver-A' }, core.captureEpoch()));
    await flush();

    core.invalidateEpoch();
    let reads = 0;
    fake.onIdentityRead = () => {
      reads += 1;
      // Read 1: the pre-cleanup ownership check still sees A, so sign-out
      // proceeds. Read 2: the confirmation read finds a newer session.
      if (reads === 2) fake.uid = 'uid-B';
    };
    fake.readyGate.resolve();
    const outcome = await attempt;

    // Ours was removed and a newer one exists: superseded, NOT unresolved.
    assert.ok(outcome instanceof SupersededAttemptError, String(outcome));
    assert.equal(fake.uid, 'uid-B');
  });
});

describe('single-flight attempt ownership', () => {
  it('identical submissions coalesce onto one attempt', async () => {
    const { core } = harness();
    let runs = 0;
    const gate = deferred();
    const run = async () => {
      runs += 1;
      await gate.promise;
      return 'result';
    };

    const first = core.singleFlight('key-A', run);
    const second = core.singleFlight('key-A', run);
    assert.equal(first.kind, 'attempt');
    assert.equal(second.kind, 'attempt');
    assert.equal(runs, 1, 'the second submission must not start a second exchange');
    assert.equal(
      (first as { promise: Promise<string> }).promise,
      (second as { promise: Promise<string> }).promise,
      'both callers must receive the same promise',
    );

    gate.resolve();
    assert.equal(await (first as { promise: Promise<string> }).promise, 'result');
  });

  it('a different concurrent submission is told busy, never given the result', async () => {
    const { core } = harness();
    const gate = deferred();
    const first = core.singleFlight('key-A', async () => {
      await gate.promise;
      return 'A-result';
    });
    const second = core.singleFlight('key-B', async () => 'B-result');

    assert.equal(second.kind, 'busy', 'a different attempt must not receive A result');
    gate.resolve();
    await (first as { promise: Promise<string> }).promise;
  });

  it('the slot clears on settle so the next login can proceed', async () => {
    const { core } = harness();
    await (core.singleFlight('key-A', async () => 'x') as { promise: Promise<string> }).promise;
    await flush();
    assert.equal(core.inFlightKey(), null);
    const next = core.singleFlight('key-B', async () => 'y');
    assert.equal(next.kind, 'attempt');
  });

  it('logout releases the slot so a new login is not told busy', async () => {
    const { core } = harness();
    const gate = deferred();
    const first = core.singleFlight('key-A', async () => {
      await gate.promise;
      return 'A';
    });

    core.invalidateEpoch(); // logout
    assert.equal(core.inFlightKey(), null, 'logout must release the attempt slot');

    const second = core.singleFlight('key-B', async () => 'B');
    assert.equal(second.kind, 'attempt', 'the next login must not be blocked by a cancelled one');

    gate.resolve();
    await (first as { promise: Promise<string> }).promise;
  });

  it("a stale finally cannot clear a newer attempt's ownership", async () => {
    const { core } = harness();
    const gateA = deferred();
    const attemptA = (
      core.singleFlight('key-A', async () => {
        await gateA.promise;
        return 'A';
      }) as { promise: Promise<string> }
    ).promise;

    core.invalidateEpoch(); // logout releases the slot
    const gateB = deferred();
    const attemptB = (
      core.singleFlight('key-B', async () => {
        await gateB.promise;
        return 'B';
      }) as { promise: Promise<string> }
    ).promise;
    assert.equal(core.inFlightKey(), 'key-B');

    // A settles LAST. Its finally must not clear B's ownership.
    gateA.resolve();
    await attemptA;
    await flush();
    assert.equal(core.inFlightKey(), 'key-B', "A's stale finally must not clear B");

    // And B is still coalescing correctly.
    const dup = core.singleFlight('key-B', async () => 'other');
    assert.equal(dup.kind, 'attempt');
    assert.equal((dup as { promise: Promise<string> }).promise, attemptB);

    gateB.resolve();
    assert.equal(await attemptB, 'B');
    await flush();
    assert.equal(core.inFlightKey(), null);
  });

  it('a rejected attempt still releases the slot', async () => {
    const { core } = harness();
    const attempt = (
      core.singleFlight('key-A', async () => {
        throw new Error('login failed');
      }) as { promise: Promise<string> }
    ).promise;
    await settle(attempt);
    await flush();
    assert.equal(core.inFlightKey(), null, 'a failed login must not wedge the slot');
  });
});
