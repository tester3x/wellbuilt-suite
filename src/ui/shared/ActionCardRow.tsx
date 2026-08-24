// ActionCardRow — horizontal row of 3 medium action cards:
// Shift (status-aware), Timesheet (nav link), WellBuilt eQuipment (launch).
// On "Start Shift" tap, shows enhanced ShiftStartModal with vehicle info,
// odometer, and pre-trip checklist.
// On active shift tap, shows ShiftEndModal with end odometer and return options.

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useAppLauncher } from '@/core/hooks/useAppLauncher';
import { runEquipmentCardLaunch } from '@/core/services/dvirGate/equipmentCardLaunch';
import { equipmentHandoffNotice } from '@/core/services/dvirGate/dvirGateService';
import {
  hasEquipmentHandoffConfirmHandler,
  requestEquipmentHandoffConfirm,
} from '@/core/services/dvirGate/equipmentHandoffConfirm';
import { type JsaMode } from '@/core/services/companyConfig';
import { useAuth } from '@/core/context/AuthContext';
import { mayOpenStartShiftChecklist } from '@/core/services/workPeriodAuthority/postLoginShiftRestoration';
import {
  isExplicitStartShiftSuccess,
  startShiftFailureReason,
} from '@/core/services/workPeriodAuthority/shiftSessionGuards';
import ShiftStartModal, { type ShiftStartData } from './ShiftStartModal';
import ShiftEndModal from './ShiftEndModal';
import ShiftArrivalModal from './ShiftArrivalModal';
import EnRouteYardCard from './EnRouteYardCard';

interface ActionCardRowProps {
  active: boolean;
  returning: boolean;
  returnStartTime: string | null;
  shiftStartTime: string | null;
  onStartShift: (packageId?: string) => Promise<{ ok: boolean; reason?: string }>;
  onStartReturn: () => Promise<void>;
  onArrived: (odometerMiles?: number) => Promise<boolean | void>;
  jsaMode?: JsaMode;
  jsaPending?: boolean;
  onJsaLaunch?: () => void;
}

