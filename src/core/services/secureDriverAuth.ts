/**
 * Secure driver auth via Cloud Functions HTTPS callables (no open RTDB).
 * Uses REST callable protocol + Identity Toolkit custom-token exchange.
 * Dual-run: call this first; legacy REST remains until rule enforcement.
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirebaseApp } from './firebaseApp';
import {
  getOwnedIdToken,
  initializePersistentAuth,
  signInWithCustomTokenOwned,
  signOutOwned,
  waitForAuthReady,
  getOwnedVerifiedIdentity,
} from './firebaseAuthBoundary';

const PROJECT_ID = 'wellbuilt-sync';
const REGION = 'us-central1';
const API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';
const CALLABLE_BASE = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

const ID_TOKEN_KEY = 'wb_secure_id_token';
const REFRESH_TOKEN_KEY = 'wb_secure_refresh_token';
const PENDING_ID_KEY = 'pendingSecureId';

async function callCallable<T>(name: string, data: Record<string, unknown>): Promise<T> {
  const url = `${CALLABLE_BASE}/${name}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || body.error) {
    const msg =
      body?.error?.message ||
      body?.error?.status ||
      `Callable ${name} failed (${resp.status})`;
    throw new Error(msg);
  }
  return body.result as T;
}

/**
 * Auth ownership epoch.
 *
 * Clearing a promise reference does NOT cancel an in-flight Firebase
 * operation — signInWithCustomToken, readiness and the claims read all
 * keep running and can still resolve after a logout. An epoch makes that
 * safe: logout and identity transitions bump it, and every attempt
 * re-checks ownership after each awaited step. A superseded attempt
 * publishes nothing and cleans up only the session it created itself.
 */
/** Drop the in-flight attempt so a later logout is not overtaken. */
export function cancelInFlightLogin(): void {
  inFlightLogin = null;
  inFlightKey = null;
}

/**
 * Raised when unwanted Auth state could NOT be confirmed removed.
 *
 * This is the difference between "cleanup attempted and confirmed" and
 * "cleanup failed or unconfirmable". The caller must not treat the
 * second as an ordinary secure-login failure, because a mismatched or
 * partially verified SDK user may still be current — so the legacy
 * fallback must not report success for that attempt either.
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

/**
 * Sign out ONLY the session this attempt established.
 *
 * UID-scoped so a stale attempt finishing late cannot sign out a newer,
 * valid session that replaced it. Returns whether removal was confirmed;
 * the caller decides the security outcome — cleanup failure is never
 * silently discarded.
 */
