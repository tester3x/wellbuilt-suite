// src/core/context/AuthContext.tsx
// Firebase-backed driver authentication context.
// Replaces the old hardcoded demo auth with real Firebase RTDB auth
// (same system as WB M — drivers/approved/{passcodeHash}).

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  getDriverSession,
  revalidateDriverSession,
  clearDriverSession,
  verifyLogin,
  type DriverSession,
  saveDriverSession,
  submitRegistration,
  checkRegistrationStatus,
  completeRegistration,
  firebasePatch,
} from '../services/driverAuth';
import { recordShiftEvent, checkShiftOnResume, saveYardLocation, sendShiftStartToChat } from '../services/shiftTracking';
import { loadDriverProfile, loadVehicleInfo } from '../services/driverProfile';
import * as Location from 'expo-location';
import { cascadeLogoutToSSOApps, clearSSOLaunchedApps } from '../services/appLauncher';

export interface AuthUser {
  driverId: string;
  displayName: string;
  legalName?: string;
  passcodeHash: string;
  isAdmin: boolean;
  isViewer: boolean;
  role: 'driver' | 'admin' | 'viewer';
  companyId?: string;
  companyName?: string;
  assignedRoutes?: string[];
  defaultPackageId?: string;
}

interface AuthContextType {
  /** The logged-in user (null if not authenticated) */
  user: AuthUser | null;
  /** True while checking SecureStore / revalidating on startup */
  loading: boolean;
  /** Convenience boolean */
  isAuthenticated: boolean;
  /** Whether the driver's shift is currently active (clock running) */
  shiftActive: boolean;
  /** ISO timestamp when shift started (for running timer display) */
  shiftStartTime: string | null;
  /** Whether the driver is in "returning to yard" state (driving back after last job) */
  returningToYard: boolean;
  /** ISO timestamp when return drive started (for elapsed timer) */
  returnDepartTime: string | null;
  /** Login with name + passcode. Returns error string or null on success. */
  login: (displayName: string, passcode: string) => Promise<{ success: boolean; error?: string }>;
  /** Start shift manually — records GPS login event, activates shift. Optional packageId overrides default. */
  startShift: (packageId?: string) => Promise<void>;
  /** The active package for this shift (set at shift start) */
  activePackageId: string | null;
  /** Full logout — clears SecureStore session. If shift is active, ends it first. */
  logout: () => Promise<void>;
  /** Start the return-to-yard drive (captures GPS, writes depart_return event) */
  startReturn: () => Promise<void>;
  /** Confirm arrival at yard (captures GPS, writes logout event, ends shift) */
  confirmArrival: (odometerMiles?: number) => Promise<void>;
  /** Register a new driver (goes to pending state) */
  register: (displayName: string, passcode: string, companyName?: string, legalName?: string) => Promise<{ success: boolean; error?: string }>;
  /** Check registration status */
  checkRegistration: () => Promise<'pending' | 'approved' | 'rejected' | 'none'>;
  /** Complete registration after admin approval */
  completeReg: () => Promise<{ success: boolean; error?: string }>;
  /** Logout with RTDB cascade signal — writes logoutAt so other apps self-logout on foreground */
  logoutWithCascade: () => Promise<void>;
  /** Refresh user session from SecureStore (e.g., after SSO deep link saves session) */
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function sessionToUser(session: DriverSession): AuthUser {
  return {
    driverId: session.driverId,
    displayName: session.displayName,
    legalName: session.legalName,
    passcodeHash: session.passcodeHash,
    isAdmin: session.isAdmin,
    isViewer: session.isViewer,
    role: session.isAdmin ? 'admin' : session.isViewer ? 'viewer' : 'driver',
    companyId: session.companyId,
    companyName: session.companyName,
    assignedRoutes: session.assignedRoutes,
    defaultPackageId: session.defaultPackageId,
  };
}

/**
 * Write logoutAt signal to RTDB so other WB apps self-logout on next foreground.
 * Replaces the old deep link cascade which launched apps and polluted Android task stack.
 */
async function writeLogoutSignal(passcodeHash: string): Promise<void> {
  try {
    await firebasePatch(`drivers/approved/${passcodeHash}`, {
      logoutAt: new Date().toISOString(),
    });
    console.log('[AuthContext] logoutAt signal written to RTDB');
  } catch (err) {
    console.warn('[AuthContext] Failed to write logoutAt:', err);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [shiftActive, setShiftActive] = useState(false);
  const [shiftStartTime, setShiftStartTime] = useState<string | null>(null);
  const [returningToYard, setReturningToYard] = useState(false);
  const [returnDepartTime, setReturnDepartTime] = useState<string | null>(null);
  const [activePackageId, setActivePackageId] = useState<string | null>(null);

  // On mount: check SecureStore for existing session
  // OPTIMISTIC AUTH: If local session exists, trust it immediately and revalidate
  // in the background. This eliminates the 0-10 second splash screen hang on slow
  // networks. If background revalidation fails, user gets logged out then.
  useEffect(() => {
    (async () => {
      try {
        const session = await getDriverSession();
        if (session) {
          // Trust the local session immediately — no waiting for Firebase
          setUser(sessionToUser(session));
          setLoading(false);

          // Check if shift was explicitly started (and not ended)
          const shiftStarted = await SecureStore.getItemAsync('shiftStarted');
          const shiftEnded = await SecureStore.getItemAsync('shiftEnded');
          const isActive = shiftStarted === 'true' && shiftEnded !== 'true';
          setShiftActive(isActive);
          if (isActive) {
            const startTime = await SecureStore.getItemAsync('shiftStartTime');
            setShiftStartTime(startTime || null);
          }

          // Restore active package from shift start
          const savedPkgId = await SecureStore.getItemAsync('activePackageId');
          if (savedPkgId) setActivePackageId(savedPkgId);

          // Restore returning-to-yard state if app was killed mid-return
          const savedReturnTime = await SecureStore.getItemAsync('returnDepartTime');
          if (savedReturnTime && shiftEnded !== 'true') {
            setReturningToYard(true);
            setReturnDepartTime(savedReturnTime);
          }

          // Only track shift if driver explicitly started one (tapped "Start Shift").
          // Logged-in but not on-shift should NOT create a shift doc / login event.
          if (isActive) {
            checkShiftOnResume(session.driverId, session.displayName, session.companyId).catch(() => {});
          }

          // Revalidate in background (non-blocking)
          revalidateDriverSession().then(async (stillValid) => {
            if (!stillValid) {
              console.log('[AuthContext] Background revalidation failed — logging out');
              setUser(null);
              // revalidateDriverSession already cleared SecureStore
            } else {
              // Re-read session in case revalidation updated fields
              const freshSession = await getDriverSession();
              if (freshSession) {
                setUser(sessionToUser(freshSession));
              }
            }
          }).catch((err) => {
            // Network error during revalidation — keep the user logged in (offline-friendly)
            console.log('[AuthContext] Background revalidation error (keeping session):', err);
          });
          return; // Early return — loading already set to false above
        }
      } catch (err) {
        console.error('[AuthContext] Error checking session:', err);
      }
      // No session found (or error reading SecureStore) — done loading
      setLoading(false);
    })();
  }, []);

  const login = useCallback(async (displayName: string, passcode: string) => {
    const result = await verifyLogin(displayName, passcode);
    if (result.valid && result.driverId && result.displayName && result.passcodeHash) {
      await saveDriverSession(
        result.driverId,
        result.displayName,
        result.passcodeHash,
        result.isAdmin || false,
        result.isViewer || false,
        result.companyId,
        result.companyName,
        result.legalName,
        result.assignedRoutes,
        result.defaultPackageId
      );
      // Pre-load profile + vehicle info from Firebase (fire-and-forget)
      // So truck/trailer/signature are ready for SSO deep links + shift start
      loadDriverProfile(result.passcodeHash).catch(() => {});
      loadVehicleInfo(result.passcodeHash).catch(() => {});

      // New login = clean slate. Clear stale flags + SSO tracking from previous session.
      await SecureStore.deleteItemAsync('shiftEnded');
      await SecureStore.deleteItemAsync('shiftStarted');
      await SecureStore.deleteItemAsync('returnDepartTime');
      await SecureStore.deleteItemAsync('activePackageId');
      await clearSSOLaunchedApps();
      setShiftActive(false);
      setReturningToYard(false);
      setReturnDepartTime(null);
      setActivePackageId(null);
      setUser({
        driverId: result.driverId,
        displayName: result.displayName,
        legalName: result.legalName,
        passcodeHash: result.passcodeHash,
        isAdmin: result.isAdmin || false,
        isViewer: result.isViewer || false,
        role: result.isAdmin ? 'admin' : result.isViewer ? 'viewer' : 'driver',
        companyId: result.companyId,
        companyName: result.companyName,
        assignedRoutes: result.assignedRoutes,
        defaultPackageId: result.defaultPackageId,
      });
      return { success: true };
    }
    return { success: false, error: result.error || 'Invalid name or passcode' };
  }, []);

  const startShift = useCallback(async (packageId?: string) => {
    if (!user) return;
    // Capture timestamp FIRST — before any awaits steal seconds
    const startTime = new Date().toISOString();
    // Set React state immediately so timer starts from the correct moment
    setShiftActive(true);
    setShiftStartTime(startTime);
    // Record login GPS event for DOT drive time (fire-and-forget)
    recordShiftEvent('login', user.driverId, user.displayName, user.companyId).catch(() => {});
    // Notify dispatch via chat (fire-and-forget)
    if (user.companyId) {
      sendShiftStartToChat(user.driverId, user.legalName || user.displayName, user.companyId).catch(() => {});
    }
    // Persist to SecureStore (survives app kill) — non-blocking for UI
    await SecureStore.setItemAsync('shiftStarted', 'true');
    await SecureStore.setItemAsync('shiftStartTime', startTime);
    await SecureStore.deleteItemAsync('shiftEnded');
    // Save the selected package for this shift
    const pkg = packageId || user.defaultPackageId || null;
    if (pkg) {
      await SecureStore.setItemAsync('activePackageId', pkg);
      setActivePackageId(pkg);
    }
    console.log('[AuthContext] Shift started for:', user.displayName, 'package:', pkg || 'none');
  }, [user]);

  const startReturn = useCallback(async () => {
    if (!user) return;
    const now = new Date().toISOString();
    // Record depart_return GPS event
    recordShiftEvent('depart_return', user.driverId, user.displayName, user.companyId).catch(() => {});
    await SecureStore.setItemAsync('returnDepartTime', now);
    setReturningToYard(true);
    setReturnDepartTime(now);
    console.log('[AuthContext] Return to yard started for:', user.displayName);
  }, [user]);

  const confirmArrival = useCallback(async (odometerMiles?: number) => {
    if (!user) return;
    // Record logout GPS event (arrival at yard = shift end)
    // Must await so day-summary screen can read the shift end time
    await recordShiftEvent('logout', user.driverId, user.displayName, user.companyId).catch(() => {});
    // Everything below is fire-and-forget — don't block navigation to Day Summary
    // Write odometer miles to shift doc
    if (odometerMiles != null && odometerMiles > 0) {
      import('../services/shiftTracking').then(({ writeOdometerMiles }) =>
        writeOdometerMiles(user.driverId, odometerMiles).catch(() => {}));
    }
    // Cache yard GPS — recordShiftEvent already captured GPS, so just grab last known
    Location.getLastKnownPositionAsync().then(loc => {
      if (loc) saveYardLocation(loc.coords.latitude, loc.coords.longitude).catch(() => {});
    }).catch(() => {});
    // Update local state + SecureStore in parallel
    setShiftActive(false);
    setReturningToYard(false);
    setReturnDepartTime(null);
    Promise.all([
      SecureStore.setItemAsync('shiftEnded', 'true'),
      SecureStore.deleteItemAsync('shiftStarted'),
      SecureStore.deleteItemAsync('returnDepartTime'),
    ]).catch(() => {});
    console.log('[AuthContext] Arrived at yard, shift ended for:', user.displayName);
    // No cascade here — day summary screen handles logout via logoutWithCascade
  }, [user]);

  const logoutWithCascade = useCallback(async () => {
    if (user) {
      // Write RTDB signal — SSO'd apps self-logout on next foreground
      await writeLogoutSignal(user.passcodeHash);
    }
    await SecureStore.deleteItemAsync('shiftStarted');
    await SecureStore.deleteItemAsync('shiftEnded');
    await SecureStore.deleteItemAsync('returnDepartTime');
    await SecureStore.deleteItemAsync('activePackageId');
    setShiftActive(false);
    setReturningToYard(false);
    setReturnDepartTime(null);
    setActivePackageId(null);
    await clearDriverSession();
    setUser(null);
  }, [user]);

  const logout = useCallback(async () => {
    // If shift is still active, end it as safety net before logging out
    if (shiftActive && user) {
      recordShiftEvent('logout', user.driverId, user.displayName, user.companyId).catch(() => {});
    }
    // Write RTDB signal so other apps self-logout on next foreground (backup)
    if (user) {
      writeLogoutSignal(user.passcodeHash).catch(() => {});
      // Send instant deep link logout to apps that were SSO'd from WB S this session
    }
    await SecureStore.deleteItemAsync('shiftStarted');
    await SecureStore.deleteItemAsync('shiftEnded');
    await SecureStore.deleteItemAsync('returnDepartTime');
    await SecureStore.deleteItemAsync('activePackageId');
    setShiftActive(false);
    setReturningToYard(false);
    setReturnDepartTime(null);
    setActivePackageId(null);
    await clearDriverSession();
    setUser(null);
  }, [shiftActive, user]);

  const register = useCallback(async (displayName: string, passcode: string, companyName?: string, legalName?: string) => {
    const result = await submitRegistration({ displayName, passcode, companyName, legalName });
    return result;
  }, []);

  const checkRegistration = useCallback(async () => {
    return checkRegistrationStatus();
  }, []);

  const completeReg = useCallback(async () => {
    const result = await completeRegistration();
    if (result.success) {
      const session = await getDriverSession();
      if (session) {
        setUser(sessionToUser(session));
      }
    }
    return { success: result.success, error: result.error };
  }, []);

  const refreshSession = useCallback(async () => {
    const session = await getDriverSession();
    if (session) {
      setUser(sessionToUser(session));
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      isAuthenticated: !!user,
      shiftActive,
      shiftStartTime,
      activePackageId,
      returningToYard,
      returnDepartTime,
      login,
      startShift,
      logout,
      logoutWithCascade,
      startReturn,
      confirmArrival,
      register,
      checkRegistration,
      completeReg,
      refreshSession,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
