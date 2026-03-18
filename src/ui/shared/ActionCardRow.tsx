// ActionCardRow — horizontal row of 3 medium action cards:
// Shift (status-aware), Timesheet (nav link), eWallet (coming soon).
// Replaces the old full-width ShiftButton + TimesheetButton bars.

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Animated } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useAppLauncher } from '@/core/hooks/useAppLauncher';

interface ActionCardRowProps {
  active: boolean;
  returning: boolean;
  returnStartTime: string | null;
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

export function ActionCardRow({ active, returning, returnStartTime, onStartReturn, onArrived }: ActionCardRowProps) {
  const { launchWBApp } = useAppLauncher();
  const [elapsed, setElapsed] = useState('0:00');

  useEffect(() => {
    if (!returning || !returnStartTime) return;
    setElapsed(formatElapsed(returnStartTime));
    const interval = setInterval(() => setElapsed(formatElapsed(returnStartTime)), 1000);
    return () => clearInterval(interval);
  }, [returning, returnStartTime]);

  // ── Shift card press handler ──
  const handleShiftPress = () => {
    if (returning) {
      Alert.alert('Arrived', 'Record your arrival and end shift?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End Shift', onPress: onArrived },
      ]);
    } else if (active) {
      Alert.alert('End Shift', 'Start your return drive? Your drive time will be tracked.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Return to Yard', onPress: onStartReturn, style: 'destructive' },
      ]);
    }
  };

  // ── Shift card state ──
  let shiftIcon: keyof typeof MaterialCommunityIcons.glyphMap = 'clock-check-outline';
  let shiftLabel = 'Shift Ended';
  let shiftSub = 'GPS recorded';
  let shiftColor: string = colors.text.muted;
  let shiftBorder = 'rgba(100, 116, 139, 0.2)';
  let showDot = false;

  if (returning) {
    shiftIcon = 'truck';
    shiftLabel = 'Returning';
    shiftSub = elapsed;
    shiftColor = '#F59E0B';
    shiftBorder = 'rgba(245, 158, 11, 0.3)';
  } else if (active) {
    shiftIcon = 'clock-outline';
    shiftLabel = 'Shift Active';
    shiftSub = 'Tap to end';
    shiftColor = '#34D399';
    shiftBorder = 'rgba(52, 211, 153, 0.3)';
    showDot = true;
  }

  return (
    <View style={s.row}>
      {/* Shift Card */}
      <Pressable
        onPress={handleShiftPress}
        style={[s.card, { borderColor: shiftBorder }]}
        disabled={!active && !returning}
      >
        <MaterialCommunityIcons name={shiftIcon} size={28} color={shiftColor} />
        <Text style={[s.label, { color: shiftColor }]}>{shiftLabel}</Text>
        <Text style={[s.sub, { color: shiftColor, opacity: 0.6 }]}>{shiftSub}</Text>
        {showDot && <PulsingDot color={shiftColor} />}
        {returning && (
          <View style={[s.badge, { backgroundColor: '#F59E0B' }]}>
            <Text style={s.badgeText}>Arrived</Text>
          </View>
        )}
      </Pressable>

      {/* Timesheet Card */}
      <Pressable onPress={() => router.push('/timesheet')} style={[s.card, s.cardTimesheet]}>
        <MaterialCommunityIcons name="cash-multiple" size={28} color="#34D399" />
        <Text style={[s.label, { color: '#34D399' }]}>Timesheet</Text>
        <Text style={[s.sub, { color: 'rgba(52, 211, 153, 0.6)' }]}>View your pay</Text>
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
        <Text style={[s.label, { color: colors.brand.accent }]}>eWallet</Text>
        <Text style={[s.sub, { color: colors.text.muted }]}>Documents</Text>
      </Pressable>
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
