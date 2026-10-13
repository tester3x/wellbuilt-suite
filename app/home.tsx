import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRootNavigationState } from 'expo-router';
import { useAuth } from '@/core/context/AuthContext';
import { useSkin } from '@/core/context/SkinContext';
import { colors } from '@/core/theme';

export default function HomeRoute() {
  const { skin } = useSkin();
  const { loading } = useAuth();
  const navigation = useRootNavigationState();
  // Skin Home screens redirect genuinely signed-out users. Do not mount
  // those effects during local session restoration or before Router is ready.
  if (loading || !navigation?.key) {
    return <View style={{ flex: 1, backgroundColor: colors.bg.primary, justifyContent: 'center' }}>
      <ActivityIndicator color={colors.brand.accent} />
    </View>;
  }
  const Screen = skin.screens.HomeScreen;
  return <Screen />;
}
