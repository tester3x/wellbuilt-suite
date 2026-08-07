/**
 * WB-S SSO authorization handler — decision core (vc51.9J).
 *
 * WB-T asks WB-S to vouch for the driver. WB-S may only do that when it
 * holds a session it can currently PROVE: an owned, boundary-established
 * Auth session whose fresh server-minted claims match the local driver
 * identity this device is signed in as. Anything less returns an error
 * callback and WB-T falls back to its own manual login.
 *
 * The gates below are ordered so that nothing leaves the device until
 * every local check has passed. In particular the server is not asked for
 * a code until WB-S has already satisfied itself about who it is.
 *
 * Injected ops, same reason as everywhere else in this stack: "a logout
 * during issuance invalidates the callback" is an ordering property and
 * cannot be proven by reading source.
 */
import {
  SSO_AUDIENCE_WBT,
  SSO_CHALLENGE_METHOD,
  SSO_PROTOCOL_VERSION,
  validateSsoAuthorizationRequest,
  type SsoAuthorizationRequest,
  type SsoCallback,
  type SsoErrorCode,
} from './ssoProtocol.generated';

export interface SsoIssuerLocalIdentity {
  driverId: string;
  companyId: string;
}

export interface SsoIssuerVerifiedIdentity {
  uid: string;
  kind: string | null;
  driverId: string | null;
  companyId: string | null;
}

export interface SsoAuthorizationOps {
  /** WB-S's durable local identity, or null when signed out. */
  getLocalIdentity(): Promise<SsoIssuerLocalIdentity | null>;
  /**
   * Reconciliation state. Only 'verified' means local and SDK identities
   * were confirmed to agree; 'unavailable' means offline, which is a
   * clean "try manual login", not a rejection.
   */
  getReconciliationState(): 'local-only' | 'verifying' | 'verified' | 'rejected' | 'unavailable';
  /** Fresh claims from the owned boundary. Never a cached flag. */
  getVerifiedIdentity(): Promise<SsoIssuerVerifiedIdentity | null>;
  /** Ask the server for a code. Only reached after every local gate. */
  requestCode(request: {
    protocolVersion: number;
    audience: string;
    codeChallenge: string;
    codeChallengeMethod: string;
  }): Promise<{ code: string }>;
  /**
   * Ownership epoch for the WB-S session. Captured before issuance and
   * re-read after, so a logout or driver switch that lands mid-flight
   * invalidates the authorization instead of handing WB-T a code minted
   * for the driver who just left.
   */
  currentIdentityEpoch(): number;
}

export interface SsoAuthorizationOutcome {
  /** Exactly what WB-S sends to the fixed WB-T callback. */
  callback: SsoCallback;
  /** Operator-facing only; never transmitted. */
  internalReason?: string;
}

function errorOut(
  errorCode: SsoErrorCode,
  internalReason: string,
  state?: string,
): SsoAuthorizationOutcome {
  const callback: SsoCallback = {
    protocolVersion: SSO_PROTOCOL_VERSION,
    status: 'error',
    errorCode,
  };
  // Echo state only when we actually parsed one, so WB-T can retire the
  // right attempt. A malformed request yields no state at all.
  if (state) callback.state = state;
  return { callback, internalReason };
}

export function createSsoAuthorizationHandler(ops: SsoAuthorizationOps) {
  return {
    /**
     * Handle one authorization request. Returns the callback payload;
     * the caller is responsible for delivering it to the FIXED WB-T
     * callback route and for nothing else.
     */
    async authorize(rawRequest: unknown): Promise<SsoAuthorizationOutcome> {
      // 1. Strict protocol parse. Audience, version, method, and challenge
      //    shape are all enforced here, and anything unparseable never
      //    reaches identity code.
      const parsed = validateSsoAuthorizationRequest(rawRequest);
      if (!parsed.ok) {
        return errorOut(parsed.errorCode, `invalid ${parsed.field}`);
      }
      const request: SsoAuthorizationRequest = parsed.value;

      if (request.audience !== SSO_AUDIENCE_WBT) {
        return errorOut('unsupported_audience', 'audience not allowlisted', request.state);
      }
      if (request.codeChallengeMethod !== SSO_CHALLENGE_METHOD) {
        return errorOut('unsupported_method', 'method not S256', request.state);
      }

      // 2. WB-S must have a local identity at all.
      const local = await ops.getLocalIdentity();
      if (!local) {
        return errorOut('not_authorized', 'no local identity', request.state);
      }

      // 3. Reconciliation must say VERIFIED. 'local-only' is the offline
      //    driver: a perfectly valid way to use WB-S, and precisely the
      //    state that must NOT be silently upgraded into cloud authority
      //    for another app.
      const reconciliation = ops.getReconciliationState();
      if (reconciliation === 'unavailable' || reconciliation === 'verifying') {
        return errorOut('unavailable', `reconciliation ${reconciliation}`, request.state);
      }
      if (reconciliation !== 'verified') {
        return errorOut('not_authorized', `reconciliation ${reconciliation}`, request.state);
      }

      // 4. Fresh claims from the boundary — not the reconciliation verdict,
      //    which is a cached judgement about an earlier moment.
      let verified: SsoIssuerVerifiedIdentity | null;
      try {
        verified = await ops.getVerifiedIdentity();
      } catch {
        return errorOut('unavailable', 'claims unreadable', request.state);
      }
      if (!verified) {
        return errorOut('not_authorized', 'no owned session', request.state);
      }
      if (verified.kind !== 'driver') {
        return errorOut('not_authorized', 'session is not a driver', request.state);
      }
      if (!verified.driverId || !verified.companyId) {
        return errorOut('not_authorized', 'incomplete claims', request.state);
      }

      // 5. Those claims must describe the driver THIS device is signed in
      //    as. A disagreement means the two identities have drifted, which
      //    is exactly the case that must never be bridged.
      if (verified.driverId !== local.driverId || verified.companyId !== local.companyId) {
        return errorOut('not_authorized', 'sdk/local identity mismatch', request.state);
      }

      // 6. Every local gate has passed. Only now does anything leave the
      //    device.
      const epochBefore = ops.currentIdentityEpoch();
      let code: string;
      try {
        const result = await ops.requestCode({
          protocolVersion: SSO_PROTOCOL_VERSION,
          audience: request.audience,
          codeChallenge: request.codeChallenge,
          codeChallengeMethod: request.codeChallengeMethod,
        });
        code = result.code;
      } catch {
        return errorOut('unavailable', 'code request failed', request.state);
      }

      // 7. A logout or driver switch during issuance invalidates this
      //    authorization. The code exists server-side and will simply
      //    expire unused; handing it to WB-T would bridge the driver who
      //    just left.
      if (ops.currentIdentityEpoch() !== epochBefore) {
        return errorOut('superseded', 'identity changed during issuance', request.state);
      }

      return {
        callback: {
          protocolVersion: SSO_PROTOCOL_VERSION,
          status: 'success',
          code,
          state: request.state,
        },
      };
    },
  };
}
