// src/core/services/driverAuth.ts
// Driver authentication using Firebase and SHA-256 hashed passcodes
//
// Copied from WB M (WellBuilt Mobile) driverAuth.ts — same Firebase paths,
// same auth flow, same SecureStore keys. Both apps share the `wellbuilt-sync`
// Firebase project so a driver approved in WB M is automatically approved here.
//
// How it works:
// 1. Driver enters name + passcode
// 2. App SHA-256 hashes the passcode client-side
// 3. Login: Find driver by passcode hash, verify name matches
// 4. Registration: requestDriverRegistration only. Never POST drivers/pending.
//
// Security:
// - Passcode is never sent in plaintext
// - Hash is computed client-side before transmission
// - Admin sets active=false or deletes from Firebase to revoke access
//
// Structure:
// - drivers/approved/{passcodeHash}/ = { displayName, active, approvedAt, isAdmin? }
// - pending_credentials/{pendingId} + drivers/pending_secure/{pendingId} (server)

import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { recordShiftEvent } from "./shiftTracking";

// Firebase configuration (same project as WB M: wellbuilt-sync)
const FIREBASE_DATABASE_URL = "https://wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

// Firebase paths
const DRIVERS_PENDING = "drivers/pending";
const DRIVERS_APPROVED = "drivers/approved";

// --- Interfaces ---

export interface DriverInfo {
  driverId: string;
  displayName: string;
  passcodeHash: string;
  approvedAt: string;
  active: boolean;
}

export interface DriverSession {
  driverId: string;
  displayName: string;
  legalName?: string;
  passcodeHash: string;
  isAdmin: boolean;
  isViewer: boolean;
  companyId?: string;
  companyName?: string;
  assignedRoutes?: string[];
  defaultPackageId?: string;
}

// --- Firebase helpers ---

/** Network timeout for all Firebase requests (ms) */
const FIREBASE_TIMEOUT_MS = 10000;

const buildFirebaseUrl = (path: string): string => {
  let url = `${FIREBASE_DATABASE_URL}/${path}.json`;
  if (FIREBASE_API_KEY) {
    url += `?auth=${FIREBASE_API_KEY}`;
  }
  return url;
};

/**
 * Fetch with AbortController timeout.
 * Prevents the app from hanging indefinitely on bad/slow connections.
 */
const fetchWithTimeout = async (
  url: string,
  options: RequestInit,
  timeoutMs: number = FIREBASE_TIMEOUT_MS
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw new Error(`Firebase request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const firebaseGet = async (path: string): Promise<any> => {
  const url = buildFirebaseUrl(path);
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Firebase GET failed (${response.status})`);
  }

  return response.json();
};

