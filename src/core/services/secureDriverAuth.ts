/**
 * Secure driver auth via Cloud Functions HTTPS callables (no open RTDB).
 * Uses REST callable protocol + Identity Toolkit custom-token exchange.
 * Dual-run: call this first; legacy REST remains until rule enforcement.
 */
import * as SecureStore from 'expo-secure-store';

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

async function exchangeCustomToken(customToken: string): Promise<void> {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const body = await resp.json();
  if (!resp.ok) {
    throw new Error(body?.error?.message || 'Custom token exchange failed');
  }
  if (body.idToken) await SecureStore.setItemAsync(ID_TOKEN_KEY, body.idToken);
  if (body.refreshToken) await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, body.refreshToken);
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

export async function secureLogin(params: {
  displayName: string;
  passcode: string;
}): Promise<{
  valid: boolean;
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
}> {
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
    if (data.customToken) {
      await exchangeCustomToken(data.customToken);
    } else if (data.idToken) {
      await SecureStore.setItemAsync(ID_TOKEN_KEY, data.idToken);
      if (data.refreshToken) {
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refreshToken);
      }
    }
    return {
      valid: true,
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
  await SecureStore.deleteItemAsync(ID_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

export async function getSecureIdToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ID_TOKEN_KEY);
}
