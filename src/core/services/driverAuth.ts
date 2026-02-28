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
// 4. Registration: Post to drivers/pending/, admin approves to drivers/approved/
//
// Security:
// - Passcode is never sent in plaintext
// - Hash is computed client-side before transmission
// - Admin sets active=false or deletes from Firebase to revoke access
//
// Structure:
// - drivers/approved/{passcodeHash}/ = { displayName, active, approvedAt, isAdmin? }
// - drivers/pending/{key}/ = { displayName, passcodeHash, requestedAt }

import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";

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
  passcodeHash: string;
  isAdmin: boolean;
  isViewer: boolean;
  companyId?: string;
  companyName?: string;
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

const firebasePost = async (path: string, data: any): Promise<string> => {
  const url = buildFirebaseUrl(path);
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Firebase POST failed (${response.status})`);
  }

  const result = await response.json();
  return result.name; // Firebase returns {"name": "generated-key"}
};

const firebasePatch = async (path: string, data: any): Promise<void> => {
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
export const hashPasscode = async (passcode: string): Promise<string> => {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    passcode
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
  passcodeHash?: string;
  isAdmin?: boolean;
  isViewer?: boolean;
  companyId?: string;
  companyName?: string;
  error?: string;
}> => {
  console.log("[DriverAuth-Suite] Verifying login for:", displayName);

  try {
    const hash = await hashPasscode(passcode);
    console.log("[DriverAuth-Suite] Hash:", hash.slice(0, 8) + "...");

    // Look up by passcode hash
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

      return {
        valid: true,
        driverId: hash,
        displayName: driverData.displayName,
        passcodeHash: hash,
        isAdmin: driverData.isAdmin === true,
        isViewer: driverData.isViewer === true,
        companyId: driverData.companyId || undefined,
        companyName: driverData.companyName || undefined,
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

        return {
          valid: true,
          driverId: hash,
          displayName: entry.displayName,
          passcodeHash: hash,
          isAdmin: entry.isAdmin === true,
          isViewer: entry.isViewer === true,
          companyId: entry.companyId || undefined,
          companyName: entry.companyName || undefined,
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
  companyName?: string
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

  const [driverId, displayName, passcodeHash, isAdminStr, isViewerStr, companyId, companyName] =
    await Promise.all([
      readWithTimeout("driverId"),
      readWithTimeout("driverName"),
      readWithTimeout("passcodeHash"),
      readWithTimeout("isAdmin"),
      readWithTimeout("isViewer"),
      readWithTimeout("companyId"),
      readWithTimeout("companyName"),
    ]);

  if (driverId && displayName && passcodeHash) {
    return {
      driverId,
      displayName,
      passcodeHash,
      isAdmin: isAdminStr === "true",
      isViewer: isViewerStr === "true",
      companyId: companyId || undefined,
      companyName: companyName || undefined,
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
 * Revalidate driver session - verify driver is still approved
 */
export const revalidateDriverSession = async (): Promise<boolean> => {
  const session = await getDriverSession();
  if (!session) return false;

  try {
    const hash = session.passcodeHash;
    if (!hash) {
      console.log("[DriverAuth-Suite] No passcodeHash in session");
      return false;
    }

    console.log("[DriverAuth-Suite] Revalidating session for hash:", hash.slice(0, 8) + "...");
    const driverData = await firebaseGet(`${DRIVERS_APPROVED}/${hash}`);

    if (!driverData) {
      console.log("[DriverAuth-Suite] Driver not found, clearing session...");
      await clearDriverSession();
      return false;
    }

    // Check new structure (displayName at root)
    if (driverData.displayName) {
      if (driverData.active === false) {
        console.log("[DriverAuth-Suite] Driver deactivated, clearing session...");
        await clearDriverSession();
        return false;
      }
      return true;
    }

    // Check legacy structure (nested by deviceId)
    for (const key of Object.keys(driverData)) {
      const entry = driverData[key];
      if (entry.displayName?.toLowerCase() === session.displayName.toLowerCase()) {
        if (entry.active === false) {
          console.log("[DriverAuth-Suite] Driver deactivated (legacy), clearing session...");
          await clearDriverSession();
          return false;
        }
        return true;
      }
    }

    console.log("[DriverAuth-Suite] Driver name not found in approved list");
    await clearDriverSession();
    return false;
  } catch (error) {
    console.error("[DriverAuth-Suite] Error revalidating session:", error);
    // Don't clear session on network error - allow offline use
    return true;
  }
};

/**
 * Clear driver session (logout)
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
  await clearPendingRegistration();
};

// --- Registration ---

/**
 * Check if a passcode is available (not already in use)
 */
export const isPasscodeAvailable = async (
  passcode: string
): Promise<{ available: boolean; reason?: string }> => {
  try {
    const hash = await hashPasscode(passcode);

    // Check if passcode is already approved
    const existingDriver = await firebaseGet(`${DRIVERS_APPROVED}/${hash}`);
    if (existingDriver) {
      return { available: false, reason: "This passcode is already in use" };
    }

    // Check pending registrations
    const pendingDrivers = await firebaseGet(DRIVERS_PENDING);
    if (pendingDrivers) {
      for (const key of Object.keys(pendingDrivers)) {
        const pending = pendingDrivers[key];
        if (pending.passcodeHash === hash) {
          return { available: false, reason: "This passcode has a pending registration" };
        }
      }
    }

    return { available: true };
  } catch (error) {
    console.error("[DriverAuth-Suite] Error checking passcode availability:", error);
    return { available: false, reason: "Connection error" };
  }
};

/**
 * Submit a registration request
 * Creates entry in Firebase drivers/pending/
 */
export const submitRegistration = async (params: {
  passcode: string;
  displayName: string;
  companyName?: string;
}): Promise<{ success: boolean; error?: string }> => {
  console.log("[DriverAuth-Suite] Submitting registration for:", params.displayName, "company:", params.companyName);

  try {
    const hash = await hashPasscode(params.passcode);

    const registrationData: Record<string, string> = {
      displayName: params.displayName,
      passcodeHash: hash,
      requestedAt: new Date().toISOString(),
    };
    if (params.companyName) {
      registrationData.companyName = params.companyName;
    }

    await firebasePost(DRIVERS_PENDING, registrationData);

    // Save pending registration locally
    await SecureStore.setItemAsync("pendingPasscodeHash", hash);
    await SecureStore.setItemAsync("pendingDisplayName", params.displayName);
    await SecureStore.setItemAsync("pendingRegistrationTime", Date.now().toString());
    if (params.companyName) {
      await SecureStore.setItemAsync("pendingCompanyName", params.companyName);
    }

    console.log("[DriverAuth-Suite] Registration submitted successfully");
    return { success: true };
  } catch (error) {
    console.error("[DriverAuth-Suite] Error submitting registration:", error);
    return { success: false, error: "Connection error" };
  }
};

/**
 * Get pending registration info
 */
export const getPendingRegistration = async (): Promise<{
  passcodeHash: string;
  displayName: string;
  companyName?: string;
} | null> => {
  const passcodeHash = await SecureStore.getItemAsync("pendingPasscodeHash");
  const displayName = await SecureStore.getItemAsync("pendingDisplayName");
  const companyName = await SecureStore.getItemAsync("pendingCompanyName");

  if (passcodeHash && displayName) {
    return { passcodeHash, displayName, companyName: companyName || undefined };
  }
  return null;
};

/**
 * Check registration status
 */
export const checkRegistrationStatus = async (): Promise<
  "pending" | "approved" | "rejected" | "none"
> => {
  const pending = await getPendingRegistration();
  if (!pending) {
    return "none";
  }

  try {
    // Check if approved
    const driver = await firebaseGet(`${DRIVERS_APPROVED}/${pending.passcodeHash}`);
    if (driver) {
      return "approved";
    }

    // Check if still in pending
    const pendingDrivers = await firebaseGet(DRIVERS_PENDING);
    if (pendingDrivers) {
      for (const key of Object.keys(pendingDrivers)) {
        const registration = pendingDrivers[key];
        if (registration.passcodeHash === pending.passcodeHash) {
          return "pending";
        }
      }
    }

    // Not in approved, not in pending = rejected
    return "rejected";
  } catch (error) {
    console.error("[DriverAuth-Suite] Error checking registration status:", error);
    return "pending";
  }
};

/**
 * Complete registration after approval
 */
export const completeRegistration = async (): Promise<{
  success: boolean;
  driverId?: string;
  displayName?: string;
  error?: string;
}> => {
  const pending = await getPendingRegistration();
  if (!pending) {
    return { success: false, error: "No pending registration" };
  }

  try {
    const driverData = await firebaseGet(`${DRIVERS_APPROVED}/${pending.passcodeHash}`);

    if (!driverData) {
      return { success: false, error: "Driver not found in approved list" };
    }

    const displayName = driverData.displayName || pending.displayName;
    const isAdmin = driverData.isAdmin === true;
    const isViewer = driverData.isViewer === true;
    const companyId = driverData.companyId || undefined;
    const companyName = driverData.companyName || undefined;

    await saveDriverSession(pending.passcodeHash, displayName, pending.passcodeHash, isAdmin, isViewer, companyId, companyName);
    return {
      success: true,
      driverId: pending.passcodeHash,
      displayName,
    };
  } catch (error) {
    console.error("[DriverAuth-Suite] Error completing registration:", error);
    return { success: false, error: "Connection error" };
  }
};

/**
 * Clear pending registration
 */
export const clearPendingRegistration = async (): Promise<void> => {
  await SecureStore.deleteItemAsync("pendingPasscodeHash");
  await SecureStore.deleteItemAsync("pendingDisplayName");
  await SecureStore.deleteItemAsync("pendingRegistrationTime");
  await SecureStore.deleteItemAsync("pendingCompanyName");
};
