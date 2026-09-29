/**
 * Android 11+ package visibility for a future ETC signing check.
 * The application id is ETC's source declaration only. It is not a
 * verified release signer and does not enable dispatch.
 */
const ETC_PROVIDER_AUTHORITY = 'com.wellbuilt.electronictimecard.suitehos';
const ETC_SOURCE_APPLICATION_ID = 'com.wellbuilt.electronictimecard';

function ensureList(holder, key) {
  if (!Array.isArray(holder[key])) holder[key] = [];
  return holder[key];
}

function applyEtcPackageVisibility(manifest) {
  if (!manifest || typeof manifest !== 'object') return manifest;
  if (!Array.isArray(manifest.queries) || manifest.queries.length === 0) {
    manifest.queries = [{}];
  }
  const queries = manifest.queries[0];
  const providers = ensureList(queries, 'provider');
  const providerPresent = providers.some((entry) => entry?.$?.['android:authorities'] === ETC_PROVIDER_AUTHORITY);
  if (!providerPresent) {
    providers.push({ $: { 'android:authorities': ETC_PROVIDER_AUTHORITY } });
  }
  const packages = ensureList(queries, 'package');
  const packagePresent = packages.some((entry) => entry?.$?.['android:name'] === ETC_SOURCE_APPLICATION_ID);
  if (!packagePresent) {
    packages.push({ $: { 'android:name': ETC_SOURCE_APPLICATION_ID } });
  }
  return manifest;
}

module.exports = {
  ETC_PROVIDER_AUTHORITY,
  ETC_SOURCE_APPLICATION_ID,
  applyEtcPackageVisibility,
};
