// app/day-summary.tsx — End-of-day shift summary screen
// Shown after driver taps "Arrived" at yard. Displays daily stats with
// Close as the only action. Log Out moved to the WB S home screen so
// there is a single, awaited logout path (no Day Summary / Settings
// divergence). Driver taps Close → home → Log Out.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/context/AuthContext';
import { colors } from '@/core/theme';
import {
  fetchCompletedLoads,
  invoiceQueryWindow,
  originDateFromPeriodId,
  fetchTodayShift,
  fetchShiftDocForDate,
  firestoreRestHeaders,
  resolveShiftSummaryDate,
  calculateDaySummary,
  type DaySummary,
} from '@/core/services/daySummary';
import {jsaDisplayReference} from '@/core/services/jsaDisplayReference';
import {loadShiftJsaSummary} from '@/core/services/shiftJsaSummaryClient';
import type {ShiftJsaSummary} from '@/core/services/shiftJsaSummaryCore';
import { getCurrentShiftId, getCurrentShiftOriginDate } from '@/core/services/shiftTracking';
import { originDateFromShiftId } from '@/core/services/workPeriodAuthority/postLoginShiftRestoration';
import type { ShiftDvirSummary } from '@/core/services/dvirGate';
import {
  hydrateShiftDvirSummaryIfMissing,
  loadLastFinalizedDvirSummary,
  overallDvirLabel,
} from '@/core/services/dvirGate';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadVehicleInfo } from '@/core/services/driverProfile';

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
    shiftStartSource: 'event',
    shiftEndSource: 'event',
  };
}

