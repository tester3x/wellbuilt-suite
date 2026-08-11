/**
 * Continuous outbound-handoff overlay — store + wiring acceptance.
 *
 * The corrected clearing lifecycle under test: callback launch is NOT a
 * clear (the trace shows a possible Home frame between callback launch and
 * WB-T taking foreground); only the observed AppState departure — or the
 * bounded stale timeout — may clear a callback_launched overlay. Initial
 * outbound backgrounding can never clear, because AppState clearing is
 * callback_launched-only by construction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  __resetSsoHandoffForTests,
  armSsoHandoffOutbound,
  getSsoHandoffState,
  noteSsoHandoffAppState,
  noteSsoHandoffCallbackLaunched,
  noteSsoHandoffClaim,
  noteSsoHandoffLaunchFailure,
  noteSsoHandoffTerminalError,
  noteSsoHandoffTimeoutCheck,
  SSO_HANDOFF_STALE_TIMEOUT_MS,
  ssoHandoffCopy,
  subscribeSsoHandoff,
} from './ssoHandoffOverlayStore';
import { SSO_AUDIENCE_EQUIPMENT, SSO_AUDIENCE_WBT } from './ssoProtocol.generated';

const ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('outbound arm enters opening with its audience', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 1_000);
  assert.deepEqual(getSsoHandoffState(), {
    phase: 'opening', audience: SSO_AUDIENCE_WBT, sinceMs: 1_000,
  });
});

test('initial Suite→WB-T backgrounding does NOT clear opening', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);
  noteSsoHandoffAppState('background');   // the outbound transition
  noteSsoHandoffAppState('inactive');
  assert.equal(getSsoHandoffState().phase, 'opening');
});

test('returned claim moves opening → authorizing and keeps the original sinceMs', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 5_000);
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 9_999);
  assert.deepEqual(getSsoHandoffState(), {
    phase: 'authorizing', audience: SSO_AUDIENCE_WBT, sinceMs: 5_000,
  });
});

test('callback launch enters callback_launched and does NOT clear', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 1);
  noteSsoHandoffCallbackLaunched();
  assert.equal(getSsoHandoffState().phase, 'callback_launched');
});

test('the post-callback AppState departure clears exactly once', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 1);
  noteSsoHandoffCallbackLaunched();
  const seen: string[] = [];
  const unsub = subscribeSsoHandoff((s) => seen.push(s.phase));
  noteSsoHandoffAppState('background');   // WB-T took over
  noteSsoHandoffAppState('background');   // late duplicate — must be inert
  noteSsoHandoffAppState('active');       // ordinary later Suite resume
  unsub();
  assert.equal(getSsoHandoffState().phase, 'idle');
  assert.deepEqual(seen, ['idle']);       // one clear, no further transitions
});

test('callback launched while Suite stays active keeps the overlay visible', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 1);
  noteSsoHandoffCallbackLaunched();
  noteSsoHandoffAppState('active');       // never left foreground
  assert.equal(getSsoHandoffState().phase, 'callback_launched');
});

test('timeout clears a stuck callback_launched overlay, at the bound only', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 10_000);
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 10_001);
  noteSsoHandoffCallbackLaunched();
  noteSsoHandoffTimeoutCheck(10_000 + SSO_HANDOFF_STALE_TIMEOUT_MS - 1);
  assert.equal(getSsoHandoffState().phase, 'callback_launched');
  noteSsoHandoffTimeoutCheck(10_000 + SSO_HANDOFF_STALE_TIMEOUT_MS);
  assert.equal(getSsoHandoffState().phase, 'idle');
});

test('launch failure before leaving Suite clears immediately', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);
  noteSsoHandoffLaunchFailure();
  assert.equal(getSsoHandoffState().phase, 'idle');
});

test('terminal authorize failure with no callback clears for the error UI', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 1);
  noteSsoHandoffTerminalError();
  assert.equal(getSsoHandoffState().phase, 'idle');
});

test('a terminal error cannot clear callback_launched (its endings are AppState or timeout)', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 1);
  noteSsoHandoffCallbackLaunched();
  noteSsoHandoffTerminalError();          // a later, unrelated route's failure
  assert.equal(getSsoHandoffState().phase, 'callback_launched');
});

test('a stale timer cannot clear a NEWER handoff', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 1);
  noteSsoHandoffTerminalError();          // first handoff ends
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, SSO_HANDOFF_STALE_TIMEOUT_MS - 500);
  noteSsoHandoffTimeoutCheck(SSO_HANDOFF_STALE_TIMEOUT_MS + 100); // old timer fires
  assert.equal(getSsoHandoffState().phase, 'opening'); // 600ms elapsed on the new one
});

test('repeated arms inside a live handoff cannot extend the TTL', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 1_000);
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 40_000);
  assert.equal(getSsoHandoffState().sinceMs, 1_000);
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 44_000);
  assert.equal(getSsoHandoffState().sinceMs, 1_000);
});

test('claim fallback arms only when unarmed; fresh sinceMs in that case', () => {
  __resetSsoHandoffForTests();
  noteSsoHandoffClaim(SSO_AUDIENCE_EQUIPMENT, 7_000);   // counterpart-originated
  assert.deepEqual(getSsoHandoffState(), {
    phase: 'authorizing', audience: SSO_AUDIENCE_EQUIPMENT, sinceMs: 7_000,
  });
});

// ── Order-independence of callback completion and foreground departure ────

test('ORDERING A: callback-launched (active) then inactive clears once', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 1);
  noteSsoHandoffCallbackLaunched();
  assert.equal(getSsoHandoffState().phase, 'callback_launched');
  noteSsoHandoffAppState('inactive');
  assert.equal(getSsoHandoffState().phase, 'idle');
});

test('ORDERING B: inactive while authorizing, then callback reported, clears immediately', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 1);
  noteSsoHandoffAppState('inactive');     // WB-T took over before the promise resolved
  assert.equal(getSsoHandoffState().phase, 'authorizing'); // recorded, not cleared
  noteSsoHandoffCallbackLaunched();       // departure already remembered
  assert.equal(getSsoHandoffState().phase, 'idle');
});

test('outbound inactive while opening records but does not clear or disarm', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);
  noteSsoHandoffAppState('background');   // the initial Suite→WB-T departure
  assert.equal(getSsoHandoffState().phase, 'opening');
});

test('outbound inactive, returned active, claim → still covered; callback waits for NEXT inactive', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);
  noteSsoHandoffAppState('background');   // outbound leg
  noteSsoHandoffAppState('active');       // Suite returns with the authorize
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 500);
  assert.equal(getSsoHandoffState().phase, 'authorizing');
  noteSsoHandoffCallbackLaunched();       // memory is 'active' — must WAIT
  assert.equal(getSsoHandoffState().phase, 'callback_launched');
  noteSsoHandoffAppState('inactive');     // WB-T takes over
  assert.equal(getSsoHandoffState().phase, 'idle');
});

test('the claim itself refreshes the memory — an outbound departure cannot satisfy callback time', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);
  noteSsoHandoffAppState('background');   // outbound departure REMEMBERED
  // Suite returns; suppose the host's 'active' event LOSES the race and the
  // claim processes first — the claim must reset the memory itself.
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 500);
  noteSsoHandoffCallbackLaunched();
  assert.equal(getSsoHandoffState().phase, 'callback_launched',
    'stale outbound departure must not read as "WB-T already took over"');
});

test('duplicate inactive and duplicate callback events are idempotent', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 1);
  noteSsoHandoffCallbackLaunched();
  noteSsoHandoffCallbackLaunched();       // duplicate report — inert
  noteSsoHandoffAppState('inactive');
  noteSsoHandoffAppState('inactive');     // duplicate departure — inert
  noteSsoHandoffCallbackLaunched();       // late duplicate from idle — inert
  assert.equal(getSsoHandoffState().phase, 'idle');
});

test('a PRIOR handoff\'s departure cannot clear a newer arm at callback time', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 1);
  noteSsoHandoffCallbackLaunched();
  noteSsoHandoffAppState('background');   // handoff #1 completes; memory=background
  assert.equal(getSsoHandoffState().phase, 'idle');
  // Driver returns and taps again — fresh arm must reset the memory.
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 60_000);
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 60_100);
  noteSsoHandoffCallbackLaunched();
  assert.equal(getSsoHandoffState().phase, 'callback_launched',
    'must wait for a NEW departure, not consume the previous handoff\'s');
});

test('initialization seeding: a non-active seed before any handoff is harmless', () => {
  __resetSsoHandoffForTests();
  noteSsoHandoffAppState('background');   // host seeds while Suite backgrounded
  assert.equal(getSsoHandoffState().phase, 'idle');
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);   // fresh arm resets memory
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 1);
  noteSsoHandoffCallbackLaunched();
  assert.equal(getSsoHandoffState().phase, 'callback_launched');
});

test('timeout still clears callback_launched when the foreground never transfers', () => {
  __resetSsoHandoffForTests();
  armSsoHandoffOutbound(SSO_AUDIENCE_WBT, 0);
  noteSsoHandoffClaim(SSO_AUDIENCE_WBT, 1);
  noteSsoHandoffCallbackLaunched();       // Suite stays active forever
  noteSsoHandoffTimeoutCheck(SSO_HANDOFF_STALE_TIMEOUT_MS);
  assert.equal(getSsoHandoffState().phase, 'idle');
});

test('audience copy is total and audience-aware', () => {
  assert.match(ssoHandoffCopy('opening', SSO_AUDIENCE_WBT), /Opening WellBuilt Tickets/);
  assert.match(ssoHandoffCopy('authorizing', SSO_AUDIENCE_WBT), /Authorizing WellBuilt Tickets/);
  assert.match(ssoHandoffCopy('callback_launched', SSO_AUDIENCE_EQUIPMENT), /WellBuilt eQuipment/);
  assert.match(ssoHandoffCopy('opening', null), /WellBuilt app/);
});

// ── Wiring assertions (source-level, same discipline as WB-T's harnesses) ──

test('outbound launch arms BEFORE openURL, with one committed frame between', () => {
  const src = strip(read('src/core/hooks/useAppLauncher.ts'));
  const arm = src.indexOf('armSsoHandoffOutbound(SSO_AUDIENCE_WBT');
  const frame = src.indexOf('requestAnimationFrame');
  const launch = src.indexOf('launchWBApp({ ...options, sso: undefined');
  assert.ok(arm > -1 && frame > -1 && launch > -1);
  assert.ok(arm < frame && frame < launch, 'arm → frame → openURL order');
});

test('the overlay is mounted above the router Stack', () => {
  const src = read('app/_layout.tsx');
  const stack = src.indexOf('<Stack');
  const overlay = src.indexOf('<SsoHandoffOverlay />');
  assert.ok(stack > -1 && overlay > -1 && overlay > stack,
    'rendered after <Stack> = drawn above every screen');
});

test('the store has no path to issuance, dispatch, retry, or route ownership', () => {
  const src = strip(read('src/core/services/ssoHandoffOverlayStore.ts'));
  assert.ok(!/requestCode|issuance|httpsCallable|openURL|adapter|handle\(|retry/i.test(src));
  // Module specifiers appearing ANYWHERE in the file — multi-line imports
  // included. The only external module the store may know is the protocol.
  assert.match(src, /from '\.\/ssoProtocol\.generated'/);
  assert.ok(!/from '\.\/(ssoRuntime|ssoRouteAdapter|ssoIssuanceClient|appLauncher)'/.test(src));
});

test('the overlay component is visual-only by its imports', () => {
  const src = strip(read('src/core/components/SsoHandoffOverlay.tsx'));
  assert.ok(!/ssoRuntime|ssoRouteAdapter|ssoIssuanceClient|appLauncher/.test(src));
  assert.ok(!/from 'react-native'.*Linking|Linking.*from 'react-native'/.test(
    src.split('\n').find((l) => l.includes("from 'react-native'")) ?? ''));
});

test('runtime maps route results without awaiting the overlay', () => {
  const src = strip(read('src/core/services/ssoRuntime.ts'));
  assert.match(src, /noteSsoHandoffClaim\(parsed\.value\.audience/);
  assert.match(src, /noteSsoHandoffCallbackLaunched\(\)/);
  assert.match(src, /noteSsoHandoffTerminalError\(\)/);
  assert.ok(!/await noteSsoHandoff/.test(src), 'overlay calls are never awaited');
});
