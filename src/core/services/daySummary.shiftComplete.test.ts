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
  originDateFromPeriodId,
  resolveShiftBookends,
  jsaCardPresentation,
  jsaIsRequired,
  calculateDaySummary,
} from './daySummary';

/**
 * A real enforced shift's origin-day document, matching the 2026-10-01 field
 * receipt for period 2026-09-29_080914: the SERVER writes login at claim and
 * logout at close, with depart_return between them. The client only avoids
 * writing duplicates.
 */
const SERVER_AUTHORED_EVENTS = [
  { type: 'login', timestamp: '2026-09-29T13:09:14.000Z', lat: null, lng: null },
  { type: 'depart_return', timestamp: '2026-09-30T23:40:00.000Z', lat: null, lng: null },
  { type: 'logout', timestamp: '2026-10-01T01:05:00.000Z', lat: null, lng: null },
];
/** A document carrying no bookends at all — the honestly-absent case. */
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
// CORRECTION (2026-10-02): an earlier revision claimed enforced shifts have no
// login/logout at all and fell back to the period id. Both halves were wrong.
// The server writes login at claim and logout at close into the origin-day
// document — a field receipt read exactly those events for period
// 2026-09-29_080914 — and the period id is minted CLIENT-side before the claim,
// so its timestamp is a local clock reading, not an authoritative start.
// Events are the only bookends; anything else would render an invented time.

test('a server-authored login/logout pair renders BOTH times', () => {
  const b = resolveShiftBookends({ events: LEGACY_EVENTS });
  assert.equal(b.startIso, '2026-09-29T13:20:00.000Z');
  assert.equal(b.endIso, '2026-10-01T01:05:00.000Z');
  assert.equal(b.startSource, 'event');
  assert.equal(b.endSource, 'event');
});

test('cross-midnight: both bookends survive a shift spanning local days', () => {
  const b = resolveShiftBookends({ events: LEGACY_EVENTS });
  const startDay = new Date(b.startIso as string).toISOString().slice(0, 10);
  const endDay = new Date(b.endIso as string).toISOString().slice(0, 10);
  assert.notEqual(startDay, endDay, 'premise: the shift crosses a day boundary');
  assert.ok(new Date(b.endIso as string) > new Date(b.startIso as string));
});

test('close/reopen: the LAST login/logout pair of the day document is used', () => {
  const events = [
    { type: 'login', timestamp: '2026-09-29T06:00:00.000Z', lat: null, lng: null },
    { type: 'logout', timestamp: '2026-09-29T10:00:00.000Z', lat: null, lng: null },
    { type: 'login', timestamp: '2026-09-29T14:00:00.000Z', lat: null, lng: null },
    { type: 'depart_return', timestamp: '2026-09-29T19:30:00.000Z', lat: null, lng: null },
    { type: 'logout', timestamp: '2026-09-29T20:00:00.000Z', lat: null, lng: null },
  ];
  const b = resolveShiftBookends({ events });
  assert.equal(b.startIso, '2026-09-29T14:00:00.000Z', 'reopened shift, not the first');
  assert.equal(b.endIso, '2026-09-29T20:00:00.000Z');
});

test('a shift still open shows its start and an honestly absent end', () => {
  const events = [{ type: 'login', timestamp: '2026-09-29T13:20:00.000Z', lat: null, lng: null }];
  const b = resolveShiftBookends({ events });
  assert.equal(b.startIso, '2026-09-29T13:20:00.000Z');
  assert.equal(b.endIso, null);
  assert.equal(b.endSource, 'unavailable');
});

test('genuinely missing events stay missing — no substituted time', () => {
  const b = resolveShiftBookends({ events: [] });
  assert.deepEqual(b, { startIso: null, endIso: null, startSource: 'unavailable', endSource: 'unavailable' });
  // depart_return alone is not a bookend.
  const partial = resolveShiftBookends({ events: ENFORCED_EVENTS });
  assert.equal(partial.startIso, null);
  assert.equal(partial.endIso, null);
});

