/**
 * Test-only ETC target routing. Shipped dispatch stays disabled.
 * Run: npx tsx --test src/core/services/etcStart/etcBuildTarget.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { attachEtcHandoff } from './attachEtcHandoff';
import { isEtcDispatchConfigured, ETC_RELEASE_IDENTITY } from './etcReleaseIdentity';
import { listEtcStartsForDriver, memoryEtcKv } from './etcStartOutbox';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..');
const require = createRequire(import.meta.url);
const {
  ETC_TARGETS,
  FIELD_TEST_ETC_TARGET,
  PRODUCTION_ETC_TARGET,
  etcTargetForEnv,
  identityForTarget,
  planEtcProviderCall,
  suiteEtcExtra,
} = require(join(REPO, 'modules/suite-etc-hos/etcTarget.js')) as {
  ETC_TARGETS: Record<string, Target>;
  FIELD_TEST_ETC_TARGET: Target;
  PRODUCTION_ETC_TARGET: Target;
  etcTargetForEnv: (env: Record<string, string | undefined>) => Target;
  identityForTarget: (target: Target) => { verified: boolean; etcPackageName: string | null; etcCertSha256: string | null };
  planEtcProviderCall: (target: Target, expected?: Expected) => Plan;
  suiteEtcExtra: (target: Target) => { profile: string; dispatchEnabled: boolean; authority: string; etcPackageName: string | null; etcCertSha256: string | null };
};

interface Target {
  profile: string;
  visibilityPackage: string;
  authority: string;
  etcPackageName: string | null;
  etcCertSha256: string | null;
  etcVersionCode: number | null;
  dispatchEnabled: boolean;
}

interface Expected {
  expectedPackage?: string;
  expectedCertSha256?: string;
  signatureMatches?: boolean;
  creatorPackage?: string | null;
  method?: string;
}

type Plan =
  | { ok: false; reason: string }
  | { ok: true; authority: string; uri: string; etcPackageName: string; etcCertSha256: string };

const FIELD_PACKAGE = 'com.wellbuilt.electronictimecard.fieldtest';
const FIELD_AUTHORITY = 'com.wellbuilt.electronictimecard.fieldtest.suitehos';
const CERT = '349bac3a8a8462a223d9eeb8dc4511fb5091a81a3d48e819b94d46bf68ea75b7';

function enabledField(): Target {
  return { ...FIELD_TEST_ETC_TARGET, dispatchEnabled: true };
}

test('shipped targets keep production fail-closed and field-test dispatch off', () => {
  assert.equal(Object.isFrozen(PRODUCTION_ETC_TARGET), true);
  assert.equal(Object.isFrozen(FIELD_TEST_ETC_TARGET), true);
  assert.equal(Object.isFrozen(ETC_TARGETS), true);
  const production = etcTargetForEnv({});
  assert.equal(production.profile, 'production');
  assert.equal(production.authority, 'com.wellbuilt.electronictimecard.suitehos');
  assert.equal(production.visibilityPackage, 'com.wellbuilt.electronictimecard');
  assert.equal(production.etcPackageName, null);
  assert.equal(production.etcCertSha256, null);
  assert.equal(production.dispatchEnabled, false);
  assert.deepEqual(identityForTarget(production), ETC_RELEASE_IDENTITY);
  assert.equal(isEtcDispatchConfigured(identityForTarget(production)), false);
  assert.deepEqual(planEtcProviderCall(production, {
    expectedPackage: FIELD_PACKAGE,
    expectedCertSha256: CERT,
    signatureMatches: true,
    method: 'prepareStart',
    creatorPackage: FIELD_PACKAGE,
  }), { ok: false, reason: 'dispatch_disabled' });

  const field = etcTargetForEnv({ SUITE_ETC_FIELD_TEST: '1' });
  assert.equal(field.profile, 'field-test');
  assert.equal(field.visibilityPackage, FIELD_PACKAGE);
  assert.equal(field.etcPackageName, FIELD_PACKAGE);
  assert.equal(field.authority, FIELD_AUTHORITY);
  assert.equal(field.etcCertSha256, CERT);
  assert.equal(field.etcVersionCode, 56);
  assert.equal(field.dispatchEnabled, false);
  assert.deepEqual(identityForTarget(field), {
    verified: false,
    etcPackageName: null,
    etcCertSha256: null,
  });
  assert.equal(isEtcDispatchConfigured(identityForTarget(field)), false);
  assert.equal(planEtcProviderCall(field).ok, false);
  assert.equal((planEtcProviderCall(field) as { reason: string }).reason, 'dispatch_disabled');
  const extra = suiteEtcExtra(field);
  assert.equal(extra.dispatchEnabled, false);
  assert.equal(extra.authority, FIELD_AUTHORITY);
  assert.equal(extra.etcCertSha256, CERT);
  assert.equal(suiteEtcExtra(production).dispatchEnabled, false);
  assert.equal(suiteEtcExtra(production).etcPackageName, null);
  assert.equal(suiteEtcExtra(production).etcCertSha256, null);
});

test('an enabled clone routes one field-test call and rejects signer or creator mismatches', () => {
  const target = enabledField();
  const ready = planEtcProviderCall(target, {
    expectedPackage: FIELD_PACKAGE,
    expectedCertSha256: CERT.toUpperCase(),
    signatureMatches: true,
    method: 'prepareStart',
    creatorPackage: FIELD_PACKAGE,
  });
  assert.deepEqual(ready, {
    ok: true,
    authority: FIELD_AUTHORITY,
    uri: `content://${FIELD_AUTHORITY}`,
    etcPackageName: FIELD_PACKAGE,
    etcCertSha256: CERT,
  });
  assert.equal(planEtcProviderCall({ ...target, etcCertSha256: null }).reason, 'signing_unverified');
  assert.equal(planEtcProviderCall({ ...target, etcPackageName: null }).reason, 'signing_unverified');
  assert.equal(planEtcProviderCall({ ...target, authority: '' }).reason, 'signing_unverified');
  assert.equal(planEtcProviderCall(target, { expectedPackage: 'com.wellbuilt.electronictimecard' }).reason, 'package_mismatch');
  assert.equal(planEtcProviderCall(target, { expectedCertSha256: 'ab'.repeat(32) }).reason, 'package_mismatch');
  assert.equal(planEtcProviderCall(target, { signatureMatches: false }).reason, 'package_mismatch');
  assert.equal(planEtcProviderCall(target, {
    method: 'prepareStart',
    creatorPackage: 'com.wellbuilt.electronictimecard',
    signatureMatches: true,
  }).reason, 'pending_intent_creator_mismatch');
  const identity = identityForTarget(target);
  assert.equal(identity.verified, true);
  assert.equal(identity.etcPackageName, FIELD_PACKAGE);
  assert.equal(isEtcDispatchConfigured(identity), true);
  assert.equal(FIELD_TEST_ETC_TARGET.dispatchEnabled, false);
});

test('configured field-test fingerprints do not call the provider or fail the shift', async () => {
  const kv = memoryEtcKv();
  let calls = 0;
  const result = await attachEtcHandoff({
    claim: { ok: true, periodId: '2026-09-29_120000' },
    generationCurrent: true,
    companyId: 'co-1',
    driverId: 'drv-1',
    nowMs: 1_700_000_000_000,
    activityVisible: true,
    kv,
    identity: identityForTarget(etcTargetForEnv({ SUITE_ETC_FIELD_TEST: '1' })),
    port: {
      available: true,
      async call() {
        calls += 1;
        return { ok: false, reason: 'bridge_error' };
      },
    },
    newRequestId: () => 'field-disabled',
  });
  assert.equal(calls, 0);
  assert.equal(result.reason, 'signing_unverified');
  assert.equal(result.hos, 'unknown');
  assert.equal(result.blocksShift, false);
  assert.equal(result.driverText.includes('started'), false);
});

test('native dispatch_disabled is a known refusal and does not mark the outbox uncertain', async () => {
  const kv = memoryEtcKv();
  const result = await attachEtcHandoff({
    claim: { ok: true, periodId: '2026-09-29_130000' },
    generationCurrent: true,
    companyId: 'co-1',
    driverId: 'drv-1',
    nowMs: 1_700_000_000_000,
    activityVisible: true,
    kv,
    identity: identityForTarget(enabledField()),
    port: {
      available: true,
      async call() {
        return { ok: false, reason: 'dispatch_disabled' };
      },
    },
    newRequestId: () => 'native-disabled',
  });
  assert.equal(result.reason, 'dispatch_disabled');
  assert.equal(result.blocksShift, false);
  assert.equal(result.hos, 'unknown');
  const stored = await listEtcStartsForDriver(kv, 'drv-1', 'co-1');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].dispatchUncertain, false);
  assert.equal(stored[0].request.requestId, 'native-disabled');
});

test('node native loading fail-closes and the module is registered for Android', () => {
  const config = JSON.parse(readFileSync(join(REPO, 'modules/suite-etc-hos/expo-module.config.json'), 'utf8')) as {
    android: { modules: string[] };
  };
  assert.deepEqual(config.android.modules, ['expo.modules.suiteetchos.SuiteEtcHosModule']);
  const source = readFileSync(join(REPO, 'modules/suite-etc-hos/index.js'), 'utf8');
  assert.match(source, /requireNativeModule\('SuiteEtcHos'\)/);
  const native = require(join(REPO, 'modules/suite-etc-hos/index.js')) as {
    callProvider: (args: { method: string; payload: string }) => string;
    nativeAvailable: () => boolean;
  };
  assert.equal(native.nativeAvailable(), false);
  const raw = native.callProvider({ method: 'capabilities', payload: '{}' });
  assert.equal(JSON.parse(raw).reason, 'native_unavailable');
});

test('native and gradle sources agree on BuildConfig and do not bake the field-test fingerprint', () => {
  const kt = readFileSync(join(REPO, 'modules/suite-etc-hos/android/src/main/java/expo/modules/suiteetchos/SuiteEtcHosModule.kt'), 'utf8');
  const gradle = readFileSync(join(REPO, 'modules/suite-etc-hos/android/build.gradle'), 'utf8');
  const release = readFileSync(join(HERE, 'etcReleaseIdentity.ts'), 'utf8');
  assert.equal(kt.includes('"pendingIntent"'), false);
  assert.equal(kt.includes('"request"'), false);
  assert.equal(kt.includes('"result"'), false);
  assert.equal(kt.includes(CERT), false);
  assert.equal(kt.includes('fieldtest'), false);
  assert.equal(kt.includes('com.wellbuilt.electronictimecard.suitehos'), false);
  for (const token of [
    'BuildConfig.SUITE_ETC_DISPATCH_ENABLED',
    'BuildConfig.SUITE_ETC_AUTHORITY',
    'BuildConfig.SUITE_ETC_PACKAGE',
    'BuildConfig.SUITE_ETC_CERT_SHA256',
    'fail("dispatch_disabled")',
    'fail("signing_unverified")',
    'fail("package_mismatch")',
    'fail("pending_intent_creator_mismatch")',
    'putString("payload"',
    'getString("payload"',
    'getParcelable("startIntent"',
    'content://$authority',
  ]) {
    assert.equal(kt.includes(token), true, token);
  }
  assert.ok(kt.indexOf('fail("dispatch_disabled")') < kt.indexOf('contentResolver.call'));
  assert.ok(kt.indexOf('creator != configuredPackage') < kt.indexOf('pending.send()'));
  assert.match(gradle, /buildConfigField "boolean", "SUITE_ETC_DISPATCH_ENABLED", "false"/);
  assert.equal(gradle.includes(CERT), false);
  assert.equal(gradle.includes('fieldtest'), false);
  assert.match(gradle, /suiteEtcProfile != 'field-test'/);
  assert.equal(/\b[0-9a-f]{64}\b/i.test(release), false);
  assert.equal(release.includes('com.wellbuilt.electronictimecard'), false);
  const app = JSON.parse(readFileSync(join(REPO, 'app.json'), 'utf8')) as {
    expo: { android: { package: string; versionCode: number } };
  };
  assert.equal(app.expo.android.package, 'com.wellbuilt.suite');
  assert.equal(app.expo.android.versionCode, 2);
});

test('AuthContext passes the shipped identity and still emits only from enforced start', () => {
  const auth = readFileSync(join(REPO, 'src/core/context/AuthContext.tsx'), 'utf8');
  const start = auth.indexOf('const startShift = useCallback');
  const legacy = auth.indexOf('// ── Legacy / inert:', start);
  const enforced = auth.slice(start, legacy);
  assert.match(enforced, /identity: shippedEtcIdentity\(\)/);
  assert.equal(enforced.includes('attachEtcHandoff'), false);
  const resume = auth.slice(0, start);
  assert.match(resume, /identity: shippedEtcIdentity\(\)/);
  const production = readFileSync(join(HERE, 'etcProduction.ts'), 'utf8');
  assert.match(production, /require\('\.\.\/\.\.\/\.\.\/\.\.\/modules\/suite-etc-hos\/etcTarget\.js'\)/);
  assert.match(production, /export function shippedEtcIdentity/);
  assert.match(production, /expectedPackage: identity\.etcPackageName/);
  assert.equal(production.includes('node:module'), false);
});
