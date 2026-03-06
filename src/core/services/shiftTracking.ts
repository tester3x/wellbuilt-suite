// src/core/services/shiftTracking.ts — DOT drive time shift bookend GPS capture
//
// Records login/logout GPS stamps to Firestore for DOT drive time auditing.
// Uses Firestore REST API (WB S doesn't have the Firestore JS SDK).
// Each driver gets one doc per day: driver_shifts/{driverId}_{YYYY-MM-DD}
// Events are appended via arrayUnion so multiple logins/logouts per day are tracked.
//
// Stale shift safeguard: on login, checks previous day's doc for an unmatched login.
// If found, auto-closes it with a synthetic logout at 23:59:59 of that day.

import * as Location from 'expo-location';

const FIRESTORE_PROJECT = 'wellbuilt-sync';
const FIREBASE_API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';

export interface ShiftEvent {
  type: 'login' | 'logout';
  timestamp: string;   // ISO 8601
  lat: number;
  lng: number;
  source: 'wbt' | 'wbm' | 'wbs';
  synthetic?: boolean;  // true = auto-closed by system (driver forgot to log out)
}

/**
 * Capture a one-shot GPS position. Returns null on failure.
 */
async function captureGPS(): Promise<{ timestamp: string; lat: number; lng: number } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[shiftTracking] GPS permission denied');
      return null;
    }
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return {
      timestamp: new Date(loc.timestamp).toISOString(),
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
    };
  } catch (err) {
    console.error('[shiftTracking] GPS capture failed:', err);
    return null;
  }
}

/** YYYY-MM-DD string offset by N days from a given date. */
function dateString(d: Date, offsetDays: number = 0): string {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + offsetDays);
  return copy.toISOString().slice(0, 10);
}

/** Build a Firestore REST document path. */
function docPath(driverId: string, date: string): string {
  return `projects/${FIRESTORE_PROJECT}/databases/(default)/documents/driver_shifts/${driverId}_${date}`;
}

/** Firestore commit URL. */
const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:commit?key=${FIREBASE_API_KEY}`;

/** Build a ShiftEvent as Firestore map value. */
function eventToFirestoreMap(event: ShiftEvent) {
  const fields: Record<string, any> = {
    type: { stringValue: event.type },
    timestamp: { stringValue: event.timestamp },
    lat: { doubleValue: event.lat },
    lng: { doubleValue: event.lng },
    source: { stringValue: event.source },
  };
  if (event.synthetic) {
    fields.synthetic = { booleanValue: true };
  }
  return { mapValue: { fields } };
}

/**
 * Auto-close any stale open shift from a previous day.
 * Checks up to 3 days back (covers weekend gaps).
 */
async function autoCloseStaleShift(
  driverId: string,
  source: 'wbt' | 'wbm' | 'wbs',
): Promise<void> {
  for (let daysBack = 1; daysBack <= 3; daysBack++) {
    const checkDate = dateString(new Date(), -daysBack);
    const path = docPath(driverId, checkDate);
    const getUrl = `https://firestore.googleapis.com/v1/${path}?key=${FIREBASE_API_KEY}`;

    try {
      const resp = await fetch(getUrl);
      if (resp.status === 404) continue;
      if (!resp.ok) continue;

      const doc = await resp.json();
      const eventsArray = doc.fields?.events?.arrayValue?.values || [];

      let logins = 0;
      let logouts = 0;
      for (const v of eventsArray) {
        const t = v.mapValue?.fields?.type?.stringValue;
        if (t === 'login') logins++;
        if (t === 'logout') logouts++;
      }

      if (logins > logouts) {
        const syntheticLogout: ShiftEvent = {
          type: 'logout',
          timestamp: `${checkDate}T23:59:59.000Z`,
          lat: 0,
          lng: 0,
          source,
          synthetic: true,
        };

        const body = {
          writes: [
            {
              update: {
                name: path,
                fields: {
                  updatedAt: { timestampValue: new Date().toISOString() },
                },
              },
              updateMask: { fieldPaths: ['updatedAt'] },
            },
            {
              transform: {
                document: path,
                fieldTransforms: [{
                  fieldPath: 'events',
                  appendMissingElements: { values: [eventToFirestoreMap(syntheticLogout)] },
                }],
              },
            },
          ],
        };

        await fetch(commitUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        console.log(`[shiftTracking] Auto-closed stale shift from ${checkDate}`);
      }

      break;
    } catch (err) {
      console.warn(`[shiftTracking] Failed to check stale shift ${checkDate}:`, err);
    }
  }
}

