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
 * True when durable receipts are strictly more complete than a stored summary.
 * Used so a Partial (Pre-Trip only) summary cannot freeze out a later Post-Trip
 * receipt — field defect: DVIR Partial + Post-Trip "Not available" after
 * successful Post-Trip return.
 *
 * Does not invent phases: only upgrades when the rebuilt receipt-based
 * summary has evidence the stored one lacks.
 */
export function summaryNeedsReceiptUpgrade(
  existing: ShiftDvirSummary,
  builtFromReceipts: ShiftDvirSummary,
): boolean {
  if (existing.shiftId !== builtFromReceipts.shiftId) return false;
  // Completed summaries are terminal — never downgrade or thrash.
  if (existing.overallStatus === 'completed') return false;

  if (builtFromReceipts.overallStatus === 'completed') {
    return true;
  }
  if (
    builtFromReceipts.postTrip.status === 'completed' &&
    existing.postTrip.status !== 'completed'
  ) {
    return true;
  }
  if (
    builtFromReceipts.preTrip.status === 'captured' &&
    existing.preTrip.status !== 'captured' &&
    existing.preTrip.status !== 'not_captured'
  ) {
    // Allow upgrade into captured Pre-Trip when stored said missing/not_available.
    // Do not reverse legacy "not_captured" (post-only seal) without a real pre receipt.
    return true;
  }
  if (builtFromReceipts.postTrip.completedAt && !existing.postTrip.completedAt) {
    return true;
  }
  if (
    builtFromReceipts.preTrip.completedAt &&
    !existing.preTrip.completedAt &&
    builtFromReceipts.preTrip.status === 'captured'
  ) {
    return true;
  }
  return false;
}

/**
 * Hydrate Shift Complete DVIR summary for a shift:
 * - Assemble always from durable receipts for that shiftId only.
 * - If no summary exists, persist and return.
 * - If a summary exists but receipts are strictly more complete (e.g. Post-Trip
 *   arrived after Pre-Trip-only Partial was saved), upgrade and persist.
 * - Otherwise return the existing summary (idempotent; do not thrash truck units).
 *
 * Never marks complete from navigation alone — only from stored phase receipts.
 */
export async function hydrateShiftDvirSummaryIfMissing(
  kv: DvirReceiptKv,
  shiftId: string,
  opts?: { truckUnit?: string | null; trailerUnit?: string | null; nowIso?: string },
): Promise<ShiftDvirSummary | null> {
  const id = shiftId?.trim();
  if (!id) return null;

  const existing = await loadShiftDvirSummary(kv, id);
  const built = await buildShiftDvirSummaryFromStore(kv, id, opts);

  if (!existing) {
    await saveShiftDvirSummary(kv, built);
    return built;
  }

  if (summaryNeedsReceiptUpgrade(existing, built)) {
    // Keep vehicle identity already shown on Partial; do not thrash from SSO re-read
    const upgraded: ShiftDvirSummary = {
      ...built,
      truckUnit: existing.truckUnit || built.truckUnit || null,
      trailerUnit: existing.trailerUnit || built.trailerUnit || null,
    };
    await saveShiftDvirSummary(kv, upgraded);
    return upgraded;
  }

  return existing;
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
