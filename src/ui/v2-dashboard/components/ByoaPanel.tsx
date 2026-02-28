import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { ExternalApp } from '@/core/data/externalApps';

interface ByoaPanelProps {
  pinnedApps: ExternalApp[];
  userApps: ExternalApp[];
  onOpenApp: (url: string, webUrl?: string) => void;
  onRemoveApp?: (app: ExternalApp) => void;
  onAddPress: () => void;
}

export function ByoaPanel({ pinnedApps, userApps, onOpenApp, onRemoveApp, onAddPress }: ByoaPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const allApps = [...pinnedApps, ...userApps];

  return (
    <View style={styles.container}>
      <Pressable onPress={() => setExpanded(!expanded)} style={styles.header}>
        <View>
          <Text style={styles.title}>{t('home.sections.byoa')}</Text>
          <Text style={styles.subtitle}>{t('home.sections.byoaSubtitle')}</Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable onPress={onAddPress} style={styles.addBtn}>
            <MaterialCommunityIcons name="plus" size={16} color={colors.brand.primary} />
          </Pressable>
          <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.text.muted} />
        </View>
      </Pressable>

      {expanded && (
        <View style={styles.grid}>
          {allApps.map(app => (
            <TouchableOpacity key={app.id} onPress={() => onOpenApp(app.url, app.webUrl)}
              onLongPress={onRemoveApp ? () => onRemoveApp(app) : undefined}
              delayLongPress={400} activeOpacity={0.7}
              style={styles.appItem}>
              <View style={[styles.appIcon, { backgroundColor: `${app.color}15` }]}>
                <MaterialCommunityIcons name={app.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={18} color={app.color} />
              </View>
              <Text style={styles.appName} numberOfLines={1}>{app.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle, overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md },
  title: { ...typography.body, fontWeight: '600', color: colors.text.primary },
  subtitle: { ...typography.caption, color: colors.text.muted, fontSize: 10, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  addBtn: { width: 28, height: 28, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border.active, justifyContent: 'center', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.sm, paddingTop: 0, gap: spacing.sm },
  appItem: { width: '22%', alignItems: 'center', padding: spacing.xs },
  appItemPressed: { opacity: 0.7 },
  appIcon: { width: 40, height: 40, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  appName: { ...typography.caption, color: colors.text.muted, fontSize: 9, textAlign: 'center' },
});
