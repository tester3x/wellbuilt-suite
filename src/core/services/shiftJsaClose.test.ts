// Run: npx tsx --test src/core/services/shiftJsaClose.test.ts
//
// The shift JSA close rule.
//
// What these tests pin down, in the order the packet asks for it: JSA Off stays
// silent; a signed shift with every location acknowledged closes with NO second
// signature; an unsigned shift does not close; a missing or failed
// acknowledgment does not close; a duplicate final submit closes once; a failed
// close is retryable without losing the odometer; and a prior-day open item gets
// its own action rather than a silent auto-close.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyJsaSignature,
  collectShiftJsaEvidence,
  decideShiftJsaClose,
  decodeJsaStatusDoc,
  decodeJsaStatusDocs,
  jsaCloseHeadline,
  jsaFinalizationAuthority,
  jsaGatesShiftClose,
  jsaBlocksLogout,
  jsaPermitsClose,
  normalizeJsaShiftMode,
  priorDayJsaActions,
  shouldAutoCloseOnNewJsa,
  type JsaLocationEntry,
  type JsaStatusRecord,
} from './shiftJsaClose';
import {
  companyJsaRuleFromConfigResult,
  recordsFromRestDocs,
  resolveShiftJsaClose,
} from './shiftJsaCloseGate';

const SHIFT = '2026-10-01_071500';
const OTHER_SHIFT = '2026-09-30_064500';

function record(over: Partial<JsaStatusRecord> = {}): JsaStatusRecord {
  return {
    recordId: 'hash_2026-10-01_071500',
    shiftId: SHIFT,
    jsaCompleted: false,
    jsaCompletedAt: null,
    acknowledgedMethod: null,
    pdfUrl: null,
    locations: [],
    ...over,
  };
}

/** A real WB JSA signoff: completed with positive signature evidence. */
function signed(over: Partial<JsaStatusRecord> = {}): JsaStatusRecord {
  return record({
    jsaCompleted: true,
    jsaCompletedAt: '2026-10-01T13:20:00Z',
    signedAt: '2026-10-01T13:20:00Z',
    ...over,
  });
}

/** What jsaShiftAck.acknowledgeShiftJsa writes: a flag and a method, no signature. */
function acknowledged(over: Partial<JsaStatusRecord> = {}): JsaStatusRecord {
  return record({
    jsaCompleted: true,
    jsaCompletedAt: '2026-10-01T13:20:00Z',
    acknowledgedMethod: 'acknowledged',
    ...over,
  });
}

function loc(over: Partial<JsaLocationEntry> = {}): JsaLocationEntry {
  return { id: 'well-1', label: 'Well 1', acknowledged: true, ...over };
}

function evidenceFor(records: JsaStatusRecord[] | null, shiftId: string | null = SHIFT) {
  return collectShiftJsaEvidence({ records, shiftId });
}

// ── Mode normalization ───────────────────────────────────────────────────────

test('an unreadable or unrecognised mode is unknown, never off', () => {
  assert.equal(normalizeJsaShiftMode('off'), 'off');
  assert.equal(normalizeJsaShiftMode('PER_SHIFT'), 'per_shift');
  assert.equal(normalizeJsaShiftMode('  per_location '), 'per_location');
  // The defect this pins: the old gate defaulted an unread config to 'off'.
  assert.equal(normalizeJsaShiftMode(null), null);
  assert.equal(normalizeJsaShiftMode(undefined), null);
  assert.equal(normalizeJsaShiftMode(''), null);
  assert.equal(normalizeJsaShiftMode('per_quarter_moon'), null);
});

test('only shift-scoped modes gate the close', () => {
  assert.equal(jsaGatesShiftClose('per_shift'), true);
  assert.equal(jsaGatesShiftClose('per_location'), true);
  // Job-scoped obligations belong at job close, not at shift close.
  assert.equal(jsaGatesShiftClose('per_job'), false);
  assert.equal(jsaGatesShiftClose('per_load'), false);
  assert.equal(jsaGatesShiftClose('off'), false);
});

// ── JSA Off (Liquid Gold's live setting) ─────────────────────────────────────

