/**
 * app/sso-authorize.tsx — Expo Router landing for
 *   wellbuilt-suite://sso-authorize?...
 *
 * Without this file Expo shows "Unmatched Route" even though Linking
 * listeners also dispatch the URL via dispatchSsoUrl / ssoRouteAdapter.
 *
 * Semantic owner remains ssoRuntime.dispatchSsoUrl (duplicate-safe).
 * This screen only reconstructs the deep link and forwards once so the
 * authorization UI is not an Unmatched flash.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors } from '@/core/theme';
import {
  SSO_AUTHORIZE_HOST,
  SSO_AUTHORIZE_SCHEME,
} from '../src/core/services/ssoProtocol.generated';

export default function SsoAuthorizeScreen() {
  const params = useLocalSearchParams();
  const ran = useRef(false);
  const [status, setStatus] = useState<'working' | 'done' | 'error'>('working');

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    void (async () => {
      try {
        const qs = new URLSearchParams();
        for (const [key, raw] of Object.entries(params)) {
          if (raw == null) continue;
          const value = Array.isArray(raw) ? raw[0] : raw;
          if (typeof value === 'string') qs.set(key, value);
        }
        const url = `${SSO_AUTHORIZE_SCHEME}://${SSO_AUTHORIZE_HOST}?${qs.toString()}`;
        const { dispatchSsoUrl } = await import('../src/core/services/ssoRuntime');
        await dispatchSsoUrl(url);
        setStatus('done');
      } catch {
        setStatus('error');
      }
    })();
  }, [params]);

  return (
    <View style={styles.container}>
      {status === 'working' ? (
        <>
          <ActivityIndicator color={colors.brand.primary} size="large" />
          <Text style={styles.text}>Authorizing equipment…</Text>
        </>
      ) : status === 'error' ? (
        <Text style={styles.text}>Authorization could not complete.</Text>
      ) : (
        <Text style={styles.text}>Returning to equipment…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  text: {
    marginTop: 16,
    color: colors.text.secondary,
    fontSize: 15,
    textAlign: 'center',
  },
});
