import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useAuth } from '@/core/context/AuthContext';
import { wellbuiltApps } from '@/core/data/apps';
import { useGreeting, useAppLauncher, useFirstLaunch, useCompanyConfig } from '@/core/hooks';
import { TIER_DESCRIPTIONS } from '@/core/services/companyConfig';
import { WellBuiltLogo } from '@/ui/shared/WellBuiltLogo';
import { AppCard } from '../components/AppCard';
import { ActionCardRow } from '@/ui/shared/ActionCardRow';

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user, logout, isAuthenticated, shiftActive, returningToYard, returnDepartTime, startShift, startReturn, confirmArrival } = useAuth();
  const { launchWBApp } = useAppLauncher();
  const { hasLaunched } = useFirstLaunch();
  const { isWBAppEnabled, config: companyConfig, tierLabel } = useCompanyConfig(user?.companyId);
  const insets = useSafeAreaInsets();
  const greeting = useGreeting();

  React.useEffect(() => { if (!isAuthenticated) router.replace('/'); }, [isAuthenticated]);
  if (!user) return null;

  const roleLabel = t(`home.roles.${user.role}`);
  // Filter out WB M for unrouted-only drivers (completely hidden, not greyed)
  const companyApps = wellbuiltApps.filter(app => {
    if (app.id === 'wellbuilt-mobile' && user.companyId) {
      const routes = user.assignedRoutes;
      if (routes === undefined) return true; // legacy driver — show
      if (routes.length === 0) return false;
      return routes.some(r => !r.startsWith('Unrouted'));
    }
    return true;
  });
  const showTierBanner = companyConfig && companyConfig.tier !== 'suite';
  const enabledCount = companyApps.filter(a => isWBAppEnabled(a.id)).length;

  const handleArrived = useCallback(async () => {
    await confirmArrival();
    router.push('/day-summary');
  }, [confirmArrival]);

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

        <ActionCardRow active={shiftActive} returning={returningToYard} returnStartTime={returnDepartTime} onStartShift={startShift} onStartReturn={startReturn} onArrived={handleArrived} />

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

        <View style={styles.footer}>
          <View style={styles.footerLine} />
          <Text style={styles.footerText}>{t('home.footer.version')}</Text>
          <Text style={styles.footerSubtext}>{t('home.footer.tagline')}</Text>
        </View>
      </ScrollView>
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
  appGrid: { flexDirection: 'row', flexWrap: 'wrap' },
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