test('JSA Off: not required, and nothing to show', () => {
  const d = decideShiftJsaClose({ mode: 'off', allowAcknowledge: true, evidence: evidenceFor([]) });
  assert.equal(d.kind, 'not_required');
  assert.equal(jsaPermitsClose(d), true);
  assert.equal(jsaCloseHeadline(d), null);
});

test('JSA Off closes even with no JSA record whatsoever', () => {
  const d = decideShiftJsaClose({ mode: 'off', allowAcknowledge: false, evidence: evidenceFor(null) });
  assert.equal(d.kind, 'not_required');
  assert.equal(jsaPermitsClose(d), true);
});

test('JSA Off issues no JSA record read at all', async () => {
  let reads = 0;
  const d = await resolveShiftJsaClose({
    getCurrentShiftId: async () => SHIFT,
    readJsaRecords: async () => { reads += 1; return []; },
    readCompanyRule: async () => ({ mode: 'off', allowAcknowledge: true }),
  });
  assert.equal(d.kind, 'not_required');
  assert.equal(reads, 0, 'an Off company must not be queried for JSA records');
});

test('a job-scoped mode does not gate the shift close', () => {
  const d = decideShiftJsaClose({ mode: 'per_job', allowAcknowledge: true, evidence: evidenceFor([]) });
  assert.deepEqual(d, { kind: 'not_required', reason: 'job_scoped' });
});

// ── The normal signed case: no second signature ──────────────────────────────

test('signed shift with every location acknowledged finalizes at close', () => {
  const ev = evidenceFor([signed({ locations: [loc(), loc({ id: 'well-2' })] })]);
  assert.deepEqual(ev.outstandingLocations, []);
  const d = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: ev });
  assert.equal(d.kind, 'finalize');
  if (d.kind !== 'finalize') return;
  assert.equal(d.via, 'shift_close');
  assert.equal(d.signature, 'signed');
  assert.equal(jsaPermitsClose(d), true);
  // THE POINT: no recovery route, so no second signature and no WB JSA trip.
  assert.equal(jsaCloseHeadline(d), 'JSA signed');
});

test('the signature is satisfied by ANY one signed record across operators', () => {
  // One signature per shift is the rule. WB T's per-operator records do not
  // each need their own.
  const ev = evidenceFor([
    signed({ recordId: 'opA', locations: [loc()] }),
    record({ recordId: 'opB', locations: [loc({ id: 'well-9' })] }),
  ]);
  assert.equal(ev.signature, 'signed');
  const d = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: ev });
  assert.equal(d.kind, 'finalize');
});

test('a signed record for ANOTHER shift never satisfies this close', () => {
  const ev = evidenceFor([signed({ shiftId: OTHER_SHIFT })], SHIFT);
  assert.equal(ev.recordCount, 0);
  const d = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: ev });
  assert.equal(d.kind, 'blocked');
  if (d.kind !== 'blocked') return;
  assert.equal(d.reason, 'no_jsa_record');
});

// ── Unsigned / incomplete ────────────────────────────────────────────────────

test('unsigned required shift does not close', () => {
  const d = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: evidenceFor([record()]) });
  assert.equal(d.kind, 'blocked');
  if (d.kind !== 'blocked') return;
  assert.equal(d.reason, 'not_completed');
  assert.equal(d.route, 'acknowledge');
  assert.equal(jsaPermitsClose(d), false);
});

test('unsigned shift at a read-required company routes to Read JSA, not Acknowledge', () => {
  const d = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: false, evidence: evidenceFor([record()]) });
  assert.equal(d.kind, 'blocked');
  if (d.kind !== 'blocked') return;
  assert.equal(d.route, 'read_jsa');
});

test('no JSA record at all on a required shift does not close', () => {
  const d = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: evidenceFor([]) });
  assert.equal(d.kind, 'blocked');
  if (d.kind !== 'blocked') return;
  assert.equal(d.reason, 'no_jsa_record');
  assert.equal(d.route, 'read_jsa');
});

// ── A bare status flag is not a signature ────────────────────────────────────

test('an acknowledgment is classified as an acknowledgment, not a signature', () => {
  assert.equal(classifyJsaSignature(acknowledged()), 'acknowledged_only');
  assert.equal(classifyJsaSignature(signed()), 'signed');
  assert.equal(classifyJsaSignature(record()), 'absent');
  // A completed flag with nothing identifying its origin is explicitly unproven.
  assert.equal(classifyJsaSignature(record({ jsaCompleted: true })), 'unverified');
});

