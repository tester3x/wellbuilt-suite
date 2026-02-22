// src/core/components/OfflineBanner.tsx
// Persistent banner shown when the app is offline.
// Matches WB Suite's dark theme.

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { colors } from '@/core/theme';
import { isOnline, onConnectivityChange } from '@/core/services/connectivity';

export function OfflineBanner() {
  const [offline, setOffline] = useState(!isOnline());
  const slideAnim = useRef(new Animated.Value(offline ? 0 : -40)).current;

  useEffect(() => {
    const unsub = onConnectivityChange((online) => {
      setOffline(!online);
    });
    return unsub;
  }, []);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: offline ? 0 : -40,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [offline]);

  if (!offline) return null;

  return (
    <Animated.View style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.dot} />
      <Text style={styles.text}>No Connection — Your work is saved locally</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.status.error,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 16,
    zIndex: 999,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FCA5A5',
    marginRight: 8,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
});
