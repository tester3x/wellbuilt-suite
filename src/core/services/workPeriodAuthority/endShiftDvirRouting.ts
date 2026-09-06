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

/**
 * Authenticated server-authority shift state for the driver (from the
 * resolveActiveDriverShift callable). This is the TRUTH — a local
 * returning-to-yard hint never overrides it.
 *   - 'open'         → an authoritative open period (its exact id + origin day).
 *   - 'none'         → the server has NO open period (a local returning hint is stale).
 *   - 'unverifiable' → could not be authenticated/read (network/authority).
 *   - 'not_read'     → the server was not consulted (enforcement not live-enforced).
 */
export type ServerShiftState =
  | { state: 'open'; periodId: string; originLocalDate: string }
  | { state: 'none' }
  | { state: 'unverifiable' }
  | { state: 'not_read' };

export interface EndShiftRouteInput {
  /** Enforced explicit_shift company (from the enforcement value in hand). */
  enforcedExplicit: boolean;
  /**
   * Whether the enforcement value was confirmed by a LIVE authoritative read
   * this generation (not cache/unavailable/unresolved). A permissive route
   * requires live confirmation; a restrictive cached enforced config may still
   * retain the governed path.
   */
  enforcementLive: boolean;
  /**
   * Local hint that a shift may be open (active clock OR returning-to-yard).
   * This only TRIGGERS a server reconciliation — it never determines truth.
   */
  shiftOpen: boolean;
  /** Authenticated server-authority shift state (the source of truth). */
  serverShift: ServerShiftState;
  /** Canonical Pre-Trip receipt signal for the SERVER period. */
  preTrip: PreTripSignal;
  /** Canonical equipment-operation signal for the SERVER period. */
  operated: OperatedSignal;
}

export type EndShiftRoute =
  | { action: 'direct_close'; periodId: string; originLocalDate: string | null }
  | { action: 'existing_flow' }
  | { action: 'reconcile_none' }
  | { action: 'verify_obligation'; reason: 'obligation_unknown' | 'authority_unresolved' };

/**
 * Pure routing decision for the End Shift action.
 *
 * Authority gate first: an unresolved enforcement (cached legacy, unavailable,
 * or not live-confirmed) NEVER renders a permissive control — it fails closed to
 * a non-actionable verify/retry. A restrictive cached ENFORCED config may retain
 * the governed path.
 *
 * Under a LIVE enforced contract the authenticated SERVER state is the truth —
 * the local returning hint never determines it:
 *   - server 'none'         → reconcile the stale local returning state (no write).
 *   - server 'unverifiable' → non-actionable verify/retry (never guess).
 *   - server 'open'         → use the exact returned period; no Pre-Trip → ordinary
 *                             direct close; inspected+operated/unknown → governed.
 */
export function decideEndShiftRoute(i: EndShiftRouteInput): EndShiftRoute {
  if (!i.shiftOpen) return { action: 'existing_flow' };

  // ── Authority gate ──────────────────────────────────────────────────────
  if (!i.enforcementLive) {
    if (i.enforcedExplicit) return { action: 'existing_flow' };
    return { action: 'verify_obligation', reason: 'authority_unresolved' };
  }

  // ── Live-confirmed authority ────────────────────────────────────────────
  // Live legacy keeps the existing flow (legacy recovery ACTION deferred).
  if (!i.enforcedExplicit) return { action: 'existing_flow' };

  // Live enforced: the authenticated server state decides, not the local hint.
  switch (i.serverShift.state) {
    case 'not_read':
    case 'unverifiable':
      return { action: 'verify_obligation', reason: 'authority_unresolved' };
    case 'none':
      // No authoritative open period → the local returning state is stale.
      return { action: 'reconcile_none' };
    case 'open': {
      const { periodId, originLocalDate } = i.serverShift;
      // Cannot read the Pre-Trip signal → verify, never assume absent.
      if (i.preTrip === 'indeterminate') return { action: 'verify_obligation', reason: 'obligation_unknown' };
      // No vehicle/DVIR obligation → ordinary End Shift closes the work period
      // directly (full duration preserved; paid work may have occurred).
      if (i.preTrip === 'no') return { action: 'direct_close', periodId, originLocalDate };
      // Inspected, canonically NOT operated → direct close, retain Pre-Trip.
      if (i.operated === 'not_operated') return { action: 'direct_close', periodId, originLocalDate };
      // Inspected AND (operated | unknown) → governed Post-Trip. Fail-safe.
      return { action: 'existing_flow' };
    }
  }
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
  | { kind: 'reconcile_none' }
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
  if (deps.route.action === 'reconcile_none') return { kind: 'reconcile_none' };
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
