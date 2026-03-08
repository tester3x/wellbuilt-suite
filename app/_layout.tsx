import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, View, StyleSheet } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import * as NavigationBar from 'expo-navigation-bar';
import '@/core/localization/i18n';
import { LanguageProvider } from '@/core/localization';
import { SkinProvider } from '@/core/context/SkinContext';
import { AuthProvider } from '@/core/context/AuthContext';

import { FirstLaunchProvider } from '@/core/context/FirstLaunchContext';
import { OfflineBanner } from '@/core/components/OfflineBanner';
import { colors } from '@/core/theme';
import { allSkins, defaultSkinId } from '@/ui/skins';
import { startConnectivityMonitor, stopConnectivityMonitor } from '@/core/services/connectivity';

// Keep the native splash screen visible until we're ready
// This prevents the black flicker between native splash and React render
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    // Full-screen immersive mode — hide Android navigation bar
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden');
      NavigationBar.setBehaviorAsync('overlay-swipe');
      NavigationBar.setBackgroundColorAsync('#00000000');
    }

    startConnectivityMonitor();
    return () => stopConnectivityMonitor();
  }, []);

  return (
    <LanguageProvider>
      <SkinProvider skins={allSkins} defaultSkinId={defaultSkinId}>
        <AuthProvider>
          <FirstLaunchProvider>
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
          </FirstLaunchProvider>
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
