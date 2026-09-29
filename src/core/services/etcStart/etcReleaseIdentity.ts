/**
 * Release package and signing identity for the ETC provider call.
 *
 * Both stay empty on purpose. The ETC receiver allowlist
 * `etc_suite_hos_trusted_callers` is empty, and Suite has not verified
 * ETC's installed package name or current signing certificate. An empty
 * identity disables dispatch. Do not fill these with ETC's source
 * application id or an unverified fingerprint. `app.json`'s package is
 * Suite's declared id, not proof of the installed signer. Manifest
 * queries may name ETC so a later check can see it; that is not trust.
 */
export interface EtcReleaseIdentity {
  verified: boolean;
  etcPackageName: string | null;
  etcCertSha256: string | null;
}

export const ETC_RELEASE_IDENTITY: EtcReleaseIdentity = {
  verified: false,
  etcPackageName: null,
  etcCertSha256: null,
};

export function isEtcDispatchConfigured(identity: EtcReleaseIdentity = ETC_RELEASE_IDENTITY): boolean {
  if (!identity.verified) return false;
  if (!identity.etcPackageName || !identity.etcCertSha256) return false;
  if (!/^[0-9a-f]{64}$/i.test(identity.etcCertSha256)) return false;
  return true;
}
