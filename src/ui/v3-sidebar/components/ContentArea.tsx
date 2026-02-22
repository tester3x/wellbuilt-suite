import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { colors, spacing, typography } from '@/core/theme';

interface ContentAreaProps {
  title?: string;
  children: React.ReactNode;
}

export function ContentArea({ title, children }: ContentAreaProps) {
  return (
    <View style={styles.container}>
      {title && (
        <View style={styles.titleBar}>
          <Text style={styles.title}>{title}</Text>
        </View>
      )}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  titleBar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  title: { ...typography.h3, color: colors.text.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
});
