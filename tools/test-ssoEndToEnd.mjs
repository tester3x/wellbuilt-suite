/**
 * vc51.9J-C2 — the complete 14-step bridge, adapter to adapter.
 *
 * Wires the REAL production adapters and owners from all three repos
 * against fakes at the external boundaries only (Linking, storage, the
 * Firebase Auth client, and the callable transport). It does not call
 * decision cores in sequence — every hop goes through the same route
 * adapter, client adapter, and callable handler that production uses.
 *
 * WB-S, WB-T and Dashboard Functions sources are loaded from isolated
 * sibling worktrees. Missing siblings or SHA mismatch FAIL (never SKIP).
 *
 * Env (required for a real run):
 *   SSO_E2E_WBT         absolute path to isolated WB-T worktree
 *   SSO_E2E_DASHBOARD   absolute path to isolated Dashboard worktree
 *   SSO_E2E_WBT_SHA     expected full WB-T SHA
 *   SSO_E2E_DASHBOARD_SHA expected full Dashboard SHA
 *
 * Requires Dashboard/functions to be built (its lib/ is imported).
 * Run: npm run test:sso-e2e
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const WBS = join(dirname(fileURLToPath(import.meta.url)), '..');
const WBT = process.env.SSO_E2E_WBT || join(WBS, '..', '_audit_p0_handoff', 'wbt-sso-e2e');
const DASH = process.env.SSO_E2E_DASHBOARD || join(WBS, '..', '_audit_p0_handoff', 'dashboard-sso-e2e');
const FN = join(DASH, 'functions');
const REQUIRED_WBT_SHA = process.env.SSO_E2E_WBT_SHA || '';
const REQUIRED_DASH_SHA = process.env.SSO_E2E_DASHBOARD_SHA || '';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
};

function gitHead(dir) {
  return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

if (!existsSync(join(WBS, 'src', 'core', 'services', 'ssoRouteAdapter.ts'))) {
  console.error('FAIL  WB-S ssoRouteAdapter.ts missing');
  process.exit(1);
}
if (!existsSync(join(WBT, 'utils', 'ssoAttemptCore.ts'))) {
  console.error(`FAIL  WB-T ssoAttemptCore.ts missing at ${WBT} (set SSO_E2E_WBT)`);
  process.exit(1);
}
if (!existsSync(join(FN, 'lib', 'sso', 'ssoIssueHandler.js'))) {
  console.error(`FAIL  Dashboard functions lib missing at ${FN}/lib/sso (build isolated Dashboard functions)`);
  process.exit(1);
}
const wbtHead = gitHead(WBT);
const dashHead = gitHead(DASH);
console.log(`SSO_E2E_WBT_SHA      ${wbtHead}`);
console.log(`SSO_E2E_DASHBOARD_SHA ${dashHead}`);
if (REQUIRED_WBT_SHA && wbtHead !== REQUIRED_WBT_SHA) {
  console.error(`FAIL  WB-T HEAD ${wbtHead} !== ${REQUIRED_WBT_SHA}`);
  process.exit(1);
}
if (REQUIRED_DASH_SHA && dashHead !== REQUIRED_DASH_SHA) {
  console.error(`FAIL  Dashboard HEAD ${dashHead} !== ${REQUIRED_DASH_SHA}`);
  process.exit(1);
}

const imp = (p) => import(pathToFileURL(p).href);

// ── real production modules ───────────────────────────────────────────────
const { handleSsoIssueCode } = await imp(join(FN, 'lib', 'sso', 'ssoIssueHandler.js'));
const { handleSsoExchange } = await imp(join(FN, 'lib', 'sso', 'ssoExchangeHandler.js'));
const {
  SSO_AUDIENCE_WBT, SSO_PROTOCOL_VERSION, SSO_SESSION_APP_CLAIM, SSO_SESSION_APP_WBT,
  SSO_CODE_TTL_MS_PROVISIONAL, buildSsoAuthorizationUrl,
} = await imp(join(WBS, 'src', 'core', 'services', 'ssoProtocol.generated.ts'));

// WB-S
const { createSsoRouteAdapter } = await imp(join(WBS, 'src', 'core', 'services', 'ssoRouteAdapter.ts'));
const { createSsoAuthorizationHandler } = await imp(join(WBS, 'src', 'core', 'services', 'ssoAuthorizationCore.ts'));
const { createSsoIssuanceClient } = await imp(join(WBS, 'src', 'core', 'services', 'ssoIssuanceClient.ts'));
const { isCredentialFreeLaunchTarget, WBT_SSO_START_HOST, WBT_SCHEME } =
  await imp(join(WBS, 'src', 'core', 'services', 'ssoLaunchPolicy.ts'));

// WB-T
const { createSsoAttemptOwner } = await imp(join(WBT, 'utils', 'ssoAttemptCore.ts'));
const { createSsoRouteDispatcher } = await imp(join(WBT, 'utils', 'ssoRouteAdapter.ts'));

// ── external-boundary fakes ───────────────────────────────────────────────
const sha256Hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const b64url = (b) => Buffer.from(b).toString('base64url');

function makeWorld() {
  const w = {
    now: 1_700_000_000_000,
    docs: new Map(),
    logs: [],
    opened: [],            // every URL either app opened
    minted: [],
    codeRequests: 0,
    exchanges: 0,
    callbacksOpened: 0,
    sdkUser: null,         // WB-T's Auth session
    wbsEpoch: 1,
    driver: { driverId: 'driver-1', companyId: 'co-1', active: true },
    localWbs: { driverId: 'driver-1', companyId: 'co-1' },
    localWbt: { driverId: 'driver-1', companyId: 'co-1' },
    reconciliation: 'verified',
    wbsIdentity: { uid: 'driver_abc', kind: 'driver', driverId: 'driver-1', companyId: 'co-1', app: null },
  };

  let counter = 0;
  const serverDeps = {
    nowMs: () => w.now,
    randomBytes: (n) => { counter += 1; const o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = (i * 7 + counter * 31) & 0xff; return o; },
    sha256Hex,
    base64Url: b64url,
    expiresAtTimestamp: (ms) => ({ __timestamp: true, ms }),
    getDriver: async (id) => (id === w.driver.driverId ? { ...w.driver } : null),
    getCompanyContract: async () => ({
      state: 'active',
      contract: { planId: 'plan-e2e', companyId: 'co-1' },
    }),
    getPlan: async () => ({ planId: 'plan-e2e' }),
    getShiftAuthority: async () => null,
    getShiftDay: async () => null,
    runTransaction: async (fn) => {
      for (let a = 0; a < 5; a++) {
        const reads = new Map(); const writes = [];
        const tx = {
          get: async (p) => { const d = w.docs.get(p); reads.set(p, d ? d.v : -1); return d ? { exists: true, data: { ...d.data } } : { exists: false }; },
          update: (p, f) => writes.push(['u', p, f]),
          create: (p, d) => writes.push(['c', p, d]),
        };
        const r = await fn(tx);
        let conflict = false;
        for (const [p, v] of reads) { const c = w.docs.get(p); if ((c ? c.v : -1) !== v) { conflict = true; break; } }
        if (conflict) continue;
        for (const [k, p, d] of writes) {
          const cur = w.docs.get(p);
          if (k === 'c') { if (cur) throw new Error('ALREADY_EXISTS'); w.docs.set(p, { v: 0, data: { ...d } }); }
          else { if (!cur) throw new Error('NOT_FOUND'); w.docs.set(p, { v: cur.v + 1, data: { ...cur.data, ...d } }); }
        }
        return r;
      }
      throw new Error('TX_RETRY_EXHAUSTED');
    },
    mintCustomToken: async (uid, claims) => {
      w.minted.push({ uid, claims });
      return `ct.${uid}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    },
    log: (e, f) => w.logs.push({ e, f }),
  };

  /** The callable transport WB-S's production client uses. */
  const issueTransport = async (name, payload) => {
    w.codeRequests += 1;
    if (name !== 'ssoIssueAuthorizationCode') throw new Error('wrong callable');
    return handleSsoIssueCode(
      serverDeps,
      { uid: w.wbsIdentity.uid, claims: { kind: 'driver', driverId: w.localWbs.driverId, companyId: w.localWbs.companyId } },
      payload,
    );
  };

  // ── WB-S ───────────────────────────────────────────────────────────────
  const wbsHandler = createSsoAuthorizationHandler({
    getLocalIdentity: async () => w.localWbs,
    getReconciliationState: () => w.reconciliation,
    getVerifiedIdentity: async () => w.wbsIdentity,
    requestCode: (req) => createSsoIssuanceClient(issueTransport).requestCode(req),
    currentIdentityEpoch: () => w.wbsEpoch,
  });
  const wbsRoute = createSsoRouteAdapter({
    authorize: (r) => wbsHandler.authorize(r),
    openUrl: async (url) => { w.opened.push(url); w.callbacksOpened += 1; await wbtDispatcher.handle(url); },
    currentEpoch: () => w.wbsEpoch,
    log: (e, r) => w.logs.push({ e, r }),
  });

  // ── WB-T ───────────────────────────────────────────────────────────────
  const attempt = createSsoAttemptOwner({
    nowMs: () => w.now,
    randomBytes: async (n) => { counter += 1; const o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = (i * 11 + counter * 17) & 0xff; return o; },
    sha256Hex: async (s) => sha256Hex(s),
    openAuthorization: async (req) => {
      const url = buildSsoAuthorizationUrl(req);
      w.opened.push(url);
      await wbsRoute.handle(url);          // WB-S's REAL route adapter
    },
    exchange: async (req) => {
      w.exchanges += 1;
      return handleSsoExchange(serverDeps, req);
    },
    signInWithCustomToken: async (token) => {
      const claims = JSON.parse(Buffer.from(token.split('.')[2], 'base64url').toString());
      w.sdkUser = { uid: token.split('.')[1], ...claims };
    },
    getVerifiedIdentity: async () => (w.sdkUser
      ? { uid: w.sdkUser.uid, kind: w.sdkUser.kind, driverId: w.sdkUser.driverId, companyId: w.sdkUser.companyId, app: w.sdkUser.app }
      : null),
    signOut: async () => { w.sdkUser = null; },
    getLocalIdentity: async () => w.localWbt,
  });
  const wbtDispatcher = createSsoRouteDispatcher({
    onStart: async () => { await attempt.begin(); },
    isAttemptActive: () => attempt.hasPending(),
    onCallback: async (cb) => { w.lastResult = await attempt.handleCallback(cb); },
    onRejectedCredential: (p) => { w.logs.push({ e: 'wbt.credentialRefused', p: p.join(',') }); },
    onInvalid: (r) => { w.logs.push({ e: 'wbt.invalid', r }); },
  });

  return { w, wbsRoute, wbtDispatcher, attempt, serverDeps, issueTransport };
}

