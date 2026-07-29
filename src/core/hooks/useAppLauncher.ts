import { useCallback, useMemo } from 'react';
import {
  canLaunchApp,
  launchWBApp,
  WBAppLaunchOptions,
} from '../services/appLauncher';
import { useAuth } from '../context/AuthContext';
import { loadVehicleInfo } from '../services/driverProfile';
import { getCurrentShiftId } from '../services/shiftTracking';
import {
  createSuiteDvirGate,
  isTicketsLaunch,
  makeDvirSsoGetter,
} from '../services/dvirGate';

export function useAppLauncher() {
  const { user, activePackageId, shiftStartTime, shiftActive } = useAuth();

  const dvirGate = useMemo(
    () => createSuiteDvirGate({ getSso: makeDvirSsoGetter(user) }),
    [user],
  );

  const checkCanLaunch = useCallback((scheme?: string) => {
    return canLaunchApp(scheme);
  }, []);

  // Auto-inject SSO params when launching WB ecosystem apps
  // so the target app can skip its login screen.
  // Every Tickets launch path is gated on Pre-Trip for the active shift.
  const launchWB = useCallback(async (options: WBAppLaunchOptions) => {
    if (isTicketsLaunch(options.scheme, (options as { id?: string }).id)) {
      if (!shiftActive) {
        // No active shift — still block Tickets until Start Shift + Pre-Trip
        const gate = await dvirGate.ensurePreTripGate({ alertOnBlock: true });
        if (!gate.allowed) return;
      } else {
        const gate = await dvirGate.ensurePreTripGate({ alertOnBlock: true });
        if (!gate.allowed) return;
      }
    }

    let sso = user
      ? { hash: user.passcodeHash, name: user.displayName, companyId: user.companyId }
      : undefined;

    // Include truck/trailer numbers + active package in SSO deep link for all apps
    if (sso) {
      const vehicle = await loadVehicleInfo(user!.passcodeHash);
      if (vehicle.truckNumber) (sso as any).truck = vehicle.truckNumber;
      if (vehicle.trailerNumber) (sso as any).trailer = vehicle.trailerNumber;
      if (activePackageId) (sso as any).packageId = activePackageId;
      if (shiftStartTime) (sso as any).shiftStartTime = shiftStartTime;
      // Active shiftId — scopes the JSA in WB T / WB JSA so each shift
      // has its own JSA and closing a shift freezes it.
      const shiftId = await getCurrentShiftId();
      if (shiftId) (sso as any).shiftId = shiftId;
    }

    return launchWBApp({ ...options, sso });
  }, [user, activePackageId, shiftStartTime, shiftActive, dvirGate]);

  return {
    canLaunchApp: checkCanLaunch,
    launchWBApp: launchWB,
    dvirGate,
  };
}
