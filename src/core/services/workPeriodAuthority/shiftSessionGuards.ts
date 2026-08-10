/**
 * Pure session-generation + Start Shift result + odometer close guards.
 * No React / RN imports — node:test friendly.
 */

/** Mutable generation counter (use behind a ref in React). */
export type GenerationClock = {
  /** Bump and return the new generation (invalidates all prior captures). */
  bump: (reason?: string) => number;
  /** Current generation without bumping. */
  current: () => number;
  /** True iff `captured` still matches the live generation. */
  isCurrent: (captured: number) => boolean;
};

export function createGenerationClock(initial = 0): GenerationClock {
  let gen = initial;
  return {
    bump() {
      gen += 1;
      return gen;
    },
    current() {
      return gen;
    },
    isCurrent(captured: number) {
      return captured === gen;
    },
  };
}

/**
 * Explicit Start Shift result contract.
 * Only `{ ok: true }` (optionally with extra fields) is success.
 * null / undefined / malformed / `{ ok: false }` are never success.
 */
export type ExplicitStartShiftSuccess = { ok: true; reason?: string; [k: string]: unknown };
export type ExplicitStartShiftFailure = { ok: false; reason: string; [k: string]: unknown };
export type ExplicitStartShiftResult = ExplicitStartShiftSuccess | ExplicitStartShiftFailure;

export function isExplicitStartShiftSuccess(result: unknown): result is ExplicitStartShiftSuccess {
  if (result === null || result === undefined) return false;
  if (typeof result !== 'object') return false;
  if (!('ok' in result)) return false;
  return (result as { ok: unknown }).ok === true;
}

export function startShiftFailureReason(result: unknown): string {
  if (result === null || result === undefined) return 'missing_start_result';
  if (typeof result !== 'object') return 'malformed_start_result';
  if (!('ok' in result)) return 'malformed_start_result';
  if ((result as { ok: unknown }).ok === true) return 'ok';
  const reason = (result as { reason?: unknown }).reason;
  return typeof reason === 'string' && reason ? reason : 'start_refused';
}

/**
 * Close-path odometer: total shift miles (end − start), not absolute reading.
 *
 * - absent (undefined/null): omit field (supported optional policy)
 * - present but invalid: block close (do not silently omit)
 * - valid integer 0..5000: pass through
 */
export type CloseOdometerDecision =
  | { kind: 'omit' }
  | { kind: 'valid'; miles: number }
  | { kind: 'invalid'; reason: string };

export function classifyCloseOdometerMiles(raw: unknown): CloseOdometerDecision {
  if (raw === undefined || raw === null) {
    return { kind: 'omit' };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { kind: 'invalid', reason: 'invalid_odometer_miles' };
  }
  // Non-integer totals are malformed — do not round-and-close.
  if (!Number.isInteger(raw)) {
    return { kind: 'invalid', reason: 'invalid_odometer_miles' };
  }
  if (raw < 0 || raw > 5000) {
    return { kind: 'invalid', reason: 'invalid_odometer_miles' };
  }
  return { kind: 'valid', miles: raw };
}
