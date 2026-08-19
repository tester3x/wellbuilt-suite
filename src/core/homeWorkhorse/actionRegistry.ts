/**
 * Single home-screen action registry.
 *
 * Labels, icons, badges, and semantic roles live here. Themes consume
 * descriptors through the workhorse model — they do not keep a competing
 * action catalog.
 */

import {
  HOME_ACTION_IDS,
  type HomeActionGroup,
  type HomeActionId,
  type HomeActionSemanticRole,
  type HomeActionVisibilityRule,
} from './actionIds';

export interface HomeActionDescriptor {
  id: HomeActionId;
  group: HomeActionGroup;
  role: HomeActionSemanticRole;
  visibilityRule: HomeActionVisibilityRule;
  label: string;
  description: string;
  icon: string;
}

export const HOME_ACTION_REGISTRY: Record<HomeActionId, HomeActionDescriptor> = {
  shift: {
    id: 'shift',
    group: 'primary',
    role: 'shift-control',
    visibilityRule: 'always',
    label: 'Shift',
    description: 'Start, monitor, or end the driver shift',
    icon: 'play-circle-outline',
  },
  timesheet: {
    id: 'timesheet',
    group: 'primary',
    role: 'navigate',
    visibilityRule: 'always',
    label: 'Timesheet',
    description: 'View pay and hours',
    icon: 'cash-multiple',
  },
  equipment: {
    id: 'equipment',
    group: 'primary',
    role: 'launch-app',
    visibilityRule: 'always',
    label: 'WellBuilt eQuipment',
    description: 'Launch WellBuilt eQuipment',
    icon: 'truck',
  },
  'app:wellbuilt-mobile': {
    id: 'app:wellbuilt-mobile',
    group: 'applications',
    role: 'launch-app',
    visibilityRule: 'session-unrouted-mobile',
    label: 'WellBuilt Mobile',
    description: 'Field operations',
    icon: 'oil',
  },
  'app:wellbuilt-dashboard': {
    id: 'app:wellbuilt-dashboard',
    group: 'applications',
    role: 'launch-app',
    visibilityRule: 'always',
    label: 'WellBuilt Dashboard',
    description: 'Management console',
    icon: 'monitor-dashboard',
  },
  'app:water-ticket': {
    id: 'app:water-ticket',
    group: 'applications',
    role: 'launch-app',
    visibilityRule: 'always',
    label: 'WellBuilt Tickets',
    description: 'Ticket management',
    icon: 'ticket-confirmation',
  },
  'app:wellbuilt-jsa': {
    id: 'app:wellbuilt-jsa',
    group: 'applications',
    role: 'launch-app',
    visibilityRule: 'always',
    label: 'WellBuilt JSA',
    description: 'Job Safety Analysis',
    icon: 'shield-check',
  },
  settings: {
    id: 'settings',
    group: 'chrome',
    role: 'open-settings',
    visibilityRule: 'always',
    label: 'Settings',
    description: 'Open Suite settings',
    icon: 'cog-outline',
  },
  logout: {
    id: 'logout',
    group: 'chrome',
    role: 'logout',
    visibilityRule: 'always',
    label: 'Log out',
    description: 'End the Suite session',
    icon: 'logout',
  },
};

export function allActionDescriptors(): HomeActionDescriptor[] {
  return HOME_ACTION_IDS.map((id) => HOME_ACTION_REGISTRY[id]);
}

export function descriptorFor(id: HomeActionId): HomeActionDescriptor {
  return HOME_ACTION_REGISTRY[id];
}
