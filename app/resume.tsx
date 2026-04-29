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

    // Diagnostic — capture the post-JSA-return state so a field-test
    // log can show whether the driver came back to an active shift or
    // is still in the pre-shift "JSA viewed" state. The home-screen
    // banner is driven by these same two values.
    (async () => {
      try {
        const [shiftStarted, currentShiftId, previewedAt] = await Promise.all([
          (await import('expo-secure-store')).getItemAsync('shiftStarted'),
          AsyncStorage.getItem('wellbuilt-current-shift-id'),
          AsyncStorage.getItem('wellbuilt-jsa-previewed-pre-shift'),
        ]);
        const shiftActive = shiftStarted === 'true';
        const willShowStartShiftCard = !shiftActive;
        console.log(JSON.stringify({
          tag: '[WB S][jsa.return]',
          currentShiftIdAsyncStorage: currentShiftId || null,
          shiftActive,
          previewedPreShiftAt: previewedAt || null,
          willShowStartShiftCard,
          reason: shiftActive
            ? 'shift active — Start Shift card hidden, active timer shown'
            : previewedAt
              ? 'shift NOT started — banner: JSA viewed, tap Start Shift'
              : 'shift NOT started, no preview breadcrumb — Start Shift card shown',
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