export default function DaySummaryScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [jsaEvidenceState,setJsaEvidence]=useState<ShiftJsaSummary|null>(null);
  const jsaEvidence=jsaEvidenceState?.driverId===user?.driverId&&jsaEvidenceState?.companyId===user?.companyId?jsaEvidenceState:null;
  const [jsaCheck,setJsaCheck]=useState<'checking'|'ready'|'unavailable'>('checking');
  const [jsaScope,setJsaScope]=useState<{driverId:string;companyId:string;shiftId:string|null}|undefined>(undefined);
  const [jsaRetry,setJsaRetry]=useState(0);
  const [jsaMode,setJsaMode]=useState<string>('off');
  /** True when the origin-day shift document could not be read at all. */
  const [shiftRecordMissing, setShiftRecordMissing] = useState(false);
  /** True when the invoice query failed — distinct from a genuinely empty shift. */
  const [loadsUnavailable, setLoadsUnavailable] = useState(false);
  const [dvirSummary, setDvirSummary] = useState<ShiftDvirSummary | null>(null);

  // Android back button: go to WB S home, not back to WB T
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      router.replace('/home');
      return true; // Prevent default back behavior
    });
    return () => backHandler.remove();
  }, [router]);

  // Load durable DVIR summary for this shift (receipt-based; survives reopen).
  // Cold upgrade: if receipts exist but shiftSummary was never written
  // (finalized before suite-dvir-summary), hydrate from receipts once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const kv = {
          getItem: (k: string) => AsyncStorage.getItem(k),
          setItem: (k: string, v: string) => AsyncStorage.setItem(k, v),
          removeItem: (k: string) => AsyncStorage.removeItem(k),
        };
        const shiftId = await getCurrentShiftId();
        let loaded: ShiftDvirSummary | null = null;
        if (shiftId) {
          let truck: string | null = null;
          let trailer: string | null = null;
          if (user?.passcodeHash) {
            try {
              const v = await loadVehicleInfo(user.passcodeHash);
              truck = v.truckNumber || null;
              trailer = v.trailerNumber || null;
            } catch {
              /* optional identity */
            }
          }
          loaded = await hydrateShiftDvirSummaryIfMissing(kv, shiftId, {
            truckUnit: truck,
            trailerUnit: trailer,
          });
        }
        if (!loaded) {
          loaded = await loadLastFinalizedDvirSummary(kv);
          // Only show last summary if it matches current shift scope
          if (loaded && shiftId && loaded.shiftId !== shiftId) {
            loaded = null;
          }
        }
        if (!cancelled) setDvirSummary(loaded);
      } catch {
        if (!cancelled) setDvirSummary(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    // 🔴 DEBUG: Auto-load mock data when DEV_TEST is on
    if (DEV_TEST) {
      setSummary(randomMockSummary());
      setLoading(false);
      setJsaCheck('ready');
      return;
    }
    if (!user) {setJsaEvidence(null);setSummary(null);setLoading(false);return;}
    const API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';
    const BASE = 'https://firestore.googleapis.com/v1/projects/wellbuilt-sync/databases/(default)/documents';

    let active=true;
    setLoading(true);setJsaEvidence(null);setJsaCheck('checking');setJsaScope(undefined);
    // A finalized DVIR receipt retains the exact shift after active storage is
    // cleared. No current-date substitution for JSA, including after midnight.
    const scopeP=(async()=>{
      const current=await getCurrentShiftId();if(current)return current;
      const last=await loadLastFinalizedDvirSummary({getItem:k=>AsyncStorage.getItem(k),setItem:(k,v)=>AsyncStorage.setItem(k,v),removeItem:k=>AsyncStorage.removeItem(k)});
      return last?.shiftId||null;
    })().catch(()=>null);

    // Work statistics load independently of the JSA callable.
    // Join by stable driverId (not the display name — WB-T stores the canonical
    // driver name on invoices, WB-S has the login alias). driverName is still
    // used for other UI below.
    // Query the window of the SHIFT, in correct UTC. The old call derived a
    // local calendar date and stamped it 'Z', so evening loads (and anything on
    // the far side of midnight) fell outside the window and the screen said
    // "No completed loads today" for a shift full of real closed loads.
    const invoicesP = scopeP
      .then(async pid => invoiceQueryWindow(
        (await getCurrentShiftOriginDate()) || originDateFromPeriodId(pid),
      ))
      .catch(() => invoiceQueryWindow(null))
      // Pass BOTH stable identity values: other WB apps are launched with
      // passcodeHash as the driver `hash`, so an invoice may be stamped with
      // either. Matching is done client-side against all of them.
      .then(window => fetchCompletedLoads({
        identity: { driverId: user.driverId, passcodeHash: user.passcodeHash },
        companyId: user.companyId,
        window,
      }))
      .catch(() => ({ ok: false, reason: 'query_error' } as const));
    // Explicit shifts store login/depart_return/logout/odometer on the ORIGIN-day
    // document (frozen at claim), not "calendar today" after a cross-midnight close.
    const shiftP = (async () => {
      try {
        const periodId = await scopeP;
        const origin = (await getCurrentShiftOriginDate()) || originDateFromShiftId(periodId);
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const day = resolveShiftSummaryDate({
          originLocalDate: origin,
          periodId,
          todayLocalDate: today,
        });
        // Prefer origin-day document for explicit periods (cross-midnight safe).
        const doc = await fetchShiftDocForDate(user.driverId, day).catch(() => null);
        if (doc) return doc;
        if (day !== today) {
          return fetchTodayShift(user.driverId).catch(() => null);
        }
        return null;
      } catch {
        return fetchTodayShift(user.driverId).catch(() => null);
      }
    })();
    void Promise.all([shiftP,scopeP]).then(([shift,hint])=>{
      // Prefer the actual bookend shown by this summary when a day has several shifts.
      const login=[...(shift?.events||[])].reverse().find(e=>e.type==='login');
      const shiftId=login?.shiftId||hint;
      if(active)setJsaScope({driverId:user.driverId,companyId:user.companyId||'',shiftId});
    }).catch(()=>{if(active)setJsaCheck('unavailable');});
    const companyP = user.companyId
      ? firestoreRestHeaders().then(headers => fetch(`${BASE}/companies/${user.companyId}?key=${API_KEY}`, { headers }))
          .then(r => r.ok ? r.json() : null).catch(() => null)
      : Promise.resolve(null);

    Promise.all([invoicesP, shiftP, companyP]).then(([invoiceResult, shift, companyDoc]) => {
      if(!active)return;
      // A failed query is "unavailable", never zero completed loads.
      const invoices = invoiceResult.ok ? invoiceResult.invoices : [];
      setLoadsUnavailable(!invoiceResult.ok);
      // Summary data
      const result = calculateDaySummary(invoices, shift?.events || [], shift?.odometerMiles);
      // Distinguish "no shift record could be read" from "the record has no
      // bookends": the first is a fault worth showing, the second is a fact.
      setShiftRecordMissing(!shift);
      setSummary(result);

      setJsaMode(companyDoc?.fields?.jsaMode?.stringValue || (companyDoc?'off':'unknown'));
      setLoading(false);
    }).catch(() => {if(active)setLoading(false);});
    return ()=>{active=false;};
  }, [user]);

  useEffect(()=>{
    if(jsaScope===undefined||!user||jsaScope.driverId!==user.driverId||jsaScope.companyId!==user.companyId)return;
    let active=true;
    setJsaEvidence(null);setJsaCheck('checking');
    if(!user.companyId){setJsaCheck('unavailable');return;}
    void loadShiftJsaSummary({driverId:user.driverId,companyId:user.companyId},jsaScope.shiftId)
      .then(evidence=>{if(active){setJsaEvidence(evidence);setJsaCheck('ready');}})
      .catch(()=>{if(active){setJsaEvidence(null);setJsaCheck('unavailable');}});
    return ()=>{active=false;};
  },[user,jsaScope,jsaRetry]);

  const handleClose = () => {
    // Close = dismiss summary, stay logged in. No cascade logout.
    // Logout cascade only happens on explicit "Log Out" button.
    router.replace('/home');
  };

  const jsaRecorded=!!jsaEvidence?.fullReadCount;
  const jsaTone=jsaEvidence?.status==='recorded'?'#22c55e':colors.text.secondary;
  const showJsa=jsaMode!=='off'||jsaRecorded||!!jsaEvidence?.issues||jsaCheck!=='ready';
  const timeRange = summary
    ? (summary.shiftStart || summary.shiftEnd
        ? `${formatTime12h(summary.shiftStart)} – ${formatTime12h(summary.shiftEnd)}`
        : shiftRecordMissing
          ? 'Shift times unavailable'
          : 'Shift times not recorded')
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
            {summary.totalLoads > 0 && (
              <View style={s.timeSection}>
                <View style={s.cardHeader}>
                  <Text style={s.sectionTitle}><MaterialCommunityIcons name="oil" size={14} color={colors.text.secondary} />  LOADS</Text>
                  <Text style={s.cardTotal}>
                    {summary.totalLoads} loads · {Math.round(summary.totalBBL)} BBL
                  </Text>
                </View>
                {summary.wellStats.length === 0 ? (
                  <Text style={{ color: colors.text.secondary }}>Pickup names are unavailable for these loads.</Text>
                ) : summary.wellStats.map((well, idx) => {
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
            {showJsa && (
              <View style={s.timeSection}>
                <View style={s.cardHeader}>
                  <Text style={s.sectionTitle}><MaterialCommunityIcons name="shield-check" size={14} color={jsaTone}/>  JSA</Text>
                  <Text style={[s.cardTotal,{color:jsaTone}]}>{jsaCheck==='checking'?'Checking…':jsaCheck==='unavailable'?'Unavailable':jsaEvidence?.status==='recorded'?'Recorded':jsaEvidence?.status==='partial'?'Partly verified':'No evidence'}</Text>
                </View>
                {jsaCheck==='checking'?<ActivityIndicator color={colors.brand.accent}/>:jsaCheck==='unavailable'?(
                  <View><Text style={{color:colors.text.secondary}}>Could not verify this shift’s JSA records. This does not block shift end.</Text>
                    <Pressable accessibilityRole="button" onPress={()=>setJsaRetry(n=>n+1)} style={{paddingVertical:12}}><Text style={{color:colors.brand.accent,fontWeight:'600'}}>Retry JSA check</Text></Pressable>
                  </View>
                ):<>
                  <Text style={{color:jsaTone,fontSize:14,fontWeight:'600',marginBottom:12}}>
                    {jsaRecorded?'Signed JSA read recorded for this shift.':jsaEvidence?.status==='no_shift'?'No shift could be selected.':'No verified signed read found for this shift.'}
                  </Text>
                  {!!jsaEvidence&&<View style={s.milesRow}>
                    <View style={s.milesStat}><Text style={s.milesValue}>{jsaEvidence.fullReadCount}</Text><Text style={s.milesLabel}>full reads</Text></View>
                    <View style={s.milesStat}><Text style={s.milesValue}>{jsaEvidence.acknowledgementCount}</Text><Text style={s.milesLabel}>acknowledgements</Text></View>
                    <View style={s.milesStat}><Text style={s.milesValue}>{jsaEvidence.jobCount}</Text><Text style={s.milesLabel}>jobs with evidence</Text></View>
                  </View>}
                  {!!jsaEvidence?.coveredJobCount&&<Text style={{color:colors.text.secondary,marginTop:10}}>{jsaEvidence.coveredJobCount} jobs covered by the shift read</Text>}
                  {!!jsaEvidence?.firstReadAt&&<Text style={{color:colors.text.secondary,marginTop:10}}>First signed read: {formatTime12h(jsaEvidence.firstReadAt)}</Text>}
                  {!!jsaEvidence?.jsaNumbers.length&&<Text style={{color:colors.text.secondary,marginTop:10}}>JSA numbers: {jsaEvidence.jsaNumbers.map(jsaDisplayReference).join(' · ')}</Text>}
                  {jsaEvidence?.lifecycle==='finalized'&&<Text style={{color:colors.text.secondary,marginTop:10}}>Shift JSA finalized</Text>}
                  {jsaEvidence?.status==='partial'&&<Text style={{color:colors.text.secondary,marginTop:10}}>Some records could not be verified. Counts include verified evidence only.</Text>}
                </>}
              </View>
            )}

            {/* ── DVIR card (Wells → JSA → DVIR → Miles) ─────────── */}
            <View style={s.timeSection}>
              <View style={s.cardHeader}>
                <Text style={s.sectionTitle}>
                  <MaterialCommunityIcons
                    name="clipboard-check-outline"
                    size={14}
                    color={
                      dvirSummary?.overallStatus === 'completed' ||
                      dvirSummary?.overallStatus === 'post_trip_completed'
                        ? '#22c55e'
                        : colors.text.secondary
                    }
                  />{' '}
                  DVIR
                </Text>
                <Text
                  style={[
                    s.cardTotal,
                    {
                      color:
                        dvirSummary?.overallStatus === 'completed'
                          ? '#22c55e'
                          : dvirSummary?.overallStatus === 'post_trip_completed'
                            ? '#22c55e'
                            : dvirSummary
                              ? '#f59e0b'
                              : colors.text.muted,
                    },
                  ]}
                >
                  {dvirSummary
                    ? overallDvirLabel(dvirSummary.overallStatus)
                    : 'Not available'}
                </Text>
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                {/* PRE-TRIP */}
                <View style={s.dvirPhaseCol}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialCommunityIcons
                      name={
                        dvirSummary?.preTrip.status === 'captured'
                          ? 'check-circle'
                          : dvirSummary?.preTrip.status === 'not_captured'
                            ? 'alert-circle'
                            : 'help-circle-outline'
                      }
                      size={20}
                      color={
                        dvirSummary?.preTrip.status === 'captured'
                          ? '#22c55e'
                          : dvirSummary?.preTrip.status === 'not_captured'
                            ? '#f59e0b'
                            : colors.text.muted
                      }
                    />
                    <Text style={s.dvirPhaseTitle}>PRE-TRIP</Text>
                  </View>
                  <Text
                    style={[
                      s.dvirPhaseTime,
                      {
                        color:
                          dvirSummary?.preTrip.status === 'captured'
                            ? '#22c55e'
                            : dvirSummary?.preTrip.status === 'not_captured'
                              ? '#f59e0b'
                              : colors.text.muted,
                      },
                    ]}
                  >
                    {dvirSummary?.preTrip.status === 'captured' && dvirSummary.preTrip.completedAt
                      ? formatTime12h(dvirSummary.preTrip.completedAt)
                      : dvirSummary?.preTrip.status === 'not_captured'
                        ? 'Not captured'
                        : dvirSummary
                          ? 'Not available'
                          : 'Not available'}
                  </Text>
                </View>

                {/* POST-TRIP */}
                <View style={s.dvirPhaseCol}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialCommunityIcons
                      name={
                        dvirSummary?.postTrip.status === 'completed'
                          ? 'check-circle'
                          : 'help-circle-outline'
                      }
                      size={20}
                      color={
                        dvirSummary?.postTrip.status === 'completed'
                          ? '#22c55e'
                          : colors.text.muted
                      }
                    />
                    <Text style={s.dvirPhaseTitle}>POST-TRIP</Text>
                  </View>
                  <Text
                    style={[
                      s.dvirPhaseTime,
                      {
                        color:
                          dvirSummary?.postTrip.status === 'completed'
                            ? '#22c55e'
                            : colors.text.muted,
                      },
                    ]}
                  >
                    {dvirSummary?.postTrip.status === 'completed' &&
                    dvirSummary.postTrip.completedAt
                      ? formatTime12h(dvirSummary.postTrip.completedAt)
                      : 'Not available'}
                  </Text>
                </View>
              </View>

              {(dvirSummary?.truckUnit || dvirSummary?.trailerUnit) && (
                <Text style={s.dvirFooter}>
                  {[
                    dvirSummary.truckUnit ? `Truck ${dvirSummary.truckUnit}` : null,
                    dvirSummary.trailerUnit ? `Trailer ${dvirSummary.trailerUnit}` : null,
                  ]
                    .filter(Boolean)
                    .join('  ·  ')}
                </Text>
              )}
            </View>

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
                {/* A failed query must not read as "you hauled nothing". */}
                <Text style={s.emptyText}>
                  {loadsUnavailable
                    ? 'Completed loads unavailable — could not read your load records.'
                    : t('daySummary.noLoads')}
                </Text>
              </View>
            )}
          </>
        ) : (
          <View style={s.emptyState}>
            <Text style={s.emptyText}>{t('daySummary.error')}</Text>
          </View>
        )}
      </ScrollView>

      {/* Fixed Bottom Button — Close only. Log Out lives on the WB S home
          screen now (single source of truth for the logout cascade). The
          JSA shift-end gate that previously fired here will be re-attached
          to the home-screen Log Out button in a follow-up. */}
      <View style={s.bottomButtons}>
        <Pressable style={s.closeButtonFull} onPress={handleClose}>
          <MaterialCommunityIcons name="check-circle-outline" size={20} color={colors.text.primary} />
          <Text style={s.closeButtonText}>{t('common.close')}</Text>
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
  dvirPhaseCol: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: 12,
  },
  dvirPhaseTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text.secondary,
    letterSpacing: 0.4,
  },
  dvirPhaseTime: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
  },
  dvirFooter: {
    marginTop: 12,
    fontSize: 12,
    color: colors.text.muted,
    fontWeight: '500',
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
  closeButtonFull: {
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
});
