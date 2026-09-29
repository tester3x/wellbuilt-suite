const { withAndroidManifest } = require('@expo/config-plugins');
const { etcTargetForEnv } = require('./etcTarget');
const { applyEtcPackageVisibility } = require('./etcVisibility');

/** Package visibility for the env-selected ETC target. Not trust and not dispatch. */
function withEtcSuiteHos(config) {
  const target = etcTargetForEnv(process.env);
  return withAndroidManifest(config, (config) => {
    config.modResults.manifest = applyEtcPackageVisibility(config.modResults.manifest, target);
    return config;
  });
}

module.exports = withEtcSuiteHos;
