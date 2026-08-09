/**
 * Pins WB-S Expo route ownership for wellbuilt-suite://sso-authorize.
 *
 * Lives under src/ (not app/) so Expo Router require.context and Metro
 * never attempt to bundle node:assert / node:fs / node:test into Android.
 */
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(__dirname, '..', '..', '..');

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

test('no Node test/spec files remain under app/ (Metro must not discover them)', () => {
  const appDir = join(root, 'app');
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) out.push(...walk(full));
      else if (/\.(test|spec)\.[cm]?[jt]sx?$/i.test(name)) out.push(full);
    }
    return out;
  };
  const hits = walk(appDir);
  assert.deepEqual(hits, [], `Node tests under app/: ${hits.join(', ')}`);
});
