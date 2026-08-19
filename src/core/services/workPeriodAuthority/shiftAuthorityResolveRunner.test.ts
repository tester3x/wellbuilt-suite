/**
 * Issued resolve commands always terminalize. Injected promises only.
 * No path claims or mutates a shift.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAuthoritySessionMachine,
  reduceAuthoritySession,
  initialAuthoritySessionState,
} from './shiftAuthoritySessionSequencer';
import { issuedResolveToken, terminalizeIssuedResolve } from './shiftAuthorityResolveRunner';
import { observeRevalidation, REVALIDATION_FAILED_UI } from './revalidationFailClosed';
import { reduceSsoInbox, initialSsoInboxState } from '../ssoAuthorizeInbox';
import { mayOpenStartShiftChecklist } from './postLoginShiftRestoration';

const root = join(__dirname, '..', '..', '..', '..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');
const AUTH = 'wellbuilt-suite://sso-authorize?v=1&aud=wellbuilt-tickets&cc=ccc&ccm=S256&state=sss';

function machineAfterReady() {
  const m = createAuthoritySessionMachine();
  m.dispatch({ type: 'cold_start' });
  const ready = m.dispatch({ type: 'session_ready' });
  const token = issuedResolveToken(ready.commands);
  assert.ok(token !== null);
  return { m, token };
}

test('thrown restore releases the in-flight token as transient_failure', async () => {
  const { m, token } = machineAfterReady();
  const out = await terminalizeIssuedResolve({
    machine: m,
    token,
    isCurrent: () => true,
    restore: async () => {
      throw new Error('network');
    },
  });
  assert.equal(m.peek().inFlightToken, null);
  assert.equal(out.terminal.kind, 'unavailable');
  assert.equal(mayOpenStartShiftChecklist(m.peek().ui), false);
  const retry = m.dispatch({ type: 'retry' });
  assert.equal(retry.commands.length, 1);
  assert.equal(retry.commands[0]?.token, 2);
});

test('current-generation null result becomes transient failure', async () => {
  const { m, token } = machineAfterReady();
  const out = await terminalizeIssuedResolve({
    machine: m,
    token,
    isCurrent: () => true,
    restore: async () => null,
  });
  assert.equal(m.peek().inFlightToken, null);
  assert.equal(out.terminal.kind, 'unavailable');
  assert.equal(mayOpenStartShiftChecklist(m.peek().ui), false);
});

test('one retry after transient failure emits exactly one resolve', async () => {
  const { m, token } = machineAfterReady();
  await terminalizeIssuedResolve({
    machine: m,
    token,
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

test('stale generation does not apply UI and does not block a newer token', async () => {
  const { m, token } = machineAfterReady();
  const out = await terminalizeIssuedResolve({
    machine: m,
    token,
    isCurrent: () => false,
    restore: async () => ({ kind: 'none' }),
  });
  assert.equal(out.applyUi, false);
  assert.equal(out.terminal.kind, 'abandoned_stale');
  assert.equal(m.peek().inFlightToken, null);
});

test('stale success cannot overwrite a newer generation success', async () => {
  const m = createAuthoritySessionMachine();
  m.dispatch({ type: 'cold_start' });
  m.dispatch({ type: 'session_ready' });
  await terminalizeIssuedResolve({
    machine: m,
    token: 1,
    isCurrent: () => true,
    restore: async () => ({ kind: 'none' }),
  });
  assert.equal(m.peek().ui.kind, 'none');
  const stale = await terminalizeIssuedResolve({
    machine: m,
    token: 1,
    isCurrent: () => true,
    restore: async () => ({ kind: 'unavailable', reason: 'late' }),
  });
  assert.equal(stale.applyUi, false);
  assert.equal(m.peek().ui.kind, 'none');
});

test('rejected revalidation fails closed and cannot produce Start Shift', async () => {
  const obs = await observeRevalidation(async () => {
    throw new Error('unexpected');
  });
  assert.equal(obs.outcome, 'failed');
  assert.equal(obs.cause, 'rejected');
  let state = reduceAuthoritySession(initialAuthoritySessionState, { type: 'cold_start' });
  state = reduceAuthoritySession(state.state, { type: 'session_failed' });
  assert.equal(state.state.ui.kind, 'unavailable');
  assert.equal(state.state.ui.reason, 'revalidation_failed');
  assert.equal(mayOpenStartShiftChecklist(state.state.ui), false);
  assert.deepEqual(state.state.ui, REVALIDATION_FAILED_UI);
});

test('rejected revalidation clears a queued authorize and cannot issue', async () => {
  let inbox = reduceSsoInbox(initialSsoInboxState, {
    type: 'deliver',
    url: AUTH,
    path: 'runtime',
  });
  assert.equal(inbox.state.queued, AUTH);
  const failed = reduceSsoInbox(inbox.state, { type: 'session', gate: 'failed' });
  assert.equal(failed.state.queued, null);
  assert.ok(failed.commands.some((c) => c.cmd === 'reject_closed'));
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
  assert.equal(a.cause, 'false');
  assert.equal(b.cause, 'rejected');
});

test('logout during in-flight authorize cannot deliver a callback', async () => {
  const queued = reduceSsoInbox(initialSsoInboxState, {
    type: 'deliver',
    url: AUTH,
    path: 'runtime',
  });
  const reset = reduceSsoInbox(queued.state, { type: 'reset' });
  assert.equal(reset.state.queued, null);
  const ready = reduceSsoInbox(reset.state, { type: 'session', gate: 'ready' });
  assert.equal(ready.commands.filter((c) => c.cmd === 'dispatch').length, 0);
});

test('runner never claims or mutates a shift', () => {
  const file = src('src/core/services/workPeriodAuthority/shiftAuthorityResolveRunner.ts');
  assert.ok(!file.includes('claimEnforcedExplicitStart'));
  assert.ok(!file.includes('claimDriverShift'));
  assert.ok(!/\.claim\(/.test(file));
});
