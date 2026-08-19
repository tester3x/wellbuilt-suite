import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useGreeting } from '@/core/hooks/useGreeting';
import { useHomeWorkhorse } from '@/core/context/HomeWorkhorseContext';
import { Sidebar } from '../components/Sidebar';
import { ActionCardRow } from '@/ui/shared/ActionCardRow';
import type { WellBuiltApp } from '@/core/data/apps';

export default function HomeScreen() {
  const { t } = useTranslation();
  const home = useHomeWorkhorse();
  const insets = useSafeAreaInsets();
  const greeting = useGreeting();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  if (!home.session) return null;

  const session = home.session;
  const roleLabel = t(`home.roles.${session.role}`);
  const apps = home.groups.applications.map((action) => action.app).filter((app): app is WellBuiltApp => !!app);
  const settingsAction = home.groups.chrome.find((action) => action.role === 'open-settings');
  const logoutAction = home.groups.chrome.find((action) => action.role === 'logout');
  const extraChrome = home.groups.chrome.filter(
    (action) => action.role !== 'open-settings' && action.role !== 'logout',
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.body}>
        <Sidebar
          apps={apps}
          companyName={session.companyName || 'WellBuilt'}
          userName={session.legalName || session.displayName}
          roleLabel={roleLabel}
          onAppPress={(appId) => {
            const action = home.groups.applications.find((entry) => entry.appId === appId);
            if (action) void home.invoke(action.id);
          }}
          onAppLongPress={(appId) => {
            const action = home.groups.applications.find((entry) => entry.appId === appId);
            if (action) void home.invoke(action.id, 'inspect');
          }}
          onSettings={() => { if (settingsAction) void home.invoke(settingsAction.id); }}
          onLogout={() => { if (logoutAction) void home.invoke(logoutAction.id); }}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        <View style={styles.mainContent}>
          <View style={styles.contentHeader}>
            <View>
              <Text style={styles.greeting}>{greeting},</Text>
              <Text style={styles.userName}>{session.displayName}</Text>
            </View>
            <View style={styles.headerMeta}>
              <View style={styles.roleBadge}>
                <Text style={styles.roleText}>{roleLabel}</Text>
              </View>
            </View>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {extraChrome.map((action) => (
              <Pressable key={action.id} onPress={() => { void home.invoke(action.id); }} />
            ))}
            <ActionCardRow />

            <View style={styles.footer}>
              <Text style={styles.footerText}>{t('home.footer.version')}</Text>
              <Text style={styles.footerSubtext}>{t('home.footer.tagline')}</Text>
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
  contentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  greeting: { ...typography.bodySmall, color: colors.text.muted },
  userName: { ...typography.h2, color: colors.text.primary },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  roleBadge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: `${colors.brand.primary}15` },
  roleText: { ...typography.caption, color: colors.brand.primary, fontWeight: '700', fontSize: 10 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  footer: { alignItems: 'center', marginTop: spacing.xl, paddingTop: spacing.lg },
  footerText: { ...typography.caption, color: colors.text.muted },
  footerSubtext: { ...typography.caption, color: colors.text.muted, opacity: 0.5, marginTop: 2 },
});
