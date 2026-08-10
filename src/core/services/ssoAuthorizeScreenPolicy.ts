/**
 * Pure policy for Expo route app/sso-authorize.tsx.
 * Decides working copy and post-dispatch navigation — no React Native imports.
 */
import {
  SSO_AUDIENCE_EQUIPMENT,
  SSO_AUDIENCE_WBT,
  isSsoAudience,
  type SsoAudience,
} from './ssoProtocol.generated';
import type { SsoRouteResult } from './ssoRouteAdapter';

export type AuthorizeScreenStatus = 'working' | 'leaving' | 'error';

/** Map query `aud` (or null) to a supported audience when valid. */
export function audienceFromAuthorizeParams(
  aud: string | string[] | null | undefined,
): SsoAudience | null {
  const raw = Array.isArray(aud) ? aud[0] : aud;
  if (typeof raw !== 'string' || !raw) return null;
  return isSsoAudience(raw) ? raw : null;
}

/** Working-state copy — audience-aware, never assumes equipment. */
export function authorizeWorkingCopy(audience: SsoAudience | null): string {
  if (audience === SSO_AUDIENCE_WBT) return 'Authorizing WellBuilt Tickets…';
  if (audience === SSO_AUDIENCE_EQUIPMENT) return 'Authorizing WellBuilt eQuipment…';
  return 'Authorizing app…';
}

/**
 * After dispatchSsoUrl / adapter.handle finishes for this route:
 * - always leave /sso-authorize (Home) so Back cannot resurrect dead-end;
 * - error UI only for terminal non-success kinds that need a brief message.
 *
 * `duplicate` / `busy` still navigate Home without retry (adapter already
 * de-duped security side; screen must not park).
 */
export function decideAfterAuthorizeDispatch(result: SsoRouteResult | { kind: 'not-sso' }): {
  navigateHome: boolean;
  status: AuthorizeScreenStatus;
  errorMessage: string | null;
  /** Delay before replace Home when showing error (ms). Success → 0. */
  homeDelayMs: number;
} {
  switch (result.kind) {
    case 'answered':
      if (result.status === 'error') {
        return {
          navigateHome: true,
          status: 'error',
          errorMessage: 'Authorization could not complete.',
          homeDelayMs: 900,
        };
      }
      return { navigateHome: true, status: 'leaving', errorMessage: null, homeDelayMs: 0 };
    case 'duplicate':
    case 'busy':
      // Security: no second callback. UX: still leave this dead-end route.
      return { navigateHome: true, status: 'leaving', errorMessage: null, homeDelayMs: 0 };
    case 'abandoned':
    case 'callback-failed':
      return {
        navigateHome: true,
        status: 'error',
        errorMessage: 'Authorization could not complete.',
        homeDelayMs: 900,
      };
    case 'not-sso':
      // Should not happen on this route; still recover to Home.
      return {
        navigateHome: true,
        status: 'error',
        errorMessage: 'Authorization could not complete.',
        homeDelayMs: 600,
      };
    default:
      return {
        navigateHome: true,
        status: 'error',
        errorMessage: 'Authorization could not complete.',
        homeDelayMs: 900,
      };
  }
}

/** Forbidden success/return copy (field defect). */
export const FORBIDDEN_SUCCESS_COPY = [
  'Returning to equipment…',
  'Returning to equipment...',
] as const;
