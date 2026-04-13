import React, { useCallback, useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, AppState } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@/core/theme';
import { useAuth } from '@/core/context/AuthContext';
import { wellbuiltApps } from '@/core/data/apps';
import { useGreeting, useAppLauncher, useFirstLaunch } from '@/core/hooks';
import { CommandHeader } from '../components/CommandHeader';
import { AppListItem } from '../components/AppListItem';
import { WidgetContainer } from '../components/WidgetContainer';
import { SystemStatusBar } from '../components/SystemStatusBar';
import { ActionCardRow } from '@/ui/shared/ActionCardRow';
import { fetchPendingDispatches, DispatchSummary } from '@/core/services/dispatchJobs';

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user, logout, isAuthenticated, shiftActive, shiftStartTime, returningToYard, returnDepartTime, startShift, startReturn, confirmArrival } = useAuth();
  const { launchWBApp } = useAppLauncher();
  const { hasLaunched } = useFirstLaunch();
  const insets = useSafeAreaInsets();
  const greeting = useGreeting();

  // Pending dispatch jobs for Tickets card badge
  const [dispatches, setDispatches] = useState<DispatchSummary[]>([]);
  const lastFetchRef = useRef<number>(0);
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  const refreshDispatches = useCallback(async () => {
    if (!user?.passcodeHash) return;
    if (Date.now() - lastFetchRef.current < CACHE_TTL) return;
    lastFetchRef.current = Date.now();
    const results = await fetchPendingDispatches(user.passcodeHash);
    setDispatches(results);
  }, [user?.passcodeHash]);

  // Fetch on mount + foreground resume
  useEffect(() => {
    refreshDispatches();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        lastFetchRef.current = 0; // force refresh on foreground
        refreshDispatches();
      }
    });
    return () => sub.remove();
  }, [refreshDispatches]);

  React.useEffect(() => { if (!isAuthenticated) router.replace('/'); }, [isAuthenticated]);
  if (!user) return null;

  const roleLabel = t(`home.roles.${user.role}`);
  // Filter out WB M for unrouted-only drivers
  const companyApps = wellbuiltApps.filter(app => {
    if (app.id === 'wellbuilt-mobile' && user.companyId) {
      const routes = user.assignedRoutes;
      if (routes === undefined) return true;
      if (routes.length === 0) return false;
      return routes.some(r => !r.startsWith('Unrouted'));
    }
    return true;
  });

  const handleArrived = useCallback(async (odometerMiles?: number) => {
    await confirmArrival(odometerMiles);
    router.push('/day-summary');
  }, [confirmArrival]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <CommandHeader
        title={`${greeting}, ${user.displayName}`}
        subtitle={`${roleLabel} — ${user.companyName || 'WellBuilt'}`}
        onSettings={() => router.push('/settings')}
        onAction={logout}
        actionIcon="logout"
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <ActionCardRow active={shiftActive} returning={returningToYard} returnStartTime={returnDepartTime} shiftStartTime={shiftStartTime} onStartShift={startShift} onStartReturn={startReturn} onArrived={handleArrived} />


        <WidgetContainer
          title={t('home.sections.applications').toUpperCase()}
        >
          <View style={styles.appList}>
            {companyApps.map(app => {
              // Build badge props for Tickets card
              const isTickets = app.id === 'water-ticket';
              const badgeText = isTickets && dispatches.length > 0
                ? `${dispatches.length} pending`
                : undefined;
              const badgeDetailText = isTickets && dispatches.length > 0 && dispatches.length <= 3
                ? dispatches.map(d => d.wellName).join(', ')
                : undefined;

              return (
              <AppListItem key={app.id} app={app}
                badge={badgeText}
                badgeDetail={badgeDetailText}
                onPress={() => {
                  if (hasLaunched(app.id)) {
                    launchWBApp({ name: app.name, scheme: app.scheme, androidPackage: app.androidPackage, webUrl: app.webUrl });
                  } else {
                    router.push(`/app-detail?id=${app.id}`);
                  }
                }}
                onLongPress={() => router.push(`/app-detail?id=${app.id}`)}
              />
              );
            })}
          </View>
        </WidgetContainer>

        <SystemStatusBar />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  appList: { gap: spacing.sm },
});
