// src/core/hooks/useInstalledApps.ts
// Layer 2 of BYOA triple hybrid: Installed app detection
//
// Checks Linking.canOpenURL() for each app with a native scheme.
// Returns a Set<string> of app IDs that are installed on the device.
//
// Limitations:
// - iOS: Only works for schemes declared in LSApplicationQueriesSchemes
// - Android 11+: Only works for schemes declared in manifest <queries>
// - Web URLs (https://) always return true — we skip those
// - Results cached per session (re-checked when modal opens)

import { useState, useCallback, useRef } from 'react';
import { Linking, Platform } from 'react-native';
import { appCatalog, isNativeScheme } from '../data/externalApps';

/**
 * Hook that checks which BYOA apps are installed on the device.
 * Call `refresh()` when the add-app modal opens to re-scan.
 */
export function useInstalledApps() {
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const hasChecked = useRef(false);

  const refresh = useCallback(async () => {
    // Only re-check once per modal open (avoid hammering canOpenURL)
    setChecking(true);

    try {
      // Filter to apps with native schemes only
      const nativeApps = appCatalog.filter(app => isNativeScheme(app.url));

      // Check all in parallel
      const results = await Promise.allSettled(
        nativeApps.map(async (app) => {
          try {
            const canOpen = await Linking.canOpenURL(app.url);
            return { id: app.id, installed: canOpen };
          } catch {
            return { id: app.id, installed: false };
          }
        })
      );

      const installed = new Set<string>();

      // Always-available system apps (phone, sms, email)
      const systemSchemes = ['tel:', 'sms:', 'mailto:'];
      for (const app of appCatalog) {
        if (systemSchemes.includes(app.url)) {
          installed.add(app.id);
        }
      }

      // Add detected apps
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.installed) {
          installed.add(result.value.id);
        }
      }

      setInstalledIds(installed);
      hasChecked.current = true;
    } catch (err) {
      console.warn('[useInstalledApps] Error checking installed apps:', err);
    } finally {
      setChecking(false);
    }
  }, []);

  const isInstalled = useCallback((id: string) => {
    return installedIds.has(id);
  }, [installedIds]);

  return {
    /** Set of installed app IDs */
    installedIds,
    /** Whether detection check is in progress */
    checking,
    /** Whether we've done at least one check */
    hasChecked: hasChecked.current,
    /** Check if a specific app is installed */
    isInstalled,
    /** Re-scan installed apps (call when modal opens) */
    refresh,
  };
}
