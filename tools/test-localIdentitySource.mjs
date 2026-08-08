/**
 * vc51.9P — WB-S must read local identity from the store login writes to.
 *
 * LIVE FAILURE THIS PINS (2026-08-08 00:00:45, device R5CX15HEGQB):
 * WB-T vc56 correctly emitted `wellbuilt-suite://sso-authorize`. WB-S
 * refused at precondition 2 of ssoAuthorizationCore with
 * `not_authorized / no local identity` and returned an error callback, so
 * WB-T could never reach authenticated state.
 *
 * The cause is a storage-backend mismatch, not missing data:
 *
 *   driverAuth.saveDriverSession  -> SecureStore.setItemAsync('driverId')
 *                                 -> SecureStore.setItemAsync('companyId')
 *   authReconciliation.readLocalIdentity
 *                                 -> AsyncStorage.getItem('driverId')
 *                                 -> AsyncStorage.getItem('selectedCompanyId')
 *
 * AsyncStorage and SecureStore are separate stores, so the read could
 * never observe what login wrote. `selectedCompanyId` compounds it: no
 * code path in WB-S writes that key at all — it has three readers and
 * zero writers. getLocalIdentity() therefore returned null for EVERY
 * driver in EVERY session, making the SSO bridge unreachable by
 * construction rather than by state.
 *
 * Run: node tools/test-localIdentitySource.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
};

const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const recon = stripComments(readFileSync(join(ROOT, 'src/core/services/authReconciliation.ts'), 'utf8'));
const auth = stripComments(readFileSync(join(ROOT, 'src/core/services/driverAuth.ts'), 'utf8'));

// ── the exact live failure ───────────────────────────────────────────────
check('readLocalIdentity does NOT read driverId from AsyncStorage',
  !/AsyncStorage\.getItem\(\s*['"]driverId['"]\s*\)/.test(recon),
  'login writes driverId to SecureStore; this read can never see it');

check('readLocalIdentity does NOT read the writerless selectedCompanyId key',
  !/AsyncStorage\.getItem\(\s*['"]selectedCompanyId['"]\s*\)/.test(recon),
  'no code path in WB-S writes selectedCompanyId');

check('readLocalIdentity sources identity from the authenticated session',
  /getDriverSession\s*\(/.test(recon),
  'it must read what the authenticated login path actually persisted');

// ── the canonical writer is unchanged ────────────────────────────────────
check('login still persists driverId to SecureStore',
  /SecureStore\.setItemAsync\(\s*["']driverId["']/.test(auth));
check('login still persists companyId to SecureStore',
  /SecureStore\.setItemAsync\(\s*["']companyId["']/.test(auth));
check('getDriverSession still reads both canonical keys',
  /readWithTimeout\(\s*["']driverId["']\s*\)/.test(auth)
  && /readWithTimeout\(\s*["']companyId["']\s*\)/.test(auth));

// ── the identity must stay REAL, never fabricated ────────────────────────
check('no fallback invents a driver or company id',
  !/driverId\s*(\|\||\?\?)\s*['"][^'"]+['"]/.test(recon)
  && !/companyId\s*(\|\||\?\?)\s*['"][^'"]+['"]/.test(recon),
  'a defaulted identifier would authorize the wrong driver');

check('identity is never derived from a URL, display name, or claim',
  !/displayName|queryParams|searchParams|deepLink/i.test(
    recon.slice(recon.indexOf('readLocalIdentity'), recon.indexOf('readLocalIdentity') + 900)),
  'only the authenticated session may supply identity');

// ── issuance preconditions must remain intact ────────────────────────────
{
  const core = stripComments(
    readFileSync(join(ROOT, 'src/core/services/ssoAuthorizationCore.ts'), 'utf8'));
  check('issuance still requires a local identity',
    /getLocalIdentity\(\)/.test(core) && /no local identity/.test(
      readFileSync(join(ROOT, 'src/core/services/ssoAuthorizationCore.ts'), 'utf8')));
  check('issuance still requires reconciliation === verified',
    /reconciliation !== 'verified'/.test(core));
  check('issuance still requires fresh verified claims',
    /getVerifiedIdentity\(\)/.test(core));
  check('audience allowlist retained', /SSO_AUDIENCE_WBT/.test(core));
  check('PKCE S256 method check retained', /SSO_CHALLENGE_METHOD/.test(core));
}

// ── the SSO runtime still demands BOTH identifiers ───────────────────────
{
  const rt = stripComments(readFileSync(join(ROOT, 'src/core/services/ssoRuntime.ts'), 'utf8'));
  check('runtime still refuses when either identifier is absent',
    /!local\.driverId\s*\|\|\s*!local\.companyId/.test(rt),
    'a partial identity must never authorize');
}

// ── logout must still clear the canonical keys ───────────────────────────
check('logout still deletes the canonical driverId',
  /SecureStore\.deleteItemAsync\(\s*["']driverId["']/.test(auth));

// ── no identity values may be logged ─────────────────────────────────────
{
  const reconRaw = readFileSync(join(ROOT, 'src/core/services/authReconciliation.ts'), 'utf8');
  const logged = [...reconRaw.matchAll(/console\.(log|warn|error)\(([^\n]*)/g)].map((m) => m[2]);
  check('no log statement emits a driver or company identifier',
    !logged.some((l) => /\$\{[^}]*(driverId|companyId|passcodeHash|hash)[^}]*\}/.test(l)
      || /,\s*(driverId|companyId|passcodeHash)\b/.test(l)),
    logged.filter((l) => /driverId|companyId/.test(l)).join(' | ').slice(0, 160));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
