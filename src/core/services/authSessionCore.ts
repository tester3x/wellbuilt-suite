/**
 * Auth session orchestration — the ordering-critical logic, isolated.
 *
 * WHY THIS FILE EXISTS
 * secureDriverAuth.ts transitively imports react-native (via AsyncStorage),
 * which esbuild cannot transform, so nothing in it can be executed under
 * `tsx --test`. The races this logic guards against are ordering bugs:
 * they cannot be proven by reading source, only by controlling when each
 * asynchronous Auth operation resolves. So the orchestration lives here,
 * with zero react-native / firebase / expo imports, driven through an
 * injected operations object.
 *
 * This is the same shape as DvirGateDeps elsewhere in this service layer:
 * a narrow dependency object, not a service locator. There is no runtime
 * mode switch, no environment lookup, and no way to select a fake
 * implementation from persisted state, user input, or application data.
 * secureDriverAuth.ts constructs exactly one instance, unconditionally,
 * with the real boundary operations. Tests construct their own instance
 * with deferred fakes; a fresh instance per test is the whole reset story.
 *
 * Firebase Auth stays boundary-owned: this module never imports the SDK,
 * never sees a FirebaseApp, and never learns a uid except as an opaque
 * string handed back by the operations it was given.
 */

/** Server-minted claims for the currently signed-in user. */
export interface VerifiedIdentity {
  uid: string;
  kind: string | null;
  driverId: string | null;
  companyId: string | null;
}

/** The identity an attempt believes it is authenticating. */
export interface ExpectedIdentity {
  driverId?: string;
  companyId?: string;
}

/**
 * The exact asynchronous boundary operations whose ordering matters.
 *
 * Every one of these is a real Firebase Auth operation in production. The
 * set is deliberately minimal — it is the operations that mutate or
 * observe `currentUser`, and nothing else.
 */
export interface AuthSessionOps {
  /** Ensure the boundary-owned persistent Auth instance exists. */
  initializePersistentAuth(): void;
  /** MUTATES currentUser. */
  signInWithCustomToken(customToken: string): Promise<void>;
  /** Resolves once persisted state has been restored or proven absent. */
  waitForAuthReady(): Promise<void>;
  /** Reads server-minted claims for the current user, or null. */
  getVerifiedIdentity(): Promise<VerifiedIdentity | null>;
  /** Synchronous read of the current uid — no await, no refresh. */
  getCurrentUserId(): string | null;
  /** MUTATES currentUser. */
  signOut(): Promise<void>;
}

export interface AuthSessionOptions {
  /** Reserved. */
  readonly _?: never;
}

/** Raised when a newer epoch has taken ownership mid-attempt. */
export class SupersededAttemptError extends Error {
  constructor() {
    super('This sign-in attempt was superseded before it could complete.');
    this.name = 'SupersededAttemptError';
  }
}

/**
 * Raised when unwanted Auth state could NOT be confirmed removed, or when
 * an older Auth mutation could not be confirmed drained.
 *
 * This is the difference between "cleanup attempted and confirmed" and
 * "cleanup failed or unconfirmable". The caller must not treat the second
 * as an ordinary login failure: a mismatched or partially verified user
 * may still be current, so the legacy fallback must not report success.
 */
export class UnresolvedAuthStateError extends Error {
  constructor(public readonly cause: string) {
    super(
      'Sign-in failed and the resulting Auth state could not be confirmed clean. '
      + 'Refusing to continue: an unverified session may still be present.',
    );
    this.name = 'UnresolvedAuthStateError';
  }
}

/** Outcome of a scoped sign-out. Never collapsed to a boolean. */
export type CleanupOutcome = 'confirmed' | 'not-ours' | 'failed';

export interface AuthSessionCore {
  /** Establish a verified session, or throw. */
  establish(customToken: string, expected: ExpectedIdentity, epoch: number): Promise<void>;
  /** Bump the ownership epoch. Logout and identity transitions call this. */
  invalidateEpoch(): void;
  /** The epoch an attempt should capture at entry. */
  captureEpoch(): number;
  /** True when `epoch` is no longer the current owner. */
  isSuperseded(epoch: number): boolean;
}

