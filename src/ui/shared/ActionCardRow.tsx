// ActionCardRow — horizontal row of 3 medium action cards:
// Shift (status-aware), Timesheet (nav link), eWallet (coming soon).
// On "Start Shift" tap, shows a package picker modal so the driver
// can confirm or change their job package before starting.

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Animated, Modal, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useAppLauncher } from '@/core/hooks/useAppLauncher';
import { useAuth } from '@/core/context/AuthContext';
import { fetchCompanyPackages, type ShiftPackageOption } from '@/core/services/companyConfig';

interface ActionCardRowProps {
  active: boolean;
  returning: boolean;
  returnStartTime: string | null;
  onStartShift: (packageId?: string) => Promise<void>;
  onStartReturn: () => Promise<void>;
  onArrived: () => Promise<void>;
}

function formatElapsed(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  if (ms < 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Pulsing dot for active shift
function PulsingDot({ color }: { color: string }) {
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  return (
    <Animated.View style={[s.dot, { backgroundColor: color, opacity: pulse }]} />
  );
}

export function ActionCardRow({ active, returning, returnStartTime, onStartShift, onStartReturn, onArrived }: ActionCardRowProps) {
  const { t } = useTranslation();
  const { launchWBApp } = useAppLauncher();
  const { user } = useAuth();
  const [elapsed, setElapsed] = useState('0:00');
  const [showPackageModal, setShowPackageModal] = useState(false);
  const [packages, setPackages] = useState<ShiftPackageOption[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<string>('');
  const [loadingPkgs, setLoadingPkgs] = useState(false);

  useEffect(() => {
    if (!returning || !returnStartTime) return;
    setElapsed(formatElapsed(returnStartTime));
    const interval = setInterval(() => setElapsed(formatElapsed(returnStartTime)), 1000);
    return () => clearInterval(interval);
  }, [returning, returnStartTime]);

  // ── Shift card press handler ──
  const handleShiftPress = () => {
    if (returning) {
      Alert.alert(t('shift.arrived'), t('shift.arrivedConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('shift.endShift'), onPress: onArrived },
      ]);
    } else if (active) {
      Alert.alert(t('shift.endShift'), t('shift.startReturnConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('shift.returnToYard'), onPress: onStartReturn, style: 'destructive' },
      ]);
    } else {
      // Start shift — show package picker
      openPackagePicker();
    }
  };

  const openPackagePicker = async () => {
    setLoadingPkgs(true);
    setShowPackageModal(true);
    try {
      const pkgs = await fetchCompanyPackages(user?.companyId || '');
      setPackages(pkgs);
      // Pre-select driver's default, or first available
      const defaultId = user?.defaultPackageId;
      if (defaultId && pkgs.some(p => p.id === defaultId)) {
        setSelectedPkg(defaultId);
      } else {
        setSelectedPkg(pkgs[0]?.id || '');
      }
    } catch {
      setPackages([{ id: 'water-hauling', name: 'Water Hauling' }]);
      setSelectedPkg('water-hauling');
    } finally {
      setLoadingPkgs(false);
    }
  };

  const confirmStartShift = async () => {
    setShowPackageModal(false);
    await onStartShift(selectedPkg || undefined);
  };

  // ── Shift card state ──
  let shiftIcon: keyof typeof MaterialCommunityIcons.glyphMap = 'play-circle-outline';
  let shiftLabel = t('shift.startShift');
  let shiftSub = t('shift.tapToClockIn');
  let shiftColor: string = colors.brand.accent;
  let shiftBorder = `${colors.brand.accent}30`;
  let showDot = false;

  if (returning) {
    shiftIcon = 'truck';
    shiftLabel = t('shift.returning');
    shiftSub = elapsed;
    shiftColor = '#F59E0B';
    shiftBorder = 'rgba(245, 158, 11, 0.3)';
  } else if (active) {
    shiftIcon = 'clock-outline';
    shiftLabel = t('shift.shiftActive');
    shiftSub = t('shift.tapToEndShort');
    shiftColor = '#34D399';
    shiftBorder = 'rgba(52, 211, 153, 0.3)';
    showDot = true;
  }

  return (
    <View style={s.row}>
      {/* Shift Card */}
      <Pressable
        onPress={handleShiftPress}
        style={[s.card, { borderColor: shiftBorder }]}
      >
        <MaterialCommunityIcons name={shiftIcon} size={28} color={shiftColor} />
        <Text style={[s.label, { color: shiftColor }]}>{shiftLabel}</Text>
        <Text style={[s.sub, { color: shiftColor, opacity: 0.6 }]}>{shiftSub}</Text>
        {showDot && <PulsingDot color={shiftColor} />}
        {returning && (
          <View style={[s.badge, { backgroundColor: '#F59E0B' }]}>
            <Text style={s.badgeText}>{t('shift.arrived')}</Text>
          </View>
        )}
      </Pressable>

      {/* Timesheet Card */}
      <Pressable onPress={() => router.push('/timesheet')} style={[s.card, s.cardTimesheet]}>
        <MaterialCommunityIcons name="cash-multiple" size={28} color="#34D399" />
        <Text style={[s.label, { color: '#34D399' }]}>{t('actionCard.timesheet')}</Text>
        <Text style={[s.sub, { color: 'rgba(52, 211, 153, 0.6)' }]}>{t('actionCard.viewPay')}</Text>
      </Pressable>

      {/* eWallet Card */}
      <Pressable
        onPress={() => launchWBApp({
          name: 'WB eWallet',
          scheme: 'wbewallet',
          androidPackage: 'com.wellbuilt.ewallet',
        })}
        style={[s.card, s.cardWallet]}
      >
        <MaterialCommunityIcons name="wallet-outline" size={28} color={colors.brand.accent} />
        <Text style={[s.label, { color: colors.brand.accent }]}>{t('actionCard.eWallet')}</Text>
        <Text style={[s.sub, { color: colors.text.muted }]}>{t('actionCard.documents')}</Text>
      </Pressable>

      {/* ── Package Picker Modal ── */}
      <Modal
        visible={showPackageModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPackageModal(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>{t('shift.startShift')}</Text>
            <Text style={s.modalSub}>{t('shift.selectPackage')}</Text>

            {loadingPkgs ? (
              <ActivityIndicator color={colors.brand.accent} style={{ marginVertical: 24 }} />
            ) : (
              <View style={s.pkgList}>
                {packages.map(pkg => (
                  <Pressable
                    key={pkg.id}
                    onPress={() => setSelectedPkg(pkg.id)}
                    style={[
                      s.pkgOption,
                      selectedPkg === pkg.id && s.pkgOptionSelected,
                    ]}
                  >
                    <View style={[
                      s.pkgRadio,
                      selectedPkg === pkg.id && s.pkgRadioSelected,
                    ]}>
                      {selectedPkg === pkg.id && <View style={s.pkgRadioDot} />}
                    </View>
                    <Text style={[
                      s.pkgLabel,
                      selectedPkg === pkg.id && s.pkgLabelSelected,
                    ]}>
                      {pkg.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            <View style={s.modalButtons}>
              <Pressable
                onPress={confirmStartShift}
                disabled={loadingPkgs || !selectedPkg}
                style={[s.modalBtn, s.modalBtnStart, (loadingPkgs || !selectedPkg) && { opacity: 0.4 }]}
              >
                <MaterialCommunityIcons name="play-circle-outline" size={20} color="#000" />
                <Text style={s.modalBtnStartText}>{t('shift.startShift')}</Text>
              </Pressable>
              <Pressable
                onPress={() => setShowPackageModal(false)}
                style={[s.modalBtn, s.modalBtnCancel]}
              >
                <Text style={s.modalBtnCancelText}>{t('common.cancel')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  card: {
    flex: 1,
    backgroundColor: colors.bg.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 110,
  },
  cardTimesheet: {
    borderColor: 'rgba(52, 211, 153, 0.2)',
  },
  cardWallet: {
    borderColor: `${colors.brand.accent}20`,
  },
  label: {
    ...typography.bodySmall,
    fontWeight: '700',
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  sub: {
    ...typography.caption,
    marginTop: 2,
    textAlign: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: spacing.xs,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: spacing.xs,
  },
  badgeText: {
    color: '#000',
    fontSize: 11,
    fontWeight: '700',
  },
  // ── Modal styles ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: colors.bg.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: 24,
    width: '100%',
    maxWidth: 360,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  modalSub: {
    color: colors.text.muted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  pkgList: {
    gap: 8,
    marginBottom: 20,
  },
  pkgOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  pkgOptionSelected: {
    borderColor: colors.brand.accent,
    backgroundColor: `${colors.brand.accent}15`,
  },
  pkgRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pkgRadioSelected: {
    borderColor: colors.brand.accent,
  },
  pkgRadioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.brand.accent,
  },
  pkgLabel: {
    color: '#ccc',
    fontSize: 16,
    fontWeight: '500',
  },
  pkgLabelSelected: {
    color: '#fff',
    fontWeight: '700',
  },
  modalButtons: {
    gap: 10,
  },
  modalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
  },
  modalBtnStart: {
    backgroundColor: colors.brand.accent,
  },
  modalBtnStartText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  modalBtnCancel: {
    backgroundColor: 'transparent',
  },
  modalBtnCancelText: {
    color: colors.text.muted,
    fontSize: 14,
    fontWeight: '500',
  },
});
