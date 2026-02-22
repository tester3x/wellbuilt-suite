import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useAuth } from '@/core/context/AuthContext';
import { useLanguage } from '@/core/localization';
import { useSkin } from '@/core/context/SkinContext';
import { wellbuiltApps } from '@/core/data/apps';
import { Sidebar } from '../components/Sidebar';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { currentLanguage, setLanguage, supportedLanguages } = useLanguage();
  const { skinId, setSkin, availableSkins } = useSkin();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  if (!user) return null;
  const roleLabel = t(`home.roles.${user.role}`);
  const companyApps = wellbuiltApps;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.body}>
        <Sidebar
          apps={companyApps}
          companyName="WellBuilt"
          userName={user.displayName}
          roleLabel={roleLabel}
          onAppPress={(appId) => router.push(`/app-detail?id=${appId}`)}
          onSettings={() => {}}
          onLogout={logout}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        <View style={styles.mainContent}>
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <MaterialCommunityIcons name="chevron-left" size={24} color={colors.text.primary} />
            </Pressable>
            <Text style={styles.headerTitle}>{t('settings.title')}</Text>
            <View style={styles.backButton} />
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t('settings.language')}</Text>
              <Text style={styles.sectionSubtitle}>{t('settings.languageSubtitle')}</Text>
              <View style={styles.optionGroup}>
                {supportedLanguages.map(lang => (
                  <Pressable key={lang} onPress={() => setLanguage(lang)}
                    style={[styles.optionRow, currentLanguage === lang && styles.optionRowActive]}>
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
              <Text style={styles.sectionLabel}>{t('settings.skin')}</Text>
              <Text style={styles.sectionSubtitle}>{t('settings.skinSubtitle')}</Text>
              <View style={styles.optionGroup}>
                {availableSkins.map(skin => (
                  <Pressable key={skin.id} onPress={() => setSkin(skin.id)}
                    style={[styles.optionRow, skinId === skin.id && styles.optionRowActive]}>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  body: { flex: 1, flexDirection: 'row' },
  mainContent: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  backButton: { width: 40, height: 40, borderRadius: radius.full, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { ...typography.body, fontWeight: '600', color: colors.text.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg },
  section: { marginBottom: spacing.xl },
  sectionLabel: { ...typography.h3, color: colors.text.primary, marginBottom: 4 },
  sectionSubtitle: { ...typography.caption, color: colors.text.muted, marginBottom: spacing.md },
  optionGroup: { gap: spacing.sm },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.bg.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.md },
  optionRowActive: { borderColor: colors.border.active, backgroundColor: `${colors.brand.primary}08` },
  optionText: { ...typography.body, color: colors.text.primary },
  optionTextActive: { color: colors.brand.primary, fontWeight: '600' },
  optionDescription: { ...typography.caption, color: colors.text.muted, marginTop: 2 },
});
