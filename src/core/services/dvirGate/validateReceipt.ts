import {
  buildIntegrityPayload,
  PHASE_RECEIPT_SCHEMA,
  RECEIPT_VERSION,
  type DvirReceiptPhase,
  type PhaseCompletionReceipt,
} from './receiptTypes';

export type ValidateReceiptResult =
  | { ok: true; receipt: PhaseCompletionReceipt }
  | { ok: false; reason: string };

export async function validatePhaseCompletionReceipt(
  raw: unknown,
  deps: {
    sha256Hex: (canonical: string) => Promise<string>;
    expectedShiftId?: string;
    expectedPhase?: DvirReceiptPhase;
    maxAgeMs?: number;
    nowMs?: number;
  },
): Promise<ValidateReceiptResult> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Receipt is not an object' };
  }
  const r = raw as Partial<PhaseCompletionReceipt>;
  if (r.schemaVersion !== PHASE_RECEIPT_SCHEMA) {
    return { ok: false, reason: `Unsupported receipt schema: ${String(r.schemaVersion)}` };
  }
  if (r.version !== RECEIPT_VERSION) {
    return { ok: false, reason: `Unsupported receipt version: ${String(r.version)}` };
  }
  if (!r.receiptId?.trim()) return { ok: false, reason: 'receiptId missing' };
  if (!r.shiftId?.trim()) return { ok: false, reason: 'shiftId missing' };
  if (!r.inspectionId?.trim()) return { ok: false, reason: 'inspectionId missing' };
  if (r.phase !== 'pre_trip' && r.phase !== 'post_trip') {
    return { ok: false, reason: 'phase must be pre_trip or post_trip' };
  }
  if (!r.completedAt?.trim()) return { ok: false, reason: 'completedAt missing' };
  if (!r.integrity?.trim()) return { ok: false, reason: 'integrity missing' };

  if (deps.expectedShiftId && r.shiftId !== deps.expectedShiftId) {
    return { ok: false, reason: 'Receipt shiftId does not match active shift' };
  }
  if (deps.expectedPhase && r.phase !== deps.expectedPhase) {
    return { ok: false, reason: 'Receipt phase does not match expected phase' };
  }

  const completedMs = Date.parse(r.completedAt);
  if (Number.isNaN(completedMs)) {
    return { ok: false, reason: 'completedAt is not a valid timestamp' };
  }
  const now = deps.nowMs ?? Date.now();
  const maxAge = deps.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  if (completedMs > now + 5 * 60 * 1000) {
    return { ok: false, reason: 'completedAt is in the future' };
  }
  if (now - completedMs > maxAge) {
    return { ok: false, reason: 'Receipt is too old' };
  }

  const canonical = buildIntegrityPayload({
    schemaVersion: PHASE_RECEIPT_SCHEMA,
    receiptId: r.receiptId,
    shiftId: r.shiftId,
    inspectionId: r.inspectionId,
    phase: r.phase,
    completedAt: r.completedAt,
    version: RECEIPT_VERSION,
    driverHash: r.driverHash,
  });
  const expected = await deps.sha256Hex(canonical);
  if (expected.toLowerCase() !== r.integrity.toLowerCase()) {
    return { ok: false, reason: 'Integrity hash mismatch' };
  }

  return {
    ok: true,
    receipt: {
      schemaVersion: PHASE_RECEIPT_SCHEMA,
      receiptId: r.receiptId,
      shiftId: r.shiftId,
      inspectionId: r.inspectionId,
      phase: r.phase,
      completedAt: r.completedAt,
      version: RECEIPT_VERSION,
      integrity: r.integrity,
      driverHash: r.driverHash ?? null,
    },
  };
}

export function decodeReceiptFromDeepLink(encoded: string): unknown {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const json =
    typeof atob === 'function'
      ? atob(b64 + pad)
      : Buffer.from(b64 + pad, 'base64').toString('utf8');
  return JSON.parse(json);
}

export function encodeReceiptForDeepLink(receipt: PhaseCompletionReceipt): string {
  const json = JSON.stringify(receipt);
  const b64 =
    typeof btoa === 'function'
      ? btoa(json)
      : Buffer.from(json, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
