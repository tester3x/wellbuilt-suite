import React from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '@/core/theme';

interface ShiftButtonProps {
  active: boolean;
  onEndShift: () => Promise<void>;
}

export function ShiftButton({ active, onEndShift }: ShiftButtonProps) {
  const handlePress = () => {
    if (!active) return;
    Alert.alert(
      'End Shift',
      'Record your shift end time and GPS location?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Shift',
          onPress: onEndShift,
          style: 'destructive',
        },
      ],
    );
  };

  return (
    <Pressable
      onPress={handlePress}
      style={[
        styles.container,
        active ? styles.active : styles.ended,
      ]}
      disabled={!active}
    >
      <MaterialCommunityIcons
        name={active ? 'clock-outline' : 'clock-check-outline'}
        size={20}
        color={active ? '#34D399' : colors.text.muted}
      />
      <View style={styles.textContainer}>
        <Text style={[styles.label, !active && styles.labelEnded]}>
          {active ? 'Shift Active' : 'Shift Ended'}
        </Text>
        <Text style={[styles.action, !active && styles.actionEnded]}>
          {active ? 'Tap to end shift' : 'GPS clock-out recorded'}
        </Text>
      </View>
      {active && (
        <View style={styles.dot} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  active: {
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
    borderColor: 'rgba(52, 211, 153, 0.25)',
  },
  ended: {
    backgroundColor: 'rgba(100, 116, 139, 0.08)',
    borderColor: 'rgba(100, 116, 139, 0.15)',
  },
  textContainer: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  label: {
    ...typography.bodySmall,
    color: '#34D399',
    fontWeight: '700',
  },
  labelEnded: {
    color: colors.text.muted,
  },
  action: {
    ...typography.caption,
    color: 'rgba(52, 211, 153, 0.6)',
    marginTop: 1,
  },
  actionEnded: {
    color: colors.text.muted,
    opacity: 0.6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34D399',
  },
});
