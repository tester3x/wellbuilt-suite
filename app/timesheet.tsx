// app/timesheet.tsx — Driver payroll view with paper-style invoice detail
// Basic payroll summary matching Dashboard Payroll data.
// Tapping an invoice row opens the full WB T-style paper invoice detail.

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Platform,
  StatusBar,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '@/core/context/AuthContext';
import { colors, spacing, radius } from '@/core/theme';
import {
  type TimesheetSummary,
  type TimesheetRow,
  type PeriodType,
  type InvoiceDetail,
  type TicketDetail,
  getPeriodDates,
  fetchDriverInvoices,
  fetchPayConfig,
  buildTimesheetSummary,
  buildWellCountyMap,
  fetchInvoiceDetail,
  fetchTicketDetails,
} from '@/core/services/payroll';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const ANDROID_TOP = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0;

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return '$' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function statusColor(status: string): string {
  switch (status) {
    case 'closed': case 'submitted': case 'approved': case 'paid':
      return colors.status.online;
    case 'open':
      return colors.status.warning;
    default:
      return colors.text.muted;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'closed': return 'Closed';
    case 'submitted': return 'Submitted';
    case 'approved': return 'Approved';
    case 'paid': return 'Paid';
    case 'open': return 'In Progress';
    default: return status;
  }
}

function paperStatusColor(status: string): string {
  switch (status) {
    case 'open': return colors.brand.primary;
    case 'closed': return '#888';
    case 'submitted': return '#4fc3f7';
    case 'approved': case 'paid': return '#66bb6a';
    case 'void': return '#ef4444';
    default: return '#555';
  }
}

