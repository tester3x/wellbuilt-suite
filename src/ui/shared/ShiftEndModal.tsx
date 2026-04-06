// ShiftEndModal — simple confirmation to start return drive.
// No odometer here — that moves to ShiftArrivalModal (you don't know
// end odometer until you've driven back to the yard).

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius } from '@/core/theme';

interface ShiftEndModalProps {
  visible: boolean;
  onClose: () => void;
  onReturnToYard: () => void;
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
  const shiftDuration = formatShiftDuration(shiftStartTime);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          <MaterialCommunityIcons name="truck" size={36} color={colors.status.warning} style={s.headerIcon} />
          <Text style={s.title}>Return to Yard</Text>
          <Text style={s.subtitle}>Start your return drive. Your drive time will be tracked.</Text>

          {/* Shift Summary */}
          <View style={s.summaryRow}>
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel}>SHIFT TIME</Text>
              <Text style={s.summaryValue}>{shiftDuration}</Text>
            </View>
          </View>

          {/* Buttons */}
          <View style={s.buttons}>
            <Pressable onPress={() => { onReturnToYard(); }} style={[s.btn, s.btnReturn]}>
              <MaterialCommunityIcons name="truck-fast" size={20} color="#000" />
              <Text style={s.btnReturnText}>Return to Yard</Text>
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
  buttons: {
    gap: 8,
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
