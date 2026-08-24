/**
 * Primary Suite app-card tap policy.
 *
 * A normal tap never opens About / App Details. First-seen flags, off-shift
 * state, and onboarding must not intercept launch. Details stay on a
 * separate info/long-press control.
 */
export type AppCardTapApp = {
  id: string;
  name: string;
  scheme?: string;
  androidPackage?: string;
  webUrl?: string;
  platform?: 'mobile' | 'web' | 'both';
};

export type AppCardLaunchTarget = {
  name: string;
  scheme?: string;
  androidPackage?: string;
  webUrl?: string;
};

export type AppCardPrimaryDecision =
  | { action: 'launch_native'; target: AppCardLaunchTarget }
  | { action: 'open_web'; target: AppCardLaunchTarget }
  | { action: 'disabled_notice' }
  | { action: 'not_configured' };

const inflight = new Set<string>();

export function decideAppCardPrimaryAction(input: {
  app: AppCardTapApp;
  enabled: boolean;
  /** Persisted About-screen / first-tap flags. MUST NOT change the decision. */
  hasLaunched?: boolean;
  /** Off-shift must not block an otherwise enabled card. */
  shiftActive?: boolean;
}): AppCardPrimaryDecision {
  void input.hasLaunched;
  void input.shiftActive;
  const app = input.app;
  if (!input.enabled) return { action: 'disabled_notice' };

  const target: AppCardLaunchTarget = {
    name: app.name,
    scheme: app.scheme,
    androidPackage: app.androidPackage,
    webUrl: app.webUrl,
  };

  if (app.scheme) return { action: 'launch_native', target };
  if (app.webUrl) return { action: 'open_web', target };
  return { action: 'not_configured' };
}

/** One tap → at most one in-flight launch/authorization for that app id. */
export function beginAppCardLaunch(appId: string): boolean {
  const id = appId.trim();
  if (!id || inflight.has(id)) return false;
  inflight.add(id);
  return true;
}

export function endAppCardLaunch(appId: string): void {
  inflight.delete(appId.trim());
}

export function __resetAppCardLaunchForTests(): void {
  inflight.clear();
}
