// src/core/services/driverProfile.ts
// Driver profile management — Firebase RTDB read/write.
// Path: drivers/approved/{hash}/profile/
//
// Same path as WB T — all apps share the same profile data.
// Profile follows the person (syncs to Firebase).
// Vehicle info follows the driver on personal devices (Firebase),
// or stays on the device for company-owned tablets (AsyncStorage only).
//
// TODO: Add company device detection via `devices/company/{deviceId}`
//       to determine vehicle save behavior (Firebase vs AsyncStorage-only).

import AsyncStorage from '@react-native-async-storage/async-storage';

const FIREBASE_DATABASE_URL = 'https://wellbuilt-sync-default-rtdb.firebaseio.com';
const FIREBASE_API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';
const TIMEOUT_MS = 10000;
const PROFILE_CACHE_KEY = 'wellbuilt-driver-profile';
const VEHICLE_CACHE_KEY = 'wellbuilt-vehicle-info';

// ── Interfaces ────────────────────────────────────────────────

export interface DriverProfile {
  displayName: string;
  phone?: string;
  cdl?: string;
  signature?: string; // base64 PNG
  language: 'en' | 'es';
  companyId?: string;
  companyName?: string;
}

export interface VehicleInfo {
  truckNumber: string;
  trailerNumber: string;
}

// ── Firebase helpers ──────────────────────────────────────────

function buildUrl(path: string): string {
  return `${FIREBASE_DATABASE_URL}/${path}.json?auth=${FIREBASE_API_KEY}`;
}

async function fbFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fbGet(path: string): Promise<any> {
  const res = await fbFetch(buildUrl(path), { method: 'GET' });
  if (!res.ok) return null;
  return res.json();
}

async function fbPatch(path: string, data: Record<string, any>): Promise<boolean> {
  const res = await fbFetch(buildUrl(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.ok;
}

// ── Driver Profile (Firebase-synced) ──────────────────────────

/**
 * Load driver profile from Firebase, with local cache fallback.
 * Reads from `drivers/approved/{hash}/profile/`.
 * Falls back to top-level fields for backward compatibility.
 */
export async function loadDriverProfile(hash: string): Promise<DriverProfile | null> {
  if (!hash) return null;

  // Return cache immediately, refresh in background
  try {
    const cached = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
    if (cached) {
      const profile = JSON.parse(cached) as DriverProfile;
      refreshProfileInBackground(hash);
      return profile;
    }
  } catch {}

  // No cache — blocking fetch
  return await refreshProfile(hash);
}

/** Background refresh — doesn't block UI */
function refreshProfileInBackground(hash: string): void {
  refreshProfile(hash).catch(() => {});
}

/** Fetch profile from Firebase and cache locally */
async function refreshProfile(hash: string): Promise<DriverProfile | null> {
  try {
    // Try the profile/ subpath first
    let data = await fbGet(`drivers/approved/${hash}/profile`);

    if (!data) {
      // Backward compat: read top-level driver record
      const topData = await fbGet(`drivers/approved/${hash}`);
      if (!topData) return null;

      const profile: DriverProfile = {
        displayName: topData.displayName || topData.name || '',
        language: 'en',
        companyId: topData.companyId,
        companyName: topData.companyName,
      };
      await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
      return profile;
    }

    const profile: DriverProfile = {
      displayName: data.displayName || '',
      phone: data.phone || undefined,
      cdl: data.cdl || undefined,
      signature: data.signature || undefined,
      language: data.language || 'en',
      companyId: data.companyId || undefined,
      companyName: data.companyName || undefined,
    };
    await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    return profile;
  } catch (err) {
    console.warn('[driverProfile] Failed to load profile:', err);
    return null;
  }
}

/**
 * Save partial profile updates to Firebase + local cache.
 */
export async function saveDriverProfile(
  hash: string,
  updates: Partial<DriverProfile>
): Promise<boolean> {
  try {
    const ok = await fbPatch(`drivers/approved/${hash}/profile`, updates);
    if (ok) {
      // Optimistic cache update
      try {
        const cached = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
        const current = cached ? JSON.parse(cached) : {};
        await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ ...current, ...updates }));
      } catch {}
    }
    return ok;
  } catch (err) {
    console.warn('[driverProfile] Failed to save profile:', err);
    return false;
  }
}

// ── Vehicle Info (smart save: Firebase + local) ───────────────

/**
 * Load vehicle info — checks local cache first, falls back to Firebase.
 */
export async function loadVehicleInfo(hash: string): Promise<VehicleInfo> {
  const empty: VehicleInfo = { truckNumber: '', trailerNumber: '' };

  // Local cache first (always present if saved from this device)
  try {
    const cached = await AsyncStorage.getItem(VEHICLE_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch {}

  // Fall back to Firebase profile (personal device scenario — follows driver)
  if (hash) {
    try {
      const data = await fbGet(`drivers/approved/${hash}/profile`);
      if (data?.truckNumber || data?.trailerNumber) {
        const info: VehicleInfo = {
          truckNumber: data.truckNumber || '',
          trailerNumber: data.trailerNumber || '',
        };
        await AsyncStorage.setItem(VEHICLE_CACHE_KEY, JSON.stringify(info));
        return info;
      }
    } catch {}
  }

  return empty;
}

/**
 * Save vehicle info — always local, plus Firebase for personal devices.
 * TODO: Skip Firebase write if device is registered as company-owned
 *       (check `devices/company/{deviceId}` in RTDB).
 */
export async function saveVehicleInfo(hash: string, info: VehicleInfo): Promise<void> {
  // Always save locally
  await AsyncStorage.setItem(VEHICLE_CACHE_KEY, JSON.stringify(info));

  // Also save to Firebase (follows driver on personal devices)
  if (hash) {
    try {
      await fbPatch(`drivers/approved/${hash}/profile`, {
        truckNumber: info.truckNumber,
        trailerNumber: info.trailerNumber,
      });
    } catch {
      // Offline — local cache has it
    }
  }
}

// ── Cache management ──────────────────────────────────────────

/**
 * Clear profile cache (call on logout).
 * Note: Vehicle info is NOT cleared — it stays on the device.
 */
export async function clearProfileCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {}
}
