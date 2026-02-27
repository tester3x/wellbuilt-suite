// src/core/hooks/useCompanyConfig.ts
// Hook that fetches and caches company tier config for the logged-in user.
// Provides isWBAppEnabled() to gate WB app access by tier.

import { useState, useEffect, useCallback } from 'react';
import {
  fetchCompanyConfig,
  isAppEnabled,
  clearCompanyConfigCache,
  type CompanyConfig,
  type WBAppId,
  TIER_LABELS,
} from '../services/companyConfig';

/** Map WellBuilt app IDs (from apps.ts) → tier WBAppId */
const WB_APP_ID_MAP: Record<string, WBAppId | undefined> = {
  'wellbuilt-mobile': 'wbm',
  'wellbuilt-dashboard': 'dashboard',
  'water-ticket': 'wbt',
  // JSA is third-party — not gated by WB tier
};

interface UseCompanyConfigReturn {
  /** Full company config (null if no company or WB admin) */
  config: CompanyConfig | null;
  /** True while loading company config */
  loading: boolean;
  /** Check if a WB app (by apps.ts id) is enabled for this company's tier */
  isWBAppEnabled: (appId: string) => boolean;
  /** Human-readable tier label (e.g. "Suite", "Full Field") */
  tierLabel: string;
  /** Refresh the config (e.g. after tier change) */
  refresh: () => Promise<void>;
  /** Clear cache (call on logout) */
  clearCache: () => Promise<void>;
}

export function useCompanyConfig(companyId?: string): UseCompanyConfigReturn {
  const [config, setConfig] = useState<CompanyConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    if (!companyId) {
      // No company = WB admin or no company assigned → all apps enabled
      setConfig(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = await fetchCompanyConfig(companyId);
      setConfig(result);
    } catch (err) {
      console.warn('[useCompanyConfig] Failed to load:', err);
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const isWBAppEnabled = useCallback((appId: string): boolean => {
    // No config = WB admin → everything enabled
    if (!config) return true;

    // Map the apps.ts ID to the tier WBAppId
    const wbAppId = WB_APP_ID_MAP[appId];

    // If no mapping (e.g. JSA), always allow
    if (!wbAppId) return true;

    return isAppEnabled(config, wbAppId);
  }, [config]);

  const tierLabel = config ? TIER_LABELS[config.tier] : 'Suite';

  const clearCache = useCallback(async () => {
    await clearCompanyConfigCache();
    setConfig(null);
  }, []);

  return {
    config,
    loading,
    isWBAppEnabled,
    tierLabel,
    refresh: loadConfig,
    clearCache,
  };
}
