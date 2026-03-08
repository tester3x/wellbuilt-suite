import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
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
import { ShiftButton } from '@/ui/shared/ShiftButton';

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user, logout, isAuthenticated, shiftActive, endShift } = useAuth();
  const { launchWBApp } = useAppLauncher();
  const { hasLaunched } = useFirstLaunch();
  const insets = useSafeAreaInsets();
  const greeting = useGreeting();

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
        <ShiftButton active={shiftActive} onEndShift={endShift} />

        <WidgetContainer
          title={t('home.sections.applications').toUpperCase()}
        >
          <View style={styles.appList}>
            {companyApps.map(app => (
              <AppListItem key={app.id} app={app}
                onPress={() => {
                  if (hasLaunched(app.id)) {
                    launchWBApp({ name: app.name, scheme: app.scheme, androidPackage: app.androidPackage, webUrl: app.webUrl });
                  } else {
                    router.push(`/app-detail?id=${app.id}`);
                  }
                }}
                onLongPress={() => router.push(`/app-detail?id=${app.id}`)}
              />
            ))}
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