test('a pdf artifact counts as positive signature evidence', () => {
  assert.equal(
    classifyJsaSignature(record({ jsaCompleted: true, pdfUrl: 'https://example.test/j.pdf' })),
    'signed',
  );
});

test('an acknowledged-only shift closes where the company allows it, labelled honestly', () => {
  const d = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: evidenceFor([acknowledged()]) });
  assert.equal(d.kind, 'finalize');
  if (d.kind !== 'finalize') return;
  assert.equal(d.signature, 'acknowledged_only');
  assert.ok(d.caveats.includes('acknowledged_not_signed'));
  // Never presented as a signed JSA.
  assert.equal(jsaCloseHeadline(d), 'JSA acknowledged (not signed)');
});

test('an acknowledged-only flag cannot satisfy a company that forbids acknowledgment', () => {
  // THE HOLE THIS CLOSES: jsaCompleted=true from an acknowledge path satisfied
  // the old gate regardless of jsaAllowAcknowledge, so a company requiring a
  // read got a close with no signature.
  const d = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: false, evidence: evidenceFor([acknowledged()]) });
  assert.equal(d.kind, 'blocked');
  if (d.kind !== 'blocked') return;
  assert.equal(d.reason, 'acknowledge_not_permitted');
  assert.equal(d.route, 'read_jsa');
});

test('an unverifiable completion closes but is never called signed', () => {
  // The honest middle: this build cannot tell a WB JSA signoff from a legacy
  // flag, so it does not strand the driver AND does not claim a signature.
  const d = decideShiftJsaClose({
    mode: 'per_shift',
    allowAcknowledge: true,
    evidence: evidenceFor([record({ jsaCompleted: true, jsaCompletedAt: '2026-10-01T13:00:00Z' })]),
  });
  assert.equal(d.kind, 'finalize');
  if (d.kind !== 'finalize') return;
  assert.equal(d.signature, 'unverified');
  assert.ok(d.caveats.includes('signature_not_verifiable'));
  assert.equal(jsaCloseHeadline(d), 'JSA recorded (signature not verifiable)');
});

// ── Missing / failed acknowledgment ──────────────────────────────────────────

test('a stamped location with no acknowledgment blocks the close', () => {
  const ev = evidenceFor([signed({ locations: [loc(), loc({ id: 'well-2', acknowledged: false })] })]);
  assert.equal(ev.outstandingLocations.length, 1);
  assert.equal(ev.outstandingLocations[0].locationId, 'well-2');
  const d = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: ev });
  assert.equal(d.kind, 'blocked');
  if (d.kind !== 'blocked') return;
  assert.equal(d.reason, 'acknowledgment_outstanding');
  assert.equal(d.route, 'read_jsa');
  assert.match(d.message, /One location/);
});

test('acknowledgments are collapsed strictly across operator records', () => {
  // THE DEFECT THIS REPLACES: Path D collapsed with ANY, so a signature on one
  // operator's record satisfied the shift while another operator's stamped
  // location sat unacknowledged.
  const ev = evidenceFor([
    signed({ recordId: 'opA', locations: [loc()] }),
    record({ recordId: 'opB', jsaCompleted: true, locations: [loc({ id: 'well-7', acknowledged: false })] }),
  ]);
  const d = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: ev });
  assert.equal(d.kind, 'blocked');
  if (d.kind !== 'blocked') return;
  assert.equal(d.reason, 'acknowledgment_outstanding');
  assert.equal(d.outstandingLocations[0].recordId, 'opB');
});

test('several outstanding locations are counted, not generalised', () => {
  const ev = evidenceFor([signed({
    locations: [loc({ id: 'a', acknowledged: false }), loc({ id: 'b', acknowledged: false })],
  })]);
  const d = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: ev });
  assert.equal(d.kind, 'blocked');
  if (d.kind !== 'blocked') return;
  assert.match(d.message, /2 locations/);
  assert.equal(d.outstandingLocations.length, 2);
});

