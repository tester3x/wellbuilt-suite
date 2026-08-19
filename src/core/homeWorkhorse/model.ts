/**
 * Pure home-screen workhorse model.
 *
 * Skin / theme identity is intentionally not an input. Switching Card Grid,
 * Command Center, Sidebar Nav, or Widget Board must not rebuild functional
 * state and must not re-run authentication, SSO, or shift resolution.
 */

import {
  HOME_ACTION_GROUPS,
  appCatalogIdFromActionId,
  type HomeActionGroup,
  type HomeActionId,
} from './actionIds';
import { allActionDescriptors, type HomeActionDescriptor } from './actionRegistry';
import { isActionVisible, isAppLocked } from './availability';

export interface HomeAppRef {
  id: string;
  name: string;
  shortName: string;
  subtitle: string;
  description: string;
  icon: string;
  color: string;
  scheme?: string;
  androidPackage?: string;
  webUrl?: string;
  status?: string;
  version?: string;
  platform?: string;
  gradientKey?: string;
  logo?: unknown;
}

export interface HomeSessionInput {
  displayName: string;
  legalName?: string;
  role: 'driver' | 'admin' | 'viewer';
  companyId?: string;
  companyName?: string;
  assignedRoutes?: string[];
  isAdmin: boolean;
  customerAccentColor?: string;
}

export interface HomeShiftInput {
  active: boolean;
  returning: boolean;
  returnStartTime: string | null;
  shiftStartTime: string | null;
  authorityKind: 'checking' | 'none' | 'open' | 'unavailable' | 'legacy';
  startShiftBusy: boolean;
}

export interface HomeTierInput {
  tier: 'field-basics' | 'full-field' | 'suite' | null;
  tierLabel: string;
  tierDescription: string;
  isAppEnabled?: (appId: string) => boolean;
}

export interface HomeDispatchSummary {
  wellName: string;
  jobType: string;
  status: string;
}

export interface HomeLiveInput {
  pendingDispatches: HomeDispatchSummary[];
  jsaPending: boolean;
  jsaMode: string;
}

export interface HomeWorkhorseInput<TApp extends HomeAppRef = HomeAppRef> {
  session: HomeSessionInput | null;
  shift: HomeShiftInput;
  tier: HomeTierInput;
  live: HomeLiveInput;
  apps: TApp[];
}

export type HomeShiftPresentationState =
  | 'returning'
  | 'active'
  | 'checking'
  | 'unavailable'
  | 'idle';

export type HomeActionUiState =
  | 'idle'
  | 'loading'
  | 'checking'
  | 'unavailable'
  | 'retry'
  | 'active'
  | 'disabled'
  | 'locked';

export interface HomeActionBadge {
  text: string;
  detail?: string;
  accentColor?: string;
  pulse: boolean;
  count: number;
}

export interface HomeActionView<TApp extends HomeAppRef = HomeAppRef> {
  id: HomeActionId;
  group: HomeActionGroup;
  role: HomeActionDescriptor['role'];
  visibilityRule: HomeActionDescriptor['visibilityRule'];
  visible: boolean;
  label: string;
  description: string;
  icon: string;
  locked: boolean;
  state: HomeActionUiState;
  badge?: HomeActionBadge;
  appId?: string;
  app?: TApp;
}

export interface HomeSessionView {
  displayName: string;
  legalName?: string;
  role: HomeSessionInput['role'];
  companyId?: string;
  companyName?: string;
  isAdmin: boolean;
  customerAccentColor?: string;
}

export interface HomeShiftView {
  active: boolean;
  returning: boolean;
  returnStartTime: string | null;
  shiftStartTime: string | null;
  authorityKind: HomeShiftInput['authorityKind'];
  startShiftBusy: boolean;
  presentationState: HomeShiftPresentationState;
}

export interface HomeLiveView {
  applicationCount: number;
  enabledApplicationCount: number;
  activeApplicationCount: number;
  pendingDispatchCount: number;
  pendingDispatches: HomeDispatchSummary[];
  jsaPending: boolean;
  jsaMode: string;
  tier: HomeTierInput['tier'];
  tierLabel: string;
  tierDescription: string;
  showTierBanner: boolean;
}

export type HomeActionGroups<TApp extends HomeAppRef = HomeAppRef> = {
  [K in HomeActionGroup]: HomeActionView<TApp>[];
};

export interface HomeWorkhorseModel<TApp extends HomeAppRef = HomeAppRef> {
  session: HomeSessionView | null;
  shift: HomeShiftView;
  actions: HomeActionView<TApp>[];
  groups: HomeActionGroups<TApp>;
  visibleActionIds: HomeActionId[];
  live: HomeLiveView;
}

export function shiftPresentationState(shift: HomeShiftInput): HomeShiftPresentationState {
  if (shift.returning) return 'returning';
  if (shift.active) return 'active';
  if (shift.authorityKind === 'checking') return 'checking';
  if (shift.authorityKind === 'unavailable') return 'unavailable';
  return 'idle';
}

