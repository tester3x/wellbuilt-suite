import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useAuth } from '@/core/context/AuthContext';
import { wellbuiltApps } from '@/core/data/apps';
import { useGreeting, useAppLauncher, useFirstLaunch } from '@/core/hooks';
import { Sidebar } from '../components/Sidebar';

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user, logout, isAuthenticated } = useAuth();
  const { launchWBApp } = useAppLauncher();
  const { hasLaunched } = useFirstLaunch();
  const insets = useSafeAreaInsets();
  const greeting = useGreeting();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  React.useEffect(() => { if (!isAuthenticated) router.replace('/'); }, [isAuthenticated]);
  if (!user) return null;

  const roleLabel = t(`home.roles.${user.role}`);
  const companyApps = wellbuiltApps;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.body}>
        <Sidebar
          apps={companyApps}
          companyName={user.companyName || 'WellBuilt'}
          userName={user.displayName}
          roleLabel={roleLabel}
          onAppPress={(appId) => {
            const app = companyApps.find(a => a.id === appId);
            if (app && hasLaunched(app.id)) {
              launchWBApp({ name: app.name, scheme: app.scheme, androidPackage: app.androidPackage, webUrl: app.webUrl });
            } else {
              router.push(`/app-detail?id=${appId}`);
            }
          }}
          onAppLongPress={(appId) => router.push(`/app-detail?id=${appId}`)}
          onSettings={() => router.push('/settings')}
          onLogout={logout}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        <View style={styles.mainContent}>
          <View style={styles.contentHeader}>
            <View>
              <Text style={styles.greeting}>{greeting},</Text>
              <Text style={styles.userName}>{user.displayName}</Text>
            </View>
            <View style={styles.headerMeta}>
              <View style={styles.roleBadge}>
                <Text style={styles.roleText}>{roleLabel}</Text>
              </View>
            </View>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.footer}>
              <Text style={styles.footerText}>{t('home.footer.version')}</Text>
              <Text style={styles.footerSubtext}>{t('home.footer.tagline')}</Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  body: { flex: 1, flexDirection: 'row' },
  mainContent: { flex: 1 },
  contentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  greeting: { ...typography.bodySmall, color: colors.text.muted },
  userName: { ...typography.h2, color: colors.text.primary },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  roleBadge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: `${colors.brand.primary}15` },
  roleText: { ...typography.caption, color: colors.brand.primary, fontWeight: '700', fontSize: 10 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  footer: { alignItems: 'center', marginTop: spacing.xl, paddingTop: spacing.lg },
  footerText: { ...typography.caption, color: colors.text.muted },
  footerSubtext: { ...typography.caption, color: colors.text.muted, opacity: 0.5, marginTop: 2 },
});
