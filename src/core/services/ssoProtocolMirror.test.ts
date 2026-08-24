/**
 * Protected SSO protocol mirror: platform line endings must not change
 * the hash/compare result. Semantic (non-newline) differences still fail.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  assertLfCrlfEquivalence,
  bodyOf,
  normalizeNewlines,
  sha256NormalizedUtf8,
  verifyMirror,
} from '../../../tools/mirror-sso-protocol.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GENERATED = join(HERE, 'ssoProtocol.generated.ts');
const MANIFEST = join(HERE, 'SSO-MIRROR-MANIFEST.json');

describe('SSO protocol mirror newline-normalized verify', () => {
  it('LF, CRLF, and lone CR of the same semantic text hash identically', () => {
    const lf = 'export const X = 1;\nexport const Y = 2;\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    const cr = lf.replace(/\n/g, '\r');
    assert.notEqual(crlf, lf);
    assert.notEqual(cr, lf);
    const h = sha256NormalizedUtf8(lf);
    assert.equal(sha256NormalizedUtf8(crlf), h);
    assert.equal(sha256NormalizedUtf8(cr), h);
    assert.equal(assertLfCrlfEquivalence(lf), h);
  });

  it('a semantic content change still hashes differently after newline normalize', () => {
    const a = 'export const X = 1;\n';
    const b = 'export const X = 2;\n';
    const aCrlf = a.replace(/\n/g, '\r\n');
    assert.notEqual(sha256NormalizedUtf8(aCrlf), sha256NormalizedUtf8(b));
    assert.notEqual(normalizeNewlines(aCrlf), normalizeNewlines(b));
  });

  it('does not replace the pinned manifest hash with a working-tree CRLF hash', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const generated = readFileSync(GENERATED, 'utf8');
    const body = bodyOf(generated);
    const rawSha = createHash('sha256').update(body, 'utf8').digest('hex');
    const normalizedSha = sha256NormalizedUtf8(body);
    assert.equal(normalizedSha, manifest.bodySha256);
    if (body.includes('\r')) {
      assert.notEqual(rawSha, manifest.bodySha256, 'raw CRLF hash must not become the pin');
    }
  });

  it('bodyOf+hash is identical for a complete generated file in LF, CRLF, and lone CR', () => {
    const marker = '// @generated from wellbuilt-contracts/src/sso/protocol.ts';
    const semantic = 'export const X = 1;\nexport const Y = 2;\n';
    const wrap = (nl: string) =>
      `/** GENERATED FILE — DO NOT EDIT. */${nl}${marker}${nl}${semantic.replace(/\n/g, nl)}`;
    const hLf = sha256NormalizedUtf8(bodyOf(wrap('\n')));
    assert.equal(sha256NormalizedUtf8(bodyOf(wrap('\r\n'))), hLf);
    assert.equal(sha256NormalizedUtf8(bodyOf(wrap('\r'))), hLf);
    assert.equal(normalizeNewlines(bodyOf(wrap('\r'))), semantic);
    assert.equal(normalizeNewlines(bodyOf(wrap('\r\n'))), semantic);
  });

  it('verifyMirror reports pass for the live generated file (newline-normalized)', () => {
    const results = verifyMirror();
    for (const r of results) {
      assert.equal(r.ok, true, r.message);
    }
    assert.ok(results.some((r) => /LF\/CRLF-equivalence/.test(r.message)));
    assert.ok(results.some((r) => r.message === 'mirror matches its manifest hash'));
  });
});
