/**
 * vc51.9R — no credential-derived value may reach the log.
 *
 * FOUND WHILE DIAGNOSING THE SSO BRIDGE. WB-S logged, in production:
 *
 *   [DriverAuth-Suite] Hash: <8 hex chars>...
 *   [DriverAuth-Suite] Revalidating session for hash: <8 hex chars>...
 *
 * That value is `hashPasscode(passcode, displayName)` — the LEGACY BEARER
 * CREDENTIAL, the same material ssoRouteAdapter refuses to accept from a
 * deep link precisely because possessing it is treated as proof of
 * identity.
 *
 * A truncated prefix is not safe here. The display name is also logged, the
 * hash function is in the shipped bundle, and driver passcodes are short.
 * 32 bits of confirmed prefix turns anyone with logcat access — adb, a
 * crash reporter, a log aggregator, a shared device — into an OFFLINE
 * ORACLE: guess a passcode, hash it with the known name, compare the
 * prefix. A match at 32 bits is effectively certain, so the full
 * credential is recoverable without ever touching the network.
 *
 * Path and status markers are fine. Credential-derived bytes are not, at
 * any length.
 *
 * Run: node tools/test-noCredentialLogging.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
};

/** Every shipped source file (tests and generated mirrors excluded). */
function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) { sources(p, out); continue; }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(p);
  }
  return out;
}

const files = [
  ...sources(join(ROOT, 'src')),
  ...sources(join(ROOT, 'app')),
];

/**
 * A log argument is unsafe when a credential-derived identifier is
 * interpolated or passed as a value — including truncated forms, which are
 * the oracle described above. Presence booleans (`!!hash`) and hashes of
 * non-secrets (ipHash) are fine.
 */
const CREDENTIAL_TERMS = /\b(passcodeHash|passcode|hash|driverHash|customToken|idToken|refreshToken|verifier|codeVerifier)\b/;

/** Returns the 1-based line numbers whose console call leaks credential bytes. */
function scan(src) {
  const hits = [];
  // Split on CRLF too. `.` does not match \r — it is a line terminator — so
  // on a CRLF working tree `(.*)$` never matched ANY real line and the
  // scanner reported SAFE while live leaks sat in the file. The synthetic
  // self-check below is LF, which is exactly why it passed regardless.
  src.split(/\r?\n/).forEach((line, i) => {
    const m = /console\.(log|warn|error|info|debug)\((.*)$/.exec(line);
    if (!m) return;
    const args = m[2];
    if (!CREDENTIAL_TERMS.test(args)) return;
    // Safe forms: presence checks, ip hashes, and explicit redaction.
    if (/!!\s*\w*[Hh]ash|ipHash|REDACTED|redact/.test(args)) return;
    // Safe: the WORD appears only inside a quoted human message, with no
    // interpolation or variable argument carrying the value.
    const withoutStrings = args.replace(/'[^']*'|"[^"]*"|`[^`$]*`/g, '');
    if (!CREDENTIAL_TERMS.test(withoutStrings)) return;
    hits.push(i + 1);
  });
  return hits;
}

// SELF-VERIFICATION. A scanner that silently matches nothing is worse than
// no scanner: it reports SAFE forever. Prove it still catches the exact
// shapes this defect took before trusting its verdict on real files.
{
  const known = [
    'console.log("[X] Hash:", hash.slice(0, 8) + "...");',
    'console.log("[X] Revalidating session for hash:", hash.slice(0, 8) + "...");',
    'console.warn(`[X] stale hash=${driverHash.substring(0, 8)}`);',
    'console.log("[X] token", customToken);',
  ].join('\n');
  const safe = [
    'console.log("[X] Legacy hash lookup");',
    'console.log("[X] missing hash:", !!hash);',
    'console.log("[X] ip", ipHash);',
  ].join('\n');
  check('scanner catches every known credential-logging shape',
    scan(known).length === 4, `caught ${scan(known).length}/4`);
  check('scanner does not flag safe path/status markers',
    scan(safe).length === 0, `flagged ${scan(safe).join(', ')}`);
}

const offenders = [];
for (const file of files) {
  for (const line of scan(readFileSync(file, 'utf8'))) {
    offenders.push(`${relative(ROOT, file)}:${line}`);
  }
}

check('no log statement emits a credential-derived value', offenders.length === 0,
  offenders.join(', '));

// ── the two specific live offenders ──────────────────────────────────────
{
  const auth = readFileSync(join(ROOT, 'src/core/services/driverAuth.ts'), 'utf8');
  check('the passcode-hash prefix is no longer logged at login',
    !/console\.log\("\[DriverAuth-Suite\] Hash:",\s*hash\.slice/.test(auth),
    'login still logs a credential prefix');
  check('the passcode-hash prefix is no longer logged at revalidation',
    !/Revalidating session for hash:",\s*hash\.slice/.test(auth),
    'revalidation still logs a credential prefix');
  // Operational markers must survive — losing the path signal is what made
  // the legacy-fallback diagnosis expensive in the first place.
  check('the login path marker is retained',
    /Secure login miss, trying legacy/.test(auth));
  check('a non-sensitive revalidation marker is retained',
    /Revalidating session/.test(auth));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
