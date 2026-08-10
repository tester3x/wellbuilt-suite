/**
 * app/sso-authorize.tsx — Expo Router landing for
 *   wellbuilt-suite://sso-authorize?...
 *
 * Without this file Expo shows "Unmatched Route" even though Linking
 * listeners also dispatch the URL via dispatchSsoUrl / ssoRouteAdapter.
 *
 * Semantic owner remains ssoRuntime.dispatchSsoUrl (duplicate-safe).
 * This screen reconstructs the deep link, forwards once, then ALWAYS
 * leaves /sso-authorize for Home so a completed authorize cannot park
 * the user on a dead-end route after external SSO callbacks.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { colors } from '@/core/theme';
import {
  SSO_AUTHORIZE_HOST,
  SSO_AUTHORIZE_SCHEME,
} from '../src/core/services/ssoProtocol.generated';
import {
  audienceFromAuthorizeParams,
  authorizeWorkingCopy,
  decideAfterAuthorizeDispatch,
  type AuthorizeScreenStatus,
} from '../src/core/services/ssoAuthorizeScreenPolicy';

export default function SsoAuthorizeScreen() {
  const params = useLocalSearchParams();
  const ran = useRef(false);
  const [status, setStatus] = useState<AuthorizeScreenStatus>('working');
  const [message, setMessage] = useState<string | null>(null);

  const audience = audienceFromAuthorizeParams(
    params.aud as string | string[] | undefined,
  );
  const workingCopy = authorizeWorkingCopy(audience);

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
        // Full adapter outcome — not a guessed boolean.
        const result = await dispatchSsoUrl(url);
        const decision = decideAfterAuthorizeDispatch(result);

        if (decision.status === 'error') {
          setStatus('error');
          setMessage(decision.errorMessage);
        } else {
          setStatus('leaving');
          setMessage(null);
        }

        if (decision.navigateHome) {
          if (decision.homeDelayMs > 0) {
            setTimeout(() => {
              router.replace('/home');
            }, decision.homeDelayMs);
          } else {
            router.replace('/home');
          }
        }
      } catch {
        setStatus('error');
        setMessage('Authorization could not complete.');
        setTimeout(() => {
          router.replace('/home');
        }, 900);
      }
    })();
  }, [params]);

  return (
    <View style={styles.container}>
      {status === 'working' ? (
        <>
          <ActivityIndicator color={colors.brand.primary} size="large" />
          <Text style={styles.text}>{workingCopy}</Text>
        </>
      ) : status === 'error' ? (
        <Text style={styles.text}>{message || 'Authorization could not complete.'}</Text>
      ) : (
        // Brief leaving state while replace(Home) runs — no success/return copy.
        <ActivityIndicator color={colors.brand.primary} size="large" />
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
