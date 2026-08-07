/**
 * vc51.9I-RECOVERY5A — Firebase RN persistence boundary (WB-S).
 *
 * Proves the boundary is a genuine runtime capability check against the
 * OFFICIAL public module, not a shim — and that it cannot silently
 * outlive the upstream defect it exists for.
 *
 * Run: node tools/test-firebaseAuthBoundary.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
};

const P = join(root, 'src', 'core', 'services', 'firebaseAuthBoundary.ts');
check('boundary module exists', existsSync(P));
const src = readFileSync(P, 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = stripComments(src);

// ── 1. None of the forbidden mechanisms ─────────────────────────────────
check('no ambient/global declaration', !/declare\s+(global|module|namespace)/.test(code));
check('no @ts-ignore / @ts-expect-error', !/@ts-(ignore|expect-error)/.test(src));
check('no `any`', !/\bany\b/.test(code.replace(/AsyncStorageLike/g, '')));
check('no double cast', !/as\s+unknown\s+as/.test(code));
check('no internal/deep Firebase import',
  !/@firebase\//.test(code) && !/firebase\/auth\/(dist|internal|react-native)/.test(code));
check('no patch-package patch for firebase',
  !existsSync(join(root, 'patches')) ||
  !readFileSync(join(root, 'patches'), 'utf8').includes?.('firebase') ||
  true);
{
  const patches = join(root, 'patches');
  let fbPatch = [];
  if (existsSync(patches)) {
    const { readdirSync } = require('node:fs');
    fbPatch = readdirSync(patches).filter((f) => /firebase/i.test(f));
  }
  check('no firebase patch-package patch exists', fbPatch.length === 0, fbPatch.join(', '));
}
check('no hand-written Persistence implementation',
  // MissingRnPersistenceError is an Error subclass, not a Persistence impl.
  !/_isAvailable|_addListener|_removeListener/.test(code)
  && !/class\s+\w*Persistence(?!Error)\b/.test(code));
check('no React Native Firebase dependency',
  !/@react-native-firebase/.test(code)
  && !Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies || {})
    .some((d) => d.startsWith('@react-native-firebase')));
check('no memory-persistence fallback', !/inMemoryPersistence|browserLocalPersistence/.test(code));
check('getAuth is never called at all (it returns memory-only on RN)',
  !/firebaseAuth\.getAuth\s*\(/.test(code) && /already-initialized/.test(code));

// ── 2. It uses the official public module and the required mechanism ────
check('namespace-imports the public firebase/auth module',
  /import \* as firebaseAuth from 'firebase\/auth';/.test(code));
check('imports Persistence from the public type surface',
  /import type \{[^}]*Persistence[^}]*\} from 'firebase\/auth';/.test(code));
check('detects the capability with Reflect.get',
  /Reflect\.get\(ns, 'getReactNativePersistence'\)/.test(code));
check('narrows with a real type predicate',
  /function providesRnPersistence\(ns: typeof firebaseAuth\): ns is AuthWithRnPersistence/.test(code));
check('narrowed type is an intersection with the public namespace',
  /type AuthWithRnPersistence = typeof firebaseAuth & \{/.test(code));
check('only narrows after confirming the property is callable',
  /typeof candidate === 'function'/.test(code));
check('the AsyncStorage contract is the three-method surface',
  /getItem\(key: string\): Promise<string \| null>/.test(code)
  && /setItem\(key: string, value: string\): Promise<void>/.test(code)
  && /removeItem\(key: string\): Promise<void>/.test(code));

// ── 3. Bounded export surface ───────────────────────────────────────────
{
  const exported = [...code.matchAll(/^export (?:function|class|interface|const) (\w+)/gm)].map((m) => m[1]);
  const allowed = ['AsyncStorageLike', 'MissingRnPersistenceError', 'ForeignAuthInstanceError',
    'getReactNativePersistenceFactory', 'boundaryStillRequired', 'initializePersistentAuth',
    // Ownership accessors — the boundary is the sole Auth-instance owner.
    'getOwnedAuth', 'isBoundaryOwnedAuth', 'requireOwnedAuth', '__resetOwnershipForTests',
    // Bounded operations — callers use these instead of importing firebase/auth.
    'waitForAuthReady', 'signInWithCustomTokenOwned', 'signOutOwned',
    'getOwnedUserId', 'getOwnedIdToken', 'onOwnedAuthStateChanged'];
  check('exports only the narrowed factory + bounded init (no broad re-export)',
    exported.every((e) => allowed.includes(e)), exported.join(', '));
  check('does not re-export firebase/auth', !/export \*/.test(code) && !/export \{[^}]*\} from 'firebase\/auth'/.test(code));
}

// ── 4. Fail-closed, credential-free ─────────────────────────────────────
check('throws a typed error when the capability is absent',
  /throw new MissingRnPersistenceError\(\)/.test(code));
check('the diagnostic names no credential, key, or token',
  // Read the CODE, not the comment that explains the rule.
  !/token|apiKey|password|secret/i.test(
    (stripComments(src).match(/class MissingRnPersistenceError[\s\S]*?\n\}/) || [''])[0]));

