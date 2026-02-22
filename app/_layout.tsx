import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import '@/core/localization/i18n';
import { LanguageProvider } from '@/core/localization';
import { SkinProvider } from '@/core/context/SkinContext';
import { AuthProvider } from '@/core/context/AuthContext';
import { UserAppsProvider } from '@/core/context/UserAppsContext';
import { OfflineBanner } from '@/core/components/OfflineBanner';
import { colors } from '@/core/theme';
import { allSkins, defaultSkinId } from '@/ui/skins';
import { startConnectivityMonitor, stopConnectivityMonitor } from '@/core/services/connectivity';

export default function RootLayout() {
  useEffect(() => {
    startConnectivityMonitor();
    return () => stopConnectivityMonitor();
  }, []);

  return (
    <LanguageProvider>
      <SkinProvider skins={allSkins} defaultSkinId={defaultSkinId}>
        <AuthProvider>
          <UserAppsProvider>
            <View style={styles.container}>
              <StatusBar style="light" />
              <OfflineBanner />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.bg.primary },
                  animation: 'fade',
                }}
              />
            </View>
          </UserAppsProvider>
        </AuthProvider>
      </SkinProvider>
    </LanguageProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
});
