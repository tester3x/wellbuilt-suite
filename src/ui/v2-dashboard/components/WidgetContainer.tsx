import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography } from '@/core/theme';

interface WidgetContainerProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  rightElement?: React.ReactNode;
}

export function WidgetContainer({ title, subtitle, children, rightElement }: WidgetContainerProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{title}</Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
        {rightElement}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  title: { ...typography.label, color: colors.text.muted },
  subtitle: { ...typography.caption, color: colors.text.muted, fontSize: 10, marginTop: 1 },
});
