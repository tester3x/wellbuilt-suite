import {Linking} from 'react-native';
import {getFunctions,httpsCallable} from 'firebase/functions';
import {getFirebaseApp,FIREBASE_REGION} from './firebaseApp';
import {getOwnedVerifiedIdentity} from './firebaseAuthBoundary';
import {readLocalIdentity,resolveReconciliationForHandoff} from './authReconciliation';
import {currentSsoIdentityEpoch} from './ssoRuntime';
import {createEquipmentAccessHandler} from './equipmentAppAccessCore';

export const authorizeEquipmentAppAccess=createEquipmentAccessHandler({
 epoch:currentSsoIdentityEpoch,local:readLocalIdentity,reconcile:resolveReconciliationForHandoff,
 identity:refresh=>getOwnedVerifiedIdentity(getFirebaseApp(),refresh),now:()=>Date.now(),
 issue:async codeChallenge=>(await httpsCallable(getFunctions(getFirebaseApp(),FIREBASE_REGION),'issueEquipmentAppSession',{timeout:60000})({version:1,codeChallenge})).data,
 open:url=>Linking.openURL(url),
});
