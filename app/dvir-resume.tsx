import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useAuth } from '@/core/context/AuthContext';
import { createSuiteDvirGate, makeDvirSsoGetter } from '@/core/services/dvirGate';
import { getCurrentShiftId } from '@/core/services/shiftTracking';
import { useSsoSessionGate } from '@/core/hooks/useSsoSessionGate';

/** Recovery never enters the arrival/close path for an older shift's receipt. */
export default function DvirResumeScreen() {
  const { user, shiftActive, loading } = useAuth();
  const navigation = useRootNavigationState();
  const sessionGate = useSsoSessionGate();
  const params = useLocalSearchParams<{ shiftId?: string; phase?: string }>();
  const router = useRouter();
  const ran = useRef(false);
  const [message, setMessage] = useState('Post-Trip saved. Continuing your current inspection request…');
  useEffect(() => {
    if (ran.current || loading || !navigation?.key || sessionGate === 'pending') return;
    void SplashScreen.hideAsync().catch(() => {});
    if (!user) { router.replace('/'); return; }
    if (sessionGate !== 'ready') {
      setMessage('Post-Trip is saved. Restore your Suite sign-in before continuing.');
      return;
    }
    ran.current = true;
    void (async () => {
      const current = await getCurrentShiftId();
      if (!shiftActive || !current || current !== params.shiftId
          || (params.phase !== 'pre_trip' && params.phase !== 'post_trip')) {
        router.replace('/home');
        return;
      }
      const gate = createSuiteDvirGate({ getSso: makeDvirSsoGetter(user), isShiftActive: () => shiftActive });
      const result = await gate.launchPhase(params.phase, current);
      if (!result.launched) setMessage(result.error || 'Post-Trip is saved. Return Home and retry the current inspection.');
      else router.replace('/home');
    })().catch(() => setMessage('Post-Trip is saved. Return Home and retry the current inspection.'));
  }, [user, shiftActive, loading, navigation?.key, sessionGate, params.shiftId, params.phase, router]);
  return <View style={{ flex: 1, backgroundColor: '#0A0E1A', padding: 28, justifyContent: 'center' }}>
    <ActivityIndicator /><Text style={{ color: '#fff', textAlign: 'center', marginTop: 16 }}>{message}</Text>
    <Text accessibilityRole="button" onPress={() => router.replace('/home')}
      style={{ color: '#60a5fa', textAlign: 'center', padding: 24 }}>Return Home</Text>
  </View>;
}
