/**
 * Startup-state matrix and identity-generation ownership for restored
 * session reconciliation.
 *
 * Run: npm run test:auth-core
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VerifiedIdentity } from './authSessionCore.js';
import {
  createReconciliationCore,
  type AuthReconciliationState,
  type LocalIdentity,
  type ReconciliationOps,
} from './reconciliationCore.js';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const flush = () => new Promise<void>((r) => setImmediate(r));

class FakeBoundary {
  /** The persisted SDK user, or null when signed out. */
  identity: VerifiedIdentity | null = null;
  /** Claims cannot be read (offline / refresh failure). */
  unreadable = false;
  /** Ownership itself cannot be established. */
  initThrows = false;
  signOuts: string[] = [];
  identityGate: Deferred | null = null;

  readonly ops: ReconciliationOps = {
    initializePersistentAuth: () => {
      if (this.initThrows) throw new Error('foreign auth instance');
    },
    waitForAuthReady: async () => {},
    getVerifiedIdentity: async () => {
      if (this.identityGate) await this.identityGate.promise;
      if (this.unreadable) throw new Error('claims unreadable');
      return this.identity;
    },
    signOut: async () => {
      this.signOuts.push(this.identity?.uid ?? '<none>');
      this.identity = null;
    },
  };
}

const driver = (uid: string, driverId: string, companyId: string | null = 'co-1'): VerifiedIdentity => ({
  uid,
  kind: 'driver',
  driverId,
  companyId,
});
const local = (driverId: string | null, companyId: string | null = 'co-1'): LocalIdentity => ({
  driverId,
  companyId,
});

function harness() {
  const fake = new FakeBoundary();
  return { fake, core: createReconciliationCore(fake.ops) };
}

describe('startup state matrix', () => {
  const cases: Array<{
    name: string;
    localIdentity: LocalIdentity | null;
    sdk: VerifiedIdentity | null;
    unreadable?: boolean;
    expected: AuthReconciliationState;
    signedOut: boolean;
  }> = [
    {
      name: 'local absent, SDK absent -> local-only',
      localIdentity: null,
      sdk: null,
      expected: 'local-only',
      signedOut: false,
    },
    {
      name: 'local absent, SDK present -> orphan signed out, rejected',
      localIdentity: null,
      sdk: driver('uid-A', 'driver-A'),
      expected: 'rejected',
      signedOut: true,
    },
    {
      name: 'local present, SDK absent -> local-only',
      localIdentity: local('driver-A'),
      sdk: null,
      expected: 'local-only',
      signedOut: false,
    },
    {
      name: 'local present, SDK matching -> verified',
      localIdentity: local('driver-A'),
      sdk: driver('uid-A', 'driver-A'),
      expected: 'verified',
      signedOut: false,
    },
    {
      name: 'local present, SDK mismatched driver -> rejected',
      localIdentity: local('driver-A'),
      sdk: driver('uid-B', 'driver-B'),
      expected: 'rejected',
      signedOut: true,
    },
    {
      name: 'local present, SDK mismatched company -> rejected',
      localIdentity: local('driver-A', 'co-1'),
      sdk: driver('uid-A', 'driver-A', 'co-2'),
      expected: 'rejected',
      signedOut: true,
    },
    {
      name: 'local present, SDK wrong kind -> rejected',
      localIdentity: local('driver-A'),
      sdk: { uid: 'uid-A', kind: 'admin', driverId: 'driver-A', companyId: 'co-1' },
      expected: 'rejected',
      signedOut: true,
    },
    {
      name: 'local present, SDK malformed (no driverId) -> rejected',
      localIdentity: local('driver-A'),
      sdk: { uid: 'uid-A', kind: 'driver', driverId: null, companyId: 'co-1' },
      expected: 'rejected',
      signedOut: true,
    },
    {
      name: 'local present, SDK scoped to WB-T -> rejected',
      localIdentity: local('driver-A'),
      sdk: { uid: 'uid-A', kind: 'driver', driverId: 'driver-A', companyId: 'co-1', app: 'wbt' },
      expected: 'rejected',
      signedOut: true,
    },
    {
      name: 'local present, SDK scoped to an unknown app -> rejected',
      localIdentity: local('driver-A'),
      sdk: { uid: 'uid-A', kind: 'driver', driverId: 'driver-A', companyId: 'co-1', app: 'other' },
      expected: 'rejected',
      signedOut: true,
    },
    {
      name: 'local present, SDK unscoped (today\'s installs) -> verified',
      localIdentity: local('driver-A'),
      sdk: { uid: 'uid-A', kind: 'driver', driverId: 'driver-A', companyId: 'co-1', app: null },
      expected: 'verified',
      signedOut: false,
    },
    {
      name: 'local present, claims temporarily unreadable -> unavailable',
      localIdentity: local('driver-A'),
      sdk: driver('uid-A', 'driver-A'),
      unreadable: true,
      expected: 'unavailable',
      signedOut: false,
    },
    {
      name: 'local absent, claims temporarily unreadable -> unavailable',
      localIdentity: null,
      sdk: null,
      unreadable: true,
      expected: 'unavailable',
      signedOut: false,
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const { fake, core } = harness();
      fake.identity = c.sdk;
      fake.unreadable = c.unreadable ?? false;

      const result = await core.reconcile(c.localIdentity);

      assert.equal(result, c.expected);
      assert.equal(core.getState(), c.expected);
      assert.equal(
        fake.signOuts.length > 0,
        c.signedOut,
        c.signedOut ? 'the SDK user must be signed out' : 'nothing may be signed out',
      );
      assert.equal(core.isVerifiedReady(), c.expected === 'verified');
    });
  }

  it('unavailable preserves the SDK session — it is not a logout', async () => {
    const { fake, core } = harness();
    fake.identity = driver('uid-A', 'driver-A');
    fake.unreadable = true;

    await core.reconcile(local('driver-A'));

    assert.equal(core.getState(), 'unavailable');
    assert.deepEqual(fake.identity, driver('uid-A', 'driver-A'), 'session must survive');
    assert.deepEqual(fake.signOuts, []);
  });

  it('a boundary that cannot establish ownership is unavailable, not rejected', async () => {
    const { fake, core } = harness();
    fake.initThrows = true;
    fake.identity = driver('uid-A', 'driver-A');

    const result = await core.reconcile(local('driver-A'));

    assert.equal(result, 'unavailable');
    assert.deepEqual(fake.signOuts, [], 'must not sign out on an ownership failure');
  });

  it('isVerifiedReady re-reads state — a later rejection clears it', async () => {
    const { fake, core } = harness();
    fake.identity = driver('uid-A', 'driver-A');
    await core.reconcile(local('driver-A'));
    assert.equal(core.isVerifiedReady(), true);

    core.invalidate();
    fake.identity = driver('uid-B', 'driver-B');
    await core.reconcile(local('driver-A'));

    assert.equal(core.isVerifiedReady(), false, 'no stale true may survive');
    assert.equal(core.getState(), 'rejected');
  });
});

