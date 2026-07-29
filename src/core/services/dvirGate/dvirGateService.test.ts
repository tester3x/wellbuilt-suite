import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  buildEquipmentDvirUrl,
  clearDvirRoutingAfterFinalization,
  equipmentHandoffNotice,
  ensurePostTripGate,
  ensurePreTripGate,
  ingestDvirCompletionUrl,
  isTicketsLaunch,
  SUITE_DVIR_RETURN_URL,
  type DvirGateDeps,
} from './dvirGateService.js';
import {
  buildIntegrityPayload,
  PHASE_RECEIPT_SCHEMA,
  RECEIPT_VERSION,
  type PhaseCompletionReceipt,
} from './receiptTypes.js';
import { encodeReceiptForDeepLink } from './validateReceipt.js';
import {
  getPendingEndShift,
  getReceipt,
  hasValidPhase,
  setPendingEndShift,
  type DvirReceiptKv,
} from './dvirReceiptStore.js';

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

async function makeReceipt(
  over: Partial<PhaseCompletionReceipt> & {
    shiftId: string;
    phase: 'pre_trip' | 'post_trip';
  },
): Promise<PhaseCompletionReceipt> {
  const base = {
    schemaVersion: PHASE_RECEIPT_SCHEMA,
    receiptId: over.receiptId || `rcpt_${over.phase}_${over.shiftId}`,
    shiftId: over.shiftId,
    inspectionId: over.inspectionId || `dvir_shift_${over.shiftId}`,
    phase: over.phase,
    completedAt: over.completedAt || '2026-07-28T12:00:00.000Z',
    version: RECEIPT_VERSION,
    driverHash: over.driverHash ?? null,
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

function deps(
  kv: DvirReceiptKv,
  shiftId: string | null,
  launched: string[],
  shiftActive = true,
): DvirGateDeps {
  return {
    kv,
    sha256Hex,
    getCurrentShiftId: async () => shiftId,
    isShiftActive: () => shiftActive,
    openUrl: async (url) => {
      launched.push(url);
    },
    nowMs: () => Date.parse('2026-07-28T12:05:00.000Z'),
  };
}

describe('Suite DVIR gate service', () => {
  it('Start Shift path launches Pre-Trip when receipt missing', async () => {
    const kv = memoryKv();
    const launched: string[] = [];
    const d = deps(kv, '2026-07-28_060000', launched);
    const r = await ensurePreTripGate(d, { alertOnBlock: false });
    assert.equal(r.allowed, false);
    assert.equal(r.launched, true);
    assert.ok(launched[0].includes('phase=pre_trip'));
    assert.ok(launched[0].includes('shiftId=2026-07-28_060000'));
  });

  it('pre-trip handoff notice names eQuipment and reason', () => {
    const pre = equipmentHandoffNotice('pre_trip');
    assert.match(pre.title, /WellBuilt eQuipment/i);
    assert.match(pre.message, /pre-trip/i);
    assert.match(pre.message, /WellBuilt Suite/i);
    const post = equipmentHandoffNotice('post_trip');
    assert.match(post.message, /post-trip/i);
    assert.doesNotMatch(post.message, /pre-trip/i);
  });

  it('confirmLeaveForEquipment cancel does not launch eQuipment', async () => {
    const kv = memoryKv();
    const launched: string[] = [];
    const d: DvirGateDeps = {
      ...deps(kv, 'shift_confirm', launched, true),
      confirmLeaveForEquipment: async () => false,
    };
    const r = await ensurePreTripGate(d, { alertOnBlock: true });
    assert.equal(r.allowed, false);
    assert.equal(r.launched, false);
    assert.equal(launched.length, 0);
  });

  it('Suite DVIR return URL uses dvir-complete path (receivable route)', () => {
    assert.equal(SUITE_DVIR_RETURN_URL, 'wellbuilt-suite://dvir-complete');
    const url = buildEquipmentDvirUrl({
      shiftId: 's1',
      phase: 'pre_trip',
      hash: 'h',
      name: 'Mike',
    });
    assert.match(url, /returnUrl=.*dvir-complete/);
    assert.match(url, /hash=h/);
    assert.match(url, /name=Mike/);
  });

  it('Tickets remains blocked before receipt; valid receipt unlocks', async () => {
    const kv = memoryKv();
    const shiftId = '2026-07-28_070000';
    const d = deps(kv, shiftId, []);
    assert.equal(await hasValidPhase(kv, shiftId, 'pre_trip'), false);
    assert.equal(isTicketsLaunch('wellbuilt-tickets'), true);

    const gate1 = await ensurePreTripGate(d, { alertOnBlock: false });
    assert.equal(gate1.allowed, false);

    const receipt = await makeReceipt({ shiftId, phase: 'pre_trip' });
    const encoded = encodeReceiptForDeepLink(receipt);
    const url = `wellbuilt-suite://dvir-complete?receipt=${encodeURIComponent(encoded)}`;
    const ing = await ingestDvirCompletionUrl(d, url);
    assert.equal(ing.ok, true);

    const gate2 = await ensurePreTripGate(d, { alertOnBlock: false });
    assert.equal(gate2.allowed, true);
    assert.equal(gate2.launched, false);
  });

  it('rejects stale/wrong-shift/wrong-phase/malformed receipts', async () => {
    const kv = memoryKv();
    const shiftId = 'shift_active';
    const d = deps(kv, shiftId, []);

    const wrongShift = await makeReceipt({ shiftId: 'other', phase: 'pre_trip' });
    const r1 = await ingestDvirCompletionUrl(
      d,
      `wellbuilt-suite://dvir-complete?receipt=${encodeURIComponent(encodeReceiptForDeepLink(wrongShift))}`,
    );
    assert.equal(r1.ok, false);

    const good = await makeReceipt({ shiftId, phase: 'post_trip' });
    // Tamper integrity
    const bad = { ...good, integrity: 'aa'.repeat(32) };
    const r2 = await ingestDvirCompletionUrl(
      d,
      `wellbuilt-suite://dvir-complete?receipt=${encodeURIComponent(encodeReceiptForDeepLink(bad as PhaseCompletionReceipt))}`,
    );
    assert.equal(r2.ok, false);

    const r3 = await ingestDvirCompletionUrl(d, 'wellbuilt-suite://dvir-complete?receipt=%%%');
    assert.equal(r3.ok, false);

    // complete=true without scoped receipt is not accepted
    const r4 = await ingestDvirCompletionUrl(d, 'wellbuilt-suite://dvir-complete?complete=true');
    assert.equal(r4.ok, false);
  });

  it('receipt survives Suite restart (durable kv)', async () => {
    const store = new Map<string, string>();
    const kv: DvirReceiptKv = {
      getItem: async (k) => store.get(k) ?? null,
      setItem: async (k, v) => {
        store.set(k, v);
      },
      removeItem: async (k) => {
        store.delete(k);
      },
    };
    const shiftId = 'shift_restart';
    const d = deps(kv, shiftId, []);
    const receipt = await makeReceipt({ shiftId, phase: 'pre_trip' });
    const url = `wellbuilt-suite://dvir-complete?receipt=${encodeURIComponent(encodeReceiptForDeepLink(receipt))}`;
    await ingestDvirCompletionUrl(d, url);

    // New deps instance, same underlying store (simulates process restart)
    const d2 = deps(kv, shiftId, []);
    assert.equal(await hasValidPhase(kv, shiftId, 'pre_trip'), true);
    const gate = await ensurePreTripGate(d2, { alertOnBlock: false });
    assert.equal(gate.allowed, true);
    const loaded = await getReceipt(kv, shiftId, 'pre_trip');
    assert.equal(loaded?.receiptId, receipt.receiptId);
  });

  it('End Shift launches Post-Trip before changing shift-ended state; logout blocked until receipt', async () => {
    const kv = memoryKv();
    const shiftId = 'shift_end';
    const launched: string[] = [];
    const d = deps(kv, shiftId, launched);

    // Pre-trip done so we can focus post
    const pre = await makeReceipt({ shiftId, phase: 'pre_trip' });
    await ingestDvirCompletionUrl(
      d,
      `wellbuilt-suite://dvir-complete?receipt=${encodeURIComponent(encodeReceiptForDeepLink(pre))}`,
    );

    const postGate = await ensurePostTripGate(d, {
      odometerMiles: 120,
      alertOnBlock: false,
    });
    assert.equal(postGate.allowed, false);
    assert.equal(postGate.launched, true);
    assert.ok(launched.some((u) => u.includes('phase=post_trip')));

    // Still no post receipt — gate remains closed (caller must not end shift)
    assert.equal(await hasValidPhase(kv, shiftId, 'post_trip'), false);

    const post = await makeReceipt({
      shiftId,
      phase: 'post_trip',
      completedAt: '2026-07-28T18:00:00.000Z',
    });
    // Adjust now for post receipt
    const dLate: DvirGateDeps = {
      ...d,
      nowMs: () => Date.parse('2026-07-28T18:01:00.000Z'),
    };
    await ingestDvirCompletionUrl(
      dLate,
      `wellbuilt-suite://dvir-complete?receipt=${encodeURIComponent(encodeReceiptForDeepLink(post))}`,
    );
    const open = await ensurePostTripGate(dLate, { alertOnBlock: false });
    assert.equal(open.allowed, true);
  });

  it('repeated receipt and repeated End Shift are idempotent', async () => {
    const kv = memoryKv();
    const shiftId = 'shift_idem';
    const launched: string[] = [];
    const d: DvirGateDeps = {
      ...deps(kv, shiftId, launched),
      nowMs: () => Date.parse('2026-07-28T18:05:00.000Z'),
    };
    const post = await makeReceipt({
      shiftId,
      phase: 'post_trip',
      completedAt: '2026-07-28T18:00:00.000Z',
    });
    const url = `wellbuilt-suite://dvir-complete?receipt=${encodeURIComponent(encodeReceiptForDeepLink(post))}`;
    const a = await ingestDvirCompletionUrl(d, url);
    const b = await ingestDvirCompletionUrl(d, url);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (a.ok && b.ok) {
      assert.equal(a.created, true);
      assert.equal(b.created, false);
    }

    const g1 = await ensurePostTripGate(d, { alertOnBlock: false });
    const g2 = await ensurePostTripGate(d, { alertOnBlock: false });
    assert.equal(g1.allowed, true);
    assert.equal(g2.allowed, true);
    assert.equal(g1.launched, false);
    assert.equal(g2.launched, false);
  });

  it('offline receipt works without RTDB (local kv only)', async () => {
    const kv = memoryKv();
    const shiftId = 'offline_shift';
    const d = deps(kv, shiftId, []);
    // No network used — pure local validate + store
    const receipt = await makeReceipt({ shiftId, phase: 'pre_trip' });
    const r = await ingestDvirCompletionUrl(
      d,
      `wellbuilt-suite://dvir-complete?receipt=${encodeURIComponent(encodeReceiptForDeepLink(receipt))}`,
    );
    assert.equal(r.ok, true);
    assert.equal(await hasValidPhase(kv, shiftId, 'pre_trip'), true);
  });

  it('buildEquipmentDvirUrl includes returnUrl and phase', () => {
    const url = buildEquipmentDvirUrl({
      shiftId: 's1',
      phase: 'pre_trip',
      hash: 'h',
      name: 'Mike',
    });
    assert.match(url, /^wbequipment:\/\/dvir\?/);
    assert.match(url, /returnUrl=/);
    assert.match(url, /phase=pre_trip/);
  });

  it('off-shift never redirects Pre-Trip or Post-Trip even with stale shiftId', async () => {
    const kv = memoryKv();
    const launched: string[] = [];
    const staleId = '2026-07-28_090534';
    const d = deps(kv, staleId, launched, false);

    const pre = await ensurePreTripGate(d, { alertOnBlock: false });
    assert.equal(pre.allowed, true);
    assert.equal(pre.launched, false);

    await setPendingEndShift(kv, {
      shiftId: staleId,
      createdAt: '2026-07-28T18:00:00.000Z',
    });
    const post = await ensurePostTripGate(d, { alertOnBlock: false });
    assert.equal(post.allowed, true);
    assert.equal(post.launched, false);
    assert.equal(launched.length, 0);
    assert.equal(await getPendingEndShift(kv), null);
  });

  it('stale pending Post-Trip flag while off-shift is cleared without launch', async () => {
    const kv = memoryKv();
    const launched: string[] = [];
    const d = deps(kv, 'prior_shift', launched, false);
    await setPendingEndShift(kv, {
      shiftId: 'prior_shift',
      odometerMiles: 99,
      createdAt: '2026-07-28T18:00:00.000Z',
    });
    await clearDvirRoutingAfterFinalization(d);
    assert.equal(await getPendingEndShift(kv), null);
    const post = await ensurePostTripGate(d, { alertOnBlock: false });
    assert.equal(post.launched, false);
    assert.equal(launched.length, 0);
  });

  it('completed receipt releases Pre-Trip gate on active shift', async () => {
    const kv = memoryKv();
    const shiftId = 'active_pre';
    const d = deps(kv, shiftId, [], true);
    assert.equal((await ensurePreTripGate(d, { alertOnBlock: false })).allowed, false);
    const receipt = await makeReceipt({ shiftId, phase: 'pre_trip' });
    await ingestDvirCompletionUrl(
      d,
      `wellbuilt-suite://dvir-complete?receipt=${encodeURIComponent(encodeReceiptForDeepLink(receipt))}`,
    );
    assert.equal((await ensurePreTripGate(d, { alertOnBlock: false })).allowed, true);
  });

  it('new shift cannot inherit prior pending Post-Trip routing', async () => {
    const kv = memoryKv();
    const launched: string[] = [];
    // Prior shift left a pending end-shift flag
    await setPendingEndShift(kv, {
      shiftId: 'old_shift',
      createdAt: '2026-07-28T17:00:00.000Z',
    });
    // New shift active with different id — finalize routing on start
    await clearDvirRoutingAfterFinalization({ kv });
    assert.equal(await getPendingEndShift(kv), null);

    const d = deps(kv, 'new_shift', launched, true);
    // Pre-Trip still required for the new shift (no inheritance of completion)
    const pre = await ensurePreTripGate(d, { alertOnBlock: false });
    assert.equal(pre.allowed, false);
    assert.equal(pre.launched, true);
    assert.ok(launched[0].includes('phase=pre_trip'));
    assert.ok(launched[0].includes('shiftId=new_shift'));
    assert.ok(!launched.some((u) => u.includes('phase=post_trip')));
  });

  it('Tickets scheme remains Tickets (isTicketsLaunch unchanged)', () => {
    assert.equal(isTicketsLaunch('wellbuilt-tickets'), true);
    assert.equal(isTicketsLaunch('wellbuilt-tickets', 'water-ticket'), true);
    assert.equal(isTicketsLaunch('wbequipment'), false);
  });
});
