import { useCallback } from 'react';
import {
  canLaunchApp,
  launchWBApp,
  WBAppLaunchOptions,
} from '../services/appLauncher';
import { useAuth } from '../context/AuthContext';
import { loadVehicleInfo } from '../services/driverProfile';

export function useAppLauncher() {
  const { user } = useAuth();

  const checkCanLaunch = useCallback((scheme?: string) => {
    return canLaunchApp(scheme);
  }, []);

  // Auto-inject SSO params when launching WB ecosystem apps
  // so the target app can skip its login screen.
  const launchWB = useCallback(async (options: WBAppLaunchOptions) => {
    let sso = user
      ? { hash: user.passcodeHash, name: user.displayName, companyId: user.companyId }
      : undefined;

    // For eWallet, include truck/trailer numbers so vehicle docs auto-load
    if (sso && options.scheme === 'wbewallet') {
      const vehicle = await loadVehicleInfo(user!.passcodeHash);
      if (vehicle.truckNumber) (sso as any).truck = vehicle.truckNumber;
      if (vehicle.trailerNumber) (sso as any).trailer = vehicle.trailerNumber;
    }

    return launchWBApp({ ...options, sso });
  }, [user]);

  return {
    canLaunchApp: checkCanLaunch,
    launchWBApp: launchWB,
  };
}
