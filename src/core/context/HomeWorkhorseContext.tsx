/**
 * Home-screen workhorse provider.
 *
 * Mounted above the skin HomeScreen (app/home.tsx) so switching Card Grid /
 * Command Center / Sidebar Nav / Widget Board remounts presentation only.
 * This provider must not import the skin module and must not resolve shift
 * authority, revalidate auth, or handle SSO — it reads already-resolved
 * AuthContext state and shared live display data.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, AppState } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/context/AuthContext';
import { wellbuiltApps, type WellBuiltApp } from '@/core/data/apps';
import { useAppLauncher, useCompanyConfig, useFirstLaunch } from '@/core/hooks';
import { TIER_DESCRIPTIONS } from '@/core/services/companyConfig';
import { fetchPendingDispatches, type DispatchSummary } from '@/core/services/dispatchJobs';
import type { ShiftAuthorityUiState } from '@/core/services/workPeriodAuthority/postLoginShiftRestoration';
import {
  buildHomeWorkhorseModel,
  createHomeActionInvoker,
  queryTodaysJsaCompletion,
  type HomeActionId,
  type HomeActionInvoker,
  type HomeInvokeIntent,
  type HomeInvokeResult,
  type HomeWorkhorseModel,
} from '@/core/homeWorkhorse';

export interface HomeShiftActions {
  startShift: (packageId?: string) => Promise<{ ok: boolean; reason?: string }>;
  startReturn: () => Promise<void>;
  confirmArrival: (odometerMiles?: number) => Promise<boolean | void>;
  refreshShiftAuthority: () => Promise<void>;
}

export interface HomeWorkhorseValue {
  model: HomeWorkhorseModel<WellBuiltApp>;
  session: HomeWorkhorseModel<WellBuiltApp>['session'];
  shift: HomeWorkhorseModel<WellBuiltApp>['shift'];
  shiftAuthorityUi: ShiftAuthorityUiState;
  groups: HomeWorkhorseModel<WellBuiltApp>['groups'];
  live: HomeWorkhorseModel<WellBuiltApp>['live'];
  visibleActionIds: HomeWorkhorseModel<WellBuiltApp>['visibleActionIds'];
  invoke: (id: HomeActionId, intent?: HomeInvokeIntent) => Promise<HomeInvokeResult>;
  isInFlight: (id: HomeActionId) => boolean;
  shiftActions: HomeShiftActions;
}

const HomeWorkhorseContext = createContext<HomeWorkhorseValue | null>(null);

const DISPATCH_CACHE_TTL_MS = 5 * 60 * 1000;

export function HomeWorkhorseProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const {
    user,
    logout,
    isAuthenticated,
    shiftActive,
    shiftStartTime,
    returningToYard,
    returnDepartTime,
    startShift,
    startReturn,
    confirmArrival,
    shiftAuthorityUi,
    startShiftBusy,
    refreshShiftAuthority,
  } = useAuth();
  const { launchWBApp } = useAppLauncher();
  const { hasLaunched } = useFirstLaunch();
  const { isWBAppEnabled, config: companyConfig, tierLabel } = useCompanyConfig(user?.companyId);

  const [dispatches, setDispatches] = useState<DispatchSummary[]>([]);
  const lastDispatchFetchRef = useRef(0);
  const [jsaPending, setJsaPending] = useState(false);

  const jsaMode = companyConfig?.jsaMode || 'off';
  const jsaRequired = jsaMode !== 'off';

  React.useEffect(() => {
    if (!isAuthenticated) router.replace('/');
  }, [isAuthenticated]);

  const handleArrived = useCallback(
    async (odometerMiles?: number) => {
      const ok = await confirmArrival(odometerMiles);
      if (ok === false) return false;
      router.push('/day-summary');
      return true;
    },
    [confirmArrival],
  );

  const refreshDispatches = useCallback(async (force = false) => {
    if (!user?.passcodeHash) return;
    if (!force && Date.now() - lastDispatchFetchRef.current < DISPATCH_CACHE_TTL_MS) return;
    lastDispatchFetchRef.current = Date.now();
    const results = await fetchPendingDispatches(user.passcodeHash);
    setDispatches(results);
  }, [user?.passcodeHash]);

  useEffect(() => {
    void refreshDispatches();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        lastDispatchFetchRef.current = 0;
        void refreshDispatches(true);
      }
    });
    return () => sub.remove();
  }, [refreshDispatches]);

  const checkJsaCompletion = useCallback(async () => {
    if (!jsaRequired || !shiftActive || !user) return;
    const result = await queryTodaysJsaCompletion({
      driverName: user.legalName || user.displayName,
    });
    if (result.kind === 'found') setJsaPending(false);
    else if (result.kind === 'missing') setJsaPending(true);
  }, [jsaRequired, shiftActive, user]);

  useEffect(() => {
    if (!jsaRequired || !shiftActive) {
      setJsaPending(false);
      return;
    }
    setJsaPending(true);
    void checkJsaCompletion();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkJsaCompletion();
    });
    return () => sub.remove();
  }, [jsaRequired, shiftActive, checkJsaCompletion]);

  const model = useMemo(
    () =>
      buildHomeWorkhorseModel({
        session: user
          ? {
              displayName: user.displayName,
              legalName: user.legalName,
              role: user.role,
              companyId: user.companyId,
              companyName: user.companyName,
              assignedRoutes: user.assignedRoutes,
              isAdmin: user.isAdmin,
              customerAccentColor: (user as { customerAccentColor?: string }).customerAccentColor,
            }
          : null,
        shift: {
          active: shiftActive,
          returning: returningToYard,
          returnStartTime: returnDepartTime,
          shiftStartTime,
          authorityKind: shiftAuthorityUi.kind,
          startShiftBusy,
        },
        tier: {
          tier: companyConfig?.tier ?? null,
          tierLabel,
          tierDescription: companyConfig ? TIER_DESCRIPTIONS[companyConfig.tier] : '',
          isAppEnabled: isWBAppEnabled,
        },
        live: {
          pendingDispatches: dispatches,
          jsaPending,
          jsaMode,
        },
        apps: wellbuiltApps,
      }),
    [
      user,
      shiftActive,
      returningToYard,
      returnDepartTime,
      shiftStartTime,
      shiftAuthorityUi.kind,
      startShiftBusy,
      companyConfig,
      tierLabel,
      isWBAppEnabled,
      dispatches,
      jsaPending,
      jsaMode,
    ],
  );

  const modelRef = useRef(model);
  modelRef.current = model;

  const invokerRef = useRef<HomeActionInvoker | null>(null);
  if (!invokerRef.current) {
    invokerRef.current = createHomeActionInvoker({
      getModel: () => modelRef.current,
      launchApp: async (options) => {
        await launchWBApp(options);
      },
      openAppDetail: (appId) => {
        router.push(`/app-detail?id=${appId}`);
      },
      openTimesheet: () => {
        router.push('/timesheet');
      },
      openSettings: () => {
        router.push('/settings');
      },
      logout: () => logout(),
      hasLaunched: (appId) => hasLaunched(appId),
      onLocked: (action) => {
        Alert.alert(
          t('home.tier.lockedTitle'),
          t('home.tier.lockedMessage', {
            name: action.label,
            tier: modelRef.current.live.tierLabel,
          }),
        );
      },
    });
  }

  const launchRef = useRef(launchWBApp);
  launchRef.current = launchWBApp;
  const hasLaunchedRef = useRef(hasLaunched);
  hasLaunchedRef.current = hasLaunched;
  const logoutRef = useRef(logout);
  logoutRef.current = logout;
  const tRef = useRef(t);
  tRef.current = t;

  // Recreate only the dependency closures that must stay current. The
  // in-flight set lives on invokerRef so theme remounts / parent renders
  // do not drop exactly-once protection.
  useEffect(() => {
    invokerRef.current = createHomeActionInvoker({
      getModel: () => modelRef.current,
      launchApp: async (options) => {
        await launchRef.current(options);
      },
      openAppDetail: (appId) => {
        router.push(`/app-detail?id=${appId}`);
      },
      openTimesheet: () => {
        router.push('/timesheet');
      },
      openSettings: () => {
        router.push('/settings');
      },
      logout: () => logoutRef.current(),
      hasLaunched: (appId) => hasLaunchedRef.current(appId),
      onLocked: (action) => {
        Alert.alert(
          tRef.current('home.tier.lockedTitle'),
          tRef.current('home.tier.lockedMessage', {
            name: action.label,
            tier: modelRef.current.live.tierLabel,
          }),
        );
      },
    });
  }, [launchWBApp, hasLaunched, logout]);

  const invoke = useCallback(
    (id: HomeActionId, intent?: HomeInvokeIntent) => {
      return invokerRef.current!.invoke(id, intent);
    },
    [],
  );

  const isInFlight = useCallback((id: HomeActionId) => {
    return invokerRef.current!.isInFlight(id);
  }, []);

  const shiftActions = useMemo<HomeShiftActions>(
    () => ({
      startShift,
      startReturn,
      confirmArrival: handleArrived,
      refreshShiftAuthority,
    }),
    [startShift, startReturn, handleArrived, refreshShiftAuthority],
  );

  const value = useMemo<HomeWorkhorseValue>(
    () => ({
      model,
      session: model.session,
      shift: model.shift,
      shiftAuthorityUi,
      groups: model.groups,
      live: model.live,
      visibleActionIds: model.visibleActionIds,
      invoke,
      isInFlight,
      shiftActions,
    }),
    [model, invoke, isInFlight, shiftActions, shiftAuthorityUi],
  );

  return (
    <HomeWorkhorseContext.Provider value={value}>
      {children}
    </HomeWorkhorseContext.Provider>
  );
}

export function useHomeWorkhorse(): HomeWorkhorseValue {
  const ctx = useContext(HomeWorkhorseContext);
  if (!ctx) throw new Error('useHomeWorkhorse must be used within HomeWorkhorseProvider');
  return ctx;
}
