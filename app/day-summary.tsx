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
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '@/core/context/AuthContext';
import { colors } from '@/core/theme';
import { firebasePatch } from '@/core/services/driverAuth';
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

interface StatCardProps {
  icon: string;
  label: string;
  value: string;
  color?: string;
}

function StatCard({ icon, label, value, color = colors.brand.primary }: StatCardProps) {
  return (
    <View style={s.statCard}>
      <MaterialCommunityIcons name={icon as any} size={22} color={color} />
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

export default function DaySummaryScreen() {
  const router = useRouter();
  const { user, logoutWithCascade } = useAuth();
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [invoices, shift] = await Promise.all([
          fetchTodayInvoices(user.displayName, user.companyId),
          fetchTodayShift(user.driverId),
        ]);
        const result = calculateDaySummary(invoices, shift?.events || []);
        setSummary(result);
      } catch (err) {
        console.warn('[DaySummary] Failed to load data:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const handleClose = async () => {
    // Shift is over — signal other apps to logout even though WB S stays logged in
    if (user) {
      firebasePatch(`drivers/approved/${user.passcodeHash}`, {
        logoutAt: new Date().toISOString(),
      }).catch(() => {});
    }
    router.replace('/home');
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Log out of all WellBuilt apps?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
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
          <Text style={s.title}>Shift Complete</Text>
          {timeRange ? <Text style={s.timeRange}>{timeRange}</Text> : null}
        </View>

        {loading ? (
          <View style={s.loadingContainer}>
            <ActivityIndicator size="large" color={colors.brand.primary} />
            <Text style={s.loadingText}>Loading summary...</Text>
          </View>
        ) : summary ? (
          <>
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
                value={String(Math.round(summary.totalBBL))}
                color={colors.brand.primary}
              />
              <StatCard
                icon="map-marker-multiple"
                label="Wells"
                value={String(summary.wellsVisited.length)}
                color={colors.brand.accent}
              />
              <StatCard
                icon="clock-outline"
                label="Total Hours"
                value={summary.totalHoursWorked > 0 ? `${summary.totalHoursWorked}h` : '0h'}
                color={colors.status.warning}
              />
              <StatCard
                icon="road-variant"
                label="Drive Time"
                value={formatDuration(summary.driveMinutes)}
                color="#F97316"
              />
              <StatCard
                icon="hard-hat"
                label="On-Site"
                value={formatDuration(summary.onSiteMinutes)}
                color="#A78BFA"
              />
              {summary.driveMiles > 0 && (
                <StatCard
                  icon="map-marker-distance"
                  label="Miles"
                  value={`${summary.driveMiles}`}
                  color="#38BDF8"
                />
              )}
              {summary.avgSpeedMph > 0 && (
                <StatCard
                  icon="speedometer"
                  label="Avg Speed"
                  value={`${summary.avgSpeedMph} mph`}
                  color="#FB923C"
                />
              )}
            </View>

            {/* Wells Visited */}
            {summary.wellsVisited.length > 0 && (
              <View style={s.wellsSection}>
                <Text style={s.sectionTitle}>Wells Visited</Text>
                <View style={s.wellBadges}>
                  {summary.wellsVisited.map((well, idx) => (
                    <View key={idx} style={s.wellBadge}>
                      <Text style={s.wellBadgeText}>{well}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {summary.totalLoads === 0 && (
              <View style={s.emptyState}>
                <Text style={s.emptyText}>No completed loads today</Text>
              </View>
            )}
          </>
        ) : (
          <View style={s.emptyState}>
            <Text style={s.emptyText}>Unable to load summary</Text>
          </View>
        )}
      </ScrollView>

      {/* Fixed Bottom Buttons */}
      <View style={s.bottomButtons}>
        <Pressable style={s.closeButton} onPress={handleClose}>
          <MaterialCommunityIcons name="check-circle-outline" size={20} color={colors.text.primary} />
          <Text style={s.closeButtonText}>Close</Text>
        </Pressable>
        <Pressable style={s.logoutButton} onPress={handleLogout}>
          <MaterialCommunityIcons name="logout" size={20} color="#EF4444" />
          <Text style={s.logoutButtonText}>Log Out</Text>
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    width: '47%',
    backgroundColor: colors.bg.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text.primary,
    marginTop: 8,
  },
  statLabel: {
    fontSize: 13,
    color: colors.text.muted,
    marginTop: 2,
  },
  wellsSection: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  wellBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  wellBadge: {
    backgroundColor: colors.bg.elevated,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  wellBadgeText: {
    color: colors.text.primary,
    fontSize: 13,
    fontWeight: '500',
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
