import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography } from '@/core/theme';

interface StatItem {
  label: string;
  value: string;
  color?: string;
}

interface StatsBarProps {
  stats: StatItem[];
}

export function StatsBar({ stats }: StatsBarProps) {
  return (
    <View style={styles.container}>
      {stats.map((stat, i) => (
        <View key={stat.label} style={[styles.stat, i < stats.length - 1 && styles.statBorder]}>
          <Text style={[styles.value, stat.color ? { color: stat.color } : null]}>{stat.value}</Text>
          <Text style={styles.label}>{stat.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.md },
  stat: { flex: 1, alignItems: 'center' },
  statBorder: { borderRightWidth: 1, borderRightColor: colors.border.subtle },
  value: { ...typography.h3, color: colors.text.primary, marginBottom: 2 },
  label: { ...typography.caption, color: colors.text.muted },
});
