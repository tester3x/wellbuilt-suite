import React, { useCallback, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, AppState } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useAuth } from '@/core/context/AuthContext';
import { wellbuiltApps } from '@/core/data/apps';
import { useGreeting, useAppLauncher, useAppCardActions, useCompanyConfig } from '@/core/hooks';
import { TIER_DESCRIPTIONS } from '@/core/services/companyConfig';
import { WellBuiltLogo } from '@/ui/shared/WellBuiltLogo';
import { AppCard } from '../components/AppCard';
import { ActionCardRow } from '@/ui/shared/ActionCardRow';

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user, logout, isAuthenticated, shiftActive, shiftStartTime, returningToYard, returnDepartTime, startShift, startReturn, confirmArrival } = useAuth();
  const { launchWBApp } = useAppLauncher();
  const { onPrimaryTap, onOpenDetails } = useAppCardActions();
  const { isWBAppEnabled, config: companyConfig, tierLabel } = useCompanyConfig(user?.companyId);
  const insets = useSafeAreaInsets();
  const greeting = useGreeting();

  React.useEffect(() => { if (!isAuthenticated) router.replace('/'); }, [isAuthenticated]);

  // All hooks MUST run before any early return (logout / revalidation null user).
  const handleArrived = useCallback(async (odometerMiles?: number) => {
    const ok = await confirmArrival(odometerMiles);
    if (ok === false) return false;
    router.push('/day-summary');
    return true;
  }, [confirmArrival]);

  // ── JSA shift-start gate ──────────────────────────────────────
  const jsaMode = companyConfig?.jsaMode || 'off';
  const jsaRequired = jsaMode !== 'off';
  const [jsaPending, setJsaPending] = useState(false);

  // Check Firestore for today's JSA completion when shift is active
  const checkJsaCompletion = useCallback(async () => {
    if (!jsaRequired || !shiftActive || !user) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const driverName = user.legalName || user.displayName;
      const url = `https://firestore.googleapis.com/v1/projects/wellbuilt-sync/databases/(default)/documents:runQuery?key=AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI`;
      const body = {
        structuredQuery: {
          from: [{ collectionId: 'jsas' }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                { fieldFilter: { field: { fieldPath: 'driverName' }, op: 'EQUAL', value: { stringValue: driverName } } },
                { fieldFilter: { field: { fieldPath: 'date' }, op: 'EQUAL', value: { stringValue: today } } },
              ],
            },
          },
          limit: 1,
        },
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return;
      const results = await res.json();
      const found = results.some((r: any) => r.document);
      setJsaPending(!found);
    } catch {
      // Network error — don't block, just leave pending state as-is
    }
  }, [jsaRequired, shiftActive, user]);

  // Check on mount, foreground resume, and when shift becomes active
  useEffect(() => {
    if (!jsaRequired || !shiftActive) {
      setJsaPending(false);
      return;
    }
    setJsaPending(true); // Assume pending until we confirm
    checkJsaCompletion();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkJsaCompletion();
    });
    return () => sub.remove();
  }, [jsaRequired, shiftActive, checkJsaCompletion]);

  const handleJsaLaunch = useCallback(() => {
    launchWBApp({
      name: 'WB JSA',
      scheme: 'jsaapp',
      androidPackage: 'com.syconik801.jsaapp',
    });
  }, [launchWBApp]);

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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <WellBuiltLogo />
        <View style={styles.headerRight}>
          <Pressable onPress={() => router.push('/settings')} style={styles.headerButton}>
            <MaterialCommunityIcons name="cog-outline" size={20} color={colors.text.muted} />
          </Pressable>
          <Pressable onPress={logout} style={[styles.headerButton, styles.logoutHeaderButton]}>
            <MaterialCommunityIcons name="logout" size={20} color="#EF4444" />
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

        <ActionCardRow active={shiftActive} returning={returningToYard} returnStartTime={returnDepartTime} shiftStartTime={shiftStartTime} onStartShift={startShift} onStartReturn={startReturn} onArrived={handleArrived} jsaMode={jsaMode} jsaPending={jsaPending} onJsaLaunch={handleJsaLaunch} />


        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('home.sections.applications')}</Text>
          <Text style={styles.sectionCount}>{t('home.sections.appCount', { count: companyApps.length })}</Text>
        </View>

        <View style={styles.appGrid}>
          {companyApps.map((app, index) => {
            const locked = !isWBAppEnabled(app.id);
            return (
              <AppCard key={app.id} app={app} index={index} locked={locked}
                onPress={() => onPrimaryTap(app)}
                onLongPress={() => onOpenDetails(app.id)}
                onInfoPress={() => onOpenDetails(app.id)}
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
  // Red-tinted variant for the logout button — destructive action, should
  // not blend into the header icon row. Matches WB T's #EF4444 convention.
  logoutHeaderButton: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)' },
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
