/**
 * The handoff surface itself — and the owner of the ONE AppState
 * subscription and the ONE staleness ticker the store needs.
 *
 * Mounted once in app/_layout.tsx, rendered AFTER the router Stack so it
 * draws above every screen. While the store is non-idle it covers the whole
 * window with the audience-aware copy; while idle it renders nothing and
 * costs nothing but a subscription.
 *
 * VISUAL ONLY, enforced by its imports: the store (pure) and React Native
 * primitives. No route adapter, no runtime, no issuance surface — a remount
 * cannot start, retry, or duplicate anything.
 *
 * Platform-signal ownership lives HERE, not in the store, so the store
 * stays node-testable: this component forwards AppState changes (which can
 * only ever clear callback_launched — see the store's proof) and runs a 1 s
 * staleness check while non-idle. Interval-based rather than per-arm timers,
 * which makes "stale timers must not clear a newer handoff" structural: every
 * check measures elapsed time against the CURRENT handoff.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/core/theme';
import {
  getSsoHandoffState,
  noteSsoHandoffAppState,
  noteSsoHandoffTimeoutCheck,
  ssoHandoffCopy,
  subscribeSsoHandoff,
  type SsoHandoffState,
} from '@/core/services/ssoHandoffOverlayStore';

export default function SsoHandoffOverlay() {
  const [state, setState] = useState<SsoHandoffState>(getSsoHandoffState());

  useEffect(() => subscribeSsoHandoff(setState), []);

  // The single AppState forwarder. SEEDED from the current value at
  // subscribe time so the store's memory reflects reality before the first
  // change event; thereafter every event is recorded, and only a
  // callback_launched departure can clear (see the store's proof).
  useEffect(() => {
    noteSsoHandoffAppState(AppState.currentState);
    const sub = AppState.addEventListener('change', (next) => {
      noteSsoHandoffAppState(next);
    });
    return () => sub.remove();
  }, []);

  // Staleness ticker — runs only while a handoff is live.
  useEffect(() => {
    if (state.phase === 'idle') return;
    const id = setInterval(() => noteSsoHandoffTimeoutCheck(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [state.phase]);

  if (state.phase === 'idle') return null;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <ActivityIndicator size="large" color={colors.brand.primary} />
      <Text style={styles.text}>{ssoHandoffCopy(state.phase, state.audience)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    zIndex: 1000,
    elevation: 1000,
  },
  text: {
    marginTop: 16,
    color: colors.text.secondary,
    fontSize: 15,
    textAlign: 'center',
  },
});
