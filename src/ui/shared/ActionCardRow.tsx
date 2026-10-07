// ActionCardRow — horizontal row of 3 medium action cards:
// Shift (status-aware), Timesheet (nav link), WellBuilt eQuipment (launch).
// On "Start Shift" tap, shows enhanced ShiftStartModal with vehicle info,
// odometer, and pre-trip checklist.
// On active shift tap, shows ShiftEndModal with end odometer and return options.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useAppLauncher } from '@/core/hooks/useAppLauncher';
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
import ShiftUnavailableModal from './ShiftUnavailableModal';
import EnRouteYardCard from './EnRouteYardCard';
import { subscribeEtcNotice } from '@/core/services/etcStart/etcNoticeStore';
import { runReturnTap, createReturnTapLatch, type ReturnStartResult } from '@/core/services/returnStart';
import { jsaRecoveryLabel, type BlockedJsaClose } from '@/core/services/shiftJsaClose';

interface ActionCardRowProps {
  active: boolean;
  returning: boolean;
  returnStartTime: string | null;
  shiftStartTime: string | null;
  onStartShift: (packageId?: string) => Promise<{ ok: boolean; reason?: string }>;
  onStartReturn: () => Promise<ReturnStartResult>;
  onArrived: (odometerMiles?: number) => Promise<boolean | void>;
  jsaMode?: JsaMode;
  jsaPending?: boolean;
  onJsaLaunch?: () => void;
}

/**
 * The modal's recovery button for a blocked shift JSA. Null when there is
 * nothing extra to offer — a retry is the Confirm button the driver already has.
 */
