import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';

interface CommandHeaderProps {
  title: string;
  subtitle?: string;
  onSettings?: () => void;
  onAction?: () => void;
  actionIcon?: string;
}

export function CommandHeader({ title, subtitle, onSettings, onAction, actionIcon }: CommandHeaderProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <View style={styles.statusRow}>
        <View style={styles.statusDot} />
        <Text style={styles.statusText}>SYSTEM ONLINE</Text>
      </View>
      <View style={styles.titleRow}>
        <View>
          <Text style={styles.title}>{title}</Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
        <View style={styles.actions}>
          {onSettings && (
            <Pressable onPress={onSettings} style={styles.actionBtn}>
              <MaterialCommunityIcons name="cog-outline" size={20} color={colors.text.muted} />
            </Pressable>
          )}
          {onAction && (
            <Pressable onPress={onAction} style={styles.actionBtn}>
              <MaterialCommunityIcons name={(actionIcon || 'logout') as keyof typeof MaterialCommunityIcons.glyphMap} size={20} color={colors.text.muted} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border.subtle, backgroundColor: colors.bg.secondary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.status.online },
  statusText: { ...typography.caption, color: colors.status.online, fontSize: 9, letterSpacing: 1.5, fontWeight: '700' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...typography.h2, color: colors.text.primary },
  subtitle: { ...typography.caption, color: colors.text.muted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.bg.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border.subtle },
});
