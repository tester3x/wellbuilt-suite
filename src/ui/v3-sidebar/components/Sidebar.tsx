import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { WellBuiltApp } from '@/core/data/apps';
import { SidebarAppItem } from './SidebarAppItem';

interface SidebarProps {
  apps: WellBuiltApp[];
  companyName: string;
  userName: string;
  roleLabel: string;
  onAppPress: (appId: string) => void;
  onSettings: () => void;
  onLogout: () => void;
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ apps, companyName, userName, roleLabel, onAppPress, onSettings, onLogout, collapsed, onToggle }: SidebarProps) {
  const { t } = useTranslation();

  if (collapsed) {
    return (
      <View style={styles.collapsedContainer}>
        <Pressable onPress={onToggle} style={styles.toggleBtn}>
          <MaterialCommunityIcons name="menu" size={20} color={colors.text.muted} />
        </Pressable>
        <View style={styles.collapsedLogo}>
          <Image source={require('../../../../assets/wellbuilt-logo.png')} style={styles.collapsedLogoImage} resizeMode="contain" />
        </View>
        <ScrollView style={styles.collapsedApps} showsVerticalScrollIndicator={false}>
          {apps.map(app => (
            <Pressable key={app.id} onPress={() => onAppPress(app.id)}
              style={({ pressed }) => [styles.collapsedAppBtn, pressed && styles.collapsedAppBtnPressed]}>
              <View style={[styles.collapsedAppIcon, { backgroundColor: `${app.color}15` }]}>
                <MaterialCommunityIcons name={app.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={18} color={app.color} />
              </View>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable onPress={onSettings} style={styles.collapsedBottomBtn}>
          <MaterialCommunityIcons name="cog-outline" size={18} color={colors.text.muted} />
        </Pressable>
        <Pressable onPress={onLogout} style={styles.collapsedBottomBtn}>
          <MaterialCommunityIcons name="logout" size={18} color={colors.text.muted} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Image source={require('../../../../assets/wellbuilt-logo.png')} style={styles.logoImage} resizeMode="contain" />
          <View>
            <Text style={styles.brandText}>{t('companySelect.brand')}</Text>
            <Text style={styles.suiteText}>{t('companySelect.suite')}</Text>
          </View>
        </View>
        <Pressable onPress={onToggle} style={styles.toggleBtn}>
          <MaterialCommunityIcons name="menu-open" size={20} color={colors.text.muted} />
        </Pressable>
      </View>

      <View style={styles.userCard}>
        <View style={styles.userAvatar}>
          <MaterialCommunityIcons name="account" size={20} color={colors.brand.primary} />
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>{userName}</Text>
          <Text style={styles.userMeta} numberOfLines={1}>{roleLabel} · {companyName}</Text>
        </View>
      </View>

      <View style={styles.navLabel}>
        <Text style={styles.navLabelText}>{t('home.sections.applications').toUpperCase()}</Text>
      </View>

      <ScrollView style={styles.appList} showsVerticalScrollIndicator={false}>
        {apps.map(app => (
          <SidebarAppItem key={app.id} app={app} onPress={() => onAppPress(app.id)} />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={onSettings} style={styles.footerBtn}>
          <MaterialCommunityIcons name="cog-outline" size={18} color={colors.text.muted} />
          <Text style={styles.footerBtnText}>{t('settings.title')}</Text>
        </Pressable>
        <Pressable onPress={onLogout} style={styles.footerBtn}>
          <MaterialCommunityIcons name="logout" size={18} color={colors.text.muted} />
          <Text style={styles.footerBtnText}>{t('common.done')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: 240, backgroundColor: colors.bg.secondary, borderRightWidth: 1, borderRightColor: colors.border.subtle },
  collapsedContainer: { width: 60, backgroundColor: colors.bg.secondary, borderRightWidth: 1, borderRightColor: colors.border.subtle, alignItems: 'center', paddingVertical: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  logoImage: { width: 24, height: 24 },
  brandText: { ...typography.body, fontWeight: '700', color: colors.text.primary, fontSize: 14 },
  suiteText: { ...typography.caption, color: colors.brand.primary, fontSize: 8, letterSpacing: 2 },
  toggleBtn: { width: 32, height: 32, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center' },
  userCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, margin: spacing.md, padding: spacing.sm, backgroundColor: colors.bg.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle },
  userAvatar: { width: 32, height: 32, borderRadius: radius.full, backgroundColor: `${colors.brand.primary}15`, justifyContent: 'center', alignItems: 'center' },
  userInfo: { flex: 1 },
  userName: { ...typography.bodySmall, fontWeight: '600', color: colors.text.primary },
  userMeta: { ...typography.caption, color: colors.text.muted, fontSize: 9, marginTop: 1 },
  navLabel: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  navLabelText: { ...typography.caption, color: colors.text.muted, fontSize: 9, letterSpacing: 1.5, fontWeight: '700' },
  appList: { flex: 1, paddingHorizontal: spacing.sm },
  footer: { borderTopWidth: 1, borderTopColor: colors.border.subtle, padding: spacing.sm, gap: spacing.xs },
  footerBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  footerBtnText: { ...typography.bodySmall, color: colors.text.muted },
  collapsedLogo: { marginVertical: spacing.md },
  collapsedLogoImage: { width: 28, height: 28 },
  collapsedApps: { flex: 1, marginTop: spacing.sm },
  collapsedAppBtn: { padding: spacing.sm, alignItems: 'center' },
  collapsedAppBtnPressed: { opacity: 0.7 },
  collapsedAppIcon: { width: 36, height: 36, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center' },
  collapsedBottomBtn: { padding: spacing.sm },
});
