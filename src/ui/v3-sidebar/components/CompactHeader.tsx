import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '@/core/theme';

interface CompactHeaderProps {
  title: string;
  onBack?: () => void;
  rightElement?: React.ReactNode;
}

export function CompactHeader({ title, onBack, rightElement }: CompactHeaderProps) {
  return (
    <View style={styles.container}>
      {onBack ? (
        <Pressable onPress={onBack} style={styles.backBtn}>
          <MaterialCommunityIcons name="chevron-left" size={22} color={colors.text.primary} />
        </Pressable>
      ) : (
        <View style={styles.backBtn} />
      )}
      <Text style={styles.title}>{title}</Text>
      {rightElement || <View style={styles.backBtn} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  backBtn: { width: 36, height: 36, borderRadius: radius.full, justifyContent: 'center', alignItems: 'center' },
  title: { ...typography.body, fontWeight: '600', color: colors.text.primary },
});
