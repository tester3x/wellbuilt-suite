import { strict as assert } from 'node:assert';
import test from 'node:test';
import { mintReturnAttemptId, isReturnAttemptId, RETURN_ATTEMPT_ID_RE } from './returnAttempt';

const PERIOD = '2026-09-24_143000';

test('minted id matches the server-shared attempt-id shape', () => {
  const id = mintReturnAttemptId(PERIOD, 1_758_000_000_000, () => 0.123456);
  assert.ok(RETURN_ATTEMPT_ID_RE.test(id), `not a valid attempt id: ${id}`);
  assert.ok(isReturnAttemptId(id));
  assert.ok(id.length <= 80);
});

test('deterministic for fixed now/rand; distinct for different now', () => {
  const a = mintReturnAttemptId(PERIOD, 1000, () => 0.5);
  const b = mintReturnAttemptId(PERIOD, 1000, () => 0.5);
  const c = mintReturnAttemptId(PERIOD, 2000, () => 0.5);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('two returns in the same period get distinct ids', () => {
  const first = mintReturnAttemptId(PERIOD, 1_758_000_000_000, () => 0.1);
  const second = mintReturnAttemptId(PERIOD, 1_758_000_600_000, () => 0.9);
  assert.notEqual(first, second);
  assert.ok(isReturnAttemptId(first) && isReturnAttemptId(second));
});

test('validator rejects malformed', () => {
  assert.equal(isReturnAttemptId(''), false);
  assert.equal(isReturnAttemptId('short'), false);
  assert.equal(isReturnAttemptId('bad space'), false);
  assert.equal(isReturnAttemptId('a'.repeat(81)), false);
  assert.equal(isReturnAttemptId(undefined), false);
});
