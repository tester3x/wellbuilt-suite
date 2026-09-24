// Run: npx tsx --test src/core/services/returnDivert.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldDivertFromReturn } from './returnDivert';

test('divert only while a return is in progress', () => {
  assert.equal(shouldDivertFromReturn({ hasUser: true, returningToYard: true }), true);
  assert.equal(shouldDivertFromReturn({ hasUser: true, returningToYard: false }), false); // active shift, not returning
  assert.equal(shouldDivertFromReturn({ hasUser: false, returningToYard: true }), false); // no user
  assert.equal(shouldDivertFromReturn({ hasUser: false, returningToYard: false }), false);
});