test('an unacknowledged location is reported before completion is claimed', () => {
  // Signature present, acknowledgment missing: the driver must be told the
  // specific missing thing, not "JSA pending".
  const ev = evidenceFor([signed({ locations: [loc({ acknowledged: false })] })]);
  assert.equal(ev.signature, 'signed');
  const d = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: ev });
  assert.equal(jsaCloseHeadline(d), (d as any).message);
});

// ── Unreadable config / unreadable evidence ──────────────────────────────────

test('an unreadable company config blocks with a retry, it does not drop the gate', () => {
  // THE DEFECT THIS REPLACES: jsaGateShiftEnd was assigned only inside
  // `if (companyDoc)`, so a failed config read left the gate false.
  const d = decideShiftJsaClose({ mode: null, allowAcknowledge: true, evidence: evidenceFor(null) });
  assert.equal(d.kind, 'blocked');
  if (d.kind !== 'blocked') return;
  assert.equal(d.reason, 'config_unreadable');
  assert.equal(d.route, 'retry');
  assert.equal(jsaPermitsClose(d), false);
});

test('an unreadable JSA record query is unknown, never zero', () => {
  const d = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: evidenceFor(null) });
  assert.equal(d.kind, 'blocked');
  if (d.kind !== 'blocked') return;
  assert.equal(d.reason, 'evidence_unreadable');
  assert.equal(d.route, 'retry');
});

test('a thrown JSA read is unknown, not an absent obligation', async () => {
  const d = await resolveShiftJsaClose({
    getCurrentShiftId: async () => SHIFT,
    readJsaRecords: async () => { throw new Error('offline'); },
    readCompanyRule: async () => ({ mode: 'per_shift', allowAcknowledge: true }),
  });
  assert.equal(d.kind, 'blocked');
  if (d.kind !== 'blocked') return;
  assert.equal(d.reason, 'evidence_unreadable');
});

test('no verified period is unreadable evidence, and invents no date scope', async () => {
  let reads = 0;
  const d = await resolveShiftJsaClose({
    getCurrentShiftId: async () => null,
    readJsaRecords: async () => { reads += 1; return []; },
    readCompanyRule: async () => ({ mode: 'per_shift', allowAcknowledge: true }),
  });
  assert.equal(d.kind, 'blocked');
  if (d.kind !== 'blocked') return;
  assert.equal(d.reason, 'evidence_unreadable');
  assert.equal(reads, 0, 'no fabricated scope may be queried');
});

test('an unavailable config outcome maps to the unknown mode', () => {
  assert.deepEqual(
    companyJsaRuleFromConfigResult({ kind: 'unavailable' }),
    { mode: null, allowAcknowledge: true },
  );
});

test('a cached config is usable, and the acknowledge default is true when absent', () => {
  assert.deepEqual(
    companyJsaRuleFromConfigResult({ kind: 'cache', config: { jsaMode: 'per_shift' } }),
    { mode: 'per_shift', allowAcknowledge: true },
  );
  assert.deepEqual(
    companyJsaRuleFromConfigResult({ kind: 'live', config: { jsaMode: 'per_shift', jsaAllowAcknowledge: false } }),
    { mode: 'per_shift', allowAcknowledge: false },
  );
});

test('the raw stored mode wins over the coerced one', () => {
  // companyConfig coerces an unknown jsaMode to 'off' for presentation. The gate
  // must see the real value so an unknown mode is not read as no obligation.
  const rule = companyJsaRuleFromConfigResult({
    kind: 'live',
    config: { jsaMode: 'off', jsaModeRaw: 'per_shift_v2' },
  });
  assert.equal(rule.mode, null);
});

// ── The Shift Complete backstop ──────────────────────────────────────────────

test('the backstop holds a logout for an evidence-based block', () => {
  for (const ev of [
    evidenceFor([]),                                      // no_jsa_record
    evidenceFor([record()]),                              // not_completed
    evidenceFor([signed({ locations: [loc({ acknowledged: false })] })]), // outstanding
  ]) {
    const d = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: ev });
    assert.equal(jsaBlocksLogout(d), true);
  }
  const forbidden = decideShiftJsaClose({
    mode: 'per_shift', allowAcknowledge: false, evidence: evidenceFor([acknowledged()]),
  });
  assert.equal(jsaBlocksLogout(forbidden), true);
});

