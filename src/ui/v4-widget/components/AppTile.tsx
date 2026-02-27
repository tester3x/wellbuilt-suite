import React from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { WellBuiltApp } from '@/core/data/apps';

type TileSize = 'large' | 'medium' | 'small';

interface AppTileProps {
  app: WellBuiltApp;
  size: TileSize;
  onPress: () => void;
  onLongPress?: () => void;
}

export function AppTile({ app, size, onPress, onLongPress }: AppTileProps) {
  const { t } = useTranslation();
  const statusLabel = app.status === 'active' ? t('appDetail.meta.active') : app.status === 'beta' ? t('appDetail.meta.beta') : t('appDetail.meta.comingSoon');

  if (size === 'large') {
    return (
      <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.tileLarge, pressed && styles.tilePressed]}>
        <View style={styles.largeTop}>
          <View style={[styles.largeIcon, { backgroundColor: `${app.color}15` }]}>
            {app.logo ? (
              <Image source={app.logo} style={styles.largeLogoImage} resizeMode="contain" />
            ) : (
              <MaterialCommunityIcons name={app.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={32} color={app.color} />
            )}
          </View>
          <View style={styles.largeStatus}>
            <View style={[styles.statusDot, { backgroundColor: app.status === 'active' ? colors.status.online : colors.status.warning }]} />
            <Text style={styles.statusText}>{statusLabel}</Text>
          </View>
        </View>
        <Text style={styles.largeName}>{app.name}</Text>
        <Text style={styles.largeSubtitle} numberOfLines={2}>{app.subtitle}</Text>
        <Text style={styles.version}>v{app.version}</Text>
      </Pressable>
    );
  }

  if (size === 'medium') {
    return (
      <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.tileMedium, pressed && styles.tilePressed]}>
        <View style={[styles.mediumIcon, { backgroundColor: `${app.color}15` }]}>
          {app.logo ? (
            <Image source={app.logo} style={styles.mediumLogoImage} resizeMode="contain" />
          ) : (
            <MaterialCommunityIcons name={app.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={24} color={app.color} />
          )}
        </View>
        <Text style={styles.mediumName} numberOfLines={1}>{app.shortName}</Text>
        <View style={styles.mediumBottom}>
          <View style={[styles.statusDot, { backgroundColor: app.status === 'active' ? colors.status.online : colors.status.warning }]} />
          <Text style={styles.mediumStatus}>{statusLabel}</Text>
        </View>
      </Pressable>
    );
  }

  // small
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.tileSmall, pressed && styles.tilePressed]}>
      <View style={[styles.smallIcon, { backgroundColor: `${app.color}15` }]}>
        <MaterialCommunityIcons name={app.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={20} color={app.color} />
      </View>
      <Text style={styles.smallName} numberOfLines={1}>{app.shortName}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tilePressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },

  // Large tile (full width)
  tileLarge: { width: '100%', backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.lg },
  largeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.md },
  largeIcon: { width: 56, height: 56, borderRadius: radius.lg, justifyContent: 'center', alignItems: 'center' },
  largeLogoImage: { width: 36, height: 36 },
  largeStatus: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  largeName: { ...typography.h3, color: colors.text.primary, marginBottom: 4 },
  largeSubtitle: { ...typography.bodySmall, color: colors.text.muted, marginBottom: spacing.sm },
  version: { ...typography.caption, color: colors.text.muted, fontSize: 10 },

  // Medium tile (~48%)
  tileMedium: { width: '48%', backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.md, alignItems: 'center' },
  mediumIcon: { width: 44, height: 44, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.sm },
  mediumLogoImage: { width: 28, height: 28 },
  mediumName: { ...typography.body, fontWeight: '600', color: colors.text.primary, marginBottom: spacing.xs, textAlign: 'center' },
  mediumBottom: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mediumStatus: { ...typography.caption, color: colors.text.muted, fontSize: 9 },

  // Small tile (~30%)
  tileSmall: { width: '30%', backgroundColor: colors.bg.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.sm, alignItems: 'center' },
  smallIcon: { width: 36, height: 36, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  smallName: { ...typography.caption, color: colors.text.muted, fontSize: 10, textAlign: 'center' },

  // Common
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { ...typography.caption, color: colors.text.muted, fontSize: 10 },
});
