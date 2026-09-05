/**
 * End Shift vs. DVIR-obligation routing (P0 reframe) — failing-first coverage.
 *
 * A shift is paid work time; the vehicle/DVIR (Post-Trip) obligation is a
 * separate lifecycle. These tests pin the pure routing decision, the direct
 * close orchestration, and the real Suite action/routing seams.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decideEndShiftRoute,
  performEndShiftDirectClose,
  type EndShiftRouteInput,
  type EndShiftDirectCloseDeps,
} from './endShiftDvirRouting.js';

const PERIOD = '2026-09-05_070000';

function routeInput(over: Partial<EndShiftRouteInput> = {}): EndShiftRouteInput {
  return {
    enforcedExplicit: true,
    shiftOpen: true,
    periodId: PERIOD,
    obligation: 'no_obligation',
    ...over,
  };
}

function harness(over: Partial<EndShiftDirectCloseDeps> = {}) {
  const calls = { close: 0, realClosures: 0, closedPeriodIds: [] as string[], cleared: 0 };
  const deps: EndShiftDirectCloseDeps = {
    route: over.route ?? decideEndShiftRoute(routeInput()),
    close:
      over.close ??
      (async (pid: string) => {
        calls.close += 1;
        calls.realClosures += 1;
        calls.closedPeriodIds.push(pid);
        return { ok: true, alreadyClosed: false };
      }),
    clearReturnState: async () => {
      calls.cleared += 1;
    },
    isCurrent: over.isCurrent,
  };
  return { deps, calls };
}

describe('decideEndShiftRoute (product rules)', () => {
  it('Rule 2: definitively no Pre-Trip/DVIR obligation → ordinary direct close', () => {
    const r = decideEndShiftRoute(routeInput({ obligation: 'no_obligation' }));
    assert.deepEqual(r, { action: 'direct_close', periodId: PERIOD });
  });

  it('Rule 1: matching completed Pre-Trip obligation → existing governed flow', () => {
    const r = decideEndShiftRoute(routeInput({ obligation: 'obligation' }));
    assert.equal(r.action, 'existing_flow');
  });

  it('Rule 3: unknown/verifying obligation → verify, never assume absent, never bypass', () => {
    const r = decideEndShiftRoute(routeInput({ obligation: 'unknown' }));
    assert.equal(r.action, 'verify_obligation');
  });

  it('no period id → verify (cannot close), never direct close', () => {
    const r = decideEndShiftRoute(routeInput({ obligation: 'no_obligation', periodId: null }));
    assert.equal(r.action, 'verify_obligation');
  });

  it('legacy (non-enforced) or not-open shift → existing flow unchanged', () => {
    assert.equal(decideEndShiftRoute(routeInput({ enforcedExplicit: false })).action, 'existing_flow');
    assert.equal(decideEndShiftRoute(routeInput({ shiftOpen: false })).action, 'existing_flow');
  });

  it('ticket/job activity is NOT an input to the routing decision', () => {
    const keys = Object.keys(routeInput());
    assert.ok(!keys.some((k) => /ticket|job|load|work/i.test(k)));
  });
});

describe('performEndShiftDirectClose (orchestration)', () => {
  it('T1: no Pre-Trip → normal close called exactly once, then return state cleared', async () => {
    const { deps, calls } = harness();
    const r = await performEndShiftDirectClose(deps);
    assert.equal(r.kind, 'closed');
    assert.equal(calls.realClosures, 1);
    assert.deepEqual(calls.closedPeriodIds, [PERIOD]);
    assert.equal(calls.cleared, 1);
  });

  it('T2/T3: closes by period id only — no odometer/arrival/post-trip/receipt dep exists', async () => {
    const { deps } = harness();
    const depKeys = Object.keys(deps);
    assert.ok(!depKeys.some((k) => /odometer|arrival|postTrip|receipt|markArrived|enRoute|reason|marker/i.test(k)));
    await performEndShiftDirectClose(deps);
  });

  it('T6: unknown/verifying obligation route → verify passthrough, never closes', async () => {
    const { deps, calls } = harness({
      route: decideEndShiftRoute(routeInput({ obligation: 'unknown' })),
    });
    const r = await performEndShiftDirectClose(deps);
    assert.equal(r.kind, 'verify_obligation');
    assert.equal(calls.realClosures, 0);
    assert.equal(calls.cleared, 0);
  });

  it('T5(governed): obligation route → existing_flow, no close', async () => {
    const { deps, calls } = harness({
      route: decideEndShiftRoute(routeInput({ obligation: 'obligation' })),
    });
    const r = await performEndShiftDirectClose(deps);
    assert.equal(r.kind, 'existing_flow');
    assert.equal(calls.realClosures, 0);
  });

  it('T7: close failure → retry, shift + return state left intact', async () => {
    const { deps, calls } = harness({ close: async () => ({ ok: false, reason: 'transport' }) });
    const r = await performEndShiftDirectClose(deps);
    assert.equal(r.kind, 'retry');
    assert.equal(calls.cleared, 0);
  });

  it('T7b: close throwing (offline) → retry, nothing cleared', async () => {
    const { deps, calls } = harness({
      close: async () => {
        throw new Error('network_unavailable');
      },
    });
    const r = await performEndShiftDirectClose(deps);
    assert.equal(r.kind, 'retry');
    assert.equal(calls.cleared, 0);
  });

  it('T8: repeated closes are idempotent (server alreadyClosed dedupe)', async () => {
    let n = 0;
    const { deps } = harness({
      close: async () => {
        n += 1;
        return { ok: true, alreadyClosed: n > 1 };
      },
    });
    const first = await performEndShiftDirectClose(deps);
    const second = await performEndShiftDirectClose(deps);
    assert.equal(first.kind, 'closed');
    assert.equal(second.kind, 'closed');
    if (first.kind === 'closed') assert.equal(first.alreadyClosed, false);
    if (second.kind === 'closed') assert.equal(second.alreadyClosed, true);
  });

  it('stale generation after ok close → does not mutate a replaced session’s state', async () => {
    let current = true;
    const { deps, calls } = harness({ isCurrent: () => current });
    deps.close = async () => {
      current = false;
      return { ok: true, alreadyClosed: false };
    };
    const r = await performEndShiftDirectClose(deps);
    assert.equal(r.kind, 'closed');
    assert.equal(calls.cleared, 0);
  });
});

describe('Suite wiring (real action/routing seams)', () => {
  const root = join(__dirname, '..', '..', '..', '..');
  const read = (p: string) => readFileSync(join(root, p), 'utf8');

  it('AuthContext exposes resolveEndShiftRoute + closeShiftDirect on performEndShiftDirectClose', () => {
    const auth = read('src/core/context/AuthContext.tsx');
    assert.ok(auth.includes('performEndShiftDirectClose'));
    assert.ok(auth.includes('resolveEndShiftRoute'));
    assert.ok(auth.includes('closeShiftDirect'));
    assert.ok(/resolveEndShiftRoute,/.test(auth) && /closeShiftDirect,/.test(auth));
  });

  it('T2 duration preserved: direct close cleanup never clears shiftStartTime', () => {
    const auth = read('src/core/context/AuthContext.tsx');
    const s = auth.indexOf('const closeShiftDirect');
    const e = auth.indexOf('const logoutWithCascade');
    const region = auth.slice(s, e > s ? e : undefined);
    assert.ok(s > 0, 'closeShiftDirect located');
    assert.ok(!/shiftStartTime/.test(region), 'must not touch shiftStartTime (paid duration preserved)');
  });

  it('T9: Sign Out / logout never closes the shift', () => {
    const auth = read('src/core/context/AuthContext.tsx');
    const s = auth.indexOf('const logoutWithCascade');
    const e = auth.indexOf('const refreshSession');
    const region = auth.slice(s, e > 0 ? e : undefined);
    assert.ok(s > 0);
    assert.ok(!region.includes('closeShiftDirect') && !region.includes('performEndShiftDirectClose'));
  });

  it('T4: already-returning without obligation exposes truthful End Shift, not Mark Arrived overload', () => {
    const row = read('src/ui/shared/ActionCardRow.tsx');
    assert.ok(row.includes('closeShiftDirect'));
    assert.ok(row.includes('ShiftEndRecoveryCard'), 'truthful recovery card used in returning branch');
    // The direct close must NOT be wired onto EnRouteYardCard's arrival action.
    assert.ok(!/onArrived=\{[^}]*closeShiftDirect/.test(row), 'Mark Arrived must not trigger direct close');
  });

  it('T5: governed arrival path still enforces Post-Trip', () => {
    const row = read('src/ui/shared/ActionCardRow.tsx');
    assert.ok(row.includes('ensurePostTripGate'));
    assert.ok(row.includes('EnRouteYardCard'));
  });
});

describe('truthful copy + withdrawn naming', () => {
  const root = join(__dirname, '..', '..', '..', '..');
  const en = JSON.parse(readFileSync(join(root, 'src/core/localization/translations/en.json'), 'utf8'));
  const es = JSON.parse(readFileSync(join(root, 'src/core/localization/translations/es.json'), 'utf8'));
  const NEW = ['endShiftConfirmTitle', 'endShiftConfirmBody', 'endShiftFailed', 'endVerifying', 'endShiftOpenTitle'];

  it('new shift.* keys exist and are translated in both languages', () => {
    for (const k of NEW) {
      assert.ok(en.shift[k] && typeof en.shift[k] === 'string', `en shift.${k} missing`);
      assert.ok(es.shift[k] && typeof es.shift[k] === 'string', `es shift.${k} missing`);
      assert.notEqual(es.shift[k], en.shift[k], `es shift.${k} must be translated`);
    }
  });

  it('withdrawn "no work" / aborted_before_pretrip naming is absent from the routing module', () => {
    const src = readFileSync(join(__dirname, 'endShiftDvirRouting.ts'), 'utf8');
    assert.ok(!/aborted_before_pretrip/.test(src));
    // No user-facing "No Work" action naming survives.
    assert.ok(!en.shift.endNoWorkAction && !es.shift.endNoWorkAction);
  });
});
