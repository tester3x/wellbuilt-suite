/**
 * vc51.9J — WB-S SSO authorization gates and identity-transition matrix.
 *
 * Run: npm run test:sso
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createSsoAuthorizationHandler,
  type SsoAuthorizationOps,
} from './ssoAuthorizationCore.js';
import {
  SSO_AUDIENCE_WBT,
  SSO_PROTOCOL_VERSION,
  SSO_CALLBACK_SUCCESS_KEYS,
  SSO_CALLBACK_ERROR_KEYS,
  containsForbiddenSsoField,
  hasOnlyKeys,
} from './ssoProtocol.generated.js';

const CHALLENGE = 'C'.repeat(43);
const STATE = 'S'.repeat(43);
const request = (over: Record<string, unknown> = {}) => ({
  protocolVersion: SSO_PROTOCOL_VERSION,
  audience: SSO_AUDIENCE_WBT,
  codeChallenge: CHALLENGE,
  codeChallengeMethod: 'S256',
  state: STATE,
  ...over,
});

interface World {
  local: { driverId: string; companyId: string } | null;
  reconciliation: 'local-only' | 'verifying' | 'verified' | 'rejected' | 'unavailable';
  verified: { uid: string; kind: string | null; driverId: string | null; companyId: string | null } | null;
  claimsThrow: boolean;
  codeThrows: boolean;
  epoch: number;
  requests: unknown[];
  /** Runs while the code request is in flight — used to simulate logout. */
  duringIssuance: (() => void) | null;
}

function harness(over: Partial<World> = {}) {
  const w: World = {
    local: { driverId: 'driver-1', companyId: 'co-1' },
    reconciliation: 'verified',
    verified: { uid: 'driver_abc', kind: 'driver', driverId: 'driver-1', companyId: 'co-1' },
    claimsThrow: false,
    codeThrows: false,
    epoch: 1,
    requests: [],
    duringIssuance: null,
    ...over,
  };
  const ops: SsoAuthorizationOps = {
    getLocalIdentity: async () => w.local,
    getReconciliationState: () => w.reconciliation,
    getVerifiedIdentity: async () => {
      if (w.claimsThrow) throw new Error('offline');
      return w.verified;
    },
    requestCode: async (req) => {
      w.requests.push(req);
      w.duringIssuance?.();
      if (w.codeThrows) throw new Error('server unavailable');
      return { code: 'c'.repeat(43) };
    },
    currentIdentityEpoch: () => w.epoch,
  };
  return { w, handler: createSsoAuthorizationHandler(ops) };
}

