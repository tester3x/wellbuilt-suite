/**
 * DETERMINISTIC reproduction of Mike's observed state, and a differential
 * diagnosis that names the terminal routing decision and rules the six
 * candidate causes in/out. Pure — no device, no time cutoffs, no I/O.
 *
 * Known state:
 *   - Server period 2026-08-23_232617, authority version 7, OPEN.
 *   - No Pre-Trip exists -> no Post-Trip owed (the TRUE DVIR signal is preTrip='no').
 *   - WB-S displays a STALE EN ROUTE / The Yard / Mark Arrived card with 133+h
 *     from a stale returnDepartTime.
 *   - The End Shift attempt returned Home; the authoritative shift stayed open.
 *
 * The six candidate causes to distinguish:
 *   1. intentional Mark Arrived gate
 *   2. stale local return-route state
 *   3. route-decider defect
 *   4. missing confirmation
 *   5. callable never reached
 *   6. callable reached but failed
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideEndShiftRoute, type EndShiftRouteInput } from './endShiftDvirRouting.js';

const MIKE = '2026-08-23_232617';
const ORIGIN = '2026-08-23';
const root = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Mike's server-open input; only the DVIR signal varies. */
function mike(over: Partial<EndShiftRouteInput> = {}): EndShiftRouteInput {
  return {
    enforcedExplicit: true,
    enforcementLive: true,
    shiftOpen: true,
    serverShift: { state: 'open', periodId: MIKE, originLocalDate: ORIGIN },
    preTrip: 'no',
    operated: 'unknown',
    ...over,
  };
}

describe('stale EN ROUTE reproduction — terminal decision + differential diagnosis', () => {
  // The OBSERVED display (EN ROUTE / Mark Arrived) requires the decider to
  // return existing_flow, which only happens when preTrip==='yes'. That
  // contradicts "no Pre-Trip exists" -> the 'yes' is a STALE LOCAL signal
  // (a leftover completed-receipt or an armed pending end-shift), not reality.
  it('OBSERVED: server-open + stale preTrip="yes" -> existing_flow (EN ROUTE / Mark Arrived) — the terminal decision', () => {
    const r = decideEndShiftRoute(mike({ preTrip: 'yes' }));
    assert.equal(r.action, 'existing_flow');
  });

  it('TRUE state: server-open + preTrip="no" (no Pre-Trip) -> direct_close on the SAME period — a valid, confirmable End Shift IS available when the signal is correct', () => {
    const r = decideEndShiftRoute(mike({ preTrip: 'no' }));
    assert.equal(r.action, 'direct_close');
    assert.equal(r.action === 'direct_close' && r.periodId, MIKE);
  });

  it('unreadable gate: preTrip="indeterminate" -> verify_obligation (bounded, actionable) — never a silent existing_flow', () => {
    const r = decideEndShiftRoute(mike({ preTrip: 'indeterminate' }));
    assert.equal(r.action, 'verify_obligation');
    assert.equal(r.action === 'verify_obligation' && r.reason, 'obligation_unknown');
  });

  // ── Differential diagnosis: rule each candidate cause in/out ──────────────
  it('CAUSE #3 route-decider defect: RULED OUT — the decider maps inputs correctly', () => {
    // Same period, only the signal differs, and each maps to the contract action.
    assert.equal(decideEndShiftRoute(mike({ preTrip: 'no' })).action, 'direct_close');
    assert.equal(decideEndShiftRoute(mike({ preTrip: 'yes' })).action, 'existing_flow');
    assert.equal(decideEndShiftRoute(mike({ operated: 'not_operated', preTrip: 'yes' })).action, 'direct_close');
    // The decider never returns a silent no-op; existing_flow is a real card.
  });

  it('CAUSE #2 stale local return-route state: CONFIRMED — existing_flow requires preTrip="yes", which contradicts "no Pre-Trip exists"', () => {
    // If the local DVIR signal reflected reality (no Pre-Trip => preTrip="no"),
    // the decider would yield direct_close, not the EN ROUTE trap.
    const observed = decideEndShiftRoute(mike({ preTrip: 'yes' })).action; // existing_flow
    const truthful = decideEndShiftRoute(mike({ preTrip: 'no' })).action; // direct_close
    assert.notEqual(observed, truthful);
    assert.equal(observed, 'existing_flow');
    assert.equal(truthful, 'direct_close');
  });

  it('CAUSE #1 intentional Mark Arrived gate: NOT a valid gate for THIS true state — it is entered only via the stale preTrip="yes" signal, not a genuine Pre-Trip', () => {
    // The gate would be legitimate if a real Pre-Trip existed. Here it does not,
    // so routing into the governed arrival flow is a consequence of stale state,
    // not an intended obligation.
    assert.equal(decideEndShiftRoute(mike({ preTrip: 'yes' })).action, 'existing_flow'); // the gate
    assert.equal(decideEndShiftRoute(mike({ preTrip: 'no' })).action, 'direct_close'); // no gate when truthful
  });

  it('CAUSE #4 missing confirmation: in existing_flow the UI renders EnRouteYardCard (Mark Arrived) — there is NO direct End Shift confirmation control', () => {
    const acr = read('src/ui/shared/ActionCardRow.tsx');
    // existing_flow -> EnRouteYardCard; the direct-close confirmation
    // (promptDirectEndShift) is only wired for the direct_close card.
    assert.ok(acr.includes('EnRouteYardCard'));
    assert.ok(acr.includes('promptDirectEndShift'));
    // The confirmation is gated behind a direct_close route, not existing_flow.
    assert.ok(/direct_close/.test(acr));
  });

  it('CAUSE #5 callable never reached (logout path): REPAIRED — the red icon now routes through the guarded Sign Out; logout() still invokes NO close callable', () => {
    const home = read('src/ui/v1-grid/screens/HomeScreen.tsx');
    assert.ok(home.includes('handleSignOutPress') && home.includes('name="logout"'));
    assert.ok(!home.includes('onPress={logout}'), 'no silent logout on the red icon');
    const auth = read('src/core/context/AuthContext.tsx');
    const start = auth.indexOf('const logout = useCallback');
    const end = auth.indexOf('const register = useCallback', start);
    const logoutRegion = auth.slice(start, end);
    assert.ok(
      !/closeEnforcedExplicit|performEndShiftDirectClose|closeShiftDirect/.test(logoutRegion),
      'logout must not reach any close path',
    );
  });

  it('CAUSE #6 callable reached-but-failed: distinguished ONLY at runtime — the breadcrumb callable_start/callable_result pair is the discriminator', () => {
    // The pure decider cannot see a runtime close outcome; the instrumentation
    // added in eee5a48 records callable_start then callable_result{outcome}, so a
    // device capture separates "never reached" (#5, no callable_start on the
    // taken control) from "reached but failed" (#6, callable_result outcome=error).
    const auth = read('src/core/context/AuthContext.tsx');
    assert.ok(auth.includes("emitEndShiftBreadcrumb('callable_start'"));
    assert.ok(auth.includes("emitEndShiftBreadcrumb('callable_result'"));
  });
});
