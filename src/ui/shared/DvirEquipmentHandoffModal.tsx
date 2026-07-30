/**
 * Branded Suite → WellBuilt eQuipment DVIR handoff notice.
 * Replaces the system gray Alert with Suite visual language (JsaChoiceModal pattern).
 */
import React, { useRef } from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, radius } from '@/core/theme';
import type { DvirReceiptPhase } from '@/core/services/dvirGate/receiptTypes';

export interface DvirEquipmentHandoffModalProps {
  visible: boolean;
  phase: DvirReceiptPhase;
  title: string;
  message: string;
  onContinue: () => void;
  onCancel: () => void;
}

export default function DvirEquipmentHandoffModal({
  visible,
  phase,
  title,
  message,
  onContinue,
  onCancel,
}: DvirEquipmentHandoffModalProps) {
  const locked = useRef(false);
  if (!visible) {
    locked.current = false;
  }

  const phaseLabel = phase === 'post_trip' ? 'Post-Trip DVIR' : 'Pre-Trip DVIR';
  const phaseColor = phase === 'post_trip' ? '#f59e0b' : colors.brand.accent;

  const handleContinue = () => {
    if (locked.current) return;
    locked.current = true;
    onContinue();
  };

  const handleCancel = () => {
    if (locked.current) return;
    locked.current = true;
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleCancel}
    >
      <View style={s.overlay} accessibilityViewIsModal>
        <View style={s.card} accessibilityRole="summary">
          <View style={s.header}>
            <View style={[s.iconCircle, { backgroundColor: `${phaseColor}22` }]}>
              <MaterialCommunityIcons
                name="clipboard-check-outline"
                size={32}
                color={phaseColor}
              />
            </View>
            <Text style={s.brandChip}>WellBuilt eQuipment</Text>
            <Text style={s.title}>{title}</Text>
            <View style={[s.phasePill, { borderColor: phaseColor }]}>
              <Text style={[s.phasePillText, { color: phaseColor }]}>{phaseLabel}</Text>
            </View>
            <Text style={s.subtitle}>{message}</Text>
          </View>

          <View style={s.buttons}>
            <Pressable
              onPress={handleContinue}
              style={[s.btnPrimary, { backgroundColor: phaseColor }]}
              accessibilityRole="button"
              accessibilityLabel="Continue to WellBuilt eQuipment"
            >
              <MaterialCommunityIcons name="arrow-right-circle" size={20} color="#000" />
              <Text style={s.btnPrimaryText}>Continue</Text>
            </Pressable>
            <Pressable
              onPress={handleCancel}
              style={s.btnSecondary}
              accessibilityRole="button"
              accessibilityLabel="Cancel handoff"
            >
              <Text style={s.btnSecondaryText}>Cancel</Text>
            </Pressable>
          </View>

          <Text style={s.footer}>
            You will return to WellBuilt Suite when this DVIR is finished.
          </Text>
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
    padding: 24,
  },
  card: {
    backgroundColor: colors.bg.card,
    borderRadius: radius.xl,
    width: '100%',
    maxWidth: 400,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  brandChip: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.brand.accent,
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text.primary,
    textAlign: 'center',
  },
  phasePill: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  phasePillText: {
    fontSize: 13,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 14,
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 20,
  },
  buttons: {
    gap: 10,
    marginBottom: spacing.md,
  },
  btnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  btnPrimaryText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#000',
  },
  btnSecondary: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    paddingVertical: 12,
    backgroundColor: colors.bg.elevated,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  btnSecondaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text.primary,
  },
  footer: {
    fontSize: 11,
    color: colors.text.muted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
