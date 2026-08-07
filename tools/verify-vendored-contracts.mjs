/**
 * vc51.9L-C2 — vendored contracts integrity and drift gate.
 *
 * WHY THIS EXISTS
 * `@tester3x/wellbuilt-contracts` lives on GitHub Packages, which needs a
 * NODE_AUTH_TOKEN the EAS builders do not have — so both mobile builds
 * failed at "Install dependencies" the first time either app was built
 * after adopting the package. The exact PUBLISHED 0.2.0 tarball is
 * vendored here instead, making the dependency install credential-free.
 *
 * "Exact" is the whole point, so it is proven rather than asserted: the
 * vendored bytes must hash to the same sha512 the lockfile recorded when
 * npm downloaded the package from the registry. That value predates this
 * change and cannot be back-fitted.
 *
 * Run: node tools/verify-vendored-contracts.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = '@tester3x/wellbuilt-contracts';
const VENDOR_REL = 'vendor/wellbuilt-contracts-0.2.0.tgz';
const VENDOR = join(ROOT, VENDOR_REL);

/**
 * The published artifact's hashes.
 *
 * INTEGRITY is exactly what the pre-vendoring lockfile carried for the
 * registry download; SHA256 independently matches the value Dashboard's
 * contracts mirror recorded at publish time.
 */
const EXPECTED = Object.freeze({
  name: PKG,
  version: '0.2.0',
  integrity: 'sha512-uf6QuaWGloxvsnphgOM8SVINNLkv6scBLvdfRf9LCz+iBSwMxw3A2/4CQSyQMI5cfK6YhaZr9HCNYE8StjJtoQ==',
  sha256: 'aa99296cdd71d94322a1e36862177de427a32301d034aacbdc1b03010e8c171f',
  bytes: 45589,
  entryCount: 39,
});

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
};

// ── the artifact ─────────────────────────────────────────────────────────
check('vendored tarball exists', existsSync(VENDOR), VENDOR_REL);
if (!existsSync(VENDOR)) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
const buf = readFileSync(VENDOR);
const sha512 = `sha512-${createHash('sha512').update(buf).digest('base64')}`;
const sha256 = createHash('sha256').update(buf).digest('hex');

check('sha512 equals the PUBLISHED package integrity', sha512 === EXPECTED.integrity, sha512);
check('sha256 equals the repository pin', sha256 === EXPECTED.sha256, sha256);
check('byte length is exact', buf.length === EXPECTED.bytes, String(buf.length));

