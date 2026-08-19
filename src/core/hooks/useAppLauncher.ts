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
} from '../services/dvirGate';
import {
  isCredentialFreeLaunchTarget,
  credentialFreeAudience,
  WBT_SSO_START_HOST,
} from '../services/ssoLaunchPolicy';
import {
  armSsoHandoffOutbound,
  noteSsoHandoffLaunchFailure,
} from '../services/ssoHandoffOverlayStore';
import { SSO_AUDIENCE_WBT, type SsoAudience } from '../services/ssoProtocol.generated';

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
  // Tickets: Pre-Trip gate only while a shift is active. Off-shift opens
  // WB-T normally (never redirect to a stale Post-Trip / Pre-Trip DVIR).
  const launchWB = useCallback(async (options: WBAppLaunchOptions) => {
    if (isTicketsLaunch(options.scheme, (options as { id?: string }).id)) {
      if (shiftActive) {
        const gate = await dvirGate.ensurePreTripGate({ alertOnBlock: true });
        if (!gate.allowed) return;
      }
      // Off-shift: no DVIR redirect — fall through to normal Tickets launch.
    }

    // Credential-free launch: WB-T and WB-M. Each mints its own PKCE
    // attempt. WB-T's audience and start host stay exactly as before.
    // JSA and eQuipment still receive the legacy params.
    if (isCredentialFreeLaunchTarget(options.scheme)) {
      const audience = (credentialFreeAudience(options.scheme) || SSO_AUDIENCE_WBT) as SsoAudience;
      // CONTINUOUS HANDOFF OVERLAY — armed BEFORE openURL, then one
      // committed frame, so the tree Suite backgrounds with is already the
      // covered tree. Android redraws that exact tree when the authorize
      // intent re-fronts Suite, which is what makes "Home never visibly
      // uncovered" hold by construction for a process-preserved handoff
      // (a returned-claim overlay always loses that first frame to the
      // resumed native tree). Purely visual: failure to arm changes pixels
      // only, so it is swallowed and the launch proceeds regardless.
      try {
        armSsoHandoffOutbound(audience, Date.now());
        // Double-rAF: the first fires before the commit paints; the second
        // guarantees a frame containing the overlay has been committed.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      } catch { /* visual only — never block the launch */ }
      try {
        return await launchWBApp({ ...options, sso: undefined, startHost: WBT_SSO_START_HOST });
      } catch (err) {
        // Launch failed before leaving Suite: uncover Home immediately and
        // let launchWBApp's existing alert handling stand. (Failures that
        // launchWBApp absorbs internally without throwing fall to the
        // bounded stale timeout instead — documented, not hidden.)
        noteSsoHandoffLaunchFailure();
        throw err;
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
      // Only pass shiftId while the shift is active so target apps do not
      // inherit a finalized shift's routing identity for DVIR deep links.
      if (shiftActive) {
        const shiftId = await getCurrentShiftId();
        if (shiftId) (sso as any).shiftId = shiftId;
      }
    }

    return launchWBApp({ ...options, sso });
  }, [user, activePackageId, shiftStartTime, shiftActive, dvirGate]);

  return {
    canLaunchApp: checkCanLaunch,
    launchWBApp: launchWB,
    dvirGate,
  };
}
