import { preparedShiftJsa } from '../preparedShiftJsa';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOwnedVerifiedIdentity } from '../firebaseAuthBoundary';
import { getFirebaseApp } from '../firebaseApp';
import { getCurrentShiftId } from '../shiftTracking';
import { receiptKey } from '../dvirGate/dvirReceiptStore';
import { readEtcStart } from '../etcStart/etcStartOutbox';
import { requestIdentityKey } from '../etcStart/etcStartProtocol';
import { createEtcPort } from '../etcStart/etcProduction';
import { hosBlocksUnstartedCancellation } from './cancelUnstartedHos';
import { isCallableReadyDriverSession, realShiftAuthorityTransport } from './shiftAuthorityClient';
import { cancelUnstartedShiftFlow } from './cancelUnstartedShiftFlow';

/** Online, authenticated cancellation only. A failed request never clears the shift. */
export async function cancelUnstartedShift(reason: string, expected: { driverId: string; companyId: string }): Promise<void> {
  let cancelledPeriod: string | null = null;
  await cancelUnstartedShiftFlow(reason, {
    context: async () => {
      const identity = await getOwnedVerifiedIdentity(getFirebaseApp());
      const periodId = await getCurrentShiftId();
      return identity?.kind === 'driver' && identity.driverId === expected.driverId
        && identity.companyId === expected.companyId && periodId
        ? { uid: identity.uid, driverId: expected.driverId, companyId: expected.companyId, periodId } : null;
    },
    // Any local receipt, including an unreadable one, prevents destructive cancellation.
    hasInspection: async id => !!(await AsyncStorage.getItem(receiptKey(id, 'pre_trip'))
      || await AsyncStorage.getItem(receiptKey(id, 'post_trip'))),
    hasHosRequest: async owner => hosBlocksUnstartedCancellation(await readEtcStart(AsyncStorage, requestIdentityKey({
      driverId: owner.driverId, companyId: owner.companyId, suiteShiftId: owner.periodId,
    })), createEtcPort(true)),
    cancel: async payload => {
      if (!await isCallableReadyDriverSession(true)) throw Error('Your account could not be verified. Reconnect and retry.');
      const result = await realShiftAuthorityTransport('cancelUnstartedDriverShift', payload, 25000);
      cancelledPeriod = await getCurrentShiftId();
      return result;
    },
  });
  if (cancelledPeriod) await preparedShiftJsa.endShift(cancelledPeriod).catch(() => {});
}
