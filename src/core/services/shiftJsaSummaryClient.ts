import {getFunctions,httpsCallable} from 'firebase/functions';
import {getFirebaseApp,FIREBASE_REGION} from './firebaseApp';
import {getOwnedVerifiedIdentity} from './firebaseAuthBoundary';
import {fetchOwnedShiftJsaSummary} from './shiftJsaSummaryCore';
export function loadShiftJsaSummary(owner:{driverId:string;companyId:string},shiftId:string|null){
  const app=getFirebaseApp();
  return fetchOwnedShiftJsaSummary(owner,shiftId,{
    identity:()=>getOwnedVerifiedIdentity(app),
    call:async body=>(await httpsCallable(getFunctions(app,FIREBASE_REGION),'jsaShiftSummary',{timeout:35_000})(body)).data,
  });
}
