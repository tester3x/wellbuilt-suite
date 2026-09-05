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
import SsoHandoffOverlay from '@/core/components/SsoHandoffOverlay';
import {
  acceptSsoAuthorizeUrl,
  bindSsoAuthorizeDispatch,
  bindSsoTerminalDispatch,
  notifySsoInboxSession,
} from '@/core/services/ssoAuthorizeInbox';
import { getSsoSessionGate } from '@/core/services/ssoSessionGate';
import { dispatchSsoUrl } from '@/core/services/ssoRuntime';
import { isSsoAuthorizeUrl } from '@/core/services/ssoRouteAdapter';

// Keep the native splash screen visible until we're ready
// This prevents the black flicker between native splash and React render
SplashScreen.preventAutoHideAsync();

/**
 * SSO Linking ownership is mounted once. It must not tear down when
 * AuthContext replaces `user` after session revalidation — that gap
 * dropped onNewIntent authorize URLs. Inbox queues until the session
 * gate is ready and deduplicates initial/runtime/resume deliveries.
 */
function SsoAuthorizeListener() {
  useEffect(() => {
    bindSsoAuthorizeDispatch((url) => dispatchSsoUrl(url));
    // Terminal error return: a stranded authorize routes through the same handler,
    // which returns a bounded error callback (ssoAuthorizationCore refuses to
    // issue a code unless reconciliation is verified) so WB-E is not stranded.
    bindSsoTerminalDispatch((url) => dispatchSsoUrl(url));
    Linking.getInitialURL().then((url) => acceptSsoAuthorizeUrl(url, 'initial'));
    const sub = Linking.addEventListener('url', (e) => {
      acceptSsoAuthorizeUrl(e.url, 'runtime');
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      notifySsoInboxSession(getSsoSessionGate());
      Linking.getInitialURL().then((url) => acceptSsoAuthorizeUrl(url, 'resume'));
    });
    return () => {
      sub.remove();
      app.remove();
    };
  }, []);

  return null;
}

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

    const route = async (url: string | null | undefined) => {
      if (!url) return;
      if (isSsoAuthorizeUrl(url)) return;
      void handleUrl(url);
    };

    const sub = Linking.addEventListener('url', (e) => {
      void route(e.url);
    });
    Linking.getInitialURL().then((url) => {
      void route(url);
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
              <SsoAuthorizeListener />
              <DvirReceiptListener />
              <DvirHandoffHost />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.bg.primary },
                  animation: 'fade',
                }}
              />
              {/* Continuous outbound-handoff surface. Rendered AFTER the
                  Stack so it draws above every screen — armed at the
                  Tickets tap, it rides the backgrounded tree and is already
                  covering Home when the authorize intent re-fronts Suite,
                  which is what removes the cold double-Home artifact. */}
              <SsoHandoffOverlay />
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
