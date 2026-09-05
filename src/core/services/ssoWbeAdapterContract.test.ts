/**
 * WB-S → WB-E executable adapter contract.
 *
 * Requires an isolated WB-E checkout whose HEAD matches WBE_SHA.
 * Missing sibling or SHA mismatch FAILS (never SKIP-pass).
 *
 * Run: npm run test:sso-wbe
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { buildAudienceCallbackUrl } from './ssoRouteAdapter.js';
import {
  SSO_AUDIENCE_EQUIPMENT,
  SSO_PROTOCOL_VERSION,
  isSsoErrorCode,
} from './ssoProtocol.generated.js';

export const WBE_SHA = '2e174d1909d6312561b0f288ad03c17a41da3816';

const WBE = process.env.SSO_E2E_WBE
  || join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '_audit_p0_handoff', 'wbe-2e174d1');

function requireWbe(): string {
  if (!existsSync(join(WBE, 'features', 'dvir', 'deepLink', 'equipmentSsoAttempt.ts'))) {
    throw new Error(`WB-E sibling missing at ${WBE} — required @ ${WBE_SHA}`);
  }
  const head = execFileSync('git', ['-C', WBE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== WBE_SHA) {
    throw new Error(`WB-E HEAD ${head} !== required ${WBE_SHA}`);
  }
  return WBE;
}

function parseCallbackQuery(url: string): Record<string, unknown> {
  // Production mapping from equipmentSsoRuntime.handleEquipmentSsoCallback.
  const qAt = url.indexOf('?');
  if (qAt < 0) throw new Error('callback_missing_query');
  const params = new URLSearchParams(url.slice(qAt + 1));
  const status = params.get('status');
  const version = Number(params.get('v'));
  if (status === 'success') {
    return {
      protocolVersion: version,
      status: 'success',
      code: params.get('code'),
      state: params.get('state'),
    };
  }
  return {
    protocolVersion: version,
    status: 'error',
    errorCode: params.get('err'),
    state: params.get('state') || undefined,
  };
}

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

  it('live WB-E attempt owner maps a terminal unavailable callback to callback_unavailable without stranding', async () => {
    const root = requireWbe();
    const attemptMod = await import(
      pathToFileURL(join(root, 'features', 'dvir', 'deepLink', 'equipmentSsoAttempt.ts')).href
    );
    const copyMod = await import(
      pathToFileURL(join(root, 'features', 'dvir', 'deepLink', 'governedErrorCopy.ts')).href
    );
    const storeMod = await import(
      pathToFileURL(join(root, 'features', 'dvir', 'deepLink', 'equipmentPendingAttemptStore.ts')).href
    );
    const kv = new Map<string, string>();
    storeMod.setPendingAttemptKv({
      getItem: async (k: string) => kv.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        kv.set(k, v);
      },
      removeItem: async (k: string) => {
        kv.delete(k);
      },
    });
    await storeMod.__resetPendingAttemptForTests();
    storeMod.setPendingAttemptKv({
      getItem: async (k: string) => kv.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        kv.set(k, v);
      },
      removeItem: async (k: string) => {
        kv.delete(k);
      },
    });

    const owner = attemptMod.createEquipmentSsoAttempt({
      nowMs: () => Date.now(),
      randomBytes: async (n: number) => new Uint8Array(n).fill(7),
      sha256Hex: async (s: string) => {
        const { createHash } = await import('node:crypto');
        return createHash('sha256').update(s, 'utf8').digest('hex');
      },
      openAuthorization: async () => {},
      exchange: async () => {
        throw new Error('exchange must not run on error callback');
      },
      signInWithCustomToken: async () => {
        throw new Error('sign-in must not run on error callback');
      },
      getSdkUid: async () => null,
      signOut: async () => {},
    });
    await owner.begin({ shiftId: '2026-09-05_070000', phase: 'pre_trip' });
    assert.equal(owner.getState(), 'awaiting-authorization');

    const url = buildAudienceCallbackUrl(
      {
        protocolVersion: SSO_PROTOCOL_VERSION,
        status: 'error',
        errorCode: 'unavailable',
        state: 'st',
      },
      SSO_AUDIENCE_EQUIPMENT,
    );
    const raw = parseCallbackQuery(url);
    const result = await owner.handleCallback(raw);
    assert.equal(result.errorCode, 'unavailable');
    const reason = copyMod.formatGovernedFailureReason('callback', result.state, result.errorCode);
    assert.equal(reason, 'callback_unavailable');
    assert.notEqual(owner.getState(), 'idle');
  });

  it('duplicate/late error callback does not strand or re-exchange', async () => {
    const root = requireWbe();
    const attemptMod = await import(
      pathToFileURL(join(root, 'features', 'dvir', 'deepLink', 'equipmentSsoAttempt.ts')).href
    );
    const storeMod = await import(
      pathToFileURL(join(root, 'features', 'dvir', 'deepLink', 'equipmentPendingAttemptStore.ts')).href
    );
    const kv = new Map<string, string>();
    const store = {
      getItem: async (k: string) => kv.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        kv.set(k, v);
      },
      removeItem: async (k: string) => {
        kv.delete(k);
      },
    };
    storeMod.setPendingAttemptKv(store);
    await storeMod.__resetPendingAttemptForTests();
    storeMod.setPendingAttemptKv(store);
    const owner = attemptMod.createEquipmentSsoAttempt({
      nowMs: () => Date.now(),
      randomBytes: async (n: number) => new Uint8Array(n).fill(3),
      sha256Hex: async (s: string) => {
        const { createHash } = await import('node:crypto');
        return createHash('sha256').update(s, 'utf8').digest('hex');
      },
      openAuthorization: async () => {},
      exchange: async () => {
        throw new Error('no exchange');
      },
      signInWithCustomToken: async () => {},
      getSdkUid: async () => null,
      signOut: async () => {},
    });
    await owner.begin({ shiftId: 's1', phase: 'pre_trip' });
    const raw = {
      protocolVersion: SSO_PROTOCOL_VERSION,
      status: 'error',
      errorCode: 'not_authorized',
      state: 'st',
    };
    const first = await owner.handleCallback(raw);
    assert.equal(first.errorCode, 'not_authorized');
    const second = await owner.handleCallback(raw);
    assert.ok(second.errorCode === 'not_authorized' || second.errorCode === 'invalid_grant');
    assert.ok(owner.getState() === 'governed_error' || owner.getState() === 'rejected');
  });
});
