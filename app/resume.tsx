// app/resume.tsx — Deep link landing for wellbuilt-suite://resume
// Called when JSA app returns via "Return to Work" deep link.
// Clears jsaPending flag and navigates to home screen.

import { useEffect } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';

export default function ResumeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  useEffect(() => {
    // JSA PDF URL may be passed back for attachment
    if (params.jsaPdfUrl) {
      console.log('[WB S] JSA return — PDF URL received:', String(params.jsaPdfUrl).substring(0, 60));
    }
    console.log('[WB S] JSA return — navigating home');
    router.replace('/home');
  }, []);

  return null;
}
