/**
 * Stable home-screen action IDs and groups.
 *
 * Themes may place, group, and style these actions. They must not invent
 * private functional IDs and must not silently drop a required visible action.
 * Adding a group to HOME_ACTION_GROUPS without updating every theme's
 * consumption of `model.groups.<id>` fails themeParity.test.ts.
 */

export const HOME_ACTION_GROUPS = ['primary', 'applications', 'chrome'] as const;
export type HomeActionGroup = (typeof HOME_ACTION_GROUPS)[number];

export const HOME_ACTION_IDS = [
  'shift',
  'timesheet',
  'equipment',
  'app:wellbuilt-mobile',
  'app:wellbuilt-dashboard',
  'app:water-ticket',
  'app:wellbuilt-jsa',
  'settings',
  'logout',
] as const;

export type HomeActionId = (typeof HOME_ACTION_IDS)[number];

export const HOME_APP_CATALOG_IDS = [
  'wellbuilt-mobile',
  'wellbuilt-dashboard',
  'water-ticket',
  'wellbuilt-jsa',
] as const;

export type HomeAppCatalogId = (typeof HOME_APP_CATALOG_IDS)[number];

export type HomeActionSemanticRole =
  | 'shift-control'
  | 'navigate'
  | 'launch-app'
  | 'open-settings'
  | 'logout';

export type HomeActionVisibilityRule =
  | 'always'
  | 'session-unrouted-mobile';

export function isHomeActionId(id: string): id is HomeActionId {
  return (HOME_ACTION_IDS as readonly string[]).includes(id);
}

export function appCatalogIdFromActionId(id: HomeActionId): HomeAppCatalogId | null {
  if (!id.startsWith('app:')) return null;
  const catalogId = id.slice(4);
  return (HOME_APP_CATALOG_IDS as readonly string[]).includes(catalogId)
    ? (catalogId as HomeAppCatalogId)
    : null;
}

export function actionIdForAppCatalog(appId: HomeAppCatalogId): HomeActionId {
  return `app:${appId}`;
}
