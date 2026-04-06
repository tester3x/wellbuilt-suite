// ShiftEndModal — enhanced end-of-shift confirmation modal.
// Shown when driver taps shift card to end shift (before Return to Yard).
// Captures end odometer, shows shift summary, confirms return drive.
//
// Flow: Driver taps shift timer → ShiftEndModal opens →
//   fills end odometer → "Return to Yard" → modal closes, return drive starts.
//   OR: "End Shift Here" → ends shift immediately (driver already at yard).

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, radius } from '@/core/theme';

interface ShiftEndModalProps {
  visible: boolean;
  onClose: () => void;
  onReturnToYard: (endOdometer: string, totalMiles: string) => void;
  shiftStartTime: string | null;
}

function formatShiftDuration(startIso: string | null): string {
  if (!startIso) return '--:--';
  const ms = Date.now() - new Date(startIso).getTime();
  if (ms < 0) return '0:00';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

export default function ShiftEndModal({ visible, onClose, onReturnToYard, shiftStartTime }: ShiftEndModalProps) {
  const [endOdometer, setEndOdometer] = useState('');
  const [startOdometer, setStartOdometer] = useState('');
  const [totalMiles, setTotalMiles] = useState('');

  // Load start odometer on open
  useEffect(() => {
    if (!visible) return;
    setEndOdometer('');
    setTotalMiles('');
    (async () => {
      const startOdo = await AsyncStorage.getItem('wellbuilt-shift-start-odometer').catch(() => null);
      setStartOdometer(startOdo || '');
    })();
  }, [visible]);

  // Auto-calculate total miles
  useEffect(() => {
    const start = parseFloat(startOdometer.replace(/,/g, ''));
    const end = parseFloat(endOdometer.replace(/,/g, ''));
    if (!isNaN(start) && !isNaN(end) && end >= start) {
      setTotalMiles(String(Math.round(end - start)));
    } else {
      setTotalMiles('');
    }
  }, [endOdometer, startOdometer]);

  const handleSaveOdometer = useCallback(async () => {
    // Save end odometer as next day's pre-fill
    if (endOdometer.trim()) {
      await AsyncStorage.setItem('wellbuilt-last-odometer', endOdometer.trim()).catch(() => {});
    }
  }, [endOdometer]);

  // Dismiss keyboard first, wait for it to settle, then close.
  // Prevents stutter: KeyboardAvoidingView sliding down + modal fade = two competing animations.
  const dismissThenRun = useCallback((action: () => void) => {
    const isKeyboardUp = Keyboard.isVisible?.() ?? false;
    Keyboard.dismiss();
    if (isKeyboardUp) {
      // Give keyboard animation time to finish before closing modal
      setTimeout(action, 350);
    } else {
      action();
    }
  }, []);

  const handleReturnToYard = useCallback(async () => {
    const run = async () => {
      await handleSaveOdometer();
      onReturnToYard(endOdometer.trim(), totalMiles);
    };
    dismissThenRun(run);
  }, [endOdometer, totalMiles, handleSaveOdometer, onReturnToYard, dismissThenRun]);


  const hasOdometer = endOdometer.trim().length > 0;
  const shiftDuration = formatShiftDuration(shiftStartTime);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.card}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
          {/* Header */}
          <MaterialCommunityIcons name="truck" size={36} color={colors.status.warning} style={s.headerIcon} />
          <Text style={s.title}>Return to Yard</Text>
          <Text style={s.subtitle}>Record your ending odometer before heading back</Text>

          {/* Shift Summary */}
          <View style={s.summaryRow}>
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel}>SHIFT TIME</Text>
              <Text style={s.summaryValue}>{shiftDuration}</Text>
            </View>
            {startOdometer ? (
              <View style={s.summaryItem}>
                <Text style={s.summaryLabel}>START ODO</Text>
                <Text style={s.summaryValue}>{startOdometer}</Text>
              </View>
            ) : null}
          </View>

          {/* End Odometer */}
          <Text style={s.sectionLabel}>ODOMETER</Text>
          <View style={s.inputRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.inputLabel}>End Miles</Text>
              <TextInput
                style={s.input}
                value={endOdometer}
                onChangeText={setEndOdometer}
                placeholder="e.g., 124,590"
                placeholderTextColor={colors.text.muted}
                keyboardType="numeric"
                returnKeyType="done"
                autoFocus
              />
            </View>
            {totalMiles ? (
              <View style={s.milesBox}>
                <Text style={s.milesLabel}>TOTAL</Text>
                <Text style={s.milesValue}>{totalMiles}</Text>
                <Text style={s.milesUnit}>miles</Text>
              </View>
            ) : null}
          </View>

          {/* Buttons */}
          <View style={s.buttons}>
            <Pressable
              onPressIn={hasOdometer ? handleReturnToYard : undefined}
              disabled={!hasOdometer}
              style={[s.btn, s.btnReturn, !hasOdometer && { opacity: 0.4 }]}
            >
              <MaterialCommunityIcons name="truck" size={20} color="#000" />
              <Text style={s.btnReturnText}>Return to Yard</Text>
            </Pressable>
            <Pressable onPressIn={onClose} style={[s.btn, s.btnCancel]}>
              <Text style={s.btnCancelText}>Cancel</Text>
            </Pressable>
          </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: colors.bg.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: 24,
    width: '100%',
    maxWidth: 420,
  },
  headerIcon: {
    alignSelf: 'center',
    marginBottom: 8,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: colors.text.muted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },

  // Summary
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  summaryItem: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radius.md,
    padding: 12,
    alignItems: 'center',
  },
  summaryLabel: {
    color: colors.text.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  summaryValue: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },

  // Inputs
  sectionLabel: {
    color: colors.text.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-end',
  },
  inputLabel: {
    color: colors.text.secondary,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.bg.input,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  milesBox: {
    backgroundColor: `${colors.status.online}15`,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: `${colors.status.online}30`,
    padding: 10,
    alignItems: 'center',
    minWidth: 80,
  },
  milesLabel: {
    color: colors.text.muted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  milesValue: {
    color: colors.status.online,
    fontSize: 22,
    fontWeight: '700',
  },
  milesUnit: {
    color: colors.text.muted,
    fontSize: 10,
  },

  // Buttons
  buttons: {
    gap: 8,
    marginTop: 20,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
  },
  btnReturn: {
    backgroundColor: colors.status.warning,
  },
  btnReturnText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  btnCancel: {
    backgroundColor: 'transparent',
  },
  btnCancelText: {
    color: colors.text.muted,
    fontSize: 14,
    fontWeight: '500',
  },
});