// ── contents ─────────────────────────────────────────────────────────────
const entries = [];
{
  const tar = gunzipSync(buf);
  let off = 0;
  while (off + 512 <= tar.length) {
    const b = tar.subarray(off, off + 512);
    if (b.every((x) => x === 0)) break;
    const name = b.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const mode = parseInt(b.subarray(100, 108).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
    const size = parseInt(b.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(b[156]);
    if (name) entries.push({ name, mode, size, type, body: tar.subarray(off + 512, off + 512 + size) });
    off += 512 + Math.ceil(size / 512) * 512;
  }
}
check('entry count is exact', entries.length === EXPECTED.entryCount, String(entries.length));

const manifest = entries.find((e) => e.name === 'package/package.json');
check('package.json is present', !!manifest);
if (manifest) {
  const pj = JSON.parse(manifest.body.toString('utf8'));
  check('internal name is exact', pj.name === EXPECTED.name, pj.name);
  check('internal version is exact', pj.version === EXPECTED.version, pj.version);
  check('license metadata is retained', typeof pj.license === 'string' && pj.license.length > 0, pj.license);
}

// Only the expected published surface.
const unexpected = entries.filter((e) =>
  !/^package\/(dist\/|package\.json$|README\.md$|NOTICE$)/.test(e.name));
check('contains only the expected published surface', unexpected.length === 0,
  unexpected.map((e) => e.name).join(', '));

// ── safety ───────────────────────────────────────────────────────────────
const hazards = [];
for (const e of entries) {
  if (e.name.includes('..')) hazards.push(`traversal: ${e.name}`);
  if (/^([A-Za-z]:|\/)/.test(e.name)) hazards.push(`absolute: ${e.name}`);
  if (e.type === '1' || e.type === '2') hazards.push(`link: ${e.name}`);
  if (/(^|\/)\.npmrc$|(^|\/)\.env|credential|serviceAccount|\.pem$|\.key$/i.test(e.name)) {
    hazards.push(`credential/config: ${e.name}`);
  }
  if (/\.(sh|bat|cmd|ps1|exe|dll|so|dylib|node)$/i.test(e.name)) hazards.push(`executable: ${e.name}`);
  if (e.type === '0' && (e.mode & 0o111)) hazards.push(`exec bit: ${e.name}`);
}
check('no path traversal, absolute path, link, executable, or config file', hazards.length === 0,
  hazards.join('; '));

// Credential-shaped material in file BODIES. The README documents the old
// GitHub Packages auth flow in prose, which is not a credential.
{
  const bodies = entries.filter((e) => e.name !== 'package/README.md')
    .map((e) => e.body.toString('latin1')).join('\n');
  const pats = [
    ['GitHub token', /gh[pousr]_[A-Za-z0-9]{16,}/],
    ['npm authToken assignment', /_authToken\s*=\s*\S/],
    ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{16,}/],
    ['Google API key', /AIza[A-Za-z0-9_-]{30,}/],
    ['private key block', /BEGIN [A-Z ]*PRIVATE KEY/],
  ];
  for (const [label, re] of pats) check(`no ${label} in package files`, !re.test(bodies));
}

// ── manifest + lockfile wiring ───────────────────────────────────────────
const pkgJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
check('manifest points at the approved local tarball',
  pkgJson.dependencies?.[PKG] === `file:${VENDOR_REL}`, pkgJson.dependencies?.[PKG]);

const lockRaw = readFileSync(join(ROOT, 'package-lock.json'), 'utf8');
const lock = JSON.parse(lockRaw);
const entry = lock.packages?.[`node_modules/${PKG}`];
check('lockfile entry exists', !!entry);
check('lockfile resolves locally', entry?.resolved === `file:${VENDOR_REL}`, entry?.resolved);
check('lockfile keeps the published integrity', entry?.integrity === EXPECTED.integrity, entry?.integrity);
check('lockfile version is exact', entry?.version === EXPECTED.version, entry?.version);
check('no GitHub Packages URL remains for this dependency',
  !new RegExp(`npm\\.pkg\\.github\\.com[^"]*wellbuilt-contracts`).test(lockRaw));
check('no GitHub Packages URL remains anywhere in the lockfile',
  !/npm\.pkg\.github\.com/.test(lockRaw));
check('no absolute path or machine metadata in the lockfile',
  !/[A-Za-z]:\\\\|file:\/\/\/|AppData|Users\\\\/.test(lockRaw));

// ── credential-free install ──────────────────────────────────────────────
{
  const npmrcPath = join(ROOT, '.npmrc');
  const npmrc = existsSync(npmrcPath) ? readFileSync(npmrcPath, 'utf8') : '';
  check('.npmrc requires no NODE_AUTH_TOKEN', !/NODE_AUTH_TOKEN/.test(npmrc), npmrc.trim());
  check('.npmrc declares no GitHub Packages registry', !/npm\.pkg\.github\.com/.test(npmrc));
}

// ── installed module matches the vendored artifact ───────────────────────
{
  const installed = join(ROOT, 'node_modules', '@tester3x', 'wellbuilt-contracts');
  if (!existsSync(installed)) {
    check('installed module present (run npm install)', false);
  } else {
    let same = 0, diff = [];
    for (const e of entries) {
      if (e.type !== '0' && e.type !== '\0') continue;
      const rel = e.name.replace(/^package\//, '');
      const p = join(installed, rel);
      if (!existsSync(p)) { diff.push(`missing ${rel}`); continue; }
      const a = createHash('sha256').update(e.body).digest('hex');
      const b = createHash('sha256').update(readFileSync(p)).digest('hex');
      if (a === b) same++; else diff.push(rel);
    }
    check('installed module matches the vendored artifact byte-for-byte',
      diff.length === 0, diff.slice(0, 5).join(', '));
    check('all package files are installed', same === EXPECTED.entryCount, `${same}`);
    const ipj = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
    check('installed version is exactly 0.2.0', ipj.version === EXPECTED.version, ipj.version);
    // The unpublished 0.3.0-dev SSO surface must NOT arrive via the package.
    const api = readFileSync(join(installed, 'dist', 'index.d.ts'), 'utf8');
    check('package exposes NO unpublished SSO surface',
      !/SSO_PROTOCOL_VERSION|SESSION_AUDIENCE_WBT/.test(api));
  }
}

// ── the unpublished bridge contract stays mirror-only ────────────────────
{
  const mirrors = readdirSync(join(ROOT, 'src', 'core', 'services'))
    .filter((f) => /\.generated\.ts$/.test(f));
  check('unpublished protocol still arrives via generated mirrors', mirrors.length > 0,
    mirrors.join(', '));
  for (const m of mirrors) {
    const src = readFileSync(join(ROOT, 'src', 'core', 'services', m), 'utf8');
    check(`${m} does not import the package`, !new RegExp(`from '${PKG}'`).test(src));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
