/**
 * SUITE_ETC_FIELD_TEST=1 selects the ETC field-test target.
 * extra.suiteEtc.dispatchEnabled stays false in this artifact.
 */
const appJson = require('./app.json');
const { etcTargetForEnv, suiteEtcExtra } = require('./modules/suite-etc-hos/etcTarget');

const expo = appJson.expo;
const target = etcTargetForEnv(process.env);

module.exports = {
  expo: {
    ...expo,
    extra: {
      ...expo.extra,
      suiteEtc: suiteEtcExtra(target),
    },
  },
};
