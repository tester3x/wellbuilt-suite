import { useTranslation } from 'react-i18next';

export function useGreeting(): string {
  const { t } = useTranslation();
  const hour = new Date().getHours();

  if (hour < 12) return t('home.greeting.morning');
  if (hour < 17) return t('home.greeting.afternoon');
  return t('home.greeting.evening');
}