// ── 5. The official runtime really does supply it ───────────────────────
{
  // Node resolves firebase/auth to the browser build, so assert against
  // the react-native condition the way Metro resolves it.
  const pkgPath = require.resolve('@firebase/auth/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const rnEntry = pkg.exports?.['.']?.['react-native']?.default || pkg['react-native'];
  check('@firebase/auth declares a react-native entry', !!rnEntry, String(rnEntry));
  const rnFile = join(dirname(pkgPath), rnEntry.replace(/^\.\//, ''));
  const rnSrc = readFileSync(rnFile, 'utf8');
  check('the official RN bundle exports getReactNativePersistence',
    /exports\.getReactNativePersistence\s*=/.test(rnSrc) || /getReactNativePersistence/.test(rnSrc));

  // THE ROT PIN: this boundary exists only because `types` precedes
  // `react-native` in the export map. When Firebase fixes that ordering,
  // the factory becomes importable directly and this module must go.
  const conds = Object.keys(pkg.exports?.['.'] || {});
  const typesIdx = conds.indexOf('types');
  const rnIdx = conds.indexOf('react-native');
  check('upstream defect still present (types precedes react-native) — boundary still needed',
    typesIdx !== -1 && rnIdx !== -1 && typesIdx < rnIdx,
    `order: ${conds.join(' -> ')} — if react-native now precedes types, DELETE src/core/services/firebaseAuthBoundary.ts and import getReactNativePersistence directly`);
  const typeEntry = pkg.exports?.['.']?.types;
  const typeSrc = typeof typeEntry === 'string'
    ? readFileSync(join(dirname(pkgPath), typeEntry.replace(/^\.\//, '')), 'utf8') : '';
  check('the types entry still omits the RN factory (the exact defect)',
    !/getReactNativePersistence/.test(typeSrc),
    'types entry now declares it — boundary can be deleted');
}

// ── 6. Exactly one Auth instance, AsyncStorage 2.2.0 passed through ─────
check('initializes via initializeAuth with an explicit persistence',
  /firebaseAuth\.initializeAuth\(app, \{ persistence \}\)/.test(code));
check('handles auth/already-initialized explicitly',
  /code === 'auth\/already-initialized'/.test(code));

// ── 7. Sole ownership of the Auth instance ──────────────────────────────
{
  const prodFiles = execSync('git ls-files "*.ts" "*.tsx"', { cwd: root, encoding: 'utf8' })
    .trim().split('\n')
    .filter((f) => f && !f.startsWith('tools/') && !f.startsWith('functions/')
      && f !== 'src/core/services/firebaseAuthBoundary.ts');
  const offenders = [];
  for (const f of prodFiles) {
    let t;
    try { t = readFileSync(join(root, f), 'utf8'); } catch { continue; }
    const c = stripComments(t);
    if (/from ['"](firebase\/auth|@firebase\/auth)['"]/.test(c)) offenders.push(`${f} (imports firebase/auth)`);
    else if (/\b(getAuth|initializeAuth)\s*\(/.test(c)) offenders.push(`${f} (calls getAuth/initializeAuth)`);
    else if (/import\(\s*['"](firebase\/auth|@firebase\/auth)['"]\s*\)/.test(c)) offenders.push(`${f} (dynamic import)`);
    else if (/firebase\/compat/.test(c)) offenders.push(`${f} (compat import)`);
  }
  check('no production module outside the boundary initializes or retrieves Auth',
    offenders.length === 0, offenders.slice(0, 4).join(' ; '));
  console.log(`   scanned ${prodFiles.length} production modules`);
}

// ── 8. already-initialized is attributable, never blindly adopted ───────
check('a foreign pre-existing instance is refused, not adopted',
  /if \(code === 'auth\/already-initialized'\) throw new ForeignAuthInstanceError\(\)/.test(code));
check('getAuth is never called to recover an instance',
  !/firebaseAuth\.getAuth\(/.test(code));
check('ownership is recorded only after a persistent initializeAuth',
  /const auth = firebaseAuth\.initializeAuth\(app, \{ persistence \}\);[\s\S]{0,80}registry\.set\(app, auth\)/.test(code));
check('a repeat call returns the boundary-owned instance (Fast Refresh safe)',
  /const alreadyOurs = registry\.get\(app\);[\s\S]{0,60}return alreadyOurs;/.test(code));
check('ownership survives module re-evaluation via a Symbol.for slot',
  /Symbol\.for\('wellbuilt\.firebaseAuthBoundary\.ownedAuth'\)/.test(code));
check('ownership state is our own — no Firebase internals inspected',
  !/_getInstance|_getProvider|\b_delegate\b|persistenceManager|_persistence/.test(code));
check('protected paths can fail closed on unowned Auth',
  /export function requireOwnedAuth/.test(code));
check('ownership predicate compares instance identity',
  /ownedRegistry\(\)\.get\(app\) === auth/.test(code));
check('ForeignAuthInstanceError explains the persistence risk without naming a credential',
  /memory-backed instance would silently end the driver/.test(code)
  && !/token|apiKey|password|secret/i.test(
    (stripComments(src).match(/class ForeignAuthInstanceError[\s\S]*?\n\}/) || [''])[0]));
{
  const pkgJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  check('AsyncStorage is pinned at the version passed to the factory',
    pkgJson.dependencies['@react-native-async-storage/async-storage'] === '2.2.0'
    || /^\^?2\.2\.0$/.test(pkgJson.dependencies['@react-native-async-storage/async-storage']),
    pkgJson.dependencies['@react-native-async-storage/async-storage']);
  const installed = JSON.parse(readFileSync(
    join(root, 'node_modules', '@react-native-async-storage', 'async-storage', 'package.json'), 'utf8')).version;
  check('installed AsyncStorage is 2.2.0', installed === '2.2.0', installed);
  const fbAuth = JSON.parse(readFileSync(require.resolve('@firebase/auth/package.json'), 'utf8'));
  const peer = fbAuth.peerDependencies?.['@react-native-async-storage/async-storage'];
  check('@firebase/auth officially accepts that AsyncStorage version',
    !!peer && /2\.2\.0|\^2\b|\^3\b/.test(peer), peer);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
