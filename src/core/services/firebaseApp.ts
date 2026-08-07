/**
 * WB-S Firebase app — single owner.
 *
 * WB-S historically reached Firebase entirely over REST (Firestore, RTDB,
 * callables, Identity Toolkit), so no FirebaseApp existed. Giving the app
 * a real SDK-owned Auth session needs one, and it must be exactly one:
 * a second `initializeApp` would produce a second Auth registry and defeat
 * the ownership guarantees in firebaseAuthBoundary.ts.
 *
 * This module is the only place that calls `initializeApp`. It does not
 * initialize Auth — that belongs to the boundary, which alone knows how
 * to attach AsyncStorage persistence.
 *
 * The values below are ordinary Firebase client configuration, not
 * secrets: the Web API key identifies the project and is designed to ship
 * in clients. Access is controlled by Security Rules and by server-side
 * verification of the driver's ID token, never by concealing this key.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';

export const FIREBASE_PROJECT_ID = 'wellbuilt-sync';
export const FIREBASE_REGION = 'us-central1';

/** Single project — WB-S has no environment variants today. */
const firebaseConfig = {
  apiKey: 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI',
  authDomain: `${FIREBASE_PROJECT_ID}.firebaseapp.com`,
  databaseURL: `https://${FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`,
  projectId: FIREBASE_PROJECT_ID,
  storageBucket: `${FIREBASE_PROJECT_ID}.firebasestorage.app`,
};

/**
 * The one FirebaseApp for this process. Idempotent so Fast Refresh and
 * repeat imports reuse the existing app rather than creating a second.
 */
export function getFirebaseApp(): FirebaseApp {
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}
