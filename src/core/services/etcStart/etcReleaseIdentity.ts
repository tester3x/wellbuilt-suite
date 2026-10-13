/**
 * Fail-closed fallback if the verified build target cannot be loaded.
 * The production target is verified separately from installed APK certificates;
 * manifest visibility alone is never permission to call a provider.
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
