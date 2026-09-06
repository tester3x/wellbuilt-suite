// vc51.9C clarification 1 — shift DURATION semantics.
//
// Product policy: a protected explicit work period is owned by the
// genuine sign-in/Start Shift → logout lifecycle. Elapsed hours,
// midnight, and calendar-day boundaries MUST NOT close it, and crossing
// midnight must never silently create a replacement shift.
//
// RED-FIRST: the source pins fail until autoCloseStaleShift — which
// appends a synthetic logout at `{date}T23:59:59.000Z` purely because a
// calendar day elapsed (shiftTracking.ts:170-240, fired from
// recordShiftEvent('login'):287 and checkShiftOnResume:582) — is
// enforcement-gated.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { verifyCachedShiftAgainstAuthority } from './suiteShiftAuthority';

const base = { companyId: 'liquid-gold', driverId: 'hash-1' };
const doc = (m: Record<string, { readable: boolean; present: boolean; currentShiftId?: string }>) =>
  async (d: string) => m[d] ?? { readable: false, present: false };

test('midnight crossing: a legitimate overnight shift stays OPEN', async () => {
  // Started 2026-08-05 18:00, still open at 02:00 on 2026-08-06.
  const v = await verifyCachedShiftAgainstAuthority({
    ...base,
    cachedShiftId: '2026-08-05_180000',
    localDate: '2026-08-06',
    nowMs: Date.parse('2026-08-06T08:00:00.000Z'),
    fetchDayDoc: doc({
      '2026-08-06': { readable: true, present: false },
      '2026-08-05': { readable: true, present: true, currentShiftId: '2026-08-05_180000' },
    }),
  });
  assert.equal(v.verdict, 'verified_open');
  assert.equal((v as { periodId: string }).periodId, '2026-08-05_180000');
});

test('long-running legitimate shift: 20 elapsed hours does not close it', async () => {
  const v = await verifyCachedShiftAgainstAuthority({
    ...base,
    cachedShiftId: '2026-08-05_060000',
    localDate: '2026-08-06',
    nowMs: Date.parse('2026-08-06T20:00:00.000Z'), // ~38h after start
    fetchDayDoc: doc({
      '2026-08-06': { readable: true, present: false },
      '2026-08-05': { readable: true, present: true, currentShiftId: '2026-08-05_060000' },
    }),
  });
  assert.equal(v.verdict, 'verified_open', 'elapsed time must never end an enforced period');
});

test('closed previous-day shift is verified_closed (never resurrected)', async () => {
  const v = await verifyCachedShiftAgainstAuthority({
    ...base,
    cachedShiftId: '2026-08-05_180000',
    localDate: '2026-08-06',
    nowMs: Date.parse('2026-08-06T08:00:00.000Z'),
    fetchDayDoc: doc({
      '2026-08-06': { readable: true, present: false },
      '2026-08-05': { readable: true, present: true, currentShiftId: '' },
    }),
  });
  assert.equal(v.verdict, 'verified_closed');
});

test('missing cache + authoritative OPEN origin-day shift: today governs, nothing invented', async () => {
  // No local hint at all. Today's doc names the open shift → restored
  // from AUTHORITY, not from the calendar.
  const v = await verifyCachedShiftAgainstAuthority({
    ...base,
    cachedShiftId: null,
    localDate: '2026-08-06',
    nowMs: Date.parse('2026-08-06T15:00:00.000Z'),
    fetchDayDoc: doc({ '2026-08-06': { readable: true, present: true, currentShiftId: '2026-08-06_060000' } }),
  });
  assert.equal(v.verdict, 'verified_open');
  assert.equal((v as { periodId: string }).periodId, '2026-08-06_060000');
});

