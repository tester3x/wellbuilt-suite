import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '@/core/theme';

interface StatWidget {
  icon: string;
  label: string;
  value: string;
  color: string;
}

interface DashboardStatsPanelProps {
  stats: StatWidget[];
}

export function DashboardStatsPanel({ stats }: DashboardStatsPanelProps) {
  return (
    <View style={styles.container}>
      {stats.map((stat) => (
        <View key={stat.label} style={styles.widget}>
          <View style={[styles.iconWrap, { backgroundColor: `${stat.color}15` }]}>
            <MaterialCommunityIcons name={stat.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={20} color={stat.color} />
          </View>
          <Text style={[styles.value, { color: stat.color }]}>{stat.value}</Text>
          <Text style={styles.label}>{stat.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', gap: spacing.sm },
  widget: { flex: 1, backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.md, alignItems: 'center' },
  iconWrap: { width: 40, height: 40, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.sm },
  value: { ...typography.h2, marginBottom: 2 },
  label: { ...typography.caption, color: colors.text.muted, textAlign: 'center' },
});
