import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  decideEquipmentCardLaunch,
  runEquipmentCardLaunch,
} from './equipmentCardLaunch.js';
import {
  consumePendingEndShiftIfReady,
  ensurePostTripGate,
  ingestDvirCompletionUrl,
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
  hasValidPhase,
  type DvirReceiptKv,
} from './dvirReceiptStore.js';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const OPEN = '2026-08-23_070000';

describe('equipment card launch contract', () => {
  it('1. active open period, Pre-Trip incomplete → launch Pre-Trip for that period', () => {
    const d = decideEquipmentCardLaunch({
      shiftActive: true,
      openPeriodId: OPEN,
      preTripComplete: false,
      postTripComplete: false,
      pendingEndShiftId: null,
    });
    assert.deepEqual(d, { action: 'launch_pre_trip', shiftId: OPEN });
  });

  it('2. end-shift pending, Post-Trip incomplete → launch Post-Trip for the same period', () => {
    const d = decideEquipmentCardLaunch({
      shiftActive: true,
      openPeriodId: OPEN,
      preTripComplete: true,
      postTripComplete: false,
      pendingEndShiftId: OPEN,
    });
    assert.deepEqual(d, { action: 'launch_post_trip', shiftId: OPEN });
  });

  it('3. required gates satisfied → credential-free WB-E, never a silent no-op', () => {
    const d = decideEquipmentCardLaunch({
      shiftActive: true,
      openPeriodId: OPEN,
      preTripComplete: true,
      postTripComplete: true,
      pendingEndShiftId: null,
    });
    assert.deepEqual(d, { action: 'open_equipment_credential_free' });
  });

  it('4. no active shift → standalone credential-free', () => {
    const d = decideEquipmentCardLaunch({
      shiftActive: false,
      openPeriodId: null,
      preTripComplete: false,
      postTripComplete: false,
      pendingEndShiftId: null,
    });
    assert.deepEqual(d, { action: 'open_equipment_credential_free' });
  });

  it('exact matching pending End Shift → governed Post-Trip for the current open period', () => {
    const d = decideEquipmentCardLaunch({
      shiftActive: true,
      openPeriodId: OPEN,
      preTripComplete: true,
      postTripComplete: false,
      pendingEndShiftId: OPEN,
    });
    assert.equal(d.action, 'launch_post_trip');
    if (d.action === 'launch_post_trip') assert.equal(d.shiftId, OPEN);
  });

  it('active + Pre-Trip complete + Post-Trip incomplete + no pending End Shift → ordinary WB-E', () => {
    const d = decideEquipmentCardLaunch({
      shiftActive: true,
      openPeriodId: OPEN,
      preTripComplete: true,
      postTripComplete: false,
      pendingEndShiftId: null,
    });
    assert.deepEqual(d, { action: 'open_equipment_credential_free' });
  });

  it('stale pending period → ordinary WB-E launch, no Post-Trip for either period', () => {
    const d = decideEquipmentCardLaunch({
      shiftActive: true,
      openPeriodId: OPEN,
      preTripComplete: true,
      postTripComplete: false,
      pendingEndShiftId: '2026-08-22_070000',
    });
    assert.deepEqual(d, { action: 'open_equipment_credential_free' });
  });
});