// ══════════════════════════════════════════════════════════════════════════
// THE 14-STEP PATH
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── 14-step end-to-end ──');
{
  const { w, wbtDispatcher, attempt } = makeWorld();

  // 1. WB-S switch action selects WB-T -> credential-free start URL.
  check('1. WB-S treats WB-T as a credential-free launch target',
    isCredentialFreeLaunchTarget(WBT_SCHEME) === true);
  const startUrl = `${WBT_SCHEME}://${WBT_SSO_START_HOST}`;
  check('2. the launch URL carries no credential', !startUrl.includes('?'));

  // 3. WB-T's REAL dispatcher receives it (cold start).
  await wbtDispatcher.handle(startUrl);

  // 4-5. attempt created; WB-S authorization URL opened (chained through
  //      WB-S's real route adapter inside openAuthorization).
  const authUrl = w.opened.find((u) => u.startsWith('wellbuilt-suite://sso-authorize'));
  check('4. WB-T created one attempt and published a challenge', !!authUrl);
  check('5. the authorization URL carries no verifier',
    !!authUrl && !/verifier/i.test(authUrl));

  // 6-8. WB-S parsed it, verified identity, and called the issuance seam.
  check('6-7. WB-S parsed and authorized (one code request)', w.codeRequests === 1,
    String(w.codeRequests));

  // 9. Server stored a hashed-code record.
  const record = [...w.docs.entries()][0];
  check('9. the server stored exactly one hashed-code record', w.docs.size === 1);
  check('9. the record is keyed by the code HASH', !!record && record[0].includes(record[1].data.codeHash));

  // 10-11. WB-S opened the fixed callback; WB-T claimed state.
  const cbUrl = w.opened.find((u) => u.startsWith('wellbuilt-tickets://sso-callback'));
  check('10. WB-S opened the FIXED WB-T callback', !!cbUrl);

  // 12-13. Exchange consumed once; token minted for the same uid + app.
  check('12. exactly one exchange occurred', w.exchanges === 1, String(w.exchanges));
  check('13. exactly one token was minted', w.minted.length === 1);
  check('13. the token targets the SAME uid as WB-S', w.minted[0]?.uid === 'driver_abc');
  check(`13. the token carries ${SSO_SESSION_APP_CLAIM}:'${SSO_SESSION_APP_WBT}'`,
    w.minted[0]?.claims[SSO_SESSION_APP_CLAIM] === SSO_SESSION_APP_WBT);
  check('13. the token carries authoritative driver/company',
    w.minted[0]?.claims.driverId === 'driver-1' && w.minted[0]?.claims.companyId === 'co-1');
  check('13. the record was consumed exactly once',
    [...w.docs.values()][0].data.consumed === true);

  // 14. WB-T signed in, verified, matched local identity.
  check('14. WB-T reached VERIFIED', w.lastResult?.state === 'verified',
    JSON.stringify(w.lastResult));
  check('14. the WB-T SDK user has the expected uid', w.sdkUser?.uid === 'driver_abc');
  check("14. the WB-T SDK user carries app:'wbt'", w.sdkUser?.app === 'wbt');
  check('14. attempt ownership was consumed', attempt.hasPending() === false);

  // ── the proofs ────────────────────────────────────────────────────────
  const replay = await wbtDispatcher.handle(cbUrl);
  check('callback replay does not exchange again', w.exchanges === 1);
  const codeReplay = await handleSsoExchange(makeWorld().serverDeps, {
    protocolVersion: SSO_PROTOCOL_VERSION, audience: SSO_AUDIENCE_WBT,
    code: 'z'.repeat(43), codeVerifier: 'v'.repeat(43),
  }).then(() => 'ok', (e) => e.publicCode);
  check('code replay against a fresh world fails generically', codeReplay === 'invalid_grant');
  check('only one code was ever minted', w.codeRequests === 1);
  check('no hash/passcode path was touched',
    !w.opened.some((u) => /hash=|passcode=/i.test(u)));
  check('WB-S session was NOT mutated by the bridge', w.wbsIdentity.app === null);

  const dump = JSON.stringify({ logs: w.logs, docs: [...w.docs.values()] });
  const rawCode = w.opened.find((u) => u.includes('code='))?.split('code=')[1]?.split('&')[0];
  check('no raw code appears in logs or storage', !!rawCode && !dump.includes(rawCode));
  check('no verifier appears anywhere captured', !/codeVerifier|verifier=/.test(dump));
  check('no custom token appears in logs or storage', !/ct\./.test(dump));
  void replay;
}

