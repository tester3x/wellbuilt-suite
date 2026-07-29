/**
 * Durable shift-scoped DVIR receipt store (Suite-local AsyncStorage).
 * Never trusts another app's storage.
 */
import type { DvirReceiptPhase, PhaseCompletionReceipt } from './receiptTypes';

const ROOT = '@wb/suite-dvir-gate/v1';

export function receiptKey(shiftId: string, phase: DvirReceiptPhase): string {
  return `${ROOT}/receipt/${shiftId}/${phase}`;
}

export function seenReceiptIdsKey(): string {
  return `${ROOT}/seenReceiptIds`;
}

export function pendingEndShiftKey(): string {
  return `${ROOT}/pendingEndShift`;
}

export interface PendingEndShift {
  shiftId: string;
  odometerMiles?: number;
  createdAt: string;
}

export interface DvirReceiptKv {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Save a validated receipt. Idempotent by receiptId — replaying the same
 * receiptId does not create a second unlock. Wrong-shift never overwrites.
 */
export async function saveReceiptIdempotent(
  kv: DvirReceiptKv,
  receipt: PhaseCompletionReceipt,
): Promise<'created' | 'already_exists'> {
  const key = receiptKey(receipt.shiftId, receipt.phase);
  const existingRaw = await kv.getItem(key);
  if (existingRaw) {
    try {
      const existing = JSON.parse(existingRaw) as PhaseCompletionReceipt;
      if (existing.receiptId === receipt.receiptId) return 'already_exists';
      // Same shift+phase already complete with different receipt — treat as exists
      return 'already_exists';
    } catch {
      /* replace corrupt */
    }
  }

  // Global receiptId idempotency
  const seen = await loadSeenIds(kv);
  if (seen.includes(receipt.receiptId)) {
    // Already processed under possibly different key — still write shift key if missing
    if (!existingRaw) {
      await kv.setItem(key, JSON.stringify(receipt));
    }
    return 'already_exists';
  }

  await kv.setItem(key, JSON.stringify(receipt));
  seen.push(receipt.receiptId);
  // Cap seen list growth
  const trimmed = seen.slice(-500);
  await kv.setItem(seenReceiptIdsKey(), JSON.stringify(trimmed));
  return 'created';
}

export async function getReceipt(
  kv: DvirReceiptKv,
  shiftId: string,
  phase: DvirReceiptPhase,
): Promise<PhaseCompletionReceipt | null> {
  const raw = await kv.getItem(receiptKey(shiftId, phase));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PhaseCompletionReceipt;
  } catch {
    return null;
  }
}

export async function hasValidPhase(
  kv: DvirReceiptKv,
  shiftId: string,
  phase: DvirReceiptPhase,
): Promise<boolean> {
  const r = await getReceipt(kv, shiftId, phase);
  return !!(r && r.shiftId === shiftId && r.phase === phase);
}

export async function setPendingEndShift(
  kv: DvirReceiptKv,
  pending: PendingEndShift,
): Promise<void> {
  await kv.setItem(pendingEndShiftKey(), JSON.stringify(pending));
}

export async function getPendingEndShift(
  kv: DvirReceiptKv,
): Promise<PendingEndShift | null> {
  const raw = await kv.getItem(pendingEndShiftKey());
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingEndShift;
  } catch {
    return null;
  }
}

export async function clearPendingEndShift(kv: DvirReceiptKv): Promise<void> {
  await kv.removeItem(pendingEndShiftKey());
}

/** Clear all gate state for a shift on logout (optional cleanup). */
export async function clearShiftReceipts(
  kv: DvirReceiptKv,
  shiftId: string,
): Promise<void> {
  await kv.removeItem(receiptKey(shiftId, 'pre_trip'));
  await kv.removeItem(receiptKey(shiftId, 'post_trip'));
  await clearPendingEndShift(kv);
}

async function loadSeenIds(kv: DvirReceiptKv): Promise<string[]> {
  const raw = await kv.getItem(seenReceiptIdsKey());
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}
