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
import { Sidebar } from '../components/Sidebar';
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  React.useEffect(() => { if (!isAuthenticated) router.replace('/'); }, [isAuthenticated]);
  if (!user) return null;

  const roleLabel = t(`home.roles.${user.role}`);
  const companyApps = wellbuiltApps;
  const userEnabledApps = appCatalog.filter(a => enabledAppIds.includes(a.id));
  const allByoaApps = [...pinnedApps, ...userEnabledApps];

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
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <MaterialCommunityIcons name="apps" size={20} color={colors.brand.primary} />
                <Text style={[styles.statValue, { color: colors.brand.primary }]}>{companyApps.length}</Text>
                <Text style={styles.statLabel}>{t('home.stats.apps')}</Text>
              </View>
              <View style={styles.statCard}>
                <MaterialCommunityIcons name="check-circle" size={20} color={colors.status.online} />
                <Text style={[styles.statValue, { color: colors.status.online }]}>{companyApps.filter(a => a.status === 'active').length}</Text>
                <Text style={styles.statLabel}>{t('home.stats.active')}</Text>
              </View>
              <View style={styles.statCard}>
                <MaterialCommunityIcons name="link-variant" size={20} color={colors.brand.accent} />
                <Text style={[styles.statValue, { color: colors.brand.accent }]}>{allByoaApps.length}</Text>
                <Text style={styles.statLabel}>BYOA</Text>
              </View>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('home.sections.byoa')}</Text>
              <Pressable onPress={() => setShowAddModal(true)} style={styles.addBtn}>
                <MaterialCommunityIcons name="plus" size={16} color={colors.brand.primary} />
                <Text style={styles.addBtnText}>{t('addAppModal.title')}</Text>
              </Pressable>
            </View>

            <View style={styles.byoaGrid}>
              {allByoaApps.map(app => (
                <Pressable key={app.id} onPress={() => launchExternalApp({ url: app.url, webUrl: app.webUrl })}
                  style={({ pressed }) => [styles.byoaItem, pressed && styles.byoaItemPressed]}>
                  <View style={[styles.byoaIcon, { backgroundColor: `${app.color}15` }]}>
                    <MaterialCommunityIcons name={app.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={20} color={app.color} />
                  </View>
                  <Text style={styles.byoaName} numberOfLines={1}>{app.name}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerText}>{t('home.footer.version')}</Text>
              <Text style={styles.footerSubtext}>{t('home.footer.tagline')}</Text>
            </View>
          </ScrollView>
        </View>
      </View>

      <AddAppModal visible={showAddModal} onClose={() => setShowAddModal(false)} />
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
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  statCard: { flex: 1, backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.md, alignItems: 'center', gap: spacing.xs },
  statValue: { ...typography.h2 },
  statLabel: { ...typography.caption, color: colors.text.muted, textAlign: 'center' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  sectionTitle: { ...typography.h3, color: colors.text.primary },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border.active },
  addBtnText: { ...typography.caption, color: colors.brand.primary, fontWeight: '600' },
  byoaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  byoaItem: { width: '22%', alignItems: 'center', padding: spacing.sm },
  byoaItemPressed: { opacity: 0.7 },
  byoaIcon: { width: 44, height: 44, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.xs },
  byoaName: { ...typography.caption, color: colors.text.muted, fontSize: 10, textAlign: 'center' },
  footer: { alignItems: 'center', marginTop: spacing.xl, paddingTop: spacing.lg },
  footerText: { ...typography.caption, color: colors.text.muted },
  footerSubtext: { ...typography.caption, color: colors.text.muted, opacity: 0.5, marginTop: 2 },
});
