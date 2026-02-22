import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '@/core/theme';

interface StatTileProps {
  icon: string;
  label: string;
  value: string;
  color: string;
}

export function StatTile({ icon, label, value, color }: StatTileProps) {
  return (
    <View style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: `${color}15` }]}>
        <MaterialCommunityIcons name={icon as keyof typeof MaterialCommunityIcons.glyphMap} size={18} color={color} />
      </View>
      <Text style={[styles.value, { color }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '30%', backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.md, alignItems: 'center' },
  iconWrap: { width: 36, height: 36, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.xs },
  value: { ...typography.h3, marginBottom: 2 },
  label: { ...typography.caption, color: colors.text.muted, fontSize: 9, textAlign: 'center' },
});