export function shiftActionUiState(shift: HomeShiftInput): HomeActionUiState {
  const presentation = shiftPresentationState(shift);
  switch (presentation) {
    case 'returning':
      return 'active';
    case 'active':
      return 'active';
    case 'checking':
      return 'checking';
    case 'unavailable':
      return 'retry';
    case 'idle':
      return shift.startShiftBusy ? 'loading' : 'idle';
    default: {
      const _exhaustive: never = presentation;
      throw new Error(`unhandled shift presentation: ${String(_exhaustive)}`);
    }
  }
}

function partitionVisibleActions<TApp extends HomeAppRef>(
  actions: HomeActionView<TApp>[],
): HomeActionGroups<TApp> {
  const groups = {
    primary: [] as HomeActionView<TApp>[],
    applications: [] as HomeActionView<TApp>[],
    chrome: [] as HomeActionView<TApp>[],
  };
  for (const action of actions) {
    if (!action.visible) continue;
    const group = action.group;
    switch (group) {
      case 'primary':
      case 'applications':
      case 'chrome':
        groups[group].push(action);
        break;
      default: {
        const _exhaustive: never = group;
        throw new Error(`unhandled home action group: ${String(_exhaustive)}`);
      }
    }
  }
  return groups;
}

function ticketsBadge(
  live: HomeLiveInput,
  session: HomeSessionInput | null,
): HomeActionBadge | undefined {
  if (live.pendingDispatches.length === 0) return undefined;
  const accent = session?.customerAccentColor;
  return {
    text: `${live.pendingDispatches.length} pending`,
    detail:
      live.pendingDispatches.length <= 3
        ? live.pendingDispatches.map((d) => d.wellName).join(', ')
        : undefined,
    accentColor: accent,
    pulse: true,
    count: live.pendingDispatches.length,
  };
}

export function buildHomeWorkhorseModel<TApp extends HomeAppRef>(
  input: HomeWorkhorseInput<TApp>,
): HomeWorkhorseModel<TApp> {
  const appsById = new Map(input.apps.map((app) => [app.id, app]));
  const shiftView: HomeShiftView = {
    active: input.shift.active,
    returning: input.shift.returning,
    returnStartTime: input.shift.returnStartTime,
    shiftStartTime: input.shift.shiftStartTime,
    authorityKind: input.shift.authorityKind,
    startShiftBusy: input.shift.startShiftBusy,
    presentationState: shiftPresentationState(input.shift),
  };

  const actions: HomeActionView<TApp>[] = allActionDescriptors().map((descriptor) => {
    const visible = isActionVisible(descriptor, input.session);
    const appId = appCatalogIdFromActionId(descriptor.id) ?? undefined;
    const app = appId ? appsById.get(appId) : undefined;
    const locked = appId ? isAppLocked(appId, input.tier.isAppEnabled) : false;

    let state: HomeActionUiState = 'idle';
    let badge: HomeActionBadge | undefined;
    if (descriptor.id === 'shift') {
      state = shiftActionUiState(input.shift);
    } else if (locked) {
      state = 'locked';
    }

    if (descriptor.id === 'app:water-ticket') {
      badge = ticketsBadge(input.live, input.session);
    }

    return {
      id: descriptor.id,
      group: descriptor.group,
      role: descriptor.role,
      visibilityRule: descriptor.visibilityRule,
      visible,
      label: app?.name || descriptor.label,
      description: app?.subtitle || descriptor.description,
      icon: app?.icon || descriptor.icon,
      locked,
      state,
      badge,
      appId,
      app,
    };
  });

  const groups = partitionVisibleActions(actions);
  const visibleApps = groups.applications;
  const enabledApplicationCount = visibleApps.filter((action) => !action.locked).length;
  const activeApplicationCount = visibleApps.filter(
    (action) => action.app?.status === 'active',
  ).length;

  const session: HomeSessionView | null = input.session
    ? {
        displayName: input.session.displayName,
        legalName: input.session.legalName,
        role: input.session.role,
        companyId: input.session.companyId,
        companyName: input.session.companyName,
        isAdmin: input.session.isAdmin,
        customerAccentColor: input.session.customerAccentColor,
      }
    : null;

  return {
    session,
    shift: shiftView,
    actions,
    groups,
    visibleActionIds: actions.filter((action) => action.visible).map((action) => action.id),
    live: {
      applicationCount: visibleApps.length,
      enabledApplicationCount,
      activeApplicationCount,
      pendingDispatchCount: input.live.pendingDispatches.length,
      pendingDispatches: input.live.pendingDispatches,
      jsaPending: input.live.jsaPending,
      jsaMode: input.live.jsaMode,
      tier: input.tier.tier,
      tierLabel: input.tier.tierLabel,
      tierDescription: input.tier.tierDescription,
      showTierBanner: !!input.tier.tier && input.tier.tier !== 'suite',
    },
  };
}

/** Compile-time reminder: every group key is accounted for. */
export function assertHomeActionGroupsComplete(groups: HomeActionGroups): HomeActionId[] {
  const ids: HomeActionId[] = [];
  for (const key of HOME_ACTION_GROUPS) {
    switch (key) {
      case 'primary':
      case 'applications':
      case 'chrome':
        ids.push(...groups[key].map((action) => action.id));
        break;
      default: {
        const _exhaustive: never = key;
        throw new Error(`unhandled home action group: ${String(_exhaustive)}`);
      }
    }
  }
  return ids;
}
