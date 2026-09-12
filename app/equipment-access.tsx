import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { router, useLocalSearchParams } from 'expo-router';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '@/core/context/AuthContext';
import { useSsoSessionGate } from '@/core/hooks/useSsoSessionGate';
import { getFirebaseApp, FIREBASE_REGION } from '@/core/services/firebaseApp';
import { getOwnedVerifiedIdentity } from '@/core/services/firebaseAuthBoundary';
import { trackSSOApp } from '@/core/services/appLauncher';

const valid = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
export default function EquipmentAccess() {
  const params = useLocalSearchParams();
  const { user, loading, isAuthenticated } = useAuth();
  const gate = useSsoSessionGate();
  const ran = useRef(false);
  const [message, setMessage] = useState('Opening Equipment with your Suite account…');
  useEffect(() => {
    if (loading || gate !== 'ready' || !isAuthenticated || !user || ran.current) return;
    let cancelled = false;
    ran.current = true;
    void (async () => {
      if (!valid(params.state) || !valid(params.codeChallenge)) throw new Error('Invalid sign-on request');
      const identity = await getOwnedVerifiedIdentity(getFirebaseApp(), true);
      if (!identity || identity.kind !== 'driver' || identity.driverId !== user.passcodeHash || identity.companyId !== user.companyId) {
        throw new Error('Suite account could not be verified');
      }
      const { data } = await httpsCallable(getFunctions(getFirebaseApp(), FIREBASE_REGION), 'issueEquipmentAppSession')(
        { version: 1, codeChallenge: params.codeChallenge });
      const result = data as any;
      const current = await getOwnedVerifiedIdentity(getFirebaseApp());
      if (cancelled || current?.uid !== identity.uid || current?.driverId !== identity.driverId || current?.companyId !== identity.companyId) return;
      if (result?.version !== 1 || !valid(result.code)) throw new Error('Invalid sign-on response');
      await Linking.openURL(`wbequipment://app-callback?code=${result.code}&state=${params.state}`);
      await trackSSOApp('wbequipment');
      if (!cancelled) setMessage('Equipment sign-on sent.');
    })().catch(() => { if (!cancelled) setMessage('Equipment access could not be confirmed. Return to Suite and retry.'); });
    return () => { cancelled = true; };
  }, [loading, gate, isAuthenticated, user?.passcodeHash, user?.companyId, params.state, params.codeChallenge]);
  return <View onLayout={() => { void SplashScreen.hideAsync().catch(() => {}); }}
    style={{ flex: 1, backgroundColor: '#0A0E1A', justifyContent: 'center', padding: 28 }}>
    <Text style={{ color: 'white' }}>{!loading && !isAuthenticated ? 'Sign into Suite to open Equipment.' : message}</Text>
    <Pressable onPress={() => router.replace('/home')}><Text style={{ color: '#818CF8', marginTop: 24 }}>Return to Suite</Text></Pressable>
  </View>;
}