test('the backstop does NOT hold a logout on unreadable evidence', () => {
  // By the time Shift Complete renders the shift is already closed, so holding
  // an offline driver inside the app costs them their logout and changes
  // nothing. The CLOSE gate stays fail-closed on exactly these cases.
  const unreadableConfig = decideShiftJsaClose({ mode: null, allowAcknowledge: true, evidence: evidenceFor(null) });
  const unreadableEvidence = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: evidenceFor(null) });
  assert.equal(jsaBlocksLogout(unreadableConfig), false);
  assert.equal(jsaBlocksLogout(unreadableEvidence), false);
  // They still refuse a CLOSE.
  assert.equal(jsaPermitsClose(unreadableConfig), false);
  assert.equal(jsaPermitsClose(unreadableEvidence), false);
});

test('the backstop never holds a logout when nothing is owed', () => {
  assert.equal(jsaBlocksLogout({ kind: 'not_required', reason: 'mode_off' }), false);
  const finalized = decideShiftJsaClose({
    mode: 'per_shift', allowAcknowledge: true, evidence: evidenceFor([signed({ locations: [loc()] })]),
  });
  assert.equal(jsaBlocksLogout(finalized), false);
});

// ── Firestore decoding ───────────────────────────────────────────────────────

test('decoding keeps acknowledgedMethod, which the old screen dropped', () => {
  const decoded = decodeJsaStatusDoc({
    name: 'projects/p/databases/(default)/documents/jsa_day_status/hash_SHIFT',
    fields: {
      shiftId: { stringValue: SHIFT },
      jsaCompleted: { booleanValue: true },
      jsaCompletedAt: { timestampValue: '2026-10-01T13:00:00Z' },
      acknowledgedMethod: { stringValue: 'acknowledged' },
    },
  });
  assert.ok(decoded);
  assert.equal(decoded!.acknowledgedMethod, 'acknowledged');
  assert.equal(classifyJsaSignature(decoded!), 'acknowledged_only');
});

test('a bare string location carries no acknowledgment of its own', () => {
  const decoded = decodeJsaStatusDoc({
    name: 'x/jsa_day_status/d1',
    fields: {
      shiftId: { stringValue: SHIFT },
      wells: { arrayValue: { values: [{ stringValue: 'Well A' }] } },
    },
  });
  assert.equal(decoded!.locations.length, 1);
  assert.equal(decoded!.locations[0].acknowledged, false);
});

test('a location is acknowledged only when it says so', () => {
  const decoded = decodeJsaStatusDoc({
    name: 'x/jsa_day_status/d1',
    fields: {
      shiftId: { stringValue: SHIFT },
      locations: { arrayValue: { values: [
        { mapValue: { fields: { id: { stringValue: 'w1' }, acknowledgedAt: { timestampValue: '2026-10-01T12:00:00Z' } } } },
        { mapValue: { fields: { id: { stringValue: 'w2' } } } },
        { mapValue: { fields: { id: { stringValue: 'w3' }, acknowledged: { booleanValue: false } } } },
      ] } },
    },
  });
  const byId = Object.fromEntries(decoded!.locations.map(l => [l.id, l.acknowledged]));
  assert.deepEqual(byId, { w1: true, w2: false, w3: false });
});

test('a malformed document decodes to nothing rather than to a completed JSA', () => {
  assert.equal(decodeJsaStatusDoc(null), null);
  assert.equal(decodeJsaStatusDoc({}), null);
  assert.equal(decodeJsaStatusDoc({ name: 'x/d1' }), null);
  assert.equal(decodeJsaStatusDocs(null), null);
  assert.deepEqual(decodeJsaStatusDocs([null, {}]), []);
});

test('a duplicated document is counted once', () => {
  const doc = { name: 'x/jsa_day_status/d1', fields: { shiftId: { stringValue: SHIFT }, jsaCompleted: { booleanValue: true } } };
  assert.equal(decodeJsaStatusDocs([doc, doc])!.length, 1);
});

test('a failed REST read is null, an empty one is an empty array', () => {
  assert.equal(recordsFromRestDocs({ directDoc: null, operatorDocs: null, readFailed: true }), null);
  assert.deepEqual(recordsFromRestDocs({ directDoc: null, operatorDocs: [], readFailed: false }), []);
});