function formatElapsed(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  if (ms < 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
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

/** DOT-style color: green < 8h, yellow 8-10h, red > 10h */
function getShiftColor(startIso: string | null): string {
  if (!startIso) return '#34D399';
  const hours = (Date.now() - new Date(startIso).getTime()) / 3600000;
  if (hours >= 10) return '#EF4444';
  if (hours >= 8) return '#F59E0B';
  return '#34D399';
}

export function ActionCardRow({ active, returning, returnStartTime, shiftStartTime, onStartShift, onStartReturn, onArrived, jsaMode, jsaPending, onJsaLaunch }: ActionCardRowProps) {
  const { t } = useTranslation();
  const { launchWBApp, dvirGate } = useAppLauncher();
  const { shiftAuthorityUi, refreshShiftAuthority, startShiftBusy } = useAuth();
  const [elapsed, setElapsed] = useState('0:00');
  const [shiftElapsed, setShiftElapsed] = useState('0:00');
  const [dotColor, setDotColor] = useState('#34D399');
  const [showStartModal, setShowStartModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [showArrivalModal, setShowArrivalModal] = useState(false);
  const [startConfirmBusy, setStartConfirmBusy] = useState(false);
  const canOpenChecklist = mayOpenStartShiftChecklist(shiftAuthorityUi);
  const claimBusy = startShiftBusy || startConfirmBusy;
  // (Pre-shift JSA preview breadcrumb + banner removed 2026-05-01. The
  // Preview-JSA-from-Start-Shift-modal flow caused two field-confirmed
  // bugs: signed JSAs scoped to the wrong shiftId, and the modal closing
  // on backgrounding to WB JSA. See ShiftStartModal jsa-explainer comment
  // for context.)

  // Tick shift timer while active
  useEffect(() => {
    if (!active || !shiftStartTime) return;
    setShiftElapsed(formatElapsed(shiftStartTime));
    setDotColor(getShiftColor(shiftStartTime));
    const interval = setInterval(() => {
      setShiftElapsed(formatElapsed(shiftStartTime));
      setDotColor(getShiftColor(shiftStartTime));
    }, 1000);
    return () => clearInterval(interval);
  }, [active, shiftStartTime]);

  // Tick return timer while returning
  useEffect(() => {
    if (!returning || !returnStartTime) return;
    setElapsed(formatElapsed(returnStartTime));
    const interval = setInterval(() => setElapsed(formatElapsed(returnStartTime)), 1000);
    return () => clearInterval(interval);
  }, [returning, returnStartTime]);

  // ── Shift card press handler ──
  const handleShiftPress = () => {
    if (returning) {
      // Returning to yard — branded arrival confirmation with post-trip checklist
      setShowArrivalModal(true);
    } else if (active) {
      // Active shift — show end shift modal
      setShowEndModal(true);
    } else {
      // Authority must clear before checklist (enforced explicit_shift).
      if (shiftAuthorityUi.kind === 'checking') {
        Alert.alert('Shift status', 'Checking shift status…');
        return;
      }
      if (shiftAuthorityUi.kind === 'unavailable') {
        Alert.alert(
          'Shift unavailable',
          'Could not verify shift status. Check your connection and try again.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Retry', onPress: () => { void refreshShiftAuthority(); } },
          ],
        );
        return;
      }
      if (shiftAuthorityUi.kind === 'open') {
        // Server says open but local UI inactive — refresh to restore.
        void refreshShiftAuthority();
        return;
      }
      if (!canOpenChecklist) return;
      setShowStartModal(true);
    }
  };

  // ── Start shift confirmed ──
  // Only explicit { ok: true } proceeds. null/undefined/malformed = failure.
  // Single-flight: in-flight second confirms are no-ops (AuthContext + local busy).
  const handleStartConfirm = async (data: ShiftStartData) => {
    if (claimBusy) return;
    setStartConfirmBusy(true);
    try {
      let result: { ok: boolean; reason?: string };
      try {
        result = await onStartShift(data.packageId || undefined);
      } catch (err) {
        console.warn('[ActionCardRow] startShift threw:', err);
        Alert.alert('Could not start shift', 'start failed');
        return;
      }
      if (!isExplicitStartShiftSuccess(result)) {
        const reason = startShiftFailureReason(result);
        // in_flight: silent (first confirm owns the op)
        if (reason !== 'in_flight') {
          Alert.alert('Could not start shift', reason.replace(/_/g, ' '));
        }
        return;
      }
      setShowStartModal(false);
      // Force Pre-Trip only after successful claim/adoption (still under busy).
      try {
        const { createSuiteDvirGate } = await import('@/core/services/dvirGate');
        const gate = createSuiteDvirGate({ isShiftActive: () => true });
        await gate.ensurePreTripGate({ alertOnBlock: true });
      } catch (err) {
        console.warn('[ActionCardRow] Pre-Trip gate launch failed:', err);
      }
    } finally {
      setStartConfirmBusy(false);
    }
  };

  // ── End shift: return to yard ──
  const handleReturnToYard = async () => {
    setShowEndModal(false);
    await onStartReturn();
  };


  // ── Shift card state ──
  let shiftIcon: keyof typeof MaterialCommunityIcons.glyphMap = 'play-circle-outline';
  let shiftLabel = t('shift.startShift');
  let shiftSub = t('shift.tapToClockIn');
  let shiftColor: string = colors.brand.accent;
  let shiftBorder = `${colors.brand.accent}30`;
  let showDot = false;
  let shiftDisabled = false;

  if (returning) {
    shiftIcon = 'truck';
    shiftLabel = t('shift.returning');
    shiftSub = elapsed;
    shiftColor = '#F59E0B';
    shiftBorder = 'rgba(245, 158, 11, 0.3)';
  } else if (active) {
    shiftIcon = 'clock-outline';
    shiftLabel = shiftElapsed;
    shiftSub = t('shift.tapToEndShort');
    shiftColor = dotColor;
    shiftBorder = `${dotColor}40`;
    showDot = true;
  } else if (shiftAuthorityUi.kind === 'checking') {
    shiftLabel = 'Checking…';
    shiftSub = 'Shift status';
    shiftColor = colors.text.muted;
    shiftBorder = colors.border.subtle;
    shiftDisabled = true;
  } else if (shiftAuthorityUi.kind === 'unavailable') {
    shiftLabel = 'Unavailable';
    shiftSub = 'Tap to retry';
    shiftColor = '#F59E0B';
    shiftBorder = 'rgba(245, 158, 11, 0.3)';
  }

  // When returning to yard, show full-width en route card instead of 3-card row
  if (returning) {
    return (
      <View>
        <EnRouteYardCard
          returnStartTime={returnStartTime}
          onArrived={() => setShowArrivalModal(true)}
        />

        {/* ── Arrival Confirmation Modal ── */}
        <ShiftArrivalModal
          visible={showArrivalModal}
          onClose={() => setShowArrivalModal(false)}
          onConfirm={async (miles) => {
            // Hold the modal open with its busy spinner while end-of-shift
            // work runs. Do not close on close failure or invalid odometer.
            try {
              const { createSuiteDvirGate } = await import('@/core/services/dvirGate');
              // Governed Post-Trip: PKCE only (no hash/name URI material).
              const gate = createSuiteDvirGate({ isShiftActive: () => true });
              const post = await gate.ensurePostTripGate({
                odometerMiles: miles,
                alertOnBlock: true,
              });
              if (!post.allowed) {
                // Keep shift active; pending end-shift stored for resume after receipt.
                setShowArrivalModal(false);
                return;
              }
              const closed = await onArrived(miles);
              if (closed === false) {
                Alert.alert(
                  'Could not end shift',
                  'Check total miles (0–5000 whole miles) and try again. Your shift is still open.',
                );
                return; // keep arrival modal open
              }
              // Arrival finalizes the shift — clear pending Post-Trip routing.
              await gate.clearDvirRoutingAfterFinalization();
              setShowArrivalModal(false);
            } catch (err) {
              console.warn('[ActionCardRow] arrival confirm failed:', err);
              Alert.alert('Could not end shift', 'Try again. Your shift is still open.');
            }
          }}
          returnStartTime={returnStartTime}
        />
      </View>
    );
  }

  return (
    <View>
      <View style={s.row}>
        {/* Shift Card */}
        <Pressable
          onPress={handleShiftPress}
          disabled={shiftDisabled && shiftAuthorityUi.kind === 'checking'}
          style={[s.card, { borderColor: shiftBorder, opacity: shiftDisabled ? 0.7 : 1 }]}
        >
          <MaterialCommunityIcons name={shiftIcon} size={28} color={shiftColor} />
          <Text style={[s.label, { color: shiftColor }]}>{shiftLabel}</Text>
          <Text style={[s.sub, { color: shiftColor, opacity: 0.6 }]}>{shiftSub}</Text>
          {showDot && <PulsingDot color={shiftColor} />}
        </Pressable>

        {/* Timesheet Card */}
        <Pressable onPress={() => router.push('/timesheet')} style={[s.card, s.cardTimesheet]}>
          <MaterialCommunityIcons name="cash-multiple" size={28} color="#34D399" />
          <Text style={[s.label, { color: '#34D399' }]}>{t('actionCard.timesheet')}</Text>
          <Text style={[s.sub, { color: 'rgba(52, 211, 153, 0.6)' }]}>{t('actionCard.viewPay')}</Text>
        </Pressable>

        {/* WellBuilt eQuipment — launches com.wellbuilt.equipment only (no eWallet fallback) */}
        <Pressable
          onPress={() => {
            void (async () => {
              try {
                await runEquipmentCardLaunch({
                  shiftActive: active,
                  getOpenPeriodId: () => dvirGate.getCurrentShiftId(),
                  isPreTripComplete: (id) => dvirGate.isPreTripComplete(id),
                  isPostTripComplete: (id) => dvirGate.isPostTripComplete(id),
                  getPendingEndShiftId: async () => {
                    const pending = await dvirGate.peekPendingEndShift();
                    return pending?.shiftId ?? null;
                  },
                  launchPhase: (phase, shiftId) => dvirGate.launchPhase(phase, shiftId),
                  openEquipmentCredentialFree: () =>
                    launchWBApp({
                      name: 'WellBuilt eQuipment',
                      scheme: 'wbequipment',
                      androidPackage: 'com.wellbuilt.equipment',
                    }),
                  confirmLeave: async (phase) => {
                    const notice = equipmentHandoffNotice(phase);
                    if (hasEquipmentHandoffConfirmHandler()) {
                      return requestEquipmentHandoffConfirm({
                        phase,
                        title: notice.title,
                        message: notice.message,
                      });
                    }
                    return true;
                  },
                });
              } catch (err) {
                console.warn('[ActionCardRow] equipment governed launch failed:', err);
              }
            })();
          }}
          style={[s.card, s.cardWallet]}
        >
          <MaterialCommunityIcons name="truck" size={28} color={colors.brand.accent} />
          <Text style={[s.label, { color: colors.brand.accent }]}>{t('actionCard.eEquipment')}</Text>
          <Text style={[s.sub, { color: colors.text.muted }]}>{t('actionCard.equipmentSub')}</Text>
        </Pressable>
      </View>

      {/* JSA Required banner + JsaChoiceModal both removed (4/24/2026).
          The per-job-close JSA gate in WB T owns the prompt; shift-start
          + home-screen are silent. Drivers can still launch the JSA app
          early via the application grid. */}

      {/* ── Enhanced Shift Start Modal ── */}
      <ShiftStartModal
        visible={showStartModal}
        onClose={() => {
          if (claimBusy) return;
          setShowStartModal(false);
        }}
        onConfirm={handleStartConfirm}
        confirming={claimBusy}
      />

      {/* ── Enhanced Shift End Modal ── */}
      <ShiftEndModal
        visible={showEndModal}
        onClose={() => setShowEndModal(false)}
        onReturnToYard={handleReturnToYard}
        shiftStartTime={shiftStartTime}
      />
    </View>
  );
}

const s = StyleSheet.create({
  jsaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f59e0b',
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: spacing.md,
    marginTop: -spacing.sm,
  },
  jsaBannerTitle: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
  },
  jsaBannerSub: {
    color: 'rgba(0,0,0,0.6)',
    fontSize: 12,
    marginTop: 1,
  },
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
});
