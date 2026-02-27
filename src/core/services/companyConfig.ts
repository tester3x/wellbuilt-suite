// src/core/services/companyConfig.ts
// Company configuration: tier, enabled apps, branding, required apps.
// Reads from Firestore REST API: `companies/{companyId}`
// Cached in AsyncStorage (1hr TTL).
//
// Tier system:
//   field-basics  → single app (WB T or WB M)
//   full-field    → WB T + WB M + Dashboard
//   suite         → Everything + WB S hub + future Billing/Payroll/Dispatch

import AsyncStorage from '@react-native-async-storage/async-storage';

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/wellbuilt-sync/databases/(default)/documents';
const CACHE_KEY_PREFIX = 'wellbuilt-company-config-';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const TIMEOUT_MS = 10000;

// ── Tier definitions ──────────────────────────────────────────

export type Tier = 'field-basics' | 'full-field' | 'suite';

export type WBAppId = 'wbs' | 'wbt' | 'wbm' | 'dashboard';

/** What each tier unlocks */
export const TIER_APPS: Record<Tier, WBAppId[]> = {
  'field-basics': ['wbt'],
  'full-field': ['wbt', 'wbm', 'dashboard'],
  'suite': ['wbs', 'wbt', 'wbm', 'dashboard'],
};

export const TIER_LABELS: Record<Tier, string> = {
  'field-basics': 'Field Basics',
  'full-field': 'Full Field',
  'suite': 'Suite',
};

export const TIER_DESCRIPTIONS: Record<Tier, string> = {
  'field-basics': 'Single app — water tickets or tank pulls',
  'full-field': 'Tickets + Pulls + Dashboard',
  'suite': 'Hub + Tickets + Pulls + Dashboard + Billing & Payroll',
};

export const TIER_ORDER: Tier[] = ['field-basics', 'full-field', 'suite'];

// ── Company config interface ──────────────────────────────────

export interface CompanyConfig {
  tier: Tier;
  enabledApps: WBAppId[];
  name: string;
  requiredApps: string[]; // BYOA app IDs
  logoUrl?: string;
  primaryColor?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

// ── Fetch helpers ─────────────────────────────────────────────

interface CachedConfig {
  config: CompanyConfig;
  fetchedAt: number;
}

async function fetchTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseStr(field: any): string {
  return field?.stringValue || '';
}

function parseStrArray(field: any): string[] {
  if (!field?.arrayValue?.values) return [];
  return field.arrayValue.values
    .filter((v: any) => v.stringValue)
    .map((v: any) => v.stringValue);
}

// ── Public API ────────────────────────────────────────────────

/**
 * Fetch full company config from Firestore.
 * Returns null if companyId is empty or doc doesn't exist.
 */
export async function fetchCompanyConfig(companyId: string): Promise<CompanyConfig | null> {
  if (!companyId) return null;

  const cacheKey = `${CACHE_KEY_PREFIX}${companyId}`;

  // Check cache
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const parsed: CachedConfig = JSON.parse(cached);
      if (Date.now() - parsed.fetchedAt < CACHE_TTL_MS) {
        return parsed.config;
      }
    }
  } catch {}

  // Fetch from Firestore REST
  try {
    const url = `${FIRESTORE_BASE}/companies/${companyId}`;
    const res = await fetchTimeout(url);
    if (!res.ok) return getCachedConfig(cacheKey);

    const doc = await res.json();
    const f = doc.fields || {};

    const tier = (parseStr(f.tier) || 'suite') as Tier; // Default to suite for existing companies
    const explicitApps = parseStrArray(f.enabledApps) as WBAppId[];

    const config: CompanyConfig = {
      tier,
      enabledApps: explicitApps.length > 0 ? explicitApps : TIER_APPS[tier],
      name: parseStr(f.name),
      requiredApps: parseStrArray(f.requiredApps),
      logoUrl: parseStr(f.logoUrl) || undefined,
      primaryColor: parseStr(f.primaryColor) || undefined,
      phone: parseStr(f.phone) || undefined,
      address: parseStr(f.address) || undefined,
      city: parseStr(f.city) || undefined,
      state: parseStr(f.state) || undefined,
      zip: parseStr(f.zip) || undefined,
    };

    await AsyncStorage.setItem(cacheKey, JSON.stringify({ config, fetchedAt: Date.now() } as CachedConfig));
    return config;
  } catch (err) {
    console.warn('[companyConfig] Failed to fetch:', err);
    return getCachedConfig(cacheKey);
  }
}

async function getCachedConfig(cacheKey: string): Promise<CompanyConfig | null> {
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) return (JSON.parse(cached) as CachedConfig).config;
  } catch {}
  return null;
}

/**
 * Check if a specific WB app is enabled for this company.
 * No config = allow everything (WB admin or no company set).
 */
export function isAppEnabled(config: CompanyConfig | null, appId: WBAppId): boolean {
  if (!config) return true;
  return config.enabledApps.includes(appId);
}

/**
 * Clear cached company config (call on logout).
 */
export async function clearCompanyConfigCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const configKeys = keys.filter(k => k.startsWith(CACHE_KEY_PREFIX));
    if (configKeys.length > 0) await AsyncStorage.multiRemove(configKeys);
  } catch {}
}