describe('WB-S issuance gates', () => {
  it('a verified matching session may issue', async () => {
    const { w, handler } = harness();
    const out = await handler.authorize(request());
    assert.equal(out.callback.status, 'success');
    assert.equal(w.requests.length, 1);
    if (out.callback.status === 'success') {
      assert.equal(out.callback.state, STATE, 'state is echoed so WB-T can match');
      assert.match(out.callback.code, /^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('local-only cannot issue, and never reaches the server', async () => {
    const { w, handler } = harness({ reconciliation: 'local-only' });
    const out = await handler.authorize(request());
    assert.equal(out.callback.status, 'error');
    if (out.callback.status === 'error') assert.equal(out.callback.errorCode, 'not_authorized');
    assert.equal(w.requests.length, 0, 'a local-only session must not be silently upgraded');
  });

  it('offline reconciliation reports unavailable, not rejection', async () => {
    for (const state of ['unavailable', 'verifying'] as const) {
      const { w, handler } = harness({ reconciliation: state });
      const out = await handler.authorize(request());
      assert.equal(out.callback.status, 'error');
      if (out.callback.status === 'error') {
        assert.equal(out.callback.errorCode, 'unavailable',
          'WB-T must be told to offer manual login, not that access was denied');
      }
      assert.equal(w.requests.length, 0);
    }
  });

  it('a rejected reconciliation cannot issue', async () => {
    const { w, handler } = harness({ reconciliation: 'rejected' });
    const out = await handler.authorize(request());
    assert.equal(out.callback.status, 'error');
    assert.equal(w.requests.length, 0);
  });

  it('no local identity cannot issue', async () => {
    const { w, handler } = harness({ local: null });
    const out = await handler.authorize(request());
    assert.equal(out.callback.status, 'error');
    assert.equal(w.requests.length, 0);
  });

  it('no owned session cannot issue', async () => {
    const { w, handler } = harness({ verified: null });
    const out = await handler.authorize(request());
    assert.equal(out.callback.status, 'error');
    assert.equal(w.requests.length, 0);
  });

  it('unreadable claims report unavailable', async () => {
    const { w, handler } = harness({ claimsThrow: true });
    const out = await handler.authorize(request());
    assert.equal(out.callback.status, 'error');
    if (out.callback.status === 'error') assert.equal(out.callback.errorCode, 'unavailable');
    assert.equal(w.requests.length, 0);
  });

  it('a non-driver session cannot issue', async () => {
    const { w, handler } = harness({
      verified: { uid: 'u', kind: 'admin', driverId: 'driver-1', companyId: 'co-1' },
    });
    const out = await handler.authorize(request());
    assert.equal(out.callback.status, 'error');
    assert.equal(w.requests.length, 0);
  });

  it('incomplete claims cannot issue', async () => {
    for (const verified of [
      { uid: 'u', kind: 'driver', driverId: null, companyId: 'co-1' },
      { uid: 'u', kind: 'driver', driverId: 'driver-1', companyId: null },
    ]) {
      const { w, handler } = harness({ verified });
      const out = await handler.authorize(request());
      assert.equal(out.callback.status, 'error');
      assert.equal(w.requests.length, 0);
    }
  });

  it('SDK/local identity mismatch is rejected', async () => {
    const { w, handler } = harness({
      verified: { uid: 'u', kind: 'driver', driverId: 'driver-OTHER', companyId: 'co-1' },
    });
    const out = await handler.authorize(request());
    assert.equal(out.callback.status, 'error');
    if (out.callback.status === 'error') assert.equal(out.callback.errorCode, 'not_authorized');
    assert.equal(w.requests.length, 0, 'a drifted identity must never be bridged');
  });

  it('company mismatch is rejected', async () => {
    const { w, handler } = harness({
      verified: { uid: 'u', kind: 'driver', driverId: 'driver-1', companyId: 'co-OTHER' },
    });
    const out = await handler.authorize(request());
    assert.equal(out.callback.status, 'error');
    assert.equal(w.requests.length, 0);
  });
});

describe('protocol rejection', () => {
  it('rejects a foreign audience', async () => {
    const { w, handler } = harness();
    const out = await handler.authorize(request({ audience: 'attacker-app' }));
    assert.equal(out.callback.status, 'error');
    if (out.callback.status === 'error') assert.equal(out.callback.errorCode, 'unsupported_audience');
    assert.equal(w.requests.length, 0);
  });

  it('rejects plain PKCE and an unsupported version', async () => {
    for (const over of [{ codeChallengeMethod: 'plain' }, { protocolVersion: 2 }]) {
      const { w, handler } = harness();
      const out = await handler.authorize(request(over));
      assert.equal(out.callback.status, 'error');
      assert.equal(w.requests.length, 0);
    }
  });

  it('rejects a malformed challenge or state', async () => {
    for (const over of [{ codeChallenge: 'short' }, { state: '' }]) {
      const { w, handler } = harness();
      const out = await handler.authorize(request(over));
      assert.equal(out.callback.status, 'error');
      assert.equal(w.requests.length, 0);
    }
  });

  it('IGNORES an injected redirect destination entirely', async () => {
    const { w, handler } = harness();
    const out = await handler.authorize(request({
      redirectUri: 'evil://steal',
      callbackUrl: 'https://attacker.example/collect',
      returnTo: 'evil://steal',
    }));
    // The request is otherwise valid, so it succeeds — and the callback
    // carries no destination at all, because the destination is a
    // protocol constant rather than a field.
    assert.equal(out.callback.status, 'success');
    assert.ok(hasOnlyKeys(out.callback, SSO_CALLBACK_SUCCESS_KEYS),
      'no redirect field can survive into the callback');
    assert.ok(!JSON.stringify(out.callback).includes('evil'));
    assert.ok(!JSON.stringify(w.requests).includes('evil'),
      'no redirect reaches the server either');
  });
});

describe('identity transition during issuance', () => {
  it('a logout mid-issuance invalidates the authorization', async () => {
    const { w, handler } = harness();
    w.duringIssuance = () => { w.epoch += 1; };
    const out = await handler.authorize(request());
    assert.equal(out.callback.status, 'error');
    if (out.callback.status === 'error') {
      assert.equal(out.callback.errorCode, 'superseded',
        'the code must not be handed to WB-T for the driver who just left');
    }
  });

  it('a driver switch mid-issuance invalidates the authorization', async () => {
    const { w, handler } = harness();
    w.duringIssuance = () => {
      w.epoch += 1;
      w.local = { driverId: 'driver-2', companyId: 'co-1' };
    };
    const out = await handler.authorize(request());
    assert.equal(out.callback.status, 'error');
    if (out.callback.status === 'error') assert.equal(out.callback.errorCode, 'superseded');
  });

  it('a stable identity through issuance succeeds', async () => {
    const { handler } = harness();
    const out = await handler.authorize(request());
    assert.equal(out.callback.status, 'success');
  });

  it('a failed code request reports unavailable', async () => {
    const { handler } = harness({ codeThrows: true });
    const out = await handler.authorize(request());
    assert.equal(out.callback.status, 'error');
    if (out.callback.status === 'error') assert.equal(out.callback.errorCode, 'unavailable');
  });
});

describe('callback payload census', () => {
  it('a success callback carries only code, state, status, version', async () => {
    const { handler } = harness();
    const out = await handler.authorize(request());
    assert.ok(hasOnlyKeys(out.callback, SSO_CALLBACK_SUCCESS_KEYS));
    assert.ok(!containsForbiddenSsoField(out.callback));
  });

  it('an error callback carries only the permitted fields', async () => {
    const { handler } = harness({ reconciliation: 'local-only' });
    const out = await handler.authorize(request());
    assert.ok(hasOnlyKeys(out.callback, SSO_CALLBACK_ERROR_KEYS));
    assert.ok(!containsForbiddenSsoField(out.callback));
  });

  it('no callback ever carries a token, passcode, hash, or verifier', async () => {
    const worlds: Array<Partial<World>> = [
      {},
      { reconciliation: 'local-only' },
      { reconciliation: 'unavailable' },
      { local: null },
      { verified: null },
      { claimsThrow: true },
      { codeThrows: true },
    ];
    for (const over of worlds) {
      const { handler } = harness(over);
      const out = await handler.authorize(request());
      const s = JSON.stringify(out.callback).toLowerCase();
      for (const forbidden of ['idtoken', 'refreshtoken', 'customtoken', 'passcode', 'hash', 'verifier']) {
        assert.ok(!s.includes(forbidden), `callback leaked ${forbidden}`);
      }
    }
  });

  it('the internal reason is never part of the callback', async () => {
    const { handler } = harness({ verified: null });
    const out = await handler.authorize(request());
    assert.ok(out.internalReason, 'an operator-facing reason exists');
    assert.ok(!JSON.stringify(out.callback).includes(out.internalReason!),
      'but it is not transmitted');
  });

  it('a malformed request yields no state (there was none to echo)', async () => {
    const { handler } = harness();
    const out = await handler.authorize(null);
    assert.equal(out.callback.status, 'error');
    if (out.callback.status === 'error') assert.equal(out.callback.state, undefined);
  });
});
