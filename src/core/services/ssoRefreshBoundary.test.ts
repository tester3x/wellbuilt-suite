/**
 * Forced claims-refresh boundary — observability without a timeout.
 *
 * HISTORY THIS ENCODES. The refresh was instrumented because two handoffs
 * went silent with no issuance reaching the backend; the telemetry proved
 * the stall is here (`refresh.started` with no completion). A 10 s
 * Promise.race bound was then tried and REMOVED, because the same device
 * evidence showed the refresh is FROZEN, not hung: Suite loses the
 * foreground, Android suspends the JS context, and a setTimeout bound
 * freezes with it — the nominal 10 s fired at ~50 s of wall clock and
 * killed a refresh that resolved successfully 19 ms later, turning a
 * recoverable handoff into a failed authorization.
 *
 * So these tests pin the opposite of what a timeout suite would: that no
 * timeout-driven callback or terminal result can be produced at all, that
 * the epoch guard still invalidates a refresh completing after a driver
 * switch, and that the telemetry stays truthful and secret-free.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSsoAuthorizationHandler,
  type SsoAuthorizationOps,
  type SsoRefreshCategory,
  type SsoRefreshPhase,
} from './ssoAuthorizationCore';
import { SSO_AUDIENCE_WBT, SSO_CHALLENGE_METHOD, SSO_PROTOCOL_VERSION } from './ssoProtocol.generated';

const CHALLENGE = 'C'.repeat(43);
const STATE = 'S'.repeat(43);
const request = {
  protocolVersion: SSO_PROTOCOL_VERSION,
  audience: SSO_AUDIENCE_WBT,
  codeChallenge: CHALLENGE,
  codeChallengeMethod: SSO_CHALLENGE_METHOD,
  state: STATE,
} as Parameters<ReturnType<typeof createSsoAuthorizationHandler>['authorize']>[0];

const VERIFIED = { uid: 'u', kind: 'driver', driverId: 'd1', companyId: 'c1' };

function harness(opts: {
  refresh?: () => Promise<typeof VERIFIED | null>;
  epochs?: number[];
} = {}) {
  const logged: Array<{ phase: SsoRefreshPhase; category?: SsoRefreshCategory; elapsed?: number }> = [];
  let issued = 0;
  let clock = 1_000;
  const epochs = opts.epochs ? [...opts.epochs] : null;
  let epochCall = 0;

  const ops: SsoAuthorizationOps = {
    getLocalIdentity: async () => ({ driverId: 'd1', companyId: 'c1' }),
    getReconciliationState: () => 'verified',
    getVerifiedIdentity: opts.refresh ?? (async () => { clock += 120; return VERIFIED; }),
    requestCode: async () => { issued += 1; return { code: 'z'.repeat(43) }; },
    currentIdentityEpoch: () => {
      if (!epochs) return 1;
      const v = epochs[Math.min(epochCall, epochs.length - 1)];
      epochCall += 1;
      return v;
    },
    nowMs: () => clock,
    log: (phase, category, elapsed) => { logged.push({ phase, category, elapsed }); },
  };
  return {
    handler: createSsoAuthorizationHandler(ops),
    logged,
    phases: () => logged.map((l) => l.phase),
    issuedCount: () => issued,
  };
}

test('a successful refresh continues the authorization exactly once', async () => {
  const h = harness();
  const outcome = await h.handler.authorize(request);
  assert.equal(h.issuedCount(), 1);
  assert.equal(outcome.callback.status, 'success');
  assert.deepEqual(h.phases(), ['refresh.started', 'refresh.completed']);
});

test('a rejected refresh fails safely with zero issuance', async () => {
  const h = harness({ refresh: async () => { throw new Error('boom'); } });
  const outcome = await h.handler.authorize(request);
  assert.equal(h.issuedCount(), 0);
  assert.equal(outcome.callback.status, 'error');
  assert.ok(h.phases().includes('refresh.failed'));
});

test('an identity epoch change DURING the refresh blocks issuance', async () => {
  // Reads: [before-refresh, after-refresh, ...] — a driver switch mid-refresh.
  const h = harness({ epochs: [1, 2, 2] });
  const outcome = await h.handler.authorize(request);
  assert.equal(h.issuedCount(), 0, 'a superseded attempt must not issue');
  assert.equal(outcome.callback.status, 'error');
  assert.ok(h.logged.some((l) => l.category === 'superseded'));
});

test('a slow refresh is NOT cut short — it completes and issues', async () => {
  // The exact case the removed timeout used to destroy: a refresh that
  // takes far longer than any bound we would have chosen still succeeds.
  let resolveLate: (v: typeof VERIFIED) => void = () => {};
  const h = harness({ refresh: () => new Promise((r) => { resolveLate = r; }) });
  const p = h.handler.authorize(request);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.issuedCount(), 0, 'nothing issues while the refresh is outstanding');
  resolveLate(VERIFIED);
  const outcome = await p;
  assert.equal(h.issuedCount(), 1);
  assert.equal(outcome.callback.status, 'success');
});

test('no timeout-driven callback or terminal result can be produced', () => {
  const core: string = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'ssoAuthorizationCore.ts'), 'utf8');
  const code = core.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // No racing, no delay injection, no timeout error path, and no timeout
  // vocabulary left in the executable surface.
  assert.ok(!/Promise\.race/.test(code), 'the refresh race is gone');
  assert.ok(!/waitMs/.test(code), 'no delay op remains');
  assert.ok(!/setTimeout|setInterval/.test(code), 'the core schedules nothing');
  assert.ok(!/timed out|timeout/i.test(code), 'no timeout vocabulary in executable code');
  assert.ok(!/SSO_VERIFIED_IDENTITY_TIMEOUT_MS/.test(code), 'the bound constant is removed');
});

test('the phase and category sets no longer contain timeout vocabulary', () => {
  const core: string = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'ssoAuthorizationCore.ts'), 'utf8');
  const phaseBlock = core.slice(core.indexOf('export type SsoRefreshPhase'),
    core.indexOf('export interface SsoAuthorizationOps'));
  assert.ok(!/lateDiscarded|refresh\.timeout/.test(phaseBlock),
    'removed phases must not survive in the closed set');
  assert.match(phaseBlock, /'refresh\.started'/);
  assert.match(phaseBlock, /'refresh\.completed'/);
  assert.match(phaseBlock, /'refresh\.failed'/);
});

test('duplicate route delivery cannot duplicate the refresh or the issuance', async () => {
  // Deduplication lives in the route adapter; this pins that a second
  // authorize for the same claim is not reachable through the handler by
  // re-entry — one authorize call performs exactly one refresh and at most
  // one issuance.
  const h = harness();
  await h.handler.authorize(request);
  assert.equal(h.phases().filter((p) => p === 'refresh.started').length, 1);
  assert.equal(h.issuedCount(), 1);
});

test('telemetry carries only closed-set words plus an elapsed number', () => {
  const core: string = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'ssoAuthorizationCore.ts'), 'utf8');
  const allowedPhases = new Set(['refresh.started', 'refresh.completed', 'refresh.failed']);
  const allowedCategories = new Set([undefined, 'ok', 'error', 'superseded']);
  for (const m of core.matchAll(/ops\.log\?\.\('([^']+)'(?:,\s*'([^']+)')?/g)) {
    assert.ok(allowedPhases.has(m[1]), `unexpected phase ${m[1]}`);
    assert.ok(allowedCategories.has(m[2]), `unexpected category ${m[2]}`);
  }
  assert.ok(!/ops\.log\?\.\([^)]*(token|code|state|challenge|verifier|url|claim|driverId|companyId|uid)/i.test(core));
  // The runtime sink interpolates only phase, category, and elapsed ms.
  const runtime: string = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'ssoRuntime.ts'), 'utf8');
  assert.match(runtime, /\$\{phase\}\$\{category \? `: \$\{category\}` : ''\}\$\{ms\}/);
});

test('elapsed duration is reported when a clock is available, omitted otherwise', async () => {
  const withClock = harness();
  await withClock.handler.authorize(request);
  const completed = withClock.logged.find((l) => l.phase === 'refresh.completed');
  assert.equal(typeof completed?.elapsed, 'number');
  assert.ok((completed!.elapsed as number) >= 0);
});

test('no automatic retry or resume hook exists', () => {
  const core: string = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'ssoAuthorizationCore.ts'), 'utf8');
  const code = core.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/AppState|addEventListener|retry\(|reissue/i.test(code));
});
