// JsaChoiceModal — shown after shift start when JSA mode is on.
// Offers two choices: complete JSA now, or start working and do it later.

import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '@/core/theme';

interface JsaChoiceModalProps {
  visible: boolean;
  onCompleteNow: () => void;
  onStartWorking: () => void;
}

export default function JsaChoiceModal({ visible, onCompleteNow, onStartWorking }: JsaChoiceModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={s.overlay}>
        <View style={s.card}>
          {/* Header */}
          <View style={s.header}>
            <View style={s.iconCircle}>
              <MaterialCommunityIcons name="shield-check" size={32} color="#f59e0b" />
            </View>
            <Text style={s.title}>Job Safety Analysis</Text>
            <Text style={s.subtitle}>
              A JSA is required once per shift. You can complete it now or start working and do it later.
            </Text>
          </View>

          {/* Options */}
          <View style={s.options}>
            <Pressable onPress={onCompleteNow} style={s.optionPrimary}>
              <MaterialCommunityIcons name="shield-edit-outline" size={22} color="#000" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.optionPrimaryTitle}>Complete JSA Now</Text>
                <Text style={s.optionPrimarySubtitle}>Opens the JSA app — takes 2-3 minutes</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color="#000" />
            </Pressable>

            <Pressable onPress={onStartWorking} style={s.optionSecondary}>
              <MaterialCommunityIcons name="truck-fast-outline" size={22} color={colors.text.primary} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.optionSecondaryTitle}>Start Working</Text>
                <Text style={s.optionSecondarySubtitle}>JSA later — you'll be reminded on each job</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.text.muted} />
            </Pressable>
          </View>

          <Text style={s.footer}>
            You must complete your JSA before ending your shift.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.bg.card,
    borderRadius: radius.xl,
    width: '100%',
    maxWidth: 380,
    padding: spacing.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text.primary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  options: {
    gap: 10,
    marginBottom: spacing.md,
  },
  optionPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f59e0b',
    borderRadius: radius.lg,
    padding: 14,
  },
  optionPrimaryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
  },
  optionPrimarySubtitle: {
    fontSize: 11,
    color: 'rgba(0,0,0,0.6)',
    marginTop: 1,
  },
  optionSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.elevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: 14,
  },
  optionSecondaryTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text.primary,
  },
  optionSecondarySubtitle: {
    fontSize: 11,
    color: colors.text.muted,
    marginTop: 1,
  },
  footer: {
    fontSize: 11,
    color: colors.text.muted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
