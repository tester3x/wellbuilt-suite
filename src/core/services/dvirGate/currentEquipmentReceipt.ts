import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp, FIREBASE_REGION } from '../firebaseApp';
import { getOwnedVerifiedIdentity } from '../firebaseAuthBoundary';
import type { PhaseCompletionReceipt } from './receiptTypes';

/** A prior vehicle's cached receipt cannot satisfy the replacement vehicle. */
export async function isCurrentEquipmentReceipt(receipt: PhaseCompletionReceipt): Promise<boolean> {
  try {
    const app = getFirebaseApp();
    const who = await getOwnedVerifiedIdentity(app);
    if (who?.kind !== 'driver' || !who.driverId || !who.companyId || receipt.driverHash !== who.driverId) return false;
    const response = await httpsCallable(getFunctions(app, FIREBASE_REGION), 'resolveDriverDvirStatus', { timeout: 15000 })({
      expectedDriverId: who.driverId, expectedCompanyId: who.companyId, shiftId: receipt.shiftId,
    });
    const ledger = response.data as Record<string, any>;
    const phase = receipt.phase === 'pre_trip' ? ledger?.preTrip : ledger?.postTrip;
    return ledger?.protocolVersion === 1 && ledger.driverId === who.driverId && ledger.companyId === who.companyId
      && ledger.shiftId === receipt.shiftId && phase?.inspectionId === receipt.inspectionId
      && phase.completedAt === receipt.completedAt;
  } catch { return false; } // Unverified completion never ends a shift.
}
