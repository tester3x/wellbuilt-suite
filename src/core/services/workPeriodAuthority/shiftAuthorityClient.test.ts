import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  createShiftAuthorityClient,
  validateResolveResponse,
  validateClaimResponse,
  validateDepartReturnResponse,
  validateReturnAbandonedResponse,
  validateCloseResponse,
  normalizeOdometerMiles,
  mapHttpsError,
  sanitizeShiftAuthorityDetails,
  extractReasonToken,
  reasonTokenHead,
  SHIFT_AUTHORITY_REASON_TOKENS,
  ShiftAuthorityError,
  CLAIM_DRIVER_SHIFT,
  CLOSE_DRIVER_SHIFT,
  RECORD_DEPART_RETURN,
  RECORD_RETURN_ABANDONED,
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

test('returnAbandoned recorded flag is success shape; malformed rejected', () => {
  const r = validateReturnAbandonedResponse({
    protocolVersion: 1,
    periodId: '2026-09-24_143000',
    recorded: true,
  });
  assert.equal(r.recorded, true);
  assert.throws(() => validateReturnAbandonedResponse({ protocolVersion: 1, periodId: 'bad', recorded: true }));
  assert.throws(() => validateReturnAbandonedResponse({ protocolVersion: 2, periodId: '2026-09-24_143000', recorded: true }));
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
      if (name === RECORD_RETURN_ABANDONED) {
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

  const ATTEMPT = 'ret-2026-08-10_090000-abc123';
  await client.resolve();
  await client.claim('2026-08-10_090000', '2026-08-10');
  await client.recordDepartReturn('2026-08-10_090000', ATTEMPT);
  await client.recordReturnAbandoned('2026-08-10_090000', ATTEMPT);
  await client.close('2026-08-10_090000', 42);

  assert.equal(calls[0].name, RESOLVE_ACTIVE_DRIVER_SHIFT);
  assert.deepEqual(Object.keys(calls[0].payload), []);
  assert.deepEqual(Object.keys(calls[1].payload).sort(), ['originLocalDate', 'periodId']);
  assert.ok(!('driverId' in calls[1].payload));
  assert.ok(!('companyId' in calls[1].payload));
  assert.ok(!('date' in calls[1].payload));
  assert.ok(!('type' in calls[1].payload));
  // depart_return / return_abandoned carry ONLY periodId + attemptId — still no
  // driver/company selector, just the per-attempt idempotency scope.
  assert.deepEqual(Object.keys(calls[2].payload).sort(), ['attemptId', 'periodId']);
  assert.equal(calls[2].payload.attemptId, ATTEMPT);
  assert.equal(calls[3].name, RECORD_RETURN_ABANDONED);
  assert.deepEqual(Object.keys(calls[3].payload).sort(), ['attemptId', 'periodId']);
  assert.equal(calls[3].payload.attemptId, ATTEMPT);
  assert.deepEqual(Object.keys(calls[4].payload).sort(), ['odometerMiles', 'periodId']);
});

test('client rejects a malformed attempt id before calling the transport', async () => {
  let called = false;
  const client = createShiftAuthorityClient(
    async () => { called = true; return { protocolVersion: 1, periodId: '2026-08-10_090000', recorded: true }; },
    { requireSession: async () => true },
  );
  await assert.rejects(() => client.recordReturnAbandoned('2026-08-10_090000', 'bad id'), (e: unknown) => {
    assert.ok(e instanceof ShiftAuthorityError);
    assert.equal((e as ShiftAuthorityError).failure, 'malformed_attempt');
    return true;
  });
  assert.equal(called, false);
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


// ── invalid-argument refusals must name the specific reason ───────────────
// Regression for the MikeS24 Return-to-Yard refusal (2026-09-30): the server
// sent a specific reason, the extractor could not match it, and the driver was
// shown a bare `invalid_argument` with no field named.

test('every declared server reason token is extractable and survives mapping', () => {
  for (const token of SHIFT_AUTHORITY_REASON_TOKENS) {
    assert.equal(extractReasonToken(`FAILED_PRECONDITION: ${token}`), token, `bare ${token}`);
    const mapped = mapHttpsError({ code: 'functions/invalid-argument', message: token });
    assert.equal(mapped.message, token, `mapped message for ${token}`);
    assert.equal(mapped.failure, token, `failure class for ${token}`);
    assert.notEqual(mapped.message, 'invalid_argument', `${token} must not degrade to the generic token`);
  }
});

test('the two reasons that used to degrade now survive: malformed_attempt, payload_not_object', () => {
  for (const token of ['malformed_attempt', 'payload_not_object']) {
    const e = mapHttpsError({ code: 'functions/invalid-argument', message: `INVALID_ARGUMENT: ${token}` });
    assert.equal(e.message, token);
    assert.equal(e.failure, token);
  }
});

test('unknown_fields:attemptId keeps the field that was rejected', () => {
  const e = mapHttpsError({
    code: 'functions/invalid-argument',
    message: 'INVALID_ARGUMENT: unknown_fields:attemptId',
  });
  assert.equal(e.message, 'unknown_fields:attemptId');
  assert.equal(e.failure, 'unknown_fields', 'classified on the token head');
  assert.equal(reasonTokenHead(e.message), 'unknown_fields');
});

test('a reason carried in details.reason is used when the message has none', () => {
  const e = mapHttpsError({
    code: 'functions/invalid-argument',
    message: 'Request had invalid arguments.',
    details: { reason: 'malformed_attempt' },
  });
  assert.equal(e.message, 'malformed_attempt');
  assert.equal(e.failure, 'malformed_attempt');
});

test('details.field names the offending field even when the reason is unrecognised', () => {
  const e = mapHttpsError({
    code: 'functions/invalid-argument',
    message: 'Request had invalid arguments.',
    details: { field: 'attemptId' },
  });
  assert.equal(e.message, 'invalid_argument:attemptId', 'field preserved rather than discarded');
  assert.deepEqual(e.details, { field: 'attemptId' });
});

test('malformed_period still maps, and period/attempt reasons stay distinct', () => {
  assert.equal(mapHttpsError({ code: 'functions/invalid-argument', message: 'malformed_period' }).failure, 'malformed_period');
  assert.equal(mapHttpsError({ code: 'functions/invalid-argument', message: 'malformed_attempt' }).failure, 'malformed_attempt');
});

test('a truly opaque invalid-argument still falls back honestly', () => {
  const e = mapHttpsError({ code: 'functions/invalid-argument', message: 'Request had invalid arguments.' });
  assert.equal(e.message, 'invalid_argument');
  assert.equal(e.failure, 'unknown');
  assert.equal(e.details, undefined);
});

test('missing / malformed details never throw and never invent a reason', () => {
  for (const details of [undefined, null, 'a string', 42, [], { }, { nested: { a: 1 } }]) {
    const e = mapHttpsError({ code: 'functions/invalid-argument', message: 'opaque', details });
    assert.equal(e.message, 'invalid_argument');
    assert.equal(e.details, undefined);
  }
});

// ── privacy filtering on details ──────────────────────────────────────────
test('details sanitization keeps only allowlisted structural keys', () => {
  const out = sanitizeShiftAuthorityDetails({
    field: 'attemptId',
    expected: '^[A-Za-z0-9_-]{6,80}$',
    length: 36,
    protocolVersion: 1,
    somethingElse: 'dropped',
  });
  assert.deepEqual(out, {
    field: 'attemptId',
    expected: '^[A-Za-z0-9_-]{6,80}$',
    length: 36,
    protocolVersion: 1,
  });
});

test('details sanitization drops credentials, identity and location', () => {
  const out = sanitizeShiftAuthorityDetails({
    idToken: 'eyJhbGciOiJIUzI1NiJ9.payload',
    authorization: 'Bearer abc',
    passcodeHash: 'deadbeef',
    driverId: 'D-123',
    companyId: 'C-9',
    email: 'mike@example.com',
    latitude: 47.1234567,
    field: 'attemptId',
  });
  assert.deepEqual(out, { field: 'attemptId' }, 'only the safe structural key survives');
});

test('a sensitive VALUE is dropped even under an allowlisted key', () => {
  assert.equal(sanitizeShiftAuthorityDetails({ reason: 'mike@example.com' }), undefined);
  assert.equal(sanitizeShiftAuthorityDetails({ expected: '-122.4194019' }), undefined);
  assert.equal(sanitizeShiftAuthorityDetails({ field: 'eyJhbGciOiJIUzI1NiJ9.abcdefgh' }), undefined);
});

test('details sanitization bounds size, arrays and value length', () => {
  const long = 'x'.repeat(500);
  const out = sanitizeShiftAuthorityDetails({ expected: long, fields: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
  assert.ok(out);
  assert.equal((out as Record<string, string>).expected.length, 120);
  assert.equal((out as Record<string, string>).fields, 'a,b,c,d,e');
  // Non-finite numbers and nested objects never appear.
  assert.equal(sanitizeShiftAuthorityDetails({ length: Number.NaN }), undefined);
  assert.equal(sanitizeShiftAuthorityDetails({ expected: { nested: true } }), undefined);
});

test('the returned details object is frozen so callers cannot mutate the record', () => {
  const out = sanitizeShiftAuthorityDetails({ field: 'attemptId' });
  assert.ok(out && Object.isFrozen(out));
});

// ── the drift that caused this ────────────────────────────────────────────
test('the recognized-reason set and the extractor come from ONE list', () => {
  const src = readFileSync(
    join(__dirname, 'shiftAuthorityClient.ts'),
    'utf8',
  );
  assert.ok(src.includes('const KNOWN_REASONS: ReadonlySet<string> = new Set(SHIFT_AUTHORITY_REASON_TOKENS);'));
  assert.ok(src.includes('SHIFT_AUTHORITY_REASON_TOKENS.join(\'|\')'));
  // No second hand-written alternation list may reappear.
  assert.doesNotMatch(src, /driver_session_required\|driver_not_authoritative/);
});
