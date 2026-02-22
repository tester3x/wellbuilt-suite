import React from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { WellBuiltApp } from '@/core/data/apps';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - spacing.lg * 2 - spacing.md) / 2;

interface AppCardProps {
  app: WellBuiltApp;
  onPress: () => void;
  index: number;
}

export function AppCard({ app, onPress, index }: AppCardProps) {
  const { t } = useTranslation();
  const isLeftColumn = index % 2 === 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.container, { marginRight: isLeftColumn ? spacing.md : 0 },
        pressed && styles.pressed,
      ]}
    >
      <LinearGradient
        colors={colors.gradient[app.gradientKey] as unknown as [string, string]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={[styles.iconContainer, { backgroundColor: `${app.color}20` }]}>
          <MaterialCommunityIcons
            name={app.icon as keyof typeof MaterialCommunityIcons.glyphMap}
            size={28} color={app.color}
          />
        </View>
        <Text style={styles.name} numberOfLines={1}>{app.shortName}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{app.subtitle}</Text>
        <View style={styles.footer}>
          <View style={[styles.statusDot, {
            backgroundColor: app.status === 'active' ? colors.status.online
              : app.status === 'beta' ? colors.status.warning : colors.status.offline,
          }]} />
          <Text style={styles.version}>v{app.version}</Text>
        </View>
        <View style={[styles.platformBadge, { borderColor: `${app.color}30` }]}>
          <MaterialCommunityIcons
            name={app.platform === 'web' ? 'web' : app.platform === 'both' ? 'devices' : 'cellphone'}
            size={10} color={colors.text.muted}
          />
          <Text style={styles.platformText}>
            {app.platform === 'web' ? t('appCard.web') : app.platform === 'both' ? t('appCard.all') : t('appCard.mobile')}
          </Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { width: CARD_WIDTH, marginBottom: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle, overflow: 'hidden' },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  gradient: { padding: spacing.md, minHeight: 170, justifyContent: 'space-between' },
  iconContainer: { width: 48, height: 48, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md },
  name: { ...typography.h3, color: colors.text.primary, marginBottom: 2 },
  subtitle: { ...typography.caption, color: colors.text.muted, marginBottom: spacing.md },
  footer: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: spacing.xs },
  version: { ...typography.caption, color: colors.text.muted, fontSize: 11 },
  platformBadge: { position: 'absolute', top: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1, gap: 3 },
  platformText: { fontSize: 9, fontWeight: '600', color: colors.text.muted },
});
