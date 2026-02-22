import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { appCatalog, categoryKeys } from '@/core/data/externalApps';
import { useUserApps } from '@/core/context/UserAppsContext';

interface AddAppModalProps {
  visible: boolean;
  onClose: () => void;
}

export function AddAppModal({ visible, onClose }: AddAppModalProps) {
  const { t } = useTranslation();
  const { toggleApp, isEnabled } = useUserApps();

  const grouped = categoryKeys
    .map(cat => ({
      category: cat,
      label: t(`addAppModal.categories.${cat}`),
      apps: appCatalog.filter(a => a.category === cat),
    }))
    .filter(g => g.apps.length > 0);

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>{t('addAppModal.title')}</Text>
              <Text style={styles.subtitle}>{t('addAppModal.subtitle')}</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={20} color={colors.text.muted} />
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {grouped.map(group => (
              <View key={group.category} style={styles.group}>
                <Text style={styles.groupLabel}>{group.label}</Text>
                {group.apps.map(app => {
                  const enabled = isEnabled(app.id);
                  return (
                    <Pressable key={app.id} onPress={() => toggleApp(app.id)}
                      style={[styles.appRow, enabled && styles.appRowEnabled]}>
                      <View style={[styles.appIcon, { backgroundColor: `${app.color}20` }]}>
                        <MaterialCommunityIcons name={app.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={20} color={app.color} />
                      </View>
                      <Text style={styles.appName}>{app.name}</Text>
                      <View style={[styles.toggle, enabled && { backgroundColor: colors.brand.primary }]}>
                        {enabled && <MaterialCommunityIcons name="check" size={14} color={colors.text.inverse} />}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
          <Pressable onPress={onClose} style={({ pressed }) => [styles.doneButton, pressed && styles.doneButtonPressed]}>
            <Text style={styles.doneButtonText}>{t('common.done')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modal: { backgroundColor: colors.bg.elevated, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, maxHeight: '80%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.lg },
  title: { ...typography.h2, color: colors.text.primary },
  subtitle: { ...typography.caption, color: colors.text.muted, marginTop: 2 },
  closeButton: { width: 32, height: 32, borderRadius: radius.full, backgroundColor: colors.bg.card, justifyContent: 'center', alignItems: 'center' },
  scroll: { marginBottom: spacing.md },
  group: { marginBottom: spacing.lg },
  groupLabel: { ...typography.label, color: colors.text.muted, fontSize: 11, marginBottom: spacing.sm },
  appRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.sm + 2, marginBottom: spacing.xs + 2, gap: spacing.sm },
  appRowEnabled: { borderColor: colors.border.active, backgroundColor: `${colors.brand.primary}08` },
  appIcon: { width: 36, height: 36, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center' },
  appName: { ...typography.body, color: colors.text.primary, flex: 1 },
  toggle: { width: 24, height: 24, borderRadius: radius.full, borderWidth: 2, borderColor: colors.border.default, justifyContent: 'center', alignItems: 'center' },
  doneButton: { backgroundColor: colors.brand.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  doneButtonPressed: { opacity: 0.8 },
  doneButtonText: { ...typography.body, fontWeight: '700', color: colors.text.inverse },
});
