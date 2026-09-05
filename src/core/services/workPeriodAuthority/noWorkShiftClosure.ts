/**
 * Aborted / no-work shift closure (P0).
 *
 * A shift that never completed its required Pre-Trip and never entered governed
 * work must be closable by the driver's explicit End Shift action WITHOUT a
 * fabricated arrival, Pre-Trip, or Post-Trip. This module owns the pure
 * eligibility decision and the closure orchestration over injected authority.
 *
 * Eligibility is computed from AUTHORITATIVE state — the durable Pre-Trip /
 * Post-Trip completion receipts plus the server period id — never from
 * screen/travel state. JSA is deliberately not an input, so a disabled JSA can
 * never gate. A navigation/drive timer is likewise not an input, so it can
 * never force Mark Arrived or fabricate a DVIR.
 *
 * The authoritative closure reuses the existing closeDriverShift contract with
 * the periodId only (no odometer). It never writes pendingEndShiftId, never
 * launches Post-Trip, and never fabricates a receipt or arrival. The bounded
 * terminal reason is recorded through the injected client audit lane; the
 * server contract is not changed.
 */

export type NoWorkTerminalReason = 'aborted_before_pretrip' | 'no_governed_work';

export interface NoWorkEligibilityInput {
  /** Enforced explicit_shift company. Legacy shifts are out of scope here. */
  enforcedExplicit: boolean;
  /** Shift is open locally — an active clock OR a returning-to-yard drive. */
  shiftOpen: boolean;
  /** Authoritative server period id for the open shift. */
  periodId: string | null;
  /** Durable Pre-Trip completion receipt exists for this shift. */
  hasPreTripReceipt: boolean;
  /** Durable Post-Trip completion receipt exists for this shift. */
  hasPostTripReceipt: boolean;
}

export type NoWorkIneligibleReason =
  | 'not_enforced'
  | 'shift_not_open'
  | 'no_period'
  | 'pretrip_present'
  | 'governed_work_present';

export type NoWorkDecision =
  | { eligible: true; periodId: string; terminalReason: NoWorkTerminalReason }
  | { eligible: false; reason: NoWorkIneligibleReason };

/**
 * Pure eligibility decision for the aborted / no-work close.
 *
 * A completed Post-Trip means work happened and finished; a completed Pre-Trip
 * means governed work could have started — either way the governed Post-Trip
 * flow owns the close and we never abort-close. The absence of a Pre-Trip
 * receipt is authoritative proof that Tickets was never unlocked, so no governed
 * WB-T job or load could have started.
 */
export function decideNoWorkClosure(input: NoWorkEligibilityInput): NoWorkDecision {
  if (!input.enforcedExplicit) return { eligible: false, reason: 'not_enforced' };
  if (!input.shiftOpen) return { eligible: false, reason: 'shift_not_open' };
  if (!input.periodId) return { eligible: false, reason: 'no_period' };
  if (input.hasPostTripReceipt) return { eligible: false, reason: 'governed_work_present' };
  if (input.hasPreTripReceipt) return { eligible: false, reason: 'pretrip_present' };
  return {
    eligible: true,
    periodId: input.periodId,
    terminalReason: 'aborted_before_pretrip',
  };
}

export interface NoWorkClosureDeps {
  eligibility: NoWorkEligibilityInput;
  /**
   * Authoritative server close — closeDriverShift with periodId only, no
   * odometer. Idempotent server-side (alreadyClosed on repeat).
   */
  close: (periodId: string) => Promise<{ ok: boolean; alreadyClosed?: boolean; reason?: string }>;
  /**
   * Record the bounded terminal reason in the Suite client audit lane
   * (diagnostic + local marker). Must not reach a backend contract.
   */
  recordTerminalReason: (periodId: string, reason: NoWorkTerminalReason) => void | Promise<void>;
  /** Clear local trip/navigation + active shift state. Called ONLY after ok close. */
  clearTripState: () => Promise<void>;
  /** Generation gate — a stale session must not mutate local state after logout/login. */
  isCurrent?: () => boolean;
}

export type NoWorkClosureResult =
  | { kind: 'closed'; periodId: string; alreadyClosed: boolean; terminalReason: NoWorkTerminalReason }
  | { kind: 'not_eligible'; reason: NoWorkIneligibleReason | 'stale_generation' }
  | { kind: 'retry'; reason: string };

/**
 * Orchestrate the aborted / no-work closure.
 *
 * On an authoritative-close failure (backend error or offline) the shift and
 * its trip/navigation state are left completely intact and the caller may retry
 * — nothing local is cleared and no terminal reason is recorded. On success the
 * terminal reason is recorded and local trip state is cleared, in that order,
 * and only while the originating session is still current.
 */
export async function performNoWorkClosure(deps: NoWorkClosureDeps): Promise<NoWorkClosureResult> {
  const decision = decideNoWorkClosure(deps.eligibility);
  if (!decision.eligible) return { kind: 'not_eligible', reason: decision.reason };

  const isStale = () => (deps.isCurrent ? !deps.isCurrent() : false);
  if (isStale()) return { kind: 'not_eligible', reason: 'stale_generation' };

  let closed: { ok: boolean; alreadyClosed?: boolean; reason?: string };
  try {
    closed = await deps.close(decision.periodId);
  } catch (err) {
    return { kind: 'retry', reason: err instanceof Error ? err.message : 'close_failed' };
  }
  if (!closed.ok) {
    return { kind: 'retry', reason: closed.reason || 'close_failed' };
  }

  // Authoritative closure succeeded. Record the bounded reason (safe even if the
  // session was replaced — it is keyed by the closed period), then clear local
  // trip/navigation state only while this session is still current.
  await deps.recordTerminalReason(decision.periodId, decision.terminalReason);
  if (!isStale()) {
    await deps.clearTripState();
  }
  return {
    kind: 'closed',
    periodId: decision.periodId,
    alreadyClosed: !!closed.alreadyClosed,
    terminalReason: decision.terminalReason,
  };
}
