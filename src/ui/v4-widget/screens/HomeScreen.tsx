import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useGreeting } from '@/core/hooks/useGreeting';
import { useHomeWorkhorse } from '@/core/context/HomeWorkhorseContext';
import { TileGrid } from '../components/TileGrid';
import { AppTile } from '../components/AppTile';
import { StatTile } from '../components/StatTile';
import { TileContainer } from '../components/TileContainer';
import { ActionCardRow } from '@/ui/shared/ActionCardRow';
import type { WellBuiltApp } from '@/core/data/apps';

export default function HomeScreen() {
  const { t } = useTranslation();
  const home = useHomeWorkhorse();
  const insets = useSafeAreaInsets();
  const greeting = useGreeting();

  if (!home.session) return null;

  const session = home.session;
  const roleLabel = t(`home.roles.${session.role}`);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image source={require('../../../../assets/wellbuilt-logo.png')} style={styles.headerLogo} resizeMode="contain" />
          <View>
            <Text style={styles.headerGreeting}>{greeting}</Text>
            <Text style={styles.headerName}>{session.displayName}</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{roleLabel}</Text>
          </View>
          {home.groups.chrome.map((action) => (
            <Pressable
              key={action.id}
              onPress={() => { void home.invoke(action.id); }}
              style={[styles.headerBtn, action.role === 'logout' && styles.logoutHeaderBtn]}
            >
              <MaterialCommunityIcons
                name={action.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                size={20}
                color={action.role === 'logout' ? '#EF4444' : colors.text.muted}
              />
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <ActionCardRow />

        <TileContainer title={t('home.stats.apps').toUpperCase()}>
          <TileGrid>
            <StatTile icon="apps" label={t('home.stats.apps')} value={String(home.live.applicationCount)} color={colors.brand.primary} />
            <StatTile icon="check-circle" label={t('home.stats.active')} value={String(home.live.activeApplicationCount)} color={colors.status.online} />
            <StatTile icon="account-group" label={t('home.stats.platform')} value="v1.0" color={colors.brand.accent} />
          </TileGrid>
        </TileContainer>

        <TileContainer title={t('home.sections.applications').toUpperCase()}>
          <TileGrid>
            {home.groups.applications.map((action, idx) => {
              if (!action.app) return null;
              return (
                <AppTile
                  key={action.id}
                  app={action.app as WellBuiltApp}
                  size={idx === 0 ? 'large' : idx < 3 ? 'medium' : 'small'}
                  onPress={() => { void home.invoke(action.id); }}
                  onLongPress={() => { void home.invoke(action.id, 'inspect'); }}
                />
              );
            })}
          </TileGrid>
        </TileContainer>

        <View style={styles.footer}>
          <View style={styles.footerLine} />
          <Text style={styles.footerText}>{t('home.footer.version')}</Text>
          <Text style={styles.footerSubtext}>{t('home.footer.tagline')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerLogo: { width: 28, height: 28 },
  headerGreeting: { ...typography.caption, color: colors.text.muted },
  headerName: { ...typography.body, fontWeight: '600', color: colors.text.primary },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  roleBadge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: `${colors.brand.primary}15` },
  roleText: { ...typography.caption, color: colors.brand.primary, fontWeight: '700', fontSize: 9 },
  headerBtn: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.bg.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border.subtle },
  // Red-tinted variant for the logout button — destructive action.
  logoutHeaderBtn: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)' },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  footer: { alignItems: 'center', marginTop: spacing.xl, paddingTop: spacing.lg },
  footerLine: { width: 40, height: 2, backgroundColor: colors.border.subtle, borderRadius: 1, marginBottom: spacing.md },
  footerText: { ...typography.caption, color: colors.text.muted },
  footerSubtext: { ...typography.caption, color: colors.text.muted, opacity: 0.5, marginTop: 2 },
});
