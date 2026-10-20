import AsyncStorage from '@react-native-async-storage/async-storage';
import {getFunctions,httpsCallable} from 'firebase/functions';
import {getFirebaseApp} from './firebaseApp';
import {initializePersistentAuth,waitForAuthReady,getOwnedUserId,getOwnedVerifiedIdentity,getOwnedAuth} from './firebaseAuthBoundary';
import {createDeviceAccountClient,type DeviceAccountNative} from './deviceAccount.generated';
const native=require('../../../modules/wellbuilt-platform') as DeviceAccountNative|null;
export const suiteDeviceAccount=createDeviceAccountClient(native,async(name,data)=>(await httpsCallable(getFunctions(getFirebaseApp(),'us-central1'),name,{timeout:15000})(data)).data);
export async function restoreSuiteDeviceAccount(){
 initializePersistentAuth(getFirebaseApp(),AsyncStorage);await waitForAuthReady(getFirebaseApp());
 const capturedUser=getOwnedAuth(getFirebaseApp())?.currentUser;
 const {getDriverSession,saveDriverSession}=await import('./driverAuth');const saved=await getDriverSession(),uid=getOwnedUserId(getFirebaseApp());
 if(getOwnedAuth(getFirebaseApp())?.currentUser!==capturedUser)throw Object.assign(Error('Account changed during local restore.'),{code:'platform/superseded'});
 return suiteDeviceAccount.restore('suite',uid&&saved?.companyId?{uid,driverId:saved.driverId,companyId:saved.companyId}:null,async reply=>{
  const {installDeviceAccountToken}=await import('./secureDriverAuth');
  await installDeviceAccountToken(reply.customToken,reply.access.owner,async()=>{
  const verified=await getOwnedVerifiedIdentity(getFirebaseApp(),false),owner=reply.access.owner;
  if(!verified||verified.uid!==owner.uid||verified.driverId!==owner.driverId||verified.companyId!==owner.companyId||verified.app)throw Error('platform_identity_mismatch');
  await saveDriverSession(owner.driverId,reply.access.profile.displayName||'Driver',owner.driverId,false,false,owner.companyId,undefined,reply.access.profile.legalName||undefined);
  const {markSessionAuthMode,markSecureSessionVerified}=await import('./secureSessionRevalidation');await markSessionAuthMode('secure');await markSecureSessionVerified();
  });
 });
}
export async function publishSuiteDeviceAccount(explicit=false){
 const identity=await getOwnedVerifiedIdentity(getFirebaseApp(),false);if(!identity||identity.kind!=='driver'||!identity.driverId||!identity.companyId||identity.app)return;
 const local=await import('./driverAuth').then(m=>m.getDriverSession());
 if(local?.driverId!==identity.driverId||local?.companyId!==identity.companyId)return;
 const uid=identity.uid;await suiteDeviceAccount.publish({uid,driverId:identity.driverId,companyId:identity.companyId},()=>getOwnedUserId(getFirebaseApp())===uid,explicit);
}

export async function revokeSuiteDeviceAccount(){const saved=await suiteDeviceAccount.read();if(saved&&getOwnedUserId(getFirebaseApp())===saved.access.owner.uid)await suiteDeviceAccount.revoke(saved.access.owner);}
