import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';

interface ShiftButtonProps {
  active: boolean;
  returning: boolean;
  returnStartTime: string | null;
  shiftStartTime: string | null;
  onStartReturn: () => Promise<void>;
  onArrived: () => Promise<void>;
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

/** Get DOT-style color based on shift hours: green < 8h, yellow 8-10h, red > 10h */
function getShiftColor(startIso: string | null): string {
  if (!startIso) return '#34D399';
  const hours = (Date.now() - new Date(startIso).getTime()) / 3600000;
  if (hours >= 10) return '#EF4444';
  if (hours >= 8) return '#F59E0B';
  return '#34D399';
}

export function ShiftButton({ active, returning, returnStartTime, shiftStartTime, onStartReturn, onArrived }: ShiftButtonProps) {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState('0:00');
  const [shiftElapsed, setShiftElapsed] = useState('0:00');
  const [shiftColor, setShiftColor] = useState('#34D399');

  // Tick the shift timer while active
  useEffect(() => {
    if (!active || !shiftStartTime) return;
    setShiftElapsed(formatElapsed(shiftStartTime));
    setShiftColor(getShiftColor(shiftStartTime));
    const interval = setInterval(() => {
      setShiftElapsed(formatElapsed(shiftStartTime));
      setShiftColor(getShiftColor(shiftStartTime));
    }, 1000);
    return () => clearInterval(interval);
  }, [active, shiftStartTime]);

  // Tick the elapsed timer while returning
  useEffect(() => {
    if (!returning || !returnStartTime) return;
    setElapsed(formatElapsed(returnStartTime));
    const interval = setInterval(() => {
      setElapsed(formatElapsed(returnStartTime));
    }, 1000);
    return () => clearInterval(interval);
  }, [returning, returnStartTime]);

  // ── Returning state ────────────────────────────────────────────────
  if (returning) {
    const handleArrived = () => {
      Alert.alert(
        t('shift.arrived'),
        t('shift.arrivedConfirm'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('shift.endShift'), onPress: onArrived },
        ],
      );
    };

    return (
      <Pressable onPress={handleArrived} style={[styles.container, styles.returning]}>
        <MaterialCommunityIcons name="truck" size={20} color="#F59E0B" />
        <View style={styles.textContainer}>
          <Text style={[styles.label, styles.labelReturning]}>{t('shift.returningToYard')}</Text>
          <Text style={[styles.action, styles.actionReturning]}>{elapsed} {t('shift.driving')}</Text>
        </View>
        <View style={styles.arrivedBadge}>
          <Text style={styles.arrivedText}>{t('shift.arrived')}</Text>
        </View>
      </Pressable>
    );
  }

  // ── Active state ───────────────────────────────────────────────────
  if (active) {
    const handleEndShift = () => {
      Alert.alert(
        t('shift.endShift'),
        t('shift.startReturnConfirm'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('shift.returnToYard'), onPress: onStartReturn, style: 'destructive' },
        ],
      );
    };

    return (
      <Pressable onPress={handleEndShift} style={[styles.container, styles.active, { borderColor: `${shiftColor}40` }]}>
        <MaterialCommunityIcons name="clock-outline" size={20} color={shiftColor} />
        <View style={styles.textContainer}>
          <Text style={[styles.label, { color: shiftColor }]}>{t('shift.shiftActive')}</Text>
          <Text style={[styles.action, { color: `${shiftColor}99` }]}>{t('shift.tapToEnd')}</Text>
        </View>
        <Text style={{ color: shiftColor, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{shiftElapsed}</Text>
      </Pressable>
    );
  }

  // ── Ended state ────────────────────────────────────────────────────
  return (
    <View style={[styles.container, styles.ended]}>
      <MaterialCommunityIcons name="clock-check-outline" size={20} color={colors.text.muted} />
      <View style={styles.textContainer}>
        <Text style={[styles.label, styles.labelEnded]}>{t('shift.shiftEnded')}</Text>
        <Text style={[styles.action, styles.actionEnded]}>{t('shift.clockOutRecorded')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  active: {
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
    borderColor: 'rgba(52, 211, 153, 0.25)',
  },
  returning: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.25)',
  },
  ended: {
    backgroundColor: 'rgba(100, 116, 139, 0.08)',
    borderColor: 'rgba(100, 116, 139, 0.15)',
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
  labelReturning: {
    color: '#F59E0B',
  },
  labelEnded: {
    color: colors.text.muted,
  },
  action: {
    ...typography.caption,
    color: 'rgba(52, 211, 153, 0.6)',
    marginTop: 1,
  },
  actionReturning: {
    color: 'rgba(245, 158, 11, 0.7)',
  },
  actionEnded: {
    color: colors.text.muted,
    opacity: 0.6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34D399',
  },
  arrivedBadge: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
  },
  arrivedText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '700',
  },
});
