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

/**
 * Establish the SDK-owned session from the server-minted custom token.
 *
 * Replaces a raw Identity Toolkit POST that stored idToken/refreshToken in
 * SecureStore and never refreshed them — Firebase ID tokens live one hour,
 * so that 'verified identity' went stale and stayed stale. The SDK now owns
 * persistence and refresh, so getCurrentIdToken() is always current.
 *
 * The custom token is consumed exactly once and never persisted or logged.
 */
async function establishSdkSession(
  customToken: string,
  expected: { driverId?: string; companyId?: string },
): Promise<void> {
  const app = getFirebaseApp();
  initializePersistentAuth(app, AsyncStorage);
  await signInWithCustomTokenOwned(app, customToken);
  await waitForAuthReady(app);

  // Step 6 of the login contract: the session is only 'verified' once the
  // server-minted claims match the driver we believe we authenticated. A
  // token that signs in but carries another identity must fail closed
  // rather than be reported as a successful verified login.
  const identity = await getOwnedVerifiedIdentity(app);
  if (!identity) throw new Error('Auth session did not establish');
  if (identity.kind !== 'driver') throw new Error('Auth session is not a driver session');
  if (expected.driverId && identity.driverId !== expected.driverId) {
    throw new Error('Authenticated identity does not match the signed-in driver');
  }
  if (expected.companyId && identity.companyId !== expected.companyId) {
    throw new Error('Authenticated identity does not match the driver company');
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
 * Single-flight guard for the login exchange.
 *
 * Duplicate taps must not race two authenticateDriver calls and two
 * signInWithCustomToken exchanges against one Auth instance — the second
 * would overwrite the first's session mid-establishment. Concurrent
 * callers share the in-flight promise; the slot clears when it settles so
 * a genuine retry after failure still works.
 */
let inFlightLogin: Promise<SecureLoginResult> | null = null;

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
  if (inFlightLogin) return inFlightLogin;
  inFlightLogin = runSecureLogin(params).finally(() => {
    inFlightLogin = null;
  });
  return inFlightLogin;
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
