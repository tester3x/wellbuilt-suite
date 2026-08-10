import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  createShiftAuthorityClient,
  validateResolveResponse,
  validateClaimResponse,
  validateDepartReturnResponse,
  validateCloseResponse,
  normalizeOdometerMiles,
  mapHttpsError,
  ShiftAuthorityError,
  CLAIM_DRIVER_SHIFT,
  CLOSE_DRIVER_SHIFT,
  RECORD_DEPART_RETURN,
  RESOLVE_ACTIVE_DRIVER_SHIFT,
} from './shiftAuthorityClient';

test('validate resolve none/open/unverifiable', () => {
  assert.equal(validateResolveResponse({ protocolVersion: 1, state: 'none' }).state, 'none');
  const open = validateResolveResponse({
    protocolVersion: 1,
    state: 'open',
    periodId: '2026-08-10_080000',
    originLocalDate: '2026-08-10',
  });
  assert.equal(open.state, 'open');
  if (open.state === 'open') assert.equal(open.periodId, '2026-08-10_080000');
  const u = validateResolveResponse({
    protocolVersion: 1,
    state: 'unverifiable',
    reason: 'authority_absent',
  });
  assert.equal(u.state, 'unverifiable');
});

test('reject malformed resolve / claim / close', () => {
  assert.throws(() => validateResolveResponse({ protocolVersion: 2, state: 'none' }));
  assert.throws(() => validateClaimResponse({ protocolVersion: 1, state: 'open', periodId: 'bad', originLocalDate: '2026-08-10', claimed: true }));
  assert.throws(() => validateCloseResponse({ protocolVersion: 1, state: 'open', closedPeriodId: '2026-08-10_080000', alreadyClosed: false }));
});

test('claim response claimed false is success shape', () => {
  const r = validateClaimResponse({
    protocolVersion: 1,
    state: 'open',
    periodId: '2026-08-10_080000',
    originLocalDate: '2026-08-10',
    claimed: false,
  });
  assert.equal(r.claimed, false);
});

test('departReturn recorded false is success shape', () => {
  const r = validateDepartReturnResponse({
    protocolVersion: 1,
    periodId: '2026-08-10_080000',
    recorded: false,
  });
  assert.equal(r.recorded, false);
});

test('close alreadyClosed true is success shape', () => {
  const r = validateCloseResponse({
    protocolVersion: 1,
    state: 'none',
    closedPeriodId: '2026-08-10_080000',
    alreadyClosed: true,
  });
  assert.equal(r.alreadyClosed, true);
});

test('odometer bounds 0..5000 integer', () => {
  assert.equal(normalizeOdometerMiles(12.4), 12);
  assert.equal(normalizeOdometerMiles(0), 0);
  assert.equal(normalizeOdometerMiles(5000), 5000);
  assert.throws(() => normalizeOdometerMiles(-1));
  assert.throws(() => normalizeOdometerMiles(5001));
  assert.equal(normalizeOdometerMiles(undefined), undefined);
});

test('mapHttpsError known reasons', () => {
  const e = mapHttpsError({ code: 'functions/failed-precondition', message: 'period_mismatch' });
  assert.equal(e.failure, 'period_mismatch');
  const s = mapHttpsError({ code: 'functions/unauthenticated', message: 'driver_session_required' });
  assert.equal(s.failure, 'driver_session_required');
});

test('client requires session and exact payload keys; no identity fields', async () => {
  const calls: { name: string; payload: Record<string, unknown> }[] = [];
  const client = createShiftAuthorityClient(
    async (name, payload) => {
      calls.push({ name, payload });
      if (name === RESOLVE_ACTIVE_DRIVER_SHIFT) {
        return { protocolVersion: 1, state: 'none' };
      }
      if (name === CLAIM_DRIVER_SHIFT) {
        return {
          protocolVersion: 1,
          state: 'open',
          periodId: payload.periodId,
          originLocalDate: payload.originLocalDate,
          claimed: true,
        };
      }
      if (name === RECORD_DEPART_RETURN) {
        return { protocolVersion: 1, periodId: payload.periodId, recorded: true };
      }
      if (name === CLOSE_DRIVER_SHIFT) {
        return {
          protocolVersion: 1,
          state: 'none',
          closedPeriodId: payload.periodId,
          alreadyClosed: false,
        };
      }
      throw new Error('unexpected');
    },
    { requireSession: async () => true },
  );

  await client.resolve();
  await client.claim('2026-08-10_090000', '2026-08-10');
  await client.recordDepartReturn('2026-08-10_090000');
  await client.close('2026-08-10_090000', 42);

  assert.equal(calls[0].name, RESOLVE_ACTIVE_DRIVER_SHIFT);
  assert.deepEqual(Object.keys(calls[0].payload), []);
  assert.deepEqual(Object.keys(calls[1].payload).sort(), ['originLocalDate', 'periodId']);
  assert.ok(!('driverId' in calls[1].payload));
  assert.ok(!('companyId' in calls[1].payload));
  assert.ok(!('date' in calls[1].payload));
  assert.ok(!('type' in calls[1].payload));
  assert.deepEqual(Object.keys(calls[2].payload), ['periodId']);
  assert.deepEqual(Object.keys(calls[3].payload).sort(), ['odometerMiles', 'periodId']);
});

test('client fails closed without SDK session', async () => {
  const client = createShiftAuthorityClient(
    async () => ({ protocolVersion: 1, state: 'none' }),
    { requireSession: async () => false },
  );
  await assert.rejects(() => client.resolve(), (e: unknown) => {
    assert.ok(e instanceof ShiftAuthorityError);
    assert.equal((e as ShiftAuthorityError).failure, 'driver_session_required');
    return true;
  });
});
