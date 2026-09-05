/**
 * Shift-authority vs secure-session sequencing.
 * No test path claims, starts, ends, or mutates a shift.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyAuthorityResolveUi,
  initialAuthoritySessionState,
  reduceAuthoritySession,
  type AuthoritySessionState,
} from './shiftAuthoritySessionSequencer';

function mayOpenStartShiftChecklist(ui: {
  kind: string;
  periodId?: string;
  originLocalDate?: string;
}): boolean {
  return ui.kind === 'none' || ui.kind === 'legacy';
}

function restoreActionToUiState(action: {
  kind: string;
  periodId?: string;
  originLocalDate?: string;
}): { kind: string; periodId?: string; originLocalDate?: string } {
  if (action.kind === 'restore_active' && action.periodId) {
    return {
      kind: 'open',
      periodId: action.periodId,
      originLocalDate: action.originLocalDate || '',
    };
  }
  if (action.kind === 'inactive_allow_start') return { kind: 'none' };
  return { kind: 'unavailable' };
}

function mapServerResolveToRestoreAction(resolved: {
  state: string;
  periodId?: string;
  originLocalDate?: string;
  protocolVersion?: number;
}): { kind: string; periodId?: string; originLocalDate?: string } {
  if (resolved.state === 'open') {
    return {
      kind: 'restore_active',
      periodId: resolved.periodId,
      originLocalDate: resolved.originLocalDate,
    };
  }
  return { kind: 'inactive_allow_start' };
}

const root = join(__dirname, '..', '..', '..', '..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

function fold(events: Parameters<typeof reduceAuthoritySession>[1][]) {
  let state: AuthoritySessionState = { ...initialAuthoritySessionState };
  let lastCommands: ReturnType<typeof reduceAuthoritySession>['commands'] = [];
  let resolveCount = 0;
  for (const event of events) {
    const r = reduceAuthoritySession(state, event);
    state = r.state;
    lastCommands = r.commands;
    resolveCount += r.commands.filter((c) => c.cmd === 'resolve').length;
  }
  return { state, lastCommands, resolveCount };
}

test('authority resolution waits for secure-session readiness', () => {
  const r = fold([{ type: 'cold_start' }]);
  assert.equal(r.state.session, 'pending');
  assert.equal(r.state.ui.kind, 'checking');
  assert.equal(r.resolveCount, 0);
  assert.equal(r.lastCommands.length, 0);
});

test('no authority call occurs while revalidation is pending', () => {
  const r = fold([{ type: 'cold_start' }, { type: 'retry' }]);
  assert.equal(r.resolveCount, 0);
  assert.equal(r.state.ui.kind, 'checking');
  assert.equal(mayOpenStartShiftChecklist(r.state.ui), false);
});

test('successful revalidation causes one authority resolution', () => {
  const r = fold([{ type: 'cold_start' }, { type: 'session_ready' }]);
  assert.equal(r.resolveCount, 1);
  assert.equal(r.lastCommands[0]?.cmd, 'resolve');
  assert.equal(r.lastCommands[0]?.token, 1);
  assert.equal(r.lastCommands[0]?.generation, r.state.generation);
  assert.equal(r.state.ui.kind, 'checking');
});

test('an early driver_session_required result is recoverable after readiness', () => {
  // Original race: resolve flew before session_ready, got driver_session_required.
  const state: AuthoritySessionState = {
    ...initialAuthoritySessionState,
    generation: 1,
    inFlight: { generation: 1, token: 1 },
    nextToken: 2,
  };
  const earlyFail = reduceAuthoritySession(state, {
    type: 'resolve_result',
    generation: 1,
    token: 1,
    result: 'driver_session_required',
  });
  assert.equal(earlyFail.state.ui.kind, 'checking');
  assert.equal(earlyFail.state.session, 'pending');
  assert.equal(mayOpenStartShiftChecklist(earlyFail.state.ui), false);
  const afterReady = reduceAuthoritySession(earlyFail.state, { type: 'session_ready' });
  assert.equal(afterReady.commands.length, 1);
  assert.equal(afterReady.commands[0]?.cmd, 'resolve');
  const success = reduceAuthoritySession(afterReady.state, {
    type: 'resolve_result',
    generation: afterReady.commands[0].generation,
    token: afterReady.commands[0].token,
    result: 'none',
  });
  assert.equal(success.state.ui.kind, 'none');
  assert.equal(mayOpenStartShiftChecklist(success.state.ui), true);
});

test('multiple readiness signals still produce one effective resolution', () => {
  const first = fold([{ type: 'cold_start' }, { type: 'session_ready' }]);
  const second = reduceAuthoritySession(first.state, { type: 'session_ready' });
  assert.equal(first.resolveCount, 1);
  assert.equal(second.commands.length, 0);
  const after = reduceAuthoritySession(first.state, {
    type: 'resolve_result',
    generation: 1,
    token: 1,
    result: 'none',
  });
  const third = reduceAuthoritySession(after.state, { type: 'session_ready' });
  assert.equal(third.commands.length, 0);
  assert.equal(after.state.ui.kind, 'none');
});

test('a stale early failure cannot overwrite a later success', () => {
  const ready = fold([{ type: 'cold_start' }, { type: 'session_ready' }]);
  const success = reduceAuthoritySession(ready.state, {
    type: 'resolve_result',
    generation: 1,
    token: 1,
    result: 'none',
  });
  assert.equal(success.state.ui.kind, 'none');
  const stale = reduceAuthoritySession(success.state, {
    type: 'resolve_result',
    generation: 1,
    token: 1,
    result: 'driver_session_required',
  });
  assert.equal(stale.applyUi, false);
  assert.equal(stale.state.ui.kind, 'none');
  const older = reduceAuthoritySession(success.state, {
    type: 'resolve_result',
    generation: 1,
    token: 0,
    result: 'transient_failure',
  });
  assert.equal(older.applyUi, false);
  assert.equal(older.state.ui.kind, 'none');
});

test('valid session plus no open shift produces Start Shift', () => {
  const action = mapServerResolveToRestoreAction({ state: 'none' });
  const ui = restoreActionToUiState(action);
  assert.equal(ui.kind, 'none');
  assert.equal(mayOpenStartShiftChecklist(ui), true);
  const r = fold([
    { type: 'cold_start' },
    { type: 'session_ready' },
    { type: 'resolve_result', generation: 1, token: 1, result: 'none' },
  ]);
  assert.equal(r.state.ui.kind, 'none');
  assert.equal(mayOpenStartShiftChecklist(r.state.ui), true);
});

test('valid session plus open shift restores active-shift UI', () => {
  const action = mapServerResolveToRestoreAction({
    state: 'open',
    periodId: '2026-08-19_010203',
    originLocalDate: '2026-08-19',
    protocolVersion: 1,
  });
  const ui = restoreActionToUiState(action);
  assert.equal(ui.kind, 'open');
  if (ui.kind === 'open') {
    assert.equal(ui.periodId, '2026-08-19_010203');
  }
  assert.equal(mayOpenStartShiftChecklist(ui), false);
  const r = fold([
    { type: 'cold_start' },
    { type: 'session_ready' },
    {
      type: 'resolve_result',
      generation: 1,
      token: 1,
      result: 'open',
      open: { periodId: '2026-08-19_010203', originLocalDate: '2026-08-19' },
    },
  ]);
  assert.equal(r.state.ui.kind, 'open');
  assert.equal(mayOpenStartShiftChecklist(r.state.ui), false);
});

test('failed revalidation remains fail-closed', () => {
  const r = fold([{ type: 'cold_start' }, { type: 'session_failed' }]);
  assert.equal(r.state.session, 'failed');
  assert.equal(r.state.ui.kind, 'unavailable');
  if (r.state.ui.kind === 'unavailable') {
    assert.equal(r.state.ui.reason, 'revalidation_failed');
  }
  assert.equal(mayOpenStartShiftChecklist(r.state.ui), false);
  const retry = reduceAuthoritySession(r.state, { type: 'retry' });
  assert.equal(retry.commands.length, 0);
  assert.equal(retry.state.ui.kind, 'unavailable');
});

test('a genuine transient authority failure can recover through retry', () => {
  const failed = fold([
    { type: 'cold_start' },
    { type: 'session_ready' },
    { type: 'resolve_result', generation: 1, token: 1, result: 'transient_failure' },
  ]);
  assert.equal(failed.state.ui.kind, 'unavailable');
  assert.equal(mayOpenStartShiftChecklist(failed.state.ui), false);
  const retry = reduceAuthoritySession(failed.state, { type: 'retry' });
  assert.equal(retry.commands.length, 1);
  const recovered = reduceAuthoritySession(retry.state, {
    type: 'resolve_result',
    generation: retry.commands[0].generation,
    token: retry.commands[0].token,
    result: 'none',
  });
  assert.equal(recovered.state.ui.kind, 'none');
  assert.equal(mayOpenStartShiftChecklist(recovered.state.ui), true);
});

test('classifyAuthorityResolveUi maps unavailable session errors', () => {
  assert.equal(classifyAuthorityResolveUi({ kind: 'none' }), 'none');
  assert.equal(
    classifyAuthorityResolveUi({ kind: 'open', periodId: 'p', originLocalDate: 'd' }),
    'open',
  );
  assert.equal(
    classifyAuthorityResolveUi({ kind: 'unavailable', reason: 'driver_session_required' }),
    'driver_session_required',
  );
  assert.equal(
    classifyAuthorityResolveUi({ kind: 'unavailable', reason: 'refresh_failed' }),
    'transient_failure',
  );
});

test('no sequencer path claims or mutates a shift', () => {
  const seq = src('src/core/services/workPeriodAuthority/shiftAuthoritySessionSequencer.ts');
  assert.ok(!seq.includes('client.claim'));
  assert.ok(!seq.includes('claimEnforcedExplicitStart'));
  assert.ok(!seq.includes('claimDriverShift'));
  assert.ok(!seq.includes('closeEnforcedExplicit'));
  assert.ok(!/\.claim\(/.test(seq));
});

test('wiring: cold-start restore waits for revalidateDriverSession', () => {
  const auth = src('src/core/context/AuthContext.tsx');
  const mount = auth.slice(
    auth.indexOf('// On mount: check SecureStore'),
    auth.indexOf('const login = useCallback'),
  );
  assert.ok(mount.includes('revalidateDriverSession'));
  assert.ok(mount.includes('postLoginEnforcedRestore'));
  assert.ok(mount.includes('createAuthoritySessionMachine') || mount.includes('authoritySessionRef'));
  assert.ok(
    mount.indexOf('revalidateDriverSession') < mount.indexOf('postLoginEnforcedRestore'),
    'restore must run after revalidation begins',
  );
  assert.ok(
    !/void \(async \(\) => \{[\s\S]*postLoginEnforcedRestore[\s\S]*\}\)\(\);\s*\n\s*revalidateDriverSession/.test(mount),
    'must not launch restore in parallel with revalidation',
  );
});

test('none produces Start Shift availability and open does not', () => {
  assert.equal(mayOpenStartShiftChecklist({ kind: 'none' }), true);
  assert.equal(
    mayOpenStartShiftChecklist({ kind: 'open', periodId: 'p', originLocalDate: 'd' }),
    false,
  );
  assert.equal(mayOpenStartShiftChecklist({ kind: 'checking' }), false);
});

test('stale resolve cannot overwrite a newer success', () => {
  const ready = fold([{ type: 'cold_start' }, { type: 'session_ready' }]);
  const success = reduceAuthoritySession(ready.state, {
    type: 'resolve_result',
    generation: 1,
    token: 1,
    result: 'none',
  });
  assert.equal(success.state.ui.kind, 'none');
  const stale = reduceAuthoritySession(success.state, {
    type: 'resolve_result',
    generation: 1,
    token: 1,
    result: 'transient_failure',
  });
  assert.equal(stale.state.ui.kind, 'none');
  assert.equal(mayOpenStartShiftChecklist(stale.state.ui), true);
});

test('reset cannot reuse an ownership identity', () => {
  const first = fold([{ type: 'cold_start' }, { type: 'session_ready' }]);
  const firstLease = first.lastCommands[0];
  const reset = reduceAuthoritySession(first.state, { type: 'reset' });
  assert.equal(reset.state.inFlight, null);
  assert.ok(reset.state.generation > first.state.generation);
  assert.equal(reset.state.nextToken, first.state.nextToken);
  const ready = reduceAuthoritySession(reset.state, { type: 'session_ready' });
  const second = ready.commands[0];
  assert.ok(second);
  assert.notEqual(
    `${firstLease.generation}:${firstLease.token}`,
    `${second.generation}:${second.token}`,
  );
});

test('repeated cold_start cannot reuse an ownership identity', () => {
  const a = fold([{ type: 'cold_start' }, { type: 'session_ready' }]);
  const b = reduceAuthoritySession(a.state, { type: 'cold_start' });
  const c = reduceAuthoritySession(b.state, { type: 'session_ready' });
  assert.notEqual(
    `${a.lastCommands[0].generation}:${a.lastCommands[0].token}`,
    `${c.commands[0].generation}:${c.commands[0].token}`,
  );
  assert.ok(c.commands[0].token > a.lastCommands[0].token);
});

test('sequencer never uses hash-only identity fallback', () => {
  const seq = src('src/core/services/workPeriodAuthority/shiftAuthoritySessionSequencer.ts');
  assert.ok(!/passcodeHash|hashOnly|hash-only|legacyHash/.test(seq));
});

test('wiring: logout resets inbox generation and SSO epoch', () => {
  const auth = src('src/core/context/AuthContext.tsx');
  assert.ok(auth.includes("bumpAuthorityGeneration('logout')"));
  assert.ok(auth.includes('resetLiveSsoAuthorizeInbox'));
  assert.ok(auth.includes('bumpSsoIdentityEpoch'));
  // Logout drives the terminal-fail through composite readiness — the bridge
  // publishes the failed gate to the inbox — rather than a direct gate write.
  assert.ok(auth.includes("reportSsoRevalidation(readinessGenRef.current, 'failed')"));
  assert.ok(auth.includes('createCompositeReadinessBridge'));
});

test('wiring: revalidation rejection uses shared fail-closed, not keep-session', () => {
  const auth = src('src/core/context/AuthContext.tsx');
  assert.ok(auth.includes('observeRevalidation'));
  assert.ok(auth.includes('failClosedUncertainSession'));
  assert.ok(!auth.includes('Background revalidation error (keeping session)'));
  assert.ok(auth.includes('hardFailRevalidationCleanup'));
  assert.ok(auth.includes('terminalizeIssuedResolve'));
});
