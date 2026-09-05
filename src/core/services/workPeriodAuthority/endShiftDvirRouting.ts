/**
 * End Shift routing vs. the vehicle/DVIR (Post-Trip) obligation.
 *
 * A WellBuilt shift is paid work time; a vehicle-operation (DVIR/Post-Trip)
 * obligation is a SEPARATE lifecycle. A driver may do shop work, maintenance,
 * training, or paperwork without operating a vehicle, so "no Pre-Trip" does NOT
 * mean "no work" — it means there is no vehicle-operation obligation gating the
 * close. Ticket/job activity is never the predicate.
 *
 * LOCKED RULE:  Post-Trip required = matching valid Pre-Trip AND actual
 * operation of that equipment.  Completing a Pre-Trip creates an inspected /
 * planned equipment session; it does NOT prove the equipment was driven.
 *
 *   preTrip  operated                result
 *   ───────  ─────────────────────   ─────────────────────────────────────────
 *   no       (any)                   End Shift directly; no Post-Trip
 *   yes      not_operated (proven)   End Shift directly; retain Pre-Trip record
 *   yes      operated                require the matching Post-Trip
 *   yes      unknown                 fail safe: require Post-Trip (never bypass)
 *   indeterminate / no period        fail safe into verification
 *
 * The predicate reuses the existing canonical Pre-Trip receipt signal (what the
 * Post-Trip gate itself uses) plus an equipment-operation signal. It never uses
 * ticket/job activity, invents a local authoritative marker, or weakens the gate.
 * No backend change, no reason token, and no arrival / inspection / odometer /
 * job / "no work" record is created.
 *
 * NOTE (contract gap): WB-S has no durable, period-attributed "vehicle operated"
 * signal today, so the wiring supplies operated = 'unknown' for every inspected
 * shift and the "yes + not_operated → direct close" row is not yet reachable in
 * production. The rule is encoded and tested here so it is correct the moment a
 * truthful operated signal exists. See the return report for the smallest
 * required contract change.
 */

/** Whether a matching valid Pre-Trip receipt exists for the shift. */
export type PreTripSignal = 'yes' | 'no' | 'indeterminate';
/** Whether the inspected equipment was actually operated this shift. */
export type OperatedSignal = 'operated' | 'not_operated' | 'unknown';

export interface EndShiftRouteInput {
  /** Enforced explicit_shift company. Legacy shifts keep their existing flow. */
  enforcedExplicit: boolean;
  /** Shift is open locally — an active clock OR a returning-to-yard drive. */
  shiftOpen: boolean;
  /** Authoritative server period id for the open shift. */
  periodId: string | null;
  /** Canonical Pre-Trip receipt signal for this shift. */
  preTrip: PreTripSignal;
  /** Canonical equipment-operation signal for this shift. */
  operated: OperatedSignal;
}

export type EndShiftRoute =
  | { action: 'direct_close'; periodId: string }
  | { action: 'existing_flow' }
  | { action: 'verify_obligation'; reason: 'obligation_unknown' | 'no_period' };

/**
 * Pure routing decision for the End Shift action. Never converts a governed or
 * unverified shift into a direct close, and never bypasses a possibly-required
 * Post-Trip: when operation cannot be proven for an inspected shift it fails
 * safe onto the governed Post-Trip path (which requires the inspection).
 */
export function decideEndShiftRoute(i: EndShiftRouteInput): EndShiftRoute {
  // Legacy/non-enforced shifts and not-open shifts keep the existing behavior.
  if (!i.enforcedExplicit) return { action: 'existing_flow' };
  if (!i.shiftOpen) return { action: 'existing_flow' };
  if (!i.periodId) return { action: 'verify_obligation', reason: 'no_period' };
  // Cannot even read the Pre-Trip signal → verify, never assume absent.
  if (i.preTrip === 'indeterminate') return { action: 'verify_obligation', reason: 'obligation_unknown' };
  // No vehicle/DVIR obligation → ordinary End Shift closes the work period
  // directly. Full shift duration is preserved (paid work may have occurred).
  if (i.preTrip === 'no') return { action: 'direct_close', periodId: i.periodId };
  // Inspected shift, canonically proven NOT operated (e.g. reassigned before
  // departing) → close directly and retain the Pre-Trip record. No false Post-Trip.
  if (i.operated === 'not_operated') return { action: 'direct_close', periodId: i.periodId };
  // Inspected AND (operated | operation unknown) → the existing governed
  // return/arrival/Post-Trip path owns the close. Fail-safe on unknown: require
  // the inspection rather than silently bypass it.
  return { action: 'existing_flow' };
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
