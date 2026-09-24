// Run: npx tsx --test src/core/services/shiftEventPolicy.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOpenShiftLastEvent } from './shiftEventPolicy';

test('shift is open after login / depart_return / return_abandoned; closed after logout', () => {
  assert.equal(isOpenShiftLastEvent('login'), true);
  assert.equal(isOpenShiftLastEvent('depart_return'), true);
  // return_abandoned (divert back to work) MUST keep the shift open so a later
  // real logout is not skipped by the illegal-append guard.
  assert.equal(isOpenShiftLastEvent('return_abandoned'), true);
  assert.equal(isOpenShiftLastEvent('logout'), false);
  assert.equal(isOpenShiftLastEvent(null), false);
  assert.equal(isOpenShiftLastEvent('UNKNOWN'), false);
});
