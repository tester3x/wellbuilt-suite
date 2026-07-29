/**
 * app/dvir-complete.tsx — Expo Router landing for
 *   wellbuilt-suite://dvir-complete?receipt=...&phase=...&shiftId=...
 *
 * Without this file Expo shows "Unmatched Route" even though Linking
 * listeners also try to ingest the URL. Mirrors app/resume.tsx for JSA
 * (wellbuilt-suite://resume) with DVIR receipt handling.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/core/context/AuthContext';
import { createSuiteDvirGate, makeDvirSsoGetter } from '@/core/services/dvirGate';
import { colors } from '@/core/theme';

export default function DvirCompleteScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    receipt?: string | string[];
    phase?: string | string[];
    shiftId?: string | string[];
  }>();
  const { user, confirmArrival, shiftActive } = useAuth();
  const ran = useRef(false);
  const [status, setStatus] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('Recording DVIR completion…');

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const receiptRaw = Array.isArray(params.receipt)
          ? params.receipt[0]
          : params.receipt;
        const phase = Array.isArray(params.phase) ? params.phase[0] : params.phase;
        const shiftId = Array.isArray(params.shiftId)
          ? params.shiftId[0]
          : params.shiftId;

        if (!receiptRaw) {
          setStatus('error');
          setMessage('DVIR return was missing a completion receipt.');
          setTimeout(() => router.replace('/home'), 1800);
          return;
        }

        // Reconstruct a full URL so existing ingestDvirCompletionUrl can parse it
        const qs = new URLSearchParams();
        qs.set('receipt', receiptRaw);
        if (phase) qs.set('phase', phase);
        if (shiftId) qs.set('shiftId', shiftId);
        const synthetic = `wellbuilt-suite://dvir-complete?${qs.toString()}`;

        const gate = createSuiteDvirGate({
          getSso: makeDvirSsoGetter(user),
          isShiftActive: () => shiftActive,
        });

        const result = await gate.ingestDvirCompletionUrl(synthetic);
        if (!result.ok) {
          console.warn('[dvir-complete] rejected:', result.reason);
          setStatus('error');
          setMessage(result.reason || 'Could not accept DVIR completion.');
          setTimeout(() => router.replace('/home'), 2200);
          return;
        }

        const phaseLabel =
          result.receipt.phase === 'post_trip' ? 'Post-Trip' : 'Pre-Trip';
        setStatus('ok');
        setMessage(
          result.created
            ? `${phaseLabel} DVIR recorded.`
            : `${phaseLabel} DVIR already recorded.`,
        );

        if (result.receipt.phase === 'pre_trip') {
          await gate.finalizeShiftDvirSummary(result.receipt.shiftId);
          setTimeout(() => router.replace('/home'), 900);
          return;
        }

        // Post-Trip: resume arrival if pending, else home / day-summary
        const pending = await gate.consumePendingEndShiftIfReady();
        if (pending.resume && shiftActive) {
          try {
            await confirmArrival(pending.odometerMiles);
            setTimeout(() => router.replace('/day-summary'), 600);
            return;
          } catch (err) {
            console.warn('[dvir-complete] confirmArrival failed:', err);
          }
        }
        await gate.clearDvirRoutingAfterFinalization();
        await gate.finalizeShiftDvirSummary(result.receipt.shiftId);
        setTimeout(() => router.replace(shiftActive ? '/home' : '/day-summary'), 900);
      } catch (err) {
        console.warn('[dvir-complete] handler failed:', err);
        setStatus('error');
        setMessage('Something went wrong accepting the DVIR return.');
        setTimeout(() => router.replace('/home'), 2000);
      }
    })();
  }, [params.receipt, params.phase, params.shiftId, user, shiftActive, confirmArrival, router]);

  return (
    <View style={styles.container}>
      {status === 'working' ? (
        <ActivityIndicator color={colors.brand.accent} size="large" />
      ) : null}
      <Text
        style={[
          styles.message,
          status === 'error' && styles.error,
          status === 'ok' && styles.ok,
        ]}
      >
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  message: {
    marginTop: 16,
    color: colors.text.secondary,
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '600',
  },
  ok: { color: '#22c55e' },
  error: { color: '#f59e0b' },
});
