/**
 * Aborted / no-work shift closure (P0) — failing-first behavioral coverage.
 *
 * A shift that never completed its required Pre-Trip and never entered governed
 * work must be closable by the driver's explicit End Shift action WITHOUT a
 * fabricated arrival, Pre-Trip, or Post-Trip. These tests pin the pure
 * eligibility decision, the closure orchestration, and the Suite wiring.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decideNoWorkClosure,
  performNoWorkClosure,
  type NoWorkEligibilityInput,
  type NoWorkClosureDeps,
} from './noWorkShiftClosure.js';

const PERIOD = '2026-09-05_070000';

function eligibleInput(over: Partial<NoWorkEligibilityInput> = {}): NoWorkEligibilityInput {
  return {
    enforcedExplicit: true,
    shiftOpen: true,
    periodId: PERIOD,
    hasPreTripReceipt: false,
    hasPostTripReceipt: false,
    ...over,
  };
}

type CloseFn = NoWorkClosureDeps['close'];

function harness(over: Partial<NoWorkClosureDeps> & { close?: CloseFn } = {}) {
  const calls = {
    close: 0,
    realClosures: 0,
    closedPeriodIds: [] as string[],
    recorded: [] as Array<{ periodId: string; reason: string }>,
    cleared: 0,
  };
  const deps: NoWorkClosureDeps = {
    eligibility: over.eligibility ?? eligibleInput(),
    close:
      over.close ??
      (async (periodId: string) => {
        calls.close += 1;
        calls.realClosures += 1;
        calls.closedPeriodIds.push(periodId);
        return { ok: true, alreadyClosed: false };
      }),
    recordTerminalReason: async (periodId, reason) => {
      calls.recorded.push({ periodId, reason });
    },
    clearTripState: async () => {
      calls.cleared += 1;
    },
    isCurrent: over.isCurrent,
  };
  return { deps, calls };
}

describe('decideNoWorkClosure (pure, authoritative)', () => {
  it('no Pre-Trip + no Post-Trip + enforced open shift → eligible aborted_before_pretrip', () => {
    const d = decideNoWorkClosure(eligibleInput());
    assert.equal(d.eligible, true);
    if (d.eligible) {
      assert.equal(d.periodId, PERIOD);
      assert.equal(d.terminalReason, 'aborted_before_pretrip');
    }
  });

  it('JSA is not an input, so a disabled JSA can never gate closure', () => {
    // The eligibility contract has no JSA field at all. Whatever the company's
    // JSA setting, the decision for a no-work shift is identical → eligible.
    const keys = Object.keys(eligibleInput());
    assert.ok(!keys.some((k) => /jsa/i.test(k)), 'eligibility must not reference JSA');
    assert.equal(decideNoWorkClosure(eligibleInput()).eligible, true);
  });

  it('a completed Pre-Trip means governed work could have started → not eligible', () => {
    const d = decideNoWorkClosure(eligibleInput({ hasPreTripReceipt: true }));
    assert.equal(d.eligible, false);
    if (!d.eligible) assert.equal(d.reason, 'pretrip_present');
  });

  it('a completed Post-Trip means work happened → not eligible (governed flow owns it)', () => {
    const d = decideNoWorkClosure(eligibleInput({ hasPostTripReceipt: true }));
    assert.equal(d.eligible, false);
    if (!d.eligible) assert.equal(d.reason, 'governed_work_present');
  });

  it('legacy (non-enforced), closed shift, or missing period are not eligible', () => {
    assert.equal(decideNoWorkClosure(eligibleInput({ enforcedExplicit: false })).eligible, false);
    assert.equal(decideNoWorkClosure(eligibleInput({ shiftOpen: false })).eligible, false);
    assert.equal(decideNoWorkClosure(eligibleInput({ periodId: null })).eligible, false);
  });
});

describe('performNoWorkClosure (orchestration)', () => {
  it('T1: no Pre-Trip + no governed work + End Shift → closes exactly once, records reason, clears trip state', async () => {
    const { deps, calls } = harness();
    const r = await performNoWorkClosure(deps);
    assert.equal(r.kind, 'closed');
    if (r.kind === 'closed') assert.equal(r.terminalReason, 'aborted_before_pretrip');
    assert.equal(calls.realClosures, 1);
    assert.deepEqual(calls.recorded, [{ periodId: PERIOD, reason: 'aborted_before_pretrip' }]);
    assert.equal(calls.cleared, 1);
  });

  it('T3: drive/navigation timer present (returning) + no governed work → closes without odometer/arrival/DVIR', async () => {
    // shiftOpen models an active OR returning-to-yard shift; the drive timer is
    // never an input, so it cannot force Mark Arrived. close() takes periodId
    // only — there is no odometer parameter to supply.
    const { deps, calls } = harness({ eligibility: eligibleInput({ shiftOpen: true }) });
    const r = await performNoWorkClosure(deps);
    assert.equal(r.kind, 'closed');
    // Closed by period id alone — no odometer/arrival value ever threaded through.
    assert.deepEqual(calls.closedPeriodIds, [PERIOD]);
    assert.equal(calls.cleared, 1);
  });

  it('T4: never launches Post-Trip, never writes a pending end-shift marker, never fabricates a receipt', async () => {
    // The orchestrator is incapable by construction: its dependency surface has
    // no post-trip / pending / receipt / launch capability at all, so the only
    // side effects it can ever produce are close + record-reason + clear-trip.
    const { deps } = harness();
    const depKeys = Object.keys(deps);
    assert.ok(!depKeys.some((k) => /postTrip|pending|receipt|launch|dvir|odometer|arrival/i.test(k)));
    await performNoWorkClosure(deps);
  });

  it('T5: authoritative close failure → retry, shift + trip state left intact', async () => {
    const { deps, calls } = harness({ close: async () => ({ ok: false, reason: 'transport' }) });
    const r = await performNoWorkClosure(deps);
    assert.equal(r.kind, 'retry');
    assert.equal(calls.cleared, 0, 'trip state must NOT be cleared on failed close');
    assert.equal(calls.recorded.length, 0, 'no terminal reason recorded on failed close');
  });

  it('T5b: close throwing (offline) → retry, nothing cleared', async () => {
    const { deps, calls } = harness({
      close: async () => {
        throw new Error('network_unavailable');
      },
    });
    const r = await performNoWorkClosure(deps);
    assert.equal(r.kind, 'retry');
    assert.equal(calls.cleared, 0);
  });

  it('T6: repeated End Shift taps/retries → the shift closes at most once (server dedupe)', async () => {
    let n = 0;
    const close: CloseFn = async () => {
      n += 1;
      // First call performs the real closure; later calls report alreadyClosed.
      return { ok: true, alreadyClosed: n > 1 };
    };
    const { deps } = harness({ close });
    const first = await performNoWorkClosure(deps);
    const second = await performNoWorkClosure(deps);
    assert.equal(first.kind, 'closed');
    assert.equal(second.kind, 'closed');
    if (first.kind === 'closed') assert.equal(first.alreadyClosed, false);
    if (second.kind === 'closed') assert.equal(second.alreadyClosed, true);
  });

  it('T7: a shift that unlocked governed work (Pre-Trip receipt) is not abort-closed', async () => {
    const { deps, calls } = harness({ eligibility: eligibleInput({ hasPreTripReceipt: true }) });
    const r = await performNoWorkClosure(deps);
    assert.equal(r.kind, 'not_eligible');
    assert.equal(calls.realClosures, 0);
    assert.equal(calls.cleared, 0);
  });

  it('stale generation after ok close → closed but local trip state is not mutated', async () => {
    let current = true;
    const { deps, calls } = harness({ isCurrent: () => current });
    // Flip to stale right when close resolves.
    deps.close = async () => {
      current = false;
      return { ok: true, alreadyClosed: false };
    };
    const r = await performNoWorkClosure(deps);
    assert.equal(r.kind, 'closed');
    assert.equal(calls.cleared, 0, 'must not clear a replaced session’s local state');
  });
});

describe('Suite wiring (source assertions)', () => {
  const root = join(__dirname, '..', '..', '..', '..');
  const read = (p: string) => readFileSync(join(root, p), 'utf8');

  it('AuthContext exposes endShiftNoWork built on performNoWorkClosure', () => {
    const auth = read('src/core/context/AuthContext.tsx');
    assert.ok(auth.includes('performNoWorkClosure'));
    assert.ok(auth.includes('endShiftNoWork'));
    // Provided through context so UI surfaces can call it.
    assert.ok(/endShiftNoWork,/.test(auth));
  });

  it('T8/T9: End Shift no-work path is separate from Sign Out — logout never abort-closes', () => {
    const auth = read('src/core/context/AuthContext.tsx');
    const logoutStart = auth.indexOf('const logoutWithCascade');
    const logoutEnd = auth.indexOf('const refreshSession');
    const logoutRegion = auth.slice(logoutStart, logoutEnd > 0 ? logoutEnd : undefined);
    assert.ok(logoutStart > 0, 'logout region located');
    assert.ok(
      !logoutRegion.includes('performNoWorkClosure') && !logoutRegion.includes('endShiftNoWork'),
      'Sign Out / logout must never invoke the no-work closure',
    );
  });

  it('ActionCardRow tries endShiftNoWork first and falls back to the existing flows', () => {
    const row = read('src/ui/shared/ActionCardRow.tsx');
    assert.ok(row.includes('endShiftNoWork'));
    // Fallbacks preserved: normal return-to-yard travel + governed Post-Trip arrival.
    assert.ok(row.includes('onStartReturn'));
    assert.ok(row.includes('ShiftArrivalModal'));
  });
});

describe('i18n parity for new copy', () => {
  const root = join(__dirname, '..', '..', '..', '..');
  const en = JSON.parse(readFileSync(join(root, 'src/core/localization/translations/en.json'), 'utf8'));
  const es = JSON.parse(readFileSync(join(root, 'src/core/localization/translations/es.json'), 'utf8'));
  const NEW_KEYS = ['endNoWorkTitle', 'endNoWorkConfirm', 'endNoWorkAction', 'endNoWorkFailed'];

  it('new shift.* keys exist in both English and Spanish', () => {
    for (const k of NEW_KEYS) {
      assert.ok(en.shift[k] && typeof en.shift[k] === 'string', `en shift.${k} missing`);
      assert.ok(es.shift[k] && typeof es.shift[k] === 'string', `es shift.${k} missing`);
      assert.notEqual(es.shift[k], en.shift[k], `es shift.${k} must be translated, not echoed`);
    }
  });
});
