/**
 * End Shift routing vs. the vehicle/DVIR (Post-Trip) obligation.
 *
 * A WellBuilt shift is paid work time; a vehicle-operation (DVIR/Post-Trip)
 * obligation is a SEPARATE lifecycle. A driver may do shop work, maintenance,
 * training, or paperwork without operating a vehicle, so "no Pre-Trip" does NOT
 * mean "no work" — it means there is no vehicle-operation obligation gating the
 * close. Ticket/job activity is never the predicate.
 *
 * The predicate is the existing canonical Post-Trip obligation signal: a
 * matching completed Pre-Trip receipt (or an armed pending Post-Trip) for the
 * shift. That is exactly what ensurePostTripGate uses to arm Post-Trip, so this
 * reuses the canonical signal rather than inventing one.
 *
 *  - obligation present  → existing governed return / arrival / Post-Trip path.
 *  - definitively absent  → ordinary End Shift closes the work period directly
 *                           via the existing authoritative closeDriverShift.
 *  - unknown/unavailable  → never assume absent; verify/reconcile, never bypass.
 *
 * No backend change, no local authoritative marker, no reason token, and no
 * arrival / inspection / odometer / job / "no work" record is created.
 */

export type DvirObligationSignal = 'obligation' | 'no_obligation' | 'unknown';

export interface EndShiftRouteInput {
  /** Enforced explicit_shift company. Legacy shifts keep their existing flow. */
  enforcedExplicit: boolean;
  /** Shift is open locally — an active clock OR a returning-to-yard drive. */
  shiftOpen: boolean;
  /** Authoritative server period id for the open shift. */
  periodId: string | null;
  /** Canonical vehicle/DVIR obligation signal for this shift. */
  obligation: DvirObligationSignal;
}

export type EndShiftRoute =
  | { action: 'direct_close'; periodId: string }
  | { action: 'existing_flow' }
  | { action: 'verify_obligation'; reason: 'obligation_unknown' | 'no_period' };

/**
 * Pure routing decision for the End Shift action. Never converts a governed or
 * unverified shift into a direct close.
 */
export function decideEndShiftRoute(i: EndShiftRouteInput): EndShiftRoute {
  // Legacy/non-enforced shifts and not-open shifts keep the existing behavior.
  if (!i.enforcedExplicit) return { action: 'existing_flow' };
  if (!i.shiftOpen) return { action: 'existing_flow' };
  // A matching completed Pre-Trip (or armed Post-Trip) establishes the
  // vehicle-operation obligation — the governed return/arrival/Post-Trip path
  // owns the close and must not be weakened or bypassed.
  if (i.obligation === 'obligation') return { action: 'existing_flow' };
  // Never assume "no obligation" when the canonical signal is unavailable or
  // still verifying: reconcile / show a recoverable message instead.
  if (i.obligation === 'unknown') return { action: 'verify_obligation', reason: 'obligation_unknown' };
  if (!i.periodId) return { action: 'verify_obligation', reason: 'no_period' };
  // Definitively no vehicle/DVIR obligation → ordinary End Shift closes the work
  // period directly. Full shift duration is preserved (paid work may have occurred).
  return { action: 'direct_close', periodId: i.periodId };
}

export interface EndShiftDirectCloseDeps {
  /** Precomputed route from decideEndShiftRoute. */
  route: EndShiftRoute;
  /** Existing authoritative close — closeDriverShift with periodId only. */
  close: (periodId: string) => Promise<{ ok: boolean; alreadyClosed?: boolean; reason?: string }>;
  /**
   * Clear local return/active shift state. Called ONLY after an authoritative
   * close succeeds. Never truncates or fabricates shift-duration state.
   */
  clearReturnState: () => Promise<void>;
  /** Generation gate — a stale session must not mutate local state after logout. */
  isCurrent?: () => boolean;
}

export type EndShiftDirectCloseResult =
  | { kind: 'closed'; alreadyClosed: boolean }
  | { kind: 'existing_flow' }
  | { kind: 'verify_obligation'; reason: string }
  | { kind: 'retry'; reason: string };

/**
 * Perform the ordinary direct End Shift close for a shift with no vehicle/DVIR
 * obligation. On close failure the shift and any return state are left intact
 * and retryable; no false events are created. Idempotent via the server's
 * alreadyClosed contract.
 */
export async function performEndShiftDirectClose(
  deps: EndShiftDirectCloseDeps,
): Promise<EndShiftDirectCloseResult> {
  if (deps.route.action === 'existing_flow') return { kind: 'existing_flow' };
  if (deps.route.action === 'verify_obligation') {
    return { kind: 'verify_obligation', reason: deps.route.reason };
  }
  const periodId = deps.route.periodId;
  const isStale = () => (deps.isCurrent ? !deps.isCurrent() : false);
  if (isStale()) return { kind: 'verify_obligation', reason: 'stale_generation' };

  let closed: { ok: boolean; alreadyClosed?: boolean; reason?: string };
  try {
    closed = await deps.close(periodId);
  } catch (err) {
    return { kind: 'retry', reason: err instanceof Error ? err.message : 'close_failed' };
  }
  if (!closed.ok) return { kind: 'retry', reason: closed.reason || 'close_failed' };

  // Authoritative close succeeded — clear local return/active state only while
  // this session is still current.
  if (!isStale()) await deps.clearReturnState();
  return { kind: 'closed', alreadyClosed: !!closed.alreadyClosed };
}
