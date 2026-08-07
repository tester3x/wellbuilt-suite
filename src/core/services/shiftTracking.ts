// src/core/services/shiftTracking.ts — DOT drive time shift bookend GPS capture
//
// Records login/logout GPS stamps to Firestore for DOT drive time auditing.
// Uses Firestore REST API (WB S doesn't have the Firestore JS SDK).
// Each driver gets one doc per day: driver_shifts/{driverId}_{YYYY-MM-DD}
// Events are appended via arrayUnion so multiple logins/logouts per day are tracked.
//
// Stale shift safeguard: on login, checks previous day's doc for an unmatched login.
// If found, auto-closes it with a synthetic logout at 23:59:59 of that day.
//
// shiftId — unique-per-shift token minted at Start Shift, used as the JSA
// scope key across WB S / WB T / WB JSA. Format `${YYYY-MM-DD}_${HHMMSS}`.
// Each shift gets its own JSA doc; closing the shift "freezes" that JSA
// because new shifts mint a new id. Stored in AsyncStorage so all three
// apps can read it (passed through SSO deep links to WB T / WB JSA).

import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SHIFT_ID_KEY = 'wellbuilt-current-shift-id';

/** Generate a new shift id from the current local time. */
export function mintShiftId(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}_${hh}${mi}${ss}`;
}

/** Persist the active shiftId to AsyncStorage. */
export async function setCurrentShiftId(shiftId: string): Promise<void> {
  try { await AsyncStorage.setItem(SHIFT_ID_KEY, shiftId); } catch {}
}

/** Read the active shiftId, or null if no shift is active. */
export async function getCurrentShiftId(): Promise<string | null> {
  try { return await AsyncStorage.getItem(SHIFT_ID_KEY); } catch { return null; }
}

/** Clear the active shiftId — called on shift end / logout. */
export async function clearCurrentShiftId(): Promise<void> {
  try { await AsyncStorage.removeItem(SHIFT_ID_KEY); } catch {}
}

const FIRESTORE_PROJECT = 'wellbuilt-sync';
const FIREBASE_API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';
const FETCH_TIMEOUT_MS = 10000;

/** fetch() with AbortController timeout — prevents indefinite hangs on slow/dead networks. */
async function fetchSafe(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface ShiftEvent {
  type: 'login' | 'logout' | 'depart_return';
  timestamp: string;   // ISO 8601
  lat: number;
  lng: number;
  source: 'wbt' | 'wbm' | 'wbs';
  synthetic?: boolean;  // true = auto-closed by system (driver forgot to log out)
  // Additive event metadata (2026-06-11) — purely optional. Readers parse
  // type/timestamp and ignore unknown fields, so omitting these is safe and
  // existing docs without them keep working. displayName encodes the device
  // (e.g. "Mike TabletS10 Burger"); driverHash is the identity behind the doc.
  displayName?: string;
  driverHash?: string;
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
    // Last-known position is instant (OS cache). End-of-shift logout
    // doesn't need a fresh fix — the driver is at the yard and will
    // sit there for hours; an audit stamp from the last fix (typically
    // <30s old when logging out at a known location) is plenty.
    // Per CLAUDE.md gotcha: NEVER block driver actions on GPS.
    // Pre-fix this was getCurrentPositionAsync with a 10s timeout —
    // tapping End Shift sat there for the full 10s on a cold GPS,
    // making drivers think the button didn't work.
    const lastKnown = await Location.getLastKnownPositionAsync();
    if (lastKnown?.coords) {
      return {
        timestamp: new Date(lastKnown.timestamp).toISOString(),
        lat: lastKnown.coords.latitude,
        lng: lastKnown.coords.longitude,
      };
    }
    // Last-known unavailable — try a brief fresh fix capped at 1.5s.
    // Worst case is an unstamped event in a truly GPS-dead environment
    // vs. the prior 10-second freeze.
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    if (fresh && (fresh as any).coords) {
      const f = fresh as any;
      return {
        timestamp: new Date(f.timestamp).toISOString(),
        lat: f.coords.latitude,
        lng: f.coords.longitude,
      };
    }
    return null;
  } catch (err) {
    console.error('[shiftTracking] GPS capture failed:', err);
    return null;
  }
}

/** YYYY-MM-DD string offset by N days from a given date. */
function dateString(d: Date, offsetDays: number = 0): string {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + offsetDays);
  const year = copy.getFullYear();
  const month = String(copy.getMonth() + 1).padStart(2, '0');
  const day = String(copy.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  if (event.displayName) {
    fields.displayName = { stringValue: event.displayName };
  }
  if (event.driverHash) {
    fields.driverHash = { stringValue: event.driverHash };
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
      const resp = await fetchSafe(getUrl);
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

        await fetchSafe(commitUrl, {
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
 * Read the most recent shift-event type for a driver's day doc, to gate illegal
 * transitions. Returns the last event's `type`, `null` when there's no doc / no
 * events (no open shift), or `'UNKNOWN'` when the READ ITSELF failed — in which
 * case the caller must FAIL OPEN (a transient read error must never skip a real
 * logout and leave a shift hanging open).
 */
async function readLastEventType(path: string): Promise<string | null | 'UNKNOWN'> {
  const getUrl = `https://firestore.googleapis.com/v1/${path}?key=${FIREBASE_API_KEY}`;
  try {
    const resp = await fetchSafe(getUrl);
    if (resp.status === 404) return null;
    if (!resp.ok) return 'UNKNOWN';
    const doc = await resp.json();
    const values = doc.fields?.events?.arrayValue?.values || [];
    if (values.length === 0) return null;
    return values[values.length - 1]?.mapValue?.fields?.type?.stringValue ?? null;
  } catch {
    return 'UNKNOWN';
  }
}

