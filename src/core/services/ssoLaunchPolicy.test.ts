/**
 * vc51.9J-C1 — WB-S launcher: WB-T goes credential-free, the other three
 * are byte-for-byte unchanged.
 *
 * Run: npm run test:sso
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  isCredentialFreeLaunchTarget,
  wbtSsoStartUrl,
  LEGACY_HASH_SSO_DEBT,
  WBT_SCHEME,
  WBT_SSO_START_HOST,
} from './ssoLaunchPolicy.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('WB-T launches credential-free', () => {
  it('identifies WB-T by scheme, case-insensitively', () => {
    assert.equal(isCredentialFreeLaunchTarget(WBT_SCHEME), true);
    assert.equal(isCredentialFreeLaunchTarget('WELLBUILT-TICKETS'), true);
  });

  it('does NOT match the other three apps', () => {
    for (const { scheme } of LEGACY_HASH_SSO_DEBT) {
      assert.equal(isCredentialFreeLaunchTarget(scheme), false, scheme);
    }
    assert.equal(isCredentialFreeLaunchTarget(undefined), false);
    assert.equal(isCredentialFreeLaunchTarget(null), false);
    assert.equal(isCredentialFreeLaunchTarget(''), false);
  });

  it('the start URL carries nothing at all', () => {
    const url = wbtSsoStartUrl();
    assert.equal(url, `${WBT_SCHEME}://${WBT_SSO_START_HOST}`);
    assert.ok(!url.includes('?'), 'no query string');
    for (const bad of ['hash', 'name', 'companyId', 'passcode', 'token', 'driver']) {
      assert.ok(!url.toLowerCase().includes(bad), `start URL leaked ${bad}`);
    }
  });

  it('the real hook returns before ever building SSO params for WB-T', () => {
    const hook = strip(read('hooks/useAppLauncher.ts'));
    const guardAt = hook.indexOf('isCredentialFreeLaunchTarget(options.scheme)');
    const ssoAt = hook.indexOf('hash: user.passcodeHash');
    assert.ok(guardAt > -1, 'the guard exists');
    assert.ok(ssoAt > -1, 'the legacy sso construction still exists for other apps');
    assert.ok(guardAt < ssoAt,
      'the WB-T guard must return BEFORE the passcode hash is ever assembled');
    // Widened for the handoff overlay: the guard's body now arms the visual
    // overlay and commits a frame before launching, but the PROPERTY is
    // unchanged — the branch still launches credential-free (sso: undefined,
    // start host) and still returns before any legacy param is assembled
    // (asserted positionally above). The bounded gap tolerates the overlay
    // block; a change that reordered the launch out of the guard would
    // still fail here.
    assert.match(hook, /isCredentialFreeLaunchTarget\(options\.scheme\)\)\s*\{[\s\S]{0,900}return await launchWBApp\(\{ \.\.\.options, sso: undefined, startHost: WBT_SSO_START_HOST \}\)/);
  });

  it('launchWBApp builds a bare start route when startHost is set', () => {
    const launcher = strip(read('services/appLauncher.ts'));
    assert.match(launcher, /let url = startHost \? `\$\{scheme\}:\/\/\$\{startHost\}` : `\$\{scheme\}:\/\/`;/);
    // The SSO branch that appends params must still be gated on `sso`.
    assert.match(launcher, /if \(sso\) \{[\s\S]{0,600}URLSearchParams/);
  });
});

describe('the other three apps are unchanged', () => {
  const hook = strip(read('hooks/useAppLauncher.ts'));
  const launcher = strip(read('services/appLauncher.ts'));

  it('still assembles the full legacy parameter set', () => {
    for (const key of ['hash', 'name', 'companyId', 'truck', 'trailer', 'packageId', 'shiftStartTime', 'shiftId']) {
      assert.ok(
        new RegExp(`\\b${key}\\b`).test(hook) || new RegExp(`\\b${key}\\b`).test(launcher),
        `legacy SSO parameter '${key}' disappeared — that would break WB-M/JSA/eQuipment`,
      );
    }
  });

  it('still builds the legacy login URL for them', () => {
    assert.match(launcher, /url = `\$\{scheme\}:\/\/login\?\$\{params\.toString\(\)\}`/);
  });

  it('still tracks SSO launches for cascade logout', () => {
    assert.match(launcher, /if \(sso\) await trackSSOApp\(scheme\)/);
  });

  it('the debt inventory names exactly the three unmigrated apps', () => {
    assert.equal(LEGACY_HASH_SSO_DEBT.length, 3);
    assert.deepEqual(
      LEGACY_HASH_SSO_DEBT.map((d) => d.app).sort(),
      ['WB JSA', 'WB Mobile', 'WB eQuipment'],
    );
    for (const entry of LEGACY_HASH_SSO_DEBT) {
      assert.ok(entry.transports.includes('hash'), `${entry.app} must record the hash transport`);
      assert.ok(entry.migration.length > 0, `${entry.app} must record its migration path`);
      assert.ok(Object.isFrozen(entry));
    }
  });

  it('the inventory is frozen so the debt cannot silently shrink', () => {
    assert.ok(Object.isFrozen(LEGACY_HASH_SSO_DEBT));
  });
});

describe('no shared-helper refactor removed their parameters', () => {
  it('exactly one launch path builds the credential URL', () => {
    const launcher = strip(read('services/appLauncher.ts'));
    assert.equal((launcher.match(/URLSearchParams/g) || []).length, 1,
      'more than one param builder means a refactor split the behavior');
  });

  it('the policy module itself carries no credential logic', () => {
    const policy = strip(read('services/ssoLaunchPolicy.ts'));
    assert.ok(!/passcodeHash|driverHash|getItemAsync|SecureStore/.test(policy));
  });
});
