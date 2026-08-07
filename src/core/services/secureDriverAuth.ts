/**
 * Secure driver auth via Cloud Functions HTTPS callables (no open RTDB).
 * Uses REST callable protocol + Identity Toolkit custom-token exchange.
 * Dual-run: call this first; legacy REST remains until rule enforcement.
 */
import * as SecureStore from 'expo-secure-store';
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

/** Sign-out whose own failure can never mask the caller's failure. */
async function signOutQuietly(app: ReturnType<typeof getFirebaseApp>): Promise<void> {
  try {
    await signOutOwned(app);
  } catch {
    // Deliberately swallowed: cleanup must not convert a failed
    // verification into a thrown cleanup error, or worse, into success.
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

  // A pre-existing MISMATCHED session must never survive into this attempt.
  if (prior && !priorMatched) await signOutQuietly(app);

  // 2-5. Sign in, await readiness, read and validate claims.
  let signedInThisAttempt = false;
  try {
    await signInWithCustomTokenOwned(app, customToken);
    signedInThisAttempt = true;
    await waitForAuthReady(app);
    const identity = await getOwnedVerifiedIdentity(app);
    if (!identity) throw new Error('Auth session did not establish');
    if (identity.kind !== 'driver') throw new Error('Auth session is not a driver session');
    if (expected.driverId && identity.driverId !== expected.driverId) {
      throw new Error('Authenticated identity does not match the signed-in driver');
    }
    if (expected.companyId && identity.companyId !== expected.companyId) {
      throw new Error('Authenticated identity does not match the driver company');
    }
  } catch (err) {
    // 6. Roll back only what this attempt created. If sign-in itself never
    // succeeded, any prior session is still whatever it was and is left
    // alone; if it did, the new user is unverified or mismatched and must
    // not persist.
    if (signedInThisAttempt) await signOutQuietly(app);
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
 * The credential is never stored: it is reduced to a non-reversible,
 * per-process fingerprint that lives only in memory for the duration of
 * the in-flight promise, is never persisted, and is never logged. It
 * exists solely to tell "same submission" from "different submission".
 * Expected driver/company are not part of the key because they are
 * server-supplied outputs of the attempt, not inputs to it.
 */
let inFlightLogin: Promise<SecureLoginResult> | null = null;
let inFlightKey: string | null = null;

/** Per-process salt so a fingerprint is meaningless outside this run. */
const ATTEMPT_SALT = `${Date.now()}:${Math.random()}`;

function attemptKey(displayName: string, passcode: string): string {
  const normalizedName = displayName.trim().toLowerCase();
  // Non-reversible within this process and discarded with it. Not a
  // password hash and never used as one — only an equality token.
  let h = 0;
  const material = `${ATTEMPT_SALT} ${normalizedName} ${passcode}`;
  for (let i = 0; i < material.length; i++) {
    h = (Math.imul(31, h) + material.charCodeAt(i)) | 0;
  }
  return `${normalizedName}#${h.toString(36)}`;
}

/**
 * Invalidate any in-flight login. Called on logout and identity
 * transitions so a login that is still in flight cannot land afterwards
 * and resurrect the identity that was just signed out.
 */
export function cancelInFlightLogin(): void {
  inFlightLogin = null;
  inFlightKey = null;
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
export function secureLogin(params: {
  displayName: string;
  passcode: string;
}): Promise<SecureLoginResult> {
  const key = attemptKey(params.displayName, params.passcode);
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
      await establishSdkSession(data.customToken, {
        driverId: data.driverId,
        companyId: data.companyId || undefined,
      });
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
