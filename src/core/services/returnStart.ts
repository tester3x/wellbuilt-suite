/**
 * Return-to-Yard confirmation: start the return drive, or say why not.
 *
 * FIELD DEFECT THIS GUARDS (v49 / 35695d5, MikeS24, 2026-09-30)
 *
 * The shipped handler was:
 *
 *     const handleReturnToYard = async () => {
 *       setShowEndModal(false);     // dismissed BEFORE the attempt
 *       await onStartReturn();      // Promise<void> — outcome discarded
 *     };
 *
 * and `startReturn` returned `void`, bailing out with only a console.warn when
 * the governed depart_return was refused. So a refused return looked exactly
 * like a successful one: the modal closed, no return state existed, no error
 * was shown, and End Shift / logout had nowhere left to go. The driver was
 * stranded on the Suite home screen with an open shift.
 *
 * The rule this module enforces: the confirmation is dismissed ONLY after the
 * return state has actually been accepted. Any other outcome keeps the modal up
 * and states the reason. A return the server did not record is never presented
 * as a return that happened.
 *
 * Kept RN/expo-free so the tap behaviour — success, duplicate taps, refusal,
 * storage rejection, session change — is executable in node:test.
 */

export type ReturnStartResult = { ok: true } | { ok: false; reason: string };

/** Close the confirmation only after the return state has been accepted. */
export async function confirmReturnStart(
  start: () => Promise<ReturnStartResult>,
  confirmed: () => void,
): Promise<ReturnStartResult> {
  try {
    const result = await start();
    if (result?.ok === true) {
      confirmed();
      return result;
    }
    return { ok: false, reason: result?.reason || 'return_failed' };
  } catch {
    return { ok: false, reason: 'return_failed' };
  }
}

export type ReturnStartRecovery =
  /** Another attempt can genuinely succeed. */
  | 'retry'
  /** Needs a fresh secure sign-in. */
  | 'reauthenticate'
  /** Needs back-office action; the driver cannot clear it from the device. */
  | 'contact_dispatch'
  /** App and server disagree on the return contract. */
  | 'update_app'
  /** The device's own date/time is the problem. */
  | 'check_device_date'
  /** The shift itself could not be confirmed. */
  | 'refresh_shift';

export type ReturnStartDiagnosis = {
  /** Canonical token, always surfaced so support can act without a screenshot. */
  code: string;
  recovery: ReturnStartRecovery;
  message: string;
  /** Whether offering "try again" is honest for this class. */
  retryable: boolean;
};

/** App/server contract disagreement — retrying sends the same rejected shape. */
const CONTRACT = new Set([
  'invalid_argument',
  'unsupported_return_contract',
  'malformed_response',
  'malformed_period',
  'malformed_attempt',
  'unsupported_protocol_version',
  'payload_not_object',
]);

/** Back-office state: driver record or company shift authority. */
const DISPATCH = new Set([
  'authority_absent',
  'authority_uninitialized',
  'authority_inconsistent',
  'driver_inactive',
  'driver_not_authoritative',
  'driver_mismatch',
]);

const DEVICE_DATE = new Set(['period_date_mismatch', 'implausible_origin_local_date']);

const SHIFT_UNCONFIRMED = new Set(['no_open_shift', 'no_period', 'no_user', 'no_shift']);

/** Transient / plumbing where another tap is a real remedy. */
const TRANSIENT = new Set([
  'return_failed',
  'depart_failed',
  'transport',
  'callable_unavailable',
  'callable_failed',
  'failed_precondition',
  'stale_generation',
  'in_flight',
  'identity_superseded',
  'period_mismatch',
]);

function isMalformedFieldReason(code: string): boolean {
  return /^(resolve|claim|depart|abandon|close)_(bad|missing|not)_/.test(code);
}

/** Return-state persistence failures raised by returnStateStore. */
function isStorageReason(code: string): boolean {
  return code === 'return_attempt_reserve_failed'
    || code === 'return_depart_write_failed'
    || code === 'return_state_read_failed'
    || code === 'return_state_clear_failed'
    || code === 'minted_attempt_invalid';
}

/**
 * Explain a refused return honestly.
 *
 * Every message states that the shift is STILL OPEN — the driver must never be
 * left thinking the return or the logout went through — and every message
 * carries the code, because the reason was previously only a console.warn and
 * nobody could tell a backend contract rejection from a dead network.
 */
