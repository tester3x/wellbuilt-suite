import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';

interface QuickLinkCardProps {
  name: string;
  icon: string;
  color: string;
  onPress: () => void;
  onLongPress?: () => void;
}

// Use TouchableOpacity instead of Pressable — Pressable's onLongPress
// gets swallowed by parent horizontal ScrollView gesture handler.
// TouchableOpacity handles this correctly.
export function QuickLinkCard({ name, icon, color, onPress, onLongPress }: QuickLinkCardProps) {
  return (
    <TouchableOpacity onPress={onPress} onLongPress={onLongPress}
      delayLongPress={400} activeOpacity={0.7} style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: `${color}20` }]}>
        <MaterialCommunityIcons name={icon as keyof typeof MaterialCommunityIcons.glyphMap} size={22} color={color} />
      </View>
      <Text style={styles.name} numberOfLines={1}>{name}</Text>
    </TouchableOpacity>
  );
}

interface AddAppCardProps {
  onPress: () => void;
}

export function AddAppCard({ onPress }: AddAppCardProps) {
  const { t } = useTranslation();
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
      style={[styles.container, styles.addContainer]}>
      <View style={[styles.iconWrap, styles.addIconWrap]}>
        <MaterialCommunityIcons name="plus" size={22} color={colors.text.muted} />
      </View>
      <Text style={[styles.name, styles.addName]}>{t('common.add')}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', width: 72, gap: spacing.xs },
  iconWrap: { width: 52, height: 52, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border.subtle },
  name: { ...typography.caption, color: colors.text.secondary, textAlign: 'center' },
  addContainer: {},
  addIconWrap: { backgroundColor: colors.bg.card, borderStyle: 'dashed', borderColor: colors.border.default },
  addName: { color: colors.text.muted },
});
