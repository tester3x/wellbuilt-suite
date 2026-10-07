// EnRouteYardCard — replaces the "Returning" shift card with a proper en route display.
// Shows drive timer, destination "The Yard", and "Mark Arrived" button.
// Destination defaults to the last logout GPS coords (where the driver parked last time).
// First-ever shift = no destination, just timer.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Linking,
  Platform,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '@/core/theme';
import { fetchLastYardLocation } from '@/core/services/shiftTracking';
import { useAuth } from '@/core/context/AuthContext';
import { returnDivertMessage } from '@/core/services/returnStart';

interface EnRouteYardCardProps {
  returnStartTime: string | null;
  onArrived: () => void;
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

export default function EnRouteYardCard({ returnStartTime, onArrived }: EnRouteYardCardProps) {
  const { user, abandonReturn } = useAuth();

  // Divert: a new job came in while heading to the yard. Exit the return
  // WITHOUT marking arrival or ending the shift (abandonReturn keeps the shift
  // open and leaves the depart_return leg in history). Confirm to avoid a
  // mis-tap discarding the return.
  // A refused divert must be VISIBLE. Previously this was fire-and-forget with
  // only a console.warn, so when the server rejected it the driver saw nothing
  // at all and kept tapping — the same silent dead end that Return to Yard had
  // in v49. The divert still leaves the return state intact on failure.
  const divertBusy = useRef(false);
  const [showDivert, setShowDivert] = useState(false);
  const [divertError, setDivertError] = useState<string | null>(null);
  const [divertSubmitting, setDivertSubmitting] = useState(false);
  const handleDivert = useCallback(() => {
    if (divertBusy.current) return;
    divertBusy.current = true;
    setDivertSubmitting(true);
    setDivertError(null);
    void (async () => {
      try {
        const result = await abandonReturn();
        if (!result.ok) setDivertError(returnDivertMessage(result.reason));
        else setShowDivert(false);
      } catch {
        setDivertError(returnDivertMessage('return_failed'));
      } finally {
        divertBusy.current = false;
        setDivertSubmitting(false);
      }
    })();
  }, [abandonReturn]);
  const [elapsed, setElapsed] = useState('0:00');
  const [yardLocation, setYardLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [pulse] = useState(() => new Animated.Value(1));

  // Tick timer
  useEffect(() => {
    if (!returnStartTime) return;
    setElapsed(formatElapsed(returnStartTime));
    const interval = setInterval(() => setElapsed(formatElapsed(returnStartTime)), 1000);
    return () => clearInterval(interval);
  }, [returnStartTime]);

  // Pulsing animation
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.4, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  // Load yard location
  useEffect(() => {
    if (!user?.driverId) return;
    fetchLastYardLocation(user.driverId).then(loc => {
      if (loc) setYardLocation({ lat: loc.lat, lng: loc.lng });
    }).catch(() => {});
  }, [user?.driverId]);

  // Open maps to yard
  const openDirections = useCallback(() => {
    if (!yardLocation) return;
    const url = Platform.OS === 'ios'
      ? `maps://app?daddr=${yardLocation.lat},${yardLocation.lng}&dirflg=d`
      : `google.navigation:q=${yardLocation.lat},${yardLocation.lng}&mode=d`;
    Linking.openURL(url).catch(() => {
      // Fallback to Google Maps web
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${yardLocation.lat},${yardLocation.lng}&travelmode=driving`).catch(() => {});
    });
  }, [yardLocation]);

  return (
    <View style={s.container}>
      {/* En Route Header */}
      <View style={s.header}>
        <Animated.View style={{ opacity: pulse }}>
          <MaterialCommunityIcons name="truck-fast" size={20} color="#F59E0B" />
        </Animated.View>
        <Text style={s.headerLabel}>EN ROUTE</Text>
        <View style={s.headerDot} />
      </View>

      {/* Destination */}
      <View style={s.destRow}>
        <MaterialCommunityIcons name="map-marker" size={18} color="#F59E0B" />
        <Text style={s.destText}>The Yard</Text>
        {yardLocation && (
          <Pressable onPress={openDirections} style={s.navButton}>
            <MaterialCommunityIcons name="navigation-variant" size={16} color={colors.brand.primary} />
            <Text style={s.navText}>Navigate</Text>
          </Pressable>
        )}
      </View>

      {/* Timer */}
      <Text style={s.timer}>{elapsed}</Text>
      <Text style={s.timerLabel}>Drive Time</Text>

      {/* Mark Arrived */}
      <Pressable onPress={onArrived} style={s.arrivedButton}>
        <MaterialCommunityIcons name="map-marker-check" size={18} color="#000" />
        <Text style={s.arrivedText}>Mark Arrived</Text>
      </Pressable>

      {/* Back to work — divert when a new job arrives (no arrival, no close) */}
      <Pressable onPress={() => { setDivertError(null); setShowDivert(true); }} style={s.divertButton}>
        <MaterialCommunityIcons name="briefcase-arrow-left-right-outline" size={16} color="#F59E0B" />
        <Text style={s.divertText}>Back to Work (new job)</Text>
      </Pressable>
      <Modal visible={showDivert} transparent animationType="fade" onRequestClose={() => { if (!divertBusy.current) setShowDivert(false); }}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <MaterialCommunityIcons name="truck-fast" size={36} color="#F59E0B" style={s.modalIcon} />
            <Text style={s.modalTitle}>{divertError ? 'Still returning to the yard' : 'Back to work?'}</Text>
            <Text style={s.modalMessage}>{divertError || 'Cancel the drive to The Yard and keep your shift open for a new job. This does not mark you arrived or end your shift.'}</Text>
            {!divertError && <Pressable accessibilityRole="button" disabled={divertSubmitting} onPress={handleDivert} style={[s.modalPrimary, divertSubmitting && s.modalDisabled]}>
              {divertSubmitting && <ActivityIndicator size="small" color="#000" />}
              <Text style={s.modalPrimaryText}>{divertSubmitting ? 'Working…' : 'Back to work'}</Text>
            </Pressable>}
            <Pressable accessibilityRole="button" disabled={divertSubmitting} onPress={() => setShowDivert(false)} style={s.modalSecondary}>
              <Text style={s.modalSecondaryText}>{divertError ? 'Close' : 'Keep returning'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: colors.bg.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  headerLabel: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  headerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F59E0B',
    marginLeft: 'auto',
  },
  destRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  destText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: `${colors.brand.primary}20`,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  navText: {
    color: colors.brand.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  timer: {
    color: '#F59E0B',
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 2,
  },
  timerLabel: {
    color: 'rgba(245, 158, 11, 0.6)',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
  },
  arrivedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F59E0B',
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  arrivedText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
  },
  divertButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.5)',
    paddingVertical: 10,
    marginTop: 8,
  },
  divertText: {
    color: '#F59E0B',
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  modalCard: { width: '100%', maxWidth: 420, backgroundColor: colors.bg.card, borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)', borderRadius: radius.lg, padding: 24 },
  modalIcon: { alignSelf: 'center', marginBottom: 8 },
  modalTitle: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center' },
  modalMessage: { color: colors.text.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8, marginBottom: 20 },
  modalPrimary: { backgroundColor: '#F59E0B', borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  modalDisabled: { opacity: 0.65 },
  modalPrimaryText: { color: '#000', fontSize: 16, fontWeight: '700' },
  modalSecondary: { paddingVertical: 14, alignItems: 'center' },
  modalSecondaryText: { color: colors.text.muted, fontSize: 14, fontWeight: '600' },
});
