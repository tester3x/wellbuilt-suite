/**
 * Which apps still receive the legacy credential-bearing SSO launch.
 *
 * WB-T no longer does. It uses the vc51.9J authorization-code bridge, so
 * WB-S launches it on a credential-free start route and WB-T mints its
 * own PKCE attempt from there.
 *
 * WB-M, WB-JSA, and eQuipment are UNCHANGED. Their launch still carries
 * `hash` (the driver passcode hash) in the deep-link URL, which is a
 * bearer credential in a channel the OS can log and any app registering
 * the scheme can read. That is real, live security debt — see
 * LEGACY_HASH_SSO_DEBT below — but migrating them needs a bridge per app
 * and is explicitly out of scope for this packet. Touching them here
 * would break three working logins to fix one.
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

export function wbtSsoStartUrl(): string {
  return `${WBT_SCHEME}://${WBT_SSO_START_HOST}`;
}

/**
 * True when this launch target must NOT receive credential SSO params.
 *
 * Matched on scheme, which is the identity the OS actually routes on.
 */
export function isCredentialFreeLaunchTarget(scheme?: string | null): boolean {
  return typeof scheme === 'string' && scheme.toLowerCase() === WBT_SCHEME;
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
    app: 'WB Mobile',
    scheme: 'wellbuiltmobile',
    transports: Object.freeze(['hash', 'name', 'companyId', 'truck', 'trailer', 'packageId', 'shiftStartTime', 'shiftId']),
    migration: 'needs its own vc51.9J-style bridge before hash transport can be removed',
  }),
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
