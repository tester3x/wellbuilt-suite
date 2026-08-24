#!/usr/bin/env node
/**
 * vc51.9J — generator/verifier for the SSO protocol source mirror.
 *
 *   node tools/mirror-sso-protocol.mjs --regenerate [--canonical <path>]
 *   node tools/mirror-sso-protocol.mjs --verify
 *
 * WHY THIS EXISTS, AND WHY IT IS TEMPORARY
 * WB-S is pinned to the published @tester3x/wellbuilt-contracts@0.2.0.
 * The SSO protocol lives in canonical contracts 0.3.0-dev.0, which is
 * deliberately unpublished, so the package cannot carry it.
 *
 * Rather than hand-copy constants — which is exactly the JSA receipt
 * v1/v2 drift this ecosystem already paid for once — this copies the
 * canonical source file VERBATIM and verifies it. Platform line endings
 * (CRLF vs LF vs lone CR) are normalized before hash/compare so a
 * Windows working tree cannot flip the protected result. Any semantic
 * (non-newline) difference still fails hard.
 *
 * The canonical file is self-contained: zero imports, zero platform APIs.
 * That is asserted here, because it is what makes a verbatim copy safe.
 *
 * DELETE THIS when contracts publishes a version containing the SSO
 * protocol: replace the generated module with a package import and drop
 * both this tool and its test.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CANONICAL = join(REPO, '..', 'wellbuilt-contracts', 'src', 'sso', 'protocol.ts');
const GENERATED = join(REPO, 'src', 'core', 'services', 'ssoProtocol.generated.ts');
const MANIFEST = join(REPO, 'src', 'core', 'services', 'SSO-MIRROR-MANIFEST.json');

export const EXPECTED_CANONICAL_VERSION = '0.5.0-dev.0';

const HEADER = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Verbatim copy of the canonical SSO protocol from
 * @tester3x/wellbuilt-contracts src/sso/protocol.ts at version
 * ${EXPECTED_CANONICAL_VERSION} (UNPUBLISHED).
 *
 * Regenerate:  node tools/mirror-sso-protocol.mjs --regenerate
 * Verify:      node tools/mirror-sso-protocol.mjs --verify
 *
 * This exists only because the contracts package mirror is SHA-pinned to
 * the published 0.2.0 artifact and cannot carry an unpublished bump.
 * When the SSO protocol is published, delete this file and import from
 * the package instead.
 */
