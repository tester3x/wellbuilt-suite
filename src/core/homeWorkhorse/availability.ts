/**
 * Universally governed home-screen visibility and lock rules.
 *
 * Themes must not reimplement these. A hidden action is omitted from every
 * theme at once. A locked action is still rendered; invoke() fail-closes.
 */

import type { HomeActionId, HomeActionVisibilityRule } from './actionIds';
import type { HomeActionDescriptor } from './actionRegistry';

export interface HomeAvailabilitySession {
  companyId?: string;
  assignedRoutes?: string[];
}

/**
 * WB-M is hidden for unrouted-only drivers when a company is assigned.
 * Legacy drivers (assignedRoutes undefined) still see it.
 */
export function isWellbuiltMobileVisible(session: HomeAvailabilitySession | null): boolean {
  if (!session?.companyId) return true;
  const routes = session.assignedRoutes;
  if (routes === undefined) return true;
  if (routes.length === 0) return false;
  return routes.some((r) => !r.startsWith('Unrouted'));
}

export function isActionVisible(
  descriptor: HomeActionDescriptor,
  session: HomeAvailabilitySession | null,
): boolean {
  return evaluateVisibilityRule(descriptor.visibilityRule, descriptor.id, session);
}

export function evaluateVisibilityRule(
  rule: HomeActionVisibilityRule,
  id: HomeActionId,
  session: HomeAvailabilitySession | null,
): boolean {
  switch (rule) {
    case 'always':
      return true;
    case 'session-unrouted-mobile':
      if (id !== 'app:wellbuilt-mobile') return true;
      return isWellbuiltMobileVisible(session);
    default: {
      const _exhaustive: never = rule;
      throw new Error(`unhandled visibility rule: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Tier lock. Missing config (WB admin / no company) enables every app.
 * JSA and unknown catalog IDs are not tier-gated.
 */
export function isAppLocked(
  appId: string,
  isEnabled: ((catalogId: string) => boolean) | undefined,
): boolean {
  if (!isEnabled) return false;
  return !isEnabled(appId);
}
