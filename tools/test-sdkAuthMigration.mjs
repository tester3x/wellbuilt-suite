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
  /signInWithCustomTokenOwned\(app, customToken\)/.test(auth));
check('persistent Auth is initialized through the boundary',
  /initializePersistentAuth\(app, AsyncStorage\)/.test(auth));
check('AsyncStorage is what is handed to the boundary', /AsyncStorage/.test(auth));
check('readiness is awaited after sign-in', /waitForAuthReady\(app\)/.test(auth));
check('the current ID token comes from the SDK session, not storage',
  /return getOwnedIdToken\(getFirebaseApp\(\)\)/.test(auth));

// ── 3. Legacy material is cleared only AFTER success ────────────────────
{
  const idx = auth.indexOf('await establishSdkSession(data.customToken);');
  const clr = auth.indexOf('await clearLegacyTokenMaterial();', idx);
  check('legacy token material is cleared only after a successful SDK sign-in',
    idx !== -1 && clr !== -1 && clr > idx);
  check('cleanup only deletes — it never reads the values',
    /deleteItemAsync\(ID_TOKEN_KEY\)/.test(auth) && /deleteItemAsync\(REFRESH_TOKEN_KEY\)/.test(auth));
  // A failed exchange must not reach the cleanup.
  check('a failed sign-in cannot fall through to cleanup',
    /await establishSdkSession\([^)]*\);\s*\n\s*await clearLegacyTokenMaterial\(\);/.test(auth));
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
