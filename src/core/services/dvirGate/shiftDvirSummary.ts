/**
 * Finalized shift DVIR summary for Shift Complete (and future daily DVIR).
 * Built only from durable Suite-local phase receipts — never from
 * “equipment was opened” or shift clock times.
 */
import type { DvirReceiptKv } from './dvirReceiptStore';
import { getReceipt } from './dvirReceiptStore';
import type { PhaseCompletionReceipt } from './receiptTypes';

const ROOT = '@wb/suite-dvir-gate/v1';

export function shiftDvirSummaryKey(shiftId: string): string {
  return `${ROOT}/shiftSummary/${shiftId}`;
}

export function lastFinalizedDvirSummaryKey(): string {
  return `${ROOT}/lastFinalizedSummary`;
}

export type PreTripPhaseStatus = 'captured' | 'not_captured' | 'missing' | 'not_available';
export type PostTripPhaseStatus = 'completed' | 'missing' | 'not_available';
export type DvirOverallStatus =
  | 'completed'
  | 'post_trip_completed'
  | 'partial'
  | 'not_available';

export interface ShiftDvirPhaseSummary {
  status: PreTripPhaseStatus | PostTripPhaseStatus;
  /** Inspection completion time from the accepted receipt — never shift clock. */
  completedAt: string | null;
}

export interface ShiftDvirSummary {
  schemaVersion: 'suite-dvir-summary/1';
  shiftId: string;
  overallStatus: DvirOverallStatus;
  preTrip: ShiftDvirPhaseSummary;
  postTrip: ShiftDvirPhaseSummary;
  truckUnit?: string | null;
  trailerUnit?: string | null;
  /** When this summary was assembled (not an inspection timestamp). */
  finalizedAt: string;
}

export interface BuildShiftDvirSummaryInput {
  shiftId: string;
  preReceipt: PhaseCompletionReceipt | null;
  postReceipt: PhaseCompletionReceipt | null;
  truckUnit?: string | null;
  trailerUnit?: string | null;
  nowIso?: string;
}

/**
 * Assemble a truthful summary from accepted receipts for one shift only.
 * Legacy: post receipt without pre → Pre-Trip "not captured".
 */
export function buildShiftDvirSummary(input: BuildShiftDvirSummaryInput): ShiftDvirSummary {
  const shiftId = input.shiftId?.trim();
  if (!shiftId) {
    return emptySummary('', input.nowIso);
  }

  const preOk =
    !!input.preReceipt &&
    input.preReceipt.shiftId === shiftId &&
    input.preReceipt.phase === 'pre_trip';
  const postOk =
    !!input.postReceipt &&
    input.postReceipt.shiftId === shiftId &&
    input.postReceipt.phase === 'post_trip';

  const preTrip: ShiftDvirPhaseSummary = preOk
    ? {
        status: 'captured',
        completedAt: input.preReceipt!.completedAt || null,
      }
    : postOk
      ? {
          // Legacy migration: Post-Trip sealed without Pre-Trip capture
          status: 'not_captured',
          completedAt: null,
        }
      : {
          status: 'missing',
          completedAt: null,
        };

  const postTrip: ShiftDvirPhaseSummary = postOk
    ? {
        status: 'completed',
        completedAt: input.postReceipt!.completedAt || null,
      }
    : {
        status: 'missing',
        completedAt: null,
      };

  let overallStatus: DvirOverallStatus;
  if (preOk && postOk) overallStatus = 'completed';
  else if (!preOk && postOk) overallStatus = 'post_trip_completed';
  else if (preOk || postOk) overallStatus = 'partial';
  else overallStatus = 'not_available';

  return {
    schemaVersion: 'suite-dvir-summary/1',
    shiftId,
    overallStatus,
    preTrip,
    postTrip,
    truckUnit: input.truckUnit?.trim() || null,
    trailerUnit: input.trailerUnit?.trim() || null,
    finalizedAt: input.nowIso || new Date().toISOString(),
  };
}

