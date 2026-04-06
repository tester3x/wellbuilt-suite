// EnRouteYardCard — replaces the "Returning" shift card with a proper en route display.
// Shows drive timer, destination "The Yard", and "Mark Arrived" button.
// Destination defaults to the last logout GPS coords (where the driver parked last time).
// First-ever shift = no destination, just timer.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Linking,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '@/core/theme';
import { fetchLastYardLocation } from '@/core/services/shiftTracking';
import { useAuth } from '@/core/context/AuthContext';

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
  const { user } = useAuth();
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
});
