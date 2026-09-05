/**
 * vc51.9J-C2 — WB-S route adapter and issuance client.
 *
 * Run: npm run test:sso
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createSsoRouteAdapter, isSsoAuthorizeUrl } from './ssoRouteAdapter.js';
import {
  createSsoIssuanceClient,
  mapTransportError,
  validateIssueResponse,
  SsoIssuanceError,
  SSO_ISSUE_CALLABLE,
  SSO_ISSUE_TIMEOUT_MS,
} from './ssoIssuanceClient.js';
import {
  SSO_AUDIENCE_WBT,
  SSO_AUTHORIZE_HOST,
  SSO_AUTHORIZE_SCHEME,
  SSO_CALLBACK_HOST,
  SSO_CALLBACK_SCHEME,
  SSO_CALLBACK_SUCCESS_KEYS,
  SSO_CALLBACK_ERROR_KEYS,
  SSO_PROTOCOL_VERSION,
  buildSsoAuthorizationUrl,
  hasOnlyKeys,
  parseSsoCallbackUrl,
} from './ssoProtocol.generated.js';

const CHALLENGE = 'C'.repeat(43);
const STATE = 'S'.repeat(43);
const CODE = 'c'.repeat(43);
const AUTH_URL = buildSsoAuthorizationUrl({
  protocolVersion: SSO_PROTOCOL_VERSION,
  audience: SSO_AUDIENCE_WBT,
  codeChallenge: CHALLENGE,
  codeChallengeMethod: 'S256',
  state: STATE,
});

const flush = () => new Promise<void>((r) => setImmediate(r));

interface World {
  epoch: number;
  opened: string[];
  authorizeCalls: number;
  logs: string[];
  openThrows: boolean;
  gate: Promise<void> | null;
  duringAuthorize: (() => void) | null;
  outcome: 'success' | 'error';
}

function harness(over: Partial<World> = {}) {
  const w: World = {
    epoch: 1, opened: [], authorizeCalls: 0, logs: [],
    openThrows: false, gate: null, duringAuthorize: null, outcome: 'success',
    ...over,
  };
  const adapter = createSsoRouteAdapter({
    authorize: async (request) => {
      w.authorizeCalls += 1;
      if (w.gate) await w.gate;
      w.duringAuthorize?.();
      const state = (request as { state?: string })?.state;
      if (w.outcome === 'error') {
        return {
          callback: { protocolVersion: SSO_PROTOCOL_VERSION, status: 'error', errorCode: 'not_authorized', state },
          internalReason: 'test rejection',
        };
      }
      return {
        callback: { protocolVersion: SSO_PROTOCOL_VERSION, status: 'success', code: CODE, state: state! },
      };
    },
    openUrl: async (url) => {
      if (w.openThrows) throw new Error('WB-T not installed');
      w.opened.push(url);
    },
    currentEpoch: () => w.epoch,
    log: (event, reason) => w.logs.push(`${event}:${reason}`),
  });
  return { w, adapter };
}

describe('WB-S route recognition', () => {
  it('recognizes only the fixed authorization route', () => {
    assert.equal(isSsoAuthorizeUrl(AUTH_URL), true);
    assert.equal(isSsoAuthorizeUrl(`${SSO_AUTHORIZE_SCHEME}://${SSO_AUTHORIZE_HOST}`), true);
  });

  it('rejects wrong scheme, host, prefix, and path', () => {
    assert.equal(isSsoAuthorizeUrl(`evil://${SSO_AUTHORIZE_HOST}?v=1`), false);
    assert.equal(isSsoAuthorizeUrl(`${SSO_AUTHORIZE_SCHEME}://evil?v=1`), false);
    assert.equal(isSsoAuthorizeUrl(`${SSO_AUTHORIZE_SCHEME}://${SSO_AUTHORIZE_HOST}extra`), false);
    assert.equal(isSsoAuthorizeUrl(`${SSO_CALLBACK_SCHEME}://${SSO_CALLBACK_HOST}?v=1`), false);
    assert.equal(isSsoAuthorizeUrl(null), false);
    assert.equal(isSsoAuthorizeUrl('x'.repeat(3000)), false);
  });

  it('leaves non-SSO URLs entirely alone', async () => {
    const { w, adapter } = harness();
    const r = await adapter.handle('wellbuilt-suite://dvir-complete?x=1');
    assert.equal(r.kind, 'not-sso');
    assert.equal(w.authorizeCalls, 0);
    assert.equal(w.opened.length, 0);
  });
});

describe('WB-S cold/warm delivery and duplicates', () => {
  it('answers a valid authorization with the fixed callback', async () => {
    const { w, adapter } = harness();
    const r = await adapter.handle(AUTH_URL);
    assert.deepEqual(r, { kind: 'answered', status: 'success' });
    assert.equal(w.opened.length, 1);
    assert.ok(w.opened[0].startsWith(`${SSO_CALLBACK_SCHEME}://${SSO_CALLBACK_HOST}?`));
  });

  it('duplicate delivery of the same URL issues at most ONE code request', async () => {
    const { w, adapter } = harness();
    await adapter.handle(AUTH_URL);
    const second = await adapter.handle(AUTH_URL);
    assert.equal(second.kind, 'duplicate');
    assert.equal(w.authorizeCalls, 1);
    assert.equal(w.opened.length, 1, 'and only one callback is opened');
  });

  it('concurrent cold+warm delivery still issues once', async () => {
    const { w, adapter } = harness();
    await Promise.all([adapter.handle(AUTH_URL), adapter.handle(AUTH_URL)]);
    assert.equal(w.authorizeCalls, 1);
    assert.equal(w.opened.length, 1);
  });

  it('a DIFFERENT authorization URL while one is pending is refused as busy', async () => {
    const { w, adapter } = harness();
    let release!: () => void;
    (harnessGate as { current: Promise<void> | null }).current = null;
    w.gate = new Promise<void>((r) => { release = r; });
    const first = adapter.handle(AUTH_URL);
    await flush();
    const otherUrl = buildSsoAuthorizationUrl({
      protocolVersion: SSO_PROTOCOL_VERSION, audience: SSO_AUDIENCE_WBT,
      codeChallenge: 'D'.repeat(43), codeChallengeMethod: 'S256', state: 'T'.repeat(43),
    });
    const second = await adapter.handle(otherUrl);
    assert.equal(second.kind, 'busy');
    assert.equal(w.authorizeCalls, 1, 'the second never reached authorization');
    w.gate = null;
    release();
    await first;
    assert.equal(w.opened.length, 1);
  });
});
const harnessGate = { current: null as Promise<void> | null };

describe('WB-S malformed and unsupported routes', () => {
  const cases: Array<[string, string]> = [
    ['malformed query', `${SSO_AUTHORIZE_SCHEME}://${SSO_AUTHORIZE_HOST}?v=1&state=%zz`],
    ['unsupported protocol', `${SSO_AUTHORIZE_SCHEME}://${SSO_AUTHORIZE_HOST}?v=9&aud=${SSO_AUDIENCE_WBT}&cc=${CHALLENGE}&ccm=S256&state=${STATE}`],
    ['plain PKCE', `${SSO_AUTHORIZE_SCHEME}://${SSO_AUTHORIZE_HOST}?v=1&aud=${SSO_AUDIENCE_WBT}&cc=${CHALLENGE}&ccm=plain&state=${STATE}`],
    ['foreign audience', `${SSO_AUTHORIZE_SCHEME}://${SSO_AUTHORIZE_HOST}?v=1&aud=evil&cc=${CHALLENGE}&ccm=S256&state=${STATE}`],
    ['duplicate key', `${AUTH_URL}&state=${'Z'.repeat(43)}`],
    ['no parameters', `${SSO_AUTHORIZE_SCHEME}://${SSO_AUTHORIZE_HOST}`],
  ];

  for (const [name, url] of cases) {
    it(`answers a bounded failure for: ${name}`, async () => {
      const { w, adapter } = harness();
      const r = await adapter.handle(url);
      assert.equal(r.kind, 'answered');
      assert.equal((r as { status: string }).status, 'error');
      assert.equal(w.authorizeCalls, 0, 'a malformed route never reaches authorization');
      const parsed = parseSsoCallbackUrl(w.opened[0]);
      assert.ok(parsed.ok && parsed.value.status === 'error');
    });
  }

  it('an injected redirect parameter never reaches the callback', async () => {
    const { w, adapter } = harness();
    await adapter.handle(`${AUTH_URL}&redirectUri=${encodeURIComponent('evil://steal')}`);
    assert.ok(!w.opened[0].includes('evil'));
    assert.ok(w.opened[0].startsWith(`${SSO_CALLBACK_SCHEME}://${SSO_CALLBACK_HOST}?`));
  });
});

describe('WB-S ownership across awaits', () => {
  it('a logout during authorization abandons the callback', async () => {
    const { w, adapter } = harness();
    w.duringAuthorize = () => { w.epoch += 1; };
    const r = await adapter.handle(AUTH_URL);
    assert.equal(r.kind, 'abandoned');
    assert.equal(w.opened.length, 0, 'no callback may be opened for the driver who left');
  });

  it('an identity transition during authorization abandons the callback', async () => {
    const { w, adapter } = harness();
    w.duringAuthorize = () => { w.epoch = 99; };
    const r = await adapter.handle(AUTH_URL);
    assert.equal(r.kind, 'abandoned');
    assert.equal(w.opened.length, 0);
  });

  it('a stale finally does not clear a newer attempt', async () => {
    const { w, adapter } = harness();
    let release!: () => void;
    w.gate = new Promise<void>((r) => { release = r; });
    const first = adapter.handle(AUTH_URL);
    await flush();
    assert.equal(adapter.isBusy(), true);
    // Reset (logout) then start a fresh attempt.
    adapter.reset();
    w.gate = null;
    const second = adapter.handle(AUTH_URL);
    await flush();
    release();
    await Promise.all([first, second]);
    // The slot must be free — neither handler may have wedged it.
    assert.equal(adapter.isBusy(), false);
  });

  it('a failed callback open is reported, not silently swallowed', async () => {
    const { w, adapter } = harness({ openThrows: true });
    const r = await adapter.handle(AUTH_URL);
    assert.equal(r.kind, 'callback-failed');
    assert.ok(w.logs.some((l) => l.startsWith('sso.route.callbackFailed')));
  });

  it('reset re-arms after logout', async () => {
    const { w, adapter } = harness();
    await adapter.handle(AUTH_URL);
    adapter.reset();
    await adapter.handle(AUTH_URL);
    assert.equal(w.authorizeCalls, 2);
  });
});

describe('WB-S callback schema', () => {
  it('a success callback carries exactly the permitted keys', async () => {
    const { w, adapter } = harness();
    await adapter.handle(AUTH_URL);
    const parsed = parseSsoCallbackUrl(w.opened[0]);
    assert.ok(parsed.ok);
    assert.ok(hasOnlyKeys(parsed.value, SSO_CALLBACK_SUCCESS_KEYS));
    assert.equal((parsed.value as { state: string }).state, STATE, 'state is echoed for correlation');
  });

  it('an error callback carries exactly the permitted keys', async () => {
    const { w, adapter } = harness({ outcome: 'error' });
    await adapter.handle(AUTH_URL);
    const parsed = parseSsoCallbackUrl(w.opened[0]);
    assert.ok(parsed.ok);
    assert.ok(hasOnlyKeys(parsed.value, SSO_CALLBACK_ERROR_KEYS));
  });

  it('NO callback URL ever carries a secret or an identifier', async () => {
    for (const outcome of ['success', 'error'] as const) {
      const { w, adapter } = harness({ outcome });
      await adapter.handle(AUTH_URL);
      const url = w.opened[0].toLowerCase();
      for (const forbidden of ['verifier', 'challenge', 'idtoken', 'customtoken',
        'refreshtoken', 'passcode', 'hash', 'uid', 'driverid', 'companyid']) {
        assert.ok(!url.includes(forbidden), `${outcome} callback leaked ${forbidden}`);
      }
    }
  });

  it('logs carry reason codes only — never a URL, code, or state', async () => {
    const { w, adapter } = harness({ outcome: 'error' });
    await adapter.handle(AUTH_URL);
    const joined = w.logs.join('|');
    assert.ok(!joined.includes('://'));
    assert.ok(!joined.includes(CODE));
    assert.ok(!joined.includes(STATE));
    assert.ok(!joined.includes(CHALLENGE));
  });
});

describe('WB-S issuance client', () => {
  it('pins the exact callable name and a bounded timeout', () => {
    assert.equal(SSO_ISSUE_CALLABLE, 'ssoIssueAuthorizationCode');
    assert.ok(SSO_ISSUE_TIMEOUT_MS > 0 && SSO_ISSUE_TIMEOUT_MS <= 30_000);
  });

  it('sends exactly the canonical request and NO identity', async () => {
    let sent: Record<string, unknown> | null = null;
    let sentTimeout = 0;
    const client = createSsoIssuanceClient(async (name, payload, timeout) => {
      assert.equal(name, SSO_ISSUE_CALLABLE);
      sent = payload;
      sentTimeout = timeout;
      return { protocolVersion: 1, code: CODE, expiresInSeconds: 120 };
    });
    const r = await client.requestCode({
      protocolVersion: 1, audience: SSO_AUDIENCE_WBT,
      codeChallenge: CHALLENGE, codeChallengeMethod: 'S256',
    });
    assert.equal(r.code, CODE);
    assert.equal(sentTimeout, SSO_ISSUE_TIMEOUT_MS);
    assert.deepEqual(Object.keys(sent!).sort(),
      ['audience', 'codeChallenge', 'codeChallengeMethod', 'protocolVersion']);
    for (const k of ['uid', 'driverId', 'companyId', 'hash', 'token']) {
      assert.ok(!(k in sent!), `identity field ${k} must never be sent`);
    }
  });

  it('refuses to send a non-canonical request at all', async () => {
    let called = false;
    const client = createSsoIssuanceClient(async () => { called = true; return {}; });
    await assert.rejects(() => client.requestCode({
      protocolVersion: 1, audience: 'evil', codeChallenge: CHALLENGE, codeChallengeMethod: 'S256',
    }));
    await assert.rejects(() => client.requestCode({
      protocolVersion: 9, audience: SSO_AUDIENCE_WBT, codeChallenge: CHALLENGE, codeChallengeMethod: 'S256',
    }));
    assert.equal(called, false);
  });

  it('validates the response and fails closed on an unsupported version', () => {
    assert.throws(() => validateIssueResponse({ protocolVersion: 2, code: CODE, expiresInSeconds: 120 }));
    assert.throws(() => validateIssueResponse({ protocolVersion: 1, code: 'short', expiresInSeconds: 120 }));
    assert.throws(() => validateIssueResponse({ protocolVersion: 1, code: CODE, expiresInSeconds: 0 }));
    assert.throws(() => validateIssueResponse(null));
    const ok = validateIssueResponse({ protocolVersion: 1, code: CODE, expiresInSeconds: 120, extra: 'x' });
    assert.ok(hasOnlyKeys(ok, ['protocolVersion', 'code', 'expiresInSeconds']));
  });

  it('maps callable errors to bounded states without revealing existence', () => {
    assert.equal(mapTransportError({ code: 'functions/unauthenticated' }).failure, 'not_authorized');
    assert.equal(mapTransportError({ code: 'functions/permission-denied' }).failure, 'not_authorized');
    assert.equal(mapTransportError({ code: 'functions/invalid-argument' }).failure, 'malformed_request');
    // Timeout, unavailable, exhausted, internal, unknown -> unavailable.
    for (const code of ['functions/deadline-exceeded', 'functions/unavailable',
      'functions/resource-exhausted', 'functions/internal', 'weird', undefined]) {
      assert.equal(mapTransportError({ code }).failure, 'unavailable', String(code));
    }
    // permission-denied must NOT be distinguishable from "no such record".
    const denied = mapTransportError({ code: 'functions/permission-denied' });
    assert.ok(!/not.?found|exists|absent|disabled/i.test(denied.message));
  });

  it('a transport timeout surfaces as unavailable', async () => {
    const client = createSsoIssuanceClient(async () => {
      throw { code: 'functions/deadline-exceeded' };
    });
    await assert.rejects(
      () => client.requestCode({
        protocolVersion: 1, audience: SSO_AUDIENCE_WBT,
        codeChallenge: CHALLENGE, codeChallengeMethod: 'S256',
      }),
      (e: SsoIssuanceError) => e.failure === 'unavailable',
    );
  });
});

describe('WB-S runtime registration', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the real Linking lifecycle routes SSO first, on BOTH paths', () => {
    const layout = strip(readFileSync(join(ROOT, 'app', '_layout.tsx'), 'utf8'));
    assert.match(layout, /acceptSsoAuthorizeUrl/);
    assert.match(layout, /dispatchSsoUrl/);
    assert.match(layout, /SsoAuthorizeListener/);
    assert.match(layout, /Linking\.addEventListener\('url'/);
    assert.match(layout, /Linking\.getInitialURL\(\)/);
    assert.match(layout, /acceptSsoAuthorizeUrl\(url, 'initial'\)/);
    assert.match(layout, /acceptSsoAuthorizeUrl\(e\.url, 'runtime'\)/);
    assert.match(layout, /useEffect\(\(\) => \{/);
  });

  it('no screen parses SSO query parameters itself', () => {
    const layout = readFileSync(join(ROOT, 'app', '_layout.tsx'), 'utf8');
    assert.ok(!/searchParams\.get\('(code|state|cc|ccm)'\)/.test(layout));
  });

  it('the runtime binds the real callable and the owned session', () => {
    const rt = strip(readFileSync(join(ROOT, 'src', 'core', 'services', 'ssoRuntime.ts'), 'utf8'));
    assert.match(rt, /httpsCallable\(fns, name, \{ timeout: timeoutMs \}\)/);
    assert.match(rt, /getFunctions\(getFirebaseApp\(\), FIREBASE_REGION\)/);
    assert.match(rt, /getOwnedVerifiedIdentity\(getFirebaseApp\(\), true\)/,
      'claims must be force-refreshed');
    // The Functions SDK attaches the ID token from the owned session, so
    // this module must never fetch, store, or forward one.
    assert.ok(!/getIdToken|getOwnedIdToken|Bearer|['"]Authorization['"]/.test(rt),
      'the runtime must never handle a token itself');
    assert.ok(!/initializeApp/.test(rt), 'no second FirebaseApp');
  });
});