test('missing cache + no authoritative open shift → no_shift (no synthesized period)', async () => {
  const v = await verifyCachedShiftAgainstAuthority({
    ...base,
    cachedShiftId: null,
    localDate: '2026-08-06',
    nowMs: Date.parse('2026-08-06T15:00:00.000Z'),
    fetchDayDoc: doc({ '2026-08-06': { readable: true, present: false } }),
  });
  assert.equal(v.verdict, 'no_shift');
});

test('unreadable/network-unverified authority stays unverified (never open, never closed)', async () => {
  const v = await verifyCachedShiftAgainstAuthority({
    ...base,
    cachedShiftId: '2026-08-05_180000',
    localDate: '2026-08-06',
    nowMs: Date.parse('2026-08-06T08:00:00.000Z'),
    fetchDayDoc: doc({}), // every read fails
  });
  assert.equal(v.verdict, 'unverified');
});

test('resume after a genuine logout: authority says closed → closed', async () => {
  const v = await verifyCachedShiftAgainstAuthority({
    ...base,
    cachedShiftId: '2026-08-06_060000',
    localDate: '2026-08-06',
    nowMs: Date.parse('2026-08-06T20:00:00.000Z'),
    fetchDayDoc: doc({ '2026-08-06': { readable: true, present: true, currentShiftId: '' } }),
  });
  assert.equal(v.verdict, 'verified_closed');
});

test('a prior closed period never satisfies a new period', async () => {
  // Cache still holds yesterday's CLOSED id while today has a NEW open
  // shift: the verdict must be today's shift, not the stale one.
  const v = await verifyCachedShiftAgainstAuthority({
    ...base,
    cachedShiftId: '2026-08-05_180000',
    localDate: '2026-08-06',
    nowMs: Date.parse('2026-08-06T15:00:00.000Z'),
    fetchDayDoc: doc({
      '2026-08-06': { readable: true, present: true, currentShiftId: '2026-08-06_060000' },
      '2026-08-05': { readable: true, present: true, currentShiftId: '' },
    }),
  });
  assert.equal(v.verdict, 'verified_open');
  assert.equal((v as { periodId: string }).periodId, '2026-08-06_060000');
});

// ── source pins: the synthetic calendar closer is enforcement-gated ───────
const root = join(__dirname, '..', '..', '..', '..');
const tracking = () => readFileSync(join(root, 'src/core/services/shiftTracking.ts'), 'utf8');

test('autoCloseStaleShift is detection-only — never synthesizes a calendar-boundary logout', () => {
  const src = tracking();
  const fn = src.slice(src.indexOf('async function autoCloseStaleShift'), src.indexOf('async function autoCloseStaleShift') + 3000);
  // Still observes enforcement (refreshes live LKG), but issues NO write.
  assert.ok(fn.includes('observeEnforcementSafety'),
    'autoCloseStaleShift must use force-refresh observe path (cutover-safe LKG)');
  // P0 safety: the fabricated 23:59:59 logout and its commit are removed.
  assert.ok(!fn.includes('23:59:59'), 'synthetic 23:59:59 logout must be removed');
  assert.ok(!/appendMissingElements/.test(fn), 'no event append write may remain');
  assert.ok(!/fetchSafe\(commitUrl/.test(fn), 'no commit write may remain in the sweep');
  assert.ok(fn.includes('stale-shift.detected'), 'stale open shift must be surfaced for reconciliation');
});

test('legacy/unenforced stale shift is detected and presented, never auto-closed', () => {
  const src = tracking();
  const region = src.slice(src.indexOf('async function autoCloseStaleShift'), src.indexOf('async function autoCloseStaleShift') + 3000);
  assert.ok(/no write issued|authoritative reconciliation/.test(region),
    'stale shift must be presented for authoritative reconciliation, not mutated');
});

test('no time-threshold constant governs enforced shift closure', () => {
  const src = tracking();
  assert.ok(!/MAX_SHIFT_HOURS|12 \* 60 \* 60|14 \* 60 \* 60|hoursSince/.test(src),
    'a duration threshold must never end an enforced explicit shift');
});
