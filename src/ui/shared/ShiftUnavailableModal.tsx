import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius } from '@/core/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onRetry: () => void;
};

export default function ShiftUnavailableModal({ visible, onClose, onRetry }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          <MaterialCommunityIcons name="cloud-alert-outline" size={38} color={colors.status.warning} style={s.icon} />
          <Text style={s.title}>Shift status unavailable</Text>
          <Text style={s.message}>
            Suite could not confirm your shift status. This does not end your shift. We’ll retry automatically.
          </Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={[s.button, s.retry]}>
            <MaterialCommunityIcons name="refresh" size={20} color="#000" />
            <Text style={s.retryText}>Try now</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onClose} style={[s.button, s.close]}>
            <Text style={s.closeText}>Close</Text>
          </Pressable>
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
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.lg,
    padding: 24,
  },
  icon: { alignSelf: 'center', marginBottom: 8 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center' },
  message: { color: colors.text.muted, fontSize: 14, textAlign: 'center', lineHeight: 20, marginTop: 8, marginBottom: 20 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: radius.md },
  retry: { backgroundColor: colors.status.warning },
  retryText: { color: '#000', fontSize: 16, fontWeight: '700' },
  close: { marginTop: 4 },
  closeText: { color: colors.text.muted, fontSize: 14, fontWeight: '500' },
});
