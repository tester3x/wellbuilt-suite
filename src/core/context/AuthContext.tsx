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
  hardFailRevalidationCleanup,
  verifyLogin,
  type DriverSession,
  saveDriverSession,
  submitRegistration,
  checkRegistrationStatus,
  completeRegistration,
  firebasePatch,
} from '../services/driverAuth';
import { recordShiftEvent, checkShiftOnResume, saveYardLocation, sendShiftStartToChat, mintShiftId, setCurrentShiftId, setCurrentShiftBinding, clearCurrentShiftId, getCurrentShiftId, observeEnforcementSafety } from '../services/shiftTracking';
import { loadDriverProfile, loadVehicleInfo } from '../services/driverProfile';
import * as Location from 'expo-location';
import { clearSSOLaunchedApps } from '../services/appLauncher';
import { wbDiagLog } from '../services/wbDiagLog';
import type { ShiftAuthorityUiState } from '../services/workPeriodAuthority/postLoginShiftRestoration';
import { createGenerationClock } from '../services/workPeriodAuthority/shiftSessionGuards';
import { classifyCloseOdometerMiles } from '../services/workPeriodAuthority/shiftSessionGuards';
import {
  decideEndShiftRoute,
  performEndShiftDirectClose,
  type PreTripSignal,
  type OperatedSignal,
  type ServerShiftState,
  type EndShiftRoute,
  type EndShiftDirectCloseResult,
} from '../services/workPeriodAuthority/endShiftDvirRouting';
import { registerLiveEquipmentShiftAuthority } from '../services/dvirGate/equipmentShiftLiveAuthority';
import {
  createAuthoritySessionMachine,
} from '../services/workPeriodAuthority/shiftAuthoritySessionSequencer';
import {
  issuedResolveLease,
  terminalizeIssuedResolve,
} from '../services/workPeriodAuthority/shiftAuthorityResolveRunner';
import {
  observeRevalidation,
  runUncertainSessionFailClosed,
  REVALIDATION_FAILED_UI,
} from '../services/workPeriodAuthority/revalidationFailClosed';
import { setSsoSessionGate } from '../services/ssoSessionGate';
import { notifySsoInboxSession, resetLiveSsoAuthorizeInbox } from '../services/ssoAuthorizeInbox';
import { bumpSsoIdentityEpoch } from '../services/ssoRuntime';
import {
  bindCompositeReadinessBridge,
  createCompositeReadinessBridge,
} from '../services/ssoCompositeReadiness';
import { subscribeGovernedHandoffChanged } from '../services/dvirGate/equipmentHandoffBinding';
import { executeSignOutSession } from '../services/signOutSession';

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
  /**
   * Server-authoritative shift UI gate (enforced explicit_shift).
   * checking | none | open | unavailable | legacy
   */
  shiftAuthorityUi: ShiftAuthorityUiState;
  /** True while Start Shift claim is in flight (single-flight busy). */
  startShiftBusy: boolean;
  /** Re-run resolveActiveDriverShift under enforced explicit (retry after unavailable). */
  refreshShiftAuthority: () => Promise<void>;
  /** Login with name + passcode. Returns error string or null on success. */
  login: (displayName: string, passcode: string) => Promise<{ success: boolean; error?: string }>;
  /**
   * Start shift — under enforced explicit_shift claims via server callable.
   * Returns ok:false when claim/authority refuses (caller must not launch Pre-Trip).
   * Always returns an explicit { ok } object — never void/undefined success.
   */
  startShift: (packageId?: string) => Promise<{ ok: boolean; reason?: string }>;
  /** The active package for this shift (set at shift start) */
  activePackageId: string | null;
  /**
   * Sign Out — terminates/cascades the authenticated Suite session only. It does
   * NOT end, close, or mutate an authoritative server shift, never runs Pre-Trip
   * or Post-Trip, and never writes pendingEndShiftId. An open shift is left open
   * and restored on re-login; End Shift is the only action that closes a shift.
   */
  logout: () => Promise<void>;
  /** Start the return-to-yard drive (captures GPS, writes depart_return event) */
  startReturn: () => Promise<void>;
  /**
   * Confirm arrival at yard — server close under enforcement.
   * Returns false when close is blocked (invalid odometer, close failure, etc.)
   * so the UI can keep the modal open for retry.
   */
  confirmArrival: (odometerMiles?: number) => Promise<boolean>;
  /**
   * Decide how the End Shift action should route for the current shift, based on
   * the canonical vehicle/DVIR (Post-Trip) obligation signal — WITHOUT acting:
   *   - 'existing_flow'     → governed return/arrival/Post-Trip (obligation, or legacy).
   *   - 'direct_close'      → no vehicle/DVIR obligation; ordinary End Shift may close.
   *   - 'verify_obligation' → obligation unknown/unavailable; reconcile, never bypass.
   */
  resolveEndShiftRoute: () => Promise<EndShiftRoute>;
  /**
   * Reconcile a stale local returning/shift state against the authenticated
   * server authority. If the server has NO open period, clear local returning/
   * shift state ONLY (no server event of any kind). Returns 'cleared' on an
   * authoritative 'none' ack, 'not_none' if the server still has an open period
   * (or authority not live), 'error' on failure. Never guesses or fabricates.
   */
  reconcileStaleReturningShift: () => Promise<'cleared' | 'not_none' | 'error'>;
  /**
   * Ordinary End Shift for a shift with no vehicle/DVIR obligation: closes the
   * work period via the existing authoritative closeDriverShift — no EN ROUTE,
   * no Mark Arrived, no Post-Trip, no arrival/inspection/odometer/marker. Full
   * shift duration is preserved. On failure the shift is left open and retryable.
   * Idempotent. Separate from Sign Out, which never closes a shift.
   */
  closeShiftDirect: () => Promise<EndShiftDirectCloseResult>;
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
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const { getApp } = await import('firebase/app');
    const fn = httpsCallable(getFunctions(getApp()), 'signalDriverLogout');
    await fn({ logoutAt: Date.now() });
    console.log('[AuthContext] logoutAt signal written via signalDriverLogout');
  } catch (err) {
    console.warn('[AuthContext] Failed to write logoutAt via callable:', err);
    try {
      await firebasePatch(`drivers/approved/${passcodeHash}`, {
        logoutAt: new Date().toISOString(),
      });
    } catch (legacyErr) {
      console.warn('[AuthContext] Failed to write logoutAt:', legacyErr);
    }
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [shiftActive, setShiftActive] = useState(false);
  // DVIR line (128edb7): expose the live shift-active state + current period to the
  // equipment SSO binding so WB-E resolves the authoritative shift. Preserved during
  // the SSO/session-gate integration.
  const liveShiftActiveRef = useRef(false);
  liveShiftActiveRef.current = shiftActive;
  useEffect(() => {
    registerLiveEquipmentShiftAuthority({
      isShiftActive: () => liveShiftActiveRef.current,
      getPeriodId: getCurrentShiftId,
    });
    return () => registerLiveEquipmentShiftAuthority(null);
  }, []);
  const [shiftStartTime, setShiftStartTime] = useState<string | null>(null);
  const [returningToYard, setReturningToYard] = useState(false);
  const [returnDepartTime, setReturnDepartTime] = useState<string | null>(null);
  const [activePackageId, setActivePackageId] = useState<string | null>(null);
  /** Default legacy until company enforcement is known. */
  const [shiftAuthorityUi, setShiftAuthorityUi] = useState<ShiftAuthorityUiState>({ kind: 'legacy' });
  const [startShiftBusy, setStartShiftBusy] = useState(false);
  /**
   * Session/authority generation — bumped on login identity, logout, cascade,
   * and provider unmount. Async resolve/claim/refresh must capture and re-check
   * so stale results never mutate a newer session.
   */
  const authorityGenRef = useRef(createGenerationClock());
  const authoritySessionRef = useRef(createAuthoritySessionMachine());
  const startShiftInFlightRef = useRef(false);
  const bumpAuthorityGeneration = useCallback((reason: string) => {
    const n = authorityGenRef.current.bump(reason);
    console.log(JSON.stringify({ tag: '[shiftAuthority]', event: 'generation.bump', reason, gen: n }));
    return n;
  }, []);
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
  const currentLocalRef = useRef<{ driverId: string; companyId: string | null } | null>(null);
  const readinessGenRef = useRef(0);

  const reconcileForIdentity = useCallback(
    (
      local: { driverId: string; companyId: string | null } | null,
      opts?: { force?: boolean },
    ) => {
      const key = local ? `${local.driverId}|${local.companyId ?? ''}` : '<none>';
      // `force` re-runs same-identity reconciliation — the composite-readiness
      // retry after a successful revalidation (the cold-start ordering fix, where
      // reconciliation first returned local-only/unavailable before the SDK
      // session existed). The plain call still deduplicates per identity, so
      // reconciledForRef never PERMANENTLY suppresses a needed reconciliation.
      if (!opts?.force && reconciledForRef.current === key) return;
      reconciledForRef.current = key;
      currentLocalRef.current = local;
      // Capture THIS operation's generation now. The result reports only with
      // this value — never with whatever readinessGenRef.current is later.
      const gen = readinessGenRef.current;
      void import('../services/authReconciliation')
        .then(async (m) => {
          m.invalidateReconciliation();
          const state = await m.reconcileRestoredSession(local);
          compositeReadinessRef.current.reportReconciliation(gen, state);
          return state;
        })
        // Observed, not ignored: reconciliation failing must never surface
        // as an unhandled rejection, and must never block app entry.
        .catch((err) => {
          console.warn('[AuthContext] reconciliation failed:', err);
        });
    },
    [],
  );

  // Composite, generation-owned SSO readiness. The inbox gate goes `ready` ONLY
  // when secure revalidation succeeded AND reconciliation is verified for the
  // SAME generation — never from revalidation/authVerified alone. A genuinely
  // unverifiable session terminalizes so a queued request gets a bounded error.
  const compositeReadinessRef = useRef(
    createCompositeReadinessBridge({
      onPublish: ({ gate, equipment, terminalReason }) => {
        setSsoSessionGate(gate);
        notifySsoInboxSession(gate, equipment, terminalReason);
      },
      onRetryReconciliation: () =>
        reconcileForIdentity(currentLocalRef.current, { force: true }),
      readHandoff: async () => {
        const { hydrateGovernedEquipmentHandoff } = await import(
          '../services/dvirGate/equipmentHandoffBinding'
        );
        const rec = await hydrateGovernedEquipmentHandoff();
        if (!rec) return null;
        return { shiftId: rec.shiftId, phase: rec.phase, expiresAtMs: rec.expiresAtMs };
      },
    }),
  );
  const resetSsoReadiness = useCallback((): number => {
    const gen = (readinessGenRef.current += 1);
    compositeReadinessRef.current.reset(gen);
    return gen;
  }, []);
  const reportSsoRevalidation = useCallback(
    (gen: number, outcome: 'ok' | 'failed') =>
      compositeReadinessRef.current.reportRevalidation(gen, outcome),
    [],
  );

  useEffect(() => {
    bindCompositeReadinessBridge(compositeReadinessRef.current);
    const offHandoff = subscribeGovernedHandoffChanged(() => {
      compositeReadinessRef.current.reconsiderEquipmentHandoff();
    });
    return () => {
      bindCompositeReadinessBridge(null);
      offHandoff();
    };
  }, []);

  const failClosedUncertainSession = useCallback(async (reason: string) => {
    const cleanup = await runUncertainSessionFailClosed({
      applyMemory: () => {
        authoritySessionRef.current.dispatch({ type: 'session_failed' });
        // Terminal session failure — composite readiness fails closed (returns a
        // bounded error callback to any queued authorize; never a code).
        reportSsoRevalidation(readinessGenRef.current, 'failed');
        resetLiveSsoAuthorizeInbox();
        bumpSsoIdentityEpoch();
        bumpAuthorityGeneration(reason);
        startShiftInFlightRef.current = false;
        setStartShiftBusy(false);
        reconcileForIdentity(null);
        setUser(null);
        setShiftAuthorityUi(REVALIDATION_FAILED_UI);
        setShiftActive(false);
      },
      cleanup: hardFailRevalidationCleanup,
    });
    if (cleanup === 'cleanup_failed') {
      console.log('[AuthContext] revalidation.cleanup_failed');
    }
  }, [bumpAuthorityGeneration, reconcileForIdentity]);

  // Provider disposal invalidates all in-flight authority work.
  useEffect(() => {
    return () => {
      bumpAuthorityGeneration('provider_unmount');
      startShiftInFlightRef.current = false;
    };
  }, [bumpAuthorityGeneration]);

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
        // Establish the composite-readiness generation for this restore BEFORE
        // reconciliation starts, so its verdict is attributed to this flow and a
        // prior driver's late verdict cannot drive this gate.
        const restoreReadinessGen = resetSsoReadiness();
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

          // Local flags are hints only. Under explicit_shift, cold start must
          // consult server resolveActiveDriverShift (never resume-login write).
          const shiftStarted = await SecureStore.getItemAsync('shiftStarted');
          const shiftEnded = await SecureStore.getItemAsync('shiftEnded');
          const priorLocalActive = shiftStarted === 'true' && shiftEnded !== 'true';
          setShiftActive(priorLocalActive);
          if (priorLocalActive) {
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

          // Hold Start Shift until secure-session revalidation completes.
          // Canonical cold start used to launch resolveActiveDriverShift in
          // parallel with revalidateDriverSession; driver_session_required
          // froze the tile on Unavailable because success never re-resolved.
          const gen = authorityGenRef.current.current();
          const held = authoritySessionRef.current.dispatch({ type: 'cold_start' });
          setShiftAuthorityUi(held.state.ui);
          console.log(JSON.stringify({ tag: '[shiftAuthority]', event: 'session.hold_until_revalidate' }));

          void (async () => {
            const observed = await observeRevalidation(() => revalidateDriverSession());
            if (observed.outcome === 'failed') {
              console.log('[AuthContext] Background revalidation failed — fail closed');
              await failClosedUncertainSession(
                observed.cause === 'rejected' ? 'revalidation_rejected' : 'revalidation_hard_fail',
              );
              return;
            }

            const freshSession = await getDriverSession();
            if (freshSession) {
              setUser(sessionToUser(freshSession));
            }
            // Revalidation succeeded — report OK. The inbox goes `ready` only
            // once reconciliation is ALSO verified for this generation.
            reportSsoRevalidation(restoreReadinessGen, 'ok');
            if (!authorityGenRef.current.isCurrent(gen)) return;

            const live = freshSession || session;
            try {
              const companyId = live.companyId || '';
              if (!companyId) {
                if (!authorityGenRef.current.isCurrent(gen)) return;
                setShiftAuthorityUi({ kind: 'legacy' });
                compositeReadinessRef.current.reportEquipmentRestoration(restoreReadinessGen, 'none');
                if (priorLocalActive) {
                  checkShiftOnResume(
                    live.driverId,
                    live.legalName || live.displayName,
                    live.companyId,
                  ).catch(() => {});
                }
                return;
              }
              const [
                { fetchCompanyConfig },
                { parseSuiteEnforcement },
                { isEnforcedExplicitShift },
                { postLoginEnforcedRestore },
              ] = await Promise.all([
                import('../services/companyConfig'),
                import('../services/workPeriodAuthority/suiteShiftAuthority'),
                import('../services/workPeriodAuthority/postLoginShiftRestoration'),
                import('../services/workPeriodAuthority/explicitShiftLifecycle'),
              ]);
              const cfg = await fetchCompanyConfig(companyId);
              const enforcement = parseSuiteEnforcement(cfg ?? undefined);
              const cached = await getCurrentShiftId();

              if (!isEnforcedExplicitShift(enforcement)) {
                if (!authorityGenRef.current.isCurrent(gen)) return;
                setShiftAuthorityUi({ kind: 'legacy' });
                compositeReadinessRef.current.reportEquipmentRestoration(restoreReadinessGen, 'none');
                if (priorLocalActive) {
                  checkShiftOnResume(
                    live.driverId,
                    live.legalName || live.displayName,
                    live.companyId,
                    'wbs',
                    cached,
                    { enforcedExplicit: false },
                  ).catch(() => {});
                }
                return;
              }

              const ready = authoritySessionRef.current.dispatch({ type: 'session_ready' });
              if (ready.applyUi) setShiftAuthorityUi(ready.state.ui);
              const lease = issuedResolveLease(ready.commands);
              if (!lease) return;

              const term = await terminalizeIssuedResolve({
                machine: authoritySessionRef.current,
                lease,
                isCurrent: () => authorityGenRef.current.isCurrent(gen),
                restore: () => postLoginEnforcedRestore({
                  enforcement,
                  flags: {
                    setShiftActive,
                    setShiftStartTime,
                  },
                  gate: { isCurrent: () => authorityGenRef.current.isCurrent(gen) },
                }),
              });
              if (term.abandoned || !term.applyUi || !term.ui) return;
              setShiftAuthorityUi(term.ui);
              if (term.ui.kind === 'open') {
                compositeReadinessRef.current.reportEquipmentRestoration(
                  restoreReadinessGen,
                  'open',
                  term.ui.periodId,
                );
                console.log('[AuthContext] Cold-start restored explicit shift via server resolve');
              } else if (term.ui.kind === 'none') {
                compositeReadinessRef.current.reportEquipmentRestoration(restoreReadinessGen, 'none');
                console.log('[AuthContext] Cold-start authority: no open shift (server_none)');
              } else {
                compositeReadinessRef.current.reportEquipmentRestoration(restoreReadinessGen, 'failed');
                console.log(
                  '[AuthContext] Cold-start leave inactive (' +
                    (term.ui.kind === 'unavailable' ? term.ui.reason : 'leave') +
                    ')',
                );
              }
            } catch (err) {
              console.warn('[AuthContext] Cold-start shift restore failed closed:', err);
              if (!authorityGenRef.current.isCurrent(gen)) return;
              const inflight = authoritySessionRef.current.peek().inFlight;
              if (inflight && inflight.generation === authoritySessionRef.current.peek().generation) {
                const term = await terminalizeIssuedResolve({
                  machine: authoritySessionRef.current,
                  lease: inflight,
                  isCurrent: () => authorityGenRef.current.isCurrent(gen),
                  restore: async () => {
                    throw err instanceof Error ? err : new Error('cold_start_error');
                  },
                });
                if (term.applyUi && term.ui) setShiftAuthorityUi(term.ui);
              } else {
                setShiftAuthorityUi({ kind: 'unavailable', reason: 'cold_start_error' });
              }
              if (!priorLocalActive) {
                setShiftActive(false);
              }
            }
          })();
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
      // New identity — invalidate any in-flight resolve/claim from prior session.
      const loginGen = bumpAuthorityGeneration('login_identity');
      authoritySessionRef.current.dispatch({ type: 'reset' });
      const loginReadinessGen = resetSsoReadiness();
      resetLiveSsoAuthorizeInbox();
      bumpSsoIdentityEpoch();
      startShiftInFlightRef.current = false;
      setStartShiftBusy(false);

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

      // ── Explicit-shift restoration via server resolve (never mint on login) ──
      try {
        const companyId = result.companyId || '';
        const [{ fetchCompanyConfig }, { parseSuiteEnforcement, mayUseDateFallback }, { isEnforcedExplicitShift }, { postLoginEnforcedRestore }] =
          await Promise.all([
            import('../services/companyConfig'),
            import('../services/workPeriodAuthority/suiteShiftAuthority'),
            import('../services/workPeriodAuthority/postLoginShiftRestoration'),
            import('../services/workPeriodAuthority/explicitShiftLifecycle'),
          ]);
        const cfg = companyId ? await fetchCompanyConfig(companyId) : null;
        const enforcement = parseSuiteEnforcement(cfg ?? undefined);

        if (isEnforcedExplicitShift(enforcement)) {
          if (!result.authVerified) {
            // Legacy dual-run login cannot call shift authority callables.
            if (!authorityGenRef.current.isCurrent(loginGen)) return { success: true };
            // Legacy login cannot establish a secure SDK session → readiness fails
            // closed (queued authorize gets a bounded error, not a hang).
            reportSsoRevalidation(loginReadinessGen, 'failed');
            setShiftAuthorityUi({ kind: 'unavailable', reason: 'driver_session_required' });
            await SecureStore.deleteItemAsync('shiftStarted');
            setShiftActive(false);
            setShiftStartTime(null);
            console.log(
              '[AuthContext] Post-login shift blocked — secure SDK session required for explicit_shift',
            );
          } else {
            if (!authorityGenRef.current.isCurrent(loginGen)) return { success: true };
            // Secure SDK session established — report OK; the gate goes ready only
            // once reconciliation is also verified for this login generation.
            reportSsoRevalidation(loginReadinessGen, 'ok');
            const ready = authoritySessionRef.current.dispatch({ type: 'session_ready' });
            if (ready.applyUi) setShiftAuthorityUi(ready.state.ui);
            const lease = issuedResolveLease(ready.commands);
            if (!lease) {
              console.log('[AuthContext] Post-login resolve skipped — sequencer');
            } else {
              const term = await terminalizeIssuedResolve({
                machine: authoritySessionRef.current,
                lease,
                isCurrent: () => authorityGenRef.current.isCurrent(loginGen),
                restore: () => postLoginEnforcedRestore({
                  enforcement,
                  flags: { setShiftActive, setShiftStartTime },
                  gate: { isCurrent: () => authorityGenRef.current.isCurrent(loginGen) },
                }),
              });
              if (term.abandoned) {
                console.log('[AuthContext] Post-login resolve stale — discarded');
              } else if (term.applyUi && term.ui) {
                setShiftAuthorityUi(term.ui);
                if (term.ui.kind === 'open') {
                  compositeReadinessRef.current.reportEquipmentRestoration(
                    loginReadinessGen,
                    'open',
                    term.ui.periodId,
                  );
                  const savedPkgId = await SecureStore.getItemAsync('activePackageId');
                  if (savedPkgId && authorityGenRef.current.isCurrent(loginGen)) {
                    setActivePackageId(savedPkgId);
                  }
                  console.log('[AuthContext] Restored explicit shift after login via server resolve');
                } else if (term.ui.kind === 'none') {
                  compositeReadinessRef.current.reportEquipmentRestoration(loginReadinessGen, 'none');
                  setActivePackageId(null);
                  await SecureStore.deleteItemAsync('activePackageId');
                  console.log('[AuthContext] Post-login authority: no open shift (server_none)');
                } else {
                  compositeReadinessRef.current.reportEquipmentRestoration(loginReadinessGen, 'failed');
                  console.log(
                    '[AuthContext] Post-login shift restore blocked (' +
                      (term.ui.kind === 'unavailable' ? term.ui.reason : 'blocked') +
                      ') — Start Shift disabled until authority clears',
                  );
                }
              }
            }
          }
        } else if (mayUseDateFallback(enforcement)) {
          if (!authorityGenRef.current.isCurrent(loginGen)) return { success: true };
          // Legacy/inert: established clean-slate on fresh login.
          setShiftAuthorityUi({ kind: 'legacy' });
          compositeReadinessRef.current.reportEquipmentRestoration(loginReadinessGen, 'none');
          await SecureStore.deleteItemAsync('shiftEnded');
          await SecureStore.deleteItemAsync('shiftStarted');
          await SecureStore.deleteItemAsync('activePackageId');
          await clearCurrentShiftId();
          setShiftActive(false);
          setShiftStartTime(null);
          setActivePackageId(null);
        } else {
          if (!authorityGenRef.current.isCurrent(loginGen)) return { success: true };
          // invalid / unknown contract — fail closed (no mint from local flags)
          setShiftAuthorityUi({ kind: 'unavailable', reason: 'enforcement_invalid' });
          compositeReadinessRef.current.reportEquipmentRestoration(loginReadinessGen, 'failed');
          await SecureStore.deleteItemAsync('shiftStarted');
          setShiftActive(false);
          setShiftStartTime(null);
        }
      } catch (err) {
        console.warn('[AuthContext] Post-login shift restore failed closed:', err);
        if (authorityGenRef.current.isCurrent(loginGen)) {
          const inflight = authoritySessionRef.current.peek().inFlight;
          if (inflight && inflight.generation === authoritySessionRef.current.peek().generation) {
            const term = await terminalizeIssuedResolve({
              machine: authoritySessionRef.current,
              lease: inflight,
              isCurrent: () => authorityGenRef.current.isCurrent(loginGen),
              restore: async () => {
                throw err instanceof Error ? err : new Error('post_login_error');
              },
            });
            if (term.applyUi && term.ui) setShiftAuthorityUi(term.ui);
          } else {
            setShiftAuthorityUi({ kind: 'unavailable', reason: 'post_login_error' });
          }
          await SecureStore.deleteItemAsync('shiftStarted');
          setShiftActive(false);
          setShiftStartTime(null);
        }
      }

      if (result.authVerified) {
        reportSsoRevalidation(loginReadinessGen, 'ok');
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
  }, [bumpAuthorityGeneration]);

  const startShift = useCallback(async (packageId?: string): Promise<{ ok: boolean; reason?: string }> => {
    if (!user) return { ok: false, reason: 'no_user' };
    // Single-flight: first confirm owns the operation; later taps no-op.
    if (startShiftInFlightRef.current) {
      return { ok: false, reason: 'in_flight' };
    }
    startShiftInFlightRef.current = true;
    setStartShiftBusy(true);
    const gen = authorityGenRef.current.current();
    // Capture timestamp FIRST — before any awaits steal seconds
    const startTime = new Date().toISOString();
    const _now = new Date();
    const localDate = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
    const pkg = packageId || user.defaultPackageId || null;

    try {
      if (!authorityGenRef.current.isCurrent(gen)) {
        return { ok: false, reason: 'stale_generation' };
      }
      const [{ fetchCompanyConfig }, { parseSuiteEnforcement }, { isEnforcedExplicitShift }, { claimEnforcedExplicitStart }] =
        await Promise.all([
          import('../services/companyConfig'),
          import('../services/workPeriodAuthority/suiteShiftAuthority'),
          import('../services/workPeriodAuthority/postLoginShiftRestoration'),
          import('../services/workPeriodAuthority/explicitShiftLifecycle'),
        ]);
      const cfg = user.companyId ? await fetchCompanyConfig(user.companyId) : null;
      const enforcement = parseSuiteEnforcement(cfg ?? undefined);

      // ── Enforced explicit_shift: server claim only (no client login REST) ──
      if (isEnforcedExplicitShift(enforcement)) {
        if (shiftAuthorityUi.kind !== 'none' && shiftAuthorityUi.kind !== 'checking') {
          // Still allow claim attempt if UI is stale none-check; resolve re-runs inside claim.
          if (shiftAuthorityUi.kind === 'open' || shiftAuthorityUi.kind === 'unavailable') {
            console.log('[startShift] refused — authority UI kind=' + shiftAuthorityUi.kind);
            return { ok: false, reason: shiftAuthorityUi.kind === 'unavailable' ? shiftAuthorityUi.reason : 'open_explicit_shift_exists' };
          }
        }
        const claim = await claimEnforcedExplicitStart({
          flags: { setShiftActive, setShiftStartTime },
          packageId: pkg,
          startTimeIso: startTime,
          gate: { isCurrent: () => authorityGenRef.current.isCurrent(gen) },
        });
        if (!authorityGenRef.current.isCurrent(gen)) {
          return { ok: false, reason: 'stale_generation' };
        }
        if (!claim.ok) {
          if (claim.openPeriodId) {
            setShiftAuthorityUi({
              kind: 'open',
              periodId: claim.openPeriodId,
              originLocalDate: claim.openPeriodId.slice(0, 10),
            });
            compositeReadinessRef.current.reportEquipmentRestoration(
              readinessGenRef.current,
              'open',
              claim.openPeriodId,
            );
          } else {
            setShiftAuthorityUi({ kind: 'unavailable', reason: claim.reason });
            compositeReadinessRef.current.reportEquipmentRestoration(
              readinessGenRef.current,
              'failed',
            );
          }
          console.log('[startShift] refused claim — ' + claim.reason);
          return { ok: false, reason: claim.reason };
        }
        setShiftAuthorityUi({
          kind: 'open',
          periodId: claim.periodId,
          originLocalDate: claim.originLocalDate,
        });
        compositeReadinessRef.current.reportEquipmentRestoration(
          readinessGenRef.current,
          'open',
          claim.periodId,
        );
        import('../services/dvirGate')
          .then(({ createSuiteDvirGate }) =>
            createSuiteDvirGate({ isShiftActive: () => true }).clearDvirRoutingAfterFinalization(),
          )
          .catch(() => {});
        if (user.companyId) {
          sendShiftStartToChat(user.driverId, user.legalName || user.displayName, user.companyId).catch(() => {});
        }
        if (pkg) {
          await SecureStore.setItemAsync('activePackageId', pkg);
          if (authorityGenRef.current.isCurrent(gen)) setActivePackageId(pkg);
        }
        if (!authorityGenRef.current.isCurrent(gen)) {
          return { ok: false, reason: 'stale_generation' };
        }
        wbDiagLog({
          area: 'shift',
          event: 'shiftId.claimed',
          source: 'AuthContext.startShift',
          result: 'ok',
          reason: claim.claimed ? 'server claim' : 'adopted existing binding',
          shiftId: claim.periodId,
          extra: {
            startTime,
            originLocalDate: claim.originLocalDate,
            claimed: claim.claimed,
            packageId: pkg,
          },
        });
        console.log('[AuthContext] Shift claimed for:', user.displayName, 'package:', pkg || 'none');
        return { ok: true };
      }

      // ── Legacy / inert: local mint + direct REST login (unchanged) ──
      const [{ decidePreMintShiftGate }, { fetchShiftDayDoc }] = await Promise.all([
        import('../services/workPeriodAuthority/postLoginShiftRestoration'),
        import('../services/shiftTracking'),
      ]);
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
          await setCurrentShiftId(gate.openPeriodId);
          await SecureStore.setItemAsync('shiftStarted', 'true');
          await SecureStore.deleteItemAsync('shiftEnded');
          setShiftActive(true);
          console.log('[startShift] refused mint — open restored periodId=' + gate.openPeriodId);
        } else {
          console.log('[startShift] refused mint — ' + gate.reason);
        }
        return { ok: false, reason: gate.reason };
      }
      if (cached) await clearCurrentShiftId();

      const shiftId = mintShiftId();
      let asyncStorageWriteOk = false;
      try {
        await setCurrentShiftBinding(shiftId, shiftId.slice(0, 10));
        asyncStorageWriteOk = true;
      } catch (err) {
        console.warn('[startShift] setCurrentShiftBinding failed:', err);
      }
      import('../services/dvirGate')
        .then(({ createSuiteDvirGate }) =>
          createSuiteDvirGate({ isShiftActive: () => true }).clearDvirRoutingAfterFinalization(),
        )
        .catch(() => {});
      wbDiagLog({
        area: 'shift',
        event: 'shiftId.minted',
        source: 'AuthContext.startShift',
        result: 'ok',
        reason: 'legacy path local mint',
        shiftId,
        extra: { startTime, localDate, asyncStorageWriteOk, packageId: pkg },
      });
      setShiftActive(true);
      setShiftStartTime(startTime);
      setShiftAuthorityUi({ kind: 'legacy' });
      recordShiftEvent(
        'login',
        user.driverId,
        user.legalName || user.displayName,
        user.companyId,
        'wbs',
        shiftId,
        { enforcedExplicit: false, allowDirectWrite: true },
      ).catch((err) => console.warn('[startShift] recordShiftEvent failed:', err));
      if (user.companyId) {
        sendShiftStartToChat(user.driverId, user.legalName || user.displayName, user.companyId).catch(() => {});
      }
      await SecureStore.setItemAsync('shiftStarted', 'true');
      await SecureStore.setItemAsync('shiftStartTime', startTime);
      await SecureStore.deleteItemAsync('shiftEnded');
      if (pkg) {
        await SecureStore.setItemAsync('activePackageId', pkg);
        setActivePackageId(pkg);
      }
      if (!authorityGenRef.current.isCurrent(gen)) {
        return { ok: false, reason: 'stale_generation' };
      }
      console.log('[AuthContext] Shift started (legacy) for:', user.displayName);
      return { ok: true };
    } catch (err) {
      console.warn('[startShift] failed closed:', err);
      return { ok: false, reason: 'start_shift_error' };
    } finally {
      // Release single-flight only if this attempt still owns the slot and
      // generation is current (logout bumps gen and clears busy separately).
      if (authorityGenRef.current.isCurrent(gen)) {
        startShiftInFlightRef.current = false;
        setStartShiftBusy(false);
      } else {
        startShiftInFlightRef.current = false;
      }
    }
  }, [user, shiftAuthorityUi]);

  // In-flight guards (6/11/2026) — block a double-tap from appending a duplicate
  // depart_return / logout while the first invocation is still resolving. The
  // record-layer transition guard is the ultimate safety net; these stop the bad
  // UI action from even firing.
  const returnInFlight = useRef(false);
  const arrivalInFlight = useRef(false);
  const directCloseInFlight = useRef(false);
  const reconcileInFlight = useRef(false);

  const startReturn = useCallback(async () => {
    if (!user) return;
    // Caller gate: Return-to-Yard is only valid during an OPEN shift, and not if
    // already returning — prevents a stray/duplicate depart_return.
    if (!shiftActive || returningToYard) return;
    if (returnInFlight.current) return;
    returnInFlight.current = true;
    try {
      const now = new Date().toISOString();
      const [{ fetchCompanyConfig }, { parseSuiteEnforcement }, { isEnforcedExplicitShift }, { recordEnforcedDepartReturn }] =
        await Promise.all([
          import('../services/companyConfig'),
          import('../services/workPeriodAuthority/suiteShiftAuthority'),
          import('../services/workPeriodAuthority/postLoginShiftRestoration'),
          import('../services/workPeriodAuthority/explicitShiftLifecycle'),
        ]);
      const cfg = user.companyId ? await fetchCompanyConfig(user.companyId) : null;
      const enforcement = parseSuiteEnforcement(cfg ?? undefined);

      if (isEnforcedExplicitShift(enforcement)) {
        const periodId = await getCurrentShiftId();
        const result = await recordEnforcedDepartReturn({ periodId });
        if (!result.ok) {
          console.warn('[AuthContext] recordDepartReturn failed — not entering return state:', result.reason);
          return;
        }
      } else {
        recordShiftEvent(
          'depart_return',
          user.driverId,
          user.legalName || user.displayName,
          user.companyId,
          'wbs',
          undefined,
          { enforcedExplicit: false, allowDirectWrite: true },
        ).catch(() => {});
      }
      await SecureStore.setItemAsync('returnDepartTime', now);
      setReturningToYard(true);
      setReturnDepartTime(now);
      console.log('[AuthContext] Return to yard started for:', user.displayName);
    } finally {
      returnInFlight.current = false;
    }
  }, [user, shiftActive, returningToYard]);

  const confirmArrival = useCallback(async (odometerMiles?: number): Promise<boolean> => {
    if (!user) return false;
    // Caller gate: arrival ends an OPEN shift (active, or returning-to-yard). If
    // there's no open shift there is nothing to close — skip the logout write
    // (the record-layer guard would skip it anyway) and let navigation proceed.
    // This blocks the spurious second confirmArrival that produced the
    // "...logout -> depart_return -> logout" tail.
    if (!shiftActive && !returningToYard) return false;
    if (arrivalInFlight.current) return false;
    arrivalInFlight.current = true;
    try {
    const [{ fetchCompanyConfig }, { parseSuiteEnforcement }, { isEnforcedExplicitShift }, { closeEnforcedExplicit }] =
      await Promise.all([
        import('../services/companyConfig'),
        import('../services/workPeriodAuthority/suiteShiftAuthority'),
        import('../services/workPeriodAuthority/postLoginShiftRestoration'),
        import('../services/workPeriodAuthority/explicitShiftLifecycle'),
      ]);
    const cfg = user.companyId ? await fetchCompanyConfig(user.companyId) : null;
    const enforcement = parseSuiteEnforcement(cfg ?? undefined);
    const periodId = await getCurrentShiftId();

    let shiftEndOk = false;
    if (isEnforcedExplicitShift(enforcement)) {
      // Server close: periodId + optional total miles (0..5000). No client logout/REST.
      // Present-but-invalid miles must NOT silently omit and close.
      const odo = classifyCloseOdometerMiles(odometerMiles);
      if (odo.kind === 'invalid') {
        console.warn('[confirmArrival] invalid odometer miles — close blocked:', odo.reason);
        return false;
      }
      const closed = await closeEnforcedExplicit({
        periodId,
        odometerMiles: odo.kind === 'valid' ? odo.miles : undefined,
        gate: { isCurrent: () => true },
      });
      shiftEndOk = closed.ok;
      if (!shiftEndOk) {
        console.warn(
          '[confirmArrival] closeDriverShift failed — retaining active local state:',
          closed.reason,
        );
        // Do not clear local active flags on failed close.
        return false;
      }
    } else {
      shiftEndOk = await recordShiftEvent(
        'logout',
        user.driverId,
        user.legalName || user.displayName,
        user.companyId,
        'wbs',
        periodId || undefined,
        { enforcedExplicit: false, allowDirectWrite: true },
      ).catch(() => false);
      if (!shiftEndOk) {
        console.warn('[confirmArrival] logout shift event did not persist after retry — shift may show open until next-login auto-close');
      }
      // Legacy: odometer via REST on day doc
      if (odometerMiles != null && odometerMiles > 0) {
        import('../services/shiftTracking').then(({ writeOdometerMiles }) =>
          writeOdometerMiles(user.driverId, odometerMiles, { enforcedExplicit: false }).catch(() => {}));
      }
    }
    // NOTE: shiftId is intentionally NOT cleared here. Day Summary needs
    // it to scope the JSA query (jsa_day_status WHERE shiftId == X).
    // Real cleanup happens on full logout (logoutWithCascade / logout below).
    Location.getLastKnownPositionAsync().then(loc => {
      if (loc) saveYardLocation(loc.coords.latitude, loc.coords.longitude).catch(() => {});
    }).catch(() => {});
    // Update local state + SecureStore only after successful close (enforced) or best-effort (legacy)
    setShiftActive(false);
    setReturningToYard(false);
    setReturnDepartTime(null);
    setShiftAuthorityUi(isEnforcedExplicitShift(enforcement) ? { kind: 'none' } : { kind: 'legacy' });
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
    return true;
    } finally {
      arrivalInFlight.current = false;
    }
  }, [user, shiftActive, returningToYard]);

  // Canonical DVIR signals for the shift.
  //   preTrip:  a matching Pre-Trip receipt, or an armed pending Post-Trip — the
  //             same durable signals the Post-Trip gate uses. 'indeterminate' when
  //             the receipt store cannot be read (never assumed absent).
  //   operated: whether the inspected equipment was actually driven. WB-S has NO
  //             durable, period-attributed operation signal today (its only
  //             "depart" is the return-to-yard leg; WB-T's depart is invoice-
  //             scoped, not period-attributed), so this is truthfully 'unknown'.
  //             The routing fails safe on 'unknown' (require Post-Trip when a
  //             Pre-Trip exists) — it never fabricates operation or bypasses.
  //             See the return report for the smallest required contract change.
  const determineDvirSignals = useCallback(
    async (periodId: string | null): Promise<{ preTrip: PreTripSignal; operated: OperatedSignal }> => {
      const operated: OperatedSignal = 'unknown';
      if (!periodId) return { preTrip: 'indeterminate', operated };
      try {
        const { createSuiteDvirGate } = await import('../services/dvirGate');
        const gate = createSuiteDvirGate({ isShiftActive: () => true });
        const [hasPreTrip, pending] = await Promise.all([
          gate.isPreTripComplete(periodId),
          gate.peekPendingEndShift(),
        ]);
        const pendingForShift = !!pending && pending.shiftId === periodId;
        return { preTrip: hasPreTrip || pendingForShift ? 'yes' : 'no', operated };
      } catch {
        return { preTrip: 'indeterminate', operated };
      }
    },
    [],
  );

  const resolveEndShiftRoute = useCallback(async (): Promise<EndShiftRoute> => {
    if (!user) return { action: 'existing_flow' };
    if (!shiftActive && !returningToYard) return { action: 'existing_flow' };
    const [{ loadCompanyConfigResult }, { parseSuiteEnforcement }, { isEnforcedExplicitShift }, { resolveEnforcedExplicit }] =
      await Promise.all([
        import('../services/companyConfig'),
        import('../services/workPeriodAuthority/suiteShiftAuthority'),
        import('../services/workPeriodAuthority/postLoginShiftRestoration'),
        import('../services/workPeriodAuthority/explicitShiftLifecycle'),
      ]);
    // LIVE authority read: enforcement must be confirmed live before any
    // permissive route. Cache/unavailable → not live → authority gate fails closed.
    const cfgResult = user.companyId
      ? await loadCompanyConfigResult(user.companyId, { forceRefresh: true })
      : ({ kind: 'unavailable' } as const);
    const enforcementLive = cfgResult.kind === 'live';
    const cfg = cfgResult.kind === 'unavailable' ? null : cfgResult.config;
    const enforcement = parseSuiteEnforcement(cfg ?? undefined);
    const enforcedExplicit = isEnforcedExplicitShift(enforcement);
    const shiftOpen = shiftActive || returningToYard;

    // Under a LIVE enforced contract, consult the authenticated server authority
    // (resolveActiveDriverShift). Its state is the TRUTH — the SecureStore
    // returning hint never determines the route. DVIR is evaluated for the exact
    // SERVER period, not a local binding.
    let serverShift: ServerShiftState = { state: 'not_read' };
    let preTrip: PreTripSignal = 'indeterminate';
    let operated: OperatedSignal = 'unknown';
    if (enforcementLive && enforcedExplicit && shiftOpen) {
      try {
        const resolved = await resolveEnforcedExplicit();
        if (resolved.state === 'open') {
          serverShift = { state: 'open', periodId: resolved.periodId, originLocalDate: resolved.originLocalDate };
          const sig = await determineDvirSignals(resolved.periodId);
          preTrip = sig.preTrip;
          operated = sig.operated;
        } else if (resolved.state === 'none') {
          serverShift = { state: 'none' };
        } else {
          serverShift = { state: 'unverifiable' };
        }
      } catch {
        serverShift = { state: 'unverifiable' };
      }
    }
    return decideEndShiftRoute({ enforcedExplicit, enforcementLive, shiftOpen, serverShift, preTrip, operated });
  }, [user, shiftActive, returningToYard, determineDvirSignals]);

  // Server said NO open period → the local returning/shift state is stale.
  // Clear it ONLY after this authenticated authoritative acknowledgement, and
  // write NO server event (no logout / arrival / DVIR / Post-Trip / odometer).
  const reconcileStaleReturningShift = useCallback(async (): Promise<'cleared' | 'not_none' | 'error'> => {
    if (!user) return 'error';
    if (reconcileInFlight.current) return 'not_none';
    reconcileInFlight.current = true;
    const gen = authorityGenRef.current.current();
    try {
      const [{ loadCompanyConfigResult }, { parseSuiteEnforcement }, { isEnforcedExplicitShift }, { resolveEnforcedExplicit }] =
        await Promise.all([
          import('../services/companyConfig'),
          import('../services/workPeriodAuthority/suiteShiftAuthority'),
          import('../services/workPeriodAuthority/postLoginShiftRestoration'),
          import('../services/workPeriodAuthority/explicitShiftLifecycle'),
        ]);
      const cfgResult = user.companyId
        ? await loadCompanyConfigResult(user.companyId, { forceRefresh: true })
        : ({ kind: 'unavailable' } as const);
      if (cfgResult.kind !== 'live') return 'not_none';
      if (!isEnforcedExplicitShift(parseSuiteEnforcement(cfgResult.config))) return 'not_none';
      const resolved = await resolveEnforcedExplicit();
      if (resolved.state !== 'none') return 'not_none';
      if (!authorityGenRef.current.isCurrent(gen)) return 'not_none';
      // Authenticated ack: server has no open period. Local-only cleanup.
      setShiftActive(false);
      setReturningToYard(false);
      setReturnDepartTime(null);
      setShiftAuthorityUi({ kind: 'none' });
      await Promise.all([
        SecureStore.setItemAsync('shiftEnded', 'true'),
        SecureStore.deleteItemAsync('shiftStarted'),
        SecureStore.deleteItemAsync('returnDepartTime'),
      ]).catch(() => {});
      console.log('[AuthContext] Reconciled stale local returning state — server has no open period (no write issued)');
      return 'cleared';
    } catch {
      return 'error';
    } finally {
      reconcileInFlight.current = false;
    }
  }, [user]);

  const closeShiftDirect = useCallback(async (): Promise<EndShiftDirectCloseResult> => {
    if (!user) return { kind: 'existing_flow' };
    // Single-flight: a second tap while the first close is resolving is a no-op,
    // so repeated End Shift taps close at most once.
    if (directCloseInFlight.current) return { kind: 'verify_obligation', reason: 'in_flight' };
    directCloseInFlight.current = true;
    const gen = authorityGenRef.current.current();
    try {
      const route = await resolveEndShiftRoute();
      const { closeEnforcedExplicit } = await import(
        '../services/workPeriodAuthority/explicitShiftLifecycle'
      );
      const result = await performEndShiftDirectClose({
        route,
        // Existing authoritative close: periodId only. No odometer, no arrival.
        close: async (pid) => {
          const closed = await closeEnforcedExplicit({
            periodId: pid,
            gate: { isCurrent: () => authorityGenRef.current.isCurrent(gen) },
          });
          return { ok: closed.ok, alreadyClosed: closed.alreadyClosed, reason: closed.reason };
        },
        // Clear local return/active state only after ok close. Full shift
        // duration is preserved — the start-time and shift-id local state are
        // untouched here (real cleanup happens on logout; Day Summary needs the id).
        clearReturnState: async () => {
          setShiftActive(false);
          setReturningToYard(false);
          setReturnDepartTime(null);
          setShiftAuthorityUi({ kind: 'none' });
          await Promise.all([
            SecureStore.setItemAsync('shiftEnded', 'true'),
            SecureStore.deleteItemAsync('shiftStarted'),
            SecureStore.deleteItemAsync('returnDepartTime'),
          ]).catch(() => {});
        },
        isCurrent: () => authorityGenRef.current.isCurrent(gen),
      });
      if (result.kind === 'closed') {
        console.log('[AuthContext] Shift closed via ordinary End Shift (no DVIR obligation) for:', user.displayName);
      }
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'close_failed';
      console.warn('[AuthContext] closeShiftDirect error — shift left open:', reason);
      return { kind: 'retry', reason };
    } finally {
      directCloseInFlight.current = false;
    }
  }, [user, resolveEndShiftRoute]);

  const logoutWithCascade = useCallback(async () => {
    // Invalidate in-flight resolve/claim so they cannot restore after logout.
    bumpAuthorityGeneration('logout_cascade');
    authoritySessionRef.current.dispatch({ type: 'reset' });
    reportSsoRevalidation(readinessGenRef.current, 'failed');
    resetLiveSsoAuthorizeInbox();
    bumpSsoIdentityEpoch();
    startShiftInFlightRef.current = false;
    setStartShiftBusy(false);
    setShiftAuthorityUi({ kind: 'legacy' });
    // SIGN OUT lifecycle (P0 enterprise-handoff correction):
    // Sign Out terminates/cascades the authenticated Suite session ONLY. It must
    // NEVER run the Post-Trip gate, launch a DVIR, write pendingEndShiftId, or
    // close the shift. If an authoritative shift is open it is left OPEN and
    // unchanged — re-login reconciles the authoritative period and restores the
    // same shift state. End Shift is the sole action that closes a period and
    // arms Post-Trip. A failed/incomplete Pre-Trip therefore can never be turned
    // into a Post-Trip or a close by signing out.
    const passcodeHash = user?.passcodeHash;
    await executeSignOutSession({
      writeLogoutSignal: async () => {
        if (passcodeHash) await writeLogoutSignal(passcodeHash);
      },
      clearLocalShiftPointers: async () => {
        await SecureStore.deleteItemAsync('shiftStarted');
        await SecureStore.deleteItemAsync('shiftEnded');
        await SecureStore.deleteItemAsync('returnDepartTime');
        await SecureStore.deleteItemAsync('activePackageId');
        clearCurrentShiftId().catch(() => {});
        await AsyncStorage.multiRemove([...LOGOUT_ASYNCSTORAGE_KEYS]).catch(() => {});
        wbDiagLog({
          area: 'logout',
          event: 'currentShiftId.cleared',
          source: 'AuthContext.logoutWithCascade',
          result: 'ok',
          reason: 'logoutWithCascade — full cascade end-of-day path',
          driverHash: passcodeHash,
          extra: { trigger: 'logoutWithCascade' },
        });
        setShiftActive(false);
        setReturningToYard(false);
        setReturnDepartTime(null);
        setActivePackageId(null);
      },
      invalidateAuthEpoch: () => {},
      takeReconciliationOwnership: () => {},
      secureSignOut: async () => {
        const secure = await import('../services/secureDriverAuth');
        secure.invalidateAuthEpoch();
        reconcileForIdentity(null);
        await secure.secureSignOut().catch(() => {});
      },
      clearDriverSession: () => clearDriverSession(),
      clearMemoryUser: () => setUser(null),
    });
  }, [shiftActive, user]);

  // Single logout function for all WB S logout buttons (4 home screens, etc.).
  // RTDB writeLogoutSignal is AWAITED so it lands before this WB S session is
  // torn down — critical for the cascade signal to reach WB T / WB M / WB eW
  // before they next foreground. The previous fire-and-forget pattern dropped
  // the RTDB write whenever WB S crashed or the process ended before the
  // network call flushed (field-confirmed 2026-05-01).
  const logout = useCallback(async () => {
    // Invalidate in-flight resolve/claim so they cannot restore after logout.
    bumpAuthorityGeneration('logout');
    authoritySessionRef.current.dispatch({ type: 'reset' });
    reportSsoRevalidation(readinessGenRef.current, 'failed');
    resetLiveSsoAuthorizeInbox();
    bumpSsoIdentityEpoch();
    startShiftInFlightRef.current = false;
    setStartShiftBusy(false);
    setShiftAuthorityUi({ kind: 'legacy' });
    // SIGN OUT lifecycle (P0 enterprise-handoff correction):
    // Sign Out terminates/cascades the authenticated Suite session ONLY. It must
    // NEVER run the Post-Trip gate, launch a DVIR, write pendingEndShiftId, or
    // close the shift. If an authoritative shift is open it is left OPEN and
    // unchanged — re-login reconciles the authoritative period and restores the
    // same shift state. End Shift is the sole action that closes a period and
    // arms Post-Trip. A failed/incomplete Pre-Trip therefore can never be turned
    // into a Post-Trip or a close by signing out.
    const passcodeHash = user?.passcodeHash;
    const shiftActiveAtLogout = shiftActive;
    await executeSignOutSession({
      writeLogoutSignal: async () => {
        if (passcodeHash) await writeLogoutSignal(passcodeHash);
      },
      clearLocalShiftPointers: async () => {
        await SecureStore.deleteItemAsync('shiftStarted');
        await SecureStore.deleteItemAsync('shiftEnded');
        await SecureStore.deleteItemAsync('returnDepartTime');
        await SecureStore.deleteItemAsync('activePackageId');
        clearCurrentShiftId().catch(() => {});
        await AsyncStorage.multiRemove([...LOGOUT_ASYNCSTORAGE_KEYS]).catch(() => {});
        wbDiagLog({
          area: 'logout',
          event: 'currentShiftId.cleared',
          source: 'AuthContext.logout',
          result: 'ok',
          reason: 'logout — single awaited path (home screen Log Out button)',
          driverHash: passcodeHash,
          extra: { trigger: 'logout', shiftActiveAtLogout },
        });
        setShiftActive(false);
        setReturningToYard(false);
        setReturnDepartTime(null);
        setActivePackageId(null);
      },
      invalidateAuthEpoch: () => {},
      takeReconciliationOwnership: () => {},
      secureSignOut: async () => {
        const secure = await import('../services/secureDriverAuth');
        secure.invalidateAuthEpoch();
        reconcileForIdentity(null);
        await secure.secureSignOut().catch(() => {});
      },
      clearDriverSession: () => clearDriverSession(),
      clearMemoryUser: () => setUser(null),
    });
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
      // Reset composite readiness for the new identity, then report the freshly
      // installed (SSO-verified) SDK session; the gate goes ready only once the
      // NEW identity reconciles — never before.
      const refreshGen = resetSsoReadiness();
      reconcileForIdentity({
        driverId: session.driverId,
        companyId: session.companyId || null,
      });
      reportSsoRevalidation(refreshGen, 'ok');
    }
  }, [reconcileForIdentity]);

  const refreshShiftAuthority = useCallback(async () => {
    if (!user?.companyId) return;
    const gen = authorityGenRef.current.current();
    try {
      const [{ fetchCompanyConfig }, { parseSuiteEnforcement }, { isEnforcedExplicitShift }, { postLoginEnforcedRestore }] =
        await Promise.all([
          import('../services/companyConfig'),
          import('../services/workPeriodAuthority/suiteShiftAuthority'),
          import('../services/workPeriodAuthority/postLoginShiftRestoration'),
          import('../services/workPeriodAuthority/explicitShiftLifecycle'),
        ]);
      const cfg = await fetchCompanyConfig(user.companyId);
      const enforcement = parseSuiteEnforcement(cfg ?? undefined);
      if (!isEnforcedExplicitShift(enforcement)) {
        if (!authorityGenRef.current.isCurrent(gen)) return;
        setShiftAuthorityUi({ kind: 'legacy' });
        return;
      }
      if (!authorityGenRef.current.isCurrent(gen)) return;
      const retry = authoritySessionRef.current.dispatch({ type: 'retry' });
      if (retry.applyUi) setShiftAuthorityUi(retry.state.ui);
      const lease = issuedResolveLease(retry.commands);
      if (!lease) return;
      const term = await terminalizeIssuedResolve({
        machine: authoritySessionRef.current,
        lease,
        isCurrent: () => authorityGenRef.current.isCurrent(gen),
        restore: () => postLoginEnforcedRestore({
          enforcement,
          flags: { setShiftActive, setShiftStartTime },
          gate: { isCurrent: () => authorityGenRef.current.isCurrent(gen) },
        }),
      });
      if (term.applyUi && term.ui) setShiftAuthorityUi(term.ui);
    } catch (err) {
      console.warn('[AuthContext] refreshShiftAuthority failed:', err);
      if (authorityGenRef.current.isCurrent(gen)) {
        const inflight = authoritySessionRef.current.peek().inFlight;
        if (inflight && inflight.generation === authoritySessionRef.current.peek().generation) {
          const term = await terminalizeIssuedResolve({
            machine: authoritySessionRef.current,
            lease: inflight,
            isCurrent: () => authorityGenRef.current.isCurrent(gen),
            restore: async () => {
              throw err instanceof Error ? err : new Error('refresh_failed');
            },
          });
          if (term.applyUi && term.ui) setShiftAuthorityUi(term.ui);
        } else {
          setShiftAuthorityUi({ kind: 'unavailable', reason: 'refresh_failed' });
        }
      }
    }
  }, [user]);

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
      shiftAuthorityUi,
      startShiftBusy,
      refreshShiftAuthority,
      login,
      startShift,
      logout,
      logoutWithCascade,
      startReturn,
      confirmArrival,
      resolveEndShiftRoute,
      reconcileStaleReturningShift,
      closeShiftDirect,
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
