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
  SSO_AUDIENCE_EQUIPMENT,
  SSO_AUDIENCE_JSA,
  SSO_AUDIENCE_WBT,
  SSO_AUDIENCE_WBM,
  SSO_CHALLENGE_METHOD,
  SSO_PROTOCOL_VERSION,
  audienceRequiresShiftBinding,
  isSsoAudience,
  validateSsoAuthorizationRequest,
  type SsoAudience,
  type SsoAuthorizationRequest,
  type SsoCallback,
  type SsoErrorCode,
  type SsoShiftBinding,
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

/**
 * Observability for the forced claims refresh — and why there is NO timeout.
 *
 * WHAT THE TELEMETRY FOUND (device-proven 2026-08-11, three consecutive
 * runs). Two earlier handoffs had gone silent with no issuance reaching the
 * backend, and this refresh was the last unbounded operation before
 * `requestCode`. Instrumenting it settled that: the failing run logged
 * `refresh.started` and no completion. So the stall really is here.
 *
 * WHY A TIMEOUT IS THE WRONG TOOL — and was actively harmful. The same run
 * proved the refresh is not HUNG, it is FROZEN: Suite loses the foreground
 * to the arbitration race, and Android suspends the whole JS context. A
 * `setTimeout` bound freezes with it, so a nominal 10 s bound fired at
 * ~50 s of wall clock — it cannot enforce a wall-clock deadline it is
 * itself suspended by. Worse, on unfreeze the overdue timer drained BEFORE
 * the settling promise and killed a refresh that resolved successfully
 * 19 ms later, converting a recoverable handoff into a failed
 * authorization. A bound that can only fire when the thing it bounds is
 * also about to succeed is not a safety net; it is a coin flip that loses.
 *
 * So the refresh is awaited plainly again. The freeze is a foreground
 * lifecycle defect and must be fixed there, not papered over with a timer
 * that shares its fate. What remains here is truthful observability —
 * started / completed / failed with elapsed wall-clock — which is what
 * made the diagnosis possible in the first place and costs nothing.
 */

/** Closed set. Nothing else may be logged from this boundary. */
export type SsoRefreshPhase =
  | 'refresh.started'
  | 'refresh.completed'
  | 'refresh.failed';

/** Closed set. Coarse by design — never an error message or identifier. */
export type SsoRefreshCategory = 'ok' | 'error' | 'superseded';

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
    shiftBinding?: SsoShiftBinding;
  }): Promise<{ code: string }>;
  /**
   * Ownership epoch for the WB-S session. Captured before issuance and
   * re-read after, so a logout or driver switch that lands mid-flight
   * invalidates the authorization instead of handing WB-T a code minted
   * for the driver who just left.
   */
  currentIdentityEpoch(): number;
  /**
   * Wall clock, injected for testability. Used ONLY to measure elapsed
   * refresh duration for telemetry — never to bound, cancel, or decide
   * anything. Absent clock simply means no duration is reported.
   */
  nowMs?(): number;
  /**
   * Sanitized boundary telemetry. Phase and category are CLOSED SETS
   * declared in this file, and the only other value is an elapsed
   * millisecond count — so no token, code, state, PKCE material, URL,
   * claim, or identifier can reach a log.
   */
  log?(phase: SsoRefreshPhase, category?: SsoRefreshCategory, elapsedMs?: number): void;
  /**
   * Authoritative equipment shift binding from WB-S governed state.
   * Required when audience is equipment; ignored for tickets.
   */
  getEquipmentShiftBinding?(): Promise<SsoShiftBinding | null>;
}

export interface SsoAuthorizationOutcome {
  /** Exactly what WB-S sends to the fixed audience callback. */
  callback: SsoCallback;
  /** Operator-facing only; never transmitted. */
  internalReason?: string;
  /** Drives fixed callback scheme selection (tickets vs equipment). */
  audience?: SsoAudience;
}

/** Elapsed ms when both readings exist; undefined when no clock was injected. */
function elapsedMs(startedAtMs?: number, endedAtMs?: number): number | undefined {
  if (typeof startedAtMs !== 'number' || typeof endedAtMs !== 'number') return undefined;
  return endedAtMs - startedAtMs;
}