test('a client-minted period id can never become a displayed start time', () => {
  // mintShiftId() runs before the claim, so this timestamp is local clock.
  // Only its DATE part is used, and only to pick which day document to read.
  assert.equal(originDateFromPeriodId('2026-09-29_080914'), '2026-09-29');
  assert.equal(originDateFromPeriodId('2026-09-29'), null, 'not a period id');
  for (const bad of [null, undefined, '', 'wbs', 'not-a-period']) {
    assert.equal(originDateFromPeriodId(bad as string | null), null, String(bad));
  }
  const b = resolveShiftBookends({ events: ENFORCED_EVENTS });
  assert.equal(b.startIso, null, 'no period-id-derived start leaks into the bookends');
});

test('malformed event timestamps are ignored rather than becoming Invalid Date', () => {
  const b = resolveShiftBookends({
    events: [
      { type: 'login', timestamp: 'garbage', lat: null, lng: null },
      { type: 'login', timestamp: '2026-09-29T13:20:00.000Z', lat: null, lng: null },
    ],
  });
  assert.equal(b.startIso, '2026-09-29T13:20:00.000Z');
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

test('the origin day bounds the window, so a cross-midnight shift is covered', () => {
  const originDay = originDateFromPeriodId('2026-09-29_080914') as string;
  const now = new Date(2026, 9, 1, 20, 0, 0); // 2026-10-01 8pm local, ~2 days later
  const w = invoiceQueryWindow(originDay, now);
  const expected = new Date(2026, 8, 29, 0, 0, 0, 0).toISOString();
  assert.equal(w.startIso, expected, 'local midnight of the ORIGIN day, converted to UTC');
  assert.ok(Date.parse(w.endIso) >= now.getTime(), 'reaches now');
  // An invoice created the previous evening is inside the window.
  assert.ok(Date.parse('2026-09-30T01:02:00.000Z') > Date.parse(w.startIso));
  // The window is a FETCH bound only; the displayed times still come from events.
});

test('REGRESSION: loads created in the evening are counted, not zeroed', () => {
  // Phone 2: loads WERE done. The query field is invoice `createdAt`, so what
  // the old window excluded was invoices CREATED outside the stamped-Z day.
  const invoices = [
    invoice('a', '2026-09-30T01:02:00.000Z', 120),  // evening of the 29th local
    invoice('b', '2026-09-30T18:40:00.000Z', 95),
  ];
  const summary = calculateDaySummary(invoices, SERVER_AUTHORED_EVENTS, undefined);
  assert.equal(summary.totalLoads, 2, 'both loads attributed to the shift');
  assert.equal(summary.totalBBL, 215);
  assert.equal(summary.wellsVisited.length, 2);
  // Times come from the server-authored events, not from anything derived.
  assert.equal(summary.shiftStart, '2026-09-29T13:09:14.000Z');
  assert.equal(summary.shiftEnd, '2026-10-01T01:05:00.000Z');
});

test('loads outside the shift window are NOT counted', () => {
  const invoices = [
    invoice('before', '2026-09-28T12:00:00.000Z'),   // previous shift
    invoice('inside', '2026-09-30T01:02:00.000Z'),
  ];
  const summary = calculateDaySummary(invoices, LEGACY_EVENTS, undefined);
  assert.equal(summary.totalLoads, 1);
  assert.equal(summary.wellStats[0].name, 'Well inside');
});

test('PHOTO 1: a device with no jobs still reports none, and still shows its times', () => {
  const summary = calculateDaySummary([], SERVER_AUTHORED_EVENTS, undefined);
  assert.equal(summary.totalLoads, 0);
  assert.equal(summary.totalBBL, 0);
  assert.deepEqual(summary.wellsVisited, []);
  assert.equal(summary.shiftStart, '2026-09-29T13:09:14.000Z', 'times do not depend on loads');
  assert.equal(summary.shiftEnd, '2026-10-01T01:05:00.000Z');
});

test('a shift document that could not be read yields no times and no invented ones', () => {
  // fetchShiftDocForDate returns null on a failed read (it now logs the status),
  // so the screen receives an empty event list and must stay honest.
  const summary = calculateDaySummary([], [], undefined);
  assert.equal(summary.shiftStart, null);
  assert.equal(summary.shiftEnd, null);
  assert.equal(summary.shiftStartSource, 'unavailable');
  assert.equal(summary.shiftEndSource, 'unavailable');
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
