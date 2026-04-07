// SignatureModal — signature capture modal for WB S Settings.
// Wraps SignaturePad in a full-screen modal overlay.

import React, { useState, useRef, useCallback } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import SignaturePad, { type SignaturePadRef } from './SignaturePad';

interface SignatureModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (base64: string) => void;
  accent: string;
  title?: string;
}

export default function SignatureModal({ visible, onClose, onSave, accent, title = 'Driver Signature' }: SignatureModalProps) {
  const [hasDrawn, setHasDrawn] = useState(false);
  const sigRef = useRef<SignaturePadRef>(null);

  const handleSave = useCallback((base64: string) => {
    onSave(base64);
    onClose();
    setHasDrawn(false);
  }, [onSave, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
    setHasDrawn(false);
  }, [onClose]);

  const handleClear = useCallback(() => {
    sigRef.current?.clearSignature();
    setHasDrawn(false);
  }, []);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.box}>
          <Text style={[styles.title, { color: accent }]}>{title}</Text>
          <View style={styles.canvas}>
            <SignaturePad
              ref={sigRef}
              onBegin={() => setHasDrawn(true)}
              onSave={handleSave}
              penColor="#ffffff"
              backgroundColor="#1a1a1a"
              strokeWidth={5}
              style={{ width: '100%', height: 300 }}
            />
          </View>
          <View style={styles.actions}>
            <TouchableOpacity onPress={handleClear} disabled={!hasDrawn} style={styles.btn}>
              <Text style={[styles.btnText, !hasDrawn && { opacity: 0.3 }]}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => sigRef.current?.readSignature()}
              disabled={!hasDrawn}
              style={[styles.btn, styles.saveBtn, { backgroundColor: accent }]}
            >
              <Text style={[styles.saveText, !hasDrawn && { opacity: 0.3 }]}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleCancel} style={styles.btn}>
              <Text style={styles.btnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  box: {
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    padding: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  canvas: {
    width: '100%',
    height: 300,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#fff',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  saveBtn: {
    borderRadius: 8,
  },
  btnText: {
    color: '#888',
    fontSize: 14,
  },
  saveText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
  },
});
