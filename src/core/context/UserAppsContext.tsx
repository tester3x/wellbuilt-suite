// src/core/context/UserAppsContext.tsx
// Manages BYOA app selections — triple hybrid:
//   1. User-toggled apps (AsyncStorage — driver personal choice)
//   2. Installed detection (handled by useInstalledApps hook, not here)
//   3. Company-required apps (Firestore — admin mandated, non-removable)

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { fetchCompanyRequiredApps, clearCompanyAppsCache } from '../services/companyApps';

interface UserAppsContextType {
  /** IDs of apps the user has toggled on from the catalog */
  enabledAppIds: string[];
  /** IDs of apps the company requires (admin-mandated, non-removable) */
  companyRequiredIds: string[];
  /** Loading state for company required apps fetch */
  companyAppsLoading: boolean;
  /** Toggle a user-selected app on/off */
  toggleApp: (id: string) => void;
  /** Check if a user-selected app is enabled */
  isEnabled: (id: string) => boolean;
  /** Check if an app is company-required (non-removable) */
  isCompanyRequired: (id: string) => boolean;
}

const STORAGE_KEY = 'wellbuilt-suite-enabled-apps';

const UserAppsContext = createContext<UserAppsContextType | null>(null);

export function UserAppsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [enabledAppIds, setEnabledAppIds] = useState<string[]>([]);
  const [companyRequiredIds, setCompanyRequiredIds] = useState<string[]>([]);
  const [companyAppsLoading, setCompanyAppsLoading] = useState(false);

  // Load user-toggled apps from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(data => {
      if (data) {
        try {
          setEnabledAppIds(JSON.parse(data));
        } catch {
          // ignore bad data
        }
      }
    });
  }, []);

  // Load company-required apps when user/companyId changes
  useEffect(() => {
    if (!user?.companyId) {
      setCompanyRequiredIds([]);
      return;
    }

    let cancelled = false;
    setCompanyAppsLoading(true);

    fetchCompanyRequiredApps(user.companyId)
      .then(ids => {
        if (!cancelled) {
          setCompanyRequiredIds(ids);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCompanyRequiredIds([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCompanyAppsLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [user?.companyId]);

  const persist = useCallback((ids: string[]) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }, []);

  const toggleApp = useCallback((id: string) => {
    setEnabledAppIds(prev => {
      const next = prev.includes(id)
        ? prev.filter(x => x !== id)
        : [...prev, id];
      persist(next);
      return next;
    });
  }, [persist]);

  const isEnabled = useCallback((id: string) => {
    return enabledAppIds.includes(id);
  }, [enabledAppIds]);

  const isCompanyRequired = useCallback((id: string) => {
    return companyRequiredIds.includes(id);
  }, [companyRequiredIds]);

  return (
    <UserAppsContext.Provider value={{
      enabledAppIds,
      companyRequiredIds,
      companyAppsLoading,
      toggleApp,
      isEnabled,
      isCompanyRequired,
    }}>
      {children}
    </UserAppsContext.Provider>
  );
}

export function useUserApps() {
  const ctx = useContext(UserAppsContext);
  if (!ctx) throw new Error('useUserApps must be used within UserAppsProvider');
  return ctx;
}
