/**
 * AppSwitcher company lookup (Phase 1B).
 *
 * Reads public_companies/{id} first. Falls back to companies/{id} only when
 * the public document is missing — never on arbitrary read errors.
 * Consumes only the AppSwitcher field (`tier`). Never returns/caches a
 * full company document.
 *
 * Fail-closed: the UI tier is `free` until a known `field` or `god` value
 * is successfully resolved for the current lookup generation.
 */

export const PUBLIC_COMPANY_COLLECTION = 'public_companies';
export const LEGACY_COMPANY_COLLECTION = 'companies';
export const FAIL_CLOSED_TIER = 'free';
export const KNOWN_APP_SWITCHER_TIERS = ['free', 'field', 'god'] as const;
export type KnownAppSwitcherTier = (typeof KNOWN_APP_SWITCHER_TIERS)[number];

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

export function isKnownAppSwitcherTier(tier: string): tier is KnownAppSwitcherTier {
  return (KNOWN_APP_SWITCHER_TIERS as readonly string[]).includes(tier);
}

export function pickAppSwitcherTier(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const tier = (data as { tier?: unknown }).tier;
  if (typeof tier !== 'string' || tier.length === 0) return null;
  if (!isKnownAppSwitcherTier(tier)) return null;
  return tier;
}

/** Fail-closed: unknown/missing/none → free. Known field/god pass through. */
export function resolveAppSwitcherTier(result: AppSwitcherCompanyLookup): string {
  if (result.source === 'none') return FAIL_CLOSED_TIER;
  if (result.tier && isKnownAppSwitcherTier(result.tier)) return result.tier;
  return FAIL_CLOSED_TIER;
}

export function isAppAvailableForTier(requiredTier: string, companyTier: string): boolean {
  const allowed = TIER_INCLUDES[companyTier] || TIER_INCLUDES.free;
  return allowed.includes(requiredTier);
}

export function filterAppsForTier<T extends { enabled?: boolean; requiredTier: string; deepLinkScheme: string }>(
  apps: T[],
  companyTier: string,
  selfScheme: string,
): T[] {
  const allowed = TIER_INCLUDES[companyTier] || TIER_INCLUDES.free;
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

/** Generation gate so a slower previous lookup cannot restore its tier. */
export function createAppSwitcherTierSession() {
  let generation = 0;
  return {
    startLookup(): number {
      generation += 1;
      return generation;
    },
    isCurrent(gen: number): boolean {
      return gen === generation;
    },
    invalidate(): void {
      generation += 1;
    },
  };
}

/**
 * Fail-closed apply: always set `free` first, then optionally upgrade to a
 * known resolved tier if this generation is still current.
 */
export async function applyAppSwitcherTierLookup(opts: {
  companyId: string | null | undefined;
  generation: number;
  isCurrent: (generation: number) => boolean;
  read: AppSwitcherCompanyReader;
  setTier: (tier: string) => void;
}): Promise<void> {
  opts.setTier(FAIL_CLOSED_TIER);
  if (!opts.companyId) return;
  try {
    const result = await loadAppSwitcherCompanyFields(opts.companyId, opts.read);
    if (!opts.isCurrent(opts.generation)) return;
    opts.setTier(resolveAppSwitcherTier(result));
  } catch {
    if (!opts.isCurrent(opts.generation)) return;
    opts.setTier(FAIL_CLOSED_TIER);
  }
}
