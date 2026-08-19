/**
 * Issued resolve commands always terminalize. Injected promises only.
 * Models the reset + token-reuse race against the shipped runner+machine.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAuthoritySessionMachine,
} from './shiftAuthoritySessionSequencer';
import { issuedResolveLease, terminalizeIssuedResolve } from './shiftAuthorityResolveRunner';
import {
  observeRevalidation,
  REVALIDATION_FAILED_UI,
  runUncertainSessionFailClosed,
  uncertainSessionFailClosedMemory,
} from './revalidationFailClosed';
import { reduceSsoInbox, initialSsoInboxState } from '../ssoAuthorizeInbox';
import { reduceAuthoritySession, initialAuthoritySessionState } from './shiftAuthoritySessionSequencer';

const root = join(__dirname, '..', '..', '..', '..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');
const AUTH = 'wellbuilt-suite://sso-authorize?v=1&aud=wellbuilt-tickets&cc=ccc&ccm=S256&state=sss';

function mayOpenStartShiftChecklist(ui: { kind: string }): boolean {
  return ui.kind === 'none' || ui.kind === 'legacy';
}

function machineAfterReady() {
  const m = createAuthoritySessionMachine();
  m.dispatch({ type: 'cold_start' });
  const ready = m.dispatch({ type: 'session_ready' });
  const lease = issuedResolveLease(ready.commands);
  assert.ok(lease);
  return { m, lease };
}

function deferRestore() {
  let finish: (ui: { kind: 'none' } | { kind: 'open'; periodId: string; originLocalDate: string } | { kind: 'unavailable'; reason: string } | null) => void;
  let fail: (err: Error) => void;
  const promise = new Promise<any>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  return {
    restore: () => promise,
    resolve: (ui: any) => finish(ui),
    reject: (err: Error) => fail(err),
  };
}

test('thrown restore releases the in-flight lease as transient_failure', async () => {
  const { m, lease } = machineAfterReady();
  const out = await terminalizeIssuedResolve({
    machine: m,
    lease,
    isCurrent: () => true,
    restore: async () => {
      throw new Error('network');
    },
  });
  assert.equal(m.peek().inFlight, null);
  assert.equal(out.terminal.kind, 'unavailable');
  assert.equal(mayOpenStartShiftChecklist(m.peek().ui), false);
  const retry = m.dispatch({ type: 'retry' });
  assert.equal(retry.commands.length, 1);
  assert.equal(retry.commands[0]?.token, 2);
});

test('current-generation null result becomes transient failure', async () => {
  const { m, lease } = machineAfterReady();
  const out = await terminalizeIssuedResolve({
    machine: m,
    lease,
    isCurrent: () => true,
    restore: async () => null,
  });
  assert.equal(m.peek().inFlight, null);
  assert.equal(out.terminal.kind, 'unavailable');
  assert.equal(mayOpenStartShiftChecklist(m.peek().ui), false);
});

test('one retry after transient failure emits exactly one resolve', async () => {
  const { m, lease } = machineAfterReady();
  await terminalizeIssuedResolve({
    machine: m,
    lease,
    isCurrent: () => true,
    restore: async () => {
      throw new Error('boom');
    },
  });
  const retry = m.dispatch({ type: 'retry' });
  assert.equal(retry.commands.filter((c) => c.cmd === 'resolve').length, 1);
  const simultaneous = m.dispatch({ type: 'retry' });
  assert.equal(simultaneous.commands.length, 0);
});

test('stale generation does not apply UI and does not block a newer lease', async () => {
  const { m, lease } = machineAfterReady();
  const out = await terminalizeIssuedResolve({
    machine: m,
    lease,
    isCurrent: () => false,
    restore: async () => ({ kind: 'none' }),
  });
  assert.equal(out.applyUi, false);
  assert.equal(out.terminal.kind, 'abandoned_stale');
});

async function raceOldRestore(kind: 'none' | 'open' | 'unavailable' | 'null' | 'reject') {
  const m = createAuthoritySessionMachine();
  m.dispatch({ type: 'cold_start' });
  const oldReady = m.dispatch({ type: 'session_ready' });
  const oldLease = issuedResolveLease(oldReady.commands);
  assert.ok(oldLease);
  let current = true;
  const pending = deferRestore();
  const oldRun = terminalizeIssuedResolve({
    machine: m,
    lease: oldLease,
    isCurrent: () => current,
    restore: pending.restore,
  });
  m.dispatch({ type: 'reset' });
  current = false;
  const newReady = m.dispatch({ type: 'session_ready' });
  const newLease = issuedResolveLease(newReady.commands);
  assert.ok(newLease);
  assert.notEqual(`${oldLease.generation}:${oldLease.token}`, `${newLease.generation}:${newLease.token}`);
  const uiBefore = m.peek().ui;
  const inFlightBefore = m.peek().inFlight;
  if (kind === 'reject') pending.reject(new Error('old'));
  else if (kind === 'null') pending.resolve(null);
  else if (kind === 'open') {
    pending.resolve({ kind: 'open', periodId: 'old', originLocalDate: '2026-08-19' });
  } else if (kind === 'unavailable') {
    pending.resolve({ kind: 'unavailable', reason: 'old' });
  } else {
    pending.resolve({ kind: 'none' });
  }
  const stale = await oldRun;
  assert.equal(stale.applyUi, false);
  assert.equal(m.peek().ui.kind, uiBefore.kind);
  assert.deepEqual(m.peek().inFlight, inFlightBefore);
  const fresh = await terminalizeIssuedResolve({
    machine: m,
    lease: newLease,
    isCurrent: () => true,
    restore: async () => ({ kind: 'none' }),
  });
  assert.equal(fresh.terminal.kind, 'none');
  assert.equal(m.peek().ui.kind, 'none');
  assert.equal(mayOpenStartShiftChecklist(m.peek().ui), true);
}

test('old pending restore success cannot steal new generation token 1', async () => {
  await raceOldRestore('none');
});
test('old pending restore open cannot steal new resolve', async () => {
  await raceOldRestore('open');
});
test('old pending restore unavailable cannot steal new resolve', async () => {
  await raceOldRestore('unavailable');
});
test('old pending restore null cannot steal new resolve', async () => {
  await raceOldRestore('null');
});
test('old pending restore rejection cannot steal new resolve', async () => {
  await raceOldRestore('reject');
});

test('stale finally cannot clear a new in-flight resolve', async () => {
  const m = createAuthoritySessionMachine();
  m.dispatch({ type: 'cold_start' });
  const oldReady = m.dispatch({ type: 'session_ready' });
  const oldLease = issuedResolveLease(oldReady.commands)!;
  m.dispatch({ type: 'reset' });
  const newReady = m.dispatch({ type: 'session_ready' });
  const newLease = issuedResolveLease(newReady.commands)!;
  await terminalizeIssuedResolve({
    machine: m,
    lease: oldLease,
    isCurrent: () => false,
    restore: async () => ({ kind: 'none' }),
  });
  assert.deepEqual(m.peek().inFlight, newLease);
});

test('stale failure cannot overwrite new success', async () => {
  const { m, lease } = machineAfterReady();
  await terminalizeIssuedResolve({
    machine: m,
    lease,
    isCurrent: () => true,
    restore: async () => ({ kind: 'none' }),
  });
  await terminalizeIssuedResolve({
    machine: m,
    lease,
    isCurrent: () => true,
    restore: async () => {
      throw new Error('late');
    },
  });
  assert.equal(m.peek().ui.kind, 'none');
});

test('stale success cannot overwrite new failure', async () => {
  const m = createAuthoritySessionMachine();
  m.dispatch({ type: 'cold_start' });
  const first = issuedResolveLease(m.dispatch({ type: 'session_ready' }).commands)!;
  await terminalizeIssuedResolve({
    machine: m,
    lease: first,
    isCurrent: () => true,
    restore: async () => {
      throw new Error('fail');
    },
  });
  assert.equal(m.peek().ui.kind, 'unavailable');
  await terminalizeIssuedResolve({
    machine: m,
    lease: first,
    isCurrent: () => true,
    restore: async () => ({ kind: 'none' }),
  });
  assert.equal(m.peek().ui.kind, 'unavailable');
});

test('rejected revalidation fails closed and cannot produce Start Shift', async () => {
  const obs = await observeRevalidation(async () => {
    throw new Error('unexpected');
  });
  assert.equal(obs.outcome, 'failed');
  let state = reduceAuthoritySession(initialAuthoritySessionState, { type: 'cold_start' });
  state = reduceAuthoritySession(state.state, { type: 'session_failed' });
  assert.equal(state.state.ui.kind, 'unavailable');
  assert.equal(mayOpenStartShiftChecklist(state.state.ui), false);
  assert.deepEqual(state.state.ui, REVALIDATION_FAILED_UI);
});

test('rejected revalidation clears a queued authorize and cannot issue', async () => {
  const queued = reduceSsoInbox(initialSsoInboxState, {
    type: 'deliver',
    url: AUTH,
    path: 'runtime',
  });
  const failed = reduceSsoInbox(queued.state, { type: 'session', gate: 'failed' });
  assert.equal(failed.state.queued, null);
  const later = reduceSsoInbox(failed.state, { type: 'session', gate: 'ready' });
  assert.equal(later.commands.filter((c) => c.cmd === 'dispatch').length, 0);
});

test('false revalidation uses the same fail-closed transition as rejection', async () => {
  const a = await observeRevalidation(async () => false);
  const b = await observeRevalidation(async () => {
    throw new Error('x');
  });
  assert.equal(a.outcome, 'failed');
  assert.equal(b.outcome, 'failed');
});

test('logout during in-flight authorize cannot deliver a callback', async () => {
  const queued = reduceSsoInbox(initialSsoInboxState, {
    type: 'deliver',
    url: AUTH,
    path: 'runtime',
  });
  const reset = reduceSsoInbox(queued.state, { type: 'reset' });
  const ready = reduceSsoInbox(reset.state, { type: 'session', gate: 'ready' });
  assert.equal(ready.commands.filter((c) => c.cmd === 'dispatch').length, 0);
});

test('cleanup success leaves the app failed closed', async () => {
  const mem = { user: 'MikeS24' as string | null, shiftActive: true, ui: { kind: 'open' } as { kind: string } };
  const inbox = reduceSsoInbox(initialSsoInboxState, { type: 'deliver', url: AUTH, path: 'runtime' });
  let inboxState = inbox.state;
  const result = await runUncertainSessionFailClosed({
    applyMemory: () => {
      const snap = uncertainSessionFailClosedMemory();
      mem.user = snap.user;
      mem.shiftActive = snap.shiftActive;
      mem.ui = snap.shiftAuthorityUi;
      inboxState = reduceSsoInbox(inboxState, { type: 'session', gate: 'failed' }).state;
    },
    cleanup: async () => {},
  });
  assert.equal(result, 'cleanup_ok');
  assert.equal(mem.user, null);
  assert.equal(mem.shiftActive, false);
  assert.equal(mayOpenStartShiftChecklist(mem.ui), false);
  assert.equal(inboxState.queued, null);
});

test('cleanup rejection also leaves the app failed closed', async () => {
  const mem = { user: 'MikeS24' as string | null, shiftActive: true, ui: { kind: 'checking' } as { kind: string } };
  let inboxState = reduceSsoInbox(initialSsoInboxState, { type: 'deliver', url: AUTH, path: 'runtime' }).state;
  const ops: string[] = [];
  const result = await runUncertainSessionFailClosed({
    applyMemory: () => {
      const snap = uncertainSessionFailClosedMemory();
      mem.user = snap.user;
      mem.shiftActive = snap.shiftActive;
      mem.ui = snap.shiftAuthorityUi;
      inboxState = reduceSsoInbox(inboxState, { type: 'session', gate: 'failed' }).state;
    },
    cleanup: async () => {
      ops.push('cleanup');
      throw new Error('SecureStore');
    },
  });
  assert.equal(result, 'cleanup_failed');
  assert.equal(mem.user, null);
  assert.equal(mem.shiftActive, false);
  assert.equal(mayOpenStartShiftChecklist(mem.ui), false);
  assert.equal(inboxState.queued, null);
  assert.ok(!ops.includes('claim') && !ops.includes('close'));
});

test('cleanup rejection cannot drain a queued authorize after fail-closed', async () => {
  let inboxState = reduceSsoInbox(initialSsoInboxState, { type: 'deliver', url: AUTH, path: 'runtime' }).state;
  await runUncertainSessionFailClosed({
    applyMemory: () => {
      inboxState = reduceSsoInbox(inboxState, { type: 'session', gate: 'failed' }).state;
    },
    cleanup: async () => {
      throw new Error('SecureStore');
    },
  });
  const later = reduceSsoInbox(inboxState, { type: 'session', gate: 'ready' });
  assert.equal(later.commands.filter((c) => c.cmd === 'dispatch').length, 0);
});

test('runner never claims or mutates a shift', () => {
  const file = src('src/core/services/workPeriodAuthority/shiftAuthorityResolveRunner.ts');
  assert.ok(!file.includes('claimEnforcedExplicitStart'));
  assert.ok(!file.includes('claimDriverShift'));
  assert.ok(!/\.claim\(/.test(file));
});
