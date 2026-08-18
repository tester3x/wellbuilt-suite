/**
 * Suite C3 company-registration source inventory.
 * Run: node tools/test-suiteCompanyRegistration.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const auth = readFileSync(join(ROOT, 'src', 'core', 'services', 'driverAuth.ts'), 'utf8');
const secure = readFileSync(join(ROOT, 'src', 'core', 'services', 'secureDriverAuth.ts'), 'utf8');
const login = readFileSync(join(ROOT, 'src', 'core', 'hooks', 'useLogin.ts'), 'utf8');
const ctx = readFileSync(join(ROOT, 'src', 'core', 'context', 'AuthContext.tsx'), 'utf8');
let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
}

function sha256(rel) {
  return createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex');
}

check('submitRegistration uses secureSubmitRegistration', /secureSubmitRegistration/.test(auth));
check('secure helper calls requestDriverRegistration', /'requestDriverRegistration'/.test(secure));
check('source marker is wbs', /source:\s*'wbs'|source:\s*params\.source \|\| 'wbs'/.test(auth + secure));
check('no firebasePost function', !/const firebasePost/.test(auth) && !/firebasePost\(/.test(auth));
check(
  'no reachable drivers/pending POST',
  !/firebasePost\(\s*DRIVERS_PENDING/.test(auth)
    && !/fetch\([^)]*drivers\/pending/.test(auth + secure + login),
);
check('no pendingPasscodeHash write', !/setItemAsync\(\s*['"]pendingPasscodeHash['"]/.test(auth + secure));
check('stores pendingSecureId', /setItemAsync\(\s*'pendingSecureId'/.test(auth));
check(
  'malformed success rejected',
  /did not return a pending request/.test(auth + secure),
);
check(
  'completeRegistration does not saveDriverSession',
  /export const completeRegistration[\s\S]*Please sign in/.test(auth)
    && !/export const completeRegistration[\s\S]*saveDriverSession/.test(auth),
);
check('status uses pendingId', /pendingId/.test(secure) && /secureCheckRegistrationStatus/.test(auth));
check('useLogin does not call isPasscodeAvailable', !/isPasscodeAvailable/.test(login));
check('useLogin approval goes to login', /Registration approved\. Please sign in/.test(login));
check('useLogin does not auto completeReg on approval', !/auth\.completeReg\(/.test(login));
check('five-char rejected', /SUITE_PASSCODE_MIN_LEN = 6/.test(auth) && /at least 6 characters/.test(login));
check('AuthContext still only delegates register()', /submitRegistration/.test(ctx));

const dirty = {
  'src/core/context/AuthContext.tsx': 'b5b80639a45267ffc11039f56f83f5483e3adf22e0c2ff6292f71be7a40e8206',
  'src/core/hooks/useAppLauncher.ts': 'f47734b14da58bff7103109332c31a66ac53066b721865e0b88774603a7a7f38',
  'src/core/services/SSO-MIRROR-MANIFEST.json': 'c63890d6eeb19acdec010eb5c16f6e11f329c95b7306040b95ea4dcd6ce44317',
  'src/core/services/ssoAuthorizationCore.ts': 'd8170ac3e78eb1af72d349c13038c277773050ac4a22d425830891b79185ca4d',
  'src/core/services/ssoAuthorizeScreenPolicy.ts': '6771d918a6aea3c6ac2e93fd0e850be765f6152aa3331c2f3b6eaee586711ff4',
  'src/core/services/ssoHandoffOverlayStore.ts': '50a14b601c2e9fd9daae0ee40d2066a58c046f6d3cf2dc5e107cd64a27d02c9a',
  'src/core/services/ssoIssuanceClient.ts': '31b74f18b48351196124a08d10bb256b3694a8d44422bb3b91be1ea4723c58c1',
  'src/core/services/ssoLaunchPolicy.test.ts': '6b92c6805269e0c94d359fde3adc844424b6fcbf98475f0aba1ee32fcef3eafe',
  'src/core/services/ssoLaunchPolicy.ts': '4748b131e681fc4124c0df5b00808dbf77318e94d3dcb64b03abdbd07513a831',
  'src/core/services/ssoProtocol.generated.ts': 'a9a22672d4ba7b428d7c4450e2f832f34c6527d42a1c592e337a6b656d91961a',
  'src/core/services/ssoFrozenFlows.nonregression.test.ts': 'ae469cc7d4a3053b8d49ca57057189af548bfd9836534bbfe82c73bcaf2c2d67',
  'package.json': 'b0e37a2ce5ca11b2da7daa2be0b510787674e5c37228a4cc59225efcb50ee353',
};
for (const [rel, want] of Object.entries(dirty)) {
  const got = sha256(rel);
  check(`dirty unchanged ${rel}`, got === want, got);
}

console.log(`\nRESULT passed=${pass} failed=${fail} total=${pass + fail}`);
process.exit(fail ? 1 : 0);
