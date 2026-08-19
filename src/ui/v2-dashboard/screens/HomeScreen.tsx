import React from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@/core/theme';
import { useGreeting } from '@/core/hooks/useGreeting';
import { useHomeWorkhorse } from '@/core/context/HomeWorkhorseContext';
import { CommandHeader } from '../components/CommandHeader';
import { AppListItem } from '../components/AppListItem';
import { WidgetContainer } from '../components/WidgetContainer';
import { SystemStatusBar } from '../components/SystemStatusBar';
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
  const settingsAction = home.groups.chrome.find((action) => action.role === 'open-settings');
  const logoutAction = home.groups.chrome.find((action) => action.role === 'logout');
  const extraChrome = home.groups.chrome.filter(
    (action) => action.role !== 'open-settings' && action.role !== 'logout',
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <CommandHeader
        title={`${greeting}, ${session.displayName}`}
        subtitle={`${roleLabel} — ${session.companyName || 'WellBuilt'}`}
        onSettings={settingsAction ? () => { void home.invoke(settingsAction.id); } : undefined}
        onAction={logoutAction ? () => { void home.invoke(logoutAction.id); } : undefined}
        actionIcon="logout"
        actionDestructive
      />
      {extraChrome.map((action) => (
        <Pressable key={action.id} onPress={() => { void home.invoke(action.id); }} />
      ))}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <ActionCardRow />

        <WidgetContainer
          title={t('home.sections.applications').toUpperCase()}
        >
          <View style={styles.appList}>
            {home.groups.applications.map((action) => {
              if (!action.app) return null;
              const badge = action.badge;
              const ticketsAccent = badge
                ? (session.customerAccentColor || colors.brand.primary)
                : undefined;
              return (
                <AppListItem
                  key={action.id}
                  app={action.app as WellBuiltApp}
                  badge={badge?.text}
                  badgeDetail={badge?.detail}
                  accentColor={ticketsAccent}
                  pulse={!!badge?.pulse}
                  onPress={() => { void home.invoke(action.id); }}
                  onLongPress={() => { void home.invoke(action.id, 'inspect'); }}
                />
              );
            })}
          </View>
        </WidgetContainer>

        <SystemStatusBar />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  appList: { gap: spacing.sm },
});
