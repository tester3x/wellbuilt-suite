// src/core/services/companyApps.ts
// Layer 3 of BYOA triple hybrid: Company-required apps
//
// Fetches the company's requiredApps list from Firestore REST API.
// These are apps the company admin mandates all drivers must have.
// They show as auto-pinned and non-removable in the BYOA section.
//
// Data source: Firestore `companies/{companyId}` → `requiredApps: string[]`
// where each string is an app ID from the catalog (e.g., 'whatsapp').
//
// Caches in AsyncStorage per companyId (1 hour TTL).

import AsyncStorage from '@react-native-async-storage/async-storage';

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/wellbuilt-sync/databases/(default)/documents';
const CACHE_KEY_PREFIX = 'wellbuilt-company-apps-';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Timeout for Firestore requests */
const TIMEOUT_MS = 10000;

interface CachedCompanyApps {
  requiredApps: string[];
  fetchedAt: number;
}

/**
 * Fetch with timeout using AbortController.
 */
async function fetchWithTimeout(url: string, timeoutMs: number = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse Firestore REST document value into a JS array of strings.
 * Firestore REST returns values in typed wrappers like:
 *   { arrayValue: { values: [{ stringValue: "whatsapp" }, ...] } }
 */
function parseFirestoreStringArray(field: any): string[] {
  if (!field?.arrayValue?.values) return [];
  return field.arrayValue.values
    .filter((v: any) => v.stringValue)
    .map((v: any) => v.stringValue);
}

/**
 * Fetch company-required apps from Firestore.
 * Returns app IDs the company admin has mandated.
 * Falls back to cache if network fails, empty array if no cache.
 */
export async function fetchCompanyRequiredApps(companyId: string): Promise<string[]> {
  if (!companyId) return [];

  const cacheKey = `${CACHE_KEY_PREFIX}${companyId}`;

  // Check cache first
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const parsed: CachedCompanyApps = JSON.parse(cached);
      const age = Date.now() - parsed.fetchedAt;
      if (age < CACHE_TTL_MS) {
        return parsed.requiredApps;
      }
    }
  } catch {
    // Cache read failed — continue to network
  }

  // Fetch from Firestore REST
  try {
    const url = `${FIRESTORE_BASE}/companies/${companyId}`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      // Company doc doesn't exist or other error — return cached or empty
      return await getCachedOrEmpty(cacheKey);
    }

    const doc = await response.json();
    const requiredApps = parseFirestoreStringArray(doc.fields?.requiredApps);

    // Cache the result
    const cacheData: CachedCompanyApps = {
      requiredApps,
      fetchedAt: Date.now(),
    };
    await AsyncStorage.setItem(cacheKey, JSON.stringify(cacheData));

    return requiredApps;
  } catch (err) {
    console.warn('[companyApps] Failed to fetch company apps:', err);
    return await getCachedOrEmpty(cacheKey);
  }
}

/** Return cached value or empty array */
async function getCachedOrEmpty(cacheKey: string): Promise<string[]> {
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const parsed: CachedCompanyApps = JSON.parse(cached);
      return parsed.requiredApps;
    }
  } catch {
    // ignore
  }
  return [];
}

/**
 * Clear cached company apps (call on logout).
 */
export async function clearCompanyAppsCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const companyKeys = keys.filter(k => k.startsWith(CACHE_KEY_PREFIX));
    if (companyKeys.length > 0) {
      await AsyncStorage.multiRemove(companyKeys);
    }
  } catch {
    // ignore
  }
}
