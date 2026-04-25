// app/day-summary.tsx — End-of-day shift summary screen
// Shown after driver taps "Arrived" at yard. Displays daily stats
// with Close (stay in app) and Log Out (RTDB cascade + clear session) buttons.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  BackHandler,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/context/AuthContext';
import { colors } from '@/core/theme';
import { firebasePatch } from '@/core/services/driverAuth';
import { cascadeLogoutToSSOApps } from '@/core/services/appLauncher';
import {
  fetchTodayInvoices,
  fetchTodayShift,
  calculateDaySummary,
  type DaySummary,
} from '@/core/services/daySummary';
import { acknowledgeShiftJsa } from '@/core/services/jsaShiftAck';
import JsaCloseModal from '@/ui/shared/JsaCloseModal';

function formatTime12h(iso: string | null): string {
  if (!iso) return '--:--';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '--:--';
    let hours = d.getHours();
    const mins = d.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${String(mins).padStart(2, '0')} ${ampm}`;
  } catch {
    return '--:--';
  }
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Time breakdown bar colors ────────────────────────────────────────────────
const BAR_COLORS = {
  drive:   '#3b82f6',
  pickup:  '#22c55e',
  dropoff: '#8b5cf6',
  yard:    '#f59e0b',
  other:   '#6b7280',
} as const;

interface TimeBarProps {
  label: string;
  minutes: number;
  totalMinutes: number;
  color: string;
}

function TimeBar({ label, minutes, totalMinutes, color }: TimeBarProps) {
  const pct = totalMinutes > 0 ? Math.max((minutes / totalMinutes) * 100, 2) : 0;
  return (
    <View style={s.timeBarRow}>
      <View style={s.timeBarHeader}>
        <Text style={[s.timeBarLabel, { color }]}>{label}</Text>
        <Text style={s.timeBarValue}>{formatDuration(minutes)}</Text>
      </View>
      <View style={[s.timeBarTrack, { backgroundColor: color + '26' }]}>
        <View style={[s.timeBarFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

// ── DEBUG: Mock data for layout testing ─────────────────────────────────────
const DEV_TEST = false;
function randomMockSummary(): DaySummary {
  const wells = ['GABRIEL 6-36-25TFH', 'THOR 1-31-30H', 'GABRIEL 2-36-25H', 'GABRIEL 7-36-25TFH', 'DAGGER 1-22-15H', 'RENEGADE 4-8-17TFH', 'IRONBANK 6-19-30H'];
  const visitedCount = Math.floor(Math.random() * 4) + 2; // 2-5 wells
  const shuffled = wells.sort(() => Math.random() - 0.5).slice(0, visitedCount);
  // Generate per-well stats — some wells get multiple loads
  const wellStats = shuffled.map(name => {
    const loads = Math.random() > 0.6 ? 2 : 1; // 40% chance of 2 loads
    const bblPerLoad = [120, 130, 140, 150, 160][Math.floor(Math.random() * 5)];
    return { name, bbls: loads * bblPerLoad, loads };
  });
  const loads = wellStats.reduce((s, w) => s + w.loads, 0);
  const driveMin = Math.floor(Math.random() * 120) + 180; // 180-300
  const pickupMin = Math.floor(Math.random() * 15) + 5;   // 5-20
  const dropoffMin = Math.floor(Math.random() * 10) + 3;  // 3-13
  const otherMin = Math.floor(Math.random() * 40) + 15;   // 15-55
  const totalMin = driveMin + pickupMin + dropoffMin + otherMin;
  const totalHours = Math.round(totalMin / 6) / 10;
  const miles = Math.round((Math.random() * 60 + 60) * 10) / 10; // 60-120
  const now = new Date();
  const startH = 6 + Math.floor(Math.random() * 3); // 6-8 AM
  const start = new Date(now); start.setHours(startH, Math.floor(Math.random() * 30), 0);
  const end = new Date(start.getTime() + totalMin * 60000);
  const totalBBL = wellStats.reduce((s, w) => s + w.bbls, 0);
  return {
    totalLoads: loads,
    totalBBL,
    wellsVisited: shuffled,
    wellStats,
    totalHoursWorked: totalHours,
    driveMinutes: driveMin,
    onSiteMinutes: pickupMin + dropoffMin,
    pickupMinutes: pickupMin,
    dropoffMinutes: dropoffMin,
    driveMiles: miles,
    avgSpeedMph: Math.round(miles / (driveMin / 60)),
    shiftStart: start.toISOString(),
    shiftEnd: end.toISOString(),
  };
}

export default function DaySummaryScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, logoutWithCascade } = useAuth();
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [jsaStatus, setJsaStatus] = useState<{
    completed: boolean;
    completedAt: string | null;
    pdfUrl: string | null;
    wellCount: number;
  } | null>(null);
  const [jsaGateShiftEnd, setJsaGateShiftEnd] = useState(false);
  const [jsaGateLoaded, setJsaGateLoaded] = useState(false);
  const [jsaAllowAcknowledge, setJsaAllowAcknowledge] = useState(true);
  // Shift-end JSA gate state — modal opens when driver hits Log Out without
  // jsaCompleted. Acknowledge writes jsa_day_status.jsaCompleted=true; Read
  // deep-links to WB JSA. After Acknowledge, logout proceeds via the same
  // confirm Alert that already exists below.
  const [showJsaModal, setShowJsaModal] = useState(false);
  const [jsaAcknowledging, setJsaAcknowledging] = useState(false);

  // Android back button: go to WB S home, not back to WB T
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      router.replace('/home');
      return true; // Prevent default back behavior
    });
    return () => backHandler.remove();
  }, [router]);

  useEffect(() => {
    // 🔴 DEBUG: Auto-load mock data when DEV_TEST is on
    if (DEV_TEST) {
      setSummary(randomMockSummary());
      setLoading(false);
      setJsaGateLoaded(true);
      return;
    }
    if (!user) return;
    const driverName = user.legalName || user.displayName;
    // jsa_day_status doc ids are keyed by UTC date (jsaTracking.ts uses
    // toISOString().slice(0,10)). Past 6 PM Mountain (midnight UTC) the
    // local-day driver is on shift, but `new Date().toISOString()` reports
    // tomorrow's UTC date — so today's doc id misses by one. Same trap the
    // WB T JSA banner had; same fallback: try today, then yesterday.
    const todayStr = new Date().toISOString().slice(0, 10);
    const yesterdayStr = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    const API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';
    const BASE = 'https://firestore.googleapis.com/v1/projects/wellbuilt-sync/databases/(default)/documents';

    // All 4 fetches in parallel — no sequential waits
    const invoicesP = fetchTodayInvoices(driverName, user.companyId).catch(() => [] as any[]);
    const shiftP = fetchTodayShift(user.driverId).catch(() => null);
    const fetchJsaForDate = (dateStr: string) =>
      fetch(`${BASE}/jsa_day_status/${user.driverId}_${dateStr}?key=${API_KEY}`)
        .then(r => r.ok ? r.json() : null).catch(() => null);
    const jsaP = fetchJsaForDate(todayStr).then(async (doc) => {
      if (doc) return doc;
      // Today missed — try yesterday (UTC-rollover during a late shift).
      return fetchJsaForDate(yesterdayStr);
    });
    const companyP = user.companyId
      ? fetch(`${BASE}/companies/${user.companyId}?key=${API_KEY}`)
          .then(r => r.ok ? r.json() : null).catch(() => null)
      : Promise.resolve(null);

    Promise.all([invoicesP, shiftP, jsaP, companyP]).then(([invoices, shift, jsaDoc, companyDoc]) => {
      // Summary data
      const result = calculateDaySummary(invoices, shift?.events || [], shift?.odometerMiles);
      setSummary(result);

      // JSA status
      if (jsaDoc) {
        const f = jsaDoc.fields;
        const wells = f?.wells?.arrayValue?.values;
        const wellCount = Array.isArray(wells) ? wells.length : 0;
        console.log(`[jsaFix] wells count = ${wellCount}`);
        setJsaStatus({
          completed: f?.jsaCompleted?.booleanValue === true,
          completedAt: f?.jsaCompletedAt?.timestampValue || null,
          pdfUrl: f?.pdfUrl?.stringValue || null,
          wellCount,
        });
      } else {
        console.log('[jsaFix] wells count = 0');
        setJsaStatus({ completed: false, completedAt: null, pdfUrl: null, wellCount: 0 });
      }

      // JSA gate from company config. Legacy 'per_load' / 'per_location' read
      // as their behavior (per_load was per-job, no shift gate; per_location
      // gated like per_shift). Per the 4/24 mode rename, only 'per_shift'
      // gates shift end going forward.
      if (companyDoc) {
        const mode = companyDoc.fields?.jsaMode?.stringValue || 'off';
        setJsaGateShiftEnd(mode === 'per_shift' || mode === 'per_location');
        const allow = companyDoc.fields?.jsaAllowAcknowledge?.booleanValue;
        // Default true when field missing — matches Dashboard JsaCard default.
        setJsaAllowAcknowledge(allow !== false);
      }

      setJsaGateLoaded(true);
      setLoading(false);
    }).catch(() => {
      setJsaGateLoaded(true);
      setLoading(false);
    });
  }, [user]);

  const handleClose = () => {
    // Close = dismiss summary, stay logged in. No cascade logout.
    // Logout cascade only happens on explicit "Log Out" button.
    router.replace('/home');
  };

  const handleLogout = () => {
    // JSA gate: only block logout if rule.gateShiftEnd is true (per_shift) and
    // jsaCompleted hasn't flipped to true today. The proper modal replaces
    // the Alert-based shortcut so drivers get the same Read/Ack experience
    // they see in WB T at job-close.
    if (jsaGateShiftEnd && jsaStatus && !jsaStatus.completed) {
      setShowJsaModal(true);
      return;
    }

    Alert.alert(t('daySummary.logOut'), t('daySummary.logOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('daySummary.logOut'),
        style: 'destructive',
        onPress: async () => {
          await logoutWithCascade();
        },
      },
    ]);
  };

  // ── JSA gate modal handlers ───────────────────────────────────────────

  /** Acknowledge today's JSA in-place — write jsa_day_status flag, then resume logout. */
  const handleJsaAcknowledge = async () => {
    if (jsaAcknowledging || !user) return;
    setJsaAcknowledging(true);
    try {
      const driverName = user.legalName || user.displayName || '';
      const ok = await acknowledgeShiftJsa(
        user.driverId,
        driverName,
        user.companyId || '',
        'acknowledged',
      );
      if (!ok) {
        Alert.alert('Network Issue', 'Could not record acknowledgment. Try again or tap Read JSA.');
        return;
      }
      // Reflect locally so the gate doesn't re-fire on the next handleLogout call.
      setJsaStatus(prev => prev ? { ...prev, completed: true, completedAt: new Date().toISOString() } : prev);
      setShowJsaModal(false);
      // Loop back into the logout-confirm Alert flow.
      setTimeout(() => handleLogout(), 0);
    } finally {
      setJsaAcknowledging(false);
    }
  };

  /** Open WB JSA via deep link. Halt logout — driver returns and re-taps Log Out. */
  const handleJsaRead = async () => {
    setShowJsaModal(false);
    try {
      const Linking = await import('expo-linking');
      const params = new URLSearchParams({ returnTo: 'wbs' });
      if (user?.driverId) params.set('hash', user.driverId);
      const name = user?.legalName || user?.displayName;
      if (name) params.set('name', name);
      await Linking.openURL(`jsaapp://start?${params.toString()}`);
    } catch (err) {
      console.warn('[day-summary] Read JSA deep link failed:', err);
      Alert.alert('JSA App Not Available', 'Could not open the WB JSA app. Tap Acknowledged or install WB JSA.');
    }
  };

  const handleJsaCancel = () => {
    if (jsaAcknowledging) return;
    setShowJsaModal(false);
  };

  const timeRange = summary
    ? `${formatTime12h(summary.shiftStart)} – ${formatTime12h(summary.shiftEnd)}`
    : '';

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.scrollContent}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.checkCircle}>
            <MaterialCommunityIcons name="check" size={36} color={colors.status.online} />
          </View>
          <Text style={s.title}>{t('daySummary.title')}</Text>
          {timeRange ? <Text style={s.timeRange}>{timeRange}</Text> : null}
        </View>

        {/* 🔴 DEBUG: Test button — tap to load random realistic data */}
        {DEV_TEST && (
          <Pressable
            onPress={() => { setSummary(randomMockSummary()); setLoading(false); }}
            style={{ alignSelf: 'center', backgroundColor: '#ef4444', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, marginBottom: 16 }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>🔴 TEST — Random Data</Text>
          </Pressable>
        )}

        {loading ? (
          <View style={s.loadingContainer}>
            <ActivityIndicator size="large" color={colors.brand.primary} />
            <Text style={s.loadingText}>{t('daySummary.loading')}</Text>
          </View>
        ) : summary ? (
          <>
            {/* ── Time card ──────────────────────────────────────── */}
            {(() => {
              const totalMin = Math.round(summary.totalHoursWorked * 60);
              const accountedMin = summary.driveMinutes + summary.pickupMinutes + summary.dropoffMinutes;
              const otherMin = Math.max(totalMin - accountedMin, 0);
              return totalMin > 0 ? (
                <View style={s.timeSection}>
                  <View style={s.cardHeader}>
                    <Text style={s.sectionTitle}><MaterialCommunityIcons name="clock-outline" size={14} color={colors.text.secondary} />  TIME</Text>
                    <Text style={s.cardTotal}>{summary.totalHoursWorked}h</Text>
                  </View>
                  <TimeBar label="Drive"     minutes={summary.driveMinutes}   totalMinutes={totalMin} color={BAR_COLORS.drive} />
                  <TimeBar label="Pickup"    minutes={summary.pickupMinutes}  totalMinutes={totalMin} color={BAR_COLORS.pickup} />
                  <TimeBar label="Drop-off"  minutes={summary.dropoffMinutes} totalMinutes={totalMin} color={BAR_COLORS.dropoff} />
                  {otherMin > 0 && (
                    <TimeBar label="Other" minutes={otherMin} totalMinutes={totalMin} color={BAR_COLORS.other} />
                  )}
                </View>
              ) : null;
            })()}

            {/* ── Wells card ─────────────────────────────────────── */}
            {summary.wellStats && summary.wellStats.length > 0 && (
              <View style={s.timeSection}>
                <View style={s.cardHeader}>
                  <Text style={s.sectionTitle}><MaterialCommunityIcons name="oil" size={14} color={colors.text.secondary} />  WELLS</Text>
                  <Text style={s.cardTotal}>
                    {summary.totalLoads} loads · {Math.round(summary.totalBBL)} BBL
                  </Text>
                </View>
                {summary.wellStats.map((well, idx) => {
                  const pct = summary.totalBBL > 0 ? Math.max((well.bbls / summary.totalBBL) * 100, 3) : 0;
                  const wellColors = ['#f59e0b', '#3b82f6', '#22c55e', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];
                  const color = wellColors[idx % wellColors.length];
                  return (
                    <View key={idx} style={s.timeBarRow}>
                      <View style={s.timeBarHeader}>
                        <Text style={[s.timeBarLabel, { color }]} numberOfLines={1}>{well.name}</Text>
                        <Text style={s.timeBarValue}>
                          {well.bbls} BBL
                          <Text style={{ color: colors.text.muted, fontWeight: '400' }}> · {well.loads}x</Text>
                        </Text>
                      </View>
                      <View style={[s.timeBarTrack, { backgroundColor: color + '26' }]}>
                        <View style={[s.timeBarFill, { width: `${pct}%`, backgroundColor: color }]} />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* ── JSA card ──────────────────────────────────────── */}
            {jsaStatus && (
              <View style={s.timeSection}>
                <View style={s.cardHeader}>
                  <Text style={s.sectionTitle}>
                    <MaterialCommunityIcons
                      name={jsaStatus.completed ? 'shield-check' : 'shield-alert'}
                      size={14}
                      color={jsaStatus.completed ? '#22c55e' : '#f59e0b'}
                    />  JSA
                  </Text>
                  <Text style={[s.cardTotal, { color: jsaStatus.completed ? '#22c55e' : '#f59e0b' }]}>
                    {jsaStatus.completed ? 'Completed' : 'Pending'}
                  </Text>
                </View>
                {jsaStatus.completed && jsaStatus.completedAt && (
                  <View style={s.milesRow}>
                    <View style={s.milesStat}>
                      <Text style={s.milesValue}>{formatTime12h(jsaStatus.completedAt)}</Text>
                      <Text style={s.milesLabel}>completed</Text>
                    </View>
                    <View style={s.milesStat}>
                      <Text style={s.milesValue}>{jsaStatus.wellCount}</Text>
                      <Text style={s.milesLabel}>locations</Text>
                    </View>
                  </View>
                )}
                {jsaStatus.completed && jsaStatus.pdfUrl ? (
                  <Pressable
                    onPress={() => {
                      import('expo-linking').then(({ default: Linking }) => {
                        Linking.openURL(jsaStatus.pdfUrl!).catch(() => {});
                      });
                    }}
                    style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  >
                    <MaterialCommunityIcons name="file-pdf-box" size={18} color="#ef4444" />
                    <Text style={{ color: colors.brand.accent, fontSize: 13, fontWeight: '600' }}>View PDF</Text>
                  </Pressable>
                ) : !jsaStatus.completed ? (
                  <Pressable
                    onPress={() => {
                      import('expo-linking').then(({ default: Linking }) => {
                        Linking.openURL('jsaapp://start').catch(() => {});
                      });
                    }}
                    style={{
                      marginTop: 8, backgroundColor: '#f59e0b', borderRadius: 8,
                      padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    <MaterialCommunityIcons name="shield-edit-outline" size={18} color="#000" />
                    <Text style={{ color: '#000', fontSize: 13, fontWeight: '700' }}>Complete JSA Now</Text>
                  </Pressable>
                ) : null}
              </View>
            )}

            {/* ── Miles card ─────────────────────────────────────── */}
            {summary.driveMiles > 0 && (
              <View style={s.timeSection}>
                <View style={s.cardHeader}>
                  <Text style={s.sectionTitle}><MaterialCommunityIcons name="map-marker-distance" size={14} color={colors.text.secondary} />  MILES</Text>
                  <Text style={s.cardTotal}>{summary.driveMiles} mi</Text>
                </View>
                {summary.avgSpeedMph > 0 && (
                  <View style={s.milesRow}>
                    <View style={s.milesStat}>
                      <Text style={s.milesValue}>{summary.avgSpeedMph}</Text>
                      <Text style={s.milesLabel}>mph avg</Text>
                    </View>
                    {summary.driveMinutes > 0 && (
                      <View style={s.milesStat}>
                        <Text style={s.milesValue}>{formatDuration(summary.driveMinutes)}</Text>
                        <Text style={s.milesLabel}>drive time</Text>
                      </View>
                    )}
                    {summary.totalLoads > 0 && (
                      <View style={s.milesStat}>
                        <Text style={s.milesValue}>{Math.round(summary.driveMiles / summary.totalLoads * 10) / 10}</Text>
                        <Text style={s.milesLabel}>mi/load</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            )}

            {summary.totalLoads === 0 && (
              <View style={s.emptyState}>
                <Text style={s.emptyText}>{t('daySummary.noLoads')}</Text>
              </View>
            )}
          </>
        ) : (
          <View style={s.emptyState}>
            <Text style={s.emptyText}>{t('daySummary.error')}</Text>
          </View>
        )}
      </ScrollView>

      {/* Fixed Bottom Buttons */}
      <View style={s.bottomButtons}>
        <Pressable style={s.closeButton} onPress={handleClose}>
          <MaterialCommunityIcons name="check-circle-outline" size={20} color={colors.text.primary} />
          <Text style={s.closeButtonText}>{t('common.close')}</Text>
        </Pressable>
        <Pressable style={[s.logoutButton, !jsaGateLoaded && { opacity: 0.4 }]} onPress={handleLogout} disabled={!jsaGateLoaded}>
          <MaterialCommunityIcons name="logout" size={20} color="#EF4444" />
          <Text style={s.logoutButtonText}>{t('daySummary.logOut')}</Text>
        </Pressable>
      </View>

      {/* JSA shift-end gate modal — same Read / Ack / Cancel UI as WB T */}
      <JsaCloseModal
        visible={showJsaModal}
        allowAcknowledge={jsaAllowAcknowledge}
        busy={jsaAcknowledging}
        accent={colors.brand.accent}
        onAcknowledge={handleJsaAcknowledge}
        onRead={handleJsaRead}
        onCancel={handleJsaCancel}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 100,
  },
  header: {
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 32,
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(52, 211, 153, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 4,
  },
  timeRange: {
    fontSize: 16,
    color: colors.text.secondary,
  },
  loadingContainer: {
    alignItems: 'center',
    marginTop: 60,
  },
  loadingText: {
    color: colors.text.muted,
    marginTop: 12,
    fontSize: 14,
  },
  // ── Card header (title left, total right) ────────
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
  },
  // ── Miles card stats row ────────────────────────
  milesRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 4,
  },
  milesStat: {
    alignItems: 'center',
  },
  milesValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text.primary,
  },
  milesLabel: {
    fontSize: 11,
    color: colors.text.muted,
    marginTop: 2,
  },

  // ── Time breakdown section ──────────────────────
  timeSection: {
    marginBottom: 28,
    backgroundColor: colors.bg.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  timeBarRow: {
    marginBottom: 12,
  },
  timeBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  timeBarLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  timeBarValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.primary,
  },
  timeBarTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  timeBarFill: {
    height: 8,
    borderRadius: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 40,
  },
  emptyText: {
    color: colors.text.muted,
    fontSize: 15,
  },
  bottomButtons: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    paddingBottom: 36,
    backgroundColor: colors.bg.primary,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  closeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.bg.card,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  closeButtonText: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  logoutButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  logoutButtonText: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: '600',
  },
});
