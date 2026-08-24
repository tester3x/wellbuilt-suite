/**
 * Shared Suite app-card actions: primary tap launches, info/long-press
 * opens App Details. First-seen flags are not consulted.
 */
import { useCallback } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useCompanyConfig } from './useCompanyConfig';
import { useAppLauncher } from './useAppLauncher';
import type { WellBuiltApp } from '../data/apps';
import {
  beginAppCardLaunch,
  decideAppCardPrimaryAction,
  endAppCardLaunch,
} from '../services/appCardTapPolicy';

export function useAppCardActions() {
  const { t } = useTranslation();
  const { user, shiftActive } = useAuth();
  const { launchWBApp } = useAppLauncher();
  const { isWBAppEnabled, tierLabel } = useCompanyConfig(user?.companyId);

  const onPrimaryTap = useCallback((app: WellBuiltApp) => {
    const decision = decideAppCardPrimaryAction({
      app,
      enabled: isWBAppEnabled(app.id),
      shiftActive,
    });
    if (decision.action === 'disabled_notice') {
      Alert.alert(
        t('home.tier.lockedTitle'),
        t('home.tier.lockedMessage', { name: app.name, tier: tierLabel }),
      );
      return;
    }
    if (decision.action === 'not_configured') {
      Alert.alert(app.name, t('appDetail.launch.notConfigured', { name: app.name }));
      return;
    }
    if (!beginAppCardLaunch(app.id)) return;
    void launchWBApp({
      name: decision.target.name,
      scheme: decision.target.scheme,
      androidPackage: decision.target.androidPackage,
      webUrl: decision.target.webUrl,
    }).finally(() => endAppCardLaunch(app.id));
  }, [isWBAppEnabled, launchWBApp, shiftActive, t, tierLabel]);

  const onOpenDetails = useCallback((appId: string) => {
    router.push(`/app-detail?id=${appId}`);
  }, []);

  return { onPrimaryTap, onOpenDetails, isWBAppEnabled };
}
