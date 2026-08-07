/**
 * WB-S SSO route ownership (vc51.9J-C2).
 *
 * One owner for `wellbuilt-suite://sso-authorize`. It parses only through
 * the canonical strict parser, runs the accepted authorization handler,
 * and opens only the fixed WB-T callback. No screen parses these query
 * parameters, and no message names a destination — the callback route is
 * a protocol constant.
 *
 * Pure: URL opening and the authorization decision are injected, so the
 * duplicate-delivery, logout-mid-issuance, and stale-finally races are
 * proven by ordering rather than argued.
 */
import {
  SSO_AUTHORIZE_HOST,
  SSO_AUTHORIZE_SCHEME,
  SSO_CALLBACK_SUCCESS_KEYS,
  SSO_CALLBACK_ERROR_KEYS,
  buildSsoCallbackUrl,
  hasOnlyKeys,
  parseSsoAuthorizationUrl,
  type SsoCallback,
} from './ssoProtocol.generated';
import type { SsoAuthorizationOutcome } from './ssoAuthorizationCore';

/** What the adapter decided to do with a URL. Bounded, for diagnostics. */
export type SsoRouteResult =
  | { kind: 'not-sso' }
  /** Already handled this exact URL — cold + warm delivered the same one. */
  | { kind: 'duplicate' }
  /** An authorization attempt is already in flight; this one is refused. */
  | { kind: 'busy' }
  /** A callback was opened. `status` is the callback's own status. */
  | { kind: 'answered'; status: 'success' | 'error' }
  /**
   * A callback was NOT opened because ownership was lost mid-flight
   * (logout or identity transition). Deliberately silent: opening a
   * callback here would hand WB-T a code minted for the driver who left.
   */
  | { kind: 'abandoned' }
  /** The callback URL could not be opened. */
  | { kind: 'callback-failed' };

export interface SsoRouteOps {
  /** Run the accepted authorization handler. */
  authorize(request: unknown): Promise<SsoAuthorizationOutcome>;
  /** Open a URL on the device. */
  openUrl(url: string): Promise<void>;
  /**
   * The current WB-S identity/Auth epoch. Captured before authorization
   * and re-read after every await, so a logout landing mid-flight is
   * detected rather than overtaken.
   */
  currentEpoch(): number;
  /** Bounded diagnostic. Receives reason codes only — never values. */
  log(event: string, reason: string): void;
}

export interface SsoRouteAdapter {
  handle(url: unknown): Promise<SsoRouteResult>;
  /** Diagnostics/tests only. */
  isBusy(): boolean;
  /** Forget delivered URLs. Used on logout and identity transitions. */
  reset(): void;
}

/** True when this URL is WB-S's authorization route, by scheme and host. */
export function isSsoAuthorizeUrl(url: unknown): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return false;
  const at = url.indexOf('://');
  if (at < 0) return false;
  if (url.slice(0, at).toLowerCase() !== SSO_AUTHORIZE_SCHEME) return false;
  const rest = url.slice(at + 3);
  const cut = rest.search(/[?#/]/);
  return (cut < 0 ? rest : rest.slice(0, cut)).toLowerCase() === SSO_AUTHORIZE_HOST;
}

export function createSsoRouteAdapter(ops: SsoRouteOps): SsoRouteAdapter {
  const delivered = new Set<string>();
  /**
   * Generation of the in-flight authorization, or null when idle.
   *
   * A number rather than a boolean so a stale handler's `finally` can
   * check whether it still owns the slot: releasing unconditionally would
   * let attempt A's completion clear attempt B's ownership.
   */
  let inFlight: number | null = null;
  let nextGeneration = 1;

  return {
    async handle(url) {
      if (!isSsoAuthorizeUrl(url)) return { kind: 'not-sso' };
      const key = String(url);

      // Cold start (getInitialURL) and the warm listener can both deliver
      // the same URL. At most one code request may result.
      if (delivered.has(key)) {
        ops.log('sso.route.duplicate', 'same url already handled');
        return { kind: 'duplicate' };
      }
      delivered.add(key);

      if (inFlight !== null) {
        ops.log('sso.route.busy', 'authorization already in flight');
        return { kind: 'busy' };
      }

      const parsed = parseSsoAuthorizationUrl(url);
      const generation = nextGeneration++;
      inFlight = generation;
      const epochBefore = ops.currentEpoch();

      try {
        let callback: SsoCallback;
        if (!parsed.ok) {
          // Malformed, wrong protocol, forbidden extras: answer with the
          // canonical bounded failure. No state exists to echo.
          ops.log('sso.route.rejected', parsed.errorCode);
          callback = {
            protocolVersion: 1,
            status: 'error',
            errorCode: parsed.errorCode,
          };
        } else {
          const outcome = await ops.authorize(parsed.value);

          // Ownership recheck AFTER the awaited authorization. A logout or
          // driver switch that landed mid-flight means this answer is for
          // the previous driver and must not be delivered.
          if (ops.currentEpoch() !== epochBefore) {
            ops.log('sso.route.abandoned', 'identity changed during authorization');
            return { kind: 'abandoned' };
          }
          if (inFlight !== generation) {
            ops.log('sso.route.abandoned', 'superseded by a newer authorization');
            return { kind: 'abandoned' };
          }
          callback = outcome.callback;
          if (outcome.internalReason) {
            // Operator-facing reason code only; never transmitted.
            ops.log('sso.route.outcome', outcome.internalReason);
          }
        }

        // The URL is built by the canonical builder, never by hand, and
        // its key set is asserted before it can be opened.
        const allowed = callback.status === 'success'
          ? SSO_CALLBACK_SUCCESS_KEYS
          : SSO_CALLBACK_ERROR_KEYS;
        if (!hasOnlyKeys(callback, allowed)) {
          ops.log('sso.route.blocked', 'callback carried an unexpected key');
          return { kind: 'abandoned' };
        }

        try {
          await ops.openUrl(buildSsoCallbackUrl(callback));
        } catch {
          // WB-T may not be installed or may have been uninstalled
          // mid-flight. Nothing to retry into — the code simply expires.
          ops.log('sso.route.callbackFailed', 'could not open the WB-T callback');
          return { kind: 'callback-failed' };
        }
        return { kind: 'answered', status: callback.status };
      } finally {
        // Release ONLY if this attempt still owns the slot. A stale
        // handler settling late must not clear a newer attempt.
        if (inFlight === generation) inFlight = null;
      }
    },
    isBusy: () => inFlight !== null,
    reset() {
      delivered.clear();
      inFlight = null;
    },
  };
}
