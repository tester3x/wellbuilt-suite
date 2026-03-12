// src/core/context/AuthContext.tsx
// Firebase-backed driver authentication context.
// Replaces the old hardcoded demo auth with real Firebase RTDB auth
// (same system as WB M — drivers/approved/{passcodeHash}).

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Linking } from 'react-native';
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
} from '../services/driverAuth';
import { recordShiftEvent, checkShiftOnResume } from '../services/shiftTracking';

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
  /** Whether the driver is in "returning to yard" state (driving back after last job) */
  returningToYard: boolean;
  /** ISO timestamp when return drive started (for elapsed timer) */
  returnDepartTime: string | null;
  /** Login with name + passcode. Returns error string or null on success. */
  login: (displayName: string, passcode: string) => Promise<{ success: boolean; error?: string }>;
  /** Full logout — clears SecureStore session. If shift is active, ends it first. */
  logout: () => Promise<void>;
  /** Start the return-to-yard drive (captures GPS, writes depart_return event) */
  startReturn: () => Promise<void>;
  /** Confirm arrival at yard (captures GPS, writes logout event, ends shift) */
  confirmArrival: () => Promise<void>;
  /** Register a new driver (goes to pending state) */
  register: (displayName: string, passcode: string, companyName?: string, legalName?: string) => Promise<{ success: boolean; error?: string }>;
  /** Check registration status */
  checkRegistration: () => Promise<'pending' | 'approved' | 'rejected' | 'none'>;
  /** Complete registration after admin approval */
  completeReg: () => Promise<{ success: boolean; error?: string }>;
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
  };
}

/**
 * Fire logout deep links to all WB ecosystem apps.
 * Each app has a logout handler that clears its session.
 * Fire-and-forget — don't block on failures.
 */
const CASCADE_LOGOUT_SCHEMES = ['wellbuilt-tickets', 'wellbuiltmobile', 'jsaapp'];

async function cascadeLogoutToApps(): Promise<void> {
  for (const scheme of CASCADE_LOGOUT_SCHEMES) {
    try {
      const url = `${scheme}://logout`;
      await Linking.openURL(url);
      // Small delay between launches to let each app process
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      // App not installed or can't be opened — that's fine, skip it
      console.log(`[AuthContext] Cascade logout skipped ${scheme}:`, err);
    }
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [shiftActive, setShiftActive] = useState(false);
  const [returningToYard, setReturningToYard] = useState(false);
  const [returnDepartTime, setReturnDepartTime] = useState<string | null>(null);

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

          // Check if shift was already ended this session
          const shiftEnded = await SecureStore.getItemAsync('shiftEnded');
          setShiftActive(shiftEnded !== 'true');

          // Restore returning-to-yard state if app was killed mid-return
          const savedReturnTime = await SecureStore.getItemAsync('returnDepartTime');
          if (savedReturnTime && shiftEnded !== 'true') {
            setReturningToYard(true);
            setReturnDepartTime(savedReturnTime);
          }

          // Ensure today's shift is tracked + close stale shifts (fire-and-forget)
          checkShiftOnResume(session.driverId, session.displayName, session.companyId).catch(() => {});

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
        result.assignedRoutes
      );
      // New login = new shift. Clear stale flags.
      await SecureStore.deleteItemAsync('shiftEnded');
      await SecureStore.deleteItemAsync('returnDepartTime');
      setShiftActive(true);
      setReturningToYard(false);
      setReturnDepartTime(null);
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
      });
      return { success: true };
    }
    return { success: false, error: result.error || 'Invalid name or passcode' };
  }, []);

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

  const confirmArrival = useCallback(async () => {
    if (!user) return;
    // Record logout GPS event (arrival at yard = shift end)
    recordShiftEvent('logout', user.driverId, user.displayName, user.companyId).catch(() => {});
    await SecureStore.setItemAsync('shiftEnded', 'true');
    await SecureStore.deleteItemAsync('returnDepartTime');
    setShiftActive(false);
    setReturningToYard(false);
    setReturnDepartTime(null);
    console.log('[AuthContext] Arrived at yard, shift ended for:', user.displayName);
    // Cascade logout to all WB ecosystem apps (fire-and-forget)
    cascadeLogoutToApps().catch(() => {});
  }, [user]);

  const logout = useCallback(async () => {
    // If shift is still active, end it as safety net before logging out
    if (shiftActive && user) {
      recordShiftEvent('logout', user.driverId, user.displayName, user.companyId).catch(() => {});
    }
    // Cascade logout to all WB ecosystem apps (fire-and-forget)
    cascadeLogoutToApps().catch(() => {});
    await SecureStore.deleteItemAsync('shiftEnded');
    await SecureStore.deleteItemAsync('returnDepartTime');
    setShiftActive(false);
    setReturningToYard(false);
    setReturnDepartTime(null);
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
      returningToYard,
      returnDepartTime,
      login,
      logout,
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
