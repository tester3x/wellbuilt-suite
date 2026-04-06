// ShiftArrivalModal — branded dark modal replacing native Alert for arrival confirmation.
// Shown when driver taps shift card while in "Returning" state.
// Includes post-trip reminders before ending shift.

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius } from '@/core/theme';

interface ShiftArrivalModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
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
  const [postTripDone, setPostTripDone] = useState(false);
  const [paperworkDone, setPaperworkDone] = useState(false);

  // Reset on open
  useEffect(() => {
    if (visible) {
      setPostTripDone(false);
      setPaperworkDone(false);
    }
  }, [visible]);

  const allChecked = postTripDone && paperworkDone;
  const returnDrive = formatReturnDrive(returnStartTime);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          <MaterialCommunityIcons name="map-marker-check" size={36} color={colors.status.online} style={s.headerIcon} />
          <Text style={s.title}>Arrived at Yard</Text>
          <Text style={s.subtitle}>Confirm arrival and end your shift</Text>

          {/* Return drive summary */}
          <View style={s.summaryRow}>
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel}>RETURN DRIVE</Text>
              <Text style={s.summaryValue}>{returnDrive}</Text>
            </View>
          </View>

          {/* Post-trip checklist */}
          <Text style={s.sectionLabel}>END OF SHIFT</Text>
          <CheckItem
            label="Post-trip vehicle inspection completed"
            checked={postTripDone}
            onToggle={() => setPostTripDone(v => !v)}
          />
          <CheckItem
            label="All paperwork and jobs closed in app"
            checked={paperworkDone}
            onToggle={() => setPaperworkDone(v => !v)}
          />

          {/* Buttons */}
          <View style={s.buttons}>
            <Pressable
              onPress={onConfirm}
              disabled={!allChecked}
              style={[s.btn, s.btnConfirm, !allChecked && { opacity: 0.4 }]}
            >
              <MaterialCommunityIcons name="check-circle-outline" size={20} color="#000" />
              <Text style={s.btnConfirmText}>End Shift</Text>
            </Pressable>
            <Pressable onPress={onClose} style={[s.btn, s.btnCancel]}>
              <Text style={s.btnCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
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
  summaryRow: {
    marginBottom: 16,
  },
  summaryItem: {
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
    marginBottom: 4,
  },
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
