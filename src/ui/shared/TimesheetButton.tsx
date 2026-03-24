// Shared timesheet quick-link button for all HomeScreen skins.
// Shows on all screens below the ShiftButton.

import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { colors, spacing, radius, typography } from '@/core/theme';

export function TimesheetButton() {
  const { t } = useTranslation();
  return (
    <Pressable onPress={() => router.push('/timesheet')} style={s.container}>
      <MaterialCommunityIcons name="cash-multiple" size={20} color="#34D399" />
      <View style={s.textContainer}>
        <Text style={s.label}>{t('actionCard.timesheet')}</Text>
        <Text style={s.action}>{t('actionCard.viewPay')}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.muted} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: 'rgba(52, 211, 153, 0.06)',
    borderColor: 'rgba(52, 211, 153, 0.15)',
    marginBottom: spacing.md,
  },
  textContainer: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  label: {
    ...typography.bodySmall,
    color: '#34D399',
    fontWeight: '700',
  },
  action: {
    ...typography.caption,
    color: 'rgba(52, 211, 153, 0.6)',
    marginTop: 1,
  },
});
