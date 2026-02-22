// app/index.tsx
// App entry point — checks auth state and redirects.
// Mirrors WB M's index.tsx pattern:
// 1. Check SecureStore for saved session
// 2. Revalidate against Firebase RTDB
// 3. Route to /home (authenticated) or /login (not authenticated)

import React from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/core/context/AuthContext';
import { colors } from '@/core/theme';

export default function Index() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.brand.primary} />
      </View>
    );
  }

  return <Redirect href={isAuthenticated ? '/home' : '/login'} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg.primary,
  },
});