function emptySummary(shiftId: string, nowIso?: string): ShiftDvirSummary {
  return {
    schemaVersion: 'suite-dvir-summary/1',
    shiftId,
    overallStatus: 'not_available',
    preTrip: { status: 'not_available', completedAt: null },
    postTrip: { status: 'not_available', completedAt: null },
    truckUnit: null,
    trailerUnit: null,
    finalizedAt: nowIso || new Date().toISOString(),
  };
}

/** Load receipts for shiftId and build summary (never crosses shift identity). */
export async function buildShiftDvirSummaryFromStore(
  kv: DvirReceiptKv,
  shiftId: string,
  opts?: { truckUnit?: string | null; trailerUnit?: string | null; nowIso?: string },
): Promise<ShiftDvirSummary> {
  const id = shiftId?.trim();
  if (!id) return emptySummary('', opts?.nowIso);
  const preReceipt = await getReceipt(kv, id, 'pre_trip');
  const postReceipt = await getReceipt(kv, id, 'post_trip');
  // Guard: never attach another shift's receipt
  const pre =
    preReceipt && preReceipt.shiftId === id ? preReceipt : null;
  const post =
    postReceipt && postReceipt.shiftId === id ? postReceipt : null;
  return buildShiftDvirSummary({
    shiftId: id,
    preReceipt: pre,
    postReceipt: post,
    truckUnit: opts?.truckUnit,
    trailerUnit: opts?.trailerUnit,
    nowIso: opts?.nowIso,
  });
}

/**
 * Cold-upgrade / first-open hydration for a finalized shift:
 * - If suite-dvir-summary already exists for this shiftId, return it (idempotent).
 * - Else assemble from durable receipts for that exact shiftId only, persist, return.
 *
 * Covers upgrades where receipts were accepted before shiftSummary existed —
 * no second receipt or new shift required.
 */
export async function hydrateShiftDvirSummaryIfMissing(
  kv: DvirReceiptKv,
  shiftId: string,
  opts?: { truckUnit?: string | null; trailerUnit?: string | null; nowIso?: string },
): Promise<ShiftDvirSummary | null> {
  const id = shiftId?.trim();
  if (!id) return null;

  const existing = await loadShiftDvirSummary(kv, id);
  if (existing) return existing;

  const built = await buildShiftDvirSummaryFromStore(kv, id, opts);
  await saveShiftDvirSummary(kv, built);
  return built;
}

export async function saveShiftDvirSummary(
  kv: DvirReceiptKv,
  summary: ShiftDvirSummary,
): Promise<void> {
  if (!summary.shiftId) return;
  await kv.setItem(shiftDvirSummaryKey(summary.shiftId), JSON.stringify(summary));
  await kv.setItem(lastFinalizedDvirSummaryKey(), JSON.stringify(summary));
}

export async function loadShiftDvirSummary(
  kv: DvirReceiptKv,
  shiftId: string,
): Promise<ShiftDvirSummary | null> {
  const id = shiftId?.trim();
  if (!id) return null;
  const raw = await kv.getItem(shiftDvirSummaryKey(id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ShiftDvirSummary;
    if (parsed?.schemaVersion !== 'suite-dvir-summary/1') return null;
    if (parsed.shiftId !== id) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Last finalized summary for Shift Complete reopen when shiftId still known. */
export async function loadLastFinalizedDvirSummary(
  kv: DvirReceiptKv,
): Promise<ShiftDvirSummary | null> {
  const raw = await kv.getItem(lastFinalizedDvirSummaryKey());
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ShiftDvirSummary;
    if (parsed?.schemaVersion !== 'suite-dvir-summary/1') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function overallDvirLabel(status: DvirOverallStatus): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'post_trip_completed':
      return 'Post-Trip completed';
    case 'partial':
      return 'Partial';
    default:
      return 'Not available';
  }
}
