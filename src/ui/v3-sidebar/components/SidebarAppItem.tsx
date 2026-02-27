import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { WellBuiltApp } from '@/core/data/apps';

interface SidebarAppItemProps {
  app: WellBuiltApp;
  onPress: () => void;
  onLongPress?: () => void;
}

export function SidebarAppItem({ app, onPress, onLongPress }: SidebarAppItemProps) {
  const { t } = useTranslation();
  const statusLabel = app.status === 'active' ? t('appDetail.meta.active') : app.status === 'beta' ? t('appDetail.meta.beta') : t('appDetail.meta.comingSoon');

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.container, pressed && styles.pressed]}>
      <View style={[styles.iconWrap, { backgroundColor: `${app.color}15` }]}>
        <MaterialCommunityIcons name={app.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={16} color={app.color} />
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{app.shortName}</Text>
        <Text style={styles.status} numberOfLines={1}>{statusLabel}</Text>
      </View>
      <View style={[styles.statusDot, { backgroundColor: app.status === 'active' ? colors.status.online : colors.status.warning }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.md, marginBottom: 2 },
  pressed: { backgroundColor: colors.bg.card },
  iconWrap: { width: 30, height: 30, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center' },
  info: { flex: 1 },
  name: { ...typography.bodySmall, fontWeight: '600', color: colors.text.primary, fontSize: 13 },
  status: { ...typography.caption, color: colors.text.muted, fontSize: 9, marginTop: 1 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
});