/**
 * Record a shift bookend (login or logout) with GPS coordinates.
 * Fire-and-forget — never throws, never blocks auth flow.
 *
 * On login: also checks for stale open shifts from previous days and auto-closes them.
 */
export async function recordShiftEvent(
  type: 'login' | 'logout',
  driverId: string,
  displayName: string,
  companyId?: string,
  source: 'wbt' | 'wbm' | 'wbs' = 'wbs',
): Promise<void> {
  try {
    const gps = await captureGPS();
    if (!gps) {
      console.warn(`[shiftTracking] GPS unavailable for ${type} — skipping`);
      return;
    }

    if (type === 'login') {
      autoCloseStaleShift(driverId, source).catch(() => {});
    }

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const path = docPath(driverId, date);

    const event: ShiftEvent = {
      type,
      timestamp: gps.timestamp,
      lat: gps.lat,
      lng: gps.lng,
      source,
    };

    const body = {
      writes: [
        {
          update: {
            name: path,
            fields: {
              driverId: { stringValue: driverId },
              displayName: { stringValue: displayName },
              companyId: companyId ? { stringValue: companyId } : { nullValue: null },
              date: { stringValue: date },
              updatedAt: { timestampValue: now.toISOString() },
            },
          },
          updateMask: {
            fieldPaths: ['driverId', 'displayName', 'companyId', 'date', 'updatedAt'],
          },
        },
        {
          transform: {
            document: path,
            fieldTransforms: [{
              fieldPath: 'events',
              appendMissingElements: { values: [eventToFirestoreMap(event)] },
            }],
          },
        },
      ],
    };

    const resp = await fetch(commitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[shiftTracking] Firestore commit failed (${resp.status}):`, text);
      return;
    }

    console.log(`[shiftTracking] Recorded ${type} at ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}`);
  } catch (err) {
    console.error(`[shiftTracking] Failed to record ${type}:`, err);
  }
}

/**
 * Called on app open when driver is already logged in (persisted session).
 * Handles the common case: driver never logs out, just opens the app the next day.
 *
 * 1. Auto-closes any stale shift from a previous day
 * 2. Ensures today has a login event (so every working day has a record)
 */
export async function checkShiftOnResume(
  driverId: string,
  displayName: string,
  companyId?: string,
  source: 'wbt' | 'wbm' | 'wbs' = 'wbs',
): Promise<void> {
  try {
    await autoCloseStaleShift(driverId, source);

    const today = dateString(new Date());
    const path = docPath(driverId, today);
    const getUrl = `https://firestore.googleapis.com/v1/${path}?key=${FIREBASE_API_KEY}`;

    const resp = await fetch(getUrl);
    if (resp.ok) return;

    const gps = await captureGPS();
    if (!gps) return;

    const event: ShiftEvent = {
      type: 'login',
      timestamp: gps.timestamp,
      lat: gps.lat,
      lng: gps.lng,
      source,
    };

    const body = {
      writes: [
        {
          update: {
            name: path,
            fields: {
              driverId: { stringValue: driverId },
              displayName: { stringValue: displayName },
              companyId: companyId ? { stringValue: companyId } : { nullValue: null },
              date: { stringValue: today },
              updatedAt: { timestampValue: new Date().toISOString() },
            },
          },
          updateMask: {
            fieldPaths: ['driverId', 'displayName', 'companyId', 'date', 'updatedAt'],
          },
        },
        {
          transform: {
            document: path,
            fieldTransforms: [{
              fieldPath: 'events',
              appendMissingElements: { values: [eventToFirestoreMap(event)] },
            }],
          },
        },
      ],
    };

    await fetch(commitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    console.log(`[shiftTracking] Resume: recorded today's login at ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}`);
  } catch (err) {
    console.error('[shiftTracking] checkShiftOnResume failed:', err);
  }
}
