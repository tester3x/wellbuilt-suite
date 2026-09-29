const { withAndroidManifest } = require('@expo/config-plugins');

const AUTHORITY = 'com.wellbuilt.electronictimecard.suitehos';

function ensureProviderQuery(manifest) {
  if (!Array.isArray(manifest.queries) || manifest.queries.length === 0) {
    manifest.queries = [{}];
  }
  const queries = manifest.queries[0];
  if (!Array.isArray(queries.provider)) queries.provider = [];
  const present = queries.provider.some((entry) => entry?.$?.['android:authorities'] === AUTHORITY);
  if (!present) {
    queries.provider.push({ $: { 'android:authorities': AUTHORITY } });
  }
  return manifest;
}

/** Package visibility for the ETC provider. Does not grant trust or a signing cert. */
function withEtcSuiteHos(config) {
  return withAndroidManifest(config, (config) => {
    config.modResults.manifest = ensureProviderQuery(config.modResults.manifest);
    return config;
  });
}

module.exports = withEtcSuiteHos;
