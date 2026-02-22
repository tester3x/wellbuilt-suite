import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography } from '@/core/theme';

interface TileContainerProps {
  title?: string;
  children: React.ReactNode;
  rightElement?: React.ReactNode;
}

export function TileContainer({ title, children, rightElement }: TileContainerProps) {
  return (
    <View style={styles.container}>
      {title && (
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          {rightElement}
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  title: { ...typography.label, color: colors.text.muted, fontSize: 10, letterSpacing: 1.5, fontWeight: '700' },
});