export function createAuthSessionCore(
  ops: AuthSessionOps,
  _options: AuthSessionOptions = {},
): AuthSessionCore {
  let epoch = 0;

  /**
   * Sign out ONLY the session identified by `uid`.
   *
   * UID-scoped so a stale attempt finishing late cannot sign out a newer,
   * valid session. Returns whether removal was confirmed by re-reading
   * identity afterwards; the caller decides the security outcome, and
   * cleanup failure is never silently discarded.
   */
  async function signOutScoped(uid: string | null): Promise<CleanupOutcome> {
    try {
      const before = await ops.getVerifiedIdentity();
      if (before === null) return 'confirmed'; // already gone
      if (uid && before.uid !== uid) return 'not-ours'; // a newer session — leave it
      await ops.signOut();
      const after = await ops.getVerifiedIdentity();
      if (after === null) return 'confirmed';
      // Identity changed between sign-out and confirmation: a newer session
      // took the slot. Ours is gone, theirs must not be touched.
      if (uid && after.uid !== uid) return 'not-ours';
      return 'failed';
    } catch {
      return 'failed';
    }
  }

  function claimsMatch(identity: VerifiedIdentity | null, expected: ExpectedIdentity): boolean {
    if (!identity) return false;
    if (identity.kind !== 'driver') return false;
    if (expected.driverId && identity.driverId !== expected.driverId) return false;
    if (expected.companyId && identity.companyId !== expected.companyId) return false;
    return true;
  }

  async function readIdentityQuietly(): Promise<VerifiedIdentity | null> {
    try {
      return await ops.getVerifiedIdentity();
    } catch {
      return null;
    }
  }

  async function runEstablish(
    customToken: string,
    expected: ExpectedIdentity,
    attemptEpoch: number,
  ): Promise<void> {
    const superseded = () => epoch !== attemptEpoch;

    // 1. Snapshot the pre-existing session, if any.
    const prior = await readIdentityQuietly();
    if (superseded()) throw new SupersededAttemptError();

    // A pre-existing MISMATCHED session must never survive into this
    // attempt, and if it cannot be confirmed gone we must not proceed and
    // must not let the caller fall back to a "successful" local login.
    if (prior && !claimsMatch(prior, expected)) {
      const removed = await signOutScoped(prior.uid);
      if (removed === 'failed') throw new UnresolvedAuthStateError('prior-mismatch-not-removed');
    }

    let establishedUid: string | null = null;
    try {
      await ops.signInWithCustomToken(customToken);
      // Claim the uid SYNCHRONOUSLY, before the supersession check.
      // Sign-in has already taken effect by the time it resolves, so if
      // the epoch changed during that await the session exists and MUST be
      // rolled back. Recording it only after the next await would leave
      // establishedUid null on exactly that path and let a logged-out
      // driver's session survive.
      establishedUid = ops.getCurrentUserId();
      if (superseded()) throw new SupersededAttemptError();

      await ops.waitForAuthReady();
      if (superseded()) throw new SupersededAttemptError();

      const identity = await ops.getVerifiedIdentity();
      establishedUid = identity?.uid ?? establishedUid;
      if (superseded()) throw new SupersededAttemptError();

      if (!identity) throw new Error('Auth session did not establish');
      if (identity.kind !== 'driver') throw new Error('Auth session is not a driver session');
      if (expected.driverId && identity.driverId !== expected.driverId) {
        throw new Error('Authenticated identity does not match the signed-in driver');
      }
      if (expected.companyId && identity.companyId !== expected.companyId) {
        throw new Error('Authenticated identity does not match the driver company');
      }
    } catch (err) {
      // Roll back only what THIS attempt created. If sign-in never
      // succeeded there is nothing of ours to remove, and any prior
      // session is left exactly as it was.
      if (establishedUid !== null) {
        const removed = await signOutScoped(establishedUid);
        // Cleanup failure is a different, more severe outcome than the
        // verification failure: an unverified user may still be current.
        if (removed === 'failed') throw new UnresolvedAuthStateError('rollback-failed');
      }
      throw err;
    }
  }

  return {
    async establish(customToken, expected, attemptEpoch) {
      ops.initializePersistentAuth();
      await runEstablish(customToken, expected, attemptEpoch);
    },
    invalidateEpoch() {
      epoch += 1;
    },
    captureEpoch() {
      return epoch;
    },
    isSuperseded(e) {
      return epoch !== e;
    },
  };
}
