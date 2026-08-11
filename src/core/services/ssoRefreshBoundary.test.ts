/**
 * Forced claims-refresh boundary — bounded, invalidating, silent-safe.
 *
 * DEVICE-PROVEN NEED (2026-08-11): two handoffs died with the authorize
 * route claimed and no issuance EVER reaching the backend — the issuance
 * function logged the three healthy runs and neither failure. The chain
 * therefore stalled before requestCode, and `getIdTokenResult(true)` was
 * the only unbounded network call ahead of it.
 *
 * These tests pin the bound, the invalidation, and — the part that actually
 * matters for safety — that a LATE refresh resolution can never reach
 * issuance or a callback.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSsoAuthorizationHandler,
  SSO_VERIFIED_IDENTITY_TIMEOUT_MS,
  type SsoAuthorizationOps,
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

/** Harness with manual control of the refresh and the timeout. */
function harness(opts: {
  refresh?: () => Promise<typeof VERIFIED | null>;
  epochs?: number[];
} = {}) {
  const phases: SsoRefreshPhase[] = [];
  const logged: Array<{ phase: string; category?: string }> = [];
  let issued = 0;
  let releaseTimeout: () => void = () => {};
  const timeoutGate = new Promise<void>((r) => { releaseTimeout = r; });
  const epochs = opts.epochs ? [...opts.epochs] : null;
  let epochCall = 0;

  const ops: SsoAuthorizationOps = {
    getLocalIdentity: async () => ({ driverId: 'd1', companyId: 'c1' }),
    getReconciliationState: () => 'verified',
    getVerifiedIdentity: opts.refresh ?? (async () => VERIFIED),
    requestCode: async () => { issued += 1; return { code: 'z'.repeat(43) }; },
    currentIdentityEpoch: () => {
      if (!epochs) return 1;
      const v = epochs[Math.min(epochCall, epochs.length - 1)];
      epochCall += 1;
      return v;
    },
    waitMs: () => timeoutGate,
    log: (phase, category) => { phases.push(phase); logged.push({ phase, category }); },
  };
  return {
    handler: createSsoAuthorizationHandler(ops),
    phases, logged,
    issuedCount: () => issued,
    fireTimeout: () => releaseTimeout(),
  };
}

test('refresh resolves before the timeout → authorization continues, issuing once', async () => {
  const h = harness();
  const outcome = await h.handler.authorize(request);
  assert.equal(h.issuedCount(), 1);
  assert.equal(outcome.callback.status, 'success');
  assert.deepEqual(h.phases, ['refresh.started', 'refresh.completed']);
});

test('refresh rejects → existing sanitized failure path, zero issuance', async () => {
  const h = harness({ refresh: async () => { throw new Error('boom'); } });
  const outcome = await h.handler.authorize(request);
  assert.equal(h.issuedCount(), 0);
  assert.equal(outcome.callback.status, 'error');
  assert.ok(h.phases.includes('refresh.failed'));
});

test('refresh times out → zero issuance, zero success callback', async () => {
  const h = harness({ refresh: () => new Promise(() => {}) });   // never settles
  const p = h.handler.authorize(request);
  h.fireTimeout();
  const outcome = await p;
  assert.equal(h.issuedCount(), 0, 'a timed-out refresh must not issue');
  assert.equal(outcome.callback.status, 'error');
  assert.ok(h.phases.includes('refresh.timeout'));
});

test('a timed-out refresh that LATER resolves still issues nothing', async () => {
  let resolveLate: (v: typeof VERIFIED) => void = () => {};
  const h = harness({ refresh: () => new Promise((r) => { resolveLate = r; }) });
  const p = h.handler.authorize(request);
  h.fireTimeout();
  const outcome = await p;
  // The refresh comes back well after the attempt returned.
  resolveLate(VERIFIED);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.issuedCount(), 0, 'late resolution must never reach requestCode');
  assert.equal(outcome.callback.status, 'error');
  assert.ok(h.phases.includes('refresh.lateDiscarded'), 'late completion is recorded, not silent');
});

