// src/core/context/FirstLaunchContext.tsx
// Shared context for tracking which WB apps the driver has launched before.
// First tap on home → detail screen (intro). After that → direct launch.
// Long-press → detail screen regardless.
//
// Previously this was a standalone hook (useFirstLaunch) with local state per component.
// That caused the detail screen's markLaunched() to not propagate back to HomeScreen.
// Converting to a context ensures a single source of truth.

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'wellbuilt-suite-launched-apps';

interface FirstLaunchContextValue {
  /** Check if an app has been launched before */
  hasLaunched: (appId: string) => boolean;
  /** Mark an app as launched (persists to AsyncStorage) */
  markLaunched: (appId: string) => Promise<void>;
  /** Whether the initial load from storage is complete */
  loaded: boolean;
}

const FirstLaunchContext = createContext<FirstLaunchContextValue | undefined>(undefined);

export function FirstLaunchProvider({ children }: { children: React.ReactNode }) {
  const [launchedApps, setLaunchedApps] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          setLaunchedApps(new Set(JSON.parse(stored)));
        }
      } catch (err) {
        console.error('[FirstLaunchContext] Error loading:', err);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const hasLaunched = useCallback((appId: string): boolean => {
    return launchedApps.has(appId);
  }, [launchedApps]);

  const markLaunched = useCallback(async (appId: string) => {
    setLaunchedApps(prev => {
      const next = new Set(prev);
      next.add(appId);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...next])).catch(err =>
        console.error('[FirstLaunchContext] Error saving:', err)
      );
      return next;
    });
  }, []);

  return (
    <FirstLaunchContext.Provider value={{ hasLaunched, markLaunched, loaded }}>
      {children}
    </FirstLaunchContext.Provider>
  );
}

export function useFirstLaunch() {
  const ctx = useContext(FirstLaunchContext);
  if (!ctx) {
    throw new Error('useFirstLaunch must be used within a FirstLaunchProvider');
  }
  return ctx;
}
