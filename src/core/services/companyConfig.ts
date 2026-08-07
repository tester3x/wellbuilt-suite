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

// Current JSA modes. Legacy `per_load` and `per_location` are still
// readable from existing Firestore docs (4/24/2026 rename) and map to
// `per_job` behaviorally — kept in the union so we don't reject doc
// reads, canonicalized via canonicalizeJsaMode below.
export type JsaMode = 'off' | 'per_shift' | 'per_job' | 'per_location' | 'per_load';

/** Map legacy modes to the current canonical set. */
export function canonicalizeJsaMode(mode: string | undefined): 'off' | 'per_shift' | 'per_job' {
  if (mode === 'per_load' || mode === 'per_location') return 'per_job';
  if (mode === 'per_shift' || mode === 'per_job') return mode;
  return 'off';
}

export interface CompanyConfig {
  tier: Tier;
  enabledApps: WBAppId[];
  name: string;
  requiredApps: string[]; // BYOA app IDs
  jsaMode?: JsaMode;
  logoUrl?: string;
  primaryColor?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  /**
   * vc51.9C: the raw wellbuiltContract root, passed through UNPARSED so
   * suiteShiftAuthority.parseSuiteEnforcement is the single interpreter.
   * Absent ⇒ legacy (established behavior). Tier remains presentation
   * only and never activates enforcement.
   */
  wellbuiltContract?: Record<string, unknown>;
}

/**
 * vc51.9C: decode the wellbuiltContract Firestore map into plain values.
 * Structure-preserving only — NO interpretation (parseSuiteEnforcement
 * is the single interpreter, and it fails closed on anything it does
 * not recognize).
 */
function decodeContractRoot(fields: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (v?.stringValue !== undefined) out[k] = v.stringValue;
    else if (v?.booleanValue !== undefined) out[k] = v.booleanValue;
    else if (v?.integerValue !== undefined) out[k] = Number(v.integerValue);
    else if (v?.doubleValue !== undefined) out[k] = v.doubleValue;
    else if (v?.mapValue?.fields) out[k] = decodeContractRoot(v.mapValue.fields);
    else if (v?.arrayValue) {
      out[k] = (v.arrayValue.values ?? []).map((e: any) =>
        e?.mapValue?.fields ? decodeContractRoot(e.mapValue.fields) : (e?.stringValue ?? e?.booleanValue ?? e?.integerValue));
    }
  }
  return out;
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

    const rawTier = parseStr(f.tier) || 'suite';
    // Map Dashboard tier names (free/field/god) to WB S tier names
    const TIER_ALIAS: Record<string, Tier> = { free: 'field-basics', field: 'full-field', god: 'suite' };
    const tier: Tier = (TIER_ALIAS[rawTier] || rawTier) as Tier;
    const explicitApps = parseStrArray(f.enabledApps) as WBAppId[];

    const jsaModeRaw = parseStr(f.jsaMode) || 'off';
    const config: CompanyConfig = {
      tier,
      enabledApps: explicitApps.length > 0 ? explicitApps : (TIER_APPS[tier] || TIER_APPS['suite']),
      name: parseStr(f.name),
      requiredApps: parseStrArray(f.requiredApps),
      jsaMode: (['off', 'per_shift', 'per_job', 'per_location', 'per_load'].includes(jsaModeRaw) ? jsaModeRaw : 'off') as JsaMode,
      logoUrl: parseStr(f.logoUrl) || undefined,
      primaryColor: parseStr(f.primaryColor) || undefined,
      phone: parseStr(f.phone) || undefined,
      address: parseStr(f.address) || undefined,
      city: parseStr(f.city) || undefined,
      state: parseStr(f.state) || undefined,
      zip: parseStr(f.zip) || undefined,
      // vc51.9C: preserve the contract root (Firestore mapValue → plain
      // object) so enforcement can be evaluated canonically. Only the
      // fields the boundary needs are decoded; interpretation lives in
      // suiteShiftAuthority, never here.
      ...(f.wellbuiltContract?.mapValue?.fields ? {
        wellbuiltContract: decodeContractRoot(f.wellbuiltContract.mapValue.fields),
      } : {}),
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

// ── Job Packages ─────────────────────────────────────────────

export interface ShiftPackageOption {
  id: string;
  name: string;
}

/**
 * Fetch the company's active job packages (id + name).
 * Uses Firestore REST API. Returns fallback if fetch fails.
 */
export async function fetchCompanyPackages(companyId: string): Promise<ShiftPackageOption[]> {
  if (!companyId) return [{ id: 'water-hauling', name: 'Water Hauling' }];

  try {
    // 1. Get company doc to find activePackages[]
    const companyUrl = `${FIRESTORE_BASE}/companies/${companyId}`;
    const companyRes = await fetchTimeout(companyUrl);
    if (!companyRes.ok) return [{ id: 'water-hauling', name: 'Water Hauling' }];
    const companyDoc = await companyRes.json();
    const packageIds = parseStrArray(companyDoc.fields?.activePackages) || ['water-hauling'];

    // 2. Fetch each package doc for its name
    const packages: ShiftPackageOption[] = [];
    for (const pkgId of packageIds) {
      try {
        const pkgUrl = `${FIRESTORE_BASE}/job_packages/${pkgId}`;
        const pkgRes = await fetchTimeout(pkgUrl);
        if (pkgRes.ok) {
          const pkgDoc = await pkgRes.json();
          packages.push({
            id: pkgId,
            name: parseStr(pkgDoc.fields?.name) || pkgId,
          });
        } else {
          packages.push({ id: pkgId, name: pkgId });
        }
      } catch {
        packages.push({ id: pkgId, name: pkgId });
      }
    }

    return packages.length > 0 ? packages : [{ id: 'water-hauling', name: 'Water Hauling' }];
  } catch (err) {
    console.warn('[companyConfig] Failed to fetch packages:', err);
    return [{ id: 'water-hauling', name: 'Water Hauling' }];
  }
}
