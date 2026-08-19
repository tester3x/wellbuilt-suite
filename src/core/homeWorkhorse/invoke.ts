/**
 * Shared home-screen action invoker.
 *
 * Every theme calls the same `invoke(id)` for functional actions. Shift uses
 * the dedicated shift controller (modals / DVIR gates) and is rejected here
 * so a theme cannot start a parallel shift implementation.
 *
 * Exactly-once: a second invoke for the same id while the first is in flight
 * is a no-op (`ignored`).
 */

import { isHomeActionId, type HomeActionId } from './actionIds';
import type { HomeActionView, HomeAppRef, HomeWorkhorseModel } from './model';

export type HomeInvokeIntent = 'press' | 'inspect';

export type HomeInvokeResult =
  | { status: 'ok' }
  | { status: 'ignored' }
  | { status: 'locked' }
  | { status: 'hidden' }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; reason: string };

export interface HomeAppLaunchOptions {
  name: string;
  scheme?: string;
  androidPackage?: string;
  webUrl?: string;
}

export interface HomeActionInvokerDeps<TApp extends HomeAppRef = HomeAppRef> {
  getModel: () => HomeWorkhorseModel<TApp>;
  launchApp: (options: HomeAppLaunchOptions) => Promise<void>;
  openAppDetail: (appId: string) => void;
  openTimesheet: () => void;
  openSettings: () => void;
  logout: () => Promise<void> | void;
  hasLaunched: (appId: string) => boolean;
  onLocked: (action: HomeActionView<TApp>) => void;
}

export interface HomeActionInvoker {
  invoke: (id: HomeActionId, intent?: HomeInvokeIntent) => Promise<HomeInvokeResult>;
  isInFlight: (id: HomeActionId) => boolean;
}

const EQUIPMENT_LAUNCH: HomeAppLaunchOptions = {
  name: 'WellBuilt eQuipment',
  scheme: 'wbequipment',
  androidPackage: 'com.wellbuilt.equipment',
};

export function createHomeActionInvoker<TApp extends HomeAppRef = HomeAppRef>(
  deps: HomeActionInvokerDeps<TApp>,
): HomeActionInvoker {
  const inFlight = new Set<HomeActionId>();

  const invoke = async (
    id: HomeActionId,
    intent: HomeInvokeIntent = 'press',
  ): Promise<HomeInvokeResult> => {
    if (!isHomeActionId(id)) {
      return { status: 'error', reason: 'unknown_action' };
    }
    if (id === 'shift') {
      return { status: 'unavailable', reason: 'shift_uses_dedicated_controller' };
    }

    const model = deps.getModel();
    const action = model.actions.find((entry) => entry.id === id);
    if (!action || !action.visible) {
      return { status: 'hidden' };
    }
    if (action.locked) {
      deps.onLocked(action);
      return { status: 'locked' };
    }
    if (inFlight.has(id)) {
      return { status: 'ignored' };
    }

    inFlight.add(id);
    try {
      switch (id) {
        case 'timesheet':
          deps.openTimesheet();
          return { status: 'ok' };
        case 'settings':
          deps.openSettings();
          return { status: 'ok' };
        case 'logout':
          await deps.logout();
          return { status: 'ok' };
        case 'equipment':
          await deps.launchApp(EQUIPMENT_LAUNCH);
          return { status: 'ok' };
        case 'app:wellbuilt-mobile':
        case 'app:wellbuilt-dashboard':
        case 'app:water-ticket':
        case 'app:wellbuilt-jsa': {
          const appId = action.appId;
          const app = action.app;
          if (!appId || !app) {
            return { status: 'error', reason: 'missing_app' };
          }
          if (intent === 'inspect') {
            deps.openAppDetail(appId);
            return { status: 'ok' };
          }
          if (deps.hasLaunched(appId)) {
            await deps.launchApp({
              name: app.name,
              scheme: app.scheme,
              androidPackage: app.androidPackage,
              webUrl: app.webUrl,
            });
          } else {
            deps.openAppDetail(appId);
          }
          return { status: 'ok' };
        }
        default: {
          const _exhaustive: never = id;
          return { status: 'error', reason: `unhandled_action:${String(_exhaustive)}` };
        }
      }
    } catch (err) {
      return { status: 'error', reason: err instanceof Error ? err.message : 'invoke_failed' };
    } finally {
      inFlight.delete(id);
    }
  };

  return {
    invoke,
    isInFlight: (id) => inFlight.has(id),
  };
}
