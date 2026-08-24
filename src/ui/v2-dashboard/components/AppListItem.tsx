import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { WellBuiltApp } from '@/core/data/apps';

interface AppListItemProps {
  app: WellBuiltApp;
  onPress: () => void;
  onLongPress?: () => void;
  onInfoPress?: () => void;
  /** Optional badge text (e.g. "3 pending") shown below subtitle */
  badge?: string;
  /** Optional detail text shown below badge (e.g. well names) */
  badgeDetail?: string;
  /**
   * Optional accent color for the badge (replaces default amber). Use the
   * customer/company accent when known; HomeScreen falls back to LG gold
   * when no per-customer accent exists yet. Has no effect unless `badge`
   * is also set.
   */
  accentColor?: string;
  /**
   * Pulse the badge opacity to draw attention (e.g. when pendingCount > 0).
   * 1.5s loop, opacity 0.55 → 1.0, native driver. Stops + resets when the
   * prop flips back to false. Has no effect unless `badge` is also set.
   */
  pulse?: boolean;
}

export function AppListItem({ app, onPress, onLongPress, onInfoPress, badge, badgeDetail, accentColor, pulse }: AppListItemProps) {
  const { t } = useTranslation();
  const statusLabel = app.status === 'active' ? t('appDetail.meta.active') : app.status === 'beta' ? t('appDetail.meta.beta') : t('appDetail.meta.comingSoon');

  // Pulse animation — opacity-only loop on the badge wrapper. Native driver,
  // no JS bridge cost while running. Pausing on `pulse=false` is critical
  // because the parent (HomeScreen) toggles it as soon as the driver opens
  // WB T (pendingCount drops or badge unmounts).
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulse || !badge) {
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.55, duration: 750, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulseAnim.setValue(1);
    };
  }, [pulse, badge, pulseAnim]);

  // Resolve badge tint from accent. `${accent}20` = ~12.5% bg tint, matches
  // the existing amber `#FBBF2420` shape so the badge keeps the same
  // weight; only the hue changes.
  const accent = accentColor;
  const badgeBgStyle = accent ? { backgroundColor: `${accent}20` } : null;
  const badgeTextStyle = accent ? { color: accent } : null;

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.container, pressed && styles.pressed]}>
      <View style={[styles.iconWrap, { backgroundColor: `${app.color}15` }]}>
        <MaterialCommunityIcons name={app.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={24} color={app.color} />
      </View>
      <View style={styles.info}>
        <Text style={styles.name}>{app.name}</Text>
        <Text style={styles.subtitle}>{app.subtitle}</Text>
        {badge ? (
          <View style={styles.badgeRow}>
            <Animated.View style={[styles.badge, badgeBgStyle, pulse ? { opacity: pulseAnim } : null]}>
              <Text style={[styles.badgeText, badgeTextStyle]}>{badge}</Text>
            </Animated.View>
            {badgeDetail ? <Text style={styles.badgeDetail} numberOfLines={1}>{badgeDetail}</Text> : null}
          </View>
        ) : null}
      </View>
      <View style={styles.right}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: app.status === 'active' ? colors.status.online : colors.status.warning }]} />
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
        <Text style={styles.version}>v{app.version}</Text>
      </View>
      {onInfoPress ? (
        <Pressable onPress={onInfoPress} hitSlop={8} accessibilityRole="button" accessibilityLabel="App details">
          <MaterialCommunityIcons name="information-outline" size={18} color={colors.text.muted} />
        </Pressable>
      ) : (
        <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.muted} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.md, gap: spacing.md },
  pressed: { backgroundColor: colors.bg.elevated, borderColor: colors.border.active },
  iconWrap: { width: 48, height: 48, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' },
  info: { flex: 1 },
  name: { ...typography.body, fontWeight: '600', color: colors.text.primary },
  subtitle: { ...typography.caption, color: colors.text.muted, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { ...typography.caption, color: colors.text.muted, fontSize: 10 },
  version: { ...typography.caption, color: colors.text.muted, fontSize: 10, marginTop: 2 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  badge: { backgroundColor: '#FBBF2420', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#FBBF24' },
  badgeDetail: { ...typography.caption, color: colors.text.muted, fontSize: 11, flex: 1 },
});
