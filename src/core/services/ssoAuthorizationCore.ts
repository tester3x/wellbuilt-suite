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
  SSO_AUDIENCE_WBT,
  SSO_CHALLENGE_METHOD,
  SSO_PROTOCOL_VERSION,
  audienceRequiresShiftBinding,
  isSsoAudience,
  validateSsoAuthorizationRequest,
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
 * Bound on the forced claims refresh.
 *
 * DEVICE-PROVEN NEED (2026-08-11): in two failed handoffs Suite claimed the
 * authorize route and then went silent — no issuance reached the backend at
 * all (`ssoIssueAuthorizationCode` logged invocations for the three healthy
 * runs and NOTHING for the two failures). The chain therefore died before
 * `requestCode`, and the only unbounded network operation ahead of it is
 * this forced refresh: `getIdTokenResult(true)` has no timeout, no abort,
 * and no race anywhere in the boundary. An unbounded network call in an
 * authorization path is a latent indefinite hang, and this is what it looks
 * like in the field.
 *
 * The three healthy runs completed the ENTIRE authorize+issue chain in
 * 1.0-4.8 s. Against that, 10 s is 10x the FASTEST complete path but only
 * ~2.1x the SLOWEST — a deliberately modest margin over the worst observed
 * healthy case, not an order of magnitude over it. Sequentially with the
 * existing 15 s issuance bound it totals 25 s, which stays inside WB-T's
 * 45 s pending-bridge bound, so a stalled refresh surfaces as Suite's own
 * bounded failure rather than as WB-T timing out on an app that never
 * answered.
 */
export const SSO_VERIFIED_IDENTITY_TIMEOUT_MS = 10_000;

/** Closed set. Nothing else may be logged from this boundary. */
export type SsoRefreshPhase =
  | 'refresh.started'
  | 'refresh.completed'
  | 'refresh.failed'
  | 'refresh.timeout'
  | 'refresh.lateDiscarded';

/** Closed set. Coarse by design — never an error message or identifier. */
export type SsoRefreshCategory = 'ok' | 'error' | 'timeout' | 'superseded';

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
   * Bounded delay, injected so the refresh timeout is testable under node.
   * Only ever raced against getVerifiedIdentity — never awaited alone.
   */
  waitMs?(ms: number): Promise<void>;
  /**
   * Sanitized boundary telemetry. Phase and category are CLOSED SETS
   * declared in this file; nothing else may be passed, so no token, code,
   * state, PKCE material, URL, claim, or identifier can reach a log.
   */
  log?(phase: SsoRefreshPhase, category?: SsoRefreshCategory): void;
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
  audience?: typeof SSO_AUDIENCE_WBT | typeof SSO_AUDIENCE_EQUIPMENT;
}

function errorOut(
  errorCode: SsoErrorCode,
  internalReason: string,
  state?: string,
  audience?: typeof SSO_AUDIENCE_WBT | typeof SSO_AUDIENCE_EQUIPMENT,
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
      //    BOUNDED. The forced refresh is a network call with no timeout of
      //    its own; unbounded, it hangs this attempt forever and the driver
      //    sees nothing until the far app's own bound expires. Racing it
      //    against a delay converts that into the existing bounded failure.
      //
      //    The epoch is captured BEFORE the refresh, not after it, so a
      //    logout or driver switch that lands DURING the refresh invalidates
      //    the attempt too. Previously the first capture happened after this
      //    await, leaving the refresh window unguarded.
      const epochBeforeRefresh = ops.currentIdentityEpoch();
      let verified: SsoIssuerVerifiedIdentity | null;
      {
        ops.log?.('refresh.started');
        type RefreshResult =
          | { kind: 'ok'; value: SsoIssuerVerifiedIdentity | null }
          | { kind: 'error' }
          | { kind: 'timeout' };
        let settled = false;
        const refresh: Promise<RefreshResult> = ops.getVerifiedIdentity()
          .then((value): RefreshResult => {
            // A resolution arriving AFTER the timeout won the race is inert:
            // this attempt already returned, so nothing downstream can be
            // reached. Recorded so a late completion is visible rather than
            // silent — it is the signature of a slow, not dead, refresh.
            if (settled) ops.log?.('refresh.lateDiscarded', 'timeout');
            return { kind: 'ok', value };
          })
          .catch((): RefreshResult => {
            if (settled) ops.log?.('refresh.lateDiscarded', 'error');
            return { kind: 'error' };
          });
        const timeout: Promise<RefreshResult> = ops.waitMs
          ? ops.waitMs(SSO_VERIFIED_IDENTITY_TIMEOUT_MS).then((): RefreshResult => ({ kind: 'timeout' }))
          // No waiter injected (older callers/tests): behave exactly as
          // before rather than inventing an unbounded timer.
          : new Promise<RefreshResult>(() => {});
        const outcome = await Promise.race([refresh, timeout]);
        settled = true;
        if (outcome.kind === 'timeout') {
          ops.log?.('refresh.timeout', 'timeout');
          // INVALIDATION: return through the existing bounded failure path.
          // Because this returns before step 7, a late refresh resolution
          // has no path to requestCode, to a success callback, or to any
          // later terminal mutation — the attempt is over. Recovery is a
          // deliberate fresh attempt, never an automatic retry: Firebase's
          // refresh promise is not cancellable, and retrying could overlap
          // a still-running one.
          return errorOut('unavailable', 'claims refresh timed out', request.state, aud);
        }
        if (outcome.kind === 'error') {
          ops.log?.('refresh.failed', 'error');
          return errorOut('unavailable', 'claims unreadable', request.state, aud);
        }
        ops.log?.('refresh.completed', 'ok');
        verified = outcome.value;
      }
      // A driver switch that landed while the refresh was in flight makes
      // these claims describe a session this attempt no longer owns.
      if (ops.currentIdentityEpoch() !== epochBeforeRefresh) {
        ops.log?.('refresh.lateDiscarded', 'superseded');
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
        internalReason: aud === SSO_AUDIENCE_EQUIPMENT ? 'equipment_issued' : 'tickets_issued',
        audience: aud,
      };
    },
  };
}
