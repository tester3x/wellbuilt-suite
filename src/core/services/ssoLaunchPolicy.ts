/**
 * Which apps still receive the legacy credential-bearing SSO launch.
 *
 * WB-T no longer does. It uses the vc51.9J authorization-code bridge, so
 * WB-S launches it on a credential-free start route and WB-T mints its
 * own PKCE attempt from there.
 *
 * WB-M now joins WB-T on the credential-free start route. WB-JSA and
 * eQuipment are UNCHANGED and still carry `hash` — see LEGACY_HASH_SSO_DEBT.
 * Migrating those remaining apps is out of scope.
 *
 * Pure and node-testable: no imports, no platform APIs.
 */

/** The WB-T deep-link scheme, as registered in its AndroidManifest. */
export const WBT_SCHEME = 'wellbuilt-tickets';

/**
 * The credential-free route WB-S opens on WB-T.
 *
 * Carries nothing: no hash, no name, no company, no token. WB-T reacts by
 * generating its own state/verifier/challenge and calling back into
 * WB-S's authorization route — the extra hop exists precisely so the
 * verifier originates in, and never leaves, WB-T.
 */
export const WBT_SSO_START_HOST = 'sso-start';

/** Same host WB-T already uses. WB-M keeps the wellbuiltmobile scheme. */
export const WBM_SCHEME = 'wellbuiltmobile';
export const WBM_SSO_START_HOST = 'sso-start';

export function wbtSsoStartUrl(): string {
  return `${WBT_SCHEME}://${WBT_SSO_START_HOST}`;
}

export function wbmSsoStartUrl(): string {
  return `${WBM_SCHEME}://${WBM_SSO_START_HOST}`;
}

/**
 * True when this launch target must NOT receive credential SSO params.
 *
 * Matched on scheme, which is the identity the OS actually routes on.
 * WB-T and WB-M are credential-free. JSA and eQuipment stay on the
 * hash-debt inventory until their own packets migrate them.
 */
export function isCredentialFreeLaunchTarget(scheme?: string | null): boolean {
  if (typeof scheme !== 'string') return false;
  const s = scheme.toLowerCase();
  return s === WBT_SCHEME || s === WBM_SCHEME;
}

/** Audience the Suite authorize hop must issue for a credential-free scheme. */
export function credentialFreeAudience(scheme?: string | null): 'wellbuilt-tickets' | 'wellbuilt-mobile' | null {
  if (typeof scheme !== 'string') return null;
  const s = scheme.toLowerCase();
  if (s === WBT_SCHEME) return 'wellbuilt-tickets';
  if (s === WBM_SCHEME) return 'wellbuilt-mobile';
  return null;
}

/**
 * Apps whose launch still transports the passcode hash.
 *
 * Recorded as an explicit inventory so the debt is visible and a test can
 * assert it neither grows nor silently disappears. Each entry needs its
 * own authorization-code bridge before the hash transport can be removed.
 */
export const LEGACY_HASH_SSO_DEBT: readonly {
  app: string;
  scheme: string;
  transports: readonly string[];
  migration: string;
}[] = Object.freeze([
  Object.freeze({
    app: 'WB JSA',
    scheme: 'jsaapp',
    transports: Object.freeze(['hash', 'name', 'companyId', 'truck', 'trailer', 'packageId', 'shiftStartTime', 'shiftId']),
    migration: 'needs its own vc51.9J-style bridge before hash transport can be removed',
  }),
  Object.freeze({
    app: 'WB eQuipment',
    scheme: 'wellbuiltequipment',
    transports: Object.freeze(['hash', 'name', 'companyId', 'truck', 'trailer', 'packageId', 'shiftStartTime', 'shiftId']),
    migration: 'needs its own vc51.9J-style bridge before hash transport can be removed',
  }),
]);