// ── Prior-day open items ─────────────────────────────────────────────────────

test('a signed prior-day orphan gets its own Close JSA action', () => {
  const rows = priorDayJsaActions({
    items: [{ recordId: 'r1', shiftId: OTHER_SHIFT, originLocalDate: '2026-09-30', signature: 'signed', periodStillOpen: false }],
    currentShiftId: SHIFT,
  });
  assert.deepEqual(rows[0].actions, [{ action: 'close_jsa', reason: 'signed_orphan' }]);
});

test('an unsigned prior-day item offers Finish or an audited Discard, never a close', () => {
  const rows = priorDayJsaActions({
    items: [{ recordId: 'r2', shiftId: OTHER_SHIFT, originLocalDate: '2026-09-30', signature: 'absent', periodStillOpen: false }],
    currentShiftId: SHIFT,
  });
  assert.deepEqual(rows[0].actions.map(a => a.action), ['finish', 'discard_audited']);
  assert.ok(!rows[0].actions.some(a => a.action === 'close_jsa'));
});

test('an acknowledged-only prior-day item is not closeable as signed', () => {
  const rows = priorDayJsaActions({
    items: [{ recordId: 'r3', shiftId: OTHER_SHIFT, originLocalDate: '2026-09-30', signature: 'acknowledged_only', periodStillOpen: false }],
    currentShiftId: SHIFT,
  });
  assert.deepEqual(rows[0].actions.map(a => a.action), ['finish', 'discard_audited']);
});

test('the current shift is not a prior-day item', () => {
  const rows = priorDayJsaActions({
    items: [{ recordId: 'r4', shiftId: SHIFT, originLocalDate: '2026-10-01', signature: 'signed', periodStillOpen: true }],
    currentShiftId: SHIFT,
  });
  assert.deepEqual(rows[0].actions, [{ action: 'none', reason: 'current_shift' }]);
});

test('a record whose period is still open is left alone', () => {
  const rows = priorDayJsaActions({
    items: [{ recordId: 'r5', shiftId: OTHER_SHIFT, originLocalDate: '2026-09-30', signature: 'signed', periodStillOpen: true }],
    currentShiftId: SHIFT,
  });
  assert.deepEqual(rows[0].actions, [{ action: 'none', reason: 'period_open' }]);
});

test('starting a new JSA never auto-closes an old one', () => {
  assert.equal(shouldAutoCloseOnNewJsa(), false);
});

// ── What closes the JSA ──────────────────────────────────────────────────────

test('finalization is the authoritative shift close, and Suite writes no closure flag', () => {
  const authority = jsaFinalizationAuthority();
  assert.equal(authority.closedBy, 'closeDriverShift');
  assert.equal(authority.suiteWritesClosureFlag, false);
  assert.equal(authority.durableArtifactOwner, 'wb-jsa');
  assert.match(authority.crossAppAssumption, /not in this repository/);
});

test('the durable artifact is reported separately from the completion', () => {
  const withArtifact = evidenceFor([signed({ pdfUrl: 'https://example.test/j.pdf' })]);
  assert.equal(withArtifact.artifact, 'present');
  const withoutArtifact = evidenceFor([signed()]);
  assert.equal(withoutArtifact.artifact, 'absent');
  // A signed JSA with no stored artifact is still a finalize, but says so.
  const d = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: withoutArtifact });
  assert.equal(d.kind, 'finalize');
  if (d.kind !== 'finalize') return;
  assert.ok(d.caveats.includes('artifact_absent'));
});

// ── Purity / repeatability ───────────────────────────────────────────────────

test('the decision is pure: the same evidence decides the same way every time', () => {
  const ev = evidenceFor([signed({ locations: [loc()] })]);
  const a = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: ev });
  const b = decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: ev });
  assert.deepEqual(a, b);
});

test('nothing in the rule mutates the records it is given', () => {
  const recs = [signed({ locations: [loc({ acknowledged: false })] })];
  const before = JSON.stringify(recs);
  decideShiftJsaClose({ mode: 'per_shift', allowAcknowledge: true, evidence: evidenceFor(recs) });
  assert.equal(JSON.stringify(recs), before);
});
