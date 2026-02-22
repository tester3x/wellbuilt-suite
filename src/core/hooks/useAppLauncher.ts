import { useCallback } from 'react';
import {
  canLaunchApp,
  launchWBApp,
  launchExternalApp,
  WBAppLaunchOptions,
  ExternalLaunchOptions,
} from '../services/appLauncher';
import { useAuth } from '../context/AuthContext';

export function useAppLauncher() {
  const { user } = useAuth();

  const checkCanLaunch = useCallback((scheme?: string) => {
    return canLaunchApp(scheme);
  }, []);

  // Auto-inject SSO params when launching WB ecosystem apps
  // so the target app can skip its login screen.
  const launchWB = useCallback((options: WBAppLaunchOptions) => {
    const sso = user
      ? { hash: user.passcodeHash, name: user.displayName }
      : undefined;
    return launchWBApp({ ...options, sso });
  }, [user]);

  const launchExternal = useCallback((options: ExternalLaunchOptions) => {
    return launchExternalApp(options);
  }, []);

  return {
    canLaunchApp: checkCanLaunch,
    launchWBApp: launchWB,
    launchExternalApp: launchExternal,
  };
}
