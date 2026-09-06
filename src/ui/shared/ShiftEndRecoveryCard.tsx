// ShiftEndRecoveryCard — truthful End Shift recovery for a shift that is in the
// returning-to-yard state but has NO vehicle/DVIR (Post-Trip) obligation.
//
// It never says "Mark Arrived" and never implies an arrival: the work shift can
// be ended directly. While the obligation is still being verified it shows a
// neutral checking/verify state and never offers a false arrival action.

import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius } from '@/core/theme';

type RecoveryMode = 'end' | 'verify' | 'checking';

interface ShiftEndRecoveryCardProps {
  mode: RecoveryMode;
  returnStartTime: string | null;
  /** Authoritative origin day of the open period (YYYY-MM-DD) — truthful, from the server. */
  originDate?: string | null;
  onEndShift: () => void;
  onRetry: () => void;
}

export default function ShiftEndRecoveryCard({ mode, originDate, onEndShift, onRetry }: ShiftEndRecoveryCardProps) {
  const { t } = useTranslation();

  if (mode === 'checking') {
    return (
      <View style={s.container}>
        <View style={s.header}>
          <ActivityIndicator size="small" color={colors.text.muted} />
          <Text style={s.checkingLabel}>{t('shift.verifyingStatus')}</Text>
        </View>
      </View>
    );
  }

  if (mode === 'verify') {
    return (
      <View style={s.container}>
        <View style={s.header}>
          <MaterialCommunityIcons name="clock-alert-outline" size={18} color={colors.status.warning} />
          <Text style={s.verifyLabel}>{t('shift.verifyingStatus')}</Text>
        </View>
        <Pressable onPress={onRetry} style={s.retryButton}>
          <MaterialCommunityIcons name="refresh" size={16} color={colors.brand.primary} />
          <Text style={s.retryText}>{t('shift.verifyRetry')}</Text>
        </Pressable>
      </View>
    );
  }

  // mode === 'end'
  return (
    <View style={s.container}>
      <View style={s.header}>
        <MaterialCommunityIcons name="clock-outline" size={18} color={colors.status.warning} />
        <Text style={s.title}>{t('shift.endShiftOpenTitle')}</Text>
        {/* Truthful authoritative origin day (never the local drive timer). */}
        {originDate ? (
          <Text style={s.timer}>{`${t('shift.startedOn')} ${originDate}`}</Text>
        ) : null}
      </View>
      <Pressable onPress={onEndShift} style={s.endButton}>
        <MaterialCommunityIcons name="clock-check-outline" size={18} color="#000" />
        <Text style={s.endText}>{t('shift.endShiftAction')}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: colors.bg.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  title: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  checkingLabel: {
    color: colors.text.muted,
    fontSize: 13,
    flex: 1,
  },
  verifyLabel: {
    color: colors.text.secondary,
    fontSize: 13,
    flex: 1,
  },
  timer: {
    color: colors.text.muted,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  endButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.status.warning,
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  endText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: `${colors.brand.primary}20`,
    borderRadius: radius.md,
    paddingVertical: 10,
  },
  retryText: {
    color: colors.brand.primary,
    fontSize: 14,
    fontWeight: '600',
  },
});