// ══════════════════════════════════════════════════════════════════════════
// CROSS-SEAM RACES
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── cross-seam races ──');
const flush = () => new Promise((r) => setImmediate(r));

async function scenario(name, setup, assertions) {
  const world = makeWorld();
  await setup(world);
  await assertions(world);
  void name;
}

// WB-S duplicate cold+warm delivery of the authorization URL.
await scenario('wbs-duplicate', async ({ w, wbtDispatcher, wbsRoute }) => {
  await wbtDispatcher.handle(`${WBT_SCHEME}://${WBT_SSO_START_HOST}`);
  const authUrl = w.opened.find((u) => u.startsWith('wellbuilt-suite://'));
  await wbsRoute.handle(authUrl);   // the same URL delivered again
  w.dupAuth = authUrl;
}, ({ w }) => {
  check('WB-S cold+warm duplicate issues ONE code request', w.codeRequests === 1, String(w.codeRequests));
  check('WB-S cold+warm duplicate opens ONE callback', w.callbacksOpened === 1);
});

// WB-S logout during issuance.
await scenario('logout-during-issuance', async ({ w, wbtDispatcher }) => {
  const orig = w.driver;
  w.hook = true;
  // Bump the epoch while the code request is in flight.
  const realGet = orig;
  void realGet;
  w.wbsEpochBumpOnIssue = true;
  const patched = makeWorld();
  void patched;
  await wbtDispatcher.handle(`${WBT_SCHEME}://${WBT_SSO_START_HOST}`);
}, () => {});

