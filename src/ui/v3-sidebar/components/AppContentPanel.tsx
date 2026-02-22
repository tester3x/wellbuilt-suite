import React from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { WellBuiltApp } from '@/core/data/apps';

interface AppContentPanelProps {
  app: WellBuiltApp;
  canLaunch: boolean | null;
  onLaunch: () => void;
}

export function AppContentPanel({ app, canLaunch, onLaunch }: AppContentPanelProps) {
  const { t } = useTranslation();
  const statusLabel = app.status === 'active' ? t('appDetail.meta.active') : app.status === 'beta' ? t('appDetail.meta.beta') : t('appDetail.meta.comingSoon');
  const platformLabel = app.platform === 'web' ? t('appDetail.meta.webApp') : t('appDetail.meta.mobileApp');

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={[styles.iconWrap, { backgroundColor: `${app.color}20` }]}>
          {app.logo ? (
            <Image source={app.logo} style={styles.logoImage} resizeMode="contain" />
          ) : (
            <MaterialCommunityIcons name={app.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={32} color={app.color} />
          )}
        </View>
        <View style={styles.topInfo}>
          <Text style={styles.appName}>{app.name}</Text>
          <Text style={styles.appSubtitle}>{app.subtitle}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.statusBadge, { backgroundColor: app.status === 'active' ? `${colors.status.online}20` : `${colors.status.warning}20` }]}>
              <View style={[styles.statusDot, { backgroundColor: app.status === 'active' ? colors.status.online : colors.status.warning }]} />
              <Text style={[styles.statusText, { color: app.status === 'active' ? colors.status.online : colors.status.warning }]}>{statusLabel}</Text>
            </View>
            <Text style={styles.metaText}>{platformLabel}</Text>
            <Text style={styles.metaText}>v{app.version}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('appDetail.about')}</Text>
        <Text style={styles.description}>{app.description}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('appDetail.features')}</Text>
        <View style={styles.featureGrid}>
          {app.features.map((feature, idx) => (
            <View key={idx} style={styles.featureItem}>
              <MaterialCommunityIcons name="check-circle" size={14} color={app.color} />
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('appDetail.technical')}</Text>
        <View style={styles.techRow}>
          <View style={styles.techItem}>
            <Text style={styles.techLabel}>{t('appDetail.platform')}</Text>
            <Text style={styles.techValue}>{app.platform === 'web' ? t('appDetail.values.webPlatform') : t('appDetail.values.mobilePlatform')}</Text>
          </View>
          <View style={styles.techItem}>
            <Text style={styles.techLabel}>{t('appDetail.backend')}</Text>
            <Text style={styles.techValue}>{t('appDetail.values.backendValue')}</Text>
          </View>
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

      {canLaunch === false && app.scheme && (
        <View style={styles.notInstalledBanner}>
          <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.status.warning} />
          <Text style={styles.notInstalledText}>{t('appDetail.launch.notDetected')}</Text>
        </View>
      )}

      <Pressable onPress={onLaunch} style={({ pressed }) => [styles.launchButton, pressed && styles.launchButtonPressed]}>
        <LinearGradient colors={[app.color, `${app.color}CC`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.launchGradient}>
          <MaterialCommunityIcons name={canLaunch ? 'launch' : app.scheme ? 'download' : 'lock-outline'} size={20} color={colors.text.inverse} />
          <Text style={styles.launchText}>
            {canLaunch || app.scheme ? t('appDetail.launch.open', { name: app.name }) : t('appDetail.launch.notAvailable')}
          </Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  topRow: { flexDirection: 'row', gap: spacing.md },
  iconWrap: { width: 64, height: 64, borderRadius: radius.lg, justifyContent: 'center', alignItems: 'center' },
  logoImage: { width: 42, height: 42 },
  topInfo: { flex: 1 },
  appName: { ...typography.h2, color: colors.text.primary, marginBottom: 2 },
  appSubtitle: { ...typography.bodySmall, color: colors.text.muted, marginBottom: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { ...typography.caption, fontWeight: '600', fontSize: 10 },
  metaText: { ...typography.caption, color: colors.text.muted },
  section: {},
  sectionTitle: { ...typography.label, color: colors.text.muted, marginBottom: spacing.sm },
  description: { ...typography.body, color: colors.text.secondary, lineHeight: 26 },
  featureGrid: { gap: spacing.sm },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  featureText: { ...typography.bodySmall, color: colors.text.secondary, flex: 1 },
  techRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  techItem: { flex: 1, minWidth: '40%', backgroundColor: colors.bg.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.sm },
  techLabel: { ...typography.caption, color: colors.text.muted, fontSize: 9, marginBottom: 4 },
  techValue: { ...typography.bodySmall, color: colors.text.primary, fontWeight: '500' },
  notInstalledBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  notInstalledText: { ...typography.caption, color: colors.status.warning },
  launchButton: { borderRadius: radius.md, overflow: 'hidden' },
  launchButtonPressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  launchGradient: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.sm },
  launchText: { ...typography.body, fontWeight: '700', color: colors.text.inverse },
});
