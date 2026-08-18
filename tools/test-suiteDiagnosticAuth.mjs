/**
 * Suite C4 diagnostic client authentication inventory.
 * Run: node tools/test-suiteDiagnosticAuth.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const diag = readFileSync(join(ROOT, 'src', 'core', 'services', 'wbDiagLog.ts'), 'utf8');
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

check('endpoint is writeDiagnosticLog', /writeDiagnosticLog/.test(diag));
check('uses owned Suite ID token', /getOwnedIdToken/.test(diag) && /getOwnedAuth/.test(diag));
check('Authorization Bearer contract', /Authorization:\s*`Bearer \$\{token\}`/.test(diag));
check('missing token does not fetch', /if \(!authz\) return;/.test(diag) && /await fetch/.test(diag));
check('unowned Auth fails closed', /if \(!getOwnedAuth\(app\)\) return null/.test(diag));
check('refresh then fail closed', /getOwnedIdToken\(app, false\)/.test(diag) && /getOwnedIdToken\(app, true\)/.test(diag));
check('no unauthenticated fetch headers-only JSON', !/headers:\s*\{\s*'Content-Type': 'application\/json'\s*\}/.test(diag));
check('omits driverHash from body', /forbidden client identity/.test(diag) && !/driverHash: input\.driverHash/.test(diag));
check('no token logging', !/console\.(log|warn|error|debug)\([^)]*token/i.test(diag));
check('no SecureStore token persist', !/setItemAsync|SecureStore/.test(diag));
check('no RTDB fallback', !/drivers\/pending|firebasePost/.test(diag));
check('still fire-and-forget', /void submitDiagnostic/.test(diag));

const frozen = {
  'src/core/services/firebaseAuthBoundary.ts': 'e92aae9a9eb25f5bb951e050ea63a6fa69a769200ac0080937afde8b07718a9c',
  'src/core/services/firebaseApp.ts': 'a6348ded6c6ae3b83235edd3e6cd981cd2ec61dcc4cd853b46762a5f631a12db',
  'src/core/services/secureDriverAuth.ts': '1a946ce47aedd4c664c61ae99d76cf0adb5a0802786f7fb9817682f64a7885d5',
  'src/core/context/AuthContext.tsx': 'b5b80639a45267ffc11039f56f83f5483e3adf22e0c2ff6292f71be7a40e8206',
  'src/core/hooks/useAppLauncher.ts': 'f47734b14da58bff7103109332c31a66ac53066b721865e0b88774603a7a7f38',
  'src/core/services/ssoLaunchPolicy.ts': '4748b131e681fc4124c0df5b00808dbf77318e94d3dcb64b03abdbd07513a831',
};
for (const [rel, want] of Object.entries(frozen)) {
  const got = sha256(rel);
  check(`hash-locked ${rel}`, got === want, got);
}

console.log(`\nRESULT passed=${pass} failed=${fail} total=${pass + fail}`);
process.exit(fail ? 1 : 0);
