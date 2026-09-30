import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmReturnStart, returnStartMessage } from './returnStart';

test('rejected server request leaves confirmation open with a useful error', async () => {
  let closed = false;
  const result = await confirmReturnStart(async () => ({ ok: false, reason: 'invalid_argument' }), () => { closed = true; });
  assert.deepEqual(result, { ok: false, reason: 'invalid_argument' });
  assert.equal(closed, false);
  assert.match(returnStartMessage('invalid_argument'), /shift is still open/);
});
test('confirmation remains open until return has actually succeeded', async () => {
  let accept!: (result: { ok: true }) => void;
  let closed = false;
  const result = confirmReturnStart(() => new Promise(resolve => { accept = resolve; }), () => { closed = true; });
  assert.equal(closed, false);
  accept({ ok: true });
  assert.deepEqual(await result, { ok: true });
  assert.equal(closed, true);
});
test('storage/network exceptions do not dismiss confirmation', async () => {
  const result = await confirmReturnStart(async () => { throw new Error('network'); }, () => assert.fail('dismissed'));
  assert.equal(result.ok, false);
});
test('stale session and duplicate in-flight results do not dismiss confirmation', async () => {
  for (const reason of ['stale_generation', 'in_flight', 'no_open_shift']) {
    const result = await confirmReturnStart(async () => ({ ok: false, reason }), () => assert.fail('dismissed'));
    assert.equal(result.ok, false);
  }
});