// @generated from wellbuilt-contracts/src/sso/protocol.ts
`;

/** Read as UTF-8 text and collapse CRLF / lone CR to LF. */
export function normalizeNewlines(text) {
  if (typeof text !== 'string') throw new TypeError('normalizeNewlines expects utf-8 text');
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function sha256NormalizedUtf8(text) {
  return createHash('sha256').update(normalizeNewlines(text), 'utf8').digest('hex');
}

export function bodyOf(generated) {
  const marker = '// @generated from wellbuilt-contracts/src/sso/protocol.ts';
  const at = generated.indexOf(marker);
  if (at < 0) throw new Error('generated file is missing its provenance marker');
  const after = generated.slice(at + marker.length).replace(/^\r?\n/, '');
  return after;
}

export function readUtf8(path) {
  return readFileSync(path, 'utf8');
}

function readCanonical(path) {
  if (!existsSync(path)) {
    throw new Error(`canonical SSO protocol not found at ${path}`);
  }
  const src = readUtf8(path);
  // A verbatim copy is only safe if the source pulls in nothing.
  const importLine = normalizeNewlines(src).split('\n').find((l) => /^\s*import\s/.test(l));
  if (importLine) {
    throw new Error(`canonical protocol must have no imports; found: ${importLine.trim()}`);
  }
  if (/require\(|process\.|globalThis|Math\.random|Date\.now/.test(src)) {
    throw new Error('canonical protocol must be pure: no platform, clock, or randomness');
  }
  return src;
}

/**
 * Executable LF/CRLF equivalence: the protected hash must be identical
 * for LF, CRLF, and lone-CR encodings of the same semantic text.
 */
export function assertLfCrlfEquivalence(text) {
  const lf = normalizeNewlines(text);
  const crlf = lf.replace(/\n/g, '\r\n');
  const cr = lf.replace(/\n/g, '\r');
  const hLf = sha256NormalizedUtf8(lf);
  const hCrlf = sha256NormalizedUtf8(crlf);
  const hCr = sha256NormalizedUtf8(cr);
  if (hLf !== hCrlf || hLf !== hCr) {
    throw new Error('LF/CRLF/CR encodings of the same text must hash identically');
  }
  if (lf.includes('\n') && crlf === lf) {
    throw new Error('CRLF fixture collapsed unexpectedly');
  }
  return hLf;
}

export function verifyMirror(opts = {}) {
  const generatedPath = opts.generatedPath || GENERATED;
  const manifestPath = opts.manifestPath || MANIFEST;
  const canonicalPath = opts.canonicalPath || DEFAULT_CANONICAL;
  const results = [];
  const note = (ok, message) => {
    results.push({ ok, message });
    return ok;
  };

  if (!existsSync(generatedPath)) {
    note(false, 'generated mirror exists');
    return results;
  }
  const generated = readUtf8(generatedPath);
  if (!existsSync(manifestPath)) {
    note(false, 'manifest exists');
    return results;
  }
  const manifest = JSON.parse(readUtf8(manifestPath));
  const body = bodyOf(generated);
  const bodyHash = sha256NormalizedUtf8(body);
  note(
    bodyHash === manifest.bodySha256,
    bodyHash === manifest.bodySha256
      ? 'mirror matches its manifest hash'
      : `mirror matches its manifest hash (${bodyHash})`,
  );

  try {
    assertLfCrlfEquivalence(body);
    note(true, 'LF/CRLF-equivalence of protected body');
  } catch (err) {
    note(false, `LF/CRLF-equivalence of protected body: ${err instanceof Error ? err.message : 'failed'}`);
  }

  note(
    manifest.canonicalVersion === EXPECTED_CANONICAL_VERSION,
    'manifest records the expected canonical version',
  );
  note(manifest.published === false, 'manifest records the source as unpublished');

  if (existsSync(canonicalPath)) {
    const canonical = readCanonical(canonicalPath);
    const same = normalizeNewlines(canonical) === normalizeNewlines(body);
    note(
      same,
      same
        ? 'mirror is newline-normalized identical to the canonical source'
        : 'mirror is newline-normalized identical to the canonical source',
    );
  } else {
    note(true, 'canonical source unavailable here — hash check stands alone');
  }

  note(/DO NOT EDIT/.test(generated), 'mirror carries a do-not-edit header');
  return results;
}

function invokedAsCli() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    const self = fileURLToPath(import.meta.url);
    const invoked = resolve(argv1);
    return self === invoked || pathToFileURL(invoked).href === import.meta.url;
  } catch {
    return /mirror-sso-protocol\.mjs$/i.test(String(argv1));
  }
}

function runCli() {
  const mode = process.argv.includes('--regenerate')
    ? 'regenerate'
    : process.argv.includes('--verify')
      ? 'verify'
      : null;
  const canonicalIdx = process.argv.indexOf('--canonical');
  const canonicalPath = canonicalIdx > -1 ? process.argv[canonicalIdx + 1] : DEFAULT_CANONICAL;

  if (!mode) {
    console.error('usage: mirror-sso-protocol.mjs --regenerate | --verify');
    process.exit(2);
  }

  if (mode === 'regenerate') {
    const canonical = readCanonical(canonicalPath);
    mkdirSync(dirname(GENERATED), { recursive: true });
    writeFileSync(GENERATED, HEADER + canonical, 'utf8');
    writeFileSync(
      MANIFEST,
      JSON.stringify(
        {
          canonicalVersion: EXPECTED_CANONICAL_VERSION,
          canonicalPath: 'wellbuilt-contracts/src/sso/protocol.ts',
          bodySha256: sha256NormalizedUtf8(canonical),
          published: false,
          note: 'Unpublished. Replace with a package import once contracts publishes the SSO protocol.',
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    console.log(`regenerated ${GENERATED}`);
    console.log(`body sha256 ${sha256NormalizedUtf8(canonical)}`);
    return;
  }

  const results = verifyMirror({ canonicalPath });
  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.message}`);
    if (!r.ok) failed += 1;
  }
  console.log(failed ? `\n${failed} failed` : '\nSSO protocol mirror verified');
  if (failed) process.exitCode = 1;
}

if (invokedAsCli()) runCli();
