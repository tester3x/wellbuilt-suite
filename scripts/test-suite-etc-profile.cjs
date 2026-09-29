/**
 * Profile separation for the Suite ETC target.
 * Run: node scripts/test-suite-etc-profile.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { applyEtcPackageVisibility, ETC_PROVIDER_AUTHORITY, ETC_SOURCE_APPLICATION_ID } = require('../modules/suite-etc-hos/etcVisibility');
const { FIELD_TEST_ETC_TARGET, PRODUCTION_ETC_TARGET } = require('../modules/suite-etc-hos/etcTarget');
const { propertiesText, retargetEtcQueries, writeSuiteEtcProfile } = require('./sync-suite-etc-profile.cjs');

const CONFIG = require.resolve('../app.config.js');
const TARGET = require.resolve('../modules/suite-etc-hos/etcTarget.js');

const FIELD_PACKAGE = 'com.wellbuilt.electronictimecard.fieldtest';
const FIELD_AUTHORITY = 'com.wellbuilt.electronictimecard.fieldtest.suitehos';
const CERT = '349bac3a8a8462a223d9eeb8dc4511fb5091a81a3d48e819b94d46bf68ea75b7';

function fixtureXml() {
  return [
    '<manifest package="com.wellbuilt.suite">',
    '  <queries>',
    '    <package android:name="com.waze"/>',
    '    <package android:name="com.wellbuilt.electronictimecard"/>',
    '    <provider android:authorities="com.wellbuilt.electronictimecard.suitehos"/>',
    '    <intent>',
    '      <action android:name="android.intent.action.VIEW"/>',
    '    </intent>',
    '  </queries>',
    '</manifest>',
    '',
  ].join('\n');
}

test('default visibility stays on the production ETC package', () => {
  const manifest = applyEtcPackageVisibility({
    queries: [{ package: [{ $: { 'android:name': 'com.waze' } }] }],
  });
  const queries = manifest.queries[0];
  assert.equal(ETC_PROVIDER_AUTHORITY, 'com.wellbuilt.electronictimecard.suitehos');
  assert.equal(ETC_SOURCE_APPLICATION_ID, 'com.wellbuilt.electronictimecard');
  assert.equal(queries.provider.some((entry) => entry.$['android:authorities'] === ETC_PROVIDER_AUTHORITY), true);
  assert.equal(queries.provider.some((entry) => entry.$['android:authorities'] === FIELD_AUTHORITY), false);
  assert.equal(queries.package.some((entry) => entry.$['android:name'] === 'com.waze'), true);
  assert.equal(queries.package.some((entry) => entry.$['android:name'] === ETC_SOURCE_APPLICATION_ID), true);
  assert.equal(queries.package.some((entry) => entry.$['android:name'] === FIELD_PACKAGE), false);
});

test('field-test visibility replaces only the known ETC query entries', () => {
  const manifest = applyEtcPackageVisibility({
    queries: [{
      package: [
        { $: { 'android:name': 'com.waze' } },
        { $: { 'android:name': 'com.wellbuilt.electronictimecard' } },
      ],
      provider: [{ $: { 'android:authorities': 'com.wellbuilt.electronictimecard.suitehos' } }],
    }],
  }, FIELD_TEST_ETC_TARGET);
  const queries = manifest.queries[0];
  const names = queries.package.map((entry) => entry.$['android:name']);
  const authorities = queries.provider.map((entry) => entry.$['android:authorities']);
  assert.deepEqual(names.sort(), ['com.waze', FIELD_PACKAGE].sort());
  assert.deepEqual(authorities, [FIELD_AUTHORITY]);
  const restored = applyEtcPackageVisibility(manifest, PRODUCTION_ETC_TARGET);
  const restoredNames = restored.queries[0].package.map((entry) => entry.$['android:name']);
  assert.deepEqual(restoredNames.sort(), ['com.waze', 'com.wellbuilt.electronictimecard'].sort());
  assert.equal(restoredNames.some((name) => name.endsWith('.fieldtest')), false);
  assert.equal(restored.queries[0].provider[0].$['android:authorities'], ETC_PROVIDER_AUTHORITY);
});

test('manifest retarget keeps unrelated packages and is idempotent', () => {
  const field = retargetEtcQueries(fixtureXml(), FIELD_TEST_ETC_TARGET);
  assert.match(field, /android:name="com.waze"/);
  assert.match(field, /package="com.wellbuilt.suite"/);
  assert.match(field, new RegExp(`android:name="${FIELD_PACKAGE}"`));
  assert.doesNotMatch(field, /android:name="com.wellbuilt.electronictimecard"/);
  assert.match(field, new RegExp(`android:authorities="${FIELD_AUTHORITY}"`));
  assert.equal(retargetEtcQueries(field, FIELD_TEST_ETC_TARGET), field);
  const regular = retargetEtcQueries(field, PRODUCTION_ETC_TARGET);
  assert.match(regular, /android:name="com.wellbuilt.electronictimecard"/);
  assert.doesNotMatch(regular, /fieldtest/);
  assert.match(regular, /android:name="com.waze"/);
  assert.equal(retargetEtcQueries(regular, PRODUCTION_ETC_TARGET), regular);
});

test('properties carry the field-test provider only for that profile', () => {
  const field = propertiesText(FIELD_TEST_ETC_TARGET);
  assert.match(field, /^profile=field-test/m);
  assert.match(field, new RegExp(`^authority=${FIELD_AUTHORITY}$`, 'm'));
  assert.match(field, new RegExp(`^package=${FIELD_PACKAGE}$`, 'm'));
  assert.match(field, new RegExp(`^cert=${CERT}$`, 'm'));
  assert.match(field, /^dispatch=false$/m);
  const regular = propertiesText(PRODUCTION_ETC_TARGET);
  assert.match(regular, /^profile=production/m);
  assert.match(regular, /^authority=com\.wellbuilt\.electronictimecard\.suitehos$/m);
  assert.match(regular, /^package=$/m);
  assert.match(regular, /^cert=$/m);
  assert.equal(regular.includes(CERT), false);
  assert.equal(regular.includes('fieldtest'), false);
});

test('sync writes properties and retargets an existing manifest without touching other roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-etc-profile-'));
  const manifestDir = path.join(root, 'android', 'app', 'src', 'main');
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, 'AndroidManifest.xml');
  fs.writeFileSync(manifestPath, fixtureXml(), 'utf8');
  const field = writeSuiteEtcProfile({ root, env: { SUITE_ETC_FIELD_TEST: '1' } });
  assert.equal(field.manifestChanged, true);
  assert.match(fs.readFileSync(field.propsPath, 'utf8'), new RegExp(`^cert=${CERT}$`, 'm'));
  assert.match(fs.readFileSync(manifestPath, 'utf8'), new RegExp(FIELD_AUTHORITY));
  const repeat = writeSuiteEtcProfile({ root, env: { SUITE_ETC_FIELD_TEST: '1' } });
  assert.equal(repeat.manifestChanged, false);
  const regular = writeSuiteEtcProfile({ root, env: {} });
  assert.equal(regular.manifestChanged, true);
  const props = fs.readFileSync(regular.propsPath, 'utf8');
  assert.match(props, /^profile=production/m);
  assert.equal(props.includes(CERT), false);
  const xml = fs.readFileSync(manifestPath, 'utf8');
  assert.match(xml, /com\.wellbuilt\.electronictimecard\.suitehos/);
  assert.equal(xml.includes('fieldtest'), false);
  assert.match(xml, /com\.waze/);
});

test('app config keeps the Suite package and forces dispatch off for either target', () => {
  const previous = process.env.SUITE_ETC_FIELD_TEST;
  function load(fieldTest) {
    if (fieldTest) process.env.SUITE_ETC_FIELD_TEST = '1';
    else delete process.env.SUITE_ETC_FIELD_TEST;
    delete require.cache[CONFIG];
    delete require.cache[TARGET];
    return require('../app.config.js');
  }
  try {
    const field = load(true);
    assert.equal(field.expo.android.package, 'com.wellbuilt.suite');
    assert.equal(field.expo.android.versionCode, 2);
    assert.equal(field.expo.extra.eas.projectId, '202541c3-1f23-43c5-93ab-3cd1c2064595');
    assert.deepEqual(field.expo.extra.router, {});
    assert.equal(field.expo.extra.suiteEtc.profile, 'field-test');
    assert.equal(field.expo.extra.suiteEtc.authority, FIELD_AUTHORITY);
    assert.equal(field.expo.extra.suiteEtc.etcPackageName, FIELD_PACKAGE);
    assert.equal(field.expo.extra.suiteEtc.etcCertSha256, CERT);
    assert.equal(field.expo.extra.suiteEtc.etcVersionCode, 56);
    assert.equal(field.expo.extra.suiteEtc.dispatchEnabled, false);
    const regular = load(false);
    assert.equal(regular.expo.android.package, 'com.wellbuilt.suite');
    assert.equal(regular.expo.extra.suiteEtc.profile, 'production');
    assert.equal(regular.expo.extra.suiteEtc.authority, 'com.wellbuilt.electronictimecard.suitehos');
    assert.equal(regular.expo.extra.suiteEtc.etcPackageName, null);
    assert.equal(regular.expo.extra.suiteEtc.etcCertSha256, null);
    assert.equal(regular.expo.extra.suiteEtc.dispatchEnabled, false);
    assert.equal(JSON.stringify(regular.expo.extra.suiteEtc).includes(CERT), false);
  } finally {
    if (previous === undefined) delete process.env.SUITE_ETC_FIELD_TEST;
    else process.env.SUITE_ETC_FIELD_TEST = previous;
    delete require.cache[CONFIG];
    delete require.cache[TARGET];
  }
});
