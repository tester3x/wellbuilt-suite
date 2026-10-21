import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/core/context/AuthContext';
import { colors } from '@/core/theme';
import { cancelUnstartedShift } from '@/core/services/workPeriodAuthority/cancelUnstartedShift';

export default function CancelUnstartedShiftScreen() {
  const { user, shiftActive, returningToYard, refreshShiftAuthority } = useAuth();
  const currentOwner = useRef(user);
  currentOwner.current = user;
  const latch = useRef(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const cancel = async () => {
    if (latch.current || !user?.companyId || !shiftActive || returningToYard) return;
    const owner = user;
    latch.current = true; setBusy(true); setMessage('');
    try {
      await cancelUnstartedShift(reason, { driverId: owner.driverId, companyId: owner.companyId! });
      if (currentOwner.current?.driverId !== owner.driverId || currentOwner.current?.companyId !== owner.companyId) return;
      await refreshShiftAuthority();
      setMessage('Shift cancelled. No inspection or work time was recorded.');
      Alert.alert('Shift cancelled', 'The unstarted shift is cancelled. Your account stays signed in.', [
        { text: 'Suite home', onPress: () => router.replace('/home') },
      ]);
    } catch (error) {
      const code = String((error as { code?: string })?.code || '');
      setMessage(code.includes('failed-precondition')
        ? 'This shift has recorded work or inspection activity and cannot be cancelled here. Use the normal End Shift process.'
        : code.includes('unavailable') || code.includes('deadline')
          ? 'Could not confirm cancellation. Reconnect and retry; the same request is safe to repeat.'
          : (error instanceof Error ? error.message : 'Could not cancel. Your shift has not been cleared locally.'));
    } finally { latch.current = false; setBusy(false); }
  };
  const ready = !!user && shiftActive && !returningToYard && reason.trim().length >= 8;
  return <ScrollView style={{ flex: 1, backgroundColor: colors.bg.primary }} contentContainerStyle={{ padding: 28, paddingTop: 65 }} keyboardShouldPersistTaps="handled">
    <Text style={{ color: colors.text.primary, fontSize: 26, fontWeight: '700', marginBottom: 20 }}>Cancel unstarted shift</Text>
    <Text style={{ color: colors.text.primary, fontSize: 18, marginBottom: 22 }}>Use this only if you have not completed pre-trip, driven, or done work on this shift. The start and your cancellation reason will be kept in the audit history.</Text>
    <TextInput accessibilityLabel="Cancellation reason" placeholder="Reason for cancellation" placeholderTextColor={colors.text.muted}
      value={reason} onChangeText={setReason} editable={!busy} maxLength={240} multiline
      style={{ color: colors.text.primary, borderWidth: 1, borderColor: colors.text.muted, borderRadius: 12, minHeight: 110, padding: 16, fontSize: 18 }} />
    {!!message && <Text accessibilityRole="alert" style={{ color: colors.text.primary, marginTop: 20, fontSize: 17 }}>{message}</Text>}
    {busy && <ActivityIndicator style={{ marginTop: 20 }} color={colors.brand.accent} />}
    <Pressable accessibilityRole="button" disabled={!ready || busy} style={{ padding: 18, marginTop: 20, opacity: ready && !busy ? 1 : 0.4 }} onPress={() => Alert.alert(
      'Cancel this unstarted shift?', 'Confirm that you have not completed an inspection, driven, or performed work on this shift.',
      [{ text: 'Keep shift', style: 'cancel' }, { text: 'No work performed — cancel shift', style: 'destructive', onPress: () => void cancel() }],
    )}><Text style={{ color: colors.brand.accent, textAlign: 'center', fontWeight: '700', fontSize: 18 }}>Cancel shift</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.replace('/home')} style={{ padding: 18 }}><Text style={{ color: colors.brand.accent, textAlign: 'center', fontSize: 18 }}>Keep shift · Suite home</Text></Pressable>
  </ScrollView>;
}