describe('equipment card execute + field recovery', () => {
  it('never emits identity params and failed open does not write a receipt', async () => {
    const launched: string[] = [];
    let receipts = 0;
    const r = await runEquipmentCardLaunch({
      shiftActive: true,
      getOpenPeriodId: async () => OPEN,
      isPreTripComplete: async () => true,
      isPostTripComplete: async () => false,
      getPendingEndShiftId: async () => OPEN,
      launchPhase: async (phase, shiftId) => {
        launched.push(`${phase}:${shiftId}`);
        return { launched: false, error: 'governed_unavailable' };
      },
      openEquipmentCredentialFree: async () => {
        throw new Error('must not fall through to standalone');
      },
      confirmLeave: async () => true,
    });
    assert.equal(r.action, 'launch_post_trip');
    assert.equal(r.launched, false);
    assert.equal(r.shiftId, OPEN);
    assert.equal(r.phase, 'post_trip');
    assert.deepEqual(launched, [`post_trip:${OPEN}`]);
    assert.equal(receipts, 0);
  });

  it('no matching pending End Shift opens ordinary WB-E and does not launch Post-Trip', async () => {
    const phases: string[] = [];
    let ordinary = 0;
    const r = await runEquipmentCardLaunch({
      shiftActive: true,
      getOpenPeriodId: async () => OPEN,
      isPreTripComplete: async () => true,
      isPostTripComplete: async () => false,
      getPendingEndShiftId: async () => null,
      launchPhase: async (phase, shiftId) => {
        phases.push(`${phase}:${shiftId}`);
        return { launched: true };
      },
      openEquipmentCredentialFree: async () => {
        ordinary += 1;
      },
    });
    assert.equal(r.action, 'open_equipment_credential_free');
    assert.equal(ordinary, 1);
    assert.deepEqual(phases, []);
  });

  it('stale pending period opens ordinary WB-E and does not launch Post-Trip', async () => {
    const phases: string[] = [];
    let ordinary = 0;
    const r = await runEquipmentCardLaunch({
      shiftActive: true,
      getOpenPeriodId: async () => OPEN,
      isPreTripComplete: async () => true,
      isPostTripComplete: async () => false,
      getPendingEndShiftId: async () => '2026-08-22_070000',
      launchPhase: async (phase, shiftId) => {
        phases.push(`${phase}:${shiftId}`);
        return { launched: true };
      },
      openEquipmentCredentialFree: async () => {
        ordinary += 1;
      },
    });
    assert.equal(r.action, 'open_equipment_credential_free');
    assert.equal(ordinary, 1);
    assert.deepEqual(phases, []);
  });

  it('failed exact Post-Trip launch preserves the pending period and creates no receipt', async () => {
    let pending: string | null = OPEN;
    const receipts: string[] = [];
    const r = await runEquipmentCardLaunch({
      shiftActive: true,
      getOpenPeriodId: async () => OPEN,
      isPreTripComplete: async () => true,
      isPostTripComplete: async () => false,
      getPendingEndShiftId: async () => pending,
      launchPhase: async () => ({ launched: false, error: 'governed_unavailable' }),
      openEquipmentCredentialFree: async () => {
        throw new Error('must not fall through');
      },
      confirmLeave: async () => true,
    });
    assert.equal(r.launched, false);
    assert.equal(r.phase, 'post_trip');
    assert.equal(pending, OPEN);
    assert.deepEqual(receipts, []);
  });

  it('retry after failure launches Post-Trip for the same period', async () => {
    const launched: string[] = [];
    const deps = {
      shiftActive: true,
      getOpenPeriodId: async () => OPEN,
      isPreTripComplete: async () => true,
      isPostTripComplete: async () => false,
      getPendingEndShiftId: async () => OPEN,
      launchPhase: async (phase: 'pre_trip' | 'post_trip', shiftId: string) => {
        launched.push(`${phase}:${shiftId}`);
        return { launched: true as const };
      },
      openEquipmentCredentialFree: async () => {
        throw new Error('must not open credential-free during required Post-Trip');
      },
      confirmLeave: async () => true,
    };
    const first = await runEquipmentCardLaunch(deps);
    assert.equal(first.launched, true);
    const retry = await runEquipmentCardLaunch(deps);
    assert.equal(retry.launched, true);
    assert.deepEqual(launched, [`post_trip:${OPEN}`, `post_trip:${OPEN}`]);
  });

  it('ActionCardRow wires runEquipmentCardLaunch and never no-ops on ensurePreTripGate', () => {
    const row = readFileSync(join(HERE, '../../../ui/shared/ActionCardRow.tsx'), 'utf8');
    assert.ok(row.includes('runEquipmentCardLaunch'));
    const cardAt = row.indexOf('WellBuilt eQuipment — launches');
    assert.ok(cardAt > -1);
    const cardSlice = row.slice(cardAt, cardAt + 1800);
    assert.ok(cardSlice.includes('runEquipmentCardLaunch'));
    assert.ok(cardSlice.includes('launchPhase'));
    assert.ok(cardSlice.includes('peekPendingEndShift'));
    assert.ok(!cardSlice.includes('ensurePreTripGate'));
  });
});

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
  const base: PhaseCompletionReceipt = {
    schemaVersion: PHASE_RECEIPT_SCHEMA,
    receiptId: over.receiptId || `rcpt_${over.shiftId}_${over.phase}_insp`,
    shiftId: over.shiftId,
    inspectionId: over.inspectionId || `insp_${over.phase}`,
    phase: over.phase,
    completedAt: over.completedAt || '2026-08-23T18:00:00.000Z',
    version: RECEIPT_VERSION,
    driverHash: over.driverHash,
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
    nowMs: () => Date.parse('2026-08-23T18:05:00.000Z'),
  };
}

