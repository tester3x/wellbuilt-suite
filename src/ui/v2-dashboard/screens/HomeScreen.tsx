import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useAuth } from '@/core/context/AuthContext';
import { useUserApps } from '@/core/context/UserAppsContext';
import { wellbuiltApps } from '@/core/data/apps';
import { pinnedApps, appCatalog } from '@/core/data/externalApps';
import { useGreeting, useAppLauncher, useFirstLaunch } from '@/core/hooks';
import { CommandHeader } from '../components/CommandHeader';
import { DashboardStatsPanel } from '../components/DashboardStatsPanel';
import { AppListItem } from '../components/AppListItem';
import { WidgetContainer } from '../components/WidgetContainer';
import { ByoaPanel } from '../components/ByoaPanel';
import { SystemStatusBar } from '../components/SystemStatusBar';
import { AddAppModal } from '@/ui/v1-grid/components/AddAppModal';

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user, logout, isAuthenticated } = useAuth();
  const { enabledAppIds } = useUserApps();
  const { launchExternalApp, launchWBApp } = useAppLauncher();
  const { hasLaunched } = useFirstLaunch();
  const insets = useSafeAreaInsets();
  const greeting = useGreeting();
  const [showAddModal, setShowAddModal] = useState(false);

  React.useEffect(() => { if (!isAuthenticated) router.replace('/'); }, [isAuthenticated]);
  if (!user) return null;

  const roleLabel = t(`home.roles.${user.role}`);
  const companyApps = wellbuiltApps;
  const userEnabledApps = appCatalog.filter(a => enabledAppIds.includes(a.id));

  const statsData = [
    { icon: 'apps', label: t('home.stats.apps'), value: String(companyApps.length), color: colors.brand.primary },
    { icon: 'check-circle', label: t('home.stats.active'), value: String(companyApps.filter(a => a.status === 'active').length), color: colors.status.online },
    { icon: 'account-group', label: t('home.stats.platform'), value: 'v1.0', color: colors.brand.accent },
  ];

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
        <WidgetContainer title={t('home.stats.apps').toUpperCase()} subtitle={t('home.sections.appCount', { count: companyApps.length })}>
          <DashboardStatsPanel stats={statsData} />
        </WidgetContainer>

        <WidgetContainer
          title={t('home.sections.applications').toUpperCase()}
          rightElement={
            <Text style={styles.appCount}>{companyApps.length} {t('home.stats.apps').toLowerCase()}</Text>
          }
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

        <ByoaPanel
          pinnedApps={pinnedApps}
          userApps={userEnabledApps}
          onOpenApp={(url, webUrl) => launchExternalApp({ url, webUrl })}
          onAddPress={() => setShowAddModal(true)}
        />

        <SystemStatusBar />
      </ScrollView>

      <AddAppModal visible={showAddModal} onClose={() => setShowAddModal(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  appCount: { ...typography.caption, color: colors.text.muted },
  appList: { gap: spacing.sm },
});
