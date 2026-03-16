// app/timesheet.tsx — Driver timesheet / payroll view
// Basic payroll summary matching Dashboard Payroll data.
// Invoice numbers are tappable references (future: deep link to WB T invoice detail).

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
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '@/core/context/AuthContext';
import { colors, spacing, radius, typography } from '@/core/theme';
import {
  type TimesheetSummary,
  type TimesheetRow,
  type PeriodType,
  getPeriodDates,
  fetchDriverInvoices,
  fetchPayConfig,
  buildTimesheetSummary,
  buildWellCountyMap,
} from '@/core/services/payroll';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return '$' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function statusColor(status: string): string {
  switch (status) {
    case 'closed':
    case 'submitted':
    case 'approved':
    case 'paid':
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

// ── Payroll Row (basic) ─────────────────────────────────────────────────────

function PayrollRow({ row, expanded, onToggle }: {
  row: TimesheetRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const sColor = statusColor(row.status);
  const rateLabel = row.rateMethod === 'per_bbl'
    ? `${formatCurrency(row.rate)}/bbl`
    : `${formatCurrency(row.rate)}/hr`;

  return (
    <Pressable onPress={onToggle} style={s.payrollRow}>
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
          <MaterialCommunityIcons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.text.muted}
          />
        </View>
      </View>

      {expanded && (
        <View style={s.rowDetail}>
          <View style={s.detailGrid}>
            <DetailItem label="Status" value={statusLabel(row.status)} valueColor={sColor} />
            <DetailItem label="Product" value={row.jobType} />
            <DetailItem label="Operator" value={row.operator} />
            <DetailItem label="Rate" value={rateLabel} />
            {row.bbls > 0 && <DetailItem label="BBLs" value={String(Math.round(row.bbls))} />}
            {row.hours > 0 && <DetailItem label="Hours" value={row.hours.toFixed(1)} />}
            <DetailItem label="Gross Billed" value={formatCurrency(row.gross)} />
          </View>
          <View style={s.detailPayRow}>
            <Text style={s.detailPayLabel}>Your Take</Text>
            <Text style={s.detailPayValue}>{formatCurrency(row.employeePay)}</Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

function DetailItem({ label, value, valueColor }: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={s.detailItem}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={[s.detailValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
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
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [noRateSheet, setNoRateSheet] = useState(false);

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

  if (!user) return null;

  // Count closed vs in-progress
  const closedCount = summary?.rows.filter(r => r.status !== 'open').length || 0;
  const openCount = summary?.rows.filter(r => r.status === 'open').length || 0;

  return (
    <SafeAreaView style={s.container}>
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
        {PERIODS.map(p => {
          const active = p.type === selectedPeriod;
          return (
            <Pressable
              key={p.type}
              style={[s.periodTab, active && s.periodTabActive]}
              onPress={() => {
                setSelectedPeriod(p.type);
                setExpandedRow(null);
              }}
            >
              <MaterialCommunityIcons
                name={p.icon as any}
                size={14}
                color={active ? colors.text.primary : colors.text.muted}
              />
              <Text style={[s.periodTabText, active && s.periodTabTextActive]}>
                {p.label}
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
                  expanded={expandedRow === row.invoiceId}
                  onToggle={() => setExpandedRow(
                    expandedRow === row.invoiceId ? null : row.invoiceId
                  )}
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
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

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
    padding: spacing.md,
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
    color: colors.text.muted,
    marginTop: 1,
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
  rowDetail: {
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    padding: spacing.md,
    backgroundColor: colors.bg.elevated,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  detailItem: {
    width: '45%',
  },
  detailLabel: {
    fontSize: 10,
    color: colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 13,
    color: colors.text.primary,
    fontWeight: '500',
    marginTop: 1,
  },
  detailPayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  detailPayLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text.secondary,
  },
  detailPayValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.status.online,
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