export const firebasePatch = async (path: string, data: any): Promise<void> => {
  const url = buildFirebaseUrl(path);
  const response = await fetchWithTimeout(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Firebase PATCH failed (${response.status})`);
  }
};

// --- Crypto helpers ---

/**
 * Hash a passcode using SHA-256
 * Returns lowercase hex string
 */
export const hashPasscode = async (passcode: string, name?: string): Promise<string> => {
  const input = name ? name.toLowerCase().trim() + passcode : passcode;
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input
  );
  return hash.toLowerCase();
};

// --- Authentication ---

/**
 * Verify login with name + passcode
 * Looks up driver by passcode hash, then verifies name matches
 *
 * Structure: drivers/approved/{passcodeHash}/ = { displayName, active, isAdmin? }
 * Also supports legacy structure: drivers/approved/{passcodeHash}/{deviceId}/
 */
export const verifyLogin = async (
  displayName: string,
  passcode: string
): Promise<{
  valid: boolean;
  driverId?: string;
  displayName?: string;
  legalName?: string;
  passcodeHash?: string;
  isAdmin?: boolean;
  isViewer?: boolean;
  companyId?: string;
  companyName?: string;
  assignedRoutes?: string[];
  defaultPackageId?: string;
  error?: string;
  /**
   * True only when the secure path established a verified SDK Auth session
   * whose server-minted claims matched this driver.
   *
   * `valid` alone means the credentials checked out — it does NOT mean a
   * verified cloud session exists, because the legacy hash fallback below
   * can validate a driver without one. Protected online operations must
   * gate on `authVerified`, never on `valid`.
   */
  authVerified?: boolean;
}> => {
  console.log("[DriverAuth-Suite] Verifying login for:", displayName);

  // Prefer server-enforced auth (scrypt + custom token). Falls through to
  // legacy hash lookup only during dual-run while open rules still exist.
  try {
    const { secureLogin } = await import('./secureDriverAuth');
    const secure = await secureLogin({ displayName, passcode });
    if (secure.valid) {
      console.log("[DriverAuth-Suite] Secure login OK for:", secure.displayName);
      return secure;
    }
    // If server says passcode reset required or invalid, do not fall back to
    // exposed legacy hashes when the error is explicit.
    // SECURITY GATE: when the secure attempt could not confirm that
    // unwanted Auth state was removed, a mismatched or partially verified
    // SDK user may still be current. Falling back to a 'successful' local
    // login here would be exactly the hole this closes — refuse instead.
    if (secure.authStateUnresolved) {
      return { valid: false, error: secure.error || 'Sign-in state could not be verified' };
    }
    if (secure.error && /reset required|Too many login/i.test(secure.error)) {
      return { valid: false, error: secure.error };
    }
    console.log("[DriverAuth-Suite] Secure login miss, trying legacy:", secure.error);
  } catch (e) {
    console.warn("[DriverAuth-Suite] Secure login unavailable, legacy fallback", e);
  }

  try {
    const hash = await hashPasscode(passcode, displayName);
    // The passcode hash is the legacy BEARER credential. Even a truncated
    // prefix is an offline oracle: the display name is logged alongside it,
    // the hash function ships in the bundle, and passcodes are short — so
    // anyone with logcat access can confirm a guessed passcode without ever
    // touching the network. Path/status only, never credential bytes.
    console.log("[DriverAuth-Suite] Legacy hash lookup");

    // Look up by name+passcode hash
    const driverData = await firebaseGet(`${DRIVERS_APPROVED}/${hash}`);

    if (!driverData) {
      console.log("[DriverAuth-Suite] No driver found with this passcode");
      return { valid: false, error: "Invalid name or passcode" };
    }

    // Check if this is the new flat structure (has displayName directly)
    if (driverData.displayName) {
      if (driverData.active === false) {
        return { valid: false, error: "This account has been deactivated" };
      }

      if (driverData.displayName.toLowerCase() !== displayName.toLowerCase()) {
        console.log("[DriverAuth-Suite] Name mismatch");
        return { valid: false, error: "Invalid name or passcode" };
      }

      console.log("[DriverAuth-Suite] Login verified for:", driverData.displayName);

      // Clear any stale logoutAt signal from previous session
      firebasePatch(`${DRIVERS_APPROVED}/${hash}`, { logoutAt: null }).catch(() => {});

      return {
        valid: true,
        driverId: hash,
        displayName: driverData.displayName,
        legalName: driverData.legalName || undefined,
        passcodeHash: hash,
        isAdmin: driverData.isAdmin === true,
        isViewer: driverData.isViewer === true,
        companyId: driverData.companyId || undefined,
        companyName: driverData.companyName || undefined,
        assignedRoutes: Array.isArray(driverData.assignedRoutes) ? driverData.assignedRoutes : undefined,
        defaultPackageId: driverData.defaultPackageId || undefined,
      };
    }

    // Legacy structure: drivers/approved/{hash}/{deviceId}/ = { displayName, ... }
    for (const key of Object.keys(driverData)) {
      const entry = driverData[key];
      if (
        entry.displayName?.toLowerCase() === displayName.toLowerCase() &&
        entry.active !== false
      ) {
        console.log("[DriverAuth-Suite] Login verified (legacy) for:", entry.displayName);

        // Clear any stale logoutAt signal from previous session
        firebasePatch(`${DRIVERS_APPROVED}/${hash}`, { logoutAt: null }).catch(() => {});

        return {
          valid: true,
          driverId: hash,
          displayName: entry.displayName,
          legalName: entry.legalName || undefined,
          passcodeHash: hash,
          isAdmin: entry.isAdmin === true,
          isViewer: entry.isViewer === true,
          companyId: entry.companyId || undefined,
          companyName: entry.companyName || undefined,
          assignedRoutes: Array.isArray(entry.assignedRoutes) ? entry.assignedRoutes : undefined,
        };
      }
    }

    console.log("[DriverAuth-Suite] Name mismatch in legacy structure");
    return { valid: false, error: "Invalid name or passcode" };
  } catch (error) {
    console.error("[DriverAuth-Suite] Error verifying login:", error);
    return { valid: false, error: "Connection error" };
  }
};

// --- Session Management ---

/**
 * Save driver session after successful passcode verification
 */
export const saveDriverSession = async (
  driverId: string,
  displayName: string,
  passcodeHash: string,
  isAdmin: boolean = false,
  isViewer: boolean = false,
  companyId?: string,
  companyName?: string,
  legalName?: string,
  assignedRoutes?: string[],
  defaultPackageId?: string
): Promise<void> => {
  await SecureStore.setItemAsync("driverId", driverId);
  await SecureStore.setItemAsync("driverName", displayName);
  await SecureStore.setItemAsync("passcodeHash", passcodeHash);
  await SecureStore.setItemAsync("isAdmin", isAdmin ? "true" : "false");
  await SecureStore.setItemAsync("isViewer", isViewer ? "true" : "false");
  await SecureStore.setItemAsync("driverVerifiedAt", Date.now().toString());
  if (companyId) {
    await SecureStore.setItemAsync("companyId", companyId);
  } else {
    await SecureStore.deleteItemAsync("companyId");
  }
  if (companyName) {
    await SecureStore.setItemAsync("companyName", companyName);
  } else {
    await SecureStore.deleteItemAsync("companyName");
  }
  if (legalName) {
    await SecureStore.setItemAsync("legalName", legalName);
  } else {
    await SecureStore.deleteItemAsync("legalName");
  }
  if (assignedRoutes && assignedRoutes.length > 0) {
    await SecureStore.setItemAsync("assignedRoutes", JSON.stringify(assignedRoutes));
  } else {
    await SecureStore.deleteItemAsync("assignedRoutes");
  }
  if (defaultPackageId) {
    await SecureStore.setItemAsync("defaultPackageId", defaultPackageId);
  } else {
    await SecureStore.deleteItemAsync("defaultPackageId");
  }

  // Clear any pending registration data
  await clearPendingRegistration();
};

/**
 * Get current driver session
 */
export const getDriverSession = async (): Promise<DriverSession | null> => {
  // Parallelize all SecureStore reads with a 5-second timeout
  // Prevents splash screen hang when SecureStore is slow on cold boot
  const timeoutMs = 5000;
  const readWithTimeout = (key: string): Promise<string | null> =>
    Promise.race([
      SecureStore.getItemAsync(key),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);

  const [driverId, displayName, passcodeHash, isAdminStr, isViewerStr, companyId, companyName, legalName, assignedRoutesStr, defaultPackageId] =
    await Promise.all([
      readWithTimeout("driverId"),
      readWithTimeout("driverName"),
      readWithTimeout("passcodeHash"),
      readWithTimeout("isAdmin"),
      readWithTimeout("isViewer"),
      readWithTimeout("companyId"),
      readWithTimeout("companyName"),
      readWithTimeout("legalName"),
      readWithTimeout("assignedRoutes"),
      readWithTimeout("defaultPackageId"),
    ]);

  if (driverId && displayName && passcodeHash) {
    let assignedRoutes: string[] | undefined;
    try {
      assignedRoutes = assignedRoutesStr ? JSON.parse(assignedRoutesStr) : undefined;
    } catch { assignedRoutes = undefined; }

    return {
      driverId,
      displayName,
      legalName: legalName || undefined,
      passcodeHash,
      isAdmin: isAdminStr === "true",
      isViewer: isViewerStr === "true",
      companyId: companyId || undefined,
      companyName: companyName || undefined,
      assignedRoutes,
      defaultPackageId: defaultPackageId || undefined,
    };
  }
  return null;
};

/**
 * Check if driver is verified (has a valid session)
 */
export const isDriverVerified = async (): Promise<boolean> => {
  const session = await getDriverSession();
  return session !== null;
};

/**
 * Hard-fail cleanup for revalidation: secure sign-out + local identity clear.
 * Does NOT close the backend shift, write logout events, or run Post-Trip.
 */
async function hardFailRevalidationCleanup(): Promise<void> {
  try {
    const secure = await import('./secureDriverAuth');
    secure.invalidateAuthEpoch();
    await secure.secureSignOut().catch(() => {});
  } catch {
    /* boundary may be unavailable offline */
  }
  await clearDriverSession();
}

/**
 * Revalidate driver session on cold start / resume.
 *
 * Secure sessions: SDK claims + verifyDriverSession({}) — never RTDB approved-list.
 * Legacy sessions: bounded dual-run RTDB drivers/approved/{passcodeHash}.
 * UUID compatibility aliases never enter the legacy path.
 */
export const revalidateDriverSession = async (): Promise<boolean> => {
  const session = await getDriverSession();
  if (!session) return false;

  const {
    resolveSessionAuthMode,
    revalidateSecureSession,
    createProductionSecureRevalidationOps,
    isSecureSessionShape,
  } = await import('./secureSessionRevalidation');

  const mode = await resolveSessionAuthMode(session);

  // Secure path — never touch drivers/approved/{hash}
  if (mode === 'secure' || isSecureSessionShape(session)) {
    console.log('[DriverAuth-Suite] Revalidating secure session');
    const ops = createProductionSecureRevalidationOps(hardFailRevalidationCleanup);
    const result = await revalidateSecureSession(session, ops);
    if (result.outcome === 'verified') {
      console.log('[DriverAuth-Suite] Secure session revalidated');
      return true;
    }
    if (result.outcome === 'soft_offline') {
      console.log('[DriverAuth-Suite] Secure revalidation offline — keeping verified session');
      return true;
    }
    console.log('[DriverAuth-Suite] Secure revalidation failed — signed out');
    return false;
  }

  // ── Legacy dual-run only ───────────────────────────────────────────────
  try {
    const hash = session.passcodeHash;
    if (!hash) {
      console.log('[DriverAuth-Suite] No passcodeHash in legacy session');
      await hardFailRevalidationCleanup();
      return false;
    }
    // Never treat UUID alias as a legacy RTDB key
    if (isSecureSessionShape(session)) {
      console.log('[DriverAuth-Suite] Refusing legacy path for secure session shape');
      await hardFailRevalidationCleanup();
      return false;
    }

    console.log('[DriverAuth-Suite] Revalidating legacy session');
    const driverData = await firebaseGet(`${DRIVERS_APPROVED}/${hash}`);

    if (!driverData) {
      console.log('[DriverAuth-Suite] Legacy driver not found, clearing session...');
      await hardFailRevalidationCleanup();
      return false;
    }

    if (driverData.displayName) {
      if (driverData.active === false) {
        console.log('[DriverAuth-Suite] Legacy driver deactivated, clearing session...');
        await hardFailRevalidationCleanup();
        return false;
      }
      return true;
    }

    for (const key of Object.keys(driverData)) {
      const entry = driverData[key];
      if (entry.displayName?.toLowerCase() === session.displayName.toLowerCase()) {
        if (entry.active === false) {
          console.log('[DriverAuth-Suite] Legacy driver deactivated, clearing session...');
          await hardFailRevalidationCleanup();
          return false;
        }
        return true;
      }
    }

    console.log('[DriverAuth-Suite] Legacy name not found in approved list');
    await hardFailRevalidationCleanup();
    return false;
  } catch (error) {
    // Transport only — keep offline legacy session (unchanged dual-run policy)
    console.log('[DriverAuth-Suite] Legacy revalidation network error — keeping session');
    return true;
  }
};

/**
 * Clear driver session (logout / hard revalidation fail).
 * Does not touch shiftStarted / currentShiftId / backend shift.
 */
export const clearDriverSession = async (): Promise<void> => {
  await SecureStore.deleteItemAsync("driverId");
  await SecureStore.deleteItemAsync("driverName");
  await SecureStore.deleteItemAsync("passcodeHash");
  await SecureStore.deleteItemAsync("isAdmin");
  await SecureStore.deleteItemAsync("isViewer");
  await SecureStore.deleteItemAsync("driverVerifiedAt");
  await SecureStore.deleteItemAsync("companyId");
  await SecureStore.deleteItemAsync("companyName");
  await SecureStore.deleteItemAsync("legalName");
  await SecureStore.deleteItemAsync("assignedRoutes");
  await SecureStore.deleteItemAsync("defaultPackageId");
  try {
    const { clearSecureSessionMarkers } = await import('./secureSessionRevalidation');
    await clearSecureSessionMarkers();
  } catch {
    /* ignore */
  }
  await clearPendingRegistration();
};

// --- Registration ---

/**
 * Check if a passcode is available (not already in use)
 */
export const isPasscodeAvailable = async (
  passcode: string,
  name?: string
): Promise<{ available: boolean; reason?: string }> => {
  try {
    const hash = await hashPasscode(passcode, name);

    // Check if name+passcode combo already approved
    const existingDriver = await firebaseGet(`${DRIVERS_APPROVED}/${hash}`);
    if (existingDriver) {
      return { available: false, reason: "This name and passcode combination is already registered" };
    }

    // Check pending registrations
    const pendingDrivers = await firebaseGet(DRIVERS_PENDING);
    if (pendingDrivers) {
      for (const key of Object.keys(pendingDrivers)) {
        const pending = pendingDrivers[key];
        if (pending.passcodeHash === hash) {
          return { available: false, reason: "A registration with this name and passcode is already pending" };
        }
      }
    }

    return { available: true };
  } catch (error) {
    console.error("[DriverAuth-Suite] Error checking passcode availability:", error);
    return { available: false, reason: "Connection error" };
  }
};

/** Server contract: passcode 6–128. Suite UI also caps at 12. */
export const SUITE_PASSCODE_MIN_LEN = 6;

/**
 * Submit a pending registration through requestDriverRegistration only.
 * Never POSTs drivers/pending. Never stores a passcode hash.
 */
export const submitRegistration = async (params: {
  passcode: string;
  displayName: string;
  companyName?: string;
  legalName?: string;
}): Promise<{ success: boolean; pending?: boolean; pendingId?: string; error?: string }> => {
  if (params.passcode.length < SUITE_PASSCODE_MIN_LEN || params.passcode.length > 128) {
    return { success: false, error: 'Passcode must be 6–128 characters' };
  }

  try {
    const { secureSubmitRegistration } = await import('./secureDriverAuth');
    const secure = await secureSubmitRegistration({
      displayName: params.displayName,
      passcode: params.passcode,
      companyName: params.companyName,
      legalName: params.legalName,
      source: 'wbs',
    });
    if (!secure.success || !secure.pendingId) {
      return {
        success: false,
        error: secure.error || 'Registration did not return a pending request',
      };
    }
    await SecureStore.setItemAsync('pendingSecureId', secure.pendingId);
    await SecureStore.setItemAsync('pendingDisplayName', params.displayName);
    await SecureStore.setItemAsync('pendingRegistrationTime', Date.now().toString());
    if (params.companyName) {
      await SecureStore.setItemAsync('pendingCompanyName', params.companyName);
    }
    return { success: true, pending: true, pendingId: secure.pendingId };
  } catch (error: unknown) {
    const msg = typeof (error as { message?: unknown })?.message === 'string'
      ? String((error as { message: string }).message)
      : 'Connection error';
    return { success: false, error: msg };
  }
};

/**
 * Get pending registration info (pendingId lifecycle only).
 */
export const getPendingRegistration = async (): Promise<{
  passcodeHash: string;
  displayName: string;
  companyName?: string;
} | null> => {
  const displayName = await SecureStore.getItemAsync('pendingDisplayName');
  const companyName = await SecureStore.getItemAsync('pendingCompanyName');
  const secureId = await SecureStore.getItemAsync('pendingSecureId');

  if (secureId && displayName) {
    return { passcodeHash: '', displayName, companyName: companyName || undefined };
  }
  return null;
};

/**
 * Check registration status by server-issued pendingId only.
 */
export const checkRegistrationStatus = async (): Promise<
  "pending" | "approved" | "rejected" | "none"
> => {
  const { secureCheckRegistrationStatus } = await import('./secureDriverAuth');
  return secureCheckRegistrationStatus();
};

/**
 * Approval never mints a local hash session. The driver must sign in normally.
 */
export const completeRegistration = async (): Promise<{
  success: boolean;
  driverId?: string;
  displayName?: string;
  error?: string;
}> => {
  return {
    success: false,
    error: 'Registration approved. Please sign in.',
  };
};

/**
 * Clear pending registration
 */
export const clearPendingRegistration = async (): Promise<void> => {
  await SecureStore.deleteItemAsync("pendingPasscodeHash");
  await SecureStore.deleteItemAsync("pendingDisplayName");
  await SecureStore.deleteItemAsync("pendingRegistrationTime");
  await SecureStore.deleteItemAsync("pendingCompanyName");
  await SecureStore.deleteItemAsync("pendingSecureId");
};
