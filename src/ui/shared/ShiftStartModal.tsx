// ShiftStartModal — enhanced shift start confirmation with vehicle info,
// odometer, pre-trip checklist, and package selection.
// Replaces the basic package picker modal in ActionCardRow.
//
// Fields:
// - Job Package (radio select)
// - Truck # (pre-filled from saved vehicle info, editable)
// - Trailer # (pre-filled from saved vehicle info, editable)
// - Start Odometer (pre-filled from previous shift's end odometer)
// - Pre-trip checklist (CDL/Med Card, Pre-trip done, Vehicle condition)

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useAuth } from '@/core/context/AuthContext';
import { loadVehicleInfo, saveVehicleInfo } from '@/core/services/driverProfile';
import { fetchCompanyPackages, fetchCompanyConfig, canonicalizeJsaMode, type ShiftPackageOption } from '@/core/services/companyConfig';

type JsaModeCanonical = 'off' | 'per_shift' | 'per_job';

/** Mode-aware explainer text shown in the start-shift modal. */
function jsaExplainer(mode: JsaModeCanonical): { title: string; body: string } | null {
  switch (mode) {
    case 'per_shift':
      return {
        title: 'JSA — Once per shift',
        body: 'You\'ll be prompted to acknowledge or read today\'s JSA at your first job close. Your shift can\'t end until it\'s done. Tap the JSA tile any time to do it now.',
      };
    case 'per_job':
      return {
        title: 'JSA — Once per job',
        body: 'You\'ll be prompted at every job close. Your first JSA today becomes a template — every job after that can be acknowledged with one tap.',
      };
    default:
      return null;
  }
}

const ODOMETER_KEY = 'wellbuilt-last-odometer';

interface ShiftStartModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (data: ShiftStartData) => void;
}

export interface ShiftStartData {
  packageId: string;
  truckNumber: string;
  trailerNumber: string;
  startOdometer: string;
  preTrip: {
    cdlMedCard: boolean;
    preTripDone: boolean;
    vehicleOk: boolean;
  };
}

