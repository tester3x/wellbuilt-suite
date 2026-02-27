// src/ui/v1-grid/screens/SettingsScreen.tsx
// Full driver settings: profile (Firebase-synced) + vehicle (local/Firebase) + app prefs.
// Same profile path as WB T: drivers/approved/{hash}/profile/

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useAuth } from '@/core/context/AuthContext';
import { useLanguage } from '@/core/localization';
import { useSkin } from '@/core/context/SkinContext';
import {
  loadDriverProfile,
  saveDriverProfile,
  loadVehicleInfo,
  saveVehicleInfo,
  clearProfileCache,
  type DriverProfile,
  type VehicleInfo,
} from '@/core/services/driverProfile';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { currentLanguage, setLanguage, supportedLanguages } = useLanguage();
  const { skinId, setSkin, availableSkins } = useSkin();

  // Profile state
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [vehicle, setVehicle] = useState<VehicleInfo>({ truckNumber: '', trailerNumber: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable fields
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [cdl, setCdl] = useState('');
  const [truckNumber, setTruckNumber] = useState('');
  const [trailerNumber, setTrailerNumber] = useState('');

  // Dirty tracking
  const [profileDirty, setProfileDirty] = useState(false);
  const [vehicleDirty, setVehicleDirty] = useState(false);

  const hash = user?.passcodeHash || '';

  // Load profile + vehicle on mount
  useEffect(() => {
    if (!hash) return;
    let cancelled = false;

    (async () => {
      const [p, v] = await Promise.all([
        loadDriverProfile(hash),
        loadVehicleInfo(hash),
      ]);

      if (cancelled) return;

      if (p) {
        setProfile(p);
        setDisplayName(p.displayName);
        setPhone(p.phone || '');
        setCdl(p.cdl || '');
      } else {
        // No profile yet — use auth display name
        setDisplayName(user?.displayName || '');
      }

      setVehicle(v);
      setTruckNumber(v.truckNumber);
      setTrailerNumber(v.trailerNumber);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [hash]);

  // Track dirty state
  useEffect(() => {
    if (!profile && !loading) {
      // New profile — always dirty if anything entered
      setProfileDirty(displayName.length > 0);
    } else if (profile) {
      setProfileDirty(
        displayName !== profile.displayName ||
        phone !== (profile.phone || '') ||
        cdl !== (profile.cdl || '')
      );
    }
  }, [displayName, phone, cdl, profile, loading]);

  useEffect(() => {
    setVehicleDirty(
      truckNumber !== vehicle.truckNumber ||
      trailerNumber !== vehicle.trailerNumber
    );
  }, [truckNumber, trailerNumber, vehicle]);

  const isDirty = profileDirty || vehicleDirty;

  const handleSave = useCallback(async () => {
    if (!hash || saving) return;
    setSaving(true);

    try {
      const promises: Promise<any>[] = [];

      if (profileDirty) {
        promises.push(
          saveDriverProfile(hash, {
            displayName: displayName.trim(),
            phone: phone.trim() || undefined,
            cdl: cdl.trim() || undefined,
          })
        );
      }

      if (vehicleDirty) {
        promises.push(
          saveVehicleInfo(hash, {
            truckNumber: truckNumber.trim(),
            trailerNumber: trailerNumber.trim(),
          })
        );
      }

      await Promise.all(promises);

      // Update local state to match saved values
      setProfile(prev => prev ? {
        ...prev,
        displayName: displayName.trim(),
        phone: phone.trim() || undefined,
        cdl: cdl.trim() || undefined,
      } : null);
      setVehicle({ truckNumber: truckNumber.trim(), trailerNumber: trailerNumber.trim() });
      setProfileDirty(false);
      setVehicleDirty(false);
    } catch (err) {
      Alert.alert('Save Failed', 'Could not save your changes. Check your connection.');
    } finally {
      setSaving(false);
    }
  }, [hash, saving, profileDirty, vehicleDirty, displayName, phone, cdl, truckNumber, trailerNumber]);

  const handleLogout = useCallback(() => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await clearProfileCache();
          await logout();
        },
      },
    ]);
  }, [logout]);

  const handleLanguageChange = useCallback((lang: string) => {
    setLanguage(lang);
    // Also save to Firebase profile
    if (hash) {
      saveDriverProfile(hash, { language: lang as 'en' | 'es' }).catch(() => {});
    }
  }, [hash, setLanguage]);

  const formatPhone = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits.length ? `(${digits}` : '';
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <MaterialCommunityIcons name="chevron-left" size={24} color={colors.text.primary} />
          </Pressable>
          <Text style={styles.headerTitle}>{t('settings.title')}</Text>
          <View style={styles.backButton} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.brand.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={24} color={colors.text.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('settings.title')}</Text>
        {isDirty ? (
          <Pressable onPress={handleSave} disabled={saving} style={styles.saveButton}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.brand.primary} />
            ) : (
              <Text style={styles.saveText}>{t('common.save')}</Text>
            )}
          </Pressable>
        ) : (
          <View style={styles.backButton} />
        )}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ── Driver Profile (Firebase-synced) ── */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>Driver Profile</Text>
          <View style={styles.syncBadge}>
            <MaterialCommunityIcons name="cloud-check" size={12} color="#34D399" />
            <Text style={styles.syncText}>Synced</Text>
          </View>
        </View>
        <Text style={styles.sectionSubtitle}>Follows you across all WellBuilt apps</Text>

        <View style={styles.fieldGroup}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.fieldInput}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your display name"
              placeholderTextColor={colors.text.muted}
              autoCapitalize="words"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput
              style={styles.fieldInput}
              value={phone}
              onChangeText={(text) => setPhone(formatPhone(text))}
              placeholder="(xxx) xxx-xxxx"
              placeholderTextColor={colors.text.muted}
              keyboardType="phone-pad"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>CDL #</Text>
            <TextInput
              style={styles.fieldInput}
              value={cdl}
              onChangeText={setCdl}
              placeholder="Commercial driver's license"
              placeholderTextColor={colors.text.muted}
              autoCapitalize="characters"
            />
          </View>
          {user?.companyName ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Company</Text>
              <View style={[styles.fieldInput, styles.fieldReadOnly]}>
                <Text style={styles.readOnlyText}>{user.companyName}</Text>
                <MaterialCommunityIcons name="lock" size={14} color={colors.text.muted} />
              </View>
            </View>
          ) : null}
          {profile?.signature ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Signature</Text>
              <View style={styles.signaturePreview}>
                <Text style={styles.signatureOnFile}>Signature on file</Text>
                <MaterialCommunityIcons name="check-circle" size={16} color="#34D399" />
              </View>
            </View>
          ) : null}
        </View>

        {/* ── Vehicle & Equipment ── */}
        <View style={[styles.sectionHeaderRow, { marginTop: spacing.xl }]}>
          <Text style={styles.sectionLabel}>Vehicle & Equipment</Text>
          <View style={styles.deviceBadge}>
            <MaterialCommunityIcons name="cellphone" size={12} color="#60A5FA" />
            <Text style={styles.deviceText}>This device</Text>
          </View>
        </View>
        <Text style={styles.sectionSubtitle}>Truck and trailer you're driving today</Text>

        <View style={styles.fieldGroup}>
          <View style={styles.fieldRow}>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>Truck #</Text>
              <TextInput
                style={styles.fieldInput}
                value={truckNumber}
                onChangeText={setTruckNumber}
                placeholder="e.g., 42"
                placeholderTextColor={colors.text.muted}
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>Trailer #</Text>
              <TextInput
                style={styles.fieldInput}
                value={trailerNumber}
                onChangeText={setTrailerNumber}
                placeholder="e.g., T-15"
                placeholderTextColor={colors.text.muted}
              />
            </View>
          </View>
        </View>

        {/* ── Language ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('settings.language')}</Text>
          <Text style={styles.sectionSubtitle}>{t('settings.languageSubtitle')}</Text>
          <View style={styles.optionGroup}>
            {supportedLanguages.map(lang => (
              <Pressable
                key={lang}
                onPress={() => handleLanguageChange(lang)}
                style={[styles.optionRow, currentLanguage === lang && styles.optionRowActive]}
              >
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

        {/* ── App Theme ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('settings.skin')}</Text>
          <Text style={styles.sectionSubtitle}>{t('settings.skinSubtitle')}</Text>
          <View style={styles.optionGroup}>
            {availableSkins.map(skin => (
              <Pressable
                key={skin.id}
                onPress={() => setSkin(skin.id)}
                style={[styles.optionRow, skinId === skin.id && styles.optionRowActive]}
              >
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

        {/* ── Account ── */}
        <View style={[styles.section, { marginBottom: spacing.xxl }]}>
          <Pressable onPress={handleLogout} style={styles.logoutButton}>
            <MaterialCommunityIcons name="logout" size={18} color="#EF4444" />
            <Text style={styles.logoutText}>Log Out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  backButton: { width: 40, height: 40, borderRadius: radius.full, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { ...typography.body, fontWeight: '600', color: colors.text.primary },
  saveButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.sm },
  saveText: { ...typography.body, fontWeight: '700', color: colors.brand.primary },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg },

  // Section headers
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel: { ...typography.h3, color: colors.text.primary, marginBottom: 2 },
  sectionSubtitle: { ...typography.caption, color: colors.text.muted, marginBottom: spacing.md },
  section: { marginTop: spacing.xl },

  // Sync / device badges
  syncBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#34D39915', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  syncText: { fontSize: 10, color: '#34D399', fontWeight: '600' },
  deviceBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#60A5FA15', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  deviceText: { fontSize: 10, color: '#60A5FA', fontWeight: '600' },

  // Fields
  fieldGroup: { gap: spacing.sm + 2 },
  field: { marginBottom: 2 },
  fieldLabel: { ...typography.caption, color: colors.text.muted, marginBottom: 4, fontSize: 11, fontWeight: '600' },
  fieldInput: {
    backgroundColor: colors.bg.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border.subtle,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    ...typography.body, color: colors.text.primary,
  },
  fieldReadOnly: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: `${colors.bg.card}80`,
  },
  readOnlyText: { ...typography.body, color: colors.text.muted },
  fieldRow: { flexDirection: 'row', gap: spacing.sm },

  // Signature
  signaturePreview: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.bg.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border.subtle,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
  },
  signatureOnFile: { ...typography.body, color: colors.text.muted, flex: 1 },

  // Options (language / skin)
  optionGroup: { gap: spacing.sm },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bg.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border.subtle, padding: spacing.md,
  },
  optionRowActive: { borderColor: colors.border.active, backgroundColor: `${colors.brand.primary}08` },
  optionText: { ...typography.body, color: colors.text.primary },
  optionTextActive: { color: colors.brand.primary, fontWeight: '600' },
  optionDescription: { ...typography.caption, color: colors.text.muted, marginTop: 2 },

  // Account
  logoutButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: '#EF444410', borderRadius: radius.md,
    borderWidth: 1, borderColor: '#EF444430',
    paddingVertical: spacing.md,
  },
  logoutText: { ...typography.body, color: '#EF4444', fontWeight: '600' },
});
