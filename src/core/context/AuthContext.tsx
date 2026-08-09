// src/core/context/AuthContext.tsx
// Firebase-backed driver authentication context.
// Replaces the old hardcoded demo auth with real Firebase RTDB auth
// (same system as WB M — drivers/approved/{passcodeHash}).

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { recordShiftEvent, checkShiftOnResume, saveYardLocation, sendShiftStartToChat, mintShiftId, setCurrentShiftId, clearCurrentShiftId, getCurrentShiftId, observeEnforcementSafety } from '../services/shiftTracking';
import { loadDriverProfile, loadVehicleInfo } from '../services/driverProfile';
import * as Location from 'expo-location';
import { clearSSOLaunchedApps } from '../services/appLauncher';
import { wbDiagLog } from '../services/wbDiagLog';

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
 * AsyncStorage keys tied to the current driver session or current shift.
 * Wiped on logout so a fresh login (or the same driver re-logging in) doesn't
 * inherit stale per-shift state. Mirrors WB T's LOGOUT_CLEAR_KEYS list.
 *
 * Intentionally NOT included:
 *   - 'wellbuilt-last-odometer' — pre-fills the next shift's start odometer.
 *     Belongs to the device + driver pairing, survives logout by design.
 */
const LOGOUT_ASYNCSTORAGE_KEYS: readonly string[] = [
  // Pre-shift JSA preview breadcrumb. The Preview-JSA-from-Start-Shift
  // launcher was retired 2026-05-01, but existing installs may still
  // have a stale breadcrumb sitting in AsyncStorage. Clear on logout so
  // the next session starts cold.
  'wellbuilt-jsa-previewed-pre-shift',
  // Per-shift odometer cache (set in ShiftStartModal). Per-shift state,
  // not driver-survival state — wipe on logout.
  'wellbuilt-shift-start-odometer',
  // Mirror of SecureStore 'shiftStartTime' written by AppSwitcher.tsx
  // for the floating-badge timer. The SecureStore copy is cleared above;
  // the AsyncStorage copy was previously surviving logout.
  'shiftStartTime',
];

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
  /**
   * The identity the last reconciliation was started for.
   *
   * NOT a boolean "already done" flag. AuthProvider sits above the router in
   * app/_layout.tsx and never unmounts: logout is setUser(null), so
   * driver A logging out and driver B logging in happens inside one
   * provider lifetime. A boolean would stay true and driver B would never
   * be reconciled at all. refreshSession (SSO deep link) can likewise
   * change the durable identity while mounted. Keying on the identity
   * makes the guard deduplicate repeats without ever suppressing a
   * genuine change — including a change back to "no identity".
   */
  const reconciledForRef = useRef<string | null>(null);

  /**
   * Start reconciliation for `local`, at most once per identity.
   *
   * Every transition first takes reconciliation ownership, so an in-flight
   * reconciliation for the previous driver can no longer publish state or
   * sign the new driver out.
   */
  const reconcileForIdentity = useCallback((local: { driverId: string; companyId: string | null } | null) => {
    const key = local ? `${local.driverId}|${local.companyId ?? ''}` : '<none>';
    if (reconciledForRef.current === key) return;
    reconciledForRef.current = key;
    void import('../services/authReconciliation')
      .then((m) => {
        m.invalidateReconciliation();
        return m.reconcileRestoredSession(local);
      })
      // Observed, not ignored: reconciliation failing must never surface
      // as an unhandled rejection, and must never block app entry.
      .catch((err) => {
        console.warn('[AuthContext] reconciliation failed:', err);
      });
  }, []);

  // On mount: check SecureStore for existing session
  // OPTIMISTIC AUTH: If local session exists, trust it immediately and revalidate
  // in the background. This eliminates the 0-10 second splash screen hang on slow
  // networks. If background revalidation fails, user gets logged out then.
  useEffect(() => {
    (async () => {
      try {
        const session = await getDriverSession();

        // VC51.9I-RECOVERY5A: reconcile the persisted SDK Auth session
        // against the local identity that was (or was not) restored.
        //
        // Runs for BOTH cases on purpose. With no local session there can
        // still be a persisted SDK user — left by a previous install or an
        // abandoned driver switch — and that orphan must be signed out.
        // Null is passed explicitly rather than a fabricated identity.
        //
        // Deliberately NOT awaited: ordinary app entry is offline-capable
        // and must not become network-dependent. The result only decides
        // whether VERIFIED cloud operations may run; local entry proceeds
        // either way, and 'unavailable' (offline) is not a logout.
        reconcileForIdentity(
          session ? { driverId: session.driverId, companyId: session.companyId || null } : null,
        );

        if (session) {
          // Trust the local session immediately — no waiting for Firebase
          setUser(sessionToUser(session));
          setLoading(false);

          // Cold-start / session restore: force-refresh company config and
          // refresh durable enforcement LKG when a live read succeeds.
          // Independent of shift activity so cutover does not require
          // Start Shift. Does not clear auth/shift/JSA/DVIR state.
          if (session.companyId) {
            observeEnforcementSafety(session.companyId, 'AuthContext.sessionRestore').catch(() => {});
          }

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
          // vc51.9C: the cached shift id is verified against AUTHORITY through
          // the canonical resolver before it is presented as current. Closed/
          // superseded → cleared and the local session marked ended (never
          // reopened); unverified (offline) → preserved but the backfill still
          // runs with the cached id so the doc keeps its scope key.
          if (isActive) {
            (async () => {
              try {
                const cached = await getCurrentShiftId();
                const [{ verifyCachedShiftAgainstAuthority }, { fetchShiftDayDoc }] = await Promise.all([
                  import('../services/workPeriodAuthority/suiteShiftAuthority'),
                  import('../services/shiftTracking'),
                ]);
                const n = new Date();
                const localDate = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
                const v = await verifyCachedShiftAgainstAuthority({
                  companyId: session.companyId || '',
                  driverId: session.driverId,
                  cachedShiftId: cached,
                  localDate,
                  nowMs: Date.now(),
                  fetchDayDoc: (date) => fetchShiftDayDoc(session.driverId, date),
                });
                if (v.verdict === 'verified_closed') {
                  await clearCurrentShiftId();
                  await SecureStore.setItemAsync('shiftEnded', 'true');
                  setShiftActive(false);
                  console.log('[AuthContext] cached shift closed by authority (' + v.reason + ') — cleared, not reopened');
                  return;
                }
                checkShiftOnResume(session.driverId, session.legalName || session.displayName, session.companyId, 'wbs', cached).catch(() => {});
              } catch {
                checkShiftOnResume(session.driverId, session.legalName || session.displayName, session.companyId).catch(() => {});
              }
            })();
          }

          // Revalidate in background (non-blocking). Secure path uses
          // verifyDriverSession; hard fail clears SDK+local without shift close.
          revalidateDriverSession().then(async (stillValid) => {
            if (!stillValid) {
              console.log('[AuthContext] Background revalidation failed — logging out');
              // Take reconciliation ownership so orphan SDK state cannot linger.
              reconcileForIdentity(null);
              setUser(null);
              // revalidateDriverSession already performed secure sign-out + SecureStore clear
            } else {
              // Re-read session in case revalidation updated fields
              const freshSession = await getDriverSession();
              if (freshSession) {
                setUser(sessionToUser(freshSession));
              }
            }
          }).catch((err) => {
            // Unexpected throw only: soft keep (revalidate should not throw for hard fails)
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
      // Durable secure vs legacy marker — never inferred from passcodeHash alone later.
      {
        const { markSessionAuthMode, markSecureSessionVerified } = await import(
          '../services/secureSessionRevalidation'
        );
        if (result.authVerified) {
          await markSessionAuthMode('secure');
          // Login just established a verified SDK session — offline soft-fail eligible.
          await markSecureSessionVerified();
        } else {
          await markSessionAuthMode('legacy');
        }
      }
      // The identity changed: reconcile for the new driver. The login
      // itself already established and verified the SDK session, but this
      // keeps reconciliation state owned by the current identity rather
      // than whatever the previous driver left behind.
      reconcileForIdentity({
        driverId: result.driverId,
        companyId: result.companyId || null,
      });

      // Pre-load profile + vehicle info from Firebase (fire-and-forget)
      // So truck/trailer/signature are ready for SSO deep links + shift start
      loadDriverProfile(result.passcodeHash).catch(() => {});
      loadVehicleInfo(result.passcodeHash).catch(() => {});

      // Cutover / enforcement LKG: force-refresh company config on secure
      // login and persist durable enforcement safety state when the live
      // read succeeds. Does not clear auth, shift, JSA, or DVIR keys.
      if (result.companyId) {
        observeEnforcementSafety(result.companyId, 'AuthContext.login').catch(() => {});
      }

      // SSO app-switcher tracking is always reset on fresh identity login.
      await clearSSOLaunchedApps();
      await SecureStore.deleteItemAsync('returnDepartTime');
      setReturningToYard(false);
      setReturnDepartTime(null);

      // ── Explicit-shift restoration (do NOT blind-clear under enforcement) ──
      // clearDriverSession never clears AsyncStorage currentShiftId; login must
      // re-verify that cache against origin-day authority (cross-midnight safe).
      try {
        const companyId = result.companyId || '';
        const [{ fetchCompanyConfig }, { parseSuiteEnforcement, mayUseDateFallback }, { decidePostLoginShiftRestore, shiftStartIsoFromShiftId }, { fetchShiftDayDoc }] =
          await Promise.all([
            import('../services/companyConfig'),
            import('../services/workPeriodAuthority/suiteShiftAuthority'),
            import('../services/workPeriodAuthority/postLoginShiftRestoration'),
            import('../services/shiftTracking'),
          ]);
        const cfg = companyId ? await fetchCompanyConfig(companyId) : null;
        const enforcement = parseSuiteEnforcement(cfg ?? undefined);
        const n = new Date();
        const localDate = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
        const cached = await getCurrentShiftId();
        const priorStarted = (await SecureStore.getItemAsync('shiftStarted')) === 'true';

        if (enforcement.state === 'active' && enforcement.mode === 'explicit_shift') {
          const action = await decidePostLoginShiftRestore({
            enforcement,
            cachedShiftId: cached,
            localDate,
            nowMs: Date.now(),
            companyId,
            driverId: result.driverId,
            fetchDayDoc: (date) => fetchShiftDayDoc(result.driverId, date),
            localShiftStarted: priorStarted,
          });
          if (action.kind === 'restore_active' && action.periodId) {
            await setCurrentShiftId(action.periodId);
            await SecureStore.setItemAsync('shiftStarted', 'true');
            await SecureStore.deleteItemAsync('shiftEnded');
            const startIso =
              action.shiftStartTimeIso ||
              shiftStartIsoFromShiftId(action.periodId) ||
              (await SecureStore.getItemAsync('shiftStartTime'));
            if (startIso) {
              await SecureStore.setItemAsync('shiftStartTime', startIso);
              setShiftStartTime(startIso);
            }
            // Keep package if still present; do not invent one
            const savedPkgId = await SecureStore.getItemAsync('activePackageId');
            if (savedPkgId) setActivePackageId(savedPkgId);
            setShiftActive(true);
            console.log(
              '[AuthContext] Restored explicit shift after login periodId=' + action.periodId,
            );
            // Resume hygiene only — must not mint or append a new login event.
            checkShiftOnResume(
              result.driverId,
              result.legalName || result.displayName,
              result.companyId,
              'wbs',
              action.periodId,
            ).catch(() => {});
          } else if (action.kind === 'inactive_allow_start') {
            await SecureStore.deleteItemAsync('shiftStarted');
            await SecureStore.setItemAsync('shiftEnded', 'true');
            await clearCurrentShiftId();
            setShiftActive(false);
            setShiftStartTime(null);
            setActivePackageId(null);
            await SecureStore.deleteItemAsync('activePackageId');
            console.log(
              '[AuthContext] Post-login authority: no open shift (' + action.reason + ')',
            );
          } else {
            // block_start — unreadable / mismatch / missing-cache discovery gap
            await SecureStore.deleteItemAsync('shiftStarted');
            await SecureStore.deleteItemAsync('shiftEnded');
            setShiftActive(false);
            setShiftStartTime(null);
            // Keep currentShiftId cache if present for a later retry; do not mint.
            console.log(
              '[AuthContext] Post-login shift restore blocked (' + action.reason + ') — Start Shift disabled until authority clears',
            );
            // Surface non-actionable state: shiftActive false AND shiftMintBlocked
            // is enforced in startShift pre-mint gate (refuse when open/unknown).
          }
        } else if (mayUseDateFallback(enforcement)) {
          // Legacy/inert: established clean-slate on fresh login.
          await SecureStore.deleteItemAsync('shiftEnded');
          await SecureStore.deleteItemAsync('shiftStarted');
          await SecureStore.deleteItemAsync('activePackageId');
          await clearCurrentShiftId();
          setShiftActive(false);
          setShiftStartTime(null);
          setActivePackageId(null);
        } else {
          // invalid / unknown contract — fail closed (no mint from local flags)
          await SecureStore.deleteItemAsync('shiftStarted');
          setShiftActive(false);
          setShiftStartTime(null);
        }
      } catch (err) {
        console.warn('[AuthContext] Post-login shift restore failed closed:', err);
        await SecureStore.deleteItemAsync('shiftStarted');
        setShiftActive(false);
        setShiftStartTime(null);
      }

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
    // Local date used for driver_shifts/{driverHash}_{localDate} doc id.
    // Computed here so the diagnostic log lets us match this Start Shift
    // event to the WB JSA refresh log byte-for-byte.
    const _now = new Date();
    const localDate = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;

    // Pre-mint authority gate: never rely solely on React shiftActive.
    // Under explicit_shift, refuse if an open period exists or authority is unknown.
    try {
      const [{ fetchCompanyConfig }, { parseSuiteEnforcement }, { decidePreMintShiftGate }, { fetchShiftDayDoc }] =
        await Promise.all([
          import('../services/companyConfig'),
          import('../services/workPeriodAuthority/suiteShiftAuthority'),
          import('../services/workPeriodAuthority/postLoginShiftRestoration'),
          import('../services/shiftTracking'),
        ]);
      const cfg = user.companyId ? await fetchCompanyConfig(user.companyId) : null;
      const enforcement = parseSuiteEnforcement(cfg ?? undefined);
      const cached = await getCurrentShiftId();
      const gate = await decidePreMintShiftGate({
        enforcement,
        cachedShiftId: cached,
        localDate,
        nowMs: Date.now(),
        companyId: user.companyId || '',
        driverId: user.driverId,
        fetchDayDoc: (date) => fetchShiftDayDoc(user.driverId, date),
      });
      if (!gate.allowMint) {
        if (gate.openPeriodId) {
          // Heal UI: restore the open period instead of dual-opening.
          await setCurrentShiftId(gate.openPeriodId);
          await SecureStore.setItemAsync('shiftStarted', 'true');
          await SecureStore.deleteItemAsync('shiftEnded');
          setShiftActive(true);
          console.log(
            '[startShift] refused mint — open explicit shift restored periodId=' + gate.openPeriodId,
          );
        } else {
          console.log('[startShift] refused mint — ' + gate.reason);
        }
        return;
      }
      // Closed/stale cache may be cleared before mint
      if (cached) await clearCurrentShiftId();
    } catch (err) {
      console.warn('[startShift] pre-mint authority check failed closed:', err);
      return;
    }

    // Mint a fresh shiftId for the new shift. JSA is keyed by this id
    // across WB S / WB T / WB JSA — closing a shift "freezes" its JSA
    // because the next shift gets a new id. SSO deep links pass it down
    // to WB T / WB JSA on launch (see appLauncher.ts).
    const shiftId = mintShiftId();
    let asyncStorageWriteOk = false;
    try {
      await setCurrentShiftId(shiftId);
      asyncStorageWriteOk = true;
    } catch (err) {
      console.warn('[startShift] setCurrentShiftId failed:', err);
    }
    // Drop any pending Post-Trip end-shift flag from a prior shift so the
    // new shift cannot inherit prior-shift DVIR routing state.
    import('../services/dvirGate')
      .then(({ createSuiteDvirGate }) =>
        createSuiteDvirGate({ isShiftActive: () => true }).clearDvirRoutingAfterFinalization(),
      )
      .catch(() => {});
    // (Pre-shift JSA preview breadcrumb cleanup removed — the Preview-JSA
    // launcher was retired 2026-05-01. Logout now wipes any lingering
    // breadcrumb on existing installs via LOGOUT_ASYNCSTORAGE_KEYS.)
    wbDiagLog({
      area: 'shift',
      event: 'shiftId.minted',
      source: 'AuthContext.startShift',
      result: 'ok',
      reason: 'fresh shiftId minted at Start Shift',
      driverHash: user.passcodeHash,
      shiftId,
      extra: {
        startTime,
        localDate,
        docId: `${user.driverId}_${localDate}`,
        asyncStorageWriteOk,
        companyId: user.companyId || null,
        packageId: packageId || user.defaultPackageId || null,
      },
    });
    // Set React state immediately so timer starts from the correct moment
    setShiftActive(true);
    setShiftStartTime(startTime);
    // Record login GPS event for DOT drive time (fire-and-forget)
    recordShiftEvent('login', user.driverId, user.legalName || user.displayName, user.companyId, 'wbs', shiftId).catch(err => console.warn('[startShift] recordShiftEvent failed:', err));
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

  // In-flight guards (6/11/2026) — block a double-tap from appending a duplicate
  // depart_return / logout while the first invocation is still resolving. The
  // record-layer transition guard is the ultimate safety net; these stop the bad
  // UI action from even firing.
  const returnInFlight = useRef(false);
  const arrivalInFlight = useRef(false);

  const startReturn = useCallback(async () => {
    if (!user) return;
    // Caller gate: Return-to-Yard is only valid during an OPEN shift, and not if
    // already returning — prevents a stray/duplicate depart_return.
    if (!shiftActive || returningToYard) return;
    if (returnInFlight.current) return;
    returnInFlight.current = true;
    try {
      const now = new Date().toISOString();
      // Record depart_return GPS event
      recordShiftEvent('depart_return', user.driverId, user.legalName || user.displayName, user.companyId).catch(() => {});
      await SecureStore.setItemAsync('returnDepartTime', now);
      setReturningToYard(true);
      setReturnDepartTime(now);
      console.log('[AuthContext] Return to yard started for:', user.displayName);
    } finally {
      returnInFlight.current = false;
    }
  }, [user, shiftActive, returningToYard]);

  const confirmArrival = useCallback(async (odometerMiles?: number) => {
    if (!user) return;
    // Caller gate: arrival ends an OPEN shift (active, or returning-to-yard). If
    // there's no open shift there is nothing to close — skip the logout write
    // (the record-layer guard would skip it anyway) and let navigation proceed.
    // This blocks the spurious second confirmArrival that produced the
    // "...logout -> depart_return -> logout" tail.
    if (!shiftActive && !returningToYard) return;
    if (arrivalInFlight.current) return;
    arrivalInFlight.current = true;
    try {
    // Record logout GPS event (arrival at yard = shift end)
    // Must await so day-summary screen can read the shift end time.
    // recordShiftEvent now retries once internally and returns a success flag —
    // observe it (was a swallowed .catch) so a failed shift-close is visible in
    // the logs instead of silently leaving the shift open.
    const shiftEndOk = await recordShiftEvent('logout', user.driverId, user.legalName || user.displayName, user.companyId).catch(() => false);
    if (!shiftEndOk) {
      console.warn('[confirmArrival] logout shift event did not persist after retry — shift may show open until next-login auto-close');
    }
    // NOTE: shiftId is intentionally NOT cleared here. Day Summary needs
    // it to scope the JSA query (jsa_day_status WHERE shiftId == X).
    // Clearing on confirmArrival caused getCurrentShiftId() to return
    // null on the Day Summary screen, scope fell back to the date string,
    // and the JSA wells/locations count rendered as 0 even when JSAs
    // were signed. The next shift's startShift mints a fresh shiftId and
    // overwrites this key — no risk of stale carryover. Real cleanup
    // happens on full logout (logoutWithCascade / logout below).
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
    // Clear pending Post-Trip routing + persist DVIR summary for Shift Complete.
    // Must await finalize so day-summary does not open on a stale Pre-Trip-only
    // Partial while Post-Trip receipt is already durable (fire-and-forget race).
    try {
      const { createSuiteDvirGate } = await import('../services/dvirGate');
      const { getCurrentShiftId: getSid } = await import('../services/shiftTracking');
      const gate = createSuiteDvirGate({
        isShiftActive: () => false,
        });
      await gate.clearDvirRoutingAfterFinalization();
      const sid = await getSid();
      if (sid) await gate.finalizeShiftDvirSummary(sid);
    } catch {
      /* non-blocking for navigation — hydrate path can still upgrade from receipts */
    }
    Promise.all([
      SecureStore.setItemAsync('shiftEnded', 'true'),
      SecureStore.deleteItemAsync('shiftStarted'),
      SecureStore.deleteItemAsync('returnDepartTime'),
    ]).catch(() => {});
    console.log('[AuthContext] Arrived at yard, shift ended for:', user.displayName);
    // No cascade here — day summary screen handles logout via logoutWithCascade
    } finally {
      arrivalInFlight.current = false;
    }
  }, [user, shiftActive, returningToYard]);

  const logoutWithCascade = useCallback(async () => {
    // Post-Trip gate: never complete logout while the active shift lacks
    // a durable Post-Trip receipt. Launch eQuipment and abort cleanup.
    // vc51.9C: NO null-shiftId escape hatch — the gate fails closed on a
    // missing id; the caller never pre-filters it away.
    if (shiftActive && user) {
      try {
        const { createSuiteDvirGate } = await import('../services/dvirGate');
        const gate = createSuiteDvirGate({ isShiftActive: () => true });
        const post = await gate.ensurePostTripGate({ alertOnBlock: true });
        if (!post.allowed) {
          console.log('[logoutWithCascade] blocked — Post-Trip required before logout');
          return;
        }
      } catch (err) {
        console.warn('[logoutWithCascade] Post-Trip gate error (blocking logout):', err);
        return;
      }
    }
    // Safety net: normally End Shift (confirmArrival) already closed the shift,
    // so shiftActive is false here and this is skipped. If a shift is somehow
    // still active when the full cascade logout runs, close the record first so
    // it doesn't linger open. Awaited + observed; never blocks the cascade.
    if (shiftActive && user) {
      const shiftEndOk = await recordShiftEvent('logout', user.driverId, user.legalName || user.displayName, user.companyId).catch(() => false);
      if (!shiftEndOk) {
        console.warn('[logoutWithCascade] logout shift event did not persist after retry — shift may show open until next-login auto-close');
      }
    }
    if (user) {
      // Write RTDB signal — apps for the same driverHash self-logout on
      // next foreground (manual + SSO both honor it as of 4/27/2026).
      // Deep-link cascade was retired here on 5/2/2026: launching WB T
      // during logout pollutes Android's task stack and the prior SSO
      // ${scheme}://login intent gets re-delivered, routing WB T to its
      // SSOLogin screen which silently re-authenticates the driver.
      // Field-confirmed regression. Each target app self-detects logoutAt
      // on cold start + warm resume — no foreground-launch needed.
      await writeLogoutSignal(user.passcodeHash);
    }
    await SecureStore.deleteItemAsync('shiftStarted');
    await SecureStore.deleteItemAsync('shiftEnded');
    await SecureStore.deleteItemAsync('returnDepartTime');
    await SecureStore.deleteItemAsync('activePackageId');
    clearCurrentShiftId().catch(() => {});
    // Match logout()'s cleanup: wipe per-shift / per-session AsyncStorage.
    await AsyncStorage.multiRemove([...LOGOUT_ASYNCSTORAGE_KEYS]).catch(() => {});
    wbDiagLog({
      area: 'logout',
      event: 'currentShiftId.cleared',
      source: 'AuthContext.logoutWithCascade',
      result: 'ok',
      reason: 'logoutWithCascade — full cascade end-of-day path',
      driverHash: user?.passcodeHash,
      extra: { trigger: 'logoutWithCascade' },
    });
    setShiftActive(false);
    setReturningToYard(false);
    setReturnDepartTime(null);
    setActivePackageId(null);
    // End the verified Auth session BEFORE local teardown, so a driver is
    // never left signed in to Firebase with local state already cleared.
    // secureSignOut swallows an unowned/absent session and still removes the
    // legacy token material, so logout completes even if sign-out fails.
    {
      // Cancel any in-flight login FIRST, so a sign-in still resolving
      // cannot land after teardown and resurrect the identity we are
      // logging out. Then end the verified session before local cleanup.
      const secure = await import('../services/secureDriverAuth');
      secure.invalidateAuthEpoch();
      // Take reconciliation ownership too: an in-flight reconciliation
      // for this driver must not publish state, or sign anything out,
      // after the next driver logs in.
      reconcileForIdentity(null);
      await secure.secureSignOut().catch(() => {});
    }
    await clearDriverSession();
    setUser(null);
  }, [shiftActive, user]);

  // Single logout function for all WB S logout buttons (4 home screens, etc.).
  // RTDB writeLogoutSignal is AWAITED so it lands before this WB S session is
  // torn down — critical for the cascade signal to reach WB T / WB M / WB eW
  // before they next foreground. The previous fire-and-forget pattern dropped
  // the RTDB write whenever WB S crashed or the process ended before the
  // network call flushed (field-confirmed 2026-05-01).
  const logout = useCallback(async () => {
    // Post-Trip gate for home-screen Log Out while shift still active.
    // vc51.9C: NO null-shiftId escape hatch — a lost cache key must not
    // silently skip the gate; ensurePostTripGate itself fails closed on
    // a missing id, so the GATE decides, never this caller.
    if (shiftActive && user) {
      try {
        const { createSuiteDvirGate } = await import('../services/dvirGate');
        const gate = createSuiteDvirGate({ isShiftActive: () => true });
        const post = await gate.ensurePostTripGate({ alertOnBlock: true });
        if (!post.allowed) {
          console.log('[logout] blocked — Post-Trip required before logout');
          return;
        }
      } catch (err) {
        console.warn('[logout] Post-Trip gate error (blocking logout):', err);
        return;
      }
    }
    // If shift is still active, end it as safety net before logging out.
    // Awaited + observed (was fire-and-forget) so the shift record is closed
    // before the cascade signal + cleanup. Bounded by recordShiftEvent's own
    // timeouts; logout always proceeds even if this write ultimately fails.
    if (shiftActive && user) {
      const shiftEndOk = await recordShiftEvent('logout', user.driverId, user.legalName || user.displayName, user.companyId).catch(() => false);
      if (!shiftEndOk) {
        console.warn('[logout] logout shift event did not persist after retry — shift may show open until next-login auto-close');
      }
    }
    if (user) {
      // Write RTDB signal — apps for the same driverHash self-logout on
      // next foreground. AWAITED so the PATCH lands before tear-down.
      // Deep-link cascade was retired here on 5/2/2026: launching WB T
      // during logout pollutes Android's task stack and the prior SSO
      // ${scheme}://login intent gets re-delivered, routing WB T to its
      // SSOLogin screen which silently re-authenticates the driver.
      // Field-confirmed regression. Each target app self-detects logoutAt
      // on cold start + warm resume — no foreground-launch needed.
      await writeLogoutSignal(user.passcodeHash);
    }
    await SecureStore.deleteItemAsync('shiftStarted');
    await SecureStore.deleteItemAsync('shiftEnded');
    await SecureStore.deleteItemAsync('returnDepartTime');
    await SecureStore.deleteItemAsync('activePackageId');
    clearCurrentShiftId().catch(() => {});
    // Wipe per-shift / per-session AsyncStorage state so the next login
    // starts cold. See LOGOUT_ASYNCSTORAGE_KEYS doc for what's included
    // and what survives intentionally.
    await AsyncStorage.multiRemove([...LOGOUT_ASYNCSTORAGE_KEYS]).catch(() => {});
    wbDiagLog({
      area: 'logout',
      event: 'currentShiftId.cleared',
      source: 'AuthContext.logout',
      result: 'ok',
      reason: 'logout — single awaited path (home screen Log Out button)',
      driverHash: user?.passcodeHash,
      extra: { trigger: 'logout', shiftActiveAtLogout: shiftActive },
    });
    setShiftActive(false);
    setReturningToYard(false);
    setReturnDepartTime(null);
    setActivePackageId(null);
    // End the verified Auth session BEFORE local teardown, so a driver is
    // never left signed in to Firebase with local state already cleared.
    // secureSignOut swallows an unowned/absent session and still removes the
    // legacy token material, so logout completes even if sign-out fails.
    {
      // Cancel any in-flight login FIRST, so a sign-in still resolving
      // cannot land after teardown and resurrect the identity we are
      // logging out. Then end the verified session before local cleanup.
      const secure = await import('../services/secureDriverAuth');
      secure.invalidateAuthEpoch();
      // Take reconciliation ownership too: an in-flight reconciliation
      // for this driver must not publish state, or sign anything out,
      // after the next driver logs in.
      reconcileForIdentity(null);
      await secure.secureSignOut().catch(() => {});
    }
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
      // An SSO deep link can install a DIFFERENT driver session while
      // the provider stays mounted, so this is an identity transition too.
      reconcileForIdentity({
        driverId: session.driverId,
        companyId: session.companyId || null,
      });
    }
  }, [reconcileForIdentity]);

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
