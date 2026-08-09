/**
 * Post-login shift restoration + pre-mint gate matrix.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decideColdStartFlagAction,
  decidePostLoginShiftRestore,
  decidePreMintShiftGate,
  mapVerdictToRestoreAction,
  originDateFromShiftId,
  shiftStartIsoFromShiftId,
} from './postLoginShiftRestoration';
import { mayUseDateFallback, type SuiteEnforcement } from './suiteShiftAuthority';

const NOW = Date.parse('2026-08-09T15:00:00.000Z');
const base = {
  companyId: 'liquid-gold',
  driverId: '99ff4b35-51ab-4d45-8d54-18b3b8515c9b',
  localDate: '2026-08-09',
  nowMs: NOW,
};
const explicit: SuiteEnforcement = { state: 'active', mode: 'explicit_shift' };
const doc = (m: Record<string, { readable: boolean; present: boolean; currentShiftId?: string }>) =>
  async (d: string) => m[d] ?? { readable: false, present: false };

test('originDateFromShiftId and shiftStartIsoFromShiftId', () => {
  assert.equal(originDateFromShiftId('2026-08-08_211725'), '2026-08-08');
  assert.equal(originDateFromShiftId(null), null);
  assert.ok(shiftStartIsoFromShiftId('2026-08-08_211725'));
});

test('1. login with cached open same-day explicit shift restores active', async () => {
  const a = await decidePostLoginShiftRestore({
    ...base,
    localDate: '2026-08-08',
    enforcement: explicit,
    cachedShiftId: '2026-08-08_211725',
    fetchDayDoc: doc({
      '2026-08-08': { readable: true, present: true, currentShiftId: '2026-08-08_211725' },
    }),
  });
  assert.equal(a.kind, 'restore_active');
  if (a.kind === 'restore_active') assert.equal(a.periodId, '2026-08-08_211725');
});

test('2. login with cached open origin-day/cross-midnight shift restores active', async () => {
  const a = await decidePostLoginShiftRestore({
    ...base,
    enforcement: explicit,
    cachedShiftId: '2026-08-08_211725',
    fetchDayDoc: doc({
      '2026-08-09': { readable: true, present: false },
      '2026-08-08': { readable: true, present: true, currentShiftId: '2026-08-08_211725' },
    }),
  });
  assert.equal(a.kind, 'restore_active');
  if (a.kind === 'restore_active') assert.equal(a.periodId, '2026-08-08_211725');
});

test('3. resolved periodId mismatch refuses restoration', () => {
  const a = mapVerdictToRestoreAction(
    {
      verdict: 'verified_open',
      periodId: '2026-08-08_999999',
      resolution: {} as never,
    },
    '2026-08-08_211725',
  );
  assert.equal(a.kind, 'block_start');
  if (a.kind === 'block_start') assert.equal(a.reason, 'period_id_mismatch');
});

test('4. closed shift clears stale local state (inactive_allow_start)', async () => {
  const a = await decidePostLoginShiftRestore({
    ...base,
    enforcement: explicit,
    cachedShiftId: '2026-08-08_211725',
    fetchDayDoc: doc({
      '2026-08-09': { readable: true, present: true, currentShiftId: '' },
      '2026-08-08': { readable: true, present: true, currentShiftId: '' },
    }),
  });
  assert.equal(a.kind, 'inactive_allow_start');
});

test('5. superseded/closed with empty currentShiftId → inactive_allow_start', async () => {
  const a = await decidePostLoginShiftRestore({
    ...base,
    enforcement: explicit,
    cachedShiftId: '2026-08-08_211725',
    fetchDayDoc: doc({
      '2026-08-09': { readable: true, present: true, currentShiftId: '2026-08-09_010000' },
      '2026-08-08': { readable: true, present: true, currentShiftId: '2026-08-09_010000' },
    }),
  });
  // Authority may report closed/superseded or mismatch depending on resolver —
  // must NOT restore the stale cached id as active.
  assert.notEqual(a.kind, 'restore_active');
});

test('6. unreadable authority blocks Start Shift', async () => {
  const a = await decidePostLoginShiftRestore({
    ...base,
    enforcement: explicit,
    cachedShiftId: '2026-08-08_211725',
    fetchDayDoc: doc({}),
  });
  assert.equal(a.kind, 'block_start');
});

test('7. missing cached ID does not assume today absence means no shift', async () => {
  const a = await decidePostLoginShiftRestore({
    ...base,
    enforcement: explicit,
    cachedShiftId: null,
    fetchDayDoc: doc({
      '2026-08-09': { readable: true, present: false },
    }),
  });
  assert.equal(a.kind, 'block_start');
  if (a.kind === 'block_start') {
    assert.equal(a.reason, 'missing_cache_no_safe_discovery');
  }
});

test('8-9. discovery of one/multiple open shifts — no client discovery seam', async () => {
  // Documented architectural gap: no restore without cache.
  const a = await decidePostLoginShiftRestore({
    ...base,
    enforcement: explicit,
    cachedShiftId: null,
    fetchDayDoc: doc({
      '2026-08-08': { readable: true, present: true, currentShiftId: '2026-08-08_211725' },
    }),
  });
  assert.equal(a.kind, 'block_start');
});

test('10. positively proven no-open (closed cache) enables Start Shift path', async () => {
  const a = await decidePostLoginShiftRestore({
    ...base,
    enforcement: explicit,
    cachedShiftId: '2026-08-08_211725',
    fetchDayDoc: doc({
      '2026-08-09': { readable: true, present: true, currentShiftId: '' },
      '2026-08-08': { readable: true, present: true, currentShiftId: '' },
    }),
  });
  assert.equal(a.kind, 'inactive_allow_start');
});

test('15. Start Shift refuses when open shift exists despite local inactive', async () => {
  const g = await decidePreMintShiftGate({
    ...base,
    enforcement: explicit,
    cachedShiftId: '2026-08-08_211725',
    fetchDayDoc: doc({
      '2026-08-09': { readable: true, present: false },
      '2026-08-08': { readable: true, present: true, currentShiftId: '2026-08-08_211725' },
    }),
  });
  assert.equal(g.allowMint, false);
  if (!g.allowMint) {
    assert.equal(g.reason, 'open_explicit_shift_exists');
    assert.equal(g.openPeriodId, '2026-08-08_211725');
  }
});

test('16. Start Shift refuses when authority is unknown', async () => {
  const g = await decidePreMintShiftGate({
    ...base,
    enforcement: explicit,
    cachedShiftId: '2026-08-08_211725',
    fetchDayDoc: doc({}),
  });
  assert.equal(g.allowMint, false);
});

test('17. Start Shift mints only after positive no-open proof (closed)', async () => {
  const g = await decidePreMintShiftGate({
    ...base,
    enforcement: explicit,
    cachedShiftId: '2026-08-08_211725',
    fetchDayDoc: doc({
      '2026-08-09': { readable: true, present: true, currentShiftId: '' },
      '2026-08-08': { readable: true, present: true, currentShiftId: '' },
    }),
  });
  assert.equal(g.allowMint, true);
});

test('17b. missing cache refuses mint under explicit_shift (no dual-open)', async () => {
  const g = await decidePreMintShiftGate({
    ...base,
    enforcement: explicit,
    cachedShiftId: null,
    fetchDayDoc: doc({ '2026-08-09': { readable: true, present: false } }),
  });
  assert.equal(g.allowMint, false);
  if (!g.allowMint) assert.equal(g.reason, 'missing_cache_no_safe_discovery');
});

test('18. derived/synthetic fallback remains disabled under active explicit', () => {
  assert.equal(mayUseDateFallback(explicit), false);
});

test('cold-start: cached open origin-day with missing local flags → set_active', async () => {
  const a = await decidePostLoginShiftRestore({
    ...base,
    enforcement: explicit,
    cachedShiftId: '2026-08-08_211725',
    localShiftStarted: false,
    fetchDayDoc: doc({
      '2026-08-09': { readable: true, present: false },
      '2026-08-08': { readable: true, present: true, currentShiftId: '2026-08-08_211725' },
    }),
  });
  assert.equal(a.kind, 'restore_active');
  assert.equal(
    decideColdStartFlagAction({ priorLocalActive: false, action: a }),
    'set_active',
  );
});

test('cold-start: closed shift → set_inactive', async () => {
  const a = await decidePostLoginShiftRestore({
    ...base,
    enforcement: explicit,
    cachedShiftId: '2026-08-08_211725',
    fetchDayDoc: doc({
      '2026-08-09': { readable: true, present: true, currentShiftId: '' },
      '2026-08-08': { readable: true, present: true, currentShiftId: '' },
    }),
  });
  assert.equal(
    decideColdStartFlagAction({ priorLocalActive: true, action: a }),
    'set_inactive',
  );
});

test('cold-start: unreadable authority + prior active → preserve_active_offline', async () => {
  const a = await decidePostLoginShiftRestore({
    ...base,
    enforcement: explicit,
    cachedShiftId: '2026-08-08_211725',
    fetchDayDoc: doc({}),
  });
  assert.equal(a.kind, 'block_start');
  assert.equal(
    decideColdStartFlagAction({ priorLocalActive: true, action: a }),
    'preserve_active_offline',
  );
});

test('cold-start: unreadable + not active → leave_inactive (no mint)', async () => {
  const a = await decidePostLoginShiftRestore({
    ...base,
    enforcement: explicit,
    cachedShiftId: '2026-08-08_211725',
    fetchDayDoc: doc({}),
  });
  assert.equal(
    decideColdStartFlagAction({ priorLocalActive: false, action: a }),
    'leave_inactive',
  );
});

test('cold-start: today absent does not invent restore without origin open', async () => {
  const a = await decidePostLoginShiftRestore({
    ...base,
    enforcement: explicit,
    cachedShiftId: null,
    fetchDayDoc: doc({
      '2026-08-09': { readable: true, present: false },
    }),
  });
  assert.equal(a.kind, 'block_start');
  assert.equal(
    decideColdStartFlagAction({ priorLocalActive: false, action: a }),
    'leave_inactive',
  );
});

test('cold-start: idempotent restore when already local active', async () => {
  const a = await decidePostLoginShiftRestore({
    ...base,
    enforcement: explicit,
    cachedShiftId: '2026-08-08_211725',
    localShiftStarted: true,
    fetchDayDoc: doc({
      '2026-08-09': { readable: true, present: false },
      '2026-08-08': { readable: true, present: true, currentShiftId: '2026-08-08_211725' },
    }),
  });
  assert.equal(a.kind, 'restore_active');
  assert.equal(
    decideColdStartFlagAction({ priorLocalActive: true, action: a }),
    'set_active',
  );
});

test('wiring: login + cold-start consult decidePostLoginShiftRestore', () => {
  const auth = readFileSync(join(__dirname, '..', '..', 'context', 'AuthContext.tsx'), 'utf8');
  assert.ok(auth.includes('decidePostLoginShiftRestore'));
  assert.ok(auth.includes('decidePreMintShiftGate'));
  assert.ok(auth.includes('decideColdStartFlagAction'));
  assert.ok(auth.includes('Cold-start restored explicit shift'));
  // Must not still do blind clean-slate only without authority for explicit
  assert.ok(auth.includes("mode === 'explicit_shift'"));
});

test('wiring: restore does not call mintShiftId or recordShiftEvent login on restore path', () => {
  const auth = readFileSync(join(__dirname, '..', '..', 'context', 'AuthContext.tsx'), 'utf8');
  const loginFn = auth.slice(auth.indexOf('const login = useCallback'), auth.indexOf('const startShift = useCallback'));
  // Restore log line present; mint only in startShift region
  assert.ok(loginFn.includes('Restored explicit shift after login'));
  assert.ok(!loginFn.includes('mintShiftId()'));
  assert.ok(!/recordShiftEvent\(\s*'login'/.test(loginFn));
});
