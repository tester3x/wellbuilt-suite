import React, { useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { usePathname } from 'expo-router';
import { useAuth } from '@/core/context/AuthContext';
import { useSsoSessionGate } from '@/core/hooks/useSsoSessionGate';
import { resolveDvirRecovery, saveDvirRecoveryFeedback, type DvirRecovery } from '@/core/services/dvirGate/dvirRecovery';
import { createSuiteDvirGate } from '@/core/services/dvirGate';
import { launchEquipmentPhase } from '@/core/services/dvirGate/dvirGateService';
import { clearGovernedEquipmentHandoff, hydrateGovernedEquipmentHandoff, subscribeGovernedHandoffChanged } from '@/core/services/dvirGate/equipmentHandoffBinding';

const reasons = [
  ['app_or_connection', 'App or connection problem'],
  ['phone_unavailable', 'Phone shut down or was unavailable'],
  ['forgot', 'Forgot to finish'],
  ['other', 'Other'],
] as const;

/** Recovery belongs to the authenticated driver, independently of clock-in state. */
export default function DvirRecoveryHost() {
  const { user, loading } = useAuth();
  const gate = useSsoSessionGate();
  const path = usePathname();
  const [recovery, setRecovery] = useState<DvirRecovery | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const generation = useRef(0);
  const available = !loading && !!user && gate === 'ready' && path === '/home' && foreground;
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      setForeground(state === 'active');
      if (state === 'active') setRevision(n => n + 1);
    });
    const unsub = subscribeGovernedHandoffChanged(() => setRevision(n => n + 1));
    return () => { sub.remove(); unsub(); };
  }, []);
  useEffect(() => {
    const gen = ++generation.current;
    setRecovery(null);
    setError('');
    if (!available) return;
    void (async () => {
      // Do not intercept the Suite authorization leg of a live handoff.
      const handoff = await hydrateGovernedEquipmentHandoff();
      if (handoff && handoff.purpose !== 'recovery') return;
      const next = await resolveDvirRecovery();
      if (gen !== generation.current) return;
      if (handoff?.purpose === 'recovery') {
        // A recovery return goes Home, not through current-shift receipt close.
        // Retire its Suite handoff once the server no longer lists that report,
        // then allow the next older obligation to surface immediately.
        if (next?.shiftId === handoff.shiftId) return;
        await clearGovernedEquipmentHandoff('recovery_no_longer_pending');
        if (gen !== generation.current) return;
      }
      setRecovery(next);
      setReason('');
      setNote('');
    })().catch(() => {
      if (gen === generation.current) setError('Could not check unfinished inspections. Tap to retry.');
    });
    return () => { generation.current++; };
  }, [available, user, revision]);

  const openRecovery = async () => {
    if (!recovery || busy) return;
    setBusy(true);
    const expected = generation.current;
    try {
      const fresh = await resolveDvirRecovery();
      if (expected !== generation.current) return;
      if (!fresh || fresh.shiftId !== recovery.shiftId) { setRevision(n => n + 1); return; }
      if (reason || note.trim()) {
        try { await saveDvirRecoveryFeedback(fresh.shiftId, reason || 'other', note); }
        catch { /* Optional feedback must never prevent the actual close-out. */ }
      }
      if (expected !== generation.current) return;
      const result = await launchEquipmentPhase(createSuiteDvirGate(), 'post_trip', fresh.shiftId, true);
      if (!result.launched) {
        await clearGovernedEquipmentHandoff('recovery_open_failed');
        setError(result.error || 'Could not open Equipment. Please retry.');
      }
    } catch {
      setError('Could not open the unfinished inspection. Please retry.');
    } finally { setBusy(false); }
  };
  return <>
    {available && error && !recovery ? <Pressable onPress={() => setRevision(n => n + 1)} style={s.banner}>
      <Text style={s.text}>{error}</Text>
    </Pressable> : null}
    <Modal visible={available && !!recovery} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={s.backdrop}><ScrollView style={s.card} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>Finish an earlier inspection</Text>
        <Text style={s.text}>Your account has an unfinished Post-Trip from the shift that started {recovery?.shiftId.slice(0, 10)}. Please finish it so your records are complete.</Text>
        <Text style={s.text}>This closes that inspection only. It will not clock you in or reopen the earlier shift.</Text>
        <Text style={s.heading}>What happened? (optional)</Text>
        <Text style={s.text}>This helps WellBuilt find app or connection problems. You can leave it blank.</Text>
        {reasons.map(([value, label]) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: reason === value }}
          onPress={() => setReason(reason === value ? '' : value)} style={[s.choice, reason === value && s.selected]}>
          <Text style={s.text}>{label}</Text>
        </Pressable>)}
        <TextInput accessibilityLabel="Optional details" placeholder="Anything else that would help? (optional)" placeholderTextColor="#a4afc1"
          value={note} onChangeText={setNote} maxLength={500} multiline style={s.input} />
        {error ? <Text style={s.text}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void openRecovery()} style={s.button}>
          <Text style={s.buttonText}>{busy ? 'Opening inspection…' : 'Finish Post-Trip'}</Text>
        </Pressable>
      </ScrollView></View>
    </Modal>
  </>;
}
const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000b', justifyContent: 'center', padding: 22 },
  card: { backgroundColor: '#172033', borderRadius: 20, maxHeight: '90%' },
  content: { padding: 24, gap: 14 }, title: { color: '#fff', fontSize: 24, fontWeight: '700' },
  heading: { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 8 },
  text: { color: '#e3e9f1', fontSize: 16, lineHeight: 23 },
  choice: { padding: 12, borderWidth: 1, borderColor: '#526077', borderRadius: 10 },
  selected: { borderColor: '#67b4ff', backgroundColor: '#23476b' },
  input: { color: '#fff', borderWidth: 1, borderColor: '#526077', borderRadius: 10, padding: 12, minHeight: 70, textAlignVertical: 'top' },
  button: { padding: 16, backgroundColor: '#4ca3ff', borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#071a30', fontWeight: '700', fontSize: 17 },
  banner: { position: 'absolute', top: 65, left: 16, right: 16, zIndex: 50, backgroundColor: '#563c17', padding: 14, borderRadius: 12 },
});