/** Format ISO timestamp to readable 12hr time. */
function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    let h = d.getHours();
    const m = d.getMinutes();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m < 10 ? '0' : ''}${m} ${ap}`;
  } catch { return iso; }
}

/** Context-aware timeline label (same ping-pong logic as WB T receipt builder). */
function getTimelineLabel(
  event: { type: string },
  arriveCount: number,
  departSiteCount: number,
): string {
  switch (event.type) {
    case 'depart':
      return arriveCount === 0 ? 'Start / Departed' : 'Departed';
    case 'arrive':
      return arriveCount % 2 === 1 ? 'Pickup Arrival' : 'Drop-off Arrival';
    case 'depart_site':
      return departSiteCount % 2 === 1 ? 'Loaded / Departure' : 'Unloaded / Departure';
    case 'close': return 'Job Closed';
    case 'pause': return 'Paused';
    case 'resume': return 'Resumed';
    case 'transfer': return 'Transferred';
    case 'reroute': return 'Rerouted';
    default: return event.type;
  }
}

const PERIODS: { type: PeriodType; label: string; icon: string }[] = [
  { type: 'today', label: 'Today', icon: 'calendar-today' },
  { type: 'this-week', label: 'This Week', icon: 'calendar-week' },
  { type: 'last-week', label: 'Last Week', icon: 'calendar-arrow-left' },
  { type: 'biweekly', label: '2 Weeks', icon: 'calendar-range' },
];

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, icon }: {
  label: string;
  value: string;
  color: string;
  icon: string;
}) {
  return (
    <View style={s.statCard}>
      <MaterialCommunityIcons name={icon as any} size={18} color={color} />
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Paper-Style Invoice Detail Modal ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function InvoiceDetailModal({
  visible,
  invoice,
  tickets,
  loadingTickets,
  onClose,
}: {
  visible: boolean;
  invoice: InvoiceDetail | null;
  tickets: TicketDetail[];
  loadingTickets: boolean;
  onClose: () => void;
}) {
  if (!invoice) return null;

  const sColor = paperStatusColor(invoice.status);

  // Build labeled timeline
  let arriveCount = 0;
  let departSiteCount = 0;
  const labeledTimeline = (invoice.timeline || []).map((ev) => {
    if (ev.type === 'arrive') arriveCount++;
    if (ev.type === 'depart_site') departSiteCount++;
    return { ...ev, label: getTimelineLabel(ev, arriveCount, departSiteCount) };
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[p.modalBg, { paddingTop: ANDROID_TOP }]}>
        {/* Header bar */}
        <View style={p.modalHeader}>
          <Pressable onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <MaterialCommunityIcons name="chevron-left" size={26} color={colors.brand.primary} />
          </Pressable>
          <Text style={p.modalTitle}>Invoice Detail</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView style={p.scroll} contentContainerStyle={p.scrollContent} showsVerticalScrollIndicator={false}>
          {/* ─── THE PAPER ─── */}
          <View style={p.page}>

            {/* ─── Invoice Header ─── */}
            <View style={p.sectionHeader}>
              <Text style={p.invoiceTitle}>INVOICE</Text>
              <View style={[p.statusPill, { backgroundColor: sColor + '22', borderColor: sColor }]}>
                <Text style={[p.statusPillText, { color: sColor }]}>{invoice.status.toUpperCase()}</Text>
              </View>
            </View>

            <PaperRow label="Invoice #" value={invoice.invoiceNumber} mono />
            <PaperRow label="Date" value={invoice.date} />
            {invoice.commodityType ? <PaperRow label="Type" value={invoice.commodityType} /> : null}

            <View style={p.divider} />

            {/* ─── Job Details ─── */}
            <Text style={p.sectionTitle}>JOB DETAILS</Text>
            <PaperRow label="Operator" value={invoice.operator || '—'} />
            <PaperRow label="Well / Location" value={invoice.wellName || '—'} />
            {invoice.hauledTo ? <PaperRow label="Drop-off" value={invoice.hauledTo} /> : null}
            {invoice.state ? <PaperRow label="State" value={invoice.state} /> : null}

            <View style={p.divider} />

            {/* ─── Driver & Vehicle ─── */}
            <Text style={p.sectionTitle}>DRIVER & VEHICLE</Text>
            <PaperRow label="Driver" value={invoice.driver || '—'} />
            {invoice.truckNumber ? <PaperRow label="Truck #" value={invoice.truckNumber} /> : null}
            {invoice.trailer ? <PaperRow label="Trailer #" value={invoice.trailer} /> : null}

            {/* ─── Time ─── */}
            {(invoice.startTime || invoice.stopTime) && (
              <>
                <View style={p.divider} />
                <Text style={p.sectionTitle}>TIME</Text>
                {invoice.startTime ? <PaperRow label="Start" value={invoice.startTime} /> : null}
                {invoice.stopTime ? <PaperRow label="Stop" value={invoice.stopTime} /> : null}
              </>
            )}

            <View style={p.divider} />

            {/* ─── Water Tickets ─── */}
            <Text style={p.sectionTitle}>WATER TICKETS</Text>

            {loadingTickets ? (
              <ActivityIndicator size="small" color={colors.brand.primary} style={{ paddingVertical: 20 }} />
            ) : tickets.length === 0 ? (
              <Text style={p.noData}>No water tickets found</Text>
            ) : (
              tickets.map((tk) => (
                <View key={tk.docId} style={p.ticket}>
                  {/* Ticket header */}
                  <View style={p.ticketHeader}>
                    <Text style={[p.ticketTitle, { color: colors.brand.primary }]}>WATER TICKET</Text>
                    <Text style={[p.ticketNum, p.mono]}>#{tk.ticketNumber}</Text>
                  </View>

                  <View style={p.ticketDivider} />

                  {/* Ticket body */}
                  {tk.company ? <TicketRow label="Operator" value={tk.company} /> : null}
                  <TicketRow label="Pickup" value={tk.location || '—'} />
                  {tk.hauledTo ? <TicketRow label="Drop-off" value={tk.hauledTo} /> : null}
                  <TicketRow label="Date" value={tk.date || '—'} />
                  {tk.timeGauged ? <TicketRow label="Time Gauged" value={tk.timeGauged} /> : null}

                  {/* Measurements row */}
                  <View style={p.ticketMeasurements}>
                    <MeasureBox label="TYPE" value={tk.type || '—'} />
                    <MeasureBox label="QTY (BBL)" value={tk.qty || '—'} mono />
                    {tk.top ? <MeasureBox label="TOP" value={tk.top} mono /> : null}
                    {tk.bottom ? <MeasureBox label="BOTTOM" value={tk.bottom} mono /> : null}
                  </View>

                  {/* Legal info (smaller) */}
                  {(tk.apiNo || tk.county || tk.legalDesc) && (
                    <View style={p.ticketLegal}>
                      {tk.apiNo ? <Text style={p.legalText}>API# {tk.apiNo}</Text> : null}
                      {tk.county ? <Text style={p.legalText}>County: {tk.county}</Text> : null}
                      {tk.legalDesc ? <Text style={p.legalText}>Legal: {tk.legalDesc}</Text> : null}
                      {tk.gpsLat && tk.gpsLng ? (
                        <Text style={p.legalText}>GPS: {tk.gpsLat}, {tk.gpsLng}</Text>
                      ) : null}
                    </View>
                  )}

                  {/* Hours (service work) */}
                  {(tk.startTime || tk.stopTime || tk.hours) && (
                    <View style={p.ticketTimeRow}>
                      {tk.startTime ? <Text style={p.ticketTimeText}>Start: {tk.startTime}</Text> : null}
                      {tk.stopTime ? <Text style={p.ticketTimeText}>Stop: {tk.stopTime}</Text> : null}
                      {tk.hours ? <Text style={p.ticketTimeText}>Hours: {tk.hours}</Text> : null}
                    </View>
                  )}

                  {/* Notes */}
                  {tk.notes ? (
                    <View style={p.ticketNotes}>
                      <Text style={p.ticketNotesLabel}>Notes</Text>
                      <Text style={p.ticketNotesText}>{tk.notes}</Text>
                    </View>
                  ) : null}
                </View>
              ))
            )}

            {/* ─── Job Timeline ─── */}
            {labeledTimeline.length > 0 && (
              <>
                <View style={p.divider} />
                <Text style={p.sectionTitle}>JOB TIMELINE</Text>
                {labeledTimeline.map((ev, i) => (
                  <View key={i} style={p.timelineRow}>
                    <View style={p.timelineDot} />
                    {i < labeledTimeline.length - 1 && <View style={p.timelineLine} />}
                    <Text style={[p.timelineTime, p.mono]}>{fmtTime(ev.timestamp)}</Text>
                    <View style={p.timelineLabelWrap}>
                      <Text style={p.timelineLabel}>{ev.label}</Text>
                      {ev.locationName ? (
                        <Text style={p.timelineLocation}>{ev.locationName}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </>
            )}

            {/* ─── Notes ─── */}
            {invoice.notes ? (
              <>
                <View style={p.divider} />
                <Text style={p.sectionTitle}>REMARKS</Text>
                <Text style={p.notesText}>{invoice.notes}</Text>
              </>
            ) : null}

            {/* ─── Totals ─── */}
            <View style={p.totalsDivider} />
            <View style={p.totalsSection}>
              <View style={p.totalsRow}>
                <Text style={p.totalsLabel}>Total BBL</Text>
                <Text style={[p.totalsValue, p.mono]}>{invoice.totalBBL || 0}</Text>
              </View>
              <View style={p.totalsRow}>
                <Text style={p.totalsLabel}>Total Hours</Text>
                <Text style={[p.totalsValue, p.mono]}>{invoice.totalHours || 0}</Text>
              </View>
              <View style={p.totalsRow}>
                <Text style={p.totalsLabel}>Tickets</Text>
                <Text style={[p.totalsValue, p.mono]}>{invoice.ticketCount}</Text>
              </View>
            </View>

            {/* ─── Footer ─── */}
            <View style={p.footer}>
              <Text style={p.footerText}>WellBuilt Tickets</Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// Small helpers for paper layout
function PaperRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={p.row}>
      <Text style={p.label}>{label}</Text>
      <Text style={[p.value, mono && p.mono]}>{value}</Text>
    </View>
  );
}

function TicketRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={p.ticketRow}>
      <Text style={p.ticketLabel}>{label}</Text>
      <Text style={p.ticketValue}>{value}</Text>
    </View>
  );
}

function MeasureBox({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={p.measureBox}>
      <Text style={p.measureLabel}>{label}</Text>
      <Text style={[p.measureValue, mono && p.mono]}>{value}</Text>
    </View>
  );
}

// ── Payroll Row ──────────────────────────────────────────────────────────────

function PayrollRow({ row, onTap }: {
  row: TimesheetRow;
  onTap: () => void;
}) {
  const sColor = statusColor(row.status);
  const rateLabel = row.rateMethod === 'per_bbl'
    ? `${formatCurrency(row.rate)}/bbl`
    : `${formatCurrency(row.rate)}/hr`;

  return (
    <Pressable onPress={onTap} style={s.payrollRow}>
      <View style={s.rowHeader}>
        <View style={s.rowLeft}>
          <View style={[s.statusDot, { backgroundColor: sColor }]} />
          <View style={{ flex: 1 }}>
            <Text style={s.rowDate}>{row.date}</Text>
            <Text style={s.rowInvoice}>#{row.invoiceNumber}</Text>
          </View>
        </View>
        <View style={s.rowRight}>
          <Text style={s.rowPay}>{formatCurrency(row.employeePay)}</Text>
          <MaterialCommunityIcons name="chevron-right" size={16} color={colors.text.muted} />
        </View>
      </View>

      {/* Mini detail strip */}
      <View style={s.miniDetail}>
        <Text style={s.miniText}>{row.operator}</Text>
        <Text style={s.miniDot}>·</Text>
        <Text style={s.miniText}>{rateLabel}</Text>
        {row.bbls > 0 && (
          <>
            <Text style={s.miniDot}>·</Text>
            <Text style={s.miniText}>{Math.round(row.bbls)} BBL</Text>
          </>
        )}
        {row.hours > 0 && (
          <>
            <Text style={s.miniDot}>·</Text>
            <Text style={s.miniText}>{row.hours.toFixed(1)}h</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function TimesheetScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('this-week');
  const [summary, setSummary] = useState<TimesheetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [noRateSheet, setNoRateSheet] = useState(false);

  // Invoice detail modal state
  const [detailInvoice, setDetailInvoice] = useState<InvoiceDetail | null>(null);
  const [detailTickets, setDetailTickets] = useState<TicketDetail[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const loadData = useCallback(async (showLoader = true) => {
    if (!user) return;
    if (showLoader) setLoading(true);

    try {
      const { start, end, label } = getPeriodDates(selectedPeriod);

      const [invoices, payConfig] = await Promise.all([
        fetchDriverInvoices(user.displayName, user.companyId, start, end),
        user.companyId ? fetchPayConfig(user.companyId) : Promise.resolve(null),
      ]);

      setNoRateSheet(!payConfig?.rateSheets || Object.keys(payConfig.rateSheets).length === 0);

      // Build well→county map from NDIC data for frost rate calculation
      const operators = [...new Set(invoices.map(i => i.operator).filter(Boolean))];
      const countyMap = operators.length > 0 ? await buildWellCountyMap(operators) : new Map();

      const result = buildTimesheetSummary(invoices, payConfig, label, start, end, countyMap);
      setSummary(result);
    } catch (err) {
      console.warn('[Timesheet] Failed to load:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, selectedPeriod]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData(false);
  }, [loadData]);

  // Open invoice detail modal
  const handleInvoiceTap = useCallback(async (row: TimesheetRow) => {
    setShowDetail(true);
    setLoadingDetail(true);
    setLoadingTickets(true);
    setDetailInvoice(null);
    setDetailTickets([]);

    try {
      const detail = await fetchInvoiceDetail(row.invoiceId);
      if (detail) {
        setDetailInvoice(detail);
        setLoadingDetail(false);

        // Load tickets
        if (detail.tickets.length > 0) {
          const tickets = await fetchTicketDetails(detail.tickets);
          setDetailTickets(tickets);
        }
      } else {
        setLoadingDetail(false);
      }
    } catch (err) {
      console.warn('[Timesheet] Failed to load detail:', err);
      setLoadingDetail(false);
    }
    setLoadingTickets(false);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setShowDetail(false);
    setDetailInvoice(null);
    setDetailTickets([]);
  }, []);

  if (!user) return null;

  // Count closed vs in-progress
  const closedCount = summary?.rows.filter(r => r.status !== 'open').length || 0;
  const openCount = summary?.rows.filter(r => r.status === 'open').length || 0;

  return (
    <SafeAreaView style={s.container}>
      {/* Extra padding for Android status bar */}
      {Platform.OS === 'android' && <View style={{ height: ANDROID_TOP }} />}

      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text.primary} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Payroll</Text>
          {summary && (
            <Text style={s.headerSubtitle}>
              {summary.periodStart} – {summary.periodEnd}
            </Text>
          )}
        </View>
        <View style={s.headerRight} />
      </View>

      {/* Period Tabs */}
      <View style={s.periodBar}>
        {PERIODS.map(per => {
          const active = per.type === selectedPeriod;
          return (
            <Pressable
              key={per.type}
              style={[s.periodTab, active && s.periodTabActive]}
              onPress={() => setSelectedPeriod(per.type)}
            >
              <MaterialCommunityIcons
                name={per.icon as any}
                size={14}
                color={active ? colors.text.primary : colors.text.muted}
              />
              <Text style={[s.periodTabText, active && s.periodTabTextActive]}>
                {per.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand.primary}
            colors={[colors.brand.primary]}
          />
        }
      >
        {loading ? (
          <View style={s.loadingContainer}>
            <ActivityIndicator size="large" color={colors.brand.primary} />
            <Text style={s.loadingText}>Loading payroll...</Text>
          </View>
        ) : summary ? (
          <>
            {/* Net Pay Banner */}
            <View style={s.payBanner}>
              <Text style={s.payBannerLabel}>{summary.periodLabel} Pay</Text>
              <Text style={s.payBannerAmount}>{formatCurrency(summary.totalPay)}</Text>
              {noRateSheet && (
                <Text style={s.noRateWarning}>Rate sheet not configured</Text>
              )}
              {openCount > 0 && (
                <Text style={s.buildingNote}>
                  {openCount} job{openCount > 1 ? 's' : ''} still in progress
                </Text>
              )}
            </View>

            {/* Stats Grid */}
            <View style={s.statsGrid}>
              <StatCard
                icon="truck-delivery"
                label="Loads"
                value={String(summary.totalLoads)}
                color={colors.status.online}
              />
              <StatCard
                icon="water"
                label="BBLs"
                value={String(Math.round(summary.totalBBLs))}
                color={colors.brand.primary}
              />
              <StatCard
                icon="clock-outline"
                label="Hours"
                value={summary.totalHours.toFixed(1)}
                color={colors.status.warning}
              />
              <StatCard
                icon="currency-usd"
                label="Gross"
                value={formatCurrency(summary.totalGross)}
                color={colors.status.online}
              />
            </View>

            {/* Job List */}
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Jobs</Text>
              <Text style={s.sectionCount}>{summary.totalLoads} total</Text>
            </View>

            {summary.rows.length === 0 ? (
              <View style={s.emptyState}>
                <MaterialCommunityIcons name="clipboard-text-outline" size={40} color={colors.text.muted} />
                <Text style={s.emptyText}>No jobs for this period</Text>
                <Text style={s.emptySubtext}>Completed jobs will appear here</Text>
              </View>
            ) : (
              summary.rows.map(row => (
                <PayrollRow
                  key={row.invoiceId}
                  row={row}
                  onTap={() => handleInvoiceTap(row)}
                />
              ))
            )}
          </>
        ) : (
          <View style={s.emptyState}>
            <Text style={s.emptyText}>Unable to load payroll</Text>
          </View>
        )}
      </ScrollView>

      {/* Invoice Detail Modal — loading state or full paper view */}
      {showDetail && !detailInvoice && loadingDetail && (
        <Modal visible animationType="slide" onRequestClose={handleCloseDetail}>
          <View style={[p.modalBg, { paddingTop: ANDROID_TOP }]}>
            <View style={p.modalHeader}>
              <Pressable onPress={handleCloseDetail}>
                <MaterialCommunityIcons name="chevron-left" size={26} color={colors.brand.primary} />
              </Pressable>
              <Text style={p.modalTitle}>Invoice Detail</Text>
              <View style={{ width: 26 }} />
            </View>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.brand.primary} />
              <Text style={{ color: colors.text.muted, marginTop: 12, fontSize: 14 }}>Loading invoice...</Text>
            </View>
          </View>
        </Modal>
      )}

      <InvoiceDetailModal
        visible={showDetail && detailInvoice !== null}
        invoice={detailInvoice}
        tickets={detailTickets}
        loadingTickets={loadingTickets}
        onClose={handleCloseDetail}
      />
    </SafeAreaView>
  );
}

// ── Main Screen Styles ───────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.bg.card,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text.primary,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.text.muted,
    marginTop: 1,
  },
  headerRight: {
    width: 40,
  },
  periodBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  periodTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  periodTabActive: {
    backgroundColor: colors.brand.primary + '20',
    borderColor: colors.brand.primary + '50',
  },
  periodTabText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text.muted,
  },
  periodTabTextActive: {
    color: colors.text.primary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  loadingContainer: {
    alignItems: 'center',
    marginTop: 80,
  },
  loadingText: {
    color: colors.text.muted,
    marginTop: 12,
    fontSize: 14,
  },
  payBanner: {
    alignItems: 'center',
    backgroundColor: colors.bg.card,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    marginBottom: spacing.md,
  },
  payBannerLabel: {
    fontSize: 13,
    color: colors.text.muted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  payBannerAmount: {
    fontSize: 42,
    fontWeight: '800',
    color: colors.status.online,
    marginTop: 4,
  },
  noRateWarning: {
    fontSize: 11,
    color: colors.status.warning,
    marginTop: 6,
  },
  buildingNote: {
    fontSize: 11,
    color: colors.brand.primary,
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.bg.card,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  statLabel: {
    fontSize: 10,
    color: colors.text.muted,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionCount: {
    fontSize: 12,
    color: colors.text.muted,
  },
  payrollRow: {
    backgroundColor: colors.bg.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    marginBottom: 8,
    overflow: 'hidden',
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 4,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowDate: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.primary,
  },
  rowInvoice: {
    fontSize: 12,
    color: colors.brand.primary,
    marginTop: 1,
    fontFamily: MONO,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowPay: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.status.online,
  },
  miniDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm + 2,
    paddingTop: 2,
    flexWrap: 'wrap',
  },
  miniText: {
    fontSize: 11,
    color: colors.text.muted,
  },
  miniDot: {
    fontSize: 11,
    color: colors.text.muted,
    marginHorizontal: 4,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 60,
    gap: 8,
  },
  emptyText: {
    color: colors.text.muted,
    fontSize: 15,
    fontWeight: '500',
  },
  emptySubtext: {
    color: colors.text.muted,
    fontSize: 13,
    opacity: 0.7,
  },
});

// ── Paper Styles (Invoice Detail Modal) ──────────────────────────────────────

const p = StyleSheet.create({
  modalBg: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  // The paper document
  page: {
    backgroundColor: '#FAFAF8',
    borderRadius: 6,
    padding: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },

  // Section header (INVOICE title row)
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  invoiceTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111',
    letterSpacing: 2,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // Generic rows
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  label: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  value: {
    fontSize: 13,
    color: '#111',
    fontWeight: '600',
    textAlign: 'right',
    flex: 1,
    marginLeft: 12,
  },
  mono: {
    fontFamily: MONO,
  },

  // Dividers
  divider: {
    height: 1,
    backgroundColor: '#ccc',
    marginVertical: 14,
  },

  // Section titles
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#444',
    letterSpacing: 1.5,
    marginBottom: 8,
  },

  noData: {
    color: '#999',
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 16,
    fontStyle: 'italic',
  },

  // ── Water Ticket Stubs ──
  ticket: {
    borderLeftWidth: 4,
    borderLeftColor: colors.brand.primary,
    borderColor: '#ddd',
    borderWidth: 1,
    borderRadius: 4,
    marginBottom: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f5f5f5',
  },
  ticketTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  ticketNum: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111',
  },
  ticketDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#ddd',
  },
  ticketRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 3,
  },
  ticketLabel: {
    fontSize: 11,
    color: '#888',
    fontWeight: '500',
  },
  ticketValue: {
    fontSize: 11,
    color: '#222',
    fontWeight: '600',
    textAlign: 'right',
    flex: 1,
    marginLeft: 8,
  },

  // Measurements boxes
  ticketMeasurements: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  measureBox: {
    flex: 1,
    minWidth: 70,
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
    padding: 6,
    alignItems: 'center',
  },
  measureLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  measureValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111',
  },

  // Legal info (small print)
  ticketLegal: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#fafafa',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
  },
  legalText: {
    fontSize: 9,
    color: '#999',
    lineHeight: 13,
  },

  // Time row (service work)
  ticketTimeRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 4,
    gap: 12,
    backgroundColor: '#fafafa',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
  },
  ticketTimeText: {
    fontSize: 10,
    color: '#666',
    fontWeight: '500',
  },

  // Ticket notes
  ticketNotes: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
  },
  ticketNotesLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#888',
    marginBottom: 2,
  },
  ticketNotesText: {
    fontSize: 10,
    color: '#444',
    lineHeight: 14,
  },

  // ── Timeline ──
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 2,
    minHeight: 28,
    position: 'relative',
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#444',
    marginTop: 4,
    marginRight: 0,
    zIndex: 1,
  },
  timelineLine: {
    position: 'absolute',
    left: 3.5,
    top: 12,
    bottom: -4,
    width: 1,
    backgroundColor: '#ccc',
  },
  timelineTime: {
    width: 72,
    fontSize: 11,
    color: '#666',
    marginLeft: 8,
    marginTop: 1,
  },
  timelineLabelWrap: {
    flex: 1,
  },
  timelineLabel: {
    fontSize: 12,
    color: '#222',
    fontWeight: '600',
  },
  timelineLocation: {
    fontSize: 10,
    color: '#888',
    marginTop: 1,
  },

  // ── Notes ──
  notesText: {
    fontSize: 12,
    color: '#333',
    lineHeight: 18,
  },

  // ── Totals ──
  totalsDivider: {
    height: 2,
    backgroundColor: '#111',
    marginTop: 16,
    marginBottom: 12,
  },
  totalsSection: {
    marginBottom: 12,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  totalsLabel: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
  },
  totalsValue: {
    fontSize: 14,
    color: '#111',
    fontWeight: '800',
  },

  // ── Footer ──
  footer: {
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
  },
  footerText: {
    fontSize: 10,
    color: '#bbb',
    letterSpacing: 1,
    fontWeight: '500',
  },
});