export function classifyReturnStartFailure(raw: string | null | undefined): ReturnStartDiagnosis {
  const code = (typeof raw === 'string' && raw.trim() ? raw.trim() : 'return_failed').toLowerCase();
  const support = ` (code: ${code})`;
  const stillOpen = 'Your shift is still open.';

  if (CONTRACT.has(code) || isMalformedFieldReason(code)) {
    return {
      code,
      recovery: 'update_app',
      message: `The server could not accept this return request. ${stillOpen} `
        + `The app and server need a matching update — report this code.${support}`,
      retryable: false,
    };
  }
  if (code === 'driver_session_required') {
    return {
      code,
      recovery: 'reauthenticate',
      message: `Your secure session has expired, so the return could not be recorded. ${stillOpen} `
        + `Log out and log back in, then try the return again.${support}`,
      retryable: false,
    };
  }
  if (DISPATCH.has(code)) {
    return {
      code,
      recovery: 'contact_dispatch',
      message: `The shift server will not record a return for this driver yet. ${stillOpen} `
        + `Retrying will not change this — give dispatch this code.${support}`,
      retryable: false,
    };
  }
  if (DEVICE_DATE.has(code)) {
    return {
      code,
      recovery: 'check_device_date',
      message: `The shift server rejected this device's date. ${stillOpen} `
        + `Set date, time and time zone to automatic, then try again.${support}`,
      retryable: true,
    };
  }
  if (SHIFT_UNCONFIRMED.has(code)) {
    return {
      code,
      recovery: 'refresh_shift',
      message: `Your active shift could not be confirmed, so the return was not started. ${stillOpen} `
        + `Refresh your shift status and try again.${support}`,
      retryable: true,
    };
  }
  if (isStorageReason(code) || code === 'no_attempt') {
    return {
      code,
      recovery: 'retry',
      message: `This device could not save the return securely, so the return was not started. ${stillOpen} `
        + `Try again.${support}`,
      retryable: true,
    };
  }
  if (TRANSIENT.has(code)) {
    return {
      code,
      recovery: 'retry',
      message: `Could not start the return drive. ${stillOpen} `
        + `Check your connection and try again.${support}`,
      retryable: true,
    };
  }
  // Unrecognised: never dress it up as a network problem, and keep the token.
  return {
    code,
    recovery: 'retry',
    message: `The return could not be started for a reason this app version does not recognise. `
      + `${stillOpen} Try again; if it repeats, give dispatch this code.${support}`,
    retryable: true,
  };
}

/** Back-compatible message helper. */
export function returnStartMessage(reason: string): string {
  return classifyReturnStartFailure(reason).message;
}

/** Single-owner latch so a double tap cannot start two returns. */
export type ReturnTapLatch = {
  tryAcquire: () => boolean;
  release: () => void;
  held: () => boolean;
};

export function createReturnTapLatch(): ReturnTapLatch {
  let busy = false;
  return {
    tryAcquire() {
      if (busy) return false;
      busy = true;
      return true;
    },
    release() {
      busy = false;
    },
    held() {
      return busy;
    },
  };
}

export type ReturnTapOutcome =
  | { kind: 'started' }
  | { kind: 'busy' }
  | { kind: 'failed'; diagnosis: ReturnStartDiagnosis };

/**
 * One "Return to Yard" tap.
 *
 * `onStarted` is the ONLY path that dismisses the confirmation, and it runs
 * only after `start()` has resolved `{ ok: true }` — the invariant whose
 * absence stranded the driver in v49. A refused or throwing start leaves the
 * modal up with a truthful message, and `report` gives the failure somewhere
 * durable to go so a backend refusal is diagnosable without a screenshot.
 */
export async function runReturnTap(deps: {
  latch: ReturnTapLatch;
  start: () => Promise<ReturnStartResult>;
  /** Dismiss the confirmation. Called only on a confirmed success. */
  onStarted: () => void;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string | null) => void;
  report?: (diagnosis: ReturnStartDiagnosis) => void;
}): Promise<ReturnTapOutcome> {
  // A second tap while the first is resolving must change nothing at all, and
  // must not release the first tap's latch.
  if (!deps.latch.tryAcquire()) return { kind: 'busy' };
  deps.onBusyChange(true);
  deps.onError(null);
  let result: ReturnStartResult;
  try {
    result = await confirmReturnStart(deps.start, deps.onStarted);
  } finally {
    deps.latch.release();
    deps.onBusyChange(false);
  }
  if (result.ok) return { kind: 'started' };
  const diagnosis = classifyReturnStartFailure(result.reason);
  deps.onError(diagnosis.message);
  deps.report?.(diagnosis);
  return { kind: 'failed', diagnosis };
}
