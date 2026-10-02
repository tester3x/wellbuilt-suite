// Run: npx tsx --test src/core/services/daySummary.shiftComplete.test.ts
//
// Shift Complete screen, three field defects (2026-10-01, two phones):
//   1. shift start/stop rendered "--:-- – --:--" on BOTH phones
//   2. JSA shown as amber Pending when the company requires no JSA
//   3. a phone that DID run loads showed "No completed loads today"
//
// Photo 1 (no jobs on that device) correctly shows no loads; that case is
// covered too, so the loads repair cannot start inventing counts.
//
// The loads defect is TIMEZONE-DEPENDENT: it only appears on a device west of
// UTC. This file must therefore run under a fixed negative-offset zone, which
// `npm run test:day-summary` sets (TZ=America/Chicago). The precondition is
// asserted below so a run without it fails loudly instead of passing for the
// wrong reason — the container itself is UTC, where the bug is invisible.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  invoiceQueryWindow,
  periodIdToStartIso,
  resolveShiftBookends,
  jsaCardPresentation,
  jsaIsRequired,
  calculateDaySummary,
} from './daySummary';

/** An enforced shift's day doc: the client writes NO login/logout. */
const ENFORCED_EVENTS = [
  { type: 'depart_return', timestamp: '2026-09-30T23:40:00.000Z', lat: null, lng: null },
];
const LEGACY_EVENTS = [
  { type: 'login', timestamp: '2026-09-29T13:20:00.000Z', lat: null, lng: null },
  { type: 'logout', timestamp: '2026-10-01T01:05:00.000Z', lat: null, lng: null },
];

function invoice(id: string, createdAt: string, bbl = 100) {
  return {
    id, wellName: `Well ${id}`, hauledTo: 'SWD', operator: 'Op',
    totalBBL: bbl, totalHours: 1, status: 'closed',
    timeline: [], createdAt,
  };
}

// ── 1. shift start / stop ─────────────────────────────────────────────────
test('REGRESSION: an enforced shift has bookends even though no login event exists', () => {
  // Under enforced explicit_shift the claim "never appends client login" and
  // recordShiftEvent refuses direct writes, so login/logout are absent and the
  // old code produced null/null -> "--:-- – --:--" on every enforced shift.
  const before = ENFORCED_EVENTS.filter(e => e.type === 'login' || e.type === 'logout');
  assert.equal(before.length, 0, 'premise: the day doc carries no login/logout');

  const b = resolveShiftBookends({ events: ENFORCED_EVENTS, periodId: '2026-09-29_082000' });
  assert.equal(b.startSource, 'period_id');
  assert.ok(b.startIso, 'start is recovered from the server-assigned period id');
  assert.equal(new Date(b.startIso as string).getFullYear(), 2026);
  // No authoritative end exists client-side: report it as unavailable rather
  // than substituting the phone clock.
  assert.equal(b.endIso, null);
  assert.equal(b.endSource, 'unavailable');
});

test('a login/logout pair still wins over the period id, and survives cross-midnight', () => {
  const b = resolveShiftBookends({ events: LEGACY_EVENTS, periodId: '2026-09-29_082000' });
  assert.equal(b.startIso, '2026-09-29T13:20:00.000Z');
  assert.equal(b.endIso, '2026-10-01T01:05:00.000Z');
  assert.equal(b.startSource, 'event');
  assert.equal(b.endSource, 'event');
});

test('the LAST login/logout pair is used when a day holds several shifts', () => {
  const events = [
    { type: 'login', timestamp: '2026-09-29T06:00:00.000Z', lat: null, lng: null },
    { type: 'logout', timestamp: '2026-09-29T10:00:00.000Z', lat: null, lng: null },
    { type: 'login', timestamp: '2026-09-29T14:00:00.000Z', lat: null, lng: null },
    { type: 'logout', timestamp: '2026-09-29T20:00:00.000Z', lat: null, lng: null },
  ];
  const b = resolveShiftBookends({ events, periodId: null });
  assert.equal(b.startIso, '2026-09-29T14:00:00.000Z');
  assert.equal(b.endIso, '2026-09-29T20:00:00.000Z');
});

test('close/reopen: a second period id resolves to its own start, not the first', () => {
  const first = periodIdToStartIso('2026-09-29_082000');
  const second = periodIdToStartIso('2026-09-29_173000');
  assert.ok(first && second);
  assert.notEqual(first, second);
  assert.ok(new Date(second as string).getTime() > new Date(first as string).getTime());
});

test('genuinely absent data stays absent — no fabricated times', () => {
  const b = resolveShiftBookends({ events: [], periodId: null });
  assert.deepEqual(b, { startIso: null, endIso: null, startSource: 'unavailable', endSource: 'unavailable' });
  for (const bad of [null, undefined, '', 'wbs', 'not-a-period', '2026-09-29']) {
    assert.equal(periodIdToStartIso(bad as string | null), null, String(bad));
  }
});

test('malformed event timestamps are ignored rather than becoming Invalid Date', () => {
  const b = resolveShiftBookends({
    events: [{ type: 'login', timestamp: 'garbage', lat: null, lng: null }],
    periodId: '2026-09-29_082000',
  });
  assert.equal(b.startSource, 'period_id', 'falls through to the authoritative source');
});

// ── 2. loads / invoice window ─────────────────────────────────────────────
test('precondition: this file runs under a negative UTC offset', () => {
  assert.ok(
    new Date(2026, 8, 30).getTimezoneOffset() > 0,
    'run via `npm run test:day-summary` (TZ=America/Chicago); under UTC the loads defect cannot reproduce',
  );
});

