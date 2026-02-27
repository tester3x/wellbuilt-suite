import React from 'react';
import { View, Text, Image, StyleSheet, ScrollView, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { wellbuiltApps } from '@/core/data/apps';
import { useAppLauncher, useFirstLaunch } from '@/core/hooks';

export default function AppDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const app = wellbuiltApps.find(a => a.id === id);
  const { launchWBApp } = useAppLauncher();
  const { markLaunched } = useFirstLaunch();

  if (!app) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{t('appDetail.notFound')}</Text>
      </View>
    );
  }

  const handleLaunch = () => {
    markLaunched(app.id);
    launchWBApp({ name: app.name, scheme: app.scheme, androidPackage: app.androidPackage, webUrl: app.webUrl });
  };
  const isWebApp = app.platform === 'web';
  const platformLabel = app.platform === 'web' ? t('appDetail.meta.webApp') : t('appDetail.meta.mobileApp');
  const statusLabel = app.status === 'active' ? t('appDetail.meta.active') : app.status === 'beta' ? t('appDetail.meta.beta') : t('appDetail.meta.comingSoon');

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={24} color={colors.text.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('appDetail.headerTitle')}</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero tile */}
        <View style={styles.heroTile}>
          <View style={[styles.heroIcon, { backgroundColor: `${app.color}20` }]}>
            {app.logo ? (
              <Image source={app.logo} style={styles.heroLogoImage} resizeMode="contain" />
            ) : (
              <MaterialCommunityIcons name={app.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={40} color={app.color} />
            )}
          </View>
          <Text style={styles.heroName}>{app.name}</Text>
          <Text style={styles.heroSubtitle}>{app.subtitle}</Text>
          <View style={styles.heroMeta}>
            <View style={[styles.metaBadge, { backgroundColor: `${app.color}15` }]}>
              <Text style={[styles.metaBadgeText, { color: app.color }]}>{platformLabel}</Text>
            </View>
            <View style={[styles.metaBadge, { backgroundColor: app.status === 'active' ? `${colors.status.online}15` : `${colors.status.warning}15` }]}>
              <View style={[styles.statusDot, { backgroundColor: app.status === 'active' ? colors.status.online : colors.status.warning }]} />
              <Text style={[styles.metaBadgeText, { color: app.status === 'active' ? colors.status.online : colors.status.warning }]}>{statusLabel}</Text>
            </View>
            <View style={[styles.metaBadge, { backgroundColor: `${colors.text.muted}15` }]}>
              <Text style={[styles.metaBadgeText, { color: colors.text.muted }]}>v{app.version}</Text>
            </View>
          </View>
        </View>

        {/* About tile */}
        <View style={styles.infoTile}>
          <Text style={styles.tileTitle}>{t('appDetail.about')}</Text>
          <Text style={styles.description}>{app.description}</Text>
        </View>

        {/* Features tile */}
        <View style={styles.infoTile}>
          <Text style={styles.tileTitle}>{t('appDetail.features')}</Text>
          {app.features.map((feature, idx) => (
            <View key={idx} style={styles.featureRow}>
              <MaterialCommunityIcons name="check-circle" size={16} color={app.color} />
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>

        {/* Tech tiles */}
        <View style={styles.techGrid}>
          <View style={styles.techTile}>
            <Text style={styles.techLabel}>{t('appDetail.platform')}</Text>
            <Text style={styles.techValue}>{app.platform === 'web' ? t('appDetail.values.webPlatform') : t('appDetail.values.mobilePlatform')}</Text>
          </View>
          <View style={styles.techTile}>
            <Text style={styles.techLabel}>{t('appDetail.backend')}</Text>
            <Text style={styles.techValue}>{t('appDetail.values.backendValue')}</Text>
          </View>
          <View style={styles.techTile}>
            <Text style={styles.techLabel}>{t('appDetail.auth')}</Text>
            <Text style={styles.techValue}>{t('appDetail.values.authValue')}</Text>
          </View>
          <View style={styles.techTile}>
            <Text style={styles.techLabel}>{t('appDetail.sync')}</Text>
            <Text style={styles.techValue}>{t('appDetail.values.syncValue')}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.launchBar, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable onPress={handleLaunch} style={({ pressed }) => [styles.launchButton, pressed && styles.launchButtonPressed]}>
          <LinearGradient colors={[app.color, `${app.color}CC`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.launchGradient}>
            <MaterialCommunityIcons name={isWebApp ? 'web' : 'launch'} size={20} color={colors.text.inverse} />
            <Text style={styles.launchText}>
              {isWebApp ? t('appDetail.launch.openBrowser', { name: app.name, defaultValue: 'Open in Browser' }) : t('appDetail.launch.open', { name: app.name })}
            </Text>
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  backButton: { width: 40, height: 40, borderRadius: radius.full, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { ...typography.body, fontWeight: '600', color: colors.text.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: 120, gap: spacing.md },
  errorText: { ...typography.body, color: colors.status.error, textAlign: 'center', marginTop: spacing.xxl },

  heroTile: { backgroundColor: colors.bg.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.xl, alignItems: 'center' },
  heroIcon: { width: 72, height: 72, borderRadius: radius.xl, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md },
  heroLogoImage: { width: 48, height: 48 },
  heroName: { ...typography.h2, color: colors.text.primary, marginBottom: 4 },
  heroSubtitle: { ...typography.bodySmall, color: colors.text.muted, marginBottom: spacing.md },
  heroMeta: { flexDirection: 'row', gap: spacing.sm },
  metaBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  metaBadgeText: { ...typography.caption, fontWeight: '600', fontSize: 10 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },

  infoTile: { backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.lg },
  tileTitle: { ...typography.label, color: colors.text.muted, marginBottom: spacing.sm },
  description: { ...typography.body, color: colors.text.secondary, lineHeight: 26 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  featureText: { ...typography.bodySmall, color: colors.text.secondary, flex: 1 },

  techGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  techTile: { width: '48%', backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.md },
  techLabel: { ...typography.caption, color: colors.text.muted, fontSize: 9, marginBottom: 4 },
  techValue: { ...typography.body, color: colors.text.primary, fontWeight: '500' },

  launchBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.bg.primary, borderTopWidth: 1, borderTopColor: colors.border.subtle },
  launchButton: { borderRadius: radius.md, overflow: 'hidden' },
  launchButtonPressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  launchGradient: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.sm },
  launchText: { ...typography.body, fontWeight: '700', color: colors.text.inverse },
});
