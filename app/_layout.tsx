import React, { useEffect, useRef } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppState, Platform, View, StyleSheet, Linking } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import * as NavigationBar from 'expo-navigation-bar';
import '@/core/localization/i18n';
import { LanguageProvider } from '@/core/localization';
import { SkinProvider } from '@/core/context/SkinContext';
import { AuthProvider, useAuth } from '@/core/context/AuthContext';

import { FirstLaunchProvider } from '@/core/context/FirstLaunchContext';
import { OfflineBanner } from '@/core/components/OfflineBanner';
import { colors } from '@/core/theme';
import { allSkins, defaultSkinId } from '@/ui/skins';
import { startConnectivityMonitor, stopConnectivityMonitor } from '@/core/services/connectivity';
import { createSuiteDvirGate, makeDvirSsoGetter } from '@/core/services/dvirGate';
import DvirHandoffHost from '@/ui/shared/DvirHandoffHost';

// Keep the native splash screen visible until we're ready
// This prevents the black flicker between native splash and React render
SplashScreen.preventAutoHideAsync();

/**
 * Ingest eQuipment → Suite DVIR completion receipts and resume end-shift
 * when a pending Post-Trip gate is satisfied.
 */
function DvirReceiptListener() {
  const { user, confirmArrival, shiftActive } = useAuth();
  const handled = useRef<Set<string>>(new Set());
  const shiftActiveRef = useRef(shiftActive);
  shiftActiveRef.current = shiftActive;

  useEffect(() => {
    const gate = createSuiteDvirGate({
      getSso: makeDvirSsoGetter(user),
      isShiftActive: () => shiftActiveRef.current,
    });

    const handleUrl = async (url: string | null) => {
      if (!url || !url.includes('dvir-complete')) return;
      if (handled.current.has(url)) return;
      handled.current.add(url);

      const result = await gate.ingestDvirCompletionUrl(url);
      if (!result.ok) {
        console.warn('[DvirReceipt] rejected:', result.reason);
        return;
      }
      console.log(
        '[DvirReceipt] saved',
        result.receipt.phase,
        result.receipt.shiftId,
        result.created ? 'created' : 'idempotent',
      );

      // Resume end-shift if Post-Trip completed and pending flag set
      if (result.receipt.phase === 'post_trip') {
        const pending = await gate.consumePendingEndShiftIfReady();
        if (pending.resume && shiftActiveRef.current) {
          try {
            await confirmArrival(pending.odometerMiles);
            router.replace('/day-summary');
          } catch (err) {
            console.warn('[DvirReceipt] resume confirmArrival failed:', err);
          }
        } else if (!shiftActiveRef.current) {
          // Already finalized — ensure pending flag cannot re-hijack module taps
          await gate.clearDvirRoutingAfterFinalization();
          await gate.finalizeShiftDvirSummary(result.receipt.shiftId);
        } else {
          // Post-Trip complete while still active (arrival will finalize)
          await gate.finalizeShiftDvirSummary(result.receipt.shiftId);
        }
      }
    };

    const sub = Linking.addEventListener('url', (e) => {
      void handleUrl(e.url);
    });
    Linking.getInitialURL().then((url) => {
      void handleUrl(url);
    });

    return () => sub.remove();
  }, [user, confirmArrival]);

  return null;
}

export default function RootLayout() {
  useEffect(() => {
    // Full-screen immersive mode — hide Android navigation bar
    const hideNavBar = () => {
      if (Platform.OS === 'android') {
        NavigationBar.setVisibilityAsync('hidden');
        NavigationBar.setBehaviorAsync('overlay-swipe');
        NavigationBar.setBackgroundColorAsync('#00000000');
      }
    };
    hideNavBar();
    // Re-hide nav bar when app returns to foreground (deep links can re-show it)
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') hideNavBar();
    });

    startConnectivityMonitor();
    return () => { stopConnectivityMonitor(); appStateSub.remove(); };
  }, []);

  return (
    <LanguageProvider>
      <SkinProvider skins={allSkins} defaultSkinId={defaultSkinId}>
        <AuthProvider>
          <FirstLaunchProvider>
            <View style={styles.container}>
              <StatusBar style="light" />
              <OfflineBanner />
              <DvirReceiptListener />
              <DvirHandoffHost />
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
