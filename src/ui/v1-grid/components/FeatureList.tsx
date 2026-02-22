import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/core/theme';

interface FeatureListProps {
  features: string[];
  color: string;
}

export function FeatureList({ features, color }: FeatureListProps) {
  return (
    <View style={styles.container}>
      {features.map((feature) => (
        <View key={feature} style={styles.row}>
          <MaterialCommunityIcons name="check-circle" size={18} color={color} />
          <Text style={styles.text}>{feature}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm + 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { ...typography.bodySmall, color: colors.text.secondary, flex: 1 },
});
