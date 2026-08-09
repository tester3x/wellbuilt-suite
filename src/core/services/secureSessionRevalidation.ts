/**
 * Secure cold-start session revalidation for WB-S (production wiring).
 *
 * Pure decision core lives in secureSessionRevalidationCore.ts.
 */
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirebaseApp } from './firebaseApp';
import {
  getOwnedIdToken,
  getOwnedUserId,
  getOwnedVerifiedIdentity,
  initializePersistentAuth,
  waitForAuthReady,
} from './firebaseAuthBoundary';
import type { DriverSession } from './driverAuth';
import {
  VERIFY_DRIVER_SESSION_CALLABLE,
  isSecureSessionShape,
  revalidateSecureSession,
  type SecureRevalidationOps,
} from './secureSessionRevalidationCore';

export * from './secureSessionRevalidationCore';

/** Versioned secure/legacy discriminator — not the misleading passcodeHash field. */
export const SESSION_AUTH_MODE_KEY = 'wbs_session_auth_mode_v1';
export type SessionAuthMode = 'secure' | 'legacy';

/** Set only after a successful online verifyDriverSession. */
export const SESSION_SECURE_VERIFIED_KEY = 'wbs_session_secure_verified_v1';

const CALLABLE_BASE = 'https://us-central1-wellbuilt-sync.cloudfunctions.net';

export async function markSessionAuthMode(mode: SessionAuthMode): Promise<void> {
  await SecureStore.setItemAsync(SESSION_AUTH_MODE_KEY, mode);
  if (mode !== 'secure') {
    await SecureStore.deleteItemAsync(SESSION_SECURE_VERIFIED_KEY);
  }
}

export async function markSecureSessionVerified(): Promise<void> {
  await SecureStore.setItemAsync(SESSION_SECURE_VERIFIED_KEY, '1');
}

export async function clearSecureSessionMarkers(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_AUTH_MODE_KEY);
  await SecureStore.deleteItemAsync(SESSION_SECURE_VERIFIED_KEY);
}

export async function readSessionAuthMode(): Promise<SessionAuthMode | null> {
  const raw = await SecureStore.getItemAsync(SESSION_AUTH_MODE_KEY);
  if (raw === 'secure' || raw === 'legacy') return raw;
  return null;
}

export async function wasSecureSessionVerified(): Promise<boolean> {
  return (await SecureStore.getItemAsync(SESSION_SECURE_VERIFIED_KEY)) === '1';
}

/**
 * Discriminate secure vs legacy without trusting passcodeHash alone.
 * Migration: unmarked + UUID alias shape → secure candidate (still needs SDK).
 */
export async function resolveSessionAuthMode(
  session: DriverSession,
): Promise<SessionAuthMode> {
  const stored = await readSessionAuthMode();
  if (stored) return stored;
  if (isSecureSessionShape(session)) return 'secure';
  return 'legacy';
}

/** Production transport: exact empty `data: {}`, Bearer ID token. */
export async function productionCallVerifyDriverSession(
  idToken: string,
): Promise<unknown> {
  const resp = await fetch(`${CALLABLE_BASE}/${VERIFY_DRIVER_SESSION_CALLABLE}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data: {} }),
  });
  const body = (await resp.json().catch(() => ({}))) as {
    error?: { message?: string; status?: string };
    result?: unknown;
  };
  if (!resp.ok || body.error) {
    const err = new Error(
      body?.error?.message || `verifyDriverSession failed (${resp.status})`,
    ) as Error & { code?: string; status?: number };
    err.code = String(body?.error?.status || body?.error?.message || '').toLowerCase();
    err.status = resp.status;
    throw err;
  }
  return body.result;
}

export function createProductionSecureRevalidationOps(
  hardFailCleanup: () => Promise<void>,
): SecureRevalidationOps {
  const app = getFirebaseApp();
  return {
    initializePersistentAuth: () => {
      initializePersistentAuth(app, AsyncStorage);
    },
    waitForAuthReady: () => waitForAuthReady(app),
    getSdkUid: () => getOwnedUserId(app),
    getVerifiedIdentity: (force) => getOwnedVerifiedIdentity(app, force),
    getIdToken: (force) => getOwnedIdToken(app, force),
    callVerifyDriverSession: productionCallVerifyDriverSession,
    wasPreviouslyVerified: wasSecureSessionVerified,
    markVerified: async () => {
      await markSessionAuthMode('secure');
      await markSecureSessionVerified();
    },
    hardFailCleanup,
  };
}

// Re-export revalidateSecureSession for callers that import from this module.
export { revalidateSecureSession };
