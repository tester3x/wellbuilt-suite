/**
 * Suite JSA audience adapter — accept wellbuilt-jsa, issue via the
 * existing authorize route, deliver only jsaapp://sso-callback.
 *
 * Tickets/eQuipment callback schemes must stay unchanged.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSsoRouteAdapter } from './ssoRouteAdapter.js';
import {
  createSsoIssuanceClient,
  SsoIssuanceError,
} from './ssoIssuanceClient.js';
import { createSsoAuthorizationHandler } from './ssoAuthorizationCore.js';
import {
  SSO_AUDIENCE_EQUIPMENT,
  SSO_AUDIENCE_JSA,
  SSO_AUDIENCE_WBT,
  SSO_CALLBACK_BY_AUDIENCE,
  SSO_CALLBACK_ERROR_KEYS,
  SSO_CALLBACK_SCHEME_JSA,
  SSO_CALLBACK_SUCCESS_KEYS,
  SSO_PROTOCOL_VERSION,
  buildSsoAuthorizationUrl,
  containsForbiddenSsoField,
  hasOnlyKeys,
  isSsoAudience,
} from './ssoProtocol.generated.js';
import { buildAudienceCallbackUrl } from './ssoRouteAdapter.js';

const CHALLENGE = 'C'.repeat(43);
const STATE = 'S'.repeat(43);
const CODE = 'c'.repeat(43);

describe('Suite JSA audience', () => {
  it('allowlists wellbuilt-jsa and pins the JSA callback route', () => {
    assert.equal(isSsoAudience(SSO_AUDIENCE_JSA), true);
    assert.equal(SSO_CALLBACK_BY_AUDIENCE[SSO_AUDIENCE_JSA].scheme, SSO_CALLBACK_SCHEME_JSA);
    assert.equal(SSO_CALLBACK_BY_AUDIENCE[SSO_AUDIENCE_JSA].host, 'sso-callback');
    assert.equal(SSO_CALLBACK_BY_AUDIENCE[SSO_AUDIENCE_WBT].scheme, 'wellbuilt-tickets');
    assert.equal(SSO_CALLBACK_BY_AUDIENCE[SSO_AUDIENCE_EQUIPMENT].scheme, 'wbequipment');
  });

  it('success callback is only jsaapp://sso-callback with non-secret keys', () => {
    const url = buildAudienceCallbackUrl({
      protocolVersion: SSO_PROTOCOL_VERSION,
      status: 'success',
      code: CODE,
      state: STATE,
    }, SSO_AUDIENCE_JSA);
    assert.match(url, /^jsaapp:\/\/sso-callback\?/);
    assert.ok(!/hash=|name=|shiftId=|codeVerifier=|customToken=/.test(url));
    const cb = { protocolVersion: SSO_PROTOCOL_VERSION, status: 'success' as const, code: CODE, state: STATE };
    assert.equal(containsForbiddenSsoField(cb), false);
    assert.ok(hasOnlyKeys(cb, SSO_CALLBACK_SUCCESS_KEYS));
  });

  it('error callback stays on the JSA scheme and carries no secrets', () => {
    const url = buildAudienceCallbackUrl({
      protocolVersion: SSO_PROTOCOL_VERSION,
      status: 'error',
      errorCode: 'not_authorized',
      state: STATE,
    }, SSO_AUDIENCE_JSA);
    assert.match(url, /^jsaapp:\/\/sso-callback\?/);
    assert.match(url, /err=not_authorized/);
    assert.ok(hasOnlyKeys({
      protocolVersion: SSO_PROTOCOL_VERSION,
      status: 'error',
      errorCode: 'not_authorized',
      state: STATE,
    }, SSO_CALLBACK_ERROR_KEYS));
  });

  it('issuance client refuses a client-proposed JSA shiftBinding', async () => {
    const client = createSsoIssuanceClient(async () => {
      throw new Error('must not reach transport');
    });
    await assert.rejects(
      () => client.requestCode({
        protocolVersion: SSO_PROTOCOL_VERSION,
        audience: SSO_AUDIENCE_JSA,
        codeChallenge: CHALLENGE,
        codeChallengeMethod: 'S256',
        shiftBinding: { shiftId: '2026-08-12_182535', phase: 'pre_trip' },
      }),
      (err: unknown) => err instanceof SsoIssuanceError && err.failure === 'malformed_request',
    );
  });

  it('issuance client sends JSA without shiftBinding', async () => {
    let payload: Record<string, unknown> | null = null;
    const client = createSsoIssuanceClient(async (_name, body) => {
      payload = body;
      return { protocolVersion: SSO_PROTOCOL_VERSION, code: CODE, expiresInSeconds: 120 };
    });
    const out = await client.requestCode({
      protocolVersion: SSO_PROTOCOL_VERSION,
      audience: SSO_AUDIENCE_JSA,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    });
    assert.equal(out.code, CODE);
    assert.equal(payload!.audience, SSO_AUDIENCE_JSA);
    assert.equal(payload!.shiftBinding, undefined);
  });

  it('route adapter opens the JSA callback, not tickets', async () => {
    const opened: string[] = [];
    const adapter = createSsoRouteAdapter({
      authorize: async () => ({
        callback: {
          protocolVersion: SSO_PROTOCOL_VERSION,
          status: 'success',
          code: CODE,
          state: STATE,
        },
        internalReason: 'jsa_issued',
        audience: SSO_AUDIENCE_JSA,
      }),
      openUrl: async (url) => { opened.push(url); },
      currentEpoch: () => 1,
      log: () => {},
    });
    const url = buildSsoAuthorizationUrl({
      protocolVersion: SSO_PROTOCOL_VERSION,
      audience: SSO_AUDIENCE_JSA,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      state: STATE,
    });
    const result = await adapter.handle(url);
    assert.equal(result.kind, 'answered');
    assert.equal(opened.length, 1);
    assert.match(opened[0], /^jsaapp:\/\/sso-callback\?/);
    assert.ok(!opened[0].startsWith('wellbuilt-tickets://'));
  });

  it('authorization handler issues JSA through the same verified Suite session', async () => {
    const requests: unknown[] = [];
    const handler = createSsoAuthorizationHandler({
      getLocalIdentity: async () => ({ driverId: 'driver-1', companyId: 'co-1' }),
      getReconciliationState: () => 'verified',
      getVerifiedIdentity: async () => ({
        uid: 'driver_abc', kind: 'driver', driverId: 'driver-1', companyId: 'co-1',
      }),
      requestCode: async (req) => { requests.push(req); return { code: CODE }; },
      currentIdentityEpoch: () => 1,
    });
    const out = await handler.authorize({
      protocolVersion: SSO_PROTOCOL_VERSION,
      audience: SSO_AUDIENCE_JSA,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      state: STATE,
    });
    assert.equal(out.callback.status, 'success');
    assert.equal(out.internalReason, 'jsa_issued');
    assert.equal((requests[0] as { shiftBinding?: unknown }).shiftBinding, undefined);
  });
});
