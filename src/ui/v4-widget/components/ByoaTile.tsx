import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '@/core/theme';
import { ExternalApp } from '@/core/data/externalApps';

interface ByoaTileProps {
  app: ExternalApp;
  onPress: () => void;
}

export function ByoaTile({ app, onPress }: ByoaTileProps) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.container, pressed && styles.pressed]}>
      <View style={[styles.iconWrap, { backgroundColor: `${app.color}15` }]}>
        <MaterialCommunityIcons name={app.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={18} color={app.color} />
      </View>
      <Text style={styles.name} numberOfLines={1}>{app.name}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { width: '22%', alignItems: 'center', padding: spacing.sm },
  pressed: { opacity: 0.7 },
  iconWrap: { width: 40, height: 40, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  name: { ...typography.caption, color: colors.text.muted, fontSize: 9, textAlign: 'center' },
});
