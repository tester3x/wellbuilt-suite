/**
 * Phase completion receipt from WellBuilt eQuipment (return deep-link).
 * Integrity is SHA-256 over canonical fields — corruption detection only,
 * not a shared-secret MAC (no client-embedded signing key).
 */

export const PHASE_RECEIPT_SCHEMA = 'wb-equipment-dvir-receipt/1' as const;
export const RECEIPT_VERSION = 1 as const;

export type DvirReceiptPhase = 'pre_trip' | 'post_trip';

export interface PhaseCompletionReceipt {
  schemaVersion: typeof PHASE_RECEIPT_SCHEMA;
  receiptId: string;
  shiftId: string;
  inspectionId: string;
  phase: DvirReceiptPhase;
  completedAt: string;
  version: number;
  integrity: string;
  driverHash?: string | null;
}

export function buildIntegrityPayload(parts: {
  schemaVersion: string;
  receiptId: string;
  shiftId: string;
  inspectionId: string;
  phase: DvirReceiptPhase;
  completedAt: string;
  version: number;
  driverHash?: string | null;
}): string {
  return [
    `schemaVersion=${parts.schemaVersion}`,
    `receiptId=${parts.receiptId}`,
    `shiftId=${parts.shiftId}`,
    `inspectionId=${parts.inspectionId}`,
    `phase=${parts.phase}`,
    `completedAt=${parts.completedAt}`,
    `version=${parts.version}`,
    `driverHash=${parts.driverHash?.trim().toLowerCase() || ''}`,
  ].join('\n');
}
