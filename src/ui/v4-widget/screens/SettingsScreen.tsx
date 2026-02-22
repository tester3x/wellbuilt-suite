import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useLanguage } from '@/core/localization';
import { useSkin } from '@/core/context/SkinContext';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { currentLanguage, setLanguage, supportedLanguages } = useLanguage();
  const { skinId, setSkin, availableSkins } = useSkin();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={24} color={colors.text.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('settings.title')}</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <View style={styles.sectionTile}>
            <View style={styles.sectionIconWrap}>
              <MaterialCommunityIcons name="translate" size={18} color={colors.brand.primary} />
            </View>
            <View style={styles.sectionInfo}>
              <Text style={styles.sectionLabel}>{t('settings.language')}</Text>
              <Text style={styles.sectionSubtitle}>{t('settings.languageSubtitle')}</Text>
            </View>
          </View>
          <View style={styles.optionGroup}>
            {supportedLanguages.map(lang => (
              <Pressable key={lang} onPress={() => setLanguage(lang)}
                style={[styles.optionTile, currentLanguage === lang && styles.optionTileActive]}>
                <Text style={[styles.optionText, currentLanguage === lang && styles.optionTextActive]}>
                  {t(`settings.languages.${lang}`)}
                </Text>
                {currentLanguage === lang && (
                  <MaterialCommunityIcons name="check-circle" size={20} color={colors.brand.primary} />
                )}
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionTile}>
            <View style={styles.sectionIconWrap}>
              <MaterialCommunityIcons name="palette-outline" size={18} color={colors.brand.accent} />
            </View>
            <View style={styles.sectionInfo}>
              <Text style={styles.sectionLabel}>{t('settings.skin')}</Text>
              <Text style={styles.sectionSubtitle}>{t('settings.skinSubtitle')}</Text>
            </View>
          </View>
          <View style={styles.optionGroup}>
            {availableSkins.map(skin => (
              <Pressable key={skin.id} onPress={() => setSkin(skin.id)}
                style={[styles.optionTile, skinId === skin.id && styles.optionTileActive]}>
                <View>
                  <Text style={[styles.optionText, skinId === skin.id && styles.optionTextActive]}>
                    {skin.name}
                  </Text>
                  <Text style={styles.optionDescription}>{skin.description}</Text>
                </View>
                {skinId === skin.id && (
                  <MaterialCommunityIcons name="check-circle" size={20} color={colors.brand.primary} />
                )}
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  backButton: { width: 40, height: 40, borderRadius: radius.full, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { ...typography.body, fontWeight: '600', color: colors.text.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg },
  section: { marginBottom: spacing.xl },
  sectionTile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  sectionIconWrap: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.bg.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border.subtle },
  sectionInfo: {},
  sectionLabel: { ...typography.h3, color: colors.text.primary, marginBottom: 2 },
  sectionSubtitle: { ...typography.caption, color: colors.text.muted },
  optionGroup: { gap: spacing.sm },
  optionTile: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.md },
  optionTileActive: { borderColor: colors.border.active, backgroundColor: `${colors.brand.primary}08` },
  optionText: { ...typography.body, color: colors.text.primary },
  optionTextActive: { color: colors.brand.primary, fontWeight: '600' },
  optionDescription: { ...typography.caption, color: colors.text.muted, marginTop: 2 },
});
