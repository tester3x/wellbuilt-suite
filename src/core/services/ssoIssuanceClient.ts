/**
 * WB-S production client for the issuance callable (vc51.9J-C2).
 *
 * Callable Auth is supplied entirely by the boundary-owned SDK session:
 * the Functions SDK attaches the current user's ID token itself, so this
 * module never handles, stores, or forwards a token. That is why the
 * pre-flight gate below checks the OWNED session rather than passing
 * credentials — there is nothing to pass.
 *
 * The transport is injected so the error-mapping and validation matrix
 * is deterministic; production always constructs the real httpsCallable.
 */
import {
  SSO_AUDIENCE_EQUIPMENT,
  SSO_AUDIENCE_WBT,
  SSO_PROTOCOL_VERSION,
  isSsoAudience,
  isSsoProtocolVersion,
  isSsoCode,
  isSsoShiftBinding,
  type SsoIssueCodeResponse,
  type SsoShiftBinding,
} from './ssoProtocol.generated';

/** Must match the Functions export name exactly. */
export const SSO_ISSUE_CALLABLE = 'ssoIssueAuthorizationCode';

/** Bounded so a hung network cannot strand the authorization. */
export const SSO_ISSUE_TIMEOUT_MS = 15_000;

/** The bounded failures the route adapter can map onto callback codes. */
export type SsoIssuanceFailure = 'unavailable' | 'not_authorized' | 'malformed_request';

export class SsoIssuanceError extends Error {
  constructor(public readonly failure: SsoIssuanceFailure, reason: string) {
    super(reason);
    this.name = 'SsoIssuanceError';
  }
}

/**
 * A callable transport. Returns the raw response payload.
 *
 * Errors are surfaced as-is; `mapTransportError` decides what they mean,
 * so the mapping is testable without a network.
 */
export type SsoCallableTransport = (
  name: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
) => Promise<unknown>;

/**
 * Map a callable failure onto a bounded state.
 *
 * Deliberately coarse. permission-denied and unauthenticated both become
 * `not_authorized` without distinguishing "no such driver" from "driver
 * disabled" from "claims mismatch": that difference is an oracle, and the
 * server already refuses to make it.
 */
export function mapTransportError(err: unknown): SsoIssuanceError {
  const code = String((err as { code?: unknown })?.code ?? '').toLowerCase();
  if (code.includes('unauthenticated') || code.includes('permission-denied')) {
    return new SsoIssuanceError('not_authorized', 'callable refused the caller');
  }
  if (code.includes('invalid-argument')) {
    return new SsoIssuanceError('malformed_request', 'callable rejected the request shape');
  }
  // deadline-exceeded, unavailable, resource-exhausted, internal, and
  // anything unrecognized: WB-T should offer manual login, not report a
  // denial we cannot substantiate.
  return new SsoIssuanceError('unavailable', 'callable unavailable');
}

/** Strictly validate the issuance response. Untrusted input like any other. */
export function validateIssueResponse(raw: unknown): SsoIssueCodeResponse {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (!isSsoProtocolVersion(o.protocolVersion)) {
    throw new SsoIssuanceError('unavailable', 'unsupported issuance protocol version');
  }
  if (!isSsoCode(o.code)) {
    throw new SsoIssuanceError('unavailable', 'malformed issuance code');
  }
  const expires = o.expiresInSeconds;
  if (typeof expires !== 'number' || !Number.isFinite(expires) || expires <= 0) {
    throw new SsoIssuanceError('unavailable', 'malformed issuance expiry');
  }
  return {
    protocolVersion: SSO_PROTOCOL_VERSION,
    code: o.code,
    expiresInSeconds: expires,
  };
}

export interface SsoIssuanceClient {
  requestCode(request: {
    protocolVersion: number;
    audience: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    /** Required for equipment; forbidden for tickets. */
    shiftBinding?: SsoShiftBinding;
  }): Promise<{ code: string; expiresInSeconds: number }>;
}

export function createSsoIssuanceClient(transport: SsoCallableTransport): SsoIssuanceClient {
  return {
    async requestCode(request) {
      if (!isSsoAudience(request.audience)
        || !isSsoProtocolVersion(request.protocolVersion)) {
        throw new SsoIssuanceError('malformed_request', 'refusing to send a non-canonical request');
      }
      if (request.audience === SSO_AUDIENCE_EQUIPMENT) {
        if (!isSsoShiftBinding(request.shiftBinding)) {
          throw new SsoIssuanceError('malformed_request', 'equipment issuance requires shiftBinding');
        }
      } else if (request.audience === SSO_AUDIENCE_WBT) {
        if (request.shiftBinding !== undefined) {
          throw new SsoIssuanceError('malformed_request', 'tickets issuance forbids shiftBinding');
        }
      }
      let raw: unknown;
      try {
        // Exactly the canonical request fields. No identity is sent —
        // the server takes it from the verified Auth context, and sending
        // it would be both useless and a hard reject there.
        const payload: Record<string, unknown> = {
          protocolVersion: request.protocolVersion,
          audience: request.audience,
          codeChallenge: request.codeChallenge,
          codeChallengeMethod: request.codeChallengeMethod,
        };
        if (request.shiftBinding) payload.shiftBinding = request.shiftBinding;
        raw = await transport(
          SSO_ISSUE_CALLABLE,
          payload,
          SSO_ISSUE_TIMEOUT_MS,
        );
      } catch (err) {
        if (err instanceof SsoIssuanceError) throw err;
        throw mapTransportError(err);
      }
      const validated = validateIssueResponse(raw);
      return { code: validated.code, expiresInSeconds: validated.expiresInSeconds };
    },
  };
}