export default function ShiftStartModal({ visible, onClose, onConfirm }: ShiftStartModalProps) {
  const { user } = useAuth();

  // Form state
  const [packages, setPackages] = useState<ShiftPackageOption[]>([]);
  const [selectedPkg, setSelectedPkg] = useState('');
  const [truckNumber, setTruckNumber] = useState('');
  const [trailerNumber, setTrailerNumber] = useState('');
  const [startOdometer, setStartOdometer] = useState('');
  const [cdlMedCard, setCdlMedCard] = useState(false);
  const [preTripDone, setPreTripDone] = useState(false);
  const [vehicleOk, setVehicleOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [jsaMode, setJsaMode] = useState<JsaModeCanonical>('off');

  // Load all pre-fill data when modal opens
  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    // Reset checklist each shift start
    setCdlMedCard(false);
    setPreTripDone(false);
    setVehicleOk(false);

    (async () => {
      try {
        // Load packages + company config (jsaMode for the explainer) in
        // parallel. Both reads are cached, so revisits are instant.
        const [pkgs, cfg] = await Promise.all([
          fetchCompanyPackages(user?.companyId || '').catch(() => [
            { id: 'water-hauling', name: 'Water Hauling' } as ShiftPackageOption,
          ]),
          fetchCompanyConfig(user?.companyId || '').catch(() => null),
        ]);
        setPackages(pkgs.length > 0 ? pkgs : [{ id: 'water-hauling', name: 'Water Hauling' }]);
        const defaultId = user?.defaultPackageId;
        if (defaultId && pkgs.some(p => p.id === defaultId)) {
          setSelectedPkg(defaultId);
        } else {
          setSelectedPkg(pkgs[0]?.id || 'water-hauling');
        }
        setJsaMode(canonicalizeJsaMode(cfg?.jsaMode));

        // Load vehicle info
        const vehicle = await loadVehicleInfo(user?.passcodeHash || '');
        setTruckNumber(vehicle.truckNumber || '');
        setTrailerNumber(vehicle.trailerNumber || '');

        // Load previous end odometer
        const lastOdo = await AsyncStorage.getItem(ODOMETER_KEY);
        setStartOdometer(lastOdo || '');
      } catch (err) {
        console.warn('[ShiftStartModal] Load error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [visible, user]);

  const allChecked = cdlMedCard && preTripDone && vehicleOk;

  const handleConfirm = useCallback(async () => {
    // Save vehicle info for next time + SSO relay
    if (user?.passcodeHash) {
      saveVehicleInfo(user.passcodeHash, {
        truckNumber: truckNumber.trim(),
        trailerNumber: trailerNumber.trim(),
      }).catch(() => {});
    }
    // Save start odometer so end-shift can compute total miles
    if (startOdometer.trim()) {
      await AsyncStorage.setItem('wellbuilt-shift-start-odometer', startOdometer.trim()).catch(() => {});
    }

    onConfirm({
      packageId: selectedPkg,
      truckNumber: truckNumber.trim(),
      trailerNumber: trailerNumber.trim(),
      startOdometer: startOdometer.trim(),
      preTrip: { cdlMedCard, preTripDone, vehicleOk },
    });
  }, [selectedPkg, truckNumber, trailerNumber, startOdometer, cdlMedCard, preTripDone, vehicleOk, user, onConfirm]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.card}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.scrollContent}
          >
            {/* Header */}
            <MaterialCommunityIcons name="clock-check-outline" size={36} color={colors.brand.accent} style={s.headerIcon} />
            <Text style={s.title}>Start Shift</Text>
            <Text style={s.subtitle}>Confirm your info before clocking in</Text>

            {loading ? (
              <ActivityIndicator color={colors.brand.accent} style={{ marginVertical: 32 }} />
            ) : (
              <>
                {/* ── JSA explainer (only when company has JSA enabled) ── */}
                {(() => {
                  const ex = jsaExplainer(jsaMode);
                  if (!ex) return null;
                  return (
                    <View style={s.jsaCard}>
                      <View style={s.jsaCardHeader}>
                        <MaterialCommunityIcons name="shield-check" size={18} color={colors.brand.accent} />
                        <Text style={s.jsaCardTitle}>{ex.title}</Text>
                      </View>
                      <Text style={s.jsaCardBody}>{ex.body}</Text>
                    </View>
                  );
                })()}

                {/* ── Job Package ── */}
                <Text style={s.sectionLabel}>JOB PACKAGE</Text>
                <View style={s.pkgList}>
                  {packages.map(pkg => (
                    <Pressable
                      key={pkg.id}
                      onPress={() => setSelectedPkg(pkg.id)}
                      style={[s.pkgOption, selectedPkg === pkg.id && s.pkgOptionSelected]}
                    >
                      <View style={[s.radio, selectedPkg === pkg.id && s.radioSelected]}>
                        {selectedPkg === pkg.id && <View style={s.radioDot} />}
                      </View>
                      <Text style={[s.pkgLabel, selectedPkg === pkg.id && s.pkgLabelSelected]}>
                        {pkg.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* ── Vehicle Info ── */}
                <Text style={s.sectionLabel}>VEHICLE</Text>
                <View style={s.inputRow}>
                  <View style={s.inputHalf}>
                    <Text style={s.inputLabel}>Truck #</Text>
                    <TextInput
                      style={s.input}
                      value={truckNumber}
                      onChangeText={setTruckNumber}
                      placeholder="e.g., 142"
                      placeholderTextColor={colors.text.muted}
                      autoCapitalize="characters"
                      returnKeyType="next"
                    />
                  </View>
                  <View style={s.inputHalf}>
                    <Text style={s.inputLabel}>Trailer #</Text>
                    <TextInput
                      style={s.input}
                      value={trailerNumber}
                      onChangeText={setTrailerNumber}
                      placeholder="e.g., 308"
                      placeholderTextColor={colors.text.muted}
                      autoCapitalize="characters"
                      returnKeyType="next"
                    />
                  </View>
                </View>

                {/* ── Odometer ── */}
                <Text style={s.sectionLabel}>ODOMETER</Text>
                <View style={s.inputFull}>
                  <Text style={s.inputLabel}>Start Miles</Text>
                  <TextInput
                    style={s.input}
                    value={startOdometer}
                    onChangeText={setStartOdometer}
                    placeholder="e.g., 124,350"
                    placeholderTextColor={colors.text.muted}
                    keyboardType="numeric"
                    returnKeyType="done"
                  />
                </View>

                {/* ── Pre-Trip Checklist ── */}
                <Text style={s.sectionLabel}>PRE-TRIP CHECKLIST</Text>
                <CheckItem
                  label="CDL, medical card, and insurance on person"
                  checked={cdlMedCard}
                  onToggle={() => setCdlMedCard(v => !v)}
                />
                <CheckItem
                  label="Pre-trip vehicle inspection completed"
                  checked={preTripDone}
                  onToggle={() => setPreTripDone(v => !v)}
                />
                <CheckItem
                  label="Vehicle in safe operating condition"
                  checked={vehicleOk}
                  onToggle={() => setVehicleOk(v => !v)}
                />
              </>
            )}
          </ScrollView>

          {/* ── Buttons ── */}
          <View style={s.buttons}>
            <Pressable
              onPress={handleConfirm}
              disabled={loading || !selectedPkg || !allChecked}
              style={[s.btn, s.btnStart, (loading || !selectedPkg || !allChecked) && { opacity: 0.4 }]}
            >
              <MaterialCommunityIcons name="play-circle-outline" size={20} color="#000" />
              <Text style={s.btnStartText}>Start Shift</Text>
            </Pressable>
            <Pressable onPress={onClose} style={[s.btn, s.btnCancel]}>
              <Text style={s.btnCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Checkbox row ────────────────────────────────────────────────

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

// ── Styles ──────────────────────────────────────────────────────

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
  scrollContent: {
    padding: 24,
    paddingBottom: 8,
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
    marginBottom: 20,
  },
  sectionLabel: {
    color: colors.text.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 16,
    marginBottom: 8,
  },

  // JSA explainer card — shown when company.jsaMode !== 'off'
  jsaCard: {
    backgroundColor: `${colors.brand.accent}10`,
    borderWidth: 1,
    borderColor: `${colors.brand.accent}40`,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 4,
  },
  jsaCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  jsaCardTitle: {
    color: colors.brand.accent,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  jsaCardBody: {
    color: colors.text.secondary,
    fontSize: 12,
    lineHeight: 17,
  },

  // Package picker
  pkgList: { gap: 6 },
  pkgOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  pkgOptionSelected: {
    borderColor: colors.brand.accent,
    backgroundColor: `${colors.brand.accent}12`,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.brand.accent },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.brand.accent,
  },
  pkgLabel: {
    color: '#bbb',
    fontSize: 15,
    fontWeight: '500',
  },
  pkgLabelSelected: {
    color: '#fff',
    fontWeight: '700',
  },

  // Inputs
  inputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  inputHalf: { flex: 1 },
  inputFull: { width: '100%' },
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
    fontSize: 16,
    fontWeight: '600',
  },

  // Checklist
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
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

  // Buttons
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
  btnStart: {
    backgroundColor: colors.brand.accent,
  },
  btnStartText: {
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
