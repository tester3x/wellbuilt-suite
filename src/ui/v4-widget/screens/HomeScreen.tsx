import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useAuth } from '@/core/context/AuthContext';
import { useUserApps } from '@/core/context/UserAppsContext';
import { wellbuiltApps } from '@/core/data/apps';
import { pinnedApps, appCatalog } from '@/core/data/externalApps';
import { useGreeting, useAppLauncher, useFirstLaunch } from '@/core/hooks';
import { TileGrid } from '../components/TileGrid';
import { AppTile } from '../components/AppTile';
import { StatTile } from '../components/StatTile';
import { ByoaTile } from '../components/ByoaTile';
import { TileContainer } from '../components/TileContainer';
import { AddAppModal } from '@/ui/v1-grid/components/AddAppModal';

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user, logout, isAuthenticated } = useAuth();
  const { enabledAppIds, toggleApp, isCompanyRequired } = useUserApps();
  const { launchWBApp, launchExternalApp } = useAppLauncher();
  const { hasLaunched } = useFirstLaunch();
  const insets = useSafeAreaInsets();
  const greeting = useGreeting();
  const [showAddModal, setShowAddModal] = useState(false);

  React.useEffect(() => { if (!isAuthenticated) router.replace('/'); }, [isAuthenticated]);
  if (!user) return null;

  const roleLabel = t(`home.roles.${user.role}`);
  const companyApps = wellbuiltApps;
  const userEnabledApps = appCatalog.filter(a => enabledAppIds.includes(a.id));
  const allByoaApps = [...pinnedApps, ...userEnabledApps];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image source={require('../../../../assets/wellbuilt-logo.png')} style={styles.headerLogo} resizeMode="contain" />
          <View>
            <Text style={styles.headerGreeting}>{greeting}</Text>
            <Text style={styles.headerName}>{user.displayName}</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{roleLabel}</Text>
          </View>
          <Pressable onPress={() => router.push('/settings')} style={styles.headerBtn}>
            <MaterialCommunityIcons name="cog-outline" size={20} color={colors.text.muted} />
          </Pressable>
          <Pressable onPress={logout} style={styles.headerBtn}>
            <MaterialCommunityIcons name="logout" size={20} color={colors.text.muted} />
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <TileContainer title={t('home.stats.apps').toUpperCase()}>
          <TileGrid>
            <StatTile icon="apps" label={t('home.stats.apps')} value={String(companyApps.length)} color={colors.brand.primary} />
            <StatTile icon="check-circle" label={t('home.stats.active')} value={String(companyApps.filter(a => a.status === 'active').length)} color={colors.status.online} />
            <StatTile icon="account-group" label={t('home.stats.platform')} value="v1.0" color={colors.brand.accent} />
          </TileGrid>
        </TileContainer>

        <TileContainer title={t('home.sections.applications').toUpperCase()}>
          <TileGrid>
            {companyApps.map((app, idx) => (
              <AppTile
                key={app.id}
                app={app}
                size={idx === 0 ? 'large' : idx < 3 ? 'medium' : 'small'}
                onPress={() => {
                  if (hasLaunched(app.id)) {
                    launchWBApp({ name: app.name, scheme: app.scheme, androidPackage: app.androidPackage, webUrl: app.webUrl });
                  } else {
                    router.push(`/app-detail?id=${app.id}`);
                  }
                }}
                onLongPress={() => router.push(`/app-detail?id=${app.id}`)}
              />
            ))}
          </TileGrid>
        </TileContainer>

        <TileContainer
          title={t('home.sections.byoa').toUpperCase()}
          rightElement={
            <Pressable onPress={() => setShowAddModal(true)} style={styles.addBtn}>
              <MaterialCommunityIcons name="plus" size={14} color={colors.brand.primary} />
            </Pressable>
          }
        >
          <View style={styles.byoaWrap}>
            <TileGrid>
              {allByoaApps.map(app => (
                <ByoaTile key={app.id} app={app}
                  onPress={() => launchExternalApp({ url: app.url, webUrl: app.webUrl })}
                  onLongPress={() => {
                    if (isCompanyRequired(app.id)) return;
                    Alert.alert(
                      t('addAppModal.removeTitle'),
                      t('addAppModal.removeMessage', { name: app.name }),
                      [
                        { text: t('common.cancel'), style: 'cancel' },
                        { text: t('addAppModal.remove'), style: 'destructive', onPress: () => toggleApp(app.id) },
                      ]
                    );
                  }} />
              ))}
            </TileGrid>
          </View>
        </TileContainer>

        <View style={styles.footer}>
          <View style={styles.footerLine} />
          <Text style={styles.footerText}>{t('home.footer.version')}</Text>
          <Text style={styles.footerSubtext}>{t('home.footer.tagline')}</Text>
        </View>
      </ScrollView>

      <AddAppModal visible={showAddModal} onClose={() => setShowAddModal(false)} />
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
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  addBtn: { width: 24, height: 24, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border.active, justifyContent: 'center', alignItems: 'center' },
  byoaWrap: { backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.sm },
  footer: { alignItems: 'center', marginTop: spacing.xl, paddingTop: spacing.lg },
  footerLine: { width: 40, height: 2, backgroundColor: colors.border.subtle, borderRadius: 1, marginBottom: spacing.md },
  footerText: { ...typography.caption, color: colors.text.muted },
  footerSubtext: { ...typography.caption, color: colors.text.muted, opacity: 0.5, marginTop: 2 },
});
