import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeEquipmentRelease } from './ssoEquipmentAuthority.js';

const handoff = {
  shiftId: '2026-09-05_070000',
  phase: 'pre_trip' as const,
  expiresAtMs: 2_000,
};

describe('computeEquipmentRelease', () => {
  it('holds while restoration is pending — cached flags cannot release', () => {
    const r = computeEquipmentRelease({
      restoration: 'pending',
      periodId: '2026-09-05_070000',
      handoff,
      nowMs: 1_000,
    });
    assert.equal(r.release, 'pending');
    assert.equal(r.binding, null);
  });

  it('holds while restoration is open but no handoff yet', () => {
    const r = computeEquipmentRelease({
      restoration: 'open',
      periodId: '2026-09-05_070000',
      handoff: null,
      nowMs: 1_000,
    });
    assert.equal(r.release, 'pending');
    assert.equal(r.binding, null);
  });

  it('releases exactly once for matching unexpired handoff + server period', () => {
    const r = computeEquipmentRelease({
      restoration: 'open',
      periodId: '2026-09-05_070000',
      handoff,
      nowMs: 1_000,
    });
    assert.equal(r.release, 'open');
    assert.deepEqual(r.binding, { shiftId: '2026-09-05_070000', phase: 'pre_trip' });
  });

  it('fails closed on mismatched handoff', () => {
    const r = computeEquipmentRelease({
      restoration: 'open',
      periodId: '2026-09-05_070000',
      handoff: { ...handoff, shiftId: 'other' },
      nowMs: 1_000,
    });
    assert.equal(r.release, 'failed');
    assert.equal(r.binding, null);
  });

  it('fails closed on expired handoff', () => {
    const r = computeEquipmentRelease({
      restoration: 'open',
      periodId: '2026-09-05_070000',
      handoff,
      nowMs: 9_000,
    });
    assert.equal(r.release, 'failed');
  });

  it('server none / failed never bind', () => {
    assert.equal(
      computeEquipmentRelease({
        restoration: 'none',
        periodId: null,
        handoff,
        nowMs: 1_000,
      }).release,
      'none',
    );
    assert.equal(
      computeEquipmentRelease({
        restoration: 'failed',
        periodId: '2026-09-05_070000',
        handoff,
        nowMs: 1_000,
      }).release,
      'failed',
    );
  });

  it('periodId-only without restoration open cannot authorize', () => {
    const r = computeEquipmentRelease({
      restoration: 'pending',
      periodId: '2026-09-05_070000',
      handoff: null,
      nowMs: 1_000,
    });
    assert.equal(r.binding, null);
  });
});
