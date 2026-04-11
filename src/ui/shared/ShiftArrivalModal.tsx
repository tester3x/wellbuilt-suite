// ShiftArrivalModal — branded end-of-shift modal shown when driver arrives at yard.
// Captures end odometer, shows total miles, return drive time, post-trip checklist.

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
import { colors, radius } from '@/core/theme';

interface ShiftArrivalModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (odometerMiles?: number) => void;
  returnStartTime: string | null;
}

function formatReturnDrive(startIso: string | null): string {
  if (!startIso) return '--';
  const ms = Date.now() - new Date(startIso).getTime();
  if (ms < 0) return '0m';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function CheckItem({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={s.checkRow}>
      <View style={[s.checkbox, checked && s.checkboxChecked]}>
        {checked && <MaterialCommunityIcons name="check" size={14} color="#000" />}
      </View>
      <Text style={[s.checkLabel, checked && s.checkLabelChecked]}>{label}</Text>
    </Pressable>
  );
}

export default function ShiftArrivalModal({ visible, onClose, onConfirm, returnStartTime }: ShiftArrivalModalProps) {
  const [endOdometer, setEndOdometer] = useState('');
  const [startOdometer, setStartOdometer] = useState('');
  const [totalMiles, setTotalMiles] = useState('');
  const [postTripDone, setPostTripDone] = useState(false);
  const [paperworkDone, setPaperworkDone] = useState(false);

  // Reset + load start odometer on open
  useEffect(() => {
    if (!visible) return;
    setPostTripDone(false);
    setPaperworkDone(false);
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

  const hasOdometer = endOdometer.trim().length > 0;
  const allChecked = postTripDone && paperworkDone && hasOdometer;
  const returnDrive = formatReturnDrive(returnStartTime);

  const handleConfirm = useCallback(async () => {
    Keyboard.dismiss();
    // Save end odometer as next day's start pre-fill
    if (endOdometer.trim()) {
      await AsyncStorage.setItem('wellbuilt-last-odometer', endOdometer.trim()).catch(() => {});
    }
    // Pass odometer miles to parent so it can write to Firestore shift doc
    const miles = totalMiles ? parseInt(totalMiles, 10) : undefined;
    onConfirm(miles);
  }, [endOdometer, totalMiles, onConfirm]);

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
            <MaterialCommunityIcons name="map-marker-check" size={36} color={colors.status.online} style={s.headerIcon} />
            <Text style={s.title}>Arrived at Yard</Text>
            <Text style={s.subtitle}>Record odometer and confirm end of shift</Text>

            {/* Summary cards */}
            <View style={s.summaryRow}>
              <View style={s.summaryItem}>
                <Text style={s.summaryLabel}>RETURN DRIVE</Text>
                <Text style={s.summaryValue}>{returnDrive}</Text>
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

            {/* Post-trip checklist */}
            <Text style={[s.sectionLabel, { marginTop: 16 }]}>END OF SHIFT</Text>
            <CheckItem
              label="Post-trip vehicle inspection completed"
              checked={postTripDone}
              onToggle={() => setPostTripDone(v => !v)}
            />
            <CheckItem
              label="All paperwork completed"
              checked={paperworkDone}
              onToggle={() => setPaperworkDone(v => !v)}
            />
          </ScrollView>

          {/* Buttons */}
          <View style={s.buttons}>
            <Pressable
              onPressIn={allChecked ? handleConfirm : undefined}
              disabled={!allChecked}
              style={[s.btn, s.btnConfirm, !allChecked && { opacity: 0.4 }]}
            >
              <MaterialCommunityIcons name="check-circle-outline" size={20} color="#000" />
              <Text style={s.btnConfirmText}>End Shift</Text>
            </Pressable>
            <Pressable onPressIn={onClose} style={[s.btn, s.btnCancel]}>
              <Text style={s.btnCancelText}>Cancel</Text>
            </Pressable>
          </View>
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
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
  },
  headerIcon: {
    alignSelf: 'center',
    marginTop: 24,
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
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
    paddingHorizontal: 24,
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
  sectionLabel: {
    color: colors.text.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
    paddingHorizontal: 24,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-end',
    paddingHorizontal: 24,
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
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.status.online,
    borderColor: colors.status.online,
  },
  checkLabel: {
    color: colors.text.secondary,
    fontSize: 13,
    flex: 1,
  },
  checkLabelChecked: {
    color: '#fff',
  },
  buttons: {
    gap: 8,
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
  },
  btnConfirm: {
    backgroundColor: colors.status.online,
  },
  btnConfirmText: {
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