describe('identity-generation ownership within one provider lifetime', () => {
  it('A -> logout -> B: B is reconciled, not suppressed', async () => {
    const { fake, core } = harness();
    fake.identity = driver('uid-A', 'driver-A');
    await core.reconcile(local('driver-A'));
    assert.equal(core.getState(), 'verified');

    // Logout, then driver B logs in. The provider never unmounted.
    core.invalidate();
    fake.identity = driver('uid-B', 'driver-B');
    const result = await core.reconcile(local('driver-B'));

    assert.equal(result, 'verified', 'B must be reconciled on its own terms');
    assert.equal(core.isVerifiedReady(), true);
  });

  it("A's late reconciliation cannot publish over B's state", async () => {
    const { fake, core } = harness();
    const gate = deferred();
    fake.identityGate = gate;
    fake.identity = driver('uid-A', 'driver-A');

    // A's reconciliation parks on the claims read.
    const reconcileA = core.reconcile(local('driver-A'));
    await flush();

    // Logout + B logs in and reconciles to completion.
    core.invalidate();
    fake.identityGate = null;
    fake.identity = driver('uid-B', 'driver-B');
    await core.reconcile(local('driver-B'));
    assert.equal(core.getState(), 'verified');

    // A now finishes. It must publish nothing.
    fake.identityGate = null;
    gate.resolve();
    await reconcileA;

    assert.equal(core.getState(), 'verified', "A must not overwrite B's state");
    assert.equal(core.isVerifiedReady(), true);
  });

  it("A's late reconciliation cannot sign out B", async () => {
    const { fake, core } = harness();
    const gate = deferred();
    fake.identityGate = gate;
    // A will see driver-B's session and would normally call it a mismatch.
    fake.identity = driver('uid-A', 'driver-A');

    const reconcileA = core.reconcile(local('driver-A'));
    await flush();

    core.invalidate();
    fake.identityGate = null;
    fake.identity = driver('uid-B', 'driver-B');
    await core.reconcile(local('driver-B'));

    // Release A: it reads B's identity, which mismatches driver-A.
    gate.resolve();
    await reconcileA;

    assert.deepEqual(fake.signOuts, [], "a stale reconciliation must not sign out B");
    assert.deepEqual(fake.identity, driver('uid-B', 'driver-B'));
    assert.equal(core.getState(), 'verified');
  });

  it('a stale subscriber notification is not emitted after invalidation', async () => {
    const { fake, core } = harness();
    const seen: AuthReconciliationState[] = [];
    core.subscribe((s) => seen.push(s));

    const gate = deferred();
    fake.identityGate = gate;
    fake.identity = null;
    const reconcileA = core.reconcile(local('driver-A'));
    await flush();

    core.invalidate();
    gate.resolve();
    await reconcileA;

    assert.ok(
      !seen.includes('local-only'),
      `a superseded reconciliation must publish nothing (saw ${seen.join(',')})`,
    );
  });

  it('logout then no login reconciles the "no identity" case', async () => {
    const { fake, core } = harness();
    fake.identity = driver('uid-A', 'driver-A');
    await core.reconcile(local('driver-A'));
    assert.equal(core.getState(), 'verified');

    // Logout leaves an SDK session behind; reconciling with no local
    // identity must sign that orphan out.
    core.invalidate();
    const result = await core.reconcile(null);

    assert.equal(result, 'rejected');
    assert.deepEqual(fake.signOuts, ['uid-A']);
    assert.equal(fake.identity, null);
  });
});
