import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useGreeting } from '@/core/hooks/useGreeting';
import { useHomeWorkhorse } from '@/core/context/HomeWorkhorseContext';
import { WellBuiltLogo } from '@/ui/shared/WellBuiltLogo';
import { AppCard } from '../components/AppCard';
import { ActionCardRow } from '@/ui/shared/ActionCardRow';
import type { WellBuiltApp } from '@/core/data/apps';

export default function HomeScreen() {
  const { t } = useTranslation();
  const home = useHomeWorkhorse();
  const insets = useSafeAreaInsets();
  const greeting = useGreeting();

  if (!home.session) return null;

  const session = home.session;
  const roleLabel = t(`home.roles.${session.role}`);
  const showTierBanner = home.live.showTierBanner;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <WellBuiltLogo />
        <View style={styles.headerRight}>
          {home.groups.chrome.map((action) => (
            <Pressable
              key={action.id}
              onPress={() => { void home.invoke(action.id); }}
              style={[styles.headerButton, action.role === 'logout' && styles.logoutHeaderButton]}
            >
              <MaterialCommunityIcons
                name={action.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                size={20}
                color={action.role === 'logout' ? '#EF4444' : colors.text.muted}
              />
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.welcomeSection}>
          <Text style={styles.greeting}>{greeting},</Text>
          <Text style={styles.userName}>{session.displayName}</Text>
          <View style={styles.roleRow}>
            <View style={[styles.roleBadge, {
              backgroundColor: session.role === 'admin' ? `${colors.brand.accent}20` :
                session.role === 'viewer' ? `${colors.status.online}20` : `${colors.brand.primary}20`,
            }]}>
              <Text style={[styles.roleText, {
                color: session.role === 'admin' ? colors.brand.accent :
                  session.role === 'viewer' ? colors.status.online : colors.brand.primary,
              }]}>{roleLabel}</Text>
            </View>
            {session.companyName ? (
              <Text style={styles.companyText}>{session.companyName}</Text>
            ) : null}
          </View>
        </View>

        {showTierBanner && (
          <View style={styles.tierBanner}>
            <View style={styles.tierBannerLeft}>
              <MaterialCommunityIcons name="shield-star-outline" size={18} color={colors.brand.accent} />
              <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                <Text style={styles.tierBannerTitle}>{home.live.tierLabel} {t('home.tier.plan')}</Text>
                <Text style={styles.tierBannerDesc}>
                  {home.live.tierDescription}
                </Text>
              </View>
            </View>
            <View style={styles.tierBadge}>
              <Text style={styles.tierBadgeText}>{home.live.enabledApplicationCount}/{home.live.applicationCount}</Text>
            </View>
          </View>
        )}

        <ActionCardRow />

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('home.sections.applications')}</Text>
          <Text style={styles.sectionCount}>{t('home.sections.appCount', { count: home.live.applicationCount })}</Text>
        </View>

        <View style={styles.appGrid}>
          {home.groups.applications.map((action, index) => {
            if (!action.app) return null;
            return (
              <AppCard
                key={action.id}
                app={action.app as WellBuiltApp}
                index={index}
                locked={action.locked}
                onPress={() => { void home.invoke(action.id); }}
                onLongPress={() => { void home.invoke(action.id, 'inspect'); }}
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
