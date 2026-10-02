// Run: npx tsx --test src/core/services/dvirGate/arrivalJsaClose.test.ts
//
// The JSA gate at the close itself.
//
// The gate it replaces sat on day-summary's Log Out button — which day-summary
// documents as running AFTER shift finalization. So on a required company the
// shift was already closed before anything asked about the JSA: the gate could
// not prevent a close, only strand a logout. It now runs inside
// finalizeArrival, the one place the shift is closed.
//
// These tests cover the cases the pure rule cannot: duplicate final submit, a
// failed close and its retry, a blocked close that must not cost the driver the
// odometer they typed, and a cold start after being sent to WB JSA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeArrival } from './arrivalCoordinator';
import { saveReceiptIdempotent } from './dvirReceiptStore';
import { writeArrivalRecord, readArrivalRecord } from './arrivalFlow';
import type { DvirGateDeps } from './dvirGateService';
import type { JsaCloseDecision } from '../shiftJsaClose';

const SHIFT = '2026-10-01_071500';

function memKv() {
  const data = new Map<string, string>();
  return {
    data,
    kv: {
      getItem: async (k: string) => data.get(k) ?? null,
      setItem: async (k: string, v: string) => { data.set(k, v); },
      removeItem: async (k: string) => { data.delete(k); },
    },
  };
}

function gateDeps(kv: ReturnType<typeof memKv>['kv'], shiftId: string | null = SHIFT): DvirGateDeps {
  return {
    kv,
    sha256Hex: async (s: string) => s,
    openUrl: async () => {},
    getCurrentShiftId: async () => shiftId,
  };
}

/** An arrived shift with a valid Post-Trip receipt — ready for the final submit. */
async function arrivedAwaitingFinal(kv: ReturnType<typeof memKv>['kv']) {
  await writeArrivalRecord(kv, {
    shiftId: SHIFT,
    arrivedAtIso: '2026-10-01T23:40:00.000Z',
    stage: 'awaiting_final',
  });
  await saveReceiptIdempotent(kv, {
    shiftId: SHIFT,
    phase: 'post_trip',
    receiptId: 'r-post-1',
  } as any);
}

const FINALIZE: JsaCloseDecision = {
  kind: 'finalize', via: 'shift_close', signature: 'signed', artifact: 'present', caveats: [],
};
const NOT_REQUIRED: JsaCloseDecision = { kind: 'not_required', reason: 'mode_off' };
const BLOCKED: JsaCloseDecision = {
  kind: 'blocked',
  reason: 'acknowledgment_outstanding',
  route: 'read_jsa',
  message: 'One location on your JSA still needs to be acknowledged. Open the JSA to finish it.',
  outstandingLocations: [{ recordId: 'opB', locationId: 'well-7', label: 'Well 7' }],
};

// ── No closure before the evidence is verified ───────────────────────────────

test('a blocked JSA decision does not close the shift', async () => {
  const { kv } = memKv();
  await arrivedAwaitingFinal(kv);
  let closes = 0;
  const result = await finalizeArrival(gateDeps(kv), {
    paperworkConfirmed: true,
    odometerMiles: 412,
    close: async () => { closes += 1; return true; },
    jsaGate: async () => BLOCKED,
  });
  assert.equal(result.ok, false);
  assert.equal(closes, 0, 'the close must not run while the JSA is unverified');
  if (result.ok) return;
  assert.equal(result.reason, 'jsa:acknowledgment_outstanding');
  assert.equal(result.recoverable, true);
  assert.equal(result.jsa?.kind, 'blocked');
});

test('a blocked close keeps the arrival record and the typed odometer', async () => {
  // The driver is about to be sent to WB JSA. Coming back must not cost them
  // the reading they already entered.
  const { kv } = memKv();
  await arrivedAwaitingFinal(kv);
  await finalizeArrival(gateDeps(kv), {
    paperworkConfirmed: true,
    odometerMiles: 412,
    close: async () => true,
    jsaGate: async () => BLOCKED,
  });
  const record = await readArrivalRecord(kv);
  assert.ok(record, 'the arrival must survive a blocked close');
  assert.equal(record!.shiftId, SHIFT);
  assert.equal(record!.stage, 'awaiting_final');
  assert.equal(record!.odometerMiles, 412);
});