async function signOutOwnedUid(
  app: ReturnType<typeof getFirebaseApp>,
  uid: string | null,
): Promise<'confirmed' | 'not-ours' | 'failed'> {
  try {
    const now = await getOwnedVerifiedIdentity(app);
    if (now === null) return 'confirmed';        // already gone
    if (uid && now.uid !== uid) return 'not-ours'; // a newer session — leave it
    await signOutOwned(app);
    const after = await getOwnedVerifiedIdentity(app);
    return after === null ? 'confirmed' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Claims match the driver we believe we are authenticating. */
function claimsMatch(
  identity: { kind: string | null; driverId: string | null; companyId: string | null } | null,
  expected: { driverId?: string; companyId?: string },
): boolean {
  if (!identity) return false;
  if (identity.kind !== 'driver') return false;
  if (expected.driverId && identity.driverId !== expected.driverId) return false;
  if (expected.companyId && identity.companyId !== expected.companyId) return false;
  return true;
}

/** Claims read that never throws — a transient failure reads as "unknown". */
async function readIdentityQuietly(app: ReturnType<typeof getFirebaseApp>) {
  try {
    return await getOwnedVerifiedIdentity(app);
  } catch {
    return null;
  }
}

/**
 * Establish a VERIFIED owned session, transactionally.
 *
 * Previously, a sign-in that succeeded but failed claim verification left
 * the new user signed in: establishSdkSession threw, secureLogin caught,
 * and verifyLogin fell through to the legacy hash path and reported an
 * ordinary local login — while a persistent SDK session for the WRONG
 * driver survived. getSecureIdToken() would then hand out that identity.
 *
 * Now every post-sign-in failure rolls the session back, and a
 * pre-existing mismatched session is signed out before another identity
 * is accepted. A transient failure BEFORE sign-in leaves any prior valid
 * matching session untouched — a redundant login attempt that merely
 * loses connectivity must not destroy a good session.
 */
async function establishSdkSession(
  customToken: string,
  expected: { driverId?: string; companyId?: string },
): Promise<void> {
  const app = getFirebaseApp();
  initializePersistentAuth(app, AsyncStorage);

  // 1. Snapshot the pre-existing owned session, if any.
  const prior = await readIdentityQuietly(app);
  const priorMatched = claimsMatch(prior, expected);

  // A pre-existing MISMATCHED session must never survive into this
  // attempt — and if it cannot be confirmed gone, we must not proceed and
  // must not let the caller fall back to a "successful" local login.
  if (prior && !priorMatched) {
    const removed = await signOutOwnedUid(app, prior.uid);
    if (removed === 'failed') throw new UnresolvedAuthStateError('prior-mismatch-not-removed');
  }

  // 2-5. Sign in, await readiness, read and validate claims, re-checking
  // ownership after every awaited step so a logout mid-flight can never be
  // overtaken by this attempt publishing success.
  let establishedUid: string | null = null;
  try {
    await signInWithCustomTokenOwned(app, customToken);

    await waitForAuthReady(app);

    const identity = await getOwnedVerifiedIdentity(app);
    establishedUid = identity?.uid ?? null;

    if (!identity) throw new Error('Auth session did not establish');
    if (identity.kind !== 'driver') throw new Error('Auth session is not a driver session');
    if (expected.driverId && identity.driverId !== expected.driverId) {
      throw new Error('Authenticated identity does not match the signed-in driver');
    }
    if (expected.companyId && identity.companyId !== expected.companyId) {
      throw new Error('Authenticated identity does not match the driver company');
    }
  } catch (err) {
    // 6. Roll back only the session THIS attempt created, scoped by uid so
    // a stale attempt finishing late cannot sign out a newer valid
    // session. If sign-in never succeeded there is nothing of ours to
    // remove and any prior session is left exactly as it was.
    if (establishedUid !== null) {
      const removed = await signOutOwnedUid(app, establishedUid);
      // Cleanup failure is a DIFFERENT, more severe outcome than the
      // verification failure: an unverified user may still be current, so
      // the caller must refuse to continue rather than fall back.
      if (removed === 'failed') throw new UnresolvedAuthStateError('rollback-failed');
    }
    throw err;
  }
}

export async function secureSubmitRegistration(params: {
  displayName: string;
  passcode: string;
  companyName?: string;
  legalName?: string;
  source?: string;
}): Promise<{ success: boolean; pendingId?: string; error?: string }> {
  try {
    const result = await callCallable<{ pendingId: string }>('requestDriverRegistration', {
      displayName: params.displayName,
      passcode: params.passcode,
      companyName: params.companyName,
      legalName: params.legalName,
      source: params.source || 'wbs',
    });
    if (result.pendingId) {
      await SecureStore.setItemAsync(PENDING_ID_KEY, result.pendingId);
    }
    return { success: true, pendingId: result.pendingId };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Registration failed' };
  }
}

export async function secureCheckRegistrationStatus(
  pendingId?: string | null,
): Promise<'pending' | 'approved' | 'rejected' | 'none'> {
  try {
    const id = pendingId || (await SecureStore.getItemAsync(PENDING_ID_KEY));
    if (!id) return 'none';
    const result = await callCallable<{ status: string }>('checkDriverRegistrationStatus', {
      pendingId: id,
    });
    return (result.status as any) || 'none';
  } catch {
    return 'pending';
  }
}


/**
 * Single-flight guard for the login exchange, keyed by ATTEMPT IDENTITY.
 *
 * Duplicate taps must not race two authenticateDriver calls and two
 * signInWithCustomToken exchanges against one Auth instance — the second
 * would overwrite the first's session mid-establishment.
 *
 * But coalescing must only ever merge genuinely identical submissions. An
 * unkeyed slot would hand a second attempt for a DIFFERENT driver the
 * first attempt's result, reporting the wrong identity as a success. The
 * key therefore distinguishes the normalized display name and the
 * credential attempt.
 *
 * The credential is never stored: it is reduced to a keyed digest under a
 * random per-process key (see attemptKey below) that lives only in memory
 * for the duration of the in-flight promise, is never persisted, and is
 * never logged. It exists solely to tell "same submission" from
 * "different submission".
 * Expected driver/company are not part of the key because they are
 * server-supplied outputs of the attempt, not inputs to it.
 */
let inFlightLogin: Promise<SecureLoginResult> | null = null;
let inFlightKey: string | null = null;

/**
 * Random 256-bit process key. Generated once per app process, held only
 * in memory, never persisted, never logged, never transmitted. It dies
 * with the process, so an equality token from one run means nothing in
 * another.
 */
let attemptKeyMaterial: string | null = null;

async function processKey(): Promise<string> {
  if (attemptKeyMaterial === null) {
    const bytes = await Crypto.getRandomBytesAsync(32);
    attemptKeyMaterial = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return attemptKeyMaterial;
}

/**
 * Keyed equality token for one submission.
 *
 * SHA-256 over (random 256-bit process key, normalized name, credential)
 * — a KEYED digest, not a plain salted one. The distinction is the whole
 * point: a passcode is low entropy, so a salted digest with a knowable
 * salt would be trivially brute-forceable. Keyed under a secret random
 * value that never leaves memory, it is not. (An earlier version used a
 * 32-bit non-cryptographic hash over a timestamp salt, and its comment
 * overstated the guarantee: it was neither keyed nor hard to invert.)
 *
 * It exists ONLY to answer "is this the same submission as the one in
 * flight?" It is never persisted, never logged, never transmitted, and is
 * never used as a password hash or as authority for anything.
 *
 * The normalized name is kept in the clear as a prefix deliberately: the
 * server resolves identity through driver_name_index/{nameNorm} to a
 * single driverId, so the normalized name IS the account identifier and
 * is already stored in local identity. The credential component only
 * separates a duplicate tap from a corrected retry.
 */
async function attemptKey(displayName: string, passcode: string): Promise<string> {
  const normalizedName = displayName.trim().toLowerCase();
  const token = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    [await processKey(), normalizedName, passcode].join('\u0001'),
  );
  return `${normalizedName}#${token}`;
}


export interface SecureLoginResult {
  valid: boolean;
  /**
   * True only when an owned, persistent SDK Auth session exists AND its
   * server-minted claims match this driver. `valid` alone means the
   * credentials checked out; it does NOT mean a verified cloud session
   * exists, because the legacy dual-run path can validate without one.
   */
  authVerified?: boolean;
  /**
   * Set when sign-in failed AND unwanted Auth state could not be confirmed
   * removed. The legacy fallback must refuse to report success while this
   * is set, because an unverified session may still be present.
   */
  authStateUnresolved?: boolean;
  error?: string;
  driverId?: string;
  displayName?: string;
  legalName?: string;
  companyId?: string;
  companyName?: string;
  isAdmin?: boolean;
  isViewer?: boolean;
  assignedRoutes?: string[];
  defaultPackageId?: string;
  passcodeHash?: string;
}

/**
 * Public entry point. Shares one in-flight exchange across duplicate
 * submissions so two taps cannot race two token exchanges against a
 * single Auth instance.
 */
export async function secureLogin(params: {
  displayName: string;
  passcode: string;
}): Promise<SecureLoginResult> {
  const key = await attemptKey(params.displayName, params.passcode);
  // Coalesce only an identical submission. A different name or credential
  // must never receive this attempt's result.
  if (inFlightLogin && inFlightKey === key) return inFlightLogin;
  if (inFlightLogin) {
    return Promise.resolve({
      valid: false,
      error: 'Another sign-in is already in progress',
    });
  }
  inFlightKey = key;
  const attempt = runSecureLogin(params).finally(() => {
    // Only clear if this attempt still owns the slot — a logout that
    // cancelled it must not be undone by this settling late.
    if (inFlightKey === key) {
      inFlightLogin = null;
      inFlightKey = null;
    }
  });
  inFlightLogin = attempt;
  return attempt;
}

async function runSecureLogin(params: {
  displayName: string;
  passcode: string;
}): Promise<SecureLoginResult> {
  try {
    const data = await callCallable<{
      customToken?: string;
      idToken?: string;
      refreshToken?: string;
      mintMethod?: string;
      driverId: string;
      displayName: string;
      legalName?: string;
      companyId?: string;
      companyName?: string;
      isAdmin?: boolean;
      isViewer?: boolean;
      assignedRoutes?: string[];
      defaultPackageId?: string;
    }>('authenticateDriver', {
      displayName: params.displayName,
      passcode: params.passcode,
    });
    // Prefer custom token (createCustomToken + signInWithCustomToken).
    // idToken path is emergency password-exchange only (server flag off by default).
    // Only the custom-token path can establish an SDK session. The legacy
    // idToken path was an emergency password-exchange escape hatch (server
    // flag off by default) whose token had no refresh path; it no longer
    // establishes a session rather than creating one that silently expires.
    if (data.customToken) {
      await establishSdkSession(
        data.customToken,
        { driverId: data.driverId, companyId: data.companyId || undefined },
      );
      // Legacy material is removed only AFTER the SDK session exists.
      await clearLegacyTokenMaterial();
    } else {
      throw new Error('Server did not return a session token');
    }
    return {
      valid: true,
      authVerified: true,
      driverId: data.driverId,
      // passcodeHash field kept for session shape compatibility; store driverId
      passcodeHash: data.driverId,
      displayName: data.displayName,
      legalName: data.legalName || undefined,
      companyId: data.companyId || undefined,
      companyName: data.companyName || undefined,
      isAdmin: data.isAdmin === true,
      isViewer: data.isViewer === true,
      assignedRoutes: data.assignedRoutes || undefined,
      defaultPackageId: data.defaultPackageId || undefined,
    };
  } catch (e: any) {
    // An unresolved Auth state is NOT an ordinary login failure: a
    // mismatched or partially verified user may still be current, so the
    // caller must not fall back to a local login for this attempt.
    if (e instanceof UnresolvedAuthStateError) {
      return { valid: false, authStateUnresolved: true, error: e.message };
    }
    return { valid: false, error: e?.message || 'Login failed' };
  }
}

export async function secureSignOut(): Promise<void> {
  // End the verified session first; local cleanup follows even if it fails,
  // so a driver can never be left signed in with local state cleared.
  try {
    await signOutOwned(getFirebaseApp());
  } catch {
    // Unowned or already signed out — legacy cleanup still proceeds.
  }
  await clearLegacyTokenMaterial();
}

/**
 * Remove the pre-SDK token material. Called only AFTER an SDK session is
 * established, or as part of a completed sign-out — never before, so a
 * failed sign-in leaves the prior local state untouched. Values are
 * deleted, never read or logged.
 */
export async function clearLegacyTokenMaterial(): Promise<void> {
  await SecureStore.deleteItemAsync(ID_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

/**
 * Current ID token from the SDK-owned session.
 *
 * Compatibility-named: it previously returned whatever string sat in
 * SecureStore, with no expiry check and no refresh, so after an hour it
 * was a stale token presented as identity. It now asks the owned Auth
 * session, which owns refresh. Returns null when no verified session
 * exists so callers fail closed rather than sending a dead credential.
 */
export async function getSecureIdToken(): Promise<string | null> {
  return getOwnedIdToken(getFirebaseApp());
}
