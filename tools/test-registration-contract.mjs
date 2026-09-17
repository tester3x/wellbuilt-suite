/**
 * WB-S registration contract + payload + navigation wiring test (source-level).
 *
 * Verifies WB-S employee registration mirrors the proven WB-M contract against
 * the corrected backend (54da58e6): sends `companyCode` (NOT the old free-text
 * `companyName`), uppercases the input, keeps `requestDriverRegistration`, stays
 * pending-only, preserves canonical authenticateDriver sign-in, and wires the
 * Android Back handler. Static + logic-only: invokes NO Firebase and registers
 * NO users (zero production invocation).
 *
 * Run: node tools/test-registration-contract.mjs
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
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (p) => strip(readFileSync(join(ROOT, p), 'utf8'));

const useLogin = read('src/core/hooks/useLogin.ts');
const secure = read('src/core/services/secureDriverAuth.ts');
const driver = read('src/core/services/driverAuth.ts');
const auth = read('src/core/context/AuthContext.tsx');
const screen = read('src/ui/shared/LoginScreen.tsx');
const en = JSON.parse(readFileSync(join(ROOT, 'src/core/localization/translations/en.json'), 'utf8'));

// ── payload contract (end-to-end companyCode) ────────────────────────────────
check('secureSubmitRegistration sends companyCode + source:wbs to requestDriverRegistration',
  /companyCode:\s*params\.companyCode/.test(secure) && /source:\s*params\.source\s*\|\|\s*'wbs'/.test(secure)
  && /'requestDriverRegistration'/.test(secure));
check('secureSubmitRegistration no longer sends a companyName payload key',
  !/companyName:\s*params\.companyName/.test(secure));
check('driverAuth.submitRegistration threads companyCode through',
  /companyCode\?:\s*string/.test(driver) && /companyCode:\s*params\.companyCode/.test(driver));
check('AuthContext.register signature + call use companyCode',
  /register\s*=\s*useCallback\(async\s*\(displayName: string, passcode: string, companyCode\?: string/.test(auth)
  && /submitRegistration\(\{\s*displayName,\s*passcode,\s*companyCode,\s*legalName\s*\}\)/.test(auth));
check('useLogin passes companyCode to auth.register and validates it',
  /companyCode\.trim\(\)\s*\|\|\s*undefined/.test(useLogin)
  && /company join code/i.test(useLogin));

// ── input normalization (uppercase; backend authoritative for the rest) ──────
check('company join-code input is uppercased on entry',
  /setCompanyCode\(value\.toUpperCase\(\)\)/.test(screen));
check('company field autoCapitalizes characters (accepts XXXX-XXXX)',
  /value=\{companyCode\}[\s\S]*?autoCapitalize="characters"/.test(screen));
check('locale label/placeholder now describe a join code, not a company name',
  /join code/i.test(en.login.companyLabel + ' ' + en.login.companyPlaceholder + ' ' + en.login.companyHint)
  && !/your company name/i.test(en.login.companyPlaceholder));

// ── pending-only + canonical sign-in preserved ───────────────────────────────
check('successful registration goes to pending (no session minted here)',
  /setMode\('pending'\)/.test(useLogin));
check('sign-in remains canonical authenticateDriver (preserved)',
  /authenticateDriver/.test(secure));

// ── Android Back wiring ──────────────────────────────────────────────────────
check('useLogin imports the registration Back helpers + BackHandler',
  /shouldInstallRegistrationBackHandler/.test(useLogin) && /consumeRegistrationHardwareBack/.test(useLogin)
  && /BackHandler/.test(useLogin));
check('Back handler subscribes on hardwareBackPress and returns to Sign In',
  /addEventListener\('hardwareBackPress'/.test(useLogin) && /returnToSignIn:\s*handleSwitchToLogin/.test(useLogin));

// ── legacy fallback preserved (not removed by this task) ─────────────────────
check('legacy fallback code preserved (verifyLogin / drivers/approved still present)',
  /verifyLogin/.test(driver) || /drivers\/approved/.test(driver));

// ── zero production invocation by this harness ───────────────────────────────
check('harness imports only node built-ins (no Firebase / network)',
  (() => {
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const imports = self.match(/^\s*import[^;]*from\s*['"][^'"]+['"]/gm) || [];
    return imports.length > 0 && imports.every((line) => /from\s*['"]node:/.test(line));
  })());

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
