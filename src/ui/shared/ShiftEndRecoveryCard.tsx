// ShiftEndRecoveryCard — truthful End Shift recovery for a shift that is in the
// returning-to-yard state but has NO vehicle/DVIR (Post-Trip) obligation.
//
// It never says "Mark Arrived" and never implies an arrival: the work shift can
// be ended directly. While the obligation is still being verified it shows a
// neutral checking/verify state and never offers a false arrival action.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius } from '@/core/theme';

type RecoveryMode = 'end' | 'verify' | 'checking';

interface ShiftEndRecoveryCardProps {
  mode: RecoveryMode;
  returnStartTime: string | null;
  onEndShift: () => void;
  onRetry: () => void;
}

function formatElapsed(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  if (ms < 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function ShiftEndRecoveryCard({ mode, returnStartTime, onEndShift, onRetry }: ShiftEndRecoveryCardProps) {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState('0:00');

  useEffect(() => {
    if (!returnStartTime) return;
    setElapsed(formatElapsed(returnStartTime));
    const interval = setInterval(() => setElapsed(formatElapsed(returnStartTime)), 1000);
    return () => clearInterval(interval);
  }, [returnStartTime]);

  if (mode === 'checking') {
    return (
      <View style={s.container}>
        <View style={s.header}>
          <ActivityIndicator size="small" color={colors.text.muted} />
          <Text style={s.checkingLabel}>{t('shift.endVerifying')}</Text>
        </View>
      </View>
    );
  }

  if (mode === 'verify') {
    return (
      <View style={s.container}>
        <View style={s.header}>
          <MaterialCommunityIcons name="clock-alert-outline" size={18} color={colors.status.warning} />
          <Text style={s.verifyLabel}>{t('shift.endVerifying')}</Text>
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
        {returnStartTime ? <Text style={s.timer}>{elapsed}</Text> : null}
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
