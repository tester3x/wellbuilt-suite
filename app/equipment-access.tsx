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
import AsyncStorage from '@react-native-async-storage/async-storage';

const valid = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
export default function EquipmentAccess() {
  const params = useLocalSearchParams();
  const { user, loading, isAuthenticated } = useAuth();
  const gate = useSsoSessionGate();
  const ran = useRef(false);
  const [message, setMessage] = useState('Opening Equipment with your Suite account…');
  const [working, setWorking] = useState(true);
  const [dots, setDots] = useState('.');
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setDots(value => value.length === 3 ? '.' : value + '.'), 450);
    return () => clearInterval(timer);
  }, [working]);
  useEffect(() => {
    if (loading || gate !== 'ready' || !isAuthenticated || !user || ran.current) return;
    let cancelled = false;
    ran.current = true;
    void (async () => {
      if (!valid(params.state) || !valid(params.codeChallenge)) throw new Error('Invalid sign-on request');
      // Navigation history only, never authentication or inspection authority.
      // Android can re-deliver the last Activity intent when Suite is reopened.
      const saved = await AsyncStorage.getItem('wbs.completedEquipmentLaunches.v1');
      let completed: string[] = [];
      try { const parsed = saved ? JSON.parse(saved) : []; if (Array.isArray(parsed)) completed = parsed.filter(valid); } catch {}
      if (cancelled) return;
      if (completed.includes(params.state)) { router.replace('/home'); return; }
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
      await AsyncStorage.setItem('wbs.completedEquipmentLaunches.v1', JSON.stringify([params.state, ...completed].slice(0, 20)));
      if (!cancelled) router.replace('/home');
      await trackSSOApp('wbequipment');
      if (!cancelled) { setWorking(false); setMessage('Equipment sign-on sent.'); }
    })().catch(() => { if (!cancelled) { setWorking(false); setMessage('Equipment access could not be confirmed. Return to Suite and retry.'); } });
    return () => { cancelled = true; };
  }, [loading, gate, isAuthenticated, user?.passcodeHash, user?.companyId, params.state, params.codeChallenge]);
  return <View onLayout={() => { void SplashScreen.hideAsync().catch(() => {}); }}
    style={{ flex: 1, backgroundColor: '#0A0E1A', justifyContent: 'center', padding: 28 }}>
    <Text style={{ color: 'white' }}>{!loading && !isAuthenticated ? 'Sign into Suite to open Equipment.' : message}</Text>
    {working && (loading || isAuthenticated) && <Text accessible={false} style={{ color: '#818CF8', fontSize: 32, height: 44 }}>{dots}</Text>}
    <Pressable onPress={() => router.replace('/home')}><Text style={{ color: '#818CF8', marginTop: 24 }}>Return to Suite</Text></Pressable>
  </View>;
}
