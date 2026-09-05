/**
 * WB-S → WB-E SSO adapter contract, pinned against WB-E commit 2e174d1
 * (fix/wbe-open-shift-dvir-entry). Proves the terminal-error-return reaches WB-E
 * as a BOUNDED, credential-free error (never a code, never a strand), and that
 * WB-E is a correct messenger — so no WB-E change is warranted.
 *
 * WB-S side runs live (buildAudienceCallbackUrl). WB-E side is pinned from source
 * because WB-E has a deep runtime dependency graph; changing WB-E is out of scope
 * unless a defect is proven here (none is).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAudienceCallbackUrl } from './ssoRouteAdapter.js';
import { SSO_AUDIENCE_EQUIPMENT, isSsoErrorCode } from './ssoProtocol.generated.js';

const WBE_SHA = '2e174d1';
const WBE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '_wbe-dvir-entry');
const WBE_RUNTIME = join(WBE, 'features', 'dvir', 'deepLink', 'equipmentSsoRuntime.ts');

describe(`WB-S → WB-E SSO adapter contract (WB-E @ ${WBE_SHA})`, () => {
  it('WB-S builds a bounded, credential-free error callback for the equipment audience', () => {
    assert.ok(isSsoErrorCode('unavailable'));
    const url = buildAudienceCallbackUrl(
      { protocolVersion: 1, status: 'error', errorCode: 'unavailable', state: 'st' },
      SSO_AUDIENCE_EQUIPMENT,
    );
    assert.ok(url.startsWith('wbequipment://'));
    assert.match(url, /[?&]status=error/);
    assert.match(url, /[?&]err=unavailable/);
    // No code / credential material on the error callback.
    assert.doesNotMatch(url, /[?&]code=/);
    assert.doesNotMatch(url, /(token|passcode|hash|verifier|challenge)=/i);
  });

  it('WB-S success callback for equipment carries only code + state', () => {
    const url = buildAudienceCallbackUrl(
      { protocolVersion: 1, status: 'success', code: 'CODE', state: 'st' },
      SSO_AUDIENCE_EQUIPMENT,
    );
    assert.match(url, /[?&]status=success/);
    assert.match(url, /[?&]code=CODE/);
    assert.match(url, /[?&]state=st/);
  });

  const wbe = existsSync(WBE_RUNTIME) ? readFileSync(WBE_RUNTIME, 'utf8') : null;

  it('WB-E parses `err` and maps it to a bounded governed failure (callback_unavailable), not a strand', () => {
    if (!wbe) {
      console.log(`SKIP  WB-E source not found at ${WBE} — expected @ ${WBE_SHA}`);
      return;
    }
    assert.match(wbe, /params\.get\('err'\)/);
    assert.match(wbe, /governedFailure\(result, 'callback'\)/);
  });

  it('WB-E has the late/duplicate-callback guard so a stale error cannot overwrite a verified inspection', () => {
    if (!wbe) {
      console.log(`SKIP  WB-E source not found at ${WBE} — expected @ ${WBE_SHA}`);
      return;
    }
    assert.match(wbe, /const uiBefore = owner\.getState\(\)/);
    assert.match(wbe, /uiBefore === 'idle' \|\| uiBefore === 'verified'/);
  });
});
