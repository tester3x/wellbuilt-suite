/**
 * Issuance-incapable terminal SSO error responder.
 *
 * A queued authorize that reaches a terminal authority failure (revalidation
 * failed, reconciliation rejected/unavailable, no/mismatched equipment shift)
 * must return a bounded credential-free error callback so the counterpart is
 * not stranded. This module is the ONLY path allowed to do that.
 *
 * STRUCTURAL INABILITY TO ISSUE (dependency graph):
 *   This file imports:
 *     - ssoProtocol.generated (parse + allowlists only)
 *     - ssoRouteAdapter.buildAudienceCallbackUrl / isSsoAuthorizeUrl (URL
 *       builders/predicates; the route adapter's handle/authorize factory is
 *       never called)
 *   This file does NOT import:
 *     - ssoRuntime / dispatchSsoUrl
 *     - ssoAuthorizationCore / createSsoAuthorizationHandler
 *     - ssoIssuanceClient / requestCode
 *     - firebaseAuthBoundary / getVerifiedIdentity
 *     - any claims, token, or identity reader
 *
 * It never consults the identity epoch, so an epoch bump or adapter.reset()
 * cannot convert a scheduled terminal response into `abandoned`.
 *
 * Callback contents are limited to protocol version, status=error, an
 * allowlisted error code, and validated state when present.
 */
import {
  SSO_PROTOCOL_VERSION,
  isSsoAudience,
  isSsoErrorCode,
  parseSsoAuthorizationUrl,
  type SsoAudience,
  type SsoErrorCode,
} from './ssoProtocol.generated';
import { buildAudienceCallbackUrl, isSsoAuthorizeUrl } from './ssoRouteAdapter';

export type SsoTerminalReason =
  | 'revalidation_failed'
  | 'reconciliation_rejected'
  | 'reconciliation_unavailable'
  | 'equipment_unavailable'
  | 'not_sso';

export type SsoTerminalResult =
  | { kind: 'answered'; errorCode: SsoErrorCode; audience: SsoAudience }
  | { kind: 'log_only'; reason: SsoTerminalReason }
  | { kind: 'callback-failed'; errorCode: SsoErrorCode };

export function mapTerminalReasonToErrorCode(reason: SsoTerminalReason): SsoErrorCode | null {
  switch (reason) {
    case 'revalidation_failed':
    case 'reconciliation_rejected':
    case 'equipment_unavailable':
      return 'not_authorized';
    case 'reconciliation_unavailable':
      return 'unavailable';
    case 'not_sso':
      return null;
  }
}

export interface SsoTerminalResponderOps {
  openUrl(url: string): Promise<void>;
  /** Reason codes only — never a URL, token, code, state, or identity. */
  log?(event: string, reason: string): void;
}

/**
 * Parse an inbound authorize URL and, if it is a valid allowlisted request,
 * open the fixed audience error callback. Invalid / non-SSO input is log-only.
 */
export async function respondSsoTerminalError(
  url: string,
  reason: SsoTerminalReason,
  ops: SsoTerminalResponderOps,
): Promise<SsoTerminalResult> {
  const errorCode = mapTerminalReasonToErrorCode(reason);
  if (!errorCode || !isSsoAuthorizeUrl(url)) {
    ops.log?.('sso.route.queued_closed', reason);
    return { kind: 'log_only', reason };
  }

  const parsed = parseSsoAuthorizationUrl(url);
  if (!parsed.ok || !isSsoAudience(parsed.value.audience)) {
    ops.log?.('sso.route.queued_closed', reason);
    return { kind: 'log_only', reason };
  }
  if (!isSsoErrorCode(errorCode)) {
    ops.log?.('sso.route.queued_closed', 'error_code_not_allowlisted');
    return { kind: 'log_only', reason };
  }

  const audience = parsed.value.audience;
  const callback = {
    protocolVersion: SSO_PROTOCOL_VERSION,
    status: 'error' as const,
    errorCode,
    ...(parsed.value.state ? { state: parsed.value.state } : {}),
  };

  const callbackUrl = buildAudienceCallbackUrl(callback, audience);
  try {
    await ops.openUrl(callbackUrl);
  } catch {
    ops.log?.('sso.route.terminal_callback_failed', errorCode);
    return { kind: 'callback-failed', errorCode };
  }
  ops.log?.('sso.route.terminal_error', reason);
  return { kind: 'answered', errorCode, audience };
}
