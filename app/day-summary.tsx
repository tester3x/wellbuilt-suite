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
const DEV_TEST = true; // 🔴 REMOVE BEFORE PRODUCTION
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
    locationCount: number;
  } | null>(null);
  const [jsaGateShiftEnd, setJsaGateShiftEnd] = useState(false);

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
      return;
    }
    if (!user) return;
    (async () => {
      try {
        // WB T writes legalName as the invoice driver field (falls back to displayName).
        // Query with the same preference so Day Summary finds the right invoices.
        const driverName = user.legalName || user.displayName;
        const [invoices, shift] = await Promise.all([
          fetchTodayInvoices(driverName, user.companyId),
          fetchTodayShift(user.driverId),
        ]);
        const result = calculateDaySummary(invoices, shift?.events || [], shift?.odometerMiles);
        setSummary(result);
      } catch (err) {
        console.warn('[DaySummary] Failed to load data:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  // Fetch JSA day status + determine if gate applies
  useEffect(() => {
    if (!user?.driverId) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    const docId = `${user.driverId}_${todayStr}`;
    const API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';
    const BASE = 'https://firestore.googleapis.com/v1/projects/wellbuilt-sync/databases/(default)/documents';
    (async () => {
      // Fetch JSA day status
      try {
        const resp = await fetch(`${BASE}/jsa_day_status/${docId}?key=${API_KEY}`);
        if (!resp.ok) {
          setJsaStatus({ completed: false, completedAt: null, pdfUrl: null, locationCount: 0 });
        } else {
          const doc = await resp.json();
          const f = doc.fields;
          const locs = f?.locations?.arrayValue?.values;
          setJsaStatus({
            completed: f?.jsaCompleted?.booleanValue === true,
            completedAt: f?.jsaCompletedAt?.timestampValue || null,
            pdfUrl: f?.pdfUrl?.stringValue || null,
            locationCount: Array.isArray(locs) ? locs.length : 0,
          });
        }
      } catch {
        setJsaStatus({ completed: false, completedAt: null, pdfUrl: null, locationCount: 0 });
      }

      // Read jsaMode from company config to determine gate behavior
      // per_shift and per_location gate shift end; per_load and off do not
      if (user.companyId) {
        try {
          const resp = await fetch(`${BASE}/companies/${user.companyId}?key=${API_KEY}`);
          if (resp.ok) {
            const doc = await resp.json();
            const mode = doc.fields?.jsaMode?.stringValue || 'off';
            setJsaGateShiftEnd(mode === 'per_shift' || mode === 'per_location');
          }
        } catch {}
      }
    })();
  }, [user?.driverId, user?.companyId]);

  const handleClose = () => {
    // Close = dismiss summary, stay logged in. No cascade logout.
    // Logout cascade only happens on explicit "Log Out" button.
    router.replace('/home');
  };

  const handleLogout = () => {
    // JSA gate: only block logout if rule.gateShiftEnd (per_shift, per_location)
    if (jsaGateShiftEnd && jsaStatus && !jsaStatus.completed) {
      Alert.alert(
        'JSA Required',
        'You must complete your Job Safety Analysis before ending your shift.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Complete JSA Now',
            onPress: () => {
              import('expo-linking').then(({ default: Linking }) => {
                Linking.openURL('jsaapp://start').catch(() => {});
              });
            },
          },
        ],
      );
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
                      <Text style={s.milesValue}>{jsaStatus.locationCount}</Text>
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
        <Pressable style={s.logoutButton} onPress={handleLogout}>
          <MaterialCommunityIcons name="logout" size={20} color="#EF4444" />
          <Text style={s.logoutButtonText}>{t('daySummary.logOut')}</Text>
        </Pressable>
      </View>
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
