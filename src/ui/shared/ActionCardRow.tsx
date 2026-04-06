// ActionCardRow — horizontal row of 3 medium action cards:
// Shift (status-aware), Timesheet (nav link), eWallet (launch).
// On "Start Shift" tap, shows enhanced ShiftStartModal with vehicle info,
// odometer, and pre-trip checklist.
// On active shift tap, shows ShiftEndModal with end odometer and return options.

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Animated } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useAppLauncher } from '@/core/hooks/useAppLauncher';
import ShiftStartModal, { type ShiftStartData } from './ShiftStartModal';
import ShiftEndModal from './ShiftEndModal';

interface ActionCardRowProps {
  active: boolean;
  returning: boolean;
  returnStartTime: string | null;
  shiftStartTime: string | null;
  onStartShift: (packageId?: string) => Promise<void>;
  onStartReturn: () => Promise<void>;
  onArrived: () => Promise<void>;
}

function formatElapsed(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  if (ms < 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Pulsing dot for active shift
function PulsingDot({ color }: { color: string }) {
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  return (
    <Animated.View style={[s.dot, { backgroundColor: color, opacity: pulse }]} />
  );
}

/** DOT-style color: green < 8h, yellow 8-10h, red > 10h */
function getShiftColor(startIso: string | null): string {
  if (!startIso) return '#34D399';
  const hours = (Date.now() - new Date(startIso).getTime()) / 3600000;
  if (hours >= 10) return '#EF4444';
  if (hours >= 8) return '#F59E0B';
  return '#34D399';
}

export function ActionCardRow({ active, returning, returnStartTime, shiftStartTime, onStartShift, onStartReturn, onArrived }: ActionCardRowProps) {
  const { t } = useTranslation();
  const { launchWBApp } = useAppLauncher();
  const [elapsed, setElapsed] = useState('0:00');
  const [shiftElapsed, setShiftElapsed] = useState('0:00');
  const [dotColor, setDotColor] = useState('#34D399');
  const [showStartModal, setShowStartModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);

  // Tick shift timer while active
  useEffect(() => {
    if (!active || !shiftStartTime) return;
    setShiftElapsed(formatElapsed(shiftStartTime));
    setDotColor(getShiftColor(shiftStartTime));
    const interval = setInterval(() => {
      setShiftElapsed(formatElapsed(shiftStartTime));
      setDotColor(getShiftColor(shiftStartTime));
    }, 1000);
    return () => clearInterval(interval);
  }, [active, shiftStartTime]);

  // Tick return timer while returning
  useEffect(() => {
    if (!returning || !returnStartTime) return;
    setElapsed(formatElapsed(returnStartTime));
    const interval = setInterval(() => setElapsed(formatElapsed(returnStartTime)), 1000);
    return () => clearInterval(interval);
  }, [returning, returnStartTime]);

  // ── Shift card press handler ──
  const handleShiftPress = () => {
    if (returning) {
      // Returning to yard — simple confirm arrival
      Alert.alert(t('shift.arrived'), t('shift.arrivedConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('shift.endShift'), onPress: onArrived },
      ]);
    } else if (active) {
      // Active shift — show end shift modal
      setShowEndModal(true);
    } else {
      // Not started — show start shift modal
      setShowStartModal(true);
    }
  };

  // ── Start shift confirmed ──
  const handleStartConfirm = async (data: ShiftStartData) => {
    setShowStartModal(false);
    await onStartShift(data.packageId || undefined);
  };

  // ── End shift: return to yard ──
  const handleReturnToYard = async (_endOdo: string, _totalMiles: string) => {
    setShowEndModal(false);
    await onStartReturn();
  };


  // ── Shift card state ──
  let shiftIcon: keyof typeof MaterialCommunityIcons.glyphMap = 'play-circle-outline';
  let shiftLabel = t('shift.startShift');
  let shiftSub = t('shift.tapToClockIn');
  let shiftColor: string = colors.brand.accent;
  let shiftBorder = `${colors.brand.accent}30`;
  let showDot = false;

  if (returning) {
    shiftIcon = 'truck';
    shiftLabel = t('shift.returning');
    shiftSub = elapsed;
    shiftColor = '#F59E0B';
    shiftBorder = 'rgba(245, 158, 11, 0.3)';
  } else if (active) {
    shiftIcon = 'clock-outline';
    shiftLabel = shiftElapsed;
    shiftSub = t('shift.tapToEndShort');
    shiftColor = dotColor;
    shiftBorder = `${dotColor}40`;
    showDot = true;
  }

  return (
    <View style={s.row}>
      {/* Shift Card */}
      <Pressable
        onPress={handleShiftPress}
        style={[s.card, { borderColor: shiftBorder }]}
      >
        <MaterialCommunityIcons name={shiftIcon} size={28} color={shiftColor} />
        <Text style={[s.label, { color: shiftColor }]}>{shiftLabel}</Text>
        <Text style={[s.sub, { color: shiftColor, opacity: 0.6 }]}>{shiftSub}</Text>
        {showDot && <PulsingDot color={shiftColor} />}
        {returning && (
          <View style={[s.badge, { backgroundColor: '#F59E0B' }]}>
            <Text style={s.badgeText}>{t('shift.endShift')}</Text>
          </View>
        )}
      </Pressable>

      {/* Timesheet Card */}
      <Pressable onPress={() => router.push('/timesheet')} style={[s.card, s.cardTimesheet]}>
        <MaterialCommunityIcons name="cash-multiple" size={28} color="#34D399" />
        <Text style={[s.label, { color: '#34D399' }]}>{t('actionCard.timesheet')}</Text>
        <Text style={[s.sub, { color: 'rgba(52, 211, 153, 0.6)' }]}>{t('actionCard.viewPay')}</Text>
      </Pressable>

      {/* eWallet Card */}
      <Pressable
        onPress={() => launchWBApp({
          name: 'WB eWallet',
          scheme: 'wbewallet',
          androidPackage: 'com.wellbuilt.ewallet',
        })}
        style={[s.card, s.cardWallet]}
      >
        <MaterialCommunityIcons name="wallet-outline" size={28} color={colors.brand.accent} />
        <Text style={[s.label, { color: colors.brand.accent }]}>{t('actionCard.eWallet')}</Text>
        <Text style={[s.sub, { color: colors.text.muted }]}>{t('actionCard.documents')}</Text>
      </Pressable>

      {/* ── Enhanced Shift Start Modal ── */}
      <ShiftStartModal
        visible={showStartModal}
        onClose={() => setShowStartModal(false)}
        onConfirm={handleStartConfirm}
      />

      {/* ── Enhanced Shift End Modal ── */}
      <ShiftEndModal
        visible={showEndModal}
        onClose={() => setShowEndModal(false)}
        onReturnToYard={handleReturnToYard}
        shiftStartTime={shiftStartTime}
      />
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  card: {
    flex: 1,
    backgroundColor: colors.bg.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 110,
  },
  cardTimesheet: {
    borderColor: 'rgba(52, 211, 153, 0.2)',
  },
  cardWallet: {
    borderColor: `${colors.brand.accent}20`,
  },
  label: {
    ...typography.bodySmall,
    fontWeight: '700',
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  sub: {
    ...typography.caption,
    marginTop: 2,
    textAlign: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: spacing.xs,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: spacing.xs,
  },
  badgeText: {
    color: '#000',
    fontSize: 11,
    fontWeight: '700',
  },
});
