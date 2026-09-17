/**
 * Android Back on the New Employee Registration / Pending views (WB-S).
 *
 * Registration and Pending are *modes* on the single Login route, not stack
 * screens. Hardware Back, the header Back control, and the on-screen "Sign in"
 * link therefore share one destination: an in-screen switch back to Sign In.
 * Popping the route would finish the auth activity and close WB-S, so while
 * these modes show we consume Back and return to Sign In instead. Mirrors the
 * proven WB-M registrationBack contract, extended to also cover Pending.
 */

export type RegisterHardwareBackAction =
  | 'dismiss-keyboard'
  | 'return-to-sign-in'
  | 'none';

/** Install the hardware-Back interceptor only while these modes are showing. */
export function shouldInstallRegistrationBackHandler(mode: string): boolean {
  return mode === 'register' || mode === 'pending';
}

/**
 * From Registration, a first Back press dismisses the keyboard (if open); the
 * next returns to Sign In. From Pending there is no keyboard, so Back returns
 * to Sign In directly. Any other mode is not handled here.
 */
export function decideRegistrationHardwareBack(
  mode: string,
  keyboardVisible: boolean,
): RegisterHardwareBackAction {
  if (mode === 'register') {
    return keyboardVisible ? 'dismiss-keyboard' : 'return-to-sign-in';
  }
  if (mode === 'pending') {
    return 'return-to-sign-in';
  }
  return 'none';
}

/**
 * Apply the decision. Returns true when handled (so Android does not finish the
 * activity), false when the mode is not one we intercept (let the OS proceed).
 */
export function consumeRegistrationHardwareBack(opts: {
  mode: string;
  keyboardVisible: boolean;
  dismissKeyboard: () => void;
  returnToSignIn: () => void;
}): boolean {
  const action = decideRegistrationHardwareBack(opts.mode, opts.keyboardVisible);
  if (action === 'dismiss-keyboard') {
    opts.dismissKeyboard();
    return true;
  }
  if (action === 'return-to-sign-in') {
    opts.returnToSignIn();
    return true;
  }
  return false;
}

/** Leaving Registration must drop the typed passcode; it is never persisted. */
export function shouldClearPasscodeOnLeaveRegistration(mode: string): boolean {
  return mode === 'register';
}
