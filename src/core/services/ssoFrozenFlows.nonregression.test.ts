/**
 * Non-regression pins for the frozen Suite → WB-T / JSA / eQuipment SSO
 * surfaces. Added before any WB-M audience work.
 *
 * If a pin fails, stop. Do not "fix" it by rewriting the frozen flow.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  SSO_AUDIENCE_EQUIPMENT,
  SSO_AUDIENCE_JSA,
  SSO_AUDIENCE_WBT,
  SSO_AUDIENCE_WBM,
  SSO_AUDIENCES,
  SSO_CALLBACK_BY_AUDIENCE,
  SSO_CALLBACK_HOST,
  SSO_CALLBACK_SCHEME,
  SSO_CALLBACK_SCHEME_EQUIPMENT,
  SSO_CALLBACK_SCHEME_JSA,
  SSO_CALLBACK_SCHEME_WBM,
  audienceCarriesDisplayName,
  audienceCarriesJsaBinding,
  audienceRequiresShiftBinding,
  isSsoAudience,
} from './ssoProtocol.generated';
import {
  isCredentialFreeLaunchTarget,
  LEGACY_HASH_SSO_DEBT,
  WBM_SCHEME,
  WBT_SCHEME,
  WBT_SSO_START_HOST,
  wbmSsoStartUrl,
  wbtSsoStartUrl,
} from './ssoLaunchPolicy';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('frozen Suite → WB-T automatic PKCE launch', () => {
  it('still uses wellbuilt-tickets://sso-start with no query', () => {
    assert.equal(wbtSsoStartUrl(), 'wellbuilt-tickets://sso-start');
    assert.equal(WBT_SCHEME, 'wellbuilt-tickets');
    assert.equal(WBT_SSO_START_HOST, 'sso-start');
    assert.ok(!wbtSsoStartUrl().includes('?'));
  });

  it('WB-T remains a credential-free launch target', () => {
    assert.equal(isCredentialFreeLaunchTarget('wellbuilt-tickets'), true);
    assert.equal(isCredentialFreeLaunchTarget('WELLBUILT-TICKETS'), true);
  });

  it('the launcher hook still arms the tickets audience and sso-start for WB-T', () => {
    const hook = read('hooks/useAppLauncher.ts');
    assert.match(hook, /isCredentialFreeLaunchTarget\(options\.scheme\)/);
    assert.match(hook, /SSO_AUDIENCE_WBT/);
    assert.match(hook, /WBT_SSO_START_HOST/);
    assert.match(hook, /sso: undefined/);
  });
});

describe('frozen JSA audience / return / no client shiftBinding', () => {
  it('allowlists wellbuilt-jsa and the jsaapp callback', () => {
    assert.equal(SSO_AUDIENCE_JSA, 'wellbuilt-jsa');
    assert.equal(isSsoAudience(SSO_AUDIENCE_JSA), true);
    assert.equal(SSO_CALLBACK_BY_AUDIENCE[SSO_AUDIENCE_JSA].scheme, SSO_CALLBACK_SCHEME_JSA);
    assert.equal(SSO_CALLBACK_BY_AUDIENCE[SSO_AUDIENCE_JSA].host, SSO_CALLBACK_HOST);
    assert.equal(SSO_CALLBACK_SCHEME_JSA, 'jsaapp');
  });

  it('JSA does not take a client shiftBinding and carries a server JSA binding', () => {
    assert.equal(audienceRequiresShiftBinding(SSO_AUDIENCE_JSA), false);
    assert.equal(audienceCarriesJsaBinding(SSO_AUDIENCE_JSA), true);
    assert.equal(audienceCarriesDisplayName(SSO_AUDIENCE_JSA), true);
  });

  it('JSA launch/return contracts still forbid credential keys', () => {
    const launch = readFileSync(
      join(SRC, '..', '..', '..', 'JSA', 'services', 'sso', 'jsaLaunch.ts'),
      'utf8',
    );
    assert.match(launch, /JSA_LAUNCH_SCHEME = 'jsaapp'/);
    assert.match(launch, /JSA_RETURN_SCHEME = 'wellbuilt-tickets'/);
    assert.match(launch, /JSA_RETURN_HOST = 'jsa-return'/);
    assert.match(launch, /passcodeHash/);
    assert.match(launch, /codeVerifier/);
  });
});

describe('frozen eQuipment DVIR shift-binding', () => {
  it('equipment still requires server-validated shiftBinding', () => {
    assert.equal(SSO_AUDIENCE_EQUIPMENT, 'wellbuilt-equipment');
    assert.equal(audienceRequiresShiftBinding(SSO_AUDIENCE_EQUIPMENT), true);
    assert.equal(SSO_CALLBACK_BY_AUDIENCE[SSO_AUDIENCE_EQUIPMENT].scheme, SSO_CALLBACK_SCHEME_EQUIPMENT);
    assert.equal(SSO_CALLBACK_SCHEME_EQUIPMENT, 'wbequipment');
  });

  it('tickets callback scheme is unchanged', () => {
    assert.equal(SSO_CALLBACK_SCHEME, 'wellbuilt-tickets');
    assert.equal(SSO_CALLBACK_BY_AUDIENCE[SSO_AUDIENCE_WBT].host, 'sso-callback');
  });
});

describe('frozen hash-debt apps that this packet must not migrate', () => {
  it('JSA and eQuipment remain on the hash-debt inventory', () => {
    const apps = LEGACY_HASH_SSO_DEBT.map((d) => d.app);
    assert.ok(apps.includes('WB JSA'));
    assert.ok(apps.includes('WB eQuipment'));
    for (const row of LEGACY_HASH_SSO_DEBT) {
      if (row.app === 'WB JSA' || row.app === 'WB eQuipment') {
        assert.ok(row.transports.includes('hash'));
        assert.equal(isCredentialFreeLaunchTarget(row.scheme), false);
      }
    }
  });
});

describe('frozen shared callable names', () => {
  it('Suite still issues through ssoIssueAuthorizationCode', () => {
    const client = read('services/ssoIssuanceClient.ts');
    assert.match(client, /SSO_ISSUE_CALLABLE = 'ssoIssueAuthorizationCode'/);
  });

  it('prior audiences remain, then additive wellbuilt-mobile is the fourth', () => {
    // Additive only: tickets, equipment, and JSA stay first and unchanged.
    assert.equal(SSO_AUDIENCES.length, 4);
    assert.equal(SSO_AUDIENCES[0], SSO_AUDIENCE_WBT);
    assert.equal(SSO_AUDIENCES[1], SSO_AUDIENCE_EQUIPMENT);
    assert.equal(SSO_AUDIENCES[2], SSO_AUDIENCE_JSA);
    assert.equal(SSO_AUDIENCES[3], SSO_AUDIENCE_WBM);
    assert.equal(SSO_AUDIENCE_WBM, 'wellbuilt-mobile');
    assert.equal(isSsoAudience(SSO_AUDIENCE_WBM), true);
    assert.equal(audienceRequiresShiftBinding(SSO_AUDIENCE_WBM), false);
    assert.equal(audienceCarriesJsaBinding(SSO_AUDIENCE_WBM), false);
    assert.equal(audienceCarriesDisplayName(SSO_AUDIENCE_WBM), true);
    assert.equal(SSO_CALLBACK_BY_AUDIENCE[SSO_AUDIENCE_WBM].scheme, SSO_CALLBACK_SCHEME_WBM);
    assert.equal(SSO_CALLBACK_SCHEME_WBM, 'wellbuiltmobile');
    assert.equal(wbmSsoStartUrl(), `${WBM_SCHEME}://sso-start`);
    assert.equal(isCredentialFreeLaunchTarget(WBM_SCHEME), true);
    for (const aud of [SSO_AUDIENCE_WBT, SSO_AUDIENCE_EQUIPMENT, SSO_AUDIENCE_JSA]) {
      assert.equal(isSsoAudience(aud), true);
      assert.ok(SSO_AUDIENCES.includes(aud));
    }
  });
});
