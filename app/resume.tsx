// app/resume.tsx — Deep link landing for wellbuilt-suite://resume
// Called when JSA app returns via "Return to Work" deep link.
// Clears jsaPending flag and navigates to home screen.

import { useEffect } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function ResumeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  useEffect(() => {
    // JSA PDF URL may be passed back for attachment
    if (params.jsaPdfUrl) {
      console.log('[WB S] JSA return — PDF URL received:', String(params.jsaPdfUrl).substring(0, 60));
    }

    // Diagnostic — post-JSA-return state. Pre-shift "JSA viewed" branch
    // retired 2026-05-01 (Preview-JSA launcher removed); the only valid
    // states now are shift-active (driver came back from JSA mid-shift)
    // or shift-not-started (driver opened JSA via the application grid
    // before clocking in — unusual but allowed).
    (async () => {
      try {
        const [shiftStarted, currentShiftId] = await Promise.all([
          (await import('expo-secure-store')).getItemAsync('shiftStarted'),
          AsyncStorage.getItem('wellbuilt-current-shift-id'),
        ]);
        const shiftActive = shiftStarted === 'true';
        console.log(JSON.stringify({
          tag: '[WB S][jsa.return]',
          currentShiftIdAsyncStorage: currentShiftId || null,
          shiftActive,
          reason: shiftActive
            ? 'shift active — JSA mid-shift return'
            : 'shift NOT started — driver opened JSA via app grid before clocking in',
          jsaPdfUrlReceived: !!params.jsaPdfUrl,
        }));
      } catch (err) {
        console.warn('[WB S][jsa.return] diagnostic failed:', err);
      }
    })();

    console.log('[WB S] JSA return — navigating home');
    router.replace('/home');
  }, []);

  return null;
}
