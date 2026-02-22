import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface UserAppsContextType {
  /** IDs of apps the user has toggled on from the catalog */
  enabledAppIds: string[];
  toggleApp: (id: string) => void;
  isEnabled: (id: string) => boolean;
}

const STORAGE_KEY = 'wellbuilt-suite-enabled-apps';

const UserAppsContext = createContext<UserAppsContextType | null>(null);

export function UserAppsProvider({ children }: { children: React.ReactNode }) {
  const [enabledAppIds, setEnabledAppIds] = useState<string[]>([]);

  // Load from storage on mount
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

  return (
    <UserAppsContext.Provider value={{ enabledAppIds, toggleApp, isEnabled }}>
      {children}
    </UserAppsContext.Provider>
  );
}

export function useUserApps() {
  const ctx = useContext(UserAppsContext);
  if (!ctx) throw new Error('useUserApps must be used within UserAppsProvider');
  return ctx;
}