test('the blocked decision carries the specific outstanding location to the driver', async () => {
  const { kv } = memKv();
  await arrivedAwaitingFinal(kv);
  const result = await finalizeArrival(gateDeps(kv), {
    paperworkConfirmed: true,
    odometerMiles: 412,
    close: async () => true,
    jsaGate: async () => BLOCKED,
  });
  assert.equal(result.ok, false);
  if (result.ok || result.jsa?.kind !== 'blocked') return;
  assert.equal(result.jsa.route, 'read_jsa');
  assert.deepEqual(result.jsa.outstandingLocations.map(l => l.locationId), ['well-7']);
});

test('after the JSA is finished, the same submit closes', async () => {
  const { kv } = memKv();
  await arrivedAwaitingFinal(kv);
  const deps = gateDeps(kv);
  const blocked = await finalizeArrival(deps, {
    paperworkConfirmed: true, odometerMiles: 412, close: async () => true, jsaGate: async () => BLOCKED,
  });
  assert.equal(blocked.ok, false);
  // Driver goes to WB JSA, acknowledges, comes back. Same submit, new evidence.
  let closedWith: number | undefined = -1;
  const ok = await finalizeArrival(deps, {
    paperworkConfirmed: true,
    odometerMiles: 412,
    close: async (m) => { closedWith = m; return true; },
    jsaGate: async () => FINALIZE,
  });
  assert.equal(ok.ok, true);
  assert.equal(closedWith, 412);
  assert.equal(await readArrivalRecord(kv), null, 'a successful close clears the arrival');
});

// ── The normal signed case asks for nothing more ─────────────────────────────

test('a finalize decision closes with no further prompt', async () => {
  const { kv } = memKv();
  await arrivedAwaitingFinal(kv);
  const result = await finalizeArrival(gateDeps(kv), {
    paperworkConfirmed: true,
    odometerMiles: 300,
    close: async () => true,
    jsaGate: async () => FINALIZE,
  });
  assert.equal(result.ok, true);
  assert.equal(result.jsa?.kind, 'finalize');
});

test('an Off company closes without the gate changing anything', async () => {
  const { kv } = memKv();
  await arrivedAwaitingFinal(kv);
  const result = await finalizeArrival(gateDeps(kv), {
    paperworkConfirmed: true,
    odometerMiles: 300,
    close: async () => true,
    jsaGate: async () => NOT_REQUIRED,
  });
  assert.equal(result.ok, true);
  assert.equal(result.jsa?.kind, 'not_required');
});

test('the close path without a JSA gate is unchanged', async () => {
  // The prior Post-Trip-first behaviour must stand where no gate is supplied.
  const { kv } = memKv();
  await arrivedAwaitingFinal(kv);
  const result = await finalizeArrival(gateDeps(kv), {
    paperworkConfirmed: true, odometerMiles: 300, close: async () => true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.jsa, undefined);
  assert.equal(await readArrivalRecord(kv), null);
});

// ── Gate ordering: local preconditions first ─────────────────────────────────

test('the JSA gate is not consulted while Post-Trip is still missing', async () => {
  const { kv } = memKv();
  await writeArrivalRecord(kv, {
    shiftId: SHIFT, arrivedAtIso: '2026-10-01T23:40:00.000Z', stage: 'awaiting_post_trip',
  });
  let gateCalls = 0;
  const result = await finalizeArrival(gateDeps(kv), {
    paperworkConfirmed: true,
    odometerMiles: 300,
    close: async () => true,
    jsaGate: async () => { gateCalls += 1; return FINALIZE; },
  });
  assert.equal(result.ok, false);
  assert.equal(gateCalls, 0, 'no network trip while the local preconditions are unmet');
});

test('the JSA gate is not consulted when paperwork is unconfirmed', async () => {
  const { kv } = memKv();
  await arrivedAwaitingFinal(kv);
  let gateCalls = 0;
  const result = await finalizeArrival(gateDeps(kv), {
    paperworkConfirmed: false,
    odometerMiles: 300,
    close: async () => true,
    jsaGate: async () => { gateCalls += 1; return FINALIZE; },
  });
  assert.equal(result.ok, false);
  assert.equal(gateCalls, 0);
});

// ── Duplicate final submit ───────────────────────────────────────────────────

test('a duplicate final submit closes once', async () => {
  const { kv } = memKv();
  await arrivedAwaitingFinal(kv);
  const deps = gateDeps(kv);
  let closes = 0;
  const opts = {
    paperworkConfirmed: true,
    odometerMiles: 275,
    close: async () => { closes += 1; return true; },
    jsaGate: async () => FINALIZE,
  };
  const first = await finalizeArrival(deps, opts);
  const second = await finalizeArrival(deps, opts);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false, 'the second submit has no arrival record to close');
  assert.equal(closes, 1);
});

