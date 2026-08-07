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
    requestCode: (request) => issuance.requestCode(request),
    currentIdentityEpoch: () => identityEpoch,
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

/** Dispatch one incoming URL. Returns true when the SSO route claimed it. */
export async function dispatchSsoUrl(url: string | null | undefined): Promise<boolean> {
  if (!url) return false;
  const result = await getSsoRouteAdapter().handle(url);
  return result.kind !== 'not-sso';
}

/** Test-only: drop the singleton so a suite can exercise a cold start. */
export function __resetSsoRuntimeForTests(): void {
  adapter = null;
  identityEpoch = 1;
}

export { SSO_ISSUE_CALLABLE, SSO_ISSUE_TIMEOUT_MS };
