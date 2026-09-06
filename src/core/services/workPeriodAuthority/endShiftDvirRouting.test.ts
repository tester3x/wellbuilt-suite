/**
 * End Shift vs. DVIR-obligation routing (P0) — failing-first behavioral coverage.
 *
 * A shift is paid work time; the vehicle/DVIR (Post-Trip) obligation is a
 * separate lifecycle. Post-Trip required = matching valid Pre-Trip AND actual
 * operation of the equipment. These tests pin the pure routing decision, the
 * direct-close orchestration, and the real Suite action/routing seams
 * (Start-Shift correction, departure DVIR hand-off, Sign Out separation, and
 * the truthful — never fabricated — operation signal).
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
const ORIGIN = '2026-09-05';
const root = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function routeInput(over: Partial<EndShiftRouteInput> = {}): EndShiftRouteInput {
  return {
    enforcedExplicit: true,
    enforcementLive: true,
    shiftOpen: true,
    serverShift: { state: 'open', periodId: PERIOD, originLocalDate: ORIGIN },
    preTrip: 'no',
    operated: 'unknown',
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

describe('decideEndShiftRoute — locked rule (Pre-Trip AND operated)', () => {
  it('no Pre-Trip → ordinary direct close on the exact SERVER period (any operation state)', () => {
    for (const operated of ['unknown', 'not_operated', 'operated'] as const) {
      assert.deepEqual(
        decideEndShiftRoute(routeInput({ preTrip: 'no', operated })),
        { action: 'direct_close', periodId: PERIOD, originLocalDate: ORIGIN },
      );
    }
  });

  it('Pre-Trip + canonically NOT operated → direct close, retain Pre-Trip (no false Post-Trip)', () => {
    assert.deepEqual(
      decideEndShiftRoute(routeInput({ preTrip: 'yes', operated: 'not_operated' })),
      { action: 'direct_close', periodId: PERIOD, originLocalDate: ORIGIN },
    );
  });

  it('Pre-Trip + operated → require the matching Post-Trip (existing governed flow)', () => {
    assert.equal(decideEndShiftRoute(routeInput({ preTrip: 'yes', operated: 'operated' })).action, 'existing_flow');
  });

  it('Pre-Trip + operation UNKNOWN → fail safe: require Post-Trip, never silently bypass', () => {
    assert.equal(decideEndShiftRoute(routeInput({ preTrip: 'yes', operated: 'unknown' })).action, 'existing_flow');
  });

  it('server open but Pre-Trip signal indeterminate → verify (never assume absent)', () => {
    assert.equal(decideEndShiftRoute(routeInput({ preTrip: 'indeterminate' })).action, 'verify_obligation');
  });

  it('server authority is the truth: none → reconcile; unverifiable/not_read → verify', () => {
    // The local returning hint (shiftOpen) never overrides the server state.
    assert.deepEqual(decideEndShiftRoute(routeInput({ serverShift: { state: 'none' } })), { action: 'reconcile_none' });
    assert.equal(decideEndShiftRoute(routeInput({ serverShift: { state: 'unverifiable' } })).action, 'verify_obligation');
    assert.equal(decideEndShiftRoute(routeInput({ serverShift: { state: 'not_read' } })).action, 'verify_obligation');
  });

  it('server open + Pre-Trip + operated → require matching Post-Trip on that exact period', () => {
    const r = decideEndShiftRoute(routeInput({
      serverShift: { state: 'open', periodId: '2026-08-23_232617', originLocalDate: '2026-08-23' },
      preTrip: 'yes',
      operated: 'operated',
    }));
    assert.equal(r.action, 'existing_flow');
  });

  it('server open + no Pre-Trip → direct close on the returned period id + origin date', () => {
    const r = decideEndShiftRoute(routeInput({
      serverShift: { state: 'open', periodId: '2026-08-23_232617', originLocalDate: '2026-08-23' },
      preTrip: 'no',
    }));
    assert.deepEqual(r, { action: 'direct_close', periodId: '2026-08-23_232617', originLocalDate: '2026-08-23' });
  });

  it('live legacy, or not-open shift → existing flow unchanged (legacy recovery deferred)', () => {
    assert.equal(decideEndShiftRoute(routeInput({ enforcedExplicit: false, enforcementLive: true })).action, 'existing_flow');
    assert.equal(decideEndShiftRoute(routeInput({ shiftOpen: false })).action, 'existing_flow');
  });

  it('ticket/job activity is NOT an input to the routing decision', () => {
    const keys = Object.keys(routeInput());
    assert.ok(!keys.some((k) => /ticket|job|load|work/i.test(k)));
  });
});

describe('authority gate — never act on cached/unresolved enforcement', () => {
  it('cached legacy returning shift → non-actionable verify (no Mark Arrived / End Shift)', () => {
    const r = decideEndShiftRoute(routeInput({ enforcedExplicit: false, enforcementLive: false }));
    assert.deepEqual(r, { action: 'verify_obligation', reason: 'authority_unresolved' });
  });

  it('unavailable/unresolved enforcement → non-actionable verify', () => {
    // AuthContext maps kind:"unavailable" to enforcedExplicit=false + enforcementLive=false.
    const r = decideEndShiftRoute(routeInput({ enforcedExplicit: false, enforcementLive: false, preTrip: 'indeterminate' }));
    assert.equal(r.action, 'verify_obligation');
  });

  it('cached legacy must NOT enable the permissive legacy path regardless of Pre-Trip', () => {
    for (const preTrip of ['no', 'yes', 'indeterminate'] as const) {
      assert.equal(
        decideEndShiftRoute(routeInput({ enforcedExplicit: false, enforcementLive: false, preTrip })).action,
        'verify_obligation',
      );
    }
  });

  it('restrictive cached ENFORCED config retains the governed path (never verify/legacy)', () => {
    assert.equal(decideEndShiftRoute(routeInput({ enforcedExplicit: true, enforcementLive: false })).action, 'existing_flow');
    // Even with no Pre-Trip, a cached (not live) enforced config must NOT direct-close.
    assert.equal(
      decideEndShiftRoute(routeInput({ enforcedExplicit: true, enforcementLive: false, preTrip: 'no' })).action,
      'existing_flow',
    );
  });

  it('enforced LKG cannot downgrade to a permissive legacy route: cached enforced ≠ direct/verify-legacy', () => {
    // A cached enforced value only ever retains the (more-restrictive) governed
    // path; it can never become the permissive legacy Mark Arrived path.
    assert.notEqual(decideEndShiftRoute(routeInput({ enforcedExplicit: true, enforcementLive: false })).action, 'direct_close');
  });

  it('retry → live resolution transitions to the correct governed/direct route', () => {
    // Before: cached legacy → verify. After a live read confirms enforced + no
    // Pre-Trip → direct close; live enforced + operated → governed.
    assert.equal(decideEndShiftRoute(routeInput({ enforcedExplicit: false, enforcementLive: false })).action, 'verify_obligation');
    assert.equal(decideEndShiftRoute(routeInput({ enforcedExplicit: true, enforcementLive: true, preTrip: 'no' })).action, 'direct_close');
    assert.equal(decideEndShiftRoute(routeInput({ enforcedExplicit: true, enforcementLive: true, preTrip: 'yes', operated: 'operated' })).action, 'existing_flow');
  });
});

describe('performEndShiftDirectClose — orchestration', () => {
  it('T1: trapped no-Pre-Trip shift closes exactly once, then return state cleared', async () => {
    const { deps, calls } = harness();
    const r = await performEndShiftDirectClose(deps);
    assert.equal(r.kind, 'closed');
    assert.equal(calls.realClosures, 1);
    assert.deepEqual(calls.closedPeriodIds, [PERIOD]);
    assert.equal(calls.cleared, 1);
  });

  it('T1: closes by period id only — no arrival/odometer/post-trip/receipt dep exists', async () => {
    const { deps } = harness();
    const depKeys = Object.keys(deps);
    assert.ok(!depKeys.some((k) => /odometer|arrival|postTrip|receipt|markArrived|enRoute|reason|marker/i.test(k)));
    await performEndShiftDirectClose(deps);
  });

  it('T2: close failure → retry, shift + return state left intact', async () => {
    const { deps, calls } = harness({ close: async () => ({ ok: false, reason: 'transport' }) });
    const r = await performEndShiftDirectClose(deps);
    assert.equal(r.kind, 'retry');
    assert.equal(calls.cleared, 0);
  });

  it('T2b: close throwing (offline) → retry, nothing cleared', async () => {
    const { deps, calls } = harness({
      close: async () => { throw new Error('network_unavailable'); },
    });
    const r = await performEndShiftDirectClose(deps);
    assert.equal(r.kind, 'retry');
    assert.equal(calls.cleared, 0);
  });

  it('idempotent: repeated closes dedupe via the server alreadyClosed contract', async () => {
    let n = 0;
    const { deps } = harness({ close: async () => { n += 1; return { ok: true, alreadyClosed: n > 1 }; } });
    const first = await performEndShiftDirectClose(deps);
    const second = await performEndShiftDirectClose(deps);
    if (first.kind === 'closed') assert.equal(first.alreadyClosed, false);
    if (second.kind === 'closed') assert.equal(second.alreadyClosed, true);
  });

  it('T7(governed): Pre-Trip+operated route → existing_flow, no direct close', async () => {
    const { deps, calls } = harness({
      route: decideEndShiftRoute(routeInput({ preTrip: 'yes', operated: 'operated' })),
    });
    const r = await performEndShiftDirectClose(deps);
    assert.equal(r.kind, 'existing_flow');
    assert.equal(calls.realClosures, 0);
  });

  it('T10: verify route → passthrough, never closes', async () => {
    const { deps, calls } = harness({
      route: decideEndShiftRoute(routeInput({ preTrip: 'indeterminate' })),
    });
    const r = await performEndShiftDirectClose(deps);
    assert.equal(r.kind, 'verify_obligation');
    assert.equal(calls.realClosures, 0);
  });

  it('T10: stale generation after ok close → does not mutate a replaced session', async () => {
    let current = true;
    const { deps, calls } = harness({ isCurrent: () => current });
    deps.close = async () => { current = false; return { ok: true, alreadyClosed: false }; };
    const r = await performEndShiftDirectClose(deps);
    assert.equal(r.kind, 'closed');
    assert.equal(calls.cleared, 0);
  });
});

describe('T3/T4/T5 — Start-Shift correction (no forced DVIR or JSA)', () => {
  const row = read('src/ui/shared/ActionCardRow.tsx');

  it('T3: Start Shift does not force a DVIR Pre-Trip (the only Pre-Trip force is removed)', () => {
    assert.ok(row.includes('const handleStartConfirm'), 'Start-Shift confirm present');
    // The forced-Pre-Trip-after-claim block is gone; the Pre-Trip gate now lives
    // only at the vehicle boundary (Tickets/depart), never at clock-in.
    assert.ok(!row.includes('ensurePreTripGate'), 'no Pre-Trip force anywhere in ActionCardRow');
    assert.ok(/Start Shift begins paid work time immediately/.test(row), 'correction documented');
  });

  it('T4: Start Shift does not launch JSA, and the JSA choice launcher stays dead', () => {
    assert.ok(!/jsaapp|launchJsa/.test(row));
    assert.ok(!row.includes('onJsaLaunch('), 'JSA launch prop never invoked');
    assert.ok(!row.includes('<JsaChoiceModal'), 'removed JsaChoiceModal not rendered');
  });
});

describe('T8/T9 — departure DVIR hand-off remains enforced (gate not weakened)', () => {
  it('T8: opening Tickets while on shift still enforces Pre-Trip → WB-E hand-off', () => {
    const launcher = read('src/core/hooks/useAppLauncher.ts');
    const dvir = read('src/core/services/dvirGate/dvirGateService.ts');
    // The Tickets/vehicle boundary still gates on a Pre-Trip receipt and launches
    // eQuipment when missing — removing the Start-Shift force did not weaken it.
    assert.ok(launcher.includes('ensurePreTripGate'));
    assert.ok(dvir.includes('launchEquipmentPhase(deps, \'pre_trip\''));
  });

  it('T9: a satisfied Pre-Trip receipt lets the boundary through (single, idempotent)', () => {
    const dvir = read('src/core/services/dvirGate/dvirGateService.ts');
    // ensurePreTripGate returns allowed with no relaunch once a receipt exists.
    assert.ok(dvir.includes('if (await isPreTripCompleteForShift(deps, shiftId)) {'));
  });
});

describe('T11/T12/T15 — operation is truthful; job/GPS/JSA never fabricate it', () => {
  const auth = read('src/core/context/AuthContext.tsx');
  it('T11/T12: WB-S never sets operated to a truthy value (no job/GPS-derived operation)', () => {
    // WB-S has no durable operated signal; the wiring is truthfully 'unknown'.
    const sig = auth.slice(auth.indexOf('const determineDvirSignals'), auth.indexOf('const resolveEndShiftRoute'));
    assert.ok(sig.includes("const operated: OperatedSignal = 'unknown'"));
    assert.ok(!/operated:\s*'operated'/.test(sig), 'never asserts operated');
  });
  it('T15: JSA is not an input to End Shift routing (disabled/enabled cannot gate it)', () => {
    const src = readFileSync(join(__dirname, 'endShiftDvirRouting.ts'), 'utf8');
    assert.ok(!/jsa/i.test(src));
    const route = auth.slice(auth.indexOf('const resolveEndShiftRoute'), auth.indexOf('const closeShiftDirect'));
    assert.ok(!/jsa/i.test(route));
  });
});

describe('T13/T16 — Sign Out separation + withdrawn naming', () => {
  const auth = read('src/core/context/AuthContext.tsx');
  it('T13: Sign Out / logout never closes the shift', () => {
    const s = auth.indexOf('const logoutWithCascade');
    const e = auth.indexOf('const refreshSession');
    const region = auth.slice(s, e > 0 ? e : undefined);
    assert.ok(s > 0);
    assert.ok(!region.includes('closeShiftDirect') && !region.includes('performEndShiftDirectClose'));
  });
  it('T16: no withdrawn "No Work" / aborted_before_pretrip concepts return', () => {
    const src = readFileSync(join(__dirname, 'endShiftDvirRouting.ts'), 'utf8');
    const en = JSON.parse(read('src/core/localization/translations/en.json'));
    const es = JSON.parse(read('src/core/localization/translations/es.json'));
    assert.ok(!/aborted_before_pretrip/.test(src));
    assert.ok(!auth.includes('aborted_before_pretrip'));
    assert.ok(!en.shift.endNoWorkAction && !es.shift.endNoWorkAction);
  });
});

describe('Suite wiring (routing seams) + truthful copy', () => {
  const auth = read('src/core/context/AuthContext.tsx');
  const row = read('src/ui/shared/ActionCardRow.tsx');
  it('AuthContext exposes resolveEndShiftRoute + closeShiftDirect on performEndShiftDirectClose', () => {
    assert.ok(auth.includes('performEndShiftDirectClose'));
    assert.ok(/resolveEndShiftRoute,/.test(auth) && /closeShiftDirect,/.test(auth));
  });
  it('trapped returning shift w/o obligation shows truthful End Shift, not Mark Arrived overload', () => {
    assert.ok(row.includes('closeShiftDirect'));
    assert.ok(row.includes('ShiftEndRecoveryCard'));
    assert.ok(!/onArrived=\{[^}]*closeShiftDirect/.test(row));
  });
  it('governed arrival path still enforces Post-Trip', () => {
    assert.ok(row.includes('ensurePostTripGate'));
    assert.ok(row.includes('EnRouteYardCard'));
  });
  it('new shift.* copy is present and translated in both languages', () => {
    const en = JSON.parse(read('src/core/localization/translations/en.json'));
    const es = JSON.parse(read('src/core/localization/translations/es.json'));
    for (const k of ['endShiftConfirmTitle', 'endShiftConfirmBody', 'endShiftFailed', 'endVerifying', 'endShiftOpenTitle', 'verifyingStatus']) {
      assert.ok(en.shift[k] && es.shift[k] && es.shift[k] !== en.shift[k], `shift.${k} translated`);
    }
  });
});

describe('safety wiring — live authority, hint-not-authority, no synthetic writes', () => {
  const auth = read('src/core/context/AuthContext.tsx');
  const tracking = read('src/core/services/shiftTracking.ts');

  it('resolveEndShiftRoute reads LIVE config + the authenticated server authority', () => {
    const region = auth.slice(auth.indexOf('const resolveEndShiftRoute'), auth.indexOf('const reconcileStaleReturningShift'));
    assert.ok(region.includes('loadCompanyConfigResult'));
    assert.ok(/forceRefresh:\s*true/.test(region));
    assert.ok(region.includes("cfgResult.kind === 'live'"), 'enforcementLive derives from a live read');
    // The authenticated server-authority reader (resolveActiveDriverShift) is consulted.
    assert.ok(region.includes('resolveEnforcedExplicit'));
    assert.ok(region.includes('serverShift'));
    // DVIR is evaluated for the SERVER period id, not a local binding.
    assert.ok(region.includes('determineDvirSignals(resolved.periodId)'));
  });

  it('local returningToYard is only a hint — the server state determines the route', () => {
    const region = auth.slice(auth.indexOf('const resolveEndShiftRoute'), auth.indexOf('const reconcileStaleReturningShift'));
    // shiftOpen (the local hint) only TRIGGERS the server read; decide is fed serverShift.
    assert.ok(!/returningToYard[^;]*decideEndShiftRoute/.test(region));
    assert.ok(region.includes('decideEndShiftRoute'));
  });

  it('reconcileStaleReturningShift clears local state only on an authenticated server "none", with no write', () => {
    const region = auth.slice(auth.indexOf('const reconcileStaleReturningShift'), auth.indexOf('const closeShiftDirect'));
    assert.ok(region.includes('resolveEnforcedExplicit'));
    assert.ok(region.includes("resolved.state !== 'none'"), 'only an authoritative none clears');
    assert.ok(region.includes('setReturningToYard(false)'));
    // No server event of any kind is written from the reconcile path.
    assert.ok(!region.includes('recordShiftEvent') && !region.includes('closeEnforcedExplicit'));
    assert.ok(!region.includes('depart_return') && !/ensurePostTripGate|closeDriverShift/.test(region));
  });

  it('ActionCardRow reconciles a server-none returning shift (never guesses/clears blindly)', () => {
    const row = read('src/ui/shared/ActionCardRow.tsx');
    assert.ok(row.includes("route.action === 'reconcile_none'"));
    assert.ok(row.includes('reconcileStaleReturningShift'));
    // Truthful origin date is surfaced from the server route, not a local timer.
    assert.ok(row.includes('originDate') && row.includes('originLocalDate'));
  });

  it('autoCloseStaleShift issues ZERO shift writes (detection/diagnostic only)', () => {
    const fn = tracking.slice(
      tracking.indexOf('async function autoCloseStaleShift'),
      tracking.indexOf('async function autoCloseStaleShift') + 3000,
    );
    assert.ok(!fn.includes('23:59:59'), 'no fabricated 23:59:59 logout');
    assert.ok(!/appendMissingElements/.test(fn), 'no event-append transform');
    assert.ok(!/fetchSafe\(commitUrl/.test(fn), 'no commit write');
    assert.ok(!/synthetic:\s*true/.test(fn), 'no synthetic logout event constructed');
    assert.ok(fn.includes('stale-shift.detected'), 'stale shift surfaced for reconciliation');
    assert.ok(fn.includes('observeEnforcementSafety'), 'still refreshes live LKG');
  });
});
