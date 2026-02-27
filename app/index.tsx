// app/index.tsx
// App entry point — checks auth state and redirects.
// 1. Native splash stays visible (preventAutoHideAsync in _layout.tsx)
// 2. AuthContext checks SecureStore (instant for returning users via optimistic auth)
// 3. Hide splash → redirect to /home or /login
// Note: SplashScreen API only works in production builds, not Expo Go.

import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { Redirect } from 'expo-router';
import { useAuth } from '@/core/context/AuthContext';
import { colors } from '@/core/theme';

export default function Index() {
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      // Auth resolved — hide the native splash screen
      // No-op in Expo Go, works in production builds
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [loading]);

  if (loading) {
    // Native splash is still visible in production builds
    // In Expo Go this will briefly show as empty dark screen
    return <View style={styles.container} />;
  }

  return <Redirect href={isAuthenticated ? '/home' : '/login'} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
});
