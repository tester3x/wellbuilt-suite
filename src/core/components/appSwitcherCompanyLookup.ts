/**
 * AppSwitcher company lookup (Phase 1B).
 *
 * Reads public_companies/{id} first. Falls back to companies/{id} only when
 * the public document is missing — never on arbitrary read errors.
 * Consumes only the AppSwitcher field (`tier`). Never returns/caches a
 * full company document.
 */

export const PUBLIC_COMPANY_COLLECTION = 'public_companies';
export const LEGACY_COMPANY_COLLECTION = 'companies';

export type AppSwitcherCompanySnap = {
  exists: boolean;
  data?: unknown;
};

export type AppSwitcherCompanyReader = (
  collection: typeof PUBLIC_COMPANY_COLLECTION | typeof LEGACY_COMPANY_COLLECTION,
  companyId: string,
) => Promise<AppSwitcherCompanySnap>;

export type AppSwitcherCompanyLookup =
  | { source: 'public_companies'; tier: string | null }
  | { source: 'companies'; tier: string | null }
  | { source: 'none'; tier: null };

/** Existing AppSwitcher hierarchy: god includes field includes free. */
export const TIER_INCLUDES: Record<string, string[]> = {
  free: ['free'],
  field: ['free', 'field'],
  god: ['free', 'field', 'god'],
};

export function pickAppSwitcherTier(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const tier = (data as { tier?: unknown }).tier;
  if (typeof tier !== 'string' || tier.length === 0) return null;
  return tier;
}

/**
 * Existing UI: a present document with no/invalid tier becomes 'free'.
 * No document → null so the switcher keeps its default ('god').
 */
export function resolveAppSwitcherTier(result: AppSwitcherCompanyLookup): string | null {
  if (result.source === 'none') return null;
  return result.tier || 'free';
}

export function isAppAvailableForTier(requiredTier: string, companyTier: string): boolean {
  const allowed = TIER_INCLUDES[companyTier] || TIER_INCLUDES.god;
  return allowed.includes(requiredTier);
}

export function filterAppsForTier<T extends { enabled?: boolean; requiredTier: string; deepLinkScheme: string }>(
  apps: T[],
  companyTier: string,
  selfScheme: string,
): T[] {
  const allowed = TIER_INCLUDES[companyTier] || TIER_INCLUDES.god;
  return apps.filter(
    (app) =>
      app.enabled !== false &&
      app.deepLinkScheme !== selfScheme &&
      allowed.includes(app.requiredTier),
  );
}

/**
 * Load AppSwitcher company fields. If `read('public_companies')` throws,
 * the error propagates — callers must not catch-and-read `companies`.
 */
export async function loadAppSwitcherCompanyFields(
  companyId: string,
  read: AppSwitcherCompanyReader,
): Promise<AppSwitcherCompanyLookup> {
  const pub = await read(PUBLIC_COMPANY_COLLECTION, companyId);
  if (pub.exists) {
    return { source: 'public_companies', tier: pickAppSwitcherTier(pub.data) };
  }
  const legacy = await read(LEGACY_COMPANY_COLLECTION, companyId);
  if (legacy.exists) {
    return { source: 'companies', tier: pickAppSwitcherTier(legacy.data) };
  }
  return { source: 'none', tier: null };
}
