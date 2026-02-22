import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import en from './translations/en.json';
import es from './translations/es.json';

const SUPPORTED_LANGUAGES = ['en', 'es'];

const deviceLanguage = Localization.getLocales()?.[0]?.languageCode || 'en';
const defaultLanguage = SUPPORTED_LANGUAGES.includes(deviceLanguage) ? deviceLanguage : 'en';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
  },
  lng: defaultLanguage,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
  compatibilityJSON: 'v4',
});

export default i18n;
export { SUPPORTED_LANGUAGES };
