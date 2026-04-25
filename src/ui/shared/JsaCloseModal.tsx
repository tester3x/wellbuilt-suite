// JsaCloseModal (WB S) — Shift-end JSA gate.
//
// Same shape as WB T's JsaCloseModal: Acknowledged + Read JSA + Cancel.
// Fires from day-summary.tsx when the driver taps Log Out and the
// company has jsaMode='per_shift' AND jsa_day_status.jsaCompleted !== true.
//
// When company.jsaAllowAcknowledge === false, Acknowledged greys out and
// the driver MUST tap Read JSA — same enforcement as WB T.

import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface Props {
  visible: boolean;
  /** Company-level toggle (default true). Greys Acknowledged when false. */
  allowAcknowledge: boolean;
  /** True when an acknowledgment write is in flight. */
  busy?: boolean;
  /** Brand accent color for the primary button. */
  accent: string;
  onAcknowledge: () => void;
  onRead: () => void;
  onCancel: () => void;
}

export default function JsaCloseModal({
  visible,
  allowAcknowledge,
  busy = false,
  accent,
  onAcknowledge,
  onRead,
  onCancel,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => !busy && onCancel()}
    >
      <View style={s.backdrop}>
        <View style={s.content}>
          <View style={s.headerRow}>
            <MaterialCommunityIcons name="shield-check" size={24} color={accent} />
            <Text style={[s.title, { color: accent }]}>JSA Required to End Shift</Text>
          </View>

          <Text style={s.subtitle}>
            Your Job Safety Analysis hasn't been completed yet today. Acknowledge or read the JSA to log out.
          </Text>

          {!allowAcknowledge ? (
            <View style={s.warningBox}>
              <MaterialCommunityIcons name="information-outline" size={16} color="#fbbf24" />
              <Text style={s.warningText}>
                Your company requires drivers to read the full JSA. Tap Read JSA to continue.
              </Text>
            </View>
          ) : null}

          <View style={s.buttonsCol}>
            <Pressable
              style={[
                s.primaryBtn,
                { backgroundColor: accent },
                (!allowAcknowledge || busy) && s.btnDisabled,
              ]}
              onPress={onAcknowledge}
              disabled={!allowAcknowledge || busy}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <>
                  <MaterialCommunityIcons name="check-circle" size={18} color="#000" />
                  <Text style={s.primaryText}>Acknowledged</Text>
                </>
              )}
            </Pressable>

            <Pressable
              style={[s.secondaryBtn, busy && s.btnDisabled]}
              onPress={onRead}
              disabled={busy}
            >
              <MaterialCommunityIcons name="file-document-outline" size={18} color="#fff" />
              <Text style={s.secondaryText}>Read JSA</Text>
            </Pressable>

            <Pressable
              style={[s.cancelBtn, busy && s.btnDisabled]}
              onPress={onCancel}
              disabled={busy}
            >
              <Text style={s.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  content: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: { fontSize: 18, fontWeight: '700' },
  subtitle: {
    color: '#aaa',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  warningBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.25)',
  },
  warningText: { color: '#fde68a', fontSize: 12, flex: 1, lineHeight: 16 },
  buttonsCol: { gap: 8 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
  },
  primaryText: { color: '#000', fontWeight: '700', fontSize: 15 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#2c2c2c',
    borderWidth: 1,
    borderColor: '#444',
  },
  secondaryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  cancelBtn: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelText: { color: '#888', fontSize: 13 },
  btnDisabled: { opacity: 0.4 },
});
