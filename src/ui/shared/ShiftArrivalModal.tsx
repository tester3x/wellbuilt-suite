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
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, radius } from '@/core/theme';
import { useAuth } from '@/core/context/AuthContext';
import { START_ODOMETER_KEY, readBoundStartOdometer, resolveShiftMiles } from '@/core/services/shiftMileage';

interface ShiftArrivalModalProps {
  visible: boolean;
  onClose: () => void;
  /** Returning a Promise lets the modal hold its busy state until end-of-shift work resolves. */
  onConfirm: (odometerMiles?: number) => boolean | Promise<boolean>;
  /**
   * Post-Trip satisfied, derived from a verified receipt for THIS shift.
   * The row is display-only: a tap must never claim an inspection happened.
   */
  postTripVerified?: boolean;
  /** Odometer retained from a failed close, so a retry does not re-ask. */
  initialOdometer?: string;
  /** Visible reason a previous submit did not close the shift. */
  errorText?: string | null;
  /**
   * The recovery action for a blocked shift JSA, when there is one. Shown next
   * to errorText so a driver who cannot close is told what to DO, not only what
   * is wrong. Absent for every non-JSA failure.
   */
  recoveryAction?: { label: string; onPress: () => void } | null;
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

export default function ShiftArrivalModal({
  visible, onClose, onConfirm, returnStartTime,
  postTripVerified = false, initialOdometer, errorText, recoveryAction,
}: ShiftArrivalModalProps) {
  const { user } = useAuth();
  const [etcMiles, setEtcMiles] = useState<number | null>(null);
  const [readingMileage, setReadingMileage] = useState(false);
  const [endOdometer, setEndOdometer] = useState('');
  const [startOdometer, setStartOdometer] = useState('');
  const [totalMiles, setTotalMiles] = useState('');
  // NOT driver-settable. Post-Trip is satisfied by a verified receipt or not
  // at all — the old manual checkbox let a tap assert an inspection that had
  // not been done, because the handoff only happened after this modal closed.
  const postTripDone = postTripVerified;
  const [paperworkDone, setPaperworkDone] = useState(false);
  // Busy = end-of-shift work in flight. Modal stays open with a spinner
  // and disabled buttons so the driver doesn't double-tap thinking the
  // first tap missed. Pre-fix the modal closed eagerly and the slow GPS
  // fix made it look like nothing happened.
  const [busy, setBusy] = useState(false);

  // Reset + load start odometer on open
  useEffect(() => {
    if (!visible) return;
    setPaperworkDone(false);
    // Restore a reading retained from a failed close so the retry does not
    // make the driver type it again.
    setEndOdometer(initialOdometer || '');
    setTotalMiles('');
    setBusy(false);
    let cancelled = false;
    setStartOdometer(''); setEtcMiles(null); setReadingMileage(true);
    (async () => {
      try {
        const { getCurrentShiftId } = await import('@/core/services/shiftTracking');
        const suiteShiftId = await getCurrentShiftId();
        if (!suiteShiftId || !user?.companyId || !user.driverId) return;
        const identity = { companyId: user.companyId, driverId: user.driverId, suiteShiftId };
        const raw = await AsyncStorage.getItem(START_ODOMETER_KEY);
        if (!cancelled) setStartOdometer(readBoundStartOdometer(raw, identity));
        const { readEtcShiftMiles } = await import('@/core/services/etcStart/etcMileage');
        const miles = await readEtcShiftMiles(identity);
        if (!cancelled) setEtcMiles(miles);
      } finally { if (!cancelled) setReadingMileage(false); }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [visible, initialOdometer, user?.companyId, user?.driverId]);

  // Auto-calculate total miles
  useEffect(() => {
    const miles = resolveShiftMiles(initialOdometer ? '' : startOdometer, endOdometer, etcMiles);
    setTotalMiles(miles === null ? '' : String(miles));
  }, [endOdometer, startOdometer, etcMiles, initialOdometer]);

  const hasOdometer = totalMiles !== '' && Number(totalMiles) <= 5000;
  const allChecked = postTripDone && paperworkDone && hasOdometer && !readingMileage;

  const returnDrive = formatReturnDrive(returnStartTime);

  const handleConfirm = useCallback(async () => {
    if (busy) return;
    Keyboard.dismiss();
    setBusy(true);
    try {
      // Pass distance traveled, never an absolute odometer. This value must
      // not be promoted as the next shift's starting odometer.
      const miles = totalMiles !== '' ? Number(totalMiles) : undefined;
      const closed = await Promise.resolve(onConfirm(miles));
      // A repeated refusal may keep the same error/odometer props. Explicitly
      // release busy rather than relying on a prop-change effect to reset it.
      if (!closed) setBusy(false);
    } catch {
      setBusy(false);
    }
  }, [busy, endOdometer, totalMiles, onConfirm]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? () => {} : onClose}>
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
            <Text style={s.subtitle}>Review shift miles and confirm end of shift</Text>

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
            <Text style={s.sectionLabel}>SHIFT MILEAGE</Text>
            <Text style={{ color: colors.text.muted, marginBottom: 10 }}>
              {readingMileage ? 'Reading ETC mileage…' : etcMiles !== null ? `ETC GPS: ${etcMiles.toFixed(1)} miles · this shift` : 'ETC mileage unavailable for this shift. Enter miles manually.'}
            </Text>
            <View style={s.inputRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.inputLabel}>{startOdometer && !initialOdometer ? 'End odometer (optional override)' : 'Shift miles (optional override)'}</Text>
                <TextInput
                  style={s.input}
                  value={endOdometer}
                  onChangeText={setEndOdometer}
                  placeholder={startOdometer && !initialOdometer ? 'e.g., 124,590' : etcMiles !== null ? `ETC: ${etcMiles.toFixed(1)} miles` : 'e.g., 240'}
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

            {errorText ? (
              <View style={{ marginTop: 12 }}>
                <Text style={{ color: '#f59e0b', fontSize: 13 }}>{errorText}</Text>
                {recoveryAction ? (
                  <Pressable
                    onPress={recoveryAction.onPress}
                    style={{
                      marginTop: 10,
                      alignSelf: 'flex-start',
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 8,
                      backgroundColor: '#f59e0b',
                    }}
                  >
                    <Text style={{ color: '#000', fontSize: 13, fontWeight: '700' }}>
                      {recoveryAction.label}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {/* Post-trip checklist */}
            <Text style={[s.sectionLabel, { marginTop: 16 }]}>END OF SHIFT</Text>
            {/* Display-only: satisfied by a verified receipt for this shift,
                never by a tap. The inspection happens at Mark Arrived, before
                this modal opens. */}
            <CheckItem
              label={postTripDone
                ? 'Post-trip vehicle inspection completed'
                : 'Post-trip vehicle inspection required'}
              checked={postTripDone}
              onToggle={() => {}}
            />
            <CheckItem
              label="All paperwork completed"
              checked={paperworkDone}
              onToggle={() => setPaperworkDone(v => !v)}
            />
          </ScrollView>

          {/* Buttons.
              IMPORTANT: use `onPress` (touch-UP), NOT `onPressIn` (touch-DOWN).
              onPressIn fires the instant the finger lands and kicks off
              confirmArrival, which flips shiftActive/returningToYard FALSE
              before the user has lifted their finger. The arrival modal
              then unmounts mid-gesture and the touch-UP event lands on
              the shift card that's now rendered behind it — opening the
              Start Shift modal on top of Day Summary. (Pic-2 bug,
              field-confirmed 2026-05-01.) */}
          <View style={s.buttons}>
            <Pressable
              onPress={allChecked && !busy ? handleConfirm : undefined}
              disabled={!allChecked || busy}
              style={[s.btn, s.btnConfirm, (!allChecked || busy) && !busy && { opacity: 0.4 }, busy && { opacity: 0.85 }]}
            >
              {busy ? (
                <>
                  <ActivityIndicator size="small" color="#000" />
                  <Text style={s.btnConfirmText}>Ending Shift…</Text>
                </>
              ) : (
                <>
                  <MaterialCommunityIcons name="check-circle-outline" size={20} color="#000" />
                  <Text style={s.btnConfirmText}>End Shift</Text>
                </>
              )}
            </Pressable>
            <Pressable
              onPress={busy ? undefined : onClose}
              disabled={busy}
              style={[s.btn, s.btnCancel, busy && { opacity: 0.4 }]}
            >
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
