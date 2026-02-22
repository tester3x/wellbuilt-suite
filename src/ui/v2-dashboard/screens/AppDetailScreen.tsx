import React, { useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet, ScrollView, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { wellbuiltApps } from '@/core/data/apps';
import { useAppLauncher } from '@/core/hooks';

export default function AppDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const app = wellbuiltApps.find(a => a.id === id);
  const { canLaunchApp, launchWBApp } = useAppLauncher();
  const [canLaunch, setCanLaunch] = useState<boolean | null>(null);

  useEffect(() => { canLaunchApp(app?.scheme).then(setCanLaunch); }, [app?.scheme]);

  if (!app) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{t('appDetail.notFound')}</Text>
      </View>
    );
  }

  const handleLaunch = () => launchWBApp({ name: app.name, scheme: app.scheme, androidPackage: app.androidPackage });
  const platformLabel = app.platform === 'web' ? t('appDetail.meta.webApp') : t('appDetail.meta.mobileApp');
  const statusLabel = app.status === 'active' ? t('appDetail.meta.active') : app.status === 'beta' ? t('appDetail.meta.beta') : t('appDetail.meta.comingSoon');

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={24} color={colors.text.primary} />
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={styles.headerStatusDot} />
          <Text style={styles.headerTitle}>{t('appDetail.headerTitle')}</Text>
        </View>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={[styles.heroIcon, { backgroundColor: `${app.color}20` }]}>
              {app.logo ? (
                <Image source={app.logo} style={styles.heroLogoImage} resizeMode="contain" />
              ) : (
                <MaterialCommunityIcons name={app.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={36} color={app.color} />
              )}
            </View>
            <View style={styles.heroInfo}>
              <Text style={styles.heroName}>{app.name}</Text>
              <Text style={styles.heroSubtitle}>{app.subtitle}</Text>
              <View style={styles.heroMeta}>
                <View style={[styles.statusBadge, { backgroundColor: app.status === 'active' ? `${colors.status.online}20` : `${colors.status.warning}20` }]}>
                  <View style={[styles.statusDot, { backgroundColor: app.status === 'active' ? colors.status.online : colors.status.warning }]} />
                  <Text style={[styles.statusText, { color: app.status === 'active' ? colors.status.online : colors.status.warning }]}>{statusLabel}</Text>
                </View>
                <Text style={styles.versionText}>v{app.version}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialCommunityIcons name="information-outline" size={14} color={colors.text.muted} />
            <Text style={styles.sectionTitle}>{t('appDetail.about')}</Text>
          </View>
          <Text style={styles.description}>{app.description}</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialCommunityIcons name="format-list-checks" size={14} color={colors.text.muted} />
            <Text style={styles.sectionTitle}>{t('appDetail.features')}</Text>
          </View>
          <View style={styles.featureCard}>
            {app.features.map((feature, idx) => (
              <View key={idx} style={styles.featureRow}>
                <MaterialCommunityIcons name="check-circle" size={16} color={app.color} />
                <Text style={styles.featureText}>{feature}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialCommunityIcons name="cog-outline" size={14} color={colors.text.muted} />
            <Text style={styles.sectionTitle}>{t('appDetail.technical')}</Text>
          </View>
          <View style={styles.techGrid}>
            <View style={styles.techRow}>
              <View style={styles.techItem}>
                <Text style={styles.techLabel}>{t('appDetail.platform')}</Text>
                <Text style={styles.techValue}>{platformLabel}</Text>
              </View>
              <View style={styles.techItem}>
                <Text style={styles.techLabel}>{t('appDetail.backend')}</Text>
                <Text style={styles.techValue}>{t('appDetail.values.backendValue')}</Text>
              </View>
            </View>
            <View style={styles.techRow}>
              <View style={styles.techItem}>
                <Text style={styles.techLabel}>{t('appDetail.auth')}</Text>
                <Text style={styles.techValue}>{t('appDetail.values.authValue')}</Text>
              </View>
              <View style={styles.techItem}>
                <Text style={styles.techLabel}>{t('appDetail.sync')}</Text>
                <Text style={styles.techValue}>{t('appDetail.values.syncValue')}</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.launchBar, { paddingBottom: insets.bottom + spacing.md }]}>
        {canLaunch === false && app.scheme && (
          <View style={styles.notInstalledBanner}>
            <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.status.warning} />
            <Text style={styles.notInstalledText}>{t('appDetail.launch.notDetected')}</Text>
          </View>
        )}
        <Pressable onPress={handleLaunch} style={({ pressed }) => [styles.launchButton, pressed && styles.launchButtonPressed]}>
          <LinearGradient colors={[app.color, `${app.color}CC`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.launchGradient}>
            <MaterialCommunityIcons name={canLaunch ? 'launch' : app.scheme ? 'download' : 'lock-outline'} size={20} color={colors.text.inverse} />
            <Text style={styles.launchText}>
              {canLaunch || app.scheme ? t('appDetail.launch.open', { name: app.name }) : t('appDetail.launch.notAvailable')}
            </Text>
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border.subtle, backgroundColor: colors.bg.secondary },
  backButton: { width: 40, height: 40, borderRadius: radius.full, justifyContent: 'center', alignItems: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.status.online },
  headerTitle: { ...typography.body, fontWeight: '600', color: colors.text.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: 120 },
  errorText: { ...typography.body, color: colors.status.error, textAlign: 'center', marginTop: spacing.xxl },
  hero: { backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.lg, marginBottom: spacing.lg },
  heroTop: { flexDirection: 'row', gap: spacing.md },
  heroIcon: { width: 64, height: 64, borderRadius: radius.lg, justifyContent: 'center', alignItems: 'center' },
  heroLogoImage: { width: 42, height: 42 },
  heroInfo: { flex: 1 },
  heroName: { ...typography.h2, color: colors.text.primary, marginBottom: 2 },
  heroSubtitle: { ...typography.bodySmall, color: colors.text.muted, marginBottom: spacing.sm },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { ...typography.caption, fontWeight: '600', fontSize: 10 },
  versionText: { ...typography.caption, color: colors.text.muted, fontSize: 10 },
  section: { marginBottom: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  sectionTitle: { ...typography.label, color: colors.text.muted },
  description: { ...typography.body, color: colors.text.secondary, lineHeight: 26 },
  featureCard: { backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.md, gap: spacing.sm },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  featureText: { ...typography.bodySmall, color: colors.text.secondary, flex: 1 },
  techGrid: { backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.md, gap: spacing.md },
  techRow: { flexDirection: 'row', gap: spacing.md },
  techItem: { flex: 1, backgroundColor: colors.bg.primary, borderRadius: radius.md, padding: spacing.sm },
  techLabel: { ...typography.caption, color: colors.text.muted, fontSize: 9, marginBottom: 4 },
  techValue: { ...typography.bodySmall, color: colors.text.primary, fontWeight: '500' },
  launchBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.bg.primary, borderTopWidth: 1, borderTopColor: colors.border.subtle },
  notInstalledBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  notInstalledText: { ...typography.caption, color: colors.status.warning },
  launchButton: { borderRadius: radius.md, overflow: 'hidden' },
  launchButtonPressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  launchGradient: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.sm },
  launchText: { ...typography.body, fontWeight: '700', color: colors.text.inverse },
});