test('a duplicate submit does not consult the JSA gate twice', async () => {
  const { kv } = memKv();
  await arrivedAwaitingFinal(kv);
  const deps = gateDeps(kv);
  let gateCalls = 0;
  const opts = {
    paperworkConfirmed: true,
    odometerMiles: 275,
    close: async () => true,
    jsaGate: async () => { gateCalls += 1; return FINALIZE; },
  };
  await finalizeArrival(deps, opts);
  await finalizeArrival(deps, opts);
  assert.equal(gateCalls, 1);
});

// ── Failed shift close, and the retry ────────────────────────────────────────

test('a failed close after a passing JSA gate is retryable and keeps the reading', async () => {
  const { kv } = memKv();
  await arrivedAwaitingFinal(kv);
  const deps = gateDeps(kv);
  const failed = await finalizeArrival(deps, {
    paperworkConfirmed: true, odometerMiles: 512, close: async () => false, jsaGate: async () => FINALIZE,
  });
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(failed.reason, 'close_failed');
  // The JSA decision is reported alongside the failure, so a close failure is
  // never misread as a JSA problem.
  assert.equal(failed.jsa?.kind, 'finalize');
  const held = await readArrivalRecord(kv);
  assert.equal(held!.odometerMiles, 512);

  const retry = await finalizeArrival(deps, {
    paperworkConfirmed: true, odometerMiles: 512, close: async () => true, jsaGate: async () => FINALIZE,
  });
  assert.equal(retry.ok, true);
  assert.equal(await readArrivalRecord(kv), null);
});

test('a throwing close is a failed close, not a silent one', async () => {
  const { kv } = memKv();
  await arrivedAwaitingFinal(kv);
  const result = await finalizeArrival(gateDeps(kv), {
    paperworkConfirmed: true,
    odometerMiles: 100,
    close: async () => { throw new Error('offline'); },
    jsaGate: async () => FINALIZE,
  });
  assert.equal(result.ok, false);
  assert.ok(await readArrivalRecord(kv), 'the arrival survives a thrown close');
});

test('a failed close does not promote the odometer prefill', async () => {
  const { kv } = memKv();
  await arrivedAwaitingFinal(kv);
  let prefilled = 0;
  await finalizeArrival(gateDeps(kv), {
    paperworkConfirmed: true,
    odometerMiles: 90,
    close: async () => false,
    jsaGate: async () => FINALIZE,
    onPrefillOdometer: async () => { prefilled += 1; },
  });
  assert.equal(prefilled, 0);
});

// ── Process restart ──────────────────────────────────────────────────────────

test('a cold start after a blocked close returns to the final step with the reading', async () => {
  const { kv, data } = memKv();
  await arrivedAwaitingFinal(kv);
  await finalizeArrival(gateDeps(kv), {
    paperworkConfirmed: true, odometerMiles: 333, close: async () => true, jsaGate: async () => BLOCKED,
  });
  // Process dies in WB JSA and comes back: a fresh kv view over the same store.
  const coldKv = {
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => { data.set(k, v); },
    removeItem: async (k: string) => { data.delete(k); },
  };
  const record = await readArrivalRecord(coldKv);
  assert.equal(record!.stage, 'awaiting_final');
  assert.equal(record!.odometerMiles, 333);
  const result = await finalizeArrival(gateDeps(coldKv), {
    paperworkConfirmed: true, odometerMiles: 333, close: async () => true, jsaGate: async () => FINALIZE,
  });
  assert.equal(result.ok, true);
});

test('a blocked close for another shift cannot be finalized by this one', async () => {
  const { kv } = memKv();
  await arrivedAwaitingFinal(kv);
  // The period moved on while the driver was away.
  const result = await finalizeArrival(gateDeps(kv, '2026-10-02_060000'), {
    paperworkConfirmed: true, odometerMiles: 333, close: async () => true, jsaGate: async () => FINALIZE,
  });
  assert.equal(result.ok, false);
});
