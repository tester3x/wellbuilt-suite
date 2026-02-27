import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useAuth } from '@/core/context/AuthContext';
import { useUserApps } from '@/core/context/UserAppsContext';
import { wellbuiltApps } from '@/core/data/apps';
import { pinnedApps, appCatalog } from '@/core/data/externalApps';
import { useGreeting, useAppLauncher, useFirstLaunch, useCompanyConfig } from '@/core/hooks';
import { TIER_DESCRIPTIONS } from '@/core/services/companyConfig';
import { WellBuiltLogo } from '@/ui/shared/WellBuiltLogo';
import { AppCard } from '../components/AppCard';
import { QuickLinkCard, AddAppCard } from '../components/QuickLinkCard';
import { AddAppModal } from '../components/AddAppModal';

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user, logout, isAuthenticated } = useAuth();
  const { enabledAppIds, companyRequiredIds, toggleApp, isCompanyRequired } = useUserApps();
  const { launchExternalApp, launchWBApp } = useAppLauncher();
  const { hasLaunched } = useFirstLaunch();
  const { isWBAppEnabled, config: companyConfig, tierLabel } = useCompanyConfig(user?.companyId);
  const insets = useSafeAreaInsets();
  const greeting = useGreeting();
  const [showAddModal, setShowAddModal] = useState(false);

  React.useEffect(() => { if (!isAuthenticated) router.replace('/'); }, [isAuthenticated]);
  if (!user) return null;

  const roleLabel = t(`home.roles.${user.role}`);
  const companyApps = wellbuiltApps;
  const showTierBanner = companyConfig && companyConfig.tier !== 'suite';
  const enabledCount = companyApps.filter(a => isWBAppEnabled(a.id)).length;
  const userEnabledApps = appCatalog.filter(a => enabledAppIds.includes(a.id));
  // Company-required apps: auto-pinned, not in user-enabled (avoid duplicates)
  const companyAppsInRow = appCatalog.filter(
    a => companyRequiredIds.includes(a.id) && !enabledAppIds.includes(a.id)
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <WellBuiltLogo />
        <View style={styles.headerRight}>
          <Pressable onPress={() => router.push('/settings')} style={styles.headerButton}>
            <MaterialCommunityIcons name="cog-outline" size={20} color={colors.text.muted} />
          </Pressable>
          <Pressable onPress={logout} style={styles.headerButton}>
            <MaterialCommunityIcons name="logout" size={20} color={colors.text.muted} />
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.welcomeSection}>
          <Text style={styles.greeting}>{greeting},</Text>
          <Text style={styles.userName}>{user.displayName}</Text>
          <View style={styles.roleRow}>
            <View style={[styles.roleBadge, {
              backgroundColor: user.role === 'admin' ? `${colors.brand.accent}20` :
                user.role === 'viewer' ? `${colors.status.online}20` : `${colors.brand.primary}20`,
            }]}>
              <Text style={[styles.roleText, {
                color: user.role === 'admin' ? colors.brand.accent :
                  user.role === 'viewer' ? colors.status.online : colors.brand.primary,
              }]}>{roleLabel}</Text>
            </View>
            {user.companyName ? (
              <Text style={styles.companyText}>{user.companyName}</Text>
            ) : null}
          </View>
        </View>

        {/* StatsBar removed — user feedback: not useful info for drivers */}

        {showTierBanner && (
          <View style={styles.tierBanner}>
            <View style={styles.tierBannerLeft}>
              <MaterialCommunityIcons name="shield-star-outline" size={18} color={colors.brand.accent} />
              <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                <Text style={styles.tierBannerTitle}>{tierLabel} {t('home.tier.plan')}</Text>
                <Text style={styles.tierBannerDesc}>
                  {TIER_DESCRIPTIONS[companyConfig!.tier]}
                </Text>
              </View>
            </View>
            <View style={styles.tierBadge}>
              <Text style={styles.tierBadgeText}>{enabledCount}/{companyApps.length}</Text>
            </View>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('home.sections.applications')}</Text>
          <Text style={styles.sectionCount}>{t('home.sections.appCount', { count: companyApps.length })}</Text>
        </View>

        <View style={styles.appGrid}>
          {companyApps.map((app, index) => {
            const locked = !isWBAppEnabled(app.id);
            return (
              <AppCard key={app.id} app={app} index={index} locked={locked}
                onPress={() => {
                  if (locked) {
                    Alert.alert(
                      t('home.tier.lockedTitle'),
                      t('home.tier.lockedMessage', { name: app.name, tier: tierLabel }),
                    );
                    return;
                  }
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

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>{t('home.sections.byoa')}</Text>
            <Text style={styles.byoaSubtitle}>{t('home.sections.byoaSubtitle')}</Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickLinksRow}>
          {pinnedApps.map(app => (
            <QuickLinkCard key={app.id} name={app.name} icon={app.icon} color={app.color}
              onPress={() => launchExternalApp({ url: app.url, webUrl: app.webUrl })} />
          ))}
          {companyAppsInRow.map(app => (
            <QuickLinkCard key={app.id} name={app.name} icon={app.icon} color={app.color}
              onPress={() => launchExternalApp({ url: app.url, webUrl: app.webUrl })} />
          ))}
          {userEnabledApps.map(app => (
            <QuickLinkCard key={app.id} name={app.name} icon={app.icon} color={app.color}
              onPress={() => launchExternalApp({ url: app.url, webUrl: app.webUrl })}
              onLongPress={() => {
                if (isCompanyRequired(app.id)) return; // Can't remove company-required
                Alert.alert(
                  t('addAppModal.removeTitle'),
                  t('addAppModal.removeMessage', { name: app.name }),
                  [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('addAppModal.remove'), style: 'destructive', onPress: () => toggleApp(app.id) },
                  ]
                );
              }} />
          ))}
          <AddAppCard onPress={() => setShowAddModal(true)} />
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.footerLine} />
          <Text style={styles.footerText}>{t('home.footer.version')}</Text>
          <Text style={styles.footerSubtext}>{t('home.footer.tagline')}</Text>
        </View>
      </ScrollView>

      <AddAppModal visible={showAddModal} onClose={() => setShowAddModal(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  headerRight: { flexDirection: 'row', gap: spacing.sm },
  headerButton: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.bg.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border.subtle },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  welcomeSection: { marginBottom: spacing.lg },
  greeting: { ...typography.bodySmall, color: colors.text.muted },
  userName: { ...typography.h1, color: colors.text.primary, marginBottom: spacing.xs },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  roleBadge: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs, borderRadius: radius.sm },
  roleText: { ...typography.caption, fontWeight: '700' },
  companyText: { ...typography.bodySmall, color: colors.text.muted },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.md },
  sectionTitle: { ...typography.h3, color: colors.text.primary },
  sectionCount: { ...typography.caption, color: colors.text.muted },
  byoaSubtitle: { ...typography.caption, color: colors.text.muted, marginTop: 1 },
  appGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  quickLinksRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.xs },
  footer: { alignItems: 'center', marginTop: spacing.xl, paddingTop: spacing.lg },
  footerLine: { width: 40, height: 2, backgroundColor: colors.border.subtle, borderRadius: 1, marginBottom: spacing.md },
  footerText: { ...typography.caption, color: colors.text.muted },
  footerSubtext: { ...typography.caption, color: colors.text.muted, opacity: 0.5, marginTop: 2 },
  tierBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: `${colors.brand.accent}10`, borderWidth: 1, borderColor: `${colors.brand.accent}30`, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  tierBannerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  tierBannerTitle: { ...typography.bodySmall, color: colors.brand.accent, fontWeight: '700' },
  tierBannerDesc: { ...typography.caption, color: colors.text.muted, marginTop: 1 },
  tierBadge: { backgroundColor: `${colors.brand.accent}20`, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs, borderRadius: radius.sm, marginLeft: spacing.sm },
  tierBadgeText: { ...typography.caption, color: colors.brand.accent, fontWeight: '700' },
});