function errorOut(
  errorCode: SsoErrorCode,
  internalReason: string,
  state?: string,
  audience?: SsoAudience,
): SsoAuthorizationOutcome {
  const callback: SsoCallback = {
    protocolVersion: SSO_PROTOCOL_VERSION,
    status: 'error',
    errorCode,
  };
  // Echo state only when we actually parsed one, so the target can retire the
  // right attempt. A malformed request yields no state at all.
  if (state) callback.state = state;
  return { callback, internalReason, audience };
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

      if (!isSsoAudience(request.audience)) {
        return errorOut('unsupported_audience', 'audience not allowlisted', request.state);
      }
      if (
        request.audience !== SSO_AUDIENCE_WBT
        && request.audience !== SSO_AUDIENCE_EQUIPMENT
        && request.audience !== SSO_AUDIENCE_JSA
        && request.audience !== SSO_AUDIENCE_WBM
      ) {
        return errorOut('unsupported_audience', 'audience not allowlisted', request.state, undefined);
      }
      const aud = request.audience;
      if (request.codeChallengeMethod !== SSO_CHALLENGE_METHOD) {
        return errorOut('unsupported_method', 'method not S256', request.state, aud);
      }

      // 2. WB-S must have a local identity at all.
      const local = await ops.getLocalIdentity();
      if (!local) {
        return errorOut('not_authorized', 'no local identity', request.state, aud);
      }

      // 3. Reconciliation must say VERIFIED. 'local-only' is the offline
      //    driver: a perfectly valid way to use WB-S, and precisely the
      //    state that must NOT be silently upgraded into cloud authority
      //    for another app.
      const reconciliation = ops.getReconciliationState();
      if (reconciliation === 'unavailable' || reconciliation === 'verifying') {
        return errorOut('unavailable', `reconciliation ${reconciliation}`, request.state, aud);
      }
      if (reconciliation !== 'verified') {
        return errorOut('not_authorized', `reconciliation ${reconciliation}`, request.state, aud);
      }

      // 4. Fresh claims from the boundary — not the reconciliation verdict,
      //    which is a cached judgement about an earlier moment.
      //
      //    NOT BOUNDED BY A TIMER — deliberately. See the note above
      //    SsoRefreshPhase: the observed stall is a FREEZE, not a hang, and
      //    a JS timer freezes with it. The 10 s bound tried here fired at
      //    ~50 s and killed a refresh that succeeded 19 ms later. Awaited
      //    plainly; the freeze is fixed in the foreground lifecycle.
      //
      //    The epoch is captured BEFORE the refresh, not after it, so a
      //    logout or driver switch that lands DURING the refresh invalidates
      //    the attempt too. Previously the first capture happened after this
      //    await, leaving the refresh window unguarded.
      const epochBeforeRefresh = ops.currentIdentityEpoch();
      let verified: SsoIssuerVerifiedIdentity | null;
      {
        ops.log?.('refresh.started');
        const startedAtMs = ops.nowMs?.();
        try {
          verified = await ops.getVerifiedIdentity();
        } catch {
          ops.log?.('refresh.failed', 'error', elapsedMs(startedAtMs, ops.nowMs?.()));
          return errorOut('unavailable', 'claims unreadable', request.state, aud);
        }
        // Elapsed wall-clock is the one number that made the freeze legible:
        // a healthy refresh is ~100-330 ms, and the frozen one spanned ~50 s.
        ops.log?.('refresh.completed', 'ok', elapsedMs(startedAtMs, ops.nowMs?.()));
      }
      // A driver switch that landed while the refresh was in flight makes
      // these claims describe a session this attempt no longer owns.
      if (ops.currentIdentityEpoch() !== epochBeforeRefresh) {
        ops.log?.('refresh.failed', 'superseded');
        return errorOut('superseded', 'identity changed during claims refresh', request.state, aud);
      }
      if (!verified) {
        return errorOut('not_authorized', 'no owned session', request.state, aud);
      }
      if (verified.kind !== 'driver') {
        return errorOut('not_authorized', 'session is not a driver', request.state, aud);
      }
      if (!verified.driverId || !verified.companyId) {
        return errorOut('not_authorized', 'incomplete claims', request.state, aud);
      }

      // 5. Those claims must describe the driver THIS device is signed in
      //    as. A disagreement means the two identities have drifted, which
      //    is exactly the case that must never be bridged.
      if (verified.driverId !== local.driverId || verified.companyId !== local.companyId) {
        return errorOut('not_authorized', 'sdk/local identity mismatch', request.state, aud);
      }

      // 6. Equipment requires authoritative shift binding from Suite state.
      let shiftBinding: SsoShiftBinding | undefined;
      if (audienceRequiresShiftBinding(request.audience)) {
        if (!ops.getEquipmentShiftBinding) {
          return errorOut('not_authorized', 'no equipment binding resolver', request.state, aud);
        }
        const binding = await ops.getEquipmentShiftBinding();
        if (!binding) {
          return errorOut('not_authorized', 'no authoritative equipment shift binding', request.state, aud);
        }
        shiftBinding = binding;
      }

      // 7. Every local gate has passed. Only now does anything leave the
      //    device.
      const epochBefore = ops.currentIdentityEpoch();
      let code: string;
      try {
        const result = await ops.requestCode({
          protocolVersion: SSO_PROTOCOL_VERSION,
          audience: request.audience,
          codeChallenge: request.codeChallenge,
          codeChallengeMethod: request.codeChallengeMethod,
          ...(shiftBinding ? { shiftBinding } : {}),
        });
        code = result.code;
      } catch {
        return errorOut('unavailable', 'code request failed', request.state, aud);
      }

      // 8. A logout or driver switch during issuance invalidates this
      //    authorization. The code exists server-side and will simply
      //    expire unused; handing it to the target would bridge the driver
      //    who just left.
      if (ops.currentIdentityEpoch() !== epochBefore) {
        return errorOut('superseded', 'identity changed during issuance', request.state, aud);
      }

      return {
        callback: {
          protocolVersion: SSO_PROTOCOL_VERSION,
          status: 'success',
          code,
          state: request.state,
        },
        internalReason: aud === SSO_AUDIENCE_EQUIPMENT
          ? 'equipment_issued'
          : aud === SSO_AUDIENCE_JSA
            ? 'jsa_issued'
            : 'tickets_issued',
        audience: aud,
      };
    },
  };
}