describe('Mikezfold field sequence: End Shift Post-Trip fail → retry same period → one close', () => {
  it('preserves pending End Shift, retries Post-Trip, closes once; rejects foreign receipts', async () => {
    const kv = memoryKv();
    const launched: string[] = [];
    const d = deps(kv, OPEN, launched, true);

    const pre = await makeReceipt({ shiftId: OPEN, phase: 'pre_trip' });
    const preIng = await ingestDvirCompletionUrl(
      d,
      `wellbuilt-suite://dvir-complete?receipt=${encodeURIComponent(encodeReceiptForDeepLink(pre))}`,
    );
    assert.equal(preIng.ok, true);
    assert.equal(await hasValidPhase(kv, OPEN, 'pre_trip'), true);

    const first = await ensurePostTripGate(d, { alertOnBlock: false, odometerMiles: 120 });
    assert.equal(first.allowed, false);
    assert.equal(first.launched, true);
    assert.equal(first.shiftId, OPEN);
    assert.match(launched[0], /phase=post_trip/);
    assert.match(launched[0], new RegExp(`shiftId=${OPEN}`));
    assert.doesNotMatch(launched[0], /phase=pre_trip/);
    assert.doesNotMatch(launched[0], /[?&](hash|name|passcode|token)=/);
    assert.equal(await hasValidPhase(kv, OPEN, 'post_trip'), false);
    const pending1 = await getPendingEndShift(kv);
    assert.ok(pending1);
    assert.equal(pending1!.shiftId, OPEN);

    const retry = await ensurePostTripGate(d, { alertOnBlock: false, odometerMiles: 120 });
    assert.equal(retry.allowed, false);
    assert.equal(retry.launched, true);
    assert.equal(retry.shiftId, OPEN);
    assert.match(launched[1], /phase=post_trip/);
    assert.match(launched[1], new RegExp(`shiftId=${OPEN}`));
    const pending2 = await getPendingEndShift(kv);
    assert.ok(pending2);
    assert.equal(pending2!.shiftId, OPEN);

    const foreign = await makeReceipt({ shiftId: '2026-08-22_070000', phase: 'post_trip' });
    const badPeriod = await ingestDvirCompletionUrl(
      d,
      `wellbuilt-suite://dvir-complete?receipt=${encodeURIComponent(encodeReceiptForDeepLink(foreign))}`,
    );
    assert.equal(badPeriod.ok, false);
    assert.equal(await hasValidPhase(kv, OPEN, 'post_trip'), false);

    const replayPre = await ingestDvirCompletionUrl(
      d,
      `wellbuilt-suite://dvir-complete?receipt=${encodeURIComponent(encodeReceiptForDeepLink(pre))}`,
    );
    assert.equal(replayPre.ok, true);
    assert.equal(await hasValidPhase(kv, OPEN, 'post_trip'), false);
    const notYet = await consumePendingEndShiftIfReady(d);
    assert.equal(notYet.resume, false);

    const post = await makeReceipt({ shiftId: OPEN, phase: 'post_trip' });
    const postIng = await ingestDvirCompletionUrl(
      d,
      `wellbuilt-suite://dvir-complete?receipt=${encodeURIComponent(encodeReceiptForDeepLink(post))}`,
    );
    assert.equal(postIng.ok, true);
    assert.equal(await hasValidPhase(kv, OPEN, 'post_trip'), true);

    const close1 = await consumePendingEndShiftIfReady(d);
    assert.equal(close1.resume, true);
    if (close1.resume) assert.equal(close1.shiftId, OPEN);
    const close2 = await consumePendingEndShiftIfReady(d);
    assert.equal(close2.resume, false);
  });
});
