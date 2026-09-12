import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Redirect, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useSkin } from '@/core/context/SkinContext';
import { useAuth } from '@/core/context/AuthContext';

export default function HomeRoute() {
  const { skin } = useSkin();
  const { loading, isAuthenticated } = useAuth();
  const navigation = useRootNavigationState();
  const ready = !loading && !!navigation?.key;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  // A cold Home link skips index.tsx. Do not mount a skin's redirecting effect
  // until authentication and the root navigator have both finished mounting.
  if (!ready) return <View style={{ flex: 1, backgroundColor: '#0A0E1A' }} />;
  if (!isAuthenticated) return <Redirect href="/" />;
  const Screen = skin.screens.HomeScreen;
  return <Screen />;
}
