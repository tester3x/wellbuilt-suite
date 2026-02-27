// src/ui/v1-grid/components/AddAppModal.tsx
// BYOA triple hybrid modal:
//   1. Full catalog by category (driver picks)
//   2. "Installed" badge on detected apps
//   3. "Required" section for company-mandated apps (non-removable)
//
// Features: search bar, category grouping, installed detection, company badges

import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, TextInput } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { appCatalog, categoryKeys, type ExternalApp } from '@/core/data/externalApps';
import { useUserApps } from '@/core/context/UserAppsContext';
import { useInstalledApps } from '@/core/hooks';

interface AddAppModalProps {
  visible: boolean;
  onClose: () => void;
}

export function AddAppModal({ visible, onClose }: AddAppModalProps) {
  const { t } = useTranslation();
  const { toggleApp, isEnabled, isCompanyRequired, companyRequiredIds } = useUserApps();
  const { isInstalled, refresh, checking } = useInstalledApps();
  const [search, setSearch] = useState('');

  // Scan installed apps when modal opens
  useEffect(() => {
    if (visible) {
      refresh();
      setSearch('');
    }
  }, [visible, refresh]);

  // Filter apps by search query
  const filteredCatalog = useMemo(() => {
    if (!search.trim()) return appCatalog;
    const q = search.toLowerCase().trim();
    return appCatalog.filter(
      a => a.name.toLowerCase().includes(q) ||
           a.category.toLowerCase().includes(q)
    );
  }, [search]);

  // Group filtered apps by category
  const grouped = useMemo(() => {
    return categoryKeys
      .map(cat => ({
        category: cat,
        label: t(`addAppModal.categories.${cat}`),
        apps: filteredCatalog.filter(a => a.category === cat),
      }))
      .filter(g => g.apps.length > 0);
  }, [filteredCatalog, t]);

  // Company-required apps (resolved from catalog)
  const requiredApps = useMemo(() => {
    return appCatalog.filter(a => companyRequiredIds.includes(a.id));
  }, [companyRequiredIds]);

  const renderAppRow = (app: ExternalApp, isRequired: boolean) => {
    const enabled = isEnabled(app.id) || isRequired;
    const installed = isInstalled(app.id);

    return (
      <Pressable
        key={app.id}
        onPress={() => {
          if (!isRequired) toggleApp(app.id);
        }}
        style={[
          styles.appRow,
          enabled && styles.appRowEnabled,
          isRequired && styles.appRowRequired,
        ]}
      >
        <View style={[styles.appIcon, { backgroundColor: `${app.color}20` }]}>
          <MaterialCommunityIcons
            name={app.icon as keyof typeof MaterialCommunityIcons.glyphMap}
            size={20}
            color={app.color}
          />
        </View>

        <View style={styles.appInfo}>
          <Text style={styles.appName}>{app.name}</Text>
          <View style={styles.badges}>
            {installed && (
              <View style={styles.installedBadge}>
                <MaterialCommunityIcons name="check-circle" size={10} color="#34D399" />
                <Text style={styles.installedText}>{t('addAppModal.installed')}</Text>
              </View>
            )}
            {isRequired && (
              <View style={styles.requiredBadge}>
                <MaterialCommunityIcons name="shield-check" size={10} color={colors.brand.primary} />
                <Text style={styles.requiredText}>{t('addAppModal.required')}</Text>
              </View>
            )}
          </View>
        </View>

        {isRequired ? (
          <View style={[styles.toggle, styles.toggleLocked]}>
            <MaterialCommunityIcons name="lock" size={12} color={colors.brand.primary} />
          </View>
        ) : (
          <View style={[styles.toggle, enabled && { backgroundColor: colors.brand.primary }]}>
            {enabled && <MaterialCommunityIcons name="check" size={14} color={colors.text.inverse} />}
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>{t('addAppModal.title')}</Text>
              <Text style={styles.subtitle}>
                {t('addAppModal.subtitle')} · {appCatalog.length} {t('addAppModal.available')}
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={20} color={colors.text.muted} />
            </Pressable>
          </View>

          {/* Search bar */}
          <View style={styles.searchWrap}>
            <MaterialCommunityIcons name="magnify" size={18} color={colors.text.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder={t('addAppModal.searchPlaceholder')}
              placeholderTextColor={colors.text.muted}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')}>
                <MaterialCommunityIcons name="close-circle" size={16} color={colors.text.muted} />
              </Pressable>
            )}
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {/* Company-required apps section */}
            {requiredApps.length > 0 && !search && (
              <View style={styles.group}>
                <View style={styles.groupLabelRow}>
                  <MaterialCommunityIcons name="shield-check" size={12} color={colors.brand.primary} />
                  <Text style={[styles.groupLabel, { color: colors.brand.primary }]}>
                    {t('addAppModal.companyRequired')}
                  </Text>
                </View>
                {requiredApps.map(app => renderAppRow(app, true))}
              </View>
            )}

            {/* Category groups */}
            {grouped.map(group => (
              <View key={group.category} style={styles.group}>
                <Text style={styles.groupLabel}>{group.label}</Text>
                {group.apps.map(app => renderAppRow(app, isCompanyRequired(app.id)))}
              </View>
            ))}

            {/* Empty search state */}
            {grouped.length === 0 && search.length > 0 && (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="magnify-close" size={32} color={colors.text.muted} />
                <Text style={styles.emptyText}>{t('addAppModal.noResults')}</Text>
              </View>
            )}
          </ScrollView>

          {/* Done button */}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.doneButton, pressed && styles.doneButtonPressed]}
          >
            <Text style={styles.doneButtonText}>{t('common.done')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: colors.bg.elevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  title: { ...typography.h2, color: colors.text.primary },
  subtitle: { ...typography.caption, color: colors.text.muted, marginTop: 2 },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.bg.card,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.text.primary,
    paddingVertical: 0,
  },

  // Scroll
  scroll: { marginBottom: spacing.md },

  // Groups
  group: { marginBottom: spacing.lg },
  groupLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: spacing.sm,
  },
  groupLabel: {
    ...typography.label,
    color: colors.text.muted,
    fontSize: 11,
    marginBottom: spacing.sm,
  },

  // App rows
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing.sm + 2,
    marginBottom: spacing.xs + 2,
    gap: spacing.sm,
  },
  appRowEnabled: {
    borderColor: colors.border.active,
    backgroundColor: `${colors.brand.primary}08`,
  },
  appRowRequired: {
    borderColor: `${colors.brand.primary}40`,
    backgroundColor: `${colors.brand.primary}10`,
  },
  appIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  appInfo: { flex: 1 },
  appName: { ...typography.body, color: colors.text.primary },
  badges: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: 1,
  },
  installedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  installedText: {
    fontSize: 9,
    color: '#34D399',
    fontWeight: '600',
  },
  requiredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  requiredText: {
    fontSize: 9,
    color: colors.brand.primary,
    fontWeight: '600',
  },

  // Toggle
  toggle: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.border.default,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleLocked: {
    borderColor: `${colors.brand.primary}60`,
    backgroundColor: `${colors.brand.primary}20`,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyText: {
    ...typography.body,
    color: colors.text.muted,
  },

  // Done button
  doneButton: {
    backgroundColor: colors.brand.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  doneButtonPressed: { opacity: 0.8 },
  doneButtonText: { ...typography.body, fontWeight: '700', color: colors.text.inverse },
});
