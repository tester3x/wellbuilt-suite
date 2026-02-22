import React, { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@/core/theme';
import { wellbuiltApps } from '@/core/data/apps';
import { useAuth } from '@/core/context/AuthContext';
import { useAppLauncher } from '@/core/hooks';
import { Sidebar } from '../components/Sidebar';
import { CompactHeader } from '../components/CompactHeader';
import { ContentArea } from '../components/ContentArea';
import { AppContentPanel } from '../components/AppContentPanel';
import { Text } from 'react-native';

export default function AppDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const app = wellbuiltApps.find(a => a.id === id);
  const { canLaunchApp, launchWBApp } = useAppLauncher();
  const [canLaunch, setCanLaunch] = useState<boolean | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => { canLaunchApp(app?.scheme).then(setCanLaunch); }, [app?.scheme]);

  if (!user) return null;

  const roleLabel = t(`home.roles.${user.role}`);
  const companyApps = wellbuiltApps;

  if (!app) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <CompactHeader title={t('appDetail.headerTitle')} onBack={() => router.back()} />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{t('appDetail.notFound')}</Text>
        </View>
      </View>
    );
  }

  const handleLaunch = () => launchWBApp({ name: app.name, scheme: app.scheme, androidPackage: app.androidPackage });

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.body}>
        <Sidebar
          apps={companyApps}
          companyName="WellBuilt"
          userName={user.displayName}
          roleLabel={roleLabel}
          onAppPress={(appId) => router.push(`/app-detail?id=${appId}`)}
          onSettings={() => router.push('/settings')}
          onLogout={logout}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <View style={styles.mainContent}>
          <CompactHeader title={t('appDetail.headerTitle')} onBack={() => router.back()} />
          <ContentArea>
            <AppContentPanel app={app} canLaunch={canLaunch} onLaunch={handleLaunch} />
          </ContentArea>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  body: { flex: 1, flexDirection: 'row' },
  mainContent: { flex: 1 },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: colors.status.error },
});