test('a timed-out refresh that LATER REJECTS issues nothing and is classified', async () => {
  // The non-cancellable Firebase promise can reject late just as easily as
  // it can resolve late. The explicit .then/.catch exist to CLASSIFY that
  // late settlement and emit the refresh.lateDiscarded telemetry — not to
  // keep it from being unhandled: Promise.race subscribes to every input,
  // so a losing promise that later rejects is already handled either way.
  // The unhandledRejection guard below is a property check on the result,
  // not the justification for the design.
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    let rejectLate: (e: Error) => void = () => {};
    const h = harness({ refresh: () => new Promise((_r, rej) => { rejectLate = rej; }) });
    const p = h.handler.authorize(request);
    h.fireTimeout();
    const outcome = await p;
    const statusAtTimeout = outcome.callback.status;

    rejectLate(new Error('late network failure'));
    // Two macrotask turns: enough for any unhandled rejection to surface.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(h.issuedCount(), 0, 'late rejection must never reach requestCode');
    assert.equal(outcome.callback.status, 'error');
    assert.equal(outcome.callback.status, statusAtTimeout,
      'the expired attempt\'s terminal state must not be mutated afterwards');
    assert.deepEqual(unhandled, [], 'no unhandled rejection escapes this path');
    // Sanitized, and from the approved closed set.
    const late = h.logged.filter((l) => l.phase === 'refresh.lateDiscarded');
    assert.equal(late.length, 1);
    assert.equal(late[0].category, 'error');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('late settlement is classified: both outcomes are mapped before the race', () => {
  // Proves the CLASSIFICATION is deliberate — both a late resolution and a
  // late rejection are mapped to a RefreshResult, and therefore to
  // refresh.lateDiscarded telemetry, rather than being indistinguishable.
  // This is not a claim about unhandled rejections; it is about the
  // boundary being observable in both directions.
  const core: string = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'ssoAuthorizationCore.ts'), 'utf8');
  const code = core.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const refreshAt = code.indexOf('ops.getVerifiedIdentity()');
  const thenAt = code.indexOf('.then(', refreshAt);
  const catchAt = code.indexOf('.catch(', refreshAt);
  const raceAt = code.indexOf('Promise.race', refreshAt);
  assert.ok(refreshAt > -1 && thenAt > -1 && catchAt > -1 && raceAt > -1);
  assert.ok(thenAt < raceAt && catchAt < raceAt,
    'both settlement paths must be classified before the value enters the race');
  assert.match(code, /if \(settled\) ops\.log\?\.\('refresh\.lateDiscarded', 'timeout'\)/);
  assert.match(code, /if \(settled\) ops\.log\?\.\('refresh\.lateDiscarded', 'error'\)/);
});

test('a deliberate subsequent fresh attempt can proceed normally', async () => {
  const stalled = harness({ refresh: () => new Promise(() => {}) });
  const p = stalled.handler.authorize(request);
  stalled.fireTimeout();
  await p;
  // New attempt, new handler — exactly what a fresh user-initiated tap does.
  const fresh = harness();
  const outcome = await fresh.handler.authorize(request);
  assert.equal(fresh.issuedCount(), 1);
  assert.equal(outcome.callback.status, 'success');
});

test('identity epoch changing DURING the refresh invalidates the attempt', async () => {
  // Epoch reads: [before-refresh, after-refresh, ...] — a switch mid-refresh.
  const h = harness({ epochs: [1, 2, 2] });
  const outcome = await h.handler.authorize(request);
  assert.equal(h.issuedCount(), 0, 'a superseded attempt must not issue');
  assert.equal(outcome.callback.status, 'error');
  assert.ok(h.phases.includes('refresh.lateDiscarded'));
  assert.ok(h.logged.some((l) => l.category === 'superseded'));
});

test('telemetry carries only closed-set phase and category words', () => {
  const allowedPhases = new Set([
    'refresh.started', 'refresh.completed', 'refresh.failed',
    'refresh.timeout', 'refresh.lateDiscarded',
  ]);
  const allowedCategories = new Set([undefined, 'ok', 'error', 'timeout', 'superseded']);
  // Structural: the runtime's logger interpolates ONLY these two values.
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'ssoRuntime.ts'), 'utf8');
  assert.match(src, /\[sso\] \$\{phase\}\$\{category \? `: \$\{category\}` : ''\}/);
  // And the core never passes anything else.
  const core = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'ssoAuthorizationCore.ts'), 'utf8');
  for (const m of core.matchAll(/ops\.log\?\.\('([^']+)'(?:,\s*'([^']+)')?\)/g)) {
    assert.ok(allowedPhases.has(m[1]), `unexpected phase ${m[1]}`);
    assert.ok(allowedCategories.has(m[2]), `unexpected category ${m[2]}`);
  }
  assert.ok(!/ops\.log\?\.\([^)]*(token|code|state|challenge|verifier|url|claim|driverId|companyId|uid)/i.test(core));
});

test('the timeout bound is defined, bounded, and inside the far pending bound', () => {
  assert.equal(typeof SSO_VERIFIED_IDENTITY_TIMEOUT_MS, 'number');
  assert.ok(SSO_VERIFIED_IDENTITY_TIMEOUT_MS >= 5_000);
  assert.ok(SSO_VERIFIED_IDENTITY_TIMEOUT_MS + 15_000 < 45_000,
    'refresh bound + issuance bound must fit inside WB-T\'s 45s pending bound');
});

test('no automatic retry exists on any resume path', () => {
  // Comments are stripped first: the prose here deliberately DISCUSSES retry
  // and resume, and an assertion that matched its own explanation would be
  // worthless.
  const core: string = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'ssoAuthorizationCore.ts'), 'utf8');
  const code = core.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/AppState|addEventListener|setInterval|retry\(|reissue/i.test(code),
    'recovery must be a deliberate fresh attempt, never an automatic retry');
});
