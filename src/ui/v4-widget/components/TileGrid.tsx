import React from 'react';
import { View, StyleSheet } from 'react-native';
import { spacing } from '@/core/theme';

interface TileGridProps {
  children: React.ReactNode;
}

export function TileGrid({ children }: TileGridProps) {
  return (
    <View style={styles.container}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
