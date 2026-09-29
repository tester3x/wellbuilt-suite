/**
 * Writes the gitignored native ETC profile from modules/suite-etc-hos/etcTarget.js.
 * Does not create a keystore, edit signing configs, or regenerate android/.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ETC_TARGETS, etcTargetForEnv } = require('../modules/suite-etc-hos/etcTarget');

function escapeReg(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function retargetAttribute(xml, tag, attr, fromValues, toValue) {
  let next = xml;
  for (const from of fromValues) {
    if (from === toValue) continue;
    const re = new RegExp(`(<${tag}\\b[^>]*\\b${attr}=")${escapeReg(from)}(")`, 'g');
    next = next.replace(re, `$1${toValue}$2`);
  }
  return next;
}

/** Replaces only exact known ETC provider authorities and package names. */
function retargetEtcQueries(xml, target) {
  const authorities = Object.values(ETC_TARGETS).map((entry) => entry.authority);
  const packages = Object.values(ETC_TARGETS).map((entry) => entry.visibilityPackage);
  let next = retargetAttribute(xml, 'provider', 'android:authorities', authorities, target.authority);
  next = retargetAttribute(next, 'package', 'android:name', packages, target.visibilityPackage);
  return next;
}

function propertiesText(target) {
  const fieldTest = target.profile === 'field-test';
  const lines = [
    `profile=${target.profile}`,
    `authority=${target.authority}`,
    `package=${fieldTest ? target.etcPackageName || '' : ''}`,
    `cert=${fieldTest ? target.etcCertSha256 || '' : ''}`,
    'dispatch=false',
    '',
  ];
  return lines.join('\n');
}

function writeSuiteEtcProfile(options) {
  const root = options.root;
  const target = etcTargetForEnv(options.env);
  const generatedDir = path.join(root, 'modules', 'suite-etc-hos', 'android', 'generated');
  const propsPath = path.join(generatedDir, 'suite-etc.properties');
  fs.mkdirSync(generatedDir, { recursive: true });
  const text = propertiesText(target);
  fs.writeFileSync(propsPath, text, 'utf8');
  const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  let manifestChanged = false;
  if (fs.existsSync(manifestPath)) {
    const before = fs.readFileSync(manifestPath, 'utf8');
    const after = retargetEtcQueries(before, target);
    if (after !== before) {
      fs.writeFileSync(manifestPath, after, 'utf8');
      manifestChanged = true;
    }
  }
  return { target, propsPath, text, manifestChanged, manifestPath };
}

function recordProvenance(root, text) {
  const hash = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  const outDir = path.join(root, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'suite-etc.properties'), text, 'utf8');
  fs.writeFileSync(path.join(outDir, 'suite-etc.properties.sha256'), `${hash}  suite-etc.properties\n`, 'utf8');
  return hash;
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const result = writeSuiteEtcProfile({ root, env: process.env });
  const sha256 = recordProvenance(root, result.text);
  process.stdout.write(`${JSON.stringify({
    profile: result.target.profile,
    authority: result.target.authority,
    dispatchEnabled: false,
    sha256,
    manifestChanged: result.manifestChanged,
    propsPath: result.propsPath,
  })}\n`);
}

module.exports = {
  retargetEtcQueries,
  propertiesText,
  writeSuiteEtcProfile,
  recordProvenance,
};
