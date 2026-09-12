import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp } from '../firebaseApp';
import { getOwnedVerifiedIdentity } from '../firebaseAuthBoundary';
import { buildIntegrityPayload, PHASE_RECEIPT_SCHEMA, RECEIPT_VERSION, type PhaseCompletionReceipt } from './receiptTypes';
import { saveReceiptIdempotent, type DvirReceiptKv } from './dvirReceiptStore';
import type { DvirOwner } from './ownedDvirKv';

export async function getDvirOwner(): Promise<DvirOwner> {
  const identity = await getOwnedVerifiedIdentity(getFirebaseApp());
  if (identity?.kind !== 'driver' || !identity.driverId || !identity.companyId) {
    throw new Error('Sign in to check inspection completion.');
  }
  return { driverId: identity.driverId, companyId: identity.companyId };
}

/** Every missing/unavailable lookup remains distinct from a completed phase. */
export async function hydrateFirebaseDvirReceipts(shiftId: string, kv: DvirReceiptKv,
  sha256Hex: (s: string) => Promise<string>): Promise<void> {
  const who = await getDvirOwner();
  const response = await httpsCallable(getFunctions(getFirebaseApp(), 'us-central1'), 'resolveDriverDvirStatus',
    { timeout: 15000 })({ shiftId, expectedDriverId: who.driverId, expectedCompanyId: who.companyId });
  const data = response.data as any;
  if (data.protocolVersion !== 1 || data.driverId !== who.driverId || data.companyId !== who.companyId
      || data.shiftId !== shiftId) throw new Error('Inspection response ownership could not be verified.');
  const still = await getDvirOwner();
  if (still.driverId !== who.driverId || still.companyId !== who.companyId) throw new Error('Driver changed during inspection lookup.');
  for (const [key, phase] of [['preTrip', 'pre_trip'], ['postTrip', 'post_trip']] as const) {
    const completion = data[key];
    if (!completion) continue;
    if (completion.phase !== phase || typeof completion.inspectionId !== 'string'
        || typeof completion.completedAt !== 'string' || !/^[a-f0-9]{64}$/.test(completion.reportDigest)) {
      throw new Error('Invalid inspection completion response.');
    }
    const receipt: PhaseCompletionReceipt = {
      schemaVersion: PHASE_RECEIPT_SCHEMA, version: RECEIPT_VERSION,
      receiptId: `rcpt_${shiftId}_${phase}_${completion.inspectionId}`,
      shiftId, inspectionId: completion.inspectionId, phase,
      completedAt: completion.completedAt, driverHash: who.driverId, integrity: '',
    };
    receipt.integrity = await sha256Hex(buildIntegrityPayload(receipt));
    await saveReceiptIdempotent(kv, receipt);
  }
}
