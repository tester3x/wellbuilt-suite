import {getFunctions,httpsCallable} from 'firebase/functions';
import {getFirebaseApp} from './firebaseApp';
import {getOwnedAuth} from './firebaseAuthBoundary';
export const preparedShiftJsa=require('../../../modules/wellbuilt-platform/preparedJsa').createNativePreparedJsa({
 user:()=>getOwnedAuth(getFirebaseApp())?.currentUser,
 call:async(body:unknown)=>(await httpsCallable(getFunctions(getFirebaseApp()),'jsaOfflineShift',{timeout:15000})(body)).data,
});
let running:Promise<boolean>|null=null;
export function prepareShiftJsa(shiftId?:string){
 if(!running)running=preparedShiftJsa.preload({shiftId,reuseMs:300000}).then((g:any)=>!shiftId||g.shiftId===shiftId).catch(()=>false).finally(()=>{running=null;});
 return running;
}