/**
 * Record a shift bookend (login or logout) with GPS coordinates.
 * Fire-and-forget — never throws, never blocks auth flow.
 *
 * On login: also checks for stale open shifts from previous days and auto-closes them.
 */
export async function recordShiftEvent(
  type: 'login' | 'logout' | 'depart_return',
  driverId: string,
  displayName: string,
  companyId?: string,
  source: 'wbt' | 'wbm' | 'wbs' = 'wbs',
  shiftId?: string,
): Promise<boolean> {
  try {
    const gps = await captureGPS();
    if (!gps) {
      console.warn(`[shiftTracking] GPS unavailable for ${type} — recording without GPS`);
    }

    if (type === 'login') {
      autoCloseStaleShift(driverId, source).catch(() => {});
    }

    const now = new Date();
    const date = dateString(now); // YYYY-MM-DD in local time
    const path = docPath(driverId, date);

    // ── Transition guard (safety net, 6/11/2026) ─────────────────────────────
    // Reject illegal shift history regardless of caller. `login` always opens a
    // new day/shift. `depart_return` and `logout` require an OPEN shift (last
    // event = login or depart_return); they are SKIPPED when the last event is
    // logout (already closed) or absent (no open shift) — the source of the
    // "login -> depart_return -> logout -> depart_return -> logout" corruption.
    // A skipped illegal event returns TRUE (safe: already closed / nothing to
    // close) so the caller's logout + cleanup never blocks. FAIL OPEN on a read
    // error so a transient GET never skips a real logout and leaves a shift open.
    if (type !== 'login') {
      const lastType = await readLastEventType(path);
      const openShift = lastType === 'login' || lastType === 'depart_return';
      if (lastType !== 'UNKNOWN' && !openShift) {
        console.warn(`[shiftTracking] Skipping illegal ${type} append — last event = ${lastType ?? 'none'} (no open shift).`);
        console.log(JSON.stringify({
          tag: '[shiftTracking][shift.guard]',
          skipped: true,
          type,
          lastEvent: lastType ?? 'none',
          driverHash: driverId,
          docId: `${driverId}_${date}`,
        }));
        return true;
      }
    }

    const event: ShiftEvent = {
      type,
      timestamp: gps?.timestamp || new Date().toISOString(),
      lat: gps?.lat || 0,
      lng: gps?.lng || 0,
      source,
      // Additive metadata — see ShiftEvent. displayName encodes the device.
      displayName,
      driverHash: driverId,
    };

    const fields: Record<string, any> = {
      driverId: { stringValue: driverId },
      displayName: { stringValue: displayName },
      date: { stringValue: date },
      updatedAt: { timestampValue: now.toISOString() },
    };
    const fieldPaths = ['driverId', 'displayName', 'date', 'updatedAt'];
    if (companyId) {
      fields.companyId = { stringValue: companyId };
      fieldPaths.push('companyId');
    }
    // Tag the shift doc with the latest shiftId so audit lookups can find
    // which JSA docs (jsa_day_status/{hash}_{shiftId}) belong to this day.
    if (shiftId) {
      fields.currentShiftId = { stringValue: shiftId };
      fieldPaths.push('currentShiftId');
    }
    // On logout, clear currentShiftId so WB JSA's refreshShiftIdFromServer
    // doesn't inherit the previous shift's id on the next session start.
    // Empty string falls through WB JSA's `stringValue || null` read into
    // the no-shift branch (AsyncStorage cleared, scope falls back to date).
    // (Audit 2026-04-27: stale field caused JSA to open into a closed shift.)
    if (type === 'logout') {
      fields.currentShiftId = { stringValue: '' };
      if (!fieldPaths.includes('currentShiftId')) {
        fieldPaths.push('currentShiftId');
      }
    }

    const body = {
      writes: [
        {
          update: { name: path, fields },
          updateMask: { fieldPaths },
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

    // Commit with ONE retry. A transient network blip on the logout write is
    // the common cause of a "login with no logout" shift that then renders as a
    // runaway open-shift duration on the dashboard. Each attempt is bounded by
    // FETCH_TIMEOUT_MS, never throws, and we return a boolean so the caller can
    // log a visible warning without ever blocking the user's logout.
    const attemptCommit = async (): Promise<{ ok: boolean; status?: number; text?: string; timedOut?: boolean }> => {
      try {
        const resp = await fetchSafe(commitUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (resp.ok) return { ok: true };
        const text = await resp.text().catch(() => '');
        return { ok: false, status: resp.status, text };
      } catch (e: any) {
        return { ok: false, text: e?.message || String(e), timedOut: e?.name === 'AbortError' };
      }
    };

    let result = await attemptCommit();
    // Retry once — but NOT after a timeout/abort. A timeout already consumed the
    // full FETCH_TIMEOUT_MS; retrying would just double the wait on a dead
    // network and keep the driver waiting on logout. Retry only FAST failures
    // (HTTP error / quick network error), which are the ones likely to succeed.
    if (!result.ok && !result.timedOut) {
      console.warn(`[shiftTracking] ${type} commit failed (status=${result.status ?? 'n/a'}) — retrying once: ${(result.text || '').slice(0, 200)}`);
      await new Promise((r) => setTimeout(r, 500));
      result = await attemptCommit();
    }

    if (!result.ok) {
      console.error(`[shiftTracking] ${type} commit FAILED after retry (status=${result.status ?? 'n/a'}):`, (result.text || '').slice(0, 300));
      // Persistent diagnostic — captures the silent-write case (same class as
      // the 4/28 field-test bug where WB JSA saw "no doc" and wiped state).
      console.log(JSON.stringify({
        tag: '[shiftTracking][shift.write]',
        ok: false,
        type,
        driverHash: driverId,
        localDate: date,
        docId: `${driverId}_${date}`,
        currentShiftIdValue: type === 'logout' ? '' : (shiftId || null),
        httpStatus: result.status ?? null,
        retried: true,
      }));
      return false;
    }

    console.log(`[shiftTracking] Recorded ${type} at ${gps?.lat?.toFixed(4) ?? 0}, ${gps?.lng?.toFixed(4) ?? 0}`);
    // Diagnostic — every successful write logs driverHash + localDate +
    // docId + currentShiftId so a post-mortem against WB JSA's
    // shiftId.refreshFromServer log can confirm the keys match exactly.
    console.log(JSON.stringify({
      tag: '[shiftTracking][shift.write]',
      ok: true,
      type,
      driverHash: driverId,
      localDate: date,
      docId: `${driverId}_${date}`,
      currentShiftIdValue: type === 'logout' ? '' : (shiftId || null),
    }));
    return true;
  } catch (err) {
    console.error(`[shiftTracking] Failed to record ${type}:`, err);
    return false;
  }
}

/**
 * Fetch the last "logout" GPS coords from recent shift docs — this is "the yard".
 * Scans up to 7 days back, returns the most recent logout event's lat/lng.
 * Caches result in AsyncStorage for instant access.
 */
export async function fetchLastYardLocation(
  driverId: string,
): Promise<{ lat: number; lng: number; timestamp: string } | null> {
  // Check AsyncStorage cache first
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const cached = await AsyncStorage.getItem('wellbuilt-yard-location');
    if (cached) {
      const parsed = JSON.parse(cached);
      // Use cache if less than 24 hours old (will update on next logout)
      const age = Date.now() - new Date(parsed.timestamp).getTime();
      if (age < 24 * 60 * 60 * 1000 && parsed.lat && parsed.lng) {
        return parsed;
      }
    }
  } catch {}

  // Scan recent shift docs for last logout event
  for (let daysBack = 1; daysBack <= 7; daysBack++) {
    const checkDate = dateString(new Date(), -daysBack);
    const path = docPath(driverId, checkDate);
    const getUrl = `https://firestore.googleapis.com/v1/${path}?key=${FIREBASE_API_KEY}`;

    try {
      const resp = await fetchSafe(getUrl);
      if (resp.status === 404 || !resp.ok) continue;

      const doc = await resp.json();
      const eventsArray = doc.fields?.events?.arrayValue?.values || [];

      // Find the LAST logout event in this day's doc
      let lastLogout: { lat: number; lng: number; timestamp: string } | null = null;
      for (const v of eventsArray) {
        const f = v.mapValue?.fields;
        if (f?.type?.stringValue === 'logout') {
          const lat = f?.lat?.doubleValue ?? f?.lat?.integerValue;
          const lng = f?.lng?.doubleValue ?? f?.lng?.integerValue;
          const ts = f?.timestamp?.stringValue;
          if (lat && lng && ts) {
            lastLogout = { lat, lng, timestamp: ts };
          }
        }
      }

      if (lastLogout) {
        // Cache it
        try {
          const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
          await AsyncStorage.setItem('wellbuilt-yard-location', JSON.stringify(lastLogout));
        } catch {}
        console.log(`[shiftTracking] Yard location from ${checkDate}: ${lastLogout.lat.toFixed(4)}, ${lastLogout.lng.toFixed(4)}`);
        return lastLogout;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Write odometer miles to today's shift doc for Day Summary.
 */
export async function writeOdometerMiles(driverId: string, miles: number): Promise<void> {
  const date = dateString(new Date());
  const patchUrl = `https://firestore.googleapis.com/v1/${docPath(driverId, date)}?updateMask.fieldPaths=odometerMiles&key=${FIREBASE_API_KEY}`;
  await fetch(patchUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        odometerMiles: { integerValue: String(miles) },
      },
    }),
  });
}

/**
 * Save the current logout GPS as the yard location cache.
 * Called after confirmArrival() records the logout event.
 */
export async function saveYardLocation(lat: number, lng: number): Promise<void> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem('wellbuilt-yard-location', JSON.stringify({
      lat, lng, timestamp: new Date().toISOString(),
    }));
  } catch {}
}

/**
 * Called on app open when driver is already logged in (persisted session).
 * Handles the common case: driver never logs out, just opens the app the next day.
 *
 * 1. Auto-closes any stale shift from a previous day
 * 2. Ensures today has a login event (so every working day has a record)
 */
/**
 * vc51.9C: fetch one authoritative driver_shifts day document for the
 * canonical verifier — 404 is definitive absence, transport failure is
 * UNREADABLE (never "closed", never "open").
 */
export async function fetchShiftDayDoc(
  driverId: string,
  date: string,
): Promise<{ readable: boolean; present: boolean; currentShiftId?: string }> {
  try {
    const resp = await fetchSafe(`https://firestore.googleapis.com/v1/${docPath(driverId, date)}?key=${FIREBASE_API_KEY}`);
    if (resp.status === 404) return { readable: true, present: false };
    if (!resp.ok) return { readable: false, present: false };
    const doc = await resp.json();
    const raw = doc?.fields?.currentShiftId?.stringValue;
    return { readable: true, present: true, ...(typeof raw === 'string' ? { currentShiftId: raw } : {}) };
  } catch {
    return { readable: false, present: false };
  }
}

export async function checkShiftOnResume(
  driverId: string,
  displayName: string,
  companyId?: string,
  source: 'wbt' | 'wbm' | 'wbs' = 'wbs',
  /** vc51.9C: the session's cached shift id — the backfilled login must
   *  restore the doc's currentShiftId scope key, never leave a
   *  scope-less shift that JSA/DVIR cannot bind to. */
  cachedShiftId?: string | null,
): Promise<void> {
  try {
    await autoCloseStaleShift(driverId, source);

    const today = dateString(new Date());
    const path = docPath(driverId, today);
    const getUrl = `https://firestore.googleapis.com/v1/${path}?key=${FIREBASE_API_KEY}`;

    const resp = await fetchSafe(getUrl);
    if (resp.ok) {
      // Doc exists — but check if it has a login event. If not, the original
      // recordShiftEvent('login') failed silently and we need to backfill it.
      // Without a login event, Day Summary shows --:-- for start time.
      try {
        const doc = await resp.json();
        const events = doc.fields?.events?.arrayValue?.values || [];
        const hasLogin = events.some((v: any) => v.mapValue?.fields?.type?.stringValue === 'login');
        if (hasLogin) return; // All good — login event exists
        console.log('[shiftTracking] Resume: shift doc exists but missing login event — backfilling');
      } catch {
        return; // Can't parse doc — don't risk a bad write
      }
    }

    const gps = await captureGPS();

    const event: ShiftEvent = {
      type: 'login',
      timestamp: gps?.timestamp || new Date().toISOString(),
      lat: gps?.lat || 0,
      lng: gps?.lng || 0,
      source,
    };

    const fields: Record<string, any> = {
      driverId: { stringValue: driverId },
      displayName: { stringValue: displayName },
      date: { stringValue: today },
      updatedAt: { timestampValue: new Date().toISOString() },
    };
    const fieldPaths = ['driverId', 'displayName', 'date', 'updatedAt'];
    if (companyId) {
      fields.companyId = { stringValue: companyId };
      fieldPaths.push('companyId');
    }
    // vc51.9C: the backfilled login restores the scope key so the shift
    // is never open-but-scopeless (JSA/DVIR bind on currentShiftId).
    if (cachedShiftId) {
      fields.currentShiftId = { stringValue: cachedShiftId };
      fieldPaths.push('currentShiftId');
    }

    const body = {
      writes: [
        {
          update: { name: path, fields },
          updateMask: { fieldPaths },
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

    await fetchSafe(commitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    console.log(`[shiftTracking] Resume: recorded today's login at ${gps?.lat?.toFixed(4) ?? 0}, ${gps?.lng?.toFixed(4) ?? 0}`);
  } catch (err) {
    console.error('[shiftTracking] checkShiftOnResume failed:', err);
  }
}

// ── Shift-start chat message to dispatch ────────────────────────────────────
// Sends a system message to all dispatch direct threads: "Driver has come on shift."
// Uses Firestore REST API to query threads and write messages.

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`;
const RUN_QUERY_URL = `${FIRESTORE_BASE}:runQuery?key=${FIREBASE_API_KEY}`;

/**
 * Send a shift-start notification to all dispatch direct chat threads.
 * Fire-and-forget — never throws, never blocks UI.
 */
export async function sendShiftStartToChat(
  driverId: string,
  driverName: string,
  companyId: string,
): Promise<void> {
  try {
    const participantId = `driver:${driverId}`;

    // Find direct threads where this driver participates
    const queryBody = {
      structuredQuery: {
        from: [{ collectionId: 'chat_threads' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: { field: { fieldPath: 'type' }, op: 'EQUAL', value: { stringValue: 'direct' } } },
              { fieldFilter: { field: { fieldPath: 'participants' }, op: 'ARRAY_CONTAINS', value: { stringValue: participantId } } },
              { fieldFilter: { field: { fieldPath: 'companyId' }, op: 'EQUAL', value: { stringValue: companyId } } },
            ],
          },
        },
        limit: 20,
      },
    };

    const resp = await fetchSafe(RUN_QUERY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queryBody),
    });
    if (!resp.ok) return;

    const results: any[] = await resp.json();
    const docs = results.filter((r: any) => r.document);
    if (docs.length === 0) return;

    // Filter for threads with exactly 2 DISTINCT participants: this driver + a dispatch user (user:*)
    // Self-chat guard: skip threads where all participants resolve to the same person
    const dispatchThreads = docs.filter(d => {
      const participants = d.document?.fields?.participants?.arrayValue?.values || [];
      if (participants.length !== 2) return false;
      // Deduplicate — reject if both participants are the same ID
      const ids = participants.map((p: any) => p.stringValue).filter(Boolean);
      if (new Set(ids).size < 2) return false;
      const hasDriver = ids.includes(participantId);
      const hasDispatch = ids.some((id: string) =>
        id.startsWith('user:') && id !== participantId,
      );
      return hasDriver && hasDispatch;
    });

    if (dispatchThreads.length === 0) return;

    const now = new Date().toISOString();
    const message = `${driverName} has come on shift.`;

    // Send system message to each dispatch thread
    for (const threadDoc of dispatchThreads) {
      const threadPath = threadDoc.document.name;
      const threadId = threadPath.split('/').pop();
      if (!threadId) continue;

      try {
        // Create message sub-document
        const msgUrl = `${FIRESTORE_BASE}/chat_threads/${threadId}/messages?key=${FIREBASE_API_KEY}`;
        await fetchSafe(msgUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              text: { stringValue: message },
              senderId: { stringValue: participantId },
              senderName: { stringValue: driverName },
              timestamp: { timestampValue: now },
              type: { stringValue: 'system' },
              systemType: { stringValue: 'shift_start' },
              clientId: { stringValue: `shift_start_${Date.now()}_${threadId.slice(0, 6)}` },
            },
          }),
        });

        // Update thread lastMessage
        const threadUrl = `${FIRESTORE_BASE}/chat_threads/${threadId}?key=${FIREBASE_API_KEY}`
          + '&updateMask.fieldPaths=lastMessage&updateMask.fieldPaths=updatedAt';
        await fetchSafe(threadUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              lastMessage: {
                mapValue: {
                  fields: {
                    text: { stringValue: message },
                    senderId: { stringValue: participantId },
                    senderName: { stringValue: driverName },
                    timestamp: { timestampValue: now },
                    type: { stringValue: 'system' },
                  },
                },
              },
              updatedAt: { timestampValue: now },
            },
          }),
        });

        console.log(`[shiftTracking] Sent shift-start message to thread: ${threadId}`);
      } catch (err) {
        console.warn('[shiftTracking] Failed to send shift-start to thread:', threadId, err);
      }
    }
  } catch (err) {
    console.warn('[shiftTracking] sendShiftStartToChat failed (non-blocking):', err);
  }
}
