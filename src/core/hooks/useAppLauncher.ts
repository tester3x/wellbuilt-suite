import {PLATFORM_APP_OPEN_HOST} from '../services/platformRuntime.generated';
import { isEquipmentAppTarget } from '../services/equipmentAppAccessCore';
import { useCallback, useMemo } from 'react';
import {
  canLaunchApp,
  launchWBApp,
  WBAppLaunchOptions,
} from '../services/appLauncher';
import { useAuth } from '../context/AuthContext';
import { loadVehicleInfo } from '../services/driverProfile';
import { getCurrentShiftId } from '../services/shiftTracking';
import { createSuiteDvirGate } from '../services/dvirGate';
import {
  isCredentialFreeLaunchTarget,
} from '../services/ssoLaunchPolicy';


export function useAppLauncher() {
  const { user, activePackageId, shiftStartTime, shiftActive } = useAuth();

  // Governed DVIR launches never attach URI hash identity (PKCE only).
  const dvirGate = useMemo(
    () =>
      createSuiteDvirGate({
        isShiftActive: () => shiftActive,
      }),
    [shiftActive],
  );

  const checkCanLaunch = useCallback((scheme?: string) => {
    return canLaunchApp(scheme);
  }, []);

  // Auto-inject SSO params when launching WB ecosystem apps
  // so the target app can skip its login screen.
  // WB-T is not intercepted for DVIR here. Pre-Trip stays on a successful
  // shift start, and Post-Trip stays on return-to-yard, both in ActionCardRow.
  const launchWB = useCallback(async (options: WBAppLaunchOptions) => {
    if (isEquipmentAppTarget(options.scheme, options.androidPackage)) {
      return launchWBApp({ ...options, scheme: 'wbequipment', sso: undefined, startHost: PLATFORM_APP_OPEN_HOST,
        entryOwner: user?.driverId && user.companyId ? {driverId:user.driverId,companyId:user.companyId} : undefined });
    }
    // General JSA/local-tool entry is separate from governed job/shift links.
    if (['jsaapp','wellbuilttimecard','tickettime'].includes((options.scheme||'').toLowerCase())) {
      return launchWBApp({...options,sso:undefined,startHost:PLATFORM_APP_OPEN_HOST,
        entryOwner:user?.driverId&&user.companyId?{driverId:user.driverId,companyId:user.companyId}:undefined});
    }
    // Ordinary entry opens the cached account directly. A destination without
    // an established session owns its initial authorization flow.
    if (isCredentialFreeLaunchTarget(options.scheme)) {
      return launchWBApp({ ...options, sso: undefined, startHost: PLATFORM_APP_OPEN_HOST,
        entryOwner: user?.driverId && user.companyId ? {driverId:user.driverId,companyId:user.companyId} : undefined });
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
      // Only pass shiftId while the shift is active so target apps do not
      // inherit a finalized shift's routing identity for DVIR deep links.
      if (shiftActive) {
        const shiftId = await getCurrentShiftId();
        if (shiftId) (sso as any).shiftId = shiftId;
      }
    }

    return launchWBApp({ ...options, sso });
  }, [user, activePackageId, shiftStartTime, shiftActive]);

  return {
    canLaunchApp: checkCanLaunch,
    launchWBApp: launchWB,
    dvirGate,
  };
}
