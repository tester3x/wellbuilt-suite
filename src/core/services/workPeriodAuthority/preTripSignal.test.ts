import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { derivePreTripSignal, type PreTripEvidence } from './preTripSignal.js';

const MIKE = '2026-08-23_232617';

function ev(over: Partial<PreTripEvidence> = {}): PreTripEvidence {
  return {
    activePeriodId: MIKE,
    readOk: true,
    rawPresent: false,
    parseError: false,
    receiptShiftId: null,
    receiptPhaseIsPreTrip: false,
    ...over,
  };
}

describe('derivePreTripSignal (period-scoped, pure)', () => {
  it('exact-period completed Pre-Trip receipt → yes', () => {
    assert.equal(
      derivePreTripSignal(ev({ rawPresent: true, receiptShiftId: MIKE, receiptPhaseIsPreTrip: true })),
      'yes',
    );
  });

  it('no exact-period receipt (successful read) → no', () => {
    assert.equal(derivePreTripSignal(ev({ rawPresent: false })), 'no');
  });

  it('another period is under a different key (not read here) → no, never yes', () => {
    // A receipt belonging to another period lives at a different store key, so
    // reading THIS period's key finds nothing.
    assert.equal(derivePreTripSignal(ev({ rawPresent: false })), 'no');
  });

  it('a pending End Shift flag cannot influence the signal (it is not an input) → no', () => {
    // derivePreTripSignal has no pending parameter by design; absence of an
    // exact-period receipt is 'no' regardless of any pending flag.
    assert.equal(derivePreTripSignal(ev({ rawPresent: false })), 'no');
  });

  it('present receipt with mismatched internal shiftId → legacy_unscoped (never yes)', () => {
    assert.equal(
      derivePreTripSignal(ev({ rawPresent: true, receiptShiftId: '2026-08-01_000000', receiptPhaseIsPreTrip: true })),
      'legacy_unscoped',
    );
  });

  it('present receipt with empty/absent internal shiftId → legacy_unscoped', () => {
    assert.equal(derivePreTripSignal(ev({ rawPresent: true, receiptShiftId: null, receiptPhaseIsPreTrip: true })), 'legacy_unscoped');
    assert.equal(derivePreTripSignal(ev({ rawPresent: true, receiptShiftId: '', receiptPhaseIsPreTrip: true })), 'legacy_unscoped');
  });

  it('present receipt whose phase is not pre_trip → legacy_unscoped (not yes)', () => {
    assert.equal(
      derivePreTripSignal(ev({ rawPresent: true, receiptShiftId: MIKE, receiptPhaseIsPreTrip: false })),
      'legacy_unscoped',
    );
  });

  it('present but unparseable receipt → legacy_unscoped', () => {
    assert.equal(derivePreTripSignal(ev({ rawPresent: true, parseError: true })), 'legacy_unscoped');
  });

  it('storage/read failure → indeterminate (never assume yes or no)', () => {
    assert.equal(derivePreTripSignal(ev({ readOk: false })), 'indeterminate');
    // read failure dominates even if a stale raw was partially observed
    assert.equal(derivePreTripSignal(ev({ readOk: false, rawPresent: true, receiptShiftId: MIKE, receiptPhaseIsPreTrip: true })), 'indeterminate');
  });
});
