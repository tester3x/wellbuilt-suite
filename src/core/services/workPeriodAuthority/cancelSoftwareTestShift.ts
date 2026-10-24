import AsyncStorage from '@react-native-async-storage/async-storage';
import {getOwnedVerifiedIdentity} from '../firebaseAuthBoundary';
import {getFirebaseApp} from '../firebaseApp';
import {getCurrentShiftId} from '../shiftTracking';
import {isCallableReadyDriverSession,realShiftAuthorityTransport} from './shiftAuthorityClient';
import {preparedShiftJsa} from '../preparedShiftJsa';
import {endEtcForSuiteShift} from '../etcStart/etcEndDispatch';

/** Operator authorization and exact test fixtures are checked by the server.
 * Ordinary shifts continue to use the existing inspection/end-shift flow. */
export async function cancelSoftwareTestShift(reason:string,expected:{driverId:string;companyId:string}) {
  if(reason.trim().length<8||reason.length>240)throw Error('Enter a cancellation reason (8–240 characters).');
  const identity=await getOwnedVerifiedIdentity(getFirebaseApp());
  const periodId=await getCurrentShiftId();
  if(identity?.kind!=='driver'||identity.driverId!==expected.driverId||identity.companyId!==expected.companyId||!periodId)
    throw Error('Restore the test account and its current shift first.');
  if(!await isCallableReadyDriverSession(true))throw Error('Reconnect to verify the test cancellation.');
  const response=await realShiftAuthorityTransport('cancelAuthorizedSoftwareTestShift',{
    periodId,reason:reason.trim(),noActualWork:true,
  },25000) as Record<string,unknown>;
  if(response?.protocolVersion!==1||response.cancelledPeriodId!==periodId||typeof response.alreadyCancelled!=='boolean')
    throw Error('Cancellation is unconfirmed. Retry the same test cancellation.');
  const current=await getOwnedVerifiedIdentity(getFirebaseApp());
  if(current?.uid!==identity.uid||await getCurrentShiftId()!==periodId)throw Error('Account or shift changed. Reopen Suite to verify the result.');
  await preparedShiftJsa.endShift(periodId);
  // Persist and deliver the normal signed ETC end handoff after server ack.
  await endEtcForSuiteShift(expected,periodId);
  const pending=JSON.parse(await AsyncStorage.getItem(`suiteEtcEndV1:${expected.companyId}:${expected.driverId}`)||'[]');
  if(!Array.isArray(pending))throw Error('HOS end confirmation is unreadable; the test cancellation remains audited.');
  return {periodId,hosEndPending:pending.some(r=>r.suiteShiftId===periodId)};
}
