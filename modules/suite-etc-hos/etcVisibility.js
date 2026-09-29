/**
 * Android 11+ package visibility for the selected ETC target.
 * The application id is visibility only. It is not a verified signer
 * and does not enable dispatch.
 */
const { ETC_TARGETS, PRODUCTION_ETC_TARGET } = require('./etcTarget');

const ETC_PROVIDER_AUTHORITY = PRODUCTION_ETC_TARGET.authority;
const ETC_SOURCE_APPLICATION_ID = PRODUCTION_ETC_TARGET.visibilityPackage;

function knownAuthorities() {
  return Object.values(ETC_TARGETS).map((target) => target.authority);
}

function knownPackages() {
  return Object.values(ETC_TARGETS).map((target) => target.visibilityPackage);
}

function ensureList(holder, key) {
  if (!Array.isArray(holder[key])) holder[key] = [];
  return holder[key];
}

function applyEtcPackageVisibility(manifest, target = PRODUCTION_ETC_TARGET) {
  if (!manifest || typeof manifest !== 'object') return manifest;
  if (!Array.isArray(manifest.queries) || manifest.queries.length === 0) {
    manifest.queries = [{}];
  }
  const queries = manifest.queries[0];
  const providers = ensureList(queries, 'provider').filter((entry) => {
    const value = entry?.$?.['android:authorities'];
    if (!knownAuthorities().includes(value)) return true;
    return value === target.authority;
  });
  if (!providers.some((entry) => entry?.$?.['android:authorities'] === target.authority)) {
    providers.push({ $: { 'android:authorities': target.authority } });
  }
  queries.provider = providers;

  const packages = ensureList(queries, 'package').filter((entry) => {
    const value = entry?.$?.['android:name'];
    if (!knownPackages().includes(value)) return true;
    return value === target.visibilityPackage;
  });
  if (!packages.some((entry) => entry?.$?.['android:name'] === target.visibilityPackage)) {
    packages.push({ $: { 'android:name': target.visibilityPackage } });
  }
  queries.package = packages;
  return manifest;
}

module.exports = {
  ETC_PROVIDER_AUTHORITY,
  ETC_SOURCE_APPLICATION_ID,
  applyEtcPackageVisibility,
};
