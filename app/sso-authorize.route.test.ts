/**
 * Pins WB-S Expo route ownership for wellbuilt-suite://sso-authorize.
 */
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(__dirname, '..');

test('app/sso-authorize.tsx exists and forwards to dispatchSsoUrl', () => {
  const p = join(root, 'app', 'sso-authorize.tsx');
  assert.ok(existsSync(p), 'missing app/sso-authorize.tsx');
  const src = readFileSync(p, 'utf8');
  assert.ok(src.includes('dispatchSsoUrl'));
  assert.ok(src.includes('SSO_AUTHORIZE_SCHEME') || src.includes('wellbuilt-suite'));
  assert.ok(src.includes('sso-authorize'));
  assert.ok(src.includes('ran.current'), 'must single-execute on mount');
});

test('dvir-complete pattern preserved (no regression of existing thin route)', () => {
  const p = join(root, 'app', 'dvir-complete.tsx');
  assert.ok(existsSync(p));
});
