/**
 * vc51.9I-RECOVERY5A — WB-S REST-to-SDK Auth ownership migration.
 *
 * RED-FIRST: before the migration WB-S exchanged the server's custom token
 * with a raw Identity Toolkit POST, stored idToken + refreshToken in
 * SecureStore, and never refreshed either. Firebase ID tokens live one
 * hour, so that "verified identity" went stale and stayed stale — the gap
 * that blocked the cross-app SSO bridge.
 *
 * These are source/semantic pins. The SDK session itself, cold-launch
 * restoration and real refresh are device-only claims and are listed at
 * the bottom for physical verification.
 *
 * Run: node tools/test-sdkAuthMigration.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
};
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const authSrc = readFileSync(join(root, 'src', 'core', 'services', 'secureDriverAuth.ts'), 'utf8');
const auth = stripComments(authSrc);
const appSrc = stripComments(readFileSync(join(root, 'src', 'core', 'services', 'firebaseApp.ts'), 'utf8'));
// The ordering-critical logic lives in authSessionCore so it can be driven
// by deferred fakes under tsx --test; secureDriverAuth wires it to the real
// boundary. Pins follow the code to whichever file now owns it.
const coreSrc = readFileSync(join(root, 'src', 'core', 'services', 'authSessionCore.ts'), 'utf8');
const core = stripComments(coreSrc);

// ── 1. The raw REST auth plane is gone ──────────────────────────────────
check('no Identity Toolkit token exchange remains', !/identitytoolkit/.test(auth));
check('no returnSecureToken REST body remains', !/returnSecureToken/.test(auth));
check('no parallel refresh-token implementation remains',
  !/securetoken\.googleapis|grant_type|refresh_token=/.test(auth));
check('no SecureStore READ of token material remains',
  !/getItemAsync\((ID_TOKEN_KEY|REFRESH_TOKEN_KEY)\)/.test(auth));
check('no SecureStore WRITE of token material remains',
  !/setItemAsync\((ID_TOKEN_KEY|REFRESH_TOKEN_KEY)/.test(auth));

// ── 2. The SDK owns the session ─────────────────────────────────────────
check('sign-in goes through the owned boundary',
  /signInWithCustomTokenOwned\(getFirebaseApp\(\), customToken\)/.test(auth));
check('persistent Auth is initialized through the boundary',
  /initializePersistentAuth\(getFirebaseApp\(\), AsyncStorage\)/.test(auth));
check('AsyncStorage is what is handed to the boundary', /AsyncStorage/.test(auth));
check('readiness is awaited after sign-in', /await ops\.waitForAuthReady\(\)/.test(core));
check('the current ID token comes from the SDK session, not storage',
  /return getOwnedIdToken\(getFirebaseApp\(\)\)/.test(auth));

// ── 3. Legacy material is cleared only AFTER success ────────────────────
{
  const idx = auth.indexOf('await authSession.establish(');
  const clr = auth.indexOf('await clearLegacyTokenMaterial();', idx);
  check('legacy token material is cleared only after a successful SDK sign-in',
    idx !== -1 && clr !== -1 && clr > idx);
  check('cleanup only deletes — it never reads the values',
    /deleteItemAsync\(ID_TOKEN_KEY\)/.test(auth) && /deleteItemAsync\(REFRESH_TOKEN_KEY\)/.test(auth));
  // A failed exchange must not reach the cleanup: establishSdkSession
  // throws, and nothing between it and the cleanup catches or recovers.
  check('a failed sign-in cannot fall through to cleanup',
    idx !== -1 && clr !== -1 && !/catch/.test(auth.slice(idx, clr)));
  check('a superseded attempt cannot reach the cleanup either',
    /await authSession\.establish\([\s\S]{0,200}?\);\s*\n\s*if \(authSession\.isSuperseded\(epoch\)\) throw new SupersededAttemptError\(\);/.test(auth));
}

// ── 3b. The genuine login lifecycle reaches the SDK ─────────────────────
{
  const dAuth = stripComments(readFileSync(join(root, 'src', 'core', 'services', 'driverAuth.ts'), 'utf8'));
  const ctx2 = stripComments(readFileSync(join(root, 'src', 'core', 'context', 'AuthContext.tsx'), 'utf8'));
  const hook = stripComments(readFileSync(join(root, 'src', 'core', 'hooks', 'useLogin.ts'), 'utf8'));

  // THE ACCEPTANCE PIN: a real production login handler must reach secureLogin.
  check('the production login hook calls AuthContext.login', /auth\.login\(/.test(hook));
  check('AuthContext.login calls verifyLogin', /await verifyLogin\(displayName, passcode\)/.test(ctx2));
  check('verifyLogin calls secureLogin (the SDK path is reachable)',
    /await secureLogin\(\{ displayName, passcode \}\)/.test(dAuth));
  const prodCallers = (dAuth.match(/secureLogin\(/g) || []).length;
  check('secureLogin has at least one real production caller', prodCallers >= 1, `${prodCallers}`);

  // Step 6: claims are verified before success is reported.
  check('the minted identity is verified before login reports success',
    /identity\.kind !== 'driver'/.test(core)
    && /identity\.driverId !== expected\.driverId/.test(core)
    && /identity\.companyId !== expected\.companyId/.test(core));
  // Within establishSdkSession specifically: readiness is awaited before
  // claims are read. (File-wide indexOf is meaningless now that helpers
  // above the function also reference getOwnedVerifiedIdentity.)
  {
    const body = core.slice(core.indexOf('async function runEstablish'));
    const ready = body.indexOf('await ops.waitForAuthReady()');
    const claims = body.indexOf('await ops.getVerifiedIdentity()');
    check('verification happens after readiness', ready !== -1 && claims !== -1 && ready < claims);
  }
  check('authVerified is only set on the verified path', /authVerified: true/.test(auth));
  check('the core never imports the Firebase SDK, react-native, or expo',
    !/from '(firebase|react-native|expo|@react-native)/.test(core));
  check('the core never touches storage directly', !/AsyncStorage|SecureStore/.test(core));
  check('the legacy fallback never claims authVerified',
    !/authVerified/.test(dAuth.split('trying legacy')[1] || ''));
  check('verifyLogin exposes authVerified so callers can gate on it',
    /authVerified\?: boolean/.test(dAuth));

  // Duplicate submissions share one exchange.
  // ── Single-flight is keyed by attempt identity ────────────────────────
  check('identical submissions coalesce onto one exchange',
    /if \(inFlight && inFlightAttemptKey === key\) \{/.test(core));
  check('a DIFFERENT concurrent attempt is rejected, not given this result',
    /if \(inFlight\) return \{ kind: 'busy' \};/.test(core)
    && /outcome\.kind === 'busy'[\s\S]{0,160}Another sign-in is already in progress/.test(auth));
  check('the in-flight slot always clears on settle',
    /\.finally\(\(\) => \{[\s\S]{0,260}inFlight = null;[\s\S]{0,70}inFlightAttemptKey = null;/.test(core));
  check('a late settle cannot undo a cancellation',
    /if \(inFlightAttemptKey === key\) \{/.test(core));
  check('logout can cancel an in-flight login',
    /export function invalidateAuthEpoch\(\)/.test(auth));
  check('the single-flight key includes the normalized display name',
    /displayName\.trim\(\)\.toLowerCase\(\)/.test(auth));
  check('the key material is random per process and never persisted',
    /let attemptKeyMaterial: string \| null = null/.test(auth)
    && /getRandomBytesAsync\(32\)/.test(auth)
    && !/(setItemAsync|AsyncStorage\.setItem)\([^)]*(attemptKeyMaterial|processKey)/.test(auth));
  check('the passcode is never logged or stored as a key',
    !/console\.(log|warn|error)\([^)]*passcode/.test(auth)
    && !/setItemAsync\([^)]*passcode/.test(auth));
}

// ── 4. No silently-expiring session is created ──────────────────────────
check('the legacy idToken path no longer establishes a session',
  !/data\.idToken[\s\S]{0,120}setItemAsync/.test(auth)
  && /Server did not return a session token/.test(auth));

// ── 5. Sign-out ends the verified session ───────────────────────────────
check('secureSignOut signs out the SDK session', /signOutOwned\(getFirebaseApp\(\)\)/.test(auth));
check('sign-out clears legacy material even if SDK sign-out throws',
  /catch \{[\s\S]{0,140}\}\s*\n\s*await clearLegacyTokenMaterial\(\);/.test(auth));

// ── 6. Single app owner ─────────────────────────────────────────────────
check('firebaseApp is the single initializeApp owner', /initializeApp\(firebaseConfig\)/.test(appSrc));
check('app creation is idempotent (no second app on Fast Refresh)',
  /getApps\(\)\.length > 0 \? getApp\(\) : initializeApp/.test(appSrc));
{
  const files = execSync('git ls-files "*.ts" "*.tsx"', { cwd: root, encoding: 'utf8' })
    .trim().split('\n')
    .filter((f) => f && f !== 'src/core/services/firebaseApp.ts');
  const offenders = files.filter((f) => {
    let t; try { t = readFileSync(join(root, f), 'utf8'); } catch { return false; }
    return /\binitializeApp\s*\(/.test(stripComments(t));
  });
  check('no other module calls initializeApp', offenders.length === 0, offenders.join(', '));
}

// ── 7. No credential ever reaches a log or a URL ────────────────────────
check('the custom token is never logged',
  !/console\.(log|warn|error)\([^)]*customToken/.test(auth));
check('no ID/refresh token is logged',
  !/console\.(log|warn|error)\([^)]*(idToken|refreshToken)/.test(auth));
check('no token is placed in a URL', !/[?&](token|idToken|key)=\$\{(customToken|idToken|token)/.test(auth));

// ── 8. Offline entry is untouched by this migration ─────────────────────
{
  // The migration must not have added a network requirement to app entry.
  const ctx = stripComments(readFileSync(join(root, 'src', 'core', 'context', 'AuthContext.tsx'), 'utf8'));
  check('AuthContext does not require an SDK session to restore local identity',
    !/waitForAuthReady|requireOwnedAuth|getOwnedIdToken/.test(ctx));
  check('AuthContext still owns logout', /logout/.test(ctx));
  // Both logout paths must end the verified session, before local teardown.
  const signOutCalls = (ctx.match(/secureSignOut\(\)/g) || []).length;
  const clearCalls = (ctx.match(/await clearDriverSession\(\);/g) || []).length;
  check('every logout path signs out the SDK session',
    signOutCalls === clearCalls && clearCalls === 2,
    `${signOutCalls} sign-outs / ${clearCalls} teardowns`);
  check('SDK sign-out happens BEFORE local session teardown',
    /secureSignOut\(\)[\s\S]{0,80}await clearDriverSession\(\);/.test(ctx));
  check('a failed sign-out cannot block logout completion',
    /secureSignOut\(\)\.catch\(\(\) => \{\}\)/.test(ctx));
}


// ── 9. Restored-session reconciliation ──────────────────────────────────
{
  const rec = stripComments(readFileSync(join(root, 'src', 'core', 'services', 'authReconciliation.ts'), 'utf8'));
  for (const st of ['local-only', 'verifying', 'verified', 'rejected', 'unavailable']) {
    check(`reconciliation models the '${st}' state`, rec.includes(`'${st}'`));
  }
  check('an unreadable-claims failure is distinguished from "no user"',
    /identity === undefined/.test(rec) && /identity === null/.test(rec));
  check('unreadable claims preserve local identity (no sign-out)',
    /if \(identity === undefined\)[\s\S]{0,120}set\('unavailable'\)/.test(rec)
    && !/if \(identity === undefined\)[\s\S]{0,120}signOutOwned/.test(rec));
  check('no SDK user leaves ordinary offline entry intact',
    /if \(identity === null\)[\s\S]{0,160}local-only/.test(rec));
  check('an SDK user with no local identity is signed out',
    /if \(!hasLocal\)[\s\S]{0,120}signOutOwned/.test(rec));
  check('driver AND company must match, and kind must be driver',
    /identity\.kind === 'driver'/.test(rec)
    && /identity\.driverId === localIdentity\.driverId/.test(rec)
    && /identity\.companyId === localIdentity\.companyId/.test(rec));
  check('a mismatch signs out and fails closed',
    /if \(!matches\)[\s\S]{0,120}signOutOwned[\s\S]{0,80}set\('rejected'\)/.test(rec));
  check('local identity is read from storage only, never the network',
    /AsyncStorage\.getItem\('driverId'\)/.test(rec) && !/\bfetch\s*\(/.test(rec));
  check('the protected gate re-reads state rather than caching a boolean',
    /export function isVerifiedReady\(\): boolean \{[\s\S]{0,60}return current === 'verified';/.test(rec));
}

// ── 10. authVerified must never become persisted authority ──────────────
{
  const files = execSync('git ls-files "*.ts" "*.tsx"', { cwd: root, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
  const persisted = [];
  for (const f of files) {
    let t;
    try { t = stripComments(readFileSync(join(root, f), 'utf8')); } catch { continue; }
    // Any write of authVerified into durable storage or the saved session.
    if (/(setItemAsync|AsyncStorage\.setItem|saveDriverSession)\([^)]*authVerified/.test(t)) persisted.push(f);
    if (/JSON\.stringify\([^)]*authVerified/.test(t)) persisted.push(f);
  }
  check('authVerified is never persisted as durable authority', persisted.length === 0, persisted.join(', '));
  const ctx3 = stripComments(readFileSync(join(root, 'src', 'core', 'context', 'AuthContext.tsx'), 'utf8'));
  check('AuthContext does not store authVerified in the session', !/authVerified/.test(ctx3));
  check('protected readiness comes from reconciliation, not the login result',
    /isVerifiedReady/.test(readFileSync(join(root, 'src', 'core', 'services', 'authReconciliation.ts'), 'utf8')));
}

// ── 11. Legacy fallback stays local-only ────────────────────────────────
{
  const dA = stripComments(readFileSync(join(root, 'src', 'core', 'services', 'driverAuth.ts'), 'utf8'));
  const legacy = dA.split('trying legacy')[1] || '';
  check('the legacy path never sets authVerified', !/authVerified/.test(legacy));
  check('the legacy path never touches the Auth boundary',
    !/signInWithCustomTokenOwned|initializePersistentAuth|getOwnedVerifiedIdentity/.test(legacy));
}

// ── CORRECTION3 item 1: startup reconciliation is actually wired ────────
{
  const ctx = stripComments(readFileSync(join(root, 'src', 'core', 'context', 'AuthContext.tsx'), 'utf8'));
  check('bootstrap invokes reconcileRestoredSession', /reconcileRestoredSession\(/.test(ctx));
  const boot = ctx.split('const session = await getDriverSession')[1] || '';
  check('reconciliation runs inside the session-restore path', /reconcileRestoredSession/.test(boot));
  check('reconciliation is NOT awaited (offline entry stays non-blocking)',
    !/await\s+[^;]*reconcileRestoredSession/.test(ctx));
  check('reconciliation is guarded to once per mounted epoch',
    /reconciledRef\.current = true/.test(ctx) && /!reconciledRef\.current/.test(ctx));
  check('reconciliation failure cannot break app entry',
    /reconcileRestoredSession[\s\S]{0,300}?\.catch\(/.test(ctx));
  check('the restored local identity is passed in rather than re-read blindly',
    /reconcileRestoredSession\(\{[\s\S]{0,140}driverId/.test(ctx));

  const rec = stripComments(readFileSync(join(root, 'src', 'core', 'services', 'authReconciliation.ts'), 'utf8'));
  check('offline claim-read failure is unavailable, never rejected',
    /identity === undefined[\s\S]{0,90}set\('unavailable'\)/.test(rec));
  check('an unavailable reconciliation never signs the driver out',
    !/identity === undefined[\s\S]{0,120}signOutOwned/.test(rec));
  check('isVerifiedReady re-reads state rather than returning a stored flag',
    /isVerifiedReady[\s\S]{0,130}return current === 'verified'/.test(rec));
}

// ── CORRECTION3 item 2: cleanup failure is never swallowed ──────────────
{
  const s = stripComments(readFileSync(join(root, 'src', 'core', 'services', 'secureDriverAuth.ts'), 'utf8'));
  check('sign-out outcome is tri-state, not boolean',
    /'confirmed' \| 'not-ours' \| 'failed'/.test(core));
  check('cleanup is CONFIRMED by re-reading identity after sign-out',
    /await ops\.signOut\(\);\s*\n\s*const after = await ops\.getVerifiedIdentity\(\);\s*\n\s*if \(after === null\) return 'confirmed';/.test(core));
  check('a failed rollback raises UnresolvedAuthStateError',
    /removed === 'failed'\) throw new UnresolvedAuthStateError\('rollback-failed'\)/.test(core));
  check('an unremovable mismatched prior session also raises it',
    /removed === 'failed'\) throw new UnresolvedAuthStateError\('prior-mismatch-not-removed'\)/.test(core));
  check('the unresolved state is surfaced on the result', /authStateUnresolved/.test(s));
  check('no bare catch-and-continue wraps the rollback sign-out',
    !/signOutScoped\([^)]*\)\.catch\(/.test(core));

  const d = stripComments(readFileSync(join(root, 'src', 'core', 'services', 'driverAuth.ts'), 'utf8'));
  check('driverAuth REFUSES the local fallback when Auth state is unresolved',
    /if \(secure\.authStateUnresolved\)[\s\S]{0,180}valid: false/.test(d));
  const gate = d.indexOf('authStateUnresolved');
  const legacy = d.indexOf('trying legacy');
  check('the unresolved gate precedes the legacy fallback',
    gate > -1 && legacy > -1 && gate < legacy);
}

// ── CORRECTION3 item 3: logout cancellation cannot be overtaken ─────────
{
  const s = stripComments(readFileSync(join(root, 'src', 'core', 'services', 'secureDriverAuth.ts'), 'utf8'));
  check('an ownership epoch exists', /let epoch = 0/.test(core));
  check('invalidateAuthEpoch increments the epoch, not just a promise ref',
    /invalidateAuthEpoch[\s\S]{0,140}authSession\.invalidateEpoch\(\)/.test(s)
    && /invalidateEpoch\(\) \{\s*\n\s*epoch \+= 1;/.test(core));
  check('it also clears the single-flight slot',
    /invalidateEpoch\(\) \{[\s\S]{0,260}inFlight = null;[\s\S]{0,70}inFlightAttemptKey = null;/.test(core));
  check('the superseded predicate compares the captured epoch to current',
    /const superseded = \(\) => epoch !== attemptEpoch/.test(core));

  const est = core.split('async function runEstablish')[1].split('\n  }\n')[0];
  const awaits = (est.match(/await /g) || []).length;
  const guards = (est.match(/if \(superseded\(\)\) throw/g) || []).length;
  check('establishSdkSession re-checks ownership after its awaits (' + guards + ' guards / ' + awaits + ' awaits)',
    guards >= 4);
  check('the uid is claimed synchronously after sign-in, BEFORE the epoch check',
    /await ops\.signInWithCustomToken\([^)]*\);\s*establishedUid = ops\.getCurrentUserId\(\);\s*if \(superseded\(\)\)/.test(est));
  check('rollback is UID-scoped so a stale attempt cannot kill a newer session',
    /signOutScoped\(establishedUid\)/.test(est));
  check('scoped sign-out refuses to touch a session that is not ours',
    /before\.uid !== uid\) return 'not-ours'/.test(core));
  check('a superseded attempt still reaches rollback (its throw is inside the guarded try)',
    est.indexOf('SupersededAttemptError') < est.indexOf('} catch (err)'));
  check('the promise-ref-only cancellation API is gone', !/cancelInFlightLogin/.test(s));
  check('identity changing between sign-out and confirmation is not "failed"',
    /if \(uid && after\.uid !== uid\) return 'not-ours';/.test(core));

  const ctx = stripComments(readFileSync(join(root, 'src', 'core', 'context', 'AuthContext.tsx'), 'utf8'));
  check('both logout paths invalidate the epoch',
    (ctx.match(/invalidateAuthEpoch\(\)/g) || []).length >= 2);
}

// ── CORRECTION3 item 4: the equality token, described accurately ────────
{
  const raw = readFileSync(join(root, 'src', 'core', 'services', 'secureDriverAuth.ts'), 'utf8');
  const s = stripComments(raw);
  check('the process key is 256 random bits', /getRandomBytesAsync\(32\)/.test(s));
  check('the token is a KEYED digest (the process key is an input)',
    /digestStringAsync\([\s\S]{0,140}await processKey\(\)/.test(s));
  check('SHA-256, not a 32-bit non-cryptographic hash', /CryptoDigestAlgorithm\.SHA256/.test(s));
  check('the old Math.imul construction is gone', !/Math\.imul/.test(s));
  check('the process key is never persisted',
    !/(SecureStore\.setItemAsync|AsyncStorage\.setItem)\([^)]*(attemptKeyMaterial|processKey)/.test(s));
  check('nothing is described as "non-reversible"', !/non-reversible/i.test(raw));
  check('the docs state it is keyed rather than a plain salted digest',
    /KEYED digest, not a plain salted/.test(raw));
  check('neither the token nor the key is logged',
    !/console\.[a-z]+\([^)]*(attemptKeyMaterial|processKey\(|\bkey\b)/.test(s));
  check('the token feeds only the single-flight slot',
    /authSession\.singleFlight\(key, \(\) => runSecureLogin\(params\)\)/.test(s));
  check('attemptKey is awaited by secureLogin', /const key = await attemptKey\(/.test(s));
  check('the file is clean UTF-8 with no NUL bytes',
    !readFileSync(join(root, 'src', 'core', 'services', 'secureDriverAuth.ts')).includes(0));
}

console.log(`
PHYSICAL / BUILD-ONLY claims — not provable here:
  - the SDK session actually persists across a true cold launch
  - AsyncStorage-backed restoration on app restart
  - SDK-driven token refresh past the one-hour ID token lifetime
  - no "memory persistence" warning appears in a device log
  - an existing install with stale legacy tokens reauthenticates once
Source-proven above: REST plane removed, SDK ownership, cleanup ordering,
sign-out behavior, single app owner, no credential logging.`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