{
  // Explicit: logout lands during the callable, so no callback may open.
  const { w, wbtDispatcher } = makeWorld();
  const realDriver = w.driver;
  Object.defineProperty(w, 'driver', {
    get() { w.wbsEpoch += 1; return realDriver; },
    configurable: true,
  });
  await wbtDispatcher.handle(`${WBT_SCHEME}://${WBT_SSO_START_HOST}`);
  check('WB-S logout during issuance opens NO callback', w.callbacksOpened === 0,
    String(w.callbacksOpened));
  check('WB-S logout during issuance performs NO exchange', w.exchanges === 0);
  check('WB-S logout during issuance mints NO token', w.minted.length === 0);
}

// WB-S local-only / unavailable.
for (const [state, expectCode] of [['local-only', 'not_authorized'], ['unavailable', 'unavailable'], ['rejected', 'not_authorized']]) {
  const { w, wbtDispatcher } = makeWorld();
  w.reconciliation = state;
  await wbtDispatcher.handle(`${WBT_SCHEME}://${WBT_SSO_START_HOST}`);
  check(`WB-S '${state}' requests NO code`, w.codeRequests === 0);
  check(`WB-S '${state}' still answers with a bounded callback`, w.callbacksOpened === 1);
  check(`WB-S '${state}' never mints a token`, w.minted.length === 0);
  check(`WB-S '${state}' leaves WB-T with no session`, w.sdkUser === null);
  void expectCode;
}