function jsaRecoveryAction(
  block: BlockedJsaClose | null,
  onJsaLaunch?: () => void,
): { label: string; onPress: () => void } | null {
  if (!block || !onJsaLaunch) return null;
  const label = jsaRecoveryLabel(block);
  return label ? { label, onPress: onJsaLaunch } : null;
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
  const { launchWBApp } = useAppLauncher();
  const { shiftAuthorityUi, refreshShiftAuthority, startShiftBusy } = useAuth();
  const [elapsed, setElapsed] = useState('0:00');
  const [shiftElapsed, setShiftElapsed] = useState('0:00');
  const [dotColor, setDotColor] = useState('#34D399');
  const [showStartModal, setShowStartModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [showShiftUnavailableModal, setShowShiftUnavailableModal] = useState(false);
  const [returnBusy, setReturnBusy] = useState(false);
  const returnTapLatch = useRef(createReturnTapLatch());
  const [returnError, setReturnError] = useState<string | null>(null);
  const [showArrivalModal, setShowArrivalModal] = useState(false);
  const [postTripVerified, setPostTripVerified] = useState(false);
  const [arrivalError, setArrivalError] = useState<string | null>(null);
  /**
   * The blocked shift JSA decision, when a close was refused for JSA evidence.
   * Held so the modal can offer the route out of it (Open JSA / Acknowledge /
   * Try again) instead of only naming the problem.
   */
  const [jsaBlock, setJsaBlock] = useState<BlockedJsaClose | null>(null);
  const [retainedOdometer, setRetainedOdometer] = useState<string | undefined>(undefined);
  const markArrivedBusy = useRef(false);

  useEffect(() => {
    if (shiftAuthorityUi.kind !== 'unavailable') setShowShiftUnavailableModal(false);
  }, [shiftAuthorityUi.kind]);

  /**
   * Mark Arrived now records a durable arrival and launches the governed
   * Post-Trip inspection IMMEDIATELY — before any mileage or checkbox. The old
   * order opened this modal first and asked the driver to tick a Post-Trip box
   * that nothing had verified, launching WB-E only on confirm.
   * It never closes the shift.
   */
  const handleMarkArrived = useCallback(async () => {
    if (markArrivedBusy.current) return;
    markArrivedBusy.current = true;
    try {
      const [{ createSuiteDvirGate }, coordinator] = await Promise.all([
        import('@/core/services/dvirGate'),
        import('@/core/services/dvirGate/arrivalCoordinator'),
      ]);
      const gate = createSuiteDvirGate({ isShiftActive: () => true });
      const result = await coordinator.markArrived(gate);
      if (!result.arrived) {
        Alert.alert('Could not mark arrived', result.reason || 'Your shift is still open.');
        return;
      }
      if (result.showFinalModal) {
        // Post-Trip already satisfied for this shift — straight to the final
        // step, no relaunch of WB-E.
        setPostTripVerified(true);
        setArrivalError(null);
        setShowArrivalModal(true);
        return;
      }
      if (!result.launched) {
        // Handoff cancelled or failed: stay arrived, offer retry, and do NOT
        // present the final modal as though the inspection had passed.
        Alert.alert(
          'Post-trip inspection needed',
          (result.reason || 'The inspection app did not open.')
            + ' Your shift is still open — tap Mark Arrived again to retry.',
        );
      }
      // Launched: the receipt return opens the final modal.
    } catch (err) {
      console.warn('[ActionCardRow] mark arrived failed:', err);
      Alert.alert('Could not mark arrived', 'Try again. Your shift is still open.');
    } finally {
      markArrivedBusy.current = false;
    }
  }, []);

  /** Restore the final step after a receipt return or a process restart. */
  useEffect(() => {
    if (!returning) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ createSuiteDvirGate }, coordinator] = await Promise.all([
          import('@/core/services/dvirGate'),
          import('@/core/services/dvirGate/arrivalCoordinator'),
        ]);
        const gate = createSuiteDvirGate({ isShiftActive: () => true });
        const view = await coordinator.getResumeArrivalView(gate, { shiftActive: true });
        if (cancelled) return;
        if (view.show === 'final_modal') {
          setPostTripVerified(true);
          setRetainedOdometer(
            view.record.odometerMiles !== undefined ? String(view.record.odometerMiles) : undefined,
          );
          setShowArrivalModal(true);
        }
      } catch { /* resume is best-effort; the card stays usable */ }
    })();
    return () => { cancelled = true; };
  }, [returning]);
  const [startConfirmBusy, setStartConfirmBusy] = useState(false);
  const [etcNotice, setEtcNotice] = useState<string | null>(null);
  useEffect(() => subscribeEtcNotice(setEtcNotice), []);
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
        return;
      }
      if (shiftAuthorityUi.kind === 'unavailable') {
        setShowShiftUnavailableModal(true);
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
  // The confirmation is dismissed ONLY after the return has actually been
  // accepted. v49 closed it first and discarded the result, so a refused
  // return dropped the driver back to Home with an open shift, no return and
  // no error — and no way forward through End Shift / logout. All of the tap
  // behaviour lives in runReturnTap so it is covered by returnStart.test.ts.
  const handleReturnToYard = async () => {
    await runReturnTap({
      latch: returnTapLatch.current,
      start: onStartReturn,
      onStarted: () => setShowEndModal(false),
      onBusyChange: setReturnBusy,
      onError: setReturnError,
      report: (diagnosis) => {
        // Give a refused return somewhere durable to go: before this, the
        // reason was a console.warn on the device only, so a backend refusal
        // could not be told from a dead network without reading the tablet.
        void import('@/core/services/wbDiagLog')
          .then(({ wbDiagLog }) => wbDiagLog({
            area: 'shift',
            event: 'returnToYard.refused',
            source: 'ActionCardRow.handleReturnToYard',
            result: 'error',
            reason: diagnosis.code,
            extra: { recovery: diagnosis.recovery, retryable: diagnosis.retryable },
          }))
          .catch(() => {});
      },
    });
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
          onArrived={handleMarkArrived}
        />
        {etcNotice ? <Text style={s.etcNotice}>{etcNotice}</Text> : null}

        {/* ── Arrival Confirmation Modal ── */}
        <ShiftArrivalModal
          visible={showArrivalModal}
          onClose={() => { setShowArrivalModal(false); setJsaBlock(null); }}
          onConfirm={async (miles) => {
            // Only this submit closes the shift, and only once every condition
            // holds: a verified Post-Trip receipt for THIS shift, the driver's
            // paperwork confirmation, and valid miles.
            try {
              setArrivalError(null);
              setJsaBlock(null);
              const [{ createSuiteDvirGate }, coordinator] = await Promise.all([
                import('@/core/services/dvirGate'),
                import('@/core/services/dvirGate/arrivalCoordinator'),
              ]);
              const gate = createSuiteDvirGate({ isShiftActive: () => true });
              const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
              const { suiteShiftJsaCloseGate } = await import('@/core/services/shiftJsaCloseLive');
              const result = await coordinator.finalizeArrival(gate, {
                paperworkConfirmed: true, // the modal enables submit only when ticked
                odometerMiles: miles,
                close: async (m) => (await onArrived(m)) !== false,
                // The shift JSA rule, checked HERE because this is the only
                // place the shift closes. The gate it replaces sat on Log Out,
                // which runs after finalization.
                jsaGate: suiteShiftJsaCloseGate,
                // Promoted only after the authoritative close succeeded.
                onPrefillOdometer: async (m) => {
                  await AsyncStorage.setItem('wellbuilt-last-odometer', String(m)).catch(() => {});
                },
              });
              if (!result.ok) {
                setRetainedOdometer(miles !== undefined ? String(miles) : undefined);
                // A JSA block carries the server-truthful reason and the route
                // out of it. Never collapsed into the generic close failure.
                if (result.jsa?.kind === 'blocked') {
                  setJsaBlock(result.jsa);
                  setArrivalError(result.jsa.message);
                  return;
                }
                const message = result.reason === 'post_trip_missing'
                  ? 'The post-trip inspection for this shift is not recorded yet. Your shift is still open.'
                  : result.reason === 'odometer_invalid'
                    ? 'Check total miles (0–5000 whole miles). Your shift is still open.'
                    : 'Could not end shift. Your shift is still open — try again.';
                setArrivalError(message);
                return; // keep the modal open and recoverable
              }
              setJsaBlock(null);
              await gate.clearDvirRoutingAfterFinalization();
              setShowArrivalModal(false);
              setRetainedOdometer(undefined);
            } catch (err) {
              console.warn('[ActionCardRow] arrival confirm failed:', err);
              setArrivalError('Could not end shift. Your shift is still open — try again.');
            }
          }}
          postTripVerified={postTripVerified}
          initialOdometer={retainedOdometer}
          errorText={arrivalError}
          recoveryAction={jsaRecoveryAction(jsaBlock, onJsaLaunch)}
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
          onPress={() => launchWBApp({
            name: 'WellBuilt eQuipment',
            scheme: 'wbequipment',
            androidPackage: 'com.wellbuilt.equipment',
          })}
          style={[s.card, s.cardWallet]}
        >
          <MaterialCommunityIcons name="truck" size={28} color={colors.brand.accent} />
          <Text style={[s.label, { color: colors.brand.accent }]}>{t('actionCard.eEquipment')}</Text>
          <Text style={[s.sub, { color: colors.text.muted }]}>{t('actionCard.equipmentSub')}</Text>
        </Pressable>
      </View>
      {etcNotice ? <Text style={s.etcNotice}>{etcNotice}</Text> : null}

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
        onClose={() => { if (!returnTapLatch.current.held()) { setShowEndModal(false); setReturnError(null); } }}
        onReturnToYard={handleReturnToYard}
        busy={returnBusy}
        error={returnError}
        shiftStartTime={shiftStartTime}
      />
      <ShiftUnavailableModal
        visible={showShiftUnavailableModal && shiftAuthorityUi.kind === 'unavailable'}
        onClose={() => setShowShiftUnavailableModal(false)}
        onRetry={() => { void refreshShiftAuthority(); }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  etcNotice: {
    color: colors.text.muted,
    fontSize: 12,
    marginTop: 6,
    paddingHorizontal: 4,
  },
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
