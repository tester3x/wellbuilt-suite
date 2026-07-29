// AppSwitcher — floating draggable button for switching between WB ecosystem apps.
// Tap = open app grid. Double-tap = jump to WB Suite hub. Long-hold + drag = reposition.
// Apps loaded from Firestore app_registry, filtered by company tier.
// Position persisted to AsyncStorage.

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Animated,
  PanResponder,
  TouchableOpacity,
  Pressable,
  useWindowDimensions,
  Platform,
  Alert,
  AppState,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
// WB S: No Firestore client — uses props or fallback
let collection: any, getDocs: any, firestoreDoc: any, firestoreGetDoc: any;
try {
  const fs = require('firebase/firestore');
  collection = fs.collection; getDocs = fs.getDocs; firestoreDoc = fs.doc; firestoreGetDoc = fs.getDoc;
} catch {}
const db: any = null;
const getDriverIdentity: any = async () => null;

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'wbt_app_switcher_pos';
const REGISTRY_CACHE_KEY = 'wbt_app_registry_cache';
const LONG_PRESS_DURATION = 400;
const DOUBLE_TAP_DELAY = 300;
const HUB_SCHEME = 'wellbuilt-suite';
// This app's own scheme — don't show in the switcher
const DEFAULT_SELF_SCHEME = 'wellbuilt-tickets';

// ── Types ────────────────────────────────────────────────────────────────────

interface AppEntry {
  id: string;
  name: string;
  shortName: string;
  iconUrl: string;
  deepLinkScheme: string;
  requiredTier: 'free' | 'field' | 'god';
  sortOrder: number;
  enabled: boolean;
  androidPackage?: string;
}

// Tier hierarchy: god includes field includes free
const TIER_INCLUDES: Record<string, string[]> = {
  free: ['free'],
  field: ['free', 'field'],
  god: ['free', 'field', 'god'],
};

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** If provided, used as the button image. Otherwise shows default icon. */
  badgeSource?: any;
  /** This app's deep link scheme — excluded from the grid. Default: 'wellbuilt-tickets' */
  selfScheme?: string;
  /** Firestore db instance. If null, uses cached registry or hardcoded fallback. */
  firestoreDb?: any;
  /** Async function returning { hash, name } for SSO params. Falls back to AsyncStorage. */
  getIdentity?: () => Promise<{ hash: string; name: string } | null>;
}

/** Format elapsed time as H:MM:SS */
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

/** DOT-style color: green < 8h, yellow 8-10h, red > 10h */
function getShiftColor(startIso: string): string {
  const hours = (Date.now() - new Date(startIso).getTime()) / 3600000;
  if (hours >= 10) return '#EF4444';
  if (hours >= 8) return '#F59E0B';
  return '#34D399';
}

// Hardcoded fallback when Firestore is unavailable (WB M, etc.)
const FALLBACK_APPS: AppEntry[] = [
  { id: 'wbs', name: 'WellBuilt Suite', shortName: 'Suite', iconUrl: '', deepLinkScheme: 'wellbuilt-suite', requiredTier: 'free', sortOrder: 0, enabled: true },
  { id: 'wbm', name: 'WellBuilt Mobile', shortName: 'Mobile', iconUrl: '', deepLinkScheme: 'wellbuilt-mobile', requiredTier: 'free', sortOrder: 1, enabled: true },
  { id: 'wbt', name: 'WaterTicket', shortName: 'Tickets', iconUrl: '', deepLinkScheme: 'wellbuilt-tickets', requiredTier: 'field', sortOrder: 2, enabled: true },
  { id: 'wbjsa', name: 'WB JSA', shortName: 'JSA', iconUrl: '', deepLinkScheme: 'jsaapp', requiredTier: 'free', sortOrder: 3, enabled: true },
  { id: 'wbew', name: 'WellBuilt eQuipment', shortName: 'eQuip', iconUrl: '', deepLinkScheme: 'wbequipment', requiredTier: 'field', sortOrder: 4, enabled: true },
];

