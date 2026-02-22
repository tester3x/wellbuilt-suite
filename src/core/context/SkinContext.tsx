import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SkinDefinition } from '../types/skin';

const STORAGE_KEY = 'wellbuilt-suite-skin';

interface SkinContextType {
  /** The currently active skin */
  skin: SkinDefinition;
  /** Current skin ID */
  skinId: string;
  /** Switch to a different skin (instant hot-swap) */
  setSkin: (id: string) => void;
  /** All registered skins */
  availableSkins: SkinDefinition[];
}

const SkinContext = createContext<SkinContextType | null>(null);

interface SkinProviderProps {
  children: React.ReactNode;
  skins: SkinDefinition[];
  defaultSkinId?: string;
}

export function SkinProvider({ children, skins, defaultSkinId }: SkinProviderProps) {
  const fallback = skins[0];
  const [activeSkin, setActiveSkin] = useState<SkinDefinition>(
    (defaultSkinId ? skins.find(s => s.id === defaultSkinId) : fallback) || fallback
  );

  // Load saved skin preference on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(savedId => {
      if (savedId) {
        const found = skins.find(s => s.id === savedId);
        if (found) {
          setActiveSkin(found);
        }
      }
    });
  }, [skins]);

  const setSkin = useCallback((id: string) => {
    const found = skins.find(s => s.id === id);
    if (found) {
      setActiveSkin(found);
      AsyncStorage.setItem(STORAGE_KEY, id);
    }
  }, [skins]);

  return (
    <SkinContext.Provider value={{
      skin: activeSkin,
      skinId: activeSkin.id,
      setSkin,
      availableSkins: skins,
    }}>
      {children}
    </SkinContext.Provider>
  );
}

export function useSkin() {
  const ctx = useContext(SkinContext);
  if (!ctx) throw new Error('useSkin must be used within SkinProvider');
  return ctx;
}
