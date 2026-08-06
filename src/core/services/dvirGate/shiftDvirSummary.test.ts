import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  buildShiftDvirSummary,
  buildShiftDvirSummaryFromStore,
  hydrateShiftDvirSummaryIfMissing,
  loadLastFinalizedDvirSummary,
  loadShiftDvirSummary,
  overallDvirLabel,
  saveShiftDvirSummary,
} from './shiftDvirSummary.js';
import {
  buildIntegrityPayload,
  PHASE_RECEIPT_SCHEMA,
  RECEIPT_VERSION,
  type PhaseCompletionReceipt,
} from './receiptTypes.js';
import { saveReceiptIdempotent, type DvirReceiptKv } from './dvirReceiptStore.js';

function memoryKv(): DvirReceiptKv {
  const m = new Map<string, string>();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      m.set(k, v);
    },
    removeItem: async (k) => {
      m.delete(k);
    },
  };
}

async function sha256Hex(s: string): Promise<string> {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

async function receipt(
  shiftId: string,
  phase: 'pre_trip' | 'post_trip',
  completedAt: string,
): Promise<PhaseCompletionReceipt> {
  const base = {
    schemaVersion: PHASE_RECEIPT_SCHEMA,
    receiptId: `rcpt_${phase}_${shiftId}`,
    shiftId,
    inspectionId: `dvir_shift_${shiftId}`,
    phase,
    completedAt,
    version: RECEIPT_VERSION,
    driverHash: 'drv',
    integrity: '',
  };
  const integrity = await sha256Hex(
    buildIntegrityPayload({
      schemaVersion: base.schemaVersion,
      receiptId: base.receiptId,
      shiftId: base.shiftId,
      inspectionId: base.inspectionId,
      phase: base.phase,
      completedAt: base.completedAt,
      version: base.version,
      driverHash: base.driverHash,
    }),
  );
  return { ...base, integrity };
}

describe('Shift Complete DVIR summary', () => {
  it('normal Pre + Post displays both actual receipt times', async () => {
    const shiftId = '2026-07-28_normal';
    const pre = await receipt(shiftId, 'pre_trip', '2026-07-28T11:14:00.000Z');
    const post = await receipt(shiftId, 'post_trip', '2026-07-28T17:37:00.000Z');
    const s = buildShiftDvirSummary({
      shiftId,
      preReceipt: pre,
      postReceipt: post,
      truckUnit: '247',
      trailerUnit: 'T30',
    });
    assert.equal(s.overallStatus, 'completed');
    assert.equal(overallDvirLabel(s.overallStatus), 'Completed');
    assert.equal(s.preTrip.status, 'captured');
    assert.equal(s.preTrip.completedAt, '2026-07-28T11:14:00.000Z');
    assert.equal(s.postTrip.status, 'completed');
    assert.equal(s.postTrip.completedAt, '2026-07-28T17:37:00.000Z');
    assert.equal(s.truckUnit, '247');
    assert.equal(s.trailerUnit, 'T30');
  });

  it('legacy Post-only shows Pre not captured and actual Post time', async () => {
    const shiftId = '2026-07-28_090534';
    const post = await receipt(shiftId, 'post_trip', '2026-07-28T17:37:00.000Z');
    const s = buildShiftDvirSummary({
      shiftId,
      preReceipt: null,
      postReceipt: post,
      truckUnit: '247',
      trailerUnit: 'T30',
    });
    assert.equal(s.overallStatus, 'post_trip_completed');
    assert.equal(overallDvirLabel(s.overallStatus), 'Post-Trip completed');
    assert.equal(s.preTrip.status, 'not_captured');
    assert.equal(s.preTrip.completedAt, null);
    assert.equal(s.postTrip.status, 'completed');
    assert.equal(s.postTrip.completedAt, '2026-07-28T17:37:00.000Z');
  });

  it('missing data remains truthful (not available / missing)', () => {
    const s = buildShiftDvirSummary({
      shiftId: 'empty_shift',
      preReceipt: null,
      postReceipt: null,
    });
    assert.equal(s.overallStatus, 'not_available');
    assert.equal(s.preTrip.status, 'missing');
    assert.equal(s.postTrip.status, 'missing');
    assert.equal(s.preTrip.completedAt, null);
    assert.equal(s.postTrip.completedAt, null);
  });

  it('reopening Shift Complete preserves the DVIR summary', async () => {
    const kv = memoryKv();
    const shiftId = 'persist_shift';
    const pre = await receipt(shiftId, 'pre_trip', '2026-07-28T10:00:00.000Z');
    const post = await receipt(shiftId, 'post_trip', '2026-07-28T18:00:00.000Z');
    await saveReceiptIdempotent(kv, pre);
    await saveReceiptIdempotent(kv, post);
    const built = await buildShiftDvirSummaryFromStore(kv, shiftId, {
      truckUnit: '101',
    });
    await saveShiftDvirSummary(kv, built);

    const reloaded = await loadShiftDvirSummary(kv, shiftId);
    assert.ok(reloaded);
    assert.equal(reloaded!.preTrip.completedAt, '2026-07-28T10:00:00.000Z');
    assert.equal(reloaded!.postTrip.completedAt, '2026-07-28T18:00:00.000Z');

    const last = await loadLastFinalizedDvirSummary(kv);
    assert.ok(last);
    assert.equal(last!.shiftId, shiftId);
  });

  it('one shift cannot display another shift receipts', async () => {
    const kv = memoryKv();
    const a = 'shift_A';
    const b = 'shift_B';
    const preA = await receipt(a, 'pre_trip', '2026-07-28T09:00:00.000Z');
    const postB = await receipt(b, 'post_trip', '2026-07-28T19:00:00.000Z');
    await saveReceiptIdempotent(kv, preA);
    await saveReceiptIdempotent(kv, postB);

    const forA = await buildShiftDvirSummaryFromStore(kv, a);
    assert.equal(forA.preTrip.status, 'captured');
    assert.equal(forA.postTrip.status, 'missing');
    assert.notEqual(forA.postTrip.completedAt, '2026-07-28T19:00:00.000Z');

    const forB = await buildShiftDvirSummaryFromStore(kv, b);
    assert.equal(forB.preTrip.status, 'not_captured'); // post only
    assert.equal(forB.postTrip.completedAt, '2026-07-28T19:00:00.000Z');
    assert.notEqual(forB.preTrip.completedAt, '2026-07-28T09:00:00.000Z');
  });

  it('never uses shift clock times — only receipt completedAt', async () => {
    const shiftId = 'clock_guard';
    const post = await receipt(shiftId, 'post_trip', '2026-07-28T17:37:00.000Z');
    const s = buildShiftDvirSummary({
      shiftId,
      preReceipt: null,
      postReceipt: post,
      nowIso: '2026-07-28T23:59:00.000Z', // assembly time ≠ inspection time
    });
    assert.equal(s.postTrip.completedAt, '2026-07-28T17:37:00.000Z');
    assert.notEqual(s.postTrip.completedAt, s.finalizedAt);
  });

  it('cold upgrade: finalized legacy shift + durable Post-Trip receipt + no summary', async () => {
    // Physical: Post-Trip accepted before suite-dvir-summary existed.
    // Durable receipt remains; shiftSummary/{shiftId} was never written.
    const kv = memoryKv();
    const shiftId = '2026-07-28_090534';
    const post = await receipt(shiftId, 'post_trip', '2026-07-28T17:37:00.000Z');
    await saveReceiptIdempotent(kv, post);

    // Foreign-shift noise must not leak into hydration
    const foreign = await receipt('other_shift', 'pre_trip', '2026-07-28T08:00:00.000Z');
    await saveReceiptIdempotent(kv, foreign);

    assert.equal(await loadShiftDvirSummary(kv, shiftId), null);
    assert.equal(await loadLastFinalizedDvirSummary(kv), null);

    const first = await hydrateShiftDvirSummaryIfMissing(kv, shiftId, {
      truckUnit: '247',
      trailerUnit: 'T30',
    });
    assert.ok(first);
    assert.equal(first!.shiftId, shiftId);
    assert.equal(first!.preTrip.status, 'not_captured');
    assert.equal(first!.preTrip.completedAt, null);
    assert.equal(first!.postTrip.status, 'completed');
    assert.equal(first!.postTrip.completedAt, '2026-07-28T17:37:00.000Z');
    assert.equal(first!.overallStatus, 'post_trip_completed');
    assert.equal(overallDvirLabel(first!.overallStatus), 'Post-Trip completed');
    assert.equal(first!.truckUnit, '247');
    assert.equal(first!.trailerUnit, 'T30');

    // Persisted for reopen without re-finalization
    const stored = await loadShiftDvirSummary(kv, shiftId);
    assert.ok(stored);
    assert.equal(stored!.postTrip.completedAt, '2026-07-28T17:37:00.000Z');
    assert.equal(stored!.preTrip.status, 'not_captured');

    // Idempotent: second open returns same truth, does not invent Pre-Trip
    const second = await hydrateShiftDvirSummaryIfMissing(kv, shiftId, {
      truckUnit: '999', // must not rewrite existing summary
    });
    assert.ok(second);
    assert.equal(second!.truckUnit, '247'); // first persist wins
    assert.equal(second!.preTrip.status, 'not_captured');
    assert.equal(second!.postTrip.completedAt, '2026-07-28T17:37:00.000Z');
  });

  it('field defect: Pre-Trip Partial summary upgrades after durable Post-Trip receipt', async () => {
    // Reproduce: Pre-Trip finalize wrote Partial → Post-Trip receipt accepted →
    // day-summary hydrate must not freeze Partial / Post-Trip Not available.
    const kv = memoryKv();
    const shiftId = '2026-08-05_field_partial';
    const pre = await receipt(shiftId, 'pre_trip', '2026-08-05T14:12:00.000Z'); // 9:12 AM local-ish
    await saveReceiptIdempotent(kv, pre);

    const partial = await buildShiftDvirSummaryFromStore(kv, shiftId, {
      truckUnit: '102',
      trailerUnit: 'T30',
    });
    assert.equal(partial.overallStatus, 'partial');
    assert.equal(partial.postTrip.status, 'missing');
    await saveShiftDvirSummary(kv, partial);

    const post = await receipt(shiftId, 'post_trip', '2026-08-05T22:45:00.000Z');
    await saveReceiptIdempotent(kv, post);

    // Foreign shift noise must not leak
    const foreign = await receipt('other_shift', 'post_trip', '2026-08-05T23:00:00.000Z');
    await saveReceiptIdempotent(kv, foreign);

    const opened = await hydrateShiftDvirSummaryIfMissing(kv, shiftId, {
      truckUnit: '999',
      trailerUnit: 'T99',
    });
    assert.ok(opened);
    assert.equal(opened!.overallStatus, 'completed');
    assert.equal(overallDvirLabel(opened!.overallStatus), 'Completed');
    assert.equal(opened!.preTrip.status, 'captured');
    assert.equal(opened!.preTrip.completedAt, '2026-08-05T14:12:00.000Z');
    assert.equal(opened!.postTrip.status, 'completed');
    assert.equal(opened!.postTrip.completedAt, '2026-08-05T22:45:00.000Z');
    // Keep identity already on the Partial card when rebuilt truck is empty-overridden
    assert.equal(opened!.truckUnit, '102');
    assert.equal(opened!.trailerUnit, 'T30');

    const stored = await loadShiftDvirSummary(kv, shiftId);
    assert.equal(stored!.overallStatus, 'completed');
    assert.equal(stored!.postTrip.completedAt, '2026-08-05T22:45:00.000Z');
  });

  it('stale foreign-shift post receipt does not complete current shift summary', async () => {
    const kv = memoryKv();
    const shiftId = 'shift_current';
    const pre = await receipt(shiftId, 'pre_trip', '2026-08-05T12:00:00.000Z');
    await saveReceiptIdempotent(kv, pre);
    await saveShiftDvirSummary(
      kv,
      await buildShiftDvirSummaryFromStore(kv, shiftId, {
        truckUnit: '102',
        trailerUnit: 'T30',
      }),
    );
    const other = await receipt('shift_other', 'post_trip', '2026-08-05T20:00:00.000Z');
    await saveReceiptIdempotent(kv, other);

    const s = await hydrateShiftDvirSummaryIfMissing(kv, shiftId);
    assert.ok(s);
    assert.equal(s!.overallStatus, 'partial');
    assert.equal(s!.postTrip.status, 'missing');
  });

  it('pre-trip receipt alone cannot populate post-trip phase', async () => {
    const kv = memoryKv();
    const shiftId = 'shift_pre_only';
    const pre = await receipt(shiftId, 'pre_trip', '2026-08-05T12:00:00.000Z');
    await saveReceiptIdempotent(kv, pre);
    const s = await buildShiftDvirSummaryFromStore(kv, shiftId);
    assert.equal(s.postTrip.status, 'missing');
    assert.equal(s.postTrip.completedAt, null);
    assert.equal(s.overallStatus, 'partial');
  });
});
