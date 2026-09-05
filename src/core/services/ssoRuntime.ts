/**
 * WB-S SSO runtime wiring (vc51.9J-C2).
 *
 * The one place binding the pure authorization handler, route adapter,
 * and issuance client to real platform capabilities: Linking, the
 * Firebase Functions client, and the boundary-owned Auth session.
 *
 * Deliberately thin — everything decision-shaped is tested elsewhere.
 */
import { Linking } from 'react-native';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp, FIREBASE_REGION } from './firebaseApp';
import { getOwnedVerifiedIdentity } from './firebaseAuthBoundary';
import { getAuthReconciliationState, readLocalIdentity } from './authReconciliation';
import { createSsoAuthorizationHandler } from './ssoAuthorizationCore';
import { createSsoRouteAdapter, type SsoRouteAdapter } from './ssoRouteAdapter';
import {
  createSsoIssuanceClient,
  SSO_ISSUE_CALLABLE,
  SSO_ISSUE_TIMEOUT_MS,
  type SsoCallableTransport,
} from './ssoIssuanceClient';
import { parseSsoAuthorizationUrl } from './ssoProtocol.generated';
import {
  noteSsoHandoffCallbackLaunched,
  noteSsoHandoffClaim,
  noteSsoHandoffTerminalError,
} from './ssoHandoffOverlayStore';

/**
 * WB-S identity epoch.
 *
 * Bumped on logout and on any driver transition. The route adapter
 * captures it before issuance and re-reads it after, so an answer minted
 * for a driver who has since left is never delivered.
 */
let identityEpoch = 1;

export function bumpSsoIdentityEpoch(): void {
  identityEpoch += 1;
  adapter?.reset();
}

/** Production transport: the real callable, on the project's region. */
export const realCallableTransport: SsoCallableTransport = async (name, payload, timeoutMs) => {
  // Callable Auth is attached by the Functions SDK from the owned SDK
  // session; this module never touches a token.
  const fns = getFunctions(getFirebaseApp(), FIREBASE_REGION);
  const callable = httpsCallable(fns, name, { timeout: timeoutMs });
  const result = await callable(payload);
  return result.data;
};

let adapter: SsoRouteAdapter | null = null;

export function getSsoRouteAdapter(
  transport: SsoCallableTransport = realCallableTransport,
): SsoRouteAdapter {
  if (adapter) return adapter;

  const issuance = createSsoIssuanceClient(transport);
  const handler = createSsoAuthorizationHandler({
    getLocalIdentity: async () => {
      const local = await readLocalIdentity();
      if (!local.driverId || !local.companyId) return null;
      return { driverId: local.driverId, companyId: local.companyId };
    },
    getReconciliationState: () => getAuthReconciliationState(),
    // forceRefresh: verify the server's CURRENT view, not a cached one.
    getVerifiedIdentity: () => getOwnedVerifiedIdentity(getFirebaseApp(), true),
    // Wall clock for refresh-duration telemetry only. Nothing is bounded,
    // cancelled, or decided by it — a timer cannot bound an operation that
    // freezes together with the timer, which is exactly what the device
    // proved when Suite loses the foreground.
    nowMs: () => Date.now(),
    // Sanitized boundary telemetry. Phase and category are closed sets
    // declared in the core and the only other value is an elapsed
    // millisecond count, so this line cannot carry a token, code, state,
    // PKCE value, URL, claim, or identifier.
    log: (phase, category, elapsed) => {
      const ms = typeof elapsed === 'number' ? ` (${elapsed}ms)` : '';
      console.log(`[sso] ${phase}${category ? `: ${category}` : ''}${ms}`);
    },
    requestCode: (request) => issuance.requestCode(request),
    currentIdentityEpoch: () => identityEpoch,
    getEquipmentShiftBinding: async () => {
      const { liveCompositeReadiness, computeCompositeGate } = await import(
        './ssoCompositeReadiness'
      );
      const snap = liveCompositeReadiness()?.peek();
      if (!snap || computeCompositeGate(snap) !== 'ready') return null;
      if (snap.equipment !== 'open' || !snap.binding) return null;
      return snap.binding;
    },
  });

  adapter = createSsoRouteAdapter({
    authorize: (request) => handler.authorize(request),
    openUrl: (url) => Linking.openURL(url),
    currentEpoch: () => identityEpoch,
    log: (event, reason) => {
      // Reason CODES only. Never a URL, code, state, challenge, token, or
      // any identifier.
      console.log(`[sso] ${event}: ${reason}`);
    },
  });
  return adapter;
}

/**
 * Dispatch one incoming URL through the SSO adapter.
 * Returns the full route result so callers can navigate/de-dupe without guessing.
 * `kind: 'not-sso'` when the URL is not the authorize route (or empty).
 */
export async function dispatchSsoUrl(
  url: string | null | undefined,
): Promise<import('./ssoRouteAdapter').SsoRouteResult | { kind: 'not-sso' }> {
  if (!url) return { kind: 'not-sso' };
  // HANDOFF OVERLAY (visual only, both calls fire-and-forget). The claim
  // note is the HYBRID FALLBACK arm: for a process-preserved outbound
  // handoff the overlay is already up ('opening' → 'authorizing'); for a
  // counterpart-originated leg or a Suite that died mid-handoff it arms
  // here, honestly accepting one pre-JS Home frame in that recovery case.
  // Neither call is awaited by, or can influence, the route adapter.
  try {
    const parsed = parseSsoAuthorizationUrl(url);
    if (parsed.ok) noteSsoHandoffClaim(parsed.value.audience, Date.now());
  } catch { /* pixels only */ }
  const result = await getSsoRouteAdapter().handle(url);
  try {
    // answered/success = issuance completed AND the callback intent was
    // opened by the handler — the overlay moves to callback_launched and
    // DELIBERATELY DOES NOT CLEAR: the trace shows a possible Home frame
    // between callback launch and WB-T taking the foreground, so clearing
    // waits for the AppState departure (or the bounded timeout).
    if (result.kind === 'answered' && result.status === 'success') {
      noteSsoHandoffCallbackLaunched();
    } else if (
      (result.kind === 'answered' && result.status === 'error')
      || result.kind === 'abandoned'
      || result.kind === 'callback-failed'
    ) {
      // Terminal with no callback: uncover so the bounded error UI shows.
      noteSsoHandoffTerminalError();
    }
    // duplicate / busy / not-sso: no overlay change — the live handoff's
    // state still belongs to the first claimer.
  } catch { /* pixels only */ }
  return result;
}

/** True when the URL was claimed by the SSO adapter (any non-not-sso outcome). */
export function isSsoRouteClaimed(
  result: import('./ssoRouteAdapter').SsoRouteResult | { kind: 'not-sso' },
): boolean {
  return result.kind !== 'not-sso';
}

/** Test-only: drop the singleton so a suite can exercise a cold start. */
export function __resetSsoRuntimeForTests(): void {
  adapter = null;
  identityEpoch = 1;
}

export { SSO_ISSUE_CALLABLE, SSO_ISSUE_TIMEOUT_MS };
