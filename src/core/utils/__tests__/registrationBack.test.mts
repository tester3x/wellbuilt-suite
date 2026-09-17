// Navigation unit tests for the WB-S registration Android-Back contract.
// Pure logic — no React Native imports. Run:
//   node --experimental-strip-types --test src/core/utils/__tests__/registrationBack.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldInstallRegistrationBackHandler,
  decideRegistrationHardwareBack,
  consumeRegistrationHardwareBack,
  shouldClearPasscodeOnLeaveRegistration,
} from '../registrationBack.ts';

test('Back handler installs only for register and pending modes', () => {
  assert.equal(shouldInstallRegistrationBackHandler('register'), true);
  assert.equal(shouldInstallRegistrationBackHandler('pending'), true);
  for (const m of ['login', 'checking', 'verifying', 'registering', 'approved', 'rejected', 'error']) {
    assert.equal(shouldInstallRegistrationBackHandler(m), false, `should not install for ${m}`);
  }
});

test('register: first Back dismisses keyboard, next returns to Sign In', () => {
  assert.equal(decideRegistrationHardwareBack('register', true), 'dismiss-keyboard');
  assert.equal(decideRegistrationHardwareBack('register', false), 'return-to-sign-in');
});

test('pending: Back returns to Sign In (no keyboard to dismiss)', () => {
  assert.equal(decideRegistrationHardwareBack('pending', true), 'return-to-sign-in');
  assert.equal(decideRegistrationHardwareBack('pending', false), 'return-to-sign-in');
});

test('other modes are not intercepted', () => {
  assert.equal(decideRegistrationHardwareBack('login', false), 'none');
});

test('consume: register+keyboard dismisses keyboard and is handled', () => {
  let dismissed = false, returned = false;
  const handled = consumeRegistrationHardwareBack({
    mode: 'register', keyboardVisible: true,
    dismissKeyboard: () => { dismissed = true; },
    returnToSignIn: () => { returned = true; },
  });
  assert.equal(handled, true);
  assert.equal(dismissed, true);
  assert.equal(returned, false);
});

test('consume: register (no keyboard) returns to Sign In and is handled', () => {
  let returned = false;
  const handled = consumeRegistrationHardwareBack({
    mode: 'register', keyboardVisible: false,
    dismissKeyboard: () => {},
    returnToSignIn: () => { returned = true; },
  });
  assert.equal(handled, true);
  assert.equal(returned, true);
});

test('consume: pending returns to Sign In and is handled', () => {
  let returned = false;
  const handled = consumeRegistrationHardwareBack({
    mode: 'pending', keyboardVisible: false,
    dismissKeyboard: () => {},
    returnToSignIn: () => { returned = true; },
  });
  assert.equal(handled, true);
  assert.equal(returned, true);
});

test('consume: unrelated mode is NOT handled (OS proceeds)', () => {
  const handled = consumeRegistrationHardwareBack({
    mode: 'login', keyboardVisible: false,
    dismissKeyboard: () => {},
    returnToSignIn: () => { assert.fail('must not return to sign in'); },
  });
  assert.equal(handled, false);
});

test('leaving register clears the typed passcode; leaving pending does not', () => {
  assert.equal(shouldClearPasscodeOnLeaveRegistration('register'), true);
  assert.equal(shouldClearPasscodeOnLeaveRegistration('pending'), false);
});
