import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp } from '../firebaseApp';
import { getDvirOwner } from './firebaseDvirCompletion';

export type DvirRecovery = { shiftId: string; phase: 'post_trip' };
const fields = (who: { driverId: string; companyId: string }) => ({ expectedDriverId: who.driverId, expectedCompanyId: who.companyId });
export async function resolveDvirRecovery(): Promise<DvirRecovery | null> {
  const who = await getDvirOwner();
  const result = await httpsCallable(getFunctions(getFirebaseApp(), 'us-central1'), 'resolveDriverDvirRecovery',
    { timeout: 15000 })(fields(who));
  const data = result.data as any;
  const still = await getDvirOwner();
  if (data.protocolVersion !== 1 || data.driverId !== who.driverId || data.companyId !== who.companyId
      || still.driverId !== who.driverId || still.companyId !== who.companyId) throw new Error('Inspection owner changed. Please retry.');
  if (data.recovery === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}_\d{6}$/.test(data.recovery?.shiftId)
      || data.recovery?.phase !== 'post_trip') throw new Error('Could not verify the unfinished inspection.');
  return { shiftId: data.recovery.shiftId, phase: 'post_trip' };
}

export async function saveDvirRecoveryFeedback(shiftId: string, reason: string, note: string): Promise<void> {
  const who = await getDvirOwner();
  await httpsCallable(getFunctions(getFirebaseApp(), 'us-central1'), 'recordDriverDvirRecoveryFeedback',
    { timeout: 15000 })({ ...fields(who), shiftId, reason, note });
}
