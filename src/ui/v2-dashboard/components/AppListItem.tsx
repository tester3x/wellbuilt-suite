import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { WellBuiltApp } from '@/core/data/apps';

interface AppListItemProps {
  app: WellBuiltApp;
  onPress: () => void;
}

export function AppListItem({ app, onPress }: AppListItemProps) {
  const { t } = useTranslation();
  const statusLabel = app.status === 'active' ? t('appDetail.meta.active') : app.status === 'beta' ? t('appDetail.meta.beta') : t('appDetail.meta.comingSoon');

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.container, pressed && styles.pressed]}>
      <View style={[styles.iconWrap, { backgroundColor: `${app.color}15` }]}>
        <MaterialCommunityIcons name={app.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={24} color={app.color} />
      </View>
      <View style={styles.info}>
        <Text style={styles.name}>{app.name}</Text>
        <Text style={styles.subtitle}>{app.subtitle}</Text>
      </View>
      <View style={styles.right}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: app.status === 'active' ? colors.status.online : colors.status.warning }]} />
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
        <Text style={styles.version}>v{app.version}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.md, gap: spacing.md },
  pressed: { backgroundColor: colors.bg.elevated, borderColor: colors.border.active },
  iconWrap: { width: 48, height: 48, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' },
  info: { flex: 1 },
  name: { ...typography.body, fontWeight: '600', color: colors.text.primary },
  subtitle: { ...typography.caption, color: colors.text.muted, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { ...typography.caption, color: colors.text.muted, fontSize: 10 },
  version: { ...typography.caption, color: colors.text.muted, fontSize: 10, marginTop: 2 },
});
