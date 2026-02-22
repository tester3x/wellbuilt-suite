import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n, { SUPPORTED_LANGUAGES } from './i18n';

const STORAGE_KEY = 'wellbuilt-suite-language';

interface LanguageContextType {
  currentLanguage: string;
  setLanguage: (lang: string) => Promise<void>;
  supportedLanguages: string[];
}

const LanguageContext = createContext<LanguageContextType | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [currentLanguage, setCurrentLanguage] = useState(i18n.language || 'en');

  // Load saved language preference on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(saved => {
      if (saved && SUPPORTED_LANGUAGES.includes(saved)) {
        i18n.changeLanguage(saved);
        setCurrentLanguage(saved);
      }
    });
  }, []);

  const setLanguage = useCallback(async (lang: string) => {
    if (!SUPPORTED_LANGUAGES.includes(lang)) return;
    await i18n.changeLanguage(lang);
    setCurrentLanguage(lang);
    await AsyncStorage.setItem(STORAGE_KEY, lang);
  }, []);

  return (
    <LanguageContext.Provider value={{
      currentLanguage,
      setLanguage,
      supportedLanguages: SUPPORTED_LANGUAGES,
    }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
