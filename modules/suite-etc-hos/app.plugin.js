const { withAndroidManifest } = require('@expo/config-plugins');
const { applyEtcPackageVisibility } = require('./etcVisibility');

/** Package visibility only. Does not grant trust, a certificate, or dispatch. */
function withEtcSuiteHos(config) {
  return withAndroidManifest(config, (config) => {
    config.modResults.manifest = applyEtcPackageVisibility(config.modResults.manifest);
    return config;
  });
}

module.exports = withEtcSuiteHos;
