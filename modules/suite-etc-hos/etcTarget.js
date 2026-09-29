/**
 * ETC targets Suite may be built against.
 * Visibility and the expected provider identity are not permission to call.
 * Shipped profiles keep dispatchEnabled false. Tests may clone a target
 * with dispatch enabled; they must not flip these frozen objects.
 */
const PRODUCTION_ETC_TARGET = Object.freeze({
  profile: 'production',
  visibilityPackage: 'com.wellbuilt.electronictimecard',
  authority: 'com.wellbuilt.electronictimecard.suitehos',
  etcPackageName: null,
  etcCertSha256: null,
  etcVersionCode: null,
  dispatchEnabled: false,
});

const FIELD_TEST_ETC_TARGET = Object.freeze({
  profile: 'field-test',
  visibilityPackage: 'com.wellbuilt.electronictimecard.fieldtest',
  authority: 'com.wellbuilt.electronictimecard.fieldtest.suitehos',
  etcPackageName: 'com.wellbuilt.electronictimecard.fieldtest',
  etcCertSha256: '349bac3a8a8462a223d9eeb8dc4511fb5091a81a3d48e819b94d46bf68ea75b7',
  etcVersionCode: 56,
  dispatchEnabled: false,
});

const ETC_TARGETS = Object.freeze({
  production: PRODUCTION_ETC_TARGET,
  'field-test': FIELD_TEST_ETC_TARGET,
});

const CERT_SHA256 = /^[0-9a-f]{64}$/i;

function etcTargetForEnv(env) {
  const source = env && typeof env === 'object' ? env : {};
  return source.SUITE_ETC_FIELD_TEST === '1' ? FIELD_TEST_ETC_TARGET : PRODUCTION_ETC_TARGET;
}

function identityForTarget(target) {
  const pkg = typeof target?.etcPackageName === 'string' ? target.etcPackageName : '';
  const cert = typeof target?.etcCertSha256 === 'string' ? target.etcCertSha256 : '';
  if (target?.dispatchEnabled !== true || !pkg || !CERT_SHA256.test(cert)) {
    return { verified: false, etcPackageName: null, etcCertSha256: null };
  }
  return {
    verified: true,
    etcPackageName: pkg,
    etcCertSha256: cert.toLowerCase(),
  };
}

/**
 * Decides whether a provider call is allowed.
 * expected: { expectedPackage, expectedCertSha256, signatureMatches, creatorPackage, method }
 * Shipped targets stop at dispatch_disabled before any fingerprint is trusted.
 */
function planEtcProviderCall(target, expected) {
  if (target?.dispatchEnabled !== true) {
    return { ok: false, reason: 'dispatch_disabled' };
  }
  const pkg = typeof target.etcPackageName === 'string' ? target.etcPackageName : '';
  const cert = typeof target.etcCertSha256 === 'string' ? target.etcCertSha256 : '';
  const authority = typeof target.authority === 'string' ? target.authority : '';
  if (!pkg || !authority || !CERT_SHA256.test(cert)) {
    return { ok: false, reason: 'signing_unverified' };
  }
  const expectedPackage = typeof expected?.expectedPackage === 'string' ? expected.expectedPackage : '';
  const expectedCert = typeof expected?.expectedCertSha256 === 'string' ? expected.expectedCertSha256 : '';
  if ((expectedPackage && expectedPackage !== pkg) || (expectedCert && expectedCert.toLowerCase() !== cert.toLowerCase())) {
    return { ok: false, reason: 'package_mismatch' };
  }
  if (expected?.signatureMatches === false) {
    return { ok: false, reason: 'package_mismatch' };
  }
  const creator = expected?.creatorPackage;
  if (expected?.method === 'prepareStart' && creator != null && creator !== '' && creator !== pkg) {
    return { ok: false, reason: 'pending_intent_creator_mismatch' };
  }
  return {
    ok: true,
    authority,
    uri: `content://${authority}`,
    etcPackageName: pkg,
    etcCertSha256: cert.toLowerCase(),
  };
}

/** Values embedded in Expo extra. Dispatch stays off in this artifact. */
function suiteEtcExtra(target) {
  return {
    profile: target.profile,
    authority: target.authority,
    visibilityPackage: target.visibilityPackage,
    etcPackageName: target.etcPackageName,
    etcCertSha256: target.etcCertSha256,
    etcVersionCode: target.etcVersionCode ?? null,
    dispatchEnabled: false,
  };
}

module.exports = {
  PRODUCTION_ETC_TARGET,
  FIELD_TEST_ETC_TARGET,
  ETC_TARGETS,
  etcTargetForEnv,
  identityForTarget,
  planEtcProviderCall,
  suiteEtcExtra,
};