test('REGRESSION: an evening load is no longer outside the query window', () => {
  // The old window was `${localY}-${localM}-${localD}T00:00:00Z`..T23:59:59.999Z.
  // At UTC-5 a load closed 20:02 local is 01:02Z the NEXT day — outside it.
  const localY = 2026, localM = 9, localD = 30;              // 2026-09-30 local
  const oldStart = Date.parse(`2026-09-30T00:00:00Z`);
  const oldEnd = Date.parse(`2026-09-30T23:59:59.999Z`);
  const eveningLoadUtc = Date.parse('2026-10-01T01:02:00.000Z');
  assert.ok(eveningLoadUtc > oldEnd, 'premise: the old window excluded it');

  const now = new Date(localY, localM - 1, localD, 20, 30, 0);  // 8:30pm local
  const w = invoiceQueryWindow(null, now);
  assert.ok(Date.parse(w.endIso) > eveningLoadUtc, 'new window reaches past the evening load');
  // Local midnight is converted correctly, not stamped with a literal Z.
  const expectedLocalMidnight = new Date(localY, localM - 1, localD, 0, 0, 0, 0).toISOString();
  assert.equal(w.startIso, expectedLocalMidnight);
  assert.notEqual(w.startIso, '2026-09-30T00:00:00Z');
  void oldStart;
});

test('with a shift start the window covers the whole shift, across midnight', () => {
  const shiftStart = periodIdToStartIso('2026-09-29_082000') as string;
  const now = new Date(2026, 9, 1, 20, 0, 0); // 2026-10-01 8pm local, ~36h later
  const w = invoiceQueryWindow(shiftStart, now);
  assert.ok(Date.parse(w.startIso) <= Date.parse(shiftStart), 'starts at or before the shift');
  assert.ok(Date.parse(w.endIso) >= now.getTime(), 'reaches now');
  // A load closed the previous evening is inside the window.
  assert.ok(Date.parse('2026-09-30T01:02:00.000Z') > Date.parse(w.startIso));
});

test('REGRESSION: loads on an enforced shift are counted, not zeroed', () => {
  // Phone 2: loads WERE done. Without bookends the invoice filter had no
  // window; with the period id it has one and the loads land inside it.
  const invoices = [
    invoice('a', '2026-09-30T01:02:00.000Z', 120),  // evening of the 29th local
    invoice('b', '2026-09-30T18:40:00.000Z', 95),
  ];
  const summary = calculateDaySummary(invoices, ENFORCED_EVENTS, undefined, {
    periodId: '2026-09-29_082000',
  });
  assert.equal(summary.totalLoads, 2, 'both loads attributed to the shift');
  assert.equal(summary.totalBBL, 215);
  assert.equal(summary.wellsVisited.length, 2);
  assert.ok(summary.shiftStart, 'and the times are populated');
});

test('loads outside the shift window are NOT counted', () => {
  const invoices = [
    invoice('before', '2026-09-28T12:00:00.000Z'),   // previous shift
    invoice('inside', '2026-09-30T01:02:00.000Z'),
  ];
  const summary = calculateDaySummary(invoices, LEGACY_EVENTS, undefined, { periodId: null });
  assert.equal(summary.totalLoads, 1);
  assert.equal(summary.wellStats[0].name, 'Well inside');
});

test('PHOTO 1: a device with no jobs still reports none', () => {
  const summary = calculateDaySummary([], ENFORCED_EVENTS, undefined, { periodId: '2026-09-29_082000' });
  assert.equal(summary.totalLoads, 0);
  assert.equal(summary.totalBBL, 0);
  assert.deepEqual(summary.wellsVisited, []);
  assert.ok(summary.shiftStart, 'times are shown even with no loads');
});

// ── 3. JSA requirement vs status ──────────────────────────────────────────
test('REGRESSION: JSA off never presents an unmet obligation', () => {
  const v = jsaCardPresentation({ mode: 'off', completed: false, hasRecord: true });
  assert.equal(v.show, false, 'nothing is owed, so nothing is shown');
  assert.equal(v.required, false);
});

test('JSA off but completed anyway reads as information, not as pending', () => {
  const v = jsaCardPresentation({ mode: 'off', completed: true, hasRecord: true });
  assert.equal(v.show, true);
  assert.ok(v.show && v.tone === 'informational');
  assert.ok(v.show && !v.showCompleteAction, 'no Complete JSA Now command');
  assert.ok(v.show && /not required/i.test(v.headline));
});

test('REGRESSION PRESERVED: required JSA still gates and still prompts', () => {
  for (const mode of ['per_shift', 'per_job', 'per_location', 'per_load']) {
    assert.equal(jsaIsRequired(mode), true, mode);
    const pending = jsaCardPresentation({ mode, completed: false, hasRecord: true });
    assert.ok(pending.show && pending.tone === 'pending', `${mode} pending`);
    assert.ok(pending.show && pending.showCompleteAction, `${mode} offers completion`);
    const done = jsaCardPresentation({ mode, completed: true, hasRecord: true });
    assert.ok(done.show && done.tone === 'complete', `${mode} complete`);
    assert.ok(done.show && !done.showCompleteAction);
  }
});

test('an unknown or missing mode is treated as not required, never as pending', () => {
  for (const mode of [undefined, null, '', 'something_new']) {
    assert.equal(jsaIsRequired(mode as string | null | undefined), false, String(mode));
    const v = jsaCardPresentation({ mode: mode as string | null, completed: false, hasRecord: false });
    assert.equal(v.show, false, `${mode} must not invent an obligation`);
  }
  assert.equal(jsaIsRequired('PER_SHIFT'), true, 'case-insensitive');
});