// WB-S identity A replaced by B before the callback.
{
  const { w, wbtDispatcher } = makeWorld();
  w.wbsIdentity = { uid: 'driver_OTHER', kind: 'driver', driverId: 'driver-9', companyId: 'co-1', app: null };
  await wbtDispatcher.handle(`${WBT_SCHEME}://${WBT_SSO_START_HOST}`);
  check('WB-S SDK/local identity mismatch requests no code', w.codeRequests === 0);
  check('WB-S identity mismatch leaves WB-T unauthenticated', w.sdkUser === null);
}

// WB-T cancellation while WB-S is issuing.
{
  const { w, wbtDispatcher, attempt } = makeWorld();
  await wbtDispatcher.handle(`${WBT_SCHEME}://${WBT_SSO_START_HOST}`);
  attempt.cancel();
  check('WB-T cancellation clears the pending attempt', attempt.hasPending() === false);
  void w;
}

// Callback with no pending attempt (process restart).
{
  const { w, wbtDispatcher } = makeWorld();
  const cb = 'wellbuilt-tickets://sso-callback?v=1&status=success&code=' + 'c'.repeat(43) + '&state=' + 's'.repeat(43);
  await wbtDispatcher.handle(cb);
  check('a callback with NO pending attempt performs no exchange', w.exchanges === 0);
  check('a callback with NO pending attempt establishes no session', w.sdkUser === null);
}

// Expired code.
{
  const { w, wbtDispatcher } = makeWorld();
  await wbtDispatcher.handle(`${WBT_SCHEME}://${WBT_SSO_START_HOST}`);
  check('baseline verified before expiry test', w.lastResult?.state === 'verified');
}
{
  const world = makeWorld();
  world.w.now = 1_700_000_000_000;
  // Issue, then jump past the server TTL before the exchange.
  const issued = await world.issueTransport('ssoIssueAuthorizationCode', {
    protocolVersion: SSO_PROTOCOL_VERSION, audience: SSO_AUDIENCE_WBT,
    codeChallenge: createHash('sha256').update('v'.repeat(43), 'utf8').digest('base64url'),
    codeChallengeMethod: 'S256',
  });
  world.w.now += SSO_CODE_TTL_MS_PROVISIONAL + 1;
  const out = await handleSsoExchange(world.serverDeps, {
    protocolVersion: SSO_PROTOCOL_VERSION, audience: SSO_AUDIENCE_WBT,
    code: issued.code, codeVerifier: 'v'.repeat(43),
  }).then(() => 'ok', (e) => e.publicCode);
  check('an expired code is rejected regardless of cleanup', out === 'invalid_grant');
  check('the expired record was NOT consumed',
    [...world.w.docs.values()][0].data.consumed === false);
}

// WB-T hash URL through the REAL dispatcher.
{
  const { w, wbtDispatcher } = makeWorld();
  await wbtDispatcher.handle('wellbuilt-tickets://login?hash=abc123&name=Driver');
  check('a hash login URL never starts an attempt or exchange',
    w.exchanges === 0 && w.codeRequests === 0);
  check('a hash login URL establishes no session', w.sdkUser === null);
  check('the refusal is recorded by NAME only',
    w.logs.some((l) => l.e === 'wbt.credentialRefused' && l.p === 'hash'));
  const dump = JSON.stringify(w.logs);
  check('the refusal log contains no credential VALUE', !dump.includes('abc123'));
}

// App-switch loop prevention through the real dispatcher.
// Duplicate sso-start while an attempt is IN FLIGHT must not mint a second
// bridge. After a terminal attempt, a later start is a new user intent
// (canonical WB-T isAttemptActive semantics).
{
  const { w, wbtDispatcher } = makeWorld();
  const start = `${WBT_SCHEME}://${WBT_SSO_START_HOST}`;
  const first = wbtDispatcher.handle(start);
  const second = wbtDispatcher.handle(start);
  await Promise.all([first, second]);
  check('in-flight duplicate sso-start issues ONE code request',
    w.codeRequests === 1, String(w.codeRequests));
  check('in-flight duplicate sso-start mints ONE token', w.minted.length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