export default function AppSwitcher({ badgeSource, selfScheme, firestoreDb, getIdentity }: Props) {
  const { width: screenW, height: screenH } = useWindowDimensions();

  // Scale sizes to screen — phone (~400px) gets smaller, tablet (~800px+) gets current sizes
  const isPhone = screenW < 600;
  const BUTTON_SIZE = isPhone ? 52 : 80;
  const EDGE_MARGIN = isPhone ? 60 : 90;

  // Refs for PanResponder closure (always has current dimensions)
  const screenRef = useRef({ w: screenW, h: screenH });
  screenRef.current = { w: screenW, h: screenH };
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [tier, setTier] = useState<string>('god'); // Default to god — Firestore overrides
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Shift timer state
  const [shiftStartTime, setShiftStartTime] = useState<string | null>(null);
  const [shiftElapsed, setShiftElapsed] = useState<string>('');
  const [shiftColor, setShiftColor] = useState('#34D399');

  // Animation for radial burst
  const burstAnim = useRef(new Animated.Value(0)).current;

  // Position
  const defaultX = screenW - BUTTON_SIZE - EDGE_MARGIN;
  const defaultY = EDGE_MARGIN;
  const pan = useRef(new Animated.ValueXY({ x: defaultX, y: defaultY })).current;
  const positionRef = useRef({ x: defaultX, y: defaultY });

  // Tap detection
  const lastTapRef = useRef(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);
  const hasMoved = useRef(false);

  // ── Animate radial burst ─────────────────────────────────────────────────
  useEffect(() => {
    Animated.spring(burstAnim, {
      toValue: isOpen ? 1 : 0,
      useNativeDriver: true,
      friction: 6,
      tension: 80,
    }).start();
  }, [isOpen]);

  // ── Shift timer ──────────────────────────────────────────────────────────

  // Load shift start time from AsyncStorage (SSO deep link) or Firestore fallback.
  // Re-reads on foreground so SSO deep link writes are picked up immediately.
  useEffect(() => {
    const readShiftTime = async () => {
      try {
        const cached = await AsyncStorage.getItem('shiftStartTime');
        if (cached) {
          const startDate = new Date(cached).toDateString();
          if (startDate === new Date().toDateString()) {
            setShiftStartTime(cached);
            return;
          }
          // Stale (yesterday) — clear it
          await AsyncStorage.removeItem('shiftStartTime');
          setShiftStartTime(null);
        }
        // No cached value — check Firestore for active shift (manual login, no SSO)
        let identity: { hash: string; name: string } | null = null;
        if (getIdentity) {
          identity = await getIdentity();
        } else {
          try {
            const id = await getDriverIdentity();
            if (id?.hash && id?.name) identity = { hash: id.hash, name: id.name };
          } catch {}
        }
        if (identity?.hash && effectiveDb) {
          const today = new Date();
          const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          const docId = `${identity.hash}_${dateStr}`;
          const shiftDoc = await firestoreGetDoc(firestoreDoc(effectiveDb, 'driver_shifts', docId));
          if (shiftDoc.exists()) {
            const data = shiftDoc.data();
            // Only use if shift has a login but no logout (still active)
            if (data?.startTime && !data?.endTime) {
              await AsyncStorage.setItem('shiftStartTime', data.startTime);
              setShiftStartTime(data.startTime);
            }
          }
        }
      } catch {}
    };
    readShiftTime();
    // Re-read when app returns to foreground (SSO deep link writes while app is backgrounded)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') readShiftTime();
    });
    return () => sub.remove();
  }, []);

  // Tick the timer every second while we have a shift start time
  useEffect(() => {
    if (!shiftStartTime || isOpen) return;
    setShiftElapsed(formatElapsed(shiftStartTime));
    setShiftColor(getShiftColor(shiftStartTime));
    const interval = setInterval(() => {
      setShiftElapsed(formatElapsed(shiftStartTime));
      setShiftColor(getShiftColor(shiftStartTime));
    }, 1000);
    return () => clearInterval(interval);
  }, [shiftStartTime, isOpen]);

  // ── Load saved position ─────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) {
          const { x, y } = JSON.parse(saved);
          const clampedX = Math.max(EDGE_MARGIN, Math.min(x, screenW - BUTTON_SIZE - EDGE_MARGIN));
          const clampedY = Math.max(EDGE_MARGIN, Math.min(y, screenH - BUTTON_SIZE - EDGE_MARGIN));
          pan.setValue({ x: clampedX, y: clampedY });
          positionRef.current = { x: clampedX, y: clampedY };
        }
      } catch {}
    })();
  }, []);

  // ── Re-clamp position on rotation (portrait ↔ landscape) ────────────────
  useEffect(() => {
    const { x, y } = positionRef.current;
    const clampedX = Math.max(EDGE_MARGIN, Math.min(x, screenW - BUTTON_SIZE - EDGE_MARGIN));
    const clampedY = Math.max(EDGE_MARGIN, Math.min(y, screenH - BUTTON_SIZE - EDGE_MARGIN));
    if (clampedX !== x || clampedY !== y) {
      pan.setValue({ x: clampedX, y: clampedY });
      positionRef.current = { x: clampedX, y: clampedY };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ x: clampedX, y: clampedY })).catch(() => {});
    }
  }, [screenW, screenH]);

  // ── Load company tier ────────────────────────────────────────────────────

  const effectiveDb = firestoreDb || db;

  useEffect(() => {
    (async () => {
      try {
        const companyId = await AsyncStorage.getItem('selectedCompanyId');
        if (companyId && effectiveDb) {
          const companySnap = await firestoreGetDoc(firestoreDoc(effectiveDb, 'companies', companyId));
          if (companySnap.exists()) {
            setTier(companySnap.data()?.tier || 'free');
          }
        }
      } catch {}
    })();
  }, [effectiveDb]);

  // ── Load app registry from Firestore (or fallback) ─────────────────────

  useEffect(() => {
    (async () => {
      try {
        // Try cache first for instant render
        const cached = await AsyncStorage.getItem(REGISTRY_CACHE_KEY);
        if (cached) {
          setApps(JSON.parse(cached));
        }

        // Fetch fresh from Firestore if available
        if (effectiveDb) {
          const snap = await getDocs(collection(effectiveDb, 'app_registry'));
          const entries: AppEntry[] = [];
          snap.forEach(d => {
            const data = d.data();
            if (data.enabled !== false) {
              entries.push({ id: d.id, ...data } as AppEntry);
            }
          });
          entries.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
          console.log('[AppSwitcher] Loaded', entries.length, 'apps from Firestore');

          setApps(entries);
          AsyncStorage.setItem(REGISTRY_CACHE_KEY, JSON.stringify(entries)).catch(() => {});
        } else if (!cached) {
          // No Firestore, no cache — use hardcoded fallback
          console.log('[AppSwitcher] No Firestore — using fallback app list');
          setApps(FALLBACK_APPS);
        }
      } catch (err) {
        console.warn('[AppSwitcher] Failed to load registry:', err);
        if (apps.length === 0) setApps(FALLBACK_APPS);
      }
    })();
  }, [effectiveDb]);

  // ── Filter apps by tier ─────────────────────────────────────────────────

  const effectiveSelfScheme = selfScheme || DEFAULT_SELF_SCHEME;
  const visibleApps = useMemo(() => {
    const allowed = TIER_INCLUDES[tier] || TIER_INCLUDES.god;
    return apps.filter(app =>
      app.enabled !== false &&
      app.deepLinkScheme !== effectiveSelfScheme &&
      allowed.includes(app.requiredTier),
    );
  }, [apps, tier, effectiveSelfScheme]);

  // ── Save position ──────────────────────────────────────────────────────

  const savePosition = useCallback((x: number, y: number) => {
    positionRef.current = { x, y };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ x, y })).catch(() => {});
  }, []);

  // ── Launch app ─────────────────────────────────────────────────────────

  const launchApp = useCallback(async (app: AppEntry) => {
    setIsOpen(false);
    try {
      let url = `${app.deepLinkScheme}://`;

      // Don't send SSO params to the hub app (WB Suite) — it manages its own auth.
      if (app.deepLinkScheme !== HUB_SCHEME) {
        // Use prop-based identity or fall back to WB T's getDriverIdentity + AsyncStorage
        let identity: { hash: string; name: string } | null = null;
        if (getIdentity) {
          identity = await getIdentity();
        } else {
          try {
            const id = await getDriverIdentity();
            if (id?.hash && id?.name) identity = { hash: id.hash, name: id.name };
          } catch {}
        }
        const hash = identity?.hash || await AsyncStorage.getItem('passcodeHash') || '';
        const companyId = await AsyncStorage.getItem('selectedCompanyId') || '';
        const vehicleRaw = await AsyncStorage.getItem('vehicleInfo');
        const vehicle = vehicleRaw ? JSON.parse(vehicleRaw) : {};

        if (hash && identity?.name) {
          const params = new URLSearchParams({
            hash,
            name: identity.name,
            ...(companyId ? { companyId } : {}),
            ...(vehicle.truckNumber ? { truck: vehicle.truckNumber } : {}),
            ...(vehicle.trailerNumber ? { trailer: vehicle.trailerNumber } : {}),
          });
          url = `${app.deepLinkScheme}://login?${params.toString()}`;
        }
      }

      await Linking.openURL(url);
    } catch {
      // Try plain scheme
      try {
        await Linking.openURL(`${app.deepLinkScheme}://`);
      } catch {
        // Android intent fallback
        if (Platform.OS === 'android' && app.androidPackage) {
          try {
            await Linking.openURL(`intent://#Intent;package=${app.androidPackage};end`);
            return;
          } catch {}
        }
        Alert.alert('Not Installed', `${app.name} is not installed on this device.`);
      }
    }
  }, []);

  // ── Double-tap → WB Suite hub ──────────────────────────────────────────

  const launchHub = useCallback(async () => {
    setIsOpen(false);
    try {
      await Linking.openURL(`${HUB_SCHEME}://`);
    } catch {
      if (Platform.OS === 'android') {
        try {
          await Linking.openURL('intent://#Intent;package=com.wellbuilt.suite;end');
          return;
        } catch {}
      }
      Alert.alert('Not Installed', 'WellBuilt Suite is not installed on this device.');
    }
  }, []);

  // ── PanResponder (same pattern as MessageButton) ───────────────────────

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5,

      onPanResponderGrant: () => {
        hasMoved.current = false;
        isDraggingRef.current = false;

        pan.setOffset({
          x: positionRef.current.x,
          y: positionRef.current.y,
        });
        pan.setValue({ x: 0, y: 0 });

        // Start long-press timer
        longPressTimerRef.current = setTimeout(() => {
          isDraggingRef.current = true;
          setIsDragging(true);
        }, LONG_PRESS_DURATION);
      },

      onPanResponderMove: (_, gs) => {
        if (Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5) {
          hasMoved.current = true;
        }

        if (isDraggingRef.current) {
          const newX = Math.max(EDGE_MARGIN, Math.min(positionRef.current.x + gs.dx, screenRef.current.w - BUTTON_SIZE - EDGE_MARGIN));
          const newY = Math.max(EDGE_MARGIN, Math.min(positionRef.current.y + gs.dy, screenRef.current.h - BUTTON_SIZE - EDGE_MARGIN));
          pan.setValue({ x: newX - positionRef.current.x, y: newY - positionRef.current.y });
        }
      },

      onPanResponderRelease: (_, gs) => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }

        if (isDraggingRef.current) {
          // Was dragging — save new position
          const newX = Math.max(EDGE_MARGIN, Math.min(positionRef.current.x + gs.dx, screenRef.current.w - BUTTON_SIZE - EDGE_MARGIN));
          const newY = Math.max(EDGE_MARGIN, Math.min(positionRef.current.y + gs.dy, screenRef.current.h - BUTTON_SIZE - EDGE_MARGIN));
          pan.flattenOffset();
          pan.setValue({ x: newX, y: newY });
          savePosition(newX, newY);
          isDraggingRef.current = false;
          setIsDragging(false);
          return;
        }

        pan.flattenOffset();
        pan.setValue({ x: positionRef.current.x, y: positionRef.current.y });

        if (hasMoved.current) return; // Gesture moved too far for a tap

        // Tap detection
        const now = Date.now();
        if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
          // Double tap → launch hub
          lastTapRef.current = 0;
          launchHub();
        } else {
          lastTapRef.current = now;
          // Wait to see if it's a double tap
          setTimeout(() => {
            if (lastTapRef.current !== 0 && Date.now() - lastTapRef.current >= DOUBLE_TAP_DELAY) {
              lastTapRef.current = 0;
              setIsOpen(prev => {
                console.log('[AppSwitcher] Toggle:', !prev, 'visibleApps:', visibleApps.length);
                return !prev;
              });
            }
          }, DOUBLE_TAP_DELAY + 10);
        }
      },

      onPanResponderTerminate: () => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        isDraggingRef.current = false;
        setIsDragging(false);
        pan.flattenOffset();
        pan.setValue({ x: positionRef.current.x, y: positionRef.current.y });
      },
    }),
  ).current;

  // ── Gear tooth positions (radial layout) ──────────────────────────────
  // The gear has teeth spanning ~240° of the bottom arc (avoiding the top droplet).
  // We distribute apps evenly across available tooth positions.
  // Angles measured clockwise from top (12 o'clock = 0°).
  const RADIAL_DISTANCE = isPhone ? 55 : 75;
  const APP_ICON_SIZE = isPhone ? 36 : 48;

  // Center point of the badge button (used for radial positions + edge clamping)
  const cx = positionRef.current.x + BUTTON_SIZE / 2;
  const cy = positionRef.current.y + BUTTON_SIZE / 2;

  const toothPositions = useMemo(() => {
    const count = visibleApps.length;
    if (count === 0) return [];

    // Full 360° radial — badge is always far enough from edges
    const startAngle = 0;
    const endAngle = 360;
    const span = endAngle - startAngle;
    const step = span / count;

    return visibleApps.map((_, i) => {
      const angleDeg = startAngle + step * i;
      const angleRad = (angleDeg * Math.PI) / 180;
      return {
        x: Math.sin(angleRad) * RADIAL_DISTANCE,
        y: -Math.cos(angleRad) * RADIAL_DISTANCE,
      };
    });
  }, [visibleApps.length]);

  // ── Render ─────────────────────────────────────────────────────────────

  // Always show the button — even if registry hasn't loaded yet.
  // Tapping with no apps just opens/closes (nothing to show).

  return (
    <>
      {/* Backdrop when open */}
      {isOpen && (
        <Pressable style={styles.backdrop} onPress={() => setIsOpen(false)} />
      )}

      {/* Radial app icons — animate from center out to gear teeth */}
      {visibleApps.map((app, i) => {
        const pos = toothPositions[i];
        if (!pos) return null;

        const translateX = burstAnim.interpolate({ inputRange: [0, 1], outputRange: [0, pos.x] });
        const translateY = burstAnim.interpolate({ inputRange: [0, 1], outputRange: [0, pos.y] });
        const scale = burstAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.6, 1] });
        const opacity = burstAnim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.5, 1] });

        return (
          <Animated.View
            key={app.id}
            style={[
              styles.toothWrapper,
              {
                left: cx - APP_ICON_SIZE / 2,
                top: cy - APP_ICON_SIZE / 2,
                transform: [{ translateX }, { translateY }, { scale }],
                opacity,
              },
            ]}
            pointerEvents={isOpen ? 'auto' : 'none'}
          >
            <TouchableOpacity
              onPress={() => launchApp(app)}
              activeOpacity={0.7}
              style={styles.toothTouchable}
            >
              <View style={[styles.toothIcon, { width: APP_ICON_SIZE, height: APP_ICON_SIZE, borderRadius: APP_ICON_SIZE / 2 }]}>
                {app.iconUrl ? (
                  <Image source={{ uri: app.iconUrl }} style={{ width: APP_ICON_SIZE - 6, height: APP_ICON_SIZE - 6, borderRadius: (APP_ICON_SIZE - 6) / 2 }} resizeMode="contain" />
                ) : (
                  <Text style={[styles.toothIconLetter, { fontSize: isPhone ? 11 : 14 }]}>{(app.shortName || app.name)[0]}</Text>
                )}
              </View>
              <Text style={[styles.toothLabel, { fontSize: isPhone ? 8 : 10, maxWidth: isPhone ? 44 : 60 }]} numberOfLines={1}>{app.shortName}</Text>
            </TouchableOpacity>
          </Animated.View>
        );
      })}

      {/* Floating button + shift timer */}
      <Animated.View
        style={[
          styles.button,
          {
            width: BUTTON_SIZE,
            height: BUTTON_SIZE,
            transform: pan.getTranslateTransform(),
            opacity: isDragging ? 0.6 : isOpen ? 0.9 : 1,
          },
        ]}
        {...panResponder.panHandlers}
      >
        {badgeSource ? (
          <Image source={badgeSource} style={{ width: BUTTON_SIZE, height: BUTTON_SIZE }} resizeMode="contain" />
        ) : (
          <View style={[styles.defaultBadge, { width: BUTTON_SIZE, height: BUTTON_SIZE, borderRadius: BUTTON_SIZE / 2 }]}>
            <Text style={styles.defaultBadgeText}>WB</Text>
          </View>
        )}
        {/* Shift timer below badge — label overlaps bottom of icon, timer below */}
        {shiftElapsed && !isOpen ? (
          <View style={[styles.timerContainer, { marginTop: isPhone ? -12 : -18 }]}>
            <Text style={[styles.timerLabel, { fontSize: isPhone ? 8 : 11 }]}>Shift Timer</Text>
            <Text style={[styles.timerText, { color: shiftColor, fontSize: isPhone ? 9 : 12 }]}>{shiftElapsed}</Text>
          </View>
        ) : null}
      </Animated.View>
    </>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 998,
  },
  button: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
    elevation: 10,
  },
  badgeImage: {
    // width/height set inline (dynamic BUTTON_SIZE)
  },
  defaultBadge: {
    backgroundColor: '#FFD700',
    justifyContent: 'center',
    alignItems: 'center',
    // width/height/borderRadius set inline (dynamic BUTTON_SIZE)
  },
  defaultBadgeText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '900',
  },
  toothWrapper: {
    position: 'absolute',
    zIndex: 999,
    alignItems: 'center',
  },
  toothIcon: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1.5,
    borderColor: '#444',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 12,
  },
  toothTouchable: {
    alignItems: 'center',
  },
  toothIconLetter: {
    color: '#FFD700',
    fontWeight: '800',
    // fontSize set inline
  },
  toothLabel: {
    color: '#ccc',
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'center',
    // fontSize/maxWidth set inline
  },
  timerContainer: {
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center' as const,
    // marginTop set inline
  },
  timerLabel: {
    color: '#FFD700',
    fontWeight: '900',
    letterSpacing: 0.5,
    // fontSize set inline
  },
  timerText: {
    fontWeight: '800',
    fontVariant: ['tabular-nums'] as any,
    textAlign: 'center' as const,
    // fontSize set inline
  },
});
